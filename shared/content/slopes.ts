// Sloped forms for shapes: ramps, stair flights, pitched roofs and leaning slabs, each as convex parts (shared/world/convex.ts)
// centred on the box that holds them, so a shape made of one is placed by its middle as a box is. Every form rises toward the
// shape's second axis (+Z) and spans its first (X). Corners are worked out with the deterministic sine, so every engine
// compiles the same numbers.

import { PI, detCos, detSin } from "../math/scalar.ts";
import type { HullDef } from "../world/convex.ts";
import { shapeHalf, type PieceRole, type ShapeBox, type ShapeDef, type StructureDef } from "./defs.ts";

type Corner = [number, number, number];

/**
 * The part between the heights `lo(z)` and `hi(z)` over a rectangle `wide` across, from the first of `zs` to the last, bent at
 * the others. Where the two heights meet, the two corners are one.
 */
function prism(wide: number, zs: readonly number[], lo: (z: number) => number, hi: (z: number) => number): HullDef {
  const corners: Corner[] = [];
  for (const z of zs) {
    for (const x of [-wide / 2, wide / 2]) {
      corners.push([x, lo(z), z]);
      if (hi(z) - lo(z) > 1e-9) corners.push([x, hi(z), z]);
    }
  }
  return { corners };
}

/** A ramp solid down to its flat foot: `wide` across, rising `rise` over `run`. Its low edge is a line on the ground. */
export function wedge(wide: number, run: number, rise: number): HullDef {
  return prism(wide, [-run / 2, run / 2], () => -rise / 2, (z) => (z * rise) / run);
}

/**
 * A slab `thick` thick measured straight up, rising `rise` over `run` from the top of its low end to the top of its high end,
 * open below: a ramp on piers, a bridge approach, one slope of a roof. Its ends are upright.
 */
export function slopedSlab(wide: number, run: number, rise: number, thick: number): HullDef {
  const line = (z: number): number => (z * rise) / run + thick / 2;
  return prism(wide, [-run / 2, run / 2], (z) => line(z) - thick, line);
}

/**
 * A box of half extents `half` turned `degrees` about its first axis, its +Z end raised: a floor slab that fell and leans on the
 * one below, a wall gone over. Its corners keep the box's square ends, unlike a sloped slab's upright ones.
 */
export function leaning(half: readonly [number, number, number], degrees: number): HullDef {
  const a = (degrees * PI) / 180;
  const c = detCos(a);
  const s = detSin(a);
  const corners: Corner[] = [];
  for (const z of [-half[2], half[2]]) for (const y of [-half[1], half[1]]) for (const x of [-half[0], half[0]]) corners.push([x, y * c + z * s, z * c - y * s]);
  return { corners };
}

/** A solid gable: two slopes meeting at a ridge along the first axis, `rise` over the eaves, `run` from eave to eave. */
export function gable(wide: number, run: number, rise: number): HullDef {
  const corners: Corner[] = [];
  for (const x of [-wide / 2, wide / 2]) corners.push([x, -rise / 2, -run / 2], [x, -rise / 2, run / 2], [x, rise / 2, 0]);
  return { corners };
}

/**
 * A pitched roof as two slabs `thick` thick (straight up) meeting at a ridge along the first axis, `run` from eave to eave,
 * the ridge's top `rise` over the eaves' tops. Open below, as a roof is.
 */
export function pitchedRoof(wide: number, run: number, rise: number, thick: number): HullDef[] {
  const half = run / 2;
  const top = (z: number): number => (rise + thick) / 2 - (Math.abs(z) * rise) / half;
  return [-half, half].map((eave) => prism(wide, eave < 0 ? [eave, 0] : [0, eave], (z) => top(z) - thick, top));
}

/** How a flight of stairs is built: solid down to its foot, or a slab open below (on stringers, between landings). */
export interface FlightOptions {
  /** Risers. The last is the edge of the landing the flight reaches, which is not part of it. */
  readonly steps: number;
  /**
   * Omitted, the flight is solid. Else its slab's thickness straight up below the line through its nosings, at least two
   * risers; it ends at the level of the flight's foot.
   */
  readonly slab?: number;
}

/**
 * A flight of stairs as one piece: `wide` across, rising `rise` over `run`. Bodies walk a ramp through the nosings of its
 * steps, from its foot at the low edge to its top edge, where the landing's edge is the last nosing; so nothing catches on a
 * step and a foot never sinks into one. The steps are drawn under that ramp: `steps` risers make steps - 1 treads, the floor
 * before the first riser and the landing after the last being the others. Far off it is drawn as the ramp it is walked as.
 */
export function stairFlight(id: string, wide: number, run: number, rise: number, o: FlightOptions): ShapeDef {
  const n = o.steps;
  const d = run / n;
  const h = rise / n;
  if (!(Number.isInteger(n) && n >= 2)) throw new Error(`${id}: a flight has two risers or more`);
  if (o.slab !== undefined && !(o.slab >= 2 * h)) throw new Error(`${id}: a flight's slab is at least two risers thick`);
  const foot = -rise / 2;
  const line = (z: number): number => foot + ((z + run / 2) * rise) / run;
  const boxes: ShapeBox[] = [];
  for (let k = 1; k < n; k++) {
    const top = foot + k * h;
    // Solid, a block from the foot up to the tread. On a slab, a riser's height, its lower back corner on the soffit's top.
    const bottom = o.slab === undefined ? foot : top - h;
    boxes.push({ at: [0, (top + bottom) / 2, -run / 2 + (k + 0.5) * d], half: [wide / 2, (top - bottom) / 2, d / 2] });
  }
  if (o.slab === undefined) return { type: "shape", id, role: "stairs", boxes: [], hulls: [wedge(wide, run, rise)], look: { boxes } };
  // The slab's underside, flat at the foot's level until it rises clear of it.
  const slab = o.slab;
  const under = (z: number): number => Math.max(line(z) - slab, foot);
  const bend = ((slab + foot) * run) / rise;
  const zs = (from: number): number[] => (bend > from && bend < run / 2 ? [from, bend, run / 2] : [from, run / 2]);
  const walked = prism(wide, zs(-run / 2), under, line);
  // Under the steps, the soffit: from a riser below the nosings, where the steps' blocks reach, down to the underside.
  const soffit = prism(wide, zs(-run / 2 + d), under, (z) => line(z) - h);
  return { type: "shape", id, role: "stairs", boxes: [], hulls: [walked], look: { boxes, hulls: [soffit] } };
}

/** A shape of sloped parts and boxes. */
export function slopeShape(id: string, role: PieceRole, hulls: readonly HullDef[], boxes: readonly ShapeBox[] = []): ShapeDef {
  return { type: "shape", id, role, boxes, hulls };
}

/** A static piece of a map with the form of `shape`, its `half` the box that holds it. */
export function staticOf(id: string, shape: ShapeDef, finish: { readonly color: number; readonly hp: number; readonly material?: string }): StructureDef {
  return { type: "structure", class: "static", id, mesh: "shape", shape: shape.id, half: shapeHalf(shape.boxes, shape.hulls, shape.look), ...finish };
}
