// The survivor log's reads for the admin page, behind the admin pages' gate (routes.ts). Each passes its parameters, checked
// and bounded, to the log, whose own thread makes the answer as JSON text (server/survivor-log/log.ts json); the tick's
// thread only hands that text on. The same question asked again within the second is answered from the first.
//
//   /admin/log/span.json                                   what the log holds, its size and cap, whether it is on and why not
//   /admin/log/survivors.json?from&to                      who was online in the window, with their sessions and time online
//   /admin/log/positions.json?from&to&step                 everyone's places through the window at a step
//   /admin/log/track.json?pid&from&to&step                 one survivor's
//   /admin/log/held.json?pid&at                            what one held at a moment
//   /admin/log/changes.json?pid&from&to                    what one gained and lost in the window, change by change
//   /admin/log/holders.json?item&from&to[&quality][&blueprint]   who held an item, and when
//   /admin/log/items.json?from&to                          every item anyone held in the window
//   /admin/log/marks.json?from&to                          admin commands and deaths in the window
//   /admin/log/tick.json?wall, /admin/log/wall.json?tick   one clock read as the other
//
// Times are wall milliseconds since 1970, a window at most WINDOW_MOST long, and a step from MIN_STEP to a day.

import { QUALITY_NAMES } from "../../shared/sim/items.ts";
import type { Host } from "../host.ts";
import type { ReadName } from "../survivor-log/log.ts";
import { MIN_STEP } from "../survivor-log/store.ts";

/** The longest window a read may ask about: longer than the log holds at its cap with ten survivors. */
export const WINDOW_MOST = 400 * 86_400_000;
const STEP_MOST = 86_400_000;
/** The latest time a JavaScript date can hold. */
const TIME_MOST = 8.64e15;
const JSON_HEADERS = { "cache-control": "no-store", "content-type": "application/json" };

/** A query's parameters, read and checked one by one; the first that fails is kept as `error`. */
class Params {
  error = "";
  private readonly q: URLSearchParams;

  constructor(q: URLSearchParams) {
    this.q = q;
  }

  private fail(why: string): number {
    if (this.error === "") this.error = why;
    return 0;
  }

  /** A whole number from `least` to `most`. */
  int(name: string, least: number, most: number): number {
    const words = this.q.get(name);
    const n = Number(words);
    if (words === null || words.trim() === "" || !Number.isSafeInteger(n) || n < least || n > most) return this.fail(`${name} is a whole number from ${least} to ${most}`);
    return n;
  }

  time(name: string): number {
    return this.int(name, 0, TIME_MOST);
  }

  /** `from` and `to`, to no earlier than from and at most WINDOW_MOST after it. */
  window(): [number, number] {
    const from = this.time("from");
    const to = this.time("to");
    if (this.error === "" && (to < from || to - from > WINDOW_MOST)) this.fail(`to is at or after from, and at most ${WINDOW_MOST / 86_400_000} days after it`);
    return [from, to];
  }

  step(): number {
    return this.int("step", MIN_STEP, STEP_MOST);
  }

  pid(): number {
    return this.int("pid", 1, Number.MAX_SAFE_INTEGER);
  }

  /** An optional value: undefined where the query does not give it. */
  has(name: string): boolean {
    return this.q.has(name);
  }

  word(name: string): string {
    return this.q.get(name) ?? "";
  }
}

/** An answer as it is kept for the second: its text, or why there is none and the status that says so. */
interface Kept {
  status: number;
  text: string;
}

/** Calls `end` after `ms` milliseconds without keeping the process up for it. */
export type Later = (ms: number, end: () => void) => void;
const later: Later = (ms, end) => void setTimeout(end, ms).unref();

export class LogRoutes {
  private readonly host: Host;
  private readonly now: () => number;
  private readonly later: Later;
  /** This second's answers by their query, so pages asking the same thing at once cost one read. Let go as the second ends. */
  private readonly asked = new Map<string, Promise<Kept>>();
  private second = -1;

  constructor(host: Host, now: () => number, after: Later = later) {
    this.host = host;
    this.now = now;
    this.later = after;
  }

  /** Answers kept, for the tests. */
  get kept(): number {
    return this.asked.size;
  }

  /** The answer to `at`, a path under /admin/log/ in lower case, or null for any other path. */
  answer(at: string, url: URL): Response | Promise<Response> | null {
    if (!at.startsWith("/admin/log/")) return null;
    const name = at.slice("/admin/log/".length);
    const now = this.now();
    if (name === "span.json") return this.cached(at, now, () => this.span(now));
    const p = new Params(url.searchParams);
    let read: [ReadName, ...unknown[]];
    if (name === "survivors.json") read = ["survivors", ...p.window()];
    else if (name === "positions.json") read = ["positions", ...p.window(), p.step()];
    else if (name === "track.json") read = ["track", p.pid(), ...p.window(), p.step()];
    else if (name === "held.json") read = ["heldAt", p.pid(), p.time("at")];
    else if (name === "changes.json") read = ["changes", p.pid(), ...p.window()];
    else if (name === "items.json") read = ["items", ...p.window()];
    else if (name === "marks.json") read = ["marks", ...p.window()];
    else if (name === "tick.json") read = ["tickAt", p.time("wall")];
    else if (name === "wall.json") read = ["wallAt", p.int("tick", 0, Number.MAX_SAFE_INTEGER)];
    else if (name === "holders.json") {
      const item = p.word("item");
      const reg = this.host.world.reg, kind = reg.index.get(item);
      if ((kind === undefined || reg.defs[kind]?.type !== "item") && p.error === "") p.error = "item is the content id of an item, such as core:metal_ingot";
      const window = p.window();
      const quality = p.has("quality") ? p.int("quality", 0, QUALITY_NAMES.length - 1) : undefined;
      const bp = p.word("blueprint");
      if (p.has("blueprint") && bp !== "0" && bp !== "1" && p.error === "") p.error = "blueprint is 0 or 1";
      read = ["holders", item, ...window, quality, p.has("blueprint") ? bp === "1" : undefined];
    } else return new Response("not found", { status: 404 });
    if (p.error !== "") return new Response(p.error, { status: 400 });
    const [fn, ...args] = read;
    return this.cached(`${fn}\t${JSON.stringify(args)}`, now, () =>
      this.host.survivorLog.json(fn, ...args).then(
        (text) => ({ status: 200, text }),
        (err: unknown) => ({ status: 503, text: `the survivor log could not answer: ${err instanceof Error ? err.message : String(err)}` }),
      ),
    );
  }

  /** What the log holds and whether it is on, with the server's own time, which a page takes as now. Its folder is not told. */
  private span(now: number): Promise<Kept> {
    const { folder: _, ...span } = this.host.survivorLog.span();
    return Promise.resolve({ status: 200, text: JSON.stringify({ ...span, now }) });
  }

  private async cached(key: string, now: number, make: () => Promise<Kept>): Promise<Response> {
    const second = Math.floor(now / 1000);
    if (second !== this.second) {
      this.asked.clear();
      this.second = second;
    }
    let p = this.asked.get(key);
    if (!p) {
      // The first answer of a second sets that second's end, when every answer it kept is let go.
      if (this.asked.size === 0) this.later(1000 - (now - second * 1000), () => this.second === second && this.asked.clear());
      this.asked.set(key, (p = make()));
    }
    const kept = await p;
    return kept.status === 200 ? new Response(kept.text, { headers: JSON_HEADERS }) : new Response(kept.text, { status: kept.status });
  }
}
