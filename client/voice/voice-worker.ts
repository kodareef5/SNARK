// The voice worker: the socket, the encoder and the decoders, off the page's thread. What to send and
// accept is decided in client/core/voice. This file joins those decisions to the browser.

import { Downlink } from "../core/voice/listen.ts";
import { GATE_END, GATE_OPEN, GATE_SKIP, Gate, PREROLL_FRAMES, Uplink, frameLevel } from "../core/voice/talk.ts";
import { AUTH_BYTES, FLAG_END, FRAME_SAMPLES, REACH_GLOBAL, SAMPLE_RATE, VOICE_INTRO, modeOf, reachOf, writeAuth } from "../../shared/voice/packet.ts";

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}
const scope = self as unknown as Scope;

/** Past this many unsent bytes a frame is dropped instead of queued, because late speech is useless. */
const MAX_UNSENT = 8192;
const RETRY_MS = 2000;
const IDLE_MS = 30000;

const gate = new Gate();
const up = new Uplink();
const down = new Downlink();
const stats = { socket: false, captured: 0, sent: 0, unsent: 0, received: 0, decoded: 0, errors: 0, rttMs: -1, level: 0, sending: false };
/** The last unsent microphone frames. If the next frame opens the gate, they go first. */
const before: Float32Array[] = [];
let url = "";
let auth = new Uint8Array(AUTH_BYTES);
let ws: WebSocket | null = null;
let wanted = false;
let playback: MessagePort | null = null;
let encoder: AudioEncoder | null = null;
/** When each packet was sent, indexed by frame number modulo 256, for the round-trip time. */
const sentAt = new Float64Array(256);

interface Listening {
  decoder: AudioDecoder;
  /** For each frame given to the decoder and not yet back, its time, its flags, and whether it is the last. */
  times: number[];
  modes: number[];
  ends: boolean[];
  usedAt: number;
}
const listening = new Map<number, Listening>();

function connect(): void {
  if (!wanted) return;
  const sock = new WebSocket(url);
  ws = sock;
  sock.binaryType = "arraybuffer";
  sock.onopen = () => {
    sock.send(auth);
    stats.socket = true;
  };
  sock.onmessage = (e) => {
    stats.received++;
    const data = new Uint8Array(e.data as ArrayBuffer);
    down.receive(data, hear);
    // After an intro the page is sent the handle and name of every introduced speaker.
    if (data[0] !== VOICE_INTRO) return;
    const who: [number, number, string][] = [];
    for (const [speaker, s] of down.speakers) if (s.handle !== 0) who.push([speaker, s.handle, s.name]);
    scope.postMessage({ who });
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    stats.socket = false;
    ws = null;
    setTimeout(connect, RETRY_MS);
  };
}

/** Gives one arrived frame to its speaker's own decoder. */
function hear(speaker: number, flags: number, time: number, opus: Uint8Array): void {
  const end = (flags & FLAG_END) !== 0;
  if (opus.length === 0) {
    if (end) playback?.postMessage({ s: speaker, t: time, m: modeOf(flags), g: reachOf(flags) === REACH_GLOBAL, e: true, p: null });
    return;
  }
  let l = listening.get(speaker);
  if (!l || l.decoder.state === "closed") {
    const mine: Listening = { times: [], modes: [], ends: [], usedAt: 0, decoder: null as unknown as AudioDecoder };
    mine.decoder = new AudioDecoder({ output: (data) => decoded(speaker, mine, data), error: () => void stats.errors++ });
    mine.decoder.configure({ codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
    listening.set(speaker, (l = mine));
  }
  // With the loop on, this is its own voice coming back, which times the round trip.
  if (up.loop) {
    const at = sentAt[(time / FRAME_SAMPLES) & 255]!;
    if (at > 0) stats.rttMs = performance.now() - at;
  }
  l.times.push(time);
  l.modes.push(flags);
  l.ends.push(end);
  l.usedAt = performance.now();
  l.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: (time / FRAME_SAMPLES) * 20000, data: opus }));
}

function decoded(speaker: number, l: Listening, data: AudioData): void {
  const time = l.times.shift();
  const flags = l.modes.shift() ?? 0;
  const end = l.ends.shift();
  const pcm = new Float32Array(data.numberOfFrames);
  data.copyTo(pcm, { planeIndex: 0, format: "f32-planar" });
  data.close();
  if (time === undefined) return;
  stats.decoded++;
  playback?.postMessage({ s: speaker, t: time, m: modeOf(flags), g: reachOf(flags) === REACH_GLOBAL, e: end === true, p: pcm }, [pcm.buffer]);
}

function capture(pcm: Float32Array): void {
  stats.captured++;
  const level = frameLevel(pcm);
  // The meter jumps to a louder frame and falls back slowly.
  stats.level = level > stats.level ? level : stats.level * 0.9 + level * 0.1;
  const say = gate.step(level);
  stats.sending = gate.sending;
  if (say === GATE_SKIP) {
    if (gate.open && gate.pressed) {
      before.push(pcm);
      if (before.length > PREROLL_FRAMES) before.shift();
    } else before.length = 0;
    up.capture(say);
    return;
  }
  if (!encoder || encoder.state === "closed") {
    // The frames a lost encoder was given will not come back.
    up.drop();
    encoder = new AudioEncoder({ output: encoded, error: () => void stats.errors++ });
    // One 20 ms speech frame per packet. DTX is off because the gate decides what is sent.
    const opus = { frameDuration: 20000, application: "voip", signal: "voice", usedtx: false, useinbandfec: false };
    encoder.configure({ codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 24000, bitrateMode: "variable", opus } as AudioEncoderConfig);
  }
  // The gate has just opened. The frames from before the sound go first, so its beginning is not cut.
  if (say === GATE_OPEN) for (let k = before.length; k > 0; k--) encode(before[before.length - k]!, up.recall(k));
  before.length = 0;
  encode(pcm, up.capture(say));
  // The last frame of an utterance must not wait inside the encoder for the next one.
  if (say === GATE_END) void encoder.flush().catch(() => {});
}

/** `micros` is the frame's time on the speaker's clock. */
function encode(pcm: Float32Array, micros: number): void {
  if (micros < 0 || !encoder) return;
  const data = new AudioData({ format: "f32", sampleRate: SAMPLE_RATE, numberOfFrames: FRAME_SAMPLES, numberOfChannels: 1, timestamp: micros, data: pcm as Float32Array<ArrayBuffer> });
  encoder.encode(data);
  data.close();
}

function encoded(chunk: EncodedAudioChunk): void {
  const opus = new Uint8Array(chunk.byteLength);
  chunk.copyTo(opus);
  const packet = up.encoded(opus);
  if (!packet) return;
  if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_UNSENT) {
    stats.unsent++;
    return;
  }
  // The packet's time is in its header, after its kind, flags and number.
  const time = (packet[4]! | (packet[5]! << 8) | (packet[6]! << 16) | (packet[7]! << 24)) >>> 0;
  sentAt[(time / FRAME_SAMPLES) & 255] = performance.now();
  ws.send(packet as Uint8Array<ArrayBuffer>);
  stats.sent++;
}

scope.onmessage = (e) => {
  const m = e.data as { t: string; url?: string; slot?: number; token?: Uint8Array; port?: MessagePort; on?: boolean; open?: boolean; mode?: number; reach?: number; loop?: boolean };
  if (m.t === "open") {
    // A new token means a new connection.
    url = m.url!;
    auth = new Uint8Array(AUTH_BYTES);
    writeAuth(auth, m.slot!, m.token!);
    wanted = true;
    const old = ws;
    ws = null;
    old?.close();
    connect();
  } else if (m.t === "playback") playback = m.port!;
  else if (m.t === "mic") m.port!.onmessage = (frame) => capture(frame.data as Float32Array);
  else if (m.t === "talk") {
    gate.pressed = m.on!;
    gate.open = m.open!;
    up.mode = m.mode!;
    up.reach = m.reach!;
    up.loop = m.loop!;
  } else if (m.t === "close") {
    wanted = false;
    ws?.close();
  }
};

// Ten times a second the page gets the stats, and decoders idle for IDLE_MS are closed.
setInterval(() => {
  scope.postMessage(stats);
  const now = performance.now();
  for (const [speaker, l] of listening) {
    if (now - l.usedAt < IDLE_MS) continue;
    if (l.decoder.state !== "closed") l.decoder.close();
    listening.delete(speaker);
  }
}, 100);
