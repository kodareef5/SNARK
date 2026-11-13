// Voice packets: what travels on the voice socket, in both directions.
//
// Byte-aligned and little-endian, each message one packet. Audio is Opus, one
// mono 20 ms frame to a packet, and is never decoded by the server. A packet
// carries its sequence number and its time in samples, so that a transport
// that drops or reorders can take the socket's place without a new format.
//
//   up    AUTH   u8 1 | u16 slot | 8 bytes token
//         AUDIO  u8 2 | u8 flags | u16 seq | u32 time | Opus, 0 to 200 bytes
//   down  BATCH  u8 3 | u8 count | count x { u16 speaker | u8 flags | u16 seq
//                                            | u32 time | u16 length | Opus }
//         INTRO  u8 4 | u16 speaker | u32 entity handle | u8 length | name
//
// Flags: bit 0 the last packet of an utterance; bits 1-2 how loud it is meant
// (whisper, talk, yell); bits 3-4 who it is for (those near, the tribe,
// everyone); bit 5 send it back to the sender as well. Bits 6-7 are zero.
//
// A client says nothing of who it is or where: the server knows both from the
// session the socket was opened for.

export const VOICE_AUTH = 1;
export const VOICE_AUDIO = 2;
export const VOICE_BATCH = 3;
export const VOICE_INTRO = 4;

export const FLAG_END = 1;
export const MODE_SHIFT = 1;
export const MODE_WHISPER = 0;
export const MODE_TALK = 1;
export const MODE_YELL = 2;
export const REACH_SHIFT = 3;
export const REACH_LOCAL = 0;
export const REACH_TRIBE = 1;
export const REACH_GLOBAL = 2;
export const FLAG_LOOP = 32;
const RESERVED = 0xc0;

/** How far a voice carries, in metres, by how loud it is meant: a whisper, talk, a yell. */
export const VOICE_RANGE: readonly number[] = [4, 25, 60];
/** Someone already hearing a speaker goes on hearing it out to this many times its range, so that a step back and forth at the edge is not heard as cuts. */
export const KEEP_RANGE = 1.1;
/** The most speakers one listener is sent at once: the nearest. */
export const MAX_HEARD = 8;

/** Samples a second, and in one frame: 20 ms. */
export const SAMPLE_RATE = 48000;
export const FRAME_SAMPLES = 960;
export const TOKEN_BYTES = 8;
export const MAX_OPUS = 200;
export const AUTH_BYTES = 3 + TOKEN_BYTES;
export const AUDIO_HEADER = 8;
/** Bytes of one frame inside a batch, before its Opus. */
export const ENTRY_HEADER = 11;
/** A batch is kept under one network packet's worth. */
export const MAX_BATCH = 1400;
export const MAX_INTRO_NAME = 72;

export function flagsOf(mode: number, reach: number, end: boolean, loop: boolean): number {
  return (end ? FLAG_END : 0) | (mode << MODE_SHIFT) | (reach << REACH_SHIFT) | (loop ? FLAG_LOOP : 0);
}

export function modeOf(flags: number): number {
  return (flags >> MODE_SHIFT) & 3;
}

export function reachOf(flags: number): number {
  return (flags >> REACH_SHIFT) & 3;
}

/** Whether flags are ones a packet may carry: nothing reserved, and a loudness and a reach that exist. */
export function flagsValid(flags: number): boolean {
  return (flags & RESERVED) === 0 && modeOf(flags) <= MODE_YELL && reachOf(flags) <= REACH_GLOBAL;
}

/**
 * Whether an Opus packet's first byte says what every packet here must be: one
 * frame, mono, 20 ms. (RFC 6716, section 3.1: the configuration in the top five
 * bits, then a stereo bit, then how many frames.)
 */
export function opusFrameValid(toc: number): boolean {
  const config = toc >> 3;
  // 20 ms: the second of each SILK set of four, the second of each hybrid pair, the fourth of each CELT set of four.
  const twenty = config < 12 ? (config & 3) === 1 : config < 16 ? (config & 1) === 1 : (config & 3) === 3;
  return twenty && (toc & 4) === 0 && (toc & 3) === 0;
}

/** Whether sequence number `a` is newer than `b`, the two being 16 bits that wrap. */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

export function writeAuth(out: Uint8Array, slot: number, token: Uint8Array): number {
  out[0] = VOICE_AUTH;
  out[1] = slot & 0xff;
  out[2] = (slot >> 8) & 0xff;
  for (let i = 0; i < TOKEN_BYTES; i++) out[3 + i] = token[i] ?? 0;
  return AUTH_BYTES;
}

/** Write an audio packet into `out`, which must hold AUDIO_HEADER and the Opus. Returns its length. */
export function writeAudio(out: Uint8Array, flags: number, seq: number, time: number, opus: Uint8Array, length = opus.length): number {
  out[0] = VOICE_AUDIO;
  out[1] = flags;
  out[2] = seq & 0xff;
  out[3] = (seq >> 8) & 0xff;
  out[4] = time & 0xff;
  out[5] = (time >>> 8) & 0xff;
  out[6] = (time >>> 16) & 0xff;
  out[7] = (time >>> 24) & 0xff;
  out.set(length === opus.length ? opus : opus.subarray(0, length), AUDIO_HEADER);
  return AUDIO_HEADER + length;
}

/** The fields of the audio packet last parsed. `opus` is a view of the packet. */
export const audio: { flags: number; seq: number; time: number; opus: Uint8Array } = { flags: 0, seq: 0, time: 0, opus: new Uint8Array(0) };

/**
 * Parse an audio packet into `audio`. False if it is not one a client may
 * send: the wrong size, reserved flags, or Opus that is not one mono 20 ms frame.
 */
export function parseAudio(data: Uint8Array): boolean {
  const n = data.length;
  if (n < AUDIO_HEADER || n > AUDIO_HEADER + MAX_OPUS || data[0] !== VOICE_AUDIO) return false;
  const flags = data[1]!;
  if (!flagsValid(flags)) return false;
  if (n > AUDIO_HEADER && !opusFrameValid(data[AUDIO_HEADER]!)) return false;
  audio.flags = flags;
  audio.seq = data[2]! | (data[3]! << 8);
  audio.time = (data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24)) >>> 0;
  audio.opus = data.subarray(AUDIO_HEADER);
  return true;
}

/** Frames for one listener, gathered until there is a packet's worth or the turn ends. */
export class Batch {
  readonly bytes = new Uint8Array(MAX_BATCH);
  length = 2;
  count = 0;

  constructor() {
    this.bytes[0] = VOICE_BATCH;
  }

  /** Whether one more frame with this much Opus would fit. */
  fits(opusLength: number): boolean {
    return this.count < 255 && this.length + ENTRY_HEADER + opusLength <= MAX_BATCH;
  }

  /** Add a frame. The caller has checked `fits`. */
  add(speaker: number, flags: number, seq: number, time: number, opus: Uint8Array): void {
    const b = this.bytes;
    let at = this.length;
    b[at++] = speaker & 0xff;
    b[at++] = (speaker >> 8) & 0xff;
    b[at++] = flags;
    b[at++] = seq & 0xff;
    b[at++] = (seq >> 8) & 0xff;
    b[at++] = time & 0xff;
    b[at++] = (time >>> 8) & 0xff;
    b[at++] = (time >>> 16) & 0xff;
    b[at++] = (time >>> 24) & 0xff;
    b[at++] = opus.length & 0xff;
    b[at++] = (opus.length >> 8) & 0xff;
    b.set(opus, at);
    this.length = at + opus.length;
    b[1] = ++this.count;
  }

  /** What to send: a view, good until the next `reset`. */
  packet(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }

  reset(): void {
    this.length = 2;
    this.count = 0;
    this.bytes[1] = 0;
  }
}

/**
 * Read a batch, calling `each` for every frame with a view of its Opus. False
 * if the packet is not a well-formed batch; frames before the fault have been
 * given.
 */
export function readBatch(data: Uint8Array, each: (speaker: number, flags: number, seq: number, time: number, opus: Uint8Array) => void): boolean {
  if (data.length < 2 || data[0] !== VOICE_BATCH) return false;
  let at = 2;
  for (let k = data[1]!; k > 0; k--) {
    if (at + ENTRY_HEADER > data.length) return false;
    const speaker = data[at]! | (data[at + 1]! << 8);
    const flags = data[at + 2]!;
    const seq = data[at + 3]! | (data[at + 4]! << 8);
    const time = (data[at + 5]! | (data[at + 6]! << 8) | (data[at + 7]! << 16) | (data[at + 8]! << 24)) >>> 0;
    const length = data[at + 9]! | (data[at + 10]! << 8);
    at += ENTRY_HEADER;
    if (length > MAX_OPUS || at + length > data.length) return false;
    each(speaker, flags, seq, time, data.subarray(at, at + length));
    at += length;
  }
  return at === data.length;
}

/** Who a speaker number is: the entity to place its voice at, and its name. `name` is UTF-8, already encoded. */
export function writeIntro(out: Uint8Array, speaker: number, handle: number, name: Uint8Array): number {
  const n = Math.min(name.length, MAX_INTRO_NAME);
  out[0] = VOICE_INTRO;
  out[1] = speaker & 0xff;
  out[2] = (speaker >> 8) & 0xff;
  out[3] = handle & 0xff;
  out[4] = (handle >>> 8) & 0xff;
  out[5] = (handle >>> 16) & 0xff;
  out[6] = (handle >>> 24) & 0xff;
  out[7] = n;
  out.set(n === name.length ? name : name.subarray(0, n), 8);
  return 8 + n;
}

/** The fields of an introduction, or null if the packet is not one. `name` is a view. */
export function readIntro(data: Uint8Array): { speaker: number; handle: number; name: Uint8Array } | null {
  if (data.length < 8 || data[0] !== VOICE_INTRO || data.length !== 8 + data[7]! || data[7]! > MAX_INTRO_NAME) return null;
  return { speaker: data[1]! | (data[2]! << 8), handle: (data[3]! | (data[4]! << 8) | (data[5]! << 16) | (data[6]! << 24)) >>> 0, name: data.subarray(8) };
}
