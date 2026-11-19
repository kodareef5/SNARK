// What the survivor log answers (server/survivor-log): the shapes its reads give, which the admin page reads as well. Times
// are wall milliseconds since 1970, places the world's metres, and `pid` a survivor's record id.

/** What a sample's `state` says a survivor was doing, by its number (server/survivor-log/format.ts STATE_). */
export const LOG_ALIVE = 0;
export const LOG_OUT = 1;
export const LOG_DEAD = 2;
export const LOG_SPECTATING = 3;
/** The connection is gone and the body lingers in the world. */
export const LOG_AWAY = 4;
export const LOG_STATES: readonly string[] = ["alive", "unconscious", "dead", "spectating", "away"];

/** The span the log holds, in wall milliseconds and ticks, and what it takes on disk. Null ends for an empty log. */
export interface LogSpan {
  from: number | null;
  to: number | null;
  fromTick: number | null;
  toTick: number | null;
  bytes: number;
  cap: number;
  segments: number;
}

/**
 * One stint of a session: from `from` (its start, or a change of tribe) to `to`, null while it goes on. `began` is when
 * the session began. `why` it ended: "left", the reason the server put the survivor out, "stopped" with the server,
 * "log off", "tribe" for a change of tribe (the next stint follows at once), or "lost" where the server stopped without
 * saying (a crash), `to` then being the last moment the log holds of that run.
 */
export interface LogSession {
  began: number;
  from: number;
  fromTick: number;
  to: number | null;
  toTick: number | null;
  team: number;
  tribe: string;
  why: string;
}

export interface LogSurvivor {
  pid: number;
  name: string;
  /** Milliseconds online inside the window asked about. */
  playMs: number;
  sessions: LogSession[];
}

/**
 * One survivor's samples, as columns. `state` is a LOG_ state; `seat` indexes the answer's `seats`, 0 being none.
 * x, y and z are metres, to a quarter of a metre.
 */
export interface LogTrack {
  pid: number;
  name: string;
  wall: number[];
  tick: number[];
  x: number[];
  y: number[];
  z: number[];
  state: number[];
  seat: number[];
}

/** `step` is the one used: the one asked for, unless the window held more than MAX_STEPS of them or more than MAX_POINTS points. */
export interface LogPositions {
  from: number;
  to: number;
  step: number;
  seats: string[];
  tracks: LogTrack[];
}

export interface LogHeld {
  item: string;
  quality: number;
  blueprint: boolean;
  count: number;
}

/**
 * What a survivor held at `at`. Offline then, it is what it held when it last left (`wall`), if the log still holds that.
 */
export interface LogHolding {
  pid: number;
  name: string;
  at: number;
  wall: number;
  online: boolean;
  items: LogHeld[];
}

/** One change: how many of each were gained and lost at that moment. */
export interface LogChange {
  wall: number;
  tick: number;
  gained: LogHeld[];
  lost: LogHeld[];
}

export interface LogChanges {
  pid: number;
  name: string;
  from: number;
  to: number;
  before: LogHeld[];
  after: LogHeld[];
  gained: LogHeld[];
  lost: LogHeld[];
  entries: LogChange[];
  /** More changes happened than MAX_ENTRIES; `gained` and `lost` still count them all. */
  more: boolean;
}

/** One span of holding some of an item. `to` is null while it is still held. */
export interface LogHolder {
  pid: number;
  name: string;
  quality: number;
  blueprint: boolean;
  from: number;
  to: number | null;
  most: number;
}

export interface LogItem {
  item: string;
  quality: number;
  blueprint: boolean;
  survivors: number;
  most: number;
}

/** An admin command or a survivor's death from the save's journal. A command's `name` is who typed it, `text` the line; a death's `text` is its cause and `cache` what was left (a record id, 0 for nothing). */
export interface LogMark {
  wall: number;
  tick: number;
  kind: "admin" | "death";
  pid: number;
  name: string;
  text: string;
  cache: number;
}

export interface LogMarks {
  marks: LogMark[];
  more: boolean;
}
