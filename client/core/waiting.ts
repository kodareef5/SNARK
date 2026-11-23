// Riding out a restart (planning/workstreams/restart.md). The server says it is stopping (S_RESTART), the game page
// notes who to bring back and leaves for a small waiting page, and that page asks the world's ready.json until a new
// start answers whose page is built, then goes back into the game as the same survivor. A game page that lost its
// server with no word waits in place by the same rules. Nothing here touches a page: the shell and the waiting page
// give it a port.

import type { Ready } from "../../shared/ready.ts";
import { savedName } from "./entry-state.ts";

/** Who a page brings back, and what it left. Kept in the tab's sessionStorage, and never put in a URL. */
export interface Comeback {
  name: string;
  /** The server's password as the page gave it, "" for none. */
  password: string;
  spectate: boolean;
  /** The start of the server it left (Ready.started), 0 where the page never learned it. */
  started: number;
  /** The world's map, "" where the page never learned it. */
  map: string;
  /** "restart": the server said it was stopping. "lost": the connection closed with no word. */
  why: "restart" | "lost";
  /** When the page began to wait, in ms since 1970. */
  at: number;
  /** Times in a row a lost page has come back and lost its server again. */
  tries: number;
}

/** A lost page comes back by itself this many times in a row. After that it says so and waits to be asked. */
export const TRIES_MOST = 3;
/** A session that has lasted this long is no longer one of a row of failures. */
export const SETTLED_MS = 60_000;

export const waitKey = (path: string): string => "snark.wait." + path.replace(/(?:index|play|wait)\.html$/, "");

export function readComeback(input: string | null): Comeback | null {
  try {
    const a = JSON.parse(input ?? "null") as Partial<Comeback> | null;
    if (!a || !savedName(a.name) || typeof a.password !== "string" || (a.why !== "restart" && a.why !== "lost")) return null;
    const number = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    return { name: a.name, password: a.password, spectate: a.spectate === true, started: number(a.started), map: typeof a.map === "string" ? a.map : "", why: a.why, at: number(a.at), tries: Math.floor(number(a.tries)) };
  } catch {
    return null;
  }
}

/** What an answer from ready.json means to a page that waits. */
export type Verdict =
  /** No server answers, or the one that does is the one that said it was stopping. */
  | "wait"
  /** A new start answers, but the client on its disk is of another version: it is still being built. */
  | "unbuilt"
  /** The connection has dropped too often in a row for the page to go on coming back by itself. */
  | "stuck"
  | "enter";

/** `ready` is null where nothing answered, or what answered was not a world's ready.json. */
export function verdict(c: Comeback, ready: Ready | null): Verdict {
  if (!ready || typeof ready.started !== "number" || typeof ready.wire !== "number") return "wait";
  // Behind a front, another world of the cluster may answer for one that is down.
  if (c.map !== "" && ready.map !== c.map) return "wait";
  if (ready.started === c.started) {
    // The same start: one that said it was stopping has not stopped yet. One that said nothing is simply there again.
    if (c.why === "restart") return "wait";
    return c.tries >= TRIES_MOST ? "stuck" : "enter";
  }
  if (typeof ready.page === "number" && ready.page !== ready.wire) return "unbuilt";
  return "enter";
}

/** How long until the next asking, by how long the page has waited: often at first, then less. */
export function pace(waitedMs: number): number {
  return waitedMs < 60_000 ? 2000 : waitedMs < 600_000 ? 5000 : 15_000;
}

/** A wait before going back in, from a number in [0, 1): a full server's pages do not all join on one tick. */
export const spread = (r: number): number => Math.floor(Math.max(0, Math.min(0.999, r)) * 3000);

/** A span as minutes and seconds: "0:07", "12:40". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The line a waiting page shows. */
export function waitLine(c: Comeback, v: Verdict, waitedMs: number): string {
  if (v === "enter") return "The server is back. Returning to the game.";
  if (v === "stuck") return "The connection keeps dropping. Reload this page to try again.";
  if (v === "unbuilt") return `The server is up and its new page is being built (${clockText(waitedMs)}).`;
  return c.why === "restart" ? `The server is restarting for an update. Stay here: you will be brought back (${clockText(waitedMs)}).` : `The server went away. Waiting for it to come back (${clockText(waitedMs)}).`;
}

/** What waiting needs of the page it runs in. */
export interface WaitPort {
  /** Milliseconds since 1970. */
  now(): number;
  /** Asks the world's ready.json; null for no answer or one that is not it. It never rejects. */
  ask(): Promise<Ready | null>;
  later(run: () => void, ms: number): void;
  /** A number in [0, 1). */
  random(): number;
  say(line: string): void;
  /** Go back into the game as the survivor. */
  enter(): void;
}

/** Waits the restart out: asks, says what it found, and enters once a server that will take the page answers. */
export function waitOut(c: Comeback, port: WaitPort): void {
  const round = (): void => {
    void port.ask().then((ready) => {
      const waited = port.now() - c.at, v = verdict(c, ready);
      port.say(waitLine(c, v, waited));
      if (v === "enter") port.later(() => port.enter(), spread(port.random()));
      else if (v !== "stuck") port.later(round, pace(waited));
    });
  };
  port.say(waitLine(c, "wait", port.now() - c.at));
  round();
}

/** What a page that asks ready.json makes of a response's JSON. */
export function readReady(v: unknown): Ready | null {
  const a = v as Partial<Ready> | null;
  if (!a || typeof a !== "object" || typeof a.started !== "number" || typeof a.wire !== "number" || typeof a.map !== "string") return null;
  return { started: a.started, wire: a.wire, page: typeof a.page === "number" ? a.page : null, map: a.map };
}

/** The game's address for a survivor coming back, beside the page that waited. */
export function backAddress(c: Comeback): string {
  return `play.html?name=${encodeURIComponent(c.name)}${c.spectate ? "&spectate=1" : ""}`;
}
