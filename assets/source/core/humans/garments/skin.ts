// A cooked body's skin as the garments are built on it: its slot meshes at one level joined into one surface, every
// point that two slots share made one, with each point's smooth normal, its weights on all thirty bones and the skin zone
// of each triangle.

import { HUMAN_BONES, SLOT_NAMES } from "../../../../../shared/anim/human.ts";
import { TriangleGrid, welded } from "../../../../../tools/pack/refit.ts";
import type { SourceMesh } from "../../../../../tools/pack/write.ts";

export interface Skin {
  positions: Float64Array;
  normals: Float64Array;
  indices: Uint32Array;
  /** Per triangle, its skin zone. */
  zones: Uint8Array;
  /** HUMAN_BONES weights a point, summing to 1. */
  weights: Float32Array;
  /** Per point, its heaviest bone. */
  bones: Uint8Array;
  grid: TriangleGrid;
}

/** Whether a mesh's section is drawn with the skin: its material's id names it so. */
const isSkin = (mesh: SourceMesh, section: number): boolean => /skin/.test(mesh.materials?.[section]?.id ?? "skin");

/** The skin of body `id` (such as "core:human_m") at `level`: its slot meshes' skin triangles, welded. */
export function skinAt(meshes: readonly SourceMesh[], id: string, level: number): Skin {
  const positions: number[] = [];
  const indices: number[] = [];
  const zones: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  for (const name of SLOT_NAMES) {
    const mesh = meshes.find((m) => m.id === `${id}/${name}`);
    if (!mesh) continue;
    const lod = mesh.lods[Math.min(level, mesh.lods.length - 1)]!;
    const base = positions.length / 3;
    positions.push(...lod.positions);
    for (let v = 0; v < lod.positions.length / 3; v++) for (let k = 0; k < 4; k++) {
      joints.push(lod.joints?.[v * 4 + k] ?? lod.bones![v]!);
      weights.push(lod.weights ? lod.weights[v * 4 + k]! : k === 0 ? 1 : 0);
    }
    for (let t = 0; t < lod.indices.length / 3; t++) {
      if (lod.sections && !isSkin(mesh, lod.sections[t]!)) continue;
      indices.push(base + lod.indices[t * 3]!, base + lod.indices[t * 3 + 1]!, base + lod.indices[t * 3 + 2]!);
      zones.push(lod.zones![t]!);
    }
  }
  const w = welded({ positions, indices });
  const n = w.positions.length / 3;
  const dense = new Float32Array(n * HUMAN_BONES);
  const seen = new Uint8Array(n);
  for (let v = 0; v < positions.length / 3; v++) {
    const i = w.of[v]!;
    if (seen[i]) continue;
    seen[i] = 1;
    let total = 0;
    for (let k = 0; k < 4; k++) total += weights[v * 4 + k]!;
    for (let k = 0; k < 4; k++) dense[i * HUMAN_BONES + joints[v * 4 + k]!]! += weights[v * 4 + k]! / (total || 1);
  }
  const bones = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let b = 1; b < HUMAN_BONES; b++) if (dense[i * HUMAN_BONES + b]! > dense[i * HUMAN_BONES + best]!) best = b;
    bones[i] = best;
  }
  return { positions: w.positions, normals: w.normals, indices: w.indices, zones: Uint8Array.from(w.from, (t) => zones[t]!), weights: dense, bones, grid: new TriangleGrid(w.positions, w.indices, 0.02) };
}

/** Points of the triangles of `zones` at a level of the skin. */
export function zonePoints(skin: Skin, zones: ReadonlySet<number>): number[] {
  const out = new Set<number>();
  for (let t = 0; t < skin.zones.length; t++) if (zones.has(skin.zones[t]!)) for (let k = 0; k < 3; k++) out.add(skin.indices[t * 3 + k]!);
  return [...out];
}
