import { readFileSync } from "node:fs";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { unpackMeshes, type SourceLod } from "../../../../../tools/pack/write.ts";

const parts = ["abandoned", "abandoned_stripped"] as const;
const id = (look: string) => `core:concept003_${look}`;

function rigid(lod: SourceLod, omitted: Set<number>): SourceLod {
  const remap = new Int32Array(lod.colors.length).fill(-1);
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const bones = lod.bones!;
  for (let i = 0; i < lod.indices.length; i += 3) {
    const corners = lod.indices.subarray(i, i + 3);
    if (corners.some(v => omitted.has(bones[v]!))) continue;
    for (const v of corners) {
      if (remap[v] === -1) {
        remap[v] = colors.length;
        positions.push(lod.positions[v * 3]!, lod.positions[v * 3 + 1]!, lod.positions[v * 3 + 2]!);
        colors.push(lod.colors[v]!);
      }
      indices.push(remap[v]!);
    }
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
}

function bake() {
  const pack = parsePack(readFileSync(new URL("../concept003/concept003.snpk", import.meta.url)));
  const body = unpackMeshes(pack).find(m => m.id === "core:concept003")!;
  const names = pack.header.rigs.find(r => r.id === body.rig)?.names;
  if (!names || !body.flat) throw new Error("The scenery needs the live car's rig and palette levels");
  return parts.map(look => {
    const omitted = new Set<number>();
    if (look === "abandoned_stripped") {
      for (const [i, name] of names.entries()) {
        if (name.startsWith("wheel_") || name.startsWith("glass_") || name === "steering_wheel" || name === "door_left") omitted.add(i);
      }
    }
    const lods = body.lods.slice(body.flat).map(lod => rigid(lod, omitted));
    const near = lods[0]!.positions;
    let sill = Infinity;
    for (let y = 1; y < near.length; y += 3) sill = Math.min(sill, near[y]!);
    for (const lod of lods) for (let y = 1; y < lod.positions.length; y += 3) lod.positions[y]! -= sill;
    return { id: id(look), lods };
  });
}

export default {
  kind: "pieces", source: { bake },
  pieces: parts.map(look => ({ id: id(look), object: look })),
  budgets: { triangles: [6000, 3000, 1600, 950] },
} satisfies PiecesAsset;
