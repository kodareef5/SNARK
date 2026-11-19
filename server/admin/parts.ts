// What each tick spent its time on, part by part, and what the loop did between it and the tick before. Every tick is
// timed so, a clock read at the end of each part and the process's counters at its start and end, a few microseconds a
// tick in all. A tick that took longer than `limit`, or that the loop came to that much later than it could have, is kept
// whole in a ring with what those counters say of it, so that a tick long for want of a core (preempted, its CPU time far
// under its wall time), for want of a page (page-ins, waits) and long for its own work (CPU time near wall time) are told
// apart. The engine's heap is not read here: with a city's heap, reading its size walks it, two milliseconds a read.
// /admin/ticks.json answers it (routes.ts).

import { TICK_RATE } from "../../shared/coords.ts";

/**
 * The parts, in the order a tick runs them, then what the loop does between ticks. `stray` is the time between ticks
 * that none of the others account for: the engine's own timers and collections, or a core the machine gave elsewhere.
 */
export const PARTS = [
  "before", "bodies", "commands", "focus", "deadlines", "spawner", "life", "riders", "combat", "creatures", "contacts",
  "build", "world", "modules", "save", "history", "own", "snapshot", "chunks",
  "sockets", "http", "idle", "stray",
] as const;
export type PartName = (typeof PARTS)[number];
export const PART = Object.fromEntries(PARTS.map((name, i) => [name, i])) as { readonly [K in PartName]: number };
/** The first part that is not in a tick. */
const BETWEEN = PART.sockets;

/**
 * The process's counters, all its threads together: CPU ms, pages read in from disk, other page faults, the times its
 * threads gave up a core to wait (on a page, a lock, a file) and the times the system took one from them.
 */
export const COUNTS = ["cpu", "pageIns", "faults", "waits", "preempted"] as const;

/** Long ticks kept. */
export const LONG_KEPT = 1024;

/** A long tick as /admin/ticks.json gives it. Times are ms, `at` wall ms since 1970. */
export interface LongTick {
  tick: number;
  at: number;
  /** The tick's own time, and how long after it was due it began. */
  ms: number;
  late: number;
  /** Ms of each part, in PARTS order; those from `sockets` on are the loop's between the tick before and this one. */
  parts: number[];
  /** The COUNTS over the tick, and over the time between the tick before and this one. */
  counts: number[];
  gap: number[];
}

export interface TickReport {
  limit: number;
  parts: readonly string[];
  counts: readonly string[];
  /** Ticks timed since the start, and of them those kept as long. */
  ticks: number;
  long: number;
  /** Ms of each part over every tick, over the long ticks alone, and the most one tick spent in it. */
  all: number[];
  inLong: number[];
  worst: number[];
  /** The long ticks held, oldest first. */
  recent: LongTick[];
}

const N = COUNTS.length;

/** The COUNTS as one read gives them, CPU in µs, into `into` from `at`. */
function counters(into: Float64Array, at: number): void {
  const u = process.resourceUsage();
  into[at] = u.userCPUTime + u.systemCPUTime;
  into[at + 1] = u.majorPageFault;
  into[at + 2] = u.minorPageFault;
  into[at + 3] = u.voluntaryContextSwitches;
  into[at + 4] = u.involuntaryContextSwitches;
}

/** The counts from row `a` to row `b` of `c`, CPU in ms. */
function delta(c: Float64Array, a: number, b: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < N; k++) out.push(k === 0 ? round((c[b * N]! - c[a * N]!) / 1000) : c[b * N + k]! - c[a * N + k]!);
  return out;
}

export class TickParts {
  /** Ms a tick or the time between two may take before it is kept. */
  limit = 1000 / TICK_RATE;
  /** When the loop meant to run the tick about to begin, on performance.now's clock; NaN where nothing says (a test, the bench). */
  due = NaN;
  ticks = 0;
  long = 0;
  readonly all = new Float64Array(PARTS.length);
  readonly inLong = new Float64Array(PARTS.length);
  readonly worst = new Float64Array(PARTS.length);
  private readonly ms = new Float64Array(PARTS.length);
  private last = 0;
  private began = 0;
  private ended = -1;
  /** Three rows of counts: at the last tick's end, at this one's start and at its end. */
  private readonly count = new Float64Array(3 * N);
  private readonly ring: (LongTick | null)[] = new Array(LONG_KEPT).fill(null);

  /** Starts a tick. What was counted between ticks since the last one ended is this tick's to keep. */
  begin(): void {
    const now = performance.now();
    if (this.ended >= 0) {
      let between = 0;
      for (let k = BETWEEN; k < PARTS.length - 1; k++) between += this.ms[k]!;
      const could = Number.isNaN(this.due) ? this.ended + between : Math.max(this.due, this.ended + between);
      this.ms[PART.stray] = Math.max(0, now - could);
    }
    counters(this.count, N);
    this.began = this.last = now;
  }

  /** Ends the part `part` of the tick: the time since the part before it ended is its own. */
  mark(part: number): void {
    const now = performance.now();
    this.ms[part]! += now - this.last;
    this.last = now;
  }

  /** Time the loop spent between ticks on `part` (sockets, http, idle). */
  between(part: number, ms: number): void {
    this.ms[part]! += ms;
  }

  /** Ends tick `tick`, keeping it if it or the time before it was long, and clears the parts for the next. */
  end(tick: number): void {
    const now = performance.now();
    const ms = now - this.began;
    let gap = 0;
    for (let k = BETWEEN; k < PARTS.length; k++) gap += this.ms[k]!;
    this.ticks++;
    const kept = ms > this.limit || gap > this.limit;
    const c = this.count;
    counters(c, 2 * N);
    if (kept) {
      this.ring[this.long % LONG_KEPT] = {
        tick,
        at: Math.round(performance.timeOrigin + this.began),
        ms: round(ms),
        late: Number.isNaN(this.due) ? 0 : round(Math.max(0, this.began - this.due)),
        parts: Array.from(this.ms, round),
        counts: delta(c, 1, 2),
        gap: this.ended < 0 ? new Array<number>(N).fill(0) : delta(c, 0, 1),
      };
      this.long++;
    }
    for (let k = 0; k < PARTS.length; k++) {
      const v = this.ms[k]!;
      this.all[k]! += v;
      if (kept) this.inLong[k]! += v;
      if (v > this.worst[k]!) this.worst[k] = v;
      this.ms[k] = 0;
    }
    c.copyWithin(0, 2 * N, 3 * N);
    this.ended = now;
    this.due = NaN;
  }

  /** The long ticks held, oldest first. */
  recent(): LongTick[] {
    const out: LongTick[] = [];
    for (let n = Math.max(0, this.long - LONG_KEPT); n < this.long; n++) out.push(this.ring[n % LONG_KEPT]!);
    return out;
  }

  report(): TickReport {
    return { limit: this.limit, parts: PARTS, counts: COUNTS, ticks: this.ticks, long: this.long, all: Array.from(this.all, round), inLong: Array.from(this.inLong, round), worst: Array.from(this.worst, round), recent: this.recent() };
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
