// The studio plays clips at the game's pace and lets the viewer loop, scrub or change speed.

import { TICK_RATE } from "../../../shared/coords.ts";

/** The speeds offered, slowest first. */
export const SPEEDS = [0.25, 0.5, 1, 2] as const;

export class Playback {
  /** The fractional sample position within the clip. */
  at = 0;
  frames = 1;
  loop = true;
  playing = true;
  speed = 1;

  private framesPerSecond = TICK_RATE;
  private loopFrames = 1;

  /** A timed move spans durationTicks from its first sample through its last. */
  start(frames: number, loop: boolean, durationTicks?: number): void {
    this.frames = Math.max(1, frames);
    this.loopFrames = durationTicks === undefined ? this.frames : Math.max(1, this.frames - 1);
    this.framesPerSecond = durationTicks === undefined ? TICK_RATE : this.loopFrames * TICK_RATE / durationTicks;
    this.loop = loop;
    this.at = 0;
    this.playing = true;
  }

  /** On by `seconds` of time. */
  step(seconds: number): void {
    if (!this.playing) return;
    this.at += seconds * this.framesPerSecond * this.speed;
    if (this.loop) this.at %= this.loopFrames;
    else if (this.at >= this.frames - 1) {
      this.at = this.frames - 1;
      this.playing = false;
    }
  }

  /** How far through, 0 to 1. */
  get share(): number {
    return this.frames <= 1 ? 0 : this.at / (this.loop ? this.loopFrames : this.frames - 1);
  }

  /** To `share` of the way through, 0 to 1. */
  scrub(share: number): void {
    const s = Math.max(0, Math.min(1, share));
    this.at = this.loop ? Math.min(this.loopFrames - 1e-6, s * this.loopFrames) : s * (this.frames - 1);
  }

  /** Plays, from the start again where a clip that does not loop has ended. */
  play(): void {
    if (!this.loop && this.at >= this.frames - 1) this.at = 0;
    this.playing = true;
  }

  /** Seconds through, and the clip's length, at speed 1. */
  get seconds(): number {
    return this.at / this.framesPerSecond;
  }
  get length(): number {
    return (this.loop ? this.loopFrames : this.frames - 1) / this.framesPerSecond;
  }
}
