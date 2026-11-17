// What a tier asks of the card beside its detail: how a material's textures are read where they are seen at a glancing
// angle.
import { expect, test } from "bun:test";
import { TIERS, forTouch } from "../../client/core/assets/tiers.ts";

test("high and ultra read a material's textures for the angle they are seen at, as far as 16 to 1 where the card offers it; low poly, medium and a touch-first device read them as seen head on", () => {
  expect(TIERS.map((t) => [t.name, t.anisotropy])).toEqual([["lowpoly", 1], ["medium", 1], ["high", 16], ["ultra", 16]]);
  expect(TIERS.map((t) => forTouch(t, true).anisotropy)).toEqual([1, 1, 1, 1]);
});
