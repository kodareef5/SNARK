import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { VehicleSpec, WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { AIR_TRAILER_ART as T } from "./air-freight-art.ts";
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
