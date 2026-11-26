// Skin through armour in motion, pinned: each piece's deepest drawn skin through it over the quick motion set, worn
// alone, may not grow. The gate is 2 mm; the pieces past it are named in planning/workstreams/people.md.

import { expect } from "bun:test";
import { auditClothFit } from "../../tools/art/cloth-fit.ts";
import { test } from "../fixtures/needs-art.ts";

/** Millimetres, rounded up, as measured when armour was lined and let out (people-90 to 95); the audit looks 30 deep. */
const PINNED: Readonly<Record<string, number>> = {
  "m/armor/cloth/feet": 0, "m/armor/cloth/hands": 0, "m/armor/cloth/head": 0, "m/armor/cloth/legs": 15, "m/armor/cloth/torso": 28,
  "m/armor/hide/feet": 21, "m/armor/hide/hands": 30, "m/armor/hide/head": 0, "m/armor/hide/legs": 22, "m/armor/hide/torso": 30,
  "m/armor/meridian/feet": 29, "m/armor/meridian/hands": 30, "m/armor/meridian/head": 30, "m/armor/meridian/legs": 1, "m/armor/meridian/torso": 28,
  "f/armor/cloth/feet": 0, "f/armor/cloth/hands": 28, "f/armor/cloth/head": 0, "f/armor/cloth/legs": 0, "f/armor/cloth/torso": 26,
  "f/armor/hide/feet": 0, "f/armor/hide/hands": 29, "f/armor/hide/head": 0, "f/armor/hide/legs": 24, "f/armor/hide/torso": 30,
  "f/armor/meridian/feet": 5, "f/armor/meridian/hands": 30, "f/armor/meridian/head": 30, "f/armor/meridian/legs": 1, "f/armor/meridian/torso": 30,
};

test("no armour piece lets skin through it deeper than its pin, and none at rest", () => {
  const fits = auditClothFit({ quick: true });
  expect(fits.length).toBe(30);
  for (const f of fits) {
    const key = f.piece.replace("core:human_", "");
    expect(f.through.depth * 1000, `${key} in ${f.through.pose}`).toBeLessThanOrEqual(PINNED[key]!);
  }
  for (const f of auditClothFit({ only: "rest" })) expect(f.through.depth, f.piece).toBe(0);
});
