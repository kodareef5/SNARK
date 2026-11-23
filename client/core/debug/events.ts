// Lag events: the moments the debug bar marks on its timeline and keeps for three minutes. A frame is a hitch when it
// stands out from the frames around it, so a game that runs steadily at half the display's rate is not one long event.
// Events that follow each other within MERGE_MS join into one, which keeps its worst frame.

import { LATE } from "../notes/ring.ts";

export const EV_HITCH = 0, EV_LONG = 1, EV_STALL = 2, EV_TASK = 3, EV_UPLOAD = 4, EV_GAP = 5, EV_CORRECTION = 6, EV_JUMP = 7, EV_GOVERNOR = 8, EV_ASSET = 9, EV_ERROR = 10, EV_TICK = 11;
export const EVENT_NAMES = ["hitch", "long frame", "stall", "long task", "upload spike", "snapshot gap", "correction", "clock jump", "governor", "asset failed", "error", "server tick"] as const;
/** Each kind's colour on the timeline, 0xRRGGBB. */
export const EVENT_COLOURS = [0xf2c46b, 0xf2a477, 0xe0605a, 0xc89be8, 0x7fd0e6, 0xe68ab4, 0xa6e3f4, 0xb4c8ff, 0x9fd39b, 0xe0605a, 0xff5a5a, 0xf2a477];
/** Frame kinds are the worst of these first three. */
const FRAME_KINDS = 3;

/** A frame past this is long, and past STALL_MS a stall, whatever the frames round it took. */
export const LONG_MS = 50;
export const STALL_MS = 250;
/** Events of a kind this close join. */
export const MERGE_MS = 500;
/** Uploads past this in one frame, and a gap between snapshots past this, are events. */
export const UPLOAD_MS = 8;
export const GAP_MS = 250;
/** Events kept: three minutes' worth at a busy rate. */
export const EVENTS_KEPT = 400;
/** The frames round a frame that say what is usual. */
const USUAL = 31;

export interface LagEvent {
  /** When it began and its last part, on the page's clock in ms. */
  at: number;
  end: number;
  kind: number;
  /** Its worst: ms for times, a count for counted things, the governor's level. */
  size: number;
  /** How many frames or things joined in it. */
  count: number;
  /** The frame its worst was in, as the span ring counts frames, or -1. */
  frame: number;
  /** What took longest in that frame, or what the event was. */
  cause: string;
  /** That frame's spans, copied so they outlive the ring, or null. */
  spans: Float32Array | null;
}

/** What the bar knows of a frame just drawn. Times are the page's clock, in ms. */
export interface FrameFacts {
  at: number;
  interval: number;
  /** The display's interval. */
  target: number;
  upload: number;
  /** The frame's number in the span ring. */
  frame: number;
  /** A picture was being taken: its frames are slow for that, and not an event. */
  shot: boolean;
}

export class LagEvents {
  /** Oldest first. */
  readonly list: LagEvent[] = [];
  private readonly usual = new Float64Array(USUAL);
  private readonly sorted = new Float64Array(USUAL);
  private seen = 0;
  /** Events since the list was last looked at, for the bar's count. */
  fresh = 0;

  /** The usual frame of late: the middle of the last USUAL intervals, or 0 before there are that many. */
  usualMs(): number {
    if (this.seen < USUAL) return 0;
    this.sorted.set(this.usual);
    this.sorted.sort();
    return this.sorted[USUAL >> 1]!;
  }

  /** The longest a frame may take before it is a hitch, against the display and against the frames round it. */
  hitchMs(target: number): number {
    const usual = this.usualMs();
    return Math.max(LATE * target, 1.25 * usual, usual + 4);
  }

  /**
   * A frame just drawn. Returns the event it made or made worse, so the caller can copy its spans and ask for a picture,
   * or null. `cause` names what took longest in it, asked only for an event.
   */
  frame(f: FrameFacts, cause: () => string): LagEvent | null {
    // The first frame's interval runs from before anything began.
    if (f.interval <= 0) return null;
    // Until the usual frame is known, only a stall stands out.
    const limit = this.seen < USUAL ? STALL_MS : this.hitchMs(f.target);
    this.usual[this.seen++ % USUAL] = f.interval;
    let made: LagEvent | null = null;
    if (!f.shot && f.interval > limit) {
      const kind = f.interval > STALL_MS ? EV_STALL : f.interval > LONG_MS ? EV_LONG : EV_HITCH;
      made = this.frameEvent(f, kind, cause);
    }
    if (f.upload > UPLOAD_MS) {
      const e = this.note(f.at, EV_UPLOAD, f.upload, "");
      if (e.frame < 0 || f.upload >= e.size) e.frame = f.frame;
    }
    return made;
  }

  private frameEvent(f: FrameFacts, kind: number, cause: () => string): LagEvent | null {
    const last = this.lastOf(FRAME_KINDS, f.at);
    if (last) {
      last.end = f.at;
      last.count++;
      if (kind > last.kind) last.kind = kind;
      if (f.interval <= last.size) return null;
      last.size = f.interval;
      last.frame = f.frame;
      last.cause = cause();
      return last;
    }
    return this.push({ at: f.at, end: f.at, kind, size: f.interval, count: 1, frame: f.frame, cause: cause(), spans: null });
  }

  /**
   * Anything else that happened at `at`: a kind, its size, and what it was. One of the same kind within MERGE_MS joins it,
   * keeping the larger size. Returns the event.
   */
  note(at: number, kind: number, size: number, cause: string): LagEvent {
    const last = this.lastOf(kind, at);
    if (last) {
      last.end = at;
      last.count++;
      if (size > last.size) {
        last.size = size;
        if (cause) last.cause = cause;
      }
      return last;
    }
    return this.push({ at, end: at, kind, size, count: 1, frame: -1, cause, spans: null });
  }

  /** The newest event of `kind` (or of any frame kind, for FRAME_KINDS) that ended within MERGE_MS of `at`. */
  private lastOf(kind: number, at: number): LagEvent | null {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]!;
      if (at - e.end > MERGE_MS) return null;
      if (kind === FRAME_KINDS ? e.kind < FRAME_KINDS : e.kind === kind) return e;
    }
    return null;
  }

  private push(e: LagEvent): LagEvent {
    this.list.push(e);
    if (this.list.length > EVENTS_KEPT) this.list.shift();
    this.fresh++;
    return e;
  }

  /** The events that touch the page's clock from `from` to `to`, oldest first, into `out`. */
  between(from: number, to: number, out: LagEvent[]): LagEvent[] {
    out.length = 0;
    for (const e of this.list) if (e.end >= from && e.at <= to) out.push(e);
    return out;
  }
}

/** Counters the bar watches between frames, and the event each one's rise makes. */
export class Rises {
  private readonly last = new Float64Array(8);
  private readonly known = new Uint8Array(8);

  /** How much counter `k` rose since it was last read; 0 the first time. */
  rise(k: number, now: number): number {
    const was = this.last[k]!, first = this.known[k] === 0;
    this.last[k] = now;
    this.known[k] = 1;
    return first ? 0 : Math.max(0, now - was);
  }
}
