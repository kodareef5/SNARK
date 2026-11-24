// The hotbar at the bottom, and over it the line that says what is loaded (the action widget fills that line).

import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../../shared/sim/items.ts";
import { K_BUTTON, K_PANEL, fitText, lineHeight } from "../ui/nodes.ts";
import { glass } from "../ui/skin.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_HUD_KEY, S_ICE, S_PROMPT, S_SLOT_TEXT } from "../ui/style.ts";
import { hotbarCell, hotbarLeft, hotbarTop } from "./layout.ts";
import type { HudWidget } from "./widget.ts";

/** The line that says what is loaded. */
export const KEY_AMMO = 35;
/** The line over it with a piece in hand: what the preview says of the piece. */
export const KEY_BUILD_SAYS = 5540;
/** Per hotbar slot: its box, its swatch, its number. */
export const KEY_HOTBAR = 40;

/** label is the first letters of the item's name. number is a count, or the rounds loaded. */
export interface HotbarCell {
  label: string;
  /** 0xRRGGBB, or -1 for an empty slot. */
  tint: number;
  number: string;
  /** The item's content id, which its picture is found by (ui/hud.ts). */
  id?: string;
}

export interface HotbarModel {
  /** Empty for a body that has no hotbar. `held` is the slot in hand, or -1. */
  hotbar: HotbarCell[];
  held: number;
  /** The loaded ammunition, the rounds in the weapon, and those carried. "" for a weapon that takes none. */
  ammo: string;
  /** With a piece in hand, what the preview says of it: how well it would stand. */
  buildSays: string;
}

/** `spend` of `spendItem` in the held slot are set down and not yet taken from it by the server (predict-build.ts): the count shows without them. */
export function fillHotbar(m: HotbarModel, inv: Inventory | null, held: number, reg: Registry, palette: Uint8Array, spendItem = 0, spend = 0): void {
  const first = inv ? inv.hotbar : -1;
  m.held = held;
  if (first < 0) {
    m.hotbar.length = 0;
    return;
  }
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const cell = (m.hotbar[i] ??= { label: "", tint: -1, number: "" });
    const item = inv!.item[first + i]!;
    const def = item === 0 ? null : (reg.defs[item] as ItemDef | null);
    if (!def) {
      cell.label = "";
      cell.tint = -1;
      cell.number = "";
      cell.id = "";
      continue;
    }
    cell.id = def.id;
    const name = def.label ?? def.id.slice(def.id.indexOf(":") + 1);
    const c = (def.color ?? 15) * 4;
    cell.label = name.slice(0, 4);
    cell.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
    const count = inv!.count[first + i]!, left = i === held && item === spendItem ? Math.max(0, count - spend) : count;
    cell.number = count > 1 ? String(left) : def.weapon?.ammo ? String(inv!.loaded[first + i]) : "";
  }
}

export const HOTBAR: HudWidget<HotbarModel> = {
  name: "hotbar",
  make: () => ({ hotbar: [], held: -1, ammo: "", buildSays: "" }),
  fill(m, c) {
    const a = c.frame;
    if (a) fillHotbar(m, a.alive ? c.session.inventory : null, c.session.held, a.reg, a.palette, a.spendItem, a.spend);
  },
  // The hotbar stays at the bottom even when a message, a vital or chat changes.
  build(f, m, at) {
    const { controls, W, left, right } = at;
    if (m.hotbar.length > 0) {
      const cell = hotbarCell(f, m.hotbar.length);
      const gap = 3;
      const x0 = hotbarLeft(f, m.hotbar.length);
      const y0 = hotbarTop(f, m.hotbar.length);
      const small = lineHeight(S_SLOT_TEXT);
      for (let i = 0; i < m.hotbar.length; i++) {
        const c = m.hotbar[i]!;
        const x = x0 + i * (cell + gap);
        const key = KEY_HOTBAR + i * 3;
        glass(f, key, x, y0, cell, cell, i === m.held ? 1 : c.tint < 0 ? .78 : .9);
        const box = f.add(key, K_BUTTON, x, y0, cell, cell, S_HUD_HIT);
        box.label = `Slot ${(i + 1) % 10}${c.id ? `: ${c.id.split(":").pop()!.replaceAll("_", " ")}` : ": empty"}`;
        box.interactive = controls;
        if (i === m.held) f.add(5500 + i, K_PANEL, x + 3, y0 + cell - 3, cell - 6, 2, S_ICE);
        f.text(5520 + i, x + 5, y0 + 2, 14, S_HUD_KEY, String((i + 1) % 10));
        if (c.tint < 0) continue;
        // The item's picture where it has one, else its colour and the first letters of its name.
        if (!f.picture(key + 1, x + 5, y0 + 6, cell - 10, cell - 10, S_SLOT_TEXT, c.id ?? "")) {
          if (cell >= 46) f.add(key + 1, K_PANEL, x + 4, y0 + 17, cell - 8, lineHeight(S_HUD_KEY), S_HUD_KEY).text = fitText(c.label, cell - 8, S_HUD_KEY);
          else f.add(key + 1, K_PANEL, x + cell / 2 - 4, y0 + 12, 8, 8, S_ICE).tint = c.tint;
        }
        f.text(key + 2, x + 2, y0 + cell - small - 2, cell - 7, S_HUD_COUNT, c.number);
      }
      if (m.ammo !== "") f.text(KEY_AMMO, Math.max(left, W / 2 - 150), y0 - lineHeight(S_PROMPT) - 3, Math.min(300, right - left), S_PROMPT, m.ammo);
      if (m.buildSays !== "") f.text(KEY_BUILD_SAYS, Math.max(left, W / 2 - 150), y0 - (m.ammo !== "" ? 2 : 1) * (lineHeight(S_PROMPT) + 3), Math.min(300, right - left), S_PROMPT, fitText(m.buildSays, Math.min(300, right - left), S_PROMPT));
    }
  },
};
