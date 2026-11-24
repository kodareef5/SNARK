// The meshes fire is drawn on (client/core/render/fire-light.ts), made here and drawn flat: a lathed cone for a rocket's
// flame and a ball for a lobe of a fireball. The fire program shapes and lights them, and reads a cone vertex's colour
// byte as where it is round the cone.

import { CONE_TURN, coneRadius } from "../../client/core/render/fire-light.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/**
 * The cone a unit long along +Z from its nozzle at the origin, a unit across at its widest, with `columns` round it and
 * a ring at each of `rings`. The seam's column is there twice, so a turn runs from 0 to CONE_TURN without a jump.
 */
function cone(columns: number, rings: readonly number[], error: number): SourceLod {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (const t of rings) {
    for (let k = 0; k <= columns; k++) {
      const a = (k / columns) * 2 * Math.PI, r = coneRadius(t);
      positions.push(Math.cos(a) * r, Math.sin(a) * r, t);
      colors.push(Math.round((k / columns) * CONE_TURN));
    }
  }
  const row = columns + 1;
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let k = 0; k < columns; k++) {
      const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, c);
      // The last ring is the tip, a point.
      if (j + 2 < rings.length) indices.push(b, d, c);
    }
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), error };
}

/** A ball of radius 1 about the origin: an icosahedron with each face split in four `splits` times. */
function ball(splits: number, error: number): SourceLod {
  const g = (1 + Math.sqrt(5)) / 2;
  let points: number[][] = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]];
  let faces: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (p: number[]): number[] => {
    const l = Math.hypot(p[0]!, p[1]!, p[2]!);
    return [p[0]! / l, p[1]! / l, p[2]! / l];
  };
  points = points.map(unit);
  for (let s = 0; s < splits; s++) {
    const middles = new Map<number, number>();
    const middle = (a: number, b: number): number => {
      const key = Math.min(a, b) * 65536 + Math.max(a, b);
      let m = middles.get(key);
      if (m === undefined) {
        m = points.length;
        points.push(unit([points[a]![0]! + points[b]![0]!, points[a]![1]! + points[b]![1]!, points[a]![2]! + points[b]![2]!]));
        middles.set(key, m);
      }
      return m;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = middle(a!, b!), bc = middle(b!, c!), ca = middle(c!, a!);
      return [[a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]];
    });
  }
  return { positions: Float32Array.from(points.flat()), colors: new Uint8Array(points.length), indices: Uint32Array.from(faces.flat()), error };
}

/** Ids are those client/core/render/blasts.ts finds. */
export function fireMeshes(): SourceMesh[] {
  return [
    // 204, 54 and 20 triangles.
    { id: "core:fire_cone", lods: [cone(12, [0, 0.06, 0.14, 0.25, 0.38, 0.52, 0.66, 0.8, 0.92, 1], 0), cone(6, [0, 0.12, 0.3, 0.55, 0.8, 1], 0.03), cone(4, [0, 0.25, 0.6, 1], 0.09)] },
    // 320 and 80 triangles. Twenty would stand a fifth of its radius off the ball, which no level of a mesh may.
    { id: "core:fire_lobe", lods: [ball(2, 0), ball(1, 0.045)] },
  ];
}
