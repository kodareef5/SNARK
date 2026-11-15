// The compact as an asset: its built pack keeps the measured contract the simulation and seats depend on
// (assets/source/core/vehicles/compact/contract.ts), and it reaches the core pack as every asset does.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPACT } from "../../assets/source/core/vehicles/compact/contract.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { readPacks } from "../../tools/art/source.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

const FILE = join(import.meta.dir, "../../assets/source/core/vehicles/compact/compact.snpk");
const pack = parsePack(new Uint8Array(readFileSync(FILE)));
const rig = pack.header.rigs.find((r) => r.id === COMPACT.id)!;
const mesh = unpackMeshes(pack).find((m) => m.id === COMPACT.id)!;

test("the rig is the contract's eight bones, in its order, on its pivots, every one on the chassis", () => {
  expect([rig.skeleton, rig.names]).toEqual([COMPACT.id, [...COMPACT.bones]]);
  expect(rig.parent).toEqual(COMPACT.bones.map((_, i) => (i === 0 ? -1 : 0)));
  rig.rest.forEach((v, i) => expect(v).toBeCloseTo(COMPACT.pivots[Math.floor(i / 3)]![i % 3]!, 4));
});

test("every socket is the contract's, on the chassis, at its point", () => {
  const sockets = Object.fromEntries((rig.sockets ?? []).map((s) => [s.name, [s.bone, s.x, s.y, s.z]]));
  expect(Object.keys(sockets).sort()).toEqual(Object.keys(COMPACT.anchors).sort());
  for (const [name, at] of Object.entries(COMPACT.anchors)) expect(sockets[name]).toEqual([0, ...at]);
});

test("closed and at rest, every level stands inside the envelope on the ground, each vertex on one bone", () => {
  const [lo, hi] = [COMPACT.envelope.min, COMPACT.envelope.max];
  for (const lod of mesh.lods) {
    const p = lod.positions;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, p[i]!);
      max[i % 3] = Math.max(max[i % 3]!, p[i]!);
    }
    for (let k = 0; k < 3; k++) {
      expect(min[k]!).toBeGreaterThanOrEqual(lo[k]! - 0.005);
      expect(max[k]!).toBeLessThanOrEqual(hi[k]! + 0.005);
    }
    // The tyres reach the ground and no lower.
    expect(min[1]!).toBeCloseTo(0, 2);
    expect(lod.bones!.every((b) => b < COMPACT.bones.length)).toBe(true);
    if (lod.weights) for (let v = 0; v < lod.weights.length; v += 4) expect(lod.weights[v]).toBeCloseTo(1, 5);
  }
});

test("each wheel is round about its pivot at the contract's radius, and wide as its tyre", () => {
  const fine = mesh.lods[0]!;
  for (let b = 1; b <= 4; b++) {
    const [cx, cy, cz] = COMPACT.pivots[b]!;
    let radius = 0;
    let [near, far] = [Infinity, -Infinity];
    for (let v = 0; v < fine.bones!.length; v++) {
      if (fine.bones![v] !== b) continue;
      radius = Math.max(radius, Math.hypot(fine.positions[v * 3 + 1]! - cy, fine.positions[v * 3 + 2]! - cz));
      near = Math.min(near, fine.positions[v * 3]! - cx);
      far = Math.max(far, fine.positions[v * 3]! - cx);
    }
    expect(radius).toBeCloseTo(COMPACT.wheelRadius, 2);
    expect(far - near).toBeLessThanOrEqual(COMPACT.wheelWidth);
  }
});

test("it is drawn with three materials of four maps and a hurt and decay layer, the paint a colour region, and in the core pack", () => {
  expect(mesh.materials!.map((m) => m.id)).toEqual(["body", "trim", "cabin"].map((n) => `${COMPACT.id}/${n}`));
  for (const m of mesh.materials!) {
    expect([m.base, m.normal, m.mro, m.mask, m.layer ?? -1].every((t) => t >= 0)).toBe(true);
    expect(m.emissive).toBe(0);
  }
  // Drawn flat, the painted panels are the paint's region, so a car keeps its paint at any distance.
  const flat = mesh.lods[mesh.flat!]!;
  const painted = flat.colors.filter((c) => c === REGION_BASE).length;
  expect(painted / flat.colors.length).toBeGreaterThan(0.2);
  const core = readPacks();
  expect([core.meshes.some((m) => m.id === COMPACT.id), core.rigs.some((r) => r.id === COMPACT.id)]).toEqual([true, true]);
});
