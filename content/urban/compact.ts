// First original vehicle in the actual game's species registry. Presentation lives in its asset source.
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { VehicleDefinition, VehicleSpec, VehicleSurface } from "../../shared/sim/vehicle.ts";

export const COMPACT: VehicleSpec = {
  halfWidth: 0.9, halfLength: 2, height: 1.5, clearance: 0.12,
  wheelbase: 2.5, track: 1.56, wheelRadius: 0.3,
  acceleration: 5, brake: 10, maxForward: 22, maxReverse: 6,
  maxSteer: 0.55, steerRate: 1.6, maxRise: 0.25, maxDrop: 0.4,
  minGroundNormal: 0.85, fuelCapacity: 40, fuelPerSecond: 0.003,
};

export const ASPHALT: VehicleSurface = { id: "urban:asphalt", grip: 7, rolling: 0.15, drag: 0.009 };
export const GRAVEL: VehicleSurface = { id: "urban:gravel", grip: 3.5, rolling: 0.5, drag: 0.018 };
export const MUD: VehicleSurface = { id: "urban:mud", grip: 1.8, rolling: 1.1, drag: 0.035 };

export const COMPACT_VEHICLE: VehicleDefinition = {
  id: "urban:compact", spec: COMPACT,
  seats: [
    { id: "driver", driver: true, anchor: [0.42, 0.59, 0.12], entry: [1.25, 0, 0.12] },
    { id: "passenger", anchor: [-0.42, 0.59, 0.12], entry: [-1.25, 0, 0.12] },
  ],
};

/** Uses normal entity health, cargo and ownership; the vehicle controller supplies all movement. */
export const COMPACT_SPECIES: SpeciesDef = {
  type:"species", class:"vehicle", id:"urban:compact", aliases:["compact", "car"],
  mesh:"urban:compact", skeleton:"urban:compact", color:9,
  radius:.9, height:1.5, eyeHeight:1.11,
  walkSpeed:.01, sprintMul:1, jumpSpeed:.01, still:true,
  mass:1100, slots:24, keeps:1, fists:0,
  stats:{health:[800,0,0],stamina:[40,0,0],weight:[400,0,0]},
  vehicle:COMPACT_VEHICLE,
};
