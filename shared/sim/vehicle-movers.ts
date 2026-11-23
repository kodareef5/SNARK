// A vehicle or a heavy creature as a ragdoll meets it (shared/anim/ragdoll.ts movers): a box or two in its frame, its
// frame on the ground under its middle. A car is its body below the belt line and a narrower cabin above; anything with
// authored body boxes is those boxes; any other vehicle its hull's box; a creature its footprint up to its height.

import type { VehicleDefinition } from "./vehicle.ts";
import type { Registry } from "../content/registry.ts";
import { bodyMass } from "./body-mass.ts";

const known = new WeakMap<VehicleDefinition, Float64Array>();

/** Centre and half size of each box, six numbers each, in the vehicle's frame. */
export function moverBoxes(def: VehicleDefinition): Float64Array {
  const cached = known.get(def);
  if (cached) return cached;
  const s = def.spec as { readonly halfWidth: number; readonly halfLength: number; readonly height: number; readonly clearance: number; readonly bodyBoxes?: readonly { readonly at: readonly number[]; readonly half: readonly number[] }[] };
  let boxes: number[];
  if (s.bodyBoxes?.length) boxes = s.bodyBoxes.flatMap(b => [b.at[0]!, b.at[1]!, b.at[2]!, b.half[0]!, b.half[1]!, b.half[2]!]);
  else {
    const low = s.clearance > 0 ? s.clearance : 0, top = s.height, belt = def.beltline > low && def.beltline < top ? def.beltline : (low + top) / 2;
    boxes = def.movement !== "boat" && def.movement !== "rotor"
      ? [0, (low + belt) / 2, 0, s.halfWidth, (belt - low) / 2, s.halfLength, 0, (belt + top) / 2, 0, s.halfWidth * 0.85, (top - belt) / 2, s.halfLength * 0.5]
      : [0, (low + top) / 2, 0, s.halfWidth, (top - low) / 2, s.halfLength];
  }
  const out = Float64Array.from(boxes);
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
