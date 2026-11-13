// The inventory screen: a grid of slots for what the survivor carries and,
// when a container is open, a second grid for what is in it. Click a stack to
// pick it up, click another slot (in either grid) to put it down: onto an
// empty slot, a matching stack, or swapping with a different one. Middle click
// picks up half. Right click eats, uses, or puts on. Every action is a command;
// what the grids show is what the server last said, so nothing here can get out
// of step with it.
//
// A survivor's own inventory has two more rows under its bag: the ten hotbar
// slots and the five armor slots. They are slots like the others. Putting
// ammunition down on a weapon that takes it sets the weapon to that kind;
// putting an attachment down on a weapon that fits it fits it. Four buttons act
// on the stack that is picked up: drop, repair, unload, detach.

import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { BOX_OPEN, BOX_SELF, CMD_ATTACH, CMD_CLOSE, CMD_DETACH, CMD_DROP, CMD_LOAD, CMD_MOVE, CMD_REPAIR, CMD_UNLOAD, CMD_FEED, CMD_ORDER, ORDER_FOLLOW, ORDER_LEVEL, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, ORDER_UNSADDLE, CMD_USE } from "../../../shared/net/protocol.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS, QUALITY_MUL, QUALITY_NAMES, type Inventory } from "../../../shared/sim/items.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_SLOT, S_SLOT_HELD, S_SLOT_TEXT, S_SWATCH, S_TITLE } from "./style.ts";

export const KEY_INV_PANEL = 290;
export const KEY_INV_TITLE = 291;
export const KEY_INV_INFO = 292;
export const KEY_OPEN_PANEL = 293;
export const KEY_OPEN_TITLE = 294;
/** Slot `s` of the survivor's own inventory is node KEY_INV_SLOT + 3 * s (then its swatch and its count). */
export const KEY_INV_SLOT = 300;
/**
 * The open container's slots, the same way, but numbered by their place on
 * the page shown: a vault has more slots than a screen has room for, and is
 * turned through a page at a time.
 */
export const KEY_OPEN_SLOT = 600;
/** The buttons that turn the page back and on, and the line between them that says which page it is. */
export const KEY_OPEN_PAGE = 296;
/** The line that says how the creature looked into is. */
export const KEY_OPEN_SUBJECT = 299;
/**
 * For a creature of one's own: a button that tells it to follow or to stay,
 * one that changes its stance, and one for each stat a level can be put in
 * (when it has levels to spend).
 */
export const KEY_OPEN_ORDER = 270;
export const KEY_OPEN_LEVEL = 272;
/** And, on one that wears a saddle, a button that takes it off. */
export const KEY_OPEN_UNSADDLE = 279;
/** And, on one that is grown and of a kind that breeds, a button that says whether it may mate. */
export const KEY_OPEN_MATE = 295;
/** The stats a creature's levels go in, and what each button is marked with. */
const LEVEL_STATS: readonly [stat: number, mark: string][] = [[0, "health"], [1, "stam"], [2, "oxy"], [3, "food"], [5, "weight"], [6, "melee"], [7, "speed"]];
const STANCE_WORDS: readonly string[] = ["passive", "neutral", "aggressive"];
const STAGE_WORDS: readonly string[] = ["baby", "juvenile", "adolescent"];

/** A wait in seconds as a few characters: "45s", "12m", "5h 12m". */
export function waitWords(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
/** Rows of the open container shown at once. */
const OPEN_ROWS = 6;
/** Labels of the hotbar and armor rows, and the four buttons that act on the picked-up stack. */
export const KEY_INV_ROW_LABEL = 280;
export const KEY_INV_ACTION = 284;
const ACTIONS: readonly string[] = ["Drop", "Repair", "Unload", "Detach"];
const ARMOR_LABELS: readonly string[] = ["head", "torso", "hands", "legs", "feet"];
const CELL = 42;
const GAP = 3;
const PAD = 12;

export function itemLabel(reg: Registry, item: number): string {
  const def = reg.defs[item] as ItemDef | null;
  return def?.label ?? reg.ids[item]!.slice(reg.ids[item]!.indexOf(":") + 1);
}

export class InventoryScreen {
  open = false;
  /** Box and slot of the stack that has been picked up; slot -1 for none. */
  heldBox = BOX_SELF;
  held = -1;
  /** Pick up only half of it. */
  private half = false;
  /** Box and slot the pointer is over; slot -1 for none. */
  hoverBox = BOX_SELF;
  hover = -1;
  private hadOpen = false;
  /** Which page of the open container is shown, how many slots a page is, and how many pages there are. */
  page = 0;
  private pageSize = 60;
  private pages = 1;
  /** Content, as of the last build: what a slot's item is decides what putting something down on it means. */
  private registry: Registry | null = null;

  private box(session: ClientSession, which: number): Inventory | null {
    return which === BOX_OPEN ? (session.open?.inventory ?? null) : session.inventory;
  }

  /** Which box and slot a node key names, as box * 1000 + slot, or -1. */
  private where(key: number, session: ClientSession): number {
    const own = session.inventory;
    const s = (key - KEY_INV_SLOT) / 3;
    if (own && key < KEY_OPEN_SLOT && Number.isInteger(s) && s >= 0 && s < own.cap) return BOX_SELF * 1000 + s;
    // The open container: the node says which place on the page, and the page says which slot that is.
    const other = session.open?.inventory;
    const i = (key - KEY_OPEN_SLOT) / 3;
    if (other && Number.isInteger(i) && i >= 0 && i < this.pageSize && this.page * this.pageSize + i < other.cap) return BOX_OPEN * 1000 + this.page * this.pageSize + i;
    return -1;
  }

  /** Close the screen, and with it whatever container was open. */
  close(session: ClientSession | null): void {
    this.open = false;
    this.held = -1;
    if (session?.open) session.command(CMD_CLOSE);
  }

  /** Pointer went down (0), up (1) or moved (2) over node `key`. */
  pointer(kind: number, key: number, button: number, session: ClientSession): void {
    const at = this.where(key, session);
    const box = at < 0 ? BOX_SELF : Math.floor(at / 1000);
    const slot = at < 0 ? -1 : at % 1000;
    if (kind === 2) {
      this.hoverBox = box;
      this.hover = slot;
      return;
    }
    const subject = session.subject;
    if (kind === 0 && subject?.owned && subject.id >= 0 && key >= KEY_OPEN_ORDER && key <= KEY_OPEN_UNSADDLE) {
      // What a creature of one's own is told: follow or stay, the next stance round, its saddle off, or a level into a stat.
      const what = key === KEY_OPEN_UNSADDLE ? ORDER_UNSADDLE : key === KEY_OPEN_ORDER ? (subject.following ? ORDER_STAY : ORDER_FOLLOW) : key === KEY_OPEN_ORDER + 1 ? ORDER_STANCE + ((subject.stance + 1) % STANCE_WORDS.length) : ORDER_LEVEL + LEVEL_STATS[key - KEY_OPEN_LEVEL]![0];
      session.command(CMD_ORDER, (w) => (w.u32(subject.id), w.u8(what)));
      return;
    }
    if (kind === 0 && subject?.owned && subject.id >= 0 && key === KEY_OPEN_MATE) {
      session.command(CMD_ORDER, (w) => (w.u32(subject.id), w.u8(subject.mating ? ORDER_UNMATE : ORDER_MATE)));
      return;
    }
    if (kind === 0 && (key === KEY_OPEN_PAGE || key === KEY_OPEN_PAGE + 2)) {
      this.page = Math.max(0, Math.min(this.pages - 1, this.page + (key === KEY_OPEN_PAGE ? -1 : 1)));
      return;
    }
    if (kind === 0 && key >= KEY_INV_ACTION && key < KEY_INV_ACTION + ACTIONS.length) {
      // One of the four buttons: it acts on the stack picked up from the survivor's own slots.
      const own = session.inventory;
      const from = this.held;
      this.held = -1;
      if (!own || from < 0 || this.heldBox !== BOX_SELF || own.item[from] === 0) return;
      const op = [CMD_DROP, CMD_REPAIR, CMD_UNLOAD, CMD_DETACH][key - KEY_INV_ACTION]!;
      session.command(op, (w) => {
        w.varint(from);
        if (op === CMD_DROP) (w.u16(0), w.u16(own.item[from]!));
      });
      return;
    }
    const inv = this.box(session, box);
    if (kind !== 0 || slot < 0 || !inv) return;
    if (button === 2) {
      // Use what is here. Only what you carry can be used; but a dose lying in an unconscious creature can be fed to it.
      if (box === BOX_SELF && inv.item[slot] !== 0) session.command(CMD_USE, (w) => (w.varint(slot), w.u16(inv.item[slot]!)));
      else if (box === BOX_OPEN && session.subject && inv.item[slot] !== 0 && (this.registry?.doseTorpor[inv.item[slot]!] ?? 0) > 0) session.command(CMD_FEED, (w) => (w.varint(slot), w.u16(inv.item[slot]!)));
      this.held = -1;
      return;
    }
    if (this.held < 0) {
      if (inv.item[slot] === 0) return;
      this.heldBox = box;
      this.held = slot;
      this.half = button === 1;
      return;
    }
    const fromBox = this.heldBox;
    const from = this.held;
    const src = this.box(session, fromBox);
    this.held = -1;
    if (!src || (fromBox === box && from === slot) || src.item[from] === 0) return;
    const count = this.half ? Math.max(1, src.count[from]! >> 1) : 0;
    // Put down on a weapon of your own: ammunition it takes sets what it is loaded with, an attachment that fits is fitted.
    const target = fromBox === BOX_SELF && box === BOX_SELF && this.registry ? (this.registry.defs[inv.item[slot]!] as ItemDef | null)?.weapon : undefined;
    const what = this.registry?.ids[src.item[from]!] ?? "";
    if (target?.ammo?.includes(what)) {
      session.command(CMD_LOAD, (w) => (w.varint(slot), w.u16(src.item[from]!)));
      return;
    }
    if (target?.fits?.includes(what)) {
      session.command(CMD_ATTACH, (w) => (w.varint(slot), w.varint(from)));
      return;
    }
    session.command(CMD_MOVE, (w) => {
      w.bits(fromBox, 1);
      w.varint(from);
      w.bits(box, 1);
      w.varint(slot);
      w.u16(count);
      w.u16(src.item[from]!);
    });
  }

  build(f: UiFrame, session: ClientSession | null, reg: Registry | null, palette: Uint8Array | null): void {
    // A container the server has just opened brings the screen up with it.
    const isOpen = !!session?.open;
    if (isOpen && !this.hadOpen) {
      this.open = true;
      this.page = 0;
    }
    this.hadOpen = isOpen;
    const own = session?.inventory;
    if (!this.open || !own || !session || !reg) return;
    const other = session.open?.inventory ?? null;
    const heldInv = this.box(session, this.heldBox);
    if (this.held >= 0 && (!heldInv || heldInv.item[this.held] === 0)) this.held = -1;

    this.registry = reg;
    const cols = Math.max(4, Math.min(10, Math.floor((f.width - PAD * 4) / (CELL + GAP))));
    const w = cols * (CELL + GAP) - GAP + PAD * 2;
    const titleH = lineHeight(S_TITLE);
    const infoH = lineHeight(S_LABEL);
    const rows = (n: number): number => Math.ceil(n / cols) * (CELL + GAP);
    // A survivor's own slots: the bag, then (if it has them) the hotbar and the armor, each under a label.
    const tail = own.hotbar >= 0;
    const tailH = tail ? infoH * 2 + rows(HOTBAR_SLOTS) + rows(ARMOR_SLOTS) + 4 : 0;
    const actionH = tail ? 28 : 0;
    const ownH = titleH + rows(own.bag) + tailH + infoH + actionH + PAD * 2 + 6;
    // The open container: as many rows as there is room to show; the rest by turning the page.
    this.pageSize = cols * OPEN_ROWS;
    this.pages = other ? Math.max(1, Math.ceil(other.bag / this.pageSize)) : 1;
    if (this.page >= this.pages) this.page = this.pages - 1;
    const onPage = other ? Math.min(this.pageSize, other.bag - this.page * this.pageSize) : 0;
    // A creature looked into has a line of its own under its name: how its taming goes, or how it is.
    const subject = other ? session.subject : null;
    // One's own has a row of buttons under that, and another when it has levels to spend.
    const orderH = subject?.owned ? 28 + (subject.points > 0 ? 28 : 0) : 0;
    const subjectH = subject ? infoH + 2 + orderH : 0;
    const otherH = other ? titleH + subjectH + rows(this.pages > 1 ? this.pageSize : other.bag) + PAD * 2 : 0;
    const x0 = Math.round((f.width - w) / 2);
    let y = Math.max(4, Math.round((f.height - ownH - otherH - (other ? 8 : 0)) / 2));
    const tick = session.serverTick;

    /** Slots `from` .. `from + n - 1` of `inv` as a grid starting at `top`. */
    const grid = (inv: Inventory, which: number, base: number, top: number, from: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const s = from + i;
        const x = x0 + PAD + (i % cols) * (CELL + GAP);
        const yy = top + Math.floor(i / cols) * (CELL + GAP);
        const inHand = which === BOX_SELF && inv.hotbar >= 0 && s === inv.hotbar + session.held;
        // The open container's nodes are numbered by place on the page; a survivor's own by slot.
        const key = base + (which === BOX_OPEN ? i : s) * 3;
        const cell = f.add(key, K_BUTTON, x, yy, CELL, CELL, this.held === s && this.heldBox === which ? S_SLOT_HELD : S_SLOT);
        cell.interactive = true;
        // What is in hand has a lighter cell.
        if (inHand && cell.style === S_SLOT) cell.tint = 0x5a6a7a;
        const item = inv.item[s]!;
        if (item === 0) continue;
        const def = reg.defs[item] as ItemDef | null;
        const swatch = f.add(key + 1, K_PANEL, x + 4, yy + 4, CELL - 8, CELL - 20, S_SWATCH);
        const c = (def?.color ?? 15) * 4;
        if (palette) swatch.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
        swatch.text = itemLabel(reg, item).slice(0, 4);
        // A stack shows how many; a weapon shows the rounds in it.
        const number = inv.count[s]! > 1 ? String(inv.count[s]) : def?.weapon?.ammo ? String(inv.loaded[s]) : "";
        f.text(key + 2, x + 2, yy + CELL - lineHeight(S_SLOT_TEXT), CELL - 4, S_SLOT_TEXT, number);
      }
    };
    const fit = (text: string): string => text.slice(0, Math.floor((w - PAD * 2) / (18 * 0.6)));

    if (other) {
      f.add(KEY_OPEN_PANEL, K_PANEL, x0, y, w, otherH, S_PANEL);
      const pagerW = this.pages > 1 ? 120 : 0;
      f.text(KEY_OPEN_TITLE, x0 + PAD, y + PAD, w - PAD * 2 - pagerW, S_TITLE, fit(session.open!.name).slice(0, Math.floor((w - PAD * 2 - pagerW) / (18 * 0.6))));
      if (this.pages > 1) {
        // Back, which page of how many, and on.
        const px = x0 + w - PAD - pagerW;
        for (const [n, label] of [[0, "<"], [2, ">"]] as const) {
          const b = f.add(KEY_OPEN_PAGE + n, K_BUTTON, px + (n === 0 ? 0 : pagerW - 28), y + PAD - 2, 28, 22, S_BUTTON);
          b.text = label;
          b.interactive = true;
        }
        f.text(KEY_OPEN_PAGE + 1, px + 34, y + PAD + 2, pagerW - 68, S_LABEL, `${this.page + 1} / ${this.pages}`);
      }
      if (subject) {
        const pct = (v: number): string => `${Math.round(v * 100)}%`;
        // How it is: its taming, if it is being tamed; else its level, its sex if its kind breeds, how grown it is if it is young, and how its mating goes.
        const grown = subject.stage >= STAGE_WORDS.length;
        const sex = subject.breeds ? (subject.female ? "  female" : "  male") : "";
        const age = grown ? "" : `  ${STAGE_WORDS[subject.stage]} ${pct(subject.maturity)}`;
        const mate = !subject.mating ? "" : subject.mate > 0 ? `  mating ${pct(subject.mate)}` : subject.wait > 0 ? `  rests ${waitWords(subject.wait)}` : "";
        const line = subject.taming ? `taming ${pct(subject.progress)}  well ${pct(subject.te)}  torpor ${pct(subject.torpor)}  food ${pct(subject.food)}` : `level ${subject.level}${sex}${age}  torpor ${pct(subject.torpor)}  food ${pct(subject.food)}${mate}`;
        f.text(KEY_OPEN_SUBJECT, x0 + PAD, y + PAD + titleH, w - PAD * 2, S_LABEL, line.slice(0, Math.floor((w - PAD * 2) / 7.2)));
        if (subject.owned) {
          const top = y + PAD + titleH + infoH + 2;
          // Two buttons; one more on one that wears a saddle, and one more on one that can be told to mate.
          const mates = subject.breeds && grown;
          const across = 2 + (subject.saddled ? 1 : 0) + (mates ? 1 : 0);
          const half = (w - PAD * 2 - GAP * (across - 1)) / across;
          for (const [n, label] of [[0, subject.following ? "Stay here" : "Follow me"], [1, across > 2 ? (STANCE_WORDS[subject.stance] ?? "neutral") : `It is ${STANCE_WORDS[subject.stance] ?? "neutral"}`]] as const) {
            const b = f.add(KEY_OPEN_ORDER + n, K_BUTTON, x0 + PAD + n * (half + GAP), top, half, 24, S_BUTTON);
            b.text = label.slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
            b.interactive = true;
          }
          if (subject.saddled) {
            const b = f.add(KEY_OPEN_UNSADDLE, K_BUTTON, x0 + PAD + 2 * (half + GAP), top, half, 24, S_BUTTON);
            b.text = "Unsaddle".slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
            b.interactive = true;
          }
          if (mates) {
            const b = f.add(KEY_OPEN_MATE, K_BUTTON, x0 + PAD + (across - 1) * (half + GAP), top, half, 24, S_BUTTON);
            b.text = (subject.mating ? "Mating on" : "Mating off").slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
            b.interactive = true;
          }
          if (subject.points > 0) {
            // A level for each press, into the stat pressed, while it has any.
            const each = (w - PAD * 2 - GAP * (LEVEL_STATS.length - 1)) / LEVEL_STATS.length;
            LEVEL_STATS.forEach(([, mark], n) => {
              const b = f.add(KEY_OPEN_LEVEL + n, K_BUTTON, x0 + PAD + n * (each + GAP), top + 28, each, 24, S_BUTTON);
              b.text = `+${mark}`.slice(0, Math.max(2, Math.floor((each - 6) / 8.4)));
              b.interactive = true;
            });
          }
        }
      }
      grid(other, BOX_OPEN, KEY_OPEN_SLOT, y + PAD + titleH + subjectH + 4, this.page * this.pageSize, onPage);
      y += otherH + 8;
    }
    f.add(KEY_INV_PANEL, K_PANEL, x0, y, w, ownH, S_PANEL);
    f.text(KEY_INV_TITLE, x0 + PAD, y + PAD, w - PAD * 2, S_TITLE, fit(`Inventory  ${own.weight(reg).toFixed(1)} kg`));
    let top = y + PAD + titleH + 4;
    grid(own, BOX_SELF, KEY_INV_SLOT, top, 0, own.bag);
    top += rows(own.bag);
    if (tail) {
      f.text(KEY_INV_ROW_LABEL, x0 + PAD, top, w - PAD * 2, S_LABEL, "Hotbar: keys 1 to 0");
      top += infoH;
      grid(own, BOX_SELF, KEY_INV_SLOT, top, own.hotbar, HOTBAR_SLOTS);
      top += rows(HOTBAR_SLOTS);
      f.text(KEY_INV_ROW_LABEL + 1, x0 + PAD, top, w - PAD * 2, S_LABEL, `Worn: ${ARMOR_LABELS.join(", ")}`.slice(0, Math.floor((w - PAD * 2) / 7.2)));
      top += infoH;
      grid(own, BOX_SELF, KEY_INV_SLOT, top, own.armor, ARMOR_SLOTS);
      top += rows(ARMOR_SLOTS) + 4;
      const bw = (w - PAD * 2 - GAP * (ACTIONS.length - 1)) / ACTIONS.length;
      ACTIONS.forEach((label, i) => {
        const b = f.add(KEY_INV_ACTION + i, K_BUTTON, x0 + PAD + i * (bw + GAP), top, bw, 24, S_BUTTON);
        b.text = label;
        b.interactive = true;
      });
    }

    // One line about the stack under the pointer, or the one picked up.
    const shownBox = this.held >= 0 ? this.heldBox : this.hoverBox;
    const shown = this.held >= 0 ? this.held : this.hover;
    const inv = this.box(session, shownBox);
    let info = this.held >= 0 ? "click a slot to put it down" : "left click: pick up   middle: half   right: use";
    if (inv && shown >= 0 && shown < inv.cap && inv.item[shown] !== 0) {
      const item = inv.item[shown]!;
      const spoil = inv.spoilAt[shown]!;
      info = `${itemLabel(reg, item)} x${inv.count[shown]}  ${(reg.weight[item]! * inv.count[shown]!).toFixed(1)} kg`;
      if (spoil > 0) info += `  spoils in ${Math.max(0, Math.ceil((spoil - tick) / 30))} s`;
      // Something that wears: its quality and what is left of it. A weapon: what is in it and on it.
      const uses = reg.uses[item]!;
      if (uses > 0 && reg.stack[item] === 1) {
        info = `${QUALITY_NAMES[inv.quality[shown]!] ?? ""} ${itemLabel(reg, item)}  ${inv.dur[shown]}/${Math.round(uses * (QUALITY_MUL[inv.quality[shown]!] ?? 1))}`;
        if (inv.ammo[shown] !== 0) info += `  ${inv.loaded[shown]} ${itemLabel(reg, inv.ammo[shown]!)}`;
        if (inv.attach[shown] !== 0) info += `  + ${itemLabel(reg, inv.attach[shown]!)}`;
      }
    }
    f.text(KEY_INV_INFO, x0 + PAD, y + ownH - PAD - infoH, w - PAD * 2, S_LABEL, info.slice(0, Math.floor((w - PAD * 2) / 7.2)));
  }
}
