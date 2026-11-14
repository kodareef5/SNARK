// Voice in a browser: the audio context, the microphone, the two worklets and the worker, joined up. Nothing here is tested.
// Hearing starts once the session has its token and the viewer has touched the page, because a browser plays nothing before that.

import { HEAR_FIELDS, type VoicePort, type VoiceSpeaker } from "../core/voice/port.ts";
import { MODE_TALK, REACH_LOCAL } from "../../shared/voice/packet.ts";

export interface VoiceReport {
  status: string;
  socket: boolean;
  captured: number;
  sent: number;
  received: number;
  decoded: number;
  played: number;
  missing: number;
  late: number;
  odd: number;
  errors: number;
  /** Round trip of a packet through the server while the loop is on, or -1 before one has come back. */
  rttMs: number;
  /** outputMs is the latency the audio device adds. targetMs is the longest jitter target of any speaker playing. */
  outputMs: number;
  targetMs: number;
  /** Microphone level, 0 to 1. */
  level: number;
  sending: boolean;
  /** Names of the speakers whose voices have been played. */
  heard: string[];
  sampleRate: number;
}

export class VoiceIo implements VoicePort {
  notice = "";
  /** Asks the server to send this client's own voice back, for testing a microphone and for the probe. */
  loop = false;
  readonly report: VoiceReport = { status: "off", socket: false, captured: 0, sent: 0, received: 0, decoded: 0, played: 0, missing: 0, late: 0, odd: 0, errors: 0, rttMs: -1, outputMs: 0, targetMs: 0, level: 0, sending: false, heard: [], sampleRate: 0 };
  readonly speakers = new Map<number, VoiceSpeaker>();
  private out: AudioWorkletNode | null = null;
  private ctx: AudioContext | null = null;
  private worker: Worker | null = null;
  private mic: "none" | "asking" | "open" | "refused" = "none";
  private talking = false;
  private mode = MODE_TALK;
  private open_ = false;
  private gain = 1;
  private version = -1;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  static get supported(): boolean {
    return typeof AudioEncoder !== "undefined" && typeof AudioDecoder !== "undefined" && typeof AudioWorkletNode !== "undefined" && typeof Worker !== "undefined";
  }

  /** Call every frame with session.voice. Opens audio output on the first token, and the socket again whenever the token changes. */
  sync(voice: { slot: number; token: Uint8Array; version: number }): void {
    if (voice.version === this.version || voice.version === 0) return;
    this.version = voice.version;
    if (!VoiceIo.supported) {
      this.notice = "voice: this browser cannot";
      this.report.status = "unsupported";
      return;
    }
    void this.open(voice.slot, voice.token).catch((err: unknown) => {
      this.notice = "voice: failed to start";
      this.report.status = `error: ${err instanceof Error ? err.message : String(err)}`;
    });
  }

  private async open(slot: number, token: Uint8Array): Promise<void> {
    if (!this.worker) {
      const ctx = (this.ctx = new AudioContext({ latencyHint: "interactive" }));
      await ctx.audioWorklet.addModule("voice-playback.js");
      const out = new AudioWorkletNode(ctx, "snark-playback", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      out.connect(ctx.destination);
      const link = new MessageChannel();
      out.port.postMessage({ port: link.port1 }, [link.port1]);
      this.out = out;
      out.port.onmessage = (e) => {
        const { speaking, ...numbers } = e.data as { speaking: number[] };
        Object.assign(this.report, numbers);
        for (const [speaker, s] of this.speakers) {
          s.speaking = speaking.includes(speaker);
          if (s.speaking && !this.report.heard.includes(s.name)) this.report.heard.push(s.name);
        }
      };
      out.port.postMessage({ v: this.gain });
      this.worker = new Worker("voice-worker.js", { type: "module" });
      this.worker.onmessage = (e) => {
        const who = (e.data as { who?: [number, number, string][] }).who;
        if (!who) return void Object.assign(this.report, e.data);
        for (const [speaker, handle, name] of who) {
          const s = this.speakers.get(speaker);
          if (s) Object.assign(s, { handle, name });
          else this.speakers.set(speaker, { handle, name, speaking: false });
        }
      };
      this.worker.postMessage({ t: "playback", port: link.port2 }, [link.port2]);
      this.report.sampleRate = ctx.sampleRate;
      this.report.status = "listening";
    }
    this.worker.postMessage({ t: "open", url: this.url, slot, token });
    this.unlock();
  }

  /** Call when the viewer touches the page. A browser plays nothing before that, so the context is resumed here. */
  unlock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    this.report.outputMs = Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000);
  }

  get level(): number {
    return this.report.level;
  }

  get sending(): boolean {
    return this.report.sending;
  }

  hear(places: Float32Array, count: number): void {
    this.out?.port.postMessage({ d: places.slice(0, count * HEAR_FIELDS) });
  }

  volume(gain: number): void {
    this.gain = gain;
    this.out?.port.postMessage({ v: gain });
  }

  talk(on: boolean, mode = this.mode, open = this.open_): void {
    this.talking = on;
    this.mode = mode;
    this.open_ = open;
    if (on && this.mic === "none") void this.microphone();
    this.unlock();
    this.worker?.postMessage({ t: "talk", on: on && this.mic === "open", open, mode, reach: REACH_LOCAL, loop: this.loop });
  }

  /** Runs the first time the talk key is pressed, and joins the microphone to the worker. */
  private async microphone(): Promise<void> {
    const ctx = this.ctx;
    const worker = this.worker;
    if (!ctx || !worker) return;
    this.mic = "asking";
    this.notice = "voice: asking for the microphone";
    try {
      // The stream runs at the device's own rate. The capture worklet resamples it to the encoder's.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      await ctx.audioWorklet.addModule("voice-capture.js");
      const capture = new AudioWorkletNode(ctx, "snark-capture", { numberOfInputs: 1, numberOfOutputs: 1 });
      ctx.createMediaStreamSource(stream).connect(capture);
      // The capture node reaches the output through a silent gain, so that every browser keeps it running.
      const silence = ctx.createGain();
      silence.gain.value = 0;
      capture.connect(silence).connect(ctx.destination);
      const link = new MessageChannel();
      capture.port.postMessage({ port: link.port1 }, [link.port1]);
      worker.postMessage({ t: "mic", port: link.port2 }, [link.port2]);
      this.mic = "open";
      this.notice = "";
      this.report.status = "ready";
      // The key may still be down from the press that asked.
      this.talk(this.talking);
    } catch {
      this.mic = "refused";
      this.notice = "voice: no microphone (refused, or none to be had)";
      this.report.status = "no microphone";
    }
  }
}
