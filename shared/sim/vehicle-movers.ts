// A vehicle or a heavy creature as a ragdoll meets it (shared/anim/ragdoll.ts movers): a box or two in its frame, its
// frame on the ground under its middle. Each way a vehicle moves says its boxes (families.ts movers); a creature is its
// footprint up to its height.

import { familyOf } from "./families.ts";
import type { VehicleDefinition } from "./vehicle.ts";
import type { Registry } from "../content/registry.ts";
import type { MoverPose } from "../anim/ragdoll.ts";
import { quatUnrotate } from "../math/quat.ts";
import { bodyMass } from "./body-mass.ts";

const known = new WeakMap<VehicleDefinition, Float64Array>();

/** Centre and half size of each box, six numbers each, in the vehicle's frame. */
export function moverBoxes(def: VehicleDefinition): Float64Array {
  const cached = known.get(def);
  if (cached) return cached;
  const out = Float64Array.from(familyOf(def)?.movers(def) ?? []);
  known.set(def, out);
  return out;
}

/** How far from a vehicle's frame its boxes reach at most. */
export function moverReach(def: VehicleDefinition): number {
  const b = moverBoxes(def);
  let most = 0;
  for (let k = 0; k < b.length; k += 6) {
    const reach = Math.sqrt(b[k]! * b[k]! + b[k + 1]! * b[k + 1]! + b[k + 2]! * b[k + 2]!) + Math.sqrt(b[k + 3]! * b[k + 3]! + b[k + 4]! * b[k + 4]! + b[k + 5]! * b[k + 5]!);
    if (reach > most) most = reach;
  }
  return most;
}

/**
 * The most solids one ragdoll meets in a step, and metres beyond a solid's reach within which it is met. Past the most,
 * every machine meets the same ones (nearestMovers).
 */
export const MOVERS_MOST = 4;
export const MOVER_MARGIN = 2;

const local = new Float64Array(4);

/**
 * How near a solid's `boxes` come to the point (x, y, z) with its frame at `pose`: the distance to its nearest box, 0
 * inside one, in whole centimetres, so that two machines' places a hair apart rank it alike.
 */
export function moverNear(boxes: Float64Array, pose: MoverPose, x: number, y: number, z: number): number {
  local[0] = pose.qx; local[1] = pose.qy; local[2] = pose.qz; local[3] = pose.qw;
  quatUnrotate(local, 0, x - pose.x, y - pose.y, z - pose.z, local, 0);
  let best = Infinity;
  for (let k = 0; k < boxes.length; k += 6) {
    const dx = Math.max(0, Math.abs(local[0]! - boxes[k]!) - boxes[k + 3]!);
    const dy = Math.max(0, Math.abs(local[1]! - boxes[k + 1]!) - boxes[k + 4]!);
    const dz = Math.max(0, Math.abs(local[2]! - boxes[k + 2]!) - boxes[k + 5]!);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
  return Math.floor(best * 100);
}

/**
 * Orders the solids a ragdoll may meet as every machine does, and keeps the MOVERS_MOST first: the nearest (`near`,
 * moverNear) first, so those it can touch come before those it cannot, then the lower handle.
 */
export function nearestMovers<T extends { near: number; handle: number }>(found: T[]): void {
  found.sort((a, b) => a.near - b.near || a.handle - b.handle);
  if (found.length > MOVERS_MOST) found.length = MOVERS_MOST;
}

/** Kilograms at which a creature walking into a ragdoll moves it, rather than passing through as a lighter one does. */
export const HEAVY_MOVER = 300;
/** Metres a tick a creature must cover to move a ragdoll: one standing still leaves what lies at its feet alone. */
export const WALKING = 0.5 / 30;

/** What a body of some kind is to a ragdoll it meets: its boxes in its own frame and how far they reach. */
export interface Solid {
  readonly boxes: Float64Array;
  readonly reach: number;
  /** Whether its frame turns by a vehicle's full attitude, or only by the body's yaw. */
  readonly vehicle: boolean;
}

const solids = new WeakMap<Registry, (Solid | null)[]>();

/** The solid a body of `kind` is to ragdolls: a vehicle's boxes, a heavy creature's footprint as a box, or none. */
export function solidOf(reg: Registry, kind: number): Solid | null {
  let list = solids.get(reg);
  if (!list) solids.set(reg, (list = []));
  if (kind in list) return list[kind]!;
  let solid: Solid | null = null;
  const def = reg.vehicle[kind];
  if (def) solid = { boxes: moverBoxes(def), reach: moverReach(def), vehicle: true };
  else if (reg.move[kind] && reg.defs[kind]?.type === "species" && bodyMass(reg, kind) >= HEAVY_MOVER) {
    // Where its legs sweep: its body's round about its middle, up to its belly. Under its head and tail lies open ground.
    const r = reg.bodyRadius[kind]!, belly = reg.bodyHeight[kind]! * 0.4;
    const boxes = Float64Array.of(0, belly / 2, 0, r, belly / 2, r);
    solid = { boxes, reach: belly / 2 + Math.sqrt(2 * r * r + (belly / 2) * (belly / 2)), vehicle: false };
  }
  list[kind] = solid;
  return solid;
}
