// What the admin page holds of the survivor log, and what it asks for: a window's survivors, everyone's places at a step,
// the marks and the items held; for a chosen survivor its finer track and its changes; for a chosen item who held it. It
// asks only when what it holds no longer serves the timeline's window, and drops an answer a newer ask has overtaken.

import type { LogChanges, LogHolder, LogItem, LogMark, LogPositions, LogSurvivor } from "../../../shared/survivor-log.ts";
import { TRACK_POINTS, fetchSpan, serves, stepFor, type Held, type Timeline } from "./timeline.ts";

/** A window's reads, all of the same stretch. */
export interface WindowData extends Held {
  survivors: LogSurvivor[];
  positions: LogPositions;
  marks: LogMark[];
  /** More marks happened than one read lists. */
  moreMarks: boolean;
  items: LogItem[];
}

/** A chosen survivor's reads over the window's stretch. */
export interface ChosenData extends Held {
  pid: number;
  track: LogPositions;
  changes: LogChanges;
}

export interface HoldersData {
  item: string;
  quality: number | null;
  blueprint: boolean | null;
  from: number;
  to: number;
  holders: LogHolder[];
}

/** Fetches a path under /admin/ and reads its JSON. */
export type Get = (path: string) => Promise<unknown>;

export class Recall {
  window: WindowData | null = null;
  chosen: ChosenData | null = null;
  holders: HoldersData | null = null;
  private readonly get: Get;
  /** The newest ask of each kind; an answer to an older one is dropped. */
  private asks = { window: 0, chosen: 0, holders: 0 };

  constructor(get: Get) {
    this.get = get;
  }

  /** Whether what is held serves the timeline's window as it is now. */
  servesWindow(t: Timeline): boolean {
    const [from, to] = fetchSpan(t);
    return serves(this.window, t.start, t.end, stepFor(to - from, this.window?.survivors.length ?? 1));
  }

  /**
   * Asks for the timeline's window if what is held does not serve it: first who was online, as the step shares the
   * points among them, then everyone's places, the marks and the items. True if a new window came.
   */
  async fetchWindow(t: Timeline): Promise<boolean> {
    if (this.servesWindow(t)) return false;
    const ask = ++this.asks.window;
    const [from, to] = fetchSpan(t);
    const range = `from=${from}&to=${to}`;
    const survivors = (await this.get(`log/survivors.json?${range}`)) as LogSurvivor[];
    if (ask !== this.asks.window) return false;
    const step = stepFor(to - from, survivors.length);
    const [positions, marks, items] = (await Promise.all([this.get(`log/positions.json?${range}&step=${step}`), this.get(`log/marks.json?${range}`), this.get(`log/items.json?${range}`)])) as [LogPositions, { marks: LogMark[]; more: boolean }, LogItem[]];
    if (ask !== this.asks.window) return false;
    this.window = { from, to, step: positions.step, survivors, positions, marks: marks.marks, moreMarks: marks.more, items };
    return true;
  }

  /** Whether what is held of `pid` serves the window. */
  servesChosen(pid: number, t: Timeline): boolean {
    const [from, to] = fetchSpan(t);
    return this.chosen !== null && this.chosen.pid === pid && serves(this.chosen, t.start, t.end, stepFor(to - from, 1, TRACK_POINTS));
  }

  /** Asks for `pid`'s track and changes over the window's stretch if what is held does not serve it. True if they came. */
  async fetchChosen(pid: number, t: Timeline): Promise<boolean> {
    if (this.servesChosen(pid, t)) return false;
    const ask = ++this.asks.chosen;
    const [from, to] = fetchSpan(t);
    const step = stepFor(to - from, 1, TRACK_POINTS);
    const [track, changes] = (await Promise.all([this.get(`log/track.json?pid=${pid}&from=${from}&to=${to}&step=${step}`), this.get(`log/changes.json?pid=${pid}&from=${from}&to=${to}`)])) as [LogPositions, LogChanges];
    if (ask !== this.asks.chosen) return false;
    this.chosen = { pid, from, to, step: track.step, track, changes };
    return true;
  }

  forget(): void {
    this.chosen = null;
    this.asks.chosen++;
  }

  /** Who held `item`, of a quality and blueprint or of any (null), over the window's stretch. */
  async fetchHolders(item: string, quality: number | null, blueprint: boolean | null, t: Timeline): Promise<boolean> {
    const ask = ++this.asks.holders;
    const [from, to] = fetchSpan(t);
    const holders = (await this.get(`log/holders.json?item=${encodeURIComponent(item)}&from=${from}&to=${to}${quality === null ? "" : `&quality=${quality}`}${blueprint === null ? "" : `&blueprint=${blueprint ? 1 : 0}`}`)) as LogHolder[];
    if (ask !== this.asks.holders) return false;
    this.holders = { item, quality, blueprint, from, to, holders };
    return true;
  }
}

/** Those of `holders` holding at `t`: their survivors' ids. */
export function holdingAt(holders: readonly LogHolder[], t: number, end: number): Set<number> {
  return new Set(holders.filter((h) => h.from <= t && t <= (h.to ?? end)).map((h) => h.pid));
}
