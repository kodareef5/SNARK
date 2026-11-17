// Native wheel chassis contract. Authority and prediction use the same fixed-tick solver.
// Occupancy grants control; this module does not grant ownership or spend inventory items.
import { clamp, detCos, detSin } from "../math/scalar.ts";
import { validateSeats, type Seat } from "./seats.ts";
import { DEFAULT_DRIVETRAIN, validateDrivetrainSpec, type VehicleDrivetrainSpec, type VehicleDrivetrainState } from "./vehicle-drivetrain.ts";
export { stepVehicle } from "./vehicle-chassis.ts";

/** Physical dimensions and resources every mechanical vehicle shares. Motion-specific tuning stays in its controller. */
export interface VehicleHullSpec {
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly height: number;
  readonly clearance: number;
  readonly mass?: number;
  readonly maxForward: number;
  readonly maxReverse: number;
  readonly fuelCapacity: number;
  readonly fuelPerSecond: number;
}

export interface VehicleSpec extends VehicleHullSpec {
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly height: number;
  readonly clearance: number;
  readonly wheelbase: number;
  readonly track: number;
  readonly wheelRadius: number;
  /** Legacy nominal acceleration, used only by definitions without a drivetrain component. */
  readonly acceleration: number;
  /** Curb mass in kilograms. Cargo and occupants live in VehicleState.payloadMass. */
  readonly mass?: number;
  readonly drivetrain?: VehicleDrivetrainSpec;
  readonly brake: number;
  readonly maxForward: number;
  readonly maxReverse: number;
  readonly maxSteer: number;
  readonly steerRate: number;
  readonly maxRise: number;
  readonly maxDrop: number;
  readonly minGroundNormal: number;
  readonly fuelCapacity: number;
  readonly fuelPerSecond: number;
  /** Tire and chassis tuning; omitted values use the deterministic arcade defaults. */
  readonly frontGrip?: number;
  readonly rearGrip?: number;
  readonly corneringStiffness?: number;
  readonly yawInertia?: number;
  readonly yawDamping?: number;
  readonly steerSpeed?: number;
  readonly handbrakeGrip?: number;
  readonly suspensionFrequency?: number;
  readonly suspensionDamping?: number;
  readonly suspensionTravel?: number;
  readonly gravity?: number;
  readonly airDrag?: number;
  /** Fraction of engine torque sent to the front axle. Omitted uses the legacy load-proportional split. */
  readonly frontDriveShare?: number;
  /** Aero load in newtons per (m/s) squared, toward the underside on a forward run. */
  readonly downforce?: number;
  /** Multiplier on the surface speed-squared resistance (body/tire drag). */
  readonly dragScale?: number;
}

/** A vehicle's seats are seats like any host's (shared/sim/seats.ts), in its chassis frame. */
export type VehicleSeat = Seat;

/** A rigid door, driven by its replicated open fraction. Sliding doors first release out of the seal, then run aft. */
export type VehicleDoor = {
  readonly bone: string;
  readonly openTicks: number;
  readonly closeTicks: number;
} & ({
  readonly axis: readonly [number, number, number];
  readonly open: number;
  readonly slide?: never;
} | {
  /** Signed local X and Z travel in metres. */
  readonly slide: { readonly outward: number; readonly along: number };
  readonly axis?: never;
  readonly open?: never;
});

/** A wheel bone rolls about the chassis X axis with the wheel angle; one that steers turns about Y first. */
export interface VehicleWheel {
  readonly bone: string;
  readonly steers?: boolean;
}

/** At most this many doors a vehicle: their open fractions travel in eight bits each (shared/sim/vehicle-body.ts). */
export const MAX_VEHICLE_DOORS = 4;

/** One kind of vehicle: its mechanics, its seats and the parts of its rig that move. Content, never code, says each. */
type VehiclePoint3 = readonly [number, number, number];
interface VehicleDefinitionBase {
  readonly id: string;
  /** Mesh used by the native persistent corpse for an opted-in mechanical wreck. */
  readonly wreck?: string;
  readonly seats: readonly VehicleSeat[];
  readonly doors: readonly VehicleDoor[];
  /** Door held open while the vehicle's inventory is being accessed. */
  readonly cargoDoor?: number;
  readonly wheels: readonly VehicleWheel[];
  /** The bone the driver's hands turn, about `axis`, `ratio` times the road wheels' steering angle. */
  readonly steeringWheel?: { readonly bone: string; readonly axis: readonly [number, number, number]; readonly ratio: number };
  /** Ticks a door action takes: getting in, getting out, pulling a driver out. */
  readonly actionTicks: number;
  /** Metres up from the ground to where the body shell ends and the open cabin begins: a shot above it reaches whoever sits inside. */
  readonly beltline: number;
  /** Solid cabin panels above the belt in vehicle-local metres. Openings between them admit shots. */
  readonly shotPanels?: readonly (readonly [VehiclePoint3, VehiclePoint3, VehiclePoint3, VehiclePoint3])[];
}

/** Existing packs omit movement; their controller remains the wheeled one. */
export interface WheelVehicleDefinition extends VehicleDefinitionBase {
  readonly movement?: "wheeled";
  /** Road chassis family shown in the catalogue. Older wheel definitions use the car family. */
  readonly frame?: "car" | "sports_car" | "van";
  readonly spec: VehicleSpec;
}

/** A spinning rigid part, with its physical disc in the chassis frame. Phase is main-rotor phase times ratio. */
export interface VehicleRotor {
  readonly bone: string;
  readonly at: readonly [number, number, number];
  readonly axis: readonly [number, number, number];
  readonly radius: number;
  readonly ratio: number;
  /** Authored blade count and mean chord in metres. Enables bounded client blur; only blades may follow this bone. */
  readonly blur?: { readonly blades: number; readonly chord: number };
}

/** A rigid part in the vehicle's local frame. */
export interface VehicleCollisionBox { readonly at: readonly [number, number, number]; readonly half: readonly [number, number, number] }

/** Stabilized rotorcraft tuning, in metres, seconds, kilograms and radians. */
export interface HelicopterSpec extends VehicleHullSpec {
  readonly mass: number;
  /** Total mass the healthy rotor can support at nominal speed; includes occupants and cargo. */
  readonly liftMass: number;
  readonly maxSide: number;
  readonly climbSpeed: number;
  readonly descendSpeed: number;
  readonly cruiseMultiplier: number;
  readonly acceleration: number;
  readonly brake: number;
  readonly turnRate: number;
  readonly turnAcceleration: number;
  readonly pitchRate: number;
  readonly rollRate: number;
  readonly bankAngle: number;
  readonly pitchAngle: number;
  readonly attitudeResponse: number;
  readonly gravity: number;
  readonly rotorRpm: number;
  readonly spoolUp: number;
  readonly spoolDown: number;
  readonly skidHalfWidth: number;
  readonly skidHalfLength: number;
  readonly minGroundNormal: number;
  /** Engine cowling outside the cabin; also determines water ingress when tilted or inverted. */
  readonly engineBox?: VehicleCollisionBox;
  /** Other rigid body parts, such as the mast and hub, without widening the cabin or rotor disc. */
  readonly bodyBoxes?: readonly VehicleCollisionBox[];
  /** Tail boom is a separate capsule: rotor radius never expands the cabin's interaction hull. */
  readonly tail: { readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number]; readonly radius: number; readonly tipRadius?: number; readonly boxes?: readonly { readonly at: readonly [number, number, number]; readonly half: readonly [number, number, number] }[] };
}

export interface RotorVehicleDefinition extends VehicleDefinitionBase {
  readonly movement: "rotor";
  readonly spec: HelicopterSpec;
  readonly rotors: readonly VehicleRotor[];
}

/** A weighted float volume. Its centre and the common buoyancyHeight describe its vertical extent. */
export interface BoatFloat { readonly at: readonly [number, number, number]; readonly weight: number }

/** Utility motorboat tuning in metres, kilograms, seconds and radians. Water geometry comes from the world. */
export interface BoatSpec extends VehicleHullSpec {
  readonly mass: number;
  /** Maximum kilograms of water displaced by the intact dry hull, never an unlimited height servo. */
  readonly displacement: number;
  /** Nominal unladen keel depth, used by authored sites and checked against the float geometry. */
  readonly draft: number;
  readonly buoyancyHeight: number;
  readonly buoyancyDamping: number;
  readonly centerOfMass: readonly [number, number, number];
  readonly buoyancyPoints: readonly BoatFloat[];
  readonly hullBoxes: readonly VehicleCollisionBox[];
  /** Steerable engine housing and skeg. These boxes are in the chassis frame at zero steering. */
  readonly outboard?: { readonly pivot: readonly [number, number, number]; readonly boxes: readonly VehicleCollisionBox[] };
  readonly propeller: { readonly at: readonly [number, number, number]; readonly radius: number };
  readonly thrust: number;
  readonly reverseThrust: number;
  readonly idleRpm: number;
  readonly maxRpm: number;
  readonly rpmRate: number;
  readonly shiftDelay: number;
  readonly maxSteer: number;
  readonly steerRate: number;
  readonly planingSpeed: number;
  /** Maximum fraction of unloaded weight supported by dynamic lift. */
  readonly planingLift: number;
  readonly planingTrim: number;
  /** Hydrodynamic resistance coefficients; forward/side forces include linear and quadratic terms. */
  readonly forwardDrag: number;
  readonly sideDrag: number;
  readonly angularDrag: number;
  readonly gravity: number;
}
export interface BoatVehicleDefinition extends VehicleDefinitionBase {
  readonly movement: "boat";
  readonly spec: BoatSpec;
  readonly propeller?: { readonly bone: string; readonly axis: readonly [number, number, number]; readonly ratio: number };
  readonly outboard?: { readonly bone: string; readonly axis: readonly [number, number, number]; readonly ratio: number };
}

export type VehicleDefinition = WheelVehicleDefinition | RotorVehicleDefinition | BoatVehicleDefinition;
export const isRotorVehicle = (d: VehicleDefinition): d is RotorVehicleDefinition => d.movement === "rotor";
export const isBoatVehicle = (d: VehicleDefinition): d is BoatVehicleDefinition => d.movement === "boat";
export const isWheelVehicle = (d: VehicleDefinition): d is WheelVehicleDefinition => d.movement === undefined || d.movement === "wheeled";

export function validateBoatSpec(s: BoatSpec): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("invalid boat specification");
  for (const key of ["halfWidth", "halfLength", "height", "mass", "maxForward", "maxReverse", "fuelCapacity", "fuelPerSecond", "displacement", "draft", "buoyancyHeight", "buoyancyDamping", "thrust", "reverseThrust", "idleRpm", "maxRpm", "rpmRate", "shiftDelay", "maxSteer", "steerRate", "planingSpeed", "planingLift", "planingTrim", "forwardDrag", "sideDrag", "angularDrag", "gravity"] as const) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`missing or invalid boat ${key}`);
  }
  const vec = (v: unknown): v is readonly [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!Number.isFinite(s.clearance) || s.clearance < 0 || s.clearance >= s.height || s.mass < 50 || s.mass > 1000000 ||
    s.displacement <= s.mass || s.displacement > s.mass * 8 || s.draft >= s.height || s.buoyancyHeight > s.height ||
    s.maxRpm <= s.idleRpm || s.maxRpm > 20000 || s.maxSteer > .95 || s.maxForward > 70 || s.maxReverse > 15 ||
    s.planingLift > .85 || s.planingTrim > .35 || !vec(s.centerOfMass) ||
    !Array.isArray(s.buoyancyPoints) || s.buoyancyPoints.length < 4 || s.buoyancyPoints.length > 12 ||
    !s.buoyancyPoints.every(v => vec(v.at) && Number.isFinite(v.weight) && v.weight > 0 && Math.abs(v.at[0]) <= s.halfWidth && Math.abs(v.at[2]) <= s.halfLength) ||
    Math.abs(s.buoyancyPoints.reduce((sum, v) => sum + v.weight, 0) - 1) > 1e-6 ||
    !Array.isArray(s.hullBoxes) || s.hullBoxes.length < 1 || s.hullBoxes.length > 16 ||
    !s.hullBoxes.every(b => b && vec(b.at) && vec(b.half) && b.half.every((n: number) => n > 0 && n <= 12)) ||
    !s.propeller || !vec(s.propeller.at) || !Number.isFinite(s.propeller.radius) || s.propeller.radius <= 0 || s.propeller.radius > 1) throw new Error("inconsistent boat specification");
  const submerged = s.buoyancyPoints.reduce((sum, v) => sum + v.weight * clamp((s.draft - v.at[1]) / s.buoyancyHeight + .5, 0, 1), 0);
  if (Math.abs(submerged * s.displacement - s.mass) > s.mass * .025) throw new Error("boat draft disagrees with float volume");
  if (s.outboard && (!vec(s.outboard.pivot) || !Array.isArray(s.outboard.boxes) || s.outboard.boxes.length > 8 ||
    !s.outboard.boxes.every(b => vec(b.at) && vec(b.half) && b.half.every((n: number) => n > 0 && n <= 4)))) throw new Error("invalid boat outboard geometry");
}

export function validateHelicopterSpec(s: HelicopterSpec): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("invalid helicopter specification");
  for (const key of ["halfWidth", "halfLength", "height", "clearance", "mass", "maxForward", "maxReverse", "fuelCapacity", "fuelPerSecond", "liftMass", "maxSide", "climbSpeed", "descendSpeed", "cruiseMultiplier", "acceleration", "brake", "turnRate", "turnAcceleration", "pitchRate", "rollRate", "bankAngle", "pitchAngle", "attitudeResponse", "gravity", "rotorRpm", "spoolUp", "spoolDown", "skidHalfWidth", "skidHalfLength", "minGroundNormal"] as const) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`missing or invalid helicopter ${key}`);
  }
  const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const box = (b: VehicleCollisionBox): boolean => !!b && vec(b.at) && vec(b.half) && b.half.every(n => n > 0 && n <= 8);
  if (s.engineBox !== undefined && !box(s.engineBox)) throw new Error("invalid helicopter engine box");
  if (s.bodyBoxes !== undefined && (!Array.isArray(s.bodyBoxes) || s.bodyBoxes.length > 8 || !s.bodyBoxes.every(box))) throw new Error("invalid helicopter body boxes");
  if (s.tail?.tipRadius !== undefined && (!Number.isFinite(s.tail.tipRadius) || s.tail.tipRadius <= 0 || s.tail.tipRadius > 2)) throw new Error("invalid helicopter tail");
  if (s.tail?.boxes !== undefined && (!Array.isArray(s.tail.boxes) || s.tail.boxes.length > 8 ||
    !s.tail.boxes.every(b => vec(b.at) && vec(b.half) && b.half.every((n: number) => n > 0 && n <= 8)))) throw new Error("invalid helicopter tail boxes");
  if (s.mass < 50 || s.mass > 1000000 || s.liftMass <= s.mass || s.liftMass > s.mass * 4 || s.clearance >= s.height ||
    s.minGroundNormal > 1 || s.bankAngle > 0.8 || s.pitchAngle > 0.8 || s.turnRate > 4 || s.pitchRate > 5 || s.rollRate > 6 || s.attitudeResponse > 12 ||
    s.cruiseMultiplier < 1 || s.cruiseMultiplier > 2 || s.rotorRpm > 3000 || s.maxForward * s.cruiseMultiplier > 100 ||
    s.climbSpeed > 30 || s.descendSpeed > 30 || !s.tail || !vec(s.tail.from) || !vec(s.tail.to) ||
    !Number.isFinite(s.tail.radius) || s.tail.radius <= 0 || s.tail.radius > 2) throw new Error("inconsistent helicopter specification");
}

/** Content checks beyond the spec's, so a definition that compiles always registers and draws. Throws on the first fault. */
export function validateVehicleDefinition(d: VehicleDefinition): void {
  if (d.movement === "rotor") validateHelicopterSpec(d.spec);
  else if (d.movement === "boat") validateBoatSpec(d.spec);
  else {
    if (d.movement !== undefined && d.movement !== "wheeled") throw new Error("invalid vehicle movement");
    if (d.frame !== undefined && !["car", "sports_car", "van"].includes(d.frame)) throw new Error("invalid road vehicle frame");
    validateVehicleSpec(d.spec);
  }
  const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const bone = (n: unknown): boolean => typeof n === "string" && n.length > 0 && n.length <= 64;
  if (!Array.isArray(d.doors) || d.doors.length > MAX_VEHICLE_DOORS) throw new Error("a vehicle has at most 4 doors");
  if (!Array.isArray(d.wheels) || d.wheels.length > 16 || !d.wheels.every((w) => bone(w.bone))) throw new Error("invalid vehicle wheels");
  for (const door of d.doors) {
    const validMotion = door.slide
      ? door.axis === undefined && door.open === undefined && Number.isFinite(door.slide.outward) && Math.abs(door.slide.outward) <= .5 &&
        Number.isFinite(door.slide.along) && Math.abs(door.slide.along) > 0 && Math.abs(door.slide.along) <= 3
      : vec(door.axis) && Number.isFinite(door.open) && Math.abs(door.open!) <= Math.PI;
    if (!bone(door.bone) || !validMotion ||
      !Number.isInteger(door.openTicks) || door.openTicks < 1 || door.openTicks > 255 ||
      !Number.isInteger(door.closeTicks) || door.closeTicks < 1 || door.closeTicks > 255) throw new Error("invalid vehicle door");
  }
  if (d.movement === "rotor") {
    if (d.wheels.length || d.steeringWheel || !Array.isArray(d.rotors) || d.rotors.length < 1 || d.rotors.length > 4) throw new Error("invalid helicopter rig");
    for (const rotor of d.rotors) {
      const n = rotor.axis;
      if (!bone(rotor.bone) || !vec(rotor.at) || !vec(n) || Math.abs(n[0] * n[0] + n[1] * n[1] + n[2] * n[2] - 1) > 1e-6 ||
        !Number.isFinite(rotor.radius) || rotor.radius <= 0 || rotor.radius > 16 || !Number.isFinite(rotor.ratio) || rotor.ratio === 0 || Math.abs(rotor.ratio) > 16) throw new Error("invalid helicopter rotor");
      if (rotor.blur && (!Number.isInteger(rotor.blur.blades) || rotor.blur.blades < 2 || rotor.blur.blades > 8 || !Number.isFinite(rotor.blur.chord) || rotor.blur.chord <= 0 || rotor.blur.chord > rotor.radius)) throw new Error("invalid helicopter rotor blur");
    }
  }
  if (d.movement === "boat") {
    if (d.wheels.length) throw new Error("invalid boat rig");
    for (const p of [d.propeller, d.outboard]) if (p && (!bone(p.bone) || !vec(p.axis) || Math.abs(p.axis[0] * p.axis[0] + p.axis[1] * p.axis[1] + p.axis[2] * p.axis[2] - 1) > 1e-6 ||
      !Number.isFinite(p.ratio) || p.ratio === 0 || Math.abs(p.ratio) > 16)) throw new Error("invalid boat propulsion rig");
  }
  if (d.cargoDoor !== undefined && (!Number.isInteger(d.cargoDoor) || d.cargoDoor < 0 || d.cargoDoor >= d.doors.length)) throw new Error("invalid vehicle cargo door");
  if (d.wreck !== undefined && (typeof d.wreck !== "string" || !d.wreck.includes(":"))) throw new Error("invalid vehicle wreck");
  const s = d.steeringWheel;
  if (s !== undefined && (!bone(s.bone) || !vec(s.axis) || !Number.isFinite(s.ratio) || Math.abs(s.ratio) > 50)) throw new Error("invalid steering wheel");
  if (!Number.isInteger(d.actionTicks) || d.actionTicks < 1 || d.actionTicks > 300) throw new Error("invalid vehicle action ticks");
  for (const panel of d.shotPanels ?? []) {
    if (panel.length !== 4 || panel.some(point => point.length !== 3 || !point.every(Number.isFinite))) throw new Error("invalid vehicle cabin panel");
  }
  if (!Number.isFinite(d.beltline) || d.beltline <= d.spec.clearance || d.beltline > d.spec.height) throw new Error("invalid vehicle belt line");
  validateSeats(d.seats, d.doors.length, "vehicle");
}

/** Physical surface values, independent of terrain palette or art material names. */
export interface VehicleSurface {
  readonly id: string;
  readonly grip: number;
  readonly rolling: number;
  readonly drag: number;
}

export interface VehicleState extends VehicleDrivetrainState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Derived presentation angles. Quaternion, when present, is the physical attitude. */
  pitch: number;
  roll: number;
  qx?: number; qy?: number; qz?: number; qw?: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  groundPitch: number;
  groundRoll: number;
  /** Mean wheel suspension displacement, for rendering; never a second body-position authority. */
  rideOffset: number;
  rideVelocity: number;
  steering: number;
  wheelAngle: number;
  fuel: number;
}
export interface CarState extends VehicleState {
  qx: number; qy: number; qz: number; qw: number;
  engineCondition: number; engineOn: boolean; hullCondition: number; flooding: number;
}

export interface VehicleInput {
  /** Signed throttle; changing direction first brakes to zero. */
  throttle: number;
  steer: number;
  brake: number;
  handbrake: boolean;
  /** Disengages the transmission for coasting/free revving; an optional future input binding. */
  neutral?: boolean;
  pilot?: boolean;
}

export interface VehicleWorld {
  /** Authority may fracture a contacted obstacle after paying its work through a point impulse. Null keeps the solid response. */
  breakContact?(state: VehicleState, spec: VehicleSpec, hit: VehicleContact): number | null;
  /** Surface normal points out of the obstacle, toward the chassis. Scratch result: consume before another query. */
  contact(from: Readonly<VehicleState>, to: Readonly<VehicleState>, spec: VehicleSpec): VehicleContact | null;
  /** Actual current overlap, without the moving-contact skin; use only for bounded position recovery. */
  penetration(at: Readonly<VehicleState>, spec: VehicleSpec): VehicleContact | null;
  wheelRay(x: number, y: number, z: number, dx: number, dy: number, dz: number, reach: number, spec: VehicleSpec): WheelRayContact | null;
  waterAt(x: number, z: number): number;
}

export interface WheelRayContact { distance: number; nx: number; ny: number; nz: number; surface: VehicleSurface }
export interface VehicleContact { reason: string; nx: number; ny: number; nz: number; x?: number; y?: number; z?: number; depth?: number; balanced?: boolean; geometryNx?: number; geometryNy?: number; geometryNz?: number; points?: readonly { x: number; y: number; z: number }[] }

export interface VehicleStep {
  blocked: string | null;
  impactSpeed: number;
  /** First wheel contact closing speed, separate from hull/wall impacts. */
  landSpeed: number;
  fuelUsed: number;
  surface: string;
  water?: boolean;
  immersion?: number;
}

export function validateVehicleSpec(s: VehicleSpec): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("invalid vehicle specification");
  for (const key of ["halfWidth", "halfLength", "height", "clearance", "wheelbase", "track", "wheelRadius", "acceleration", "brake", "maxForward", "maxReverse", "maxSteer", "steerRate", "maxRise", "maxDrop", "minGroundNormal", "fuelCapacity", "fuelPerSecond"] as const) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`missing or invalid vehicle ${key}`);
  }
  const zero = new Set(["yawDamping", "airDrag", "dragScale", "frontDriveShare", "downforce"]);
  for (const [key, value] of Object.entries(s)) if (key !== "drivetrain" && value !== undefined &&
    (!Number.isFinite(value) || (zero.has(key) ? value < 0 : value <= 0))) throw new Error("invalid vehicle specification");
  if (s.mass !== undefined && (s.mass < 50 || s.mass > 1000000)) throw new Error("invalid vehicle mass");
  if ((s.frontDriveShare ?? 0) > 1 || (s.downforce ?? 0) > 10) throw new Error("invalid vehicle axle split or downforce");
  if (s.drivetrain !== undefined) validateDrivetrainSpec(s.drivetrain);
  if (s.clearance >= s.height || s.track > 2 * s.halfWidth || s.wheelbase > 2 * s.halfLength || s.maxSteer >= 1.2 || s.minGroundNormal > 1 ||
    (s.handbrakeGrip ?? 0.18) > 1 || (s.suspensionDamping ?? 0.85) > 2 || (s.suspensionFrequency ?? 10) > 24 ||
    (s.suspensionTravel ?? 0.18) > 1) throw new Error("inconsistent vehicle geometry or steering limits");
}

export function createVehicle(s: VehicleSpec, x: number, y: number, z: number, yaw = 0, fuel = s.fuelCapacity): CarState {
  validateVehicleSpec(s);
  if (![x, y, z, yaw, fuel].every(Number.isFinite) || fuel < 0 || fuel > s.fuelCapacity) throw new Error("invalid vehicle state");
  return { x, y, z, yaw, pitch: 0, roll: 0, qx: 0, qy: detSin(yaw / 2), qz: 0, qw: detCos(yaw / 2),
    engineCondition: 1, engineOn: fuel > 0, hullCondition: 1, flooding: 0, vx: 0, vy: 0, vz: 0, grounded: true,
    yawRate: 0, pitchRate: 0, rollRate: 0, groundPitch: 0, groundRoll: 0,
    rideOffset: 0, rideVelocity: 0, steering: 0, wheelAngle: 0, fuel,
    gear: 0, engineRpm: fuel > 0 ? (s.drivetrain ?? DEFAULT_DRIVETRAIN).idleRpm : 0, shiftTime: 0, payloadMass: 0 };
}
