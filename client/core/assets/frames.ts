// What each frame took and what came in it, for the data utility's monitor: the last FRAME_ROWS frames one by one, and
// the last BUCKETS seconds summed, so a slow frame can be laid beside the bytes that arrived and went to the card in it.
// The app writes a row after each frame is drawn. Columns are typed arrays, written in place: nothing is made a frame.

import type { SoundLibrary } from "../sound/library.ts";
import type { Residency } from "./residency.ts";

/** Frames kept one by one: a power of two, about 17 s at 60 frames a second. */
export const FRAME_ROWS = 1024;
/** Seconds kept summed, ten minutes. */
export const BUCKETS = 600;
/** A frame that took longer than this is slow, as the record of play's long frame is (client/core/diagnostics.ts). */
export const SLOW_MS = 50;
/** Bits of a row's `flags`: something waited because the card was over-full, or the textures' share was, or the game's socket was behind. */
export const FLAG_FULL = 1;
export const FLAG_SHORT = 2;
export const FLAG_HELD = 4;

/** Running totals a row's bytes are the change of, by their place in `FrameRing.totals`. */
const FETCHED = 0;
const CACHED = 1;
const UPLOADED = 2;
const DISK = 3;

/** The rates a display shows frames at, in Hz, slowest first. */
export const REFRESH_RATES = [60, 75, 90, 100, 120, 144, 165, 240] as const;
/** Frames the target takes at a time: their middle interval is a rate the page kept up, which no few frames can make. */
const WINDOW = 30;
/** How much slower than a display's rate a window's frames may come and still be taken as that rate. */
const NEAR = 0.08;

/** The display's rate a page that kept up `hz` frames a second is taken to be shown at: the first of REFRESH_RATES within NEAR of it, else the fastest. */
export function refreshOf(hz: number): number {
  for (const r of REFRESH_RATES) if (r >= hz * (1 - NEAR)) return r;
  return REFRESH_RATES[REFRESH_RATES.length - 1]!;
}

/**
 * The interval a page's frames are judged against (D1120): the fastest the page has kept up since it began, or since the
 * display changed (`reset`), as a display's rate. Frames are taken WINDOW at a time and a window's middle interval is a
 * rate kept up; the target is the fastest of those, snapped by refreshOf, and 60 Hz until one is faster. A slow stretch
 * gives slower windows, which never move it, and a long pause or a hidden page is a frame or two in a window, which its
 * middle does not see. The app gives it every frame, those before the world has come too.
 */
export class RefreshTarget {
  /** The target interval, ms. */
  ms = 1000 / REFRESH_RATES[0];
  private readonly window = new Float32Array(WINDOW);
  private n = 0;
  private fastest = Infinity;

  get hz(): number {
    return Math.round(1000 / this.ms);
  }

  /** A frame `interval` ms after the one before; 0, the first's, says nothing. */
  frame(interval: number): void {
    if (!(interval > 0)) return;
    this.window[this.n++] = interval;
    if (this.n < WINDOW) return;
    this.n = 0;
    const middle = this.window.sort()[WINDOW >> 1]!;
    if (middle >= this.fastest) return;
    this.fastest = middle;
    this.ms = 1000 / refreshOf(1000 / middle);
  }

  /** The display changed: what was found of the last one is forgotten. */
  reset(): void {
    this.n = 0;
    this.fastest = Infinity;
    this.ms = 1000 / REFRESH_RATES[0];
  }
}

export class FrameRing {
  /** The display's interval the frames are judged against, which the app gives every frame (App.frame). */
  readonly target = new RefreshTarget();
  /** Rows written, ever: the latest is at `(rows - 1) % FRAME_ROWS`. */
  rows = 0;
  /** For each frame: when it began and the time since the one before, both in ms on the page's clock, and the ms our code took of it. */
  readonly at = new Float64Array(FRAME_ROWS);
  readonly interval = new Float32Array(FRAME_ROWS);
  readonly ours = new Float32Array(FRAME_ROWS);
  /** Bytes the assets sent to the card, bytes of the frame's allowance spent on what is not an asset, and the ms the shell took to hand the assets' bytes to the card. */
  readonly uploaded = new Float64Array(FRAME_ROWS);
  readonly spent = new Float64Array(FRAME_ROWS);
  readonly uploadMs = new Float32Array(FRAME_ROWS);
  /**
   * Bytes, as stored, of what arrived for the assets and the sounds: over the network, answers no longer waited on
   * among them; from the port's cache; and of those, from the disk where the port tells (the rest came from memory).
   */
  readonly fetched = new Float64Array(FRAME_ROWS);
  readonly cached = new Float64Array(FRAME_ROWS);
  readonly disk = new Float64Array(FRAME_ROWS);
  /** After the frame: requests under way, of them those for large parts, and sounds'; bytes arrived and waiting for the card; slots wanted and neither held nor coming; bytes on the card and of them textures'. */
  readonly flying = new Uint16Array(FRAME_ROWS);
  readonly flyingLarge = new Uint16Array(FRAME_ROWS);
  readonly sounds = new Uint16Array(FRAME_ROWS);
  readonly waiting = new Float64Array(FRAME_ROWS);
  readonly wanting = new Uint32Array(FRAME_ROWS);
  readonly ledger = new Float64Array(FRAME_ROWS);
  readonly texLedger = new Float64Array(FRAME_ROWS);
  /** FLAG_ bits. */
  readonly flags = new Uint8Array(FRAME_ROWS);

  /** The second the latest bucket sums, counted from the page's clock's start; -1 before any. */
  second = -1;
  /** For each second: the second it is, its frames, the slow ones, the longest, and its bytes and upload ms summed as the rows' are. */
  readonly bucketSecond = new Float64Array(BUCKETS).fill(-1);
  readonly bucketFrames = new Uint16Array(BUCKETS);
  readonly bucketSlow = new Uint16Array(BUCKETS);
  readonly bucketWorst = new Float32Array(BUCKETS);
  readonly bucketUploaded = new Float64Array(BUCKETS);
  readonly bucketSpent = new Float64Array(BUCKETS);
  readonly bucketUploadMs = new Float32Array(BUCKETS);
  readonly bucketFetched = new Float64Array(BUCKETS);
  readonly bucketCached = new Float64Array(BUCKETS);
  readonly bucketDisk = new Float64Array(BUCKETS);

  /** The totals the last row was the change of. A total that falls (a new scene, a new library) starts again from 0. */
  private readonly totals = new Float64Array(4);

  /** The row of the frame `back` frames before the latest, or -1 where it is not kept. */
  row(back: number): number {
    return back >= 0 && back < this.rows && back < FRAME_ROWS ? (this.rows - 1 - back) % FRAME_ROWS : -1;
  }

  /** The bucket of the second `back` seconds before the latest, or -1 where it is not kept. A second no frame was drawn in has a bucket of no frames. */
  bucket(back: number): number {
    if (back < 0 || back >= BUCKETS || this.second < 0) return -1;
    const b = (this.second - back) % BUCKETS;
    return b >= 0 && this.bucketSecond[b] === this.second - back ? b : -1;
  }

  /** Writes a row for the frame begun at `at`, after it was drawn: `assets` and `sounds` are read as they stand, either missing before the world is in. */
  record(at: number, interval: number, ours: number, uploadMs: number, assets: Residency | null, sounds: SoundLibrary | null): void {
    const k = this.rows % FRAME_ROWS;
    this.rows++;
    const s = assets?.stats, h = sounds?.stats;
    const fetched = this.change(FETCHED, (s ? s.fetched + s.stale : 0) + (h ? h.fetched + h.stale : 0));
    const cached = this.change(CACHED, (s ? s.cached : 0) + (h ? h.cached : 0));
    const disk = this.change(DISK, (s ? s.disk : 0) + (h ? h.disk : 0));
    const uploaded = this.change(UPLOADED, s ? s.uploaded : 0);
    const spent = assets ? assets.spentOther : 0;
    this.at[k] = at;
    this.interval[k] = interval;
    this.ours[k] = ours;
    this.uploaded[k] = uploaded;
    this.spent[k] = spent;
    this.uploadMs[k] = uploadMs;
    this.fetched[k] = fetched;
    this.cached[k] = cached;
    this.disk[k] = disk;
    this.flying[k] = assets ? assets.flying : 0;
    this.flyingLarge[k] = assets ? assets.flyingLarge : 0;
    this.sounds[k] = sounds ? sounds.flying : 0;
    this.waiting[k] = assets ? assets.waiting : 0;
    this.wanting[k] = assets ? assets.wanting() : 0;
    this.ledger[k] = assets ? assets.ledger : 0;
    this.texLedger[k] = assets ? assets.texLedger : 0;
    this.flags[k] = assets ? (assets.cardFull ? FLAG_FULL : 0) | (assets.shareShort ? FLAG_SHORT : 0) | (assets.holdBack ? FLAG_HELD : 0) : 0;

    // A new second empties its bucket, and the buckets of any seconds since the first that no frame was drawn in.
    const second = Math.floor(at / 1000);
    for (let t = this.second < 0 ? second : Math.max(this.second + 1, second - BUCKETS + 1); t <= second; t++) {
      const b = t % BUCKETS;
      this.bucketSecond[b] = t;
      this.bucketFrames[b] = this.bucketSlow[b] = this.bucketWorst[b] = 0;
      this.bucketUploaded[b] = this.bucketSpent[b] = this.bucketUploadMs[b] = this.bucketFetched[b] = this.bucketCached[b] = this.bucketDisk[b] = 0;
    }
    if (second > this.second) this.second = second;
    const b = this.second % BUCKETS;
    this.bucketFrames[b]!++;
    if (interval > SLOW_MS) this.bucketSlow[b]!++;
    if (interval > this.bucketWorst[b]!) this.bucketWorst[b] = interval;
    this.bucketUploaded[b]! += uploaded;
    this.bucketSpent[b]! += spent;
    this.bucketUploadMs[b]! += uploadMs;
    this.bucketFetched[b]! += fetched;
    this.bucketCached[b]! += cached;
    this.bucketDisk[b]! += disk;
  }

  /** How much a running total has grown since the last row. */
  private change(k: number, total: number): number {
    const grown = total - this.totals[k]!;
    this.totals[k] = total;
    return grown >= 0 ? grown : total;
  }
}
