// Sending a line and receiving text are the session's job. This file only edits the console's state.

import { maskSecret } from "../../../shared/console.ts";
import { TEXT_NOTICE } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { columns, lineHeight, wrap, K_BUTTON, K_INPUT, K_PANEL, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_CONSOLE_TEXT, S_INPUT, S_PANEL } from "./style.ts";

const HISTORY = 50;
const SCROLLBACK = 300;
/** Longest line the server accepts, in characters (see ClientSession.text). */
export const MAX_LINE = 66;

/** What the line that shows a secret says before it, and what it says once the console has closed. */
export const SECRET_SHOWN = "Your password, shown this once: ";
export const SECRET_GONE = "A password was shown here. It is not shown again.";

export const KEY_CONSOLE_PANEL = 200;
export const KEY_CONSOLE_INPUT = 201;
/** Closes the console while it shows a secret. */
export const KEY_CONSOLE_DONE = 202;
export const KEY_CONSOLE_ROW = 210;
const PAD = 10;
const DONE_WIDTH = 170;

export class ConsoleState {
  open = false;
  input = "";
  /** Lines sent, oldest first. A line with a password is left out (maskSecret). */
  readonly history: string[] = [];
  /** Position in history while browsing it. -1 while typing a new line. */
  private at = -1;
  private draft = "";
  /** Unwrapped lines: echoes of what was typed, a password masked, text from the server, and a secret while it is shown. */
  readonly lines: string[] = [];
  /** Rows scrolled up from the newest. */
  scroll = 0;
  private seen = 0;
  private readonly rows: string[] = [];
  private rowsFor = "";
  /** The session's secret this console shows, "" for none, and its line in `lines`, -1 once scrolled away. */
  private shown = "";
  private shownAt = -1;

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
    if (this.lines.length > SCROLLBACK) {
      this.lines.shift();
      if (this.shownAt >= 0) this.shownAt--;
    }
    this.rowsFor = "";
  }

  absorb(session: ClientSession): void {
    this.showSecret(session);
    const fresh = session.logVersion - this.seen;
    if (fresh <= 0) return;
    this.seen = session.logVersion;
    const log = session.log;
    // Chat lines belong to the chat box, not the console.
    for (let i = Math.max(0, log.length - fresh); i < log.length; i++) if (log[i]!.channel <= TEXT_NOTICE) this.print(log[i]!.text);
  }

  /**
   * Shows the session's secret as a line of its own, opening the console for it. Once the console closes, a few words take
   * that line's place and the session's slot is emptied.
   */
  private showSecret(session: ClientSession): void {
    // A session made by hand in a test may have no slot at all.
    const secret = session.secret ?? "";
    if (this.shown !== "" && secret !== this.shown) this.forget();
    if (secret === "") return;
    if (this.shown === "") {
      this.print(SECRET_SHOWN + secret);
      this.shown = secret;
      this.shownAt = this.lines.length - 1;
      this.open = true;
      this.scroll = 0;
    } else if (!this.open) {
      this.forget();
      session.secret = "";
    }
  }

  private forget(): void {
    if (this.shownAt >= 0) this.lines[this.shownAt] = SECRET_GONE;
    this.shown = "";
    this.shownAt = -1;
    this.rows.length = 0;
    this.rowsFor = "";
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
    if (this.shown === "") return;
    // A finger has no Escape key to close the console that opened for it.
    const done = f.add(KEY_CONSOLE_DONE, K_BUTTON, f.width - f.right - PAD - DONE_WIDTH, PAD, DONE_WIDTH, 32, S_BUTTON);
    done.text = "Hide the password";
    done.interactive = true;
  }

  /** Rows a paging key scrolls, one fewer than are visible. */
  page(f: UiFrame): number {
    return Math.max(1, Math.floor((Math.round(f.height * 0.45) - lineHeight(S_INPUT) - 6 - PAD * 2) / lineHeight(S_CONSOLE_TEXT)) - 1);
  }
}
