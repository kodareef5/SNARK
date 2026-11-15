// Sizes and health are the reference game's. Every piece height is a whole number of 1/256 m, so a piece set
// on another stands exactly on the structure lattice.

import { crafting } from "./craft.ts";
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox => ({ at: [x, y, z], half: [hx, hy, hz] });

/** Metres. */
export const SPAN = 3;
export const WALL_HEIGHT = 3;
export const WALL_THICK = 0.2;
export const FLOOR_THICK = 0.25;
export const FOUNDATION_THICK = 0.375;
/** Wider than a survivor and taller than one stands. */
export const DOOR_WIDTH = 1.4;
export const DOOR_HEIGHT = 2.3125;
/** At a standing survivor's eye height, and too short for any body to get through, even prone in a jump. */
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
/** Floor to floor. A ceiling's top is level with the top of the walls that hold it. */
export const RISE = WALL_HEIGHT;

const shape = (name: string, role: ShapeDef["role"], boxes: ShapeBox[]): ShapeDef => ({ type: "shape", id: `core:shape_${name}`, role, boxes });

const SHAPES: readonly ShapeDef[] = [
  shape("foundation", "foundation", [box(0, 0, 0, H, FOUNDATION_THICK / 2, H)]),
  shape("wall", "wall", [box(0, 0, 0, H, WH, T)]),
  { ...shape("doorframe", "wall", [box(-H + post, 0, 0, post, WH, T), box(H - post, 0, 0, post, WH, T), box(0, WH - lintel, 0, DOOR_WIDTH / 2, lintel, T)]), doorway: true },
  shape("windowframe", "wall", [
    box(-H + jamb, 0, 0, jamb, WH, T),
    box(H - jamb, 0, 0, jamb, WH, T),
    box(0, -WH + WINDOW_SILL / 2, 0, WINDOW_WIDTH / 2, WINDOW_SILL / 2, T),
    box(0, WH - (WALL_HEIGHT - WINDOW_SILL - WINDOW_HEIGHT) / 2, 0, WINDOW_WIDTH / 2, (WALL_HEIGHT - WINDOW_SILL - WINDOW_HEIGHT) / 2, T),
  ]),
  shape("ceiling", "ceiling", [box(0, 0, 0, H, FLOOR_THICK / 2, H)]),
  shape("pillar", "pillar", [box(0, 0, 0, 0.25, WH, 0.25)]),
  // An open door stands at a right angle on its hinge, at the doorway's left as seen from the front.
  shape("door", "door", [box(0, 0, 0, DOOR_WIDTH / 2, DOOR_HEIGHT / 2, 0.04)]),
  shape("door_open", "door", [box(-DOOR_WIDTH / 2 + 0.04, 0, DOOR_WIDTH / 2, 0.04, DOOR_HEIGHT / 2, DOOR_WIDTH / 2)]),
  // Each step is a block from the bottom up to its tread. The stairs rise toward +Z.
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
  readonly hp: { readonly [piece: string]: number };
}

/** Wood, stone and metal come in every piece, at the same health. */
const FULL = { foundation: 15000, wall: 10000, doorframe: 10000, windowframe: 10000, ceiling: 10000, pillar: 6250, door: 6250, stairs: 10000 };
const TIERS: readonly Tier[] = [
  { name: "thatch", color: 18, hp: { foundation: 2400, wall: 1600, doorframe: 1600, ceiling: 1600, door: 1000 } },
  { name: "wood", color: 3, hp: FULL },
  { name: "stone", color: 5, hp: FULL },
  { name: "metal", color: 11, hp: FULL },
];

function piece(tier: Tier, name: string, shapeName = name): StructureDef {
  const form = SHAPES.find((s) => s.id === `core:shape_${shapeName}`)!;
  const base: StructureDef = { type: "structure", class: "piece", id: `core:${name}_${tier.name}`, mesh: "shape", shape: form.id, half: shapeHalf(form.boxes), color: tier.color, hp: tier.hp[name.replace("_open", "")]!, material: `core:mat_${tier.name}` };
  if (name === "door") return { ...base, opens: `core:door_open_${tier.name}`, locked: true };
  if (name === "door_open") return { ...base, opens: `core:door_${tier.name}`, locked: true };
  return base;
}

/** Free-standing pieces, set on the ground or on a floor and joined to nothing. Beds are apart, below. */
const STORES: readonly { name: string; label: string; half: readonly [number, number, number]; color: number; hp: number; material: string; slots?: number; falls?: boolean; fire?: boolean; stack: number; weight: number; level: number; cost: number; needs: Needs }[] = [
  { name: "storage_box", label: "Storage box", half: [0.5, 0.3125, 0.375], color: 3, hp: 500, material: "wood", slots: 15, stack: 100, weight: 4, level: 4, cost: 6, needs: [["wood", 25], ["thatch", 20], ["fiber", 10]] },
  { name: "storage_large", label: "Large storage box", half: [0.75, 0.5, 0.4375], color: 3, hp: 2400, material: "wood", slots: 45, stack: 100, weight: 8, level: 16, cost: 9, needs: [["wood", 50], ["thatch", 35], ["fiber", 25]] },
  { name: "vault", label: "Vault", half: [0.75, 1.25, 0.625], color: 11, hp: 50000, material: "metal", slots: 350, falls: true, stack: 5, weight: 40, level: 52, cost: 60, needs: [["ingot", 300], ["paste", 60]] },
  { name: "campfire", label: "Campfire", half: [0.5, 0.1875, 0.5], color: 5, hp: 500, material: "stone", slots: 3, fire: true, stack: 3, weight: 4, level: 2, cost: 3, needs: [["thatch", 12], ["flint", 1], ["stone", 16], ["wood", 2]] },
];

/**
 * Beds, from ark.wiki.gg's pages of each (read 2026-11-15): health, weight, the material they are harmed and decay as, the
 * level and points of the engram, the experience and the recipe, and the wait. The sizes are not given there but the bunk
 * bed's "1L x 0.6W x 1H", taken as foundations; its height is cut to stand under a ceiling. The bunk bed is made at a
 * Fabricator from polymer and pelt, none of which exist yet, so it has no recipe and no engram.
 */
const BEDS: readonly { name: string; label: string; half: readonly [number, number, number]; color: number; hp: number; material: string; wait?: number; once?: boolean; floor?: boolean; rise?: readonly [number, number, number]; stack: number; weight: number; make?: { level: number; cost: number; xp: number; needs: Needs; requires?: string } }[] = [
  { name: "sleeping_bag", label: "Hide sleeping bag", half: [0.45, 0.1, 1], color: 3, hp: 100, material: "thatch", once: true, stack: 3, weight: 10, make: { level: 4, cost: 3, xp: 12.4, needs: [["hide", 25], ["fiber", 15]] } },
  { name: "bed", label: "Simple bed", half: [0.5, 0.25, 1], color: 18, hp: 1000, material: "thatch", wait: 300, floor: true, stack: 3, weight: 8, make: { level: 7, cost: 8, xp: 32.4, needs: [["wood", 15], ["thatch", 80], ["fiber", 30], ["hide", 40]], requires: "sleeping_bag" } },
  // A survivor gets up beside it, on the floor it stands on.
  { name: "bunk_bed", label: "Bunk bed", half: [0.9, 1.25, 1.5], color: 11, hp: 5000, material: "stone", wait: 150, floor: true, rise: [1.5, -1.25, 0], stack: 3, weight: 4 },
];

function bed(b: (typeof BEDS)[number]): Def[] {
  const shapeId = `core:shape_${b.name}`;
  const item = `core:piece_${b.name}`;
  const facets = { ...(b.wait !== undefined ? { wait: b.wait } : {}), ...(b.once ? { once: true } : {}), ...(b.floor ? { floor: true } : {}), ...(b.rise ? { rise: b.rise } : {}) };
  return [
    { type: "shape", id: shapeId, role: "thing", boxes: [box(0, 0, 0, b.half[0], b.half[1], b.half[2])] },
    { type: "structure", class: "bed", id: `core:${b.name}`, mesh: "shape", shape: shapeId, half: b.half, color: b.color, hp: b.hp, material: `core:mat_${b.material}`, bed: true, ...facets },
    { type: "item", class: "structure", id: item, stack: b.stack, weight: b.weight, label: b.label.toLowerCase(), color: b.color, places: [`core:${b.name}`] },
    ...(b.make
      ? [
          crafting(item, { needs: b.make.needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: b.make.xp }),
          { type: "engram", id: `core:engram-piece_${b.name}`, label: b.label, level: b.make.level, cost: b.make.cost, item, ...(b.make.requires ? { requires: [`core:engram-piece_${b.make.requires}`] } : {}) } as Def,
        ]
      : []),
  ];
}

function store(s: (typeof STORES)[number]): Def[] {
  const shapeId = `core:shape_${s.name}`;
  const item = `core:piece_${s.name}`;
  return [
    { type: "shape", id: shapeId, role: "thing", boxes: [box(0, 0, 0, s.half[0], s.half[1], s.half[2])] },
    { type: "structure", class: s.fire ? "station" : "container", id: `core:${s.name}`, mesh: "shape", shape: shapeId, half: s.half, color: s.color, hp: s.hp, material: `core:mat_${s.material}`, decayDays: 16, ...(s.slots ? { slots: s.slots } : {}), ...(s.falls ? { falls: true } : {}), ...(s.fire ? { lights: `core:${s.name}_lit` } : {}) },
    ...(s.fire ? [{ type: "structure", class: "station", id: `core:${s.name}_lit`, mesh: "shape", shape: shapeId, half: s.half, color: 8, hp: s.hp, material: `core:mat_${s.material}`, decayDays: 16, slots: s.slots!, lights: `core:${s.name}`, lit: true } as StructureDef] : []),
    { type: "item", class: "structure", id: item, stack: s.stack, weight: s.weight, label: s.label.toLowerCase(), color: s.color, places: [`core:${s.name}`] },
    crafting(item, { needs: s.needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: Math.max(1, Math.round(s.level / 3)) }),
    { type: "engram", id: `core:engram-piece_${s.name}`, label: s.label, level: s.level, cost: s.cost, item: `core:piece_${s.name}` },
  ];
}

type Needs = readonly (readonly [item: string, count: number])[];

/** One material's recipes. level is the level at which a piece's engram can be learnt, and cost the points it takes. */
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

/** A wall item also places as a doorframe or a windowframe, where the material has them. */
function kit(tier: Tier, name: string): Def[] {
  const m = MAKING[tier.name]!;
  const forms = name === "wall" ? ["wall", "doorframe", "windowframe"].filter((f) => f in tier.hp) : [name];
  const item = `core:piece_${name}_${tier.name}`;
  const label = `${m.label} ${name}`;
  const { level, needs } = m.pieces[name]!;
  return [
    { type: "item", class: "structure", id: item, stack: 100, weight: m.weight, label: label.toLowerCase(), color: tier.color, places: forms.map((f) => `core:${f}_${tier.name}`) },
    crafting(item, { needs: needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: Math.max(1, Math.round(level / 3)) }),
    { type: "engram", id: `core:engram-piece_${name}_${tier.name}`, label, level, cost: m.cost, item: `core:piece_${name}_${tier.name}` },
  ];
}

export const BUILDING_CONTENT: readonly Def[] = [
  ...SHAPES,
  ...TIERS.flatMap((tier) => [
    ...Object.keys(tier.hp).map((name) => piece(tier, name)),
    // The open door is a separate structure.
    piece(tier, "door_open"),
    ...Object.keys(MAKING[tier.name]!.pieces).flatMap((name) => kit(tier, name)),
  ]),
  ...STORES.flatMap(store),
  ...BEDS.flatMap(bed),
  // Cementing paste, which the metal tier and the vault are made of, is the item program's: content/items/resources.ts.
];
