// What a server tells its admin page (server/admin/routes.ts), as JSON: the shapes both sides are written against.
// Times are wall ms since 1970, places the world's metres (shared/world/coords.ts), durations ms. The survivor log's
// answers are shaped in shared/survivor-log.ts.

import type { LogSpan } from "./survivor-log.ts";

/** A second of the loop: its start, ticks run, the median and worst tick, the latest start, and ticks given up. */
export const SECOND_FIELDS = ["at", "ticks", "p50", "worst", "late", "dropped"] as const;
/**
 * A minute of the loop: its start, ticks run, the mean, median, 99th percentile and worst tick, the mean and latest start,
 * ticks given up, the share of the minute spent in ticks in percent, and as it closed the survivors online, bodies in the world,
 * resident and heap memory in bytes, and the save's commits since the start.
 */
export const MINUTE_FIELDS = ["at", "ticks", "mean", "p50", "p99", "worst", "lateMean", "late", "dropped", "busy", "online", "bodies", "rss", "heap", "commits"] as const;
export type SecondField = (typeof SECOND_FIELDS)[number];
export type MinuteField = (typeof MINUTE_FIELDS)[number];

/** /admin/minutes.json: the minutes held, oldest first, a column a field, and the count to ask `from` next time. */
export interface Minutes {
  next: number;
  columns: Record<MinuteField, number[]>;
}

/** Bodies in the world, by group and by kind, most first. */
export interface Bodies {
  count: number;
  max: number;
  /** Slots kept for survivors, and creates refused for want of a slot since the start. */
  reserve: number;
  refused: number;
  groups: Record<string, number>;
  kinds: { id: string; group: string; n: number }[];
}

export interface Backup {
  name: string;
  at: number;
  tick: number;
  bytes: number;
}

export interface SaveState {
  file: string;
  /** The save's file and its write-ahead log. */
  bytes: number;
  commits: number;
  /** Null while commits succeed. */
  failing: { seconds: number; tries: number; code: string; error: string } | null;
  /** The last checkpoint's time and the pages it left in the log. */
  checkpoint: { ms: number; pages: number };
  /** Newest first. */
  backups: Backup[];
}

export interface ModuleCost {
  name: string;
  handlers: number;
  calls: number;
  ms: number;
  worst: number;
  /** Handlers switched off for throwing. */
  off: number;
}

/** A setting not at its default: a list's entries one a line, and a password's value only as "set". */
export interface ChangedSetting {
  name: string;
  value: string | string[];
  source: string;
  status: string;
}

/** The survivor log: its span, whether it is on and why not. /admin/log/span.json adds `now`, the server's time. */
export interface LogState extends LogSpan {
  on: boolean;
  why: string;
}

/** /admin/stats.json. */
export interface Stats {
  at: number;
  world: { name: string; dev: boolean; tick: number; startedAt: number; cluster: string };
  map: { id: string; label: string; sizeX: number; sizeZ: number; chunksX: number; chunksZ: number };
  /** Ticks a second, the ms one has, ticks run and given up since the start, and the last two minutes by the second. */
  ticks: { rate: number; budget: number; ran: number; dropped: number; seconds: Record<SecondField, number[]> };
  online: { now: number; max: number };
  bodies: Bodies;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  save: SaveState | null;
  log: LogState;
  settings: ChangedSetting[];
  modules: ModuleCost[];
}

export interface SurvivorDeath {
  tick: number;
  /** Where the death was since this run of the server began; null before it, whose ticks span time it was down. */
  at: number | null;
  x: number;
  z: number;
}

export interface SurvivorRow {
  pid: number;
  name: string;
  tribe: string;
  team: number;
  level: number;
  /** A session is connected to it now. */
  online: boolean;
  /** Waiting to rise, and knocked out. */
  dead: boolean;
  out: boolean;
  /** Where its body is now, or what it sits on, else where it was last saved. */
  x: number;
  z: number;
  /** The content id of what it sits on, or "". */
  riding: string;
  lastLogin: number | null;
  /** Now while online, else its last checkpoint online; null if it never was. */
  lastSeen: number | null;
  playMs: number | null;
  /** Oldest first, as many as its record keeps. */
  deaths: SurvivorDeath[];
}

/** /admin/survivors.json. */
export interface Survivors {
  at: number;
  tick: number;
  survivors: SurvivorRow[];
}
