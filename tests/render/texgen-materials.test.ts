// The materials made from recipes (content/texgen/materials.ts, client/core/texgen/materials.ts, slots.ts): each recipe
// fits its tile, tiles and keeps its ranges and pinned means; one job makes any by its version; the nearest take the slots.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { MADE_FINISHES, MADE_SHARE, RUIN_FINISHES, SEAM_SHARE, finished, flatRoof, madeFinish, pitchFinish } from "../../content/ruins.ts";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { madeFar, madeShift } from "../../client/core/render/world-surfaces.ts";
import { jobFragment, jobPixels } from "../../client/core/texgen/engine.ts";
import { MADE_FLOATS, MADE_LAYER, MADE_READS, MADE_SLOTS, MOST_MATERIALS, TEXGEN_BUDGET, TEXGEN_LAYERS, madePhase, materialIndex, noMade, texgenBytes } from "../../client/core/texgen/layers.ts";
import { MATERIAL_ROWS, materialHeight, materialJob, materialRows, materialTexel } from "../../client/core/texgen/materials.ts";
import { MADE_RISE, MadeSlots } from "../../client/core/texgen/slots.ts";
import { texgen } from "../../client/core/texgen/late.ts";

const whole = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-4 && Math.round(n) >= 1;

test("every material a piece names is a recipe, a made finish keeps its painted one's colour, and a roof is a recipe", () => {
  expect(MATERIAL_RECIPES.length).toBeLessThanOrEqual(MOST_MATERIALS);
  expect(new Set(MATERIAL_RECIPES.map((r) => r.name)).size).toBe(MATERIAL_RECIPES.length);
  const named = CORE_CONTENT.flatMap((d) => (d.type === "structure" && d.made ? [d.made] : []));
  expect(named.length).toBeGreaterThan(0);
  for (const name of named) expect(materialIndex(name)).toBeGreaterThan(0);
  // Every recipe is worn by some piece.
  for (const r of MATERIAL_RECIPES) expect(named).toContain(r.name);
  for (const [painted, made] of Object.entries(MADE_FINISHES)) {
    for (const name of made!) expect(RUIN_FINISHES[name].color).toBe(RUIN_FINISHES[painted as keyof typeof RUIN_FINISHES].color);
  }
  expect([materialIndex(undefined), materialIndex("stucco")]).toEqual([0, 1]);
  // A roof's finishes come on a roof's pieces alone.
  expect([finished("floor8", "tar"), finished("zpitch8", "seam"), finished("zpitch8", "rustseam"), finished("wall8", "tar"), finished("wall8", "seam"), finished("wall8", "rustseam"), finished("wall8", "rosestucco")]).toEqual([true, true, true, false, false, false, true]);
});

test("every cell, grain, course and rib of a recipe fits its tile a whole number of times, and a bonded course an even one", () => {
  for (const r of MATERIAL_RECIPES) {
    expect(r.noise.length).toBeLessThanOrEqual(4);
    for (const n of r.noise) expect([r.name, whole(r.metres / n.cell[0]), whole(r.metres / n.cell[1])]).toEqual([r.name, true, true]);
    if (r.grain) expect([r.name, whole(r.metres / r.grain.size)]).toEqual([r.name, true]);
    if (r.course) expect([r.name, whole(r.metres / r.course.size[0]), whole(r.metres / r.course.size[1] / (r.course.bond ? 2 : 1))]).toEqual([r.name, true, true]);
    if (r.rib) expect([r.name, whole(r.metres / r.rib.pitch)]).toEqual([r.name, true]);
    expect(materialRows(r, 0).length).toBe(MATERIAL_ROWS * 4);
  }
});

test("each material meets itself at its tile's edges, keeps its values in range and its lean under a unit", () => {
  const v = new Float64Array(4), look = new Float64Array(3);
  for (const r of MATERIAL_RECIPES) {
    const base = materialRows(r, 0), relief = materialRows(r, 1), T = base[0]!;
    for (let t = 0.013; t < 1; t += 0.037) {
      expect(materialHeight(base, 0, t * T, look)).toBeCloseTo(materialHeight(base, T, t * T, look), 4);
      expect(materialHeight(base, t * T, 0, look)).toBeCloseTo(materialHeight(base, t * T, T, look), 4);
    }
    for (let k = 0; k < 300; k++) {
      const x = ((k * 0.6180339) % 1) * T, y = ((k * 0.7548776) % 1) * T;
      materialTexel(base, x, y, v);
      // Its light is halved about its mean, so twice the mean is the most it holds.
      for (let c = 0; c < 4; c++) expect([r.name, v[c]! >= 0 && v[c]! <= 1.0001]).toEqual([r.name, true]);
      materialTexel(relief, x, y, v);
      for (let c = 0; c < 4; c++) expect([r.name, v[c]! >= 0 && v[c]! <= 1.0001]).toEqual([r.name, true]);
      expect(Math.hypot(v[0]! * 2 - 1, v[1]! * 2 - 1)).toBeLessThanOrEqual(1);
    }
  }
});

test("a recipe's pinned means are its layers' means, which the read draws far off", () => {
  const job = materialJob(1), stale: string[] = [];
  MATERIAL_RECIPES.forEach((r, k) => {
    const base = jobPixels(job, 0, 64, job.taps, k + 1), relief = jobPixels(job, 1, 64, job.taps, k + 1);
    let light = 0, dye = 0, rough = 0, leanX = 0, leanY = 0;
    for (let i = 0; i < base.length; i += 4) {
      light += base[i + 1]!;
      dye += base[i + 3]!;
      rough += relief[i + 2]!;
      leanX += relief[i]!;
      leanY += relief[i + 1]!;
    }
    const n = (base.length / 4) * 255;
    const means = [(light / n) * 2 * r.means[0], dye / n, rough / n].map((m) => Math.round(m * 100) / 100);
    if (means.some((m, c) => Math.abs(m - r.means[c]!) > 0.011)) stale.push(`${r.name}: means [${means.join(", ")}]`);
    // A tile leans no way on the whole.
    expect([r.name, Math.abs(leanX / n - 0.5) < 0.01, Math.abs(leanY / n - 0.5) < 0.01]).toEqual([r.name, true, true]);
  });
  expect(stale).toEqual([]);
});

test("one job makes any material by its layer's version, with one program, and the slots fit the array's budget", () => {
  const job = materialJob();
  expect([job.layers, job.rows, MADE_LAYER + job.layers]).toEqual([MADE_SLOTS * 2, MATERIAL_ROWS, TEXGEN_LAYERS]);
  expect(jobFragment(job)).toContain(`uniform vec4 uJob[${2 + MATERIAL_ROWS}];`);
  const stucco = jobPixels(job, 0, 16, job.taps, 1), block = jobPixels(job, 0, 16, job.taps, 3), again = jobPixels(job, 2, 16, job.taps, 1);
  expect(Array.from(stucco)).toEqual(Array.from(again));
  expect(Array.from(stucco)).not.toEqual(Array.from(block));
  // The rows a layer is drawn with are the recipe's, its relief's marked.
  const rows = new Float32Array(MATERIAL_ROWS * 4);
  job.fill(3, 0, rows, 0, 3);
  expect(Array.from(rows)).toEqual(Array.from(materialRows(MATERIAL_RECIPES[2]!, 1)));
  expect(texgenBytes(512)).toBeLessThanOrEqual(TEXGEN_BUDGET);
  expect(texgenBytes(512) / 2 ** 20).toBeCloseTo(25.33, 1);
});

/** `frames` frames of `slots`, the card holding in `holds` what was wanted the frame before. */
function run(slots: MadeSlots, near: number[], out: Float32Array, frames: number, holds: Int32Array | null): void {
  for (let f = 0; f < frames; f++) {
    slots.frame(near, holds, out, 0);
    holds?.set(slots.want);
  }
}
const far = (): number[] => MATERIAL_RECIPES.map(() => Infinity);
const layerOf = (out: Float32Array, name: string): number => out[(materialIndex(name) - 1) * MADE_FLOATS]!;
const readyOf = (out: Float32Array, name: string): number => out[(materialIndex(name) - 1) * MADE_FLOATS + 1]!;

test("the materials nearest the eye take the slots, and each comes up once the card holds it", () => {
  const slots = new MadeSlots(), out = new Float32Array(MATERIAL_RECIPES.length * MADE_FLOATS), near = far(), holds = new Int32Array(TEXGEN_LAYERS);
  run(slots, near, out, 3, holds);
  expect(MATERIAL_RECIPES.map((r) => layerOf(out, r.name))).toEqual(MATERIAL_RECIPES.map(() => -1));
  expect(Array.from(slots.want.subarray(0, MADE_LAYER))).toEqual(Array.from({ length: MADE_LAYER }, () => 1));
  expect(Array.from(slots.want.subarray(MADE_LAYER))).toEqual(Array.from({ length: MADE_SLOTS * 2 }, () => 0));
  near[materialIndex("stucco") - 1] = 30;
  slots.frame(near, holds, out, 0);
  // Asked for, and not read before the card holds it.
  expect([layerOf(out, "stucco") >= MADE_LAYER, readyOf(out, "stucco"), layerOf(out, "block")]).toEqual([true, 0, -1]);
  expect(slots.want[layerOf(out, "stucco")]).toBe(materialIndex("stucco"));
  expect(slots.want[layerOf(out, "stucco") + 1]).toBe(materialIndex("stucco"));
  run(slots, near, out, MADE_RISE + 2, holds);
  expect(readyOf(out, "stucco")).toBe(1);
  // Where nothing is made, nothing comes up.
  const none = new MadeSlots();
  run(none, near, out, MADE_RISE + 2, null);
  expect(readyOf(out, "stucco")).toBe(0);
});

test("more materials than slots: the nearest hold them, one a little nearer does not take a slot, and one taken begins again", () => {
  const slots = new MadeSlots(), out = new Float32Array(MATERIAL_RECIPES.length * MADE_FLOATS), near = far(), holds = new Int32Array(TEXGEN_LAYERS);
  const names = ["corrugated", "seam", "block", "render", "gravel"];
  names.slice(0, 4).forEach((n, i) => (near[materialIndex(n) - 1] = 10 + i * 10));
  run(slots, near, out, MADE_RISE + 2, holds);
  expect(names.slice(0, 4).map((n) => readyOf(out, n))).toEqual([1, 1, 1, 1]);
  const held = names.slice(0, 4).map((n) => layerOf(out, n));
  expect(new Set(held).size).toBe(MADE_SLOTS);
  // Gravel a little nearer than the farthest held: no trade.
  near[materialIndex("gravel") - 1] = 38;
  run(slots, near, out, 3, holds);
  expect([layerOf(out, "gravel"), layerOf(out, "render")]).toEqual([-1, held[3]!]);
  // Much nearer: it takes the farthest's slot, which is not read until the card holds gravel there.
  near[materialIndex("gravel") - 1] = 5;
  slots.frame(near, holds, out, 0);
  expect([layerOf(out, "gravel"), layerOf(out, "render"), readyOf(out, "gravel")]).toEqual([held[3]!, -1, 0]);
  expect(names.slice(0, 3).map((n) => [layerOf(out, n), readyOf(out, n)])).toEqual(held.slice(0, 3).map((l) => [l, 1]));
  run(slots, near, out, MADE_RISE + 2, holds);
  expect(readyOf(out, "gravel")).toBe(1);
});

test("the frame is told where the eye is in each material's tiles, less whole tiles", () => {
  const out = new Float32Array(MATERIAL_RECIPES.length * MADE_FLOATS);
  madePhase(out, 0, 7001.25, 3.5, -12.75);
  MATERIAL_RECIPES.forEach((r, k) => {
    for (const [c, v] of [7001.25, 3.5, -12.75].entries()) {
      const phase = out[k * MADE_FLOATS + 4 + c]!;
      expect(phase >= 0 && phase < 1).toBe(true);
      expect(Math.abs(((v / r.metres - phase + 0.5) % 1 + 1) % 1 - 0.5)).toBeLessThan(1e-3);
    }
  });
});

test("a building's made finish is by its type and storeys, in its colour, the same at each draw", () => {
  const count = (painted: Parameters<typeof madeFinish>[0], type: string, storeys: number): Record<string, number> => {
    const n: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const f = madeFinish(painted, type, storeys, (i * 0.6180339) % 1, (i * 0.7548776) % 1);
      n[f] = (n[f] ?? 0) + 1;
      expect(RUIN_FINISHES[f].color).toBe(RUIN_FINISHES[painted].color);
    }
    return n;
  };
  // Sheet on a shed in any colour and on a low shop in a metal's, never on an office block, a house or a low shop in a pastel.
  expect(count("steel", "apartment", 10)).toEqual({ steel: 1000 });
  expect(count("blue", "house", 2)).toEqual({ blue: 1000 });
  expect(count("clay", "apartment", 2)).toEqual({ clay: 1000 });
  expect(count("limestone", "shop", 2).limesheet).toBeUndefined();
  expect(count("steel", "shed", 4).steelsheet).toBeGreaterThan(450);
  expect(count("rust", "shop", 2).rustsheet).toBeGreaterThan(450);
  for (const [painted, sheet] of [["limestone", "limesheet"], ["mint", "mintsheet"], ["clay", "claysheet"]] as const) expect(count(painted, "shed", 2)).toEqual({ [painted]: count(painted, "shed", 2)[painted]!, [sheet]: 1000 - count(painted, "shed", 2)[painted]! });
  expect(count("clay", "shed", 2).claysheet).toBeGreaterThan(450);
  // Block on houses and garages up to three storeys; stucco likelier than render on a house, render on a tower.
  const house = count("rose", "house", 2), tower = count("rose", "tower", 20);
  expect(house.roseblock! > 100 && house.rosestucco! > house.roserender! * 2).toBe(true);
  expect(tower.roseblock).toBeUndefined();
  expect(tower.roserender! > tower.rosestucco! * 2).toBe(true);
  expect(count("concrete", "garage", 3).greyblock).toBeGreaterThan(450);
  expect(count("concrete", "garage", 5)).toEqual({ concrete: 1000 });
  expect(Math.abs(house.rose! / 1000 - (1 - MADE_SHARE))).toBeLessThan(0.05);
  expect(madeFinish("rose", "house", 2, 0.2, 0.3)).toBe(madeFinish("rose", "house", 2, 0.2, 0.3));
  // Roofs: tar on a flat roof but a garage's deck and under a pitch; seam on sheds and commerce, clay on houses but a few.
  expect([flatRoof("apartment", "service"), flatRoof("hotel", "terrace"), flatRoof("shed", "monitor"), flatRoof("garage", "service"), flatRoof("house", "hip"), flatRoof("station", "canopy")]).toEqual(["tar", "tar", "tar", "concrete", "concrete", "concrete"]);
  expect([pitchFinish("shed", 0.9), pitchFinish("shop", 0.9), pitchFinish("house", 0.9), pitchFinish("house", SEAM_SHARE / 2)]).toEqual(["seam", "seam", "clay", "seam"]);
});

test("what the first frame holds of each material is its recipe's, and no slot is held until the keeper comes", () => {
  // The read's rows are pinned apart from the recipes (layers.ts MADE_READS): this says when one is stale.
  expect(MADE_READS.map((r) => r.name)).toEqual(MATERIAL_RECIPES.map((r) => r.name));
  MATERIAL_RECIPES.forEach((r, k) => {
    const read = MADE_READS[k]!, shift = madeShift(r);
    expect([r.name, read.metres, read.relief, read.mottle, read.lies, read.coat]).toEqual([r.name, r.metres, r.relief, r.mottle, r.lies === true, r.coat === true]);
    expect([r.name, Math.abs(read.far - madeFar(r)) < 1e-6, Math.abs(read.shift[0] - shift[0]) < 1e-6, Math.abs(read.shift[1] - shift[1]) < 1e-6]).toEqual([r.name, true, true, true]);
  });
  // A frame before the engine's file has come says no material has a slot; the keeper comes with the engine.
  const out = new Float32Array(MADE_READS.length * MADE_FLOATS);
  noMade(out, 0);
  for (let k = 0; k < MADE_READS.length; k++) expect([out[k * MADE_FLOATS], out[k * MADE_FLOATS + 1]]).toEqual([-1, 0]);
  expect(texgen(null as never).wants).toBeInstanceOf(MadeSlots);
});
