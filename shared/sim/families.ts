// The ways a vehicle moves. A family is one file under families/ and one line in FAMILIES: what its content must hold
// and how its body steps. Content picks one with `movement`; a vehicle with none is wheeled.

import type { CollisionWorld } from "../world/collide.ts";
import type { Body } from "./character.ts";
import { BOAT } from "./families/boat.ts";
import { ROTOR } from "./families/rotor.ts";
import { WHEELED } from "./families/wheeled.ts";
import type { VehicleDefinition, VehicleWorld } from "./vehicle.ts";

export interface VehicleFamily<D extends VehicleDefinition = VehicleDefinition> {
  /** Its `movement` in content. */
  readonly name: string;
  /** Whether a definition is of this family. */
  is(d: VehicleDefinition): d is D;
  /** Its own checks of a definition, before the checks every vehicle shares. Throws on the first fault. */
  validateSpec(d: D): void;
  /** Its own checks of the rig, after the doors and wheels every vehicle shares. */
  validateRig(d: D): void;
  /**
   * One fixed tick of a body driven by `moveX`, `moveZ` and `buttons`, the ordinary signed bytes and buttons; each family
   * reads them its own way. What happened is left in `vehicleStep` (vehicle-state.ts).
   */
  step(w: CollisionWorld, b: Body, moveX: number, moveZ: number, buttons: number, def: D, pilot: boolean, environment?: VehicleWorld): void;
}

/** The one place a row is widened to take any definition: a family only ever gets definitions its `is` accepts. */
const family = <D extends VehicleDefinition>(row: VehicleFamily<D>): VehicleFamily => row as unknown as VehicleFamily;

export const FAMILIES: readonly VehicleFamily[] = [
  family(WHEELED),
  family(ROTOR),
  family(BOAT),
];

/** The family of `d`, or null for a movement no family has. */
export function familyOf(d: VehicleDefinition): VehicleFamily | null {
  for (let i = 0; i < FAMILIES.length; i++) if (FAMILIES[i]!.is(d)) return FAMILIES[i]!;
  return null;
}
