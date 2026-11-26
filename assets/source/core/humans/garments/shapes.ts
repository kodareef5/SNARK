// Surfaces a cut starts from where the skin is the wrong shape for it: a shoe is lofted round the foot's slices, so it
// is one box over the toes and not five.

import { HUMAN_BONES } from "../../../../../shared/anim/human.ts";
import { smoothNormals, type Nearest } from "../../../../../tools/pack/refit.ts";
import { Cloth } from "./cloth.ts";
import type { Skin } from "./skin.ts";

/** The convex hull of 2D points, counter-clockwise. */
function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** How far from `c` along angle `a` the polygon `poly` (convex, round `c`) reaches. */
function reachOf(poly: readonly [number, number][], c: readonly [number, number], a: number): number {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - c[0]) * ey - (p[1] - c[1]) * ex) / den;
    const s = ((p[0] - c[0]) * dy - (p[1] - c[1]) * dx) / den;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.max(best, t);
  }
  return best;
}

const SLICES = 30;
const ROUND = 28;

/**
 * A closed loft round the skin of `zones` on one side (`side` 1 for +x) below `top`: slices across the foot from heel to
 * toe, each the convex hull of the skin in it, joined slice to slice and closed at each end. Its points take the
 * weights and zone of the skin nearest them.
 */
export function footLoft(skin: Skin, zones: ReadonlySet<number>, side: 1 | -1, top: number): Cloth {
  const pts: number[][] = [];
  for (let t = 0; t < skin.zones.length; t++) {
    if (!zones.has(skin.zones[t]!)) continue;
    for (let k = 0; k < 3; k++) {
      const v = skin.indices[t * 3 + k]!;
      const p = [skin.positions[v * 3]!, skin.positions[v * 3 + 1]!, skin.positions[v * 3 + 2]!];
      if (p[0]! * side > 0 && p[1]! < top) pts.push(p);
    }
  }
  let z0 = Infinity, z1 = -Infinity;
  for (const p of pts) [z0, z1] = [Math.min(z0, p[2]!), Math.max(z1, p[2]!)];
  const step = (z1 - z0) / SLICES;
  // Each slice's hull, its middle, and its reach round.
  const rings: { z: number; c: [number, number]; r: number[] }[] = [];
  for (let k = 0; k <= SLICES; k++) {
    const z = z0 + step * (k === 0 ? 0.15 : k === SLICES ? SLICES - 0.15 : k);
    const near = pts.filter((p) => Math.abs(p[2]! - z) < step * 0.9).map((p) => [p[0]!, Math.max(0, p[1]!)] as [number, number]);
    const h = hull(near);
    const c: [number, number] = [h.reduce((s, p) => s + p[0], 0) / h.length, h.reduce((s, p) => s + p[1], 0) / h.length];
    rings.push({ z, c, r: Array.from({ length: ROUND }, (_, j) => reachOf(h, c, (j / ROUND) * Math.PI * 2)) });
  }
  // Evened along the foot, so no slice stands out of its neighbours.
  for (let pass = 0; pass < 2; pass++) {
    const was = rings.map((g) => [...g.r]);
    for (let k = 1; k < SLICES; k++) for (let j = 0; j < ROUND; j++) rings[k]!.r[j] = Math.max(was[k]![j]!, (was[k - 1]![j]! + 2 * was[k]![j]! + was[k + 1]![j]!) / 4);
  }
  const c = new Cloth();
  const at: number[] = [];
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  const zoneOf: number[] = [];
  const add = (p: number[]): number => {
    const w = new Float32Array(HUMAN_BONES);
    let zone = -1;
    if (skin.grid.nearest(p[0]!, p[1]!, p[2]!, 0.2, hit, (t) => zones.has(skin.zones[t]!))) {
      zone = skin.zones[hit.triangle]!;
      const share = [hit.u, hit.v, hit.w];
      for (let k = 0; k < 3; k++) {
        const v = skin.indices[hit.triangle * 3 + k]!;
        for (let b = 0; b < HUMAN_BONES; b++) w[b]! += share[k]! * skin.weights[v * HUMAN_BONES + b]!;
      }
    }
    zoneOf.push(zone);
    return c.add(p, [0, 1, 0], w);
  };
  for (const g of rings) for (let j = 0; j < ROUND; j++) {
    const a = (j / ROUND) * Math.PI * 2;
    at.push(add([g.c[0] + Math.cos(a) * g.r[j]!, Math.max(0, g.c[1] + Math.sin(a) * g.r[j]!), g.z]));
  }
  const ends = [rings[0]!, rings[SLICES]!].map((g, e) => add([g.c[0], g.c[1], g.z + (e === 0 ? -1 : 1) * step * 0.3]));
  const tri = (a: number, b: number, d: number): void => {
    c.idx.push(a, b, d);
    const zs = [zoneOf[a]!, zoneOf[b]!, zoneOf[d]!];
    c.zone.push(zs[1] === zs[2] ? zs[1]! : zs[0]!);
  };
  // Round each ring counter-clockwise seen from the toe; wound so the outside is the front.
  for (let k = 0; k < SLICES; k++) for (let j = 0; j < ROUND; j++) {
    const a = at[k * ROUND + j]!, b = at[k * ROUND + ((j + 1) % ROUND)]!, d = at[(k + 1) * ROUND + j]!, e = at[(k + 1) * ROUND + ((j + 1) % ROUND)]!;
    tri(a, d, b);
    tri(b, d, e);
  }
  for (let j = 0; j < ROUND; j++) {
    tri(ends[0]!, at[j]!, at[(j + 1) % ROUND]!);
    tri(ends[1]!, at[SLICES * ROUND + ((j + 1) % ROUND)]!, at[SLICES * ROUND + j]!);
  }
  const n = new Float64Array(c.p.length);
  smoothNormals(c.p, c.idx, n);
  c.n = Array.from(n);
  return c;
}

/** Two clothes as one. */
export function joined(a: Cloth, b: Cloth): Cloth {
  const c = new Cloth();
  c.p = [...a.p, ...b.p];
  c.n = [...a.n, ...b.n];
  c.w = [...a.w, ...b.w];
  c.idx = [...a.idx, ...b.idx.map((i) => i + a.points)];
  c.zone = [...a.zone, ...b.zone];
  return c;
}
