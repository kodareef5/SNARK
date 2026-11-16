// A landmark: a map's own great structure, which is a content file and its art (assets/source/landmarks/<name>/) and is
// placed by the maps that have it. It gives its pieces and vehicles in its own metres; a map sets its origin down and
// turns it, and ships its definitions and files with it (MapContent).

import type { Def } from "../content/defs.ts";
import { STRUCT_UNITS } from "../coords.ts";
import { frameAxes, HALF_SIDE } from "./frame.ts";
import type { MapStatic, MapVehicle } from "./mapfile.ts";

type Vec3 = readonly [number, number, number];

/** A static of the landmark: its kind, where it stands in the landmark's metres, and its yaw there in 1/65,536 turns. */
export interface LandmarkPiece {
  readonly kind: string;
  readonly at: Vec3;
  readonly yaw: number;
}

/** A vehicle the landmark brings, parked with it as a map parks one. Its height is the map's to give, where it floats. */
export interface LandmarkVehicle {
  readonly kind: string;
  readonly id: string;
  readonly at: Vec3;
  readonly yaw: number;
  readonly condition?: readonly [number, number];
  readonly fuel?: readonly [number, number];
}

/**
 * Ground the map lays for it: each a rectangle of the landmark's x and z, its ground set to `y`, or with `dig` only lowered
 * to it, so a hull has water under it and a gangway a quay to land on.
 */
export interface LandmarkGround {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly y: number;
  readonly dig?: boolean;
}

export interface Landmark {
  /** Its files' name (assets/landmarks/<name>.json) and its definitions' namespace. */
  readonly name: string;
  readonly defs: readonly Def[];
  readonly pieces: readonly LandmarkPiece[];
  readonly vehicles: readonly LandmarkVehicle[];
  readonly ground: readonly LandmarkGround[];
}

/** A point of the landmark set down at (x, y, z) and turned by `yaw`, by the lattice frame its pieces are walked in. */
export function landmarkPoint(x: number, y: number, z: number, yaw: number, at: Vec3, out: number[] | Float64Array): void {
  const axes = new Int32Array(4);
  frameAxes(yaw, axes);
  out[0] = x + (at[0] * axes[0]! + at[2] * axes[2]!) / HALF_SIDE;
  out[1] = y + at[1];
  out[2] = z + (at[0] * axes[1]! + at[2] * axes[3]!) / HALF_SIDE;
}

const snap = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;

/** Its statics and vehicles with its origin at (x, y, z) and turned by `yaw` in 1/65,536 turns, on the lattice statics stand on. */
export function placeLandmark(l: Landmark, x: number, y: number, z: number, yaw: number): { statics: MapStatic[]; vehicles: MapVehicle[] } {
  const p = [0, 0, 0];
  const statics = l.pieces.map((s): MapStatic => {
    landmarkPoint(x, y, z, yaw, s.at, p);
    return { kind: s.kind, x: snap(p[0]!), y: snap(p[1]!), z: snap(p[2]!), yaw: (yaw + s.yaw) & 65535 };
  });
  const vehicles = l.vehicles.map((v): MapVehicle => {
    landmarkPoint(x, y, z, yaw, v.at, p);
    return { kind: v.kind, id: v.id, x: p[0]!, z: p[2]!, yaw: (yaw + v.yaw) & 65535, ...(v.condition ? { condition: v.condition } : {}), ...(v.fuel ? { fuel: v.fuel } : {}) };
  });
  return { statics, vehicles };
}
