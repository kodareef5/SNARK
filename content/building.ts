// Sizes and health are the reference game's. Every piece height is a whole number of 1/256 m, so a piece set
// on another stands exactly on the structure lattice.

import { crafting, making } from "./craft.ts";
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import { outlineBox, type FormDef } from "../shared/world/lattice/forms.ts";
import { FORMS, LIVE_FORMS, boxed, formBoxes, formHulls } from "./building/forms.ts";

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox => ({ at: [x, y, z], half: [hx, hy, hz] });

const across = (f: FormDef): number => outlineBox(f)[2] - outlineBox(f)[0];
const up = (f: FormDef): number => outlineBox(f)[3] - outlineBox(f)[1];

/** Metres, each read from the piece's form (content/building/forms.ts). */
export const SPAN = across(FORMS.foundation);
export const WALL_HEIGHT = up(FORMS.wall);
export const WALL_THICK = FORMS.wall.thick;
export const FLOOR_THICK = FORMS.ceiling.thick;
export const FOUNDATION_THICK = FORMS.foundation.thick;
export const DOOR_WIDTH = across(FORMS.door);
export const DOOR_HEIGHT = up(FORMS.door);
/** Floor to floor. A ceiling's top is level with the top of the walls that hold it. */
export const RISE = WALL_HEIGHT;

type Role = ShapeDef["role"];
/** What each form is to the rules that go by role: the ground under a foundation, what a thing rests on, another tribe's range. */
const ROLES: { readonly [name: string]: Role } = {
  foundation: "foundation", wall: "wall", doorframe: "wall", windowframe: "wall", ceiling: "ceiling", pillar: "pillar", door: "door", door_open: "door", stairs: "stairs",
  half_wall: "wall", quarter_wall: "wall", railing: "wall", beam: "wall", thin_pillar: "pillar",
  triangle_foundation: "foundation", triangle_ceiling: "ceiling",
  ramp: "stairs", roof: "ceiling", roof_hip: "ceiling", roof_valley: "ceiling", triangle_roof: "ceiling", triangle_roof_low: "ceiling", sloped_wall_left: "wall", sloped_wall_right: "wall",
  fence_foundation: "foundation", trapdoor_frame: "ceiling", trapdoor: "door", trapdoor_open: "door", ladder: "door",
  double_doorway: "wall", double_door: "door", double_door_open: "door", large_wall: "wall", gateway: "wall", gate: "door", gate_open: "door",
};
const LIVE: { readonly [name: string]: FormDef } = LIVE_FORMS;

/** A leaf and the form it has stood open. Using one swaps its row's kind for the other. */
const OPENS: { readonly [name: string]: string } = { door: "door_open", trapdoor: "trapdoor_open", double_door: "double_door_open", gate: "gate_open" };
const SHUTS: { readonly [name: string]: string } = Object.fromEntries(Object.entries(OPENS).map(([shut, open]) => [open, shut]));

/** A rectangle's collider is boxes, and a slope's or a triangle's is convex parts. */
const SHAPES: readonly ShapeDef[] = Object.keys(LIVE).map((name) => {
  const form = LIVE[name]!;
  const solid = boxed(form) ? { boxes: formBoxes(form) } : { boxes: [], hulls: formHulls(form) };
  return { type: "shape", id: `core:shape_${name}`, role: ROLES[name]!, ...solid, ...(form.takes === "door" ? { doorway: true } : {}), form };
});

interface Tier {
  readonly name: string;
  readonly color: number;
  readonly hp: { readonly [piece: string]: number };
  /** The material made from a recipe (content/texgen/materials.ts) its pieces' faces in their own colour wear, where the tier has no pictures. */
  readonly made?: string;
}

/**
 * Wood, stone and metal come in every piece, at the same health. The first nine are the reference's as before. Of the
 * rest, ark.wiki.gg's pages of each wooden piece gave these on 2026-11-24, read through a summary and not checked by
 * hand: railing, fence foundation, hatchframe and sloped roof and wall 10,000, trapdoor and gate 6,250, ladder 3,125,
 * triangle foundation 7,500, triangle ceiling and roof 5,000, double door 8,000, large wall 18,000, gateway 10,000.
 * Ours, where no page has the piece: half wall 5,000, quarter wall 2,500, thin pillar and beam the pillar's, double
 * doorway the doorframe's, hip and valley the roof's.
 */
const FULL = {
  foundation: 15000, wall: 10000, doorframe: 10000, windowframe: 10000, ceiling: 10000, pillar: 6250, door: 6250, stairs: 10000,
  half_wall: 5000, quarter_wall: 2500, railing: 10000, beam: 6250, thin_pillar: 6250,
  triangle_foundation: 7500, triangle_ceiling: 5000,
  ramp: 10000, roof: 10000, roof_hip: 10000, roof_valley: 10000, triangle_roof: 5000, triangle_roof_low: 5000, sloped_wall_left: 10000, sloped_wall_right: 10000,
  fence_foundation: 10000, trapdoor_frame: 10000, trapdoor: 6250, ladder: 3125,
  double_doorway: 10000, double_door: 8000, large_wall: 18000, gateway: 10000, gate: 6250,
};
/** The reference makes no ladder of stone. */
const { ladder: _ladder, ...STONE } = FULL;
const TIERS: readonly Tier[] = [
  // Evolved's thatch: the hut's five pieces, a sloped roof and its sloped walls.
  { name: "thatch", color: 18, hp: { foundation: 2400, wall: 1600, doorframe: 1600, ceiling: 1600, door: 1000, roof: 1600, roof_hip: 1600, roof_valley: 1600, sloped_wall_left: 1600, sloped_wall_right: 1600 } },
  { name: "wood", color: 3, hp: FULL },
  { name: "stone", color: 5, hp: STONE },
  // A steel grey, whose painted finish is steel (content/surfaces.ts); its pieces are made by tools/pack/pieces/metal.ts.
  { name: "metal", color: 89, hp: FULL, made: "plate" },
];
/** The forms a tier is made in: those it has a health for that content places. */
const formsOf = (tier: Tier): string[] => Object.keys(tier.hp).filter((name) => name in LIVE);

function piece(tier: Tier, name: string): StructureDef {
  const form = SHAPES.find((s) => s.id === `core:shape_${name}`)!;
  const base: StructureDef = { type: "structure", class: "piece", id: `core:${name}_${tier.name}`, mesh: "shape", shape: form.id, half: shapeHalf(form.boxes, form.hulls), color: tier.color, hp: tier.hp[SHUTS[name] ?? name]!, material: `core:mat_${tier.name}`, ...(tier.made ? { made: tier.made } : {}) };
  const other = OPENS[name] ?? SHUTS[name];
  return other === undefined ? base : { ...base, opens: `core:${other}_${tier.name}`, locked: true };
}

/** Free-standing pieces, set on the ground or on a floor and joined to nothing. Beds are apart, below. */
const STORES: readonly { name: string; label: string; half: readonly [number, number, number]; color: number; hp: number; material: string; slots?: number; falls?: boolean; fire?: boolean; decayDays?: number; stack: number; weight: number; level: number; cost: number; xp?: number; at?: string; needs: Needs }[] = [
  { name: "storage_box", label: "Storage box", half: [0.5, 0.3125, 0.375], color: 3, hp: 500, material: "wood", slots: 15, stack: 100, weight: 4, level: 4, cost: 6, needs: [["wood", 25], ["thatch", 20], ["fiber", 10]] },
  { name: "storage_large", label: "Large storage box", half: [0.75, 0.5, 0.4375], color: 3, hp: 2400, material: "wood", slots: 45, stack: 100, weight: 8, level: 16, cost: 9, needs: [["wood", 50], ["thatch", 35], ["fiber", 25]] },
  // ark.wiki.gg, Vault, infobox, 2026-11-15 (stations S6; Evolved's, D465): at the fabricator, 500 ingots, 100 cementing paste, 70
  // oil and 90 polymer, craftingxp 82 (our 328, D465's four times); level 75, 30 engram points; weighs 20, stacks to 1. No
  // page gives a crafting time: 5 s is ours (DEV135).
  { name: "vault", label: "Vault", half: [0.75, 1.25, 0.625], color: 11, hp: 50000, material: "metal", slots: 350, falls: true, stack: 1, weight: 20, level: 75, cost: 30, xp: 328, at: "core:fabricator", needs: [["ingot", 500], ["paste", 100], ["oil", 70], ["polymer", 90]] },
  // ark.wiki.gg, Campfire, 2026-11-15: 100 health, decaytime 172800 (2 days).
  { name: "campfire", label: "Campfire", half: [0.5, 0.1875, 0.5], color: 5, hp: 100, material: "stone", slots: 3, fire: true, decayDays: 2, stack: 3, weight: 4, level: 2, cost: 3, needs: [["thatch", 12], ["flint", 1], ["stone", 16], ["wood", 2]] },
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
          ...crafting(item, { needs: b.make.needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: b.make.xp }),
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
    { type: "structure", class: s.fire ? "station" : "container", id: `core:${s.name}`, mesh: "shape", shape: shapeId, half: s.half, color: s.color, hp: s.hp, material: `core:mat_${s.material}`, decayDays: s.decayDays ?? 16, ...(s.slots ? { slots: s.slots } : {}), ...(s.falls ? { falls: true } : {}), ...(s.fire ? { lights: `core:${s.name}_lit` } : {}) },
    ...(s.fire ? [{ type: "structure", class: "station", id: `core:${s.name}_lit`, mesh: "shape", shape: shapeId, half: s.half, color: 8, hp: s.hp, material: `core:mat_${s.material}`, decayDays: s.decayDays ?? 16, slots: s.slots!, lights: `core:${s.name}`, lit: true } as StructureDef] : []),
    { type: "item", class: "structure", id: item, stack: s.stack, weight: s.weight, label: s.label.toLowerCase(), color: s.color, places: [`core:${s.name}`] },
    ...crafting(item, { needs: s.needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: s.xp ?? Math.max(1, Math.round(s.level / 3)), ...(s.at ? { at: s.at } : {}) }),
    { type: "engram", id: `core:engram-piece_${s.name}`, label: s.label, level: s.level, cost: s.cost, item: `core:piece_${s.name}` },
  ];
}

type Needs = readonly (readonly [item: string, count: number])[];

/**
 * One material's recipes. level is the level at which a piece's engram can be learnt, and cost the points it takes: the
 * piece's own, else the material's. xp is the piece's crafting experience, else a third of its level. at is the station
 * its pieces are made at, else the hand.
 */
interface Making {
  readonly label: string;
  readonly weight: number;
  readonly cost?: number;
  readonly at?: string;
  readonly pieces: { readonly [piece: string]: { readonly level: number; readonly cost?: number; readonly xp?: number; readonly needs: Needs } };
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
      // ark.wiki.gg, Sloped Thatch Roof and Sloped Thatch Wall Left, 2026-11-24.
      roof: { level: 5, needs: [["thatch", 15], ["wood", 4], ["fiber", 10]] },
      sloped_wall: { level: 5, needs: [["thatch", 10], ["wood", 2], ["fiber", 7]] },
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
      // ark.wiki.gg's page of each wooden piece, 2026-11-24, read through a summary and not checked by hand. Ours, for
      // want of a page: the half wall at half a wall, the double doorway at the doorframe's cost as stone's and metal's are.
      half_wall: { level: 11, cost: 3, needs: [["wood", 20], ["thatch", 5], ["fiber", 4]] },
      railing: { level: 14, cost: 3, needs: [["wood", 20], ["thatch", 5], ["fiber", 3]] },
      triangle_foundation: { level: 11, needs: [["wood", 40], ["thatch", 10], ["fiber", 8]] },
      triangle_ceiling: { level: 11, needs: [["wood", 30], ["thatch", 8], ["fiber", 5]] },
      roof: { level: 14, cost: 4, needs: [["wood", 60], ["thatch", 15], ["fiber", 10]] },
      triangle_roof: { level: 14, cost: 4, needs: [["wood", 40], ["thatch", 10], ["fiber", 7]] },
      sloped_wall: { level: 12, cost: 3, needs: [["wood", 20], ["thatch", 5], ["fiber", 5]] },
      fence_foundation: { level: 11, needs: [["wood", 10], ["thatch", 3], ["fiber", 2]] },
      trapdoor_frame: { level: 13, cost: 9, needs: [["wood", 50], ["thatch", 12], ["fiber", 8]] },
      trapdoor: { level: 13, needs: [["wood", 20], ["thatch", 7], ["fiber", 4]] },
      ladder: { level: 13, needs: [["wood", 4], ["thatch", 7], ["fiber", 4]] },
      double_doorway: { level: 18, needs: [["wood", 30], ["thatch", 8], ["fiber", 6]] },
      double_door: { level: 18, cost: 4, needs: [["wood", 40], ["thatch", 14], ["fiber", 8]] },
      large_wall: { level: 15, cost: 9, needs: [["wood", 160], ["thatch", 40], ["fiber", 28]] },
      gateway: { level: 18, cost: 7, needs: [["wood", 280], ["thatch", 70], ["fiber", 25]] },
      gate: { level: 18, cost: 5, needs: [["wood", 60], ["thatch", 15], ["fiber", 10]] },
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
      // ark.wiki.gg's page of each stone piece, as wood's. Ours: the half wall; and the trapdoor, double door and gate,
      // which the reference makes "reinforced" under other names, at twice wood's in stone's own mix.
      half_wall: { level: 24, cost: 3, needs: [["stone", 20], ["wood", 10], ["thatch", 8]] },
      railing: { level: 28, cost: 4, needs: [["stone", 20], ["wood", 10], ["thatch", 7]] },
      triangle_foundation: { level: 24, cost: 6, needs: [["stone", 40], ["wood", 20], ["thatch", 15]] },
      triangle_ceiling: { level: 24, cost: 6, needs: [["stone", 30], ["wood", 15], ["thatch", 10]] },
      roof: { level: 27, cost: 4, needs: [["stone", 60], ["wood", 30], ["thatch", 20]] },
      triangle_roof: { level: 27, cost: 4, needs: [["stone", 40], ["wood", 20], ["thatch", 15]] },
      sloped_wall: { level: 27, cost: 3, needs: [["stone", 20], ["wood", 10], ["thatch", 10]] },
      fence_foundation: { level: 25, cost: 6, needs: [["stone", 15], ["wood", 10], ["thatch", 10]] },
      trapdoor_frame: { level: 26, needs: [["stone", 50], ["wood", 25], ["thatch", 15]] },
      trapdoor: { level: 26, cost: 6, needs: [["stone", 20], ["wood", 10], ["thatch", 7]] },
      double_doorway: { level: 31, cost: 6, needs: [["stone", 30], ["wood", 16], ["thatch", 12]] },
      double_door: { level: 31, cost: 4, needs: [["stone", 40], ["wood", 20], ["thatch", 14]] },
      large_wall: { level: 28, cost: 10, needs: [["stone", 160], ["wood", 80], ["thatch", 60]] },
      gateway: { level: 27, cost: 9, needs: [["stone", 280], ["wood", 140], ["thatch", 100]] },
      gate: { level: 27, cost: 5, needs: [["stone", 60], ["wood", 30], ["thatch", 20]] },
    },
  },
  // ark.wiki.gg, Metal Foundation, Metal Wall, Metal Ceiling, Metal Door, Metal Pillar and Metal Stairs, infoboxes,
  // 2026-11-15 (stations S6): made at the smithy; each piece's level, engram points, ingredients and craftingxp, shown
  // times the global 4 of patches 253.0 and 313.5 (D465); each weighs 4. No page gives a crafting time: 5 s is ours. The
  // wall also places the doorframe and windowframe, whose own engrams (Metal Doorframe, Metal Windowframe) are not ours.
  metal: {
    label: "Metal",
    weight: 4,
    at: "core:smithy",
    pieces: {
      foundation: { level: 45, cost: 24, xp: 92, needs: [["ingot", 50], ["paste", 15]] },
      wall: { level: 45, cost: 15, xp: 18.4, needs: [["ingot", 25], ["paste", 7]] },
      ceiling: { level: 45, cost: 15, xp: 51.2, needs: [["ingot", 35], ["paste", 10]] },
      door: { level: 45, cost: 12, xp: 11.6, needs: [["ingot", 10], ["paste", 4]] },
      pillar: { level: 46, cost: 18, xp: 27.2, needs: [["ingot", 25], ["paste", 7]] },
      stairs: { level: 47, cost: 12, xp: 64, needs: [["ingot", 35], ["paste", 10]] },
      // ark.wiki.gg's page of each metal piece, as wood's. Ours: the half wall. No crafting experience was read: a third of the level.
      half_wall: { level: 45, cost: 7, needs: [["ingot", 12], ["paste", 4]] },
      railing: { level: 46, cost: 7, needs: [["ingot", 12], ["paste", 3]] },
      triangle_foundation: { level: 45, cost: 24, needs: [["ingot", 25], ["paste", 8]] },
      triangle_ceiling: { level: 45, cost: 15, needs: [["ingot", 18], ["paste", 5]] },
      roof: { level: 47, cost: 10, needs: [["ingot", 35], ["paste", 10]] },
      triangle_roof: { level: 47, cost: 10, needs: [["ingot", 25], ["paste", 7]] },
      sloped_wall: { level: 47, cost: 7, needs: [["ingot", 15], ["paste", 5]] },
      fence_foundation: { level: 48, cost: 12, needs: [["ingot", 5], ["paste", 2]] },
      trapdoor_frame: { level: 48, cost: 18, needs: [["ingot", 30], ["paste", 8]] },
      trapdoor: { level: 48, cost: 14, needs: [["ingot", 10], ["paste", 4]] },
      ladder: { level: 48, cost: 21, needs: [["ingot", 7]] },
      double_doorway: { level: 52, cost: 24, needs: [["ingot", 20], ["paste", 6]] },
      double_door: { level: 52, cost: 12, needs: [["ingot", 20], ["paste", 8]] },
      large_wall: { level: 49, cost: 17, needs: [["ingot", 100], ["paste", 28]] },
      gateway: { level: 52, cost: 12, needs: [["ingot", 170], ["paste", 50]] },
      gate: { level: 52, cost: 8, needs: [["ingot", 35], ["paste", 10]] },
    },
  },
};

/**
 * The forms one item places, the first as it comes to hand and the rest on the wheel of forms. A wall is one item with
 * its doorway and its window, as in Ascended; so are stairs and a ramp, a pillar with the thin one and a beam, a roof
 * with its hip and its valley, the two triangle roofs, the two sloped walls and the two low walls. A piece the reference
 * makes at a cost of its own is an item of its own.
 */
const ITEM_FORMS: { readonly [item: string]: readonly string[] } = {
  wall: ["wall", "doorframe", "windowframe"],
  pillar: ["pillar", "thin_pillar", "beam"],
  stairs: ["stairs", "ramp"],
  half_wall: ["half_wall", "quarter_wall"],
  roof: ["roof", "roof_hip", "roof_valley"],
  triangle_roof: ["triangle_roof", "triangle_roof_low"],
  sloped_wall: ["sloped_wall_left", "sloped_wall_right"],
};

/** An item, its recipe and its engram, where the material is made in any of its forms. */
function kit(tier: Tier, name: string): Def[] {
  const m = MAKING[tier.name]!;
  const forms = (ITEM_FORMS[name] ?? [name]).filter((f) => f in tier.hp && f in LIVE);
  if (forms.length === 0) return [];
  const item = `core:piece_${name}_${tier.name}`;
  const label = `${m.label} ${name.replaceAll("_", " ")}`;
  const { level, needs, cost, xp } = m.pieces[name]!;
  return [
    { type: "item", class: "structure", id: item, stack: 100, weight: m.weight, label: label.toLowerCase(), color: tier.color, places: forms.map((f) => `core:${f}_${tier.name}`) },
    ...crafting(item, { needs: needs.map(([n, count]) => ({ item: `core:${n}`, count })), seconds: 5, xp: xp ?? Math.max(1, Math.round(level / 3)), ...(m.at ? { at: m.at } : {}) }),
    { type: "engram", id: `core:engram-piece_${name}_${tier.name}`, label, level, cost: cost ?? m.cost!, item: `core:piece_${name}_${tier.name}` },
  ];
}

/**
 * The template hammer: in the hand it copies a base as a template, sets a template down as a plan and fills the plan
 * (client/core/hammer.ts, server/plans.ts). ARK's Template Hammer is level 26 for 5 points. Its materials are chosen, in
 * wood's range, and its weight is the wooden club's 2. Made in the hand in 5 s. It has no model yet.
 */
const HAMMER: readonly Def[] = [
  { type: "item", class: "instrument", id: "core:template_hammer", label: "template hammer", stack: 1, weight: 2, color: 3 },
  ...making("template_hammer", "Template hammer", 26, 5, 1, 5, [["wood", 30], ["stone", 10], ["fiber", 20], ["hide", 10]]),
];

export const BUILDING_CONTENT: readonly Def[] = [
  ...SHAPES,
  ...TIERS.flatMap((tier) => [
    // A leaf stood open is a structure of its own.
    ...formsOf(tier).flatMap((name) => (name in OPENS ? [piece(tier, name), piece(tier, OPENS[name]!)] : [piece(tier, name)])),
    ...Object.keys(MAKING[tier.name]!.pieces).flatMap((name) => kit(tier, name)),
  ]),
  ...STORES.flatMap(store),
  ...BEDS.flatMap(bed),
  ...HAMMER,
  // Cementing paste, which the metal tier and the vault are made of, is the item program's: content/items/resources.ts.
];
