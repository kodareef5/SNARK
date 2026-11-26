// What a sight looked through shows: a scope's reticle and its window, a glass's readouts, a helmet's visor, the
// magnification ladder, and a holo-scope's tint over the view. The app's sight says what shows (SightShown), and the fill
// copies it onto the model.

import type { HudModel } from "../hud.ts";
import { SHAPE_TWIN, SHAPE_VISOR, TWIN_WIDE, VISOR_WIDE } from "../optics.ts";
import { K_PANEL, type UiFrame } from "../ui/nodes.ts";
import { S_CROSS, S_DARK, S_LENS, S_LENS_TWIN, S_MAGNIFY, S_SPOT_WORD, S_VISOR, S_VISOR_LEFT } from "../ui/style.ts";
import { band, type HudWidget } from "./widget.ts";

/** A holo-scope's tint over the view; a scope's reticle (eight panels). */
export const KEY_TINT = 38;
export const KEY_SIGHT = 5000;
/** The scope's shadow across its lens: the lens again where the eye is, and the two strips that move clears (D1077). */
export const KEY_SIGHT_SHADE = 5100;
/** A visor's frame and readouts (D1080). */
export const KEY_VISOR = 5110;
/** The magnification ladder's nodes (D1086), its gap from the window, width and most height. */
export const KEY_MAGNIFY = 9400;
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
/** The mils' two lines, four ticks a mark, and the zero under them. */
const MIL_KEYS = 3 + MIL_MARKS * 4;
export const KEY_MIL_ZERO = KEY_MIL + MIL_KEYS - 1;
/** The visor's ink: its frame, its marks and its words. */
const VISOR_INK = 0x7fe6d4;
/** A holo-scope's night tint. */
const HOLO_GREEN = 0x2f9a3c;

export interface SightModel {
  /**
   * Looking through a scope: its reticle in place of the crosshair (Scope Attachment: "based on the German Post design").
   * Aimed through a holo-scope the view takes a green night tint of opacity `tint` (Holo-Scope Attachment).
   */
  scope: boolean;
  tint: number;
  /**
   * The scope's window (D1077): the share of the screen's height it spans (optics.ts windowShare), its shape
   * (optics.ts SHAPE_), and how far the eye is off its axis in shares of its radius (x right, y down), which casts its
   * shadow across the lens.
   */
  sightShare: number;
  sightShape: number;
  sightOffX: number;
  sightOffY: number;
  /**
   * How many times the sight looked through magnifies now, and the least and most it may (0 for no sight): the
   * magnification ladder beside its window (buildMagnify, D1086).
   */
  magnify: number;
  magnifyMin: number;
  magnifyMax: number;
  /**
   * A scope whose reticle is marked in milliradians (D1083): the view's vertical field (radians), which spaces its marks
   * so they grow with the zoom, its zoom, and its zero (metres, 0 for none).
   */
  sightMil: boolean;
  sightFov: number;
  sightZoom: number;
  sightZero: number;
  /**
   * A helmet's visor up (client/core/visor.ts, D1080): its window is the sight's (above), and it shows its zoom, its view
   * (render/packet.ts OPTIC_), whether its picture is made larger past its glass, and how far off its middle is on.
   */
  visor: boolean;
  visorZoom: number;
  visorMode: number;
  visorDigital: boolean;
  visorRange: number;
  /**
   * A glass raised (client/core/glass.ts, D1082): its zoom, its range (metres, 0 for none, -1 while it lases) and bearing
   * (degrees), and whether a mark was just made.
   */
  glass: boolean;
  glassZoom: number;
  glassRange: number;
  glassBearing: number;
  glassMarked: boolean;
  /** A sight that zooms is raised, a glass is held, and a worn helmet's visor may be raised (for the touch buttons). */
  zooming: boolean;
  glassHeld: boolean;
  visorReady: boolean;
}

/** Where a sight's look starts and how it points, and whether the held weapon's laser is on. */
export interface SightAt {
  yaw: number;
  pitch: number;
  laser: boolean;
  x: number;
  y: number;
  z: number;
}

/** What the app's sight says of a frame: this widget's fields, and those of the crosshair's that the sight decides. */
export interface SightShown extends SightModel {
  orbit: boolean;
  behind: boolean;
  cone: number;
  holo: boolean;
}

const start = (): SightModel => ({
  scope: false, tint: 0, sightShare: 1, sightShape: 0, sightOffX: 0, sightOffY: 0, magnify: 0, magnifyMin: 0, magnifyMax: 0, sightMil: false, sightFov: 1, sightZoom: 0, sightZero: 0,
  visor: false, visorZoom: 0, visorMode: 0, visorDigital: false, visorRange: 0, glass: false, glassZoom: 0, glassRange: 0, glassBearing: 0, glassMarked: false, zooming: false, glassHeld: false, visorReady: false,
});

/** What a sight shows before its first frame, made once by whoever keeps it. */
export function sightShown(): SightShown {
  return { ...start(), orbit: false, behind: false, cone: -1, holo: false };
}

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
  f.text(KEY_MIL_ZERO, cx - r / 2, y, r, S_VISOR, m.sightZero > 0 ? `ZERO ${m.sightZero} m` : "ZERO ---");
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

/** A holo-scope's tint, under everything but the dark panel, which it gives way to. */
export const HOLO_TINT: HudWidget = {
  name: "holo tint",
  bands: [band(KEY_TINT, 1)],
  build(f, m, at) {
    if (m.out || !(m.tint > 0)) return;
    const n = f.add(KEY_TINT, K_PANEL, 0, 0, at.W, at.H, S_DARK);
    n.tint = HOLO_GREEN;
    n.alpha = m.tint;
  },
};

/** A scope's reticle over the laser dots, and under the readouts. */
export const SIGHT: HudWidget<SightModel> = {
  name: "sight",
  bands: [band(KEY_SIGHT, 10), band(KEY_SIGHT_SHADE, 3), band(KEY_VISOR, 30), band(KEY_GLASS, 4), band(KEY_MIL, MIL_KEYS), band(KEY_MAGNIFY, 40)],
  make: start,
  fill(m, c) {
    const s = c.frame?.sight;
    if (!s) return;
    m.scope = s.scope; m.tint = s.tint; m.sightShare = s.sightShare; m.sightShape = s.sightShape; m.sightOffX = s.sightOffX; m.sightOffY = s.sightOffY;
    m.magnify = s.magnify; m.magnifyMin = s.magnifyMin; m.magnifyMax = s.magnifyMax; m.sightMil = s.sightMil; m.sightFov = s.sightFov; m.sightZoom = s.sightZoom; m.sightZero = s.sightZero;
    m.visor = s.visor; m.visorZoom = s.visorZoom; m.visorMode = s.visorMode; m.visorDigital = s.visorDigital; m.visorRange = s.visorRange;
    m.glass = s.glass; m.glassZoom = s.glassZoom; m.glassRange = s.glassRange; m.glassBearing = s.glassBearing; m.glassMarked = s.glassMarked;
    m.zooming = s.zooming; m.glassHeld = s.glassHeld; m.visorReady = s.visorReady;
  },
  build(f, m, at) {
    const { W, H } = at;
    if (m.scope && m.banner === "") buildReticle(f, W, H, m);
    if (m.visor && m.banner === "") buildVisor(f, W, H, m);
    if (m.magnify > 0 && m.banner === "" && (m.scope || m.visor)) buildMagnify(f, W, H, m);
  },
};
