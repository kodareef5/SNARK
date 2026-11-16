import { expect, test } from "bun:test";
import source from "../../content/landmarks/cruise-layout.json" with { type: "json" };
import type { CruiseLayout, CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { cruiseScale } from "../../tools/cruise/scale.ts";
import { buildPack, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";

/** Known physical spans assembled from small repeated modules; the hull has no vertices at waterline Y0. */
function fixture(shrinkLastHullLevel = false): { layout: CruiseLayout; bytes: Uint8Array } {
  const vertices = new Float32Array([-2,-1,-6, 2,-1,-6, 2,1,-6, -2,1,-6, -2,-1,6, 2,-1,6, 2,1,6, -2,1,6]);
  const indices = new Uint32Array([0,2,1,0,3,2, 4,5,6,4,6,7, 0,1,5,0,5,4, 3,7,6,3,6,2, 0,4,7,0,7,3, 1,2,6,1,6,5]);
  const prototypes: (CruisePrototype & { art: { measurement?: "hull" | "deckhouse" | "bridge" } })[] = [];
  const meshes: SourceMesh[] = [];
  for (const group of ["hull", "deckhouse", "bridge", "gangway"] as const) {
    const id = `core:cruise_${group}`;
    prototypes.push({ id, mesh: id, category: group, color: 1, boxes: [{ at: [0,0,0], half: [2,1,6] }],
      visualBounds: { min: [-2,-1,-6], max: [2,1,6] }, art: group === "gangway" ? {} : { measurement: group } });
    const lods: SourceLod[] = Array.from({ length: 6 }, (_, level) => {
      const positions = vertices.slice();
      if (shrinkLastHullLevel && group === "hull" && level === 5) for (let at = 2; at < positions.length; at += 3) positions[at]! *= .8;
      return { positions, indices, colors: new Uint8Array(8).fill(1), error: level * .01 };
    });
    meshes.push({ id, lods });
  }
  const layout: CruiseLayout = { ...source, prototypes, instances: [
    { id: "bow", prototype: "core:cruise_hull", at: [0,0,176.5], yaw: 0, deck: "2", section: "hull", placed: true },
    { id: "stern", prototype: "core:cruise_hull", at: [0,0,-176.5], yaw: 180, deck: "2", section: "hull", placed: true },
    { id: "hull_port", prototype: "core:cruise_hull", at: [22.25,0,0], yaw: 0, deck: "2", section: "hull", placed: true },
    { id: "hull_starboard", prototype: "core:cruise_hull", at: [-22.25,0,0], yaw: 0, deck: "2", section: "hull", placed: true },
    ...(["deckhouse", "bridge"] as const).flatMap(group => [-1, 1].map(side => ({ id: `${group}_${side}`, prototype: `core:cruise_${group}`,
      at: [side * (group === "bridge" ? 30.9 : 26.9), 10, 0], yaw: 0, deck: "5", section: group, placed: true }))),
    { id: "gangway", prototype: "core:cruise_gangway", at: [70,14,250], yaw: 90, deck: "5", section: "boarding", placed: true },
  ] };
  return { layout, bytes: buildPack(meshes, defaultPalette()) };
}

test("cruise scale measures native triangle-waterline crossings and distinct hull/deckhouse/bridge spans at every level", () => {
  const { layout, bytes } = fixture(), report = cruiseScale(layout, bytes);
  expect(report.pass).toBe(true); expect(report.faults).toEqual([]); expect(report.levels).toHaveLength(6);
  for (const level of report.levels) {
    expect(level.waterlineTriangles).toBeGreaterThan(0);
    expect(level.metrics.map(m => m.actual)).toEqual(expect.arrayContaining([365, 48.5]));
    expect(level.metrics.every(m => m.low !== null && m.high !== null)).toBe(true);
    expect(level.bounds.max[2]).toBeCloseTo(182.5, 3); // The off-ship gangway is excluded.
  }
});

test("cruise scale refuses a shortened coarse silhouette even when published metadata is unchanged", () => {
  const { layout, bytes } = fixture(true), report = cruiseScale(layout, bytes);
  expect(report.pass).toBe(false);
  expect(report.levels.slice(0, 5).every(l => l.metrics.every(m => m.pass))).toBe(true);
  expect(report.faults).toHaveLength(1);
  expect(report.faults[0]).toContain("L5 lengthOverall");
});
