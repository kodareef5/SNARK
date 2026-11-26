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
