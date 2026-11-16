// A destroyed hull is still the same rigid boat. Flooding removes displacement over time; the seabed is its support.
import { len3 } from "../math/scalar.ts";
import { stepBoat, type BoatState, type BoatWorld } from "./boat.ts";
import type { BoatVehicleDefinition } from "./vehicle.ts";

const unattended = { throttle: 0, steer: 0, neutral: true, pilot: false };
export function stepBoatWreck(s: BoatState, def: BoatVehicleDefinition, world: BoatWorld): boolean {
  s.engineOn = false; s.engineCondition = 0; s.hullCondition = 0;
  // A wreck has open structural breaches. Preserve existing water and let the same bounded ingress fill it.
  stepBoat(s, unattended, def, world);
  return s.grounded && len3(s.vx, s.vy, s.vz) < .08 && len3(s.pitchRate, s.yawRate, s.rollRate) < .05;
}
