// Where each frame's time went while the debug bar is on: a tree of named slots, and for each of the last FRAME_ROWS
// frames each slot's first start and its ms in all. The frame's code times itself through the Probe it is handed
// (probe.ts): the app's parts and the scene's passes. The shell's spans come from App.shellMarks and the renderer's
// PassCpu when the frame is closed, the card's from its clock. Nothing is made a frame.

import type { AppFrame, FramePart, PartRow } from "../frame.ts";
import { PASSES, type PassCpu } from "../passes.ts";
import type { Probe } from "../probe.ts";
import type { Frame, Pass, PassRow } from "../render/pass.ts";

/** Slots at most, and frames kept: 34 s at 60 a second. */
export const MOST_SLOTS = 192;
export const FRAME_ROWS = 2048;
/** The roots, each a lane of the chart: the page's own work, the card's by pass, and the browser's own. */
export const LANE_FRAME = 0, LANE_CARD = 1, LANE_BROWSER = 2;
/** The shell's slots under the frame (App.shellMarks), made after the roots. */
const INPUT = 3, UI = 5, GL = 6;

/** The page's clock, where there is one. */
const PAGE: { now(): number } = (globalThis as { performance?: { now(): number } }).performance ?? Date;

/** One frame's times by slot, or the mean of several: each slot's first start in ms from the frame's start, NaN where it did not run, and its ms in all. */
export class SpanFrame {
  readonly start = new Float32Array(MOST_SLOTS).fill(NaN);
  readonly ms = new Float32Array(MOST_SLOTS);
  /** The frame's time on the frame clock, for a mean the latest frame's; and the frames it holds. */
  at = 0;
  frames = 0;
}

export class SpanRing implements Probe {
  /** Each slot's name, its parent (-1 for a root) and its depth under its root. */
  readonly names: string[] = [];
  readonly parents = new Int16Array(MOST_SLOTS).fill(-1);
  readonly depths = new Uint8Array(MOST_SLOTS);
  /** Frames committed, ever: the latest is in row `(rows - 1) % FRAME_ROWS`. */
  rows = 0;
  /** By row, the frame's start on the page's clock; then by row and slot, MOST_SLOTS a row, what a SpanFrame holds. */
  readonly at = new Float64Array(FRAME_ROWS);
  /** By row, the frame's time on the game's frame clock, which the rest of the bar keeps its times on. */
  readonly when = new Float64Array(FRAME_ROWS);
  readonly start = new Float32Array(FRAME_ROWS * MOST_SLOTS).fill(NaN);
  readonly ms = new Float32Array(FRAME_ROWS * MOST_SLOTS);
  private readonly clock: { now(): number };
  /** The row begun and not yet ended: its first slot's place, -1 for none, and its frame's start. */
  private base = -1;
  private from = 0;
  /** The slots of the passes (passes.ts PASSES) under the draw, and under the card. */
  private readonly drawn: Int16Array;
  private readonly carded: Int16Array;
  /** The frames each slot ran in, while a mean is taken. */
  private readonly ran = new Uint16Array(MOST_SLOTS);

  /** `clock` is the page's, which the frame's code is timed by. */
  constructor(clock: { now(): number } = PAGE) {
    this.clock = clock;
    for (const root of ["frame", "card", "browser"]) this.slot(root, -1);
    for (const name of ["input", "app", "ui", "gl"]) this.slot(name, LANE_FRAME);
    this.drawn = Int16Array.from(PASSES, (name) => this.slot(name, GL));
    this.carded = Int16Array.from(PASSES, (name) => this.slot(name, LANE_CARD));
  }

  now(): number {
    return this.clock.now();
  }

  /** The slot `name` under `parent` (-1 for a root), made the first time it is asked for; -1 once MOST_SLOTS are made. */
  slot(name: string, parent: number): number {
    const names = this.names;
    for (let s = 0; s < names.length; s++) if (this.parents[s] === parent && names[s] === name) return s;
    if (names.length >= MOST_SLOTS) return -1;
    const s = names.push(name) - 1;
    this.parents[s] = parent;
    this.depths[s] = parent < 0 ? 0 : this.depths[parent]! + 1;
    return s;
  }

  /** The root `slot` is under, which is its lane: itself for a root. */
  lane(slot: number): number {
    while (this.parents[slot]! >= 0) slot = this.parents[slot]!;
    return slot;
  }

  /** Clears the next row for the frame begun at `at`. A row begun and never ended is cleared again. */
  begin(at: number): void {
    const row = this.rows % FRAME_ROWS, base = row * MOST_SLOTS;
    this.at[row] = at;
    this.start.fill(NaN, base, base + MOST_SLOTS);
    this.ms.fill(0, base, base + MOST_SLOTS);
    this.base = base;
    this.from = at;
  }

  /** Slot `slot` ran from `from` to `to`. Outside a row begun, or for -1, nothing is kept. */
  add(slot: number, from: number, to: number): void {
    if (slot < 0 || this.base < 0) return;
    const i = this.base + slot;
    if (Number.isNaN(this.start[i]!)) this.start[i] = from - this.from;
    this.ms[i]! += to - from;
  }

  /** Commits the row begun. */
  end(): void {
    if (this.base < 0) return;
    this.base = -1;
    this.rows++;
  }

  parts(rows: readonly PartRow[], parent: number): FramePart[] {
    return rows.map(([name, part]) => {
      const slot = this.slot(name, parent);
      return {
        part: (part as { part?: FramePart }).part ?? part,
        step: (f: AppFrame) => {
          const from = this.now();
          part.step(f);
          this.add(slot, from, this.now());
        },
      };
    });
  }

  walk(rows: readonly PassRow[], update: number, draw: number): Required<Pass> {
    const timed = (hook: keyof Pass, parent: number): ((f: Frame) => void) => {
      const passes = rows.filter((r) => r[1][hook] !== undefined), slots = Int16Array.from(passes, (r) => this.slot(r[0], parent));
      return (f) => {
        for (let i = 0; i < passes.length; i++) {
          const from = this.now();
          passes[i]![1][hook]!(f);
          this.add(slots[i]!, from, this.now());
        }
      };
    };
    return { update: timed("update", update), draw: timed("draw", draw) };
  }

  /**
   * The frame drawn. The shell's spans from App.shellMarks: its input before the app's frame, the interface applied after
   * it and the draw, with the renderer's own time in each pass of it where `cpu` has this draw's; and the frame over them
   * all. Without the shell's marks the frame runs from its begin until now. Then the row is committed, at `when` on the
   * frame clock (its begin, without one).
   */
  close(marks: Float64Array, cpu: PassCpu | null, when = this.from): void {
    if (this.base < 0) return;
    this.when[this.base / MOST_SLOTS] = when;
    const from = marks[0]!, applied = marks[3]!, to = marks[4]!;
    if (from > 0 && to >= from) {
      this.add(INPUT, from, marks[1]!);
      this.add(UI, marks[2]!, applied);
      this.add(GL, applied, to);
      if (cpu && cpu.began >= applied && cpu.ended >= cpu.began && cpu.ended <= to) {
        for (let k = 0; k < PASSES.length; k++) {
          const at = cpu.began + cpu.start[k]!;
          if (!Number.isNaN(at)) this.add(this.drawn[k]!, at, at + cpu.ms[k]!);
        }
      }
      this.add(LANE_FRAME, from, to);
    } else this.add(LANE_FRAME, this.from, this.now());
    this.end();
  }

  /**
   * The card's time, into the row begun and before it is closed: by pass (`mode` 2, `ms` by PASSES) or the frame whole
   * (1, `ms[0]`), laid end to end from the frame's start. The card's times are the latest that came back, a few frames
   * behind the frame they are kept with.
   */
  card(ms: ArrayLike<number>, mode: number): void {
    if (this.base < 0 || mode === 0) return;
    let at = this.from;
    if (mode === 1) at += ms[0]! > 0 ? ms[0]! : 0;
    else {
      for (let k = 0; k < PASSES.length; k++) {
        const each = ms[k]!;
        if (!(each > 0)) continue;
        this.add(this.carded[k]!, at, at + each);
        at += each;
      }
    }
    if (at > this.from) this.add(LANE_CARD, this.from, at);
  }

  /** How many of the latest frames were at `from` or after on the frame clock. */
  since(from: number): number {
    let n = 0;
    while (n < FRAME_ROWS) {
      const row = this.row(n);
      if (row < 0 || this.when[row]! < from) break;
      n++;
    }
    return n;
  }

  /** The row of the frame `back` frames before the latest, or -1 where it is not kept. */
  row(back: number): number {
    return back >= 0 && back < this.rows && back < FRAME_ROWS ? (this.rows - 1 - back) % FRAME_ROWS : -1;
  }

  /** Row `row` into `out`; for -1, a frame with nothing in it. */
  read(row: number, out: SpanFrame): SpanFrame {
    out.start.fill(NaN);
    out.ms.fill(0);
    out.at = row < 0 ? 0 : this.when[row]!;
    out.frames = row < 0 ? 0 : 1;
    if (row < 0) return out;
    const base = row * MOST_SLOTS;
    for (let s = 0; s < this.names.length; s++) {
      out.start[s] = this.start[base + s]!;
      out.ms[s] = this.ms[base + s]!;
    }
    return out;
  }

  /**
   * The mean of the `count` frames from `back` frames before the latest, into `out`: a slot's start over the frames it
   * ran in, NaN where it ran in none, and its ms over them all. Returns the frames it is the mean of.
   */
  mean(back: number, count: number, out: SpanFrame): number {
    const ran = this.ran, slots = this.names.length;
    out.start.fill(0);
    out.ms.fill(0);
    ran.fill(0);
    let n = 0;
    for (; n < count; n++) {
      const row = this.row(back + n);
      if (row < 0) break;
      if (n === 0) out.at = this.when[row]!;
      const base = row * MOST_SLOTS;
      for (let s = 0; s < slots; s++) {
        const start = this.start[base + s]!;
        if (Number.isNaN(start)) continue;
        out.start[s]! += start;
        out.ms[s]! += this.ms[base + s]!;
        ran[s]!++;
      }
    }
    for (let s = 0; s < MOST_SLOTS; s++) {
      out.start[s] = ran[s]! > 0 ? out.start[s]! / ran[s]! : NaN;
      out.ms[s] = n > 0 ? out.ms[s]! / n : 0;
    }
    out.frames = n;
    return n;
  }

  /** The row of the frame that took longest, by its "frame" slot, of the `count` from `back` frames before the latest; -1 for none. */
  slowest(count: number, back = 0): number {
    let found = -1, most = -Infinity;
    for (let n = 0; n < count; n++) {
      const row = this.row(back + n);
      if (row < 0) break;
      const ms = this.ms[row * MOST_SLOTS + LANE_FRAME]!;
      if (ms <= most) continue;
      found = row;
      most = ms;
    }
    return found;
  }

  /** The children of `slot` (-1 for the roots) that ran in `frame`, in the order they first ran in it, into `out`. */
  children(slot: number, frame: SpanFrame, out: number[]): number[] {
    out.length = 0;
    for (let s = 0; s < this.names.length; s++) {
      const start = frame.start[s]!;
      if (this.parents[s] !== slot || Number.isNaN(start)) continue;
      let k = out.length;
      for (; k > 0 && frame.start[out[k - 1]!]! > start; k--) out[k] = out[k - 1]!;
      out[k] = s;
    }
    return out;
  }
}
