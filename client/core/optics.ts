// What a sight, glass or visor does to the view (an item's optic facet, D1029): how far it narrows the view, how the look
// slows to match, how the view eases between the two, and when it must be seen from the eye. Pure numbers, so the app,
// the HUD and the tests share them.

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
