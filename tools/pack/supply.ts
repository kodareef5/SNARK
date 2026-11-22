// The supply drop's stand-ins (planning/workstreams/supply.md): a capsule as a grey box with a lamp, and its shaft as a
// plain column, both drawn by client/core/supply.ts from the list of live drops. The lamp and the column are colour
// region 0, which the client sets to the tier's colour. The modelled capsule and the shaft's own light replace them
// where a renderer can draw those; a flat one keeps these.

import { REGION_BASE } from "../../shared/pack/palette.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "./write.ts";

const STEEL = 4;
const PORCELAIN = 10;
const BRONZE = 3;
type Box = readonly [cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: number];

/** Boxes as one mesh with its +Z up, as a loose mesh is drawn along its direction (Characters.loose). */
function build(boxes: readonly Box[]): SourceLod {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [cx, cy, cz, hx, hy, hz, color] of boxes) {
    const b = boxMesh([hx, hy, hz], color);
    const base = positions.length / 3;
    for (let v = 0; v < b.positions.length; v += 3) positions.push(b.positions[v]! + cx, b.positions[v + 1]! + cy, b.positions[v + 2]! + cz);
    for (const c of b.colors) colors.push(c);
    for (const i of b.indices) indices.push(base + i);
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
}

/** Ids are those client/core/supply.ts finds. */
export function supplyMeshes(): SourceMesh[] {
  return [
    // 2.2 m from its feet at the origin to the top of its lamp, 1.4 m across: the capsule's own measure.
    {
      id: "core:supply_box",
      lods: [build([[0, 0, 0.12, 0.7, 0.7, 0.12, BRONZE], [0, 0, 0.95, 0.55, 0.55, 0.75, PORCELAIN], [0, 0, 1.78, 0.6, 0.6, 0.08, STEEL], [0, 0, 2.03, 0.3, 0.3, 0.17, REGION_BASE]])],
    },
    // A metre across and a metre up from the origin, drawn as wide and as tall as the shaft is.
    { id: "core:supply_beam", lods: [build([[0, 0, 0.5, 0.5, 0.5, 0.5, REGION_BASE]])] },
  ];
}
