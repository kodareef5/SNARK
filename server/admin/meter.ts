// The loop's own timing (server/main.ts): how long each tick takes and how late it starts, summed up by the second and by
// the minute, with what else an admin watches sampled as each minute closes. Both runs are rings of fixed length, so the
// meter holds the same memory after a day as after a minute.

import { MINUTE_FIELDS, SECOND_FIELDS, type Minutes, type SecondField } from "../../shared/admin.ts";
import { TICK_RATE } from "../../shared/coords.ts";

/** Seconds and minutes kept: two minutes of seconds, and a day of minutes. */
export const SECONDS_KEPT = 120;
export const MINUTES_KEPT = 1440;
/** Milliseconds a tick has. */
export const TICK_MS = 1000 / TICK_RATE;

/** What else a minute keeps, read as it closes: survivors online, bodies in the world, memory in bytes, and commits made so far. */
export interface Gauges {
  online: number;
  bodies: number;
  rss: number;
  heap: number;
  commits: number;
}

/** Tick times in buckets a quarter of an octave wide from BUCKET_LOW ms, so a percentile is read to within 9%. */
const BUCKETS = 64;
const BUCKET_LOW = 0.05;
const bucketOf = (ms: number): number => (ms <= BUCKET_LOW ? 0 : Math.min(BUCKETS - 1, Math.floor(4 * Math.log2(ms / BUCKET_LOW))));
/** The middle of bucket `k`, in ms. */
const bucketMiddle = (k: number): number => BUCKET_LOW * 2 ** ((k + 0.5) / 4);

/** A ring of rows of numbers, oldest overwritten first. */
class Ring {
  readonly width: number;
  readonly length: number;
  /** Rows written since the start; the newest is row `count - 1`. */
  count = 0;
  private readonly cells: Float64Array;

  constructor(width: number, length: number) {
    this.width = width;
    this.length = length;
    this.cells = new Float64Array(width * length);
  }

  push(row: ArrayLike<number>): void {
    this.cells.set(row, (this.count % this.length) * this.width);
    this.count++;
  }

  /** Field `f` of row `n`, counted from the start. */
  at(n: number, f: number): number {
    return this.cells[(n % this.length) * this.width + f]!;
  }

  /** The rows from `from` on that are still held, as one array a field. */
  columns<F extends string>(fields: readonly F[], from = 0): Record<F, number[]> {
    const first = Math.max(from, this.count - this.length, 0);
    const out = {} as Record<F, number[]>;
    fields.forEach((name, f) => {
      const col: number[] = [];
      for (let n = first; n < this.count; n++) col.push(round(this.at(n, f)));
      out[name] = col;
    });
    return out;
  }
}

/** To a hundredth below 100 and whole above: the page draws them, and JSON is shorter so. */
function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}

export class TickMeter {
  readonly seconds = new Ring(SECOND_FIELDS.length, SECONDS_KEPT);
  readonly minutes = new Ring(MINUTE_FIELDS.length, MINUTES_KEPT);
  /** Ticks run and dropped since the start. */
  ticks = 0;
  dropped = 0;
  /** Wall ms the meter started at. */
  readonly startedAt: number;
  private readonly wall: (clock: number) => number;
  private readonly gauges: () => Gauges;
  // The second and the minute being summed, by their number on the loop's clock.
  private second = -1;
  private minute = -1;
  private readonly sTimes = new Float64Array(64);
  private sTicks = 0;
  private sWorst = 0;
  private sLate = 0;
  private sDropped = 0;
  private readonly mBuckets = new Uint32Array(BUCKETS);
  private mTicks = 0;
  private mSum = 0;
  private mWorst = 0;
  private mLateSum = 0;
  private mLate = 0;
  private mDropped = 0;
  private readonly sRow = new Float64Array(SECOND_FIELDS.length);
  private readonly mRow = new Float64Array(MINUTE_FIELDS.length);

  /**
   * `wall` turns the loop's clock (ms, performance.now) into wall time (ms since 1970), and `gauges` reads what a minute
   * keeps besides its ticks.
   */
  constructor(gauges: () => Gauges, wall: (clock: number) => number = (clock) => performance.timeOrigin + clock, startedAt = Date.now()) {
    this.gauges = gauges;
    this.wall = wall;
    this.startedAt = startedAt;
  }

  /** One tick, on the loop's clock (ms): when it was due, when it began and when it ended. Costs a few array writes. */
  tick(due: number, began: number, ended: number): void {
    this.close(ended);
    const ms = ended - began;
    const late = Math.max(0, began - due);
    if (this.sTicks < this.sTimes.length) this.sTimes[this.sTicks] = ms;
    this.sTicks++;
    if (ms > this.sWorst) this.sWorst = ms;
    if (late > this.sLate) this.sLate = late;
    this.mBuckets[bucketOf(ms)]!++;
    this.mTicks++;
    this.mSum += ms;
    if (ms > this.mWorst) this.mWorst = ms;
    this.mLateSum += late;
    if (late > this.mLate) this.mLate = late;
    this.ticks++;
  }

  /** Ticks the loop gave up on at `clock`, being too far behind to catch up. */
  drop(n: number, clock: number): void {
    this.close(clock);
    this.sDropped += n;
    this.mDropped += n;
    this.dropped += n;
  }

  /** Closes the second and the minute `clock` has passed, and every one wholly passed with no tick, which shows a stall. */
  private close(clock: number): void {
    const s = Math.floor(clock / 1000);
    if (this.second < 0) this.second = s;
    for (let n = 0; this.second < s; n++) {
      if (n < SECONDS_KEPT) this.closeSecond();
      else this.second = s;
    }
    const m = Math.floor(clock / 60000);
    if (this.minute < 0) this.minute = m;
    for (let n = 0; this.minute < m; n++) {
      if (n < MINUTES_KEPT) this.closeMinute();
      else this.minute = m;
    }
  }

  private closeSecond(): void {
    const n = Math.min(this.sTicks, this.sTimes.length);
    const sorted = this.sTimes.subarray(0, n).sort();
    const r = this.sRow;
    r[0] = this.wall(this.second * 1000);
    r[1] = this.sTicks;
    r[2] = n > 0 ? sorted[(n - 1) >> 1]! : 0;
    r[3] = this.sWorst;
    r[4] = this.sLate;
    r[5] = this.sDropped;
    this.seconds.push(r);
    this.second++;
    this.sTicks = this.sWorst = this.sLate = this.sDropped = 0;
  }

  private closeMinute(): void {
    const g = this.gauges();
    const r = this.mRow;
    const t = this.mTicks;
    r[0] = this.wall(this.minute * 60000);
    r[1] = t;
    r[2] = t > 0 ? this.mSum / t : 0;
    r[3] = this.percentile(0.5);
    r[4] = this.percentile(0.99);
    r[5] = this.mWorst;
    r[6] = t > 0 ? this.mLateSum / t : 0;
    r[7] = this.mLate;
    r[8] = this.mDropped;
    r[9] = this.mSum / 600;
    r[10] = g.online;
    r[11] = g.bodies;
    r[12] = g.rss;
    r[13] = g.heap;
    r[14] = g.commits;
    this.minutes.push(r);
    this.minute++;
    this.mBuckets.fill(0);
    this.mTicks = this.mSum = this.mWorst = this.mLateSum = this.mLate = this.mDropped = 0;
  }

  /** The tick time `share` of this minute's ticks took at most, to within a bucket; 0 with no ticks. */
  private percentile(share: number): number {
    if (this.mTicks === 0) return 0;
    const want = Math.ceil(share * this.mTicks);
    let seen = 0;
    for (let k = 0; k < BUCKETS; k++) {
      seen += this.mBuckets[k]!;
      if (seen >= want) return Math.min(bucketMiddle(k), this.mWorst);
    }
    return this.mWorst;
  }

  /** The seconds held, oldest first, a column a field. */
  secondColumns(): Record<SecondField, number[]> {
    return this.seconds.columns(SECOND_FIELDS);
  }

  /** The minutes held from the `from`-th since the start on, oldest first, a column a field, and the count to ask from next. */
  minuteColumns(from = 0): Minutes {
    return { next: this.minutes.count, columns: this.minutes.columns(MINUTE_FIELDS, from) };
  }
}
