// The server decides who reads a line.

import { maskSecret } from "../../../shared/console.ts";
import { runText, type TextRun } from "../../../shared/net/chat.ts";
import { MAX_CHAT_CHARS, TEXT_CONSOLE, TEXT_GLOBAL, TEXT_LOCAL, TEXT_MOTD, TEXT_NOTICE, TEXT_TRIBE } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { glass } from "./skin.ts";
import { lineHeight, wrapRuns, wrapText, K_BUTTON, K_INPUT, K_PANEL, type UiFrame } from "./nodes.ts";
import { S_CHAT, S_CHAT_LOCAL, S_CHAT_NOTICE, S_CHAT_PANEL, S_CHAT_TAG, S_CHAT_TRIBE, S_HUD_HIT, S_HUD_KEY, S_ICE, S_INPUT } from "./style.ts";

export const KEY_CHAT_PANEL = 13;
export const KEY_CHAT_INPUT = 14;
export const KEY_CHAT_TAG = 15;
/** By touch, beside the field: sends what was typed, as Enter does. */
export const KEY_CHAT_SEND = 5397;
export const KEY_CHAT_OPEN = 9100;
const KEY_RADIO_ICON = 9101;
const KEY_RADIO_LABEL = 9102;
const KEY_RADIO_EDGE = 9103;
const SEND_WIDTH = 64;
/** Per row shown, up to MAX_ROWS. */
export const KEY_CHAT_ROW = 16;

const MAX_ROWS = 8;
/** Rows shown while the box is shut. */
const SHUT_ROWS = 3;
const LINES = 100;
const WIDTH = 380;
const MARGIN = 12;
const TAG_WIDTH = 62;
/** Ticks a line stays up with the box shut, and the ticks at the end of that over which it fades. */
const SHOW_TICKS = 12 * 30;
const FADE_TICKS = 2 * 30;
/** What `/help` says, each line held this long, and the ticks after a slash command over which the console's answer shows here. */
const HELP: readonly string[] = [
  "Enter opens chat; Tab in the box changes channel (Global, Local, Tribe).",
  "A line that begins with / is a command: /who, /pos, /time, /help give. The ` key opens the console.",
  "V changes the view, O opens Settings, I the inventory, M the corner map (Shift+M the whole map), F3 diagnostics.",
  "F2 or , opens the field menus and F4 or ; the actions: arrows browse, Enter chooses, Escape goes back.",
  "Hold N (or the middle button) to raise the helmet's visor: the wheel zooms it, a tap of N changes its view (plain, night, heat).",
];
const HELP_TICKS = 20 * 30;
const ANSWER_TICKS = 4 * 30;

const CHANNELS: readonly number[] = [TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE];
const TAG: Record<number, string> = { [TEXT_GLOBAL]: "Global", [TEXT_LOCAL]: "Local", [TEXT_TRIBE]: "Tribe" };
const ROW_STYLE: Record<number, number> = { [TEXT_NOTICE]: S_CHAT_NOTICE, [TEXT_MOTD]: S_CHAT_NOTICE, [TEXT_GLOBAL]: S_CHAT, [TEXT_LOCAL]: S_CHAT_LOCAL, [TEXT_TRIBE]: S_CHAT_TRIBE };
/** A line's prefix, so that colour is not the only sign of its channel. */
const PREFIX: Record<number, string> = { [TEXT_NOTICE]: "", [TEXT_MOTD]: "", [TEXT_GLOBAL]: "", [TEXT_LOCAL]: "[Local] ", [TEXT_TRIBE]: "[Tribe] " };

const canRemember = (line: string): boolean => !line.trimStart().startsWith("/") || maskSecret(line) === null;

interface Row {
  text: string;
  /** A chat line's row in runs, the channel's prefix the first; null for a plain line's. */
  runs: readonly TextRun[] | null;
  channel: number;
  at: number;
  /** Ticks it stays up with the box shut. */
  hold: number;
}

const fadeOf = (row: Row, now: number): number =>
  Math.max(0, Math.min(1, (row.at + row.hold - now) / Math.max(1, Math.min(FADE_TICKS, row.hold))));

export class ChatState {
  open = false;
  channel = TEXT_GLOBAL;
  input = "";
  /** Oldest first. `at` is the tick a line arrived. */
  readonly lines: { channel: number; text: string; runs?: readonly TextRun[]; at: number; hold: number }[] = [];
  private readonly drafts = new Map<number, string>();
  private readonly sent = new Map<number, string[]>();
  private recalled = -1;
  private scratch = "";
  private readonly live: number[] = [];
  private seen = 0;
  private readonly rows: Row[] = [];
  private readonly welcomeRows: number[] = [];
  private rowsFor = "";
  private version = 0;
  /** The tick until which the console's lines show here: the answer to a slash command. */
  private answers = 0;

  private usable(channel: number, session: ClientSession | null): boolean {
    if (!session) return true;
    return channel === TEXT_GLOBAL ? session.globalChat : channel === TEXT_TRIBE ? session.tribe.name !== "" : true;
  }

  /** On a server with no global chat, the global key opens the local channel. */
  begin(channel: number, session: ClientSession | null): void {
    this.open = true;
    this.channel = this.usable(channel, session) ? channel : TEXT_LOCAL;
    this.input = this.drafts.get(this.channel) || "";
    this.recalled = -1;
  }

  /** Moves to the next channel this session can speak on. */
  cycle(session: ClientSession | null): void {
    this.rememberDraft();
    let at = CHANNELS.indexOf(this.channel);
    for (let n = 0; n < CHANNELS.length; n++) {
      at = (at + 1) % CHANNELS.length;
      if (this.usable(CHANNELS[at]!, session)) break;
    }
    this.channel = CHANNELS[at]!;
    this.input = this.drafts.get(this.channel) || "";
    this.recalled = -1;
  }

  edit(value: string): void {
    this.input = value.length > MAX_CHAT_CHARS ? value.slice(0, MAX_CHAT_CHARS) : value;
  }

  recall(by: number): void {
    const history = this.sent.get(this.channel);
    if (!history?.length) return;
    if (this.recalled < 0) {
      this.scratch = canRemember(this.input) ? this.input : "";
      this.recalled = history.length;
    }
    this.recalled = Math.max(0, Math.min(history.length, this.recalled + by));
    this.input = history[this.recalled] ?? this.scratch;
  }

  /** A command this client answers itself, as the console's (Ui.local): what to show, or null to pass the line on. */
  local: ((line: string) => string | null) | null = null;

  submit(session: ClientSession | null): void {
    const line = this.input.trim();
    this.input = "";
    this.open = false;
    this.drafts.delete(this.channel);
    this.scratch = "";
    if (line === "") return;
    if (canRemember(line)) {
      const history = this.sent.get(this.channel) ?? [];
      if (history[history.length - 1] !== line) history.push(line);
      if (history.length > 32) history.shift();
      this.sent.set(this.channel, history);
    }
    if (line.startsWith("/")) return this.command(line.slice(1).trim(), session);
    if (!session || (session.chat(this.channel, line) === 0 && session.state !== "active")) this.print(TEXT_NOTICE, "Not connected; nothing was said.", session ? session.serverTick : 0);
  }

  /**
   * A line that began with a slash, without it: `help` alone says what the keys and commands are; anything else is the
   * console's line of that name (so `/help give` is the server's own), and its answer shows here for a few seconds.
   */
  private command(line: string, session: ClientSession | null): void {
    const at = session ? session.serverTick : 0;
    const answer = line === "" || line === "help" ? null : (this.local?.(line) ?? null);
    if (line === "" || line === "help") {
      for (const text of HELP) this.print(TEXT_NOTICE, text, at, HELP_TICKS);
    } else if (answer !== null) this.print(TEXT_NOTICE, answer, at);
    else if (!session || (session.text(line) === 0 && session.state !== "active")) {
      this.print(TEXT_NOTICE, "Not connected; nothing was done.", at);
    } else this.answers = at + ANSWER_TICKS;
  }

  private rememberDraft(): void {
    if (canRemember(this.input)) this.drafts.set(this.channel, this.input);
    else this.drafts.delete(this.channel);
    this.scratch = "";
  }

  close(): void {
    if (this.open) this.rememberDraft();
    this.open = false;
    this.input = "";
  }

  /** `runs` are a chat line's (S_CHAT), whose text joined is `text`. */
  print(channel: number, text: string, at: number, hold = SHOW_TICKS, runs?: readonly TextRun[]): void {
    this.lines.push({ channel, text, runs, at, hold: Math.max(channel === TEXT_MOTD ? 0 : FADE_TICKS, hold) });
    if (this.lines.length > LINES) {
      const oldest = this.lines.findIndex(line => line.channel !== TEXT_MOTD || at - line.at >= line.hold);
      this.lines.splice(Math.max(0, oldest), 1);
    }
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
      else if (l.channel >= TEXT_NOTICE && l.channel <= TEXT_TRIBE) this.print(l.channel, l.text, session.serverTick, SHOW_TICKS, l.runs);
      else if (l.channel === TEXT_CONSOLE && session.serverTick < this.answers) for (const text of l.text.split("\n")) this.print(TEXT_NOTICE, text, session.serverTick);
    }
  }

  /**
   * The message of the day waits while the survivor has no body to play, in the creator or choosing where to rise: its
   * time starts when it is in the world.
   */
  wait(now: number): void {
    for (const line of this.lines) if (line.channel === TEXT_MOTD && line.at !== now) { line.at = now; this.version++; }
  }

  /**
   * The log, and the box while it is open, between `top` and `bottom`. With `touch` the field and its buttons are a
   * finger's size and a Send button stands beside the field.
   */
  build(f: UiFrame, top: number, bottom: number, now: number, touch = false, controls = true): void {
    const x0 = f.left + MARGIN;
    const w = Math.min(touch || this.open ? WIDTH : Math.max(180, Math.min(285, f.width * .22)), f.width - f.left - f.right - MARGIN * 2);
    const lh = lineHeight(S_CHAT);
    const inputH = touch && this.open ? 44 : lineHeight(S_INPUT) + 6;
    const sig = `${w}:${this.version}`;
    if (sig !== this.rowsFor) {
      this.rowsFor = sig;
      this.rows.length = 0;
      this.welcomeRows.length = 0;
      const parts: string[] = [];
      const runRows: TextRun[][] = [];
      for (const line of this.lines) {
        const prefix = PREFIX[line.channel] ?? "";
        const first = this.rows.length;
        if (line.runs) {
          runRows.length = 0;
          wrapRuns(prefix === "" ? line.runs : [{ text: prefix }, ...line.runs], w - 8, S_CHAT, runRows);
          for (const runs of runRows) this.rows.push({ text: runText(runs), runs, channel: line.channel, at: line.at, hold: line.hold });
        } else {
          parts.length = 0;
          wrapText(prefix + line.text, w - 8, S_CHAT, parts);
          for (const text of parts) this.rows.push({ text, runs: null, channel: line.channel, at: line.at, hold: line.hold });
        }
        if (line.channel === TEXT_MOTD) for (let i = first; i < this.rows.length; i++) this.welcomeRows.push(i);
      }
    }
    const room = Math.min(MAX_ROWS, Math.max(1, Math.floor((bottom - top - inputH - 4) / lh)));
    const rowsBottom = bottom - (this.open ? inputH + 4 : 0);
    const live = this.live;
    live.length = 0;
    let welcome = 0;
    // The server's welcome keeps its room while the closed radio shows recent chat beside it.
    if (!this.open) for (const index of this.welcomeRows) {
      const alpha = fadeOf(this.rows[index]!, now);
      if (alpha === 0) continue;
      live.push(index);
      welcome = Math.max(welcome, alpha);
      if (live.length === room) break;
    }
    const most = this.open ? room : Math.min(room, live.length + SHUT_ROWS);
    for (let i = this.rows.length - 1; i >= 0 && live.length < most; i--) {
      const row = this.rows[i]!;
      if (this.open || (row.channel !== TEXT_MOTD && ((!touch && CHANNELS.includes(row.channel)) || now - row.at < row.hold))) live.push(i);
    }
    if (welcome > 0) live.sort((a, b) => a - b);
    else live.reverse();
    const shown = live.length;
    if (this.open) {
      const h = most * lh + inputH + 12;
      f.add(KEY_CHAT_PANEL, K_PANEL, x0 - 4, bottom - h + 4, w + 8, h, S_CHAT_PANEL);
    }
    let y = rowsBottom - shown * lh;
    // A welcome gets a backdrop that fades with it. Touch leaves the stick visible behind the closed radio.
    const headerY = y - (controls ? 21 : 0);
    if (!touch && welcome > 0)
      f.add(KEY_CHAT_PANEL, K_PANEL, x0 - 4, headerY - 4, w + 8, rowsBottom - headerY + 8, S_CHAT_PANEL).alpha = welcome;
    if (!this.open && !touch && controls) {
      if (welcome === 0) glass(f, KEY_RADIO_EDGE + 1, x0 - 4, headerY - 2, w + 4, shown * lh + 25, shown ? .57 : .27);
      f.add(KEY_RADIO_EDGE, K_PANEL, x0 - 4, headerY, 1, shown * lh + 19, S_ICE).alpha = .55;
      const radio = f.add(KEY_CHAT_OPEN, K_BUTTON, x0 - 3, headerY - 2, 100, 23, S_HUD_HIT);
      radio.label = "Open radio chat"; radio.interactive = true;
      f.picture(KEY_RADIO_ICON, x0 + 1, headerY, 17, 17, S_CHAT, "ui:glass-radio");
      f.text(KEY_RADIO_LABEL, x0 + 21, headerY + 2, 110, S_HUD_KEY, (TAG[this.channel] ?? "Radio") + "   ↵");
    }
    for (let k = 0; k < shown; k++) {
      const row = this.rows[live[k]!]!;
      const n = f.text(KEY_CHAT_ROW + k, x0, y, w - 8, ROW_STYLE[row.channel] ?? S_CHAT, row.text);
      n.runs = row.runs;
      if (!this.open) {
        const fade = fadeOf(row, now);
        n.alpha = !touch && CHANNELS.includes(row.channel) ? .65 + .35 * fade : fade;
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
