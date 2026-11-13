// When a survivor is speaking, and what each frame it speaks goes out as.
//
// The microphone gives a frame every 20 ms whether anyone is talking or not.
// The gate decides which of them are sent: with push-to-talk, every frame
// while the key is held and for a short tail after it is let go, so the end
// of a word is not cut; the last of them is marked as the end. The uplink
// numbers what is sent and wraps it, once the encoder has made Opus of it.

import { AUDIO_HEADER, FRAME_SAMPLES, MAX_OPUS, flagsOf, writeAudio } from "../../../shared/voice/packet.ts";

/** Frames sent after the key is let go: 200 ms. */
export const TAIL_FRAMES = 10;

/** What to do with a frame: leave it, send it, or send it as the last of an utterance. */
export const GATE_SKIP = 0;
export const GATE_SEND = 1;
export const GATE_END = 2;

export class Gate {
  /** The talk key is held. */
  pressed = false;
  private tail = 0;

  /** Called once for each frame the microphone gives, in order. */
  step(): number {
    if (this.pressed) {
      this.tail = TAIL_FRAMES;
      return GATE_SEND;
    }
    if (this.tail === 0) return GATE_SKIP;
    return --this.tail === 0 ? GATE_END : GATE_SEND;
  }

  /** Whether anything is being sent: the key is held, or its tail is running. */
  get open(): boolean {
    return this.pressed || this.tail > 0;
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
