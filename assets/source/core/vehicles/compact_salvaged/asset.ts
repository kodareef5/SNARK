// The compact as a survivor's salvage leaves it: a shell, its stripped look without the door that was left ajar.
// `bun run art -- core:compact_salvaged` bakes it from ../compact_abandoned's pack, with no Blender: the compact's model
// lays out differently on another processor, and its pictures are painted on the layout that pack has.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../../../../../tools/pack/write.ts";
import abandoned from "../compact_abandoned/asset.ts";

const FROM = join(import.meta.dir, "../compact_abandoned");
/** The body reaches 0.87 m to the passenger's side, and the open door 1.34 m. */
const DOOR = -1;

/** A level less the parts that reach past `DOOR`: a part is the triangles that share corners, by place. */
function doorless(lod: SourceLod): SourceLod {
  const corners = lod.positions.length / 3, place = new Map<string, number>(), at = new Int32Array(corners);
  for (let v = 0; v < corners; v++) {
    const key = [0, 1, 2].map((a) => Math.round(lod.positions[v * 3 + a]! * 2000)).join(",");
    if (!place.has(key)) place.set(key, place.size);
    at[v] = place.get(key)!;
  }
  const part = Int32Array.from({ length: place.size }, (_, i) => i);
  const of = (p: number): number => { while (part[p] !== p) p = part[p] = part[part[p]!]!; return p; };
  for (let t = 0; t < lod.indices.length; t += 3) for (const k of [1, 2]) part[of(at[lod.indices[t + k]!]!)] = of(at[lod.indices[t]!]!);
  const door = new Set<number>();
  for (let v = 0; v < corners; v++) if (lod.positions[v * 3]! < DOOR) door.add(of(at[v]!));
  const kept: number[] = [], to = new Int32Array(corners).fill(-1), indices: number[] = [], sections: number[] = [];
  for (let t = 0; t < lod.indices.length; t += 3) {
    if (door.has(of(at[lod.indices[t]!]!))) continue;
    for (let k = 0; k < 3; k++) {
      const v = lod.indices[t + k]!;
      if (to[v] === -1) { to[v] = kept.length; kept.push(v); }
      indices.push(to[v]!);
    }
    if (lod.sections) sections.push(lod.sections[t / 3]!);
  }
  const taken = <T extends Float32Array | Uint8Array>(from: T, each: number): T => {
    const out = new (from.constructor as new (n: number) => T)(kept.length * each);
    kept.forEach((v, i) => out.set(from.subarray(v * each, v * each + each), i * each));
    return out;
  };
  return {
    positions: taken(lod.positions, 3), colors: taken(lod.colors, 1), indices: Uint32Array.from(indices),
    ...(lod.uvs ? { uvs: taken(lod.uvs, 2) } : {}), ...(lod.normals ? { normals: taken(lod.normals, 3) } : {}),
    ...(lod.tangents ? { tangents: taken(lod.tangents, 4) } : {}), ...(lod.sections ? { sections: Uint8Array.from(sections) } : {}),
  };
}

function bake(): SourceMesh[] {
  const pack = parsePack(new Uint8Array(readFileSync(join(FROM, "compact_abandoned.snpk"))));
  const stripped = unpackMeshes(pack).find((m) => m.id === "core:compact_abandoned_stripped");
  if (!stripped) throw new Error("the shell is made from the compact's stripped look, which its pack does not have");
  return [{ ...stripped, id: "core:compact_abandoned_shell", lods: stripped.lods.map(doorless) }];
}

export default {
  ...abandoned,
  source: { bake },
  pieces: [{ id: "core:compact_abandoned_shell", object: "shell" }],
  // The stripped look's own materials, by their ids in its pack.
  materials: Object.fromEntries(Object.entries(abandoned.materials ?? {}).map(([name, m]) => [name, { ...m, id: `core:compact_abandoned/${name}`, dir: FROM }])),
} satisfies PiecesAsset;
