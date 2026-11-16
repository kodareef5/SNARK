// The authoring clipper's exact closed pieces must also be accepted by native convex queries.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fixture from "../fixtures/cruise-cell-physics.json" with { type: "json" };
import { hullOf } from "../../shared/world/convex.ts";

test("cruise collision cells conserve source solids and retain native-valid thin clipped caps", () => {
  const hash = createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../..", fixture.source))).digest("hex");
  expect(hash).toBe(fixture.sha256); // Regenerate with the authoring helper's --self-test after a clipper change.
  const cases = fixture.cases;
  expect(cases.map(c => c.name)).toEqual(["box", "thin-rib", "twelve-corner", "slide-cap"]);
  for (const sample of cases) {
    expect(sample.parts.length).toBeGreaterThan(1);
    expect(Math.abs(sample.volume - sample.clippedVolume)).toBeLessThan(1e-8);
    for (const part of sample.parts) {
      expect(typeof hullOf({ corners: part.points.map(p => [p[0]!, p[1]!, p[2]!] as const) }), sample.name).toBe("object");
      expect(part.points.length).toBeLessThanOrEqual(12);
      expect(part.points.every(p => p.every(v => Math.abs(v) <= 8 + 1e-10))).toBe(true);
    }
  }
  const cap = cases.find(c => c.name === "slide-cap")!;
  expect(cap.parts.map(p => p.points.length)).toEqual([8, 8]);
  expect(cap.clippedVolume).toBeCloseTo(0.02818146658787253, 15);
  const first = cap.parts[0]!.points, last = cap.parts[1]!.points;
  const oldSliver = [first[0]!, first[1]!, last.at(-2)!, last.at(-1)!].map(p => [p[0]!, p[1]!, p[2]!] as const);
  expect(hullOf({ corners: oldSliver })).toBe("a part's corners all lie in one plane");
});
