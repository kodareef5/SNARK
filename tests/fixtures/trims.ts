// Stand-in trims for a tier whose pack has none, junctions set down by key in a base at any yaw, and pieces as the near
// store draws them: every instance's triangles in the world, by the rule the vertex programs place them with.

import { FOUNDATION_THICK } from "../../content/building.ts";
import { NODE_BUFFERS, type ChunkBatch } from "../../client/core/render/passes/near-store.ts";
import { PieceFit } from "../../client/core/render/piece-fit.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import { INSTANCE_BYTES, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { Frame } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, canon, canonical, dirTurn, key0, key1 } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import type { SourceLod, SourceMesh } from "../../tools/pack/write.ts";
import type { Standing, Tri } from "../../tools/pieces/joints.ts";
import { junction, pieceId, type Junction, type TierName, type WallEnd } from "../../tools/pieces/layout.ts";

/** A closed prism over a convex polygon of (x, z) corners from `y0` up to `y1`, every face looking out. */
export function prism(poly: readonly (readonly [number, number])[], y0: number, y1: number, color = REGION_BASE): SourceLod {
  const n = poly.length;
  const positions: number[] = [];
  for (const y of [y0, y1]) for (const [x, z] of poly) positions.push(x, y, z);
  const mid = [poly.reduce((a, p) => a + p[0], 0) / n, (y0 + y1) / 2, poly.reduce((a, p) => a + p[1], 0) / n];
  const indices: number[] = [];
  const face = (a: number, b: number, c: number): void => {
    const at = (v: number): number[] => positions.slice(v * 3, v * 3 + 3);
    const [p, q, r] = [at(a), at(b), at(c)];
    const u = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!], w = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!];
    const normal = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const out = normal[0]! * (p[0]! - mid[0]!) + normal[1]! * (p[1]! - mid[1]!) + normal[2]! * (p[2]! - mid[2]!);
    indices.push(a, ...(out > 0 ? [b, c] : [c, b]));
  };
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    face(k, j, n + j);
    face(k, n + j, n + k);
  }
  for (let k = 1; k + 1 < n; k++) {
    face(0, k, k + 1);
    face(n, n + k, n + k + 1);
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(n * 2).fill(color), indices: Uint32Array.from(indices) };
}

const ring = (radius: number): [number, number][] => Array.from({ length: 12 }, (_, k) => [radius * Math.cos((k * Math.PI) / 6), radius * Math.sin((k * Math.PI) / 6)]);

/** How far a stand-in joint's square reaches from its corner: a centimetre past a wall's face. */
export const JOINT_HALF = 0.11;

/**
 * A tier's trims as plain solids, by the names the client looks them up under (client/core/render/trims.ts): a square
 * post, twelve-sided posts of 0.15 m and 0.21 m, each a storey and a centimetre high, and a skirt 3 m wide that hangs
 * 2.4 m and stands 0.12 m out.
 */
export function standInTrims(tier: string): SourceMesh[] {
  const h = JOINT_HALF;
  return [
    { id: `core:joint_sq_${tier}`, lods: [prism([[-h, -h], [h, -h], [h, h], [-h, h]], 0, 3.01)] },
    { id: `core:joint_r15_${tier}`, lods: [prism(ring(0.15), 0, 3.01)] },
    { id: `core:joint_r21_${tier}`, lods: [prism(ring(0.21), 0, 3.01)] },
    { id: `core:skirt_${tier}`, lods: [prism([[-1.5, 0], [1.5, 0], [1.5, 0.12], [-1.5, 0.12]], -2.4, 0)] },
  ];
}

export const TEAM = 7;
const m = new Int32Array(8);
const O = [0, 0, 0, 0];

/** A base whose corner (0, 0, 0, 0) is at (x, z) metres, level 0 at `y`, turned `yaw`. */
export function baseAt(structs: StructureStore, x: number, y: number, z: number, yaw: number): Frame {
  return structs.frames.make(Math.round(x * STRUCT_UNITS), Math.round(y * STRUCT_UNITS), Math.round(z * STRUCT_UNITS), yaw, TEAM);
}

/** Sets a piece down in the element of class `cls` named from the corner `a` along `d`, its own +X `turn` of its slot's turns on from that way. Returns its ref. */
export function putAt(structs: StructureStore, reg: Registry, f: Frame, id: string, cls: number, a: readonly number[], d: number, lvl: number, hp = 1, flipped = false): number {
  const kind = reg.index.get(id);
  if (kind === undefined) throw new Error(`no kind ${id}`);
  m.set(a);
  canonical(cls, m, 0, dirTurn(d, 0), m, 4);
  // An edge named against the way it was asked along is the same edge turned half round.
  const rot = cls === CLS_EDGE && (canon.turn === 1) !== flipped ? 1 : 0;
  const ref = structs.place(kind, f.gid, key0(cls, m[4]!, m[5]!, m[6]!), key1(m[7]!, lvl, canon.dir, reg.forms!.layer[kind]!, rot, 0), TEAM, reg.maxHp[kind]! * hp);
  if (ref < 0) throw new Error(`${id} does not fit along ${d} at level ${lvl}`);
  return ref;
}

/**
 * The junction `ends` describe, its walls set down by key round the corner of base `f`, which is at (vx, vz): a way is
 * degrees from the base's own +X toward +Z, a whole number of twelfths of a turn. `turned` is the base's +X in the
 * world, in degrees the same way. A house's corner has a foundation and a ceiling in the quarter between ways 0 and 90.
 */
export function layJunction(structs: StructureStore, reg: Registry, f: Frame, name: string, vx: number, vz: number, turned: number, ends: readonly WallEnd[], house: TierName | null = null): Junction {
  const has = (id: string): boolean => reg.index.has(id);
  const foot = f.oy / STRUCT_UNITS;
  const made = junction(name, vx, vz, ends.map((e) => ({ ...e, way: e.way + turned })), has, foot);
  for (const e of ends) {
    const d = Math.round(e.way / 30);
    // A wall whose outside is on the left of its way runs along it; any other runs back along it.
    putAt(structs, reg, f, pieceId(e.form, e.tier, has), CLS_EDGE, O, d, (e.storey ?? 0) * 4, 1, !e.left);
  }
  if (house) {
    putAt(structs, reg, f, pieceId("foundation", house, has), CLS_SQUARE, O, 0, 0);
    putAt(structs, reg, f, pieceId("ceiling", house, has), CLS_SQUARE, O, 0, 4);
  }
  return made;
}

/** A base's yaw whose own +X lies `units` yaw units from the world's toward +Z, and that turn in degrees. */
export const turnedBy = (units: number): { yaw: number; degrees: number } => ({ yaw: (65536 - units) & 65535, degrees: (units * 360) / 65536 });

export { FOUNDATION_THICK };

/** A piece or a trim as the near store holds it: its mesh's id, its slot, whether it is a trim, and its instance's bytes. */
export interface Drawn extends Standing {
  id: string;
  ref: number;
  trim: boolean;
  bytes: Uint8Array;
  /** Its vertices in the world, x, y, z each. */
  points: Float64Array;
}

/** The near store's batches of built chunks, which the scene keeps to itself. */
export function batchesOf(scene: Scene): Map<number, ChunkBatch> {
  return (scene as unknown as { nearStore: { batches: Map<number, ChunkBatch> } }).nearStore.batches;
}

/**
 * Every instance of every chunk's batch as it is drawn at its finest level: its triangles in the world, by the rule
 * the vertex programs share (piece-fit.ts) for a built piece and by its yaw for any other.
 */
export function drawn(scene: Scene, dims: MapDims, pack: Pack, meshes: ReadonlyMap<string, SourceMesh>): Drawn[] {
  const fit = new PieceFit();
  const out: Drawn[] = [];
  const flag = (scene as unknown as { nearStore: { pieces: { flag: Uint32Array } } }).nearStore.pieces.flag;
  for (const [chunk, b] of batchesOf(scene)) {
    if (chunk >= NODE_BUFFERS) continue;
    const x0 = chunkCx(dims, chunk) * CHUNK_SIZE, z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
    const view = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength);
    for (let r = 0; r < b.ranges.length; r += 3) {
      const id = pack.header.meshes[b.ranges[r]!]!.id, lod = meshes.get(id)!.lods[0]!;
      for (let i = b.ranges[r + 1]!; i < b.ranges[r + 1]! + b.ranges[r + 2]!; i++) {
        const at = i * INSTANCE_BYTES;
        const piece = flag[b.ranges[r]!] !== 0;
        const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
        if (piece) fit.begin(b.frames ?? undefined, b.data, at);
        const [c, s] = piece ? [fit.c, fit.s] : [Math.cos(yaw), Math.sin(yaw)];
        const [ix, iy, iz] = [view.getFloat32(at, true) + x0, view.getFloat32(at + 4, true), view.getFloat32(at + 8, true) + z0];
        const points = new Float64Array(lod.positions.length);
        for (let v = 0; v < points.length; v += 3) {
          let [lx, ly, lz] = [lod.positions[v]!, lod.positions[v + 1]!, lod.positions[v + 2]!];
          if (piece) {
            fit.vertex(lx, ly, lz);
            [lx, ly, lz] = [fit.x, fit.y, fit.z];
          }
          points.set([ix + c * lx + s * lz, iy + ly, iz - s * lx + c * lz], v);
        }
        const tris: Tri[] = [];
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let t = 0; t < lod.indices.length; t += 3) {
          const tri = [0, 1, 2].flatMap((k) => [...points.subarray(lod.indices[t + k]! * 3, lod.indices[t + k]! * 3 + 3)]) as Tri;
          tris.push(tri);
          for (let k = 0; k < 9; k++) {
            lo[k % 3] = Math.min(lo[k % 3]!, tri[k]!);
            hi[k % 3] = Math.max(hi[k % 3]!, tri[k]!);
          }
        }
        out.push({ id, ref: chunk * 65536 + b.slots[i]!, trim: b.trimmed !== null && b.trimmed[i] === 1, bytes: b.data.subarray(at, at + INSTANCE_BYTES), points, tris, lo, hi });
      }
    }
  }
  return out;
}

/** Those of `all` any of whose box lies within `reach` metres of (x, z). */
export function round(all: readonly Drawn[], x: number, z: number, reach: number): Drawn[] {
  return all.filter((d) => d.lo[0]! < x + reach && d.hi[0]! > x - reach && d.lo[2]! < z + reach && d.hi[2]! > z - reach);
}
