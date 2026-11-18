// The admin page's timeline over the survivor log: the span the log holds, the window of it shown, the playhead, and
// playing at a speed. Times are wall milliseconds. Live is the playhead at now, which is the page's view of the server as
// it is; any other moment is drawn from the log. What is fetched for a window, and at what step, is decided here too, so
// that dragging the playhead never waits for the server.

/** Windows an admin picks in one press. */
export const PRESETS: readonly { label: string; ms: number }[] = [
  { label: "10 min", ms: 600_000 },
  { label: "1 h", ms: 3_600_000 },
  { label: "6 h", ms: 21_600_000 },
  { label: "1 day", ms: 86_400_000 },
  { label: "1 week", ms: 604_800_000 },
];
/** How many times faster than the clock playing goes. */
export const SPEEDS: readonly number[] = [1, 10, 60, 600, 3600];
/** The narrowest window. */
export const WINDOW_LEAST = 30_000;
/** While playing, the share of the window kept ahead of the playhead before the window moves on. */
const AHEAD = 0.1;

export class Timeline {
  /** The span the log holds, its end being now while the log records. */
  from = 0;
  to = 0;
  /** The window shown. */
  start = 0;
  end = 0;
  /** The playhead, and whether it is now. */
  at = 0;
  live = true;
  playing = false;
  speed = 60;

  /** The span is known: the log holds something. */
  get known(): boolean {
    return this.to > this.from;
  }

  /** Sets the span. A window that reached the old end goes on reaching the new one, and while live the playhead is its end. */
  setSpan(from: number, to: number): void {
    const first = !this.known;
    const following = this.end >= this.to;
    const width = this.end - this.start;
    this.from = from;
    this.to = Math.max(from, to);
    if (first) this.show(this.to - PRESETS[1]!.ms, this.to);
    else if (following) this.show(this.to - width, this.to);
    else this.show(this.start, this.end);
    if (this.live) this.at = this.to;
    this.at = Math.max(this.from, Math.min(this.to, this.at));
  }

  /** Shows the window from `start` to `end`, kept within the span and at least WINDOW_LEAST wide where the span is. */
  show(start: number, end: number): void {
    const width = Math.min(this.to - this.from, Math.max(WINDOW_LEAST, end - start));
    // One narrower than the least is widened about its middle.
    const s = end - start >= WINDOW_LEAST ? start : (start + end) / 2 - width / 2;
    this.start = Math.max(this.from, Math.min(this.to - width, s));
    this.end = this.start + width;
  }

  /** Zooms the window by `factor` (less than 1 is nearer) about the moment `t`, which stays where it is across it. */
  zoomAt(factor: number, t: number): void {
    const width = this.end - this.start;
    const next = Math.min(this.to - this.from, Math.max(WINDOW_LEAST, width * factor));
    const share = width > 0 ? (t - this.start) / width : 0.5;
    this.show(t - share * next, t - share * next + next);
  }

  /** Moves the window by `ms`, later for more. */
  pan(ms: number): void {
    this.show(this.start + ms, this.end + ms);
  }

  /** Puts the playhead at `t`, which leaves live, and brings the window to it if it is outside. */
  seek(t: number): void {
    this.live = false;
    this.at = Math.max(this.from, Math.min(this.to, t));
    const width = this.end - this.start;
    if (this.at < this.start || this.at > this.end) this.show(this.at - width / 2, this.at + width / 2);
  }

  /** Back to now: the page's live view, the window ending at now. */
  goLive(): void {
    this.live = true;
    this.playing = false;
    const width = this.end - this.start;
    this.at = this.to;
    this.show(this.to - width, this.to);
  }

  /** Plays on by `ms` of the reader's time. At the span's end it stops there; the window keeps the playhead in view. */
  advance(ms: number): void {
    if (!this.playing || this.live) return;
    this.at = Math.min(this.to, this.at + ms * this.speed);
    if (this.at >= this.to) this.playing = false;
    const width = this.end - this.start;
    if (this.at > this.end - AHEAD * width) this.show(this.at - (1 - AHEAD) * width, this.at + AHEAD * width);
  }

  /** Where `t` falls across a strip `w` pixels wide showing the window, and the moment at `x` pixels. */
  x(t: number, w: number): number {
    return ((t - this.start) / Math.max(1, this.end - this.start)) * w;
  }

  time(x: number, w: number): number {
    return this.start + (x / Math.max(1, w)) * (this.end - this.start);
  }
}

/**
 * A moment typed as a browser's date and time field gives it, "2026-11-17T21:00" or with seconds, on the reader's clock:
 * `offset` is minutes behind UTC. Null for anything else.
 */
export function localMoment(text: string, offset: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) + offset * 60_000;
}

/** A moment as a date and time field takes it, to the minute. */
export function localText(t: number, offset: number): string {
  return new Date(t - offset * 60_000).toISOString().slice(0, 16);
}

/** Points a read of everyone's places aims at: about half a megabyte of answer, which a tick's thread copies in half a millisecond. */
export const POINTS = 12_000;
/** Points a read of one survivor's track aims at. */
export const TRACK_POINTS = 2000;
/** Steps a read may ask for, so a window moved a little asks again exactly what was asked before. */
const STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 86_400_000];

/** The step for a read of `ms` of `survivors`' places that answers about `points` points. */
export function stepFor(ms: number, survivors: number, points = POINTS): number {
  const least = (ms * Math.max(1, survivors)) / points;
  return STEPS.find((s) => s >= least) ?? STEPS.at(-1)!;
}

/** What is held of the log for a window: from when to when, and at what step. */
export interface Held {
  from: number;
  to: number;
  step: number;
}

/**
 * The stretch to fetch for the timeline's window: half its width again on each side, so a pan does not ask at once,
 * within the span, and on whole seconds, so pages looking at the same moments ask the same of the server.
 */
export function fetchSpan(t: Timeline): [number, number] {
  const pad = (t.end - t.start) / 2;
  const from = Math.max(Math.floor(t.from / 1000) * 1000, Math.floor((t.start - pad) / 1000) * 1000);
  const to = Math.min(Math.ceil(t.to / 1000) * 1000, Math.ceil((t.end + pad) / 1000) * 1000);
  return [from, Math.max(from, to)];
}

/**
 * Whether what is held serves the window `start` to `end`: it covers it, at a step no coarser than twice `step`, the one
 * a fresh read would take. Its end may lag the window's by a few seconds, as it does following the log's end, which
 * moves every second.
 */
export function serves(held: Held | null, start: number, end: number, step: number): boolean {
  const slack = Math.max(5000, (end - start) / 50);
  return held !== null && held.from <= start && held.to >= end - slack && held.step <= step * 2;
}
