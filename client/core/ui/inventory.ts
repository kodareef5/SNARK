// The inventory screen: a grid of slots. Click a stack to pick it up, click
// another slot to put it down (onto an empty slot, a matching stack, or
// swapping with a different one). Middle click picks up half. Right click eats
// or uses. Every action is a command; what the grid shows is what the server
// last said, so nothing here can get out of step with it.

import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { BOX_SELF, CMD_MOVE, CMD_USE } from "../../../shared/net/protocol.ts";
import type { Inventory } from "../../../shared/sim/items.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_LABEL, S_PANEL, S_SLOT, S_SLOT_HELD, S_SLOT_TEXT, S_SWATCH, S_TITLE } from "./style.ts";

export const KEY_INV_PANEL = 290;
export const KEY_INV_TITLE = 291;
export const KEY_INV_INFO = 292;
/** Slot `s` of the survivor's own inventory is node KEY_INV_SLOT + 3 * s (then its swatch and its count). */
export const KEY_INV_SLOT = 300;
const CELL = 42;
const GAP = 3;
const PAD = 12;

export function itemLabel(reg: Registry, item: number): string {
  const def = reg.defs[item] as ItemDef | null;
  return def?.label ?? reg.ids[item]!.slice(reg.ids[item]!.indexOf(":") + 1);
}

export class InventoryScreen {
  open = false;
  /** Slot whose stack has been picked up, or -1. */
  held = -1;
  /** Pick up only half of it. */
  private half = false;
  /** Slot the pointer is over, or -1. */
  hover = -1;

  /** Whether `key` is one of this screen's slots; returns the slot or -1. */
  slotOf(key: number, inv: Inventory | null): number {
    const s = (key - KEY_INV_SLOT) / 3;
    return inv && Number.isInteger(s) && s >= 0 && s < inv.cap ? s : -1;
  }

  /** Pointer went down (0), up (1) or moved (2) over node `key`. */
  pointer(kind: number, key: number, button: number, session: ClientSession): void {
    const inv = session.inventory;
    const slot = this.slotOf(key, inv);
    if (kind === 2) {
      this.hover = slot;
      return;
    }
    if (kind !== 0 || slot < 0 || !inv) return;
    if (button === 2) {
      // Use what is here.
      if (inv.item[slot] !== 0) session.command(CMD_USE, (w) => (w.u8(slot), w.u16(inv.item[slot]!)));
      this.held = -1;
      return;
    }
    if (this.held < 0) {
      if (inv.item[slot] === 0) return;
      this.held = slot;
      this.half = button === 1;
      return;
    }
    const from = this.held;
    this.held = -1;
    if (from === slot || inv.item[from] === 0) return;
    const count = this.half ? Math.max(1, inv.count[from]! >> 1) : 0;
    session.command(CMD_MOVE, (w) => {
      w.bits(BOX_SELF, 1);
      w.u8(from);
      w.bits(BOX_SELF, 1);
      w.u8(slot);
      w.u16(count);
      w.u16(inv.item[from]!);
    });
  }

  build(f: UiFrame, session: ClientSession | null, reg: Registry | null, palette: Uint8Array | null): void {
    const inv = session?.inventory;
    if (!this.open || !inv || !reg) return;
    if (this.held >= 0 && inv.item[this.held] === 0) this.held = -1;
    const cols = Math.max(4, Math.min(10, Math.floor((f.width - PAD * 4) / (CELL + GAP))));
    const rows = Math.ceil(inv.cap / cols);
    const w = cols * (CELL + GAP) - GAP + PAD * 2;
    const titleH = lineHeight(S_TITLE);
    const infoH = lineHeight(S_LABEL);
    const h = titleH + rows * (CELL + GAP) + infoH + PAD * 2 + 6;
    const x0 = Math.round((f.width - w) / 2);
    const y0 = Math.max(4, Math.round((f.height - h) / 2));
    f.add(KEY_INV_PANEL, K_PANEL, x0, y0, w, h, S_PANEL);
    f.text(KEY_INV_TITLE, x0 + PAD, y0 + PAD, w - PAD * 2, S_TITLE, `Inventory  ${inv.weight(reg).toFixed(1)} kg`);
    const tick = session.serverTick;
    for (let s = 0; s < inv.cap; s++) {
      const x = x0 + PAD + (s % cols) * (CELL + GAP);
      const y = y0 + PAD + titleH + 4 + Math.floor(s / cols) * (CELL + GAP);
      const cell = f.add(KEY_INV_SLOT + s * 3, K_BUTTON, x, y, CELL, CELL, s === this.held ? S_SLOT_HELD : S_SLOT);
      cell.interactive = true;
      const item = inv.item[s]!;
      if (item === 0) continue;
      const def = reg.defs[item] as ItemDef | null;
      const swatch = f.add(KEY_INV_SLOT + s * 3 + 1, K_PANEL, x + 4, y + 4, CELL - 8, CELL - 20, S_SWATCH);
      const c = (def?.color ?? 15) * 4;
      if (palette) swatch.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
      swatch.text = itemLabel(reg, item).slice(0, 4);
      f.text(KEY_INV_SLOT + s * 3 + 2, x + 2, y + CELL - lineHeight(S_SLOT_TEXT), CELL - 4, S_SLOT_TEXT, inv.count[s]! > 1 ? String(inv.count[s]) : "");
    }
    // One line about the stack under the pointer, or the one picked up.
    const shown = this.held >= 0 ? this.held : this.hover;
    let info = this.held >= 0 ? "click a slot to put it down" : "left click: pick up   middle: half   right: use";
    if (shown >= 0 && shown < inv.cap && inv.item[shown] !== 0) {
      const item = inv.item[shown]!;
      const spoil = inv.spoilAt[shown]!;
      info = `${itemLabel(reg, item)} x${inv.count[shown]}  ${(reg.weight[item]! * inv.count[shown]!).toFixed(1)} kg`;
      if (spoil > 0) info += `  spoils in ${Math.max(0, Math.ceil((spoil - tick) / 30))} s`;
    }
    f.text(KEY_INV_INFO, x0 + PAD, y0 + h - PAD - infoH, w - PAD * 2, S_LABEL, info.slice(0, Math.floor((w - PAD * 2) / 7.2)));
  }
}
