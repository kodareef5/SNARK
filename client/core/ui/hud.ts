import { ACTION_DRAW, ACTION_NONE, MAX_MARKERS, MINIMAP_SIZE, type HudModel, type MarkerKind } from "../hud.ts";
import type { Settings } from "../settings.ts";
import { filledVital } from "./vitals.ts";
import { glass } from "./skin.ts";
import { KEY_MENU_OPEN, menuButton } from "./menu.ts";
import { MAX_DOTS } from "../render/laser.ts";
import { WHOLE_MAP } from "../tactical.ts";
import { K_BAR, K_BUTTON, K_IMAGE, K_PANEL, fitText, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUFF, S_DARK, S_BANNER, S_CROSS, S_FRAME, S_LABEL, S_MARK_CREATURE, S_MARK_DEATH, S_MARK_PLAYER, S_MARK_SELF, S_MARK_SPAWN, S_OXYGEN, S_PROMPT, S_SLOT_TEXT, S_STAMINA, S_TEXT } from "./style.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_HUD_KEY, S_ICE, S_MENU_FOCUS, S_MENU_MAIN, S_MENU_NOTE, S_WARNING } from "./style.ts";

export const KEY_READOUT = 1;
export const KEY_MINIMAP_FRAME = 10;
export const KEY_MINIMAP = 11;
export const KEY_CLOCK = 12;
export const KEY_MINIMAP_TOGGLE = 5390;
export const KEY_MINIMAP_OUT = 5391;
export const KEY_MINIMAP_IN = 5392;
/** Per vital: its optional label, then its filled icon. */
export const KEY_VITAL = 80;
/** The dark panel over the world while unconscious. */
export const KEY_OUT = 36;
/** The voice status line under the readout. KEY_TALKER is one name per survivor being heard. */
export const KEY_VOICE = 37;
export const KEY_TALKER = 70;
/** One mark per buff. */
export const KEY_BUFF = 180;
export const KEY_CROSS = 30;
/** Four strokes about the crosshair at the held weapon's cone. */
export const KEY_CONE = 24;
/** A holo-scope's tint over the view; a scope's reticle (eight panels); one mark per laser dot, MAX_DOTS at most. */
export const KEY_TINT = 38;
export const KEY_SIGHT = 5000;
export const KEY_DOT = 5010;
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
const DASH_W = 212;
const DASH_H = 106;
/** Indices of the minimap's picture and the map screen's in the frame's image table. */
export const IMAGE_MINIMAP = 1;
export const IMAGE_MAP = 2;

export { MINIMAP_SIZE };
const MARGIN = 12;
export const MARKER_STYLE: Record<MarkerKind, number> = { self: S_MARK_SELF, mate: S_MARK_SELF, tame: S_MARK_SELF, player: S_MARK_PLAYER, creature: S_MARK_CREATURE, spawn: S_MARK_SPAWN, death: S_MARK_DEATH };
/** Colours of the kinds that have no style of their own. */
export const MARKER_TINT: Partial<Record<MarkerKind, number>> = { mate: 0x6fd0ff, tame: 0xe8d24a };

export const HOTBAR_CELL = 52;
/** The cone's strokes: their length, and how near the dot they come, in canvas units. */
const CONE_STROKE = 6;
const CONE_MIN = 5;
/** A holo-scope's night tint, a laser's dot and its size, in canvas units. */
const HOLO_GREEN = 0x2f9a3c;
const LASER_RED = 0xff2a22;
const DOT = 4;

/**
 * A scope's reticle, the German post (Scope Attachment): the view masked to a square tube, thick posts in from the left,
 * the right and the bottom that stop short of the middle, and a fine line across between the side posts. Eight panels.
 */
function buildReticle(f: UiFrame, W: number, H: number): void {
  const side = Math.min(W, H);
  const x0 = (W - side) / 2;
  const y0 = (H - side) / 2;
  const cx = W / 2;
  const cy = H / 2;
  const gap = side * 0.06;
  const post = Math.max(3, Math.round(side * 0.012));
  const fine = 1;
  let k = KEY_SIGHT;
  // The mask outside the tube, on whichever sides there is room.
  if (x0 > 0) {
    f.add(k++, K_PANEL, 0, 0, x0, H, S_DARK).alpha = 0.96;
    f.add(k++, K_PANEL, W - x0, 0, x0, H, S_DARK).alpha = 0.96;
  }
  if (y0 > 0) {
    f.add(k++, K_PANEL, x0, 0, side, y0, S_DARK).alpha = 0.96;
    f.add(k++, K_PANEL, x0, H - y0, side, y0, S_DARK).alpha = 0.96;
  }
  f.add(k++, K_PANEL, x0, cy - post / 2, cx - gap - x0, post, S_DARK).alpha = 0.95;
  f.add(k++, K_PANEL, cx + gap, cy - post / 2, x0 + side - cx - gap, post, S_DARK).alpha = 0.95;
  f.add(k++, K_PANEL, cx - post / 2, cy, post, y0 + side - cy, S_DARK).alpha = 0.95;
  f.add(k++, K_PANEL, cx - gap, cy - fine / 2, gap * 2, fine, S_DARK).alpha = 0.9;
}

/**
 * The band the HUD leaves free for the chat box: below what shows under the crosshair, and above the hotbar, the
 * ammo line and the status line. It does not move as those come and go.
 */
export function chatBand(f: UiFrame, _m: HudModel): { top: number; bottom: number } {
  return { top: f.height / 2 + 92, bottom: f.height - MARGIN - HOTBAR_CELL - (f.width < 1100 ? 102 : 20) };
}

export function buildHud(f: UiFrame, m: HudModel, options: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels"> & { touchFirst?: boolean } = { minimap: true, diagnostics: false, vitalLabels: false }, controls = true, inspect = false): void {
  const W = f.width;
  const H = f.height;
  const lh = lineHeight(S_TEXT);
  // The dark panel goes first, under everything else, and a holo-scope's tint with it.
  if (m.out) f.add(KEY_OUT, K_PANEL, 0, 0, W, H, S_DARK).alpha = 0.82;
  else if (m.tint > 0) {
    const n = f.add(KEY_TINT, K_PANEL, 0, 0, W, H, S_DARK);
    n.tint = HOLO_GREEN;
    n.alpha = m.tint;
  }
  // Laser dots lie on the world, so under everything else; a scope's reticle over them, and under the readouts.
  for (let i = 0; i < m.dotCount && i < MAX_DOTS; i++) {
    const d = m.dots[i]!;
    if (d.u < 0 || d.u > 1 || d.v < 0 || d.v > 1 || !(d.alpha > 0.02)) continue;
    const n = f.add(KEY_DOT + i, K_PANEL, d.u * W - DOT / 2, d.v * H - DOT / 2, DOT, DOT, S_CROSS);
    n.tint = LASER_RED;
    n.alpha = d.alpha;
  }
  if (m.scope && m.banner === "") buildReticle(f, W, H);
  if (controls && options.touchFirst) menuButton(f, KEY_MENU_OPEN, MARGIN, MARGIN, 44, "Esc");
  if (options.diagnostics) for (let i = 0; i < m.readout.length; i++) f.text(KEY_READOUT + i, MARGIN, MARGIN + i * lh, Math.min(W - MARGIN * 2, 400), S_TEXT, fitText(m.readout[i]!, Math.min(W - MARGIN * 2, 400), S_TEXT));
  const voiceY = options.diagnostics ? MARGIN + m.readout.length * lh + 4 : MARGIN;
  if (m.voice !== "") {
    // A voice state is in capitals and is lit. Anything else is a sentence saying what is wrong, drawn plain.
    const live = m.voice === m.voice.toUpperCase();
    const n = f.add(KEY_VOICE, K_PANEL, MARGIN, voiceY, Math.min(W - MARGIN * 2, live ? 96 : 330), lineHeight(S_BUFF) + 4, S_BUFF);
    n.tint = !live ? 0x4a4f58 : m.voice === "MIC OPEN" ? 0x6a7a3a : 0x3c9a4a;
    n.text = m.voice;
  }
  const talkH = lineHeight(S_BUFF) + 4;
  for (let i = 0; i < m.talkers.length && i < 8; i++) {
    const n = f.add(KEY_TALKER + i, K_PANEL, MARGIN, voiceY + (talkH + 2) * (i + (m.voice !== "" ? 1 : 0)), 170, talkH, S_BUFF);
    n.tint = 0x2f5f8a;
    n.text = m.talkers[i]!;
  }

  // On a narrow canvas the minimap moves below the readout instead of beside it.
  const mapX = W - MARGIN - MINIMAP_SIZE;
  const mapY = options.diagnostics && W < 640 ? voiceY + 8 : MARGIN;
  const mapTools = controls && (inspect || options.touchFirst);
  if (options.minimap) {
    const mapTop = mapY;
    glass(f, KEY_MINIMAP_FRAME, mapX - 2, mapTop - 2, MINIMAP_SIZE + 4, MINIMAP_SIZE + 4);
    const picture = f.add(KEY_MINIMAP, K_IMAGE, mapX, mapTop, MINIMAP_SIZE, MINIMAP_SIZE, S_FRAME);
    picture.image = IMAGE_MINIMAP;
    picture.alpha = .82;
    // The minimap is a window on the map. The model lists the most important marker first, so drawing from the last keeps those on top.
    const view = m.chart ? m.chart.mini.view : WHOLE_MAP;
    let shown = 0;
    for (let i = Math.min(m.markers.length, MAX_MARKERS) - 1; i >= 0; i--) {
      const k = m.markers[i]!;
      const u = (k.u - view.u0) / view.du;
      const v = (k.v - view.v0) / view.dv;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      f.add(KEY_MARKER + shown++, K_PANEL, mapX + Math.max(2, Math.min(MINIMAP_SIZE - 2, u * MINIMAP_SIZE)) - 2, mapTop + Math.max(2, Math.min(MINIMAP_SIZE - 2, v * MINIMAP_SIZE)) - 2, 4, 4, MARKER_STYLE[k.kind]).tint = MARKER_TINT[k.kind] ?? -1;
    }
    if (inspect || options.diagnostics) f.text(KEY_CLOCK, mapX, mapTop + MINIMAP_SIZE + 4, MINIMAP_SIZE, S_LABEL, m.clock);
    if (mapTools) for (let i = 0; i < 2; i++) {
      const b = f.add(KEY_MINIMAP_OUT + i, K_BUTTON, mapX + i * 36, mapY + MINIMAP_SIZE - 32, 32, 32, S_HUD_HIT);
      b.text = i === 0 ? "−" : "+";
      b.label = i === 0 ? "Zoom out" : "Zoom in";
      b.interactive = true;
    }
  }

  // The car's instruments sit under the minimap and its clock, or in the minimap's place while it is hidden.
  const dash = m.vehicle?.active ? m.vehicle : null;
  const dashY = options.minimap ? mapY + MINIMAP_SIZE + 28 : mapY;
  if (mapTools) {
    const beside = dash && !options.minimap ? DASH_W + 4 : 0;
    const toggle = f.add(KEY_MINIMAP_TOGGLE, K_BUTTON, W - MARGIN - 32 - beside, mapY + (options.minimap ? MINIMAP_SIZE - 32 : 0), 32, 32, S_HUD_HIT);
    toggle.text = "◇";
    toggle.label = options.minimap ? "Hide minimap" : "Show minimap";
    toggle.interactive = true;
  }
  if (dash) {
    const x = W - MARGIN - DASH_W, y = dashY;
    glass(f, KEY_VEHICLE, x, y, DASH_W, DASH_H);
    f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(dash.speed * 3.6).toString().padStart(3, "0"));
    f.text(KEY_VEHICLE + 7, x + 64, y + 15, 40, S_MENU_NOTE, "km/h");
    f.text(KEY_VEHICLE + 1, x + DASH_W - 52, y + 6, 40, S_MENU_MAIN, dash.gear < 0 ? "R" : dash.gear === 0 ? "N" : `D${dash.gear}`);
    f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, DASH_W - 24, 3, S_MENU_FOCUS).value = Math.min(1, dash.rpm / dash.redline);
    f.text(KEY_VEHICLE + 3, x + 12, y + 47, 100, S_MENU_NOTE, `${Math.round(dash.rpm / 100) * 100} rpm`);
    f.text(KEY_VEHICLE + 4, x + 118, y + 47, DASH_W - 130, S_MENU_NOTE, `Fuel ${Math.round(dash.fuel * 100)}%`);
    const warn = dash.handbrake ? "HANDBRAKE" : dash.brake > 0 ? "BRAKING" : "";
    f.text(KEY_VEHICLE + 5, x + 12, y + 65, DASH_W - 24, warn ? S_WARNING : S_MENU_NOTE, warn || "W/S drive · A/D steer");
    f.text(KEY_VEHICLE + 6, x + 12, y + 83, DASH_W - 24, S_MENU_NOTE, "Space brake · E exit");
  }

  const barW = 150;
  const labelW = 62;
  const vitalY = H - MARGIN - 38 - (W < 640 ? HOTBAR_CELL + 8 : 0);
  for (let i = 0; i < m.vitals.length; i++) {
    const v = m.vitals[i]!;
    if ((v.id === "oxygen" && v.fraction >= 1) || (v.id === "torpor" && v.fraction <= 0)) continue;
    const x = W - MARGIN - 38;
    const y = vitalY - i * 43;
    filledVital(f, KEY_VITAL + i * 2 + 1, i, x, y, 32, v.fraction, v.label, controls);
    if (options.vitalLabels || inspect) f.text(KEY_VITAL + i * 2, x - 126, y + 8, 116, S_HUD_COUNT, `${v.label}  ${Math.round(v.fraction * 100)}%`);
  }
  // Buffs stay in a column above the bottom row. A buff with negative seconds shows no time.
  const buffW = barW + labelW;
  const buffH = lineHeight(S_BUFF) + 2;
  let by = H - MARGIN - HOTBAR_CELL - 64 - buffH;
  const buffTop = dash ? Math.max(200, dashY + DASH_H + 4) : 200;
  for (let i = 0; i < m.buffs.length && i < 16 && by > buffTop; i++) {
    const b = m.buffs[i]!;
    const n = f.add(KEY_BUFF + i, K_PANEL, Math.max(MARGIN, W - MARGIN - buffW - 58), by, buffW, buffH, S_BUFF);
    n.tint = b.tint;
    n.text = b.seconds < 0 ? b.label : `${b.label}  ${b.seconds}s`;
    by -= buffH + 2;
  }

  // The hotbar stays at the bottom even when a message, a vital or chat changes.
  if (m.hotbar.length > 0) {
    const cell = Math.min(HOTBAR_CELL, Math.floor((W - MARGIN * 2 - 3 * (m.hotbar.length - 1)) / m.hotbar.length));
    const gap = 3;
    const total = m.hotbar.length * (cell + gap) - gap;
    const x0 = Math.round((W - total) / 2);
    const y0 = H - MARGIN - cell;
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
    if (m.ammo !== "") f.text(KEY_AMMO, Math.max(MARGIN, W / 2 - 150), y0 - lineHeight(S_PROMPT) - 3, Math.min(300, W - MARGIN * 2), S_PROMPT, m.ammo);
  }

  // Through a scope its reticle (built under the rest) stands in for the crosshair. A holo-scope's crosshair shows whatever
  // the rules say of the crosshair, coloured by what it is on.
  if (!(m.scope && m.banner === "") && (m.crosshair || (m.holo && m.banner === ""))) {
    const cross = f.add(KEY_CROSS, K_PANEL, W / 2 - 2, H / 2 - 2, 4, 4, S_CROSS);
    if (m.holo) cross.tint = m.crossTint;
    if (m.cone >= 0) {
      // The strokes stand where the cone's edge is on the screen, and never on the dot.
      const r = Math.min(H / 2 - CONE_STROKE, Math.max(CONE_MIN, (m.cone * H) / 2));
      f.add(KEY_CONE, K_PANEL, W / 2 - 1, H / 2 - r - CONE_STROKE, 2, CONE_STROKE, S_CROSS);
      f.add(KEY_CONE + 1, K_PANEL, W / 2 - 1, H / 2 + r, 2, CONE_STROKE, S_CROSS);
      f.add(KEY_CONE + 2, K_PANEL, W / 2 - r - CONE_STROKE, H / 2 - 1, CONE_STROKE, 2, S_CROSS);
      f.add(KEY_CONE + 3, K_PANEL, W / 2 + r, H / 2 - 1, CONE_STROKE, 2, S_CROSS);
    }
  }
  if (m.crosshair) {
    if (m.prompt !== "") f.text(KEY_PROMPT, W / 2 - 150, H / 2 + 14, 300, S_PROMPT, fitText(m.prompt, 300, S_PROMPT));
    if (m.actionKind !== ACTION_NONE) f.add(KEY_ACTION, K_BAR, W / 2 - 40, H / 2 + 38, 80, 5, m.actionKind === ACTION_DRAW ? S_STAMINA : S_OXYGEN).value = m.actionFraction;
  }
  if (m.status !== "") f.text(KEY_STATUS, MARGIN, H / 2 - 100, W - MARGIN * 2, S_TEXT, m.status.slice(0, Math.floor((W - MARGIN * 2) / 7.8)));
  if (m.banner !== "") {
    const bw = 240;
    const n = f.add(KEY_BANNER, K_PANEL, W / 2 - bw / 2, 56, bw, lineHeight(S_BANNER) + 8, S_BANNER);
    n.text = m.banner;
  }
}
