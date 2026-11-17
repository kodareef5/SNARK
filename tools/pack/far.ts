// Makes a landmark's far mesh as shared/pack/far.ts describes it, from its placed pieces' own levels. `landmarkArt` is the
// one way every build and test reads a landmark's art, so each has the far mesh as the others do.

import { join } from "node:path";
import type { Def } from "../../shared/content/defs.ts";
import { FAR_ERRORS, farMeshId, type LandmarkFarRow } from "../../shared/pack/far.ts";
import { REGION_BASE, REGION_COUNT, defaultPalette } from "../../shared/pack/palette.ts";
import { TAU, detCos, detSin } from "../../shared/math/scalar.ts";
import type { Landmark } from "../../shared/world/landmark.ts";
import { LANDMARKS, readPacks, type SourceArt } from "../art/source.ts";
import { surfaceError } from "./error.ts";
import { buildPack, type SourceLod, type SourceMesh } from "./write.ts";

/** Metres a square of the curve the pieces are ordered along. */
const CURVE_CELL = 1;

/** Where along a Hilbert curve that fills `n` by `n` squares, `n` a power of two, the square (x, z) is. */
export function hilbert(n: number, x: number, z: number): number {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, rz = (z & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ rz);
    if (rz === 0) {
      if (rx === 1) [x, z] = [n - 1 - x, n - 1 - z];
      [x, z] = [z, x];
    }
  }
  return d;
}

const errorOf = (m: SourceMesh, k: number): number => (k === 0 ? 0 : (m.lods[k]!.error ?? surfaceError(m.lods[0]!, m.lods[k]!)));

/** The coarsest level of `m` that errs `most` metres or less, or its finest where none does. */
function levelOf(m: SourceMesh, most: number): number {
  let level = 0;
  for (let k = 0; k < m.lods.length; k++) if (errorOf(m, k) <= most) level = k;
  return level;
}

export interface MergedFar {
  mesh: SourceMesh;
  row: LandmarkFarRow;
  /** The kinds it places that draw something other than nothing or a mesh of its pack, which the far mesh leaves out. */
  otherwise: string[];
}

/** The far mesh of `l` from its pack's meshes, or null where it draws none of them. Its row carries the `finishes` its art states. */
export function mergeFar(l: Landmark, meshes: readonly SourceMesh[], finishes?: readonly number[]): MergedFar | null {
  const byId = new Map(meshes.map((m) => [m.id, m]));
  const defs = new Map<string, Def>(l.defs.map((d) => [d.id, d]));
  const otherwise = new Set<string>();
  const drawn: { at: readonly number[]; yaw: number; mesh: SourceMesh; color: number; key: number; index: number }[] = [];
  l.pieces.forEach((p, index) => {
    const d = defs.get(p.kind);
    const mesh = d && "mesh" in d ? d.mesh : undefined;
    if (mesh === "none" || (d?.type === "structure" && (d.opens !== undefined || d.motion !== undefined))) return;
    const m = mesh === undefined ? undefined : byId.get(mesh);
    if (!m) otherwise.add(p.kind);
    else drawn.push({ at: p.at, yaw: p.yaw, mesh: m, color: d && "color" in d ? (d.color as number) : 0, key: 0, index });
  });
  if (drawn.length === 0) return null;
  const x0 = Math.min(...drawn.map((p) => p.at[0]!)), z0 = Math.min(...drawn.map((p) => p.at[2]!));
  const cells = Math.max(...drawn.map((p) => Math.max(p.at[0]! - x0, p.at[2]! - z0))) / CURVE_CELL;
  let n = 1;
  while (n <= cells) n *= 2;
  for (const p of drawn) p.key = hilbert(n, Math.floor((p.at[0]! - x0) / CURVE_CELL), Math.floor((p.at[2]! - z0) / CURVE_CELL));
  drawn.sort((a, b) => a.key - b.key || a.at[1]! - b.at[1]! || a.index - b.index);
  const radius = new Float64Array(drawn.length);
  const counts: [number[], number[]] = [[], []];
  const lods = FAR_ERRORS.map((most, level): SourceLod => {
    const levels = drawn.map((p) => p.mesh.lods[levelOf(p.mesh, most)]!);
    const verts = levels.reduce((sum, lod) => sum + lod.positions.length / 3, 0);
    const positions = new Float32Array(verts * 3), colors = new Uint8Array(verts);
    const indices = new Uint32Array(levels.reduce((sum, lod) => sum + lod.indices.length, 0));
    let v = 0, i = 0;
    drawn.forEach((p, k) => {
      const lod = levels[k]!, a = (p.yaw / 65536) * TAU, c = detCos(a), s = detSin(a);
      for (let t = 0; t < lod.indices.length; t++) indices[i++] = lod.indices[t]! + v;
      counts[level]!.push(lod.indices.length);
      for (let q = 0; q < lod.positions.length / 3; q++, v++) {
        const x = lod.positions[q * 3]!, y = lod.positions[q * 3 + 1]!, z = lod.positions[q * 3 + 2]!;
        // As a static is turned: x' = c x + s z, z' = c z - s x.
        positions[v * 3] = p.at[0]! + c * x + s * z;
        positions[v * 3 + 1] = p.at[1]! + y;
        positions[v * 3 + 2] = p.at[2]! + c * z - s * x;
        const colour = lod.colors[q]!;
        // A static is drawn with its kind's colour in its first region and nothing in the rest.
        colors[v] = colour < REGION_BASE || colour >= REGION_BASE + REGION_COUNT ? colour : colour === REGION_BASE ? p.color : 0;
        radius[k] = Math.max(radius[k]!, Math.hypot(x, y, z));
      }
    });
    return level === 0 ? { positions, colors, indices } : { positions, colors, indices, error: most };
  });
  // Rounded up past the centimetre, so it holds the vertices as stored as well.
  const pieces = drawn.flatMap((p, k) => [p.at[0]!, p.at[1]!, p.at[2]!, Math.ceil(radius[k]! * 100 + 1) / 100]);
  const row: LandmarkFarRow = { name: l.name, pieces, counts };
  if (finishes?.length) row.finishes = [...finishes];
  return { mesh: { id: farMeshId(l.name), lods }, row, otherwise: [...otherwise].sort() };
}

/** A landmark's art: what the packs in its folder hold, with its far mesh among the meshes and its row beside them. */
export interface LandmarkArt extends SourceArt {
  far: MergedFar | null;
}

/** The art of a landmark, its far mesh made from its own meshes. */
export function landmarkArt(l: Landmark): LandmarkArt {
  const art = readPacks(join(LANDMARKS, l.name));
  const far = mergeFar(l, art.meshes, art.finishes);
  return { ...art, meshes: far ? [...art.meshes, far.mesh] : art.meshes, far };
}

/** A landmark's whole pack as its art makes it, its far mesh's row in its header. */
export function landmarkPack(art: LandmarkArt): Uint8Array {
  return buildPack(art.meshes, defaultPalette(), [], art.rigs, null, art.far ? [art.far.row] : []);
}
