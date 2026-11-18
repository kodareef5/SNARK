// Repaint only the four spike bones in a published pack’s flat palette. Keep
// every triangle and its winding so collision, skin and socket evidence carries.
import { resolve } from "node:path";
import { lodVertices, parsePack, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { findAssets } from "../art/assets.ts";
import { materialsOf, readMaps } from "../art/materials.ts";
import { baker } from "../pack/bake.ts";
import { unpackMeshes } from "../pack/write.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Give the fitted native pack and output pack path");
const bytes = await Bun.file(input).bytes();
const pack = parsePack(bytes);
const header = pack.header.meshes.find(mesh => mesh.id === "core:stego")!;
const body = unpackMeshes(pack).find(mesh => mesh.id === header.id)!;
const names = pack.header.rigs[header.rig!]!.names!;
const asset = (await findAssets(resolve("assets/source"))).find(a => a.id === header.id)!;
const materials = materialsOf(asset);
const maps = body.materials!.map(spec => readMaps(materials.find(m => m.id === spec.id)!, ["base", "mask", "mask2"]));
const paint = baker(body.lods[0]!, body.materials!, maps, pack.palette);
const islands = new Map<number, { x: number; y: number; z: number; color: number }[]>();

for (const [level, lod] of body.lods.entries()) {
  const colors = lod.uvs ? paint(lod) : null;
  const vertices = lodVertices(pack, header.lods[level]!);
  const votes = new Map<number, Map<number, number>>();
  const p = lod.positions;
  for (let t = 0; t < lod.indices.length / 3; t++) {
    const a = lod.indices[t * 3]!, b = lod.indices[t * 3 + 1]!, c = lod.indices[t * 3 + 2]!;
    const bone = lod.bones![c]!;
    if (!names[bone]!.startsWith("spike_") || lod.bones![a] !== bone || lod.bones![b] !== bone) continue;
    const x = (p[a * 3]! + p[b * 3]! + p[c * 3]!) / 3;
    const y = (p[a * 3 + 1]! + p[b * 3 + 1]! + p[c * 3 + 1]!) / 3;
    const z = (p[a * 3 + 2]! + p[b * 3 + 2]! + p[c * 3 + 2]!) / 3;
    let color = colors?.[t];
    if (level === 0) {
      if (!islands.has(bone)) islands.set(bone, []);
      islands.get(bone)!.push({ x, y, z, color: color! });
    }
    if (color === undefined) {
      let nearest = Infinity;
      for (const face of islands.get(bone)!) {
        const d = (face.x - x) ** 2 + (face.y - y) ** 2 + (face.z - z) ** 2;
        if (d < nearest) { nearest = d; color = face.color; }
      }
    }
    if (color === undefined) throw new Error(`No source face for ${names[bone]}`);
    // For this exact topology, the renderer shades the triangle from its last vertex.
    if (!votes.has(c)) votes.set(c, new Map());
    const counted = votes.get(c)!;
    counted.set(color, (counted.get(color) ?? 0) + 1);
  }
  let changed = 0;
  for (const [v, counts] of votes) {
    const best = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const at = v * VERTEX_BYTES + 6;
    if (vertices[at] !== best) changed++;
    vertices[at] = best;
  }
  console.log(`LOD ${level}: ${changed} changed fallback colours`);
}
await Bun.write(output, bytes);
