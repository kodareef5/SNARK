// Shapes: the form of a built piece, shared by every material. What bodies walk on and what joins what.

import { REGION_BASE } from "../../pack/palette.ts";
import { hullFault, hullPoint, type HullDef } from "../../world/convex.ts";
import type { Content } from "../defs.ts";
import { f, row, type Fields, type Kind, type Named } from "../kind.ts";

/** The furthest a structure, a node or any box of one may reach from its origin along an axis, in metres. */
export const MAX_STRUCTURE_HALF = 16;
export const MAX_SHAPE_BOXES = 16;
/** What a shape's look may draw: a flight's treads. */
export const MAX_LOOK_PARTS = 64;

/** `at` is the centre, measured from the piece's origin. `half` is the half extents. Both are in metres. */
export interface ShapeBox {
  readonly at: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  /** In a look only: a palette colour of its own in place of its piece's, such as a pane's or a rail's. */
  readonly color?: number;
}

/** The role decides what a piece may join and what may join it. */
export type PieceRole = "foundation" | "wall" | "ceiling" | "pillar" | "door" | "stairs" | "thing";
/** A "thing" joins nothing. It is set down on the ground or a floor and stands on what is under it. */
export const PIECE_ROLES: readonly PieceRole[] = ["foundation", "wall", "ceiling", "pillar", "door", "stairs", "thing"];

/** The form of a built piece, shared by every material. Bodies walk on its boxes and convex parts, and rays stop at them. */
export interface ShapeDef extends Named {
  readonly type: "shape";
  readonly id: string;
  readonly role: PieceRole;
  readonly boxes: readonly ShapeBox[];
  /**
   * Convex parts besides the boxes, for a ramp, a sloped roof or a triangle: each the hull of its corners, in metres from the
   * piece's origin along its first axis, up and along its second. A shape with parts may have no boxes.
   */
  readonly hulls?: readonly HullDef[];
  /**
   * What is drawn in place of the boxes and parts, where that is not what bodies and rays meet: a flight of stairs walked as
   * a ramp and drawn as treads. Far off, past the nearest level, the boxes and parts are drawn.
   */
  readonly look?: ShapeLook;
  /** A door may be set in it. */
  readonly doorway?: boolean;
}

export interface ShapeLook {
  readonly boxes?: readonly ShapeBox[];
  readonly hulls?: readonly HullDef[];
}

/** Half extents of the box, centred on a shape's origin, that holds all of its boxes and convex parts, and what is drawn of it. */
export function shapeHalf(boxes: readonly ShapeBox[], hulls: readonly HullDef[] = [], look?: ShapeLook): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  holdBoxes(out, boxes);
  if (look?.boxes) holdBoxes(out, look.boxes);
  holdHulls(out, hulls);
  if (look?.hulls) holdHulls(out, look.hulls);
  return out;
}

function holdBoxes(out: [number, number, number], boxes: readonly ShapeBox[]): void {
  for (const b of boxes) for (let a = 0; a < 3; a++) out[a] = Math.max(out[a]!, Math.abs(b.at[a]!) + b.half[a]!);
}

const corner: [number, number, number] = [0, 0, 0];

function holdHulls(out: [number, number, number], hulls: readonly HullDef[]): void {
  for (const h of hulls) {
    for (const c of h.corners) {
      const p = hullPoint(c, h.sixty === true, corner);
      for (let a = 0; a < 3; a++) out[a] = Math.max(out[a]!, Math.abs(p[a]!));
    }
  }
}

/** Every shape by its id. */
export const shapesById = (input: readonly Content[]): Map<string, ShapeDef> => new Map(input.flatMap((d) => (d.type === "shape" ? [[d.id, d] as const] : [])));

const FIELDS = {
  role: f("text", "the snap type"),
  boxes: f("list"),
  hulls: f("list"),
  look: f("facet"),
  doorway: f("switch"),
} satisfies Fields<ShapeDef>;

export const shapes: Kind<ShapeDef> = {
  type: "shape",
  fields: FIELDS,
  rows: [
    row("shape", "shape", FIELDS, { ark: "snap points and collision", shelf: "shapes", must: ["role", "boxes"], may: ["doorway", "hulls", "look"], doc: "The form of a piece, shared by every material: what bodies walk on and what joins what." }),
  ],
  check(d, { errors, positive }) {
    if (!PIECE_ROLES.includes(d.role)) errors.push(`${d.id}: role must be one of ${PIECE_ROLES.join(", ")}`);
    const parts = d.boxes.length + (d.hulls?.length ?? 0);
    if (parts < 1 || parts > MAX_SHAPE_BOXES) errors.push(`${d.id}: a shape has 1 to ${MAX_SHAPE_BOXES} boxes and convex parts`);
    const drawn = (d.look?.boxes?.length ?? 0) + (d.look?.hulls?.length ?? 0);
    if (d.look !== undefined && (drawn < 1 || drawn > MAX_LOOK_PARTS)) errors.push(`${d.id}: a look has 1 to ${MAX_LOOK_PARTS} boxes and convex parts`);
    if (d.boxes.some((b) => b.color !== undefined)) errors.push(`${d.id}: only a look's boxes have colours of their own`);
    for (const b of d.look?.boxes ?? []) if (b.color !== undefined && !(Number.isInteger(b.color) && b.color > 0 && b.color < REGION_BASE)) errors.push(`${d.id}: a box's colour is a fixed palette colour`);
    for (const b of [...d.boxes, ...(d.look?.boxes ?? [])]) {
      for (let a = 0; a < 3; a++) {
        positive(d, `a box's half[${a}]`, b.half[a]!, MAX_STRUCTURE_HALF);
        if (!(Math.abs(b.at[a]!) + b.half[a]! <= MAX_STRUCTURE_HALF)) errors.push(`${d.id}: a box reaches further than ${MAX_STRUCTURE_HALF} m from the origin`);
      }
    }
    const hulls = d.look?.hulls ? [...(d.hulls ?? []), ...d.look.hulls] : (d.hulls ?? []);
    for (const h of hulls) {
      const fault = hullFault(h);
      if (fault !== "") errors.push(`${d.id}: ${fault}`);
    }
    // One box about them all says whether any reaches too far; then each is asked, so each that does is listed.
    if (shapeHalf([], hulls).some((v) => !(v <= MAX_STRUCTURE_HALF))) for (const h of hulls) if (shapeHalf([], [h]).some((v) => !(v <= MAX_STRUCTURE_HALF))) errors.push(`${d.id}: a convex part reaches further than ${MAX_STRUCTURE_HALF} m from the origin`);
  },
};
