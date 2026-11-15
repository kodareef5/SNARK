// The accepted mood keys (assets/source/core/sky/keys) as the grade reads them: each key's clear sky at the texels of
// one slice of the table, by how far round from the sun and how high, the two sides of the sun read together. A texel
// takes the key's sky pixels out to the texels either side of it, the nearer counting more, and averages the middle
// half of them, so the thin clouds and the stars drop out. Nothing is read near the sun's middle, where its disc is
// painted, nor near the moon's, where its disc and its halo are: the moon climbs from the horizon to 67 degrees up
// through the night, and a halo held in the sky would stay where the night key has it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKY_SIZE, aroundCoord, aroundOf, elevationOf, upCoord } from "../../client/core/render/sky.ts";
import { KNEE, srgbToLinear } from "../../client/core/render/surface.ts";
import { readPng, type Image } from "../pack/png-read.ts";

export const KEYS_DIR = resolve(import.meta.dir, "../../assets/source/core/sky/keys");
/** Degrees round the sun's middle left out, its disc and the tight glow painted with it, and round the moon's, its disc and halo. */
export const SUN_CLEAR = 3;
export const MOON_CLEAR = 25;
/** The least a texel reads either side of its middle, degrees round and up, so a narrow one still sees past a ribbon of cloud. */
const MIN_ROUND = 3;
const MIN_UP = 0.3;
const DEG = Math.PI / 180;

export interface Direction {
  heading: number;
  elevation: number;
}

export interface KeySky {
  name: string;
  hour: number;
  /** The sun's height at the key's hour, degrees. */
  height: number;
  moon: boolean;
  sun: Direction;
  /** The key's colour at each texel, 0 to 255, x fastest, three numbers a texel. */
  rgb: Float64Array;
  /** How many pixels each texel read, by their weights: none where the discs or the land cover all it reads. */
  count: Float64Array;
}

interface BaseKey {
  name: string;
  hour: number;
  sunHeight: number;
  lightBy: string;
  sun: Direction;
  moon: Direction;
}

/** The keys' points file: where the sun and moon stand in each. */
export function baseKeys(): BaseKey[] {
  return JSON.parse(readFileSync(resolve(KEYS_DIR, "base/points.json"), "utf8")).keys;
}

/** The panorama's projection, base.ts's: a column's heading and a row's elevation, degrees. */
export const MIDDLE = 345;
export function headingAt(x: number, width: number): number {
  return MIDDLE + ((x + 0.5) / width - 0.5) * 360;
}
export function elevationAt(y: number, height: number): number {
  return 90 - ((y + 0.5) / height) * 180;
}

/** Degrees round from one heading to another, 0 to 180. */
export function roundFrom(heading: number, from: number): number {
  return Math.abs(((((heading - from) % 360) + 540) % 360) - 180);
}

/** Degrees between two directions. */
export function between(a: Direction, b: Direction): number {
  const c = Math.sin(a.elevation * DEG) * Math.sin(b.elevation * DEG) + Math.cos(a.elevation * DEG) * Math.cos(b.elevation * DEG) * Math.cos((a.heading - b.heading) * DEG);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/**
 * How much a pixel `v` degrees round or up counts toward texel `i`: 1 at the texel, falling to 0 at the texels either
 * side of it, or at least `least` degrees off.
 */
function reach(of: (t: number) => number, least: number, top: number): (i: number, v: number) => number {
  const n = SKY_SIZE - 1;
  const at = new Float64Array(SKY_SIZE), lo = new Float64Array(SKY_SIZE), hi = new Float64Array(SKY_SIZE);
  for (let i = 0; i < SKY_SIZE; i++) {
    at[i] = of(i / n);
    lo[i] = Math.min(of(Math.max(0, i - 1) / n), at[i]! - least);
    hi[i] = Math.max(of(Math.min(n, i + 1) / n), at[i]! + least);
  }
  return (i, v) => {
    const w = v < at[i]! ? (v - lo[i]!) / (at[i]! - lo[i]!) : (hi[i]! - v) / (hi[i]! - at[i]!);
    return v < 0 || v > top ? 0 : Math.max(0, Math.min(1, w));
  };
}

const ROUND = reach(aroundOf, MIN_ROUND, 180);
const UP = reach(elevationOf, MIN_UP, 90);
/** The share of a texel's pixels left out at either end of each channel's range: what is left is its middle half. */
const TRIM = 0.25;

/**
 * How far a pixel may lie from the first reading of the sky round it and still be read the second time, OKLab times
 * 100: past it, a pixel is a wisp of cloud or a star.
 */
const STRAY = 2;
/** Each level of 0 to 255 as light. */
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255));

/** OKLab of a colour of 0 to 255, times 100: a distance of about 2 is just seen. */
export function oklab(c: ArrayLike<number>): [number, number, number] {
  const lin = (v: number): number => (Number.isInteger(v) && v >= 0 && v <= 255 ? LINEAR[v]! : srgbToLinear(Math.max(0, Math.min(255, v)) / 255));
  const r = lin(c[0]!), g = lin(c[1]!), b = lin(c[2]!);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100, (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 100, (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 100];
}

/**
 * One key's clear sky. Sky pixels are those its base picture leaves the flat sky's colour. Each side of the sun is read
 * on its own first, since a painter's sky need not mirror; then both together, without the pixels STRAY or more from
 * the first reading of their own side.
 */
export function readKeySky(key: BaseKey): KeySky {
  const img = readPng(resolve(KEYS_DIR, `${key.name}.png`));
  const base = readPng(resolve(KEYS_DIR, `base/${key.name}.png`));
  const { width: W, height: H } = img;
  // Each row's texels and weights by elevation, each column's by how far round from the sun, and the sky's pixels.
  const rows: Taps[] = [], cols: Taps[] = [];
  for (let y = 0; elevationAt(y, H) >= 0; y++) rows.push(taps(UP, elevationAt(y, H), upCoord(elevationAt(y, H))));
  const left = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    const d = ((((headingAt(x, W) - key.sun.heading) % 360) + 540) % 360) - 180;
    left[x] = d < 0 ? 1 : 0;
    cols.push(taps(ROUND, Math.abs(d), aroundCoord(Math.abs(d))));
  }
  // Every other column, and above 10 degrees every other row: a texel reaches at least MIN_ROUND round, and from there
  // up more than a degree up and down.
  const sky: number[] = [];
  for (let y = 0; y < rows.length; y++) {
    if (elevationAt(y, H) > 10 && y % 2) continue;
    for (let x = 0; x < W; x += 2) {
      const b = (y * W + x) * base.channels;
      if (base.data[b] !== base.data[0] || base.data[b + 1] !== base.data[1] || base.data[b + 2] !== base.data[2]) continue;
      const here = { heading: headingAt(x, W), elevation: elevationAt(y, H) };
      if (between(here, key.sun) >= SUN_CLEAR && between(here, key.moon) >= MOON_CLEAR) sky.push(y * W + x);
    }
  }
  const pixels = { img, rows, cols, left, sky: Int32Array.from(sky) };
  const sides = [1, 0].map((side) => {
    const first = readSky(pixels, side);
    fill(first.rgb, Uint8Array.from(first.count, (c) => (c < 1 ? 0 : 1)));
    return first.rgb;
  });
  const { rgb, count } = readSky(pixels, -1, sides);
  return { name: key.name, hour: key.hour, height: key.sunHeight, moon: key.lightBy === "moon", sun: key.sun, rgb, count };
}

/** The texels a row or column of pixels is read into, with its weight in each, and its place among the texels. */
interface Taps {
  texels: number[];
  weights: number[];
  coord: number;
}

function taps(weight: (i: number, v: number) => number, v: number, coord: number): Taps {
  const out: Taps = { texels: [], weights: [], coord: coord * (SKY_SIZE - 1) };
  for (let i = 0; i < SKY_SIZE; i++) {
    const w = weight(i, v);
    if (w <= 0) continue;
    out.texels.push(i);
    out.weights.push(w);
  }
  return out;
}

/** Texels a key could not be read at take the mean of their neighbours, over and over, from those it could. */
export function fill(field: Float64Array, known: Uint8Array): void {
  const texels = SKY_SIZE * SKY_SIZE;
  const mean = [0, 0, 0];
  let n = 0;
  for (let t = 0; t < texels; t++) if (known[t]) for (let k = 0, m = ++n; k < 3; k++) mean[k]! += (field[t * 3 + k]! - mean[k]!) / m;
  for (let t = 0; t < texels; t++) if (!known[t]) for (let k = 0; k < 3; k++) field[t * 3 + k] = mean[k]!;
  for (let round = 0; round < 300; round++) {
    for (let t = 0; t < texels; t++) {
      if (known[t]) continue;
      const x = t % SKY_SIZE, y = Math.floor(t / SKY_SIZE);
      const near = [x > 0 ? t - 1 : -1, x < SKY_SIZE - 1 ? t + 1 : -1, y > 0 ? t - SKY_SIZE : -1, y < SKY_SIZE - 1 ? t + SKY_SIZE : -1].filter((q) => q >= 0);
      for (let k = 0; k < 3; k++) field[t * 3 + k] = near.reduce((s, q) => s + field[q * 3 + k]!, 0) / near.length;
    }
  }
}

/**
 * A key's sky read on the side of the sun `side` names (1 left, 0 right) or on both (-1), leaving out what strays from
 * `near`, a first reading of each side in that order.
 */
function readSky(pixels: { img: Image; rows: Taps[]; cols: Taps[]; left: Uint8Array; sky: Int32Array }, side: number, near?: Float64Array[]): { rgb: Float64Array; count: Float64Array } {
  const { img, rows, cols, left, sky } = pixels;
  const W = img.width;
  const hist = new Float64Array(SKY_SIZE * SKY_SIZE * 3 * 256);
  const count = new Float64Array(SKY_SIZE * SKY_SIZE);
  const lab = near?.map((field) => {
    const out = new Float64Array(field.length);
    for (let t = 0; t < SKY_SIZE * SKY_SIZE; t++) out.set(oklab(field.subarray(t * 3, t * 3 + 3)), t * 3);
    return out;
  });
  const there = [0, 0, 0];
  for (const n of sky) {
    const x = n % W, y = (n - x) / W;
    if (side >= 0 && left[x] !== side) continue;
    const row = rows[y]!, col = cols[x]!;
    const p = n * img.channels;
    if (lab) {
      const own = lab[left[x] ? 0 : 1]!;
      const i = Math.min(SKY_SIZE - 2, Math.floor(col.coord)), j = Math.min(SKY_SIZE - 2, Math.floor(row.coord)), u = col.coord - i, v = row.coord - j;
      for (let k = 0; k < 3; k++) {
        const at = (j * SKY_SIZE + i) * 3 + k;
        there[k] = (1 - v) * ((1 - u) * own[at]! + u * own[at + 3]!) + v * ((1 - u) * own[at + SKY_SIZE * 3]! + u * own[at + SKY_SIZE * 3 + 3]!);
      }
      const q = oklab(img.data.subarray(p, p + 3));
      if (Math.hypot(q[0] - there[0]!, q[1] - there[1]!, q[2] - there[2]!) > STRAY) continue;
    }
    for (let a = 0; a < row.texels.length; a++) {
      for (let b = 0; b < col.texels.length; b++) {
        const w = row.weights[a]! * col.weights[b]!;
        const t = row.texels[a]! * SKY_SIZE + col.texels[b]!;
        count[t]! += w;
        for (let k = 0; k < 3; k++) hist[(t * 3 + k) * 256 + img.data[p + k]!]! += w;
      }
    }
  }
  const rgb = new Float64Array(SKY_SIZE * SKY_SIZE * 3);
  for (let t = 0; t < SKY_SIZE * SKY_SIZE; t++) {
    const n = count[t]!;
    if (n === 0) continue;
    for (let k = 0; k < 3; k++) {
      const h = (t * 3 + k) * 256;
      // The mean of what lies between the TRIM and 1 - TRIM shares of the texel's weight, level by level.
      let below = 0, sum = 0;
      for (let v = 0; v < 256; v++) {
        const c = hist[h + v]!;
        const kept = Math.max(0, Math.min(below + c, (1 - TRIM) * n) - Math.max(below, TRIM * n));
        sum += kept * v;
        below += c;
      }
      rgb[t * 3 + k] = sum / ((1 - 2 * TRIM) * n);
    }
  }
  return { rgb, count };
}

/**
 * A colour as the screen shows it, 0 to 255, back to the light before sky.ts's tone curve, into `out`. A key's sky is
 * read as no brighter than TOP of the curve's reach: past it a step of paint stands for too much light to read.
 */
export const TOP = 0.97;
export function untone(c: ArrayLike<number>, out: number[] | Float64Array): void {
  const lin = [0, 1, 2].map((k) => srgbToLinear(Math.max(0, Math.min(255, c[k]!)) / 255));
  const shown = Math.max(...lin);
  if (shown <= KNEE) {
    for (let k = 0; k < 3; k++) out[k] = lin[k]!;
    return;
  }
  const top = Math.min(shown, TOP);
  const d = 1 - KNEE;
  const peak = (d * d) / (1 - top) - d + KNEE;
  const white = 1 - 1 / (0.15 * (peak - top) + 1);
  for (let k = 0; k < 3; k++) out[k] = Math.max(0, (peak * (lin[k]! / shown - white)) / (1 - white));
}

let read: KeySky[] | null = null;

/** Every key's clear sky, read once. */
export function keySkies(): KeySky[] {
  return (read ??= baseKeys().map(readKeySky));
}
