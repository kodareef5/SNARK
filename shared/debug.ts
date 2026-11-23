// What the debug bar and the server's `__debug` route say to each other (server/debug.ts, client/core/debug/).

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

/** The protocol's codes by family and number, for the network tab: C_, S_, CMD_, OWN_, EVENT_, TEXT_. */
export interface CodeNames {
  C: Record<number, string>;
  S: Record<number, string>;
  CMD: Record<number, string>;
  OWN: Record<number, string>;
  EVENT: Record<number, string>;
  TEXT: Record<number, string>;
}
