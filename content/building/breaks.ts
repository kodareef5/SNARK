// What a built piece breaks into: 6 to 10 convex chunks cut from its form, along lines that suit its tier. Wood comes
// apart along its boards, stone along its courses with the joints staggered, thatch in upright bundles and metal in
// plates. The client throws them (client/core/fragments.ts) and the pack tool gives each a textured mesh
// (tools/pack/pieces/breaks.ts); both cut the same row the same way, so a set's groups are the mesh's bones.

import { area, centre, clip, meet, tidy, type Pt } from "../breaks/geometry.ts";
import { outlineBox, type FormDef } from "../../shared/world/lattice/forms.ts";

export type Corner = [number, number, number];
/** One group of a piece's break: its convex chunks, each its corners in the collider's frame, a triangle's in metres. */
export type PieceGroup = Corner[][];

/** How a tier comes apart: a chunk's size along the outline's first and second axes and up a tall piece, and which rows are staggered. */
export interface Grain {
  readonly run: number;
  readonly rise: number;
  readonly tall: number;
  readonly stagger: "rows" | "columns" | "none";
}

export const GRAINS: Readonly<Record<string, Grain>> = {
  wood: { run: 1.5, rise: 0.75, tall: 0.75, stagger: "rows" },
  stone: { run: 1.5, rise: 0.75, tall: 0.75, stagger: "rows" },
  thatch: { run: 0.75, rise: 1.5, tall: 1.5, stagger: "columns" },
  metal: { run: 1.5, rise: 1, tall: 1, stagger: "none" },
};
/** The fewest and most groups a piece breaks into. */
export const LEAST_GROUPS = 6, MOST_PIECE_GROUPS = 10;
/** A chunk under this share of the piece's mean is joined to its nearest neighbour. */
const CRUMB = 0.15;
/** A piece thicker than this is cut through its thickness too, where nothing slopes. */
const THICK = 1.2;

/** A chunk while it is cut: its outline in the form's plane, and from where to where it runs through it. */
interface Cell {
  poly: Pt[];
  w0: number;
  w1: number;
  /** The part of a sloped outline it lies in. */
  slope?: Slope;
}

const ccw = (poly: readonly Pt[]): Pt[] => (area(poly) < 0 ? [...poly].reverse() : [...poly]);
/** The part of a convex polygon where coordinate `axis` is under `at` (`below`), or over it. */
const side = (poly: readonly Pt[], axis: 0 | 1, at: number, below: boolean): Pt[] => {
  const a: Pt = axis === 0 ? [at, 0] : [0, at], b: Pt = axis === 0 ? [at, 1] : [1, at];
  // clip keeps the left of a to b: for axis 0 that is u < at, for axis 1 v > at.
  return tidy(axis === 0 ? (below ? clip(poly, a, b) : clip(poly, b, a)) : below ? clip(poly, b, a) : clip(poly, a, b));
};

/** A convex polygon less a rectangle: what lies beside it, then under and over it. */
function less(poly: Pt[], r: { x0: number; x1: number; y0: number; y1: number }): Pt[][] {
  const out = [side(poly, 0, r.x0, true), side(poly, 0, r.x1, false)];
  const within = side(side(poly, 0, r.x0, false), 0, r.x1, true);
  if (within.length > 0) out.push(side(within, 1, r.y0, true), side(within, 1, r.y1, false));
  return out.filter((p) => p.length > 0);
}

/** Where a sloped form's top is over its level at (u, v): the plane of the part of its outline that holds the point. */
interface Slope {
  poly: Pt[];
  a: number;
  b: number;
  c: number;
}

function slopesOf(f: FormDef): Slope[] {
  const o = f.outline, top = f.corner!;
  const plane = (ks: readonly number[]): Slope => {
    const [p, q, r] = ks.map((k) => [o[k]![0], o[k]![1], top[k]!] as const) as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
    // h = a u + b v + c through the three corners.
    const du1 = q[0] - p[0], dv1 = q[1] - p[1], dh1 = q[2] - p[2], du2 = r[0] - p[0], dv2 = r[1] - p[1], dh2 = r[2] - p[2];
    const det = du1 * dv2 - du2 * dv1;
    const a = (dh1 * dv2 - dh2 * dv1) / det, b = (du1 * dh2 - du2 * dh1) / det;
    return { poly: ccw(ks.map((k) => o[k]!)), a, b, c: p[2] - a * p[0] - b * p[1] };
  };
  // Four corners with one apart from the other three fold on the diagonal through it, as the collider does.
  const odd = o.length === 4 ? top.findIndex((h, k) => top.filter((x) => Math.abs(x - h) < 1e-9).length === 1 && top.filter((x) => Math.abs(x - top[(k + 1) % 4]!) < 1e-9).length === 3) : -1;
  if (odd < 0) return [{ ...plane([0, 1, 2]), poly: ccw([...o]) }];
  return [plane([odd, (odd + 1) % 4, (odd + 2) % 4]), plane([odd, (odd + 2) % 4, (odd + 3) % 4])];
}

/** The cells of a rectangle `b` cut `nu` by `nv`, every other row or column moved half a cell where the grain staggers. */
function grid(b: readonly [number, number, number, number], nu: number, nv: number, stagger: Grain["stagger"]): Pt[][] {
  const [u0, v0, u1, v1] = b;
  const du = (u1 - u0) / nu, dv = (v1 - v0) / nv, out: Pt[][] = [];
  const cuts = (lo: number, step: number, n: number, moved: boolean): number[] => {
    const at = [lo];
    for (let k = 1; k < n + (moved ? 1 : 0); k++) at.push(lo + (k - (moved ? 0.5 : 0)) * step);
    at.push(lo + n * step);
    return at;
  };
  if (stagger === "columns") {
    const us = cuts(u0, du, nu, false);
    for (let i = 0; i + 1 < us.length; i++) {
      const vs = cuts(v0, dv, nv, nv > 1 && i % 2 === 1);
      for (let j = 0; j + 1 < vs.length; j++) out.push([[us[i]!, vs[j]!], [us[i + 1]!, vs[j]!], [us[i + 1]!, vs[j + 1]!], [us[i]!, vs[j + 1]!]]);
    }
    return out;
  }
  const vs = cuts(v0, dv, nv, false);
  for (let j = 0; j + 1 < vs.length; j++) {
    const us = cuts(u0, du, nu, stagger === "rows" && nu > 1 && j % 2 === 1);
    for (let i = 0; i + 1 < us.length; i++) out.push([[us[i]!, vs[j]!], [us[i + 1]!, vs[j]!], [us[i + 1]!, vs[j + 1]!], [us[i]!, vs[j + 1]!]]);
  }
  return out;
}

/** A cell's size, as a box's volume. */
const bulk = (c: Cell): number => area(c.poly) * (c.w1 - c.w0);

/** Cuts a cell in two across its longest extent: its outline's widest way, or through its thickness. */
function halve(c: Cell, through: boolean): [Cell, Cell] {
  const us = c.poly.map((p) => p[0]), vs = c.poly.map((p) => p[1]);
  const du = Math.max(...us) - Math.min(...us), dv = Math.max(...vs) - Math.min(...vs);
  if (through && c.w1 - c.w0 > Math.max(du, dv)) {
    const mid = (c.w0 + c.w1) / 2;
    return [{ ...c, w1: mid }, { ...c, w0: mid }];
  }
  const axis = du >= dv ? 0 : 1, at = axis === 0 ? (Math.max(...us) + Math.min(...us)) / 2 : (Math.max(...vs) + Math.min(...vs)) / 2;
  return [{ ...c, poly: side(c.poly, axis, at, true) }, { ...c, poly: side(c.poly, axis, at, false) }];
}

/**
 * The groups of `cells`: crumbs joined to their nearest; then while there are too few, the largest group of one cell
 * cut in two, through its thickness only where `through`; then the smallest joined until there are few enough.
 */
function grouped(cells: Cell[], through: boolean): Cell[][] {
  const groups = cells.map((c) => [c]);
  const size = (g: Cell[]): number => g.reduce((s, c) => s + bulk(c), 0);
  const middle = (g: Cell[]): Pt => {
    let u = 0, v = 0, s = 0;
    for (const c of g) {
      const m = centre(c.poly), k = bulk(c);
      u += m[0] * k;
      v += m[1] * k;
      s += k;
    }
    return s > 0 ? [u / s, v / s] : centre(g[0]!.poly);
  };
  const join = (small: number): void => {
    const m = middle(groups[small]!);
    let near = -1, nearest = Infinity;
    groups.forEach((g, i) => {
      if (i === small) return;
      const o = middle(g), d = (o[0] - m[0]) ** 2 + (o[1] - m[1]) ** 2;
      if (d < nearest) [near, nearest] = [i, d];
    });
    groups[near]!.push(...groups[small]!);
    groups.splice(small, 1);
  };
  const mean = size(cells) / Math.max(1, cells.length);
  for (let small = 0; groups.length > 1 && (small = groups.findIndex((g) => size(g) < CRUMB * mean)) >= 0; ) join(small);
  for (let guard = 0; groups.length < LEAST_GROUPS && guard < 16; guard++) {
    let big = -1;
    groups.forEach((g, i) => {
      if (g.length === 1 && (big < 0 || size(g) > size(groups[big]!))) big = i;
    });
    if (big < 0) break;
    const halves = halve(groups[big]![0]!, through).filter((h) => h.poly.length > 0);
    if (halves.length < 2) break;
    groups.splice(big, 1, [halves[0]!], [halves[1]!]);
  }
  while (groups.length > MOST_PIECE_GROUPS) {
    let small = 0;
    groups.forEach((g, i) => {
      if (size(g) < size(groups[small]!)) small = i;
    });
    join(small);
  }
  return groups;
}

/** A form's point (u, v, w) in its collider's frame. */
function placer(f: FormDef): (u: number, v: number, w: number) => Corner {
  const [ax, ay, az] = f.at;
  const r = (n: number): number => Math.round(n * 1e6) / 1e6;
  if (f.plane === "flat") return (u, v, w) => [r(u - ax), r(w - ay), r(v - az)];
  if (f.plane === "upright") return (u, v, w) => [r(u - ax), r(v - ay), r(w - az)];
  return (u, v, w) => [r(w - ax), r(v - ay), r(u - az)];
}

/**
 * The groups a piece of form `f` in `tier` breaks into, 6 to 10 of them where it is big enough to hold that many,
 * each its convex chunks, every corner within the form. Most groups are one chunk; a stair's are its steps.
 */
export function pieceBreak(f: FormDef, tier: string): PieceGroup[] {
  const grain = GRAINS[tier] ?? GRAINS.wood!;
  const at = placer(f);
  const [u0, v0, u1, v1] = outlineBox(f);
  const box: [number, number, number, number] = [u0, v0, u1, v1];
  if (f.steps !== undefined) {
    // A step a group, from the floor to its tread: they rise toward +Z, the outline's second axis.
    const steps = f.steps, groups: PieceGroup[] = [];
    const per = Math.ceil(steps / MOST_PIECE_GROUPS);
    for (let i = 0; i < steps; i += per) {
      const group: Corner[][] = [];
      for (let k = i; k < Math.min(steps, i + per); k++) group.push(prism([[u0, v0 + ((v1 - v0) * k) / steps], [u1, v0 + ((v1 - v0) * k) / steps], [u1, v0 + ((v1 - v0) * (k + 1)) / steps], [u0, v0 + ((v1 - v0) * (k + 1)) / steps]], () => 0, () => ((k + 1) * f.thick) / steps, at));
      groups.push(group);
    }
    return groups;
  }
  const flat = f.plane === "flat";
  // Through the outline's plane: up for a flat form, which may hang, and across an upright one, which may stand as a pair.
  const spans: [number, number][] = [];
  if (flat) spans.push(f.span === 0 ? [-f.thick, 0] : [0, f.thick]);
  else {
    const [w0, w1] = [(f.off ?? 0) - f.thick / 2, (f.off ?? 0) + f.thick / 2];
    spans.push([w0, w1]);
    if (f.pair !== undefined) spans.push([2 * f.pair - w1, 2 * f.pair - w0]);
  }
  const slopes = f.corner ? slopesOf(f) : null;
  const wide = u1 - u0, deep = v1 - v0, thick = spans[0]![1] - spans[0]![0];
  const nu = Math.max(1, Math.round(wide / grain.run)), nv = Math.max(1, Math.round(deep / grain.rise));
  const nw = !slopes && flat && thick > THICK ? Math.max(1, Math.round(thick / grain.tall)) : 1;
  const outline = ccw(f.outline.map(([u, v]): Pt => [u, v]));
  const cells: Cell[] = [];
  for (const g of grid(box, nu, nv, flat && nw > 1 ? "none" : grain.stagger)) {
    let polys = [meet(g, outline)].filter((p) => p.length > 0);
    for (const o of f.openings ?? []) polys = polys.flatMap((p) => less(p, o));
    if (slopes) {
      for (const p of polys) for (const s of slopes) {
        const poly = meet(p, s.poly);
        if (poly.length > 0) cells.push({ poly, w0: 0, w1: 1, slope: s });
      }
      continue;
    }
    for (const poly of polys) for (const [w0, w1] of spans) for (let k = 0; k < nw; k++) cells.push({ poly, w0: w0 + ((w1 - w0) * k) / nw, w1: w0 + ((w1 - w0) * (k + 1)) / nw });
  }
  return grouped(cells, !slopes).map((g) =>
    g.map((c) => {
      const s = c.slope;
      if (!s) return prism(c.poly, () => c.w0, () => c.w1, at);
      // Its top is the plane of the part of the outline it lies in; a roof hangs its thickness under that, a ramp stands on its level.
      const top = (p: Pt): number => s.a * p[0] + s.b * p[1] + s.c;
      return prism(c.poly, (p) => (f.span === 0 ? top(p) - f.thick : 0), top, at);
    }),
  );
}

/** A chunk's corners: each point of `poly` at its low and its high side, once where the two meet. */
function prism(poly: readonly Pt[], low: (p: Pt) => number, high: (p: Pt) => number, at: (u: number, v: number, w: number) => Corner): Corner[] {
  const out: Corner[] = [];
  for (const p of poly) {
    const a = low(p), b = high(p);
    out.push(at(p[0], p[1], a));
    if (b - a > 1e-6) out.push(at(p[0], p[1], b));
  }
  return out;
}
