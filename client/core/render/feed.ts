// A drone's camera feed as a picture (client/core/air-feed.ts): a small sensor's, sent over a radio link. The scene is drawn
// at a low share of the canvas and taken up by its nearest texel with a little blur, its colour fringed toward the edges;
// then the feed's cool grade (surface.ts graded), sensor noise, scanlines and a vignette. As the signal falls the noise
// grows, macroblocks coarsen, bands tear sideways and rows drop out; a burst does the same for a moment. The finishing
// pass draws it (post.ts FINISH); a tier without one has the grade alone and the HUD's scanlines and vignette
// (hud/air-feed.ts). The maths is here twice, as GLSL and as numbers, which a picture taken in software runs.

import { linearToSrgb, srgbToLinear } from "./color-space.ts";

/** The least share of the canvas a side the feed's scene is drawn at, and the rows it aims for above that. */
export const FEED_LEAST = 0.3;
export const FEED_ROWS = 540;
/** The share a side the feed's scene is drawn at, on a canvas `height` pixels tall where the frame would draw `share`. */
export const feedShare = (share: number, height: number): number => Math.min(share, Math.max(FEED_LEAST, FEED_ROWS / Math.max(1, height)));

/** The feed's grade over plain light: how much colour it keeps, its tint, and the floor its blacks are lifted to. */
export const FEED_SATURATION = 0.38;
export const FEED_TINT: readonly number[] = [0.86, 0.98, 1.08];
export const FEED_FLOOR = 0.012;

/** What the feed does to its picture at a signal and a burst, each 0 to 1. */
export interface FeedLook {
  /** The share of the nearest texel's colour mixed toward a smooth read. */
  blur: number;
  /** Scene texels the colour's red and blue part from its green at the picture's corners. */
  chroma: number;
  /** Sensor noise, as a display value either way. */
  noise: number;
  /** How dark the foot of each scene row is, and the corners. */
  scan: number;
  vignette: number;
  /** The odds a macroblock is drawn coarser, a band of them torn sideways, and a scene row lost. */
  block: number;
  tear: number;
  drop: number;
  /** How far a torn band slides, scene texels at most, and how far the picture's light dips at most. */
  slide: number;
  flicker: number;
}

const BLUR = 0.32, BLUR_BAD = 0.22;
const CHROMA = 0.55, CHROMA_BAD = 1.6, CHROMA_BURST = 2.4;
const NOISE = 0.028, NOISE_BAD = 0.07, NOISE_BURST = 0.04;
const SCAN = 0.16, VIGNETTE = 0.5, VIGNETTE_BAD = 0.15;
const BLOCK_BAD = 0.35, BLOCK_BURST = 0.3;
const TEAR_BAD = 0.2, TEAR_BURST = 0.25;
const DROP_BAD = 0.012, DROP_BURST = 0.02;
const SLIDE = 5, SLIDE_BAD = 28;
const FLICKER_BAD = 0.3;

/** The feed's look at `signal` and `burst` (each 0 to 1), into `out`. */
export function feedLook(signal: number, burst: number, out: FeedLook = { blur: 0, chroma: 0, noise: 0, scan: 0, vignette: 0, block: 0, tear: 0, drop: 0, slide: 0, flicker: 0 }): FeedLook {
  const bad = 1 - Math.min(1, Math.max(0, signal)), b = Math.min(1, Math.max(0, burst));
  out.blur = BLUR + BLUR_BAD * bad;
  out.chroma = CHROMA + CHROMA_BAD * bad + CHROMA_BURST * b;
  out.noise = NOISE + NOISE_BAD * bad * bad + NOISE_BURST * b;
  out.scan = SCAN;
  out.vignette = VIGNETTE + VIGNETTE_BAD * bad;
  out.block = BLOCK_BAD * bad * bad + BLOCK_BURST * b;
  out.tear = TEAR_BAD * bad * bad * bad + TEAR_BURST * b;
  out.drop = DROP_BAD * bad * bad * bad * bad + DROP_BURST * b;
  out.slide = SLIDE + SLIDE_BAD * Math.max(bad, b);
  out.flicker = FLICKER_BAD * bad * bad * bad;
  return out;
}

/** Bursts a second, and frozen frames a second, at a signal: rare near the rack, often at the edge of its range. */
export const burstOdds = (signal: number): number => 0.05 + 1.6 * (1 - signal) ** 3;
export const freezeOdds = (signal: number): number => (signal >= 0.4 ? 0 : 1.2 * ((0.4 - signal) / 0.4) ** 2);

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** `feedLook` as GLSL, from the same constants. */
const LOOK_GLSL = `struct FeedLook { float blur, chroma, noise, scan, vignette, block, tear, drop, slide, flicker; };
FeedLook feedLook(float signal, float burst) {
  float bad = 1.0 - clamp(signal, 0.0, 1.0), b = clamp(burst, 0.0, 1.0);
  FeedLook l;
  l.blur = ${f(BLUR)} + ${f(BLUR_BAD)} * bad;
  l.chroma = ${f(CHROMA)} + ${f(CHROMA_BAD)} * bad + ${f(CHROMA_BURST)} * b;
  l.noise = ${f(NOISE)} + ${f(NOISE_BAD)} * bad * bad + ${f(NOISE_BURST)} * b;
  l.scan = ${f(SCAN)};
  l.vignette = ${f(VIGNETTE)} + ${f(VIGNETTE_BAD)} * bad;
  l.block = ${f(BLOCK_BAD)} * bad * bad + ${f(BLOCK_BURST)} * b;
  l.tear = ${f(TEAR_BAD)} * bad * bad * bad + ${f(TEAR_BURST)} * b;
  l.drop = ${f(DROP_BAD)} * bad * bad * bad * bad + ${f(DROP_BURST)} * b;
  l.slide = ${f(SLIDE)} + ${f(SLIDE_BAD)} * max(bad, b);
  l.flicker = ${f(FLICKER_BAD)} * bad * bad * bad;
  return l;
}
`;

/** A hash of three whole numbers, 0 to 1: the finish's `hash` in GLSL, and this in software. */
export function feedHash(a: number, b: number, c: number): number {
  let h = (Math.imul(a >>> 0, 1664525) + Math.imul(b >>> 0, 22695477) + Math.imul(c >>> 0, 2654435761 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519 | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917 | 0) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Whole numbers a hash is offset by, so a read off the picture's near edge stays positive. */
const OFF = 65536;

/**
 * The feed in the finish, after FRAME_BLOCK, `hash`, `scene`, `tone`, `encoded`, `graded` and `bright`: the colour of the
 * pixel at `vUv` as a display value, from the scene, its bloom and fOptic and fPhosphor (OPTIC_FEED_AT, OPTIC_BURST_AT).
 */
export const FEED_GLSL = `${LOOK_GLSL}float feedHash(vec3 v) {
  return hash(uvec3(ivec3(floor(v)) + ${OFF}));
}
vec3 feedTexel(vec2 p) {
  return scene((floor(p) + 0.5) * uPass.xy);
}
vec3 feed() {
  float signal = fOptic.w - 1.0, seed = fOptic.z, tick = floor(seed / 2.0);
  FeedLook l = feedLook(signal, fPhosphor.a);
  vec2 size = uExtent.xy / uPass.xy, p = vUv * size, d = vUv - 0.5;
  // A band of macroblocks torn sideways.
  float band = floor(p.y / 8.0);
  if (feedHash(vec3(band, tick, 3.0)) < l.tear) p.x += (feedHash(vec3(band, tick, 4.0)) - 0.5) * 2.0 * l.slide;
  // A macroblock compressed coarser.
  vec2 mb = floor(p / 16.0);
  float coarse = feedHash(vec3(mb.x, mb.y, tick + 5.0)) < l.block ? (feedHash(vec3(mb.x, mb.y, tick + 6.0)) < 0.5 ? 2.0 : 4.0) : 1.0;
  vec2 q = (floor(p / coarse) + 0.5) * coarse, fringe = d * 2.0 * l.chroma;
  vec3 c = vec3(feedTexel(q + fringe).r, feedTexel(q).g, feedTexel(q - fringe).b);
  c = mix(c, scene(p * uPass.xy), l.blur);
  if (fFinish.w > 0.0) c += fFinish.y * (texture(uBloom, min(vUv * uExtent.xy, uExtent.zw)).rgb / fFinish.w - bright(c));
  // Night vision's or heat's own grain, as light; then the sensor's noise on each texel and finer on each pixel, as shown.
  vec3 t = graded(tone(c * fGrade.rgb)) + (hash(uvec3(gl_FragCoord.xy, uint(seed) + 7u)) - 0.5) * fOptic.y;
  vec3 e = encoded(clamp(t, 0.0, 1.0));
  e += (feedHash(vec3(q, seed + 9.0)) - 0.5) * l.noise + (hash(uvec3(gl_FragCoord.xy, uint(seed) + 3u)) - 0.5) * 0.5 * l.noise;
  e *= 1.0 - l.scan * smoothstep(0.35, 1.0, fract(p.y));
  float r = length(d * vec2(size.x / size.y, 1.0)) / 0.95;
  e *= 1.0 - l.vignette * r * r * r;
  // A row lost to static.
  float row = floor(p.y);
  if (feedHash(vec3(row, tick, 8.0)) < l.drop) e = mix(e, vec3(feedHash(vec3(floor(p.x / 3.0), row, seed))), 0.85);
  return e * (1.0 - l.flicker * feedHash(vec3(tick, 1.0, 12.0)));
}
`;

/**
 * The feed's finish in software, the twin of FEED_GLSL, over `color` (sRGB, `width` by `height`) that the rasterizer drew
 * at the canvas's own pixels and graded: it is taken down to `share` a side, then up as the finish takes it, with no
 * bloom. `signal`, `burst` and `seed` are the frame's (fOptic.w less one, fPhosphor.a, fOptic.z).
 */
export function feedPicture(color: Uint8ClampedArray, width: number, height: number, share: number, signal: number, burst: number, seed: number): void {
  const sw = Math.max(1, Math.round(width * share)), sh = Math.max(1, Math.round(height * share));
  // The scene at its share, each texel the mean of the canvas's pixels under it, as linear light.
  const low = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const x0 = Math.floor((x * width) / sw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / sw));
    const y0 = Math.floor((y * height) / sh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / sh));
    const sum = [0, 0, 0];
    for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) for (let c = 0; c < 3; c++) sum[c]! += srgbToLinear(color[(v * width + u) * 4 + c]! / 255);
    for (let c = 0; c < 3; c++) low[(y * sw + x) * 3 + c] = sum[c]! / ((x1 - x0) * (y1 - y0));
  }
  const texel = (px: number, py: number, c: number): number => low[(Math.min(sh - 1, Math.max(0, Math.floor(py))) * sw + Math.min(sw - 1, Math.max(0, Math.floor(px)))) * 3 + c]!;
  const smooth = (px: number, py: number, c: number): number => {
    const x = px - 0.5, y = py - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return (texel(x0, y0, c) * (1 - fx) + texel(x0 + 1, y0, c) * fx) * (1 - fy) + (texel(x0, y0 + 1, c) * (1 - fx) + texel(x0 + 1, y0 + 1, c) * fx) * fy;
  };
  const l = feedLook(signal, burst), tick = Math.floor(seed / 2), hash = (a: number, b: number, c: number): number => feedHash(Math.floor(a) + OFF, Math.floor(b) + OFF, Math.floor(c) + OFF);
  const t = [0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width, v = 1 - (y + 0.5) / height, dx = u - 0.5, dy = v - 0.5;
    // GLSL's v runs up the picture; rows here run down it.
    let px = u * sw;
    const py = v * sh;
    const band = Math.floor(py / 8);
    if (hash(band, tick, 3) < l.tear) px += (hash(band, tick, 4) - 0.5) * 2 * l.slide;
    const mx = Math.floor(px / 16), my = Math.floor(py / 16);
    const coarse = hash(mx, my, tick + 5) < l.block ? (hash(mx, my, tick + 6) < 0.5 ? 2 : 4) : 1;
    const qx = (Math.floor(px / coarse) + 0.5) * coarse, qy = (Math.floor(py / coarse) + 0.5) * coarse;
    const fx = dx * 2 * l.chroma, fy = dy * 2 * l.chroma;
    // Rows of `low` run down the picture: a texel up it is one fewer.
    const at = (sx: number, sy: number, c: number): number => texel(sx, sh - sy, c);
    t[0] = at(qx + fx, qy + fy, 0); t[1] = at(qx, qy, 1); t[2] = at(qx - fx, qy - fy, 2);
    for (let c = 0; c < 3; c++) t[c] = linearToSrgb(Math.min(1, Math.max(0, t[c]! + (smooth(px, sh - py, c) - t[c]!) * l.blur)));
    const n = (hash(qx, qy, seed + 9) - 0.5) * l.noise + (feedHash(x, y, (seed >>> 0) + 3) - 0.5) * 0.5 * l.noise;
    const scan = 1 - l.scan * smoothstep(0.35, 1, py - Math.floor(py));
    const r = Math.hypot(dx * (sw / sh), dy) / 0.95, shade = 1 - l.vignette * r * r * r;
    const row = Math.floor(py), lost = hash(row, tick, 8) < l.drop ? hash(px / 3, row, seed) : -1;
    const dip = 1 - l.flicker * hash(tick, 1, 12);
    for (let c = 0; c < 3; c++) {
      let k = (t[c]! + n) * scan * shade;
      if (lost >= 0) k += (lost - k) * 0.85;
      color[(y * width + x) * 4 + c] = Math.round(Math.min(1, Math.max(0, k * dip)) * 255);
    }
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
