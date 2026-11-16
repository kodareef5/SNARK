// Native production packs, actual moving hardware and clear first-person apertures at every level.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BOAT_ART as B } from "../../content/vehicles/boat-art.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { bothWays, measureSurface } from "../../tools/art/check.ts";
import { auditBoatFit } from "../../tools/art/boat-fit.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

const assets = ["boat", "boat_rescue", "boat_police", "boat_wreck"].map(id => {
  const pack = parsePack(new Uint8Array(readFileSync(new URL(`../../assets/source/core/vehicles/${id}/${id}.snpk`, import.meta.url))));
  return { id: `core:${id}`, pack, mesh: unpackMeshes(pack)[0]!, rig: pack.header.rigs[0]! };
});

test("all boat liveries keep the measured seats, articulated engine sockets and propeller parent", () => {
  for (const { id, rig } of assets) {
    expect([rig.id, rig.skeleton, rig.names, rig.parent]).toEqual([id, B.id, [...B.bones], [...B.parents]]);
    rig.rest.forEach((value, i) => expect(value).toBeCloseTo(B.pivots[Math.floor(i / 3)]![i % 3]!, 4));
    for (const [name, at] of Object.entries(B.anchors)) {
      const socket = rig.sockets!.find(s => s.name === name)!;
      const engine = name === "engine" || name === "exhaust" || name === "propeller";
      expect(socket.bone).toBe(engine ? 1 : 0);
      [socket.x, socket.y, socket.z].forEach((v, k) => expect(v + (engine ? B.outboard.center[k]! : 0)).toBeCloseTo(at[k]!, 5));
    }
  }
});

test("six closed outward boat levels preserve engine, propeller and wheel within the original budgets", () => {
  const budgets = [38000, 18000, 7000, 2600, 1000, 480];
  for (const { mesh } of assets) {
    expect(mesh.lods.length).toBe(6);
    mesh.lods.forEach((lod, level) => {
      expect(lod.indices.length / 3).toBeLessThanOrEqual(budgets[level]!);
      const facts = measureSurface(lod);
      expect([facts.holes, facts.flipped, facts.insideOut]).toEqual([0, 0, 0]);
      for (const bone of [1, 2, 3]) expect(lod.bones!.includes(bone)).toBe(true);
      expect(lod.bones!.every(b => b < B.bones.length)).toBe(true);
      if (level < mesh.flat!) expect(bothWays(lod)).toEqual([]);
    });
  }
});

test("the actual hull envelope, propeller sweep and livery geometry agree with the measured contract", () => {
  const first = assets[0]!.mesh;
  for (const { mesh } of assets.slice(0, 3)) {
    const fine = mesh.lods[0]!;
    expect(fine.positions).toEqual(first.lods[0]!.positions);
    let propRadius = 0;
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < fine.positions.length / 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = fine.positions[v * 3 + axis]!;
        low[axis] = Math.min(low[axis]!, value);
        high[axis] = Math.max(high[axis]!, value);
      }
      if (fine.bones![v] === 2) propRadius = Math.max(propRadius, Math.hypot(fine.positions[v * 3]! - B.propeller.center[0], fine.positions[v * 3 + 1]! - B.propeller.center[1]));
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(low[axis]!).toBeGreaterThanOrEqual(B.envelope.min[axis]! - .006);
      expect(high[axis]!).toBeLessThanOrEqual(B.envelope.max[axis]! + .006);
    }
    expect(propRadius).toBeCloseTo(B.propeller.radius, 3);
    expect(mesh.materials!.map(m => m.id).filter(id => !id.includes("body"))).toEqual(["core:boat/cabin", "core:boat/trim"]);
    expect(mesh.materials!.every(m => m.base >= 0 && m.normal >= 0 && m.mro >= 0 && m.mask >= 0 && (m.layer ?? -1) >= 0)).toBe(true);
  }
  expect(assets[3]!.mesh.lods[0]!.positions).not.toEqual(first.lods[0]!.positions);
  expect(assets[3]!.mesh.materials!.every(m => m.id.startsWith("core:boat_wreck/"))).toBe(true);
});

test("the forward eye rays stay clear through the windscreen on textured and fully flat levels", () => {
  // A +Z ray hits a triangle iff its XY projection contains the eye and the interpolated Z is ahead of it.
  for (const { mesh } of assets.slice(0, 3)) for (const lod of mesh.lods) for (const eyeY of [1.92, 2.04, 2.20]) {
    let hits = 0;
    for (let t = 0; t < lod.indices.length; t += 3) {
      const a = lod.indices[t]! * 3, b = lod.indices[t + 1]! * 3, c = lod.indices[t + 2]! * 3, p = lod.positions;
      const ax = p[a]!, ay = p[a + 1]!, bx = p[b]!, by = p[b + 1]!, cx = p[c]!, cy = p[c + 1]!;
      const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denominator) < 1e-9) continue;
      const u = ((by - cy) * (.48 - cx) + (cx - bx) * (eyeY - cy)) / denominator;
      const v = ((cy - ay) * (.48 - cx) + (ax - cx) * (eyeY - cy)) / denominator;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = u * p[a + 2]! + v * p[b + 2]! + (1 - u - v) * p[c + 2]!;
      if (z > .72 && z < 2.80) hits++;
    }
    expect(hits).toBe(0);
  }
});

test("actual survivors and gear clear all other seats, console and hull across proportions and head look", () => {
  const report = auditBoatFit();
  expect(report.pointsTested).toBeGreaterThan(3_000_000);
  expect(report.failures).toEqual([]);
  expect(report.pilotProfiles).toBe(474);
  expect(report.gripResidual).toBeLessThan(.001);
  expect(report.worst.margin).toBeGreaterThan(.04);
  expect(report.headWorst.margin - report.headMotionAllowance).toBeGreaterThan(.04);
}, 15_000);
