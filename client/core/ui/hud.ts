// The heads-up display as a screen: readout, vitals, minimap, crosshair.

import type { HudModel } from "../hud.ts";
import { K_BAR, K_IMAGE, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BANNER, S_CROSS, S_FOOD, S_FRAME, S_HEALTH, S_LABEL, S_MARK_CREATURE, S_MARK_DEATH, S_MARK_PLAYER, S_MARK_SELF, S_MARK_SPAWN, S_OXYGEN, S_PROMPT, S_STAMINA, S_TEXT, S_WATER } from "./style.ts";

export const KEY_READOUT = 1;
export const KEY_MINIMAP_FRAME = 10;
export const KEY_MINIMAP = 11;
export const KEY_CLOCK = 12;
export const KEY_VITAL = 20;
export const KEY_CROSS = 30;
export const KEY_STATUS = 31;
export const KEY_BANNER = 32;
export const KEY_PROMPT = 33;
export const KEY_MARKER = 100;
/** Index of the minimap picture in the frame's image table. */
export const IMAGE_MINIMAP = 1;

export const MINIMAP_SIZE = 160;
const MARGIN = 12;
const MAX_MARKERS = 64;
const VITAL_STYLE: Record<string, number> = { health: S_HEALTH, stamina: S_STAMINA, food: S_FOOD, water: S_WATER, oxygen: S_OXYGEN };
const MARKER_STYLE: Record<string, number> = { self: S_MARK_SELF, player: S_MARK_PLAYER, creature: S_MARK_CREATURE, spawn: S_MARK_SPAWN, death: S_MARK_DEATH };

export function buildHud(f: UiFrame, m: HudModel): void {
  const W = f.width;
  const H = f.height;
  const lh = lineHeight(S_TEXT);
  for (let i = 0; i < m.readout.length; i++) f.text(KEY_READOUT + i, MARGIN, 10 + i * lh, Math.min(W - MARGIN * 2, 400), S_TEXT, m.readout[i]!);

  // On a narrow canvas the minimap moves below the readout instead of beside it.
  const mapX = W - MARGIN - MINIMAP_SIZE;
  const mapY = W < 640 ? 10 + m.readout.length * lh + 8 : MARGIN;
  f.add(KEY_MINIMAP_FRAME, K_PANEL, mapX - 1, mapY - 1, MINIMAP_SIZE + 2, MINIMAP_SIZE + 2, S_FRAME);
  f.add(KEY_MINIMAP, K_IMAGE, mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE, S_FRAME).image = IMAGE_MINIMAP;
  const count = Math.min(m.markers.length, MAX_MARKERS);
  // The model lists the local player last; drawing in order keeps it on top.
  for (let i = m.markers.length - count; i < m.markers.length; i++) {
    const k = m.markers[i]!;
    f.add(KEY_MARKER + i - (m.markers.length - count), K_PANEL, mapX + k.u * MINIMAP_SIZE - 2, mapY + k.v * MINIMAP_SIZE - 2, 4, 4, MARKER_STYLE[k.kind] ?? S_MARK_SELF);
  }
  f.text(KEY_CLOCK, mapX, mapY + MINIMAP_SIZE + 4, MINIMAP_SIZE, S_LABEL, m.clock);

  // Vitals, bottom right: a label and a bar each.
  const barW = 150;
  const labelW = 62;
  const rowH = lineHeight(S_LABEL) + 1;
  let y = H - MARGIN - m.vitals.length * rowH;
  for (let i = 0; i < m.vitals.length; i++) {
    const v = m.vitals[i]!;
    f.text(KEY_VITAL + i * 2, W - MARGIN - barW - labelW, y, labelW, S_LABEL, v.label);
    f.add(KEY_VITAL + i * 2 + 1, K_BAR, W - MARGIN - barW, y + 5, barW, 8, VITAL_STYLE[v.id] ?? S_HEALTH).value = v.fraction;
    y += rowH;
  }

  if (m.crosshair) {
    f.add(KEY_CROSS, K_PANEL, W / 2 - 2, H / 2 - 2, 4, 4, S_CROSS);
    if (m.prompt !== "") f.text(KEY_PROMPT, W / 2 - 150, H / 2 + 14, 300, S_PROMPT, m.prompt.slice(0, 38));
  }
  // The status line sits left of the vitals, or above them where there is no room beside.
  if (m.status !== "") {
    if (W < 640) f.text(KEY_STATUS, MARGIN, H - MARGIN - m.vitals.length * rowH - lh - 4, W - MARGIN * 2, S_TEXT, m.status);
    else f.text(KEY_STATUS, MARGIN, H - MARGIN - lh, W - MARGIN * 2 - barW - labelW - 8, S_TEXT, m.status);
  }
  if (m.banner !== "") {
    const bw = 240;
    const n = f.add(KEY_BANNER, K_PANEL, W / 2 - bw / 2, 56, bw, lineHeight(S_BANNER) + 8, S_BANNER);
    n.text = m.banner;
  }
}
