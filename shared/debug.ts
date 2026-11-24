// What the debug bar and the server's `__debug` route say to each other (server/debug.ts, client/core/debug/).

import type { Bodies, SecondField } from "./admin.ts";

export const LEVEL_DEBUG = 0, LEVEL_INFO = 1, LEVEL_WARN = 2, LEVEL_ERROR = 3;
export const LEVEL_NAMES = ["debug", "info", "warn", "error"] as const;

/** A line the server logged: its number in the server's log, ms since 1970, the world's tick, its LEVEL_, its text. */
export interface ServerLine {
  seq: number;
  at: number;
  tick: number;
  level: number;
  text: string;
}

/**
 * A tick the server kept as long (server/admin/parts.ts LongTick): its tick, wall ms since 1970, its ms and how late it
 * began, ms of each part in `ServerState.parts.names` order, the process's counts over it and over the gap before it,
 * whose its time was, and its longest parts in words.
 */
export interface ServerLongTick {
  tick: number;
  at: number;
  ms: number;
  late: number;
  parts: number[];
  counts: number[];
  gap: number[];
  whose: "own" | "core" | "page";
  text: string;
}

/**
 * The server as an admin asks for it: the debug bar's Server tab, and a bug report's server.json. `at` and
 * `world.startedAt` are ISO times; the connection and the survivor are the asker's own.
 */
export interface ServerState {
  at: string;
  world: { name: string; map: string; hash: number; tick: number; dev: boolean; startedAt: string; online: number };
  /** Ticks a second, run and given up since the start, and the last two minutes by the second (shared/admin.ts SECOND_FIELDS). */
  ticks: { rate: number; ran: number; dropped: number; seconds: Record<SecondField, number[]> };
  /** The long ticks of the last two minutes, at most 64, oldest first. */
  long: ServerLongTick[];
  /**
   * Ms of each part over every tick since the start, the ticks counted, and the ms past which a tick is kept as long. Two
   * answers apart say where the ticks between them went.
   */
  parts: { names: readonly string[]; all: number[]; ticks: number; limit: number };
  bodies: Bodies;
  /** Bytes, as the process counts them. */
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
  /** Bytes sent to the asker since it connected, messages skipped for its backlog, and bytes waiting to go. */
  connection: { sent: number; skipped: number; waiting: number };
  survivor: { x: number; y: number; z: number; tick: number } | null;
}

/** What `POST __debug` answers an admin: the log's lines after the asked `since`, the `since` to ask next, and the server. */
export interface DebugAnswer {
  lines: ServerLine[];
  next: number;
  server: ServerState;
}

/** The protocol's codes by family and number, for the network tab: C_, S_, CMD_, OWN_, EVENT_, TEXT_. */
export interface CodeNames {
  C: Record<number, string>;
  S: Record<number, string>;
  CMD: Record<number, string>;
  OWN: Record<number, string>;
  EVENT: Record<number, string>;
  TEXT: Record<number, string>;
}

export const CODE_FAMILIES = ["C", "S", "CMD", "OWN", "EVENT", "TEXT"] as const;

/**
 * The codes of `protocol` (shared/net/protocol.ts as a module) by family. The server builds it and sends it: the page's
 * late files do not import the whole protocol, which would make the first frame's script export every name of it.
 */
export function codeNames(protocol: Readonly<Record<string, unknown>>): CodeNames {
  const out = { C: {}, S: {}, CMD: {}, OWN: {}, EVENT: {}, TEXT: {} } as CodeNames;
  for (const [name, value] of Object.entries(protocol)) {
    // A size beside the codes (EVENT_NAME_BYTES) is not one.
    if (typeof value !== "number" || /_(BYTES|BITS)$/.test(name)) continue;
    const family = CODE_FAMILIES.find((f) => name.startsWith(`${f}_`));
    if (family) out[family][value] = name;
  }
  return out;
}
