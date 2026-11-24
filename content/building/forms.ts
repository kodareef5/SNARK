// The forms of built pieces: one row each, with every dimension written once. content/building.ts makes its colliders
// from LIVE_FORMS, and the mesh generator reads the same rows.
// What each field means is in shared/world/lattice/forms.ts.

import type { ShapeBox } from "../../shared/content/defs.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import { outlineBox, type FormDef, type FormEdge, type Rel } from "../../shared/world/lattice/forms.ts";

/** Metres. A side is two half-sides of the lattice and a storey four of its levels. */
const SIDE = 3;
const STOREY = 3;
const LEVEL = STOREY / 4;
const WALL = 0.2;
const FLOOR = 0.25;
const FOUNDATION = 0.375;
const PILLAR = 0.5;
/** Wider than a survivor and taller than one stands. */
const DOOR = { wide: 1.4, high: 2.3125, thick: 0.08 };
/** At a standing survivor's eye height, and too short for any body to get through, even prone in a jump. */
const WINDOW = { wide: 1.2, sill: 1.2, high: 0.7 };
const STEPS = 10;
/** What a wall's end and a ceiling's side give way by, to a joint or to the wall under it. */
const YIELD = 0.1;

type Outline = FormDef["outline"];

/** An upright outline from (u0, v0) to (u1, v1). */
const rect = (u0: number, v0: number, u1: number, v1: number): Outline => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
/** A flat outline `wide` by `deep` from its least corner, its sides in the order north, east, south, west. */
const plan = (x0: number, z0: number, wide: number, deep = wide): Outline => [[x0, z0 + deep], [x0 + wide, z0 + deep], [x0 + wide, z0], [x0, z0]];
const square = plan(-SIDE / 2, -SIDE / 2, SIDE);
/** A triangle of whole sides from its first corner: along the second axis, 60 degrees on from the first, then back along the first. */
const triangle: Outline = [[0, 0], [SIDE / 2, (SIDE * Math.sqrt(3)) / 2], [SIDE, 0]];

const slab = { layer: "slab", span: 0, plane: "flat" } as const;
const wall = { cls: "edge", layer: "wall", span: 4, carries: true, need: 1, turns: 2, at: [0, STOREY / 2, 0], plane: "upright", outline: rect(-SIDE / 2, 0, SIDE / 2, STOREY), thick: WALL, yieldBand: YIELD } as const;
const doorway = { x0: -DOOR.wide / 2, x1: DOOR.wide / 2, y0: 0, y1: DOOR.high };
const leaf = { cls: "edge", layer: "leaf", span: 4, turns: 2, at: [0, DOOR.high / 2, 0], thick: DOOR.thick, yieldBand: 0 } as const;
/** Nothing is floored over a flight. */
const over: readonly Rel[] = [{ cls: "square", layer: "slab", i: 0, j: 0, lvl: 4 }];
const flight = { cls: "square", layer: "fill", span: 4, need: 1, turns: 4, at: [0, STOREY / 2, 0], blocks: over, plane: "flat", outline: square, yieldBand: 0 } as const;

/**
 * The first nine pieces, by the name of their shape: what every tier's recipe makes, and what each tier's asset and
 * tests read as such. It keeps its nine names; what content places is LIVE_FORMS.
 */
export const FORMS = {
  foundation: { cls: "square", ...slab, root: "always", carries: true, turns: 1, at: [0, -FOUNDATION / 2, 0], outline: square, thick: FOUNDATION, yieldBand: 0 },
  wall: { ...wall, closes: "full", takes: "ladder" },
  doorframe: { ...wall, closes: "doorway", takes: "door", openings: [doorway] },
  windowframe: { ...wall, closes: "window", openings: [{ x0: -WINDOW.wide / 2, x1: WINDOW.wide / 2, y0: WINDOW.sill, y1: WINDOW.sill + WINDOW.high }] },
  ceiling: { cls: "square", ...slab, turns: 1, at: [0, -FLOOR / 2, 0], outline: square, thick: FLOOR, yieldBand: YIELD },
  pillar: { cls: "vertex", layer: "post", span: 4, root: "grounded", carries: true, need: 1, turns: 1, at: [0, STOREY / 2, 0], plane: "flat", outline: plan(-PILLAR / 2, -PILLAR / 2, PILLAR), thick: STOREY, yieldBand: 0 },
  door: { ...leaf, closes: "full", hangs: ["door"], plane: "upright", outline: rect(-DOOR.wide / 2, 0, DOOR.wide / 2, DOOR.high) },
  // An open door stands at a right angle on its hinge, at the doorway's left as seen from the front.
  door_open: { ...leaf, closes: "none", hangs: ["door"], plane: "across", outline: rect(0, 0, DOOR.wide, DOOR.high), off: -DOOR.wide / 2 + DOOR.thick / 2 },
  // The stairs rise toward +Z.
  stairs: { ...flight, thick: STOREY, steps: STEPS },
} satisfies Record<string, FormDef>;

/** A roof's underside rises half a storey over a side, and its slab lies on that. */
const ROOF_RISE = 2 * LEVEL;
/** Short of a storey, so the slope is under the steepest a survivor stands on. */
const RAMP_RISE = STOREY - 0.06;
const GATE = { post: 0.5, lintel: 0.75, thick: 0.4, high: 2 * STOREY };
const HATCH = SIDE / 2;
const HATCH_LEAF = 1 / 16;
const R = ROOF_RISE;

/** A roof's sides as a wall facing out under each has its top, from the heights of its underside at its corners. */
const sides = (under: readonly number[]): FormEdge[] => under.map((from, k) => {
  const to = under[(k + 1) % under.length]!;
  return { lvl: Math.min(from, to) / LEVEL, profile: from === to ? "flat" : from > to ? "slopeL" : "slopeR" };
});
/** A roof whose underside is at `under` over its level at each corner: it stands on the walls its low sides lie over. */
const roof = (cls: "square" | "triangle", under: readonly number[], turns: 1 | 2 | 3 | 4): FormDef => ({ cls, ...slab, turns, at: [0, (ROOF_RISE + FLOOR) / 2, 0], outline: cls === "square" ? square : triangle, thick: FLOOR, corner: under.map((h) => h + FLOOR), edges: sides(under), yieldBand: YIELD });
const gable = { ...wall, span: 2, carries: false, closes: "full", at: [0, LEVEL, 0] } as const;
const gateCells = [[0, 0], [0, 4], [1, 0], [1, 4]] as const;
const gateway = { x0: -SIDE / 2 + GATE.post, x1: (3 * SIDE) / 2 - GATE.post, y0: 0, y1: GATE.high - GATE.lintel };
const doubleDoor = { x0: SIDE / 2 - DOOR.wide, x1: SIDE / 2 + DOOR.wide, y0: 0, y1: DOOR.high };

/** Walls by height, rails and thin posts. */
const LOW = {
  half_wall: { ...wall, span: 2, closes: "none", at: [0, LEVEL, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, 2 * LEVEL) },
  quarter_wall: { ...wall, span: 1, closes: "none", at: [0, LEVEL / 2, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, LEVEL) },
  railing: { ...wall, span: 1, carries: false, closes: "none", at: [0, LEVEL / 2, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, LEVEL), thick: 0.1 },
  thin_pillar: { ...FORMS.pillar, outline: plan(-0.15, -0.15, 0.3) },
  // Its top is level with the top of the wall it stands in for.
  beam: { ...wall, span: 1, carries: false, closes: "none", turns: 1, at: [0, LEVEL - 0.25, 0], outline: rect(-SIDE / 2, LEVEL - 0.5, SIDE / 2, LEVEL), thick: 0.3 },
} satisfies Record<string, FormDef>;

const TRIANGLES = {
  triangle_foundation: { ...FORMS.foundation, cls: "triangle", outline: triangle },
  triangle_ceiling: { ...FORMS.ceiling, cls: "triangle", outline: triangle },
} satisfies Record<string, FormDef>;

const SLOPES = {
  ramp: { ...flight, thick: RAMP_RISE, corner: [RAMP_RISE, RAMP_RISE, 0, 0] },
  // A slope rises toward +Z. A hip has one corner up and a valley one down, each folded on the diagonal through it.
  roof: roof("square", [R, R, 0, 0], 4),
  roof_hip: roof("square", [R, 0, 0, 0], 4),
  roof_valley: roof("square", [R, R, 0, R], 4),
  triangle_roof: roof("triangle", [0, R, 0], 3),
  triangle_roof_low: roof("triangle", [R, 0, R], 3),
  // The gable under a roof's sloped side, high at its left or its right as seen from the front.
  sloped_wall_left: { ...gable, outline: [[-SIDE / 2, 0], [SIDE / 2, 0], [-SIDE / 2, R]], edges: [{ lvl: 0, profile: "slopeL" }] },
  sloped_wall_right: { ...gable, outline: [[-SIDE / 2, 0], [SIDE / 2, 0], [SIDE / 2, R]], edges: [{ lvl: 0, profile: "slopeR" }] },
} satisfies Record<string, FormDef>;

const hatchLeaf = { cls: "square", layer: "leaf", span: 0, hangs: ["hatch"], turns: 4, plane: "flat", yieldBand: 0 } as const;
const FOOTINGS = {
  fence_foundation: { cls: "edge", layer: "footing", span: 0, root: "grounded", carries: true, turns: 1, at: [0, -FOUNDATION / 2, 0], plane: "upright", outline: rect(-SIDE / 2, -FOUNDATION, SIDE / 2, 0), thick: WALL, yieldBand: YIELD },
  trapdoor_frame: { ...FORMS.ceiling, closes: "doorway", takes: "hatch", openings: [{ x0: -HATCH / 2, x1: HATCH / 2, y0: -HATCH / 2, y1: HATCH / 2 }] },
  trapdoor: { ...hatchLeaf, closes: "full", at: [0, -HATCH_LEAF / 2, 0], outline: plan(-HATCH / 2, -HATCH / 2, HATCH), thick: HATCH_LEAF },
  // It hangs on the front of a wall, clear of its face and of a wood wall's straps, or under a hatch's side.
  ladder: { ...leaf, closes: "none", hangs: ["ladder", "hatch"], at: [0, STOREY / 2, 0], plane: "upright", outline: rect(-0.3, 0, 0.3, STOREY), thick: 0.12, off: WALL / 2 + 0.09 },
} satisfies Record<string, FormDef>;

const WIDE = {
  // Two edges with one opening, two door leaves wide, about the vertex between them.
  double_doorway: { ...wall, closes: "doorway", takes: "double", cells: [[0, 0], [1, 0]], at: [SIDE / 2, STOREY / 2, 0], outline: rect(-SIDE / 2, 0, (3 * SIDE) / 2, STOREY), openings: [doubleDoor] },
  large_wall: { ...wall, span: 16, closes: "full", takes: "ladder", cells: [[0, 0], [0, 4], [0, 8], [0, 12]], at: [0, 2 * STOREY, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, 4 * STOREY) },
  gateway: { ...wall, span: 8, closes: "doorway", takes: "gate", cells: gateCells, at: [SIDE / 2, GATE.high / 2, 0], outline: rect(-SIDE / 2, 0, (3 * SIDE) / 2, GATE.high), thick: GATE.thick, openings: [gateway] },
  gate: { ...leaf, span: 7, closes: "full", hangs: ["gate"], cells: gateCells, at: [SIDE / 2, gateway.y1 / 2, 0], plane: "upright", outline: rect(gateway.x0, 0, gateway.x1, gateway.y1), thick: WALL },
} satisfies Record<string, FormDef>;

/** Rows this work added to the 34 the tiers' recipes were written to: leaves stood open, and the double door. No tier draws them yet. */
const OPEN_HATCH = {
  // Open, the leaf hangs from its hinge along the hole's -Z side.
  trapdoor_open: { ...hatchLeaf, closes: "none", at: [0, -HATCH / 2, 0], outline: plan(-HATCH / 2, -HATCH / 2, HATCH, HATCH_LEAF), thick: HATCH },
} satisfies Record<string, FormDef>;
const WIDE_LEAVES = {
  double_door: { ...leaf, closes: "full", hangs: ["double"], cells: [[0, 0], [1, 0]], at: [SIDE / 2, DOOR.high / 2, 0], plane: "upright", outline: rect(doubleDoor.x0, 0, doubleDoor.x1, DOOR.high) },
  // Open, each leaf stands at a right angle at its own jamb.
  double_door_open: { ...leaf, closes: "none", hangs: ["double"], cells: [[0, 0], [1, 0]], at: [SIDE / 2, DOOR.high / 2, 0], plane: "across", outline: rect(0, 0, DOOR.wide, DOOR.high), off: doubleDoor.x0 + DOOR.thick / 2, pair: SIDE / 2 },
  gate_open: { ...leaf, span: 7, closes: "none", hangs: ["gate"], cells: gateCells, at: [SIDE / 2, gateway.y1 / 2, 0], plane: "across", outline: rect(0, 0, (gateway.x1 - gateway.x0) / 2, gateway.y1), thick: WALL, off: gateway.x0 + WALL / 2, pair: SIDE / 2 },
} satisfies Record<string, FormDef>;

/**
 * The 25 rows past the first nine, as wood's recipe draws them. The name is from before any was placed: the tiers'
 * recipes, assets and mesh tests read it, so it keeps its rows whichever are live. The corner pillar is the pillar's
 * own row: a pillar at a square's corner is the pillar in that slot, so it is no form and has no kind.
 */
export const PLANNED_FORMS = {
  half_wall: LOW.half_wall,
  quarter_wall: LOW.quarter_wall,
  railing: LOW.railing,
  corner_pillar: FORMS.pillar,
  thin_pillar: LOW.thin_pillar,
  beam: LOW.beam,
  ramp: SLOPES.ramp,
  ...TRIANGLES,
  quarter_foundation: { ...FORMS.foundation, size: 1, outline: plan(0, 0, SIDE / 2) },
  roof: SLOPES.roof,
  roof_hip: SLOPES.roof_hip,
  roof_valley: SLOPES.roof_valley,
  triangle_roof: SLOPES.triangle_roof,
  triangle_roof_low: SLOPES.triangle_roof_low,
  sloped_wall_left: SLOPES.sloped_wall_left,
  sloped_wall_right: SLOPES.sloped_wall_right,
  ...FOOTINGS,
  ...WIDE,
} satisfies Record<string, FormDef>;

/** The pieces content places, by the name of their shape. A row here that no tier draws is drawn as its collider. */
export const LIVE_FORMS = { ...FORMS, ...LOW } satisfies Record<string, FormDef>;

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox => ({ at: [x, y, z], half: [hx, hy, hz] });

/** The middle and half of a part from `lo` to `hi` of an outline from `least` to `most`, measured from the side it touches, about `origin`. */
function part(lo: number, hi: number, least: number, most: number, origin: number): [number, number] {
  const half = (hi - lo) / 2;
  return [hi === most && lo !== least ? most - origin - half : lo - origin + half, half];
}

/**
 * The boxes of a form whose outline is a rectangle, about its collider's origin: its steps, or what its openings leave.
 * The openings stand side by side: a column either side of each, then under and over each.
 */
export function formBoxes(f: FormDef): ShapeBox[] {
  const [u0, v0, u1, v1] = outlineBox(f);
  if (f.corner !== undefined || f.outline.length !== 4 || f.outline.some((p) => (p[0] !== u0 && p[0] !== u1) || (p[1] !== v0 && p[1] !== v1))) throw new Error("only a rectangle is made of boxes");
  // Along the outline's two coordinates and through it, as [middle, half] about the origin.
  const place = (u: [number, number], v: [number, number], w: [number, number]): ShapeBox =>
    f.plane === "flat" ? box(u[0], w[0], v[0], u[1], w[1], v[1]) : f.plane === "upright" ? box(u[0], v[0], w[0], u[1], v[1], w[1]) : box(w[0], v[0], u[0], w[1], v[1], u[1]);
  const [U, V, W] = f.plane === "flat" ? [0, 2, 1] : f.plane === "upright" ? [0, 1, 2] : [2, 1, 0];
  if (f.steps !== undefined) {
    // Each step is a block from the bottom up to its tread.
    return Array.from({ length: f.steps }, (_, i) => {
      const height = ((i + 1) * f.thick) / f.steps!;
      return place(part(u0, u1, u0, u1, f.at[U]!), [v0 - f.at[V]! + ((i + 0.5) * (v1 - v0)) / f.steps!, (v1 - v0) / f.steps! / 2], [-f.at[W]! + height / 2, height / 2]);
    });
  }
  const w: [number, number] = f.plane !== "flat" ? [(f.off ?? 0) - f.at[W]!, f.thick / 2] : part(f.span === 0 ? -f.thick : 0, f.span === 0 ? 0 : f.thick, NaN, NaN, f.at[W]!);
  // An open double door: the same leaf again, mirrored about its pair's X.
  const twin: [number, number] | null = f.pair === undefined ? null : [2 * f.pair - (f.off ?? 0) - f.at[W]!, f.thick / 2];
  const cuts = [...(f.openings ?? [])].sort((a, b) => a.x0 - b.x0);
  const across = (lo: number, hi: number): [number, number] => part(lo, hi, u0, u1, f.at[U]!);
  const up = (lo: number, hi: number): [number, number] => part(lo, hi, v0, v1, f.at[V]!);
  const out: ShapeBox[] = [];
  let from = u0;
  for (const c of [...cuts, { x0: u1, x1: u1 }]) {
    if (c.x0 > from) out.push(place(across(from, c.x0), up(v0, v1), w));
    from = c.x1;
  }
  for (const c of cuts) {
    if (c.y0 > v0) out.push(place(across(c.x0, c.x1), up(v0, c.y0), w));
    if (c.y1 < v1) out.push(place(across(c.x0, c.x1), up(c.y1, v1), w));
  }
  if (twin) out.push(place(across(u0, u1), up(v0, v1), twin));
  return out;
}

/** A corner (x, y, z) in metres about a form's origin as a convex part writes it, on 60 degree axes for a triangle. */
function hullCorner(f: FormDef, x: number, y: number, z: number): [number, number, number] {
  const [a, b, c] = [x - f.at[0], y - f.at[1], z - f.at[2]];
  if (f.cls !== "triangle") return [a, b, c];
  const second = c / (Math.sqrt(3) / 2);
  return [Math.round((a - second / 2) * 1e9) / 1e9, b, Math.round(second * 1e9) / 1e9];
}

/**
 * The convex parts of a form that is no rectangle of boxes, about its collider's origin: a sloped wall, a triangle, a
 * ramp or a roof. A hip or a valley is two, folded on the diagonal through its odd corner.
 */
export function formHulls(f: FormDef): HullDef[] {
  const sixty = f.cls === "triangle";
  if (f.plane !== "flat") {
    const w = [(f.off ?? 0) - f.thick / 2, (f.off ?? 0) + f.thick / 2];
    return [{ corners: f.outline.flatMap(([u, v]) => w.map((z) => (f.plane === "upright" ? hullCorner(f, u, v, z) : hullCorner(f, z, v, u)))) }];
  }
  const n = f.outline.length;
  const top = (k: number): number => (f.corner ? f.corner[k]! : f.span === 0 ? 0 : f.thick);
  const under = (k: number): number => (f.span === 0 ? top(k) - f.thick : 0);
  const part = (ks: readonly number[]): HullDef => ({
    ...(sixty ? { sixty } : {}),
    corners: ks.flatMap((k) => {
      const [u, v] = f.outline[k]!;
      return top(k) - under(k) > 1e-9 ? [hullCorner(f, u, under(k), v), hullCorner(f, u, top(k), v)] : [hullCorner(f, u, under(k), v)];
    }),
  });
  // Four corners with one apart from the other three lie in no plane.
  const odd = n === 4 && f.corner ? f.corner.findIndex((h, k) => f.corner!.filter((o) => Math.abs(o - h) < 1e-9).length === 1 && f.corner!.filter((o) => Math.abs(o - f.corner![(k + 1) % 4]!) < 1e-9).length === 3) : -1;
  if (odd < 0) return [part(f.outline.map((_, k) => k))];
  return [part([odd, (odd + 1) % 4, (odd + 2) % 4]), part([odd, (odd + 2) % 4, (odd + 3) % 4])];
}

/** Whether a form's collider is boxes: a rectangle with no slope. */
export function boxed(f: FormDef): boolean {
  const [u0, v0, u1, v1] = outlineBox(f);
  return f.corner === undefined && f.outline.length === 4 && f.outline.every((p) => (p[0] === u0 || p[0] === u1) && (p[1] === v0 || p[1] === v1));
}

/** Every row by its name, placed or not: for tools and tests that name a row whichever it is. */
export const ALL_FORMS = { ...FORMS, ...PLANNED_FORMS, ...OPEN_HATCH, ...WIDE_LEAVES };
