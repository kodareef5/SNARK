// How far a coarser level of a mesh lies from the finest, measured on the meshes themselves.

import type { SourceLod } from "./write.ts";

/** The distance from point p to the triangle a, b, c (Ericson, Real-Time Collision Detection, 5.1.5). */
export function toTriangle(px: number, py: number, pz: number, t: Float32Array, a: number, b: number, c: number): number {
  const ax = t[a]!, ay = t[a + 1]!, az = t[a + 2]!;
  const abx = t[b]! - ax, aby = t[b + 1]! - ay, abz = t[b + 2]! - az;
  const acx = t[c]! - ax, acy = t[c + 1]! - ay, acz = t[c + 2]! - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let v = 0;
  let w = 0;
  if (d1 > 0 || d2 > 0) {
    const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) v = 1;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) v = d1 / (d1 - d3);
    else if (d6 >= 0 && d5 <= d6) w = 1;
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) w = d2 / (d2 - d6);
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      v = 1 - w;
    } else {
      const sum = va + vb + vc;
      v = sum === 0 ? 0 : vb / sum;
      w = sum === 0 ? 0 : vc / sum;
    }
  }
  return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

/** A grid has no more cells than this along an axis. */
const MOST_CELLS = 128;
/** A triangle is put in the cells its box reaches, and this share of a cell further, so that rounding leaves none out. */
const SLACK = 1e-6;

/**
 * The triangles of a level in a grid of cells about as large as they are. The triangle nearest a point is found by
 * trying the point's own cell and then the cells around it, a layer at a time, until nothing further out can be nearer.
 */
class Grid {
  private readonly t: Float32Array;
  private readonly indices: Uint32Array;
  private readonly min = [0, 0, 0];
  private readonly cell = [1, 1, 1];
  private readonly n = [1, 1, 1];
  /** Per cell, where its triangles start in `list`. One more entry than there are cells. */
  private readonly start: Uint32Array;
  private readonly list: Uint32Array;
  /** Per triangle, the last query that tried it. */
  private readonly tried: Uint32Array;
  private query = 0;

  constructor(lod: SourceLod) {
    const t = (this.t = lod.positions);
    const indices = (this.indices = lod.indices);
    const count = indices.length / 3;
    const max = [-Infinity, -Infinity, -Infinity];
    this.min.fill(Infinity);
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i]! * 3, indices[i + 1]! * 3, indices[i + 2]! * 3];
      for (const v of [a, b, c]) {
        for (let k = 0; k < 3; k++) {
          if (t[v + k]! < this.min[k]!) this.min[k] = t[v + k]!;
          if (t[v + k]! > max[k]!) max[k] = t[v + k]!;
        }
      }
      const ux = t[b]! - t[a]!, uy = t[b + 1]! - t[a + 1]!, uz = t[b + 2]! - t[a + 2]!;
      const vx = t[c]! - t[a]!, vy = t[c + 1]! - t[a + 1]!, vz = t[c + 2]! - t[a + 2]!;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    // A cell is about as wide as the side of a mean triangle.
    const side = Math.sqrt((2 * area) / count) || 1;
    for (let k = 0; k < 3; k++) {
      const extent = max[k]! - this.min[k]!;
      this.n[k] = Math.max(1, Math.min(MOST_CELLS, Math.ceil(extent / side)));
      this.cell[k] = extent / this.n[k]! || 1;
    }
    const [nx, ny, nz] = this.n as [number, number, number];
    this.start = new Uint32Array(nx * ny * nz + 1);
    this.tried = new Uint32Array(count);
    // Twice over the triangles: once to count what each cell holds, once to fill it.
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    const each = (visit: (cell: number, triangle: number) => void): void => {
      for (let i = 0; i < indices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const [a, b, c] = [t[indices[i]! * 3 + k]!, t[indices[i + 1]! * 3 + k]!, t[indices[i + 2]! * 3 + k]!];
          lo[k] = Math.max(0, Math.floor((Math.min(a, b, c) - this.min[k]!) / this.cell[k]! - SLACK));
          hi[k] = Math.min(this.n[k]! - 1, Math.floor((Math.max(a, b, c) - this.min[k]!) / this.cell[k]! + SLACK));
        }
        for (let x = lo[0]!; x <= hi[0]!; x++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) visit((x * ny + y) * nz + z, i / 3);
      }
    };
    each((cell) => this.start[cell + 1]!++);
    for (let c = 0; c < nx * ny * nz; c++) this.start[c + 1]! += this.start[c]!;
    this.list = new Uint32Array(this.start[nx * ny * nz]!);
    const next = this.start.slice(0, nx * ny * nz);
    each((cell, triangle) => (this.list[next[cell]!++] = triangle));
  }

  /** The distance from a point to the nearest triangle. */
  nearest(px: number, py: number, pz: number): number {
    const { t, indices, min, cell, start, list, tried } = this;
    const [nx, ny, nz] = this.n as [number, number, number];
    const at = (p: number, k: number): number => Math.max(0, Math.min(this.n[k]! - 1, Math.floor((p - min[k]!) / cell[k]!)));
    const [cx, cy, cz] = [at(px, 0), at(py, 1), at(pz, 2)];
    const query = ++this.query;
    let best = Infinity;
    const visit = (x: number, y: number, z: number): void => {
      const c = (x * ny + y) * nz + z;
      for (let i = start[c]!; i < start[c + 1]!; i++) {
        const tri = list[i]!;
        if (tried[tri] === query) continue;
        tried[tri] = query;
        const d = toTriangle(px, py, pz, t, indices[tri * 3]! * 3, indices[tri * 3 + 1]! * 3, indices[tri * 3 + 2]! * 3);
        if (d < best) best = d;
      }
    };
    for (let r = 0; ; r++) {
      const [x0, x1, y0, y1, z0, z1] = [Math.max(0, cx - r), Math.min(nx - 1, cx + r), Math.max(0, cy - r), Math.min(ny - 1, cy + r), Math.max(0, cz - r), Math.min(nz - 1, cz + r)];
      // The cells of this layer: those on a face of the block of cells out to r.
      for (let x = x0; x <= x1; x++) {
        const onX = x === cx - r || x === cx + r;
        for (let y = y0; y <= y1; y++) {
          if (onX || y === cy - r || y === cy + r) for (let z = z0; z <= z1; z++) visit(x, y, z);
          else {
            if (cz - r >= 0) visit(x, y, cz - r);
            if (cz + r < nz && r > 0) visit(x, y, cz + r);
          }
        }
      }
      // What has not been tried lies wholly outside the block, so no nearer than the nearest face of it that has cells beyond.
      let beyond = Infinity;
      if (cx - r > 0) beyond = Math.min(beyond, px - (min[0]! + (cx - r) * cell[0]!));
      if (cx + r < nx - 1) beyond = Math.min(beyond, min[0]! + (cx + r + 1) * cell[0]! - px);
      if (cy - r > 0) beyond = Math.min(beyond, py - (min[1]! + (cy - r) * cell[1]!));
      if (cy + r < ny - 1) beyond = Math.min(beyond, min[1]! + (cy + r + 1) * cell[1]! - py);
      if (cz - r > 0) beyond = Math.min(beyond, pz - (min[2]! + (cz - r) * cell[2]!));
      if (cz + r < nz - 1) beyond = Math.min(beyond, min[2]! + (cz + r + 1) * cell[2]! - pz);
      // The slack a triangle's cells were given is taken off here.
      if (best <= beyond - SLACK * Math.max(cell[0]!, cell[1]!, cell[2]!)) return best;
    }
  }
}

/** How far each corner and each triangle's middle of `from` lies from the surface of `to`, least first. */
function distances(from: SourceLod, to: SourceLod): Float64Array {
  const p = from.positions;
  const grid = new Grid(to);
  const out = new Float64Array(p.length / 3 + from.indices.length / 3);
  let n = 0;
  for (let v = 0; v < p.length; v += 3) out[n++] = grid.nearest(p[v]!, p[v + 1]!, p[v + 2]!);
  for (let i = 0; i < from.indices.length; i += 3) {
    const [a, b, c] = [from.indices[i]! * 3, from.indices[i + 1]! * 3, from.indices[i + 2]! * 3];
    out[n++] = grid.nearest((p[a]! + p[b]! + p[c]!) / 3, (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3);
  }
  return out.sort();
}

/** The share of a surface that lies within the error given for it. */
export const ERROR_SHARE = 0.95;

/**
 * How far, in metres, the surfaces of `coarse` and `fine` lie from each other: 95 points in 100 of either are within
 * this of the other. The furthest point of all is not used, because one stray triangle would then speak for the whole
 * mesh. Sampled at every corner and every triangle's middle.
 */
export function surfaceError(fine: SourceLod, coarse: SourceLod): number {
  const at = (d: Float64Array): number => (d.length === 0 ? 0 : d[Math.min(d.length - 1, Math.floor(d.length * ERROR_SHARE))]!);
  if (fine.indices.length === 0 || coarse.indices.length === 0) return 0;
  return Math.max(at(distances(coarse, fine)), at(distances(fine, coarse)));
}

/** The most triangles a finer level may have to be tried the slow way. */
export const SLOW_MOST = 800;

/**
 * surfaceError as it was first written: every point against every triangle. What the grid must give exactly, tried by
 * tests/unit/error.test.ts and, on node packs, by `bun run art -- <id> --check`.
 */
export function slowSurfaceError(fine: SourceLod, coarse: SourceLod): number {
  const distances = (from: SourceLod, to: SourceLod): Float64Array => {
    const p = from.positions;
    const out: number[] = [];
    const near = (x: number, y: number, z: number): void => {
      let best = Infinity;
      for (let i = 0; i < to.indices.length; i += 3) best = Math.min(best, toTriangle(x, y, z, to.positions, to.indices[i]! * 3, to.indices[i + 1]! * 3, to.indices[i + 2]! * 3));
      out.push(best);
    };
    for (let v = 0; v < p.length; v += 3) near(p[v]!, p[v + 1]!, p[v + 2]!);
    for (let i = 0; i < from.indices.length; i += 3) {
      const [a, b, c] = [from.indices[i]! * 3, from.indices[i + 1]! * 3, from.indices[i + 2]! * 3];
      near((p[a]! + p[b]! + p[c]!) / 3, (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3);
    }
    return Float64Array.from(out).sort();
  };
  const at = (d: Float64Array): number => d[Math.min(d.length - 1, Math.floor(d.length * ERROR_SHARE))]!;
  return Math.max(at(distances(coarse, fine)), at(distances(fine, coarse)));
}
