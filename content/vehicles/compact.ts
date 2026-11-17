// First original vehicle in the actual game's species registry. Presentation lives in its asset source.
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { WheelVehicleDefinition, VehicleSpec, VehicleSurface } from "../../shared/sim/vehicle.ts";

export const COMPACT: VehicleSpec = {
  halfWidth: 0.9, halfLength: 2, height: 1.5, clearance: 0.12,
  wheelbase: 2.5, track: 1.56, wheelRadius: 0.3,
  acceleration: 8, brake: 13, maxForward: 34, maxReverse: 6, mass: 1100,
  drivetrain: {
    torqueCurve: [[850, 180], [1800, 280], [3200, 310], [4800, 300], [6200, 270], [6800, 210]],
    idleRpm: 850, redlineRpm: 6800, launchRpm: 2100, rpmResponse: 12000,
    forwardRatios: [3.2, 2.12, 1.55, 1.17, 0.92], reverseRatio: 3.05, finalDrive: 3.9, efficiency: 0.9,
    upshiftRpm: 5800, downshiftRpm: 2050, shiftDuration: 0.16, shiftCooldown: 0.65, engineBrakeNm: 24,
  },
  maxSteer: 0.55, steerRate: 2.4, maxRise: 0.25, maxDrop: 0.4,
  minGroundNormal: 0.85, fuelCapacity: 40, fuelPerSecond: 0.003,
  // A responsive road coupe: stable rear tires, progressive steering and a short recoverable handbrake flick.
  frontGrip: 1.2, rearGrip: 1.25, corneringStiffness: 8.5,
  yawInertia: 1.35, yawDamping: 1.1, steerSpeed: 22, handbrakeGrip: 0.23,
  suspensionFrequency: 10, suspensionDamping: 0.9, suspensionTravel: 0.19,
  gravity: 18, airDrag: 0.035, dragScale: 0.25,
};

export const ASPHALT: VehicleSurface = { id: "asphalt", grip: 7, rolling: 0.15, drag: 0.009 };
export const GRAVEL: VehicleSurface = { id: "gravel", grip: 3.5, rolling: 0.5, drag: 0.018 };
export const MUD: VehicleSurface = { id: "mud", grip: 1.8, rolling: 1.1, drag: 0.035 };

// Doors, wheels and the steering wheel name the rig's bones; each seat's anchor is its rig socket's point
// (assets/source/core/vehicles/compact/ref/DESIGN.md), and the anchor is what server and client both use.
export const COMPACT_VEHICLE: WheelVehicleDefinition = {
  id: "core:compact", frame: "car", spec: COMPACT,
  seats: [
    { id: "driver", driver: true, anchor: [0.42, 0.59, 0.12], entry: [1.25, 0, 0.12], door: 0 },
    { id: "passenger", anchor: [-0.42, 0.59, 0.12], entry: [-1.25, 0, 0.12], door: 1 },
  ],
  doors: [
    { bone: "door_left", axis: [0, 1, 0], open: -1.1, openTicks: 6, closeTicks: 10 },
    { bone: "door_right", axis: [0, 1, 0], open: 1.1, openTicks: 6, closeTicks: 10 },
  ],
  wheels: [
    { bone: "wheel_front_left", steers: true }, { bone: "wheel_front_right", steers: true },
    { bone: "wheel_rear_left" }, { bone: "wheel_rear_right" },
  ],
  steeringWheel: { bone: "steering_wheel", axis: [0, 0, 1], ratio: -4.5 },
  actionTicks: 18,
  // The door sills: the side windows are down and the screens open in the middle (DESIGN.md).
  beltline: 0.95,
};

/** Uses normal entity health, cargo and ownership; the vehicle controller supplies all movement. */
export const COMPACT_SPECIES: SpeciesDef = {
  type:"species", class:"vehicle", id:"core:compact", aliases:["compact", "car"],
  mesh:"core:compact", skeleton:"core:compact", color:9,
  radius:.9, height:1.5, eyeHeight:1.11,
  walkSpeed:.01, sprintMul:1, jumpSpeed:.01, still:true,
  mass:1100, slots:24, keeps:1, fists:0,
  stats:{health:[800,0,0],stamina:[40,0,0],weight:[400,0,0]},
  // Its paint, seats and wheels take colour as a creature's regions take dye (the asset paints regions 0 to 2).
  regions: [
    { name: "Paint", colors: [232, 90, 230, 233, 22, 29, 41, 136, 124, 28, 213, 226].map((c) => [c, 1] as const) },
    { name: "Upholstery", colors: [220, 230, 97, 22, 103].map((c) => [c, 1] as const) },
    { name: "Wheels", colors: [91, 84, 230, 232, 166].map((c) => [c, 1] as const) },
    null, null, null,
  ],
  vehicle:COMPACT_VEHICLE,
};
