// The cloths' weaves, made by script at their true size: a tile that repeats, as a height, a lightness around 1 and a
// roughness a texel. Knitted jersey is rows of V-shaped stitches; denim a three-over-one twill of dyed warp over white
// weft; canvas a plain weave of heavy threads. Nothing is taken from any picture.

import type { Fabric } from "../../../../../shared/people/cuts.ts";

export interface Tile {
  /** Texels a side, and metres the tile spans. */
  side: number;
  metres: number;
  height: Float32Array;
  light: Float32Array;
  rough: Float32Array;
}

/** A repeatable random number for integers, 0 to 1. */
export function hash(...k: number[]): number {
  let h = 2166136261;
  for (const x of k) {
    h ^= x | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A thread's rounded profile across it: 1 on its middle, 0 at its edge, `t` from -1 to 1. */
const round = (t: number): number => (Math.abs(t) >= 1 ? 0 : Math.sqrt(1 - t * t));

function tile(side: number, metres: number, at: (x: number, y: number) => [height: number, light: number, rough: number]): Tile {
  const n = side * side;
  const out = { side, metres, height: new Float32Array(n), light: new Float32Array(n), rough: new Float32Array(n) };
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const [h, l, r] = at((x + 0.5) / side, (y + 0.5) / side);
    out.height[y * side + x] = h;
    out.light[y * side + x] = l;
    out.rough[y * side + x] = r;
  }
  return out;
}

/** Stockinette: wales of V stitches running down the cloth, each leg a thread slanting to the wale's middle. */
function jersey(): Tile {
  const wales = 4, courses = 5;
  return tile(192, 0.0048, (x, y) => {
    const fx = x * wales, fy = y * courses;
    const w = Math.floor(fx), c = Math.floor(fy);
    const u = fx - w - 0.5, v = fy - c;
    // Each half of the V: the leg's middle runs from the wale's edge at the top to its middle at the bottom.
    let h = 0;
    for (const s of [-1, 1]) {
      for (const dv of [0, 1]) {
        const vv = v + dv;
        const mid = s * 0.42 * (1 - vv / 1.35);
        const t = (u - mid) / 0.24;
        if (vv > 1.35) continue;
        h = Math.max(h, round(t) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, vv / 1.35))));
      }
    }
    const fibre = 0.94 + 0.12 * hash(w, c, 7);
    return [h, (0.82 + 0.22 * h) * fibre, 0.92 - 0.08 * h];
  });
}

/** Three-over-one right-hand twill: the dyed warp shows on three wefts in four, stepping one warp a weft. */
function denim(): Tile {
  const warps = 16, wefts = 12;
  return tile(160, 0.004, (x, y) => {
    const fx = x * warps, fy = y * wefts;
    const i = Math.floor(fx), j = Math.floor(fy);
    const warpUp = ((i - j) % 4 + 4) % 4 !== 3;
    const across = (fx - i - 0.5) * 2, along = (fy - j - 0.5) * 2;
    const h = warpUp ? round(across) * (0.8 + 0.2 * round(along * 0.7)) : 0.55 * round(along);
    // Each warp thread is dyed a little unevenly along its length: the slub.
    const slub = 0.9 + 0.2 * hash(i, 3) * (0.7 + 0.3 * Math.sin((y + hash(i, 5)) * Math.PI * 2));
    return [h, warpUp ? 0.8 * slub : 1.45, 0.84 - 0.06 * h];
  });
}

/** Plain weave of heavy threads, over one and under one. */
function canvas(): Tile {
  const threads = 8;
  return tile(160, 0.004, (x, y) => {
    const fx = x * threads, fy = y * threads;
    const i = Math.floor(fx), j = Math.floor(fy);
    const warpUp = (i + j) % 2 === 0;
    const a = (fx - i - 0.5) * 2, b = (fy - j - 0.5) * 2;
    const h = warpUp ? round(a * 0.95) * (0.7 + 0.3 * round(b * 0.8)) : round(b * 0.95) * (0.7 + 0.3 * round(a * 0.8));
    const tone = 0.95 + 0.1 * hash(warpUp ? i : j + 99, 11);
    return [h, (0.85 + 0.2 * h) * tone, 0.9 - 0.05 * h];
  });
}

/** A smooth rubber with a fine grain, for soles. */
function rubber(): Tile {
  return tile(64, 0.004, (x, y) => {
    const g = hash(Math.floor(x * 32), Math.floor(y * 32), 17);
    return [0.2 * g, 0.97 + 0.06 * g, 0.62];
  });
}

export const WEAVES: Readonly<Record<Fabric | "rubber", () => Tile>> = { jersey, denim, canvas, rubber };
