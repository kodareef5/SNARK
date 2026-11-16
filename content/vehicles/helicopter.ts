// An original utility helicopter. These are SNARK handling choices, not specifications of a real aircraft.
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { HelicopterSpec, RotorVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { HELICOPTER_ART as ART } from "./helicopter-art.ts";

export const HELICOPTER: HelicopterSpec = {
  halfWidth: ART.cabin.max[0], halfLength: ART.cabin.max[2], height: ART.cabin.max[1], clearance: ART.cabin.min[1],
  mass: 1050, liftMass: 2050, fuelCapacity: 100, fuelPerSecond: 0.055,
  maxForward: 28, maxReverse: 10, maxSide: 12, cruiseMultiplier: 1.5,
  climbSpeed: 7, descendSpeed: 5, acceleration: 7, brake: 11,
  turnRate: 1.75, turnAcceleration: 4.5, pitchRate: 1.8, rollRate: 2.5, bankAngle: 0.48, pitchAngle: 0.34, attitudeResponse: 5,
  gravity: 18, rotorRpm: 410, spoolUp: 105, spoolDown: 70,
  skidHalfWidth: ART.skids.halfWidth, skidHalfLength: 1.75, minGroundNormal: 0.94,
  tail: { from: [0, 1.65, -1.65], to: [0, 1.91, -5.65], radius: 0.48, tipRadius: 0.09,
    boxes: [{ at: [0, 2.11, -5.475], half: [0.065, 0.84, 0.375] }, { at: [0, 1.775, -4.635], half: [0.70, 0.045, 0.185] }] },
};

export const HELICOPTER_VEHICLE: RotorVehicleDefinition = {
  id: "core:helicopter", movement: "rotor", spec: HELICOPTER, wreck: "core:helicopter_wreck",
  seats: [
    { id: "pilot", driver: true, anchor: ART.anchors.seat_driver, entry: ART.anchors.approach_front_left, door: 0, pose: "pilot", weapons: false, controls: { left: ART.anchors.collective, right: ART.anchors.cyclic } },
    { id: "front", anchor: ART.anchors.seat_front_passenger, entry: ART.anchors.approach_front_right, door: 1, pose: "cabin", weapons: false },
    { id: "rear_left", anchor: ART.anchors.seat_rear_left, entry: ART.anchors.approach_rear_left, door: 2, pose: "cabin", weapons: false },
    { id: "rear_right", anchor: ART.anchors.seat_rear_right, entry: ART.anchors.approach_rear_right, door: 3, pose: "cabin", weapons: false },
  ],
  doors: [
    { bone: "door_front_left", axis: [0, 1, 0], open: -1.2, openTicks: 10, closeTicks: 12 },
    { bone: "door_front_right", axis: [0, 1, 0], open: 1.2, openTicks: 10, closeTicks: 12 },
    { bone: "door_rear_left", axis: [0, 1, 0], open: -1.2, openTicks: 10, closeTicks: 12 },
    { bone: "door_rear_right", axis: [0, 1, 0], open: 1.2, openTicks: 10, closeTicks: 12 },
  ],
  wheels: [],
  rotors: [
    { bone: "rotor_main", at: ART.mainRotor.center, axis: ART.mainRotor.axis, radius: ART.mainRotor.radius, ratio: 1 },
    { bone: "rotor_tail", at: ART.tailRotor.center, axis: ART.tailRotor.axis, radius: ART.tailRotor.radius, ratio: -5 },
  ],
  actionTicks: 24, beltline: 1.35,
};

export const HELICOPTER_SPECIES: SpeciesDef = {
  type: "species", class: "vehicle", id: "core:helicopter", aliases: ["helicopter", "heli", "copter"],
  mesh: "core:helicopter", skeleton: "core:helicopter", color: 9,
  radius: HELICOPTER.halfWidth, height: HELICOPTER.height, eyeHeight: ART.anchors.camera_driver[1],
  walkSpeed: 0.01, sprintMul: 1, jumpSpeed: 0.01, still: true,
  mass: HELICOPTER.mass, slots: 32, keeps: 1, fists: 0,
  stats: { health: [1400, 0, 0], stamina: [100, 0, 0], weight: [650, 0, 0] },
  corpse: { health: 600, roll: 40 },
  drops: [{ item: "core:ingot", min: 2, max: 5, weight: 4, favoured: "stone" }, { item: "core:polymer", min: 1, max: 2, weight: 1 }],
  regions: [
    { name: "Paint", colors: [[103, 1], [232, 1], [86, 1], [124, 1]] },
    { name: "Stripe", colors: [[86, 1]] },
    { name: "Upholstery", colors: [[101, 1]] },
    null, null, null,
  ],
  vehicle: HELICOPTER_VEHICLE,
};

/** Liveries share mechanics and rig. Their meshes only replace the aircraft's authored paint scheme. */
export const HELICOPTER_RESCUE: SpeciesDef = {
  ...HELICOPTER_SPECIES, id: "core:helicopter_rescue", aliases: ["rescue_heli"], mesh: "core:helicopter_rescue",
  regions: [{ name: "Paint", colors: [[232, 1]] }, { name: "Stripe", colors: [[46, 1]] }, { name: "Upholstery", colors: [[101, 1]] }, null, null, null],
  vehicle: { ...HELICOPTER_VEHICLE, id: "core:helicopter_rescue" },
};
export const HELICOPTER_POLICE: SpeciesDef = {
  ...HELICOPTER_SPECIES, id: "core:helicopter_police", aliases: ["police_heli"], mesh: "core:helicopter_police",
  regions: [{ name: "Paint", colors: [[83, 1]] }, { name: "Stripe", colors: [[232, 1]] }, { name: "Upholstery", colors: [[101, 1]] }, null, null, null],
  vehicle: { ...HELICOPTER_VEHICLE, id: "core:helicopter_police" },
};
export const HELICOPTERS = [HELICOPTER_SPECIES, HELICOPTER_RESCUE, HELICOPTER_POLICE] as const;
