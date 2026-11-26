// What a server tells its admin page (server/admin/routes.ts), as JSON: the shapes both sides are written against.
// Times are wall ms since 1970, places the world's metres (shared/world/coords.ts), durations ms. The survivor log's
// answers are shaped in shared/survivor-log.ts.

import type { TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "./net/protocol.ts";
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

/** One setting on the admin's settings page (/admin/settings.json): what it is, what it has, and whether it may change now. */
export interface SettingRow {
  /** ARK's name, a command-line flag's with its dash. */
  name: string;
  /** The heading it is listed under. */
  group: string;
  /** "float", "int", "bool", "text", "flag", or a list: "indexed", "struct", "names", "lines". */
  kind: string;
  doc: string;
  note: string;
  min: number;
  max: number;
  /** The default and the value as words: a list's entries one a line, an indexed setting's numbers with commas between. A password's are "". */
  def: string;
  value: string;
  /** Whether a password has a value, which is all that leaves of one. */
  has: boolean;
  source: string;
  secret: boolean;
  /** Why it may not change while the server runs, or "". */
  fixed: string;
  /** The page set it, and its value is kept across restarts. */
  kept: boolean;
}

/** /admin/settings.json, and what a change is answered with. `why` says why a change was refused, and `note` what else to know of one made. */
export interface SettingsPage {
  ok: boolean;
  why: string;
  note: string;
  /** Whether what the page sets outlives a restart: the world has a save to keep it beside. */
  keeps: boolean;
  /** Seconds until a stop that was said (POST /admin/stop, `doexit`), or -1. */
  stopLeft: number;
  rows: SettingRow[];
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
  /**
   * Ticks a second, the ms one has, ticks run and given up since the start, and the last two minutes by the second; and of
   * those minutes' ticks over their ms, or as long before them, how many were the server's own work, and how many the
   * machine's, waiting for a core or for pages (server/admin/parts.ts).
   */
  ticks: { rate: number; budget: number; ran: number; dropped: number; seconds: Record<SecondField, number[]>; long: { own: number; core: number; page: number } };
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
  /** Its ID (shared/ids.ts), or "" for none. */
  id: string;
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

export type AdminChatChannel = typeof TEXT_GLOBAL | typeof TEXT_LOCAL | typeof TEXT_TRIBE;

/** An accepted player text message, using the world's wall clock. */
export interface AdminChatLine {
  at: number;
  channel: AdminChatChannel;
  speaker: string;
  text: string;
  /** The names of the tags it was said with; absent for none. */
  tags?: string[];
}

/** /admin/overview.json, the live data for one card in the cluster admin. */
export interface AdminOverview {
  stats: Stats;
  positions: Pick<SurvivorRow, "name" | "x" | "z">[];
  chat: AdminChatLine[];
}

/** Side of /admin/terrain.rgba in pixels. */
export const ADMIN_TERRAIN_SIDE = 192;
