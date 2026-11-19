// The server decides who reads a line.

import { MAX_CHAT_CHARS, TEXT_GLOBAL, TEXT_LOCAL, TEXT_MOTD, TEXT_NOTICE, TEXT_TRIBE } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { lineHeight, wrapText, K_BUTTON, K_INPUT, K_PANEL, type UiFrame } from "./nodes.ts";
import { S_CHAT, S_CHAT_LOCAL, S_CHAT_NOTICE, S_CHAT_PANEL, S_CHAT_TAG, S_CHAT_TRIBE, S_INPUT } from "./style.ts";

export const KEY_CHAT_PANEL = 13;
export const KEY_CHAT_INPUT = 14;
export const KEY_CHAT_TAG = 15;
/** By touch, beside the field: sends what was typed, as Enter does. */
export const KEY_CHAT_SEND = 5397;
const SEND_WIDTH = 64;
/** Per row shown, up to MAX_ROWS. */
export const KEY_CHAT_ROW = 16;

const MAX_ROWS = 8;
/** Rows shown while the box is shut. */
const SHUT_ROWS = 6;
const LINES = 100;
const WIDTH = 380;
const MARGIN = 12;
const TAG_WIDTH = 62;
/** Ticks a line stays up with the box shut, and the ticks at the end of that over which it fades. */
const SHOW_TICKS = 12 * 30;
const FADE_TICKS = 2 * 30;

const CHANNELS: readonly number[] = [TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE];
const TAG: Record<number, string> = { [TEXT_GLOBAL]: "Global", [TEXT_LOCAL]: "Local", [TEXT_TRIBE]: "Tribe" };
const ROW_STYLE: Record<number, number> = { [TEXT_NOTICE]: S_CHAT_NOTICE, [TEXT_MOTD]: S_CHAT_NOTICE, [TEXT_GLOBAL]: S_CHAT, [TEXT_LOCAL]: S_CHAT_LOCAL, [TEXT_TRIBE]: S_CHAT_TRIBE };
/** A line's prefix, so that colour is not the only sign of its channel. */
const PREFIX: Record<number, string> = { [TEXT_NOTICE]: "", [TEXT_MOTD]: "", [TEXT_GLOBAL]: "", [TEXT_LOCAL]: "[Local] ", [TEXT_TRIBE]: "[Tribe] " };

interface Row {
  text: string;
  channel: number;
  at: number;
  /** Ticks it stays up with the box shut. */
  hold: number;
}

export class ChatState {
  open = false;
  channel = TEXT_GLOBAL;
  input = "";
  /** Oldest first. `at` is the tick a line arrived. */
  readonly lines: { channel: number; text: string; at: number; hold: number }[] = [];
  private readonly live: number[] = [];
  private seen = 0;
  private readonly rows: Row[] = [];
  private rowsFor = "";
  private version = 0;

  private usable(channel: number, session: ClientSession | null): boolean {
    if (!session) return true;
    return channel === TEXT_GLOBAL ? session.globalChat : channel === TEXT_TRIBE ? session.tribe.name !== "" : true;
  }

  /** On a server with no global chat, the global key opens the local channel. */
  begin(channel: number, session: ClientSession | null): void {
    this.open = true;
    this.input = "";
    this.channel = channel === TEXT_GLOBAL && !this.usable(channel, session) ? TEXT_LOCAL : channel;
  }

  /** Moves to the next channel this session can speak on. */
  cycle(session: ClientSession | null): void {
    let at = CHANNELS.indexOf(this.channel);
    for (let n = 0; n < CHANNELS.length; n++) {
      at = (at + 1) % CHANNELS.length;
      if (this.usable(CHANNELS[at]!, session)) break;
    }
    this.channel = CHANNELS[at]!;
  }

  edit(value: string): void {
    this.input = value.length > MAX_CHAT_CHARS ? value.slice(0, MAX_CHAT_CHARS) : value;
  }

  submit(session: ClientSession | null): void {
    const line = this.input.trim();
    this.input = "";
    this.open = false;
    if (line === "") return;
    if (!session || (session.chat(this.channel, line) === 0 && session.state !== "active")) this.print(TEXT_NOTICE, "Not connected; nothing was said.", session ? session.serverTick : 0);
  }

  close(): void {
    this.open = false;
    this.input = "";
  }

  print(channel: number, text: string, at: number, hold = SHOW_TICKS): void {
    this.lines.push({ channel, text, at, hold: hold > FADE_TICKS ? hold : FADE_TICKS });
    if (this.lines.length > LINES) this.lines.shift();
    this.version++;
  }

  /** Takes in the session log since the last call. Console output is not chat and is left out. */
  absorb(session: ClientSession): void {
    const fresh = session.logVersion - this.seen;
    if (fresh <= 0) return;
    this.seen = session.logVersion;
    const log = session.log;
    for (let i = Math.max(0, log.length - fresh); i < log.length; i++) {
      const l = log[i]!;
      // The message of the day stays up for the server's motdSeconds.
      if (l.channel === TEXT_MOTD) this.print(l.channel, l.text, session.serverTick, session.motdSeconds * 30);
      else if (l.channel >= TEXT_NOTICE && l.channel <= TEXT_TRIBE) this.print(l.channel, l.text, session.serverTick);
    }
  }

  /** Lays the box out between `top` and `bottom`, newest line lowest. Shut, it shows only recent lines, which fade. */
  /**
   * The log, and the box while it is open, between `top` and `bottom`. With `touch` the field and its buttons are a
   * finger's size and a Send button stands beside the field.
   */
  build(f: UiFrame, top: number, bottom: number, now: number, touch = false): void {
    const x0 = f.left + MARGIN;
    const w = Math.min(WIDTH, f.width - f.left - f.right - MARGIN * 2);
    const lh = lineHeight(S_CHAT);
    const inputH = touch && this.open ? 44 : lineHeight(S_INPUT) + 6;
    const sig = `${w}:${this.version}`;
    if (sig !== this.rowsFor) {
      this.rowsFor = sig;
      this.rows.length = 0;
      const parts: string[] = [];
      for (const line of this.lines) {
        parts.length = 0;
        wrapText((PREFIX[line.channel] ?? "") + line.text, w - 8, S_CHAT, parts);
        for (const text of parts) this.rows.push({ text, channel: line.channel, at: line.at, hold: line.hold });
      }
    }
    const room = Math.max(1, Math.floor((bottom - top - inputH - 4) / lh));
    const most = Math.min(this.open ? MAX_ROWS : SHUT_ROWS, room);
    const rowsBottom = bottom - inputH - 4;
    // Shut, a row shows until its hold runs out. Open, every row may show. The newest `most` are taken, in arrival order.
    const live = this.live;
    live.length = 0;
    for (let i = this.rows.length - 1; i >= 0 && live.length < most; i--) if (this.open || now - this.rows[i]!.at < this.rows[i]!.hold) live.push(i);
    live.reverse();
    const shown = live.length;
    if (this.open) {
      const h = most * lh + inputH + 12;
      f.add(KEY_CHAT_PANEL, K_PANEL, x0 - 4, bottom - h + 4, w + 8, h, S_CHAT_PANEL);
    }
    let y = rowsBottom - shown * lh;
    for (let k = 0; k < shown; k++) {
      const row = this.rows[live[k]!]!;
      const n = f.text(KEY_CHAT_ROW + k, x0, y, w - 8, ROW_STYLE[row.channel] ?? S_CHAT, row.text);
      if (!this.open) {
        const left = row.hold - (now - row.at);
        n.alpha = left >= FADE_TICKS ? 1 : Math.max(0, left / FADE_TICKS);
      }
      y += lh;
    }
    if (!this.open) return;
    // A click on the channel tag changes channel, as Tab does.
    const tag = f.add(KEY_CHAT_TAG, K_BUTTON, x0, bottom - inputH, TAG_WIDTH, inputH, S_CHAT_TAG);
    tag.text = TAG[this.channel] ?? "";
    tag.label = "Change channel";
    tag.interactive = true;
    const send = touch ? SEND_WIDTH + 4 : 0;
    const field = f.add(KEY_CHAT_INPUT, K_INPUT, x0 + TAG_WIDTH + 4, bottom - inputH, w - TAG_WIDTH - 4 - send, inputH, S_INPUT);
    field.text = this.input;
    field.interactive = true;
    field.focus = true;
    if (touch) {
      const b = f.add(KEY_CHAT_SEND, K_BUTTON, x0 + w - SEND_WIDTH, bottom - inputH, SEND_WIDTH, inputH, S_CHAT_TAG);
      b.text = "Send"; b.label = "Send"; b.interactive = true;
    }
  }
}
