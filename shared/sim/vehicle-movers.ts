// A vehicle as a ragdoll meets it (shared/anim/ragdoll.ts movers): a box or two in its frame, its frame on the ground
// under its middle. A car is its body below the belt line and a narrower cabin above; anything with authored body boxes
// is those boxes; anything else is its hull's box.

import type { VehicleDefinition } from "./vehicle.ts";

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
