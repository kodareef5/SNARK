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
