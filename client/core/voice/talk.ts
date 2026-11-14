// The gate decides which microphone frames are sent, and the uplink numbers and wraps them once encoded.
// The last frame of an utterance is marked as the end.

import { AUDIO_HEADER, FRAME_SAMPLES, MAX_OPUS, flagsOf, writeAudio } from "../../../shared/voice/packet.ts";

/** Frames sent after the key is let go (200 ms), so the end of a word is not cut. */
export const TAIL_FRAMES = 10;

/** With an open microphone, frames sent from before the sound that opened the gate, and after the last sound (360 ms). */
export const PREROLL_FRAMES = 2;
export const HANG_FRAMES = 18;
/** The RMS level that opens the gate, -45 dB relative to full scale. */
export const OPEN_LEVEL = 10 ** (-45 / 20);

/** What to do with a frame. GATE_END sends it as the last of an utterance. GATE_OPEN sends it after the few skipped before it. */
export const GATE_SKIP = 0;
export const GATE_SEND = 1;
export const GATE_END = 2;
export const GATE_OPEN = 3;

/** Root mean square, 0 to 1. */
export function frameLevel(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / (pcm.length || 1));
}

export class Gate {
  /** The talk key is held or, with `open`, the microphone is switched on. */
  pressed = false;
  /** Send only while there is sound, not all the time `pressed` holds. */
  open = false;
  private tail = 0;
  private sounding = false;

  /** Call once for each microphone frame, in order. Returns a GATE_ value. */
  step(level = 1): number {
    if (this.pressed && this.open) {
      if (level >= OPEN_LEVEL) {
        this.tail = HANG_FRAMES;
        if (this.sounding) return GATE_SEND;
        this.sounding = true;
        return GATE_OPEN;
      }
      if (!this.sounding) return GATE_SKIP;
    } else if (this.pressed) {
      this.tail = TAIL_FRAMES;
      this.sounding = true;
      return GATE_SEND;
    }
    if (this.tail === 0 || !this.sounding) {
      this.sounding = false;
      return GATE_SKIP;
    }
    if (--this.tail > 0) return GATE_SEND;
    this.sounding = false;
    return GATE_END;
  }

  get sending(): boolean {
    return this.sounding;
  }
}

export class Uplink {
  /** mode is a MODE_ value and reach a REACH_ value. loop asks the server to send the voice back as well. */
  mode = 1;
  reach = 0;
  loop = false;
  /** Packets made. */
  sent = 0;
  private seq = 0;
  /** Frames the microphone has given, sent or not. A packet's time is its frame's number in samples. */
  private frame = 0;
  /** For each frame handed to the encoder and not yet back, its time and whether it is the last. */
  private readonly pendingTime: number[] = [];
  private readonly pendingEnd: boolean[] = [];
  private readonly out = new Uint8Array(AUDIO_HEADER + MAX_OPUS);

  /** Takes the gate's verdict for one microphone frame. Returns the frame's time in microseconds if it is to be encoded, or -1. */
  capture(gate: number): number {
    const time = this.frame * FRAME_SAMPLES;
    // The sample count restarts before it would pass 32 bits. Listeners take that as a new start.
    this.frame = time + FRAME_SAMPLES * 2 > 0xffffffff ? 0 : this.frame + 1;
    if (gate === GATE_SKIP) return -1;
    this.pendingTime.push(time);
    this.pendingEnd.push(gate === GATE_END);
    return (time / FRAME_SAMPLES) * 20000;
  }

  /**
   * Queues for sending the frame given `back` frames before the next one. The gate skipped it, then opened on
   * what followed. Returns its time in microseconds, or -1 if there was no such frame. Call for the oldest
   * first, before `capture` for the frame that opened the gate.
   */
  recall(back: number): number {
    const f = this.frame - back;
    if (f < 0) return -1;
    this.pendingTime.push(f * FRAME_SAMPLES);
    this.pendingEnd.push(false);
    return f * 20000;
  }

  /**
   * Call with the Opus of the oldest pending frame. Returns the packet to send (a view, good until the next call),
   * or null if the Opus is too large or nothing was pending.
   */
  encoded(opus: Uint8Array): Uint8Array | null {
    const time = this.pendingTime.shift();
    const end = this.pendingEnd.shift();
    if (time === undefined || opus.length > MAX_OPUS) return null;
    const n = writeAudio(this.out, flagsOf(this.mode, this.reach, end === true, this.loop), this.seq, time, opus);
    this.seq = (this.seq + 1) & 0xffff;
    this.sent++;
    return this.out.subarray(0, n);
  }

  /** The encoder was reset, so the frames it was given will not come back. */
  drop(): void {
    this.pendingTime.length = 0;
    this.pendingEnd.length = 0;
  }
}
