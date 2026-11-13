// What survivors build with: the pieces of a house, in four materials.
//
// A piece's form is a shape, shared by every material it is made in; the
// material says what it is worth in health and what harms it. Sizes and
// health are the reference's: a foundation is three metres square, a wall
// three by three, a storey 3.2 from floor to floor.

import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox => ({ at: [x, y, z], half: [hx, hy, hz] });

/** A side of a piece, a wall's height and thickness, and how thick a floor is: metres. */
export const SPAN = 3;
export const WALL_HEIGHT = 3;
export const WALL_THICK = 0.2;
export const FLOOR_THICK = 0.2;
export const FOUNDATION_THICK = 0.3;
/** The doorway: wide enough for a survivor with room to spare, and higher than one stands. */
export const DOOR_WIDTH = 1.4;
export const DOOR_HEIGHT = 2.3;
/** The window: at the height of a standing survivor's eyes, and too low for any body to get through, even lying down in a jump. */
const WINDOW_WIDTH = 1.2;
const WINDOW_SILL = 1.2;
const WINDOW_HEIGHT = 0.7;
const STEPS = 10;

const H = SPAN / 2;
const WH = WALL_HEIGHT / 2;
const T = WALL_THICK / 2;
const post = (SPAN - DOOR_WIDTH) / 4;
const lintel = (WALL_HEIGHT - DOOR_HEIGHT) / 2;
const jamb = (SPAN - WINDOW_WIDTH) / 4;
/** From one floor to the next: a wall and the ceiling on it. */
const RISE = WALL_HEIGHT + FLOOR_THICK;

const shape = (name: string, role: ShapeDef["role"], boxes: ShapeBox[]): ShapeDef => ({ type: "shape", id: `core:shape_${name}`, role, boxes });

const SHAPES: readonly ShapeDef[] = [
  shape("foundation", "foundation", [box(0, 0, 0, H, FOUNDATION_THICK / 2, H)]),
  shape("wall", "wall", [box(0, 0, 0, H, WH, T)]),
  // A wall with a doorway: a post either side and the piece above.
  shape("doorframe", "wall", [box(-H + post, 0, 0, post, WH, T), box(H - post, 0, 0, post, WH, T), box(0, WH - lintel, 0, DOOR_WIDTH / 2, lintel, T)]),
  // A wall with a window: a post either side, the piece below the sill, and the piece above.
  shape("windowframe", "wall", [
    box(-H + jamb, 0, 0, jamb, WH, T),
    box(H - jamb, 0, 0, jamb, WH, T),
    box(0, -WH + WINDOW_SILL / 2, 0, WINDOW_WIDTH / 2, WINDOW_SILL / 2, T),
    box(0, WH - (WALL_HEIGHT - WINDOW_SILL - WINDOW_HEIGHT) / 2, 0, WINDOW_WIDTH / 2, (WALL_HEIGHT - WINDOW_SILL - WINDOW_HEIGHT) / 2, T),
  ]),
  shape("ceiling", "ceiling", [box(0, 0, 0, H, FLOOR_THICK / 2, H)]),
  shape("pillar", "pillar", [box(0, 0, 0, 0.25, WH, 0.25)]),
  // A door fills its doorway. Open, it stands at a right angle on its hinge, at the doorway's left as seen from in front.
  shape("door", "door", [box(0, 0, 0, DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0.04)]),
  shape("door_open", "door", [box(-DOOR_WIDTH / 2 + 0.04, 0, DOOR_WIDTH / 2, 0.04, DOOR_HEIGHT / 2, DOOR_WIDTH / 2)]),
  // Stairs: ten steps from one floor to the next, each a block from the bottom up to its tread. They rise toward +Z.
  shape(
    "stairs",
    "stairs",
    Array.from({ length: STEPS }, (_, i) => {
      const height = ((i + 1) * RISE) / STEPS;
      return box(0, -RISE / 2 + height / 2, -H + ((i + 0.5) * SPAN) / STEPS, H, height / 2, SPAN / STEPS / 2);
    }),
  ),
];

interface Tier {
  readonly name: string;
  readonly color: number;
  /** Health of each piece it is made in. */
  readonly hp: { readonly [piece: string]: number };
}

/** Wood, stone and metal are made in every piece, at the same health; thatch in few, and weaker. */
const FULL = { foundation: 15000, wall: 10000, doorframe: 10000, windowframe: 10000, ceiling: 10000, pillar: 6250, door: 6250, stairs: 10000 };
const TIERS: readonly Tier[] = [
  { name: "thatch", color: 18, hp: { foundation: 2400, wall: 1600, doorframe: 1600, ceiling: 1600, door: 1000 } },
  { name: "wood", color: 3, hp: FULL },
  { name: "stone", color: 5, hp: FULL },
  { name: "metal", color: 11, hp: FULL },
];

function piece(tier: Tier, name: string, shapeName = name): StructureDef {
  const form = SHAPES.find((s) => s.id === `core:shape_${shapeName}`)!;
  return { type: "structure", id: `core:${name}_${tier.name}`, mesh: "shape", shape: form.id, half: shapeHalf(form.boxes), color: tier.color, hp: tier.hp[name.replace("_open", "")]!, material: `core:mat_${tier.name}` };
}

export const BUILDING_CONTENT: readonly Def[] = [
  ...SHAPES,
  ...TIERS.flatMap((tier) => [
    ...Object.keys(tier.hp).map((name) => piece(tier, name)),
    // A door stood open is another kind of thing in the same place.
    piece(tier, "door_open"),
  ]),
];
