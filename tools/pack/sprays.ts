// A level's cut-out triangles put in the order they are worth drawing, so that the first of them drawn alone is a
// thinner crown of the same tree (render/scene.ts draws a share of a crown's leaves under the frame's budget). A spray is
// the triangles that share corners, a card's two sides together. Each is ranked by how much of it can be seen from round
// about, its own level's opaque surfaces in the way, and then by its size: a spray on the outside of a crown comes before
// one turned in toward its head, and both before one deep in the crown or behind it, which no one sees anyway.
//
// What hides what: the opaque triangles are put in boxes VOXEL on a side, and for each way it is looked at the box
// farthest toward the eye is kept for each square across the view. A triangle of a spray is seen from there where its
// middle stands no farther back than that, less half a box.

const VOXEL = 0.5;
/** The squares across a view in which the box farthest toward the eye is kept: wider than a box, so a box seen corner on leaves no gap. */
const SQUARE = 0.7;
/** Places are told apart to a millimetre, within this many millimetres of the middle each way. */
const SPAN = 1 << 17;

/**
 * The ways a crown is looked at, toward the eye: round about from a little below, as from the ground, and fewer from a
 * little above, from under it and from over it, with what each weighs.
 */
const LOOKS: readonly { dir: readonly [number, number, number]; weight: number }[] = (() => {
  const out: { dir: [number, number, number]; weight: number }[] = [];
  for (const [rise, weight, ways, turn] of [[-0.35, 1, 8, 0], [0.35, 0.6, 4, 0.5]] as const) {
    for (let k = 0; k < ways; k++) {
      const a = ((k + turn) / ways) * Math.PI * 2;
      out.push({ dir: [Math.cos(a) * Math.cos(rise), Math.sin(rise), Math.sin(a) * Math.cos(rise)], weight });
    }
  }
  out.push({ dir: [0, -1, 0], weight: 0.6 }, { dir: [0, 1, 0], weight: 0.3 });
  return out;
})();
const WEIGHTS = LOOKS.reduce((s, l) => s + l.weight, 0);

/** A way of looking: the direction toward the eye and two across it, and for each square across it the farthest toward the eye of the opaque boxes. */
interface View {
  dir: readonly number[];
  u: number[];
  w: number[];
  u0: number;
  w0: number;
  nu: number;
  nw: number;
  front: Float64Array;
}

/** Two directions across `d`, at right angles to it and to each other. */
function across(d: readonly number[]): [number[], number[]] {
  const up = Math.abs(d[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [up[1]! * d[2]! - up[2]! * d[1]!, up[2]! * d[0]! - up[0]! * d[2]!, up[0]! * d[1]! - up[1]! * d[0]!];
  const n = Math.hypot(u[0]!, u[1]!, u[2]!);
  const uu = u.map((x) => x / n);
  return [uu, [d[1]! * uu[2]! - d[2]! * uu[1]!, d[2]! * uu[0]! - d[0]! * uu[2]!, d[0]! * uu[1]! - d[1]! * uu[0]!]];
}

/** The least and most of `positions` on each axis. */
function bounds(positions: Float32Array): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) {
    for (let a = 0; a < 3; a++) {
      const x = positions[v + a]!;
      if (x < lo[a]!) lo[a] = x;
      if (x > hi[a]!) hi[a] = x;
    }
  }
  return { lo, hi };
}

/** The middles of the boxes the triangles of `runs` (first index, how many) pass through, x, y, z each. */
function boxes(positions: Float32Array, indices: Uint32Array, runs: readonly number[][], { lo, hi }: { lo: number[]; hi: number[] }): Float64Array {
  const [nx, ny, nz] = [0, 1, 2].map((a) => Math.floor((hi[a]! - lo[a]!) / VOXEL) + 1) as [number, number, number];
  const filled = new Uint8Array(nx * ny * nz);
  const out: number[] = [];
  const [x0, y0, z0] = [lo[0]!, lo[1]!, lo[2]!];
  const p = positions;
  for (const [from, count] of runs) {
    for (let t = from!; t < from! + count!; t += 3) {
      const a = indices[t]! * 3;
      const b = indices[t + 1]! * 3;
      const c = indices[t + 2]! * 3;
      const ab = (p[a]! - p[b]!) ** 2 + (p[a + 1]! - p[b + 1]!) ** 2 + (p[a + 2]! - p[b + 2]!) ** 2;
      const bc = (p[b]! - p[c]!) ** 2 + (p[b + 1]! - p[c + 1]!) ** 2 + (p[b + 2]! - p[c + 2]!) ** 2;
      const ca = (p[c]! - p[a]!) ** 2 + (p[c + 1]! - p[a + 1]!) ** 2 + (p[c + 2]! - p[a + 2]!) ** 2;
      const n = Math.max(1, Math.ceil(Math.sqrt(Math.max(ab, bc, ca)) / (VOXEL * 0.7)));
      for (let s = 0; s <= n; s++) {
        for (let r = 0; r <= n - s; r++) {
          const wb = s / n;
          const wc = r / n;
          const wa = 1 - wb - wc;
          const i = Math.floor((p[a]! * wa + p[b]! * wb + p[c]! * wc - x0) / VOXEL);
          const j = Math.floor((p[a + 1]! * wa + p[b + 1]! * wb + p[c + 1]! * wc - y0) / VOXEL);
          const k = Math.floor((p[a + 2]! * wa + p[b + 2]! * wb + p[c + 2]! * wc - z0) / VOXEL);
          const at = (k * ny + j) * nx + i;
          if (filled[at]) continue;
          filled[at] = 1;
          out.push(x0 + (i + 0.5) * VOXEL, y0 + (j + 0.5) * VOXEL, z0 + (k + 0.5) * VOXEL);
        }
      }
    }
  }
  return Float64Array.from(out);
}

/** For each way of looking, the farthest toward the eye of the `solid` boxes in each square across the level's bounds. */
function views(solid: Float64Array, { lo, hi }: { lo: number[]; hi: number[] }): View[] {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [c & 1 ? hi[0]! : lo[0]!, c & 2 ? hi[1]! : lo[1]!, c & 4 ? hi[2]! : lo[2]!]);
  return LOOKS.map(({ dir }) => {
    const [u, w] = across(dir);
    let [u0, u1, w0, w1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y, z] of corners) {
      const [pu, pw] = [x! * u[0]! + y! * u[1]! + z! * u[2]!, x! * w[0]! + y! * w[1]! + z! * w[2]!];
      [u0, u1, w0, w1] = [Math.min(u0, pu), Math.max(u1, pu), Math.min(w0, pw), Math.max(w1, pw)];
    }
    const [nu, nw] = [Math.ceil((u1 - u0) / SQUARE) + 3, Math.ceil((w1 - w0) / SQUARE) + 3];
    const front = new Float64Array(nu * nw).fill(-Infinity);
    const [ux, uy, uz, wx, wy, wz, dx, dy, dz] = [u[0]!, u[1]!, u[2]!, w[0]!, w[1]!, w[2]!, dir[0], dir[1], dir[2]];
    for (let b = 0; b < solid.length; b += 3) {
      const x = solid[b]!;
      const y = solid[b + 1]!;
      const z = solid[b + 2]!;
      const at = (Math.floor((x * wx + y * wy + z * wz - w0) / SQUARE) + 1) * nu + Math.floor((x * ux + y * uy + z * uz - u0) / SQUARE) + 1;
      const depth = x * dx + y * dy + z * dz;
      if (depth > front[at]!) front[at] = depth;
    }
    return { dir, u, w, u0, w0, nu, nw, front };
  });
}

/** The sprays of a run of triangles: for each triangle, the spray it is in, numbered from 0. */
function spraysOf(positions: Float32Array, indices: Uint32Array, from: number, count: number): { of: Int32Array; sprays: number } {
  const n = count / 3;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  // Triangles meet where they share a corner, or a place: a card's two sides have corners of their own.
  const owner = new Map<number, number>();
  const mm = (x: number): number => Math.round(x * 1000) + SPAN;
  for (let t = 0; t < n; t++) {
    for (let c = 0; c < 3; c++) {
      const v = indices[from + t * 3 + c]! * 3;
      const key = (mm(positions[v]!) * 2 * SPAN + mm(positions[v + 1]!)) * 2 * SPAN + mm(positions[v + 2]!);
      const o = owner.get(key);
      if (o === undefined) owner.set(key, t);
      else parent[find(t)] = find(o);
    }
  }
  const of = new Int32Array(n);
  const number = new Int32Array(n).fill(-1);
  let sprays = 0;
  for (let t = 0; t < n; t++) {
    const root = find(t);
    if (number[root]! < 0) number[root] = sprays++;
    of[t] = number[root]!;
  }
  return { of, sprays };
}

/** How much of a place is seen from round about, 0 to 1. */
function seenFrom(all: readonly View[], x: number, y: number, z: number): number {
  let sum = 0;
  for (let k = 0; k < all.length; k++) {
    const m = all[k]!;
    const i = Math.floor((x * m.u[0]! + y * m.u[1]! + z * m.u[2]! - m.u0) / SQUARE) + 1;
    const j = Math.floor((x * m.w[0]! + y * m.w[1]! + z * m.w[2]! - m.w0) / SQUARE) + 1;
    if (x * m.dir[0]! + y * m.dir[1]! + z * m.dir[2]! >= m.front[j * m.nu + i]! - VOXEL / 2) sum += LOOKS[k]!.weight;
  }
  return sum / WEIGHTS;
}

/**
 * Puts the triangles of each cut-out run of a level in order, best seen first. `sections` are the level's runs as a pack
 * has them, three numbers each: material, first index, how many; `cutout` says which materials are cut out.
 */
export function rankSprays(positions: Float32Array, indices: Uint32Array, sections: readonly number[], cutout: (material: number) => boolean): void {
  const opaque: number[][] = [];
  const cut: number[][] = [];
  for (let k = 0; k < sections.length; k += 3) (cutout(sections[k]!) ? cut : opaque).push([sections[k + 1]!, sections[k + 2]!]);
  if (cut.length === 0) return;
  const box = bounds(positions);
  const all = views(boxes(positions, indices, opaque, box), box);
  for (const [from, count] of cut) {
    const { of, sprays } = spraysOf(positions, indices, from!, count!);
    const seen = new Float64Array(sprays);
    const corners = new Float64Array(sprays);
    const area = new Float64Array(sprays);
    for (let t = 0; t < count! / 3; t++) {
      const s = of[t]!;
      const [a, b, c] = [indices[from! + t * 3]! * 3, indices[from! + t * 3 + 1]! * 3, indices[from! + t * 3 + 2]! * 3];
      const [ex, ey, ez] = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
      const [fx, fy, fz] = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
      area[s] += Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx) / 2;
      // A triangle's middle stands for it: a card's corners are shared with its other side and its neighbours.
      seen[s] += seenFrom(all, (positions[a]! + positions[b]! + positions[c]!) / 3, (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3, (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3);
      corners[s]++;
    }
    // Seen most first, larger first among those seen alike, and as they came among those alike in both.
    const mean = area.reduce((x, y) => x + y, 0) / Math.max(1, sprays);
    const score = Float64Array.from(seen, (x, s) => (x / corners[s]!) * Math.sqrt(area[s]! / (mean || 1)));
    const order = Uint32Array.from({ length: count! / 3 }, (_, t) => t).sort((p, q) => score[of[q]!]! - score[of[p]!]! || of[p]! - of[q]! || p - q);
    const was = indices.slice(from!, from! + count!);
    for (let k = 0; k < order.length; k++) indices.set(was.subarray(order[k]! * 3, order[k]! * 3 + 3), from! + k * 3);
  }
}
