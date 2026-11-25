// Drawn equals hit for the female body at every body region's extremes and for random looks: each look within what a
// look may cost, and each group together within the default body's own shares (tests/fixtures/aim-audit.ts).

import { expect } from "bun:test";
import { AIM_FEMALE, AIM_FEMALE_LOOK, holdLooks, randomLooks, REGION_GROUPS, regionLooks } from "../fixtures/aim-audit.ts";
import { test } from "../fixtures/needs-art.ts";

for (const [name, from, to] of REGION_GROUPS) {
  test(`female ${name} at -1 and +1 are hit where drawn`, () => {
    expect(holdLooks(regionLooks(1, from, to), AIM_FEMALE_LOOK, AIM_FEMALE)).toEqual([]);
  });
}

test("eight random female looks are hit where drawn", () => {
  expect(holdLooks(randomLooks(1, 8), AIM_FEMALE_LOOK, AIM_FEMALE)).toEqual([]);
});
