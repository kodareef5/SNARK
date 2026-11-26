import { expect } from "bun:test";
import { auditClothFit } from "../../tools/art/cloth-fit.ts";
import { test } from "../fixtures/needs-art.ts";

test("at rest no drawn skin comes through the refit cloth and hide sets", () => {
  const fits = auditClothFit({ sets: ["cloth", "hide"], only: "rest" });
  expect(fits.length).toBe(20);
  // A hem tucked inside the old body, as a waistband under a shirt, stays tucked in the new, so cloth in skin is not held.
  for (const f of fits) expect(f.through.depth, f.piece).toBe(0);
  expect(fits.reduce((t, f) => t + f.covered, 0)).toBeGreaterThan(10000);
});
