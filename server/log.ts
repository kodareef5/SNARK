// The server's recent log lines, which the debug bar shows an admin (server/debug.ts): a ring of what the console
// printed, each line with its level, wall time and the world's tick. The console still prints every line as before.

import { format } from "node:util";
import { LEVEL_DEBUG, LEVEL_ERROR, LEVEL_INFO, LEVEL_WARN, type ServerLine } from "../shared/debug.ts";

/** Lines a server's log keeps. */
export const LOG_LINES = 1000;
/** Characters a line keeps of its text; a longer one ends in an ellipsis. */
export const LINE_CHARS = 4000;

/** The latest `most` lines the server logged. Lines are numbered from 1, and no number is given twice. */
export class ServerLog {
  readonly most: number;
  /** The world's tick, stamped on each line; 0 until there is a world. */
  tick: () => number = () => 0;
  private readonly ring: ServerLine[] = [];
  private seq = 0;

  constructor(most = LOG_LINES) {
    this.most = most;
  }

  /** The latest line's number, 0 before the first. */
  get last(): number {
    return this.seq;
  }

  add(level: number, text: string): void {
    const line: ServerLine = { seq: this.seq + 1, at: Date.now(), tick: this.tick(), level, text: text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 1)}…` : text };
    this.ring[this.seq % this.most] = line;
    this.seq++;
  }

  /** The kept lines numbered after `seq`, oldest first. */
  since(seq: number): ServerLine[] {
    const out: ServerLine[] = [];
    for (let n = Math.max(Math.floor(seq) || 0, this.seq - this.most, 0); n < this.seq; n++) out.push(this.ring[n % this.most]!);
    return out;
  }
}

/** The console's methods a log keeps the lines of, and the level of each. */
const TEED = [["debug", LEVEL_DEBUG], ["log", LEVEL_INFO], ["info", LEVEL_INFO], ["warn", LEVEL_WARN], ["error", LEVEL_ERROR]] as const;

/** The log the console's lines go to, or null. */
let target: ServerLog | null = null;
/** The console's methods as teeConsole wrapped them. */
const wrappers = new WeakSet<object>();
/** Set while a wrapper runs, so that one which calls another, or a log that prints, keeps its line once. */
let busy = false;

/**
 * Has the console add each line it prints to `log`, printing it as before. Its methods are wrapped once a process: a later
 * call points the wrappers at its own log, and wraps afresh only a method replaced since, such as a test's spy. Returns
 * what stops the lines going to `log`; the wrappers stay, and cost a null check.
 */
export function teeConsole(log: ServerLog): () => void {
  for (const [name, level] of TEED) {
    const inner = console[name];
    if (wrappers.has(inner)) continue;
    const wrapper = function (this: unknown, ...args: unknown[]): void {
      if (busy) return void inner.apply(this, args);
      busy = true;
      try {
        inner.apply(this, args);
      } finally {
        try {
          target?.add(level, format(...args));
        } catch {
          // The line is lost; the console printed it all the same.
        }
        busy = false;
      }
    };
    wrappers.add(wrapper);
    console[name] = wrapper;
  }
  target = log;
  return () => {
    if (target === log) target = null;
  };
}
