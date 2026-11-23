// Where the HUD's shared places are on a canvas: its corners, the column in the top left, the minimap, and the panel
// under the minimap that a vehicle's instruments and the jet fuel share. Worked out once a build, into one object.

import { JET_FULL_SUIT } from "../../../shared/sim/character.ts";
import type { HudModel } from "../hud.ts";
import type { Settings } from "../settings.ts";
import { lineHeight, type UiFrame } from "../ui/nodes.ts";
import { S_TEXT } from "../ui/style.ts";
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
export const MARGIN = 12;
export const HOTBAR_CELL = 52;

/**
 * The band the HUD leaves free for the chat box: below what shows under the crosshair, and above the hotbar, the
 * ammo line and the status line. It does not move as those come and go.
 */
export function chatBand(f: UiFrame, _m: HudModel): { top: number; bottom: number } {
  return { top: f.height / 2 + 92, bottom: f.height - f.bottom - MARGIN - HOTBAR_CELL - (f.width < 1100 ? 102 : 20) };
}

/** A hotbar cell's side for `slots` of them on this canvas, the bar's left edge and its top. */
export function hotbarCell(f: UiFrame, slots: number): number {
  return Math.min(HOTBAR_CELL, Math.floor((f.width - f.left - f.right - MARGIN * 2 - 3 * (slots - 1)) / slots));
}
export function hotbarLeft(f: UiFrame, slots: number): number {
  return Math.round((f.width - (slots * (hotbarCell(f, slots) + 3) - 3)) / 2);
}
export function hotbarTop(f: UiFrame, slots: number): number {
  return f.height - f.bottom - MARGIN - hotbarCell(f, slots);
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
    w: !dash ? JET_W : dash.rotor ? HELI_W : dash.boat ? BOAT_W : DASH_W,
    h: (!dash ? jet : lean ? (dash.rotor ? 124 : dash.boat ? 106 : 88) : dash.rotor ? HELI_H : dash.boat ? BOAT_H : DASH_H) + (dash?.thrusters && !dash.rotor && !dash.boat ? 26 : 0),
    lean,
    aside: dash !== null && touch !== null && f.width > f.height,
  };
}

/** The top of the HUD's column in the top left, where the readout starts: by touch under the bar, and under the panel where it stands there. */
function columnTop(f: UiFrame, m: HudModel, touch: TouchPlan | null): number {
  const p = panelOf(f, m, touch);
  return touch ? touch.stackY + (p?.aside ? p.h + 8 : 0) : f.top + MARGIN;
}

/**
 * What the resource monitor's strip is given (ui/monitor.ts reserve): the top of the HUD's column, the minimap's side
 * (0 while it is hidden), and the room the panel under the minimap takes under the strip, where on a narrow canvas the
 * strip stands across under the minimap and the panel under it.
 */
export function stripRoom(f: UiFrame, m: HudModel, touch: TouchPlan | null, minimap: boolean): { top: number; map: number; below: number } {
  const p = panelOf(f, m, touch);
  return { top: columnTop(f, m, touch), map: minimap ? (touch ? touch.map : MINIMAP_SIZE) : 0, below: p && !p.aside && f.width < NARROW ? p.h + 8 : 0 };
}

const layout: HudLayout = {
  options: { minimap: true, diagnostics: false, vitalLabels: false, compass: true }, controls: true, inspect: false, touch: null,
  W: 0, H: 0, left: 0, right: 0, foot: 0, MAP: 0, mapX: 0, mapY: 0, mapTools: false, top: 0, lh: 0, readout: false, readW: 0, columnFoot: 0, voiceY: 0,
  dash: null, panel: false, dashX: 0, dashY: 0, dashW: 0, dashH: 0, lean: false, aside: false,
};

/** The layout of this build. The same object each time. It tells the model where the monitor's strip starts (`stripY`). */
export function layoutHud(f: UiFrame, m: HudModel, options: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels" | "compass">, controls: boolean, inspect: boolean, touch: TouchPlan | null): HudLayout {
  const at = layout;
  const W = (at.W = f.width);
  at.H = f.height;
  at.options = options; at.controls = controls; at.inspect = inspect; at.touch = touch;
  const left = (at.left = f.left + MARGIN), right = (at.right = W - f.right - MARGIN);
  at.foot = f.height - f.bottom - MARGIN;
  const MAP = (at.MAP = touch ? touch.map : MINIMAP_SIZE);
  const panel = panelOf(f, m, touch);
  at.dash = m.vehicle?.active ? m.vehicle : null;
  at.panel = panel !== null;
  at.dashW = panel?.w ?? DASH_W; at.dashH = panel?.h ?? DASH_H; at.lean = panel?.lean ?? false;
  const aside = (at.aside = panel?.aside ?? false);
  const top = (at.top = columnTop(f, m, touch));
  const lh = (at.lh = lineHeight(S_TEXT));
  // The readout, and under it the resource monitor's strip (ui/monitor.ts), which on a canvas too short for both stands
  // in its place; the voice's lines under them.
  // On a narrow canvas the readout keeps left of the minimap, which keeps its place at the top, and the strip stands across under both.
  const readout = (at.readout = options.diagnostics && !m.stripAlone);
  at.readW = Math.min(right - left - (W < NARROW && options.minimap ? MAP + 8 : 0), 400);
  const columnFoot = (at.columnFoot = readout ? top + m.readout.length * lh + 4 : top);
  at.voiceY = Math.max((m.stripY = columnFoot) + (m.stripH && m.stripH + 6), m.stripFoot && m.stripFoot + 6);
  at.mapX = right - MAP;
  const mapY = (at.mapY = f.top + MARGIN);
  at.mapTools = controls && (inspect || touch !== null);
  // The car's instruments sit under the minimap and its clock, or in the minimap's place while it is hidden. A
  // helicopter's and a boat's are taller, with their state and their keys. The jet fuel stands there too, without a
  // vehicle. On a narrow canvas they stand under the strip across it, and under the readout where it has the minimap's width.
  let dashY = aside && touch ? touch.stackY : options.minimap ? mapY + MAP + 28 : mapY;
  if (W < NARROW && !aside) dashY = Math.max(dashY, m.stripFoot + 8, options.minimap || !readout ? 0 : columnFoot + 8);
  at.dashY = dashY;
  at.dashX = aside ? left : right - at.dashW;
  return at;
}
