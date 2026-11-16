// Original SNARK utility-boat tuning, not a claimed specification of any real craft.
import type { BoatSpec } from "../../shared/sim/vehicle.ts";
import { BOAT_ART as ART } from "./boat-art.ts";

export const BOAT: BoatSpec = {
  halfWidth: ART.hull.max[0], halfLength: ART.hull.max[2], height: ART.envelope.max[1], clearance: 0,
  mass: 1400, displacement: 4000, draft: .35, buoyancyHeight: 1, buoyancyDamping: 4.8,
  centerOfMass: [0, .56, -.35],
  buoyancyPoints: [
    { at: [-.9, .5, -2.3], weight: 1 / 6 }, { at: [.9, .5, -2.3], weight: 1 / 6 },
    { at: [-.9, .5, -.35], weight: 1 / 6 }, { at: [.9, .5, -.35], weight: 1 / 6 },
    { at: [-.9, .5, 1.6], weight: 1 / 6 }, { at: [.9, .5, 1.6], weight: 1 / 6 },
  ],
  hullBoxes: [
    { at: [0, .405, -3], half: [1.16, .325, .4] },
    { at: [0, .365, -.55], half: [1.30, .365, 2.05] },
    { at: [0, .475, 1.9], half: [1, .295, .4] },
    { at: [0, .68, 2.6], half: [.57, .25, .3] },
    { at: [0, 1.25, 3.15], half: [.12, .23, .25] },
    { at: [-1.245, 1.045, -.55], half: [.055, .315, 2.75] },
    { at: [1.245, 1.045, -.55], half: [.055, .315, 2.75] },
    { at: [0, 1.045, -3.33], half: [1.16, .315, .07] },
    { at: [0, 2.125, 1.39], half: [1.04, .325, .11] },
    { at: [0, 1.15, -3.70], half: [.40, .49, .38] },
    { at: [0, -.035, -3.82], half: [.065, .245, .17] },
  ],
  propeller: { at: ART.propeller.center, radius: ART.propeller.radius },
  thrust: 9000, reverseThrust: 4000, idleRpm: 750, maxRpm: 5600, rpmRate: 3600, shiftDelay: .28,
  maxSteer: ART.outboard.turn, steerRate: 1.6, maxForward: 24, maxReverse: 5,
  planingSpeed: 8, planingLift: .44, planingTrim: .085,
  forwardDrag: 19, sideDrag: 1250, angularDrag: 2.8, gravity: 18,
  fuelCapacity: 90, fuelPerSecond: .045,
};
