import { expect, test } from "bun:test";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { FIT_CLASS_SHIFT, FIT_ENDS, FIT_WALL } from "../../client/core/render/piece-fit.ts";
import { materialIndex } from "../../client/core/texgen/layers.ts";
import { FIELD_PERIOD, TEK_FIELD, fieldPhase, pieceFinish, tekFieldLight } from "../../client/core/render/tek-field.ts";
import { materialRows, materialTexel } from "../../client/core/texgen/materials.ts";

function emitted(ms: number, footprint = 0.004, facing = 1, exposure = 1): number[] {
  const rgb = new Float64Array(3);
  tekFieldLight(rgb, -0.72, 0.36, 17, facing, footprint, fieldPhase(ms), exposure);
  return Array.from(rgb, (v) => v * exposure);
}

test("the field travels over the plate and meets itself at the clock wrap", () => {
  expect(emitted(0)).toEqual(emitted(FIELD_PERIOD));
  expect(emitted(0)[1]!).toBeCloseTo(emitted(FIELD_PERIOD - 1)[1]!, 3);
  const a = emitted(0), b = emitted(FIELD_PERIOD / 6);
  expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))).toBeGreaterThan(0.035);
  expect(emitted(FIELD_PERIOD / 6, 0.004, 0.2)).not.toEqual(b);
  expect(emitted(0, 0.004, 1, 0.25)).toEqual(a);
});

test("distant field pixels settle into the same tint at both angles and times", () => {
  const far = emitted(0, 0.14);
  expect(emitted(3400, 0.14, 0.25)).toEqual(far);
  expect(far[2]!).toBeGreaterThan(far[1]!);
  expect(far[1]!).toBeGreaterThan(far[0]!);
});

test("the plate texture cuts a bent pair of conductors into the brushed finish", () => {
  const recipe = MATERIAL_RECIPES[TEK_FIELD - 1]!, relief = materialRows(recipe, 1);
  const texel = new Float64Array(4);
  const height = (u: number, v: number): number => {
    materialTexel(relief, u * recipe.metres, v * recipe.metres, texel);
    return texel[3]!;
  };
  for (const [u, bend] of [[0.22, 0], [0.34, 0.08], [0.51, 0.16]] as const) {
    const untouched = height(u, 0.38 + bend);
    expect(height(u, 0.31 + bend)).toBeLessThan(untouched - 0.24);
    expect(height(u, 0.34 + bend)).toBeLessThan(untouched - 0.24);
  }
});


test("each wall keeps its field and its borrowed Metal post keeps its plate", () => {
  expect(pieceFinish(TEK_FIELD, (FIT_WALL << FIT_CLASS_SHIFT) | 3)).toBe(TEK_FIELD);
  for (const trim of [0, 3, FIT_ENDS | 2]) expect(pieceFinish(TEK_FIELD, trim)).toBe(materialIndex("plate"));
});
