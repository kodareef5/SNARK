// One speaker's jitter buffer. It places decoded frames by the speaker's timestamp and plays `target` samples behind the newest.
// It runs inside the playback worklet, so it allocates nothing after construction and reads no clock. The caller of read() is the clock.

import { FRAME_SAMPLES, SAMPLE_RATE } from "../../../shared/voice/packet.ts";

/** Frames held, 1.28 s of audio. That is far more than any target. */
const SLOTS = 64;
const F = FRAME_SAMPLES;
const MS = SAMPLE_RATE / 1000;
/** The target before anything is known of the link, and its bounds. In samples. */
export const START_TARGET = 60 * MS;
export const MIN_TARGET = 40 * MS;
export const MAX_TARGET = 300 * MS;
/** More than this in hand beyond the target means a burst arrived after a stall. The older samples are skipped rather than played late. */
const BURST = 120 * MS;
/** With nothing left to play and no end flag, the speaker counts as stopped after this long. */
const GIVE_UP = 500 * MS;
/** After running dry, playing starts again this far behind the frame that restarts it. */
const CUSHION = 40 * MS;
/** Lateness is counted in steps of a frame, up to BUCKETS. Each count is multiplied by FADE with each frame that arrives. */
const BUCKETS = 16;
const FADE = 0.983;
/** The target covers the lateness of this share of frames. */
const COVER = 0.95;
/** The least delay is looked for over this window and the one before it. */
const WINDOW = SAMPLE_RATE;
/** A gap is covered for this long, the cover halving each frame. After that it dies away fast. */
const COVER_SAMPLES = 60 * MS;
const HALVE = 0.5 ** (1 / F);
const DIE = 0.96;
const QUIET = 1e-4;
/** Real sound fades back in over SEAM from a cover, and over FADE_IN from silence. */
const SEAM = 2.5 * MS;
const FADE_IN = 5 * MS;

export class JitterBuffer {
  /** target is how many samples behind the newest frame playing runs. wanted is what the link lately asks for, taken up at the next start. */
  target = START_TARGET;
  wanted = START_TARGET;
  /** There is, or may soon be, something of this speaker to hear. */
  playing = false;
  /**
   * missing counts frames that were due and had not come, late those that came too late to play, restarts new
   * starts after running dry, jumps skips after a burst, and odd frames whose size or time cannot be placed.
   */
  readonly stats = { played: 0, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 };
  /** The speaker's time of the next sample to play. */
  private cursor = 0;
  private readonly pcm = new Float32Array(SLOTS * F);
  /** For each slot, the number of the frame it holds plus one, or 0 for none. */
  private readonly held = new Uint32Array(SLOTS);
  /** The frame this start began with, the newest taken in, and the last of the utterance once its end is known. -1 for none. */
  private first = 0;
  private newest = -1;
  private last = -1;
  /** A histogram of lateness in frames, and the least delay seen in this window and the one before. */
  private readonly lateness = new Float32Array(BUCKETS);
  private least = Infinity;
  private leastBefore = Infinity;
  private windowEnd = 0;
  /** Slot of the last frame played to its end, or -1. A gap is covered from it. */
  private from = -1;
  /**
   * gapping means the due frame is missing. gap counts the samples of cover given for it. at and dir are the
   * cover's position and direction in the last frame played, and cover is its gain.
   */
  private gapping = false;
  private gap = 0;
  private at = 0;
  private dir = -1;
  private cover = 0;
  /** Samples left of the fade back to real sound, and out of how many. */
  private seam = 0;
  private seamOf = 1;

  /**
   * `time` is the speaker's, in samples, and a multiple of the frame. `end` says nothing follows.
   * `arrival` is the listener's clock in samples, or -1 if the caller keeps none.
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
      // The first frame, or one from another time altogether (the speaker began again). Start from here.
      this.target = this.wanted;
      this.start(time, this.target);
    } else if (time + F <= this.cursor) {
      // Too late to play. If playing has run dry, every frame will be, so start again from this one.
      if (!dry) {
        this.stats.late++;
        return;
      }
      // The target was not enough. Add a frame to it, and restart with a short cushion so sound is back soon.
      this.stats.restarts++;
      this.wanted = this.target = Math.min(MAX_TARGET, Math.max(this.wanted, this.target + F));
      this.start(time, CUSHION);
    } else if (time - this.cursor > this.target + BURST) {
      // A burst after a stall. Skip to the target.
      this.cursor = time - this.target;
      this.first = Math.ceil(this.cursor / F);
      this.stats.jumps++;
      // The cut is covered as a gap is, from the last frame played.
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

  /** Marks the newest frame as the last, for an end that arrives with no audio of its own. */
  end(): void {
    if (this.playing && this.newest >= 0) this.last = this.newest;
  }

  /** Records a frame's lateness against the least delay of the last two windows, and sets `wanted` to cover COVER of frames. */
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
    // The far edge of that bucket, plus a frame to spare.
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
    // The first frame fades in from silence.
    this.from = -1;
    this.gapping = true;
    this.cover = 0;
  }

  /** The next cover sample. The cover reads the last frame played back and forth, dying away. */
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

  /** Adds the next `n` samples to `out` at `gain`. Returns false, touching nothing, if the speaker is silent. */
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
          // Real sound again. It fades in from the cover if that still sounds, else from silence.
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
        // The frame is due and missing: lost, or not yet arrived.
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
    // Past its end flag, or GIVE_UP past the last frame it sent, the speaker has stopped.
    if ((this.last >= 0 && p >= (this.last + 1) * F) || p > (this.newest + 1) * F + GIVE_UP) this.playing = false;
    return true;
  }

  /** Samples in hand ahead of the cursor, or 0 when it has run dry. */
  get depth(): number {
    const ahead = (this.newest + 1) * F - this.cursor;
    return this.playing && ahead > 0 ? ahead : 0;
  }
}
