// What a sight, glass or visor does to the view (an item's optic facet, D1076): how far it narrows the view, how the look
// slows to match, how the view eases between the two, and when it must be seen from the eye. Pure numbers, so the app,
// the HUD and the tests share them.

import type { KeyRow } from "./key-row.ts";
import type { OpticFacet } from "../../shared/content/defs.ts";

/** The vertical field of view that magnifies `base` (radians) `zoom` times: the tangent of its half is the zoom's share. */
export function zoomed(base: number, zoom: number): number {
  return 2 * Math.atan(Math.tan(base / 2) / zoom);
}

/** How many times a view of `fov` magnifies one of `base`, both vertical radians: the inverse of `zoomed`. */
export function magnification(base: number, fov: number): number {
  return Math.tan(base / 2) / Math.tan(fov / 2);
}

/** Past this a sight is seen from the eye: over the shoulder the middle of a narrow view is not where the shot goes. */
export const EYE_FROM = 1.5;
export const forcesEye = (zoom: number): boolean => zoom > EYE_FROM;

/**
 * The look's scale for a view of `fov` against the player's `base`: the player's sensitivity times the tangent ratio, so
 * a point on screen moves under the mouse as far at any zoom ("0% monitor distance"). `zoomSens` (1 for none) weighs the
 * narrowed part of it alone, so it is the player's own sensitivity again as the view opens to `base`.
 */
export function lookScale(base: number, fov: number, sensitivity: number, zoomSens = 1): number {
  const r = 1 / magnification(base, fov);
  return sensitivity * r * (r >= 1 ? 1 : 1 + (zoomSens - 1) * (1 - r));
}

/** The magnification an optic is set to at first: its least. */
export const opticZoom = (o: OpticFacet): number => o.min;
/** The most an optic magnifies; a fixed one's least. */
export const opticMost = (o: OpticFacet): number => o.max ?? o.min;

/** Milliseconds the view takes to come most of the way to a new field of view on foot (the step's 1 - e^-1). */
export const FOV_EASE_MS = 70;

/**
 * The field of view a frame of `dt` ms takes `fov` toward `want`, eased on the logarithm of the tangent of half of each,
 * so a step from 4x to 40x looks as long as one from 1x to 4x. `rate` is the share of the way a frame takes (0..1).
 */
export function easeFov(fov: number, want: number, rate: number): number {
  if (rate >= 1 || fov === want) return want;
  const a = Math.log(Math.tan(fov / 2)), b = Math.log(Math.tan(want / 2));
  return 2 * Math.atan(Math.exp(a + (b - a) * rate));
}

/** An optic's window: one round lens, or two merged side by side (a pair of binoculars). */
export const SHAPE_ROUND = 0;
export const SHAPE_TWIN = 1;
export const SHAPE_VISOR = 2;
export const shapeOf = (o: OpticFacet | undefined): number => (o?.shape === "twin" ? SHAPE_TWIN : o?.shape === "visor" ? SHAPE_VISOR : SHAPE_ROUND);
/** A visor's window's width for its height: wide open, and a slit as it narrows. */
export const VISOR_WIDE = 3;
/** A twin window's width for its height: two lenses as tall as it, their middles a lens's radius in from each side. */
export const TWIN_WIDE = 1.76;

/**
 * The share of the screen's height an optic's window spans at `zoom`: `window[0]` at its least, `window[1]` at its most,
 * between them on the logarithm of the zoom, so the window tightens as it zooms. A whole height where it gives none.
 */
export function windowShare(o: OpticFacet, zoom: number): number {
  const [wide, tight] = o.window ?? [1, 1];
  const least = o.min, most = opticMost(o);
  if (!(most > least)) return wide;
  const t = Math.log(Math.min(most, Math.max(least, zoom)) / least) / Math.log(most / least);
  return wide + (tight - wide) * t;
}

/**
 * Fills `out` with the box a window of `shape` spanning `share` of the height of a screen `aspect` wide for its height
 * takes, as shares of the screen (x0, y0, x1, y1, y down), within the screen. What lies outside it is masked.
 */
export function windowBox(shape: number, share: number, aspect: number, out: Float64Array | number[]): void {
  const h = share / 2, w = (shape === SHAPE_TWIN ? h * TWIN_WIDE : shape === SHAPE_VISOR ? h * VISOR_WIDE : h) / aspect;
  out[0] = Math.max(0, 0.5 - w);
  out[1] = Math.max(0, 0.5 - h);
  out[2] = Math.min(1, 0.5 + w);
  out[3] = Math.min(1, 0.5 + h);
}

/**
 * How far, in shares of its radius, the eye is off a sight's axis and which way (x right, y down), written to out[0..1]:
 * moving jostles it, a shot's kick throws it, the sway's way leads it. A scope's shadow is cast that far across its lens.
 * `pace` is the body's speed over its walk, `kick` the recoil now over a weapon's whole kick, `sx` and `sy` the sway.
 */
export const EYE_PACE = 0.16;
export const EYE_KICK = 0.3;
export const EYE_MOST = 0.4;
export function eyeOff(pace: number, kick: number, sx: number, sy: number, out: Float64Array | number[]): void {
  const m = Math.min(EYE_MOST, EYE_PACE * Math.max(0, pace) + EYE_KICK * Math.max(0, kick));
  const l = Math.hypot(sx, sy);
  out[0] = l > 0 ? (sx / l) * m : 0;
  out[1] = l > 0 ? (sy / l) * m : m;
}

/** The size in pixels on a screen `height` pixels tall of something `size` metres across `distance` metres off in a view of `fov` vertical radians. */
export const screenPixels = (size: number, distance: number, fov: number, height: number): number => (size / (2 * distance * Math.tan(fov / 2))) * height;

// A raised sight that zooms takes the arrows up and down, as the wheel (and a finger's zoom buttons, which send them).
export const SIGHT_KEYS: readonly KeyRow[] = [{
  name: "sight zoom",
  keys: ["ArrowUp", "ArrowDown"],
  when: (c) => c.zooming && !c.ui.opened("map"),
  press(c, code, down) {
    if (down) c.zoomBy(code === "ArrowUp" ? -1 : 1);
    return true;
  },
}];
