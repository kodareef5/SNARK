// Sloped static pieces: proof that a map's statics may be ramps, stair flights, pitched roofs and slabs that lean, and the
// form a city generator copies (shared/content/slopes.ts). Their ids sort after every other core id, so no index moves.

import type { Def, ShapeDef } from "../shared/content/defs.ts";
import { leaning, pitchedRoof, slopeShape, slopedSlab, stairFlight, staticOf, wedge } from "../shared/content/slopes.ts";

const CONCRETE = { color: 100, material: "core:mat_stone", hp: 16000 } as const;
const RUBBLE = { color: 10, material: "core:mat_stone", hp: 12000 } as const;
const ROOF = { color: 183, material: "core:mat_stone", hp: 9000 } as const;

const name = (n: string): string => `core:zslope_${n}`;

/** Each shape and the finish its static is made in. */
const PIECES: readonly (readonly [ShapeDef, typeof CONCRETE | typeof RUBBLE | typeof ROOF])[] = [
  // A ramp up to a deck a storey high: 4 m across, rising 2 m over 6 m, about 18 degrees.
  [slopeShape(name("shape_ramp"), "stairs", [slopedSlab(4, 6, 2, 0.4)]), CONCRETE],
  // Rubble heaped against a wall: a solid wedge 1.5 m high over 4 m.
  [slopeShape(name("shape_rubble"), "thing", [wedge(4, 4, 1.5)]), RUBBLE],
  // A storey's flight as the city lays it in eleven steps (2 m across, 4 m over 5.5 m, 36 degrees), in one piece.
  [stairFlight(name("shape_stairs"), 2, 5.5, 4, { steps: 11, slab: 0.8 }), CONCRETE],
  // A solid flight, a 3 m storey over 3.6 m: a flight is walked as a ramp, so it is kept under 40 degrees.
  [stairFlight(name("shape_stairs_solid"), 3, 3.6, 3, { steps: 10 }), CONCRETE],
  // A floor slab fallen at one side, leaning at 30 degrees on the floor below.
  [slopeShape(name("shape_slab30"), "thing", [leaning([4, 0.2, 4], 30)]), CONCRETE],
  // A wall panel gone over to 60 degrees: too steep to walk up.
  [slopeShape(name("shape_slab60"), "thing", [leaning([2, 0.25, 1.5], 60)]), CONCRETE],
  // A pitched roof over an 8 m house, its ridge 2.5 m over the eaves.
  [slopeShape(name("shape_roof"), "ceiling", pitchedRoof(8, 8, 2.5, 0.25)), ROOF],
];

export const SLOPE_SHAPES: readonly ShapeDef[] = PIECES.map(([s]) => s);

export const SLOPE_BLOCKS: readonly Def[] = [...SLOPE_SHAPES, ...PIECES.map(([s, finish]) => staticOf(s.id.replace("shape_", ""), s, finish))];

/** A static of each sloped kind, by its short name: "ramp", "rubble", "stairs", "stairs_solid", "slab30", "slab60", "roof". */
export const slopeKind = (n: string): string => name(n);
