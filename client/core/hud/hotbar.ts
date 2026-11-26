// The hotbar at the bottom, and over it the line that says what is loaded (the action widget fills that line).

import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { FLAG_BLUEPRINT, HOTBAR_SLOTS, QUALITY_MUL, type Inventory } from "../../../shared/sim/items.ts";
import { K_PANEL, fitText, lineHeight } from "../ui/nodes.ts";
import { line } from "../ui/dock-visual.ts";
import { glass } from "../ui/skin.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_HUD_KEY, S_PROMPT, S_SLOT_TEXT } from "../ui/style.ts";
import { hotbarCell, hotbarLeft, hotbarTop } from "./layout.ts";
import { band, type HudWidget } from "./widget.ts";

/** The line that says what is loaded. */
export const KEY_AMMO = 35;
/** The line over it with a piece in hand: what the preview says of the piece. */
export const KEY_BUILD_SAYS = 9480;
/** Per hotbar slot: its place, its picture and its count. The dock draws the slots' hit boxes (ui/field-dock.ts). */
export const KEY_HOTBAR = 40;
/** The held slot's glow, each slot's number, and the rail with its dividers and condition lines. */
export const KEY_HOTBAR_LIT = 9460;
export const KEY_HOTBAR_NUMBER = 9470;
const KEY_HOTBAR_RAIL = 17400;

/** label is the first letters of the item's name. number is a count, or the rounds loaded. */
export interface HotbarCell {
  label: string;
  /** 0xRRGGBB, or -1 for an empty slot. */
  tint: number;
  number: string;
  /** The item's content id, which its picture is found by (ui/hud.ts). */
  id?: string;
  name?: string;
  condition?: number;
}

export interface HotbarModel {
  /** Empty for a body that has no hotbar. `held` is the slot in hand, or -1. */
  hotbar: HotbarCell[];
  held: number;
  /** The loaded ammunition, the rounds in the weapon, and those carried. "" for a weapon that takes none. */
  ammo: string;
  /** With a piece in hand, what the preview says of it: how well it would stand. */
  buildSays: string;
  /** The slot under a thumb sliding along the dock, or -1: the dock sets it. Each slot grows toward it by touch. */
  dockPreview: number;
  dockSizes: number[];
  /** The frame's time, for the growth and for the dock's own. */
  hotbarNow: number;
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
      cell.name = "";
      cell.condition = -1;
      continue;
    }
    cell.id = def.id;
    const name = def.label ?? def.id.slice(def.id.indexOf(":") + 1);
    const c = (def.color ?? 15) * 4;
    cell.name = name;
    cell.label = name.slice(0, 4);
    const slot = first + i, quality = inv!.quality[slot]!;
    const capacity = def.use?.holds?.water ?? Math.round(reg.uses[item]! * (QUALITY_MUL[quality] ?? 1));
    cell.condition = capacity && !(inv!.flags[slot]! & FLAG_BLUEPRINT) ? Math.min(1, inv!.dur[slot]! / capacity) : -1;
    cell.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
    const count = inv!.count[first + i]!, left = i === held && item === spendItem ? Math.max(0, count - spend) : count;
    cell.number = count > 1 ? String(left) : def.weapon?.ammo ? String(inv!.loaded[first + i]) : "";
  }
}

export const HOTBAR: HudWidget<HotbarModel> = {
  name: "hotbar",
  bands: [band(KEY_AMMO, 1), band(KEY_HOTBAR, 30), band(KEY_HOTBAR_LIT, 10), band(KEY_HOTBAR_NUMBER, 10), band(KEY_BUILD_SAYS, 1), band(KEY_HOTBAR_RAIL, 50)],
  make: () => ({ hotbar: [], held: -1, ammo: "", buildSays: "", dockPreview: -1, dockSizes: new Array<number>(HOTBAR_SLOTS).fill(0), hotbarNow: 0 }),
  fill(m, c) {
    const now = c.nowMs ?? m.hotbarNow, step = Math.min(1, Math.max(0, now - m.hotbarNow) / 170);
    m.hotbarNow = now;
    for (let i = 0; i < m.dockSizes.length; i++) {
      const target = m.dockPreview < 0 ? 0 : Math.max(0, 1 - Math.abs(i - m.dockPreview) * .58), size = m.dockSizes[i]!;
      m.dockSizes[i] = Math.abs(target - size) < .012 ? target : size + (target - size) * Math.min(1, step * 2.5);
    }
    const a = c.frame;
    if (a) fillHotbar(m, a.alive ? c.session.inventory : null, c.session.held, a.reg, a.palette, a.spendItem, a.spend);
  },
  // The hotbar stays at the bottom even when a message, a vital or chat changes.
  build(f, m, at) {
    const { W, left, right } = at;
    if (m.hotbar.length > 0) {
      const cell = hotbarCell(f, m.hotbar.length);
      const x0 = hotbarLeft(f, m.hotbar.length);
      const end = x0 + m.hotbar.length * (cell + 3) - 3;
      const bottom = hotbarTop(f, m.hotbar.length) + cell;
      const touch = at.touch !== null;
      const y0 = bottom - (touch ? 23 : cell);
      const railHeight = touch ? 16 : cell - 3;
      glass(f, KEY_HOTBAR_RAIL, x0-3, bottom-railHeight, end-x0+6, railHeight, touch ? .60 : .76);
      line(f, KEY_HOTBAR_RAIL + 1, x0, bottom-1, end-x0, 1, 0xc4e5f4, .71);
      for (let i = 0; i < m.hotbar.length; i++) {
        const c = m.hotbar[i]!;
        const x = x0 + i * (cell + 3);
        const key = KEY_HOTBAR + i * 3, selected = i === m.held;
        const magnify = touch ? m.dockSizes[i] ?? 0 : 0;
        const size = touch ? (selected ? 23 : 17) + magnify * 32 : cell - 7;
        const center = x + cell/2;
        f.add(key, K_PANEL, x, bottom-cell, cell, cell, S_HUD_HIT);
        if (selected) {
          line(f, KEY_HOTBAR_LIT+i, x+1, bottom-Math.min(cell,size+2), cell-2, Math.min(cell,size+2), 0x2476aa, .42);
          line(f, KEY_HOTBAR_RAIL+10+i, x+1, bottom-2, cell-2, 2, 0xa3e6ff, 1);
        }
        if (i && !touch) line(f, KEY_HOTBAR_RAIL+20+i, x-2, y0+9, 1, cell-13, 0x87adc2, .30);
        if (!touch) f.text(KEY_HOTBAR_NUMBER+i, x+3, y0, 15, S_HUD_KEY, String((i+1)%10));
        if (c.tint >= 0) {
          if (!f.picture(key+1, center-size/2, bottom-size-2, size, size, S_SLOT_TEXT, c.id ?? "")) {
            const fallback = f.add(key+1, K_PANEL, x+4, bottom-Math.min(18,size)-2, cell-8, Math.min(18,size), S_HUD_KEY);
            fallback.text = fitText(c.label, cell-8, S_HUD_KEY);
            fallback.tint = c.tint;
          }
          if (!touch || magnify > .5) f.text(key+2, x+2, bottom-lineHeight(S_SLOT_TEXT)-2, cell-7, S_HUD_COUNT, c.number);
          if (!touch && c.condition !== undefined && c.condition >= 0) {
            line(f, KEY_HOTBAR_RAIL+30+i, x+5, bottom-5, cell-10, 1, 0x102434, .9);
            line(f, KEY_HOTBAR_RAIL+40+i, x+5, bottom-5, (cell-10)*c.condition, 1, c.condition < .2 ? 0xe7b67d : 0xabcfdd, .8);
          }
        }
      }
      if (m.ammo !== "") f.text(KEY_AMMO, Math.max(left, W / 2 - 150), y0 - lineHeight(S_PROMPT) - 3, Math.min(300, right - left), S_PROMPT, m.ammo);
      if (m.buildSays !== "") f.text(KEY_BUILD_SAYS, Math.max(left, W / 2 - 150), y0 - (m.ammo !== "" ? 2 : 1) * (lineHeight(S_PROMPT) + 3), Math.min(300, right - left), S_PROMPT, fitText(m.buildSays, Math.min(300, right - left), S_PROMPT));
    }
  },
};
