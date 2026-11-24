// The forms of built pieces: one row each, with every dimension written once. content/building.ts makes its colliders
// from FORMS, and the mesh generator reads the same rows. PLANNED_FORMS are rows no kind or item uses yet.
// What each field means is in shared/world/lattice/forms.ts.

import type { ShapeBox } from "../../shared/content/defs.ts";
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

/** The pieces content places today, by the name of their shape. */
export const FORMS = {
  foundation: { cls: "square", ...slab, root: "always", carries: true, turns: 1, at: [0, -FOUNDATION / 2, 0], outline: square, thick: FOUNDATION, yieldBand: 0 },
  wall: { ...wall, closes: "full" },
  doorframe: { ...wall, closes: "doorway", openings: [doorway] },
  windowframe: { ...wall, closes: "window", openings: [{ x0: -WINDOW.wide / 2, x1: WINDOW.wide / 2, y0: WINDOW.sill, y1: WINDOW.sill + WINDOW.high }] },
  ceiling: { cls: "square", ...slab, turns: 1, at: [0, -FLOOR / 2, 0], outline: square, thick: FLOOR, yieldBand: YIELD },
  pillar: { cls: "vertex", layer: "post", span: 4, root: "grounded", carries: true, need: 1, turns: 1, at: [0, STOREY / 2, 0], plane: "flat", outline: plan(-PILLAR / 2, -PILLAR / 2, PILLAR), thick: STOREY, yieldBand: 0 },
  door: { ...leaf, closes: "full", plane: "upright", outline: rect(-DOOR.wide / 2, 0, DOOR.wide / 2, DOOR.high) },
  // An open door stands at a right angle on its hinge, at the doorway's left as seen from the front.
  door_open: { ...leaf, closes: "none", plane: "across", outline: rect(0, 0, DOOR.wide, DOOR.high), off: -DOOR.wide / 2 + DOOR.thick / 2 },
  // The stairs rise toward +Z.
  stairs: { ...flight, thick: STOREY, steps: STEPS },
} satisfies Record<string, FormDef>;

/** A roof rises half a storey over a side. */
const ROOF_RISE = 2 * LEVEL;
/** Short of a storey, so the slope is under the steepest a survivor stands on. */
const RAMP_RISE = STOREY - 0.06;
const GATE = { post: 0.5, lintel: 0.75, thick: 0.4, high: 2 * STOREY };
const HATCH = SIDE / 2;

/** A roof's sides from its corner heights, as shared/world/lattice/forms.ts reads them. */
const sides = (corner: readonly number[]): FormEdge[] => corner.map((from, k) => {
  const to = corner[(k + 1) % corner.length]!;
  return { lvl: Math.min(from, to) / LEVEL, profile: from === to ? "flat" : from > to ? "slopeL" : "slopeR" };
});
const roof = (cls: "square" | "triangle", corner: readonly number[], turns: 1 | 2 | 3 | 4): FormDef => ({ cls, ...slab, turns, at: [0, (ROOF_RISE - FLOOR) / 2, 0], outline: cls === "square" ? square : triangle, thick: FLOOR, corner, edges: sides(corner), yieldBand: YIELD });
const R = ROOF_RISE;

/** Rows for pieces to come. Each is checked as content's are, and nothing reads them yet. */
export const PLANNED_FORMS = {
  half_wall: { ...wall, span: 2, closes: "none", at: [0, LEVEL, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, 2 * LEVEL) },
  quarter_wall: { ...wall, span: 1, closes: "none", at: [0, LEVEL / 2, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, LEVEL) },
  railing: { ...wall, span: 1, carries: false, closes: "none", at: [0, LEVEL / 2, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, LEVEL), thick: 0.1 },
  // The pillar's shaft in a corner of a square. Which vertices offer it is placing's to say.
  corner_pillar: FORMS.pillar,
  thin_pillar: { ...FORMS.pillar, outline: plan(-0.15, -0.15, 0.3) },
  // Its top is level with the top of the wall it stands in for.
  beam: { ...wall, span: 1, carries: false, closes: "none", turns: 1, at: [0, LEVEL - 0.25, 0], outline: rect(-SIDE / 2, LEVEL - 0.5, SIDE / 2, LEVEL), thick: 0.3 },
  ramp: { ...flight, thick: RAMP_RISE, corner: [RAMP_RISE, RAMP_RISE, 0, 0] },
  triangle_foundation: { ...FORMS.foundation, cls: "triangle", outline: triangle },
  triangle_ceiling: { ...FORMS.ceiling, cls: "triangle", outline: triangle },
  quarter_foundation: { ...FORMS.foundation, size: 1, outline: plan(0, 0, SIDE / 2) },
  // A slope rises toward +Z. A hip has one corner up and a valley one down, each folded on the diagonal through it.
  roof: roof("square", [R, R, 0, 0], 4),
  roof_hip: roof("square", [R, 0, 0, 0], 4),
  roof_valley: roof("square", [R, R, 0, R], 4),
  triangle_roof: roof("triangle", [0, R, 0], 3),
  triangle_roof_low: roof("triangle", [R, 0, R], 3),
  // The gable under a roof's sloped side, high at its left or its right as seen from the front.
  sloped_wall_left: { ...wall, span: 2, carries: false, closes: "full", at: [0, LEVEL, 0], outline: [[-SIDE / 2, 0], [SIDE / 2, 0], [-SIDE / 2, R]], edges: [{ lvl: 0, profile: "slopeL" }] },
  sloped_wall_right: { ...wall, span: 2, carries: false, closes: "full", at: [0, LEVEL, 0], outline: [[-SIDE / 2, 0], [SIDE / 2, 0], [SIDE / 2, R]], edges: [{ lvl: 0, profile: "slopeR" }] },
  fence_foundation: { cls: "edge", layer: "footing", span: 0, root: "grounded", carries: true, turns: 1, at: [0, -FOUNDATION / 2, 0], plane: "upright", outline: rect(-SIDE / 2, -FOUNDATION, SIDE / 2, 0), thick: WALL, yieldBand: YIELD },
  trapdoor_frame: { ...FORMS.ceiling, closes: "doorway", openings: [{ x0: -HATCH / 2, x1: HATCH / 2, y0: -HATCH / 2, y1: HATCH / 2 }] },
  trapdoor: { cls: "square", layer: "leaf", span: 0, closes: "full", turns: 4, at: [0, -1 / 32, 0], plane: "flat", outline: plan(-HATCH / 2, -HATCH / 2, HATCH), thick: 1 / 16, yieldBand: 0 },
  // It hangs on the front of a wall, clear of its face.
  ladder: { ...leaf, closes: "none", at: [0, STOREY / 2, 0], plane: "upright", outline: rect(-0.3, 0, 0.3, STOREY), thick: 0.1, off: WALL / 2 + 0.05 },
  // Two edges with one opening, two door leaves wide, about the vertex between them.
  double_doorway: { ...wall, closes: "doorway", cells: [[0, 0], [1, 0]], at: [SIDE / 2, STOREY / 2, 0], outline: rect(-SIDE / 2, 0, (3 * SIDE) / 2, STOREY), openings: [{ x0: SIDE / 2 - DOOR.wide, x1: SIDE / 2 + DOOR.wide, y0: 0, y1: DOOR.high }] },
  large_wall: { ...wall, span: 16, closes: "full", cells: [[0, 0], [0, 4], [0, 8], [0, 12]], at: [0, 2 * STOREY, 0], outline: rect(-SIDE / 2, 0, SIDE / 2, 4 * STOREY) },
  gateway: { ...wall, span: 8, closes: "doorway", cells: [[0, 0], [0, 4], [1, 0], [1, 4]], at: [SIDE / 2, GATE.high / 2, 0], outline: rect(-SIDE / 2, 0, (3 * SIDE) / 2, GATE.high), thick: GATE.thick, openings: [{ x0: -SIDE / 2 + GATE.post, x1: (3 * SIDE) / 2 - GATE.post, y0: 0, y1: GATE.high - GATE.lintel }] },
  gate: { ...leaf, span: 7, closes: "full", cells: [[0, 0], [0, 4], [1, 0], [1, 4]], at: [SIDE / 2, (GATE.high - GATE.lintel) / 2, 0], plane: "upright", outline: rect(-SIDE / 2 + GATE.post, 0, (3 * SIDE) / 2 - GATE.post, GATE.high - GATE.lintel), thick: WALL },
} satisfies Record<string, FormDef>;

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
  return out;
}
