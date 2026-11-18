// Transfer painted colours to the family's existing flat levels.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { VERTEX_BYTES, lodVertices, parsePack } from "../../../../../shared/pack/pack.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf, readMaps } from "../../../../../tools/art/materials.ts";
import { baker, painted } from "../../../../../tools/pack/bake.ts";
import { toTriangle } from "../../../../../tools/pack/error.ts";
import { unpackMeshes, type SourceLod } from "../../../../../tools/pack/write.ts";

const axes = [0, 1, 2] as const;
const cellWidth = 0.32;
const margin = 0.18;
type Point = [number, number, number];

function face(lod: SourceLod, triangle: number) {
  const corners = Array.from(lod.indices.subarray(triangle * 3, triangle * 3 + 3), vertex => vertex * 3);
  const points = corners.map(offset => axes.map(axis => lod.positions[offset + axis]!) as Point);
  const [a, b, c] = points as [Point, Point, Point];
  const u = axes.map(axis => b[axis] - a[axis]);
  const v = axes.map(axis => c[axis] - a[axis]);
  const cross = axes.map(axis => {
    const j = (axis + 1) % 3, k = (axis + 2) % 3;
    return u[j]! * v[k]! - u[k]! * v[j]!;
  });
  const length = Math.hypot(...cross) || 1;
  return { corners, points, normal: cross.map(value => value / length), bone: lod.bones?.[corners[0]! / 3] };
}

function transfer(source: SourceLod, pigments: Uint8Array) {
  const faces = Array.from(pigments, (_, triangle) => face(source, triangle));
  const grid = new Map<string, number[]>();
  faces.forEach(({ points }, triangle) => {
    const low = axes.map(axis => Math.floor((Math.min(...points.map(p => p[axis])) - margin) / cellWidth));
    const high = axes.map(axis => Math.floor((Math.max(...points.map(p => p[axis])) + margin) / cellWidth));
    for (let x = low[0]!; x <= high[0]!; x++) {
      for (let y = low[1]!; y <= high[1]!; y++) {
        for (let z = low[2]!; z <= high[2]!; z++) {
          const key = [x, y, z].join(",");
          const nearby = grid.get(key);
          if (nearby) nearby.push(triangle);
          else grid.set(key, [triangle]);
        }
      }
    }
  });
  const all = faces.map((_, triangle) => triangle);
  return (lod: SourceLod) => {
    const result = new Uint8Array(lod.indices.length / 3);
    for (let triangle = 0; triangle < result.length; triangle++) {
      const { points, normal, bone } = face(lod, triangle);
      const votes = new Map<number, number>();
      for (const near of axes) {
        const sample = axes.map(axis =>
          points.reduce((sum, p, corner) => sum + p[axis] * (corner === near ? 0.60 : 0.20), 0)
        ) as Point;
        const key = sample.map(value => Math.floor(value / cellWidth)).join(",");
        let best = Infinity, colour = 0;
        for (const candidate of grid.get(key) ?? all) {
          const other = faces[candidate]!, [a, b, c] = other.corners;
          const alignment = axes.reduce<number>((sum, axis) => sum + normal[axis]! * other.normal[axis]!, 0);
          const distance = toTriangle(...sample, source.positions, a!, b!, c!);
          const score = distance + 0.025 * (1 - alignment) + (bone === other.bone ? 0 : 0.16);
          if (score < best) {
            best = score;
            colour = pigments[candidate]!;
          }
        }
        votes.set(colour, (votes.get(colour) ?? 0) + 1);
      }
      result[triangle] = [...votes.keys()].sort((a, b) => votes.get(b)! - votes.get(a)! || a - b)[0]!;
    }
    return result;
  };
}

const boat = process.argv[2];
if (boat !== "manta" && boat !== "lagoon") throw Error("Specify manta or lagoon");
const assets = await findAssets();
for (const name of [boat, boat + "_damaged", boat + "_sunk"]) {
  const asset = assets.find(a => a.id === "core:" + name);
  if (!asset) throw Error("Missing pack for " + name);
  const bytes = readFileSync(asset.file), pack = parsePack(bytes);
  const mesh = unpackMeshes(pack).find(m => m.id === asset.id);
  if (!mesh?.flat || !mesh.materials) throw Error("Missing textured surface for " + name);
  const materials = materialsOf(asset);
  const maps = mesh.materials.map(m => readMaps(materials.find(a => a.id === m.id)!, ["base", "mask"]));
  const sample = baker(mesh.lods[0]!, mesh.materials, maps, pack.palette);
  const surface = mesh.lods[mesh.flat - 1]!;
  const colour = transfer(surface, sample(surface));
  const header = pack.header.meshes[pack.meshIndex.get(asset.id)!]!;
  for (let level = mesh.flat; level < mesh.lods.length; level++) {
    const lod = mesh.lods[level]!, stored = header.lods[level]!;
    // Repainting starts on the same corner even after the previous pass rotated indices.
    for (let offset = 0; offset < lod.indices.length; offset += 3) {
      const triangle = lod.indices.subarray(offset, offset + 3);
      const [a, b, c] = triangle;
      if (b! < a! && b! <= c!) triangle.set([b!, c!, a!]);
      else if (c! < a! && c! < b!) triangle.set([c!, a!, b!]);
    }
    const ready = painted(lod, colour(lod));
    const vertices = lodVertices(pack, stored);
    ready.colors.forEach((palette, vertex) => vertices[vertex * VERTEX_BYTES + 6] = palette);
    const indices = new DataView(pack.blob.buffer, pack.blob.byteOffset + stored.indexOffset, stored.indexCount * stored.indexBytes);
    ready.indices.forEach((vertex, corner) => {
      if (stored.indexBytes === 2) indices.setUint16(2 * corner, vertex, true);
      else indices.setUint32(4 * corner, vertex, true);
    });
  }
  const temporary = asset.file + "." + process.pid + ".new";
  writeFileSync(temporary, bytes);
  renameSync(temporary, asset.file);
  console.log(asset.id + " distant palette refreshed");
}
