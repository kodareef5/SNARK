// An item as it lies on the ground, made from the mesh it is held by: turned so that its broadest side is down,
// resting on y = 0 and centred over the origin across x and z. A held mesh is modelled square to its axes (its length
// along +Z, its top along +Y: tools/art/spec.ts, PieceSpec), so its broadest side is a face of its bounds: the one
// across its two longest extents. The turn is a quarter turn or none, the same for every level, so the levels still
// lie on one another and their errors stand.

import type { SourceLod, SourceMesh } from "./write.ts";

/** Which axis of the held mesh ends up pointing up: the one its bounds are thinnest along. 0 x, 1 y, 2 z. */
export function thinnest(lod: SourceLod): number {
  const [lo, hi] = boundsOf(lod);
  const size = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
  // Ties go to y, then x: a mesh as thin across as it is tall lies as it is held.
  if (size[1]! <= size[0]! && size[1]! <= size[2]!) return 1;
  return size[0]! <= size[2]! ? 0 : 2;
}

/** The least and the most x, y and z of a level's points. */
export function boundsOf(lod: SourceLod): [number[], number[]] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const p = lod.positions;
  for (let v = 0; v < p.length; v += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[v + k]! < lo[k]!) lo[k] = p[v + k]!;
      if (p[v + k]! > hi[k]!) hi[k] = p[v + k]!;
    }
  }
  return [lo, hi];
}

/**
 * (x, y, z) turned so that axis `up` points up. A quarter turn about z takes x up and keeps the length along z; one
 * about x takes z up. Both are turns and not mirrors, so triangles keep their winding and tangents their sign.
 */
function turn(up: number, x: number, y: number, z: number, out: number[]): void {
  if (up === 0) [out[0], out[1], out[2]] = [-y, x, z];
  else if (up === 2) [out[0], out[1], out[2]] = [x, z, -y];
  else [out[0], out[1], out[2]] = [x, y, z];
}

/** `held` lying on its broadest side as the mesh `id`, on no skeleton. `held` is not changed. */
export function lying(held: SourceMesh, id: string): SourceMesh {
  const up = thinnest(held.lods[0]!);
  const t = [0, 0, 0];
  // Where the finest level ends up, so that every level is moved by the same amount.
  const turned = turnLod(held.lods[0]!, up, t);
  const [lo, hi] = boundsOf(turned);
  const shift = [-(lo[0]! + hi[0]!) / 2, -lo[1]!, -(lo[2]! + hi[2]!) / 2];
  const lods = held.lods.map((lod, level) => {
    const made = level === 0 ? turned : turnLod(lod, up, t);
    const p = made.positions;
    for (let v = 0; v < p.length; v += 3) for (let k = 0; k < 3; k++) p[v + k] = p[v + k]! + shift[k]!;
    return made;
  });
  const { skeleton: _s, rig: _r, collider: _c, ...rest } = held;
  return { ...rest, id, lods };
}

/** A copy of `lod` turned, its normals and tangents with it, and on no bones. */
function turnLod(lod: SourceLod, up: number, t: number[]): SourceLod {
  const { bones: _b, joints: _j, weights: _w, ...rest } = lod;
  const out: SourceLod = { ...rest, positions: new Float32Array(lod.positions.length) };
  const each = (from: Float32Array, to: Float32Array, stride: number): void => {
    for (let v = 0; v < from.length; v += stride) {
      turn(up, from[v]!, from[v + 1]!, from[v + 2]!, t);
      to[v] = t[0]!;
      to[v + 1] = t[1]!;
      to[v + 2] = t[2]!;
      if (stride === 4) to[v + 3] = from[v + 3]!;
    }
  };
  each(lod.positions, out.positions, 3);
  if (lod.normals) each(lod.normals, (out.normals = new Float32Array(lod.normals.length)), 3);
  if (lod.tangents) each(lod.tangents, (out.tangents = new Float32Array(lod.tangents.length)), 4);
  return out;
}
