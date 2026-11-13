// The chat box: what has been said lately, bottom left, and a line to say
// something on. Enter opens it to everyone, Insert to those near, the slash key
// to the tribe; Tab changes channel while it is open, Enter says the line and
// shuts it, Escape shuts it. Who reads a line is the server's decision.

import { MAX_CHAT_CHARS, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { columns, lineHeight, wrap, K_BUTTON, K_INPUT, K_PANEL, type UiFrame } from "./nodes.ts";
import { S_CHAT, S_CHAT_LOCAL, S_CHAT_NOTICE, S_CHAT_PANEL, S_CHAT_TAG, S_CHAT_TRIBE, S_INPUT } from "./style.ts";

export const KEY_CHAT_PANEL = 13;
export const KEY_CHAT_INPUT = 14;
export const KEY_CHAT_TAG = 15;
/** Per row shown, up to MAX_ROWS. */
export const KEY_CHAT_ROW = 16;

const MAX_ROWS = 8;
/** Rows shown while the box is shut: only what was said lately. */
const SHUT_ROWS = 6;
const LINES = 100;
const WIDTH = 380;
const MARGIN = 12;
const TAG_WIDTH = 62;
/** Ticks a line stays up with the box shut, and how many of the last of them it fades over. */
const SHOW_TICKS = 12 * 30;
const FADE_TICKS = 2 * 30;

const CHANNELS: readonly number[] = [TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE];
const TAG: Record<number, string> = { [TEXT_GLOBAL]: "Global", [TEXT_LOCAL]: "Local", [TEXT_TRIBE]: "Tribe" };
const ROW_STYLE: Record<number, number> = { [TEXT_NOTICE]: S_CHAT_NOTICE, [TEXT_GLOBAL]: S_CHAT, [TEXT_LOCAL]: S_CHAT_LOCAL, [TEXT_TRIBE]: S_CHAT_TRIBE };
/** What a line begins with, so that its channel is told by more than its colour. */
const PREFIX: Record<number, string> = { [TEXT_NOTICE]: "", [TEXT_GLOBAL]: "", [TEXT_LOCAL]: "[Local] ", [TEXT_TRIBE]: "[Tribe] " };

interface Row {
  text: string;
  channel: number;
  at: number;
}

export class ChatState {
  open = false;
  /** The channel the line being typed will go out on. */
  channel = TEXT_GLOBAL;
  input = "";
  /** What has been said and what the server has told this client, oldest first: the channel, the text, and the tick it arrived. */
  readonly lines: { channel: number; text: string; at: number }[] = [];
  private seen = 0;
  private readonly rows: Row[] = [];
  private rowsFor = "";
  private version = 0;

  /** Whether `channel` can be spoken on by this session now. */
  private usable(channel: number, session: ClientSession | null): boolean {
    if (!session) return true;
    return channel === TEXT_GLOBAL ? session.globalChat : channel === TEXT_TRIBE ? session.tribe.name !== "" : true;
  }

  /** Open the box on a channel; on a server with no global channel, that key speaks to those near. */
  begin(channel: number, session: ClientSession | null): void {
    this.open = true;
    this.input = "";
    this.channel = channel === TEXT_GLOBAL && !this.usable(channel, session) ? TEXT_LOCAL : channel;
  }

  /** The next channel this session can speak on. */
  cycle(session: ClientSession | null): void {
    let at = CHANNELS.indexOf(this.channel);
    for (let n = 0; n < CHANNELS.length; n++) {
      at = (at + 1) % CHANNELS.length;
      if (this.usable(CHANNELS[at]!, session)) break;
    }
    this.channel = CHANNELS[at]!;
  }

  /** The text field changed. */
  edit(value: string): void {
    this.input = value.length > MAX_CHAT_CHARS ? value.slice(0, MAX_CHAT_CHARS) : value;
  }

  /** Say the line, if there is one, and shut the box. */
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

  print(channel: number, text: string, at: number): void {
    this.lines.push({ channel, text, at });
    if (this.lines.length > LINES) this.lines.shift();
    this.version++;
  }

  /** Take in what has been said, and what the server has told this client, since the last call. Console output is not chat. */
  absorb(session: ClientSession): void {
    const fresh = session.logVersion - this.seen;
    if (fresh <= 0) return;
    this.seen = session.logVersion;
    const log = session.log;
    for (let i = Math.max(0, log.length - fresh); i < log.length; i++) {
      const l = log[i]!;
      if (l.channel >= TEXT_NOTICE && l.channel <= TEXT_TRIBE) this.print(l.channel, l.text, session.serverTick);
    }
  }

  /**
   * Lay the box out between `top` and `bottom` at the left of the canvas, the
   * newest line lowest. Shut, it is only the lines said lately, fading; open,
   * it has a backdrop, more lines, and the field with its channel beside it.
   */
  build(f: UiFrame, top: number, bottom: number, now: number): void {
    const w = Math.min(WIDTH, f.width - MARGIN * 2);
    const lh = lineHeight(S_CHAT);
    const inputH = lineHeight(S_INPUT) + 6;
    const cols = columns(w - 8, S_CHAT);
    const sig = `${cols}:${this.version}`;
    if (sig !== this.rowsFor) {
      this.rowsFor = sig;
      this.rows.length = 0;
      const parts: string[] = [];
      for (const line of this.lines) {
        parts.length = 0;
        wrap((PREFIX[line.channel] ?? "") + line.text, cols, parts);
        for (const text of parts) this.rows.push({ text, channel: line.channel, at: line.at });
      }
    }
    const room = Math.max(1, Math.floor((bottom - top - inputH - 4) / lh));
    const most = Math.min(this.open ? MAX_ROWS : SHUT_ROWS, room);
    const rowsBottom = bottom - inputH - 4;
    // Shut, a line is shown for a while after it arrives; open, whatever fits.
    let first = this.rows.length;
    while (first > 0 && this.rows.length - first < most && (this.open || now - this.rows[first - 1]!.at < SHOW_TICKS)) first--;
    const shown = this.rows.length - first;
    if (this.open) {
      const h = most * lh + inputH + 12;
      f.add(KEY_CHAT_PANEL, K_PANEL, MARGIN - 4, bottom - h + 4, w + 8, h, S_CHAT_PANEL);
    }
    let y = rowsBottom - shown * lh;
    for (let i = first; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const n = f.text(KEY_CHAT_ROW + (i - first), MARGIN, y, w - 8, ROW_STYLE[row.channel] ?? S_CHAT, row.text);
      if (!this.open) {
        const left = SHOW_TICKS - (now - row.at);
        n.alpha = left >= FADE_TICKS ? 1 : Math.max(0, left / FADE_TICKS);
      }
      y += lh;
    }
    if (!this.open) return;
    // The channel, which a click changes as Tab does; and the field.
    const tag = f.add(KEY_CHAT_TAG, K_BUTTON, MARGIN, bottom - inputH, TAG_WIDTH, inputH, S_CHAT_TAG);
    tag.text = TAG[this.channel] ?? "";
    tag.interactive = true;
    const field = f.add(KEY_CHAT_INPUT, K_INPUT, MARGIN + TAG_WIDTH + 4, bottom - inputH, w - TAG_WIDTH - 4, inputH, S_INPUT);
    field.text = this.input;
    field.interactive = true;
    field.focus = true;
  }
}
