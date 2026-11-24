// The marks of a slot a piece may go in (client/core/render/passes/ghost.ts): a side's strip, a square's outline, a
// triangle's and a corner's pad, thin and flat, lying just over the slot's level. Each is one colour, which the ghost pass gives it.

import { SLOT_EDGE_MESH, SLOT_SQUARE_MESH, SLOT_TRIANGLE_MESH, SLOT_VERTEX_MESH } from "../../client/core/render/passes/ghost.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { HALF_SIDE_M } from "../../shared/world/lattice/forms.ts";
import { SIDE } from "../../shared/world/lattice/module.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

/** Metres: half a strip's width and thickness, and how far over the slot's level its middle lies. */
const WIDE = 0.04;
const THICK = 0.015;
const OVER = 0.03;

/** Boxes as one level: each a middle in plan and half sizes along x and z. */
function strips(boxes: readonly (readonly [number, number, number, number])[]): SourceLod {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x, z, hx, hz] of boxes) {
    const box = boxMesh([hx, THICK, hz], REGION_BASE);
    const base = positions.length / 3;
    for (let i = 0; i < box.positions.length; i += 3) positions.push(box.positions[i]! + x, box.positions[i + 1]! + OVER, box.positions[i + 2]! + z);
    for (const i of box.indices) indices.push(base + i);
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(positions.length / 3).fill(REGION_BASE), indices: Uint32Array.from(indices) };
}

/** Strips as one level, each from (ax, az) to (bx, bz) with its inner edge `2 * WIDE` to the left of that way. */
function sides(ends: readonly (readonly [number, number, number, number])[]): SourceLod {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [ax, az, bx, bz] of ends) {
    const length = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const [ux, uz] = [(bx - ax) / length, (bz - az) / length];
    const box = boxMesh([length / 2, THICK, WIDE], REGION_BASE);
    const base = positions.length / 3;
    // The strip's own +X runs along the side and its middle lies WIDE inside it.
    const [mx, mz] = [(ax + bx) / 2 - uz * WIDE, (az + bz) / 2 + ux * WIDE];
    for (let i = 0; i < box.positions.length; i += 3) positions.push(mx + ux * box.positions[i]! - uz * box.positions[i + 2]!, box.positions[i + 1]! + OVER, mz + uz * box.positions[i]! + ux * box.positions[i + 2]!);
    for (const i of box.indices) indices.push(base + i);
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(positions.length / 3).fill(REGION_BASE), indices: Uint32Array.from(indices) };
}

export function slotMeshes(): SourceMesh[] {
  const half = (SIDE * HALF_SIDE_M) / 2;
  const in_ = half - WIDE;
  return [
    // A side: along its own +X, about its middle.
    { id: SLOT_EDGE_MESH, lods: [strips([[0, 0, half, WIDE]])] },
    // A square: its four sides, about its middle.
    { id: SLOT_SQUARE_MESH, lods: [strips([[0, -in_, half, WIDE], [0, in_, half, WIDE], [-in_, 0, WIDE, in_ - WIDE], [in_, 0, WIDE, in_ - WIDE]])] },
    // A corner: a pad about the point.
    { id: SLOT_VERTEX_MESH, lods: [strips([[0, 0, 0.14, 0.14]])] },
    // A triangle: its three sides, from its first corner along its own +X and 60 degrees on toward +Z.
    { id: SLOT_TRIANGLE_MESH, lods: [sides([[0, 0, 2 * half, 0], [2 * half, 0, half, half * Math.sqrt(3)], [half, half * Math.sqrt(3), 0, 0]])] },
  ];
}
