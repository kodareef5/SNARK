// Surfaces a cut starts from where the skin is the wrong shape for it: a shoe is lofted round the foot's slices, so it
// is one box over the toes and not five.

import { HUMAN_BONES } from "../../../../../shared/anim/human.ts";
import { smoothNormals, type Nearest } from "../../../../../tools/pack/refit.ts";
import { Cloth } from "./cloth.ts";
import type { Skin } from "./skin.ts";

/** The convex hull of 2D points, counter-clockwise. */
export function convexHull(points: [number, number][]): [number, number][] {
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
export function hullReach(poly: readonly [number, number][], c: readonly [number, number], a: number): number {
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
    const h = convexHull(near);
    const c: [number, number] = [h.reduce((s, p) => s + p[0], 0) / h.length, h.reduce((s, p) => s + p[1], 0) / h.length];
    rings.push({ z, c, r: Array.from({ length: ROUND }, (_, j) => hullReach(h, c, (j / ROUND) * Math.PI * 2)) });
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
  // Each ring runs counter-clockwise seen from the toe; each triangle is wound so the outside is its front.
  for (let k = 0; k < SLICES; k++) for (let j = 0; j < ROUND; j++) {
    const a = at[k * ROUND + j]!, b = at[k * ROUND + ((j + 1) % ROUND)]!, d = at[(k + 1) * ROUND + j]!, e = at[(k + 1) * ROUND + ((j + 1) % ROUND)]!;
    tri(a, b, d);
    tri(b, e, d);
  }
  for (let j = 0; j < ROUND; j++) {
    tri(ends[0]!, at[(j + 1) % ROUND]!, at[j]!);
    tri(ends[1]!, at[SLICES * ROUND + j]!, at[SLICES * ROUND + ((j + 1) % ROUND)]!);
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

/** The outermost skin along a ray from `o` along unit `d` within `reach`, and the skin's normal there, or null. */
function outermost(skin: Skin, o: readonly number[], d: readonly number[], reach: number, keep: (t: number) => boolean): { p: number[]; n: number[]; zone: number } | null {
  const q = skin.positions, idx = skin.indices;
  let best = -1, tri = -1, bu = 0, bv = 0;
  skin.grid.along(o[0]!, o[1]!, o[2]!, d, reach, (t) => {
    if (!keep(t)) return;
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const e1 = [q[b]! - q[a]!, q[b + 1]! - q[a + 1]!, q[b + 2]! - q[a + 2]!], e2 = [q[c]! - q[a]!, q[c + 1]! - q[a + 1]!, q[c + 2]! - q[a + 2]!];
    const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-14) return;
    const s = [o[0]! - q[a]!, o[1]! - q[a + 1]!, o[2]! - q[a + 2]!];
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) return;
    const r = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * r[0]! + d[1]! * r[1]! + d[2]! * r[2]!) / det;
    if (v < 0 || u + v > 1) return;
    const t1 = (e2[0]! * r[0]! + e2[1]! * r[1]! + e2[2]! * r[2]!) / det;
    if (t1 > best) [best, tri, bu, bv] = [t1, t, u, v];
  });
  if (tri < 0) return null;
  const c = [idx[tri * 3]!, idx[tri * 3 + 1]!, idx[tri * 3 + 2]!], w = [1 - bu - bv, bu, bv];
  const n = [0, 1, 2].map((a) => c.reduce((s, v, k) => s + w[k]! * skin.normals[v * 3 + a]!, 0));
  const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  return { p: [0, 1, 2].map((a) => o[a]! + d[a]! * best), n: n.map((x) => x / l), zone: skin.zones[tri]! };
}

export interface ApronPlan {
  /** Heights of the bib's top, the waist the ties go round, the hem; half widths of the bib, at the waist and at the hem. */
  top: number;
  waist: number;
  hem: number;
  bib: number;
  hips: number;
  skirt: number;
  /** The neck strap's height at the back of the neck, and the line the neck and the trunk are measured round (z). */
  nape: number;
  neckZ: number;
  trunkZ: number;
  /** The zones the neck strap and the ties lie on. */
  neck: (zone: number) => boolean;
  belt: (zone: number) => boolean;
  /** The print sheet's metres and its panels' rectangles: front, back, straps. */
  metres: number;
  front: readonly number[];
  back: readonly number[];
  straps: readonly number[];
}

const THICK = 0.003;
const OFF = 0.007;
const STRAP = 0.024;

/**
 * An apron: a bib and skirt hanging from the chest and belly in front, a thin slab of cloth, with a strap round the back of
 * the neck and ties round the back of the waist. Its points are weighted from the skin nearest them, evened across the
 * skirt so it swings with the hips and both legs and does not tear between them.
 */
export function apron(skin: Skin, plan: ApronPlan, front: (zone: number) => boolean): Cloth {
  // The body's front: the most forward skin in each centimetre cell across and up.
  const cell = 0.01;
  const env = new Map<string, number>();
  for (let t = 0; t < skin.zones.length; t++) {
    if (!front(skin.zones[t]!)) continue;
    for (let k = 0; k < 3; k++) {
      const v = skin.indices[t * 3 + k]!;
      const key = `${Math.round(skin.positions[v * 3]! / cell)},${Math.round(skin.positions[v * 3 + 1]! / cell)}`;
      env.set(key, Math.max(env.get(key) ?? -Infinity, skin.positions[v * 3 + 2]!));
    }
  }
  const envAt = (x: number, y: number): number => {
    let z = -Infinity;
    for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) z = Math.max(z, env.get(`${Math.round(x / cell) + i},${Math.round(y / cell) + j}`) ?? -Infinity);
    return z;
  };
  const NX = 14, NY = 30;
  const half = (y: number): number => (y > plan.waist ? plan.bib + (plan.hips - plan.bib) * ((plan.top - y) / (plan.top - plan.waist)) ** 2 : plan.hips + (plan.skirt - plan.hips) * ((plan.waist - y) / (plan.waist - plan.hem)));
  const ys = Array.from({ length: NY + 1 }, (_, j) => plan.top - ((plan.top - plan.hem) * j) / NY);
  const z = ys.map((y) => Array.from({ length: NX + 1 }, (_, i) => envAt(((i / NX) * 2 - 1) * half(y), y)));
  // Past the body's sides a row takes its nearest forward point.
  for (const row of z) {
    if (row.every((x) => x === -Infinity)) continue;
    for (let pass = 0; pass < NX && row.some((x) => x === -Infinity); pass++) {
      const was = [...row];
      for (let i = 0; i <= NX; i++) if (was[i] === -Infinity) row[i] = Math.max(was[i - 1] ?? -Infinity, was[i + 1] ?? -Infinity);
    }
  }
  for (let j = 0; j <= NY; j++) if (z[j]!.every((x) => x === -Infinity)) z[j] = [...z[j - 1]!];
  // Below the waist it hangs straight down from the farthest forward above.
  for (let j = 1; j <= NY; j++) if (ys[j]! < plan.waist) for (let i = 0; i <= NX; i++) z[j]![i] = Math.max(z[j]![i]!, z[j - 1]![i]! - 0.004);
  for (let pass = 0; pass < 3; pass++) for (let j = 0; j <= NY; j++) {
    const row = [...z[j]!];
    for (let i = 1; i < NX; i++) z[j]![i] = Math.max(row[i]!, (row[i - 1]! + 2 * row[i]! + row[i + 1]!) / 4);
  }
  const c = new Cloth();
  c.uv = [];
  const hit = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  const weightsNear = (p: readonly number[], keep: (zone: number) => boolean): { w: Float32Array; zone: number } => {
    const w = new Float32Array(HUMAN_BONES);
    if (!skin.grid.nearest(p[0]!, p[1]!, p[2]!, 0.3, hit, (t) => keep(skin.zones[t]!))) return { w, zone: 0 };
    const share = [hit.u, hit.v, hit.w];
    for (let k = 0; k < 3; k++) {
      const v = skin.indices[hit.triangle * 3 + k]!;
      for (let b = 0; b < HUMAN_BONES; b++) w[b]! += share[k]! * skin.weights[v * HUMAN_BONES + b]!;
    }
    return { w, zone: skin.zones[hit.triangle]! };
  };
  const zoneOf: number[] = [];
  const add = (p: number[], n: number[], u: number, v: number, keep: (zone: number) => boolean): number => {
    const { w, zone } = weightsNear(p, keep);
    zoneOf.push(zone);
    c.uv!.push(u, v);
    return c.add(p, n, w);
  };
  const tri = (a: number, b: number, d: number): void => {
    c.idx.push(a, b, d);
    c.zone.push(zoneOf[a]!);
  };
  const S = plan.metres;
  // The face and the back of the slab, the back a thickness nearer the body; then its edge.
  const grid: number[][][] = [[], []];
  for (const [s, layer] of [[0, OFF + THICK], [1, OFF]] as const) for (let j = 0; j <= NY; j++) {
    const row: number[] = [];
    for (let i = 0; i <= NX; i++) {
      const y = ys[j]!, x = ((i / NX) * 2 - 1) * half(y);
      const p = [x, y, z[j]![i]! + layer];
      const [u, v] = s === 0 ? [plan.front[0]! + plan.front[2]! / 2 + x / S, plan.front[1]! + (plan.top + 0.02 - y) / S] : [plan.back[0]! + plan.back[2]! / 2 - (x / S) * 0.6, plan.back[1]! + ((plan.top + 0.02 - y) / S) * 0.6];
      row.push(add(p, [0, 0, s === 0 ? 1 : -1], u, v, front));
    }
    grid[s]!.push(row);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const f = grid[0]!, b = grid[1]!;
    tri(f[j]![i]!, f[j + 1]![i]!, f[j]![i + 1]!);
    tri(f[j]![i + 1]!, f[j + 1]![i]!, f[j + 1]![i + 1]!);
    tri(b[j]![i]!, b[j]![i + 1]!, b[j + 1]![i]!);
    tri(b[j]![i + 1]!, b[j + 1]![i + 1]!, b[j + 1]![i]!);
  }
  // The edge, round the slab, joining its face to its back.
  const ring: [number, number][] = [];
  for (let i = 0; i < NX; i++) ring.push([0, i]);
  for (let j = 0; j < NY; j++) ring.push([j, NX]);
  for (let i = NX; i > 0; i--) ring.push([NY, i]);
  for (let j = NY; j > 0; j--) ring.push([j, 0]);
  for (let k = 0; k < ring.length; k++) {
    const [j, i] = ring[k]!, [j2, i2] = ring[(k + 1) % ring.length]!;
    const [a0, a1, b0, b1] = [grid[0]![j]![i]!, grid[1]![j]![i]!, grid[0]![j2]![i2]!, grid[1]![j2]![i2]!];
    tri(a0, b0, a1);
    tri(b0, b1, a1);
  }
  // The skirt's weights evened across and down, so the legs share it.
  const near: number[][] = Array.from({ length: c.points }, () => []);
  for (const s of [0, 1]) for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const v = grid[s]![j]![i]!;
    for (const [dj, di] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const u = grid[s]![j + dj!]?.[i + di!];
      if (u !== undefined) near[v]!.push(u);
    }
    near[v]!.push(grid[1 - s]![j]![i]!);
  }
  for (let pass = 0; pass < 10; pass++) {
    const was = c.w.map((w) => Float32Array.from(w));
    for (let v = 0; v < c.points; v++) {
      if (near[v]!.length === 0 || c.p[v * 3 + 1]! > plan.waist) continue;
      for (let b = 0; b < HUMAN_BONES; b++) c.w[v]![b] = 0.5 * was[v]![b]! + (0.5 * near[v]!.reduce((s, u) => s + was[u]![b]!, 0)) / near[v]!.length;
    }
  }
  // A strap: a band round the back from one point of the bib to the other, laid on the skin and doubled to show both ways.
  const strap = (y: (t: number) => number, from: number, to: number, axisZ: number, along0: number, keep: (zone: number) => boolean): void => {
    const N = 26;
    const rows: number[][] = [];
    let run = 0, last: number[] | null = null;
    for (let k = 0; k <= N; k++) {
      const t = k / N, a = from + (to - from) * t;
      const d = [Math.sin(a), 0, Math.cos(a)];
      const h = outermost(skin, [0, y(t), axisZ], d, 0.4, (tr) => keep(skin.zones[tr]!));
      if (!h) continue;
      const p = h.p.map((x, ax) => x + h.n[ax]! * OFF);
      if (last) run += Math.hypot(p[0]! - last[0]!, p[1]! - last[1]!, p[2]! - last[2]!);
      last = p;
      const tan = [Math.cos(a), 0, -Math.sin(a)];
      const across = [h.n[1]! * tan[2]! - h.n[2]! * tan[1]!, h.n[2]! * tan[0]! - h.n[0]! * tan[2]!, h.n[0]! * tan[1]! - h.n[1]! * tan[0]!];
      const l = Math.hypot(across[0]!, across[1]!, across[2]!) || 1;
      rows.push([-1, 1].map((s) => add(p.map((x, ax) => x + (s * STRAP * across[ax]!) / (2 * l)), h.n, plan.straps[0]! + along0 + (run / S) * 0.5, plan.straps[1]! + (s > 0 ? plan.straps[3]! : 0), keep)));
    }
    for (let k = 0; k + 1 < rows.length; k++) {
      const [a, b] = rows[k]!, [d, e] = rows[k + 1]!;
      tri(a!, d!, b!);
      tri(b!, d!, e!);
      tri(a!, b!, d!);
      tri(b!, e!, d!);
    }
  };
  const corner = Math.atan2(plan.bib, 0.14);
  strap((t) => plan.top + (plan.nape - plan.top) * Math.sin(Math.PI * t), corner, Math.PI * 2 - corner, plan.neckZ, 0, plan.neck);
  strap(() => plan.waist, 1.05, Math.PI * 2 - 1.05, plan.trunkZ, 0.5, plan.belt);
  const n = new Float64Array(c.p.length);
  smoothNormals(c.p, c.idx, n);
  c.n = Array.from(n);
  return c;
}
