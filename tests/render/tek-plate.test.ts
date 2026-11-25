import { expect, test } from "bun:test";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { materialRows, materialTexel } from "../../client/core/texgen/materials.ts";

const recipe = MATERIAL_RECIPES.find(r => r.name === "tek_field")!;
const relief = materialRows(recipe, 1);

test("the Tek plate returns rise from matte recesses to polished shoulders", () => {
  const recess = new Float64Array(4), shoulder = new Float64Array(4);
  for (const [x, seam] of [[0, 0.92], [1.1, 0.59], [-1.1, -0.59]]) {
    const side = Math.sign(seam);
    materialTexel(relief, x, seam - side * 0.044, recess);
    materialTexel(relief, x, seam + side * 0.020, shoulder);
    expect((shoulder[3]! - recess[3]!) * recipe.relief).toBeGreaterThan(2);
    expect(recess[2]! - shoulder[2]!).toBeGreaterThan(0.1);
  }
});

test("the cutter grain crosses the Tek pan in long strokes", () => {
  const sample = new Float64Array(4);
  let across = 0, along = 0;
  for (let x = -0.5; x < 0.5; x += 0.031) for (let y = -0.36; y < 0.36; y += 0.029) {
    materialTexel(relief, x, y, sample);
    along += Math.abs(sample[0]! - 0.5);
    across += Math.abs(sample[1]! - 0.5);
  }
  expect(along).toBeGreaterThan(0);
  expect(across).toBeGreaterThan(3 * along);
});
