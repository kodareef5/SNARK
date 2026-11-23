// The page's log from its start: what it printed to the console and the errors it met, kept until the debug bar's port
// (client/debug/debug-port.ts) takes them. The shell imports it first, so it sees the rest of the page's script run.

import { LEVEL_DEBUG, LEVEL_ERROR, LEVEL_INFO, LEVEL_WARN } from "../../shared/debug.ts";
import type { PageLine } from "../core/debug/port.ts";

/** Lines kept until the port takes them, and the most characters of one. */
const KEPT = 300, CHARS = 2000;
const LEVELS = { debug: LEVEL_DEBUG, log: LEVEL_INFO, info: LEVEL_INFO, warn: LEVEL_WARN, error: LEVEL_ERROR };
const kept: PageLine[] = [];
let sink: ((line: PageLine) => void) | null = null;

/** A value as text, never throwing: an error by its stack, an object as JSON where it can be. */
function text(v: unknown): string {
  try {
    if (v instanceof Error) return v.stack?.startsWith(String(v)) ? v.stack : `${v}\n${v.stack ?? ""}`.trim();
    return typeof v === "object" && v !== null ? (JSON.stringify(v) ?? String(v)) : String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function add(level: number, parts: readonly unknown[]): void {
  const line = { at: performance.now(), level, text: parts.map(text).join(" ").slice(0, CHARS) };
  if (sink) sink(line);
  else if (kept.push(line) > KEPT) kept.shift();
}

for (const name of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
  const print = console[name];
  console[name] = (...args: unknown[]): void => (print.apply(console, args), add(LEVELS[name], args));
}
// In the capture phase, so an image or a script that fails to load is heard too, by its tag and address.
addEventListener("error", (e: Event) => {
  if (e instanceof ErrorEvent) return add(LEVEL_ERROR, ["Uncaught", e.error ?? `${e.message} at ${e.filename}:${e.lineno}`]);
  const el = e.target as { localName?: string; src?: string; href?: string };
  add(LEVEL_ERROR, [`${el.localName} did not load: ${el.src || el.href}`]);
}, true);
addEventListener("unhandledrejection", (e) => add(LEVEL_ERROR, ["Uncaught (in promise)", e.reason]));

/** Hands the lines kept to `to`, and from then on each line as it comes. */
export function logTo(to: (line: PageLine) => void): void {
  sink = to;
  for (const line of kept.splice(0)) to(line);
}
