// What an admin did, as the save's journal keeps it (server/acts.ts writes it). An older save kept only a name, a tab and
// the line: it reads as an act whose time, survivor, rank and address are not known.

/** How the act reached the server. */
export type ActVia = "session" | "page" | "operator" | "module";
/** A command or a page's action, a sign-in, a change to permissions, or an admin's attempt at one that was refused. */
export type ActKind = "command" | "sign-in" | "change" | "refused";

export interface Act {
  /** The journal's sequence number, or the world's own count where it has no save. */
  seq: number;
  /** Wall-clock milliseconds, 0 where not known. */
  at: number;
  tick: number;
  name: string;
  /** The survivor's 17-digit ID (shared/ids.ts), or "". */
  id: string;
  /** The survivor's pid, 0 for none or not known. */
  pid: number;
  /** As shared/ranks.ts has it, -1 where not known. */
  rank: number;
  via: ActVia;
  /** The address it came from, or "". */
  from: string;
  kind: ActKind;
  what: string;
  /** The actor had proved nothing: no host password, no staff group that counted. Older entries read as false. */
  open: boolean;
}

/** Whether an act belongs with the open acts, apart from the latest kept: an open command. Every other kind is kept. */
export const openOnly = (act: Pick<Act, "open" | "kind">): boolean => act.open && act.kind === "command";

/** Text fit for an act: no control or format characters, spaces run together, at most `most` letters with a mark where cut. */
export function actText(text: string, most: number): string {
  const clean = text.slice(0, most * 4).replace(/\p{Cf}/gu, "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  const letters = Array.from(clean);
  return letters.length > most ? letters.slice(0, most).join("") + "…" : clean;
}

// The shared zone's types leave out the DOM's, so the text codecs are typed here as pack.ts types its own.
const codecs = globalThis as unknown as { TextEncoder: new () => { encode(s: string): Uint8Array }; TextDecoder: new () => { decode(bytes: Uint8Array): string } };
const UTF8_OUT = new codecs.TextEncoder();
const UTF8_IN = new codecs.TextDecoder();

const VIAS: readonly string[] = ["session", "page", "operator", "module"];
const KINDS: readonly string[] = ["command", "sign-in", "change", "refused"];

/** An act's bytes for the journal, which keeps the sequence number and the tick itself. `open` is written only when true. */
export function encodeAct(act: Omit<Act, "seq" | "tick">): Uint8Array {
  const { at, name, id, pid, rank, via, from, kind, what, open } = act;
  return UTF8_OUT.encode(JSON.stringify({ at, name, id, pid, rank, via, from, kind, what, ...(open ? { open } : {}) }));
}

/** The act in a journal entry's bytes, in either form. */
export function decodeAct(data: Uint8Array, seq = 0, tick = 0): Act {
  const line = UTF8_IN.decode(data);
  if (line.startsWith("{")) {
    let o: Record<string, unknown> | null = null;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      o = null;
    }
    if (o !== null && typeof o === "object") {
      const num = (v: unknown, or: number): number => (typeof v === "number" && Number.isFinite(v) ? v : or);
      const str = (v: unknown): string => (typeof v === "string" ? v : "");
      return {
        seq, at: num(o.at, 0), tick, name: str(o.name), id: str(o.id), pid: num(o.pid, 0), rank: num(o.rank, -1),
        via: VIAS.includes(o.via as string) ? (o.via as ActVia) : "session", from: str(o.from),
        kind: KINDS.includes(o.kind as string) ? (o.kind as ActKind) : "command", what: str(o.what), open: o.open === true,
      };
    }
  }
  const tab = line.indexOf("\t");
  const name = tab < 0 ? "" : line.slice(0, tab);
  const via: ActVia = name === "(operator)" ? "operator" : name === "(admin page)" ? "page" : "session";
  return { seq, at: 0, tick, name, id: "", pid: 0, rank: -1, via, from: "", kind: "command", what: tab < 0 ? line : line.slice(tab + 1), open: false };
}
