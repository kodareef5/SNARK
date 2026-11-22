// Materials made from recipes (content/texgen/finishes.ts, client/core/texgen/finishes.ts): every piece's recipe is one,
// a made finish wears its painted one's colour, each material tiles and stays in its ranges, and a face of one keeps
// its own layers apart from another's in the city's meshes.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { MADE_FINISHES, RUIN_FINISHES } from "../../content/ruins.ts";
import { FINISH_RECIPES, MOST_RECIPES, recipeIndex, roofOf } from "../../content/texgen/finishes.ts";
import { finishHeight, finishTexel } from "../../client/core/texgen/finishes.ts";
import { MADE_FIRST, MADE_LAYERS, WEATHER_LAYERS, weatherPixels } from "../../client/core/texgen/weather.ts";
import { MADE_MARK, madeShift } from "../../client/core/render/world-surfaces.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";

test("every recipe a piece names is one the page makes, and there are no more than the face key holds", () => {
  expect(FINISH_RECIPES.length).toBeLessThanOrEqual(MOST_RECIPES);
  expect(new Set(FINISH_RECIPES.map((r) => r.name)).size).toBe(FINISH_RECIPES.length);
  const named = CORE_CONTENT.flatMap((d) => (d.type === "structure" && d.recipe ? [d.recipe] : []));
  expect(named.length).toBeGreaterThan(0);
  for (const name of named) expect(recipeIndex(name)).toBeGreaterThan(0);
  expect([recipeIndex(undefined), recipeIndex("stucco")]).toEqual([0, 1]);
  // A masonry finish's flat roof is tar and gravel; a sheet's is its own; every roof is a recipe.
  expect([roofOf(recipeIndex("stucco")), roofOf(recipeIndex("corrugated")), roofOf(0)]).toEqual([recipeIndex("gravel"), recipeIndex("corrugated"), 0]);
  for (const r of FINISH_RECIPES) if (r.roof) expect(recipeIndex(r.roof)).toBeGreaterThan(0);
  expect([MADE_LAYERS, MADE_FIRST]).toEqual([WEATHER_LAYERS + 2 * FINISH_RECIPES.length, WEATHER_LAYERS]);
  // The mark an instance says it in is no colour a vertex can have.
  expect(MADE_MARK).toBeGreaterThanOrEqual(REGION_BASE + 6);
});

test("a made finish wears its painted finish's colour, which dyes it and whose weathering it keeps", () => {
  for (const [painted, made] of Object.entries(MADE_FINISHES)) {
    for (const name of made!) {
      const f = RUIN_FINISHES[name] as { color: number; recipe?: string };
      expect(f.color).toBe(RUIN_FINISHES[painted as keyof typeof RUIN_FINISHES].color);
      expect(recipeIndex(f.recipe)).toBeGreaterThan(0);
    }
  }
});

test("each material tiles, its values in range, its relief's lean a unit at most, and its second copy keeps its joints", () => {
  const v = new Float64Array(4), w = new Float64Array(4);
  for (const r of FINISH_RECIPES) {
    // Across the tile's edges it meets itself.
    for (let t = 0; t < 1; t += 0.037) {
      expect(finishHeight(r, 0, t * r.metres, null)).toBeCloseTo(finishHeight(r, r.metres, t * r.metres, null), 6);
      expect(finishHeight(r, t * r.metres, 0, null)).toBeCloseTo(finishHeight(r, t * r.metres, r.metres, null), 6);
    }
    for (let k = 0; k < 200; k++) {
      const x = ((k * 0.6180339) % 1) * r.metres, y = ((k * 0.7548776) % 1) * r.metres;
      for (const layer of [0, 1]) {
        finishTexel(r, layer, x, y, v);
        for (let c = 0; c < 4; c++) expect(v[c]).toBeWithin(0, 1.0000001);
      }
      finishTexel(r, 1, x, y, w);
      expect(Math.hypot(w[0]! * 2 - 1, w[1]! * 2 - 1)).toBeLessThanOrEqual(1);
    }
    // A laid or ribbed one's second copy lands its joints and ribs on its own: under the shift its height is the same
    // but for the grain, a block's joints and a seam's seams where they were and a sheet's waves in step.
    if (r.name === "block" || r.name === "seam" || r.name === "corrugated") {
      const [du, dv] = madeShift(r);
      for (let k = 0; k < 200; k++) {
        const x = ((k * 0.381966) % 1) * r.metres, y = ((k * 0.2360679) % 1) * r.metres;
        expect(Math.abs(finishHeight(r, x + du * r.metres, y + dv * r.metres, null) - finishHeight(r, x, y, null))).toBeLessThan(0.25);
      }
    }
  }
  // The array's layer of a material is made as its texels are.
  const px = weatherPixels(MADE_FIRST, 16);
  finishTexel(FINISH_RECIPES[0]!, 0, (0.5 / 16) * FINISH_RECIPES[0]!.metres, (0.5 / 16) * FINISH_RECIPES[0]!.metres, v);
  expect(Math.abs(px[0]! - v[0]! * 255)).toBeLessThan(40);
});
