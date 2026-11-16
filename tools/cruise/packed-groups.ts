// Recover authored ownership from actual native triangles after export/material ordering.
// This is offline evidence, never an extra runtime material or a draw submission.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { lodVertices, parsePack, readIndices, VERTEX_BYTES, type Pack, type PackMesh } from "../../shared/pack/pack.ts";

/** [first triangle, number of triangles, index into layout.instances]. */
export type OwnerRun = readonly [number, number, number];
export interface CruisePackedGroups {
  readonly version: 1;
  readonly layoutSHA256: string;
  readonly packSHA256: string;
  readonly meshes: readonly {
    readonly id: string;
    readonly origin: readonly [number, number, number];
    readonly yaw: number;
    readonly levels: readonly { readonly level: number; readonly triangles: number; readonly ranges: readonly OwnerRun[] }[];
  }[];
}

export const cruiseHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Cyclic rotation preserves winding; reversing a face must not match. */
function faceKey(a: string, b: string, c: string): string {
  const keys = [`${a};${b};${c}`, `${b};${c};${a}`, `${c};${a};${b}`];
  return keys[0]! < keys[1]! ? (keys[0]! < keys[2]! ? keys[0]! : keys[2]!) : (keys[1]! < keys[2]! ? keys[1]! : keys[2]!);
}

/**
 * Each raw record is uint32 owner and nine float32 local engine coordinates, little endian.
 * Blender writes these after clipping, capping, outward-normal recalculation and triangulation.
 * Quantization is exactly pack/write.ts's, so neither a spatial tolerance nor a guessed index range is needed.
 */
export function matchTriangleOwners(pack: Pack, mesh: PackMesh, level: number, raw: Uint8Array, ownerCount: number): OwnerRun[] {
  const lod = mesh.lods[level];
  if (!lod || raw.byteLength % 40 || raw.byteLength / 40 !== lod.indexCount / 3) throw new Error(`${mesh.id} L${level}: raw/native triangle count differs`);
  const source = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), expected = new Map<string, number[]>();
  for (let at = 0; at < raw.byteLength; at += 40) {
    const owner = source.getUint32(at, true);
    if (owner >= ownerCount) throw new Error(`${mesh.id} L${level}: unknown triangle owner ${owner}`);
    const points: string[] = [];
    for (let corner = 0; corner < 3; corner++) {
      const q: number[] = [];
      for (let axis = 0; axis < 3; axis++) {
        const v = source.getFloat32(at + 4 + (corner * 3 + axis) * 4, true);
        const value = Math.round((v - mesh.center[axis]!) / mesh.half[axis]! * 32767);
        if (!Number.isFinite(value) || Math.abs(value) > 32767) throw new Error(`${mesh.id} L${level}: raw vertex outside native quantization bounds`);
        q.push(value);
      }
      points.push(q.join(","));
    }
    const key = faceKey(points[0]!, points[1]!, points[2]!);
    const owners = expected.get(key);
    if (owners) owners.push(owner); else expected.set(key, [owner]);
  }
  const bytes = lodVertices(pack, lod), native = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points = Array.from({ length: lod.vertexCount }, (_, vertex) => [0, 1, 2].map(axis => native.getInt16(vertex * VERTEX_BYTES + axis * 2, true)).join(","));
  const indices = readIndices(pack, lod), runs: [number, number, number][] = [];
  for (let at = 0; at < indices.length; at += 3) {
    const key = faceKey(points[indices[at]!]!, points[indices[at + 1]!]!, points[indices[at + 2]!]!);
    const owners = expected.get(key), owner = owners?.pop();
    if (owner === undefined) throw new Error(`${mesh.id} L${level} triangle ${at / 3}: native triangle absent from outward authored geometry`);
    if (!owners!.length) expected.delete(key);
    const last = runs.at(-1);
    if (last && last[2] === owner) last[1]++; else runs.push([at / 3, 1, owner]);
  }
  if (expected.size) throw new Error(`${mesh.id} L${level}: authored triangles are missing from native geometry`);
  return runs;
}

/** Stale sidecars must never attribute the current pack's vertices to an earlier layout. */
export function verifyCruiseGroups(groups: CruisePackedGroups, layout: Uint8Array, pack: Uint8Array): void {
  if (groups.version !== 1 || groups.layoutSHA256 !== cruiseHash(layout) || groups.packSHA256 !== cruiseHash(pack)) throw new Error("Cruise packed ownership does not match this layout and pack");
  const ids = new Set<string>();
  for (const mesh of groups.meshes) {
    if (ids.has(mesh.id)) throw new Error(`Duplicate cruise audit mesh ${mesh.id}`);
    ids.add(mesh.id);
    for (const lod of mesh.levels) {
      let end = 0;
      for (const [first, count, owner] of lod.ranges) {
        if (first !== end || !Number.isInteger(count) || count < 1 || !Number.isInteger(owner) || owner < 0) throw new Error(`${mesh.id} L${lod.level}: invalid ownership coverage`);
        end += count;
      }
      if (end !== lod.triangles) throw new Error(`${mesh.id} L${lod.level}: incomplete ownership coverage`);
    }
  }
}

interface RawIndex {
  version: 1;
  layoutSHA256: string;
  meshes: { id: string; origin: [number, number, number]; yaw: number; levels: { level: number; file: string; triangles: number }[] }[];
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../.."), asset = resolve(root, "assets/source/landmarks/cruise");
  const args = process.argv.slice(2), option = (name: string, fallback: string): string => {
    const i = args.indexOf(name); return i < 0 ? fallback : resolve(args[i + 1]!);
  };
  for (let i = 0; i < args.length; i += 2) if (!["--layout", "--pack", "--raw", "--out"].includes(args[i]!) || !args[i + 1]) throw new Error("usage: packed-groups.ts [--layout path] [--pack path] [--raw index.json] [--out path]");
  const layoutBytes = readFileSync(option("--layout", resolve(root, "content/landmarks/cruise-layout.json")));
  const packBytes = readFileSync(option("--pack", resolve(asset, "cruise.snpk")));
  const rawPath = option("--raw", resolve(asset, "ref/raw-cells/index.json"));
  const raw: RawIndex = JSON.parse(readFileSync(rawPath, "utf8"));
  const layout = JSON.parse(layoutBytes.toString()) as { instances: unknown[]; cells: { id: string; origin: number[]; yaw: number }[] };
  if (raw.version !== 1 || raw.layoutSHA256 !== cruiseHash(layoutBytes)) throw new Error("Raw cell triangles belong to another source layout");
  if (JSON.stringify(raw.meshes.map(m => m.id).sort()) !== JSON.stringify(layout.cells.map(c => c.id).sort())) throw new Error("Raw cell audit does not cover exactly the authored cells");
  const pack = parsePack(packBytes);
  const meshes = raw.meshes.map(cell => {
    const source = layout.cells.find(c => c.id === cell.id)!;
    if (cell.yaw !== source.yaw || cell.origin.some((v, k) => v !== source.origin[k])) throw new Error(`${cell.id}: raw mesh frame differs from the authored anchor`);
    const mesh = pack.header.meshes[pack.meshIndex.get(cell.id)!];
    if (!mesh || mesh.lods.length !== cell.levels.length || cell.levels.some((l, k) => l.level !== k)) throw new Error(`${cell.id}: missing native/raw levels`);
    return { id: cell.id, origin: cell.origin, yaw: cell.yaw, levels: cell.levels.map(l => {
      const bytes = readFileSync(resolve(dirname(rawPath), l.file));
      if (bytes.length / 40 !== l.triangles) throw new Error(`${cell.id} L${l.level}: raw byte count differs from index`);
      return { level: l.level, triangles: l.triangles, ranges: matchTriangleOwners(pack, mesh, l.level, bytes, layout.instances.length) };
    }) };
  });
  const result: CruisePackedGroups = { version: 1, layoutSHA256: cruiseHash(layoutBytes), packSHA256: cruiseHash(packBytes), meshes };
  verifyCruiseGroups(result, layoutBytes, packBytes);
  const out = option("--out", resolve(asset, "ref/packed-groups.json"));
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result) + "\n");
  console.log(JSON.stringify({ out, cells: meshes.length, triangles: meshes.reduce((sum, m) => sum + m.levels.reduce((n, l) => n + l.triangles, 0), 0), packSHA256: result.packSHA256 }));
}
