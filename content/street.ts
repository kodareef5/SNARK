// What a city's streets hold that is not a building or a car, as a ruin of itself: lamps, signals, signs, utility poles,
// hydrants, benches, bins, bus shelters, mailboxes, parking meters and pay stations, bollards, fence and guard rail runs,
// billboards, newspaper boxes and the bars of crosswalks. Each is a static drawn as its own mesh
// (assets/source/core/props/street) and met as the boxes and parts here, in the piece's frame: origin on the ground at the
// middle of its foot, +Y up, +Z toward the road it stands by (a sign's +Z is the way its face looks), in metres. A map
// sets them down by tools/mapworld/street-furniture.ts. Their ids sort after every other core id, so no index moves.

import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import { PI, detCos, detSin } from "../shared/math/scalar.ts";
import type { HullDef } from "../shared/world/convex.ts";
import { CURB_RETURNS } from "./curbs.ts";

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ShapeBox => ({
  at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});

/**
 * A box's eight corners turned `degrees` about the x axis through the point at height `pivot`, +Y toward +Z, then `side`
 * degrees about the z axis through it, +Y toward +X.
 */
const tilted = (b: ShapeBox, degrees: number, pivot = 0, side = 0): HullDef => {
  // The deterministic sine, so every engine compiles the same corners.
  const a = (degrees * PI) / 180; const c = detCos(a); const s = detSin(a);
  const t = (side * PI) / 180; const ct = detCos(t); const st = detSin(t);
  const corners: [number, number, number][] = [];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) {
    const x = b.at[0] + dx * b.half[0]; const y = b.at[1] + dy * b.half[1] - pivot; const z = b.at[2] + dz * b.half[2];
    const y1 = y * c - z * s; const z1 = y * s + z * c;
    corners.push([round(x * ct + y1 * st), round(pivot + y1 * ct - x * st), round(z1)]);
  }
  return { corners };
};
const round = (v: number): number => Math.round(v * 1000) / 1000;

type Material = "core:mat_metal" | "core:mat_wood" | "core:mat_stone";
/**
 * One piece: its mesh's name in the pack after "core:zzstreet_", its colour far off, its hit points and what harms it
 * (left out, nothing).
 */
export interface StreetPiece {
  readonly name: string;
  readonly color: number;
  readonly hp: number;
  readonly material?: Material;
  readonly boxes: readonly ShapeBox[];
  readonly hulls?: readonly HullDef[];
  /** Paint on the ground (shared/content/defs.ts StructureDef `paint`). */
  readonly paint?: true;
}

// Palette colours: galvanised steel, signal yellow, creosoted wood, rust, hydrant red, mailbox blue, bench green, sign white,
// a pay station's blue-grey.
const GALV = 89, YELLOW = 192, WOOD = 117, RUST = 179, RED = 233, BLUE = 41, GREEN = 138, WHITE = 105, KIOSK = 85;

const MAST = box(-0.13, 0.13, 0, 8, -0.13, 0.13);
// Its arm and head, over the road.
const LAMP_HEAD = box(-0.22, 0.22, 7.9, 9.1, 0, 3.35);
const SIGNAL_POLE = box(-0.17, 0.17, 0, 6.6, -0.17, 0.17);
// The pedestrian signal on the pole.
const WALK = box(0.13, 0.4, 2.5, 2.85, -0.17, 0.17);
const POST = box(-0.04, 0.04, 0, 2.9, -0.04, 0.04);
const POLE = box(-0.17, 0.17, 0, 10.5, -0.17, 0.17);
const CROSSARM = box(-0.06, 0.06, 9.9, 10.1, -1.2, 1.2);
const TRANSFORMER = box(-0.28, 0.28, 7.3, 8.3, -0.64, -0.16);
const SHELTER = [
  box(-2, 2, 0, 2.3, -0.8, -0.72), box(-2.1, -1.9, 0, 2.3, -0.8, 0.45), box(1.92, 2, 0, 2.3, -0.8, 0.3),
  box(-2, -1.92, 0, 2.45, 0.72, 0.8), box(1.92, 2, 0, 2.45, 0.72, 0.8), box(2.56, 2.64, 0, 2.7, 0.51, 0.59),
];
// The yield sign's post above its bend at 0.5 m, and its face.
const YIELD_POST = box(-0.04, 0.04, 0.5, 2.84, -0.04, 0.04);
const YIELD_FACE = box(-0.46, 0.46, 2.1, 2.89, 0.04, 0.06);
const BILLBOARD = [box(-0.45, 0.45, 0, 10, -0.45, 0.45), box(-7.4, 7.4, 9.55, 14.4, -0.45, 1.55)];
/**
 * A crosswalk of `bars` bars, 1.2 m a bar across the road (x) and 3 m along it (z), drawn on the ground as paint is
 * (`paint`). Paint is walked and driven over as the road is, and a static has to have a box (shared/content/registry.ts):
 * so a small one deep under its origin, which is laid at the road's height at its middle. A box as wide as the bars stood
 * out of a road that slopes or is crowned under them, where a wheel met its edge.
 */
const crosswalk = (): ShapeBox[] => [box(-0.1, 0.1, -0.3, -0.2, -0.1, 0.1)];

export const STREET_PIECES: readonly StreetPiece[] = [
  { name: "lamp", color: GALV, hp: 3000, material: "core:mat_metal", boxes: [MAST, LAMP_HEAD] },
  // One that still works: its lens glows from dusk to dawn.
  { name: "lamp_lit", color: GALV, hp: 3000, material: "core:mat_metal", boxes: [MAST, LAMP_HEAD] },
  // Tilted from a heaved footing, 14 degrees along the kerb and 5 toward the road.
  { name: "lamp_leaning", color: GALV, hp: 3000, material: "core:mat_metal", boxes: [box(-0.3, 0.3, 0, 0.2, -0.3, 0.3)], hulls: [tilted(MAST, 5, 0, 14), tilted(LAMP_HEAD, 5, 0, 14)] },
  // Snapped at its foot, the mast lying along the kerb on the walk's side and its head beyond it.
  { name: "lamp_fallen", color: RUST, hp: 2000, material: "core:mat_metal", boxes: [box(-0.15, 0.15, 0, 0.42, -0.15, 0.15), box(-7.75, -0.1, 0, 0.27, -0.29, -0.03), box(-9.25, -7.9, 0, 0.42, -3.6, -0.1)] },
  { name: "signal", color: YELLOW, hp: 3000, material: "core:mat_metal", boxes: [SIGNAL_POLE, WALK, box(-0.35, 0.35, 4.85, 6.4, 0.2, 9.2)] },
  // The arm bowed down past its middle, one head gone.
  { name: "signal_bent", color: YELLOW, hp: 2500, material: "core:mat_metal", boxes: [SIGNAL_POLE, WALK, box(-0.35, 0.35, 4.2, 6.4, 0.2, 7.9)] },
  { name: "stop", color: RED, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.38, 0.38, 2.1, 2.86, 0.04, 0.08)] },
  // The post bent back 40 degrees at 0.5 m, as a car leaves it.
  { name: "stop_bent", color: RED, hp: 300, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 0.5, -0.04, 0.04)], hulls: [tilted(box(-0.04, 0.04, 0.5, 2.9, -0.04, 0.04), -40, 0.5), tilted(box(-0.38, 0.38, 2.1, 2.86, 0.04, 0.08), -40, 0.5)] },
  // R1-2, the 36-inch triangle a corner down at 2.1 m.
  { name: "yield", color: RED, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.84, -0.04, 0.04), YIELD_FACE] },
  // Bent back 35 degrees at 0.5 m and 12 over to one side, as a car leaves it.
  { name: "yield_bent", color: RED, hp: 300, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 0.5, -0.04, 0.04)], hulls: [tilted(YIELD_POST, -35, 0.5, 12), tilted(YIELD_FACE, -35, 0.5, 12)] },
  { name: "street_name", color: GREEN, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.75, -0.04, 0.04), box(-0.46, 0.46, 2.75, 2.95, -0.02, 0.02), box(-0.02, 0.02, 2.95, 3.17, -0.46, 0.46)] },
  { name: "speed", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.31, 0.31, 2.1, 2.86, 0.04, 0.08)] },
  { name: "evacuation", color: BLUE, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.7, -0.04, 0.04), box(-0.31, 0.31, 2.1, 2.71, 0.04, 0.08)] },
  { name: "speed40", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.31, 0.31, 2.1, 2.86, 0.04, 0.08)] },
  { name: "speed30", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.31, 0.31, 2.1, 2.86, 0.04, 0.08)] },
  { name: "speed25", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.31, 0.31, 2.1, 2.86, 0.04, 0.08)] },
  { name: "speed35", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.31, 0.31, 2.1, 2.86, 0.04, 0.08)] },
  { name: "speed45", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [POST, box(-0.31, 0.31, 2.1, 2.86, 0.04, 0.08)] },
  { name: "noentry", color: RED, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.8, -0.04, 0.04), box(-0.38, 0.38, 2.12, 2.88, 0.04, 0.06)] },
  // Its plate parallel to the one-way street, in front of the post.
  { name: "oneway", color: GALV, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.42, -0.04, 0.04), box(-0.46, 0.46, 2.12, 2.39, 0.03, 0.05)] },
  { name: "noparking", color: WHITE, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.62, -0.04, 0.04), box(-0.15, 0.15, 2.13, 2.59, 0.04, 0.06)] },
  { name: "crossing", color: YELLOW, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 3.05, -0.04, 0.04), box(-0.54, 0.54, 2.1, 3.18, 0.04, 0.06)] },
  { name: "deadend", color: YELLOW, hp: 400, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 3.05, -0.04, 0.04), box(-0.54, 0.54, 2.1, 3.18, 0.04, 0.06)] },
  // A sign's post whose plate is gone.
  { name: "post_bare", color: GALV, hp: 300, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 2.7, -0.04, 0.06)] },
  // Roof plant, standing on a flat roof.
  { name: "roof_ac", color: GALV, hp: 600, material: "core:mat_metal", boxes: [box(-0.5, 0.5, 0, 1.02, -0.42, 0.42)] },
  // On its side.
  { name: "roof_ac_tipped", color: GALV, hp: 500, material: "core:mat_metal", boxes: [box(-0.5, 0.5, 0, 0.84, -1.44, -0.42)] },
  { name: "roof_rtu", color: GALV, hp: 1500, material: "core:mat_metal", boxes: [box(-1.75, 1.75, 0, 1.72, -0.95, 0.95)] },
  { name: "roof_vent", color: RUST, hp: 300, material: "core:mat_metal", boxes: [box(-0.26, 0.26, 0, 0.95, -0.26, 0.26)] },
  { name: "roof_duct", color: GALV, hp: 600, material: "core:mat_metal", boxes: [box(-2, 2, 0, 1, -0.3, 0.3)] },
  { name: "roof_tank", color: WHITE, hp: 2500, material: "core:mat_metal", boxes: [box(-1.2, 1.2, 0, 1.7, -1.2, 1.2), box(-1.3, 1.3, 1.7, 5.2, -1.3, 1.3)] },
  { name: "roof_solar", color: BLUE, hp: 400, material: "core:mat_metal", boxes: [box(-1.6, 1.6, 0, 0.72, -0.5, 0.5)] },
  // One panel torn up and folded back over the rack.
  { name: "roof_solar_broken", color: BLUE, hp: 300, material: "core:mat_metal", boxes: [box(-1.6, 1.6, 0, 0.72, -0.55, 0.5)] },
  { name: "roof_bulkhead", color: WHITE, hp: 4000, material: "core:mat_stone", boxes: [box(-1.4, 1.4, 0, 2.85, -1.4, 1.4)] },
  { name: "roof_dish", color: GALV, hp: 300, material: "core:mat_metal", boxes: [box(-0.45, 0.45, 0, 1.45, -0.45, 0.5)] },
  { name: "pole", color: WOOD, hp: 2500, material: "core:mat_wood", boxes: [POLE, CROSSARM, TRANSFORMER] },
  // Leaning 12 degrees away from the road.
  { name: "pole_leaning", color: WOOD, hp: 2500, material: "core:mat_wood", boxes: [box(-0.2, 0.2, 0, 0.3, -0.2, 0.2)], hulls: [tilted(POLE, -12), tilted(CROSSARM, -12), tilted(TRANSFORMER, -12)] },
  { name: "hydrant", color: RED, hp: 1500, material: "core:mat_metal", boxes: [box(-0.2, 0.2, 0, 0.8, -0.17, 0.21)] },
  { name: "bench", color: GREEN, hp: 800, material: "core:mat_metal", boxes: [box(-0.92, 0.92, 0, 0.47, -0.25, 0.26), box(-0.92, 0.92, 0.47, 0.88, -0.29, -0.17)] },
  { name: "bench_broken", color: GREEN, hp: 500, material: "core:mat_metal", boxes: [box(-0.92, 0.92, 0, 0.47, -0.25, 0.26), box(-0.92, 0.3, 0.47, 0.88, -0.29, -0.17)] },
  { name: "bin", color: GREEN, hp: 500, material: "core:mat_metal", boxes: [box(-0.31, 0.31, 0, 0.97, -0.31, 0.31)] },
  { name: "bin_tipped", color: GREEN, hp: 500, material: "core:mat_metal", boxes: [box(-0.8, 0.25, 0, 0.62, -0.31, 0.31), box(0.58, 1.22, 0, 0.06, -0.32, 0.32)] },
  { name: "shelter", color: GALV, hp: 2500, material: "core:mat_metal", boxes: [...SHELTER, box(-2.1, 2.1, 2.38, 2.62, -0.9, 0.95), box(-1.2, 1.2, 0, 0.47, -0.72, -0.3)] },
  // The roof down at one end, the glass gone, the bench torn out.
  { name: "shelter_wrecked", color: RUST, hp: 2000, material: "core:mat_metal", boxes: [box(-2, 2, 0, 0.12, -0.8, -0.72), SHELTER[1]!, SHELTER[3]!, SHELTER[4]!, SHELTER[5]!], hulls: [{ corners: [[-2.1, 0.75, -0.9], [-2.1, 0.75, 0.95], [-2.1, 0.99, -0.9], [-2.1, 0.99, 0.95], [2.1, 2.38, -0.9], [2.1, 2.38, 0.95], [2.1, 2.62, -0.9], [2.1, 2.62, 0.95]] }] },
  // Its chute faces the walk, away from the road.
  { name: "mailbox", color: BLUE, hp: 1200, material: "core:mat_metal", boxes: [box(-0.26, 0.26, 0, 1.27, -0.3, 0.29)] },
  { name: "meter", color: GALV, hp: 500, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 1.06, -0.04, 0.04), box(-0.13, 0.13, 1.06, 1.5, -0.11, 0.11)] },
  { name: "meter_broken", color: RUST, hp: 300, material: "core:mat_metal", boxes: [box(-0.04, 0.04, 0, 1.02, -0.04, 0.04)] },
  // A car park's pay station on its pedestal, its panel facing the walk.
  { name: "paystation", color: KIOSK, hp: 800, material: "core:mat_metal", boxes: [box(-0.13, 0.13, 0, 0.5, -0.1, 0.1), box(-0.24, 0.24, 0.5, 1.65, -0.17, 0.17)] },
  // Torn from its pedestal at 0.45 m, lying on its back toward the road, turned 9 degrees, its screen smashed in.
  { name: "paystation_broken", color: KIOSK, hp: 500, material: "core:mat_metal", boxes: [box(-0.13, 0.13, 0, 0.45, -0.1, 0.1)], hulls: [{ corners: [[-0.1, 0.335, 0.522], [-0.1, 0, 0.522], [0.08, 0.335, 1.658], [0.08, 0, 1.658], [0.375, 0.335, 0.447], [0.375, 0, 0.447], [0.554, 0.335, 1.583], [0.554, 0, 1.583]] }] },
  { name: "bollard", color: YELLOW, hp: 2500, material: "core:mat_metal", boxes: [box(-0.09, 0.09, 0, 0.98, -0.09, 0.09)] },
  // A 3 m run between posts, the next run's first post at this one's last.
  { name: "fence", color: GALV, hp: 600, material: "core:mat_metal", boxes: [box(-1.5, 1.5, 0, 1.86, -0.04, 0.04)] },
  { name: "fence_sagging", color: GALV, hp: 500, material: "core:mat_metal", boxes: [box(-1.5, 1.5, 0, 1.86, -0.32, 0.06)] },
  { name: "fence_down", color: GALV, hp: 400, material: "core:mat_metal", boxes: [box(-1.54, -1.46, 0, 1.86, -0.04, 0.04), box(1.46, 1.54, 0, 1.86, -0.04, 0.04), box(-1.45, 1.45, 0, 0.07, 0.06, 1.82)] },
  { name: "rail", color: GALV, hp: 1500, material: "core:mat_metal", boxes: [box(-2, 2, 0, 0.85, -0.12, 0.34)] },
  { name: "rail_bent", color: RUST, hp: 1000, material: "core:mat_metal", boxes: [box(-2, 2, 0, 0.85, -0.55, 0.34)] },
  { name: "billboard", color: GALV, hp: 6000, material: "core:mat_metal", boxes: BILLBOARD },
  { name: "billboard_bare", color: RUST, hp: 5000, material: "core:mat_metal", boxes: BILLBOARD },
  // Its window faces the walk.
  { name: "newsbox", color: BLUE, hp: 600, material: "core:mat_metal", boxes: [box(-0.26, 0.26, 0, 1.06, -0.25, 0.24)] },
  // Crosswalk bars on the road, 1, 2, 4 and 8 of them, fresh and worn; nothing harms paint.
  ...[1, 2, 4, 8].flatMap((bars): StreetPiece[] => [
    { name: `crosswalk${bars}`, color: WHITE, hp: 1000, boxes: crosswalk(), paint: true },
    { name: `crosswalk${bars}_worn`, color: WHITE, hp: 1000, boxes: crosswalk(), paint: true },
  ]),
];

/** A piece's static id, which is also its mesh's. */
export const streetKind = (name: string): string => `core:zzstreet_${name}`;
const shapeId = (name: string): string => `core:zzstreetshape_${name}`;

const SHAPES: readonly ShapeDef[] = STREET_PIECES.map((p) => ({ type: "shape", id: shapeId(p.name), role: "thing", boxes: p.boxes, ...(p.hulls ? { hulls: p.hulls } : {}) }));
const STATICS: readonly StructureDef[] = STREET_PIECES.map((p) => ({
  type: "structure", class: "static", id: streetKind(p.name), mesh: streetKind(p.name), shape: shapeId(p.name), half: shapeHalf(p.boxes, p.hulls),
  color: p.color, hp: p.hp, ...(p.material ? { material: p.material } : {}), ...(p.paint ? { paint: true as const } : {}),
  // Drawn near only: left out of the far city's lattice and mass, where a lamp would take a whole cell. A billboard is seen from afar.
  ...(p.name.startsWith("billboard") ? {} : { near: true as const }),
}));
// The curb returns at street corners (content/curbs.ts) are the street's too.
export const STREET: readonly Def[] = [...SHAPES, ...STATICS, ...CURB_RETURNS];

/**
 * What a car knocks down (server/vehicle-trees.ts): a lamp or a wooden pole hit hard enough becomes its fallen form where it
 * stood, for the joules its foot takes to give way, a trunk's account as the trees keep it (shared/sim/vehicle-tree.ts).
 */
export const STREET_TOPPLES: Readonly<Record<string, { into: string; work: number }>> = {
  [streetKind("lamp")]: { into: streetKind("lamp_fallen"), work: 30000 },
  [streetKind("lamp_leaning")]: { into: streetKind("lamp_fallen"), work: 15000 },
  [streetKind("pole")]: { into: streetKind("pole_leaning"), work: 60000 },
};
