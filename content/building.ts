// What survivors build with: the pieces of a house, in four materials.
//
// A piece's form is a shape, shared by every material it is made in; the
// material says what it is worth in health and what harms it. Sizes and
// health are the reference's: a foundation is three metres square and a wall
// three by three. Every height here is a whole number of 1/256 m, so that a
// piece set on another stands exactly on the lattice structures are kept on.

import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox => ({ at: [x, y, z], half: [hx, hy, hz] });

/** A side of a piece, a wall's height and thickness, and how thick a floor is: metres. */
export const SPAN = 3;
export const WALL_HEIGHT = 3;
export const WALL_THICK = 0.2;
export const FLOOR_THICK = 0.25;
export const FOUNDATION_THICK = 0.375;
/** The doorway: wide enough for a survivor with room to spare, and higher than one stands. */
export const DOOR_WIDTH = 1.4;
export const DOOR_HEIGHT = 2.3125;
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
/** From one floor to the next: a wall's height. A ceiling's top is level with the top of the walls that hold it. */
export const RISE = WALL_HEIGHT;

const shape = (name: string, role: ShapeDef["role"], boxes: ShapeBox[]): ShapeDef => ({ type: "shape", id: `core:shape_${name}`, role, boxes });

const SHAPES: readonly ShapeDef[] = [
  shape("foundation", "foundation", [box(0, 0, 0, H, FOUNDATION_THICK / 2, H)]),
  shape("wall", "wall", [box(0, 0, 0, H, WH, T)]),
  // A wall with a doorway: a post either side and the piece above.
  { ...shape("doorframe", "wall", [box(-H + post, 0, 0, post, WH, T), box(H - post, 0, 0, post, WH, T), box(0, WH - lintel, 0, DOOR_WIDTH / 2, lintel, T)]), doorway: true },
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

type Needs = readonly (readonly [item: string, count: number])[];

/** What each piece costs to make in each material, the level at which its engram may be learnt, and the points that takes. */
interface Making {
  readonly label: string;
  readonly weight: number;
  readonly cost: number;
  readonly pieces: { readonly [piece: string]: { readonly level: number; readonly needs: Needs } };
}

const MAKING: { readonly [tier: string]: Making } = {
  thatch: {
    label: "Thatch",
    weight: 2,
    cost: 3,
    pieces: {
      foundation: { level: 4, needs: [["thatch", 20], ["wood", 6], ["fiber", 15]] },
      wall: { level: 4, needs: [["thatch", 10], ["wood", 2], ["fiber", 7]] },
      ceiling: { level: 4, needs: [["thatch", 15], ["wood", 4], ["fiber", 10]] },
      door: { level: 4, needs: [["thatch", 7], ["wood", 2], ["fiber", 4]] },
    },
  },
  wood: {
    label: "Wooden",
    weight: 4,
    cost: 6,
    pieces: {
      foundation: { level: 11, needs: [["wood", 80], ["thatch", 20], ["fiber", 15]] },
      wall: { level: 11, needs: [["wood", 40], ["thatch", 10], ["fiber", 7]] },
      ceiling: { level: 12, needs: [["wood", 60], ["thatch", 15], ["fiber", 10]] },
      door: { level: 13, needs: [["wood", 20], ["thatch", 7], ["fiber", 4]] },
      pillar: { level: 13, needs: [["wood", 40], ["thatch", 10], ["fiber", 7]] },
      stairs: { level: 14, needs: [["wood", 60], ["thatch", 15], ["fiber", 10]] },
    },
  },
  stone: {
    label: "Stone",
    weight: 6,
    cost: 8,
    pieces: {
      foundation: { level: 24, needs: [["stone", 80], ["wood", 40], ["thatch", 30]] },
      wall: { level: 24, needs: [["stone", 40], ["wood", 20], ["thatch", 15]] },
      ceiling: { level: 25, needs: [["stone", 60], ["wood", 30], ["thatch", 20]] },
      door: { level: 26, needs: [["stone", 20], ["wood", 10], ["thatch", 7]] },
      pillar: { level: 26, needs: [["stone", 40], ["wood", 20], ["thatch", 15]] },
      stairs: { level: 27, needs: [["stone", 60], ["wood", 30], ["thatch", 20]] },
    },
  },
  metal: {
    label: "Metal",
    weight: 4,
    cost: 12,
    pieces: {
      foundation: { level: 45, needs: [["ingot", 50], ["paste", 15]] },
      wall: { level: 45, needs: [["ingot", 25], ["paste", 7]] },
      ceiling: { level: 46, needs: [["ingot", 35], ["paste", 10]] },
      door: { level: 47, needs: [["ingot", 20], ["paste", 4]] },
      pillar: { level: 46, needs: [["ingot", 25], ["paste", 7]] },
      stairs: { level: 47, needs: [["ingot", 35], ["paste", 10]] },
    },
  },
};

/** The item for a piece, what it is set down as, the recipe that makes it and the engram that teaches the recipe. A wall is also set down as a doorframe or a windowframe, where the material has them. */
function kit(tier: Tier, name: string): Def[] {
  const m = MAKING[tier.name]!;
  const forms = name === "wall" ? ["wall", "doorframe", "windowframe"].filter((f) => f in tier.hp) : [name];
  const item = `core:piece_${name}_${tier.name}`;
  const label = `${m.label} ${name}`;
  const { level, needs } = m.pieces[name]!;
  return [
    { type: "item", id: item, stack: 100, weight: m.weight, label: label.toLowerCase(), color: tier.color, places: forms.map((f) => `core:${f}_${tier.name}`) },
    { type: "recipe", id: `core:make-piece_${name}_${tier.name}`, makes: item, count: 1, needs: needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: Math.max(1, Math.round(level / 3)) },
    { type: "engram", id: `core:engram-piece_${name}_${tier.name}`, label, level, cost: m.cost, unlocks: [`core:make-piece_${name}_${tier.name}`] },
  ];
}

export const BUILDING_CONTENT: readonly Def[] = [
  ...SHAPES,
  ...TIERS.flatMap((tier) => [
    ...Object.keys(tier.hp).map((name) => piece(tier, name)),
    // A door stood open is another kind of thing in the same place.
    piece(tier, "door_open"),
    ...Object.keys(MAKING[tier.name]!.pieces).flatMap((name) => kit(tier, name)),
  ]),
  // What holds metal together: ground shell and stone.
  { type: "item", id: "core:paste", stack: 100, weight: 0.01, label: "cementing paste", color: 15 },
  { type: "recipe", id: "core:make-paste", makes: "core:paste", count: 1, needs: [{ item: "core:chitin", count: 4 }, { item: "core:stone", count: 8 }], seconds: 2, xp: 2 },
  { type: "engram", id: "core:engram-paste", label: "Cementing paste", level: 15, cost: 3, unlocks: ["core:make-paste"] },
];
