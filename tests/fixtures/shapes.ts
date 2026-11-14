// Meshes drawn with materials that ask more of a simplifier than the tube does, made in code: a ring of six charts on
// three bones, a box whose every edge is a crease, and a flat plate. With them, a plain picture and a plain material.

import type { PackMaterial } from "../../shared/pack/pack.ts";
import type { Picture } from "../../tools/pack/image.ts";
import type { SourceLod } from "../../tools/pack/write.ts";

interface Lists {
  positions: number[];
  indices: number[];
  uvs: number[];
  normals: number[];
  sections: number[];
  bones: number[];
  joints: number[];
  weights: number[];
}
const lists = (): Lists => ({ positions: [], indices: [], uvs: [], normals: [], sections: [], bones: [], joints: [], weights: [] });
function lodOf(l: Lists): SourceLod {
  const lod: SourceLod = { positions: Float32Array.from(l.positions), colors: new Uint8Array(l.positions.length / 3).fill(1), indices: Uint32Array.from(l.indices), uvs: Float32Array.from(l.uvs), normals: Float32Array.from(l.normals), sections: Uint8Array.from(l.sections) };
  return l.bones.length > 0 ? { ...lod, bones: Uint8Array.from(l.bones), joints: Uint8Array.from(l.joints), weights: Float32Array.from(l.weights) } : lod;
}

/** The islands of the ring's picture, across and down. */
export const RING_ISLANDS = [3, 2] as const;

/**
 * A lumpy ring lying flat, a metre from its middle to the middle of its tube, on three bones spaced around it, each
 * of which hands over to the next across a sixth of the ring. Its skin is six charts, three around by two about the
 * tube, each an island of its own in the picture: island 1 is mirrored and island 4 turned a quarter. The half of the
 * ring with x below 0 is a second material, whose border runs through the middle of four of the charts.
 */
export function ring(around: number, about: number): SourceLod {
  const l = lists();
  const [ni, nj] = [around / RING_ISLANDS[0], about / RING_ISLANDS[1]];
  for (let chart = 0; chart < RING_ISLANDS[0] * RING_ISLANDS[1]; chart++) {
    const [ci, cj] = [chart % RING_ISLANDS[0], Math.floor(chart / RING_ISLANDS[0])];
    const first = l.positions.length / 3;
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        // A chart's last row and column are the next chart's first: the same places, with other texture coordinates.
        const [gi, gj] = [(ci * ni + i) % around, (cj * nj + j) % about];
        const [a, b] = [(gi / around) * Math.PI * 2, (gj / about) * Math.PI * 2];
        const r = 0.3 * (1 + 0.2 * Math.sin(3 * a) * Math.cos(2 * b));
        l.positions.push(Math.cos(a) * (1 + r * Math.cos(b)), r * Math.sin(b), Math.sin(a) * (1 + r * Math.cos(b)));
        l.normals.push(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b));
        let [s, t] = [i / ni, j / nj];
        if (chart === 1) s = 1 - s;
        if (chart === 4) [s, t] = [t, 1 - s];
        l.uvs.push((ci + 0.1 + 0.8 * s) / RING_ISLANDS[0], (cj + 0.1 + 0.8 * t) / RING_ISLANDS[1]);
        const at = (gi / around) * 3;
        const [low, share] = [Math.floor(at) % 3, Math.min(Math.max((at - Math.floor(at) - 0.25) * 2, 0), 1)];
        const own = share > 0.5 ? (low + 1) % 3 : low;
        l.bones.push(own);
        l.joints.push(own, share > 0 && share < 1 ? (own === low ? (low + 1) % 3 : low) : 0, 0, 0);
        l.weights.push(own === low ? 1 - share : share, own === low ? share : 1 - share, 0, 0);
      }
    }
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const v = first + j * (ni + 1) + i;
        l.indices.push(v, v + ni + 1, v + 1, v + 1, v + ni + 1, v + ni + 2);
        const half = ci * ni + i >= around / 4 && ci * ni + i < (around * 3) / 4 ? 1 : 0;
        l.sections.push(half, half);
      }
    }
  }
  return lodOf(l);
}

/**
 * A box two metres across with `n` by `n` squares to a side. Each side is flat, with normals of its own and an island
 * of its own in the picture, so every edge of the box is a crease and a seam. Its top is a second material. `lay`
 * says where across its island the first side has each place across itself, which is evenly unless given.
 */
export function block(n: number, lay: (s: number) => number = (s) => s): SourceLod {
  const l = lists();
  const sides = [
    [[1, -1, -1], [0, 2, 0], [0, 0, 2]], [[-1, -1, 1], [0, 2, 0], [0, 0, -2]], [[-1, 1, -1], [0, 0, 2], [2, 0, 0]],
    [[-1, -1, 1], [0, 0, -2], [2, 0, 0]], [[1, -1, 1], [0, 2, 0], [-2, 0, 0]], [[-1, -1, -1], [0, 2, 0], [2, 0, 0]],
  ];
  sides.forEach(([o, u, v], side) => {
    const first = l.positions.length / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        for (let a = 0; a < 3; a++) l.positions.push(o![a]! + (u![a]! * i) / n + (v![a]! * j) / n);
        l.normals.push((u![1]! * v![2]! - u![2]! * v![1]!) / 4, (u![2]! * v![0]! - u![0]! * v![2]!) / 4, (u![0]! * v![1]! - u![1]! * v![0]!) / 4);
        l.uvs.push(((side % 3) + 0.05 + 0.9 * (side === 0 ? lay(i / n) : i / n)) / 3, (Math.floor(side / 3) + 0.05 + (0.9 * j) / n) / 2);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = first + j * (n + 1) + i;
        l.indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
        l.sections.push(side === 2 ? 1 : 0, side === 2 ? 1 : 0);
      }
    }
  });
  return lodOf(l);
}

/**
 * A square of `n` by `n` cells lying flat, a metre across. `section` says which material a cell is drawn with, and
 * `lay` where in the picture a place on the square is: the picture lies once across it unless told otherwise.
 */
export function plate(n: number, section: (i: number, j: number) => number = () => 0, lay: (x: number, z: number) => number[] = (x, z) => [x, z]): SourceLod {
  const l = lists();
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      l.positions.push(i / n, 0, j / n);
      l.normals.push(0, 1, 0);
      l.uvs.push(...lay(i / n, j / n));
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      l.indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      l.sections.push(section(i, j), section(i, j));
    }
  }
  return lodOf(l);
}

/** A picture `side` pixels across with nothing see-through, each pixel the red, green and blue that `pixel` gives it. */
export function picture(side: number, pixel: (x: number, y: number) => readonly number[]): Picture {
  const data = new Uint8Array(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) data.set(pixel(x, y), (y * side + x) * 4);
  return { width: side, height: side, channels: 4, depth: 8, data };
}

/** A material with no tint and no textures named. */
export function plainMaterial(id: string): PackMaterial {
  return { id, base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 1 };
}
