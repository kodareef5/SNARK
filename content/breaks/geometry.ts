// Flat geometry for cutting a piece: convex polygons in a piece's own plane, counter-clockwise, in metres.

export type Pt = readonly [number, number];
export type Corner = readonly [number, number, number];
/** From and to along the first axis, then along the second. */
export type Rect = readonly [number, number, number, number];

/** Less than this is no area, in square metres: a sliver a cut leaves. */
export const SLIVER = 0.002;
const EPS = 1e-7;

/** Content keeps its numbers on a 1/4096 m grid, as content/ruins.ts does. */
export const grid = (v: number): number => Math.round(v * 4096) / 4096;

/** The length of (x, y), by exact steps alone: the same on every engine, as Math.hypot is not. */
export const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

export function area(poly: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    sum += a[0] * b[1] - a[1] * b[0];
  }
  return sum / 2;
}

export function centre(poly: readonly Pt[]): Pt {
  let x = 0, y = 0, sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const k = a[0] * b[1] - a[1] * b[0];
    x += (a[0] + b[0]) * k;
    y += (a[1] + b[1]) * k;
    sum += k;
  }
  return sum === 0 ? poly[0]! : [x / (3 * sum), y / (3 * sum)];
}

/** A polygon without its repeated points and the points on a straight run, or none if it is a sliver. */
export function tidy(poly: readonly Pt[]): Pt[] {
  const apart: Pt[] = [];
  for (const p of poly) {
    const last = apart[apart.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-5 || Math.abs(last[1] - p[1]) > 1e-5) apart.push(p);
  }
  while (apart.length > 1 && Math.abs(apart[0]![0] - apart[apart.length - 1]![0]) <= 1e-5 && Math.abs(apart[0]![1] - apart[apart.length - 1]![1]) <= 1e-5) apart.pop();
  const out: Pt[] = [];
  for (let i = 0; i < apart.length; i++) {
    const a = apart[(i + apart.length - 1) % apart.length]!, b = apart[i]!, c = apart[(i + 1) % apart.length]!;
    if (Math.abs(cross(a, b, c)) > 1e-6) out.push(b);
  }
  return out.length >= 3 && area(out) > SLIVER ? out : [];
}

/** The part of a convex polygon on the left of the line from `a` to `b`. */
export function clip(poly: readonly Pt[], a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const sp = cross(a, b, p), sq = cross(a, b, q);
    if (sp >= -EPS) out.push(p);
    if ((sp > EPS && sq < -EPS) || (sp < -EPS && sq > EPS)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** What two convex polygons share, or none. */
export function meet(p: readonly Pt[], q: readonly Pt[]): Pt[] {
  let out: Pt[] = [...p];
  for (let i = 0; i < q.length && out.length > 0; i++) out = clip(out, q[i]!, q[(i + 1) % q.length]!);
  return tidy(out);
}

export const rectPoly = ([u0, u1, v0, v1]: Rect): Pt[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

/** The rectangle a polygon is, if it is one square to the axes. */
export function asRect(poly: readonly Pt[]): Rect | null {
  if (poly.length !== 4) return null;
  const us = poly.map((p) => p[0]), vs = poly.map((p) => p[1]);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  for (const [u, v] of poly) if ((Math.abs(u - u0) > 1e-5 && Math.abs(u - u1) > 1e-5) || (Math.abs(v - v0) > 1e-5 && Math.abs(v - v1) > 1e-5)) return null;
  return [u0, u1, v0, v1];
}

/** What two rectangles share, or null. */
export function rectMeet(a: Rect, b: Rect): Rect | null {
  const u0 = Math.max(a[0], b[0]), u1 = Math.min(a[1], b[1]), v0 = Math.max(a[2], b[2]), v1 = Math.min(a[3], b[3]);
  return u1 - u0 > 1e-5 && v1 - v0 > 1e-5 ? [u0, u1, v0, v1] : null;
}

/** A rectangle less another: up to four rectangles, the sides full height and the rest between them. */
export function rectLess(a: Rect, cut: Rect): Rect[] {
  const m = rectMeet(a, cut);
  if (!m) return [a];
  const out: Rect[] = [];
  if (m[0] - a[0] > 1e-5) out.push([a[0], m[0], a[2], a[3]]);
  if (a[1] - m[1] > 1e-5) out.push([m[1], a[1], a[2], a[3]]);
  if (m[2] - a[2] > 1e-5) out.push([m[0], m[1], a[2], m[2]]);
  if (a[3] - m[3] > 1e-5) out.push([m[0], m[1], m[3], a[3]]);
  return out;
}

/** A convex polygon as polygons of `most` points at most, cut along its own diagonals. */
export function atMost(poly: readonly Pt[], most: number): Pt[][] {
  if (poly.length <= most) return [[...poly]];
  const half = Math.floor(poly.length / 2);
  return [...atMost(poly.slice(0, half + 1), most), ...atMost([poly[0]!, ...poly.slice(half)], most)];
}

/** How far along the ray from `c` toward `d` (a unit vector) it leaves a polygon that `c` is in or on, or 0. */
export function leaves(poly: readonly Pt[], c: Pt, d: Pt): number {
  let far = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den;
    const s = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den;
    if (t > far && s >= -1e-6 && s <= 1 + 1e-6) far = t;
  }
  return far;
}

/**
 * The corners of a rectangle passed going round it counter-clockwise from a point on its edge to another: none if both
 * are on one side with the second ahead.
 */
export function cornersBetween(r: Rect, from: Pt, to: Pt): Pt[] {
  const [u0, u1, v0, v1] = r;
  const w = u1 - u0, h = v1 - v0, round = 2 * (w + h);
  const along = ([u, v]: Pt): number => {
    if (Math.abs(v - v0) < 1e-5) return u - u0;
    if (Math.abs(u - u1) < 1e-5) return w + (v - v0);
    if (Math.abs(v - v1) < 1e-5) return w + h + (u1 - u);
    return 2 * w + h + (v1 - v);
  };
  const a = along(from);
  let b = along(to);
  if (b < a - 1e-6) b += round;
  const corners: [number, Pt][] = [[0, [u0, v0]], [w, [u1, v0]], [w + h, [u1, v1]], [2 * w + h, [u0, v1]]];
  const out: Pt[] = [];
  for (const lap of [0, round]) for (const [at, p] of corners) if (at + lap > a + 1e-6 && at + lap < b - 1e-6) out.push(p);
  return out;
}

/** The corners of the solid a polygon is through a thickness, as a convex part's: `to` puts a point of the plane in the piece. */
export const prism = (poly: readonly Pt[], w0: number, w1: number, to: (u: number, v: number, w: number) => Corner): Corner[] =>
  [w0, w1].flatMap((w) => poly.map(([u, v]) => to(u, v, w).map(grid) as unknown as Corner));
