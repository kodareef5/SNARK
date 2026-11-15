import { ACTION_DRAW, ACTION_NONE, MAX_MARKERS, MINIMAP_SIZE, type HudModel, type MarkerKind } from "../hud.ts";
import { WHOLE_MAP } from "../tactical.ts";
import { K_BAR, K_IMAGE, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUFF, S_DARK, S_TORPOR, S_BANNER, S_CROSS, S_FOOD, S_FRAME, S_HEALTH, S_LABEL, S_MARK_CREATURE, S_MARK_DEATH, S_MARK_PLAYER, S_MARK_SELF, S_MARK_SPAWN, S_OXYGEN, S_PROMPT, S_SLOT, S_SLOT_TEXT, S_STAMINA, S_SWATCH, S_TEXT, S_TITLE, S_WATER } from "./style.ts";

export const KEY_READOUT = 1;
export const KEY_MINIMAP_FRAME = 10;
export const KEY_MINIMAP = 11;
export const KEY_CLOCK = 12;
/** Per vital: its label, then its bar. */
export const KEY_VITAL = 80;
/** The dark panel over the world while unconscious. */
export const KEY_OUT = 36;
/** The voice status line under the readout. KEY_TALKER is one name per survivor being heard. */
export const KEY_VOICE = 37;
export const KEY_TALKER = 70;
/** One mark per buff. */
export const KEY_BUFF = 180;
export const KEY_CROSS = 30;
export const KEY_STATUS = 31;
export const KEY_BANNER = 32;
export const KEY_PROMPT = 33;
/** The bar that fills as a bow is drawn or a reload runs, and the line that says what is loaded. */
export const KEY_ACTION = 34;
export const KEY_AMMO = 35;
/** Per hotbar slot: its box, its swatch, its number. */
export const KEY_HOTBAR = 40;
/** One mark for each marker on the minimap, MAX_MARKERS at most. */
export const KEY_MARKER = 4000;
/** Small driving instruments below the minimap, outside the chat and survivor's vitals. */
export const KEY_VEHICLE = 3500;
/** Indices of the minimap's picture and the map screen's in the frame's image table. */
export const IMAGE_MINIMAP = 1;
export const IMAGE_MAP = 2;

export { MINIMAP_SIZE };
const MARGIN = 12;
const VITAL_STYLE: Record<string, number> = { health: S_HEALTH, stamina: S_STAMINA, food: S_FOOD, water: S_WATER, oxygen: S_OXYGEN, torpor: S_TORPOR };
export const MARKER_STYLE: Record<MarkerKind, number> = { self: S_MARK_SELF, mate: S_MARK_SELF, tame: S_MARK_SELF, player: S_MARK_PLAYER, creature: S_MARK_CREATURE, spawn: S_MARK_SPAWN, death: S_MARK_DEATH };
/** Colours of the kinds that have no style of their own. */
export const MARKER_TINT: Partial<Record<MarkerKind, number>> = { mate: 0x6fd0ff, tame: 0xe8d24a };

const HOTBAR_CELL = 34;

/**
 * The band the HUD leaves free for the chat box: below what shows under the crosshair, and above the hotbar, the
 * ammo line and the status line. It does not move as those come and go.
 */
export function chatBand(f: UiFrame, m: HudModel): { top: number; bottom: number } {
  const rowH = lineHeight(S_LABEL) + 1;
  const lift = (f.width < 700 ? m.vitals.length * rowH + 6 : 0) + lineHeight(S_TEXT) + 4;
  return { top: f.height / 2 + 92, bottom: f.height - MARGIN - HOTBAR_CELL - lift - lineHeight(S_PROMPT) - 3 - 4 };
}

export function buildHud(f: UiFrame, m: HudModel): void {
  const W = f.width;
  const H = f.height;
  const lh = lineHeight(S_TEXT);
  // The dark panel goes first, under everything else.
  if (m.out) f.add(KEY_OUT, K_PANEL, 0, 0, W, H, S_DARK).alpha = 0.82;
  for (let i = 0; i < m.readout.length; i++) f.text(KEY_READOUT + i, MARGIN, 10 + i * lh, Math.min(W - MARGIN * 2, 400), S_TEXT, m.readout[i]!);
  if (m.voice !== "") {
    // A voice state is in capitals and is lit. Anything else is a sentence saying what is wrong, drawn plain.
    const live = m.voice === m.voice.toUpperCase();
    const n = f.add(KEY_VOICE, K_PANEL, MARGIN, 10 + m.readout.length * lh + 4, Math.min(W - MARGIN * 2, live ? 96 : 330), lineHeight(S_BUFF) + 4, S_BUFF);
    n.tint = !live ? 0x4a4f58 : m.voice === "MIC OPEN" ? 0x6a7a3a : 0x3c9a4a;
    n.text = m.voice;
  }
  const talkH = lineHeight(S_BUFF) + 4;
  for (let i = 0; i < m.talkers.length && i < 8; i++) {
    const n = f.add(KEY_TALKER + i, K_PANEL, MARGIN, 10 + m.readout.length * lh + 4 + (talkH + 2) * (i + (m.voice !== "" ? 1 : 0)), 170, talkH, S_BUFF);
    n.tint = 0x2f5f8a;
    n.text = m.talkers[i]!;
  }

  // On a narrow canvas the minimap moves below the readout instead of beside it.
  const mapX = W - MARGIN - MINIMAP_SIZE;
  const mapY = W < 640 ? 10 + m.readout.length * lh + 8 : MARGIN;
  f.add(KEY_MINIMAP_FRAME, K_PANEL, mapX - 1, mapY - 1, MINIMAP_SIZE + 2, MINIMAP_SIZE + 2, S_FRAME);
  f.add(KEY_MINIMAP, K_IMAGE, mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE, S_FRAME).image = IMAGE_MINIMAP;
  // The minimap is a window on the map. The model lists the most important marker first, so drawing from the last keeps those on top.
  const view = m.chart ? m.chart.mini.view : WHOLE_MAP;
  let shown = 0;
  for (let i = Math.min(m.markers.length, MAX_MARKERS) - 1; i >= 0; i--) {
    const k = m.markers[i]!;
    const u = (k.u - view.u0) / view.du;
    const v = (k.v - view.v0) / view.dv;
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    f.add(KEY_MARKER + shown++, K_PANEL, mapX + u * MINIMAP_SIZE - 2, mapY + v * MINIMAP_SIZE - 2, 4, 4, MARKER_STYLE[k.kind]).tint = MARKER_TINT[k.kind] ?? -1;
  }
  f.text(KEY_CLOCK, mapX, mapY + MINIMAP_SIZE + 4, MINIMAP_SIZE, S_LABEL, m.clock);
  if (m.vehicle?.active) {
    const v = m.vehicle, width = 212, x = W - MARGIN - width, y = mapY + MINIMAP_SIZE + 28;
    f.add(KEY_VEHICLE, K_PANEL, x, y, width, 104, S_FRAME).alpha = .9;
    f.text(KEY_VEHICLE + 1, x + 10, y + 7, 132, S_TITLE, `${Math.round(v.speed * 3.6).toString().padStart(3, "0")} km/h`);
    f.text(KEY_VEHICLE + 2, x + 158, y + 8, 44, S_TITLE, v.gear < 0 ? "R" : v.gear === 0 ? "N" : `D${v.gear}`);
    f.add(KEY_VEHICLE + 3, K_BAR, x + 10, y + 34, width - 20, 4, S_STAMINA).value = Math.min(1, v.rpm / v.redline);
    f.text(KEY_VEHICLE + 4, x + 10, y + 42, 100, S_LABEL, `${Math.round(v.rpm / 100) * 100} rpm`);
    f.text(KEY_VEHICLE + 5, x + 118, y + 42, 84, S_LABEL, `Fuel ${Math.round(v.fuel * 100)}%`);
    f.text(KEY_VEHICLE + 6, x + 10, y + 63, width - 20, S_LABEL, v.handbrake ? "HANDBRAKE" : v.brake > 0 ? "BRAKING" : "W/S drive · A/D steer");
    f.text(KEY_VEHICLE + 7, x + 10, y + 82, width - 20, S_LABEL, "Space brake · E exit");
  }

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
  // Buffs go in a column above the vitals. A buff with negative seconds shows no time.
  const buffW = barW + labelW;
  const buffH = lineHeight(S_BUFF) + 2;
  let by = H - MARGIN - m.vitals.length * rowH - 6 - buffH;
  for (let i = 0; i < m.buffs.length && i < 16 && by > 200; i++) {
    const b = m.buffs[i]!;
    const n = f.add(KEY_BUFF + i, K_PANEL, W - MARGIN - buffW, by, buffW, buffH, S_BUFF);
    n.tint = b.tint;
    n.text = b.seconds < 0 ? b.label : `${b.label}  ${b.seconds}s`;
    by -= buffH + 2;
  }

  // On a narrow canvas the hotbar sits above the vitals, which would be in its way.
  if (m.hotbar.length > 0) {
    const cell = HOTBAR_CELL;
    const gap = 3;
    const total = m.hotbar.length * (cell + gap) - gap;
    const x0 = Math.round((W - total) / 2);
    const lift = (W < 700 ? m.vitals.length * rowH + 6 : 0) + (m.status !== "" ? lh + 4 : 0);
    const y0 = H - MARGIN - cell - lift;
    const small = lineHeight(S_SLOT_TEXT);
    for (let i = 0; i < m.hotbar.length; i++) {
      const c = m.hotbar[i]!;
      const x = x0 + i * (cell + gap);
      const box = f.add(KEY_HOTBAR + i * 3, K_PANEL, x, y0, cell, cell, S_SLOT);
      if (i === m.held) box.tint = 0x5a6a7a;
      if (c.tint < 0) continue;
      // The item's picture where it has one, else its colour and the first letters of its name.
      if (!f.picture(KEY_HOTBAR + i * 3 + 1, x + 2, y0 + 2, cell - 4, cell - 4, S_SLOT_TEXT, c.id ?? "")) {
        const swatch = f.add(KEY_HOTBAR + i * 3 + 1, K_PANEL, x + 3, y0 + 3, cell - 6, cell - 6 - small, S_SWATCH);
        swatch.tint = c.tint;
        swatch.text = c.label;
      }
      f.text(KEY_HOTBAR + i * 3 + 2, x + 2, y0 + cell - small, cell - 4, S_SLOT_TEXT, c.number);
    }
    if (m.ammo !== "") f.text(KEY_AMMO, Math.max(MARGIN, W / 2 - 150), y0 - lineHeight(S_PROMPT) - 3, Math.min(300, W - MARGIN * 2), S_PROMPT, m.ammo);
  }

  if (m.crosshair) {
    f.add(KEY_CROSS, K_PANEL, W / 2 - 2, H / 2 - 2, 4, 4, S_CROSS);
    if (m.prompt !== "") f.text(KEY_PROMPT, W / 2 - 150, H / 2 + 14, 300, S_PROMPT, m.prompt.slice(0, 38));
    if (m.actionKind !== ACTION_NONE) f.add(KEY_ACTION, K_BAR, W / 2 - 40, H / 2 + 38, 80, 5, m.actionKind === ACTION_DRAW ? S_STAMINA : S_OXYGEN).value = m.actionFraction;
  }
  // The status line sits left of the vitals, or above them on a narrow canvas.
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
