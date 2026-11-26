// Skin through armour in motion, pinned: each piece's deepest drawn skin through it over the quick motion set, worn
// alone, may not grow. The gate is 2 mm; the pieces past it are named in planning/workstreams/people.md.

import { expect } from "bun:test";
import { auditClothFit } from "../../tools/art/cloth-fit.ts";
import { test } from "../fixtures/needs-art.ts";

/** Millimetres, rounded up, as measured when the armour was lined and let out (people-90 to people-95). */
const PINNED: Readonly<Record<string, number>> = {};

test("no armour piece lets skin through it deeper than its pin, and none at rest", () => {
  const fits = auditClothFit({ quick: true });
  expect(fits.length).toBe(30);
  for (const f of fits) {
    const key = f.piece.replace("core:human_", "");
    expect(f.through.depth * 1000, `${key} in ${f.through.pose}`).toBeLessThanOrEqual(PINNED[key]!);
  }
  for (const f of auditClothFit({ only: "rest" })) expect(f.through.depth, f.piece).toBe(0);
});
