// Export the four original spike UV islands and their rest-space surface frame
// when repainting the archived atlas without re-unwrapping the model.
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";

const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error("Give the native Stego pack and an output JSON path");
const pack = parsePack(await Bun.file(file).bytes());
const body = unpackMeshes(pack).find(mesh => mesh.id === "core:stego")!;
const lod = body.lods[0]!;
const names = pack.header.rigs.find(rig => rig.id === "core:stego")!.names!;
const triangles = [];
for (let i = 0; i < lod.indices.length; i += 3) {
  const ids = Array.from(lod.indices.subarray(i, i + 3));
  const bone = names[lod.bones![ids[0]!]!]!;
  if (!bone.startsWith("spike_")) continue;
  if (ids.some(v => names[lod.bones![v]!] !== bone)) throw new Error("An island crosses spike bones");
  triangles.push([bone, ids.map(v => [
    ...lod.uvs!.subarray(v * 2, v * 2 + 2),
    ...lod.positions.subarray(v * 3, v * 3 + 3),
    ...lod.normals!.subarray(v * 3, v * 3 + 3),
  ])]);
}
await Bun.write(output, JSON.stringify(triangles));
