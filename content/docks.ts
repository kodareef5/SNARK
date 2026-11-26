// A marina's docks and the boats moored at them, as a city's build lays them out (tools/boat/marinas.ts).
//
// The dock kit is a fixed timber dock on piles, as many of Miami's marinas have: a main walkway 2.4 m wide and its
// finger piers 1 m wide, each made of modules 3 m long whose deck stands at the module's origin, a bent of piles under
// one end of each going down into the bed; a ramp module whose deck falls a quarter metre along it, for the walkway's way
// down from the bank; and the tall mooring pile set at each finger's tip. Each module is drawn as its mesh in the street
// pieces asset (assets/source/core/props/street/dock.py, which keeps these numbers), on the street atlas's wood, concrete
// and galvanised strips, and walked as the boxes here.
//
// The moored boats are statics of the vessels' own meshes, as a harbour's intact hulks are (content/vehicles/harbour-
// wrecks.ts), each in one of the dyes of a boat left to rot: kinds that share a mesh are drawn together, so a dye costs no draw.
//
// Every id here sorts after every other core id (the last before them was core:zzzcurbshape_r8), so no index moves.

import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import type { HullDef } from "../shared/world/convex.ts";
import { BOAT, BOAT_SPECIES } from "./vehicles/boat.ts";
import { MARINE_FLEET, MARINE_MODELS } from "./vehicles/marine-fleet.ts";
import { hulkBoxes, hulkOf } from "./vehicles/harbour-wrecks.ts";

/** The kit's measures, in metres. A module's origin is on its deck's top at its middle, +Z along it. */
export const DOCK = {
  /** The deck's top over the water where the dock is afloat level. */
  height: 0.7,
  /** The deck, boards and stringers, down from its top. */
  deck: 0.3,
  /** A module's length, and the main walkway's and a finger's width. */
  length: 3,
  walk: 2.4,
  finger: 1,
  /** How far a ramp module's deck falls along its length, toward +Z. */
  fall: 0.25,
  /** The piles of a module's bent: their side, and how far under its deck they go. */
  leg: 0.3,
  foot: 6.7,
  /** A mooring pile: across, and how far over the deck it stands. */
  pile: 0.34,
  top: 2,
} as const;

export const DOCK_KINDS = { walk: "core:zzzzdock_walk", ramp: "core:zzzzdock_ramp", finger: "core:zzzzdock_finger", pile: "core:zzzzdock_pile" } as const;
export type DockPart = keyof typeof DOCK_KINDS;
const shapeOf = (part: DockPart): string => `core:zzzzdockshape_${part}`;
/** Whether a static is a piece of a dock. */
export const isDock = (kind: string): boolean => kind.startsWith("core:zzzzdock_");

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ShapeBox => ({
  at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});
const mm = (v: number): number => Math.round(v * 1000) / 1000;

const { length: L, walk: W, finger: F, deck: D, leg: G, foot: FOOT, fall: FALL, pile: P, top: TOP } = DOCK;
/** A module's bent: its piles under the -Z end, at the edges of a walkway and the middle of a finger. */
const bent = (width: number, rise = 0): ShapeBox[] => (width > 2 ? [-1, 1] : [0]).map((side) => {
  const x = side * (width / 2 - G / 2 - 0.05);
  return box(mm(x - G / 2), mm(x + G / 2), mm(-FOOT), mm(-D + rise), mm(-L / 2 + 0.05), mm(-L / 2 + 0.05 + G));
});

/** The ramp's deck: a slab whose top falls FALL toward +Z, through the origin at its middle. */
const rampDeck = (): HullDef => ({
  corners: [-L / 2, L / 2].flatMap((z) => {
    const top = mm(-FALL * z / L);
    return [-W / 2, W / 2].flatMap((x) => [[x, top, z] as const, [x, mm(top - D), z] as const]);
  }),
});

const SHAPES: readonly ShapeDef[] = [
  { type: "shape", id: shapeOf("walk"), role: "thing", boxes: [box(-W / 2, W / 2, -D, 0, -L / 2, L / 2), ...bent(W)] },
  { type: "shape", id: shapeOf("finger"), role: "thing", boxes: [box(-F / 2, F / 2, -D, 0, -L / 2, L / 2), ...bent(F)] },
  // The ramp's high end is at -Z, where its bent stands, an eighth of its fall over the origin.
  { type: "shape", id: shapeOf("ramp"), role: "thing", boxes: bent(W, FALL / 2), hulls: [rampDeck()] },
  { type: "shape", id: shapeOf("pile"), role: "thing", boxes: [box(-P / 2, P / 2, -FOOT, TOP, -P / 2, P / 2)] },
];

// Weathered timber (the street atlas's wood strip, sRGB 101, 80, 56), as the far city draws it.
const WOOD = 118;
const STATICS: readonly StructureDef[] = (Object.keys(DOCK_KINDS) as DockPart[]).map((part) => {
  const s = SHAPES.find((d) => d.id === shapeOf(part))!;
  // A big marina has thousands of modules: their boards and cleats are left to its nearest, at twice the distance a
  // piece's levels are chosen at, still within half a pixel of the finest (client/core/render/scene.ts).
  return { type: "structure", class: "static", id: DOCK_KINDS[part], mesh: "shape", shape: s.id, half: shapeHalf(s.boxes, s.hulls), color: WOOD, hp: 6000, material: "core:mat_wood", near: true, coarse: 2 };
});

/**
 * The dyes a moored vessel is found in, by their share: its paint's palette index, and the one its stripe and seats take.
 * None is a paint a vessel that still runs is found in (a test holds that), so a boat in clean paint is one to try and a
 * charred, rusted, bleached or weed-grown one is not. A dye is a kind of the vessel's mesh, and kinds of one mesh are
 * drawn together, so it costs no draw.
 */
export const DEAD_DYES: readonly { readonly name: string; readonly paint: number; readonly trim: number; readonly share: number }[] = [
  { name: "charred", paint: 229, trim: 94, share: 3 },
  { name: "rusted", paint: 178, trim: 95, share: 3 },
  { name: "bleached", paint: 231, trim: 99, share: 4 },
  { name: "weed-grown", paint: 147, trim: 94, share: 2 },
];
/** The dyes by vessel, a palette index and its share each: the same for every vessel. */
export const MOORED_PAINTS: Readonly<Record<string, readonly (readonly [number, number])[]>> = Object.fromEntries([BOAT_SPECIES, ...MARINE_FLEET].map((s) => [s.id, DEAD_DYES.map((d) => [d.paint, d.share] as const)]));
/** The regions a vessel has past its paint, its stripe, seats and so on: true for each it has. */
const TRIMS = new Map([BOAT_SPECIES, ...MARINE_FLEET].map((s) => [s.id, s.regions!.slice(1, 6).map((r) => r !== null && r !== undefined)]));
/** How many times farther off a moored hull's levels are chosen than a found vessel's (StructureDef.coarse). */
export const MOORED_COARSE = 3;
/** The static of a vessel moored in a paint. */
export const mooredKind = (vessel: string, paint: number): string => `${vessel.replace("core:", "core:zzzzhull_")}_${paint}`;
/** Whether a static is a moored vessel. */
export const isMoored = (kind: string): boolean => kind.startsWith("core:zzzzhull_");
/** The vessel a moored static is of. */
export const mooredVessel = (kind: string): string => kind.slice(0, kind.lastIndexOf("_")).replace("core:zzzzhull_", "core:");

// The launch has no hulk (its wreck is its corpse's), so its moored shape is its own; the others' are their intact
// hulks', as the far city and bodies meet them.
const LAUNCH_SHAPE: ShapeDef = { type: "shape", id: "core:zzzzhullshape_boat", role: "thing", boxes: hulkBoxes(BOAT.hullBoxes) };
const MOORED: readonly StructureDef[] = [{ id: BOAT_SPECIES.id, shape: LAUNCH_SHAPE.id, boxes: LAUNCH_SHAPE.boxes }, ...MARINE_MODELS.map((m) => ({ id: m.id, shape: hulkOf(m.id).replace("core:", "core:shape_"), boxes: hulkBoxes(m.boxes) }))]
  .flatMap(({ id, shape, boxes }) => MOORED_PAINTS[id]!.map(([paint]): StructureDef => ({
    type: "structure", class: "static", id: mooredKind(id, paint), mesh: id, shape, half: shapeHalf(boxes), color: paint, hp: 8000, material: "core:mat_metal",
    // Its stripe and seats dulled with it; a region it has not, in its paint.
    colors: TRIMS.get(id)!.map((has) => (has ? DEAD_DYES.find((d) => d.paint === paint)!.trim : paint)),
    // A marina holds many: its hulls take their coarser levels at a third of the distance a found vessel does, so only
    // those near are textured, still within half a pixel of the finest (client/core/render/scene.ts).
    coarse: MOORED_COARSE,
  })));

/** The static of a vessel burning at its mooring: its mesh charred, with fire on it (StructureDef.ablaze). */
export const burningKind = (vessel: string): string => `${vessel.replace("core:", "core:zzzzhull_")}_burning`;
const CHARRED = DEAD_DYES[0]!;
const BURNING: readonly StructureDef[] = MOORED.filter((m) => m.color === CHARRED.paint).map((m): StructureDef => ({ ...m, id: burningKind(m.mesh as string), ablaze: true }));

// Maps and saves made before the derelict dyes name these hulls by their original paint.
const oldPaints = {
  boat: [103, 124], needle: [20, 46, 230, 48, 53], thunderbolt: [29, 230, 34, 84, 41],
  jon_boat: [136, 128, 120, 87, 98], riptide: [52, 49, 46, 230, 53, 48], solstice: [131, 29, 84, 104],
  meridian: [98, 84, 30], belvedere: [93, 29, 87], sovereign: [87, 230, 29], manta: [40, 46, 230], lagoon: [91, 104, 236],
};
const earlier: Def[] = Object.entries(oldPaints).flatMap(([name, paints]) =>
  [232, ...paints].map((paint) => ({
    type: "rename" as const, id: mooredKind(`core:${name}`, paint),
    to: [mooredKind(`core:${name}`, DEAD_DYES[paint === 232 ? 2 : paint % DEAD_DYES.length]!.paint)],
  })));

export const DOCKS: readonly Def[] = [...SHAPES, ...STATICS, LAUNCH_SHAPE, ...MOORED, ...BURNING, ...earlier];
