// The walls' weathering, made by the card from its recipe (content/texgen/weather.ts) as two jobs of the textures it
// makes (engine.ts). A bay's layer is an 8 m bay two storeys high, two stamps one above the other, each a storey from
// its slab line at the top to its floor: runoff in red, drips in green, rust in blue and the splash at the foot in
// alpha, every one nothing at the bay's sides so that bays meet in any order. A field's layer is 16 m by 16 m and tiles:
// rising damp, the plaster's hold, a patina and salt, each brought to an even spread of values (`equalize`), so that a
// threshold over it takes that share of a wall.

import { WEATHER_LUTS, WEATHER_RECIPE, type WeatherRecipe } from "../../../content/texgen/weather.ts";
import { sample, type Texture } from "../render/cpu-texture.ts";
import type { WorldSample } from "../render/world-surfaces.ts";
import { jobPixels, type Job } from "./engine.ts";
import { grainJob } from "./grain.ts";
import { TEXGEN_LAYERS, WEATHER_BAY, WEATHER_BAYS, WEATHER_FIELD, WEATHER_FIELDS, WEATHER_NOISE, WEATHER_NOISE_CELLS, WEATHER_PAD, WEATHER_STOREY } from "./layers.ts";
import { cells, fbm, hash3, hash32, line, smoothstep, tiled } from "./noise.ts";

export { WEATHER_BAY, WEATHER_BAYS, WEATHER_FIELD, WEATHER_FIELDS, WEATHER_PAD, WEATHER_STOREY } from "./layers.ts";
export const WEATHER_LAYERS = TEXGEN_LAYERS;
/** The side of the layers the rasterizer and the self-check make for themselves: the card's are as wide as the tier's finishes. */
export const WEATHER_TWIN_SIDE = 256;
/** Steps of a field's equalizing table. */
export const LUT_STEPS = 32;
/** A period long enough that a noise read only for its grain never repeats in a layer. */
const FREE = 1 << 20;

/** The seed of a bay's variant (`half` 0 the top storey of its layer, 1 the bottom) and of a field's layer. */
export const baySeed = (recipe: WeatherRecipe, layer: number, half: number): number => recipe.seed * 64 + layer * 2 + half;
export const fieldSeed = (recipe: WeatherRecipe, field: number): number => recipe.seed * 64 + 1000 * (field + 1);

const lerp = (r: readonly [number, number], t: number): number => r[0] + (r[1] - r[0]) * t;
/** A count drawn from a range, both ends included. */
const count = (r: readonly [number, number], t: number): number => Math.min(r[1], r[0] + Math.floor(t * (r[1] - r[0] + 1)));
/** One more stain over what is there: each darkens what the others leave. */
const over = (acc: number, v: number): number => 1 - (1 - acc) * (1 - Math.min(Math.max(v, 0), 1));
/** The seed of a feature's wander and grain, the variant's own: a whole number under 2^20, which a float holds and three times of which an int does. */
const grainSeed = (seed: number, k: number, j: number): number => hash32(seed, k, j + 7) >>> 12;

/**
 * Where each kind of feature begins in a bay variant's table (bayFeatures), in rows of four numbers: two for each track
 * of runoff, one for each thread, two for each drip and each rust streak, and one for the splash; as many as the recipe
 * draws at most.
 */
export function bayLayout(recipe: WeatherRecipe): { tracks: number; threads: number; drips: number; rusts: number; atThreads: number; atDrips: number; atRust: number; atSplash: number; rows: number } {
  const tracks = recipe.runs.heads[1] * recipe.runs.trails[1], threads = recipe.runs.threads[1], drips = recipe.drips.count[1], rusts = recipe.rust.count[1];
  const atThreads = tracks * 2, atDrips = atThreads + threads, atRust = atDrips + drips * 2, atSplash = atRust + rusts * 2;
  return { tracks, threads, drips, rusts, atThreads, atDrips, atRust, atSplash, rows: atSplash + 1 };
}

/**
 * A bay variant's features, drawn once from its seed and the recipe: where each track of runoff, each thread, each drip
 * and each rust streak lies, how wide, long and strong, and the seeds of its wander and grain; a feature the variant does
 * not have is marked by a length of -1. The card is given the table as it is, so neither it nor the twin hashes for them
 * at each pixel. As 32-bit floats, which both read.
 */
export function bayFeatures(recipe: WeatherRecipe, seed: number): Float32Array {
  const { atThreads, atDrips, atRust, atSplash, rows } = bayLayout(recipe);
  const f = new Float32Array(rows * 4).fill(-1), R = (k: number, j: number): number => hash3(seed, k, j), r = recipe.runs;
  const heads = count(r.heads, R(0, 0));
  for (let i = 0; i < heads; i++) {
    const k = 10 + i * 8;
    const hx = r.margin + R(k, 0) * (WEATHER_BAY - 2 * r.margin), a = lerp(r.strength, R(k, 1)), L = lerp(r.length, R(k, 2)), w0 = lerp(r.width, R(k, 3));
    const trails = count(r.trails, R(k, 4));
    for (let j = 0; j < trails; j++) {
      const tk = grainSeed(seed, k, j), at = (i * r.trails[1] + j) * 8;
      f.set([hx, j === 0 ? 0 : (R(tk, 0) - 0.5) * w0 * 3, w0 * (j === 0 ? 1 : 0.5), L, a * (j === 0 ? 1 : 0.35 + 0.45 * R(tk, 1)), tk, 0, 0], at);
    }
  }
  const threads = count(r.threads, R(1, 0));
  for (let i = 0; i < threads; i++) {
    const k = 200 + i * 4;
    f.set([0.15 + R(k, 0) * (WEATHER_BAY - 0.3), lerp(r.threadWidth, R(k, 1)), lerp(r.threadLength, R(k, 2)), lerp(r.threadStrength, R(k, 3))], (atThreads + i) * 4);
  }
  const streaks = (spec: WeatherRecipe["drips"], base: number, row: number): void => {
    const n = count(spec.count, R(base, 0));
    for (let i = 0; i < n; i++) {
      const k = base + 10 + i * 6;
      f.set([0.5 + R(k, 0) * (WEATHER_BAY - 1), lerp(spec.from, R(k, 1)), lerp(spec.width, R(k, 2)), lerp(spec.length, R(k, 3)), lerp(spec.strength, R(k, 4)), grainSeed(seed, k, 0), 0, 0], (row + i * 2) * 4);
    }
  };
  streaks(recipe.drips, 400, atDrips);
  streaks(recipe.rust, 600, atRust);
  f.set([seed * 7, grainSeed(seed, 200, 0), 0, 0], atSplash * 4);
  return f;
}

/** Drips or rust from table `f` at its rows from `row`, `n` of them: each a spot and a streak under it that widens as it falls. */
function streaksAt(f: Float32Array, row: number, n: number, spot: number, spread: number, grain: number, x: number, y: number): number {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = (row + i * 2) * 4, L = f[a + 3]!;
    const x0 = f[a]!, t = y - f[a + 1]!;
    if (L < 0 || t < -0.15 || t > L) continue;
    const ww = f[a + 2]! * (1 + (spread * Math.max(t, 0)) / L);
    if (Math.abs(x - x0) > 0.15 + 4 * ww) continue;
    const k = f[a + 5]!, dot = Math.exp(-((x - x0) * (x - x0) + t * t) / (spot * spot)) * 0.6;
    const d = (x - x0 - (line(t / 0.3, k) - 0.5) * 0.03) / ww;
    const streak = Math.exp(-d * d) * smoothstep(-0.01, 0.02, t) * (1 - smoothstep(L * 0.4, L, t)) * (1 - grain + grain * tiled(x / 0.02, t / 0.2, FREE, FREE, k + 7));
    acc = over(acc, f[a + 4]! * Math.max(streak, dot));
  }
  return acc;
}

/**
 * A bay variant's four masks from its table (bayFeatures) at x metres along it and y metres down from its slab line,
 * from 0 to 4, into `out`.
 */
export function bayTexel(recipe: WeatherRecipe, f: Float32Array, x: number, y: number, out: Float64Array | number[]): void {
  const wander = recipe.runs.wander, { tracks, threads, drips, rusts, atThreads, atDrips, atRust, atSplash } = bayLayout(recipe);
  let runs = 0;
  for (let i = 0; i < tracks; i++) {
    const a = i * 8, L = f[a + 3]!;
    if (L < 0 || y > L * 1.5) continue;
    const w = f[a + 2]! * (1 + (0.6 * y) / L) * (1 + 2 * Math.exp(-y / 0.12)), near = f[a]! + f[a + 1]! * (1 + y / L);
    if (Math.abs(x - near) > 0.625 * wander + 4 * w) continue;
    const tk = f[a + 5]!;
    const cx = near + (line(y / 0.7, tk * 3 + 1) - 0.5) * wander + (line(y / 0.19, tk * 3 + 2) - 0.5) * wander * 0.25;
    const d = (x - cx) / w;
    runs = over(runs, f[a + 4]! * Math.exp(-y / L) * (1 - smoothstep(L * 0.7, L * 1.5, y)) * smoothstep(0, 0.03, y) * Math.exp(-d * d) * (0.55 + 0.45 * tiled(x / 0.05, y / 0.5, FREE, FREE, tk)));
  }
  for (let i = 0; i < threads; i++) {
    const a = (atThreads + i) * 4, fx = f[a]!, fw = f[a + 1]!, fl = f[a + 2]!;
    if (fl < 0 || y > fl || Math.abs(x - fx) > 0.025 + 4 * fw) continue;
    const d = (x - fx - (line(y / 0.5, f[atSplash * 4 + 1]! + i * 4) - 0.5) * 0.05) / fw;
    runs = over(runs, f[a + 3]! * Math.exp(-d * d) * (1 - smoothstep(fl * 0.5, fl, y)) * smoothstep(0, 0.02, y));
  }
  // Nothing within 6 cm of a side, so that the pixels either side of where two bays meet hold none of either.
  const sides = (edge: number): number => smoothstep(0.06, 0.06 + edge, x) * smoothstep(0.06, 0.06 + edge, WEATHER_BAY - x);
  const floor = 1 - smoothstep(WEATHER_STOREY - 0.15, WEATHER_STOREY, y);
  out[0] = runs * sides(0.15) * floor;
  out[1] = streaksAt(f, atDrips, drips, 0.035, 1, 0.4, x, y) * sides(0.1) * floor;
  out[2] = streaksAt(f, atRust, rusts, 0.025, 2, 0.5, x, y) * sides(0.1) * floor;
  // The foot's splash, ragged along its top, the same height at either side so that bays meet.
  const up = WEATHER_STOREY - y, sp = recipe.splash, s7 = f[atSplash * 4]!;
  const reach = 0.3 + (lerp(sp.height, line(x / 1.3, s7 + 600)) - 0.3) * smoothstep(0, 1, Math.min(x, WEATHER_BAY - x));
  const edge = reach + (line(x / 0.11, s7 + 601) - 0.5) * 2 * sp.ragged;
  out[3] = up > edge ? 0 : (1 - smoothstep(edge - 0.1, edge, up)) * (0.45 + 0.55 * tiled(x / 0.04, up / 0.03, FREE, FREE, s7 + 602)) * (0.6 + 0.4 * (1 - Math.min(Math.max(up / edge, 0), 1)));
}

const cellOut = new Float64Array(3);
/** A field layer's four raw values at (x, y) metres in it, before they are equalized, into `out`. */
export function fieldRaw(seed: number, x: number, y: number, out: Float64Array | number[]): void {
  // Damp: broad blooms whose edges a warp breaks up.
  const qx = x + 1.2 * (fbm(x / 2, y / 2, 8, 8, seed + 1, 3) - 0.5), qy = y + 1.2 * (fbm(x / 2, y / 2, 8, 8, seed + 2, 3) - 0.5);
  out[0] = fbm(qx, qy, 16, 16, seed + 3, 5);
  // The plaster's hold: a broad field, losses grouped by it, in flakes of three sizes nicked along their edges.
  const hold = fbm(x / 4, y / 4, 4, 4, seed + 10, 3);
  cells(x / 0.5, y / 0.5, 32, 32, seed + 11, cellOut);
  const big = cellOut[2]!, nick = 1 - smoothstep(0, 0.08, cellOut[1]! - cellOut[0]!);
  cells(x / 0.2, y / 0.2, 80, 80, seed + 14, cellOut);
  const mid = cellOut[2]!;
  cells(x / 0.08, y / 0.08, 200, 200, seed + 17, cellOut);
  out[1] = hold * 0.55 + big * 0.25 + mid * 0.13 + cellOut[2]! * 0.07 - 0.03 * nick;
  // A patina of metres across, warped.
  const px = x + 2 * (fbm(x / 4, y / 4, 4, 4, seed + 20, 2) - 0.5), py = y + 2 * (fbm(x / 4, y / 4, 4, 4, seed + 21, 2) - 0.5);
  out[2] = fbm(px / 4, py / 4, 4, 4, seed + 22, 4);
  // Salt: blooms of a metre or so, mottled at a hand's width.
  out[3] = fbm(x, y, 16, 16, seed + 30, 3) * (0.5 + 0.5 * fbm(x / 0.25, y / 0.25, 64, 64, seed + 31, 2));
}

/** Where `v` falls in a field's table (`lut`, LUT_STEPS + 1 rows of four), channel `c`, from 0 to 1. */
export function equalize(v: number, lut: Float32Array, c: number): number {
  for (let k = 0; k < LUT_STEPS; k++) {
    const lo = lut[k * 4 + c]!, hi = lut[(k + 1) * 4 + c]!;
    if (v < hi) return (k + Math.min(Math.max((v - lo) / Math.max(hi - lo, 1e-6), 0), 1)) / LUT_STEPS;
  }
  return 1;
}

const luts = new Map<number, Float32Array>();
/** A field's equalizing table: each channel's values at LUT_STEPS + 1 even shares, from 64 by 64 places across it. */
export function fieldLut(seed: number): Float32Array {
  let lut = luts.get(seed);
  if (lut) return lut;
  const n = 64, values = [new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n)], raw = new Float64Array(4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      fieldRaw(seed, ((i + 0.5) / n) * WEATHER_FIELD, ((j + 0.5) / n) * WEATHER_FIELD, raw);
      for (let c = 0; c < 4; c++) values[c]![j * n + i] = raw[c]!;
    }
  }
  lut = new Float32Array((LUT_STEPS + 1) * 4);
  for (let c = 0; c < 4; c++) {
    const sorted = values[c]!.sort();
    for (let k = 0; k <= LUT_STEPS; k++) lut[k * 4 + c] = sorted[Math.round((k / LUT_STEPS) * (n * n - 1))]!;
  }
  luts.set(seed, lut);
  return lut;
}

/** Layer `layer` of the masks, `side` pixels a side, as RGBA8, row 0 first, as the card makes it. */
export function weatherPixels(layer: number, side: number, recipe: WeatherRecipe = WEATHER_RECIPE): Uint8Array {
  return layer < WEATHER_BAYS ? jobPixels(bayJob(recipe), layer, side) : layer < WEATHER_NOISE ? jobPixels(fieldJob(recipe), layer - WEATHER_BAYS, side) : jobPixels(noiseJob(recipe), 0, side);
}

/**
 * Layer `layer` of the masks `side` pixels a side as a texture of the rasterizer's (render/cpu-texture.ts), its smaller
 * pictures each the mean of four of the next, as the card's mipmaps are. Made once for each layer and side.
 */
const textures = new Map<number, Texture>();
export function weatherTexture(layer: number, side: number): Texture {
  const key = layer * 65536 + side;
  let t = textures.get(key);
  if (!t) textures.set(key, (t = mipmapped(weatherPixels(layer, side), side)));
  return t;
}
/** RGBA8 pixels `side` a side as a texture of the rasterizer's, each picture under the top the mean of four of the one over it, as the card's mipmaps are. */
export function mipmapped(pixels: Uint8Array, side: number): Texture {
  const top = Float32Array.from(pixels, (b) => b / 255), pictures = [top];
  for (let s = side >> 1, above = top; s >= 1; s >>= 1) {
    const p = new Float32Array(s * s * 4);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        for (let c = 0; c < 4; c++) {
          const at = (i: number, j: number): number => above[((2 * y + j) * 2 * s + 2 * x + i) * 4 + c]!;
          p[(y * s + x) * 4 + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
        }
      }
    }
    pictures.unshift(p);
    above = p;
  }
  return { channels: 4, pictures };
}
/** Reads layer `layer` of the masks `side` pixels a side at (u, v), as `sample` reads a texture: the twin of the card's read. */
export function weatherRead(layer: number, side: number, u: number, v: number, spread: number, out: Float64Array): void {
  sample(weatherTexture(layer, side), u, v, spread, out);
}
const twins = new Map<number, WorldSample>();
/** The masks' twin at `side` a side, as `weathered` is given it: the side the tier's card makes them at (texgenSide). */
export function weatherTwin(side: number): WorldSample {
  let t = twins.get(side);
  if (!t) twins.set(side, (t = (_role, layer, u, v, spread, out) => weatherRead(layer, side, u, v, spread, out)));
  return t;
}

const fl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The bay layers: two bands a layer, each a stamp drawn from its own table (bayFeatures), padded at its top and foot. */
export function bayJob(recipe: WeatherRecipe = WEATHER_RECIPE): Job {
  const layout = bayLayout(recipe), tables: Float32Array[] = [];
  const table = (layer: number, band: number): Float32Array => (tables[layer * 2 + band] ??= bayFeatures(recipe, baySeed(recipe, layer, band)));
  return {
    layers: WEATHER_BAYS,
    bands: 2,
    pad: WEATHER_PAD,
    taps: [2, 1],
    cost: 1,
    rows: layout.rows,
    glsl: bayGlsl(recipe),
    fill: (layer, band, out, at) => out.set(table(layer, band), at),
    made: (layer, band, u, v, out) => bayTexel(recipe, table(layer, band), u * WEATHER_BAY, v * WEATHER_STOREY, out),
  };
}

/** The field layers: each its seed and its equalizing table, pinned in the content for WEATHER_RECIPE and made for any other. */
export function fieldJob(recipe: WeatherRecipe = WEATHER_RECIPE): Job {
  const luts = Array.from({ length: WEATHER_FIELDS }, (_, f) => (recipe === WEATHER_RECIPE ? Float32Array.from(WEATHER_LUTS[f]!) : fieldLut(fieldSeed(recipe, f))));
  const raw = new Float64Array(4);
  return {
    layers: WEATHER_FIELDS,
    bands: 1,
    pad: 0,
    taps: [1, 1],
    cost: 2.6,
    rows: LUT_STEPS + 2,
    glsl: FIELD_GLSL,
    fill(layer, _band, out, at) {
      out[at] = fieldSeed(recipe, layer);
      out[at + 1] = out[at + 2] = out[at + 3] = 0;
      out.set(luts[layer]!, at + 4);
    },
    made(layer, _band, u, v, out) {
      fieldRaw(fieldSeed(recipe, layer), u * WEATHER_FIELD, v * WEATHER_FIELD, raw);
      for (let c = 0; c < 4; c++) out[c] = equalize(raw[c]!, luts[layer]!, c);
    },
  };
}

/** The weathering's jobs, in the order their layers lie in the array. */
export const weatherJobs = (recipe: WeatherRecipe = WEATHER_RECIPE): Job[] => [bayJob(recipe), fieldJob(recipe), noiseJob(recipe)];

/** The slow noises a wall's read takes from the array in place of hashing for them (layers.ts WEATHER_NOISE_CELLS). */
export const noiseJob = (recipe: WeatherRecipe = WEATHER_RECIPE): Job => grainJob(recipe.seed * 64 + 5000, WEATHER_NOISE_CELLS);

function bayGlsl(recipe: WeatherRecipe): string {
  const { tracks: TRACKS, threads: THREADS, drips: DRIPS, rusts: RUSTS, atThreads: AT_THREADS, atDrips: AT_DRIPS, atRust: AT_RUST, atSplash: AT_SPLASH } = bayLayout(recipe);
  return `float overOf(float acc, float v) { return 1.0 - (1.0 - acc) * (1.0 - clamp(v, 0.0, 1.0)); }
float sides(float x, float edge) { return smoothstep(0.06, 0.06 + edge, x) * smoothstep(0.06, 0.06 + edge, ${fl(WEATHER_BAY)} - x); }
float streaks(int row, int n, float spot, float spread, float grain, float x, float y) {
  float acc = 0.0;
  for (int i = 0; i < n; i++) {
    vec4 a = uJob[2 + row + i * 2], b = uJob[2 + row + i * 2 + 1];
    float L = a.w, x0 = a.x, t = y - a.y;
    if (L < 0.0 || t < -0.15 || t > L) continue;
    float ww = a.z * (1.0 + spread * max(t, 0.0) / L);
    if (abs(x - x0) > 0.15 + 4.0 * ww) continue;
    int k = int(b.y);
    float spot0 = exp(-((x - x0) * (x - x0) + t * t) / (spot * spot)) * 0.6;
    float d = (x - x0 - (line(t / 0.3, k) - 0.5) * 0.03) / ww;
    float streak = exp(-d * d) * smoothstep(-0.01, 0.02, t) * (1.0 - smoothstep(L * 0.4, L, t)) * (1.0 - grain + grain * tiled(x / 0.02, t / 0.2, ${FREE}, ${FREE}, k + 7));
    acc = overOf(acc, b.x * max(streak, spot0));
  }
  return acc;
}
vec4 bayTexel(float x, float y) {
  float runs = 0.0;
  for (int i = 0; i < ${TRACKS}; i++) {
    vec4 a = uJob[2 + i * 2], b = uJob[2 + i * 2 + 1];
    float L = a.w;
    if (L < 0.0 || y > L * 1.5) continue;
    float w = a.z * (1.0 + 0.6 * y / L) * (1.0 + 2.0 * exp(-y / 0.12)), near = a.x + a.y * (1.0 + y / L);
    if (abs(x - near) > ${fl(0.625 * recipe.runs.wander)} + 4.0 * w) continue;
    int tk = int(b.y);
    float cx = near + (line(y / 0.7, tk * 3 + 1) - 0.5) * ${fl(recipe.runs.wander)} + (line(y / 0.19, tk * 3 + 2) - 0.5) * ${fl(recipe.runs.wander * 0.25)};
    float d = (x - cx) / w;
    runs = overOf(runs, b.x * exp(-y / L) * (1.0 - smoothstep(L * 0.7, L * 1.5, y)) * smoothstep(0.0, 0.03, y) * exp(-d * d) * (0.55 + 0.45 * tiled(x / 0.05, y / 0.5, ${FREE}, ${FREE}, tk)));
  }
  for (int i = 0; i < ${THREADS}; i++) {
    vec4 a = uJob[2 + ${AT_THREADS} + i];
    if (a.z < 0.0 || y > a.z || abs(x - a.x) > 0.025 + 4.0 * a.y) continue;
    float d = (x - a.x - (line(y / 0.5, int(uJob[2 + ${AT_SPLASH}].y) + i * 4) - 0.5) * 0.05) / a.y;
    runs = overOf(runs, a.w * exp(-d * d) * (1.0 - smoothstep(a.z * 0.5, a.z, y)) * smoothstep(0.0, 0.02, y));
  }
  float floorOf = 1.0 - smoothstep(${fl(WEATHER_STOREY - 0.15)}, ${fl(WEATHER_STOREY)}, y);
  vec4 m;
  m.r = runs * sides(x, 0.15) * floorOf;
  m.g = streaks(${AT_DRIPS}, ${DRIPS}, 0.035, 1.0, 0.4, x, y) * sides(x, 0.1) * floorOf;
  m.b = streaks(${AT_RUST}, ${RUSTS}, 0.025, 2.0, 0.5, x, y) * sides(x, 0.1) * floorOf;
  int s7 = int(uJob[2 + ${AT_SPLASH}].x);
  float up = ${fl(WEATHER_STOREY)} - y;
  float reach = 0.3 + (mix(${fl(recipe.splash.height[0])}, ${fl(recipe.splash.height[1])}, line(x / 1.3, s7 + 600)) - 0.3) * smoothstep(0.0, 1.0, min(x, ${fl(WEATHER_BAY)} - x));
  float edge = reach + (line(x / 0.11, s7 + 601) - 0.5) * ${fl(2 * recipe.splash.ragged)};
  m.a = up > edge ? 0.0 : (1.0 - smoothstep(edge - 0.1, edge, up)) * (0.45 + 0.55 * tiled(x / 0.04, up / 0.03, ${FREE}, ${FREE}, s7 + 602)) * (0.6 + 0.4 * (1.0 - clamp(up / edge, 0.0, 1.0)));
  return m;
}
vec4 made(vec2 at) {
  return bayTexel(at.x * ${fl(WEATHER_BAY)}, at.y * ${fl(WEATHER_STOREY)});
}
`;
}

const FIELD_GLSL = `vec4 fieldRaw(int seed, float x, float y) {
  vec4 m;
  float qx = x + 1.2 * (fbm(x / 2.0, y / 2.0, 8, 8, seed + 1, 3) - 0.5), qy = y + 1.2 * (fbm(x / 2.0, y / 2.0, 8, 8, seed + 2, 3) - 0.5);
  m.r = fbm(qx, qy, 16, 16, seed + 3, 5);
  float hold = fbm(x / 4.0, y / 4.0, 4, 4, seed + 10, 3);
  vec3 c = cells(x / 0.5, y / 0.5, 32, 32, seed + 11);
  float big = c.z, nick = 1.0 - smoothstep(0.0, 0.08, c.y - c.x);
  float mid = cells(x / 0.2, y / 0.2, 80, 80, seed + 14).z;
  m.g = hold * 0.55 + big * 0.25 + mid * 0.13 + cells(x / 0.08, y / 0.08, 200, 200, seed + 17).z * 0.07 - 0.03 * nick;
  float px = x + 2.0 * (fbm(x / 4.0, y / 4.0, 4, 4, seed + 20, 2) - 0.5), py = y + 2.0 * (fbm(x / 4.0, y / 4.0, 4, 4, seed + 21, 2) - 0.5);
  m.b = fbm(px / 4.0, py / 4.0, 4, 4, seed + 22, 4);
  m.a = fbm(x, y, 16, 16, seed + 30, 3) * (0.5 + 0.5 * fbm(x / 0.25, y / 0.25, 64, 64, seed + 31, 2));
  return m;
}
float equalize(float v, int c) {
  for (int k = 0; k < ${LUT_STEPS}; k++) {
    float lo = uJob[3 + k][c], hi = uJob[4 + k][c];
    if (v < hi) return (float(k) + clamp((v - lo) / max(hi - lo, 1e-6), 0.0, 1.0)) / ${fl(LUT_STEPS)};
  }
  return 1.0;
}
vec4 made(vec2 at) {
  vec4 v = fieldRaw(int(uJob[2].x), at.x * ${fl(WEATHER_FIELD)}, at.y * ${fl(WEATHER_FIELD)});
  return vec4(equalize(v.r, 0), equalize(v.g, 1), equalize(v.b, 2), equalize(v.a, 3));
}
`;
