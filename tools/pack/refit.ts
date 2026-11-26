// Moves a piece made on one head onto another: hair and beards modelled on the Quaternius heads, worn on MakeHuman's.
// Each head's outermost surface is measured along rays from a point inside it, and a vertex moves along its ray by
// how much farther out or nearer in the new head is there, smoothed, so the piece keeps its own thickness.

import type { SourceLod } from "./write.ts";

/** A head at rest: positions and the triangles of its surface. */
export interface HeadSurface {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

const ROWS = 48;
const COLS = 96;
/** The most a point moves, in metres. */
const MOST = 0.03;

/** The ray of a grid cell: down from straight up by row, round from +Z towards +X by column. */
function direction(row: number, col: number, out: number[]): void {
  const theta = ((row + 0.5) / ROWS) * Math.PI;
  const phi = ((col + 0.5) / COLS) * Math.PI * 2;
  out[0] = Math.sin(theta) * Math.sin(phi);
  out[1] = Math.cos(theta);
  out[2] = Math.sin(theta) * Math.cos(phi);
}

/** The outermost hit of a ray from `c` along each cell's direction, or NaN where none. */
function radii(head: HeadSurface, c: readonly number[]): Float64Array {
  const out = new Float64Array(ROWS * COLS).fill(NaN);
  const p = head.positions, idx = head.indices;
  const d = [0, 0, 0];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    direction(row, col, d);
    let far = NaN;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, e = idx[t + 2]! * 3;
      const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
      const e2x = p[e]! - p[a]!, e2y = p[e + 1]! - p[a + 1]!, e2z = p[e + 2]! - p[a + 2]!;
      const hx = d[1]! * e2z - d[2]! * e2y, hy = d[2]! * e2x - d[0]! * e2z, hz = d[0]! * e2y - d[1]! * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const sx = c[0]! - p[a]!, sy = c[1]! - p[a + 1]!, sz = c[2]! - p[a + 2]!;
      const u = (sx * hx + sy * hy + sz * hz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const t1 = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t1 > 0 && !(t1 <= far)) far = t1;
    }
    out[row * COLS + col] = far;
  }
  return out;
}

/** Fills the cells with no value from those that have, and evens the whole out over `pass` sweeps of its neighbours. */
function smoothed(grid: Float64Array, pass: number): Float64Array {
  let g = Float64Array.from(grid);
  const known = Uint8Array.from(grid, (v) => (Number.isNaN(v) ? 0 : 1));
  for (let k = 0; k < 400 && g.some((v) => Number.isNaN(v)); k++) {
    const next = Float64Array.from(g);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (!Number.isNaN(g[row * COLS + col]!)) continue;
      let s = 0, n = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = row + dr!;
        if (r < 0 || r >= ROWS) continue;
        const v = g[r * COLS + ((col + dc! + COLS) % COLS)]!;
        if (!Number.isNaN(v)) [s, n] = [s + v, n + 1];
      }
      if (n > 0) next[row * COLS + col] = s / n;
    }
    g = next;
  }
  for (let k = 0; k < pass; k++) {
    const next = new Float64Array(g.length);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      let s = g[row * COLS + col]! * 4, n = 4;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = Math.min(ROWS - 1, Math.max(0, row + dr!));
        s += g[r * COLS + ((col + dc! + COLS) % COLS)]!;
        n++;
      }
      next[row * COLS + col] = s / n;
    }
    g = next;
  }
  void known;
  return g;
}

/** How far each direction from `centre` moves a point worn on `from` to sit as it did on `to`. */
export interface HeadShift {
  centre: readonly number[];
  shift: Float64Array;
}

export function headShift(from: HeadSurface, to: HeadSurface, centre: readonly number[]): HeadShift {
  const a = radii(from, centre), b = radii(to, centre);
  const d = Float64Array.from(a, (v, i) => (Number.isNaN(v) || Number.isNaN(b[i]!) ? NaN : Math.max(-MOST, Math.min(MOST, b[i]! - v))));
  return { centre, shift: smoothed(d, 6) };
}

/** Moves every vertex of `lod` along its ray from the centre by the shift there, in place. */
export function shiftLod(lod: SourceLod, s: HeadShift): void {
  const p = lod.positions;
  for (let v = 0; v < p.length / 3; v++) {
    const x = p[v * 3]! - s.centre[0]!, y = p[v * 3 + 1]! - s.centre[1]!, z = p[v * 3 + 2]! - s.centre[2]!;
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) continue;
    const theta = Math.acos(Math.max(-1, Math.min(1, y / r)));
    let phi = Math.atan2(x, z);
    if (phi < 0) phi += Math.PI * 2;
    // Bilinear between the four cells around the direction.
    const fr = Math.min(ROWS - 1, Math.max(0, (theta / Math.PI) * ROWS - 0.5)), fc = (phi / (Math.PI * 2)) * COLS - 0.5;
    const r0 = Math.floor(fr), r1 = Math.min(ROWS - 1, r0 + 1), c0 = Math.floor(fc), tr = fr - r0, tc = fc - c0;
    const at = (row: number, col: number): number => s.shift[row * COLS + ((col % COLS) + COLS) % COLS]!;
    const k = (at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc) * (1 - tr) + (at(r1, c0) * (1 - tc) + at(r1, c0 + 1) * tc) * tr;
    const m = (r + k) / r;
    p[v * 3] = s.centre[0]! + x * m;
    p[v * 3 + 1] = s.centre[1]! + y * m;
    p[v * 3 + 2] = s.centre[2]! + z * m;
  }
}

// A garment made on one body, worn on another: the cloth and hide sets modelled on the Quaternius bodies, worn on
// MakeHuman's. Both bodies rest on the same frozen rig, so each point of the old body has a place on the new one: the
// nearest point of the new skin that faces the same way. A garment vertex moves as its nearest old-body point does, takes
// the new body's weights there, and is then pushed out of the new skin where it is still inside.

/** A surface at rest: three numbers a point and three points a triangle. */
export interface Surface {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** A body's skin at rest with four bones and four weights a point. */
export interface SkinnedSurface extends Surface {
  joints: ArrayLike<number>;
  weights: ArrayLike<number>;
}

/** A surface with each point that shares a place with another made one, and the smooth normal at each. */
export interface Welded {
  positions: Float64Array;
  indices: Uint32Array;
  normals: Float64Array;
  /** For each point of the surface it was made from, its point here. */
  of: Uint32Array;
  /** For each triangle here, the triangle of the surface it was made from. */
  from: Uint32Array;
}

/** Points nearer each other than this are one. */
const WELD = 1e-4;

export function welded(s: Surface): Welded {
  const n = s.positions.length / 3;
  const of = new Uint32Array(n);
  const at = new Map<string, number>();
  const positions: number[] = [];
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(s.positions[v * 3]! / WELD)},${Math.round(s.positions[v * 3 + 1]! / WELD)},${Math.round(s.positions[v * 3 + 2]! / WELD)}`;
    let i = at.get(k);
    if (i === undefined) {
      at.set(k, (i = positions.length / 3));
      positions.push(s.positions[v * 3]!, s.positions[v * 3 + 1]!, s.positions[v * 3 + 2]!);
    }
    of[v] = i;
  }
  const indices: number[] = [];
  const from: number[] = [];
  for (let t = 0; t + 2 < s.indices.length; t += 3) {
    const [a, b, c] = [of[s.indices[t]!]!, of[s.indices[t + 1]!]!, of[s.indices[t + 2]!]!];
    if (a !== b && b !== c && a !== c) {
      indices.push(a, b, c);
      from.push(t / 3);
    }
  }
  const out = { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), normals: new Float64Array(positions.length), of, from: Uint32Array.from(from) };
  smoothNormals(out.positions, out.indices, out.normals);
  return out;
}

/** Area-weighted normals of `indices` over `positions`, written to `out`. */
export function smoothNormals(p: ArrayLike<number>, idx: ArrayLike<number>, out: Float64Array): void {
  out.fill(0);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      out[i] += nx;
      out[i + 1] += ny;
      out[i + 2] += nz;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v]!, out[v + 1]!, out[v + 2]!) || 1;
    out[v]! /= l;
    out[v + 1]! /= l;
    out[v + 2]! /= l;
  }
}

/** The nearest point of a triangle to a point: where it is, its weights on the corners, and the squared distance. */
export interface Nearest {
  triangle: number;
  x: number;
  y: number;
  z: number;
  /** Weights on the triangle's first, second and third corners. */
  u: number;
  v: number;
  w: number;
  d2: number;
}

/** Writes into `out` the nearest point of triangle a, b, c (corner offsets into `p`) to x, y, z. Ericson's region test. */
export function nearestOnTriangle(p: ArrayLike<number>, a: number, b: number, c: number, x: number, y: number, z: number, out: Nearest): void {
  const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
  const abx = p[b]! - ax, aby = p[b + 1]! - ay, abz = p[b + 2]! - az;
  const acx = p[c]! - ax, acy = p[c + 1]! - ay, acz = p[c + 2]! - az;
  const apx = x - ax, apy = y - ay, apz = z - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u = 1, v = 0, w = 0;
  if (d1 <= 0 && d2 <= 0) [u, v, w] = [1, 0, 0];
  else {
    const bpx = x - p[b]!, bpy = y - p[b + 1]!, bpz = z - p[b + 2]!;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = x - p[c]!, cpy = y - p[c + 1]!, cpz = z - p[c + 2]!;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) [u, v, w] = [0, 1, 0];
    else if (d6 >= 0 && d5 <= d6) [u, v, w] = [0, 0, 1];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const t = d1 - d3 > 0 ? d1 / (d1 - d3) : 0;
      [u, v, w] = [1 - t, t, 0];
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const t = d2 - d6 > 0 ? d2 / (d2 - d6) : 0;
      [u, v, w] = [1 - t, 0, t];
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const t = d4 - d3 + (d5 - d6) > 0 ? (d4 - d3) / (d4 - d3 + (d5 - d6)) : 0;
      [u, v, w] = [0, 1 - t, t];
    } else if (!(va + vb + vc > 0)) [u, v, w] = [1, 0, 0];
    else {
      const s = 1 / (va + vb + vc);
      v = vb * s;
      w = vc * s;
      u = 1 - v - w;
    }
  }
  out.u = u;
  out.v = v;
  out.w = w;
  out.x = ax + abx * v + acx * w;
  out.y = ay + aby * v + acy * w;
  out.z = az + abz * v + acz * w;
  out.d2 = (out.x - x) ** 2 + (out.y - y) ** 2 + (out.z - z) ** 2;
}

/** Triangles filed by the cells of a grid their boxes touch, to find the nearest to a point or the first along a ray. */
export class TriangleGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly scratch: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  /** The search each triangle was last looked at in, so a search looks at each once. */
  private readonly stamp: Int32Array;
  private search = 0;
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly cell: number;
  constructor(positions: ArrayLike<number>, indices: ArrayLike<number>, cell = 0.02) {
    this.positions = positions;
    this.indices = indices;
    this.cell = cell;
    this.stamp = new Int32Array(indices.length / 3);
    const p = positions;
    for (let t = 0; t * 3 + 2 < indices.length; t++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = indices[t * 3 + k]! * 3;
        x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!);
        y0 = Math.min(y0, p[i + 1]!); y1 = Math.max(y1, p[i + 1]!);
        z0 = Math.min(z0, p[i + 2]!); z1 = Math.max(z1, p[i + 2]!);
      }
      for (let i = this.at(x0); i <= this.at(x1); i++) for (let j = this.at(y0); j <= this.at(y1); j++) for (let k = this.at(z0); k <= this.at(z1); k++) {
        const key = TriangleGrid.key(i, j, k);
        const list = this.cells.get(key);
        if (list) list.push(t);
        else this.cells.set(key, [t]);
      }
    }
  }
  private at(x: number): number {
    return Math.floor(x / this.cell);
  }
  private static key(i: number, j: number, k: number): number {
    return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  }
  private visitCell(i: number, j: number, k: number, visit: (t: number) => void): void {
    const list = this.cells.get(TriangleGrid.key(i, j, k));
    if (!list) return;
    for (const t of list) if (this.stamp[t] !== this.search) {
      this.stamp[t] = this.search;
      visit(t);
    }
  }
  /** The triangles in the cells within `reach` of x, y, z, each once a call. */
  near(x: number, y: number, z: number, reach: number, visit: (t: number) => void): void {
    this.search++;
    for (let i = this.at(x - reach); i <= this.at(x + reach); i++) for (let j = this.at(y - reach); j <= this.at(y + reach); j++) for (let k = this.at(z - reach); k <= this.at(z + reach); k++) this.visitCell(i, j, k, visit);
  }
  /** The triangles in the cells the segment from x, y, z along unit d for `length` passes through, in order, each once; `visit` returning true stops. */
  along(x: number, y: number, z: number, d: readonly number[], length: number, visit: (t: number) => boolean | void): void {
    this.search++;
    const c = this.cell;
    const p = [x, y, z], cell = [this.at(x), this.at(y), this.at(z)];
    const step = [0, 0, 0], next = [Infinity, Infinity, Infinity], delta = [Infinity, Infinity, Infinity];
    for (let a = 0; a < 3; a++) {
      if (d[a]! > 0) [step[a], next[a], delta[a]] = [1, ((cell[a]! + 1) * c - p[a]!) / d[a]!, c / d[a]!];
      else if (d[a]! < 0) [step[a], next[a], delta[a]] = [-1, (cell[a]! * c - p[a]!) / d[a]!, -c / d[a]!];
    }
    let stop = false;
    const look = (t: number): void => {
      if (!stop && visit(t) === true) stop = true;
    };
    for (let guard = 0; guard < 4096; guard++) {
      this.visitCell(cell[0]!, cell[1]!, cell[2]!, look);
      if (stop) return;
      const a = next[0]! < next[1]! ? (next[0]! < next[2]! ? 0 : 2) : next[1]! < next[2]! ? 1 : 2;
      if (next[a]! > length) return;
      cell[a]! += step[a]!;
      next[a]! += delta[a]!;
    }
  }
  /** The nearest point within `reach` of a triangle `keep` keeps, or false. Searches outward from half a cell. */
  nearest(x: number, y: number, z: number, reach: number, out: Nearest, keep: (t: number) => boolean = () => true): boolean {
    out.d2 = Infinity;
    out.triangle = -1;
    const s = this.scratch, p = this.positions, idx = this.indices;
    const look = (t: number): void => {
      if (!keep(t)) return;
      nearestOnTriangle(p, idx[t * 3]! * 3, idx[t * 3 + 1]! * 3, idx[t * 3 + 2]! * 3, x, y, z, s);
      if (s.d2 < out.d2) {
        out.triangle = t;
        out.x = s.x; out.y = s.y; out.z = s.z;
        out.u = s.u; out.v = s.v; out.w = s.w;
        out.d2 = s.d2;
      }
    };
    for (let r = Math.min(reach, this.cell / 2); ; r = Math.min(reach, r * 2)) {
      // Each widening looks at every triangle again; the box of half-width r holds every point nearer than r.
      this.near(x, y, z, r, look);
      if (out.d2 <= r * r || r >= reach) break;
    }
    return out.triangle >= 0 && out.d2 <= reach * reach;
  }
}

/** How each point of an old body moves to sit on a new one, and the new body's weights there. */
export interface BodyField {
  /** The old body, welded, and its triangles found by place. */
  from: Welded;
  fromGrid: TriangleGrid;
  /** Per point of `from`: how far it moves, three numbers, and its weight on each bone, `bones` numbers. */
  shift: Float64Array;
  weights: Float32Array;
  bones: number;
  /** The new body, welded, its triangles found by place, the slot each of them is in, and its weights, `bones` a point. */
  to: Welded;
  toGrid: TriangleGrid;
  toSlots: Uint8Array;
  toWeights: Float32Array;
}

/** Farthest an old body's point looks for its place on the new one, in metres. */
const FIELD_REACH = 0.08;
/** The least agreement of the old and new skin's facing for a place to count, as a cosine. */
const SAME_WAY = 0.3;
/** Passes of averaging over neighbours that even out the shift, so no step shows where the nearest place jumps. */
const SHIFT_PASSES = 4;

/** `to.slots` gives the slot of each of the new body's triangles. */
export function bodyField(from: Surface, to: SkinnedSurface & { slots: ArrayLike<number> }, bones: number): BodyField {
  const f = welded(from), t = welded(to);
  const fg = new TriangleGrid(f.positions, f.indices), tg = new TriangleGrid(t.positions, t.indices);
  // The new body's weights on its welded points: of points that share a place, the first's.
  const tw = new Float32Array((t.positions.length / 3) * bones);
  const set = new Uint8Array(t.positions.length / 3);
  for (let v = 0; v < to.positions.length / 3; v++) {
    const i = t.of[v]!;
    if (set[i]) continue;
    set[i] = 1;
    for (let k = 0; k < 4; k++) tw[i * bones + to.joints[v * 4 + k]!]! += to.weights[v * 4 + k]!;
  }
  const fn = [0, 0, 0];
  const n = f.positions.length / 3;
  let shift = new Float64Array(n * 3);
  const weights = new Float32Array(n * bones);
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  for (let v = 0; v < n; v++) {
    const [x, y, z] = [f.positions[v * 3]!, f.positions[v * 3 + 1]!, f.positions[v * 3 + 2]!];
    const [nx, ny, nz] = [f.normals[v * 3]!, f.normals[v * 3 + 1]!, f.normals[v * 3 + 2]!];
    const facing = (tri: number): boolean => {
      faceNormal(t.positions, t.indices, tri, fn);
      return fn[0]! * nx + fn[1]! * ny + fn[2]! * nz > SAME_WAY;
    };
    if (!tg.nearest(x, y, z, FIELD_REACH, hit, facing)) tg.nearest(x, y, z, 1, hit);
    shift[v * 3] = hit.x - x;
    shift[v * 3 + 1] = hit.y - y;
    shift[v * 3 + 2] = hit.z - z;
    const corners = [t.indices[hit.triangle * 3]!, t.indices[hit.triangle * 3 + 1]!, t.indices[hit.triangle * 3 + 2]!];
    const share = [hit.u, hit.v, hit.w];
    for (let k = 0; k < 3; k++) for (let b = 0; b < bones; b++) weights[v * bones + b]! += share[k]! * tw[corners[k]! * bones + b]!;
  }
  // Averaging over the old body's neighbours.
  const near: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < f.indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = f.indices[i + k]!, b = f.indices[i + ((k + 1) % 3)]!;
    if (!near[a]!.includes(b)) near[a]!.push(b);
    if (!near[b]!.includes(a)) near[b]!.push(a);
  }
  for (let pass = 0; pass < SHIFT_PASSES; pass++) {
    const next = new Float64Array(shift.length);
    for (let v = 0; v < n; v++) {
      const list = near[v]!;
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (const u of list) s += shift[u * 3 + k]!;
        next[v * 3 + k] = list.length ? 0.5 * shift[v * 3 + k]! + (0.5 * s) / list.length : shift[v * 3 + k]!;
      }
    }
    shift = next;
  }
  const toSlots = Uint8Array.from(t.from, (tri) => to.slots[tri]!);
  return { from: f, fromGrid: fg, shift, weights, bones, to: t, toGrid: tg, toSlots, toWeights: tw };
}

/** The unit normal of triangle `tri`, into `out`. */
function faceNormal(p: ArrayLike<number>, idx: ArrayLike<number>, tri: number, out: number[]): void {
  const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
  const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
  const l = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
  for (let k = 0; k < 3; k++) out[k]! /= l;
}

/** A worn piece at rest as the cook gathers it, every vertex its own: what a refit moves and re-weights. */
export interface RefitPiece {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Each vertex's own bone, and four bones and four weights a vertex. */
  bones: number[];
  joints: number[];
  weights: number[];
  /** Each triangle's skin zone, which gives its slot (shared/anim/skin-zones.ts). */
  zones: number[];
}

export interface RefitReport {
  vertices: number;
  /** The farthest a vertex moved, in metres, and how many the push out of the skin moved. */
  most: number;
  pushed: number;
  /** The deepest a vertex sat inside skin drawn with it before the push, in metres. */
  deepest: number;
}

/** How far out of the new skin a garment vertex left inside it is pushed, in metres. */
export const REFIT_CLEAR = 0.003;
/** Farthest a garment vertex looks for the old body, and for new skin it might be inside, in metres. */
const PIECE_REACH = 0.3;
const INSIDE_REACH = 0.06;
/** Farthest a garment vertex takes its weights from the new skin; past it, from where its old place moved to. */
const WEIGHT_REACH = 0.1;
/**
 * How far a push out of the skin spreads to the piece's other vertices, fading, in metres: a sleeve's lining and its
 * cloth over it go out together, so neither comes through the other.
 */
const PUSH_SPREAD = 0.03;
/** How far inside the old body a vertex lies to be tucked, in metres. */
const TUCKED = 0.002;
/** Rounds of finding what is inside and pushing it out. */
const PUSH_ROUNDS = 4;

/**
 * Moves `piece` from the old body onto the new as `field` says, in place. A vertex on a `rigid` bone stays where it was:
 * a glove's or a boot's own part, which stands in for the hand or foot and on which its grips and soles are calibrated.
 * It stays on that bone too where the new skin nearest it is a hand's or a foot's. A vertex the new skin's weights would
 * put on one is held wholly on it. Skin of
 * the new body pushes the piece out only where it is drawn with it: `shows(pieceSlot, skinSlot)`, and only where the piece
 * lay over the old body. A piece stands in for its own slot's skin, which is not drawn under it, and may be slimmer
 * there; what was tucked inside the old body stays tucked.
 */
export function refitPiece(piece: RefitPiece, field: BodyField, rigid: ReadonlySet<number>, shows: (piece: number, skin: number) => boolean, slotOf: (zone: number) => number, clear = REFIT_CLEAR, tuck = true): RefitReport {
  const p = piece.positions;
  const n = p.length / 3;
  const start = Float64Array.from(p);
  const before = welded({ positions: p, indices: piece.indices });
  const was = Float64Array.from(before.normals);
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  const { from, to, bones } = field;
  const sum = new Float64Array(bones);
  /** Each vertex's weights where its old place moved to, for one with no new skin near it once moved. */
  const found = new Float32Array(n * bones);
  /** 1 for a vertex that was inside the old body: tucked under another piece, as a hood's hem is under a shirt. */
  const tucked = new Uint8Array(n);
  // A glove's or a boot's own part stays as calibrated where the new skin under it is a hand's or a foot's too; over the
  // wrist or the ankle, where the skin bends with the limb, it is weighted as that skin is.
  const held = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    if (!rigid.has(piece.bones[v]!)) continue;
    held[v] = 1;
    if (!field.toGrid.nearest(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!, WEIGHT_REACH, hit)) continue;
    let best = -1, most = 0;
    for (let b = 0; b < bones; b++) {
      let w = 0;
      for (let k = 0; k < 3; k++) w += [hit.u, hit.v, hit.w][k]! * field.toWeights[to.indices[hit.triangle * 3 + k]! * bones + b]!;
      if (w > most) [best, most] = [b, w];
    }
    if (best >= 0 && !rigid.has(best)) held[v] = 0;
  }
  for (let v = 0; v < n; v++) {
    const [x, y, z] = [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
    if (!field.fromGrid.nearest(x, y, z, PIECE_REACH, hit)) continue;
    const corners = [from.indices[hit.triangle * 3]!, from.indices[hit.triangle * 3 + 1]!, from.indices[hit.triangle * 3 + 2]!];
    const share = [hit.u, hit.v, hit.w];
    const nn = [0, 1, 2].map((a) => share.reduce((s, w, k) => s + w * from.normals[corners[k]! * 3 + a]!, 0));
    tucked[v] = tuck && (x - hit.x) * nn[0]! + (y - hit.y) * nn[1]! + (z - hit.z) * nn[2]! < -TUCKED ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      if (!rigid.has(piece.bones[v]!)) for (let a = 0; a < 3; a++) p[v * 3 + a]! += share[k]! * field.shift[corners[k]! * 3 + a]!;
      for (let b = 0; b < bones; b++) found[v * bones + b]! += share[k]! * field.weights[corners[k]! * bones + b]!;
    }
  }
  // A vertex's slot: that of the first triangle it is a corner of.
  const slot = new Int16Array(n).fill(-1);
  for (let t = 0; t < piece.indices.length / 3; t++) for (let k = 0; k < 3; k++) {
    const v = piece.indices[t * 3 + k]!;
    if (slot[v]! < 0) slot[v] = slotOf(piece.zones[t]!);
  }
  // Out of the skin drawn with it where still inside, spread to the vertices round each so layers keep their order.
  let pushed = 0, deepest = 0;
  const need = new Float64Array(n), dir = new Float64Array(n * 3);
  for (let round = 0; round < PUSH_ROUNDS; round++) {
    need.fill(0);
    const inside: number[] = [];
    for (let v = 0; v < n; v++) {
      const [x, y, z] = [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
      if (tucked[v] || !field.toGrid.nearest(x, y, z, INSIDE_REACH, hit, (tri) => shows(slot[v]!, field.toSlots[tri]!))) continue;
      const corners = [to.indices[hit.triangle * 3]!, to.indices[hit.triangle * 3 + 1]!, to.indices[hit.triangle * 3 + 2]!];
      const share = [hit.u, hit.v, hit.w];
      const nn = [0, 1, 2].map((a) => share.reduce((s, w, k) => s + w * to.normals[corners[k]! * 3 + a]!, 0));
      const l = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
      for (let a = 0; a < 3; a++) dir[v * 3 + a] = nn[a]! / l;
      const out = ((x - hit.x) * nn[0]! + (y - hit.y) * nn[1]! + (z - hit.z) * nn[2]!) / l;
      if (out >= clear) continue;
      need[v] = clear - out;
      inside.push(v);
      if (round === 0) {
        pushed++;
        deepest = Math.max(deepest, -out);
      }
    }
    if (inside.length === 0) break;
    const grid = new Map<string, number[]>();
    const cell = (q: number): number => Math.floor(q / PUSH_SPREAD);
    for (const v of inside) {
      const k = `${cell(p[v * 3]!)},${cell(p[v * 3 + 1]!)},${cell(p[v * 3 + 2]!)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
    }
    const move = new Float64Array(n * 3);
    for (let v = 0; v < n; v++) {
      const [x, y, z] = [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
      let most = 0, by = -1;
      for (let i = cell(x) - 1; i <= cell(x) + 1; i++) for (let j = cell(y) - 1; j <= cell(y) + 1; j++) for (let k = cell(z) - 1; k <= cell(z) + 1; k++) {
        for (const u of grid.get(`${i},${j},${k}`) ?? []) {
          const d2 = ((p[u * 3]! - x) ** 2 + (p[u * 3 + 1]! - y) ** 2 + (p[u * 3 + 2]! - z) ** 2) / (PUSH_SPREAD * PUSH_SPREAD);
          if (d2 >= 1) continue;
          const amount = need[u]! * (1 - d2) * (1 - d2);
          if (amount > most) [most, by] = [amount, u];
        }
      }
      if (by < 0) continue;
      // Along the vertex's own way out of the skin where it found one, else its pusher's.
      const own = need[v]! > 0 || dir[v * 3]! !== 0 || dir[v * 3 + 1]! !== 0 || dir[v * 3 + 2]! !== 0 ? v : by;
      for (let a = 0; a < 3; a++) move[v * 3 + a] = dir[own * 3 + a]! * most;
    }
    for (let i = 0; i < p.length; i++) if (!held[Math.floor(i / 3)]) p[i]! += move[i]!;
    dir.fill(0);
  }
  // The weights of the new skin nearest each vertex as it now sits, so the piece turns as the skin under it does.
  for (let v = 0; v < n; v++) {
    if (held[v]) continue;
    sum.fill(0);
    if (field.toGrid.nearest(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!, WEIGHT_REACH, hit)) {
      const corners = [to.indices[hit.triangle * 3]!, to.indices[hit.triangle * 3 + 1]!, to.indices[hit.triangle * 3 + 2]!];
      const share = [hit.u, hit.v, hit.w];
      for (let k = 0; k < 3; k++) for (let b = 0; b < bones; b++) sum[b]! += share[k]! * field.toWeights[corners[k]! * bones + b]!;
    } else for (let b = 0; b < bones; b++) sum[b] = found[v * bones + b]!;
    // The four heaviest, the own bone first; a hand's or a foot's vertex wholly on its own.
    const order = Array.from({ length: bones }, (_, b) => b).filter((b) => sum[b]! > 1e-4).sort((a, b) => sum[b]! - sum[a]!).slice(0, 4);
    if (order.length === 0) continue;
    const own = order[0]!;
    const four = rigid.has(own) ? [own] : order;
    const total = four.reduce((t, b) => t + sum[b]!, 0);
    piece.bones[v] = own;
    for (let k = 0; k < 4; k++) {
      piece.joints[v * 4 + k] = four[k] ?? own;
      piece.weights[v * 4 + k] = k < four.length ? (four.length === 1 ? 1 : sum[four[k]!]! / total) : 0;
    }
  }
  // Each normal turns as the surface round it did.
  const after = new Float64Array(before.normals.length);
  const moved = new Float64Array(before.positions.length);
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) moved[before.of[v]! * 3 + a] = p[v * 3 + a]!;
  smoothNormals(moved, before.indices, after);
  for (let v = 0; v < n; v++) {
    const i = before.of[v]!;
    const q = [0, 1, 2].map((a) => piece.normals[v * 3 + a]! + after[i * 3 + a]! - was[i * 3 + a]!);
    const l = Math.hypot(q[0]!, q[1]!, q[2]!) || 1;
    for (let a = 0; a < 3; a++) piece.normals[v * 3 + a] = q[a]! / l;
  }
  let most = 0;
  for (let v = 0; v < n; v++) most = Math.max(most, Math.hypot(p[v * 3]! - start[v * 3]!, p[v * 3 + 1]! - start[v * 3 + 1]!, p[v * 3 + 2]! - start[v * 3 + 2]!));
  return { vertices: n, most, pushed, deepest };
}

/** How far a point drawn on `field`'s old body moves to sit as it did on the new: the smoothed shift where it is nearest. */
export function shiftAt(field: BodyField, p: readonly number[]): [number, number, number] {
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  if (!field.fromGrid.nearest(p[0]!, p[1]!, p[2]!, PIECE_REACH, hit)) return [0, 0, 0];
  const out: [number, number, number] = [0, 0, 0];
  const share = [hit.u, hit.v, hit.w];
  for (let k = 0; k < 3; k++) {
    const c = field.from.indices[hit.triangle * 3 + k]!;
    for (let a = 0; a < 3; a++) out[a] += share[k]! * field.shift[c * 3 + a]!;
  }
  return out;
}
