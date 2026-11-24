// The ordinary Body/snapshot/prediction path owns vehicle state too. No second simulation or player.
import { TAU, clamp } from "../math/scalar.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { BTN_BURST, BTN_JUMP, BTN_SPRINT, MODE_NONE, type Body, stepOut } from "./character.ts";
import { familyOf } from "./families.ts";
import { ROTOR } from "./families/rotor.ts";
import type { HelicopterInput } from "./helicopter.ts";
import type { RotorVehicleDefinition, VehicleDefinition, VehicleWorld, WheelVehicleDefinition } from "./vehicle.ts";
import { stepHitched } from "./vehicle-hitch.ts";
import { loadState, state, staticWorld, storeState, trailerState, vehicleStep } from "./vehicle-state.ts";
import { TICK_DT } from "../coords.ts";

export { vehicleStep } from "./vehicle-state.ts";

/** Inputs use the ordinary signed bytes/buttons. Each family reads them its own way (families.ts). */
export function stepVehicleBody(w: CollisionWorld, b: Body, moveX: number, moveZ: number, buttons: number, def: VehicleDefinition, dt = TICK_DT, _yaw = b.yaw, pilot = true, environment?: VehicleWorld): void {
  if (dt !== TICK_DT) throw new Error("vehicles step at the shared fixed tick");
  vehicleStep.skateHurt = 0;
  stepOut.landSpeed = 0;
  vehicleStep.blocked = null; vehicleStep.impactSpeed = vehicleStep.landSpeed = vehicleStep.fuelUsed = 0; vehicleStep.rotorHit = vehicleStep.water = false;
  vehicleStep.propHit = vehicleStep.capsized = false; vehicleStep.immersion = vehicleStep.propellerImmersion = vehicleStep.planing = 0;
  if (b.mode === MODE_NONE) { b.vx = b.vy = b.vz = 0; return; }
  const family = familyOf(def);
  if (!family) throw new Error(`no vehicle family moves by ${String(def.movement)}`);
  family.step(w, b, moveX, moveZ, buttons, def, pilot, environment);
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
  const world = staticWorld(w);
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
  ROTOR.fly(w, b, input, def);
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
export { vehicleDoor, withVehicleDoor } from "./vehicle-panels.ts";

/** Observer engine state is presentation data; the driver's prediction receives the full mechanical Body. */
export function packVehicleDrive(gear: number, rpm: number, shifting: boolean, lightMode = 0, missingPanels = 0): number {
  return ((Math.round(clamp(gear, -1, 12)) + 1) | (Math.round(clamp(rpm, 0, 32767)) << 4) | (shifting ? 1 << 19 : 0) | ((lightMode & 3) << 20) | (missingPanels << 22)) >>> 0;
}
export const unpackVehicleGear = (n: number): number => (n & 15) - 1;
export const unpackVehicleRpm = (n: number): number => (n >>> 4) & 32767;
export const unpackVehicleMissingPanels = (n: number): number => n >>> 22;
export const unpackVehicleLightMode = (n: number): number => (n >>> 20) & 3;
export const vehicleShifting = (n: number): boolean => (n & (1 << 19)) !== 0;
