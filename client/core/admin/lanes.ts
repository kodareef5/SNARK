// The timeline's lanes: one for every survivor online in the window, those who played most first, the chosen survivor
// pinned above the rest so it is always in view, and the rest in a list that scrolls in a view of a few rows, so the
// timeline keeps its height whether the window holds three survivors or three hundred. Only the lanes in view are drawn.

import type { LogSurvivor } from "../../../shared/survivor-log.ts";
import { playIn } from "./past.ts";

/** The rows of the scrolling list's view. */
export const LANE_ROWS = 12;

export class LaneList {
  /** The chosen survivor's lane, above the list, or null when it has none in the window. */
  pinned: LogSurvivor | null = null;
  /** Every other survivor online in the window, most play first, then by name. */
  rest: LogSurvivor[] = [];
  /** The first lane of `rest` in view. */
  scroll = 0;
  readonly rows: number;

  constructor(rows = LANE_ROWS) {
    this.rows = rows;
  }

  /** The survivors of the window from `start` to `end` (`last` the log's end) and the chosen one; the scroll is kept where it can be. */
  set(survivors: readonly LogSurvivor[], start: number, end: number, last: number, chosen: number): void {
    const played = new Map<LogSurvivor, number>();
    for (const s of survivors) {
      const ms = playIn(s, start, end, last);
      if (ms > 0) played.set(s, ms);
    }
    const order = [...played.keys()].sort((a, b) => played.get(b)! - played.get(a)! || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.pid - b.pid);
    this.pinned = order.find((s) => s.pid === chosen) ?? null;
    this.rest = this.pinned ? order.filter((s) => s !== this.pinned) : order;
    this.scrollTo(this.scroll);
  }

  /** Every lane, the pinned one among them. */
  get count(): number {
    return this.rest.length + (this.pinned ? 1 : 0);
  }

  /** The scrolling list's lanes in view, at most `rows`, and whether there are more above or below them. */
  view(): { shown: LogSurvivor[]; above: number; below: number } {
    const shown = this.rest.slice(this.scroll, this.scroll + this.rows);
    return { shown, above: this.scroll, below: this.rest.length - this.scroll - shown.length };
  }

  /** Scrolls so lane `first` of the list heads the view, no further than a full view allows. */
  scrollTo(first: number): void {
    this.scroll = Math.max(0, Math.min(Math.max(0, this.rest.length - this.rows), Math.round(first)));
  }

  scrollBy(lanes: number): void {
    this.scrollTo(this.scroll + lanes);
  }

  /** Rows drawn: the pinned lane, if any, and the view's. */
  get drawn(): number {
    return (this.pinned ? 1 : 0) + Math.min(this.rows, this.rest.length);
  }

  /** The survivor of drawn row `row`, counting the pinned lane first, or null past them. */
  at(row: number): LogSurvivor | null {
    if (row < 0) return null;
    if (this.pinned) {
      if (row === 0) return this.pinned;
      row--;
    }
    return row < this.rows ? (this.rest[this.scroll + row] ?? null) : null;
  }
}
