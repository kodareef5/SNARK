import { PATROL_LIGHT_MODES } from "../../../shared/sim/vehicle.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { JET_UP, JET_FIST, JET_DASH, JET_CAPACITY, JET_FULL_SUIT, JET_HOVER } from "../../../shared/sim/character.ts";
import { ACTION_DRAW, ACTION_NONE, MAX_MARKERS, MINIMAP_SIZE, type HudModel, type MarkerKind } from "../hud.ts";
import type { Settings } from "../settings.ts";
import { filledVital } from "./vitals.ts";
import { glass } from "./skin.ts";
import { IMAGE_ARROW, arrowSheet, placeArrow } from "./arrow.ts";
import { TAPE_HEIGHT, buildCompass, tapeLayout } from "./compass.ts";
import type { TouchPlan } from "./touch.ts";
import { MAX_DOTS } from "../render/laser.ts";
import { K_BAR, K_BUTTON, K_IMAGE, K_PANEL, fitText, lineHeight, type UiFrame } from "./nodes.ts";
import { S_LENS, S_LENS_TWIN, S_MAGNIFY, S_SPOT_WORD, S_VISOR, S_VISOR_LEFT } from "./style.ts";
import { SHAPE_TWIN, SHAPE_VISOR, TWIN_WIDE, VISOR_WIDE } from "../optics.ts";
import { S_BUFF, S_DARK, S_BANNER, S_CROSS, S_FRAME, S_LABEL, S_MARK_CREATURE, S_MARK_DEATH, S_MARK_PLAYER, S_MARK_SELF, S_MARK_SPAWN, S_OXYGEN, S_PROMPT, S_SLOT_TEXT, S_STAMINA, S_TEXT } from "./style.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_HUD_KEY, S_ICE, S_KEY_SMALL, S_MENU_FOCUS, S_MENU_MAIN, S_MENU_NOTE, S_WARNING } from "./style.ts";

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
/** The scope's shadow across its lens: the lens again where the eye is, and the two strips that move clears (D1077). */
export const KEY_SIGHT_SHADE = 5100;
/** A visor's frame and readouts (D1080). */
export const KEY_VISOR = 5110;
/** The magnification ladder's nodes (D1086), its gap from the window, width and most height. */
export const KEY_MAGNIFY = 5440;
const MAG_GAP = 16;
const MAG_WIDE = 70;
const MAG_TALL = 220;
/** A glass's readouts (D1082). */
export const KEY_GLASS = 5140;
/** A milliradian reticle's lines, marks and words (D1083). */
export const KEY_MIL = 5300;
/** A milliradian, in radians, and the most marks an arm of the reticle has. */
const MIL = 0.001;
const MIL_MARKS = 20;
/** The visor's ink: its frame, its marks and its words. */
const VISOR_INK = 0x7fe6d4;
const SPOT_INK = 0xff6a3d;
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
/** The reader's arrow on the minimap. */
export const KEY_SELF_ARROW = 6590;
/** The arrow's side on a minimap MINIMAP_SIZE across. */
const ARROW_SIZE = 24;
/** Small driving instruments below the minimap, outside the chat and survivor's vitals. */
export const KEY_VEHICLE = 3500;
export const KEY_JET_FUEL = 3520;
const DASH_W = 212;
const DASH_H = 106;
const HELI_W = 244;
const HELI_H = 178;
const BOAT_W = 254;
const BOAT_H = 178;
/** Indices of the minimap's picture and the map screen's in the frame's image table. */
export const IMAGE_MINIMAP = 1;
export const IMAGE_MAP = 2;

export { MINIMAP_SIZE };
const MARGIN = 12;
export const MARKER_STYLE: Record<MarkerKind, number> = { self: S_MARK_SELF, mate: S_MARK_SELF, tame: S_MARK_SELF, player: S_MARK_PLAYER, creature: S_MARK_CREATURE, spawn: S_MARK_SPAWN, death: S_MARK_DEATH, drop: S_MARK_SELF, dropPip: S_MARK_SELF, spotted: S_MARK_CREATURE };
/** Colours of the kinds that have no style of their own. */
export const MARKER_TINT: Partial<Record<MarkerKind, number>> = { mate: 0x6fd0ff, tame: 0xe8d24a, spotted: SPOT_INK };
/** A spotted creature's mark over it in the view (D1082), and its ink. */
export const KEY_SPOT = 5200;
/** Another survivor's glass glinting at the viewer (D1083). */
export const KEY_GLINT = 5230;
const GLINT_INK = 0xfff6d8;
const SPOT_SIDE = 9;

export const HOTBAR_CELL = 52;
/** From one vital to the next in their row by touch: an icon and the room a finger's press of it takes. */
export const VITAL_PITCH = 42;
/** The cone's strokes: their length, and how near the dot they come, in canvas units. */
const CONE_STROKE = 6;
const CONE_MIN = 5;
/** A holo-scope's night tint, a laser's dot and its size, in canvas units. */
const HOLO_GREEN = 0x2f9a3c;
const LASER_RED = 0xff2a22;
const DOT = 4;

/**
 * A scope's reticle, the German post (Scope Attachment): the view masked to its window (D1077), round or two merged
 * lenses, spanning `m.sightShare` of the height; thick posts in from the left, the right and the bottom that stop short
 * of the middle, and a fine line across between the side posts. Where the eye is off the axis the lens is masked again
 * from where the eye is, softer, casting the scope's shadow across it.
 */
function buildReticle(f: UiFrame, W: number, H: number, m: HudModel): void {
  const r = (m.sightShare * H) / 2;
  const twin = m.sightShape === SHAPE_TWIN;
  const bw = twin ? 2 * r * TWIN_WIDE : 2 * r, bh = 2 * r;
  const cx = W / 2, cy = H / 2;
  const x0 = cx - bw / 2, y0 = cy - r;
  const gap = r * 0.12;
  const post = Math.max(3, Math.round(r * 0.024));
  const fine = 1;
  const lens = twin ? S_LENS_TWIN : S_LENS;
  let k = KEY_SIGHT;
  // Outside the lens nothing is drawn (the scene's scissor), so the mask there is whole.
  if (x0 > 0) {
    f.add(k++, K_PANEL, 0, 0, x0, H, S_DARK);
    f.add(k++, K_PANEL, x0 + bw, 0, W - x0 - bw, H, S_DARK);
  }
  if (y0 > 0) {
    f.add(k++, K_PANEL, Math.max(0, x0), 0, Math.min(W, bw), y0, S_DARK);
    f.add(k++, K_PANEL, Math.max(0, x0), y0 + bh, Math.min(W, bw), H - y0 - bh, S_DARK);
  }
  f.add(k++, K_PANEL, x0, y0, bw, bh, lens);
  // Twin lenses are a glass's, not a gun's: no posts, and under them its zoom, range, bearing and a mark just made.
  if (twin && m.glass) {
    const range = m.glassRange < 0 ? "LASING" : m.glassRange > 0 ? `${Math.round(m.glassRange).toLocaleString("en-US")} m` : "---";
    const words = ["", range, m.glassRange > 0 ? Math.round(m.glassBearing).toString().padStart(3, "0") : "", m.glassMarked ? "MARKED" : ""];
    const across = bw / words.length, y = Math.min(H - 20, y0 + bh + 6);
    for (let i = 0; i < words.length; i++) if (words[i] !== "") f.text(KEY_GLASS + i, x0 + across * i, y, across, i === 3 ? S_SPOT_WORD : S_VISOR, words[i]!);
  }
  if (!twin && m.sightMil) buildMils(f, H, cx, cy, r, m);
  else if (!twin) {
    f.add(k++, K_PANEL, x0, cy - post / 2, cx - gap - x0, post, S_DARK).alpha = 0.95;
    f.add(k++, K_PANEL, cx + gap, cy - post / 2, x0 + bw - cx - gap, post, S_DARK).alpha = 0.95;
    f.add(k++, K_PANEL, cx - post / 2, cy, post, y0 + bh - cy, S_DARK).alpha = 0.95;
    f.add(k++, K_PANEL, cx - gap, cy - fine / 2, gap * 2, fine, S_DARK).alpha = 0.9;
  }
  const ox = m.sightOffX * r, oy = m.sightOffY * r;
  if (Math.abs(ox) + Math.abs(oy) < 0.5) return;
  const shade = 0.8;
  f.add(KEY_SIGHT_SHADE, K_PANEL, x0 + ox, y0 + oy, bw, bh, lens).alpha = shade;
  // The strips of the lens's box that the shadow's box moved off, which lie outside the shadow's hole.
  if (Math.abs(ox) >= 0.5) f.add(KEY_SIGHT_SHADE + 1, K_PANEL, ox > 0 ? x0 : x0 + bw + ox, y0, Math.abs(ox), bh, S_DARK).alpha = shade;
  if (Math.abs(oy) >= 0.5) f.add(KEY_SIGHT_SHADE + 2, K_PANEL, x0, oy > 0 ? y0 : y0 + bh + oy, bw, Math.abs(oy), S_DARK).alpha = shade;
}

/**
 * A scope's reticle in milliradians, in the first focal plane (D1083): fine lines across the lens and a mark each
 * milliradian along them (each five where they would crowd, each ten where those would), longer each fifth, spaced by the
 * view's field, so they grow with the zoom and a thing's size in them gives its range at any zoom (metres = size × 1000 /
 * marks). Under the lens, the zoom and the zero.
 */
function buildMils(f: UiFrame, H: number, cx: number, cy: number, r: number, m: HudModel): void {
  const perMil = (H / (2 * Math.tan(m.sightFov / 2))) * MIL;
  const step = perMil >= 6 ? 1 : perMil * 5 >= 6 ? 5 : 10;
  let k = KEY_MIL;
  f.add(k++, K_PANEL, cx - r, cy - 0.5, 2 * r, 1, S_DARK).alpha = 0.9;
  f.add(k++, K_PANEL, cx - 0.5, cy - r, 1, 2 * r, S_DARK).alpha = 0.9;
  for (let n = step, marks = 0; n * perMil < r * 0.92 && marks < MIL_MARKS; n += step, marks++) {
    const at = n * perMil, long = n % 5 === 0 ? 5 : 3;
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (sx !== 0) f.add(k++, K_PANEL, cx + sx * at - 0.75, cy - long, 1.5, long * 2, S_DARK).alpha = 0.9;
      else f.add(k++, K_PANEL, cx - long, cy + sy * at - 0.75, long * 2, 1.5, S_DARK).alpha = 0.9;
    }
  }
  const y = Math.min(H - 20, cy + r + 6);
  f.text(KEY_MIL + 98, cx - r / 2, y, r, S_VISOR, m.sightZero > 0 ? `ZERO ${m.sightZero} m` : "ZERO ---");
}

/** The right edge of a sight's window, and its half height, in the frame's units (optics.ts windowBox, as the HUD draws it). */
function windowRight(W: number, H: number, m: HudModel): { right: number; half: number } {
  const half = (m.sightShare * H) / 2;
  const wide = m.sightShape === SHAPE_TWIN ? half * TWIN_WIDE : m.sightShape === SHAPE_VISOR ? Math.min(W / 2, half * VISOR_WIDE) : half;
  return { right: W / 2 + wide, half };
}

/** "N.Nx" under ten, "Nx" from ten. */
const times = (z: number): string => `${z >= 10 ? z.toFixed(0) : z.toFixed(1)}x`;

/**
 * The magnification ladder (D1086), beside a sight's window: its zoom now in words, and for one that zooms a ladder from
 * its least at the foot to its most at the head, spaced on the logarithm, a rung at each 1, 2 and 5 of a power of ten and
 * at its ends, the zoom now marked on it. Outside the window where there is room, else just inside it.
 */
function buildMagnify(f: UiFrame, W: number, H: number, m: HudModel): void {
  const { right, half } = windowRight(W, H, m);
  const lo = m.magnifyMin, hi = Math.max(m.magnifyMax, lo);
  const x = right + MAG_GAP + MAG_WIDE <= W - 8 ? right + MAG_GAP : right - MAG_GAP - MAG_WIDE;
  const tall = Math.min(MAG_TALL, half * 1.2), top = H / 2 - tall / 2;
  const at = (z: number): number => (hi > lo ? top + tall * (1 - Math.log(z / lo) / Math.log(hi / lo)) : H / 2);
  let k = KEY_MAGNIFY;
  const ink = (nx: number, ny: number, nw: number, nh: number, alpha = 0.85): void => {
    const n = f.add(k++, K_PANEL, nx, ny, nw, nh, S_CROSS);
    n.tint = VISOR_INK;
    n.alpha = alpha;
  };
  if (hi > lo) {
    ink(x, top, 1.5, tall, 0.5);
    const rungs = [lo, hi];
    for (let p = 1; p <= hi; p *= 10) for (const s of [1, 2, 5]) if (s * p > lo * 1.08 && s * p < hi / 1.08) rungs.push(s * p);
    for (const z of rungs) {
      if (k >= KEY_MAGNIFY + 30) break;
      const y = at(z), major = z === lo || z === hi || String(z).startsWith("1");
      ink(x, y - 0.75, major ? 9 : 5, 1.5, 0.6);
      if (major && Math.abs(y - at(Math.min(hi, Math.max(lo, m.magnify)))) > 22) f.text(k++, x + 12, y - 7, MAG_WIDE - 12, S_VISOR_LEFT, times(z)).alpha = 0.55;
    }
  }
  const y = at(Math.min(hi, Math.max(lo, m.magnify)));
  ink(x - 4, y - 1.5, 14, 3, 1);
  f.text(KEY_MAGNIFY + 39, x + 13, y - 12, MAG_WIDE, S_MAGNIFY, times(m.magnify));
}

/**
 * A helmet's visor (D1080): the view masked to its window, a wide box that narrows to a slit as it zooms; corner marks, a
 * small cross in its middle, and under the window its zoom (and DIGITAL past its glass), its view, its heading and how
 * far off its middle is on.
 */
function buildVisor(f: UiFrame, W: number, H: number, m: HudModel): void {
  const h = (m.sightShare * H) / 2, w = Math.min(W / 2, h * VISOR_WIDE);
  const x0 = W / 2 - w, y0 = H / 2 - h, x1 = W / 2 + w, y1 = H / 2 + h;
  let k = KEY_VISOR;
  if (x0 > 0) {
    f.add(k++, K_PANEL, 0, 0, x0, H, S_DARK);
    f.add(k++, K_PANEL, x1, 0, W - x1, H, S_DARK);
  }
  f.add(k++, K_PANEL, x0, 0, x1 - x0, y0, S_DARK);
  f.add(k++, K_PANEL, x0, y1, x1 - x0, H - y1, S_DARK);
  const ink = (x: number, y: number, bw: number, bh: number): void => void (f.add(k++, K_PANEL, x, y, bw, bh, S_CROSS).tint = VISOR_INK);
  const arm = Math.min(28, h * 0.4), t = 2;
  for (const [cx, sx] of [[x0, 1], [x1, -1]] as const) {
    for (const [cy, sy] of [[y0, 1], [y1, -1]] as const) {
      ink(sx > 0 ? cx : cx - arm, sy > 0 ? cy : cy - t, arm, t);
      ink(sx > 0 ? cx : cx - t, sy > 0 ? cy : cy - arm, t, arm);
    }
  }
  ink(W / 2 - 7, H / 2 - 0.5, 14, 1);
  ink(W / 2 - 0.5, H / 2 - 7, 1, 14);
  const range = m.visorRange > 0 ? `${Math.round(m.visorRange).toLocaleString("en-US")} m` : "---";
  const words = [m.visorDigital ? "DIGITAL" : "OPTICAL", m.visorMode === 1 ? "NIGHT" : m.visorMode === 2 ? "HEAT" : "PLAIN", `${Math.round(m.heading).toString().padStart(3, "0")}`, range];
  const across = (x1 - x0) / words.length, y = Math.min(H - 20, y1 + 6);
  for (let i = 0; i < words.length; i++) f.text(k++, x0 + across * i, y, across, S_VISOR, words[i]!);
}

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
const NARROW = 640;

/** The jet fuel panel's width, and its height while jets are worn and no vehicle's instruments show: taller for the full suit's line, which a narrow canvas leaves out. */
const JET_W = 210;
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

/**
 * The HUD, inside the canvas's insets. With `touch` (ui/touch.ts touchPlan) it makes room for a finger's controls: the
 * vitals stand in a row at the top, the stack in the top left starts under the bar, the minimap is the plan's size and
 * the prompt loses its key.
 */
export function buildHud(f: UiFrame, m: HudModel, options: Pick<Settings, "minimap" | "diagnostics" | "vitalLabels" | "compass"> = { minimap: true, diagnostics: false, vitalLabels: false, compass: true }, controls = true, inspect = false, touch: TouchPlan | null = null): void {
  const W = f.width;
  const H = f.height;
  // The corners anchored things keep to, and the minimap's side.
  const left = f.left + MARGIN, right = W - f.right - MARGIN, foot = H - f.bottom - MARGIN;
  const MAP = touch ? touch.map : MINIMAP_SIZE;
  const dash = m.vehicle?.active ? m.vehicle : null, panel = panelOf(f, m, touch);
  const dashW = panel?.w ?? DASH_W, dashH = panel?.h ?? DASH_H, lean = panel?.lean ?? false, aside = panel?.aside ?? false;
  const top = columnTop(f, m, touch);
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
  if (m.scope && m.banner === "") buildReticle(f, W, H, m);
  if (m.visor && m.banner === "") buildVisor(f, W, H, m);
  if (m.magnify > 0 && m.banner === "" && (m.scope || m.visor)) buildMagnify(f, W, H, m);
  // Another's glass glinting at the viewer.
  for (let i = 0; i < m.glintCount && i < 4; i++) {
    const g = m.glints[i]!, side = 4 + 8 * g.alpha;
    const n = f.add(KEY_GLINT + i, K_PANEL, g.u * W - side / 2, g.v * H - side / 2, side, side, S_CROSS);
    n.tint = GLINT_INK;
    n.alpha = 0.35 + 0.65 * g.alpha;
  }
  // What the tribe spotted, over it where it stands in view.
  for (let i = 0; i < m.spotCount && i < 8; i++) {
    const s = m.spots[i]!;
    const n = f.add(KEY_SPOT + i, K_PANEL, s.u * W - SPOT_SIDE / 2, s.v * H - SPOT_SIDE / 2, SPOT_SIDE, SPOT_SIDE, S_CROSS);
    n.tint = SPOT_INK;
    n.alpha = 0.9;
  }
  // The readout, and under it the resource monitor's strip (ui/monitor.ts), which on a canvas too short for both stands
  // in its place; the voice's lines under them.
  // On a narrow canvas the readout keeps left of the minimap, which keeps its place at the top, and the strip stands across under both.
  const readout = options.diagnostics && !m.stripAlone, readW = Math.min(right - left - (W < NARROW && options.minimap ? MAP + 8 : 0), 400);
  if (readout) for (let i = 0; i < m.readout.length; i++) f.text(KEY_READOUT + i, left, top + i * lh, readW, S_TEXT, fitText(m.readout[i]!, readW, S_TEXT));
  const columnFoot = readout ? top + m.readout.length * lh + 4 : top;
  const voiceY = Math.max((m.stripY = columnFoot) + (m.stripH && m.stripH + 6), m.stripFoot && m.stripFoot + 6);
  if (m.voice !== "") {
    // A voice state is in capitals and is lit. Anything else is a sentence saying what is wrong, drawn plain.
    const live = m.voice === m.voice.toUpperCase();
    const n = f.add(KEY_VOICE, K_PANEL, left, voiceY, Math.min(right - left, live ? 96 : 330), lineHeight(S_BUFF) + 4, S_BUFF);
    n.tint = !live ? 0x4a4f58 : m.voice === "MIC OPEN" ? 0x6a7a3a : 0x3c9a4a;
    n.text = m.voice;
  }
  const talkH = lineHeight(S_BUFF) + 4;
  for (let i = 0; i < m.talkers.length && i < 8; i++) {
    const n = f.add(KEY_TALKER + i, K_PANEL, left, voiceY + (talkH + 2) * (i + (m.voice !== "" ? 1 : 0)), 170, talkH, S_BUFF);
    n.tint = 0x2f5f8a;
    n.text = m.talkers[i]!;
  }

  const mapX = right - MAP;
  const mapY = f.top + MARGIN;
  const mapTools = controls && (inspect || touch !== null);
  if (options.minimap) {
    const mapTop = mapY;
    glass(f, KEY_MINIMAP_FRAME, mapX - 2, mapTop - 2, MAP + 4, MAP + 4);
    const picture = f.add(KEY_MINIMAP, K_IMAGE, mapX, mapTop, MAP, MAP, S_FRAME);
    picture.image = IMAGE_MINIMAP;
    picture.alpha = .82;
    // The minimap is a window on the map, and its markers are put on its picture. The model lists the most important marker
    // first, so drawing from the last keeps those on top.
    const view = m.chart?.mini.view;
    let shown = 0;
    for (let i = Math.min(m.markers.length, MAX_MARKERS) - 1; view && i >= 0; i--) {
      const k = m.markers[i]!;
      const u = (k.u - view.u0) / view.du;
      const v = (k.v - view.v0) / view.dv;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const x = mapX + Math.max(2, Math.min(MAP - 2, u * MAP)), y = mapTop + Math.max(2, Math.min(MAP - 2, v * MAP));
      // The reader is an arrow the way it faces, on top of the rest.
      if (k.kind === "self") {
        const side = Math.round((ARROW_SIZE * MAP) / MINIMAP_SIZE);
        f.images[IMAGE_ARROW] ??= arrowSheet();
        placeArrow(f.add(KEY_SELF_ARROW, K_IMAGE, x - side / 2, y - side / 2, side, side, S_FRAME), m.dial.heading);
        continue;
      }
      // A drop told of on the compass alone is not on the map, the small one either.
      if (k.kind === "dropPip") continue;
      f.add(KEY_MARKER + shown++, K_PANEL, x - 2, y - 2, 4, 4, MARKER_STYLE[k.kind]).tint = (k.tint ?? -1) >= 0 ? k.tint! : (MARKER_TINT[k.kind] ?? -1);
    }
    if (inspect || options.diagnostics) f.text(KEY_CLOCK, mapX, mapTop + MAP + 4, MAP, S_LABEL, m.clock);
    if (mapTools) for (let i = 0; i < 2; i++) {
      const b = f.add(KEY_MINIMAP_OUT + i, K_BUTTON, mapX + i * 36, mapY + MAP - 32, 32, 32, S_HUD_HIT);
      b.text = i === 0 ? "−" : "+";
      b.label = i === 0 ? "Zoom out" : "Zoom in";
      b.interactive = true;
    }
  }

  // The compass in the middle of the top, between what holds its corners, while the view is the body's own.
  m.compassBottom = 0;
  if (options.compass && !m.bare && !m.out && !m.orbit && !((m.scope || m.visor) && m.banner === "")) {
    // What holds the top left: by touch the bar, else the readout and the voice's lines where they show.
    let held = touch ? touch.topEnd : left - 8;
    if (readout) held = Math.max(held, left + Math.min(right - left, 400));
    if (m.stripH) held = Math.max(held, left + m.stripW);
    if (m.voice !== "") held = Math.max(held, left + Math.min(right - left, m.voice === m.voice.toUpperCase() ? 96 : 330));
    if (m.talkers.length > 0) held = Math.max(held, left + 170);
    const at = tapeLayout(f, held, options.minimap || touch ? mapX - 2 : right - (mapTools ? 36 : 0) + 8);
    const degrees = inspect || options.diagnostics;
    if (at) {
      buildCompass(f, m, at, degrees);
      m.compassBottom = at.y + TAPE_HEIGHT + 8 + (degrees ? lineHeight(S_LABEL) : 0);
    }
  }

  // The car's instruments sit under the minimap and its clock, or in the minimap's place while it is hidden. A
  // helicopter's and a boat's are taller, with their state and their keys. The jet fuel stands there too, without a
  // vehicle. On a narrow canvas they stand under the strip across it, and under the readout where it has the minimap's width.
  let dashY = aside && touch ? touch.stackY : options.minimap ? mapY + MAP + 28 : mapY;
  if (W < NARROW && !aside) dashY = Math.max(dashY, m.stripFoot + 8, options.minimap || !readout ? 0 : columnFoot + 8);
  const dashX = aside ? left : right - dashW;
  if (mapTools) {
    const beside = dash && !options.minimap ? dashW + 4 : 0;
    const toggle = f.add(KEY_MINIMAP_TOGGLE, K_BUTTON, right - 32 - beside, mapY + (options.minimap ? MAP - 32 : 0), 32, 32, S_HUD_HIT);
    toggle.text = "◇";
    toggle.label = options.minimap ? "Hide minimap" : "Show minimap";
    toggle.interactive = true;
  }
  if (m.jetGear && !dash) {
    const width = JET_W, x = dashX, y = dashY + (mapTools && !options.minimap && !aside ? 36 : 0);
    const left = Math.max(0, JET_CAPACITY - m.jetSpent);
    const status = m.jetThrust === JET_UP ? "Vertical burst" : m.jetThrust === JET_DASH ? "Greave dash" : m.jetThrust === JET_FIST ? "Gauntlet lunge" : m.jetThrust === JET_HOVER ? "Level flight" : m.jetThrust ? "Climbing" :
      m.jetGrounded && m.jetSpent ? "Recharging" : !left ? "Empty · land to recharge" : touch ? "Hold Jump, stick at its rim to hover" : "Hold Space · add Shift to hover";
    const linked = m.jetGear === JET_FULL_SUIT && W >= NARROW;
    glass(f, KEY_JET_FUEL, x, y, width, dashH);
    f.text(KEY_JET_FUEL + 1, x + 10, y + 6, width - 20, S_HUD_COUNT, `Jet fuel   ${(left / TICK_RATE).toFixed(1)} s`);
    f.add(KEY_JET_FUEL + 2, K_BAR, x + 10, y + 29, width - 20, 6, left <= 2 * TICK_RATE ? S_WARNING : S_OXYGEN).value = left / JET_CAPACITY;
    f.text(KEY_JET_FUEL + 3, x + 10, y + 39, width - 20, S_MENU_NOTE, status);
    if (linked) f.text(KEY_JET_FUEL + 4, x + 10, y + 59, width - 20, S_MENU_NOTE, "Full suit · 2× recharge");
  }
  if (dash && !dash.rotor && !dash.boat) {
    const x = dashX, y = dashY;
    glass(f, KEY_VEHICLE, x, y, DASH_W, dashH);
    f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(dash.speed * 3.6).toString().padStart(3, "0"));
    f.text(KEY_VEHICLE + 7, x + 64, y + 15, 40, S_MENU_NOTE, "km/h");
    f.text(KEY_VEHICLE + 1, x + DASH_W - 52, y + 6, 40, S_MENU_MAIN, dash.gear < 0 ? "R" : dash.gear === 0 ? "N" : `D${dash.gear}`);
    f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, DASH_W - 24, 3, S_MENU_FOCUS).value = Math.min(1, dash.rpm / dash.redline);
    f.text(KEY_VEHICLE + 3, x + 12, y + 47, 100, S_MENU_NOTE, `${Math.round(dash.rpm / 100) * 100} rpm`);
    f.text(KEY_VEHICLE + 4, x + 118, y + 47, DASH_W - 130, S_MENU_NOTE, `Fuel ${Math.round(dash.fuel * 100)}%`);
    const warn = dash.flooding > .04 ? `TAKING WATER ${Math.round(dash.flooding * 100)}%` : dash.engineCondition <= .08 ? "ENGINE DAMAGED" : dash.handbrake ? "HANDBRAKE" : dash.brake > 0 ? "BRAKING" : "";
    if (warn || !lean) f.text(KEY_VEHICLE + 5, x + 12, y + 65, DASH_W - 24, warn ? S_WARNING : S_MENU_NOTE, warn || "W/S drive · A/D steer");
    if (lean) { if (!warn && dash.lightMode >= 0) f.text(KEY_VEHICLE + 6, x + 12, y + 65, DASH_W - 24, S_MENU_NOTE, `Lights · ${PATROL_LIGHT_MODES[dash.lightMode]}`); }
    else f.text(KEY_VEHICLE + 6, x + 12, y + 83, DASH_W - 24, S_MENU_NOTE, dash.flooding > .04 && dash.engineCondition <= .08 ? "E exit · Push ashore to repair" : dash.engineCondition <= .08 ? "F service · Repair engine" : dash.lightMode >= 0 ? `K / R3 lights · ${PATROL_LIGHT_MODES[dash.lightMode]}` : dash.thrusters ? "Shift boost · Q flip (+WASD)" : "Space brake · E exit");
    if (dash.thrusters) {
      // Two gauges a thruster car adds under its keys: each fills as its cooldown runs out, and a move with none shows lit.
      const row = y + (lean ? 83 : 101), half = (DASH_W - 30) / 2;
      const gauge = (k: number, at: number, name: string, ready: number, firing: boolean): void => {
        const full = ready < 0 || ready >= 1;
        f.text(KEY_VEHICLE + k, at, row, half, firing ? S_WARNING : full ? S_MENU_FOCUS : S_MENU_NOTE, firing ? `${name} !` : name);
        f.add(KEY_VEHICLE + k + 1, K_BAR, at, row + 16, half, 4, firing ? S_WARNING : full ? S_OXYGEN : S_MENU_FOCUS).value = ready < 0 ? 1 : Math.max(0, Math.min(1, ready));
      };
      gauge(12, x + 12, lean ? "Boost" : "Boost · Shift", dash.boostReady, dash.boosting);
      gauge(14, x + 18 + half, lean ? "Flip" : "Flip · Q", dash.flipReady, dash.bursting);
    }
  }
  if (dash?.rotor) {
    const v = dash, x = dashX, y = dashY, line = HELI_W - 24;
    glass(f, KEY_VEHICLE, x, y, HELI_W, dashH);
    f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(v.speed * 3.6).toString().padStart(3, "0"));
    f.text(KEY_VEHICLE + 10, x + 64, y + 15, 40, S_MENU_NOTE, "km/h");
    f.text(KEY_VEHICLE + 1, x + HELI_W - 104, y + 15, 92, v.recovery ? S_WARNING : S_MENU_NOTE, v.recovery ? "RECOVERING" : v.direct ? "DIRECT" : "ASSISTED");
    f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, line, 3, S_MENU_FOCUS).value = Math.min(1, v.rpm / v.redline);
    f.text(KEY_VEHICLE + 3, x + 12, y + 47, line, S_MENU_NOTE, `Rotor ${Math.round(v.rpm)} rpm · Fuel ${Math.round(v.fuel * 100)}%`);
    f.text(KEY_VEHICLE + 4, x + 12, y + 65, line, S_MENU_NOTE, `${v.altitude.toFixed(1)} m AGL · ${v.vertical >= 0 ? "+" : ""}${v.vertical.toFixed(1)} m/s`);
    f.text(KEY_VEHICLE + 5, x + 12, y + 83, line, S_MENU_NOTE, `Collective ${Math.round(v.collective * 100)}% · ${v.engineOn ? "ENGINE ON" : "ENGINE OFF"}`);
    const worn = v.rotorCondition < .7 || v.engineCondition < .7;
    if (lean) f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, worn ? S_WARNING : S_MENU_NOTE, worn ? `Engine ${Math.round(v.engineCondition * 100)}% · Rotor ${Math.round(v.rotorCondition * 100)}%` : v.engineOn ? (v.grounded ? "On the ground" : "Land to get out") : "Hold the collective up to start");
    else {
      f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, worn ? S_WARNING : S_MENU_NOTE, worn ? `Engine ${Math.round(v.engineCondition * 100)}% · Rotor ${Math.round(v.rotorCondition * 100)}%` : "W/S pitch · A/D bank · Q/R yaw");
      f.text(KEY_VEHICLE + 7, x + 12, y + 119, line, S_MENU_NOTE, v.engineOn ? "Space/Ctrl collective · Shift agile" : "Hold Space to start and lift");
      f.text(KEY_VEHICLE + 8, x + 12, y + 137, line, S_MENU_NOTE, "C flight mode · Hold X recover");
      f.text(KEY_VEHICLE + 9, x + 12, y + 155, line, S_MENU_NOTE, v.grounded ? "V cockpit/chase · E exit" : "V cockpit/chase · Land to exit");
    }
  }
  if (dash?.boat) {
    const v = dash, x = dashX, y = dashY, line = BOAT_W - 24;
    glass(f, KEY_VEHICLE, x, y, BOAT_W, dashH);
    f.text(KEY_VEHICLE, x + 12, y + 6, 52, S_MENU_MAIN, Math.round(v.speed * 1.94384).toString().padStart(2, "0"));
    f.text(KEY_VEHICLE + 10, x + 64, y + 15, 40, S_MENU_NOTE, "kn");
    f.text(KEY_VEHICLE + 1, x + BOAT_W - 104, y + 15, 92, S_MENU_NOTE, v.gear < 0 ? "REVERSE" : v.gear > 0 ? "AHEAD" : "NEUTRAL");
    f.add(KEY_VEHICLE + 2, K_BAR, x + 12, y + 41, line, 3, S_MENU_FOCUS).value = Math.min(1, v.rpm / v.redline);
    f.text(KEY_VEHICLE + 3, x + 12, y + 47, line, S_MENU_NOTE, `${Math.round(v.rpm / 100) * 100} rpm · Fuel ${Math.round(v.fuel * 100)}%`);
    const alarm = v.capsized ? "CAPSIZED - E to escape" : v.flooding >= .5 ? `FLOODING ${Math.round(v.flooding * 100)}% - E to escape` : v.flooding > .04 ? `TAKING WATER ${Math.round(v.flooding * 100)}% - repair hull` : "";
    const escape = lean ? "get out" : "E to escape";
    const alarmed = alarm.replace("E to escape", escape);
    f.text(KEY_VEHICLE + 4, x + 12, y + 65, line, alarm ? S_WARNING : S_MENU_NOTE, alarmed || `Hull ${Math.round(v.hullCondition * 100)}% · Engine ${Math.round(v.engineCondition * 100)}%`);
    f.text(KEY_VEHICLE + 5, x + 12, y + 83, line, S_MENU_NOTE, v.precision ? "PRECISION THROTTLE" : v.engineOn ? "ENGINE ON" : lean ? "Push the stick to start the engine" : "W/S to start engine");
    if (!lean) {
      f.text(KEY_VEHICLE + 6, x + 12, y + 101, line, S_MENU_NOTE, "W/S ahead/reverse · A/D steer");
      f.text(KEY_VEHICLE + 7, x + 12, y + 119, line, S_MENU_NOTE, "Space neutral · Shift precision");
      f.text(KEY_VEHICLE + 8, x + 12, y + 137, line, S_MENU_NOTE, "V helm/chase · Mouse look");
      f.text(KEY_VEHICLE + 9, x + 12, y + 155, line, S_MENU_NOTE, "E leave helm · F cargo/service");
    }
  }

  const barW = 150;
  const labelW = 62;
  const vitalY = foot - 38 - (W < 640 ? HOTBAR_CELL + 8 : 0);
  // At the top they stand against the sky, and need glass behind them to be read: as far as the last one shown.
  if (touch) {
    let last = -1;
    for (let i = 0; i < m.vitals.length; i++) { const v = m.vitals[i]!; if (!((v.id === "oxygen" && v.fraction >= 1) || (v.id === "torpor" && v.fraction <= 0))) last = i; }
    if (last >= 0) glass(f, KEY_VITAL - 1, touch.vitalsX - 6, touch.vitalsY - 5, last * VITAL_PITCH + 44, 42, 0.85);
  }
  for (let i = 0; i < m.vitals.length; i++) {
    const v = m.vitals[i]!;
    if ((v.id === "oxygen" && v.fraction >= 1) || (v.id === "torpor" && v.fraction <= 0)) continue;
    // By touch the thumbs have the lower corners, and the vitals stand in a row at the top, each over its number.
    const x = touch ? touch.vitalsX + i * VITAL_PITCH : right - 38;
    const y = touch ? touch.vitalsY : vitalY - i * 43;
    filledVital(f, KEY_VITAL + i * 2 + 1, i, x, y, 32, v.fraction, v.label, controls);
    if (!(options.vitalLabels || inspect)) continue;
    if (touch) f.text(KEY_VITAL + i * 2, x - 4, y + 33, 40, S_KEY_SMALL, `${Math.round(v.fraction * 100)}`);
    else f.text(KEY_VITAL + i * 2, x - 126, y + 8, 116, S_HUD_COUNT, `${v.label}  ${Math.round(v.fraction * 100)}%`);
  }
  // Buffs stay in a column above the bottom row. A buff with negative seconds shows no time.
  const buffW = barW + labelW;
  const buffH = lineHeight(S_BUFF) + 2;
  let by = foot - HOTBAR_CELL - 64 - buffH;
  const buffTop = panel ? Math.max(200, dashY + dashH + 4) : 200;
  for (let i = 0; i < m.buffs.length && i < 16 && by > buffTop; i++) {
    const b = m.buffs[i]!;
    const n = f.add(KEY_BUFF + i, K_PANEL, touch ? left : Math.max(left, right - buffW - 58), by, buffW, buffH, S_BUFF);
    n.tint = b.tint;
    n.text = b.seconds < 0 ? b.label : `${b.label}  ${b.seconds}s`;
    by -= buffH + 2;
  }

  // The hotbar stays at the bottom even when a message, a vital or chat changes.
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
  }

  // Through a scope its reticle (built under the rest) stands in for the crosshair. A holo-scope's crosshair shows whatever
  // the rules say of the crosshair, coloured by what it is on.
  if (!m.orbit && !m.behind && !((m.scope || m.visor) && m.banner === "") && (m.crosshair || (m.holo && m.banner === ""))) {
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
    // The helm panel already carries the exit control; repeating it over the centre overlaps portrait instruments.
    const exitInPanel = m.vehicle?.active && m.vehicle.boat && m.prompt === "E  exit vehicle";
    // A finger is offered the prompt as a button (ui/touch.ts), so here it loses its key.
    const prompt = touch && m.prompt.startsWith("E  ") ? m.prompt.slice(3) : m.prompt;
    if (prompt !== "" && !exitInPanel) f.text(KEY_PROMPT, W / 2 - 150, H / 2 + 14, 300, S_PROMPT, fitText(prompt, 300, S_PROMPT));
    if (m.actionKind !== ACTION_NONE) f.add(KEY_ACTION, K_BAR, W / 2 - 40, H / 2 + 38, 80, 5, m.actionKind === ACTION_DRAW ? S_STAMINA : S_OXYGEN).value = m.actionFraction;
  }
  if (m.status !== "") f.text(KEY_STATUS, left, H / 2 - 100, right - left, S_TEXT, m.status.slice(0, Math.floor((right - left) / 7.8)));
  if (m.banner !== "") {
    const bw = 240;
    const n = f.add(KEY_BANNER, K_PANEL, W / 2 - bw / 2, 56, bw, lineHeight(S_BANNER) + 8, S_BANNER);
    n.text = m.banner;
  }
}
