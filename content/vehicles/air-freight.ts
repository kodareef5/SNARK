import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { HelicopterSpec, RotorVehicleDefinition, VehicleSpec, WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { AIR_CARRIER_ART as C, AIR_TRAILER_ART as T } from "./air-freight-art.ts";
import { COMPACT_SPECIES } from "./compact.ts";
import { TANKER_VEHICLE } from "./tanker.ts";

const SHARE = 0.3;
// Keys left undefined would not survive the content file's JSON, and its hash would differ from the server's.
const { frontDriveShare: _drive, ...towing } = TANKER_VEHICLE.spec;
const { wreck: _wreck, steeringWheel: _wheel, shotPanels: _panels, ...rig } = TANKER_VEHICLE;
const { skeleton: _skeleton, ...vehicleSpecies } = COMPACT_SPECIES;
const rear = T.axles.map((a) => ({ z: a.z, track: a.track }));

/** Parked: the landing legs stand on the ground ahead of the axles. */
const PARKED: VehicleSpec = {
  ...towing,
  mass: 4200,
  halfWidth: 1.3,
  halfLength: 4.45,
  height: 3.25,
  clearance: 0.8,
  wheelbase: 7.5,
  track: rear[0]!.track,
  wheelRadius: T.wheelRadius,
  maxForward: 40,
  maxReverse: 12,
  maxSteer: 0.01,
  fuelCapacity: 1,
  fuelPerSecond: 0.0001,
  kingpin: T.kingpin,
  axles: [
    { z: T.legs.z, track: T.legs.halfWidth * 2, loadShare: 0.4 },
    { z: rear[0]!.z, track: rear[0]!.track, loadShare: 0.3 },
    { z: rear[1]!.z, track: rear[1]!.track, loadShare: 0.3 },
  ],
  bodyBoxes: [
    { at: [0, T.deck + 0.96, 0], half: [1.2, 0.96, 3.9] },
    { at: [0, 1.12, -0.2], half: [0.95, 0.22, 4.2] },
  ],
};

/** On a fifth wheel the legs are up and the kingpin carries the front. */
const TOWED: VehicleSpec = {
  ...PARKED,
  axles: [
    { z: rear[0]!.z, track: rear[0]!.track, loadShare: SHARE },
    { z: rear[1]!.z, track: rear[1]!.track, loadShare: SHARE },
  ],
};

export const AIR_TRAILER_VEHICLE: WheelVehicleDefinition = {
  ...rig,
  id: T.id,
  frame: "van",
  seats: [],
  doors: [],
  wheels: [
    { bone: "wheel_front_left" }, { bone: "wheel_front_right" },
    { bone: "wheel_rear_left" }, { bone: "wheel_rear_right" },
  ],
  beltline: T.container.max[1],
  spec: PARKED,
  towed: TOWED,
};

/** The towed six-bay drone rack. It is a vehicle so it rolls, tilts and is hit as one. */
export const AIR_TRAILER: SpeciesDef = {
  ...vehicleSpecies,
  id: T.id,
  aliases: ["air_trailer", "drone_trailer"],
  mesh: T.id,
  vehicle: AIR_TRAILER_VEHICLE,
  color: 230,
  regions: [null, null, null, null, null, null],
  radius: 1.3,
  height: 3.25,
  eyeHeight: 2,
  slots: 1,
  mass: 4200,
  stats: { health: [3000, 0, 0], stamina: [1, 0, 0], weight: [100, 0, 0] },
};

const LOAD_TOP = -C.load[1];
/** The tandem-rotor heavy lifter. An autopilot flies it; nobody sits in it. */
export const AIR_CARRIER_SPEC: HelicopterSpec = {
  // The hull starts above the container it carries and stops short of a semi's cab ahead of it.
  halfWidth: 1.9, halfLength: 4.6, height: 3.4, clearance: 0.6,
  mass: 7000, liftMass: 17000, fuelCapacity: 1000, fuelPerSecond: 0.01,
  maxForward: 60, maxReverse: 12, maxSide: 16, cruiseMultiplier: 1.5,
  climbSpeed: 12, descendSpeed: 9, acceleration: 6, brake: 9,
  turnRate: 0.7, turnAcceleration: 1.6, pitchRate: 0.8, rollRate: 1.0, bankAngle: 0.42, pitchAngle: 0.3, attitudeResponse: 3,
  gravity: 18, rotorRpm: 230, spoolUp: 60, spoolDown: 40,
  skidHalfWidth: 1.2, skidHalfLength: 3.5, minGroundNormal: 0.94,
  engineBox: { at: [0, 2.2, 0], half: [0.9, 0.5, 2.4] },
  bodyBoxes: [
    { at: [0, 1.6, 0], half: [1.0, 0.7, 4.5] },
    ...C.rotors.map((r) => ({ at: [0, r.center[1] - 0.4, r.center[2]] as const, half: [0.7, 0.6, 0.9] as const })),
  ],
  // The rear rotor's pylon stands where a single-rotor aircraft has its tail.
  tail: { from: [0, 1.8, -3.0], to: [0, 2.9, -3.84], radius: 0.6, tipRadius: 0.4 },
};
export const AIR_CARRIER_VEHICLE: RotorVehicleDefinition = {
  id: C.id, movement: "rotor", spec: AIR_CARRIER_SPEC, wreck: C.id,
  seats: [], doors: [], wheels: [],
  rotors: C.rotors.map((r, i) => ({ bone: r.bone, at: r.center, axis: [0, 1, 0] as const, radius: C.rotorRadius, ratio: i === 0 ? 1 : -1, blur: { blades: 3, chord: 0.32 } })),
  actionTicks: 24, beltline: 1.2,
};
/** Where the hanging trailer's origin is, below the carrier's own origin. */
export const AIR_CARRIER_LOAD = LOAD_TOP;
export const AIR_CARRIER: SpeciesDef = {
  type: "species", class: "vehicle", id: C.id, aliases: ["air_carrier", "freight_carrier"],
  mesh: C.id, color: 230,
  radius: AIR_CARRIER_SPEC.halfWidth, height: AIR_CARRIER_SPEC.height, eyeHeight: 2,
  walkSpeed: 0.01, sprintMul: 1, jumpSpeed: 0.01, still: true,
  mass: AIR_CARRIER_SPEC.mass, slots: 1, keeps: 1, fists: 0,
  stats: { health: [900, 0, 0], stamina: [1000, 0, 0], weight: [100, 0, 0] },
  corpse: { health: 300, roll: 40 },
  regions: [null, null, null, null, null, null],
  vehicle: AIR_CARRIER_VEHICLE,
};
