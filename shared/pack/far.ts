// A landmark's far mesh, `<name>:far`, made when its files are built (tools/pack/far.ts): its drawn pieces at two coarse
// levels in one mesh, in the landmark's own metres, so one draw of a run of it stands for many of its pieces. Each
// piece's triangles are one run of indices in each level, and the pieces go in an order that keeps neighbours together.
// The row that finds the pieces in the mesh goes in the landmark's pack header and its manifest, and joins with them
// (shared/pack/join.ts).

import { meshKnown, type Manifest } from "./manifest.ts";

/** The far mesh's two levels: every drawn piece at the coarsest level of its own mesh that errs this many metres or less. */
export const FAR_ERRORS: readonly [number, number] = [0.06, 0.13];

export const farMeshId = (landmark: string): string => `${landmark}:far`;

/** How a landmark's far mesh is stored beside it, small because a client reads it before its first frame. */
export interface LandmarkFarRow {
  name: string;
  /**
   * Four numbers a piece, in the mesh's order: x, y and z of where it stands in the landmark's metres, as the landmark's
   * pieces give it, and the radius in metres of a sphere about there that holds its far geometry at both levels.
   */
  pieces: number[];
  /** For each level, each piece's count of indices. A piece's first index is the sum of the counts before it. */
  counts: [number[], number[]];
}

/** What the draw side reads of a landmark's far mesh. */
export interface LandmarkFar {
  readonly name: string;
  /** Index of `<name>:far` in the manifest's meshes. */
  readonly mesh: number;
  readonly pieces: number;
  /** x, y, z a piece, in the landmark's metres: a map turns and sets them down as `landmarkPoint` does its statics. */
  readonly at: Float64Array;
  readonly radius: Float32Array;
  /** By level, each piece's first index and its count of indices in that level. */
  readonly first: readonly [Uint32Array, Uint32Array];
  readonly count: readonly [Uint32Array, Uint32Array];
}

/** Every landmark far mesh a manifest lists, as the draw side reads them. Throws where a row does not fit its mesh. */
export function landmarkFars(m: Manifest): LandmarkFar[] {
  return (m.landmarks ?? []).map((row) => {
    const mesh = m.meshes.findIndex((x) => x.id === farMeshId(row.name));
    const n = row.pieces.length / 4;
    const levels = m.meshes[mesh]?.levels;
    if (!levels || levels.length !== 2 || !Number.isInteger(n) || row.counts.length !== 2 || row.counts.some((c) => c.length !== n)) throw new Error(`manifest: the far mesh of ${row.name} is not as its row says`);
    const first = [new Uint32Array(n), new Uint32Array(n)] as const;
    const count = [Uint32Array.from(row.counts[0]), Uint32Array.from(row.counts[1])] as const;
    for (let l = 0; l < 2; l++) {
      let at = 0;
      for (let p = 0; p < n; p++) {
        if (count[l][p] !== row.counts[l][p] || count[l][p]! % 3 !== 0) throw new Error(`manifest: a piece of the far mesh of ${row.name} is not whole triangles`);
        first[l][p] = at;
        at += count[l][p]!;
      }
      if (meshKnown(m.meshes[mesh]!) && at !== levels[l]!.tris * 3) throw new Error(`manifest: the pieces of the far mesh of ${row.name} do not cover its level ${l}`);
    }
    const at = new Float64Array(n * 3), radius = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      at.set(row.pieces.slice(p * 4, p * 4 + 3), p * 3);
      radius[p] = row.pieces[p * 4 + 3]!;
    }
    return { name: row.name, mesh, pieces: n, at, radius, first, count };
  });
}
