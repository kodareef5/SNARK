// The walls' weathering masks made from their recipe (client/core/texgen/weather.ts): the same seed makes the same
// bytes, a bay's masks vanish at its sides so bays meet in any order, a field tiles without a seam, and each field's
// values are spread evenly, so a threshold over it takes that share of a wall.
import { expect, test } from "bun:test";
import { WEATHER_RECIPE } from "../../content/texgen/weather.ts";
import { hash3, tiled, cells } from "../../client/core/texgen/noise.ts";
import { WEATHER_BAYS, WEATHER_LAYERS, WEATHER_GEN_VERTEX, bayFeatures, bayLayout, bayTexel, baySeed, equalize, fieldLut, fieldSeed, weatherFragment, weatherPixels, weatherTexture } from "../../client/core/texgen/weather.ts";

const SIDE = 128;
const layers = Array.from({ length: WEATHER_LAYERS }, (_, l) => weatherPixels(l, SIDE));
const at = (px: Uint8Array, x: number, y: number, c: number): number => px[((y * SIDE + x) * 4) + c]!;

test("the hash is the same for the same whole numbers, and tiled noise and cells wrap at their period", () => {
  expect(hash3(3, -7, 11)).toBe(hash3(3, -7, 11));
  expect(hash3(3, -7, 11)).not.toBe(hash3(3, -7, 12));
  expect(tiled(0.3, 0.7, 8, 4, 5)).toBeCloseTo(tiled(8.3, 4.7, 8, 4, 5), 12);
  const a = new Float64Array(3), b = new Float64Array(3);
  cells(0.3, 0.2, 16, 16, 9, a);
  cells(16.3, 16.2, 16, 16, 9, b);
  expect([...a].map((v) => v.toFixed(9))).toEqual([...b].map((v) => v.toFixed(9)));
});

test("a recipe makes the same bytes every time, and another seed makes other masks", () => {
  expect(weatherPixels(0, SIDE)).toEqual(layers[0]!);
  const other = weatherPixels(0, SIDE, { ...WEATHER_RECIPE, seed: WEATHER_RECIPE.seed + 1 });
  expect(other).not.toEqual(layers[0]!);
  expect(layers[0]).not.toEqual(layers[1]!);
});

test("each variant's runoff wanders and its grain falls as its own: the seeds of its first track, its threads and its streaks are the variant's", () => {
  const { atSplash, atDrips } = bayLayout(WEATHER_RECIPE), tracks = new Set<number>(), threads = new Set<number>(), drips = new Set<number>();
  let dripping = 0;
  for (let l = 0; l < WEATHER_BAYS; l++) {
    for (const half of [0, 1]) {
      const f = bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half));
      tracks.add(f[5]!);
      threads.add(f[atSplash * 4 + 1]!);
      if (f[atDrips * 4 + 3]! >= 0) (drips.add(f[atDrips * 4 + 5]!), dripping++);
      // Whole numbers a float holds, three times of which an int holds.
      for (const s of [f[5]!, f[atSplash * 4 + 1]!]) expect([Number.isInteger(s), s < 1 << 20]).toEqual([true, true]);
    }
  }
  expect([tracks.size, threads.size, drips.size]).toEqual([WEATHER_BAYS * 2, WEATHER_BAYS * 2, dripping]);
});

test("a bay's runoff, drips and rust are nothing at its sides, so bays meet in any order; its splash meets at one height either side", () => {
  for (let l = 0; l < WEATHER_BAYS; l++) {
    for (let y = 0; y < SIDE; y++) for (const c of [0, 1, 2]) expect([at(layers[l]!, 0, y, c), at(layers[l]!, SIDE - 1, y, c)]).toEqual([0, 0]);
    // Splash reaches as high up either side: the same rows hold any of it.
    const rows = (x: number): number => Array.from({ length: SIDE }, (_, y) => at(layers[l]!, x, y, 3) > 0).filter(Boolean).length;
    expect(Math.abs(rows(0) - rows(SIDE - 1))).toBeLessThanOrEqual(2);
  }
});

test("runoff begins at the slab line and is strongest near it; splash keeps to the foot", () => {
  const v = new Float64Array(4);
  let top = 0, low = 0;
  for (let l = 0; l < WEATHER_BAYS; l++) {
    for (const half of [0, 1]) {
      for (let x = 0.2; x < 7.8; x += 0.01) {
        bayTexel(WEATHER_RECIPE, bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half)), x, 0.001, v);
        expect(v[0]).toBeLessThan(0.05);
        bayTexel(WEATHER_RECIPE, bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half)), x, 0.25, v);
        top += v[0]!;
        bayTexel(WEATHER_RECIPE, bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half)), x, 3.3, v);
        low += v[0]!;
        expect(v[3]).toBe(0);
        bayTexel(WEATHER_RECIPE, bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half)), x, 3.98, v);
        expect([v[1], v[2]]).toEqual([0, 0]);
      }
    }
  }
  expect(top).toBeGreaterThan(low * 3);
});

test("a field tiles: across its wrap its values change as much as within it", () => {
  for (let l = WEATHER_BAYS; l < WEATHER_LAYERS; l++) {
    for (let c = 0; c < 4; c++) {
      let wrap = 0, inside = 0;
      for (let y = 0; y < SIDE; y++) {
        wrap += Math.abs(at(layers[l]!, 0, y, c) - at(layers[l]!, SIDE - 1, y, c)) + Math.abs(at(layers[l]!, y, 0, c) - at(layers[l]!, y, SIDE - 1, c));
        inside += Math.abs(at(layers[l]!, SIDE / 2, y, c) - at(layers[l]!, SIDE / 2 - 1, y, c)) + Math.abs(at(layers[l]!, y, SIDE / 2, c) - at(layers[l]!, y, SIDE / 2 - 1, c));
      }
      expect(wrap).toBeLessThan(inside * 1.6 + SIDE * 2);
    }
  }
});

test("a field's values are spread evenly by its table: a threshold takes about its share", () => {
  for (let l = WEATHER_BAYS; l < WEATHER_LAYERS; l++) {
    const lut = fieldLut(fieldSeed(WEATHER_RECIPE, l - WEATHER_BAYS));
    for (let c = 0; c < 4; c++) {
      for (let k = 0; k < 32; k++) expect(lut[(k + 1) * 4 + c]!).toBeGreaterThanOrEqual(lut[k * 4 + c]!);
      expect([equalize(lut[c]! - 1, lut, c), equalize(lut[32 * 4 + c]! + 1, lut, c)]).toEqual([0, 1]);
      for (const cut of [0.2, 0.5, 0.8]) {
        let over = 0;
        for (let i = 0; i < SIDE * SIDE; i++) if (layers[l]![i * 4 + c]! > cut * 255) over++;
        expect(over / (SIDE * SIDE)).toBeWithin(1 - cut - 0.08, 1 - cut + 0.08);
      }
    }
  }
});

test("the rasterizer's texture of a layer has every level, each the mean of the next", () => {
  const t = weatherTexture(0, 64);
  expect(t.pictures.map((p) => Math.sqrt(p.length / 4))).toEqual([1, 2, 4, 8, 16, 32, 64]);
  const top = t.pictures[6]!, next = t.pictures[5]!;
  expect(next[0]!).toBeCloseTo((top[0]! + top[4]! + top[64 * 4]! + top[65 * 4]!) / 4, 6);
});

test("the card's program draws what the TypeScript draws: the same loops, ranges and seeds", () => {
  const text = weatherFragment();
  expect(text.startsWith("#version 300 es")).toBe(true);
  expect(WEATHER_GEN_VERTEX).toContain("gl_VertexID");
  for (const name of ["bayTexel", "fieldRaw", "equalize", "uLut[33]", `uBay[${bayLayout(WEATHER_RECIPE).rows}]`, `i < ${WEATHER_RECIPE.runs.heads[1] * WEATHER_RECIPE.runs.trails[1]}`, `i < ${WEATHER_RECIPE.runs.threads[1]}`]) expect(text).toContain(name);
  // GLSL ES keeps these words, and % of a negative is undefined there.
  for (const word of [/\bhalf\b(?! a)/, /float dot\b/]) expect(text).not.toMatch(word);
  expect(text).toContain("(i + n * 64) % n");
});
