// What another vehicle is to a shape query: its parts posed where it stands, each swept and handed to the caller's own
// contact test, and what its hazard part is when that is the part met (shared/sim/families.ts).

import { familyOf } from "../sim/families.ts";
import type { VehicleFrame } from "../sim/vehicle-frame.ts";
import type { VehicleDefinition } from "../sim/vehicle.ts";
import type { Solid } from "./convex.ts";
import { sweep, type SolidFrame, type Swept } from "./vehicle-solid.ts";

export interface OtherHit { otherRotor: boolean; otherPropeller: boolean }

/** The first of `other`'s parts that `meet` finds a contact with: posed at `target`, its jointed parts as `otherFrame` turns them. */
export function meetOther<H extends OtherHit>(other: VehicleDefinition, otherFrame: VehicleFrame, target: SolidFrame, swept: Swept, meet: (solid: Solid) => H | null): H | null {
  const family = familyOf(other);
  if (!family) return null;
  const mounts = family.mounts(other, otherFrame);
  for (const part of family.parts(other)) {
    const pose = part.joint === undefined || !mounts ? target : mounts[part.joint]!;
    sweep(part, pose, pose, swept);
    const hit = meet(swept.solid);
    if (hit) {
      hit.otherRotor = family.hazard === "rotor" && part.hazard;
      hit.otherPropeller = family.hazard === "propeller" && part.hazard;
      return hit;
    }
  }
  return null;
}
