// The inventory screen: a grid of slots for what the survivor carries and,
// when a container is open, a second grid for what is in it. Click a stack to
// pick it up, click another slot (in either grid) to put it down: onto an
// empty slot, a matching stack, or swapping with a different one. Middle click
// picks up half. Right click eats or uses. Every action is a command; what the
// grids show is what the server last said, so nothing here can get out of
// step with it.

import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_MOVE, CMD_USE } from "../../../shared/net/protocol.ts";
import type { Inventory } from "../../../shared/sim/items.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_LABEL, S_PANEL, S_SLOT, S_SLOT_HELD, S_SLOT_TEXT, S_SWATCH, S_TITLE } from "./style.ts";

export const KEY_INV_PANEL = 290;
export const KEY_INV_TITLE = 291;
export const KEY_INV_INFO = 292;
export const KEY_OPEN_PANEL = 293;
export const KEY_OPEN_TITLE = 294;
/** Slot `s` of the survivor's own inventory is node KEY_INV_SLOT + 3 * s (then its swatch and its count). */
export const KEY_INV_SLOT = 300;
/** Slot `s` of the open container, the same way. */
export const KEY_OPEN_SLOT = 600;
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

  private box(session: ClientSession, which: number): Inventory | null {
    return which === BOX_OPEN ? (session.open?.inventory ?? null) : session.inventory;
  }

  /** Which box and slot a node key names, as box * 1000 + slot, or -1. */
  private where(key: number, session: ClientSession): number {
    for (const which of [BOX_SELF, BOX_OPEN]) {
      const inv = this.box(session, which);
      const s = (key - (which === BOX_OPEN ? KEY_OPEN_SLOT : KEY_INV_SLOT)) / 3;
      if (inv && Number.isInteger(s) && s >= 0 && s < inv.cap) return which * 1000 + s;
    }
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
    const inv = this.box(session, box);
    if (kind !== 0 || slot < 0 || !inv) return;
    if (button === 2) {
      // Use what is here. Only what you carry can be used.
      if (box === BOX_SELF && inv.item[slot] !== 0) session.command(CMD_USE, (w) => (w.u8(slot), w.u16(inv.item[slot]!)));
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
    session.command(CMD_MOVE, (w) => {
      w.bits(fromBox, 1);
      w.u8(from);
      w.bits(box, 1);
      w.u8(slot);
      w.u16(count);
      w.u16(src.item[from]!);
    });
  }

  build(f: UiFrame, session: ClientSession | null, reg: Registry | null, palette: Uint8Array | null): void {
    // A container the server has just opened brings the screen up with it.
    const isOpen = !!session?.open;
    if (isOpen && !this.hadOpen) this.open = true;
    this.hadOpen = isOpen;
    const own = session?.inventory;
    if (!this.open || !own || !session || !reg) return;
    const other = session.open?.inventory ?? null;
    const heldInv = this.box(session, this.heldBox);
    if (this.held >= 0 && (!heldInv || heldInv.item[this.held] === 0)) this.held = -1;

    const cols = Math.max(4, Math.min(10, Math.floor((f.width - PAD * 4) / (CELL + GAP))));
    const w = cols * (CELL + GAP) - GAP + PAD * 2;
    const titleH = lineHeight(S_TITLE);
    const infoH = lineHeight(S_LABEL);
    const gridH = (inv: Inventory): number => Math.ceil(inv.cap / cols) * (CELL + GAP);
    const ownH = titleH + gridH(own) + infoH + PAD * 2 + 6;
    const otherH = other ? titleH + gridH(other) + PAD * 2 : 0;
    const x0 = Math.round((f.width - w) / 2);
    let y = Math.max(4, Math.round((f.height - ownH - otherH - (other ? 8 : 0)) / 2));
    const tick = session.serverTick;

    const grid = (inv: Inventory, which: number, base: number, top: number): void => {
      for (let s = 0; s < inv.cap; s++) {
        const x = x0 + PAD + (s % cols) * (CELL + GAP);
        const yy = top + Math.floor(s / cols) * (CELL + GAP);
        const cell = f.add(base + s * 3, K_BUTTON, x, yy, CELL, CELL, this.held === s && this.heldBox === which ? S_SLOT_HELD : S_SLOT);
        cell.interactive = true;
        const item = inv.item[s]!;
        if (item === 0) continue;
        const def = reg.defs[item] as ItemDef | null;
        const swatch = f.add(base + s * 3 + 1, K_PANEL, x + 4, yy + 4, CELL - 8, CELL - 20, S_SWATCH);
        const c = (def?.color ?? 15) * 4;
        if (palette) swatch.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
        swatch.text = itemLabel(reg, item).slice(0, 4);
        f.text(base + s * 3 + 2, x + 2, yy + CELL - lineHeight(S_SLOT_TEXT), CELL - 4, S_SLOT_TEXT, inv.count[s]! > 1 ? String(inv.count[s]) : "");
      }
    };
    const fit = (text: string): string => text.slice(0, Math.floor((w - PAD * 2) / (18 * 0.6)));

    if (other) {
      f.add(KEY_OPEN_PANEL, K_PANEL, x0, y, w, otherH, S_PANEL);
      f.text(KEY_OPEN_TITLE, x0 + PAD, y + PAD, w - PAD * 2, S_TITLE, fit(session.open!.name));
      grid(other, BOX_OPEN, KEY_OPEN_SLOT, y + PAD + titleH + 4);
      y += otherH + 8;
    }
    f.add(KEY_INV_PANEL, K_PANEL, x0, y, w, ownH, S_PANEL);
    f.text(KEY_INV_TITLE, x0 + PAD, y + PAD, w - PAD * 2, S_TITLE, fit(`Inventory  ${own.weight(reg).toFixed(1)} kg`));
    grid(own, BOX_SELF, KEY_INV_SLOT, y + PAD + titleH + 4);

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
    }
    f.text(KEY_INV_INFO, x0 + PAD, y + ownH - PAD - infoH, w - PAD * 2, S_LABEL, info.slice(0, Math.floor((w - PAD * 2) / 7.2)));
  }
}
