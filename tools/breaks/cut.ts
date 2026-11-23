// Cuts a piece's parts by a plan. A part the mouth misses stays a box. A part it crosses keeps boxes outside the plan's
// window, teeth inside it, and gives up shards. Glass and loose fittings go whole.

import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import { area, asRect, atMost, grid, meet, prism, rectLess, rectMeet, rectPoly, type Corner, type Pt, type Rect } from "./geometry.ts";
import type { Plan } from "./plan.ts";

/** A part of a piece: a box in the piece's plane (`r`) through a thickness, as a facade module's parts are written. */
export interface Part {
  readonly r: Rect;
  readonly w0: number;
  readonly w1: number;
  /** A palette colour of its own. Without one it is in the piece's finish. */
  readonly color?: number;
  /** A pane. A cut never crosses it: it goes whole, as particles. */
  readonly glass?: boolean;
  /** A fitting (a mullion, a sign, a sill). A cut never crosses it: it goes whole, as one fragment. */
  readonly loose?: boolean;
  /** Its drawn form where that is not its box: a bevelled part's corners. Lost if the part is cut. */
  readonly hull?: readonly Corner[];
}

/** A convex solid of a look or a fragment, in the piece's metres. */
export interface Chunk {
  readonly corners: readonly Corner[];
  readonly color?: number;
  /** Its faces that are not on the whole piece's surface show the bared core. */
  readonly bare?: boolean;
}

export interface Look {
  readonly boxes: readonly ShapeBox[];
  readonly chunks: readonly Chunk[];
}

/** How a piece's plane lies in the piece: a wall's is along and up, a slab's along and across. */
export interface Frame {
  readonly name: "wall" | "floor";
  readonly to: (u: number, v: number, w: number) => Corner;
}
export const WALL: Frame = { name: "wall", to: (u, v, w) => [u, v, w] };
export const FLOOR: Frame = { name: "floor", to: (u, v, w) => [u, w, v] };

export function boxOf(frame: Frame, r: Rect, w0: number, w1: number, color?: number): ShapeBox {
  const a = frame.to(r[0], r[2], w0), b = frame.to(r[1], r[3], w1);
  return {
    at: [grid((a[0] + b[0]) / 2), grid((a[1] + b[1]) / 2), grid((a[2] + b[2]) / 2)],
    half: [grid(Math.abs(b[0] - a[0]) / 2), grid(Math.abs(b[1] - a[1]) / 2), grid(Math.abs(b[2] - a[2]) / 2)],
    ...(color !== undefined ? { color } : {}),
  };
}

export const partBox = (frame: Frame, p: Part): ShapeBox => boxOf(frame, p.r, p.w0, p.w1, p.color);

/** A part as a chunk: its bevelled form if it has one, else its box's corners. */
export function partChunk(frame: Frame, p: Part, bare = false): Chunk {
  const corners = p.hull ?? prism(rectPoly(p.r), p.w0, p.w1, frame.to);
  return { corners, ...(p.color !== undefined ? { color: p.color } : {}), ...(bare ? { bare } : {}) };
}

/** Parts cut in two at `u`, so a cut in one half of a piece leaves the other half's parts alone. */
export function splitAt(parts: readonly Part[], u: number): Part[] {
  return parts.flatMap((p): Part[] => {
    if (p.hull || p.loose || p.r[0] >= u - 1e-5 || p.r[1] <= u + 1e-5) return [p];
    return [{ ...p, r: [p.r[0], u, p.r[2], p.r[3]] }, { ...p, r: [u, p.r[1], p.r[2], p.r[3]] }];
  });
}

export interface Cut {
  /** What stands. */
  readonly look: Look;
  /** What leaves, each a rigid thing of one or more chunks. */
  readonly fragments: readonly (readonly Chunk[])[];
  /** Panes that go, as boxes: the client drops particles from them. */
  readonly panes: readonly ShapeBox[];
}

/** Whether a part's box and the plan's mouth share any area. */
const mouthed = (plan: Plan, r: Rect): boolean => plan.shards.some((s) => meet(s, rectPoly(r)).length > 0);

/** Cuts `parts` by a plan, or by several whose windows do not overlap: a part is cut by the one whose mouth reaches it. */
export function cut(frame: Frame, parts: readonly Part[], plans: Plan | readonly Plan[]): Cut {
  const boxes: ShapeBox[] = [], chunks: Chunk[] = [], fragments: Chunk[][] = [], panes: ShapeBox[] = [];
  const list: readonly Plan[] = Array.isArray(plans) ? plans : [plans as Plan];
  const byShard = new Map<readonly Pt[], Chunk[]>();
  for (const p of parts) {
    const plan = list.find((q) => { const r = rectMeet(p.r, q.window); return r !== null && mouthed(q, r); });
    const inside = plan ? rectMeet(p.r, plan.window) : null;
    if (!plan || !inside) {
      if (p.hull) chunks.push(partChunk(frame, p));
      else boxes.push(partBox(frame, p));
      continue;
    }
    if (p.glass) { panes.push(partBox(frame, p)); continue; }
    // A bevelled part is not cut either: its bevel would be lost.
    if (p.loose || p.hull) { fragments.push([partChunk(frame, p)]); continue; }
    for (const r of rectLess(p.r, plan.window)) boxes.push(boxOf(frame, r, p.w0, p.w1, p.color));
    const held = rectPoly(inside);
    const solid = (poly: readonly Pt[]): Chunk => ({ corners: prism(poly, p.w0, p.w1, frame.to), ...(p.color !== undefined ? { color: p.color } : {}), bare: true });
    for (const tooth of plan.teeth) {
      const poly = meet(tooth, held);
      if (poly.length === 0) continue;
      const r = asRect(poly);
      if (r) boxes.push(boxOf(frame, r, p.w0, p.w1, p.color));
      else for (const part of atMost(poly, 6)) chunks.push(solid(part));
    }
    // One shard of the plane is one thing that leaves, whatever parts it is made of.
    for (const shard of plan.shards) {
      const poly = meet(shard, held);
      if (poly.length === 0) continue;
      let group = byShard.get(shard);
      if (!group) { group = []; byShard.set(shard, group); fragments.push(group); }
      for (const part of atMost(poly, 6)) group.push(solid(part));
    }
  }
  return { look: { boxes, chunks }, fragments, panes };
}

/** A form's solid: the whole's boxes less what is passable, as boxes. */
export function solidLess(frame: Frame, solid: readonly Part[], passable: readonly Rect[]): ShapeBox[] {
  let rects: { r: Rect; p: Part }[] = solid.map((p) => ({ r: p.r, p }));
  for (const hole of passable) rects = rects.flatMap(({ r, p }) => rectLess(r, hole).map((left) => ({ r: left, p })));
  return rects.map(({ r, p }) => boxOf(frame, r, p.w0, p.w1));
}

/**
 * Bars out of a break in reinforced concrete: 7 cm square, rust, each from a point of the mouth toward its middle, some
 * bent down. `down` is the way a bar hangs: along -v in a wall, along -w in a slab.
 */
export function bars(frame: Frame, plan: Plan, w0: number, w1: number, most: number, seed: number): ShapeBox[] {
  const RUST = 179, T = 0.035;
  const out: ShapeBox[] = [];
  const mid = (w0 + w1) / 2, cover = Math.min(0.08, (w1 - w0) / 4);
  const n = plan.mouth.length;
  for (let k = 0, i = seed % Math.max(1, n); k < n && out.length < most * 2; k++, i = (i + 2) % n) {
    const p = plan.mouth[i]!;
    const du = plan.c[0] - p[0], dv = plan.c[1] - p[1];
    const far = Math.hypot(du, dv);
    if (far < 0.5) continue;
    const length = 0.25 + ((seed >>> (k * 3)) & 7) * 0.06;
    const w = k % 2 ? mid - (w1 - w0) / 2 + cover : mid + (w1 - w0) / 2 - cover;
    // A bar runs along the axis nearer the way to the middle, as a mat's bars lie.
    const alongU = Math.abs(du) >= Math.abs(dv);
    const su = Math.sign(du) || 1, sv = Math.sign(dv) || 1;
    const r: Rect = alongU ? [Math.min(p[0], p[0] + su * length), Math.max(p[0], p[0] + su * length), p[1] - T, p[1] + T] : [p[0] - T, p[0] + T, Math.min(p[1], p[1] + sv * length), Math.max(p[1], p[1] + sv * length)];
    out.push(boxOf(frame, r, w - T, w + T, RUST));
    const drop = ((seed >>> (k * 2 + 1)) & 3) * 0.14;
    if (drop > 0) {
      const tip: Pt = alongU ? [p[0] + su * length, p[1]] : [p[0], p[1] + sv * length];
      if (frame.name === "wall") out.push(boxOf(frame, [tip[0] - T, tip[0] + T, tip[1] - drop, tip[1]], w - T, w + T, RUST));
      else out.push(boxOf(frame, [tip[0] - T, tip[0] + T, tip[1] - T, tip[1] + T], w - drop, w, RUST));
    }
  }
  return out;
}

/** The volume of a chunk that is a prism made by this file: its two ends are the same polygon. */
export function prismVolume(poly: readonly Pt[], w0: number, w1: number): number {
  return area(poly) * (w1 - w0);
}

/** A look's convex parts as content writes them. */
export const hullsOf = (chunks: readonly Chunk[]): HullDef[] => chunks.map((c) => ({ corners: c.corners }));
