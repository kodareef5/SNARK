// The Creative screen, opened from the game's menu while the server shows creative mode (RULE_CREATIVE). An admin finds a
// tab for each tool; anyone else finds the admin password asked, which is sent as `enablecheats` and counted as it counts
// wrong guesses. A tool is one admin action the server checks, and the client keeps no creative state of its own.

import { CHEAT_GUESSES, WRONG_PASSWORD } from "../../../shared/console.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { TEXT_CONSOLE } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, K_SECRET, fitText, wrapText, type UiFrame } from "./nodes.ts";
import { KEY_MENU_BACK, menuBackdrop, smallButton } from "./menu.ts";
import { glass } from "./skin.ts";
import { S_HUD_HIT, S_ICE, S_INPUT, S_MENU_HEADING, S_MENU_NOTE, S_MENU_WARN } from "./style.ts";
import { Sundial } from "./sundial.ts";

export const KEY_CREATIVE_PANEL = 7000;
const KEY_CREATIVE_TITLE = 7001;
/** A tab for each tool: +n the nth. */
export const KEY_CREATIVE_TAB = 7010;
export const KEY_CREATIVE_PASSWORD = 7050;
export const KEY_CREATIVE_UNLOCK = 7051;
const KEY_CREATIVE_LINE = 7060;
/** The server's answer to the password, and how many wrong ones are left. */
export const KEY_CREATIVE_ANSWER = 7080;
export const KEY_CREATIVE_WARNING = 7081;

/** One tool of the screen: its tab, and what it draws in the area under the tabs and does with what it is sent. */
export interface CreativeTool {
  readonly name: string;
  /** The node focused as the tool opens. */
  readonly first: number;
  build(f: UiFrame, x: number, y: number, w: number, h: number, session: ClientSession, hour: number, focus: number): void;
  /** `kind` 0 for a press, 1 for a release, 2 for a move. True if the event was the tool's. */
  pointer(kind: number, key: number, x: number, y: number, session: ClientSession): boolean;
  /** Arrow keys and the pad's left and right on the focused node; `coarse` with Shift. True if the tool used them. */
  adjust(key: number, by: number, coarse: boolean): boolean;
  /** Each frame, open or not, so that a tool can finish what it sends. */
  pump(session: ClientSession, open: boolean): void;
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five"];

export class CreativeScreen {
  readonly sundial = new Sundial();
  /** In the order of their tabs. A new tool is one more entry. */
  readonly tools: readonly CreativeTool[] = [this.sundial];
  tab = 0;
  password = "";
  /** Wrong passwords this connection has given, from the server's answers: the server ends it at CHEAT_GUESSES. */
  wrong = 0;
  /** The server's answer to the password last sent from here, or "". */
  answer = "";
  /** The log's length when a password was sent and its answer not yet come, or -1. */
  private asked = -1;
  private askedAt = 0;
  private seen = 0;
  private session: ClientSession | null = null;

  get tool(): CreativeTool {
    return this.tools[this.tab] ?? this.tools[0]!;
  }

  /** The node to focus on opening: the tool's for an admin, the password's for anyone else. */
  first(session: ClientSession | null): number {
    return session?.admin ? this.tool.first : KEY_CREATIVE_PASSWORD;
  }

  /** Reads the server's answers since the last frame, counting wrong passwords whether they were sent from here or the console. */
  absorb(session: ClientSession): void {
    if (session !== this.session) {
      this.session = session;
      this.seen = this.asked = -1;
      this.wrong = 0;
      this.answer = "";
    }
    const log = session.log, fresh = Math.min(log.length, session.logVersion - Math.max(0, this.seen));
    for (let i = log.length - fresh; i < log.length; i++) {
      const line = log[i]!;
      if (line.channel !== TEXT_CONSOLE) continue;
      if (line.text === WRONG_PASSWORD) this.wrong++;
      if (this.asked >= 0) {
        this.answer = line.text;
        this.asked = -1;
      }
    }
    this.seen = session.logVersion;
    // An answer that never comes, as when the server was too busy for the line, frees the button again.
    if (this.asked >= 0 && session.serverTick - this.askedAt > 2 * TICK_RATE) this.asked = -1;
  }

  edit(value: string): void {
    this.password = value.slice(0, 64);
  }

  /** Sends the password as `enablecheats` would be typed, so the server judges and counts it as it does that command. */
  submit(session: ClientSession): void {
    this.absorb(session);
    if (this.password === "" || this.asked >= 0 || session.admin) return;
    if (session.text(`enablecheats "${this.password.replaceAll('"', "")}"`) === 0) return;
    this.password = "";
    this.answer = "";
    this.asked = session.logVersion;
    this.askedAt = session.serverTick;
  }

  pointer(kind: number, key: number, x: number, y: number, session: ClientSession): boolean {
    if (kind === 0 && key >= KEY_CREATIVE_TAB && key < KEY_CREATIVE_TAB + this.tools.length) {
      this.tab = key - KEY_CREATIVE_TAB;
      return true;
    }
    if (kind === 0 && key === KEY_CREATIVE_UNLOCK) {
      this.submit(session);
      return true;
    }
    return session.admin && this.tool.pointer(kind, key, x, y, session);
  }

  adjust(key: number, by: number, coarse: boolean): boolean {
    return !!this.session?.admin && this.tool.adjust(key, by, coarse);
  }

  pump(session: ClientSession, open: boolean): void {
    this.absorb(session);
    for (const t of this.tools) t.pump(session, open && t === this.tool && session.admin);
  }

  /** A left-hand glass field, as the menu is, so the world and its sky stay in view beside it. `hour` is the hour the sky shows. */
  build(f: UiFrame, session: ClientSession, hour: number, focus: number): void {
    menuBackdrop(f, 0.45);
    const x = Math.round(Math.max(24, f.width * 0.065)), w = Math.min(440, f.width - x * 2), y = 40, h = f.height - 80;
    f.add(KEY_CREATIVE_PANEL, K_PANEL, x, y, w, h, S_HUD_HIT);
    glass(f, KEY_CREATIVE_PANEL, x, y, w, h);
    f.text(KEY_CREATIVE_TITLE, x + 24, y + 20, w - 120, S_MENU_HEADING, "Creative");
    smallButton(f, KEY_MENU_BACK, x + w - 80, y + 16, 56, 36, "Back", "Back", focus === KEY_MENU_BACK);
    const inner = w - 48, tabW = Math.min(132, inner / this.tools.length);
    this.tools.forEach((t, i) => smallButton(f, KEY_CREATIVE_TAB + i, x + 24 + i * tabW, y + 64, tabW - 8, 34, t.name, t.name, i === this.tab));
    f.add(KEY_CREATIVE_LINE + 15, K_PANEL, x + 24, y + 104, inner, 1, S_ICE).alpha = 0.18;
    const top = y + 120, room = y + h - 18 - top;
    if (session.admin) this.tool.build(f, x + 24, top, inner, room, session, hour, focus);
    else this.gate(f, x + 24, top, inner, focus);
  }

  /** What anyone without the admin role is shown: why, the password, and how many wrong guesses are left before the server ends the connection. */
  private gate(f: UiFrame, x: number, y: number, w: number, focus: number): void {
    const lines: string[] = [];
    wrapText("These tools change the world for everyone here, so they are the server's admins'. Its admin password opens them for as long as you stay.", w, S_MENU_NOTE, lines);
    lines.forEach((line, i) => f.text(KEY_CREATIVE_LINE + i, x, y + i * 18, w, S_MENU_NOTE, line));
    const fy = y + lines.length * 18 + 18;
    const field = f.add(KEY_CREATIVE_PASSWORD, K_SECRET, x, fy, w - 112, 36, S_INPUT);
    field.text = this.password;
    field.label = "Admin password";
    field.interactive = true;
    const ready = this.password !== "" && this.asked < 0;
    const unlock = f.add(KEY_CREATIVE_UNLOCK, K_BUTTON, x + w - 100, fy, 100, 36, S_HUD_HIT);
    unlock.text = unlock.label = "Unlock";
    unlock.interactive = ready;
    unlock.alpha = ready ? 1 : 0.45;
    f.add(90000 + KEY_CREATIVE_UNLOCK, K_PANEL, x + w - 92, fy + 35, 84, 1, S_ICE).alpha = focus === KEY_CREATIVE_UNLOCK ? 0.9 : 0.3;
    const left = CHEAT_GUESSES - this.wrong;
    let ay = fy + 52;
    if (this.answer !== "") {
      f.text(KEY_CREATIVE_ANSWER, x, ay, w, this.answer === WRONG_PASSWORD ? S_MENU_WARN : S_MENU_NOTE, fitText(`${this.answer[0]!.toUpperCase()}${this.answer.slice(1)}.`, w, S_MENU_NOTE)).alpha = 0.95;
      ay += 22;
    }
    // Said before the last guess, not after it: the server puts out a connection on its third wrong password.
    const warn = left <= 1;
    const say = this.wrong === 0 ? `${WORDS[CHEAT_GUESSES] ?? CHEAT_GUESSES} wrong passwords end the connection.` : left === 1 ? "One more wrong password ends the connection." : `${WORDS[left] ?? left} more wrong passwords end the connection.`;
    const n = f.text(KEY_CREATIVE_WARNING, x, ay, w, warn ? S_MENU_WARN : S_MENU_NOTE, fitText(say, w, S_MENU_NOTE));
    n.alpha = warn ? 1 : 0.7;
  }
}
