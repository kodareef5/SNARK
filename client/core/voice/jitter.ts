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
// from the arrival of the next frame when playing has run dry. How far behind
// is learnt from how unevenly frames have been arriving, and a frame that is
// due and has not come is covered for a moment by the one before it.

import { FRAME_SAMPLES, SAMPLE_RATE } from "../../../shared/voice/packet.ts";

/** Frames held: 1.28 s, far more than any target. */
const SLOTS = 64;
const F = FRAME_SAMPLES;
const MS = SAMPLE_RATE / 1000;
/** How far behind the newest frame playing starts before anything is known of the link, and the least and most it may become. */
export const START_TARGET = 60 * MS;
export const MIN_TARGET = 40 * MS;
export const MAX_TARGET = 300 * MS;
/**
 * More than this beyond the target in hand means a burst arrived after a
 * stall. What is older is skipped: a listener is better served by the present
 * than by a growing delay.
 */
const BURST = 120 * MS;
/** With nothing left to play and no end said, a speaker is given this long to go on before it is taken to have stopped. */
const GIVE_UP = 500 * MS;
/** After running dry, playing starts again this far behind the frame that restarts it. */
const CUSHION = 40 * MS;
/** Lateness is counted in steps of a frame, up to this many; the count fades by this much with each frame that arrives. */
const BUCKETS = 16;
const FADE = 0.983;
/** How late a frame may be for the target to cover it: all but one in twenty. */
const COVER = 0.95;
/** The fastest arrival is looked for over twice this long. */
const WINDOW = SAMPLE_RATE;
/** A gap is covered for this long, the cover halving each frame; then it dies away at once. */
const COVER_SAMPLES = 60 * MS;
const HALVE = 0.5 ** (1 / F);
const DIE = 0.96;
const QUIET = 1e-4;
/** Real sound comes back in over this long from a cover, and over this long from silence. */
const SEAM = 2.5 * MS;
const FADE_IN = 5 * MS;

export class JitterBuffer {
  /** Samples behind the newest frame that playing runs; and what the link has lately asked for, taken up at the next start. */
  target = START_TARGET;
  wanted = START_TARGET;
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
  /** How late frames have been, counted by frames of lateness; and the least delay seen in this second and the one before. */
  private readonly lateness = new Float32Array(BUCKETS);
  private least = Infinity;
  private leastBefore = Infinity;
  private windowEnd = 0;
  /** The last frame played to its end (its slot, or -1), which a gap is covered from. */
  private from = -1;
  /** Whether what is due is not here; samples of cover given for it; where the cover is in that frame, which way it is going, and how loud it still is. */
  private gapping = false;
  private gap = 0;
  private at = 0;
  private dir = -1;
  private cover = 0;
  /** Samples left of bringing real sound back in, and out of how many. */
  private seam = 0;
  private seamOf = 1;

  /**
   * Take in one decoded frame: `time` is the speaker's, in samples, and a
   * multiple of the frame; `end` says nothing follows it; `arrival` is the
   * listener's clock in samples when it came, if the caller keeps one.
   */
  push(time: number, pcm: Float32Array, end = false, arrival = -1): void {
    if (pcm.length !== F || time % F !== 0 || time < 0) {
      this.stats.odd++;
      return;
    }
    if (arrival >= 0) this.observe(time, arrival);
    const f = time / F;
    const dry = this.cursor >= (this.newest + 1) * F;
    if (!this.playing || f > this.newest + SLOTS || f + SLOTS < this.newest) {
      // The first frame, or one from another time altogether (the speaker began again): start from here.
      this.target = this.wanted;
      this.start(time, this.target);
    } else if (time + F <= this.cursor) {
      // Too late to play. If playing has run dry, everything will be: start again from this one.
      if (!dry) {
        this.stats.late++;
        return;
      }
      // The target was not enough: a frame more, and a short wait so that sound is back soon.
      this.stats.restarts++;
      this.wanted = this.target = Math.min(MAX_TARGET, Math.max(this.wanted, this.target + F));
      this.start(time, CUSHION);
    } else if (time - this.cursor > this.target + BURST) {
      // A stall, then everything at once: what is in hand is older than anyone should hear. Skip to the target.
      this.cursor = time - this.target;
      this.first = Math.ceil(this.cursor / F);
      this.stats.jumps++;
      // What was playing is carried over the cut by its own echo, as a gap is.
      this.gapping = true;
      this.gap = 0;
      this.cover = this.from >= 0 ? 1 : 0;
      this.at = F - 1;
      this.dir = -1;
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

  /** Note how late a frame came, against the fastest of late, and what target would have covered all but a few. */
  private observe(time: number, arrival: number): void {
    const delay = arrival - time;
    if (arrival >= this.windowEnd) {
      this.leastBefore = this.least;
      this.least = Infinity;
      this.windowEnd = arrival + WINDOW;
    }
    if (delay < this.least) this.least = delay;
    const late = delay - Math.min(this.least, this.leastBefore);
    const h = this.lateness;
    let total = 0;
    for (let b = 0; b < BUCKETS; b++) total += h[b]! *= FADE;
    const bucket = Math.min(BUCKETS - 1, Math.floor(late / F));
    h[bucket]! += 1;
    total += 1;
    let b = 0;
    for (let sum = h[0]!; sum < total * COVER && b < BUCKETS - 1; ) sum += h[++b]!;
    // The far edge of that step of lateness, and a frame to spare.
    const wanted = (b + 2) * F;
    this.wanted = wanted < MIN_TARGET ? MIN_TARGET : wanted > MAX_TARGET ? MAX_TARGET : wanted;
  }

  private start(time: number, behind: number): void {
    this.held.fill(0);
    this.cursor = time - behind;
    this.first = time / F;
    this.newest = -1;
    this.last = -1;
    this.playing = true;
    // Whatever comes first comes in from silence.
    this.from = -1;
    this.gapping = true;
    this.cover = 0;
  }

  /** The next sample of the cover: the last frame played, back and forth, dying away. */
  private covering(): number {
    this.cover *= this.gap < COVER_SAMPLES ? HALVE : DIE;
    this.gap++;
    if (this.cover < QUIET) return 0;
    const s = this.pcm[this.from * F + this.at]! * this.cover;
    this.at += this.dir;
    if (this.at < 0) {
      this.at = 0;
      this.dir = 1;
    } else if (this.at >= F) {
      this.at = F - 1;
      this.dir = -1;
    }
    return s;
  }

  /**
   * The next `n` samples of this speaker, added to `out` at `gain`. Returns
   * false, touching nothing, if the speaker is silent. A frame that is due and
   * has not come is covered for a moment by the one before it, then is silence.
   */
  read(out: Float32Array, n: number, gain = 1): boolean {
    if (!this.playing) return false;
    let p = this.cursor;
    for (let i = 0; i < n; ) {
      const f = Math.floor(p / F);
      const off = p - f * F;
      const run = Math.min(n - i, F - off);
      const slot = f >= 0 ? f % SLOTS : 0;
      if (f >= this.first && f <= this.newest && this.held[slot] === f + 1) {
        const at = slot * F + off;
        if (this.gapping) {
          // Real sound again: brought in over a moment, from the cover if it is still sounding, else from silence.
          this.seam = this.seamOf = this.cover >= QUIET ? SEAM : FADE_IN;
          this.gapping = false;
        }
        let k = 0;
        for (; k < run && this.seam > 0; k++, this.seam--) {
          const t = 1 - this.seam / this.seamOf;
          out[i + k]! += (this.pcm[at + k]! * t + (this.cover >= QUIET ? this.covering() * (1 - t) : 0)) * gain;
        }
        for (; k < run; k++) out[i + k]! += this.pcm[at + k]! * gain;
        if (off + run === F) {
          this.stats.played++;
          this.from = slot;
        }
      } else if (f >= this.first && this.from >= 0 && (this.last < 0 || f <= this.last)) {
        // Due and not here: lost on the way, or not yet come.
        if (!this.gapping) {
          this.gapping = true;
          this.gap = 0;
          this.cover = 1;
          this.at = F - 1;
          this.dir = -1;
        }
        if (this.cover >= QUIET) for (let k = 0; k < run; k++) out[i + k]! += this.covering() * gain;
        if (off + run === F && f <= this.newest) this.stats.missing++;
      } else if (off + run === F && f >= this.first && f <= this.newest) this.stats.missing++;
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
