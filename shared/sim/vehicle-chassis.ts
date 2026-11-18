// Four fixed substeps, four unilateral wheel springs, and one freely rotating rigid chassis.
import { TICK_DT } from "../coords.ts";
import { quatRotate } from "../math/quat.ts";
import { clamp, detAtan2, detCos, detSin, len3, TAU } from "../math/scalar.ts";
import { resolveVehicleContacts, separateVehicleOverlap, type VehicleContactQueries } from "./vehicle-contact.ts";
import { DEFAULT_DRIVETRAIN, stepDrivetrain } from "./vehicle-drivetrain.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import { applyVehicleImpulse, integrateVehiclePose, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from "./vehicle-rigid.ts";
import { holdParkedTyres } from "./vehicle-tyre-static.ts";
import { applyCarWater, dragCarInWater } from "./vehicle-water.ts";
import type { CarState, VehicleInput, VehicleSpec, VehicleState, VehicleStep, VehicleSurface, VehicleWorld } from "./vehicle.ts";

const q = new Float64Array(4), up = new Float64Array(3), ahead = new Float64Array(3), local = new Float64Array(3), pointV = new Float64Array(3);
interface Wheel { x: number; y: number; z: number; nx: number; ny: number; nz: number; load: number; offset: number; closing: number; front: boolean; surface: VehicleSurface }
const wheels: Wheel[] = [];
const square = (n: number): number => n * n;
const command = (n: number, lo: number, hi: number): number => Number.isFinite(n) ? clamp(n, lo, hi) : 0;
const approach = (n: number, target: number, by: number): number => n < target ? Math.min(n + by, target) : Math.max(n - by, target);
const wrap = (n: number): number => n - Math.floor((n + TAU / 2) / TAU) * TAU;


function wheelSupports(s: VehicleState, p: VehicleSpec, w: VehicleWorld, mass: number): void {
  wheels.length = 0;
  if (up[1]! < .15) return;
  const travel = p.suspensionTravel ?? .18, mount = p.wheelRadius + travel, gravity = p.gravity ?? 18;
  const frequency = (p.suspensionFrequency ?? 10) * Math.sqrt((p.mass ?? 1100) / mass), damping = p.suspensionDamping ?? .85;
  for (const z of [p.wheelbase / 2, -p.wheelbase / 2]) for (const x of [-p.track / 2, p.track / 2]) {
    quatRotate(q, 0, x, mount, z, local, 0);
    const ox = s.x + local[0]!, oy = s.y + local[1]!, oz = s.z + local[2]!;
    let hit = w.wheelRay(ox, oy, oz, -up[0]!, -up[1]!, -up[2]!, mount + travel, p);
    let sample = 0, distance = hit?.distance ?? Infinity;
    // The leading tyre arc reaches a kerb before the axle ray; its rise follows the wheel circle.
    const lead = p.wheelRadius * .7 * (s.gear < 0 ? -1 : 1), lift = p.wheelRadius - Math.sqrt(p.wheelRadius * p.wheelRadius - lead * lead);
    const edge = w.wheelRay(ox + ahead[0]! * lead, oy + ahead[1]! * lead, oz + ahead[2]! * lead, -up[0]!, -up[1]!, -up[2]!, mount + travel, p);
    if (edge && edge.distance + lift < distance) { hit = edge; distance = edge.distance + lift; sample = lead; }
    if (!hit || hit.ny < .25 || hit.nx * up[0]! + hit.ny * up[1]! + hit.nz * up[2]! < .25 || hit.surface.grip < 0) continue;
    const px = ox + ahead[0]! * sample - up[0]! * hit.distance, py = oy + ahead[1]! * sample - up[1]! * hit.distance, pz = oz + ahead[2]! * sample - up[2]! * hit.distance;
    vehiclePointVelocity(s, p, px, py, pz, pointV);
    const compression = mount - distance, speed = pointV[0]! * hit.nx + pointV[1]! * hit.ny + pointV[2]! * hit.nz;
    // Preload holds the authored resting wheel height; neither springs nor dampers may pull on the road.
    const stop = Math.max(0, compression - Math.min(travel * .65, p.clearance * .65));
    const load = mass / 4 * clamp(gravity + frequency * frequency * compression - 2 * damping * frequency * speed + stop * 2400, 0, gravity * 16);
    wheels.push({ x: px, y: py, z: pz, nx: hit.nx, ny: hit.ny, nz: hit.nz, load, offset: -compression,
      closing: Math.max(0, -speed), front: z > 0, surface: hit.surface });
  }
}


/** A near-vertical hull may be statically braced by a floor and a wall, even when neither face alone contains its COM. */
function bracedAtRest(s: VehicleState, p: VehicleSpec, w: VehicleWorld): boolean {
  vehicleRotation(s, q);
  if (Math.abs(2 * (q[1]! * q[2]! - q[3]! * q[0]!)) < .65) return false;
  const floor = w.contact(s, { ...s, y: s.y - .01 }, p);
  if (!floor || floor.ny < .8) return false;
  for (const [x, z] of [[.015, 0], [-.015, 0], [0, .015], [0, -.015]]) {
    const wall = w.contact(s, { ...s, x: s.x + x!, z: s.z + z! }, p);
    if (wall && Math.abs(wall.ny) < .4) return true;
  }
  return false;
}


export function stepVehicle(s: VehicleState & Partial<Pick<CarState, "engineCondition" | "engineOn" | "hullCondition" | "flooding">>, input: VehicleInput, p: VehicleSpec, w: VehicleWorld): VehicleStep {
  const result: VehicleStep = { blocked: null, impactSpeed: 0, landSpeed: 0, fuelUsed: 0, surface: "air", water: false, immersion: 0 };
  const contacts: VehicleContactQueries<VehicleState> = {
    contact: (from, to) => w.contact(from, to, p),
    penetration: at => w.penetration(at, p),
    breakContact: w.breakContact ? (state, hit) => w.breakContact!(state, p, hit) : undefined,
  };
  const throttle = command(input.throttle, -1, 1), steer = command(input.steer, -1, 1), brake = command(input.brake, 0, 1);
  const dt = TICK_DT / 4, beforeFuel = s.fuel, gravity = p.gravity ?? 18;
  const { mass, ix, iy, iz } = vehicleMassProperties(p, s), massRatio = (p.mass ?? 1100) / mass;
  const drivetrain = p.drivetrain ?? DEFAULT_DRIVETRAIN;
  s.engineCondition ??= 1; s.hullCondition ??= 1; s.flooding ??= 0; s.engineOn ??= s.fuel > 0;
  if (s.fuel <= 0 || s.engineCondition <= .08 || s.hullCondition <= 0 || input.pilot === false) s.engineOn = false;
  else if (Math.abs(throttle) > .01) s.engineOn = true;
  let restingContact = false;
  const startX = s.x, startY = s.y, startZ = s.z;
  vehicleRotation(s, q); const startQx = q[0]!, startQy = q[1]!, startQz = q[2]!, startQw = q[3]!;
  for (let substep = 0; substep < 4; substep++) {
    integrateVehiclePose(s, p, 0); vehicleRotation(s, q);
    if (substep === 0) separateVehicleOverlap(s, contacts);
    quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 0, 0, 1, ahead, 0);
    const prior = { ...s }, wasGrounded = s.grounded;
    const water = applyCarWater(s, p, w, dt);
    result.water ||= water.immersion > .001; result.immersion = Math.max(result.immersion ?? 0, water.immersion);
    const forward = s.vx * ahead[0]! + s.vy * ahead[1]! + s.vz * ahead[2]!;
    const limit = p.maxSteer / (1 + square(Math.abs(forward) / (p.steerSpeed ?? 18)));
    s.steering = approach(s.steering, steer * limit, p.steerRate * (steer === 0 ? 1.35 : 1) * dt);
    wheelSupports(s, p, w, mass);
    s.grounded = wheels.some(wheel => wheel.load > mass * gravity * .01);
    const mechanical = stepDrivetrain(s, { throttle, forward, wheelRadius: p.wheelRadius, running: s.engineOn,
      disengaged: brake > 0 || input.handbrake || !s.grounded || water.immersion > .75, neutral: input.neutral === true }, drivetrain, dt);
    const spent = Math.min(s.fuel, s.engineOn ? Math.abs(throttle) * p.fuelPerSecond * dt : 0); s.fuel -= spent;
    if (wheels.length === 0 && prior.grounded && (water.immersion === 0 || s.flooding >= .999) && len3(s.vx, s.vy, s.vz) < .001 && len3(s.pitchRate, s.yawRate, s.rollRate) < .001) {
      const support = restingContact ? null : w.contact(s, { ...s, y: s.y - .01 }, p);
      if (restingContact || support?.balanced && len3(support.nx, 0, support.nz) < support.ny * .45 || bracedAtRest(s, p, w)) {
        restingContact = true;
        s.grounded = true; result.surface = "ground"; s.rideVelocity = 0; continue;
      }
    }
    s.vy -= gravity * dt;
    if (p.downforce && forward > 0 && water.immersion === 0) {
      // Acting at the centre of mass loads the suspension naturally. Do not create a levelling torque in flight.
      const impulse = p.downforce * forward * forward * dt / mass;
      s.vx -= up[0]! * impulse; s.vy -= up[1]! * impulse; s.vz -= up[2]! * impulse;
    }
    let totalLoad = 0, averageOffset = 0, normalX = 0, normalY = 0, normalZ = 0;
    for (const wheel of wheels) {
      totalLoad += wheel.load; averageOffset += wheel.offset;
      normalX += wheel.nx; normalY += wheel.ny; normalZ += wheel.nz;
      applyVehicleImpulse(s, p, wheel.x, wheel.y, wheel.z, wheel.nx * wheel.load * dt, wheel.ny * wheel.load * dt, wheel.nz * wheel.load * dt);
      if (!wasGrounded) result.landSpeed = Math.max(result.landSpeed, wheel.closing);
    }
    const previousOffset = s.rideOffset;
    s.rideOffset = wheels.length ? clamp(averageOffset / wheels.length, -(p.suspensionTravel ?? .18), p.suspensionTravel ?? .18) : p.suspensionTravel ?? .18;
    s.rideVelocity = (s.rideOffset - previousOffset) / dt;
    if (wheels.length) {
      const sn = detSin(s.yaw), cs = detCos(s.yaw);
      s.groundPitch = detAtan2(-(normalX * sn + normalZ * cs), normalY);
      s.groundRoll = detAtan2(normalX * cs - normalZ * sn, normalY);
      result.surface = wheels.reduce((least, wheel) => wheel.surface.grip < least.grip ? wheel.surface : least, wheels[0]!.surface).id;
    }
    const pedal = brake * (.25 + .75 * brake);
    const serviceBrake = p.brake * massRatio * Math.max(pedal, mechanical.opposingBrake);
    const tyreState = { ...s };
    // A parking brake still has finite grip while a parked car is sliding. Speed must not switch that grip off.
    // At driving speed a piloted handbrake retains the authored rear-wheel drift behaviour.
    const staticParking = serviceBrake > 0 && len3(s.vx, s.vy, s.vz) < 8 || input.handbrake && (input.pilot === false || Math.abs(forward) < 4) ||
      Math.abs(mechanical.drive) < .01 && len3(s.vx, s.vy, s.vz) < .01;
    if (!staticParking) for (const wheel of wheels) {
      if (wheel.load <= 0) continue;
      const steering = wheel.front ? s.steering : 0;
      quatRotate(q, 0, detSin(steering), 0, detCos(steering), local, 0);
      const dot = local[0]! * wheel.nx + local[1]! * wheel.ny + local[2]! * wheel.nz;
      let fx = local[0]! - dot * wheel.nx, fy = local[1]! - dot * wheel.ny, fz = local[2]! - dot * wheel.nz;
      const length = len3(fx, fy, fz); if (length < .01) continue;
      fx /= length; fy /= length; fz /= length;
      const sx = wheel.ny * fz - wheel.nz * fy, sy = wheel.nz * fx - wheel.nx * fz, sz = wheel.nx * fy - wheel.ny * fx;
      vehiclePointVelocity(tyreState, p, wheel.x, wheel.y, wheel.z, pointV);
      let along = pointV[0]! * fx + pointV[1]! * fy + pointV[2]! * fz;
      const side = pointV[0]! * sx + pointV[1]! * sy + pointV[2]! * sz;
      const share = wheel.load / Math.max(totalLoad, 1), grip = wheel.load / gravity * wheel.surface.grip * (wheel.front ? p.frontGrip ?? 1.08 : p.rearGrip ?? 1.05);
      const resistance = wheel.surface.rolling * mass + wheel.surface.drag * along * along * mass * (p.dragScale ?? 1) + mechanical.engineDrag;
      const torqueShare = p.frontDriveShare === undefined ? share : (wheel.front ? p.frontDriveShare : 1 - p.frontDriveShare) / 2;
      let drive = s.engineOn ? mechanical.drive * (p.drivetrain ? 1 : p.acceleration / 8) * torqueShare : 0;
      drive = clamp(drive, -grip * .95, grip * .95);
      if (drive > 0) drive = Math.min(drive, Math.max(0, resistance * share + (p.maxForward - forward) / dt * mass * share));
      else if (drive < 0) drive = Math.max(drive, Math.min(0, -resistance * share + (-p.maxReverse - forward) / dt * mass * share));
      const braking = Math.max(serviceBrake, input.handbrake && !wheel.front ? p.brake * massRatio * 1.6 : 0);
      let stoppingMass = mass * share;
      if (braking > 0 && Math.abs(along) < .5) {
        vehiclePointVelocity(s, p, wheel.x, wheel.y, wheel.z, pointV);
        along = pointV[0]! * fx + pointV[1]! * fy + pointV[2]! * fz;
        stoppingMass = 1 / vehiclePointInverseMass(s, p, wheel.x, wheel.y, wheel.z, fx, fy, fz);
      }
      const slowing = Math.min(Math.abs(along) * stoppingMass / dt, (braking * mass + resistance) * share);
      const longBudget = input.handbrake && Math.abs(along) < .5 ? Math.max(grip, wheel.load * 1.3 * clamp(wheel.surface.grip / 7, 0, 1)) : grip * (braking > 0 ? 1.6 : 1);
      const longitudinal = clamp(drive - Math.sign(along) * slowing, -longBudget, longBudget);
      const use = Math.min(.98, Math.abs(longitudinal) / Math.max(longBudget, 1));
      const lateralBudget = grip * Math.sqrt(1 - use * use) * (!wheel.front && input.handbrake ? p.handbrakeGrip ?? .18 : 1);
      const sideForce = clamp(-side * (p.corneringStiffness ?? 7) * mass * share, -lateralBudget, lateralBudget);
      applyVehicleImpulse(s, p, wheel.x, wheel.y, wheel.z, (fx * longitudinal + sx * sideForce) * dt, (fy * longitudinal + sy * sideForce) * dt, (fz * longitudinal + sz * sideForce) * dt);
    }
    const supportedRest = staticParking && holdParkedTyres(s, p, wheels, serviceBrake > 0, input.handbrake, dt);
    // Body-axis angular momentum transport, plus finite damping; no target upright attitude or air control.
    const wx = -s.pitchRate, wy = s.yawRate, wz = s.rollRate;
    s.pitchRate += (iz - iy) * wy * wz / ix * dt;
    s.yawRate += (iz - ix) * wz * wx / iy * dt;
    s.rollRate += (ix - iy) * wx * wy / iz * dt;
    s.yawRate *= Math.max(0, 1 - (s.grounded ? p.yawDamping ?? .8 : .08) * dt);
    const air = Math.max(0, 1 - (p.airDrag ?? .04) * dt);
    if (!s.grounded) { s.vx *= air; s.vz *= air; }
    dragCarInWater(s, water.immersion, dt);
    if (supportedRest && water.immersion === 0 && len3(s.vx, s.vy, s.vz) < .002 && len3(s.pitchRate, s.yawRate, s.rollRate) < .002 && Math.abs(s.rideVelocity) < .002) {
      s.vx = s.vy = s.vz = s.pitchRate = s.yawRate = s.rollRate = s.rideVelocity = 0;
    }
    s.vx = clamp(s.vx, -120, 120); s.vy = clamp(s.vy, -100, 100); s.vz = clamp(s.vz, -120, 120);
    s.pitchRate = clamp(s.pitchRate, -12, 12); s.yawRate = clamp(s.yawRate, -12, 12); s.rollRate = clamp(s.rollRate, -12, 12);
    integrateVehiclePose(s, p, dt); resolveVehicleContacts(s, prior, p, contacts, dt, result); integrateVehiclePose(s, p, 0);
    s.vx = clamp(s.vx, -120, 120); s.vy = clamp(s.vy, -100, 100); s.vz = clamp(s.vz, -120, 120);
    s.pitchRate = clamp(s.pitchRate, -12, 12); s.yawRate = clamp(s.yawRate, -12, 12); s.rollRate = clamp(s.rollRate, -12, 12);
    s.wheelAngle = wrap(s.wheelAngle + forward * dt / p.wheelRadius);
  }
  if (!restingContact && wheels.length === 0 && len3(s.vx, s.vy, s.vz) < .4 && len3(s.pitchRate, s.yawRate, s.rollRate) < .4) {
    separateVehicleOverlap(s, contacts);
    const support = w.contact(s, { ...s, y: s.y - .01 }, p);
    const balanced = support?.balanced && len3(support.nx, 0, support.nz) < support.ny * .45;
    vehicleRotation(s, q);
    const turned = 1 - Math.abs(startQx * q[0]! + startQy * q[1]! + startQz * q[2]! + startQw * q[3]!);
    const braced = turned < 1e-6 && len3(s.x - startX, s.y - startY, s.z - startZ) < .002 && bracedAtRest(s, p, w);
    if ((balanced || braced) && (!result.water || s.flooding >= .999)) {
      // A quiet roof/side resting over its support patch may sleep. An unsupported overhang keeps gravity/torque.
      s.grounded = true; s.vx = s.vy = s.vz = s.pitchRate = s.yawRate = s.rollRate = s.rideVelocity = 0;
    }
  }
  result.fuelUsed = beforeFuel - s.fuel;
  if (result.water) result.surface = "water";
  if (!s.engineOn && s.engineRpm < .01) s.engineRpm = 0;
  return result;
}
