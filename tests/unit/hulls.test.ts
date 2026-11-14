// Convex parts: a ramp wedge, a triangle on 60 degree axes and a sloped roof slab, defined in tests/fixtures/hulls.ts. Their
// queries against an independent closest-point and ray-triangle reference, and the frames that close a ring of six triangles.

import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { capsuleHull, hullFace, hullPush, rayHull, type HullTable } from "../../shared/world/convex.ts";
import { HALF_SIDE, frameAxes, sixtyOf } from "../../shared/world/frame.ts";
import { hullRegistry } from "../fixtures/hulls.ts";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V, b: V, k: number): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** A part's corners from the piece's origin, by the frame's whole-number vectors, as the game is meant to place them. */
function corners(t: HullTable, p: number, yaw: number): V[] {
  const axes = new Int32Array(4);
  frameAxes(yaw, axes);
  if (t.sixty[p] === 1) sixtyOf(axes[0]!, axes[1]!, axes, 2);
  const out: V[] = [];
  for (let c = t.corner[p]!; c < t.corner[p + 1]!; c++) {
    const [a, y, b] = [t.at[c * 3]!, t.at[c * 3 + 1]!, t.at[c * 3 + 2]!];
    out.push([(a * axes[0]! + b * axes[2]!) / HALF_SIDE, y, (a * axes[1]! + b * axes[3]!) / HALF_SIDE]);
  }
  return out;
}

/** The hull's surface as triangles, each face's corners fanned from one of them, and its outward planes. */
function surface(pts: V[]): { tris: [V, V, V][]; planes: [V, number][] } {
  const tris: [V, V, V][] = [];
  const planes: [V, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        let nrm = cross(sub(pts[j]!, pts[i]!), sub(pts[k]!, pts[i]!));
        const l = Math.hypot(...nrm);
        if (l < 1e-9) continue;
        nrm = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
        let d = dot(nrm, pts[i]!);
        const s = pts.map((q) => dot(nrm, q) - d);
        if (s.some((v) => v > 1e-7) && s.some((v) => v < -1e-7)) continue;
        if (s.some((v) => v > 1e-7)) {
          nrm = [-nrm[0], -nrm[1], -nrm[2]];
          d = -d;
        }
        if (planes.some(([m, e]) => Math.abs(dot(m, nrm) - 1) < 1e-9 && Math.abs(e - d) < 1e-7)) continue;
        planes.push([nrm, d]);
        const on = pts.filter((q) => Math.abs(dot(nrm, q) - d) < 1e-7);
        const mid = on.reduce((m, q) => add(m, q, 1 / on.length), [0, 0, 0] as V);
        const u = sub(on[0]!, mid);
        const w = cross(nrm, u);
        on.sort((a, b) => Math.atan2(dot(sub(a, mid), w), dot(sub(a, mid), u)) - Math.atan2(dot(sub(b, mid), w), dot(sub(b, mid), u)));
        for (let f = 1; f + 1 < on.length; f++) tris.push([on[0]!, on[f]!, on[f + 1]!]);
      }
    }
  }
  return { tris, planes };
}

/** The nearest point of triangle abc to p, after Ericson. */
function nearestOnTriangle(p: V, a: V, b: V, c: V): V {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = 1 / (va + vb + vc);
  return add(add(a, ab, vb * denom), ac, vc * denom);
}

/** Least distance from the upright segment (x, y0..y1, z) to the solid, 0 if they meet. The distance along the segment is convex. */
function distance(pts: V[], x: number, y0: number, y1: number, z: number): number {
  const { tris, planes } = surface(pts);
  const at = (y: number): number => {
    const p: V = [x, y, z];
    if (planes.every(([m, d]) => dot(m, p) <= d + 1e-12)) return 0;
    let best = Infinity;
    for (const [a, b, c] of tris) best = Math.min(best, Math.hypot(...sub(p, nearestOnTriangle(p, a, b, c))));
    return best;
  };
  let lo = y0;
  let hi = y1;
  for (let k = 0; k < 200 && hi - lo > 1e-13; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (at(m1) <= at(m2)) hi = m2;
    else lo = m1;
  }
  return Math.min(at(y0), at(y1), at((lo + hi) / 2));
}

/** Where the ray first meets the solid's surface, 0 if it starts inside, by testing every triangle. */
function rayReference(pts: V[], o: V, d: V): number {
  const { tris, planes } = surface(pts);
  if (planes.every(([m, e]) => dot(m, o) < e)) return 0;
  let best = Infinity;
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-14) continue;
    const s = sub(o, a);
    const u = dot(s, p) / det;
    const q = cross(s, e1);
    const v = dot(d, q) / det;
    const t = dot(e2, q) / det;
    if (u < -1e-12 || v < -1e-12 || u + v > 1 + 1e-12 || t < 0) continue;
    best = Math.min(best, t);
  }
  return best;
}

test("a part is the hull of its corners: a wedge and a triangle have five faces and nine edges, a slab six and twelve", () => {
  const parts = hullRegistry().parts.hulls!;
  const count = (p: number): number[] => [parts.corner[p + 1]! - parts.corner[p]!, parts.face[p + 1]! - parts.face[p]!, parts.edge[p + 1]! - parts.edge[p]!];
  // Kinds are in the order of their ids: the ramp, the roof, the triangle.
  expect([0, 1, 2].map(count)).toEqual([
    [6, 5, 9],
    [8, 6, 12],
    [6, 5, 9],
  ]);
});

test("six triangles on 60 degree frames close a ring exactly at every facing, by whole numbers of the frame's vectors", () => {
  const axes = new Int32Array(4);
  const open: number[] = [];
  for (let yaw = 0; yaw < 65536; yaw += 3) {
    frameAxes(yaw, axes);
    const u = [axes[0]!, axes[1]!];
    sixtyOf(u[0]!, u[1]!, axes, 2);
    const w = [axes[2]!, axes[3]!];
    // The 60 degree vector of the frame turned half round is the first one's, reversed.
    frameAxes((yaw + 32768) & 0xffff, axes);
    sixtyOf(axes[0]!, axes[1]!, axes, 2);
    if (axes[2] !== -w[0]! || axes[3] !== -w[1]!) open.push(yaw);
    // Round the centre: U, W, W - U, -U, -W, U - W. Each triangle is two of them, and the last ends where the first began.
    const ring = [u, w, [w[0]! - u[0]!, w[1]! - u[1]!], [-u[0]!, -u[1]!], [-w[0]!, -w[1]!], [u[0]! - w[0]!, u[1]! - w[1]!]];
    // Every side of every triangle is as long as the others, to within a lattice unit or so.
    for (let k = 0; k < 6; k++) {
      const a = ring[k]!;
      const b = ring[(k + 1) % 6]!;
      const sides = [Math.hypot(a[0]!, a[1]!), Math.hypot(b[0]!, b[1]!), Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)];
      if (Math.max(...sides) - Math.min(...sides) > 1.5) open.push(yaw);
    }
  }
  expect(open).toEqual([]);
});

test("a capsule meets a part where an independent closest-point search says, as deep, at any turn", () => {
  const parts = hullRegistry().parts.hulls!;
  const rng = new Rng(17);
  const wrong: string[] = [];
  let overlaps = 0;
  let shallow = 0;
  for (let n = 0; n < 900; n++) {
    const p = n % 3;
    const yaw = rng.int(65536);
    const pts = corners(parts, p, yaw);
    const r = [0.4, 0.6, 1.1][rng.int(3)]!;
    const x = rng.range(-3.5, 3.5);
    const z = rng.range(-3.5, 3.5);
    const y0 = rng.range(-2.5, 2.5);
    const y1 = y0 + rng.range(0, 1.4);
    const d = distance(pts, x, y0, y1, z);
    const hit = capsuleHull(parts, p, yaw, x, z, y0, y1, r, r);
    if (d === 0) {
      if (!hit || hullPush.depth < r - 1e-9) wrong.push(`part ${p} yaw ${yaw}: through it, but ${hit ? `depth ${hullPush.depth}` : "free"}`);
      else overlaps++;
      continue;
    }
    // Within a nanometre of touching, either answer is right.
    if (Math.abs(d - r) < 1e-9) continue;
    if (hit !== d < r) wrong.push(`part ${p} yaw ${yaw}: ${d} away, radius ${r}, ${hit ? "met" : "missed"}`);
    else if (hit) {
      shallow++;
      if (Math.abs(hullPush.depth - (r - d)) > 1e-9) wrong.push(`part ${p} yaw ${yaw}: ${r - d} deep, pushed ${hullPush.depth}`);
      // The push leaves it just touching.
      const after = distance(pts, x + hullPush.x, y0 + hullPush.y, y1 + hullPush.y, z + hullPush.z);
      if (Math.abs(after - r) > 1e-7) wrong.push(`part ${p} yaw ${yaw}: pushed out to ${after}, not ${r}`);
    }
  }
  expect(wrong).toEqual([]);
  expect(overlaps).toBeGreaterThan(20);
  expect(shallow).toBeGreaterThan(100);
});

test("a ray meets a part where it first crosses one of its faces, and reports that face", () => {
  const parts = hullRegistry().parts.hulls!;
  const rng = new Rng(23);
  const wrong: string[] = [];
  let hits = 0;
  for (let n = 0; n < 3000; n++) {
    const p = n % 3;
    const yaw = rng.int(65536);
    const pts = corners(parts, p, yaw);
    const o: V = [rng.range(-6, 6), rng.range(-4, 4), rng.range(-6, 6)];
    // Half aimed at a point inside the part's box, half anywhere.
    let d: V = n % 2 === 0 ? sub([rng.range(-1.4, 1.4), rng.range(-1.4, 1.4), rng.range(-1.4, 1.4)], o) : [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
    d = add([0, 0, 0], d, 1 / Math.hypot(...d));
    const want = rayReference(pts, o, d);
    const t = rayHull(parts, p, yaw, o[0], o[1], o[2], d[0], d[1], d[2], 0);
    if (want === Infinity ? t !== Infinity : !(Math.abs(t - want) < 1e-9)) wrong.push(`part ${p} yaw ${yaw}: met at ${t}, the faces say ${want}`);
    else if (want > 0 && want !== Infinity) {
      hits++;
      // The face it entered by faces back along the ray, and the point met is on its plane.
      const at = add(o, d, t);
      const n2 = [hullFace.nx, hullFace.ny, hullFace.nz] as V;
      const { planes } = surface(pts);
      if (!(dot(n2, d) < 0) || !planes.some(([m, e]) => Math.abs(dot(m, n2) - 1) < 1e-9 && Math.abs(dot(m, at) - e) < 1e-9)) wrong.push(`part ${p} yaw ${yaw}: reports a face it did not enter by`);
    }
  }
  expect(wrong).toEqual([]);
  expect(hits).toBeGreaterThan(800);
});
