// The debug bar's one log: the lines of three sources in the order they came. What the page printed and the errors it
// met (the port's `lines`), the game's own notices, faults and steps, and the server's lines (its `__debug` route). A
// line equal to the one before it folds into it and raises its count. Once the ring is full a new line is written over
// the oldest one's record, so a line costs nothing made.

import { LEVEL_ERROR } from "../../../shared/debug.ts";

export const SOURCE_PAGE = 0, SOURCE_GAME = 1, SOURCE_SERVER = 2;
export const SOURCE_NAMES = ["page", "game", "server"] as const;
/** Every source, as `read` and `since` take them: a bit for each SOURCE_. */
export const ALL_SOURCES = 0b111;
/** Lines kept, and the most characters of one. */
export const LOG_MOST = 2000;
export const LOG_CHARS = 2000;
const LEVELS = LEVEL_ERROR + 1;

export interface LogLine {
  /** When it first came, in ms since 1970. */
  at: number;
  source: number;
  /** Its LEVEL_ (shared/debug.ts). */
  level: number;
  text: string;
  /** How many times it came one after another. */
  count: number;
  /** The server's tick, or -1 where the line has none. */
  tick: number;
}

export class LogRing {
  readonly most: number;
  private readonly lines: LogLine[] = [];
  /** Where the oldest line is once the ring is full; 0 until then. */
  private oldest = 0;
  /** Lines of each source and level ever given, repeats too, and as they stood at the mark. */
  private readonly counts = new Float64Array(SOURCE_NAMES.length * LEVELS);
  private readonly marked = new Float64Array(SOURCE_NAMES.length * LEVELS);

  constructor(most = LOG_MOST) {
    this.most = most;
  }

  /** Lines kept. */
  get length(): number {
    return this.lines.length;
  }

  /** The line `i` from the oldest kept. */
  line(i: number): LogLine {
    return this.lines[(this.oldest + i) % this.lines.length]!;
  }

  /** A line of `source` at `level`, `at` ms since 1970, with the server's `tick` where it has one. */
  add(at: number, source: number, level: number, text: string, tick = -1): void {
    const lv = Math.max(0, Math.min(LEVELS - 1, Math.trunc(level) || 0));
    this.counts[source * LEVELS + lv]!++;
    const words = text.length > LOG_CHARS ? text.slice(0, LOG_CHARS) : text;
    const n = this.lines.length;
    const last = n > 0 ? this.line(n - 1) : null;
    if (last && last.source === source && last.level === lv && last.text === words) return void last.count++;
    if (n < this.most) return void this.lines.push({ at, source, level: lv, text: words, count: 1, tick });
    const line = this.lines[this.oldest]!;
    line.at = at;
    line.source = source;
    line.level = lv;
    line.text = words;
    line.count = 1;
    line.tick = tick;
    this.oldest = (this.oldest + 1) % n;
  }

  /**
   * Writes into `out` the lines of `sources` (a bit for each SOURCE_) at `least` level or worse, oldest first: the
   * newest `n` of them, or with `back` the `n` before the newest `back`. Returns how many lines match in all. The lines
   * are the ring's own records, good until the next `add`.
   */
  read(out: LogLine[], sources: number, least: number, n: number, back = 0): number {
    out.length = 0;
    let matched = 0;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.line(i);
      if ((sources & (1 << line.source)) === 0 || line.level < least) continue;
      if (matched >= back && out.length < n) out.push(line);
      matched++;
    }
    out.reverse();
    return matched;
  }

  /** Lines of `sources` at `level` given since the mark, each repeat counted. */
  since(sources: number, level: number): number {
    let n = 0;
    for (let s = 0; s < SOURCE_NAMES.length; s++) if (sources & (1 << s)) n += this.counts[s * LEVELS + level]! - this.marked[s * LEVELS + level]!;
    return n;
  }

  /** `since` counts from now: the bar marks when its log is looked at. */
  mark(): void {
    this.marked.set(this.counts);
  }
}
