// Writes one mesh's finest level from a pack as an OBJ, in its rest pose, so Blender can show it beside the new Rex.
//   bun assets/source/core/creatures/rex2/ref/pack-obj.ts assets/source/core/creatures/rex/rex.snpk core:rex old-rex.obj
import { readFileSync, writeFileSync } from "node:fs";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { unpackMeshes } from "../../../../../../tools/pack/write.ts";

const [packPath, id, out] = process.argv.slice(2);
if (!packPath || !id || !out) throw new Error("usage: pack-obj.ts PACK MESH_ID OUT.obj");
const meshes = unpackMeshes(parsePack(readFileSync(packPath)));
const mesh = meshes.find((m) => m.id === id);
if (!mesh) throw new Error(`no mesh ${id}; the pack has ${meshes.map((m) => m.id).join(", ")}`);
const { positions, indices } = mesh.lods[0]!;
const lines: string[] = [];
for (let i = 0; i < positions.length; i += 3) lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
for (let i = 0; i < indices.length; i += 3) lines.push(`f ${indices[i]! + 1} ${indices[i + 1]! + 1} ${indices[i + 2]! + 1}`);
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${id}: ${positions.length / 3} vertices, ${indices.length / 3} triangles`);
