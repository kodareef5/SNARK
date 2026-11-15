// Node kinds with variants, sizes and what is left once used up, standing in for the art: the content of VARIANT_NODES, and
// meshes made of each form's own boxes, so that what is drawn is what is met.

import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, NodeShape } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { VARIANT_NODES } from "../../shared/sim/scenarios.ts";
import { boxMesh, type SourceMesh } from "../../tools/pack/write.ts";

export function variantRegistry(): Registry {
  const { registry, errors } = compileContent([...CORE_CONTENT, ...VARIANT_NODES]);
  if (!registry) throw new Error(errors.join("\n"));
  return registry;
}

/** A mesh of the shape's boxes, in region 0's colour, or `color` for the first box so that a turn shows. */
function boxesMesh(shape: NodeShape, color: number): SourceMesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  (shape.boxes ?? []).forEach((b, k) => {
    const one = boxMesh(b.half, k === 0 ? color : REGION_BASE);
    const first = positions.length / 3;
    for (let i = 0; i < one.positions.length; i++) positions.push(one.positions[i]! + b.at[i % 3]!);
    colors.push(...one.colors);
    for (const v of one.indices) indices.push(v + first);
  });
  return { id: shape.mesh, lods: [{ positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) }] };
}

/** A mesh for every variant and every used-up form of VARIANT_NODES that has boxes. */
export function variantMeshes(): SourceMesh[] {
  const out: SourceMesh[] = [];
  for (const d of VARIANT_NODES as Def[]) {
    if (d.type !== "node") continue;
    for (const v of d.variants ?? []) {
      out.push(boxesMesh(v, 7));
      if (v.depleted?.boxes) out.push(boxesMesh(v.depleted, 8));
    }
    if (d.depleted?.boxes) out.push(boxesMesh(d.depleted, 8));
  }
  return out;
}
