// The template hammer's own panel. In play it is a strip at the screen's side: what the hammer would do, the report on
// the template being set down, and a button for each action, which a finger presses and which names its key. With the
// list of templates open the pointer is free: each template has its row, with what it costs, and the text of one may
// be given out or taken in.

import type { Registry } from "../../../shared/content/registry.ts";
import { planCost, pieceBook, placePieces } from "../../../shared/world/plan.ts";
import type { Hammer } from "../hammer.ts";
import type { ClientSession } from "../session.ts";
import { SESSION_CREATING, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { K_BUTTON, K_INPUT, K_PANEL, lineHeight, wrapText, type UiFrame } from "./nodes.ts";
import { structName } from "./structure.ts";
import { S_BUTTON, S_INPUT, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_HAMMER_PANEL = 8200;
export const KEY_HAMMER_TITLE = 8201;
export const KEY_HAMMER_NOTICE = 8202;
/** The report's lines, and the strip's buttons in ACTIONS order. */
export const KEY_HAMMER_LINE = 8210;
export const KEY_HAMMER_BUTTON = 8230;
/** The list: a row's title, its cost, and its buttons to set down, give out and delete. */
export const KEY_HAMMER_LIST = 8250;
export const KEY_HAMMER_ROW = 8260;
export const KEY_HAMMER_COST = 8300;
export const KEY_HAMMER_PLACE = 8340;
export const KEY_HAMMER_EXPORT = 8380;
export const KEY_HAMMER_DELETE = 8420;
export const KEY_HAMMER_IMPORT_INPUT = 8460;
export const KEY_HAMMER_IMPORT = 8461;
export const KEY_HAMMER_TEXT = 8462;
export const KEY_HAMMER_CLOSE = 8463;
export const KEY_HAMMER_NAME_INPUT = 8464;

/** Rows of the list a screen shows. */
const ROWS_MOST = 8;

/** The strip's actions, in the order of their buttons. */
export const HAMMER_ACT = 0, HAMMER_LIST = 1, HAMMER_TURN = 2, HAMMER_MIRROR = 3, HAMMER_RAISE = 4, HAMMER_LOWER = 5, HAMMER_STOP = 6, HAMMER_FILL = 7, HAMMER_CANCEL = 8, HAMMER_BOX = 9;
/** Each action's key by the keyboard and the pad, as the guide names them. */
const KEYS: readonly (readonly [string, string])[] = [["Click", "RT"], ["T", "Y"], ["R", "RB"], ["Q", "Left"], ["Up", "Up"], ["Down", "Down"], ["X", "B"], ["F", "Right"], ["Del", ""], ["G", ""]];

/** Its list of templates is a screen; its strip is drawn with the HUD while the hammer is held. */
export class HammerPanel implements Screen {
  readonly name = "hammer";
  readonly layer = "modal";
  readonly bands = [{ from: KEY_HAMMER_PANEL, count: KEY_HAMMER_NAME_INPUT - KEY_HAMMER_PANEL + 1 }];
  /** The app's hammer, once it has one. */
  hammer: Hammer | null = null;
  /** The name being typed for the chosen row. */
  private naming = "";
  private namingFor = "";

  /** The list is open, so the pointer is free. */
  get open(): boolean {
    return this.hammer?.panel ?? false;
  }

  close(): void {
    if (this.hammer) this.hammer.panel = false;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** A survivor who dies or goes to the creator puts the list away. */
  absorb(c: ScreenCtx): void {
    const state = c.session?.sessionState;
    if (state === SESSION_DEAD || state === SESSION_CREATING) this.close();
  }

  /** Its fields have the keyboard while the list is open. */
  keyboard(): boolean {
    return true;
  }

  typing(): boolean {
    return true;
  }

  pointer(kind: number, key: number): boolean {
    return kind === 0 && this.click(key);
  }

  text(key: number, value: string): boolean {
    if (!this.field(key)) return false;
    this.edit(key, value);
    return true;
  }

  build(f: UiFrame, c: ScreenCtx): void {
    if (c.session && c.registry) this.draw(f, c.session, c.registry, c.inputDevice);
  }

  play(f: UiFrame, c: ScreenCtx): void {
    if (c.session && c.registry && !this.open) this.draw(f, c.session, c.registry, c.inputDevice);
  }

  /** Returns true if the list used the key. */
  key(code: string, down: boolean, repeat: boolean): boolean {
    const h = this.hammer;
    if (!h?.panel) return false;
    // The fields have the keyboard: only what leaves the list, or acts on what is typed, is taken.
    if (code === "Escape") {
      if (down && !repeat) h.panel = false;
      return true;
    }
    if (code === "Enter" || code === "NumpadEnter") {
      if (down && !repeat) {
        if (h.importText.trim() !== "") h.takeText();
        else this.rename(h);
      }
      return true;
    }
    return false;
  }

  private rename(h: Hammer): void {
    const t = h.templates.list[h.selected];
    const reg = this.reg;
    if (!t || !reg || this.naming.trim() === "" || this.naming === t.name) return;
    h.templates.rename(h.selected, this.naming.trim(), t.description, pieceBook(reg));
    this.namingFor = h.templates.list[h.selected]!.text;
  }

  private reg: Registry | null = null;

  /** A press on one of the panel's nodes. Returns true if it was one. */
  click(key: number): boolean {
    const h = this.hammer;
    if (!h) return false;
    if (key >= KEY_HAMMER_BUTTON && key < KEY_HAMMER_BUTTON + KEYS.length) {
      const action = key - KEY_HAMMER_BUTTON;
      if (action === HAMMER_ACT) h.act();
      else if (action === HAMMER_LIST) h.panel = !h.panel;
      else if (action === HAMMER_TURN) h.rotate(1);
      else if (action === HAMMER_MIRROR) h.flip();
      else if (action === HAMMER_RAISE) h.lift(1);
      else if (action === HAMMER_LOWER) h.lift(-1);
      else if (action === HAMMER_STOP) h.choose(-1);
      else if (action === HAMMER_FILL) h.fill();
      else if (action === HAMMER_CANCEL) h.cancel();
      else if (action === HAMMER_BOX) h.box();
      return true;
    }
    if (!h.panel) return false;
    if (key === KEY_HAMMER_CLOSE) h.panel = false;
    else if (key === KEY_HAMMER_IMPORT) h.takeText();
    else if (key >= KEY_HAMMER_ROW && key < KEY_HAMMER_ROW + ROWS_MOST) h.selected = this.first(h) + key - KEY_HAMMER_ROW;
    else if (key >= KEY_HAMMER_PLACE && key < KEY_HAMMER_PLACE + ROWS_MOST) h.choose(this.first(h) + key - KEY_HAMMER_PLACE);
    else if (key >= KEY_HAMMER_EXPORT && key < KEY_HAMMER_EXPORT + ROWS_MOST) h.export((h.selected = this.first(h) + key - KEY_HAMMER_EXPORT));
    else if (key >= KEY_HAMMER_DELETE && key < KEY_HAMMER_DELETE + ROWS_MOST) h.remove(this.first(h) + key - KEY_HAMMER_DELETE);
    else return false;
    return true;
  }

  /** Whether `key` is one of the panel's fields, whose text `edit` takes. */
  field(key: number): boolean {
    return key === KEY_HAMMER_IMPORT_INPUT || key === KEY_HAMMER_NAME_INPUT || key === KEY_HAMMER_TEXT;
  }

  edit(key: number, value: string): void {
    const h = this.hammer;
    if (!h) return;
    if (key === KEY_HAMMER_IMPORT_INPUT) h.importText = value;
    else if (key === KEY_HAMMER_NAME_INPUT) this.naming = value;
  }

  /** The first row shown, so the chosen row is on the screen. */
  private first(h: Hammer): number {
    return Math.max(0, Math.min(h.selected - ROWS_MOST + 1, h.templates.list.length - ROWS_MOST));
  }

  /** What a template costs to build whole, as "12 wooden wall, 6 wooden foundation". */
  private cost(h: Hammer, reg: Registry, i: number): string {
    const book = pieceBook(reg);
    const bp = h.templates.blueprint(h.templates.list[i]!, book);
    const placed = bp ? placePieces(book, bp, false, 0, [0, 0, 0, 0], 0) : null;
    if (!placed?.ok) return "it has a piece this game does not build";
    const cost = planCost(reg, placed.placed, () => false);
    return cost.slice(0, 3).map((c) => `${c.count} ${structName(reg, reg.places[c.item]![0]!)}`).join(", ") + (cost.length > 3 ? ` and ${cost.length - 3} more kinds` : "");
  }

  draw(f: UiFrame, session: ClientSession, reg: Registry, device: number): void {
    const h = this.hammer;
    this.reg = reg;
    if (!h?.active) return;
    if (h.panel) this.list(f, h, reg);
    else this.strip(f, h, session, reg, device);
  }

  private strip(f: UiFrame, h: Hammer, session: ClientSession, reg: Registry, device: number): void {
    const pad = 10;
    const w = Math.min(f.width - 16, 330);
    const labelH = lineHeight(S_LABEL);
    const titleH = lineHeight(S_TITLE);
    const rowH = 26;
    const placing = h.chosen >= 0;
    const t = placing ? h.templates.list[h.chosen] : undefined;
    const lines: string[] = [];
    const wrapped: string[] = [];
    for (const line of h.lines(session, reg, (kind) => structName(reg, kind))) {
      wrapped.length = 0;
      wrapText(line, w - pad * 2, S_LABEL, wrapped);
      lines.push(...wrapped);
    }
    const plan = h.plan;
    if (plan && !placing) {
      let left = 0;
      for (let i = 0; i < plan.placed.n; i++) if ((plan.record.filled[i >> 3]! & (1 << (i & 7))) === 0) left++;
      lines.push(`Plan: ${left} of ${plan.placed.n} pieces to build`);
    }
    if (h.corner >= 0 && !placing) lines.push(`Box: corner marked, ${h.boxLevels / 4} storeys up`);
    const actions = placing ? [HAMMER_ACT, HAMMER_TURN, HAMMER_MIRROR, HAMMER_RAISE, HAMMER_LOWER, HAMMER_STOP, HAMMER_LIST] : [HAMMER_ACT, HAMMER_BOX, HAMMER_LIST, ...(plan ? [HAMMER_FILL, HAMMER_CANCEL] : [])];
    const said: readonly string[] = [placing ? (h.upload ? "Sending" : "Set the plan down") : "Copy this base", "Templates", "Turn", "Mirror", "Raise", "Lower", "Put the template away", h.filling ? "Stop filling" : "Fill what I carry", "Take the plan away", h.corner >= 0 ? "Copy the box" : "Mark a box's corner"];
    const cols = 2;
    const rows = Math.ceil(actions.length / cols);
    const height = pad * 2 + titleH + lines.length * labelH + (h.notice !== "" ? labelH + 4 : 0) + 6 + rows * (rowH + 4);
    const x = f.width - f.right - w - 12;
    const y = Math.max(f.top + 12, Math.round(f.height / 2 - height / 2));
    f.add(KEY_HAMMER_PANEL, K_PANEL, x, y, w, height, S_PANEL);
    f.text(KEY_HAMMER_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, t ? `${t.name}: ${t.pieces} pieces${h.joined ? ", on the base" : ""}` : "Template hammer");
    let top = y + pad + titleH;
    lines.slice(0, 16).forEach((line, i) => {
      f.text(KEY_HAMMER_LINE + i, x + pad, top, w - pad * 2, S_LABEL, line);
      top += labelH;
    });
    if (h.notice !== "") {
      f.text(KEY_HAMMER_NOTICE, x + pad, top + 2, w - pad * 2, S_LABEL, h.notice);
      top += labelH + 4;
    }
    top += 6;
    const cell = Math.floor((w - pad * 2 - 4) / cols);
    actions.forEach((action, i) => {
      const b = f.add(KEY_HAMMER_BUTTON + action, K_BUTTON, x + pad + (i % cols) * (cell + 4), top + Math.floor(i / cols) * (rowH + 4), cell, rowH, S_BUTTON);
      const key = device === 2 ? "" : KEYS[action]![device === 1 ? 1 : 0];
      b.text = key === "" ? said[action]! : `${key}  ${said[action]}`;
      b.interactive = true;
    });
  }

  private list(f: UiFrame, h: Hammer, reg: Registry): void {
    const pad = 12;
    const w = Math.min(f.width - 16, 620);
    const labelH = lineHeight(S_LABEL);
    const titleH = lineHeight(S_TITLE);
    const rowH = 28;
    const list = h.templates.list;
    const first = this.first(h);
    const shown = Math.min(ROWS_MOST, list.length - first);
    const step = rowH + labelH + 6;
    const height = pad * 2 + titleH + labelH + 8 + Math.max(1, shown) * step + 3 * (rowH + 6) + (h.notice !== "" ? labelH + 4 : 0);
    const x = Math.round((f.width - w) / 2);
    const y = Math.max(f.top + 8, Math.round((f.height - height) / 2));
    f.add(KEY_HAMMER_PANEL, K_PANEL, x, y, w, height, S_PANEL);
    f.text(KEY_HAMMER_TITLE, x + pad, y + pad, w - pad * 2 - 90, S_TITLE, `Templates: ${list.length}`);
    const close = f.add(KEY_HAMMER_CLOSE, K_BUTTON, x + w - pad - 80, y + pad, 80, rowH, S_BUTTON);
    close.text = "Close";
    close.interactive = true;
    f.text(KEY_HAMMER_LIST, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, list.length === 0 ? "None yet: close this, look at a piece of your base and copy it." : "Kept on this device. A template's text can be shared.");
    let top = y + pad + titleH + labelH + 8;
    const small = 84;
    for (let r = 0; r < shown; r++) {
      const i = first + r;
      const t = list[i]!;
      const row = f.add(KEY_HAMMER_ROW + r, K_BUTTON, x + pad, top, w - pad * 2 - 3 * (small + 4), rowH, S_BUTTON);
      row.text = `${i === h.selected ? "> " : ""}${t.name}  (${t.pieces} pieces, by ${t.author || "nobody"})`;
      row.interactive = true;
      const buttons: readonly (readonly [number, string])[] = [[KEY_HAMMER_PLACE, "Set down"], [KEY_HAMMER_EXPORT, "Share"], [KEY_HAMMER_DELETE, "Delete"]];
      buttons.forEach(([key, text], k) => {
        const b = f.add(key + r, K_BUTTON, x + w - pad - (3 - k) * (small + 4) + 4, top, small, rowH, S_BUTTON);
        b.text = text;
        b.interactive = true;
      });
      f.text(KEY_HAMMER_COST + r, x + pad, top + rowH + 2, w - pad * 2, S_LABEL, `needs ${this.cost(h, reg, i)}${t.description !== "" ? `. ${t.description}` : ""}`);
      top += step;
    }
    if (shown === 0) top += step;
    // The chosen template's name, which Enter keeps; then its text once given out; then a text to take in.
    const chosen = list[h.selected];
    if (chosen && this.namingFor !== chosen.text) [this.namingFor, this.naming] = [chosen.text, chosen.name];
    const name = f.add(KEY_HAMMER_NAME_INPUT, K_INPUT, x + pad, top, w - pad * 2, rowH, S_INPUT);
    name.text = chosen ? this.naming : "";
    name.label = "The chosen template's name";
    name.interactive = chosen !== undefined;
    top += rowH + 6;
    const text = f.add(KEY_HAMMER_TEXT, K_INPUT, x + pad, top, w - pad * 2, rowH, S_INPUT);
    text.text = h.exported;
    text.label = "The text of the template shared last";
    text.interactive = h.exported !== "";
    top += rowH + 6;
    const field = f.add(KEY_HAMMER_IMPORT_INPUT, K_INPUT, x + pad, top, w - pad * 2 - small - 4, rowH, S_INPUT);
    field.text = h.importText;
    field.label = "Paste a template's text here";
    field.interactive = true;
    const take = f.add(KEY_HAMMER_IMPORT, K_BUTTON, x + w - pad - small, top, small, rowH, S_BUTTON);
    take.text = "Import";
    take.interactive = true;
    top += rowH + 6;
    if (h.notice !== "") f.text(KEY_HAMMER_NOTICE, x + pad, top, w - pad * 2, S_LABEL, h.notice);
  }
}
