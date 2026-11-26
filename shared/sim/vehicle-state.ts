// The solver state every way of moving loads from a body and stores back (families.ts), and what the last step reported.
// One state for all of them: a step reads only what its load wrote, so they never see each other's values.

import { TAU } from "../math/scalar.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { StaticVehicleWorld } from "../world/vehicle.ts";
import type { BoatState, BoatStep } from "./boat.ts";
import { MODE_WALK, type Body } from "./character.ts";
import type { HelicopterState, HelicopterStep } from "./helicopter.ts";
import type { JetState } from "./jet.ts";

export const state: HelicopterState & BoatState & JetState = { throttle: 0, spool: 0, nozzle: 0, qx: 0, qy: 0, qz: 0, qw: 1, collective: 0, rotorRpm: 0, rotorPhase: 0, engineCondition: 1, rotorCondition: 1, engineOn: false, hullCondition: 1, flooding: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vz: 0, steering: 0, wheelAngle: 0, fuel: 0, vy: 0, grounded: true, yawRate: 0, pitchRate: 0, rollRate: 0, groundPitch: 0, groundRoll: 0, rideOffset: 0, rideVelocity: 0, gear: 0, engineRpm: 0, shiftTime: 0, payloadMass: 0 };
export type FullState = typeof state;
/** A towed trailer's, beside its tractor's. */
export const trailerState: FullState = { ...state };

/** The last vehicle step. Authority consumes this immediately for impact/water damage; prediction uses only its movement. */
export const vehicleStep: HelicopterStep & { skateHurt: number } & Pick<BoatStep, "propHit" | "capsized" | "immersion" | "propellerImmersion" | "planing"> = {
  skateHurt: 0, blocked: null, impactSpeed: 0, rotorHit: false, water: false, landSpeed: 0, fuelUsed: 0, surface: "ground",
  propHit: false, capsized: false, immersion: 0, propellerImmersion: 0, planing: 0,
};

const worlds = new WeakMap<CollisionWorld, StaticVehicleWorld>();
/** The wheeled solver's view of a collision world, made once for each. */
export function staticWorld(w: CollisionWorld): StaticVehicleWorld {
  let world = worlds.get(w);
  if (!world) { world = new StaticVehicleWorld(w); worlds.set(w, world); }
  return world;
}

/** Copies a body's vehicle columns into a solver state. */
export function loadState(state: FullState, b: Body): void {
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
export function storeState(b: Body, state: FullState): void {
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
