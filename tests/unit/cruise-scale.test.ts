import { expect, test } from "bun:test";
import source from "../../content/landmarks/cruise-layout.json" with { type: "json" };
import type { CruiseLayout, CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { cruiseScale } from "../../tools/cruise/scale.ts";
import { cruiseHash, matchTriangleOwners, type CruisePackedGroups } from "../../tools/cruise/packed-groups.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";

/** Known physical spans assembled from small repeated modules; the hull has no vertices at waterline Y0. */
function fixture(shrinkLastHullLevel = false): { layout: CruiseLayout; bytes: Uint8Array } {
  const vertices = new Float32Array([-2,-1,-6, 2,-1,-6, 2,1,-6, -2,1,-6, -2,-1,6, 2,-1,6, 2,1,6, -2,1,6]);
  const indices = new Uint32Array([0,2,1,0,3,2, 4,5,6,4,6,7, 0,1,5,0,5,4, 3,7,6,3,6,2, 0,4,7,0,7,3, 1,2,6,1,6,5]);
  const prototypes: (CruisePrototype & { art: { measurement?: "hull" | "deckhouse" | "bridge" } })[] = [];
  const meshes: SourceMesh[] = [];
  for (const group of ["hull", "deckhouse", "bridge", "gangway"] as const) {
    const id = `cruise:${group}`;
    prototypes.push({ id, mesh: id, category: group, color: 1, boxes: [{ at: [0,0,0], half: [2,1,6] }],
      visualBounds: { min: [-2,-1,-6], max: [2,1,6] }, art: group === "gangway" ? {} : { measurement: group } });
    const lods: SourceLod[] = Array.from({ length: 6 }, (_, level) => {
      const positions = vertices.slice();
      if (shrinkLastHullLevel && group === "hull" && level === 5) for (let at = 2; at < positions.length; at += 3) positions[at]! *= .8;
      return { positions, indices, colors: new Uint8Array(8).fill(1), error: level * .01 };
    });
    meshes.push({ id, lods });
  }
  const layout: CruiseLayout = { ...source, cells: [], prototypes, instances: [
    { id: "bow", prototype: "cruise:hull", at: [0,0,176.5], yaw: 0, deck: "2", section: "hull", placed: true },
    { id: "stern", prototype: "cruise:hull", at: [0,0,-176.5], yaw: 180, deck: "2", section: "hull", placed: true },
    { id: "hull_port", prototype: "cruise:hull", at: [22.25,0,0], yaw: 0, deck: "2", section: "hull", placed: true },
    { id: "hull_starboard", prototype: "cruise:hull", at: [-22.25,0,0], yaw: 0, deck: "2", section: "hull", placed: true },
    ...(["deckhouse", "bridge"] as const).flatMap(group => [-1, 1].map(side => ({ id: `${group}_${side}`, prototype: `cruise:${group}`,
      at: [side * (group === "bridge" ? 30.9 : 26.9), 10, 0], yaw: 0, deck: "5", section: group, placed: true }))),
    { id: "gangway", prototype: "cruise:gangway", at: [70,14,250], yaw: 90, deck: "5", section: "boarding", placed: true },
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

test("final feature scale measures the actual outer dome independently of the enclosing ship and inner theater", () => {
  const base = fixture(), id = "cruise:dome", meshes = unpackMeshes(parsePack(base.bytes));
  const shell = { ...base.layout.prototypes[0]!, id, mesh: id, category: "dome", art: {} };
  const inner = { ...shell, id: "cruise:inner_dome", mesh: "cruise:inner_dome", category: "inner_dome" };
  meshes.push({ ...meshes[0]!, id }, { ...meshes[0]!, id: inner.mesh });
  const layout: CruiseLayout = { ...base.layout, prototypes: [...base.layout.prototypes, shell, inner], instances: [
    ...base.layout.instances,
    ...[-1, 1].flatMap(side => [46.6, 61.6].map(y => ({ id: `dome_${side}_${y}`, prototype: id, at: [side * 26.5, y, 125],
      yaw: 0, deck: "15", section: "dome", placed: true }))),
    // Its name and much larger vertical envelope cannot substitute for the measured outer shell.
    { id: "inner_theater", prototype: inner.id, at: [0, 80, 125], yaw: 0, deck: "15", section: "dome", placed: true },
  ] };
  const bytes = buildPack(meshes, defaultPalette()), report = cruiseScale(layout, bytes, true);
  expect(report.pass).toBe(true);
  for (const level of report.levels) expect(level.metrics.slice(-2).map(m => m.actual)).toEqual([57, 17]);
  const shortened: CruiseLayout = { ...layout, instances: layout.instances.map(i => i.prototype === id && i.at[1] === 61.6 ? { ...i, at: [i.at[0]!, 61, i.at[2]!] } : i) };
  const failed = cruiseScale(shortened, bytes, true);
  expect(failed.pass).toBe(false);
  expect(failed.faults).toHaveLength(6);
  expect(failed.faults.every(f => f.includes("outerDomeHeight"))).toBe(true);
  expect(cruiseScale(shortened, bytes).pass).toBe(true); // The original four spans alone cannot detect this mistake.
});

test("cell scale reads each exported triangle once, excludes gangway owners, and does not mistake collision bounds for the model", () => {
  const base = fixture(), byId = new Map(unpackMeshes(parsePack(base.bytes)).map(m => [m.id, m]));
  const id = "cruise:cell_0000", lods: SourceLod[] = [], raw: Uint8Array[] = [];
  for (let level = 0; level < 6; level++) {
    const positions: number[] = [], indices: number[] = [], owners: number[] = [];
    base.layout.instances.forEach((instance, owner) => {
      const source = byId.get(instance.prototype)!.lods[level]!, start = positions.length / 3;
      const sign = instance.yaw === 180 ? -1 : 1;
      for (let v = 0; v < source.positions.length; v += 3) positions.push(instance.at[0]! + sign * source.positions[v]!, instance.at[1]! + source.positions[v + 1]!, instance.at[2]! + sign * source.positions[v + 2]!);
      for (const v of source.indices) indices.push(start + v);
      for (let tri = 0; tri < source.indices.length / 3; tri++) owners.push(owner);
    });
    const lod: SourceLod = { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), colors: new Uint8Array(positions.length / 3), error: level * .01 };
    lods.push(lod);
    const bytes = new Uint8Array(owners.length * 40), view = new DataView(bytes.buffer);
    owners.forEach((owner, triangle) => {
      view.setUint32(triangle * 40, owner, true);
      for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) view.setFloat32(triangle * 40 + 4 + (corner * 3 + axis) * 4, lod.positions[lod.indices[triangle * 3 + corner]! * 3 + axis]!, true);
    });
    raw.push(bytes);
  }
  const bytes = buildPack([{ id, lods }], defaultPalette()), pack = parsePack(bytes);
  const cell = { id, grid: [0,0,0], bounds: { min: [-200,-10,-200], max: [200,100,300] }, origin: [0,0,0], yaw: 0, anchor: "bow",
    members: base.layout.instances.map(i => ({ instance: i.id, prototype: i.prototype, category: base.layout.prototypes.find(p => p.id === i.prototype)!.category })) };
  const layout: CruiseLayout = { ...base.layout, cells: [cell], prototypes: base.layout.prototypes.map(p => ({ ...p, mesh: "none", visualBounds: { min: [-999,-999,-999], max: [999,999,999] } })) };
  const groups: CruisePackedGroups = { version: 1, layoutSHA256: "synthetic", packSHA256: cruiseHash(bytes), meshes: [{ id, origin: [0,0,0], yaw: 0,
    levels: lods.map((_, level) => ({ level, authoredLevel: level, triangles: raw[level]!.length / 40, ranges: matchTriangleOwners(pack, pack.header.meshes[0]!, level, raw[level]!, layout.instances.length) })) }] };
  const report = cruiseScale(layout, bytes, false, groups);
  expect(report.pass).toBe(true);
  for (const level of report.levels) {
    expect(level.triangles).toBe((layout.instances.length - 1) * 12);
    expect(level.metrics.every(m => m.pass)).toBe(true);
    expect(level.bounds.max[2]).toBeCloseTo(182.5, 2);
  }
  expect(() => cruiseScale(layout, bytes)).toThrow("require ownership evidence");
  // A simple cell keeps three real levels covering six ship-wide candidates.
  // Stage 1 still uses its finest geometry; stages 3/4 use its retained middle level.
  const retained = [0, 2, 5], fewer = buildPack([{ id, lods: retained.map(level => lods[level]!) }], defaultPalette()), fewerPack = parsePack(fewer);
  const fewerGroups: CruisePackedGroups = { ...groups, packSHA256: cruiseHash(fewer), meshes: [{ ...groups.meshes[0]!,
    levels: retained.map((authoredLevel, level) => ({ level, authoredLevel, triangles: raw[authoredLevel]!.length / 40,
      ranges: matchTriangleOwners(fewerPack, fewerPack.header.meshes[0]!, level, raw[authoredLevel]!, layout.instances.length) })) }] };
  const collapsed = cruiseScale(layout, fewer, false, fewerGroups);
  expect(collapsed.pass).toBe(true);
  expect(collapsed.levels.map(l => l.metrics)).toEqual(report.levels.map(l => l.metrics));
});
