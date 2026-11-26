// A head as hair sees it: how far its skin lies from a point inside it, along every direction of a grid of rays. Hair
// is built on that surface and kept off it, and the same field keeps hanging hair off the neck, shoulders and back.

import { B_CHEST, B_HEAD, B_NECK, B_SHOULDER_L, B_SHOULDER_R, B_UPPER_CHEST } from "../../../../../shared/anim/human.ts";
import type { FittedBody } from "../../../../../tools/makehuman/fit.ts";

export type Vec = [number, number, number];

/** Rays a grid row and column: down from straight up by row, round from the front (+Z) towards the left (+X) by column. */
export const ROWS = 90;
export const COLS = 180;
/** Where the rays start: this far above and in front of the head's joint, about the middle of the skull. */
export const CENTRE: Vec = [0, 0.09, 0.02];
/** The bones whose skin hair may rest on: never an arm's. */
const RESTS_ON = new Set([B_HEAD, B_NECK, B_UPPER_CHEST, B_CHEST, B_SHOULDER_L, B_SHOULDER_R]);

export const deg = (d: number): number => (d * Math.PI) / 180;

export interface Head {
  sex: number;
  centre: Vec;
  /** The fitted body's joint rests, three a bone. */
  rest: Float32Array;
  /** Metres to the outermost skin along each ray, filled where a ray met none, evened once. */
  skin: Float64Array;
  /** The skin widened to its neighbours' and evened: a point kept this far out clears the skin between rays too. */
  clear: Float64Array;
  /** How far the skin stands out of a much smoother head, metres: an ear, a nose, a chin. */
  bump: Float64Array;
}

/** The unit direction of polar angle `theta` from straight up and `phi` round from the front. */
export function direction(theta: number, phi: number, out: Vec = [0, 0, 0]): Vec {
  out[0] = Math.sin(theta) * Math.sin(phi);
  out[1] = Math.cos(theta);
  out[2] = Math.sin(theta) * Math.cos(phi);
  return out;
}

/** The polar angle and the angle round of `p` from `centre`, and its distance. */
export function anglesOf(centre: Vec, p: Vec): [theta: number, phi: number, r: number] {
  const x = p[0] - centre[0], y = p[1] - centre[1], z = p[2] - centre[2];
  const r = Math.hypot(x, y, z);
  return [Math.acos(Math.max(-1, Math.min(1, y / (r || 1)))), Math.atan2(x, z), r];
}

/** A grid's value between its rays, bilinear. */
export function sample(grid: Float64Array, theta: number, phi: number): number {
  const fr = Math.min(ROWS - 1, Math.max(0, (theta / Math.PI) * ROWS - 0.5));
  let fc = ((phi / (Math.PI * 2)) * COLS - 0.5) % COLS;
  if (fc < 0) fc += COLS;
  const r0 = Math.floor(fr), r1 = Math.min(ROWS - 1, r0 + 1), c0 = Math.floor(fc), tr = fr - r0, tc = fc - c0;
  const at = (row: number, col: number): number => grid[row * COLS + (col % COLS)]!;
  return (at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc) * (1 - tr) + (at(r1, c0) * (1 - tc) + at(r1, c0 + 1) * tc) * tr;
}

/** The outermost hit of each grid ray from `c` with the triangles given, NaN where none: each triangle is tried only by the rays near it. */
function radii(positions: ArrayLike<number>, triangles: readonly number[], c: Vec): Float64Array {
  const out = new Float64Array(ROWS * COLS).fill(NaN);
  const cells: number[][] = Array.from({ length: ROWS * COLS }, () => []);
  const p = positions;
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [0, 1, 2].map((k) => anglesOf(c, [p[triangles[t + k]! * 3]!, p[triangles[t + k]! * 3 + 1]!, p[triangles[t + k]! * 3 + 2]!]));
    const rowOf = (th: number): number => (th / Math.PI) * ROWS - 0.5;
    const r0 = Math.max(0, Math.floor(Math.min(...corners.map((q) => rowOf(q[0])))) - 1);
    const r1 = Math.min(ROWS - 1, Math.ceil(Math.max(...corners.map((q) => rowOf(q[0])))) + 1);
    let c0 = 0, c1 = COLS - 1;
    if (Math.min(...corners.map((q) => q[0])) > deg(8) && Math.max(...corners.map((q) => q[0])) < deg(172)) {
      // Round angles unwrapped about the first corner's, so a triangle across the back is one span.
      const phis = corners.map((q) => q[1] - Math.round((q[1] - corners[0]![1]) / (Math.PI * 2)) * Math.PI * 2);
      c0 = Math.floor((Math.min(...phis) / (Math.PI * 2)) * COLS - 0.5) - 1;
      c1 = Math.ceil((Math.max(...phis) / (Math.PI * 2)) * COLS - 0.5) + 1;
    }
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) cells[r * COLS + (((col % COLS) + COLS) % COLS)]!.push(t);
  }
  const d: Vec = [0, 0, 0];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    direction(((row + 0.5) / ROWS) * Math.PI, ((col + 0.5) / COLS) * Math.PI * 2, d);
    let far = NaN;
    for (const t of cells[row * COLS + col]!) {
      const a = triangles[t]! * 3, b = triangles[t + 1]! * 3, e = triangles[t + 2]! * 3;
      const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
      const e2x = p[e]! - p[a]!, e2y = p[e + 1]! - p[a + 1]!, e2z = p[e + 2]! - p[a + 2]!;
      const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const sx = c[0] - p[a]!, sy = c[1] - p[a + 1]!, sz = c[2] - p[a + 2]!;
      const u = (sx * hx + sy * hy + sz * hz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const hit = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (hit > 0 && !(hit <= far)) far = hit;
    }
    out[row * COLS + col] = far;
  }
  return out;
}

/** Fills the rays that met nothing from their neighbours. */
function filled(grid: Float64Array): Float64Array {
  let g = Float64Array.from(grid);
  for (let k = 0; k < 400 && g.some((v) => Number.isNaN(v)); k++) {
    const next = Float64Array.from(g);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (!Number.isNaN(g[row * COLS + col]!)) continue;
      let s = 0, n = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const r = row + dr;
        if (r < 0 || r >= ROWS) continue;
        const v = g[r * COLS + ((col + dc + COLS) % COLS)]!;
        if (!Number.isNaN(v)) [s, n] = [s + v, n + 1];
      }
      if (n > 0) next[row * COLS + col] = s / n;
    }
    g = next;
  }
  return g;
}

/** Each ray's value and its eight neighbours' combined by `pick`, `passes` times. */
function around(grid: Float64Array, passes: number, pick: (values: number[]) => number): Float64Array {
  let g = grid;
  const values: number[] = [];
  for (let k = 0; k < passes; k++) {
    const next = new Float64Array(g.length);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      values.length = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) values.push(g[Math.min(ROWS - 1, Math.max(0, row + dr)) * COLS + ((col + dc + COLS) % COLS)]!);
      next[row * COLS + col] = pick(values);
    }
    g = next;
  }
  return g;
}

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const most = (v: number[]): number => Math.max(...v);

/** The head of a fitted body, measured from about the middle of its skull. */
export function headOf(f: FittedBody, sex: number): Head {
  const rest = f.rest;
  const centre: Vec = [0, 1, 2].map((a) => rest[B_HEAD * 3 + a]! + CENTRE[a]!) as Vec;
  const triangles: number[] = [];
  for (let t = 0; t < f.indices.length / 3; t++) {
    if (f.part[t] !== 0) continue;
    const c = [f.indices[t * 3]!, f.indices[t * 3 + 1]!, f.indices[t * 3 + 2]!];
    if (c.every((v) => RESTS_ON.has(f.bone[v]!))) triangles.push(...c);
  }
  const raw = filled(radii(f.positions, triangles, centre));
  const skin = around(raw, 1, mean);
  const clear = around(around(raw, 2, most), 2, mean);
  const smooth = around(raw, 12, mean);
  const bump = Float64Array.from(raw, (v, i) => v - smooth[i]!);
  return { sex, centre, rest, skin, clear, bump };
}

/** The point `lift` metres out from the skin (or the clear surface) along the ray of `theta` and `phi`. */
export function onHead(head: Head, theta: number, phi: number, lift: number, out: Vec = [0, 0, 0], grid: Float64Array = head.clear): Vec {
  const r = sample(grid, theta, phi) + lift;
  direction(theta, phi, out);
  for (let a = 0; a < 3; a++) out[a] = head.centre[a]! + out[a]! * r;
  return out;
}

/** Pushes `p` out along its ray from the centre until it is at least `gap` metres outside the clear surface. */
export function keepOut(head: Head, p: Vec, gap: number): void {
  const [theta, phi, r] = anglesOf(head.centre, p);
  const want = sample(head.clear, theta, phi) + gap;
  if (r >= want || r < 1e-6) return;
  for (let a = 0; a < 3; a++) p[a] = head.centre[a]! + ((p[a]! - head.centre[a]!) * want) / r;
}
