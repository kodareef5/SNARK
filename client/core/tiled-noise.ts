// Fire shading and generated textures use the same periodic value noise on the CPU and GPU.

import { hash3 } from "./texgen/hash.ts";

/** `i` brought into 0 to `n`. */
export const wrap = (i: number, n: number): number => ((i % n) + n) % n;
/** The quintic step: its slope is 0 at both ends, and its bend too. */
export const ease = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise over a plane, cells a unit apart and repeating every (px, py) of them, from 0 to 1. */
export function tiled(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = ease(x - ix), fy = ease(y - iy);
  const x0 = wrap(ix, px), x1 = wrap(ix + 1, px), y0 = wrap(iy, py), y1 = wrap(iy + 1, py);
  const a = hash3(x0, y0, seed), b = hash3(x1, y0, seed), c = hash3(x0, y1, seed), d = hash3(x1, y1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** GLSL wraps negative cells after adding whole periods. */
export const TILED_GLSL = `
float hash3(int a, int b, int c) {
  uint h = uint(a) * 1597334677u ^ uint(b) * 3812015801u ^ uint(c) * 2654435761u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return float((h ^ (h >> 16u)) >> 8u) / 16777216.0;
}
int wrapi(int i, int n) { return (i + n * 64) % n; }
float ease(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float tiled(float x, float y, int px, int py, int seed) {
  float fx0 = floor(x), fy0 = floor(y);
  int ix = int(fx0), iy = int(fy0);
  float fx = ease(x - fx0), fy = ease(y - fy0);
  int x0 = wrapi(ix, px), x1 = wrapi(ix + 1, px), y0 = wrapi(iy, py), y1 = wrapi(iy + 1, py);
  float a = hash3(x0, y0, seed), b = hash3(x1, y0, seed), c = hash3(x0, y1, seed), d = hash3(x1, y1, seed);
  return (a + (b - a) * fx) * (1.0 - fy) + (c + (d - c) * fx) * fy;
}
`;
