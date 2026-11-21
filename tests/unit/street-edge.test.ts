// The street's edge as modelled (assets/source/core/props/street/curb.py): each walk piece is drawn where the content
// walks it, and a coarser level says how far it lies from the finest, as a measure of points cannot.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { artTest, fromArt } from "../fixtures/needs-art.ts";

const meshes: SourceMesh[] = fromArt(() => unpackMeshes(parsePack(readFileSync(join(import.meta.dir, "../../assets/source/core/props/street/street.snpk")))));
const KIT = ["zwalk8", "zwalk8g", "zcurbramp", "zcurbrampl"];

artTest("each walk piece is drawn where it is walked: above the ground its mesh fills the content's box to a centimetre, at every level", () => {
  for (const name of KIT) {
    const def = CORE_CONTENT.find((d) => d.id === `core:zruin_${name}_concrete`)!;
    const shape = CORE_CONTENT.find((d) => d.type === "shape" && def.type === "structure" && d.id === def.shape)!;
    if (shape.type !== "shape") throw new Error(name);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const corners = [...[...shape.boxes, ...(shape.look?.boxes ?? [])].flatMap((b) => [[0, 1, 2].map((k) => b.at[k]! - b.half[k]!), [0, 1, 2].map((k) => b.at[k]! + b.half[k]!)]), ...[...(shape.hulls ?? []), ...(shape.look?.hulls ?? [])].flatMap((h) => h.corners.map((c) => [...c]))];
    for (const c of corners) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k]!, c[k]!), Math.max(hi[k]!, c[k]!)];
    const mesh = meshes.find((m) => m.id === def.id)!;
    expect([name, mesh.lods.length]).toEqual([name, 2]);
    for (const lod of mesh.lods) {
      const p = lod.positions, mlo = [Infinity, Infinity, Infinity], mhi = [-Infinity, -Infinity, -Infinity];
      // What stands on the road or over it: a face carried into the ground is met as the ground. The curb's face leans
      // back 1.2 cm to its top.
      for (let v = 0; v < p.length; v += 3) if (p[v + 1]! > lo[1]! - 0.001) for (let k = 0; k < 3; k++) [mlo[k], mhi[k]] = [Math.min(mlo[k]!, p[v + k]!), Math.max(mhi[k]!, p[v + k]!)];
      for (const k of [0, 2]) expect([name, k, Math.abs(mlo[k]! - lo[k]!) < 0.015, Math.abs(mhi[k]! - hi[k]!) < 0.015]).toEqual([name, k, true, true]);
      expect([name, Math.abs(mhi[1]! - hi[1]!) < 0.002]).toEqual([name, true]);
    }
    // Its far level is about what the near city drew of the old boxes, and stands no more than its joints off the first.
    expect([name, mesh.lods[1]!.indices.length / 3 <= 20, mesh.lods[1]!.error]).toEqual([name, true, 0.009]);
  }
});

artTest("the curb return's levels each state at least the sagitta of their chord at the gutter's edge", () => {
  const mesh = meshes.find((m) => m.id === "core:zzzcurb_r6")!;
  const segments = [24, 16, 12, 6, 3];
  expect(mesh.lods.length).toBe(segments.length);
  for (let l = 1; l < segments.length; l++) {
    const sagitta = 6.45 * (1 - Math.cos(Math.PI / 4 / segments[l]!));
    expect([l, mesh.lods[l]!.error! >= sagitta - 1e-4, mesh.lods[l]!.error! > (mesh.lods[l - 1]!.error ?? 0)]).toEqual([l, true, true]);
  }
  // A static of no content: nothing in the game sets it down yet (tools/snap/street-study.ts --rows does).
  expect(CORE_CONTENT.some((d) => d.id === mesh.id)).toBe(false);
});
