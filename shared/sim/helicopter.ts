// The same rotorcraft physics for assisted and direct controls. Thrust follows the complete aircraft orientation;
// cyclic commands change attitude, never world velocity. Stunts are trajectories, not animation clips.
import { TICK_DT, WORLD_MAX_Y } from "../coords.ts";
import { quatAxis, quatMul, quatNormalize, quatRotate, quatUnrotate } from "../math/quat.ts";
import { clamp, detAtan2, detCos, detSin, len3, TAU } from "../math/scalar.ts";
import { validateHelicopterSpec, type HelicopterSpec, type RotorVehicleDefinition, type VehicleState } from "./vehicle.ts";

export interface HelicopterState extends VehicleState {
  qx: number; qy: number; qz: number; qw: number;
  rotorRpm: number;
  rotorPhase: number;
  engineCondition: number;
  rotorCondition: number;
  engineOn: boolean;
  /** Collective fraction 0..1. Direct controls retain it; the assisted vertical controller changes it gradually. */
  collective: number;
}
export interface HelicopterInput {
  /** Right bank, forward cyclic and left yaw, in [-1,1]. */
  right: number;
  forward: number;
  yaw: number;
  climb: number;
  brake: boolean;
  cruise: boolean;
  direct: boolean;
  /** No pilot requests finite-torque recovery and a slow descent, then shuts down on support. */
  pilot: boolean;
}
export interface HelicopterSupport { y: number; pitch: number; roll: number }
export interface HelicopterContact { reason: string; rotor: boolean; nx?: number; ny?: number; nz?: number }
export interface HelicopterWorld {
  support(x: number, y: number, z: number, yaw: number, reach: number, p: HelicopterSpec): HelicopterSupport | null;
  blocked(from: Readonly<HelicopterState>, to: Readonly<HelicopterState>, def: RotorVehicleDefinition): HelicopterContact | null;
  waterAt(x: number, z: number): number;
}
export interface HelicopterStep {
  blocked: string | null;
  impactSpeed: number;
  rotorHit: boolean;
  water: boolean;
  landSpeed: number;
  fuelUsed: number;
  surface: string;
}
const result: HelicopterStep = { blocked: null, impactSpeed: 0, rotorHit: false, water: false, landSpeed: 0, fuelUsed: 0, surface: "air" };
const q = new Float64Array(4), turn = new Float64Array(4), wanted = new Float64Array(4), error = new Float64Array(4);
const upright = new Float64Array(3), ahead = new Float64Array(3), velocity = new Float64Array(3), drag = new Float64Array(3);
const approach = (value: number, target: number, amount: number): number => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
const unit = (value: number): number => Number.isFinite(value) ? clamp(value, -1, 1) : 0;
const square = (value: number): number => value * value;
const wrap = (value: number): number => value - Math.floor((value + TAU / 2) / TAU) * TAU;

export function createHelicopter(p: HelicopterSpec, x: number, y: number, z: number, yaw = 0, fuel = p.fuelCapacity): HelicopterState {
  validateHelicopterSpec(p);
  if (![x, y, z, yaw, fuel].every(Number.isFinite) || fuel < 0 || fuel > p.fuelCapacity) throw new Error("invalid helicopter state");
  return { x, y, z, yaw, pitch: 0, roll: 0, qx: 0, qy: detSin(yaw / 2), qz: 0, qw: detCos(yaw / 2),
    vx: 0, vy: 0, vz: 0, grounded: true, yawRate: 0, pitchRate: 0, rollRate: 0,
    groundPitch: 0, groundRoll: 0, rideOffset: 0, rideVelocity: 0, steering: 0, wheelAngle: 0, fuel,
    gear: 0, engineRpm: 0, shiftTime: 0, payloadMass: 0, rotorRpm: 0, rotorPhase: 0,
    engineCondition: 1, rotorCondition: 1, engineOn: false, collective: 0 };
}
function readRotation(s: Readonly<HelicopterState>): void {
  q[0] = s.qx; q[1] = s.qy; q[2] = s.qz; q[3] = s.qw;
  quatNormalize(q, 0);
}
function writeRotation(s: HelicopterState): void {
  s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
  quatRotate(q, 0, 0, 0, 1, ahead, 0);
  quatRotate(q, 0, 0, 1, 0, upright, 0);
  // These are display values only. Physics, seats and hit geometry retain the quaternion through inversion.
  const horizontal = Math.sqrt(square(ahead[0]!) + square(ahead[2]!));
  if (horizontal > 1e-5) s.yaw = detAtan2(ahead[0]!, ahead[2]!);
  s.pitch = detAtan2(ahead[1]!, horizontal);
  s.roll = detAtan2(-(upright[0]! * detCos(s.yaw) - upright[2]! * detSin(s.yaw)), upright[1]!);
}
function targetRotation(yaw: number, pitch: number, roll: number): void {
  quatAxis(wanted, 0, 0, 1, 0, yaw);
  quatAxis(turn, 0, 0, 0, 1, roll); quatMul(wanted, 0, wanted, 0, turn, 0);
  quatAxis(turn, 0, 1, 0, 0, -pitch); quatMul(wanted, 0, wanted, 0, turn, 0);
}
function rotationError(): void {
  // q^-1 * target; use the shortest physical turn, including when inverted.
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  turn[0] = -x; turn[1] = -y; turn[2] = -z; turn[3] = w;
  quatMul(error, 0, turn, 0, wanted, 0);
  if (error[3]! < 0) for (let i = 0; i < 4; i++) error[i] = -error[i]!;
}
/** Aerodynamic force per unit mass. Rotor assistance may compensate its vertical part through collective, never by editing velocity. */
function bodyDrag(s: Readonly<HelicopterState>, p: HelicopterSpec): void {
  quatUnrotate(q, 0, s.vx, s.vy, s.vz, velocity, 0);
  const forwardDrag = p.gravity * (detSin(p.pitchAngle) / detCos(p.pitchAngle)) / (p.maxForward * p.maxForward);
  const sideDrag = p.gravity * (detSin(p.bankAngle) / detCos(p.bankAngle)) / (p.maxSide * p.maxSide);
  drag[0] = -velocity[0]! * Math.abs(velocity[0]!) * sideDrag;
  drag[1] = -velocity[1]! * Math.abs(velocity[1]!) * forwardDrag * 1.3;
  drag[2] = -velocity[2]! * Math.abs(velocity[2]!) * forwardDrag * (velocity[2]! < 0 ? square(p.maxForward / p.maxReverse) : 1);
  quatRotate(q, 0, drag[0]!, drag[1]!, drag[2]!, drag, 0);
}
function recordHit(hit: HelicopterContact, speed: number): void {
  result.blocked ??= hit.reason; result.rotorHit ||= hit.rotor;
  result.impactSpeed = Math.max(result.impactSpeed, speed);
}

/** Reuses its result; consume it before stepping the next vehicle. Every state value rounds to f32 once a world tick. */
export function stepHelicopter(s: HelicopterState, input: Readonly<HelicopterInput>, def: RotorVehicleDefinition, world: HelicopterWorld): HelicopterStep {
  const p = def.spec, beforeFuel = s.fuel;
  result.blocked = null; result.impactSpeed = result.landSpeed = result.fuelUsed = 0;
  result.rotorHit = result.water = false; result.surface = "air";
  s.engineCondition = clamp(s.engineCondition, 0, 1); s.rotorCondition = clamp(s.rotorCondition, 0, 1);
  s.payloadMass = Math.max(0, Math.min(100000, s.payloadMass)); s.collective = clamp(s.collective, 0, 1);
  const mass = p.mass + s.payloadMass, efficiency = s.rotorCondition <= 0.05 ? 0 : 0.3 + 0.7 * s.rotorCondition;
  const climb = input.pilot ? unit(input.climb) : -0.35;
  const forward = input.pilot ? unit(input.forward) : 0, right = input.pilot ? unit(input.right) : 0;
  const recovery = input.brake || !input.pilot, direct = input.direct && !recovery;
  const usable = s.fuel > 0 && s.engineCondition > 0.08 && s.rotorCondition > 0.05;
  if (input.pilot && climb > 0 && usable && !s.engineOn) {
    s.engineOn = true; s.collective = clamp(mass / (p.liftMass * Math.max(0.2, efficiency)), 0, 1);
  }
  if (!usable || (!input.pilot && s.grounded)) s.engineOn = false;
  const sea = world.waterAt(s.x, s.z), wet = Number.isFinite(sea) && s.y + p.clearance < sea;
  if (wet) { s.engineOn = false; result.water = true; result.surface = "water"; }
  const autorotation = !s.engineOn && !s.grounded && !wet ? clamp(-s.vy / 10, 0, 0.6) * s.rotorCondition : 0;
  const targetRpm = p.rotorRpm * (s.engineOn ? 0.76 + 0.24 * s.engineCondition : autorotation);
  s.rotorRpm = approach(s.rotorRpm, targetRpm, (targetRpm > s.rotorRpm ? p.spoolUp : p.spoolDown) * TICK_DT);
  s.rotorPhase = wrap(s.rotorPhase + s.rotorRpm * TAU / 60 * TICK_DT);
  s.engineRpm = s.engineOn ? s.rotorRpm * 12 : 0;
  s.gear = 0; s.shiftTime = 0; s.wheelAngle = 0; s.steering = 0; s.rideOffset = s.rideVelocity = 0;
  readRotation(s); writeRotation(s);
  const liftMax = p.gravity * p.liftMass / mass * square(s.rotorRpm / p.rotorRpm) * efficiency;
  const initialSupport = upright[1]! > 0.9 ? world.support(s.x, s.y + 0.06, s.z, s.yaw, 0.16, p) : null;
  s.grounded = !!initialSupport && s.y <= initialSupport.y + (s.grounded ? 0.03 : 0.001) && s.vy <= 0.01;
  if (s.grounded && initialSupport) {
    s.y = initialSupport.y; s.groundPitch = initialSupport.pitch; s.groundRoll = initialSupport.roll;
    targetRotation(s.yaw, initialSupport.pitch, initialSupport.roll); q.set(wanted); writeRotation(s);
  }
  const powered = s.engineOn && !wet;
  // No spontaneous takeoff while idling on a pad. Starting and climbing require the deliberate collective input.
  const launching = s.grounded && climb > 0 && liftMax * s.collective > p.gravity + 0.2;
  if (launching) s.grounded = false;
  const control = s.grounded ? 0 : clamp(s.rotorRpm / p.rotorRpm, 0, 1);
  if (direct) s.collective = clamp(s.collective + climb * 0.4 * TICK_DT, 0, 1);
  else if (powered) {
    const wantedVy = climb * (climb > 0 ? p.climbSpeed : p.descendSpeed);
    const verticalAcceleration = clamp((wantedVy - s.vy) * 2.2, -8, 8);
    // Assistance works through available lift and only upright. Recovery must physically turn first.
    const projected = Math.max(0.15, upright[1]!);
    bodyDrag(s, p);
    const target = clamp((p.gravity + verticalAcceleration - drag[1]!) / Math.max(0.1, liftMax * projected), 0, 1);
    s.collective = approach(s.collective, upright[1]! < 0.15 ? 0.12 : target, 0.7 * TICK_DT);
  }
  let wantedPitchRate = -forward * p.pitchRate, wantedRollRate = right * p.rollRate;
  let wantedYawRate = input.pilot ? unit(input.yaw) * p.turnRate : 0;
  if (!direct) {
    let pitch = -forward * (input.cruise ? detAtan2(detSin(p.pitchAngle) * square(p.cruiseMultiplier), detCos(p.pitchAngle)) : p.pitchAngle), roll = right * p.bankAngle;
    if (recovery) {
      const sn = detSin(s.yaw), cs = detCos(s.yaw);
      const along = s.vx * sn + s.vz * cs, side = -s.vx * cs + s.vz * sn;
      pitch = detAtan2(clamp(along * 1.25, -p.brake, p.brake), p.gravity);
      roll = -detAtan2(clamp(side * 1.25, -p.brake, p.brake), p.gravity);
    }
    if (s.grounded && initialSupport) { pitch = initialSupport.pitch; roll = initialSupport.roll; }
    targetRotation(s.yaw, pitch, roll); rotationError();
    wantedPitchRate = clamp(-2 * error[0]! * p.attitudeResponse, -p.pitchRate, p.pitchRate);
    wantedRollRate = clamp(2 * error[2]! * p.attitudeResponse, -p.rollRate, p.rollRate);
    wantedYawRate += clamp(2 * error[1]! * p.attitudeResponse, -p.turnRate, p.turnRate);
  }
  const acceleration = p.turnAcceleration * (s.grounded ? 1 : Math.max(0.15, control));
  s.pitchRate = approach(s.pitchRate, wantedPitchRate * control, acceleration * TICK_DT);
  s.rollRate = approach(s.rollRate, wantedRollRate * control, acceleration * TICK_DT);
  s.yawRate = approach(s.yawRate, wantedYawRate * control, acceleration * TICK_DT);
  if (s.grounded) { s.vx = s.vy = s.vz = 0; s.yawRate = s.pitchRate = s.rollRate = 0; result.surface = wet ? "water" : "ground"; }
  if (s.engineOn) s.fuel = Math.max(0, s.fuel - p.fuelPerSecond * (0.4 + 0.6 * s.collective) * TICK_DT);
  // Angular substeps also keep a sweeping rotor/tail from crossing an obstacle during a stationary roll.
  const span = Math.max(6, ...def.rotors.map(r => r.radius + len3(r.at[0], r.at[1], r.at[2])));
  const angular = len3(s.pitchRate, s.yawRate, s.rollRate);
  const travel = len3(s.vx, s.vy, s.vz) * TICK_DT + angular * span * TICK_DT;
  const count = Math.max(2, Math.min(32, Math.ceil(travel / 0.18))), dt = TICK_DT / count;
  for (let step = 0; step < count; step++) {
    const previous = { ...s };
    readRotation(s);
    const rate = len3(s.pitchRate, s.yawRate, s.rollRate);
    if (rate > 1e-9) {
      quatAxis(turn, 0, -s.pitchRate / rate, s.yawRate / rate, s.rollRate / rate, rate * dt);
      quatMul(q, 0, q, 0, turn, 0); quatNormalize(q, 0); writeRotation(s);
    }
    if (s.grounded) continue;
    // Anisotropic body drag, with no desired-speed servo: flares, dives and inverted momentum remain available.
    bodyDrag(s, p);
    const thrust = liftMax * s.collective;
    const ax = upright[0]! * thrust + drag[0]!, az = upright[2]! * thrust + drag[2]!;
    let ay = upright[1]! * thrust - p.gravity + drag[1]!;
    // Unpowered rotor drag dissipates fall energy; broken blades lose that benefit. It never reverses gravity.
    if (!powered && s.vy < 0 && upright[1]! > 0) ay += Math.min(p.gravity * 0.92, s.vy * s.vy * 0.22 * efficiency * upright[1]!);
    if (wet) { ay += -s.vy * 3; }
    s.vx = clamp(s.vx + ax * dt, -120, 120); s.vy = clamp(s.vy + ay * dt, -100, 100); s.vz = clamp(s.vz + az * dt, -120, 120);
    if (wet) { s.vx *= 1 - 2 * dt; s.vz *= 1 - 2 * dt; }
    s.x += s.vx * dt; s.z += s.vz * dt; s.y += s.vy * dt;
    if (s.y > WORLD_MAX_Y - p.height) { s.y = WORLD_MAX_Y - p.height; s.vy = Math.min(0, s.vy); }
    const support = upright[1]! > 0.9 ? world.support(s.x, previous.y + 0.04, s.z, s.yaw, Math.max(0.12, previous.y - s.y + 0.06), p) : null;
    if (support && s.vy <= 0 && s.y <= support.y + 0.012 && previous.y >= support.y - 0.012) {
      result.landSpeed = Math.max(result.landSpeed, -s.vy); result.impactSpeed = Math.max(result.impactSpeed, -s.vy);
      s.y = support.y; s.vy = 0; s.grounded = true; s.groundPitch = support.pitch; s.groundRoll = support.roll;
    }
    const hit = world.blocked(previous, s, def);
    if (hit) {
      const vx = s.vx, vy = s.vy, vz = s.vz;
      const nx = hit.nx ?? 0, ny = hit.ny ?? 0, nz = hit.nz ?? 0;
      const into = Math.min(0, vx * nx + vy * ny + vz * nz);
      const impact = len3(nx, ny, nz) > .9 ? -into : len3(vx, vy, vz);
      recordHit(hit, impact + (hit.rotor ? angular * span : 0));
      Object.assign(s, previous); s.yawRate = s.pitchRate = s.rollRate = 0;
      const slide = { ...s, vx: vx - nx * into, vy: vy - ny * into, vz: vz - nz * into, grounded: false };
      slide.x += slide.vx * dt; slide.y += slide.vy * dt; slide.z += slide.vz * dt;
      if (len3(nx, ny, nz) > 0.9 && !world.blocked(s, slide, def)) Object.assign(s, slide);
      else {
        const fall = { ...s, y: s.y + vy * dt, vy, vx: 0, vz: 0 };
        if (Math.abs(vy) > 1e-5 && !world.blocked(s, fall, def)) Object.assign(s, fall);
        else { s.vx = s.vy = s.vz = 0; }
      }
    }
    if (s.grounded) {
      s.vx *= Math.max(0, 1 - 8 * dt); s.vz *= Math.max(0, 1 - 8 * dt);
      result.surface = "ground"; break;
    }
  }
  if (s.grounded && !input.pilot) s.engineOn = false;
  if (s.fuel <= 0) s.engineOn = false;
  result.fuelUsed = beforeFuel - s.fuel;
  for (const key of ["x", "y", "z", "yaw", "pitch", "roll", "qx", "qy", "qz", "qw", "vx", "vy", "vz", "yawRate", "pitchRate", "rollRate", "groundPitch", "groundRoll", "fuel", "payloadMass", "engineRpm", "rotorRpm", "rotorPhase", "engineCondition", "rotorCondition", "collective"] as const) s[key] = Math.fround(s[key]);
  return result;
}
