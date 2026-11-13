// When a survivor is speaking, and what each frame it speaks goes out as.
//
// The microphone gives a frame every 20 ms whether anyone is talking or not.
// The gate decides which of them are sent. Held to talk: every frame while
// the key is held and for a short tail after it is let go, so the end of a
// word is not cut. Switched on and left open: only while there is something
// to hear, beginning a little before the sound that opened it and going on a
// little after the last. Either way the last frame is marked as the end. The
// uplink numbers what is sent and wraps it, once the encoder has made Opus
// of it.

import { AUDIO_HEADER, FRAME_SAMPLES, MAX_OPUS, flagsOf, writeAudio } from "../../../shared/voice/packet.ts";

/** Frames sent after the key is let go: 200 ms. */
export const TAIL_FRAMES = 10;

/** With the microphone left open: frames sent from before the sound that opened the gate, and after the last sound: 360 ms. */
export const PREROLL_FRAMES = 2;
export const HANG_FRAMES = 18;
/** How loud a frame must be to open the gate: -45 dB below full, as a root mean square. */
export const OPEN_LEVEL = 10 ** (-45 / 20);

/**
 * What to do with a frame: leave it, send it, send it as the last of an
 * utterance, or send it after the few before it that were left.
 */
export const GATE_SKIP = 0;
export const GATE_SEND = 1;
export const GATE_END = 2;
export const GATE_OPEN = 3;

/** How loud a frame is: the root of the mean of its squares, 0 to 1. */
export function frameLevel(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / (pcm.length || 1));
}

export class Gate {
  /** The talk key is held; or, with `open`, the microphone has been switched on and is left on. */
  pressed = false;
  /** Send only while there is sound, not all the while `pressed` is so. */
  open = false;
  private tail = 0;
  private sounding = false;

  /** Called once for each frame the microphone gives, in order, with how loud it is. */
  step(level = 1): number {
    if (this.pressed && this.open) {
      // Left open: a frame loud enough opens it, and it stays open a while after the last that was.
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

  /** Whether anything is being sent now. */
  get sending(): boolean {
    return this.sounding;
  }
}

export class Uplink {
  /** How loud it is meant, who it is for, and whether the server should send it back as well. */
  mode = 1;
  reach = 0;
  loop = false;
  /** Packets made. */
  sent = 0;
  private seq = 0;
  /** Frames the microphone has given, sent or not: a packet's time is its frame's number in samples. */
  private frame = 0;
  /** For each frame handed to the encoder and not yet back: its time and whether it is the last. */
  private readonly pendingTime: number[] = [];
  private readonly pendingEnd: boolean[] = [];
  private readonly out = new Uint8Array(AUDIO_HEADER + MAX_OPUS);

  /**
   * The microphone gave a frame and the gate said what to do with it. Returns
   * the frame's time in microseconds if it is to be encoded, or -1.
   */
  capture(gate: number): number {
    const time = this.frame * FRAME_SAMPLES;
    // Before the count of samples would pass what 32 bits hold, it starts again; listeners take that as a new start.
    this.frame = time + FRAME_SAMPLES * 2 > 0xffffffff ? 0 : this.frame + 1;
    if (gate === GATE_SKIP) return -1;
    this.pendingTime.push(time);
    this.pendingEnd.push(gate === GATE_END);
    return (time / FRAME_SAMPLES) * 20000;
  }

  /**
   * The frame that was given `back` frames before the next one is to be sent
   * after all, having been left at the time: the gate opened on what followed
   * it. Returns its time in microseconds, or -1 if there was no such frame.
   * Call for the oldest first, before `capture` for the frame that opened the gate.
   */
  recall(back: number): number {
    const f = this.frame - back;
    if (f < 0) return -1;
    this.pendingTime.push(f * FRAME_SAMPLES);
    this.pendingEnd.push(false);
    return f * 20000;
  }

  /**
   * The encoder made Opus of the oldest frame it was given. Returns the packet
   * to send (a view, good until the next call), or null if the Opus is too
   * large to carry or nothing was waiting.
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

  /** The encoder was reset: what it had been given will not come back. */
  drop(): void {
    this.pendingTime.length = 0;
    this.pendingEnd.length = 0;
  }
}
