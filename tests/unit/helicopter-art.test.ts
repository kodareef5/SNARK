// Native helicopter packs must preserve the measured mechanical contract and every independent moving part. The fit of
// real survivors in the cabin is helicopter-fit.slow.test.ts.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { HELICOPTER_ART as H } from "../../content/vehicles/helicopter-art.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { bothWays, measureSurface } from "../../tools/art/check.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";

const ids = ["helicopter", "helicopter_rescue", "helicopter_police", "helicopter_wreck"];
const assets = fromArt(() => ids.map(id => {
  const pack = parsePack(new Uint8Array(readFileSync(new URL(`../../assets/source/core/vehicles/${id}/${id}.snpk`, import.meta.url))));
  return { id: `core:${id}`, pack, mesh: unpackMeshes(pack)[0]!, rig: pack.header.rigs[0]! };
}));

test("all helicopter liveries and the wreck keep the eight-bone rig and every measured anchor", () => {
  for (const { id, rig } of assets) {
    expect([rig.id, rig.skeleton, rig.names]).toEqual([id, H.id, [...H.bones]]);
    expect(rig.parent).toEqual(H.bones.map((_, i) => i === 0 ? -1 : 0));
    rig.rest.forEach((value, i) => expect(value).toBeCloseTo(H.pivots[Math.floor(i / 3)]![i % 3]!, 4));
    expect(Object.fromEntries(rig.sockets!.map(s => [s.name, [s.bone, s.x, s.y, s.z]]))).toEqual(Object.fromEntries(Object.entries(H.anchors).map(([name, at]) => [name, [0, ...at]])));
  }
});

test("every built level is closed, outward, within budget, and keeps both rotor bones", () => {
  const budgets = [38000, 18000, 7000, 2600, 1000, 480];
  for (const { mesh } of assets) {
    expect(mesh.lods.length).toBe(6);
    mesh.lods.forEach((lod, level) => {
      expect(lod.indices.length / 3).toBeLessThanOrEqual(budgets[level]!);
      const facts = measureSurface(lod);
      expect([facts.holes, facts.flipped, facts.insideOut]).toEqual([0, 0, 0]);
      expect(lod.bones!.includes(1) && lod.bones!.includes(2)).toBe(true);
      expect(lod.bones!.every(b => b < H.bones.length)).toBe(true);
      if (level < mesh.flat!) expect(bothWays(lod)).toEqual([]);
    });
  }
});

test("the intact finest meshes and main rotor sweep match the collision envelope", () => {
  for (const { mesh } of assets.slice(0, 3)) {
    const fine = mesh.lods[0]!, low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    let radius = 0, tailRadius = 0;
    for (let v = 0; v < fine.positions.length / 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis]!, fine.positions[v * 3 + axis]!);
        high[axis] = Math.max(high[axis]!, fine.positions[v * 3 + axis]!);
      }
      if (fine.bones![v] === 1) radius = Math.max(radius, Math.hypot(fine.positions[v * 3]! - H.mainRotor.center[0], fine.positions[v * 3 + 2]! - H.mainRotor.center[2]));
      if (fine.bones![v] === 2) tailRadius = Math.max(tailRadius, Math.hypot(fine.positions[v * 3 + 1]! - H.tailRotor.center[1], fine.positions[v * 3 + 2]! - H.tailRotor.center[2]));
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(low[axis]!).toBeGreaterThanOrEqual(H.envelope.min[axis]! - .006);
      expect(high[axis]!).toBeLessThanOrEqual(H.envelope.max[axis]! + .006);
    }
    expect(low[1]!).toBeCloseTo(0, 2);
    expect(radius).toBeCloseTo(H.mainRotor.radius, 2);
    expect(tailRadius).toBeCloseTo(H.tailRotor.radius, 3);
  }
});

test("fast rotor replacement hides blades while keeping hub hardware on the chassis", () => {
  for (const { mesh } of assets.slice(0, 3)) {
    const fine = mesh.lods[0]!;
    let mainCap = 0, tailHub = 0;
    for (let v = 0; v < fine.positions.length / 3; v++) {
      const x = fine.positions[v * 3]!, y = fine.positions[v * 3 + 1]!, z = fine.positions[v * 3 + 2]!;
      const bone = fine.bones![v]!;
      if (bone === 1) expect(Math.hypot(x, z + .30)).toBeGreaterThan(.219);
      if (bone === 2) expect(Math.hypot(y - 2, z + 5.50)).toBeGreaterThan(.219);
      if (Math.hypot(x, z + .30) < .24 && y > 3.30) { expect(bone).toBe(0); mainCap++; }
      if (Math.hypot(y - 2, z + 5.50) < .09 && x > .36) { expect(bone).toBe(0); tailHub++; }
    }
    expect(mainCap).toBeGreaterThan(0);
    expect(tailHub).toBeGreaterThan(0);
  }
});

test("liveries share geometry and cabin/trim materials; the bent wreck has its own surfaces", () => {
  const intact = assets[0]!.mesh;
  for (const { mesh } of assets.slice(0, 3)) {
    expect(mesh.lods[0]!.positions).toEqual(intact.lods[0]!.positions);
    expect(mesh.materials!.map(m => m.id).filter(id => !id.includes("body"))).toEqual(["core:helicopter/cabin", "core:helicopter/trim"]);
    expect(mesh.materials!.every(m => m.base >= 0 && m.normal >= 0 && m.mro >= 0 && m.mask >= 0 && (m.layer ?? -1) >= 0)).toBe(true);
  }
  const wreck = assets[3]!.mesh;
  expect(wreck.materials!.every(m => m.id.startsWith("core:helicopter_wreck/"))).toBe(true);
  const mainHeight = (mesh: typeof intact): number => {
    const fine = mesh.lods[0]!;
    return Math.min(...[...fine.bones!].flatMap((bone, v) => bone === 1 ? [fine.positions[v * 3 + 1]!] : []));
  };
  expect(mainHeight(wreck)).toBeLessThan(mainHeight(intact) - .25);
});
