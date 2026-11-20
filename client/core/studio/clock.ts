// The studio's playback of one clip: where in it the body is, as a frame of the clip's 30 a second, played, paused, sped,
// looped and scrubbed. A clip that does not loop holds its last frame when it ends, and stops.

import { TICK_RATE } from "../../../shared/coords.ts";

/** The speeds offered, slowest first. */
export const SPEEDS = [0.25, 0.5, 1, 2] as const;

export class Playback {
  /** The frame, fractional; 0 to `frames` for a loop, 0 to the last for one that is not. */
  at = 0;
  frames = 1;
  loop = true;
  playing = true;
  speed = 1;

  /** Starts a clip of `frames` frames from its first. */
  start(frames: number, loop: boolean): void {
    this.frames = Math.max(1, frames);
    this.loop = loop;
    this.at = 0;
    this.playing = true;
  }

  /** On by `seconds` of time. */
  step(seconds: number): void {
    if (!this.playing) return;
    this.at += seconds * TICK_RATE * this.speed;
    if (this.loop) this.at %= this.frames;
    else if (this.at >= this.frames - 1) {
      this.at = this.frames - 1;
      this.playing = false;
    }
  }

  /** How far through, 0 to 1. */
  get share(): number {
    return this.frames <= 1 ? 0 : this.at / (this.loop ? this.frames : this.frames - 1);
  }

  /** To `share` of the way through, 0 to 1. */
  scrub(share: number): void {
    const s = Math.max(0, Math.min(1, share));
    this.at = this.loop ? Math.min(this.frames - 1e-6, s * this.frames) : s * (this.frames - 1);
  }

  /** Plays, from the start again where a clip that does not loop has ended. */
  play(): void {
    if (!this.loop && this.at >= this.frames - 1) this.at = 0;
    this.playing = true;
  }

  /** Seconds through, and the clip's length, at speed 1. */
  get seconds(): number {
    return this.at / TICK_RATE;
  }
  get length(): number {
    return (this.loop ? this.frames : this.frames - 1) / TICK_RATE;
  }
}
