// The walls' weathering made from its recipe (client/core/texgen/weather.ts): the same seed makes the same bytes, a
// bay's stamps meet at their sides in any order, the field's two tiles meet each other and themselves without a seam,
// and each layer holds what a wall's read applies.
import { expect, test } from "bun:test";
import { WEATHER_RECIPE } from "../../content/texgen/weather.ts";
import { hash3, tiled, cells } from "../../client/core/texgen/noise.ts";
import { FIELD_STRETCH, bayFeatures, bayLayout, bayResult, bayTexel, baySeed, fieldRaw, mipmapped, tileSeed, weatherJobs, weatherPixels, weatherTexture } from "../../client/core/texgen/weather.ts";
import { jobFragment, jobPixels } from "../../client/core/texgen/engine.ts";
import { formworkTexel } from "../../client/core/texgen/formwork.ts";
import { FIELD_LAYER, FORMWORK_LAYER, GROWTH_TOP, WEATHER_BAYS, WEATHER_GROUND, WEATHER_PAD, MADE_LAYER } from "../../client/core/texgen/layers.ts";
import { sample } from "../../client/core/render/cpu-texture.ts";

const SIDE = 128;
const layers = Array.from({ length: MADE_LAYER }, (_, l) => weatherPixels(l, SIDE));
const at = (px: Uint8Array, x: number, y: number, c: number): number => px[((y * SIDE + x) * 4) + c]!;
const STAMPS = WEATHER_BAYS + WEATHER_GROUND;
const table = (l: number, half: number): Float32Array => bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half), l >= WEATHER_BAYS);

test("the hash is the same for the same whole numbers, and tiled noise and cells wrap at their period", () => {
  expect(hash3(3, -7, 11)).toBe(hash3(3, -7, 11));
  expect(hash3(3, -7, 11)).not.toBe(hash3(3, -7, 12));
  expect(tiled(0.3, 0.7, 8, 4, 5)).toBeCloseTo(tiled(8.3, 4.7, 8, 4, 5), 12);
  const a = new Float64Array(3), b = new Float64Array(3);
  cells(0.3, 0.2, 16, 16, 9, a);
  cells(16.3, 16.2, 16, 16, 9, b);
  expect([...a].map((v) => v.toFixed(9))).toEqual([...b].map((v) => v.toFixed(9)));
});

test("a recipe makes the same bytes every time, and another seed makes other layers", () => {
  expect(weatherPixels(0, SIDE)).toEqual(layers[0]!);
  const other = weatherPixels(0, SIDE, { ...WEATHER_RECIPE, seed: WEATHER_RECIPE.seed + 1 });
  expect(other).not.toEqual(layers[0]!);
  expect(layers[0]).not.toEqual(layers[1]!);
  expect(weatherPixels(FIELD_LAYER, SIDE, { ...WEATHER_RECIPE, seed: WEATHER_RECIPE.seed + 1 })).not.toEqual(layers[FIELD_LAYER]!);
});

test("each variant's runoff wanders and its grain falls as its own: the seeds of its first track, its threads and its streaks are the variant's, and so is its leak", () => {
  const { atSplash, atDrips } = bayLayout(WEATHER_RECIPE), tracks = new Set<number>(), threads = new Set<number>(), drips = new Set<number>(), leaks = new Set<number>();
  let dripping = 0;
  for (let l = 0; l < STAMPS; l++) {
    for (const half of [0, 1]) {
      const f = table(l, half);
      tracks.add(f[5]!);
      threads.add(f[atSplash * 4 + 1]!);
      leaks.add(f[atSplash * 4 + 2]!);
      expect(f[atSplash * 4 + 3]).toBe(l >= WEATHER_BAYS ? 1 : 0);
      if (f[atDrips * 4 + 3]! >= 0) (drips.add(f[atDrips * 4 + 5]!), dripping++);
      // Whole numbers a float holds, three times of which an int holds.
      for (const s of [f[5]!, f[atSplash * 4 + 1]!]) expect([Number.isInteger(s), s < 1 << 20]).toEqual([true, true]);
    }
  }
  expect([tracks.size, threads.size, drips.size, leaks.size]).toEqual([STAMPS * 2, STAMPS * 2, dripping, STAMPS * 2]);
});

test("stamps meet at a bay's sides in any order: no rust or runoff there, and the light, the growth and the damp the same on every stamp of a storey", () => {
  for (let l = 0; l < STAMPS; l++) {
    for (let y = 0; y < SIDE; y++) {
      for (const x of [0, SIDE - 1]) {
        const first = l < WEATHER_BAYS ? 0 : WEATHER_BAYS;
        expect(at(layers[l]!, x, y, 2)).toBe(0);
        // The ground storey's splash is ragged at its top on its own, the same height either side.
        if (l < WEATHER_BAYS) expect([at(layers[l]!, x, y, 0), at(layers[l]!, x, y, 1)]).toEqual([at(layers[first]!, x, y, 0), 0]);
        for (const c of [1, 3]) expect(Math.abs(at(layers[l]!, x, y, c) - at(layers[first]!, x, y, c))).toBeLessThanOrEqual(2);
      }
    }
    const rows = (x: number): number => Array.from({ length: SIDE }, (_, y) => at(layers[l]!, x, y, 0) < at(layers[0]!, x, y, 0) - 8).filter(Boolean).length;
    expect(Math.abs(rows(0) - rows(SIDE - 1))).toBeLessThanOrEqual(2);
  }
});

test("no read of one of a bay layer's two stamps takes the other's, filtered at any level up to half a metre a texel: each storey's top and foot rows hold its own edge, and runoff fades at the floor as drips and rust do", () => {
  const side = 256, half = side * side * 2, top = Math.log2(side), pad = (side / 2) * WEATHER_PAD;
  for (const [first, second] of [[0, 1], [WEATHER_BAYS, WEATHER_BAYS + 1]] as const) {
    const a = weatherPixels(first, side), b = weatherPixels(second, side);
    // A layer with another's lower stamp: the upper reads as it did, and the lower as the other's, top and foot and across the wrap.
    const mixed = Uint8Array.from(a);
    mixed.set(b.subarray(half), half);
    const [ta, tb, tm] = [a, b, mixed].map((px) => mipmapped(px, side)), x = new Float64Array(4), y = new Float64Array(4);
    // Half a metre a texel at 256 is level 4, which half a texel of reaches the pad rows and no further.
    expect(Math.log2(pad) + 1).toBe(4);
    for (let level = 0; level <= 4; level++) {
      for (let k = 0; k <= 64; k++) {
        const down = (k / 64) * 0.9999, u = 0.03 + (k % 9) * 0.11;
        for (const [lower, own] of [[0, ta], [1, tb]] as const) {
          const v = (lower + WEATHER_PAD + down * (1 - 2 * WEATHER_PAD)) / 2;
          sample(own!, u, v, level - top, x);
          sample(tm!, u, v, level - top, y);
          expect([...y]).toEqual([...x]);
        }
      }
    }
  }
  // At the foot runoff, drips and rust are gone; the splash is there.
  const v = new Float64Array(4);
  let splash = 0;
  for (let l = 0; l < WEATHER_BAYS; l++) {
    for (let x0 = 0.2; x0 < 7.8; x0 += 0.05) {
      bayTexel(WEATHER_RECIPE, table(l, 0), x0, 4, v);
      expect([v[0], v[1], v[2]]).toEqual([0, 0, 0]);
      splash += v[3]!;
    }
  }
  expect(splash).toBeGreaterThan(0);
});

test("runoff begins at the slab line and is strongest near it; splash keeps to the foot", () => {
  const v = new Float64Array(4);
  let top = 0, low = 0;
  for (let l = 0; l < WEATHER_BAYS; l++) {
    for (const half of [0, 1]) {
      for (let x = 0.2; x < 7.8; x += 0.01) {
        bayTexel(WEATHER_RECIPE, table(l, half), x, 0.001, v);
        expect(v[0]).toBeLessThan(0.05);
        bayTexel(WEATHER_RECIPE, table(l, half), x, 0.25, v);
        top += v[0]!;
        bayTexel(WEATHER_RECIPE, table(l, half), x, 3.3, v);
        low += v[0]!;
        expect(v[3]).toBe(0);
        bayTexel(WEATHER_RECIPE, table(l, half), x, 3.98, v);
        expect([v[1], v[2]]).toEqual([0, 0]);
      }
    }
  }
  expect(top).toBeGreaterThan(low * 3);
});

test("a stamp holds what a wall applies: its light darkest under the slab line and over the floor, the runoff's cover, rust up the wall, and on the ground storey alone a damp foot, its growth under GROWTH_TOP and its splash", () => {
  const v = new Float64Array(4), mean = (l: number, y: number, c: number): number => {
    let sum = 0;
    for (const half of [0, 1]) for (let x = 0.3; x < 7.7; x += 0.05) (bayResult(WEATHER_RECIPE, table(l, half), x, y, v), (sum += v[c]!));
    return sum / 296;
  };
  for (const l of [0, 3, WEATHER_BAYS, STAMPS - 1]) {
    const ground = l >= WEATHER_BAYS;
    // Halved light: 0.5 is none.
    expect(mean(l, 0.05, 0)).toBeLessThan(mean(l, 2, 0) - 0.05);
    expect(mean(l, 3.99, 0)).toBeLessThan(mean(l, 3.5, 0));
    expect(mean(l, 2, 0)).toBeWithin(0.42, 0.5);
    expect(mean(l, 0.4, 2)).toBeGreaterThan(mean(l, 3, 2));
    // The damp foot and its growth, up to about a metre: none over the ground storey, nor high on it.
    expect(mean(l, 3.9, 3) > 0.5).toBe(ground);
    expect(mean(l, 4 - 2.5, 3)).toBe(0);
    expect(mean(l, 3.95, 1) > 0.2).toBe(ground);
    for (const y of [3.3, 2]) if (ground) expect(mean(l, y, 1)).toBeLessThan(0.05);
    expect(4 - GROWTH_TOP).toBeLessThan(3.5);
  }
  let rust = 0;
  for (let l = 0; l < WEATHER_BAYS; l++) for (let y = 0.5; y < 3.5; y += 0.25) rust += mean(l, y, 1);
  expect(rust).toBeGreaterThan(0);
});

test("the field's two tiles meet each other and themselves at every edge, and differ within", () => {
  const f = layers[FIELD_LAYER]!, rows = SIDE / 2, row = (tile: number, y: number): number => tile * rows + y;
  for (let c = 0; c < 4; c++) {
    let across = 0, inside = 0, apart = 0;
    for (let k = 0; k < SIDE; k++) {
      for (const tile of [0, 1]) {
        // A tile's left column against its right and the other's, and its top row against its foot and the other's.
        across += Math.abs(at(f, 0, row(tile, k % rows), c) - at(f, SIDE - 1, row(1 - tile, k % rows), c)) + Math.abs(at(f, k, row(tile, 0), c) - at(f, k, row(1 - tile, rows - 1), c));
        inside += Math.abs(at(f, SIDE / 2, row(tile, k % rows), c) - at(f, SIDE / 2 - 1, row(tile, k % rows), c)) + Math.abs(at(f, k, row(tile, rows / 2), c) - at(f, k, row(tile, rows / 2 - 1), c));
      }
      apart += Math.abs(at(f, k, row(0, rows / 2), c) - at(f, k, row(1, rows / 2), c));
    }
    expect(across).toBeLessThan(inside * 1.6 + SIDE * 4);
    if (c < 3) expect(apart).toBeGreaterThan(SIDE * 2);
  }
});

test("the field's stretch is its tiles' own: each raw channel's mean and spread over them", () => {
  const n = 48, raw = new Float64Array(5), sum = new Float64Array(5), sq = new Float64Array(5);
  for (const tile of [-1, 0, 1]) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        fieldRaw(tileSeed(WEATHER_RECIPE, tile), ((i + 0.5) / n) * 16, ((j + 0.5) / n) * 8, raw);
        for (let c = 0; c < 5; c++) {
          sum[c]! += raw[c]!;
          sq[c]! += raw[c]! * raw[c]!;
        }
      }
    }
  }
  // Should this fail, the recipe's seed or the field's noises changed: measure FIELD_STRETCH again.
  for (let c = 0; c < 5; c++) {
    const k = 3 * n * n, m = sum[c]! / k;
    expect(Math.abs(m - FIELD_STRETCH[c]![0])).toBeLessThan(0.01);
    expect(Math.abs(Math.sqrt(sq[c]! / k - m * m) - FIELD_STRETCH[c]![1])).toBeLessThan(0.01);
  }
});

test("formwork's joints run at the tile's edges, every 2 m along a concrete wall and up it, with tie holes between them, and its mipmaps fade them as a texel grows wider than a joint", () => {
  expect(formworkTexel(0.001, 1.3)).toBeGreaterThan(0.5);
  expect(formworkTexel(1.3, 1.9995)).toBeGreaterThan(0.5);
  expect(formworkTexel(0.7, 0.7)).toBe(0);
  expect(formworkTexel(0.38, 0.38)).toBeGreaterThan(0.5);
  // At 4 cm a texel of the 2 m tile, 64 of them a side, no texel is half covered; the read has let the joints go by 8 cm.
  const t = mipmapped(weatherPixels(FORMWORK_LAYER, 256), 256), top = t.pictures[8]!, level = t.pictures[6]!;
  const most = (p: Float32Array): number => Math.max(...p.filter((_, i) => i % 4 === 0));
  expect([most(top) > 0.9, most(level) < 0.5]).toEqual([true, true]);
});

test("the rasterizer's texture of a layer has every level, each the mean of the next", () => {
  const t = weatherTexture(0, 64);
  expect(t.pictures.map((p) => Math.sqrt(p.length / 4))).toEqual([1, 2, 4, 8, 16, 32, 64]);
  const top = t.pictures[6]!, next = t.pictures[5]!;
  expect(next[0]!).toBeCloseTo((top[0]! + top[4]! + top[64 * 4]! + top[65 * 4]!) / 4, 6);
});

test("the card's programs draw what the TypeScript draws: the same loops, ranges and seeds, as the engine's jobs, in the array's layers", () => {
  const jobs = weatherJobs(), [bays, fields, form] = jobs, texts = jobs.map(jobFragment);
  expect([bays!.layers, fields!.layers, form!.layers, bays!.bands, fields!.bands, form!.bands, bays!.pad, fields!.pad]).toEqual([STAMPS, 1, 1, 2, 2, 1, WEATHER_PAD, 0]);
  expect([STAMPS, STAMPS + fields!.layers, jobs.reduce((n, j) => n + j.layers, 0)]).toEqual([FIELD_LAYER, FORMWORK_LAYER, MADE_LAYER]);
  for (const name of ["vec4 bayTexel(", `uJob[${2 + bayLayout(WEATHER_RECIPE).rows}]`, `i < ${WEATHER_RECIPE.runs.heads[1] * WEATHER_RECIPE.runs.trails[1]}`, `i < ${WEATHER_RECIPE.runs.threads[1]}`]) expect(texts[0]).toContain(name);
  for (const name of ["void fieldRaw(", "float stretch(", "uJob[3]"]) expect(texts[1]).toContain(name);
  expect(texts[2]).toContain("float hole(");
  for (const text of texts) {
    expect(text.startsWith("#version 300 es")).toBe(true);
    // GLSL ES keeps these words, and % of a negative is undefined there.
    for (const word of [/\bhalf\b(?! a)/, /float dot\b/]) expect(text).not.toMatch(word);
    expect(text).toContain("(i + n * 64) % n");
  }
});

test("the first pass, at an eighth of the side with twice the taps each way, is near the whole pass's mipmap at its level, so that nothing pops as the whole comes in", () => {
  const side = 256, wide = 64, level = Math.log2(side / wide);
  for (const [job, layer] of [[weatherJobs()[0]!, 2], [weatherJobs()[0]!, WEATHER_BAYS], [weatherJobs()[1]!, 0]] as const) {
    const coarse = jobPixels(job, layer, wide, [job.taps[0] * 2, job.taps[1] * 2]), whole = mipmapped(jobPixels(job, layer, side), side).pictures[Math.log2(wide)]!;
    let sum = 0, most = 0;
    for (let i = 0; i < coarse.length; i++) {
      const d = Math.abs(coarse[i]! / 255 - whole[i]!);
      sum += d;
      most = Math.max(most, d);
    }
    expect(level).toBe(2);
    expect(sum / coarse.length).toBeLessThan(3 / 255);
    expect(most).toBeLessThan(0.25);
  }
});
