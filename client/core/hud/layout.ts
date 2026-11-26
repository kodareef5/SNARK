// Where the HUD's shared places are on a canvas: its corners, the column in the top left, the minimap, and the panel
// under the minimap that a vehicle's instruments and the jet fuel share. Worked out once a build, into one object.

import { JET_FULL_SUIT } from "../../../shared/sim/character.ts";
import type { HudModel } from "../hud.ts";
import type { Settings } from "../settings.ts";
import { lineHeight, type UiFrame } from "../ui/nodes.ts";
import { S_HUD_KEY, S_TEXT } from "../ui/style.ts";
import type { TouchPlan } from "../ui/touch.ts";
import { MINIMAP_SIZE } from "./minimap.ts";
import type { HudLayout } from "./widget.ts";

/** The panel under the minimap: a car's instruments, a helicopter's and a boat's. */
export const DASH_W = 212;
export const DASH_H = 106;
export const HELI_W = 244;
export const HELI_H = 178;
export const BOAT_W = 254;
export const BOAT_H = 178;
/** A jet's glass: the helicopter's width, two lines taller for its weapons. */
export const JET_GLASS_H = 214;
export const MARGIN = 12;
export const HOTBAR_CELL = 52;

/**
 * The band the HUD leaves free for the chat box: below what shows under the crosshair, and above the hotbar, the
 * ammo line and the status line. It does not move as those come and go.
 */
export function chatBand(f: UiFrame, _m: HudModel): { top: number; bottom: number } {
  const beside = hotbarLeft(f, 10) - 132 > Math.min(285, f.width * .22) + MARGIN;
  const bottom = f.height - f.bottom - MARGIN - (beside ? 8 : HOTBAR_CELL + 30);
  return { top: Math.max(f.top + MARGIN, Math.min(f.height / 2 + 32, bottom - 178)), bottom };
}

/** A hotbar cell's side for `slots` of them on this canvas, the bar's left edge and its top. */
export function hotbarCell(f: UiFrame, slots: number): number {
  return Math.min(HOTBAR_CELL, Math.floor((f.width - f.left - f.right - MARGIN * 2 - 3 * (slots - 1)) / slots));
}
export function hotbarLeft(f: UiFrame, slots: number): number {
  return Math.round((f.width - (slots * (hotbarCell(f, slots) + 3) - 3)) / 2);
}
export function hotbarBottom(f: UiFrame): number {
  return f.height - f.bottom - lineHeight(S_HUD_KEY) - 1;
}
export function hotbarTop(f: UiFrame, slots: number): number {
  return hotbarBottom(f) - hotbarCell(f, slots);
}

/** A canvas narrower than this is a phone's upright, or a window as narrow: the minimap keeps the top right, and the readout keeps left of it. */
export const NARROW = 640;

/** The jet fuel panel's width, and its height while jets are worn and no vehicle's instruments show: taller for the full suit's line, which a narrow canvas leaves out. */
export const JET_W = 210;
const jetHeight = (f: UiFrame, m: HudModel): number => (m.jetGear && !m.vehicle?.active ? (m.jetGear === JET_FULL_SUIT && f.width >= NARROW ? 83 : 63) : 0);

/**
 * The panel under the minimap: a vehicle's instruments, or else the jet fuel while jets are worn. Its width and height,
 * and whether it stands under the bar instead (`aside`): on a phone on its side the thumb's cluster has the place under
 * the minimap, which a vehicle's instruments leave it. A finger's buttons say what they do, so by touch a vehicle's
 * panel loses its lines of keys and says what to touch (`lean`).
 */
function panelOf(f: UiFrame, m: HudModel, touch: TouchPlan | null): { w: number; h: number; lean: boolean; aside: boolean } | null {
  const dash = m.vehicle?.active ? m.vehicle : null, lean = touch !== null, jet = jetHeight(f, m);
  if (!dash && !jet) return null;
  return {
    w: !dash ? JET_W : dash.board && !lean ? 236 : dash.rotor || dash.jet ? HELI_W : dash.boat ? BOAT_W : DASH_W,
    h: (!dash ? jet : dash.board ? (lean ? 69 : 78) : lean ? (dash.rotor ? 124 : dash.jet ? 142 : dash.boat ? 106 : 88) : dash.rotor ? HELI_H : dash.jet ? JET_GLASS_H : dash.boat ? BOAT_H : DASH_H) + (dash?.thrusters && !dash.rotor && !dash.boat ? 26 : 0),
    lean,
    aside: dash !== null && touch !== null && f.width > f.height,
  };
}

/** The top of the HUD's column in the top left, where the readout starts: by touch under the bar, and under the panel where it stands there. */
function columnTop(f: UiFrame, m: HudModel, touch: TouchPlan | null): number {
  const p = panelOf(f, m, touch);
  return touch ? touch.stackY + (p?.aside ? p.h + 8 : 0) : f.top + MARGIN + 47;
}

const layout: HudLayout = {
  options: { minimap: true, diagnostics: false, vitalLabels: false, compass: true }, controls: true, inspect: false, touch: null,
  W: 0, H: 0, left: 0, right: 0, foot: 0, MAP: 0, mapX: 0, mapY: 0, mapTools: false, top: 0, lh: 0, readout: false, readW: 0, columnFoot: 0, voiceY: 0,
  dash: null, panel: false, dashX: 0, dashY: 0, dashW: 0, dashH: 0, lean: false, aside: false,
};

/** The layout of this build. The same object each time. */
export function layoutHud(f: UiFrame, m: HudModel, options: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels" | "compass">, controls: boolean, inspect: boolean, touch: TouchPlan | null): HudLayout {
  const at = layout;
  const W = (at.W = f.width);
  at.H = f.height;
  at.options = options; at.controls = controls; at.inspect = inspect; at.touch = touch;
  const left = (at.left = f.left + MARGIN), right = (at.right = W - f.right - MARGIN);
  at.foot = f.height - f.bottom - MARGIN;
  const MAP = (at.MAP = touch ? touch.map : Math.round(Math.max(92, Math.min(MINIMAP_SIZE + 26, (right - left) * .24))));
  const panel = panelOf(f, m, touch);
  at.dash = m.vehicle?.active ? m.vehicle : null;
  at.panel = panel !== null;
  at.dashW = panel?.w ?? DASH_W; at.dashH = panel?.h ?? DASH_H; at.lean = panel?.lean ?? false;
  const aside = (at.aside = panel?.aside ?? false);
  const top = (at.top = columnTop(f, m, touch));
  const lh = (at.lh = lineHeight(S_TEXT));
  // The readout, and the voice's lines under it. On a narrow canvas the readout keeps left of the minimap.
  const readout = (at.readout = options.diagnostics);
  at.readW = Math.min(right - left - (W < NARROW && options.minimap ? MAP + 8 : 0), 400);
  const columnFoot = (at.columnFoot = readout ? top + (inspect ? m.readout.length * lh : 19) + 4 : top);
  at.voiceY = columnFoot;
  at.mapX = right - MAP;
  const mapY = (at.mapY = f.top + MARGIN);
  at.mapTools = controls && (inspect || (touch !== null && !options.minimap));
  // The car's instruments sit under the minimap and its clock, or in the minimap's place while it is hidden. A
  // helicopter's and a boat's are taller, with their state and their keys. The jet fuel stands there too, without a
  // vehicle. On a narrow canvas they stand under the readout where it has the minimap's width.
  let dashY = aside && touch ? touch.stackY : options.minimap ? mapY + MAP + 28 : mapY;
  if (W < NARROW && !aside) dashY = Math.max(dashY, options.minimap ? 0 : readout ? columnFoot + 8 : top);
  at.dashY = dashY;
  at.dashX = aside ? left : right - at.dashW;
  return at;
}
