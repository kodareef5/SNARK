// The authoring clipper's exact closed pieces must also be accepted by native convex queries.
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { hullOf } from "../../shared/world/convex.ts";

test("cruise collision cells conserve source solids and retain native-valid thin clipped caps", () => {
  const run = Bun.spawnSync(["python3", resolve(import.meta.dir, "../../assets/source/landmarks/cruise/layout_collision_cells.py"), "--self-test"]);
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  const cases = JSON.parse(run.stdout.toString()) as { name: string; volume: number; clippedVolume: number; parts: { grid: number[]; points: [number, number, number][] }[] }[];
  expect(cases.map(c => c.name)).toEqual(["box", "thin-rib", "twelve-corner"]);
  for (const sample of cases) {
    expect(sample.parts.length).toBeGreaterThan(1);
    expect(Math.abs(sample.volume - sample.clippedVolume)).toBeLessThan(1e-8);
    for (const part of sample.parts) {
      expect(typeof hullOf({ corners: part.points }), sample.name).toBe("object");
      expect(part.points.length).toBeLessThanOrEqual(12);
      expect(part.points.every(p => p.every(v => Math.abs(v) <= 8 + 1e-10))).toBe(true);
    }
  }
});
