// Skin through armour in motion, pinned: each piece's deepest drawn skin through it over the quick motion set, worn
// alone, may not grow. The gate is 2 mm; the pieces past it are named in planning/workstreams/people.md.

import { expect } from "bun:test";
import { auditClothFit, UNDER } from "../../tools/art/cloth-fit.ts";
import { test } from "../fixtures/needs-art.ts";

/** Millimetres, rounded up, as measured when armour was lined and let out (people-90 to 95, people-200 to 203). */
const PINNED: Readonly<Record<string, number>> = {
  "m/armor/cloth/feet": 0, "m/armor/cloth/hands": 0, "m/armor/cloth/head": 0, "m/armor/cloth/legs": 15, "m/armor/cloth/torso": 28,
  "m/armor/hide/feet": 0, "m/armor/hide/hands": 39, "m/armor/hide/head": 0, "m/armor/hide/legs": 22, "m/armor/hide/torso": 60,
  "m/armor/meridian/feet": 10, "m/armor/meridian/hands": 63, "m/armor/meridian/head": 10, "m/armor/meridian/legs": 4, "m/armor/meridian/torso": 14,
  "f/armor/cloth/feet": 0, "f/armor/cloth/hands": 71, "f/armor/cloth/head": 0, "f/armor/cloth/legs": 0, "f/armor/cloth/torso": 96,
  "f/armor/hide/feet": 0, "f/armor/hide/hands": 61, "f/armor/hide/head": 0, "f/armor/hide/legs": 19, "f/armor/hide/torso": 55,
  "f/armor/meridian/feet": 6, "f/armor/meridian/hands": 23, "f/armor/meridian/head": 5, "f/armor/meridian/legs": 7, "f/armor/meridian/torso": 31,
};

test("no armour piece lets skin through it deeper than its pin, and none at rest", () => {
  const fits = auditClothFit({ quick: true });
  expect(fits.length).toBe(30);
  for (const f of fits) {
    const key = f.piece.replace("core:human_", "");
    // A reading at the farthest the audit looks says only that it is at least that deep.
    expect(f.through.depth, `${key} in ${f.through.pose}`).toBeLessThan(UNDER);
    expect(f.through.depth * 1000, `${key} in ${f.through.pose}`).toBeLessThanOrEqual(PINNED[key]!);
  }
  for (const f of auditClothFit({ only: "rest" })) expect(f.through.depth, f.piece).toBe(0);
});
