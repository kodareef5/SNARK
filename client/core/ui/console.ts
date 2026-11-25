// Sending a line and receiving text are the session's job. This file only edits the console's state.

import { maskSecret } from "../../../shared/console.ts";
import { TEXT_NOTICE } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { columns, lineHeight, wrap, K_INPUT, K_PANEL, type UiFrame } from "./nodes.ts";
import { S_CONSOLE_TEXT, S_INPUT, S_PANEL } from "./style.ts";

const HISTORY = 50;
const SCROLLBACK = 300;
/** Longest line the server accepts, in characters (see ClientSession.text). */
export const MAX_LINE = 66;

export const KEY_CONSOLE_PANEL = 200;
export const KEY_CONSOLE_INPUT = 201;
export const KEY_CONSOLE_ROW = 210;
const PAD = 10;

export class ConsoleState {
  open = false;
  input = "";
  /** Lines sent, oldest first. A line with a password is left out (maskSecret). */
  readonly history: string[] = [];
  /** Position in history while browsing it. -1 while typing a new line. */
  private at = -1;
  private draft = "";
  /** Unwrapped lines: echoes of what was typed, a password masked, and text from the server. */
  readonly lines: string[] = [];
  /** Rows scrolled up from the newest. */
  scroll = 0;
  private seen = 0;
  private readonly rows: string[] = [];
  private rowsFor = "";

  edit(value: string): void {
    this.input = value.length > MAX_LINE ? value.slice(0, MAX_LINE) : value;
    this.at = -1;
  }

  submit(send: (line: string) => void): void {
    const line = this.input.trim();
    this.input = "";
    this.at = -1;
    this.scroll = 0;
    if (line === "") return;
    const masked = maskSecret(line);
    if (masked === null && this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > HISTORY) this.history.shift();
    }
    this.print("> " + (masked ?? line));
    send(line);
  }

  /** `dir` is -1 for up and +1 for down. The line being typed is kept and comes back at the end. */
  recall(dir: number): void {
    const n = this.history.length;
    if (n === 0) return;
    if (this.at < 0) {
      if (dir > 0) return;
      this.draft = this.input;
      this.at = n - 1;
    } else {
      this.at += dir;
      if (this.at < 0) this.at = 0;
      if (this.at >= n) {
        this.at = -1;
        this.input = this.draft;
        return;
      }
    }
    this.input = this.history[this.at]!;
  }

  print(line: string): void {
    this.lines.push(line);
    if (this.lines.length > SCROLLBACK) this.lines.shift();
    this.rowsFor = "";
  }

  absorb(session: ClientSession): void {
    const fresh = session.logVersion - this.seen;
    if (fresh <= 0) return;
    this.seen = session.logVersion;
    const log = session.log;
    // Chat lines belong to the chat box, not the console.
    for (let i = Math.max(0, log.length - fresh); i < log.length; i++) if (log[i]!.channel <= TEXT_NOTICE) this.print(log[i]!.text);
  }

  build(f: UiFrame): void {
    if (!this.open) return;
    const h = Math.round(f.height * 0.45);
    f.add(KEY_CONSOLE_PANEL, K_PANEL, 0, 0, f.width, h, S_PANEL);
    const lh = lineHeight(S_CONSOLE_TEXT);
    const inputH = lineHeight(S_INPUT) + 6;
    const cols = columns(f.width - PAD * 2, S_CONSOLE_TEXT);
    const sig = `${cols}:${this.lines.length}`;
    if (sig !== this.rowsFor) {
      this.rowsFor = sig;
      this.rows.length = 0;
      for (const line of this.lines) wrap(line, cols, this.rows);
    }
    const visible = Math.floor((h - inputH - PAD * 2) / lh);
    const maxScroll = Math.max(0, this.rows.length - visible);
    if (this.scroll > maxScroll) this.scroll = maxScroll;
    const last = this.rows.length - this.scroll;
    const first = Math.max(0, last - visible);
    let y = h - inputH - PAD - (last - first) * lh;
    for (let i = first; i < last; i++) {
      f.text(KEY_CONSOLE_ROW + (i - first), PAD, y, f.width - PAD * 2, S_CONSOLE_TEXT, this.rows[i]!);
      y += lh;
    }
    const field = f.add(KEY_CONSOLE_INPUT, K_INPUT, PAD, h - inputH - 4, f.width - PAD * 2, inputH, S_INPUT);
    field.text = this.input;
    field.interactive = true;
    field.focus = true;
  }

  /** Rows a paging key scrolls, one fewer than are visible. */
  page(f: UiFrame): number {
    return Math.max(1, Math.floor((Math.round(f.height * 0.45) - lineHeight(S_INPUT) - 6 - PAD * 2) / lineHeight(S_CONSOLE_TEXT)) - 1);
  }
}
