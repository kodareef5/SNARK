// The marks of a slot a piece may go in (client/core/render/passes/ghost.ts): a side's strip, a square's outline and a
// corner's pad, thin and flat, lying just over the slot's level. Each is one colour, which the ghost pass gives it.

import { SLOT_EDGE_MESH, SLOT_SQUARE_MESH, SLOT_VERTEX_MESH } from "../../client/core/render/passes/ghost.ts";
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
  ];
}
