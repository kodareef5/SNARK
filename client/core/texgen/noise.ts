// The noises the page makes its pictures from (texgen), twice: in TypeScript for the rasterizer, the tests and the tools,
// and in GLSL for the card. Both take the same integer hash of whole numbers (hash.ts), so a seed draws the same
// picture on either, within a step of 255 where the card's 32-bit floats put an edge on the other side of a texel's
// middle. Tiling noises take a period in cells along each axis, so a picture made from them wraps without a seam.

import { ease, tiled, TILED_GLSL, wrap } from "../tiled-noise.ts";
import { hash3 } from "./hash.ts";

export { tiled };
export { hash3, hash32 } from "./hash.ts";

/** Value noise along a line, cells a unit apart, from 0 to 1. */
export function line(t: number, seed: number): number {
  const i = Math.floor(t), f = ease(t - i);
  const a = hash3(i, seed, 71), b = hash3(i + 1, seed, 71);
  return a + (b - a) * f;
}

/** `octaves` of tiled noise, each twice as fine and half as strong, from 0 to 1. */
export function fbm(x: number, y: number, px: number, py: number, seed: number, octaves: number): number {
  let sum = 0, weight = 0, a = 1, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += a * tiled(x * f, y * f, px * f, py * f, seed + o * 31);
    weight += a;
    a *= 0.5;
    f *= 2;
  }
  return sum / weight;
}

/**
 * Cells about points scattered one to a unit square, repeating every (px, py) squares: into `out` the distance to the
 * nearest point and to the next nearest, in units, and a number from 0 to 1 for the nearest's cell.
 */
export function cells(x: number, y: number, px: number, py: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = wrap(ix + i, px), cy = wrap(iy + j, py);
      const dx = ix + i + hash3(cx, cy, seed) - x, dy = iy + j + hash3(cx, cy, seed + 1) - y, d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash3(cx, cy, seed + 2);
      } else if (d < d2) d2 = d;
    }
  }
  out[0] = Math.sqrt(d1);
  out[1] = Math.sqrt(d2);
  out[2] = id;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The same, for the card. `%` of a negative is undefined there, so whole periods are added first: i is never under -64 of them. */
export const NOISE_GLSL = `
${TILED_GLSL}
float line(float t, int seed) {
  float i = floor(t), f = ease(t - i);
  float a = hash3(int(i), seed, 71), b = hash3(int(i) + 1, seed, 71);
  return a + (b - a) * f;
}
float fbm(float x, float y, int px, int py, int seed, int octaves) {
  float sum = 0.0, weight = 0.0, a = 1.0, f = 1.0;
  int m = 1;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    sum += a * tiled(x * f, y * f, px * m, py * m, seed + o * 31);
    weight += a;
    a *= 0.5;
    f *= 2.0;
    m *= 2;
  }
  return sum / weight;
}
vec3 cells(float x, float y, int px, int py, int seed) {
  float fx0 = floor(x), fy0 = floor(y);
  int ix = int(fx0), iy = int(fy0);
  float d1 = 81.0, d2 = 81.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      int cx = wrapi(ix + i, px), cy = wrapi(iy + j, py);
      float dx = fx0 + float(i) + hash3(cx, cy, seed) - x, dy = fy0 + float(j) + hash3(cx, cy, seed + 1) - y, d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash3(cx, cy, seed + 2);
      } else if (d < d2) d2 = d;
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;
