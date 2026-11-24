// A form is one row of data for a kind of built piece: which slot of a base's lattice it fills, and its exact dimensions.
// Content writes the rows, and the registry refuses a row its collider does not agree with.
//
// A row's numbers are in its slot's frame. The origin is the slot's reference point: a vertex itself, the middle of an
// edge (of the first, for a piece over several), the centre of a square of two half-sides, the low corner of a square of
// one, a triangle's first corner. X runs along the edge or the piece's first axis, Y up from the slot's level, Z along the
// second axis, a wall's front.

import type { ShapeBox } from "../../content/kinds/shapes.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../coords.ts";
import { hullPoint, type HullDef } from "../convex.ts";
import { HALF_SIDE, frameAxes } from "../frame.ts";

/** Half a square's side, and a quarter of a storey, in metres. */
export const HALF_SIDE_M = HALF_SIDE / STRUCT_UNITS;
export const LEVEL_M = HALF_SIDE_M / 2;
/** Quarter storeys in a storey: a piece taller than one lists a cell for each. */
export const STOREY_LEVELS = 4;

export type SlotClass = "vertex" | "edge" | "square" | "triangle";
export const SLOT_CLASSES: readonly SlotClass[] = ["vertex", "edge", "square", "triangle"];
export type FormLayer = "slab" | "fill" | "wall" | "leaf" | "post" | "footing";
export const FORM_LAYERS: readonly FormLayer[] = ["slab", "fill", "wall", "leaf", "post", "footing"];
/** A sloped top is high at the piece's -X end (slopeL) or its +X end (slopeR). */
export type EdgeProfile = "flat" | "slopeL" | "slopeR";
export type FormCloses = "full" | "doorway" | "window" | "none";
/** The plane an outline is drawn in: (x, z) lying flat, (x, y) upright along the edge, (z, y) upright across it. */
export type FormPlane = "flat" | "upright" | "across";

/** Another slot, from this piece's: half-sides along its X and Z, and quarter storeys up. */
export interface Rel {
  readonly cls: SlotClass;
  readonly layer: FormLayer;
  readonly i: number;
  readonly j: number;
  readonly lvl: number;
}

/** One side of a piece: quarter storeys up to its low end, and how its top runs. */
export interface FormEdge {
  readonly lvl: number;
  readonly profile: EdgeProfile;
}

/** A rectangle cut through the thickness, in the outline's own two coordinates. */
export interface FormOpening {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** The slot half: what snapping, occupancy and support read. */
export interface FormSlot {
  readonly cls: SlotClass;
  readonly layer: FormLayer;
  /** Half-sides a side. 2 unless given. */
  readonly size?: 1 | 2;
  /** Quarter storeys it stands up from its level. 0 for a slab or a footing, which hang under it. */
  readonly span: number;
  /** For a piece over several edges or storeys: each cell as whole sides along the edge and quarter storeys up. */
  readonly cells?: readonly (readonly [number, number])[];
  /** It holds a base up: always, or only where it stands on the ground. */
  readonly root?: "always" | "grounded";
  /** It holds what stands straight up on it. */
  readonly carries?: boolean;
  /** The stability it must keep to stand. 0 unless given. */
  readonly need?: 0 | 1;
  /** What it shuts of its edge or face, for rooms. */
  readonly closes?: FormCloses;
  /** A flat piece: one for each side of its outline, side k from corner k to the next. An upright one: its top. */
  readonly edges?: readonly FormEdge[];
  /** Slots nothing may fill while it stands. */
  readonly blocks?: readonly Rel[];
  /** The turns it may take in its slot. */
  readonly turns: 1 | 2 | 3 | 4;
  /** The collider's origin from the reference point, in metres along the slot's axes: whole half-sides along, whole lattice units up. */
  readonly at: readonly [number, number, number];
}

/** The geometry half: what colliders and meshes are made from. */
export interface FormSolid {
  readonly plane: FormPlane;
  /**
   * The corners in metres from the reference point, going round the way a square's sides go north (+Z), east, south, west.
   * A flat piece hangs `thick` under its level if its span is 0, and else stands that high on it.
   */
  readonly outline: readonly (readonly [number, number])[];
  /** Metres through the outline's plane. An upright piece is centred on its edge's line unless `off` moves it. */
  readonly thick: number;
  /** An upright piece: where the middle of its thickness is, along Z, or along X for one across. */
  readonly off?: number;
  readonly openings?: readonly FormOpening[];
  /** A flat piece's top at each corner, in metres over its level: a roof's slope, a ramp's. */
  readonly corner?: readonly number[];
  /** A flat piece's treads, rising toward +Z to `thick`, each level with the slope at its far edge. */
  readonly steps?: number;
  /** Metres from an end or a side to the ring a drawn mesh collapses onto, where it gives way to a joint or a wall. */
  readonly yieldBand: number;
}

export interface FormDef extends FormSlot, FormSolid {}

const EPS = 1e-6;
const QUARTER = YAW_UNITS / 4;
const axes = new Int32Array(4);

const sizeOf = (f: FormSlot): number => (f.size ?? 2) * HALF_SIDE_M;
const hangs = (f: FormDef): boolean => f.plane === "flat" && f.span === 0;

/** The outline's box in its own two coordinates: least first, least second, most first, most second. */
export function outlineBox(f: FormSolid): [number, number, number, number] {
  const out: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [u, v] of f.outline) {
    out[0] = Math.min(out[0], u);
    out[1] = Math.min(out[1], v);
    out[2] = Math.max(out[2], u);
    out[3] = Math.max(out[3], v);
  }
  return out;
}

/** The least and most a form reaches through its outline's plane: up for a flat one, along Z or X for an upright one. */
function through(f: FormDef): [number, number] {
  if (f.plane !== "flat") return [(f.off ?? 0) - f.thick / 2, (f.off ?? 0) + f.thick / 2];
  const top = f.corner ? Math.max(...f.corner) : 0;
  return hangs(f) ? [-f.thick, top] : [0, f.corner ? top : f.thick];
}

/** The box a form fills in its slot's frame, in metres: least x, y and z, then most. */
export function formBounds(f: FormDef): [number, number, number, number, number, number] {
  const [u0, v0, u1, v1] = outlineBox(f);
  const [w0, w1] = through(f);
  return f.plane === "flat" ? [u0, w0, v0, u1, w1, v1] : f.plane === "upright" ? [u0, v0, w0, u1, v1, w1] : [w0, v0, u0, w1, v1, u1];
}

/** Half extents of the box about the collider's origin that holds the form: what its structures declare as `half`. */
export function formHalf(f: FormDef): [number, number, number] {
  const b = formBounds(f);
  return [0, 1, 2].map((a) => Math.max(Math.abs(b[a]! - f.at[a]!), Math.abs(b[a + 3]! - f.at[a]!))) as [number, number, number];
}

/**
 * The pose of a piece in a slot, in lattice units: the slot's reference point and facing in, the collider's origin and yaw
 * out. `at` runs along the slot's axes whatever the turn. A third of a turn is no yaw: it is the lattice's to give.
 */
export function formPose(f: FormSlot, x: number, y: number, z: number, yaw: number, turn: number, out: { x: number; y: number; z: number; yaw: number }): void {
  frameAxes(yaw, axes);
  const i = Math.round(f.at[0] / HALF_SIDE_M);
  const j = Math.round(f.at[2] / HALF_SIDE_M);
  out.x = x + i * axes[0]! + j * axes[2]!;
  out.z = z + i * axes[1]! + j * axes[3]!;
  out.y = y + Math.round(f.at[1] * STRUCT_UNITS);
  const step = f.turns === 3 ? 0 : (4 / f.turns) * QUARTER;
  out.yaw = (yaw + (turn % f.turns) * step) & (YAW_UNITS - 1);
}

/** Every kind's form by its index, and the fields placing reads most as columns. */
export interface FormTable {
  /** Null for a kind with no form. */
  readonly def: (FormDef | null)[];
  /** Indices into SLOT_CLASSES and FORM_LAYERS, -1 for a kind with no form. */
  readonly cls: Int8Array;
  readonly layer: Int8Array;
  readonly size: Uint8Array;
  readonly span: Uint8Array;
  readonly turns: Uint8Array;
  /** The collider's origin from the reference point: half-sides along X and Z, lattice units up. */
  readonly atI: Int8Array;
  readonly atJ: Int8Array;
  readonly atY: Int32Array;
}

export function makeFormTable(n: number): FormTable {
  return { def: new Array<FormDef | null>(n).fill(null), cls: new Int8Array(n).fill(-1), layer: new Int8Array(n).fill(-1), size: new Uint8Array(n), span: new Uint8Array(n), turns: new Uint8Array(n), atI: new Int8Array(n), atJ: new Int8Array(n), atY: new Int32Array(n) };
}

export function setForm(t: FormTable, k: number, f: FormDef): void {
  t.def[k] = f;
  t.cls[k] = SLOT_CLASSES.indexOf(f.cls);
  t.layer[k] = FORM_LAYERS.indexOf(f.layer);
  t.size[k] = f.size ?? 2;
  t.span[k] = f.span;
  t.turns[k] = f.turns;
  t.atI[k] = Math.round(f.at[0] / HALF_SIDE_M);
  t.atJ[k] = Math.round(f.at[2] / HALF_SIDE_M);
  t.atY[k] = Math.round(f.at[1] * STRUCT_UNITS);
}

const whole = (v: number): boolean => Math.abs(v - Math.round(v)) < EPS;
const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const PLANES: readonly FormPlane[] = ["flat", "upright", "across"];
const LAYER_CLASSES: Readonly<Record<FormLayer, readonly SlotClass[]>> = { slab: ["square", "triangle"], fill: ["square", "triangle"], wall: ["edge"], leaf: ["edge", "square", "triangle"], post: ["vertex"], footing: ["edge"] };

/** Twice the outline's area, signed: negative for the way a flat outline goes round, positive for an upright one. */
function turning(o: FormSolid["outline"]): number {
  let sum = 0;
  for (let k = 0; k < o.length; k++) {
    const a = o[k]!;
    const b = o[(k + 1) % o.length]!;
    sum += a[0] * b[1] - a[1] * b[0];
  }
  return sum;
}

/** Whether (u, v) is in the outline or on its rim. `way` is -1 for a flat outline and 1 for an upright one. */
function inOutline(o: FormSolid["outline"], way: number, u: number, v: number): boolean {
  for (let k = 0; k < o.length; k++) {
    const a = o[k]!;
    const b = o[(k + 1) % o.length]!;
    if (way * ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])) < -EPS) return false;
  }
  return true;
}

/** The profile of a flat piece's side from its two corner heights, as a wall facing out under it has its top. */
function sideOf(from: number, to: number): FormEdge {
  return { lvl: Math.round(Math.min(from, to) / LEVEL_M), profile: near(from, to) ? "flat" : from > to ? "slopeL" : "slopeR" };
}

/** What is wrong with a form by itself, or nothing. */
export function formFaults(f: FormDef): string[] {
  const out: string[] = [];
  if (!SLOT_CLASSES.includes(f.cls) || !FORM_LAYERS.includes(f.layer) || !PLANES.includes(f.plane)) return ["a form names a slot class, a layer and a plane"];
  if (!LAYER_CLASSES[f.layer].includes(f.cls)) out.push(`a ${f.layer} fills ${LAYER_CLASSES[f.layer].join(" or ")}, not ${f.cls}`);
  if ((f.cls === "edge") === (f.plane === "flat")) out.push("an edge's piece is upright, and any other lies flat");
  if (f.size !== undefined && f.size !== 1 && f.size !== 2) out.push("size is 1 or 2 half-sides");
  if (![1, 2, 3, 4].includes(f.turns)) out.push("turns is 1 to 4");
  if (f.need !== undefined && f.need !== 0 && f.need !== 1) out.push("need is 0 or 1");
  if (f.root !== undefined && f.root !== "always" && f.root !== "grounded") out.push('root is "always" or "grounded"');
  if (f.closes !== undefined && !["full", "doorway", "window", "none"].includes(f.closes)) out.push("closes is full, doorway, window or none");
  if (!(Number.isInteger(f.span) && f.span >= 0 && f.span <= 64)) out.push("span is 0 to 64 quarter storeys");
  if (!(f.thick > 0)) out.push("thick is more than 0");
  if (!Array.isArray(f.at) || f.at.length !== 3 || !whole(f.at[0] / HALF_SIDE_M) || !whole(f.at[2] / HALF_SIDE_M) || !whole(f.at[1] * STRUCT_UNITS)) out.push("at is whole half-sides along and whole lattice units up");
  for (const r of f.blocks ?? []) if (!SLOT_CLASSES.includes(r.cls) || !FORM_LAYERS.includes(r.layer) || ![r.i, r.j, r.lvl].every(Number.isInteger)) out.push("a blocked slot is a class, a layer and whole steps");

  const o = f.outline;
  if (!Array.isArray(o) || o.length < 3 || o.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return [...out, "an outline is three corners or more"];
  const way = f.plane === "flat" ? -1 : 1;
  let shortest = Infinity;
  for (let k = 0; k < o.length; k++) {
    const a = o[k]!;
    const b = o[(k + 1) % o.length]!;
    const c = o[(k + 2) % o.length]!;
    shortest = Math.min(shortest, Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])));
    if (!(way * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > EPS)) out.push(`the outline is not convex at corner ${(k + 1) % o.length}, or goes round the wrong way`);
  }
  if (!(f.yieldBand >= 0 && 2 * f.yieldBand < shortest)) out.push("the yield band is under half the shortest side");
  if (f.off !== undefined && f.plane === "flat") out.push("only an upright piece is moved off its edge's line");
  const [u0, v0, u1, v1] = outlineBox(f);

  // A face is the lattice's own square or triangle, which a slab or a fill covers and a leaf lies within.
  const side = sizeOf(f);
  const face: FormSolid["outline"] | null =
    f.cls === "square" ? (f.size === 1 ? [[0, side], [side, side], [side, 0], [0, 0]] : [[-side / 2, side / 2], [side / 2, side / 2], [side / 2, -side / 2], [-side / 2, -side / 2]]) : f.cls === "triangle" ? [[0, 0], [side / 2, (side * Math.sqrt(3)) / 2], [side, 0]] : null;
  if (face && f.layer === "leaf" ? o.some((p) => !inOutline(face, -1, p[0], p[1])) : face && (o.length !== face.length || o.some((p, k) => !near(p[0], face[k]![0]) || !near(p[1], face[k]![1])))) out.push(`the outline is not the ${f.cls} of ${f.size ?? 2} half-sides it fills`);
  if (f.cls === "vertex" && !inOutline(o, way, 0, 0)) out.push("a post stands over its vertex");

  const cells = f.cells ?? [[0, 0] as const];
  const wide = new Set(cells.map((c) => c[0])).size;
  const storeys = Math.max(1, Math.ceil(f.span / STOREY_LEVELS));
  const want = Array.from({ length: wide * storeys }, (_, n) => `${Math.floor(n / storeys)},${(n % storeys) * STOREY_LEVELS}`);
  if (f.cells !== undefined && f.cls !== "edge") out.push("only an edge's piece lists cells");
  else if (f.cls === "edge" && (cells.length !== want.length || new Set(cells.map((c) => `${c[0]},${c[1]}`)).size !== want.length || cells.some((c) => !want.includes(`${c[0]},${c[1]}`)))) out.push("cells are every edge from 0 and every storey of the span, once each");
  if (f.plane === "upright" && (u0 < -side / 2 - EPS || u1 > -side / 2 + wide * side + EPS || ((f.layer === "wall" || f.layer === "footing") && (!near(u0, -side / 2) || !near(u1, -side / 2 + wide * side))))) out.push("the outline is not as wide as its edges");

  // The height the outline reaches over the level is what the span counts in quarter storeys.
  if (f.corner !== undefined && (f.plane !== "flat" || f.corner.length !== o.length || f.corner.some((h) => !(h >= 0) || (f.span === 0 && !whole(h / LEVEL_M))) || f.corner.every((h) => near(h, f.corner![0]!)))) out.push("corner heights are one for each corner of a flat outline, not all alike, and a roof's are whole quarter storeys");
  else if (f.plane !== "flat") {
    if (f.span === 0 ? !near(v1, 0) : v0 < -EPS || Math.ceil(v1 / LEVEL_M - EPS) !== f.span) out.push("the span is not the outline's height in quarter storeys");
  } else if (f.span > 0) {
    const high = f.corner ? Math.max(...f.corner) : f.thick;
    if (!near(f.thick, high) || Math.ceil(high / LEVEL_M - EPS) !== f.span) out.push("the span is not the outline's height in quarter storeys");
  }
  if (f.steps !== undefined && (f.plane !== "flat" || f.span === 0 || f.corner !== undefined || !(Number.isInteger(f.steps) && f.steps >= 2) || o.length !== 4 || o.some((p) => (!near(p[0], u0) && !near(p[0], u1)) || (!near(p[1], v0) && !near(p[1], v1))))) out.push("steps are two or more, on a flat rectangle that stands");

  const sides = f.plane === "flat" && f.corner?.length === o.length ? o.map((_, k) => sideOf(f.corner![k]!, f.corner![(k + 1) % o.length]!)) : null;
  if (f.edges !== undefined) {
    if (f.edges.some((e) => !Number.isInteger(e.lvl) || !["flat", "slopeL", "slopeR"].includes(e.profile))) out.push("an edge is a whole level and a profile");
    else if (f.plane === "flat" ? f.edges.length !== o.length || f.edges.some((e, k) => (sides ? e.lvl !== sides[k]!.lvl || e.profile !== sides[k]!.profile : e.lvl !== 0 || e.profile !== "flat")) : f.edges.length !== 1 || !topAgrees(f, f.edges[0]!)) out.push("edges do not agree with the outline's heights");
  } else if (sides && f.span === 0) out.push("a roof says each side's level and profile");

  const cuts = f.openings ?? [];
  if (cuts.length > 0 && (f.corner !== undefined || f.steps !== undefined)) out.push("a sloped or stepped piece has no openings");
  for (const [n, c] of cuts.entries()) {
    if (!(c.x0 < c.x1 && c.y0 < c.y1) || ![c.x0, c.x1].every((u) => [c.y0, c.y1].every((v) => inOutline(o, way, u, v)))) out.push(`opening ${n} is not inside the outline`);
    if (cuts.slice(0, n).some((d) => Math.min(c.x1, d.x1) - Math.max(c.x0, d.x0) > EPS && Math.min(c.y1, d.y1) - Math.max(c.y0, d.y0) > EPS)) out.push(`opening ${n} overlaps another`);
  }
  return out;
}

/** Whether an upright piece's one edge says how its outline's top runs: its height at each end. */
function topAgrees(f: FormDef, e: FormEdge): boolean {
  const [u0, , u1] = outlineBox(f);
  const at = (u: number): number => Math.max(...f.outline.filter((p) => near(p[0], u)).map((p) => p[1]));
  const said = sideOf(at(u0), at(u1));
  return said.profile === e.profile && (e.profile === "flat" ? e.lvl === f.span : e.lvl === said.lvl);
}

/** A form's corners in its slot's frame: each outline corner at the near and far side of its thickness. */
function solidCorners(f: FormDef): [number, number, number][] {
  const [w0, w1] = through(f);
  const v1 = outlineBox(f)[3];
  const out: [number, number, number][] = [];
  for (const [k, [u, v]] of f.outline.entries()) {
    if (f.plane !== "flat") {
      out.push(f.plane === "upright" ? [u, v, w0] : [w0, v, u], f.plane === "upright" ? [u, v, w1] : [w1, v, u]);
      continue;
    }
    // Stairs walked as a ramp rise from nothing at their low side.
    const top = f.corner ? f.corner[k]! : f.steps !== undefined ? (near(v, v1) ? f.thick : 0) : w1;
    const under = hangs(f) ? top - f.thick : 0;
    out.push([u, under, v]);
    if (top - under > EPS) out.push([u, top, v]);
  }
  return out;
}

/**
 * What is wrong between a form and the collider of its shape, or nothing. Boxes must lie in the form, apart from each
 * other and clear of its openings, and fill it. Each convex part's corners must lie in it, and each of its corners be one's.
 */
export function colliderFaults(f: FormDef, boxes: readonly ShapeBox[], hulls: readonly HullDef[]): string[] {
  const out: string[] = [];
  const want = formBounds(f);
  const way = f.plane === "flat" ? -1 : 1;
  // Which of x, y and z the outline's two coordinates and its thickness are.
  const [U, V, W] = f.plane === "flat" ? [0, 2, 1] : f.plane === "upright" ? [0, 1, 2] : [2, 1, 0];
  const [w0, w1] = through(f);
  const [, v0, , v1] = outlineBox(f);
  const got = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const hold = (p: readonly number[]): void => {
    for (let a = 0; a < 3; a++) {
      got[a] = Math.min(got[a]!, p[a]!);
      got[a + 3] = Math.max(got[a + 3]!, p[a]!);
    }
  };

  let volume = 0;
  const placed = boxes.map((b) => [0, 1, 2].flatMap((a) => [b.at[a]! + f.at[a]! - b.half[a]!, b.at[a]! + f.at[a]! + b.half[a]!]));
  for (const [n, b] of placed.entries()) {
    hold([b[0]!, b[2]!, b[4]!]);
    hold([b[1]!, b[3]!, b[5]!]);
    volume += (b[1]! - b[0]!) * (b[3]! - b[2]!) * (b[5]! - b[4]!);
    const lo = (a: number): number => b[2 * a]!;
    const hi = (a: number): number => b[2 * a + 1]!;
    // A tread is level with the slope at its far edge, so a step's block may be no higher than that.
    const top = f.steps !== undefined ? (Math.round(((hi(V) - v0) / (v1 - v0)) * f.steps) * f.thick) / f.steps : w1;
    if (f.corner !== undefined) out.push("a sloped form's collider is convex parts, not boxes");
    else if (lo(W) < w0 - EPS || hi(W) > top + EPS || ![lo(U), hi(U)].every((u) => [lo(V), hi(V)].every((v) => inOutline(f.outline, way, u, v)))) out.push(`box ${n} reaches out of the form`);
    for (const c of f.openings ?? []) if (Math.min(hi(U), c.x1) - Math.max(lo(U), c.x0) > EPS && Math.min(hi(V), c.y1) - Math.max(lo(V), c.y0) > EPS) out.push(`box ${n} is in an opening`);
    if (placed.slice(0, n).some((p) => [0, 1, 2].every((a) => Math.min(hi(a), p[2 * a + 1]!) - Math.max(lo(a), p[2 * a]!) > EPS))) out.push(`box ${n} overlaps another`);
  }

  const corners = solidCorners(f);
  const met = corners.map(() => false);
  const p: [number, number, number] = [0, 0, 0];
  for (const [n, h] of hulls.entries()) {
    if ((f.openings ?? []).length > 0) out.push("a form with openings has a collider of boxes");
    for (const c of h.corners) {
      hullPoint(c, h.sixty === true, p);
      for (let a = 0; a < 3; a++) p[a] = p[a]! + f.at[a]!;
      hold(p);
      if (p[W]! < w0 - EPS || p[W]! > w1 + EPS || !inOutline(f.outline, way, p[U]!, p[V]!)) out.push(`convex part ${n} reaches out of the form`);
      corners.forEach((q, k) => (met[k] ||= near(q[0], p[0]) && near(q[1], p[1]) && near(q[2], p[2])));
    }
  }
  if (hulls.length > 0 && met.includes(false)) out.push("a corner of the form is no corner of its convex parts");

  if (got.some((v, a) => !near(v, want[a]!))) out.push(`the collider's box is [${got.map(round).join(", ")}] in the slot, and the form's is [${want.map(round).join(", ")}]`);
  if (hulls.length === 0 && f.corner === undefined) {
    const o = f.outline;
    const cut = (f.openings ?? []).reduce((sum, c) => sum + (c.x1 - c.x0) * (c.y1 - c.y0), 0);
    const full = (Math.abs(turning(o)) / 2 - cut) * f.thick;
    const filled = f.steps !== undefined ? (full * (f.steps + 1)) / (2 * f.steps) : full;
    if (Math.abs(volume - filled) > EPS * Math.max(1, filled)) out.push(`the boxes fill ${round(volume)} cubic metres, and the form ${round(filled)}`);
  }
  return out;
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6;
