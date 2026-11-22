// The performance record of bug report mode (planning/workstreams/bug-notes.md): about forty numbers for each of the last
// FRAME_SLOTS frames, about a minute, and a row for each of the last SECOND_SLOTS seconds with where the survivor was, so
// a slow second maps to a place. The sampler (notes/sample.ts) fills `sample`, `place`, `totals` and `heap` after each
// frame is drawn and `record` writes them in place: nothing is made a frame, as tests/unit/notes.test.ts holds. A frame's
// place among these rows is its place among the data utility's (assets/frames.ts FrameRing): both write a row after the
// same draw, so `row(back)` names the same frame in each. Only a page in bug report mode keeps it.

import type { PerfSummary } from "../../../shared/report.ts";

/** Frames kept one by one, a power of two: 68 s at 60 frames a second. And seconds kept, a quarter of an hour. */
export const FRAME_SLOTS = 4096;
export const SECOND_SLOTS = 900;

/**
 * A frame's numbers after `at`, its start on the page's clock in ms. Times are ms. From the data utility's row of the
 * frame: interval, own (our code's), upload (handing the assets' bytes to the card); then the app's frame of it (build)
 * and the scene's build within that (scene), which the mode times while it is on; fetched, cached and uploaded bytes,
 * requests under way, bytes waiting for the card, the card's ledger in MB. From the frame: its draws, triangles, the sun's
 * maps' triangles and draws, cascades made and drawn, ground tiles, street tiles, uploads, draws skipped and dropped, and
 * the GL calls the shell made. From the scene: the squeeze, crowns and ambient details given, the governor's level, the
 * scene's share of the canvas, the three world levels. From the session: round trip, margin, bytes, snapshots and
 * corrections this frame. Then the browser's long tasks reported this frame, a picture's own cost, and FLAG_ bits.
 */
export const CELL_FIELDS = [
  "interval", "own", "upload", "build", "scene", "gpu", "fetched", "cached", "uploaded", "requests", "waiting", "cardMB",
  "draws", "triangles", "castTriangles", "castDraws", "cascades", "cascadesDrawn", "tiles", "streetTiles", "uploads", "skipped", "dropped", "glDraws",
  "squeeze", "crowns", "ambient", "level", "share", "world0", "world1", "world2",
  "rttMs", "margin", "bytesIn", "snapshots", "corrections",
  "longMs", "shotMs", "flags",
] as const;
export type CellField = (typeof CELL_FIELDS)[number];
/** Each cell's place in a row. */
export const C = Object.fromEntries(CELL_FIELDS.map((f, i) => [f, i])) as { readonly [K in CellField]: number };
export const CELLS = CELL_FIELDS.length;
export const FRAME_FIELDS: readonly string[] = ["at", ...CELL_FIELDS];

/** Bits of a frame's `flags`: a picture was taken after its draw; it is the frame after one; the GPU was timed. */
export const FLAG_SHOT = 1;
export const FLAG_AFTER_SHOT = 2;
export const FLAG_GPU = 4;
/**
 * A frame is late where it took more than this many times the interval the page is shown at, which the ring takes as the
 * middle of its frames (a summary's) or the least of the last seconds' means (a second's row). On a 60 Hz display a frame
 * on time reads 16.6 to 16.8 ms, and a late one 20 ms or more.
 */
export const LATE = 1.25;
/** Seconds whose means the display's interval is the least of. */
const RECENT = 8;

/** Running totals the sampler keeps up to date, which a second's row holds the change of: the residency's and the stores'. */
export const TOTAL_FIELDS = ["requests", "failed", "evicted", "cityMade", "blocksMade", "nearMade"] as const;
export const T = Object.fromEntries(TOTAL_FIELDS.map((f, i) => [f, i])) as { readonly [K in (typeof TOTAL_FIELDS)[number]]: number };

/**
 * A second's row: the second on the page's clock, its frames, their mean and worst interval, its late frames and those
 * over 33.4 and 50 ms, the display's interval as the ring then took it, the GPU's mean where timed, the survivor's place at its end, the heap in MB, long tasks and their ms, and the
 * change of each TOTAL_FIELDS over it.
 */
export const SECOND_FIELDS: readonly string[] = ["second", "frames", "meanMs", "worstMs", "late", "over33", "over50", "displayMs", "gpuMs", "x", "y", "z", "heapMB", "longTasks", "longMs", ...TOTAL_FIELDS];
const S_SECOND = 0, S_FRAMES = 1, S_SUM = 2, S_WORST = 3, S_LATE = 4, S_OVER33 = 5, S_OVER50 = 6, S_DISPLAY = 7, S_GPU = 8, S_X = 9, S_Y = 10, S_Z = 11, S_HEAP = 12, S_LONG = 13, S_LONG_MS = 14, S_TOTALS = 15;
/** Plus the frames the GPU was timed in, which the mean is of; not exported. */
const SCOLS = SECOND_FIELDS.length + 1, S_GPU_FRAMES = SCOLS - 1;

export class PerfRing {
  /** Rows written, ever: the latest is at `(rows - 1) % FRAME_SLOTS`. */
  rows = 0;
  readonly at = new Float64Array(FRAME_SLOTS);
  readonly cells = new Float32Array(FRAME_SLOTS * CELLS);
  /** The frame about to be recorded, its place, the running totals, the heap in MB and long tasks reported with it. */
  readonly sample = new Float32Array(CELLS);
  readonly place = new Float64Array(3);
  readonly totals = new Float64Array(TOTAL_FIELDS.length);
  heap = 0;
  longTasks = 0;
  /** The latest second held, on the page's clock, -1 before any, and the seconds' rows; and the totals as the second began. */
  second = -1;
  readonly seconds = new Float64Array(SECOND_SLOTS * SCOLS);
  private readonly began = new Float64Array(TOTAL_FIELDS.length);
  /** The interval the page is shown at, in ms, as the least of the last seconds' means; and those means. */
  display = 16.7;
  private readonly means = new Float64Array(RECENT).fill(Infinity);

  /** The row of the frame `back` frames before the latest, or -1 where it is not kept. */
  row(back: number): number {
    return back >= 0 && back < this.rows && back < FRAME_SLOTS ? (this.rows - 1 - back) % FRAME_SLOTS : -1;
  }

  /** Writes `sample` as the frame begun at `at`, after it was drawn, and adds it to its second. */
  record(at: number): void {
    const k = this.rows % FRAME_SLOTS, base = k * CELLS, cells = this.cells, s = this.sample;
    this.rows++;
    this.at[k] = at;
    for (let c = 0; c < CELLS; c++) cells[base + c] = s[c]!;
    const second = Math.floor(at / 1000);
    if (second > this.second) {
      // A new second, and the seconds since the last no frame was drawn in, each empty.
      const from = this.second < 0 ? second : Math.max(this.second + 1, second - SECOND_SLOTS + 1);
      for (let t = from; t <= second; t++) {
        const r = (t % SECOND_SLOTS) * SCOLS;
        this.seconds.fill(0, r, r + SCOLS);
        this.seconds[r + S_SECOND] = t;
      }
      for (let i = 0; i < this.totals.length; i++) this.began[i] = this.totals[i]!;
      // The second just ended, if it was whole, says what the display's interval is.
      if (this.second >= 0) {
        const last = (this.second % SECOND_SLOTS) * SCOLS, n = this.seconds[last + S_FRAMES]!;
        if (n >= 10) this.means[this.second % RECENT] = this.seconds[last + S_SUM]! / n;
        let least = Infinity;
        for (let i = 0; i < RECENT; i++) if (this.means[i]! < least) least = this.means[i]!;
        if (least < Infinity) this.display = least;
      }
      this.second = second;
    }
    const r = (this.second % SECOND_SLOTS) * SCOLS, q = this.seconds, interval = s[C.interval]!;
    q[r + S_FRAMES]!++;
    q[r + S_SUM]! += interval;
    if (interval > q[r + S_WORST]!) q[r + S_WORST] = interval;
    if (interval > 50) q[r + S_OVER50]!++;
    if (interval > 33.4) q[r + S_OVER33]!++;
    if (interval > LATE * this.display) q[r + S_LATE]!++;
    q[r + S_DISPLAY] = this.display;
    if (s[C.gpu]! >= 0 && (s[C.flags]! & FLAG_GPU) !== 0) {
      q[r + S_GPU]! += s[C.gpu]!;
      q[r + S_GPU_FRAMES]!++;
    }
    q[r + S_X] = this.place[0]!;
    q[r + S_Y] = this.place[1]!;
    q[r + S_Z] = this.place[2]!;
    q[r + S_HEAP] = this.heap;
    q[r + S_LONG]! += this.longTasks;
    q[r + S_LONG_MS]! += s[C.longMs]!;
    for (let i = 0; i < this.totals.length; i++) q[r + S_TOTALS + i] = this.totals[i]! - this.began[i]!;
    this.longTasks = 0;
  }

  /** The frames held that began from `from` to `to` (ms, the page's clock), oldest first, as rows of FRAME_FIELDS, `at` from `origin`. */
  frames(from: number, to: number, origin = from): number[][] {
    const out: number[][] = [];
    for (let back = Math.min(this.rows, FRAME_SLOTS) - 1; back >= 0; back--) {
      const k = this.row(back), at = this.at[k]!;
      if (at < from || at > to) continue;
      const row = [round(at - origin)];
      for (let c = 0; c < CELLS; c++) row.push(round(this.cells[k * CELLS + c]!));
      out.push(row);
    }
    return out;
  }

  /** The seconds held, oldest first, as rows of SECOND_FIELDS: a mean in place of the sums, and `second` from `start` (ms) on. */
  secondRows(start: number): number[][] {
    const out: number[][] = [];
    if (this.second < 0) return out;
    for (let t = Math.max(0, this.second - SECOND_SLOTS + 1); t <= this.second; t++) {
      const r = (t % SECOND_SLOTS) * SCOLS, q = this.seconds;
      if (q[r + S_SECOND] !== t || q[r + S_FRAMES] === 0) continue;
      const row: number[] = [];
      for (let c = 0; c < SECOND_FIELDS.length; c++) row.push(q[r + c]!);
      row[S_SECOND] = round(t - start / 1000);
      row[S_SUM] = round(q[r + S_SUM]! / q[r + S_FRAMES]!);
      row[S_GPU] = q[r + S_GPU_FRAMES]! > 0 ? round(q[r + S_GPU]! / q[r + S_GPU_FRAMES]!) : -1;
      out.push(row.map(round));
    }
    return out;
  }

  /**
   * The frames from `from` to `to` summed up: their intervals at the middle, which is the display's interval, the 95th and
   * 99th, the worst and how many display intervals it took, the share late (LATE) and over 33.4 and 50 ms, leaving out the frames a picture was taken after and the next, which a picture slows; the
   * GPU's times where they were taken; long tasks. The heap is the latest.
   */
  summary(from: number, to: number): PerfSummary {
    const times: number[] = [], gpu: number[] = [];
    let left = 0, longTasks = 0, longMs = 0;
    for (let back = 0; back < Math.min(this.rows, FRAME_SLOTS); back++) {
      const k = this.row(back), at = this.at[k]!, base = k * CELLS;
      if (at < from || at > to) continue;
      const flags = this.cells[base + C.flags]!;
      longMs += this.cells[base + C.longMs]!;
      if (this.cells[base + C.longMs]! > 0) longTasks++;
      if ((flags & (FLAG_SHOT | FLAG_AFTER_SHOT)) !== 0) {
        left++;
        continue;
      }
      // The first frame's interval runs from before the record began.
      if (this.cells[base + C.interval]! > 0) times.push(this.cells[base + C.interval]!);
      if ((flags & FLAG_GPU) !== 0 && this.cells[base + C.gpu]! >= 0) gpu.push(this.cells[base + C.gpu]!);
    }
    times.sort((a, b) => a - b);
    gpu.sort((a, b) => a - b);
    const at = (list: number[], q: number): number => (list.length === 0 ? 0 : round(list[Math.min(list.length - 1, Math.floor(list.length * q))]!));
    const over = (ms: number): number => (times.length === 0 ? 0 : Math.round((times.filter((t) => t > ms).length / times.length) * 10000) / 10000);
    const middle = at(times, 0.5), worst = round(times.at(-1) ?? 0);
    return {
      frames: times.length, left, middle, p95: at(times, 0.95), p99: at(times, 0.99), worst, worstIntervals: middle > 0 ? Math.round((worst / middle) * 10) / 10 : 0,
      late: over(LATE * middle), over33: over(33.4), over50: over(50),
      gpu: { frames: gpu.length, middle: at(gpu, 0.5), p95: at(gpu, 0.95), worst: round(gpu.at(-1) ?? 0) },
      heap: round(this.heap), longTasks, longMs: round(longMs),
    };
  }

  /** The `n` frames from `from` to `to` that took longest, a picture's own frames left out, worst first, as `frames` gives them. */
  worst(from: number, to: number, n: number): number[][] {
    const rows = this.frames(from, to).filter((r) => ((r[1 + C.flags] ?? 0) & (FLAG_SHOT | FLAG_AFTER_SHOT)) === 0);
    return rows.sort((a, b) => b[1 + C.interval]! - a[1 + C.interval]!).slice(0, n);
  }
}

/** To a hundredth below 100 and whole above, as the server's meter rounds (server/admin/meter.ts): shorter JSON. */
function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}
