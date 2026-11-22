// Named places for a test to stand in: small maps written as files, which a server loads and a client reads as it would any map.

import { CHUNK_SIZE } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { flatGround } from "../fixtures/arena.ts";
import { flatMap } from "../fixtures/map.ts";
import type { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

export interface Spot {
  x: number;
  z: number;
}

export interface Place {
  /** The map file. Without one, the proving ground. */
  map?: Uint8Array<ArrayBuffer>;
  /** Where the first survivor stands, looking north (+Z). */
  at(h: Harness): Spot;
}

/** The middle of every map here, and its spawn point. */
export const MIDDLE: Spot = { x: 128, z: 128 };
const { x: X, z: Z } = MIDDLE;
const SIDE = (4 * CHUNK_SIZE) / TERRAIN_CELL + 1;
const QUARTER = 16384;

function made<T extends object>(more: Partial<MapData>, spots: T): Place & T {
  const map = writeMap(flatMap(4, more));
  return { map, at: () => MIDDLE, ...spots };
}

/** Heights for a 256 m map from a function of the place, in metres. */
function heights(y: (x: number, z: number) => number): Uint16Array {
  return Uint16Array.from({ length: SIDE * SIDE }, (_, k) => Math.round((y((k % SIDE) * TERRAIN_CELL, Math.floor(k / SIDE) * TERRAIN_CELL) + 32) * 256));
}

let flat: Place | null = null;

/** Flat, dry, empty ground 256 m on a side, at y = 0. */
export function field(): Place {
  return (flat ??= made({}, {}));
}

/** The field with a sealed 6 m room around the survivor: four walls and a ceiling at 3 m. */
export function room(): Place & { min: Spot; max: Spot } {
  const statics: MapStatic[] = [];
  for (const o of [-1.5, 1.5]) {
    for (const side of [-3, 3]) {
      statics.push({ kind: "core:wall", x: X + o, y: 1.5, z: Z + side, yaw: 0 }, { kind: "core:wall", x: X + side, y: 1.5, z: Z + o, yaw: QUARTER });
    }
    for (const p of [-1.5, 1.5]) statics.push({ kind: "core:ceiling", x: X + o, y: 3.1, z: Z + p, yaw: 0 });
  }
  return made({ id: "test:room", statics }, { min: { x: X - 2.9, z: Z - 2.9 }, max: { x: X + 2.9, z: Z + 2.9 } });
}

/** The field with a wall 6 m wide and 3 m high across the way north, 6 m off. */
export function yard(): Place & { wall: Spot } {
  const statics = [-1.5, 1.5].map((o) => ({ kind: "core:wall", x: X + o, y: 1.5, z: Z + 6, yaw: 0 }));
  return made({ id: "test:yard", statics }, { wall: { x: X, z: Z + 6 } });
}

/** The field with a car parked 6 m north, its nose to the north and its driver's door to the survivor. */
export function street(kind = "core:compact"): Place & { car: Spot } {
  const car = { x: X + 2.5, z: Z + 6 };
  return made({ id: "test:street", vehicles: [{ kind, ...car, yaw: 0 }] }, { car });
}

/** A shore at y = 1 and, from 8 m north of the survivor, water 4 m deep. `water` is 30 m out. */
export function pond(): Place & { water: Spot } {
  const ground = heights((_x, z) => Math.max(-4, Math.min(1, 1 - (z - Z - 8) * 0.5)));
  return made({ id: "test:pond", seaLevel: 0, heights: ground }, { water: { x: X, z: Z + 30 } });
}

/** A quay with the sea 8 m deep to the east, a dock out over it from where the survivor stands, and a boat moored along the dock at `berth`. */
export function dock(kind = "core:jon_boat"): Place & { berth: Spot; boat: Spot } {
  const ground = heights((x) => (x < X + 4 ? 0.6 : Math.max(-8, 0.6 - (x - X - 4) * 0.55)));
  const statics: MapStatic[] = [];
  for (let x = X + 3; x <= X + 30; x += 3) statics.push({ kind: "core:ceiling", x, y: 0.7, z: Z, yaw: 0 });
  // The dock's edge is a fender's gap from the hull.
  const boat = { x: X + 24, z: Z + 1.9 + coreRegistry().vehicle[coreRegistry().index.get(kind)!]!.spec.halfWidth };
  return made({ id: "test:dock", seaLevel: 0, heights: ground, statics, vehicles: [{ kind, ...boat, yaw: QUARTER }] }, { berth: { x: X + 24, z: Z + 1 }, boat });
}

/** The proving ground at its spawn point: trees, rocks, bushes, a pool, crates. */
export function proving(): Place {
  return { at: (h) => h.world.spawn };
}

/** Level, dry, empty ground on the proving ground, `wide` by `deep`: the survivor stands `from` metres into it, the rest to the north. */
export function clearing(wide = 40, deep = 30, from = 6): Place {
  return {
    at(h) {
      const g = flatGround(h, wide, deep);
      return { x: g.x + wide / 2, z: g.z + from };
    },
  };
}
