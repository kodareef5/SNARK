// The street's edge as modelled (assets/source/core/props/street/curb.py): each walk piece is drawn where the content
// walks it, and a coarser level says how far it lies from the finest, as a measure of points cannot. A marina's dock
// modules (dock.py) are drawn where they are walked too.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { DOCK } from "../../content/docks.ts";
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

artTest("each dock module is drawn where it is walked: its deck's top at its origin, as wide and as long as the content's deck, its piles going down", () => {
  for (const [part, width] of [["walk", DOCK.walk], ["finger", DOCK.finger], ["ramp", DOCK.walk]] as const) {
    const mesh = meshes.find((m) => m.id === `core:zzzzdock_${part}`)!;
    expect([part, mesh.lods.length >= 3]).toEqual([part, true]);
    const p = mesh.lods[0]!.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < p.length; v += 3) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k]!, p[v + k]!), Math.max(hi[k]!, p[v + k]!)];
    expect([part, Math.abs(hi[0]! - width / 2) < 0.015, Math.abs(lo[0]! + width / 2) < 0.015, Math.abs(hi[2]! - DOCK.length / 2) < 0.015]).toEqual([part, true, true, true]);
    // The deck's top: at the origin, or for the ramp a quarter metre falling through it, the cleats and rails over it.
    let top = -Infinity; for (let v = 1; v < p.length; v += 3) if (Math.abs(p[v + 1]!) < 0.3 && Math.abs(p[v - 1]!) < width / 2 - 0.2) top = Math.max(top, p[v]!);
    const most = part === "ramp" ? DOCK.fall * 0.3 / DOCK.length : 0;
    expect([part, top > -0.01 && top < most + 0.01]).toEqual([part, true]);
    expect([part, lo[1]! < -DOCK.foot + 0.01]).toEqual([part, true]);
    for (let l = 1; l < mesh.lods.length; l++) expect([part, l, mesh.lods[l]!.indices.length < mesh.lods[l - 1]!.indices.length]).toEqual([part, l, true]);
  }
  const pile = meshes.find((m) => m.id === "core:zzzzdock_pile")!;
  let top = -Infinity; for (let v = 1; v < pile.lods[0]!.positions.length; v += 3) top = Math.max(top, pile.lods[0]!.positions[v]!);
  expect(Math.abs(top - DOCK.top) < 0.01).toBe(true);
});

artTest("each curb return's levels state at least the sagitta of their chord at the gutter's edge, and its finest fills the content's walked parts", () => {
  const RETURNS: Record<number, number[]> = { 4: [20, 12, 8, 4, 2], 6: [24, 16, 12, 6, 3], 8: [28, 18, 12, 6, 3] };
  for (const [radius, segments] of Object.entries(RETURNS).map(([r, s]) => [Number(r), s] as const)) {
    const mesh = meshes.find((m) => m.id === `core:zzzcurb_r${radius}`)!;
    expect([radius, mesh.lods.length]).toEqual([radius, segments.length]);
    for (let l = 1; l < segments.length; l++) {
      const sagitta = (radius + 0.45) * (1 - Math.cos(Math.PI / 4 / segments[l]!));
      expect([radius, l, mesh.lods[l]!.error! >= sagitta - 1e-4, mesh.lods[l]!.error! > (mesh.lods[l - 1]!.error ?? 0)]).toEqual([radius, l, true, true]);
    }
    // Drawn where it is walked: its finest level's top over the content's wedges to a centimetre, and as wide.
    const def = CORE_CONTENT.find((d) => d.id === mesh.id)!;
    const shape = CORE_CONTENT.find((d) => d.type === "shape" && def.type === "structure" && d.id === def.shape)!;
    if (shape.type !== "shape" || def.type !== "structure") throw new Error(mesh.id);
    const p = mesh.lods[0]!.positions;
    let top = -Infinity; for (let v = 1; v < p.length; v += 3) top = Math.max(top, p[v]!);
    const walked = Math.max(...shape.hulls!.flatMap((h) => h.corners.map((c) => c[1])));
    expect([radius, Math.abs(top - walked) < 0.01]).toEqual([radius, true]);
    for (const k of [0, 2]) {
      let lo = Infinity, hi = -Infinity; for (let v = k; v < p.length; v += 3) { lo = Math.min(lo, p[v]!); hi = Math.max(hi, p[v]!); }
      expect([radius, k, Math.abs(hi - def.half[k]!) < 0.015, Math.abs(lo + def.half[k]!) < 0.015]).toEqual([radius, k, true, true]);
    }
  }
});
