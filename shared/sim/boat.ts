// Finite displaced volume, stern thrust and hydrodynamic resistance on the same fixed tick on both runtimes.
// The keel origin follows a rigid body: attitude never substitutes for actual translation or a water-height snap.
import { TICK_DT } from "../coords.ts";
import { quatAxis, quatMul, quatNlerp, quatNormalize, quatRotate, quatUnrotate } from "../math/quat.ts";
import { clamp, detAtan2, detCos, detSin, len3, TAU } from "../math/scalar.ts";
import { validateBoatSpec, type BoatSpec, type BoatVehicleDefinition, type VehicleState } from "./vehicle.ts";

export interface BoatState extends VehicleState {
  qx: number; qy: number; qz: number; qw: number;
  engineCondition: number;
  engineOn: boolean;
  /** Authoritative hull HP fraction. The force solver reads it; flooding never overwrites damage. */
  hullCondition: number;
  flooding: number;
}
export interface BoatInput { throttle: number; steer: number; neutral: boolean; pilot: boolean }
export interface BoatContact { reason: string; propeller: boolean; nx: number; ny: number; nz: number }
export interface BoatWorld {
  waterAt(x: number, z: number): number;
  groundAt(x: number, z: number): number;
  blocked(from: Readonly<BoatState>, to: Readonly<BoatState>, def: BoatVehicleDefinition): BoatContact | null;
}
export interface BoatStep {
  blocked: string | null; impactSpeed: number; propHit: boolean; water: boolean;
  immersion: number; propellerImmersion: number; planing: number; capsized: boolean;
  fuelUsed: number; surface: string;
}
const result: BoatStep = { blocked: null, impactSpeed: 0, propHit: false, water: false, immersion: 0, propellerImmersion: 0, planing: 0, capsized: false, fuelUsed: 0, surface: "air" };
const q = new Float64Array(4), turn = new Float64Array(4), q0 = new Float64Array(4), q1 = new Float64Array(4);
const localV = new Float64Array(3), point = new Float64Array(3), buoy = new Float64Array(3), up = new Float64Array(3), ahead = new Float64Array(3), com = new Float64Array(3);
const force = new Float64Array(3), torque = new Float64Array(3), worldForce = new Float64Array(3);
const propellerPoint = new Float64Array(3);
const unit = (n: number): number => Number.isFinite(n) ? clamp(n, -1, 1) : 0;
const approach = (n: number, target: number, by: number): number => n < target ? Math.min(target, n + by) : Math.max(target, n - by);
const square = (n: number): number => n * n;

/** Physical propeller centre in the keel frame, including the steering joint used by the rendered outboard. */
export function boatPropellerPoint(p: BoatSpec, steering: number, out: Float64Array | number[]): void {
  const at = p.propeller.at, pivot = p.outboard?.pivot;
  if (!pivot) { out[0] = at[0]; out[1] = at[1]; out[2] = at[2]; return; }
  const sn = detSin(-steering), cs = detCos(-steering), x = at[0] - pivot[0], z = at[2] - pivot[2];
  out[0] = pivot[0] + cs * x + sn * z; out[1] = at[1]; out[2] = pivot[2] - sn * x + cs * z;
}

/** Exact upright static waterline for these float volumes. Overloaded hulls have no floating placement. */
export function boatRestY(p: BoatSpec, water: number, payloadMass = 0): number {
  if (!Number.isFinite(water) || !Number.isFinite(payloadMass) || payloadMass < 0 || p.mass + payloadMass >= p.displacement) return -Infinity;
  let low = -p.height - p.buoyancyHeight, high = p.height + p.buoyancyHeight;
  for (let i = 0; i < 32; i++) {
    const y = (low + high) / 2;
    const volume = p.buoyancyPoints.reduce((sum, b) => sum + b.weight * clamp((-y - b.at[1]) / p.buoyancyHeight + .5, 0, 1), 0);
    if (volume * p.displacement > p.mass + payloadMass) low = y; else high = y;
  }
  return water + (low + high) / 2;
}
export function createBoat(p: BoatSpec, x: number, y: number, z: number, yaw = 0, fuel = p.fuelCapacity): BoatState {
  validateBoatSpec(p);
  if (![x, y, z, yaw, fuel].every(Number.isFinite) || fuel < 0 || fuel > p.fuelCapacity) throw new Error("invalid boat state");
  return { x, y, z, yaw, pitch: 0, roll: 0, qx: 0, qy: detSin(yaw / 2), qz: 0, qw: detCos(yaw / 2),
    vx: 0, vy: 0, vz: 0, grounded: false, yawRate: 0, pitchRate: 0, rollRate: 0, groundPitch: 0, groundRoll: 0,
    rideOffset: 0, rideVelocity: 0, steering: 0, wheelAngle: 0, fuel, gear: 0, engineRpm: 0, shiftTime: 0,
    payloadMass: 0, engineCondition: 1, engineOn: false, hullCondition: 1, flooding: 0 };
}
function rotation(s: BoatState): void {
  q.set([s.qx, s.qy, s.qz, s.qw]); quatNormalize(q, 0);
  quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 0, 0, 1, ahead, 0);
}
function writeRotation(s: BoatState): void {
  s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
  quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 0, 0, 1, ahead, 0);
  const horizontal = Math.sqrt(square(ahead[0]!) + square(ahead[2]!));
  if (horizontal > 1e-5) s.yaw = detAtan2(ahead[0]!, ahead[2]!);
  s.pitch = detAtan2(ahead[1]!, horizontal);
  s.roll = detAtan2(-(up[0]! * detCos(s.yaw) - up[2]! * detSin(s.yaw)), up[1]!);
}
function addForce(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
  force[0] += fx; force[1] += fy; force[2] += fz;
  torque[0] += y * fz - z * fy; torque[1] += z * fx - x * fz; torque[2] += x * fy - y * fx;
}
function immersion(world: BoatWorld, x: number, y: number, z: number, height: number): number {
  const water = world.waterAt(x, z), bottom = world.groundAt(x, z);
  return Number.isFinite(water) && water > bottom ? clamp((water - y) / height + .5, 0, 1) : 0;
}
function motor(s: BoatState, input: Readonly<BoatInput>, p: BoatSpec, wet: number, capsized: boolean): void {
  const request = input.pilot && !input.neutral ? unit(input.throttle) : 0;
  const usable = s.fuel > 0 && s.engineCondition > .08 && s.hullCondition > 0 && s.flooding < .75 && !capsized;
  if (input.pilot && Math.abs(request) > .01 && usable) s.engineOn = true;
  if (!usable || !input.pilot) s.engineOn = false;
  const wanted = request > .01 ? 1 : request < -.01 ? -1 : 0;
  s.shiftTime = Math.max(0, s.shiftTime - TICK_DT);
  if (wanted === 0) s.gear = 0;
  // Reversing unloads the engine, crosses neutral, then engages. Neither shift ever cancels hull momentum.
  if (s.gear !== 0 && s.gear !== wanted) {
    s.engineRpm = approach(s.engineRpm, p.idleRpm, p.rpmRate * 1.5 * TICK_DT);
    if (s.engineRpm <= p.idleRpm + 1) { s.gear = 0; s.shiftTime = p.shiftDelay; }
  } else {
    if (s.gear === 0 && wanted !== 0 && s.shiftTime === 0 && s.engineOn) s.gear = wanted;
    const drive = s.gear === wanted && s.gear !== 0 ? Math.abs(request) : 0;
    s.engineRpm = approach(s.engineRpm, s.engineOn ? p.idleRpm + (p.maxRpm - p.idleRpm) * drive : 0, p.rpmRate * TICK_DT);
  }
  if (!s.engineOn) { s.gear = 0; s.engineRpm = approach(s.engineRpm, 0, p.rpmRate * TICK_DT); }
  s.steering = approach(s.steering, input.pilot ? unit(input.steer) * p.maxSteer : 0, p.steerRate * TICK_DT);
  if (s.engineOn) s.fuel = Math.max(0, s.fuel - p.fuelPerSecond * (.16 + .84 * square(s.engineRpm / p.maxRpm)) * TICK_DT);
  // An exposed prop may rev but cannot drive. This field is a presentation phase, already carried by vehicle state.
  s.wheelAngle = (s.wheelAngle + s.engineRpm * s.gear * TAU / 60 * TICK_DT) % TAU;
  result.propellerImmersion = wet;
}

/** Reuses its result. Forces are bounded, and all future-controlling fields round once at the shared world tick. */
export function stepBoat(s: BoatState, input: Readonly<BoatInput>, def: BoatVehicleDefinition, world: BoatWorld): BoatStep {
  const p = def.spec, beforeFuel = s.fuel, beforeSteering = s.steering;
  Object.assign(result, { blocked: null, impactSpeed: 0, propHit: false, water: false, immersion: 0, propellerImmersion: 0, planing: 0, capsized: false, fuelUsed: 0, surface: "air" });
  s.hullCondition = clamp(s.hullCondition, 0, 1); s.engineCondition = clamp(s.engineCondition, 0, 1); s.flooding = clamp(s.flooding, 0, 1);
  s.payloadMass = clamp(s.payloadMass, 0, 100000); s.rideOffset = s.rideVelocity = 0;
  rotation(s); writeRotation(s);
  boatPropellerPoint(p, s.steering, propellerPoint);
  quatRotate(q, 0, propellerPoint[0]!, propellerPoint[1]!, propellerPoint[2]!, point, 0);
  const propWet = immersion(world, s.x + point[0]!, s.y + point[1]!, s.z + point[2]!, p.propeller.radius * 2);
  const capsize = up[1]! < .15;
  motor(s, input, p, propWet, capsize);
  const wantedSteering = s.steering; s.steering = beforeSteering;
  const mass = p.mass + s.payloadMass + s.flooding * p.displacement * .38;
  const ix = mass * (square(p.halfLength * 2) + square(p.height)) / 12;
  const iy = mass * (square(p.halfLength * 2) + square(p.halfWidth * 2)) / 12;
  const iz = mass * (square(p.halfWidth * 2) + square(p.height)) / 12;
  const travel = (len3(s.vx, s.vy, s.vz) + len3(s.pitchRate, s.yawRate, s.rollRate) * (p.halfLength + 1)) * TICK_DT;
  const count = Math.max(3, Math.min(32, Math.ceil(travel / .14))), dt = TICK_DT / count;
  let touching = false, wetTotal = 0;
  s.grounded = false;
  for (let step = 0; step < count; step++) {
    const previous = { ...s }; rotation(s);
    s.steering = beforeSteering + (wantedSteering - beforeSteering) * (step + 1) / count;
    force.fill(0); torque.fill(0); quatUnrotate(q, 0, s.vx, s.vy, s.vz, localV, 0);
    const wx = -s.pitchRate, wy = s.yawRate, wz = s.rollRate;
    let wet = 0;
    for (const b of p.buoyancyPoints) {
      quatRotate(q, 0, b.at[0], b.at[1], b.at[2], point, 0);
      const fraction = immersion(world, s.x + point[0]!, s.y + point[1]!, s.z + point[2]!, p.buoyancyHeight);
      if (fraction <= 0) continue;
      wet += fraction * b.weight;
      const rx = b.at[0] - p.centerOfMass[0], ry = b.at[1] - p.centerOfMass[1], rz = b.at[2] - p.centerOfMass[2];
      const pvx = localV[0]! + wy * rz - wz * ry, pvy = localV[1]! + wz * rx - wx * rz, pvz = localV[2]! + wx * ry - wy * rx;
      quatRotate(q, 0, pvx, pvy, pvz, point, 0);
      const volume = p.displacement * (1 - .92 * s.flooding);
      const damp = p.buoyancyDamping * mass * b.weight * Math.min(1, fraction / .35);
      const lift = clamp(volume * p.gravity * fraction * b.weight - point[1]! * damp, 0, p.displacement * p.gravity * b.weight * 2);
      quatUnrotate(q, 0, 0, lift, 0, buoy, 0); addForce(rx, ry, rz, buoy[0]!, buoy[1]!, buoy[2]!);
      // Side resistance is sampled along the hull: a turning bow and stern feel different flow, providing yaw damping.
      const drag = -pvx * p.sideDrag * (1 + Math.abs(pvx) * .25) * b.weight * Math.min(1, fraction / .35);
      addForce(rx, -.24, rz, drag, 0, 0);
    }
    wetTotal = Math.max(wetTotal, wet);
    const waterShare = clamp(wet / .35, 0, 1), along = localV[2]!;
    const plane = clamp((along - p.planingSpeed) / (p.planingSpeed * .8), 0, 1) * clamp(up[1]!, 0, 1) * clamp(wet / .12, 0, 1) * (1 - s.flooding);
    result.planing = Math.max(result.planing, plane);
    const resistance = along < 0 ? p.reverseThrust / square(p.maxReverse) * .88 : p.forwardDrag * (1 - .32 * plane);
    addForce(0, 0, 0, 0, -localV[1]! * mass * .65 * waterShare, -along * (90 + Math.abs(along) * resistance) * waterShare);
    // Dynamic pressure supports part of the hull, with a small forward centre of pressure giving genuine bow trim.
    const lift = p.mass * p.gravity * p.planingLift * plane;
    addForce(0, -.20, p.planingTrim * 4, 0, lift, 0);
    torque[2] -= s.yawRate * Math.max(0, along) * mass * .55 * plane;
    boatPropellerPoint(p, s.steering, propellerPoint);
    quatRotate(q, 0, propellerPoint[0]!, propellerPoint[1]!, propellerPoint[2]!, point, 0);
    const px = s.x + point[0]!, py = s.y + point[1]!, pz = s.z + point[2]!;
    const prop = immersion(world, px, py, pz, p.propeller.radius * 2);
    // Shallow water may surround the hull while the propeller touches bottom: no usable thrust there.
    const clearance = clamp((py - world.groundAt(px, pz) - p.propeller.radius * .6) / p.propeller.radius, 0, 1);
    const demand = clamp((s.engineRpm - p.idleRpm) / (p.maxRpm - p.idleRpm), 0, 1);
    const thrust = s.engineOn && up[1]! > .15 ? s.gear * (s.gear > 0 ? p.thrust : p.reverseThrust) * demand * (.25 + .75 * s.engineCondition) * prop * clearance : 0;
    addForce(propellerPoint[0]! - p.centerOfMass[0], propellerPoint[1]! - p.centerOfMass[1], propellerPoint[2]! - p.centerOfMass[2], -detSin(s.steering) * thrust, 0, detCos(s.steering) * thrust);
    const angularDamp = .1 + p.angularDrag * waterShare;
    torque[0] -= wx * ix * angularDamp; torque[1] -= wy * iy * angularDamp * .25; torque[2] -= wz * iz * angularDamp;
    s.pitchRate = clamp(s.pitchRate - torque[0]! / ix * dt, -4, 4);
    s.yawRate = clamp(s.yawRate + torque[1]! / iy * dt, -4, 4);
    s.rollRate = clamp(s.rollRate + torque[2]! / iz * dt, -4, 4);
    quatRotate(q, 0, force[0]!, force[1]!, force[2]!, worldForce, 0);
    s.vx = clamp(s.vx + (worldForce[0]! / mass - s.vx * .015) * dt, -100, 100);
    s.vy = clamp(s.vy + (worldForce[1]! / mass - p.gravity - s.vy * .015) * dt, -80, 80);
    s.vz = clamp(s.vz + (worldForce[2]! / mass - s.vz * .015) * dt, -100, 100);
    quatRotate(q, 0, p.centerOfMass[0], p.centerOfMass[1], p.centerOfMass[2], com, 0);
    const rate = len3(s.pitchRate, s.yawRate, s.rollRate);
    if (rate > 1e-9) { quatAxis(turn, 0, -s.pitchRate / rate, s.yawRate / rate, s.rollRate / rate, rate * dt); quatMul(q, 0, q, 0, turn, 0); quatNormalize(q, 0); }
    quatRotate(q, 0, p.centerOfMass[0], p.centerOfMass[1], p.centerOfMass[2], point, 0);
    s.x += s.vx * dt + com[0]! - point[0]!; s.y += s.vy * dt + com[1]! - point[1]!; s.z += s.vz * dt + com[2]! - point[2]!;
    writeRotation(s);
    const hit = world.blocked(previous, s, def);
    if (hit) {
      result.blocked ??= hit.reason; result.propHit ||= hit.propeller;
      let nx = hit.nx, ny = hit.ny, nz = hit.nz, low = 0, high = 1;
      const next = { ...s }, safe = { ...previous };
      q0.set([previous.qx, previous.qy, previous.qz, previous.qw]); q1.set([s.qx, s.qy, s.qz, s.qw]);
      for (let probe = 0; probe < 6; probe++) {
        const t = (low + high) / 2; quatNlerp(q, 0, q0, 0, q1, 0, t);
        const candidate = { ...next, x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t, z: previous.z + (next.z - previous.z) * t, steering: previous.steering + (next.steering - previous.steering) * t, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
        const contact = world.blocked(previous, candidate, def);
        if (contact) { high = t; nx = contact.nx; ny = contact.ny; nz = contact.nz; } else { low = t; Object.assign(safe, candidate); }
      }
      const into = Math.min(0, next.vx * nx + next.vy * ny + next.vz * nz);
      result.impactSpeed = Math.max(result.impactSpeed, -into + rate * (hit.propeller ? p.propeller.radius : .3));
      let vx = next.vx - into * nx, vy = next.vy - into * ny, vz = next.vz - into * nz;
      if (ny > .45) {
        touching = true;
        const speed = len3(vx, vy, vz), keep = speed > 0 ? Math.max(0, 1 - (-into * .35 + p.gravity * .38 * dt) / speed) : 0;
        vx *= keep; vy *= keep; vz *= keep;
      }
      Object.assign(s, safe, { vx, vy, vz, yawRate: 0, pitchRate: 0, rollRate: 0 });
      const slide = { ...s, x: s.x + vx * dt, y: s.y + vy * dt, z: s.z + vz * dt };
      if (!world.blocked(s, slide, def)) Object.assign(s, slide);
      else { s.vx = s.vy = s.vz = 0; }
    }
  }
  rotation(s); writeRotation(s);
  result.water = wetTotal > .001; result.immersion = wetTotal; result.capsized = result.water && up[1]! < .15;
  // Open cockpit ingress is gradual. Upright healthy hulls self-bail slowly; a breached hull cannot bail its leak away.
  const ingress = result.capsized ? .09 : s.hullCondition < .5 && result.water ? (.5 - s.hullCondition) * .07 : 0;
  const bail = !result.capsized && s.hullCondition > .65 && up[1]! > .8 ? .006 : 0;
  s.flooding = clamp(s.flooding + (ingress - bail) * TICK_DT, 0, 1);
  if (result.capsized || s.flooding >= .75 || s.fuel <= 0) s.engineOn = false;
  s.grounded = touching; result.surface = touching ? "ground" : result.water ? "water" : "air";
  result.fuelUsed = beforeFuel - s.fuel;
  for (const key of ["x", "y", "z", "yaw", "pitch", "roll", "qx", "qy", "qz", "qw", "vx", "vy", "vz", "yawRate", "pitchRate", "rollRate", "steering", "wheelAngle", "fuel", "payloadMass", "engineRpm", "shiftTime", "engineCondition", "hullCondition", "flooding"] as const) s[key] = Math.fround(s[key]);
  return result;
}
