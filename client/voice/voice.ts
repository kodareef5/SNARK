// Voice in a browser, as the page sees it: the audio context, the microphone,
// the two worklets and the worker, joined up. Hearing starts when the session
// has been given its token and the viewer has touched the page (a browser
// plays nothing before that); the microphone is asked for the first time the
// talk key is pressed.
//
// Nothing here is tested, and nothing here decides anything: see
// client/core/voice and shared/voice for what does.

import type { VoicePort } from "../core/voice/port.ts";
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
  /** Milliseconds for a packet to come back from the server, when the loop is on; -1 before one has. */
  rttMs: number;
  /** Milliseconds the audio device adds on the way out. */
  outputMs: number;
  sampleRate: number;
}

export class VoiceIo implements VoicePort {
  notice = "";
  /** Have the server send this client's own voice back to it: for testing a microphone, and the probe. */
  loop = false;
  readonly report: VoiceReport = { status: "off", socket: false, captured: 0, sent: 0, received: 0, decoded: 0, played: 0, missing: 0, late: 0, odd: 0, errors: 0, rttMs: -1, outputMs: 0, sampleRate: 0 };
  private ctx: AudioContext | null = null;
  private worker: Worker | null = null;
  private mic: "none" | "asking" | "open" | "refused" = "none";
  private talking = false;
  private version = -1;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  /** Whether this browser can do it at all: encode and decode Opus, and run audio worklets. */
  static get supported(): boolean {
    return typeof AudioEncoder !== "undefined" && typeof AudioDecoder !== "undefined" && typeof AudioWorkletNode !== "undefined" && typeof Worker !== "undefined";
  }

  /**
   * Called every frame with what the session was told. Opens the way to the
   * ear the first time there is a token, and the socket again whenever the
   * token changes.
   */
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
      out.port.onmessage = (e) => Object.assign(this.report, e.data);
      this.worker = new Worker("voice-worker.js", { type: "module" });
      this.worker.onmessage = (e) => Object.assign(this.report, e.data);
      this.worker.postMessage({ t: "playback", port: link.port2 }, [link.port2]);
      this.report.sampleRate = ctx.sampleRate;
      this.report.status = "listening";
    }
    this.worker.postMessage({ t: "open", url: this.url, slot, token });
    this.unlock();
  }

  /** The viewer touched the page: sound may start now. */
  unlock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    this.report.outputMs = Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000);
  }

  talk(on: boolean): void {
    this.talking = on;
    if (on && this.mic === "none") void this.microphone();
    this.unlock();
    this.worker?.postMessage({ t: "talk", on: on && this.mic === "open", mode: MODE_TALK, reach: REACH_LOCAL, loop: this.loop });
  }

  /** Ask for the microphone and join it to the worker. */
  private async microphone(): Promise<void> {
    const ctx = this.ctx;
    const worker = this.worker;
    if (!ctx || !worker) return;
    this.mic = "asking";
    this.notice = "voice: asking for the microphone";
    try {
      // The device's own rate: the capture worklet brings it to the encoder's.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      await ctx.audioWorklet.addModule("voice-capture.js");
      const capture = new AudioWorkletNode(ctx, "snark-capture", { numberOfInputs: 1, numberOfOutputs: 1 });
      ctx.createMediaStreamSource(stream).connect(capture);
      // Joined to the output through silence, so that every browser keeps it running.
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
