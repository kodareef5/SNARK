// The ordinary Body/snapshot/prediction path owns vehicle state too. No second simulation or player.
import { TICK_DT } from "../coords.ts";
import { TAU, clamp } from "../math/scalar.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { helicopterWorld } from "../world/helicopter.ts";
import { boatWorld } from "../world/boat.ts";
import { stepBoat, type BoatState, type BoatStep } from "./boat.ts";
import { stepHelicopter, type HelicopterInput, type HelicopterState, type HelicopterStep } from "./helicopter.ts";
import { StaticVehicleWorld } from "../world/vehicle.ts";
import { BTN_BURST, BTN_CROUCH, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_SECONDARY, BTN_SPRINT, BTN_JUMP, MODE_NONE, MODE_WALK, type Body, stepOut } from "./character.ts";
import { stepSkateboard } from "./skateboard.ts";
import { isSkateboard, stepVehicle, type RotorVehicleDefinition, type VehicleDefinition, type VehicleWorld, type WheelVehicleDefinition } from "./vehicle.ts";
import { stepHitched } from "./vehicle-hitch.ts";

const worlds = new WeakMap<CollisionWorld, StaticVehicleWorld>();
const state: HelicopterState & BoatState = { qx: 0, qy: 0, qz: 0, qw: 1, collective: 0, rotorRpm: 0, rotorPhase: 0, engineCondition: 1, rotorCondition: 1, engineOn: false, hullCondition: 1, flooding: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vz: 0, steering: 0, wheelAngle: 0, fuel: 0, vy: 0, grounded: true, yawRate: 0, pitchRate: 0, rollRate: 0, groundPitch: 0, groundRoll: 0, rideOffset: 0, rideVelocity: 0, gear: 0, engineRpm: 0, shiftTime: 0, payloadMass: 0 };

/** The last vehicle step. Authority consumes this immediately for impact/water damage; prediction uses only its movement. */
export const vehicleStep: HelicopterStep & { skateHurt: number } & Pick<BoatStep, "propHit" | "capsized" | "immersion" | "propellerImmersion" | "planing"> = {
  skateHurt: 0, blocked: null, impactSpeed: 0, rotorHit: false, water: false, landSpeed: 0, fuelUsed: 0, surface: "ground",
  propHit: false, capsized: false, immersion: 0, propellerImmersion: 0, planing: 0,
};

/** Inputs use the ordinary signed bytes/buttons. Wheel and rotor controllers interpret them separately. */
export function stepVehicleBody(w: CollisionWorld, b: Body, moveX: number, moveZ: number, buttons: number, def: VehicleDefinition, dt = TICK_DT, _yaw = b.yaw, pilot = true, environment?: VehicleWorld): void {
  if (dt !== TICK_DT) throw new Error("vehicles step at the shared fixed tick");
  vehicleStep.skateHurt = 0;
  stepOut.landSpeed = 0;
  vehicleStep.blocked = null; vehicleStep.impactSpeed = vehicleStep.landSpeed = vehicleStep.fuelUsed = 0; vehicleStep.rotorHit = vehicleStep.water = false;
  vehicleStep.propHit = vehicleStep.capsized = false; vehicleStep.immersion = vehicleStep.propellerImmersion = vehicleStep.planing = 0;
  if (b.mode === MODE_NONE) { b.vx = b.vy = b.vz = 0; return; }
  if (isSkateboard(def)) {
    vehicleStep.surface = "ground";
    stepSkateboard(w, b, moveX, moveZ, buttons, def.spec, pilot, vehicleStep);
    return;
  }
  let world = worlds.get(w);
  if (!world) { world = new StaticVehicleWorld(w); worlds.set(w, world); }
  loadState(state, b);
  if (def.movement === "rotor") {
    state.qx = b.vehicleQx; state.qy = b.vehicleQy; state.qz = b.vehicleQz; state.qw = b.vehicleQw;
    state.rotorRpm = b.vehicleRotorRpm; state.rotorPhase = b.vehicleRotorPhase; state.collective = b.vehicleCollective;
    state.engineCondition = b.vehicleEngineCondition; state.rotorCondition = b.vehicleRotorCondition; state.engineOn = b.vehicleEngineOn;
    Object.assign(vehicleStep, stepHelicopter(state, {
      right: moveX / 127, forward: moveZ / 127, yaw: ((buttons & BTN_PRIMARY) !== 0 ? 1 : 0) - ((buttons & BTN_SECONDARY) !== 0 ? 1 : 0),
      climb: ((buttons & BTN_JUMP) !== 0 ? 1 : 0) - ((buttons & BTN_CROUCH) !== 0 ? 1 : 0),
      brake: (buttons & BTN_PRONE) !== 0, cruise: (buttons & BTN_SPRINT) !== 0, direct: (buttons & BTN_MOD) !== 0, pilot,
    }, def, helicopterWorld(w)));
    b.vehicleQx = state.qx; b.vehicleQy = state.qy; b.vehicleQz = state.qz; b.vehicleQw = state.qw;
    b.vehicleRotorRpm = state.rotorRpm; b.vehicleRotorPhase = state.rotorPhase; b.vehicleCollective = state.collective;
    b.vehicleEngineCondition = state.engineCondition; b.vehicleRotorCondition = state.rotorCondition; b.vehicleEngineOn = state.engineOn;
  } else if (def.movement === "boat") {
    state.qx = b.vehicleQx; state.qy = b.vehicleQy; state.qz = b.vehicleQz; state.qw = b.vehicleQw;
    state.engineCondition = b.vehicleEngineCondition; state.engineOn = b.vehicleEngineOn;
    state.hullCondition = b.vehicleHullCondition; state.flooding = b.vehicleFlooding;
    Object.assign(vehicleStep, stepBoat(state, {
      throttle: moveZ / 127 * ((buttons & BTN_SPRINT) !== 0 ? .25 : 1), steer: -moveX / 127,
      neutral: (buttons & BTN_JUMP) !== 0, pilot,
    }, def, boatWorld(w)));
    b.vehicleQx = state.qx; b.vehicleQy = state.qy; b.vehicleQz = state.qz; b.vehicleQw = state.qw;
    b.vehicleEngineCondition = state.engineCondition; b.vehicleEngineOn = state.engineOn;
    b.vehicleHullCondition = state.hullCondition; b.vehicleFlooding = state.flooding;
  } else Object.assign(vehicleStep, stepVehicle(state, { throttle: moveZ / 127, steer: -moveX / 127, brake: 0, handbrake: (buttons & BTN_JUMP) !== 0, pilot,
    boost: (buttons & BTN_SPRINT) !== 0, burst: (buttons & BTN_BURST) !== 0 }, def.spec, environment ?? world));
  stepOut.landSpeed = vehicleStep.landSpeed;
  storeState(b, state);
}

type FullState = typeof state;
const trailerState: FullState = { ...state };

/** Copies a body's vehicle columns into a solver state. */
function loadState(state: FullState, b: Body): void {
  state.x = b.x; state.y = b.y; state.z = b.z;
  state.vy = b.vy; state.grounded = b.grounded;
  state.yawRate = b.vehicleYawRate;
  state.pitchRate = b.vehiclePitchRate;
  state.rollRate = b.vehicleRollRate;
  state.groundPitch = b.vehicleGroundPitch;
  state.groundRoll = b.vehicleGroundRoll;
  state.rideOffset = b.vehicleRideOffset;
  state.rideVelocity = b.vehicleRideVelocity;

  state.gear = b.vehicleGear; state.engineRpm = b.vehicleRpm; state.shiftTime = b.vehicleShiftTime; state.payloadMass = b.vehiclePayloadMass;
  state.yaw = b.vehicle ? b.vehicleYaw : b.yaw * TAU / 65536;
  state.pitch = b.vehiclePitch; state.roll = b.vehicleRoll;
  state.vx = b.vx; state.vz = b.vz; state.steering = b.steering;
  state.wheelAngle = b.wheelAngle; state.fuel = b.fuel;
  state.qx = b.vehicleQx; state.qy = b.vehicleQy; state.qz = b.vehicleQz; state.qw = b.vehicleQw;
  state.engineCondition = b.vehicleEngineCondition; state.engineOn = b.vehicleEngineOn;
  state.hullCondition = b.vehicleHullCondition; state.flooding = b.vehicleFlooding;
  state.thrust = b.vehicleThrust; state.thrustCool = b.vehicleThrustCool;
}

/** Writes a solver state back, rounded to f32 as the store and wire hold it. */
function storeState(b: Body, state: FullState): void {
  b.vehicle = true; b.mode = MODE_WALK; b.grounded = state.grounded; b.stance = 0;
  // The store and wire use f32: round here on BOTH sides before another predicted tick.
  b.x = Math.fround(state.x); b.y = Math.fround(state.y); b.z = Math.fround(state.z);
  b.vx = Math.fround(state.vx); b.vy = Math.fround(state.vy); b.vz = Math.fround(state.vz);
  b.vehicleYaw = Math.fround(state.yaw); b.vehiclePitch = Math.fround(state.pitch); b.vehicleRoll = Math.fround(state.roll);
  b.vehicleQx = Math.fround(state.qx); b.vehicleQy = Math.fround(state.qy); b.vehicleQz = Math.fround(state.qz); b.vehicleQw = Math.fround(state.qw);
  b.vehicleEngineCondition = Math.fround(state.engineCondition); b.vehicleEngineOn = state.engineOn;
  b.vehicleHullCondition = Math.fround(state.hullCondition); b.vehicleFlooding = Math.fround(state.flooding);
  b.vehicleThrust = state.thrust ?? 0; b.vehicleThrustCool = state.thrustCool ?? 0;
  b.steering = Math.fround(state.steering); b.wheelAngle = Math.fround(state.wheelAngle); b.fuel = Math.fround(state.fuel);
  b.vehicleGear = state.gear; b.vehicleRpm = Math.fround(state.engineRpm); b.vehicleShiftTime = Math.fround(state.shiftTime); b.vehiclePayloadMass = Math.fround(state.payloadMass);
  b.vehicleYawRate = Math.fround(state.yawRate);
  b.vehiclePitchRate = Math.fround(state.pitchRate);
  b.vehicleRollRate = Math.fround(state.rollRate);
  b.vehicleGroundPitch = Math.fround(state.groundPitch);
  b.vehicleGroundRoll = Math.fround(state.groundRoll);
  b.vehicleRideOffset = Math.fround(state.rideOffset);
  b.vehicleRideVelocity = Math.fround(state.rideVelocity);
  b.yaw = Math.round(b.vehicleYaw * 65536 / TAU) & 65535;
}

/**
 * A tractor and the trailer on its fifth wheel step together (vehicle-hitch.ts). The trailer's own step result is in
 * `trailerStep`. Both must be wheeled; the trailer is stepped with its towed spec.
 */
export const trailerStep: { impactSpeed: number; landSpeed: number; blocked: string | null } = { impactSpeed: 0, landSpeed: 0, blocked: null };
export function stepHitchedBodies(w: CollisionWorld, b: Body, moveX: number, moveZ: number, buttons: number, def: WheelVehicleDefinition, trailer: Body, trailerDef: WheelVehicleDefinition, pilot = true, environment?: VehicleWorld): void {
  vehicleStep.skateHurt = 0;
  stepOut.landSpeed = 0;
  vehicleStep.blocked = null; vehicleStep.impactSpeed = vehicleStep.landSpeed = vehicleStep.fuelUsed = 0; vehicleStep.rotorHit = vehicleStep.water = false;
  vehicleStep.propHit = vehicleStep.capsized = false; vehicleStep.immersion = vehicleStep.propellerImmersion = vehicleStep.planing = 0;
  let world = worlds.get(w);
  if (!world) { world = new StaticVehicleWorld(w); worlds.set(w, world); }
  loadState(state, b); loadState(trailerState, trailer);
  const [own, towed] = stepHitched(state, { throttle: moveZ / 127, steer: -moveX / 127, brake: 0, handbrake: (buttons & BTN_JUMP) !== 0, pilot,
    boost: (buttons & BTN_SPRINT) !== 0, burst: (buttons & BTN_BURST) !== 0 }, def.spec, trailerState, trailerDef.towed ?? trailerDef.spec, environment ?? world, world);
  Object.assign(vehicleStep, own);
  trailerStep.impactSpeed = towed.impactSpeed; trailerStep.landSpeed = towed.landSpeed; trailerStep.blocked = towed.blocked;
  stepOut.landSpeed = vehicleStep.landSpeed;
  storeState(b, state); storeState(trailer, trailerState);
}

/** A rotor vehicle flown by analog commands rather than keys: an autopilot (server/air-carrier.ts). */
export function stepRotorBody(w: CollisionWorld, b: Body, input: HelicopterInput, def: RotorVehicleDefinition): void {
  vehicleStep.blocked = null; vehicleStep.impactSpeed = vehicleStep.landSpeed = vehicleStep.fuelUsed = 0; vehicleStep.rotorHit = vehicleStep.water = false;
  if (b.mode === MODE_NONE) { b.vx = b.vy = b.vz = 0; return; }
  loadState(state, b);
  state.rotorRpm = b.vehicleRotorRpm; state.rotorPhase = b.vehicleRotorPhase; state.collective = b.vehicleCollective;
  state.rotorCondition = b.vehicleRotorCondition;
  Object.assign(vehicleStep, stepHelicopter(state, input, def, helicopterWorld(w)));
  b.vehicleRotorRpm = state.rotorRpm; b.vehicleRotorPhase = state.rotorPhase; b.vehicleCollective = state.collective;
  b.vehicleRotorCondition = state.rotorCondition;
  storeState(b, state);
}

// Remote presentation: one active bit, three signed 10-bit angles, plus a separate 16-bit wheel angle.
const ANGLE = 511 / (TAU / 4);
const angle = (n: number): number => Math.round(clamp(n, -TAU / 4, TAU / 4) * ANGLE) & 1023;
const unpack = (n: number): number => ((n & 512) ? (n & 1023) - 1024 : n & 1023) / ANGLE;
export function packVehiclePose(pitch: number, roll: number, steering: number): number { return (0x80000000 | angle(pitch) | (angle(roll) << 10) | (angle(steering) << 20)) >>> 0; }
export const unpackVehiclePitch = (n: number): number => unpack(n);
export const unpackVehicleRoll = (n: number): number => unpack(n >>> 10);
export const unpackVehicleSteering = (n: number): number => unpack(n >>> 20);
export const quantVehicleWheel = (n: number): number => Math.round(n * 65536 / TAU) & 65535;
export const unpackVehicleWheel = (n: number): number => n * TAU / 65536;

/** Wheel support plane, chassis heave and ground contact, separate from body roll/pitch. */
export function packVehicleRide(pitch: number, roll: number, offset: number, grounded = true): number {
  const heave = Math.round(clamp(offset, -0.5, 0.5) * 1022) & 1023;
  return (angle(pitch) | (angle(roll) << 10) | (heave << 20) | (grounded ? 0x40000000 : 0)) >>> 0;
}
export const unpackVehicleGroundPitch = (n: number): number => unpack(n);
export const unpackVehicleGroundRoll = (n: number): number => unpack(n >>> 10);
export const unpackVehicleRideOffset = (n: number): number => { const v = (n >>> 20) & 1023; return (v & 512 ? v - 1024 : v) / 1022; };
export const vehicleRideGrounded = (n: number): boolean => (n & 0x40000000) !== 0;
/** How far open each door is, door d (VehicleDefinition.doors) in bits 8d to 8d + 7: up to MAX_VEHICLE_DOORS. */
export const vehicleDoor = (packed: number, door: number): number => ((packed >>> (door * 8)) & 255) / 255;
export function withVehicleDoor(packed: number, door: number, open: number): number {
  const shift = door * 8;
  return ((packed & ~(255 << shift)) | (Math.round(clamp(open, 0, 1) * 255) << shift)) >>> 0;
}

/** Observer engine state is presentation data; the driver's prediction receives the full mechanical Body. */
export function packVehicleDrive(gear: number, rpm: number, shifting: boolean, lightMode = 0): number {
  return ((Math.round(clamp(gear, -1, 12)) + 1) | (Math.round(clamp(rpm, 0, 32767)) << 4) | (shifting ? 1 << 19 : 0) | ((lightMode & 3) << 20)) >>> 0;
}
export const unpackVehicleGear = (n: number): number => (n & 15) - 1;
export const unpackVehicleRpm = (n: number): number => (n >>> 4) & 32767;
export const unpackVehicleLightMode = (n: number): number => (n >>> 20) & 3;
export const vehicleShifting = (n: number): boolean => (n & (1 << 19)) !== 0;
