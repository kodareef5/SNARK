// The look pick's own sums (client/core/assets/look.ts): a ray against a level's triangles, and a level's sections.

import { expect, test } from "bun:test";
import { meshName, nearestTriangle, plainName, sectionAt } from "../../client/core/assets/look.ts";

test("a ray meets the nearest triangle from either side, and a section names its material", () => {
  // Two squares across the z axis, at z = 2 and z = 5, each two triangles.
  const positions = Float32Array.from([-1, -1, 2, 1, -1, 2, 1, 1, 2, -1, 1, 2, -1, -1, 5, 1, -1, 5, 1, 1, 5, -1, 1, 5]);
  const indices = Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const t = new Float64Array(1);
  expect(nearestTriangle(positions, indices, 0.5, -0.5, 0, 0, 0, 1, t)).toBe(0);
  expect(t[0]).toBeCloseTo(2, 6);
  expect(nearestTriangle(positions, indices, -0.5, 0.5, 10, 0, 0, -1, t)).toBe(9);
  expect(t[0]).toBeCloseTo(5, 6);
  expect(nearestTriangle(positions, indices, 3, 0, 0, 0, 0, 1, t)).toBe(-1);
  const sections = [7, 0, 6, 9, 6, 6];
  expect([sectionAt(sections, 0), sectionAt(sections, 3), sectionAt(sections, 6), sectionAt(sections, 9), sectionAt(sections, 12)]).toEqual([7, 7, 9, 9, -1]);
  expect([plainName("core:compact_wreck/tread"), plainName("core:oak_1"), plainName("core:stairs_stone"), meshName("core:human_f/armor/hide/feet")]).toEqual(["Tread", "Oak 1", "Stairs stone", "Human f armor hide feet"]);
});
