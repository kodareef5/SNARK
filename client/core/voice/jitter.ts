// One speaker's audio between the network and the ear.
//
// Frames arrive when the network delivers them: early, late, in bursts, or
// not at all. They are played on the listener's own clock. This buffer holds
// decoded frames by the time their speaker gave them and plays them `target`
// samples behind the newest, which is the room it has to absorb an uneven
// arrival. It runs inside the playback worklet, so it allocates nothing after
// it is made and reads no clock: whoever calls `read` is the clock.
//
// The technique is the usual one (NetEQ, Mumble, moq's audio ring): place by
// timestamp, play behind, drop what comes too late to play, and start again
// from the arrival of the next frame when playing has run dry.

import { FRAME_SAMPLES, SAMPLE_RATE } from "../../../shared/voice/packet.ts";

/** Frames held: 1.28 s, far more than any target. */
const SLOTS = 64;
const F = FRAME_SAMPLES;
/** How far behind the newest frame playing starts, in samples: 60 ms. */
export const START_TARGET = (SAMPLE_RATE * 60) / 1000;
/**
 * More than this beyond the target in hand means a burst arrived after a
 * stall. What is older is skipped: a listener is better served by the present
 * than by a growing delay.
 */
const BURST = (SAMPLE_RATE * 120) / 1000;
/** With nothing left to play and no end said, a speaker is given this long to go on before it is taken to have stopped. */
const GIVE_UP = (SAMPLE_RATE * 500) / 1000;

export class JitterBuffer {
  /** Samples behind the newest frame that playing runs. */
  target = START_TARGET;
  /** Whether there is, or may soon be, something of this speaker to hear. */
  playing = false;
  /** Frames played, frames that were due and had not come, frames that came too late, new starts after running dry, skips after a burst, and frames of a shape that cannot be placed. */
  readonly stats = { played: 0, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 };
  /** The speaker's time of the next sample to play. */
  private cursor = 0;
  private readonly pcm = new Float32Array(SLOTS * F);
  /** For each slot, the number of the frame it holds, plus one; 0 for none. */
  private readonly held = new Uint32Array(SLOTS);
  /** The frame this start began with, the newest taken in, and the last of the utterance once its end has been said; -1 for none. */
  private first = 0;
  private newest = -1;
  private last = -1;

  /**
   * Take in one decoded frame: `time` is the speaker's, in samples, and a
   * multiple of the frame; `end` says nothing follows it.
   */
  push(time: number, pcm: Float32Array, end = false): void {
    if (pcm.length !== F || time % F !== 0 || time < 0) {
      this.stats.odd++;
      return;
    }
    const f = time / F;
    const dry = this.cursor >= (this.newest + 1) * F;
    if (!this.playing || f > this.newest + SLOTS || f + SLOTS < this.newest) {
      // The first frame, or one from another time altogether (the speaker began again): start from here.
      this.start(time);
    } else if (time + F <= this.cursor) {
      // Too late to play. If playing has run dry, everything will be: start again from this one.
      if (!dry) {
        this.stats.late++;
        return;
      }
      this.stats.restarts++;
      this.start(time);
    } else if (time - this.cursor > this.target + BURST) {
      // A stall, then everything at once: what is in hand is older than anyone should hear. Skip to the target.
      this.cursor = time - this.target;
      this.first = Math.ceil(this.cursor / F);
      this.stats.jumps++;
    }
    const slot = f % SLOTS;
    this.pcm.set(pcm, slot * F);
    this.held[slot] = f + 1;
    if (f > this.newest) this.newest = f;
    if (end) this.last = f;
  }

  /** Nothing follows the newest frame in hand: said by an end that came with no sound of its own. */
  end(): void {
    if (this.playing && this.newest >= 0) this.last = this.newest;
  }

  private start(time: number): void {
    this.held.fill(0);
    this.cursor = time - this.target;
    this.first = time / F;
    this.newest = -1;
    this.last = -1;
    this.playing = true;
  }

  /**
   * The next `n` samples of this speaker, added to `out` at `gain`. Returns
   * false, touching nothing, if the speaker is silent. A frame that is due and
   * has not come is silence.
   */
  read(out: Float32Array, n: number, gain = 1): boolean {
    if (!this.playing) return false;
    let p = this.cursor;
    for (let i = 0; i < n; ) {
      const f = Math.floor(p / F);
      const off = p - f * F;
      const run = Math.min(n - i, F - off);
      if (f >= this.first && f <= this.newest) {
        const slot = f % SLOTS;
        if (this.held[slot] === f + 1) {
          const from = slot * F + off;
          for (let k = 0; k < run; k++) out[i + k]! += this.pcm[from + k]! * gain;
          if (off + run === F) this.stats.played++;
        } else if (off + run === F) this.stats.missing++;
      }
      i += run;
      p += run;
    }
    this.cursor = p;
    // Past the end it said, or long past anything it sent: it has stopped.
    if ((this.last >= 0 && p >= (this.last + 1) * F) || p > (this.newest + 1) * F + GIVE_UP) this.playing = false;
    return true;
  }

  /** Samples in hand ahead of what is playing: 0 when it has run dry. */
  get depth(): number {
    const ahead = (this.newest + 1) * F - this.cursor;
    return this.playing && ahead > 0 ? ahead : 0;
  }
}
