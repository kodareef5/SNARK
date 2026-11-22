// The walls' weathering, made by the card from its recipe (content/texgen/weather.ts) as jobs of the textures it makes
// (engine.ts). A layer holds what a wall's read applies, not what goes into it. A bay's stamp, 8 m along and a storey
// down from its slab line, holds the light that its band, its floor's dirt, its rust and, on the ground storey, its damp
// foot, growth, salt and splash leave a wall in red; the cover of its stains in green, rust over the ground storey and
// growth at its foot; the cover of its runoff and drips, which take a finish's own colour, in blue; and the damp that
// smooths its foot in alpha. Each is nothing at a bay's sides or the same at both, so that bays meet in any order. The
// field's tiles, 16 m by 8 m, hold the light a wall's tone and dirt leave, the cover a bleaching patina or a green film
// takes, and where plaster has let go. A wall reads each with a tap and mixes it in (world-surfaces.ts weathered).

import { WEATHER_RECIPE, type WeatherRecipe } from "../../../content/texgen/weather.ts";
import { sample, type Texture } from "../render/cpu-texture.ts";
import type { WorldSample } from "../render/world-surfaces.ts";
import { jobPixels, type Job } from "./engine.ts";
import { formworkJob } from "./formwork.ts";
import { FIELD_LAYER, FORMWORK_LAYER, GROWTH_TOP, WEATHER_BAY, WEATHER_BAYS, WEATHER_FIELD, WEATHER_FIELD_UP, WEATHER_GROUND, WEATHER_PAD, WEATHER_STOREY } from "./layers.ts";
import { cells, fbm, hash3, hash32, line, smoothstep, tiled } from "./noise.ts";

/** A period long enough that a noise read only for its grain never repeats in a layer. */
const FREE = 1 << 20;
/**
 * What a storey leaves at full strength: the darkening at the top of its band under the slab line and of its wash, the
 * metres over its floor its dirt reaches, and how high its damp foot rises on the ground storey.
 */
const BAND = 0.3, WASH = 0.08, FLOOR_DIRT = 0.12, FOOT = 1;
/** The share of a field's tile at each of its edges that it shares with the other tile, so that any two meet. */
const SHARED = 0.25;

/** The seed of a bay's variant (`half` 0 the top storey of its layer, 1 the bottom); of a field's tile, and of what its tiles share (-1). */
export const baySeed = (recipe: WeatherRecipe, layer: number, half: number): number => recipe.seed * 64 + layer * 2 + half;
export const tileSeed = (recipe: WeatherRecipe, tile: number): number => recipe.seed * 64 + 4000 + 100 * tile;

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
 * at each pixel; then its seed, its threads' seed, how much it leaks, 0 to 1, and 1 on the ground storey. As 32-bit
 * floats, which both read.
 */
export function bayFeatures(recipe: WeatherRecipe, seed: number, ground = false): Float32Array {
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
  f.set([seed * 7, grainSeed(seed, 200, 0), hash3(seed, 77, 1), ground ? 1 : 0], atSplash * 4);
  return f;
}

/** Nothing within 6 cm of a bay's side, so that the pixels either side of where two bays meet hold none of either. */
const sides = (x: number, edge: number): number => smoothstep(0.06, 0.06 + edge, x) * smoothstep(0.06, 0.06 + edge, WEATHER_BAY - x);

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
  const floor = 1 - smoothstep(WEATHER_STOREY - 0.15, WEATHER_STOREY, y);
  out[0] = runs * sides(x, 0.15) * floor;
  out[1] = streaksAt(f, atDrips, drips, 0.035, 1, 0.4, x, y) * sides(x, 0.1) * floor;
  out[2] = streaksAt(f, atRust, rusts, 0.025, 2, 0.5, x, y) * sides(x, 0.1) * floor;
  // The foot's splash, ragged along its top, the same height at either side so that bays meet.
  const up = WEATHER_STOREY - y, sp = recipe.splash, s7 = f[atSplash * 4]!;
  const reach = 0.3 + (lerp(sp.height, line(x / 1.3, s7 + 600)) - 0.3) * smoothstep(0, 1, Math.min(x, WEATHER_BAY - x));
  const edge = reach + (line(x / 0.11, s7 + 601) - 0.5) * 2 * sp.ragged;
  out[3] = up > edge ? 0 : (1 - smoothstep(edge - 0.1, edge, up)) * (0.45 + 0.55 * tiled(x / 0.04, up / 0.03, FREE, FREE, s7 + 602)) * (0.6 + 0.4 * (1 - Math.min(Math.max(up / edge, 0), 1)));
}

const masks = new Float64Array(4);
/** A bay stamp's four values (as the file's head says) at x metres along it and y metres down from its slab line, from its table (bayFeatures), into `out`. */
export function bayResult(recipe: WeatherRecipe, f: Float32Array, x: number, y: number, out: Float64Array | number[]): void {
  bayTexel(recipe, f, x, y, masks);
  const at = bayLayout(recipe).atSplash * 4, leak = 0.3 + 0.7 * f[at + 2]!;
  const up = WEATHER_STOREY - y, below = 1 - y / WEATHER_STOREY;
  let light = (1 - below * below * below * BAND) * (1 - WASH) * (1 - 0.3 * (1 - smoothstep(0, FLOOR_DIRT, up)));
  let stain = 0.8 * masks[2]!, damp = 0;
  if (f[at + 3]! > 0) {
    const s7 = f[at]!;
    const edge = FOOT + (line(x / 3, s7 + 610) - 0.5) * 0.8 * smoothstep(0.1, 1.5, Math.min(x, WEATHER_BAY - x));
    const foot = 1 - smoothstep(edge - 0.06, edge, up);
    const salt = (1 - smoothstep(edge * 0.7, edge + 0.25, up)) * smoothstep(0.55, 0.8, tiled(x / 0.9, up / 0.6, FREE, FREE, s7 + 620)) * sides(x, 0.25);
    light *= (1 - 0.5 * foot) * (1 - 0.32 * masks[3]!) * (1 + 0.3 * salt);
    stain = up < GROWTH_TOP ? (1 - smoothstep(0.1, 0.45, up)) * foot : stain * smoothstep(GROWTH_TOP, GROWTH_TOP + 0.1, up);
    damp = foot;
  }
  out[0] = light / 2;
  out[1] = stain;
  out[2] = over(masks[0]! * leak, 0.8 * masks[1]! * (0.6 + 0.4 * leak));
  out[3] = damp;
}

const cellOut = new Float64Array(3);
/**
 * A field tile's raw values at (x, y) metres in it, each repeating across the tile: its tone, its dirt, a patina, where
 * whole patches of plaster go, and the plaster's hold, losses grouped by a broad field in flakes of three sizes nicked
 * along their edges. Into `out`.
 */
export function fieldRaw(seed: number, x: number, y: number, out: Float64Array | number[]): void {
  out[0] = fbm(x / 4, y / 4, 4, 2, seed + 1, 3);
  out[1] = fbm(x / 8, y / 4, 2, 2, seed + 2, 2);
  const px = x + 2 * (fbm(x / 4, y / 4, 4, 2, seed + 20, 2) - 0.5), py = y + 2 * (fbm(x / 4, y / 4, 4, 2, seed + 21, 2) - 0.5);
  out[2] = fbm(px / 4, py / 4, 4, 2, seed + 22, 3);
  out[3] = fbm(x / 4, y / 4, 4, 2, seed + 4, 2);
  cells(x / 0.5, y / 0.5, 32, 16, seed + 11, cellOut);
  const big = cellOut[2]!, nick = 1 - smoothstep(0, 0.08, cellOut[1]! - cellOut[0]!);
  cells(x / 0.2, y / 0.2, 80, 40, seed + 14, cellOut);
  const mid = cellOut[2]!;
  cells(x / 0.08, y / 0.08, 200, 100, seed + 17, cellOut);
  out[4] = fbm(x / 4, y / 4, 4, 2, seed + 10, 3) * 0.55 + big * 0.25 + mid * 0.13 + cellOut[2]! * 0.07 - 0.03 * nick;
}

/** Each raw channel's mean and spread over a tile (fieldRaw), by which a field brings it to about an even spread from 0 to 1. */
export const FIELD_STRETCH = [[0.514, 0.153], [0.501, 0.177], [0.539, 0.128], [0.474, 0.184], [0.511, 0.11]] as const;
const stretch = (v: number, c: number): number => Math.min(Math.max(((v - FIELD_STRETCH[c]![0]) / FIELD_STRETCH[c]![1]) * 0.2887 + 0.5, 0), 1);

const common = new Float64Array(5), own = new Float64Array(5);
/** Tile `tile` of the field's two at (x, y) metres in it, the four values the file's head says, into `out`. */
export function fieldResult(recipe: WeatherRecipe, tile: number, x: number, y: number, out: Float64Array | number[]): void {
  const u = x / WEATHER_FIELD, v = y / WEATHER_FIELD_UP;
  const mine = smoothstep(0, SHARED, u) * smoothstep(0, SHARED, 1 - u) * smoothstep(0, SHARED, v) * smoothstep(0, SHARED, 1 - v);
  fieldRaw(tileSeed(recipe, -1), x, y, common);
  fieldRaw(tileSeed(recipe, tile), x, y, own);
  for (let c = 0; c < 5; c++) own[c] = stretch(common[c]! + (own[c]! - common[c]!) * mine, c);
  const dirty = smoothstep(0.5, 0.75, own[1]!), worn = 0.65 * (1 + dirty), gone = smoothstep(0.62, 0.7, own[3]! + 0.25 * dirty);
  const t = 1 - (0.88 * gone + 0.4 * worn * (1 - gone)), hold = own[4]!;
  out[0] = ((1 + (own[0]! - 0.5) * 0.7) * (1 - 0.4 * dirty)) / 2;
  out[1] = 0.35 * (0.4 + 0.6 * smoothstep(0.3, 0.8, own[2]!));
  out[2] = 0.6 * smoothstep(0.45, 0.8, own[2]!);
  out[3] = (smoothstep(t - 0.04, t, hold) + smoothstep(t, t + 0.02, hold)) / 2;
}

/** The bays' stamps: two bands a layer, each a stamp drawn from its own table (bayFeatures), padded at its top and foot; the ground storey's after the rest's. */
export function bayJob(recipe: WeatherRecipe = WEATHER_RECIPE): Job {
  const layout = bayLayout(recipe), tables: Float32Array[] = [];
  const table = (layer: number, band: number): Float32Array => (tables[layer * 2 + band] ??= bayFeatures(recipe, baySeed(recipe, layer, band), layer >= WEATHER_BAYS));
  return {
    layers: WEATHER_BAYS + WEATHER_GROUND,
    bands: 2,
    pad: WEATHER_PAD,
    taps: [2, 1],
    cost: 1.2,
    rows: layout.rows,
    glsl: bayGlsl(recipe),
    fill: (layer, band, out, at) => out.set(table(layer, band), at),
    made: (layer, band, u, v, out) => bayResult(recipe, table(layer, band), u * WEATHER_BAY, v * WEATHER_STOREY, out),
  };
}

/** The field: one layer of two tiles, a band each, which share their edges. */
export function fieldJob(recipe: WeatherRecipe = WEATHER_RECIPE): Job {
  return {
    layers: 1,
    bands: 2,
    pad: 0,
    taps: [2, 2],
    cost: 3.6,
    rows: 1,
    glsl: FIELD_GLSL,
    fill(_layer, band, out, at) {
      out[at] = tileSeed(recipe, -1);
      out[at + 1] = tileSeed(recipe, band);
      out[at + 2] = out[at + 3] = 0;
    },
    made: (_layer, band, u, v, out) => fieldResult(recipe, band, u * WEATHER_FIELD, v * WEATHER_FIELD_UP, out),
  };
}

/** The weathering's jobs, in the order their layers lie in the array (layers.ts). */
export const weatherJobs = (recipe: WeatherRecipe = WEATHER_RECIPE): Job[] => [bayJob(recipe), fieldJob(recipe), formworkJob()];

/** Layer `layer` of the array, `side` pixels a side, as RGBA8, row 0 first, as the card makes it. */
export function weatherPixels(layer: number, side: number, recipe: WeatherRecipe = WEATHER_RECIPE): Uint8Array {
  return layer < FIELD_LAYER ? jobPixels(bayJob(recipe), layer, side) : layer < FORMWORK_LAYER ? jobPixels(fieldJob(recipe), 0, side) : jobPixels(formworkJob(), 0, side);
}

/**
 * Layer `layer` of the array `side` pixels a side as a texture of the rasterizer's (render/cpu-texture.ts), its smaller
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
/** Reads layer `layer` of the array `side` pixels a side at (u, v), as `sample` reads a texture: the twin of the card's read. */
export function weatherRead(layer: number, side: number, u: number, v: number, spread: number, out: Float64Array): void {
  sample(weatherTexture(layer, side), u, v, spread, out);
}
const twins = new Map<number, WorldSample>();
/** The array's twin at `side` a side, as `weathered` is given it: the side the tier's card makes them at (texgenSide). */
export function weatherTwin(side: number): WorldSample {
  let t = twins.get(side);
  if (!t) twins.set(side, (t = (_role, layer, u, v, spread, out) => weatherRead(layer, side, u, v, spread, out)));
  return t;
}

const fl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

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
  float x = at.x * ${fl(WEATHER_BAY)}, y = at.y * ${fl(WEATHER_STOREY)};
  vec4 m = bayTexel(x, y), s = uJob[2 + ${AT_SPLASH}];
  float up = ${fl(WEATHER_STOREY)} - y, below = 1.0 - y / ${fl(WEATHER_STOREY)}, leak = 0.3 + 0.7 * s.z;
  float light = (1.0 - below * below * below * ${fl(BAND)}) * ${fl(1 - WASH)} * (1.0 - 0.3 * (1.0 - smoothstep(0.0, ${fl(FLOOR_DIRT)}, up)));
  float stain = 0.8 * m.b, damp = 0.0;
  if (s.w > 0.0) {
    int s7 = int(s.x);
    float edge = ${fl(FOOT)} + (line(x / 3.0, s7 + 610) - 0.5) * 0.8 * smoothstep(0.1, 1.5, min(x, ${fl(WEATHER_BAY)} - x));
    float foot = 1.0 - smoothstep(edge - 0.06, edge, up);
    float salt = (1.0 - smoothstep(edge * 0.7, edge + 0.25, up)) * smoothstep(0.55, 0.8, tiled(x / 0.9, up / 0.6, ${FREE}, ${FREE}, s7 + 620)) * sides(x, 0.25);
    light *= (1.0 - 0.5 * foot) * (1.0 - 0.32 * m.a) * (1.0 + 0.3 * salt);
    stain = up < ${fl(GROWTH_TOP)} ? (1.0 - smoothstep(0.1, 0.45, up)) * foot : stain * smoothstep(${fl(GROWTH_TOP)}, ${fl(GROWTH_TOP + 0.1)}, up);
    damp = foot;
  }
  return vec4(light * 0.5, stain, overOf(m.r * leak, 0.8 * m.g * (0.6 + 0.4 * leak)), damp);
}
`;
}

const FIELD_GLSL = `void fieldRaw(int seed, float x, float y, out vec4 a, out float hold) {
  a.x = fbm(x / 4.0, y / 4.0, 4, 2, seed + 1, 3);
  a.y = fbm(x / 8.0, y / 4.0, 2, 2, seed + 2, 2);
  float px = x + 2.0 * (fbm(x / 4.0, y / 4.0, 4, 2, seed + 20, 2) - 0.5), py = y + 2.0 * (fbm(x / 4.0, y / 4.0, 4, 2, seed + 21, 2) - 0.5);
  a.z = fbm(px / 4.0, py / 4.0, 4, 2, seed + 22, 3);
  a.w = fbm(x / 4.0, y / 4.0, 4, 2, seed + 4, 2);
  vec3 c = cells(x / 0.5, y / 0.5, 32, 16, seed + 11);
  float nick = 1.0 - smoothstep(0.0, 0.08, c.y - c.x);
  hold = fbm(x / 4.0, y / 4.0, 4, 2, seed + 10, 3) * 0.55 + c.z * 0.25 + cells(x / 0.2, y / 0.2, 80, 40, seed + 14).z * 0.13 + cells(x / 0.08, y / 0.08, 200, 100, seed + 17).z * 0.07 - 0.03 * nick;
}
float stretch(float v, int c) {
  vec2 s = ${`vec2[5](${FIELD_STRETCH.map(([m, d]) => `vec2(${fl(m)}, ${fl(d)})`).join(", ")})`}[c];
  return clamp((v - s.x) / s.y * 0.2887 + 0.5, 0.0, 1.0);
}
vec4 made(vec2 at) {
  float x = at.x * ${fl(WEATHER_FIELD)}, y = at.y * ${fl(WEATHER_FIELD_UP)}, ha, hb;
  vec4 a, b;
  fieldRaw(int(uJob[2].x), x, y, a, ha);
  fieldRaw(int(uJob[2].y), x, y, b, hb);
  float mine = smoothstep(0.0, ${fl(SHARED)}, at.x) * smoothstep(0.0, ${fl(SHARED)}, 1.0 - at.x) * smoothstep(0.0, ${fl(SHARED)}, at.y) * smoothstep(0.0, ${fl(SHARED)}, 1.0 - at.y);
  a = a + (b - a) * mine;
  float tone = stretch(a.x, 0), dirt = stretch(a.y, 1), patina = stretch(a.z, 2), hold = stretch(ha + (hb - ha) * mine, 4);
  float dirty = smoothstep(0.5, 0.75, dirt), worn = 0.65 * (1.0 + dirty), gone = smoothstep(0.62, 0.7, stretch(a.w, 3) + 0.25 * dirty);
  float t = 1.0 - (0.88 * gone + 0.4 * worn * (1.0 - gone));
  return vec4((1.0 + (tone - 0.5) * 0.7) * (1.0 - 0.4 * dirty) * 0.5, 0.35 * (0.4 + 0.6 * smoothstep(0.3, 0.8, patina)), 0.6 * smoothstep(0.45, 0.8, patina), (smoothstep(t - 0.04, t, hold) + smoothstep(t, t + 0.02, hold)) * 0.5);
}
`;
