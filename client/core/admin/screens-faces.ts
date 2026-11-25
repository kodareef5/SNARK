// The Screens page's monitors for the flat screens: a billboard on its pole against the sky, a TV on a wall and a
// laptop on a desk, each drawn as a few flat quads and its face (client/admin/screens-faces.ts draws them with WebGL).
// This is what needs no browser: the settings in metres fitted to a canvas, the picture fitted to the face, the LED
// dot grid, the light by the world's hour and the wipe between items.

import { trackColour, type ScreenType } from "../../../shared/video/clip.ts";
import type { StateClip } from "./screens.ts";
import { stageSky, trackOf } from "./screens-stage.ts";

/** The flat types of screen; the ball has its own stage. */
export type FlatType = Exclude<ScreenType, "orb">;

/** A quad in the canvas's clip space (y up): its corners from bottom left round to top left, coloured from its top to its foot (sRGB 0 to 1). */
export interface FaceQuad {
  readonly at: readonly number[];
  readonly top: readonly number[];
  readonly foot: readonly number[];
}

/** A rectangle in clip space. */
export interface ClipRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** What a monitor draws: the backdrop up the canvas, the quads in order, then the face and the light it throws. */
export interface FaceScene {
  readonly back: { readonly top: readonly number[]; readonly foot: readonly number[] };
  readonly parts: readonly FaceQuad[];
  readonly face: ClipRect;
  /** How far the face's light reaches past its edge, as shares of its width and height. */
  readonly reach: readonly [number, number];
  /** How strongly the face lights what is round it: much in the dark, little by day. */
  readonly glow: number;
  /** The sky's reflection on the face by day, 0 to 1. */
  readonly sheen: number;
  /** Whether the face is LEDs, drawn as a dot grid. */
  readonly led: boolean;
}

/** Whether a type's face is LEDs: billboards are, TVs and laptops are plain glowing panels. */
export const FACE_LED: Readonly<Record<FlatType, boolean>> = { billboard: true, tv: false, laptop: false };

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: readonly number[], b: readonly number[], t: number): number[] => a.map((x, i) => x + (b[i]! - x) * t);
const grey = (v: number): number[] => [v, v, v];

/** Daylight at `hour`, 0 at night to 1 by day, from the sun's height as the ball's stage reckons it. */
export function daylight(hour: number): number {
  const sun = Math.sin(((hour - 6) / 24) * 2 * Math.PI);
  return smooth(-0.08, 0.25, sun);
}

/** A rectangle of the setting in metres (y up), coloured from its top to its foot. */
interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly top: readonly number[];
  readonly foot?: readonly number[];
}
/** Any four corners in metres, bottom left round to top left. */
interface Quad {
  readonly at: readonly number[];
  readonly top: readonly number[];
  readonly foot?: readonly number[];
}

/** A setting in metres: the box the camera frames, the backdrop, the parts, the face and how far its light reaches. */
interface Setting {
  readonly view: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number };
  readonly back: { readonly top: readonly number[]; readonly foot: readonly number[] };
  readonly parts: readonly (Box | Quad)[];
  readonly face: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
  readonly reach: number;
  readonly glow: number;
  readonly sheen: number;
}

/** The billboard as content/street.ts builds it: a 0.9 m pole under a face 14.8 m by 4.85 m, from 9.55 m up. */
function billboard(day: number, hour: number): Setting {
  const sky = stageSky(hour);
  // What stands against the sky goes dark with it, and takes a little of its haze.
  const steel = (v: number): number[] => mix(mix(grey(0.035), sky.foot, 0.25), grey(v), day);
  const far = (v: number): number[] => mix(mix(grey(0.02), sky.foot, 0.55), mix(grey(v - 0.1), sky.foot, 0.6), day);
  const parts: (Box | Quad)[] = [];
  // A low skyline far off below the board, so it stands up off the ground.
  const roofs = [[-30, -19, 7.6], [-19, -12, 6.9], [-12, -7.5, 8.4], [-7.5, 1.5, 7.2], [1.5, 6, 8.8], [6, 13, 7.4], [13, 21, 8.1], [21, 30, 7]] as const;
  roofs.forEach(([x0, x1, y1], i) => parts.push({ x0, x1, y0: -20, y1, top: far(0.5 + (i % 3) * 0.04), foot: far(0.46) }));
  parts.push({ x0: -0.45, x1: 0.45, y0: -20, y1: 9.3, top: steel(0.42), foot: steel(0.3) });
  // The braces from the pole out to the catwalk's ends.
  parts.push({ at: [-0.45, 6.6, -0.45, 7.1, -6.8, 9.25, -6.2, 9.25], top: steel(0.38) });
  parts.push({ at: [0.45, 7.1, 0.45, 6.6, 6.2, 9.25, 6.8, 9.25], top: steel(0.38) });
  parts.push({ x0: -7.7, x1: 7.7, y0: 9.15, y1: 9.42, top: steel(0.46), foot: steel(0.34) });
  parts.push({ x0: -7.6, x1: 7.6, y0: 9.42, y1: 14.55, top: steel(0.16), foot: steel(0.12) });
  return {
    view: { cx: 0, cy: 11.3, w: 17.4, h: 9.2 }, back: sky, parts, face: { x0: -7.4, x1: 7.4, y0: 9.55, y1: 14.4 },
    reach: 4, glow: 0.5 * (1 - day) + 0.04, sheen: 0.02 * day,
  };
}

/** A room's light: dim lamplight at night, daylight from a window by day. */
const roomLight = (day: number): number => 0.16 + 0.84 * day;

/** A 1.2 m TV on a wall over a low cabinet. */
function tv(day: number): Setting {
  const k = roomLight(day), lit = (c: readonly number[]): number[] => c.map((x) => x * k);
  const wall = { top: lit([0.62, 0.6, 0.56]), foot: lit([0.72, 0.7, 0.66]) };
  const wood = [0.42, 0.29, 0.19];
  return {
    view: { cx: 0, cy: 0.95, w: 1.95, h: 1.25 }, back: wall,
    parts: [
      { x0: -50, x1: 50, y0: -5, y1: 0, top: lit(mix(wood, grey(0), 0.15)), foot: lit(mix(wood, grey(0), 0.45)) },
      { x0: -50, x1: 50, y0: 0, y1: 0.09, top: lit([0.86, 0.85, 0.82]), foot: lit([0.78, 0.77, 0.74]) },
      { x0: -0.92, x1: 0.92, y0: 0, y1: 0.48, top: lit([0.24, 0.22, 0.21]), foot: lit([0.17, 0.16, 0.15]) },
      { x0: -0.95, x1: 0.95, y0: 0.46, y1: 0.5, top: lit([0.36, 0.34, 0.32]) },
      { x0: -0.004, x1: 0.004, y0: 0.05, y1: 0.43, top: lit([0.1, 0.1, 0.1]) },
      // Its shadow on the wall, then its bezel.
      { x0: -0.6, x1: 0.66, y0: 0.79, y1: 1.52, top: lit([0.5, 0.48, 0.45]) },
      { x0: -0.625, x1: 0.625, y0: 0.825, y1: 1.55, top: [0.05, 0.05, 0.055], foot: [0.03, 0.03, 0.035] },
    ],
    face: { x0: -0.6, x1: 0.6, y0: 0.85, y1: 1.525 }, reach: 0.55, glow: 0.55 * (1 - day) + 0.06, sheen: 0.01 * day,
  };
}

/** A 13-inch laptop open on a desk against a wall, seen from a chair. */
function laptop(day: number): Setting {
  const k = roomLight(day), lit = (c: readonly number[]): number[] => c.map((x) => x * k);
  const desk = [0.55, 0.42, 0.3], shell = [0.6, 0.61, 0.63];
  return {
    view: { cx: 0.03, cy: 0.15, w: 0.62, h: 0.38 }, back: { top: lit([0.5, 0.53, 0.55]), foot: lit([0.58, 0.6, 0.61]) },
    parts: [
      // The desk's top runs back to the wall, narrower there as it is further off; its front edge is below.
      { at: [-5, -0.02, 5, -0.02, 3, 0.2, -3, 0.2], top: lit(mix(desk, grey(0), 0.25)), foot: lit(desk) },
      { x0: -5, x1: 5, y0: -1, y1: -0.02, top: lit(mix(desk, grey(0), 0.45)), foot: lit(mix(desk, grey(0), 0.6)) },
      // A mug.
      { x0: 0.24, x1: 0.295, y0: 0.05, y1: 0.135, top: lit([0.78, 0.33, 0.26]), foot: lit([0.62, 0.25, 0.2]) },
      { x0: 0.295, x1: 0.312, y0: 0.07, y1: 0.115, top: lit([0.7, 0.29, 0.23]) },
      // The base and its keys, then the lid.
      { at: [-0.18, 0.012, 0.18, 0.012, 0.162, 0.1, -0.162, 0.1], top: lit(mix(shell, grey(0), 0.1)), foot: lit(shell) },
      { at: [-0.15, 0.045, 0.15, 0.045, 0.14, 0.092, -0.14, 0.092], top: lit([0.18, 0.18, 0.2]), foot: lit([0.22, 0.22, 0.24]) },
      { at: [-0.05, 0.016, 0.05, 0.016, 0.048, 0.04, -0.048, 0.04], top: lit(mix(shell, grey(0), 0.2)) },
      { x0: -0.162, x1: 0.162, y0: 0.098, y1: 0.31, top: [0.06, 0.06, 0.065], foot: [0.04, 0.04, 0.045] },
    ],
    face: { x0: -0.148, x1: 0.148, y0: 0.112, y1: 0.297 }, reach: 0.12, glow: 0.6 * (1 - day) + 0.05, sheen: 0.008 * day,
  };
}

/** Maps metres of a setting into clip space for a canvas `aspect` wide to its height, the view box whole in it. */
export function fitView(view: { cx: number; cy: number; w: number; h: number }, aspect: number): (x: number, y: number) => [number, number] {
  const half = Math.max(view.h / 2, view.w / 2 / aspect);
  return (x, y) => [(x - view.cx) / (half * aspect), (y - view.cy) / half];
}

/** What a monitor of `type` draws on a canvas `aspect` wide to its height, at the world's `hour`. */
export function faceScene(type: FlatType, aspect: number, hour: number): FaceScene {
  const day = daylight(hour), s = type === "billboard" ? billboard(day, hour) : type === "tv" ? tv(day) : laptop(day);
  const to = fitView(s.view, aspect);
  const parts = s.parts.map((p): FaceQuad => {
    const corners = "at" in p ? p.at : [p.x0, p.y0, p.x1, p.y0, p.x1, p.y1, p.x0, p.y1];
    const at: number[] = [];
    for (let i = 0; i < 8; i += 2) at.push(...to(corners[i]!, corners[i + 1]!));
    return { at, top: p.top, foot: p.foot ?? p.top };
  });
  const [x0, y0] = to(s.face.x0, s.face.y0), [x1, y1] = to(s.face.x1, s.face.y1);
  const fw = s.face.x1 - s.face.x0, fh = s.face.y1 - s.face.y0;
  return { back: s.back, parts, face: { x0, y0, x1, y1 }, reach: [s.reach / fw, s.reach / fh], glow: s.glow, sheen: s.sheen, led: FACE_LED[type] };
}

/** Where on the picture a point of the face is, as `uv * scale + offset`: filled, the picture is cropped to cover it; else it fits whole with dark bars. */
export function fitPicture(picture: number, face: number, fill: boolean): { sx: number; sy: number; ox: number; oy: number } {
  const wider = picture > face;
  // Filled, the picture's longer way is cut; fitted, its shorter way is padded.
  const sx = wider === fill ? face / picture : 1, sy = wider === fill ? 1 : picture / face;
  return { sx, sy, ox: (1 - sx) / 2, oy: (1 - sy) / 2 };
}

/** The smallest LED a monitor draws, in pixels, and the most across a face. */
export const LED_PX = 4;
export const LED_MOST = 200;
/** Fewer LEDs across than this and the grid is left out, as it would only shimmer. */
export const LED_FEWEST = 60;

/** The LEDs across and down a face `width` by `height` pixels, or [0, 0] where it is too small for a grid. */
export function ledDots(width: number, height: number): [number, number] {
  const across = Math.min(LED_MOST, Math.floor(width / LED_PX));
  if (across < LED_FEWEST || height <= 0) return [0, 0];
  return [across, Math.max(1, Math.round((across * height) / width))];
}

/** The length of the wipe from one item to the next, in ms. */
export const WIPE_MS = 700;

/** A monitor's memory of what its face showed, so a change of item wipes down it from the top. */
export class FaceWipe {
  private shown: string | null | undefined = undefined;
  private from = 0;

  /** The share of the face, from the top, that shows `item` at `now` ms: 1 once the wipe is over, or for a still one. */
  at(item: string | null, now: number, still = false): number {
    if (still || this.shown === undefined) {
      this.shown = item;
      this.from = -Infinity;
    } else if (item !== this.shown) {
      this.shown = item;
      this.from = now;
    }
    return Math.max(0, Math.min(1, (now - this.from) / WIPE_MS));
  }
}

/** The light an item throws round its face at `seconds` in, its mean colour from its track (sRGB 0 to 1). */
export function spillOf(clip: StateClip | null, seconds: number, tracks: Map<string, Uint8Array>): number[] {
  const out = [0, 0, 0];
  if (!clip) return out;
  let track = tracks.get(clip.id);
  if (!track) tracks.set(clip.id, (track = trackOf(clip)));
  trackColour(track, clip.kind === "image" ? 0 : seconds, 0, out);
  return out;
}
