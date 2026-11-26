// Drawn equals hit for the male body at every body region's extremes, at all of them at once, and for random
// looks: each look within what a look may cost, and each group together within the default body's own shares
// (tests/fixtures/aim-audit.ts).

import { expect } from "bun:test";
import { AIM_MALE, AIM_MALE_EXTREME, AIM_MALE_LOOK, extremeLooks, holdLooks, randomLooks, REGION_GROUPS, regionLooks } from "../fixtures/aim-audit.ts";
import { test } from "../fixtures/needs-art.ts";

for (const [name, from, to] of REGION_GROUPS) {
  test(`male ${name} at -1 and +1 are hit where drawn`, () => {
    expect(holdLooks(regionLooks(0, from, to), AIM_MALE_LOOK, AIM_MALE)).toEqual([]);
  });
}

test("male looks with every region at -1 or +1 are hit where drawn", () => {
  expect(holdLooks(extremeLooks(0), AIM_MALE_EXTREME, AIM_MALE_EXTREME)).toEqual([]);
});

test("eight random male looks are hit where drawn", () => {
  expect(holdLooks(randomLooks(0, 8), AIM_MALE_LOOK, AIM_MALE)).toEqual([]);
});
