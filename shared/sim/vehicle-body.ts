// The ordinary Body/snapshot/prediction path owns vehicle state too. No second simulation or player.
import { TICK_DT } from "../coords.ts";
import { TAU, clamp } from "../math/scalar.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { StaticVehicleWorld } from "../world/vehicle.ts";
import { BTN_JUMP, MODE_NONE, MODE_WALK, type Body, stepOut } from "./character.ts";
import { stepVehicle, type VehicleDefinition, type VehicleState, type VehicleSurface } from "./vehicle.ts";

const OFFROAD: VehicleSurface = { id: "ground", grip: 5.5, rolling: 0.45, drag: 0.012 };
const worlds = new WeakMap<CollisionWorld, StaticVehicleWorld>();
const state: VehicleState = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vz: 0, steering: 0, wheelAngle: 0, fuel: 0 };

/** Inputs use the same signed bytes as walking. Space is the handbrake; reverse first brakes. */
export function stepVehicleBody(w: CollisionWorld, b: Body, moveX: number, moveZ: number, buttons: number, def: VehicleDefinition, dt = TICK_DT): void {
  if (dt !== TICK_DT) throw new Error("vehicles step at the shared fixed tick");
  stepOut.landSpeed = 0;
  if (b.mode === MODE_NONE) { b.vx = b.vy = b.vz = 0; return; }
  let world = worlds.get(w);
  if (!world) { world = new StaticVehicleWorld(w, () => OFFROAD); worlds.set(w, world); }
  state.x = b.x; state.y = b.y; state.z = b.z;
  state.yaw = b.vehicle ? b.vehicleYaw : b.yaw * TAU / 65536;
  state.pitch = b.vehiclePitch; state.roll = b.vehicleRoll;
  state.vx = b.vx; state.vz = b.vz; state.steering = b.steering;
  state.wheelAngle = b.wheelAngle; state.fuel = b.fuel;
  stepVehicle(state, { throttle: moveZ / 127, steer: -moveX / 127, brake: 0, handbrake: (buttons & BTN_JUMP) !== 0 }, def.spec, world);
  b.vehicle = true; b.mode = MODE_WALK; b.grounded = true; b.stance = 0;
  // The store and wire use f32: round here on BOTH sides before another predicted tick.
  b.x = Math.fround(state.x); b.y = Math.fround(state.y); b.z = Math.fround(state.z);
  b.vx = Math.fround(state.vx); b.vy = 0; b.vz = Math.fround(state.vz);
  b.vehicleYaw = Math.fround(state.yaw); b.vehiclePitch = Math.fround(state.pitch); b.vehicleRoll = Math.fround(state.roll);
  b.steering = Math.fround(state.steering); b.wheelAngle = Math.fround(state.wheelAngle); b.fuel = Math.fround(state.fuel);
  b.yaw = Math.round(b.vehicleYaw * 65536 / TAU) & 65535;
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
