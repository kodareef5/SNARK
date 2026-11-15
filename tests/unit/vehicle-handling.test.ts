import { expect, test } from 'bun:test';
import { COMPACT, ASPHALT } from '../../content/vehicles/compact.ts';
import { createVehicle, stepVehicle } from '../../shared/sim/vehicle.ts';
import type { VehicleInput, VehicleState, VehicleWorld } from '../../shared/sim/vehicle.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';

const flat: VehicleWorld = { support: () => ({ y: 0, normalY: 1, surface: ASPHALT }), blocked: () => null };
const input = (throttle = 0, steer = 0, brake = 0, handbrake = false): VehicleInput => ({ throttle, steer, brake, handbrake });
const speed = (s: VehicleState) => Math.hypot(s.vx, s.vz);
const slip = (s: VehicleState) => Math.atan2(s.vx * Math.cos(s.yaw) - s.vz * Math.sin(s.yaw), Math.abs(s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw)));
function run(s: VehicleState, ticks: number, command: VehicleInput, world = flat) {
  let blocked: string | null = null, impact = 0;
  for (let i = 0; i < ticks; i++) {
    const result = stepVehicle(s, command, COMPACT, world);
    blocked ??= result.blocked; impact = Math.max(impact, result.impactSpeed);
  }
  return { blocked, impact };
}
function terrain(height: (x: number, z: number) => number) {
  const dims = { chunksX: 2, chunksZ: 2 }, hf = new Heightfield(dims, 1, -16, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, height(x, z));
  const structs = new StructureStore(dims, new Float32Array([0, 4]), new Float32Array([0, 2]), new Float32Array([0, 0.05]));
  const world = new StaticVehicleWorld({ hf, structs }, () => ASPHALT);
  return { world, hf, structs };
}

test('engine torque reaches useful speed progressively; brakes stop it without reverse creep', () => {
  const car = createVehicle(COMPACT, 0, 0, 0);
  run(car, 60, input(1)); const twoSeconds = speed(car);
  run(car, 120, input(1));
  expect(twoSeconds).toBeGreaterThan(13); expect(twoSeconds).toBeLessThan(16);
  expect(speed(car)).toBeGreaterThan(27); expect(speed(car)).toBeLessThan(COMPACT.maxForward);
  const start = car.z;
  let ticks = 0;
  while (speed(car) > 0.03 && ticks < 90) { stepVehicle(car, input(0, 0, 1), COMPACT, flat); ticks++; }
  expect(ticks).toBeLessThan(70);
  expect(car.z - start).toBeGreaterThan(23); expect(car.z - start).toBeLessThan(32);
  run(car, 30, input(0, 0, 1));
  expect(car.vx).toBe(0); expect(car.vz).toBe(0);
  expect(car.fuel).toBeLessThan(COMPACT.fuelCapacity);
  const empty = createVehicle(COMPACT, 0, 0, 0, 0, 0);
  run(empty, 60, input(1)); expect(speed(empty)).toBe(0);
  const highway = createVehicle(COMPACT, 0, 0, 0);
  run(highway, 900, input(1));
  expect(speed(highway)).toBeGreaterThan(33); expect(speed(highway)).toBeLessThanOrEqual(COMPACT.maxForward);
});

test('speed-sensitive steering, yaw inertia and alternating slalom stay finite and controllable', () => {
  const slow = createVehicle(COMPACT, 0, 0, 0), fast = createVehicle(COMPACT, 0, 0, 0);
  slow.vz = 3; fast.vz = 18;
  run(slow, 20, input(0, 1)); run(fast, 20, input(0, 1));
  expect(Math.abs(fast.steering)).toBeLessThan(Math.abs(slow.steering) * 0.8);
  const car = createVehicle(COMPACT, 0, 0, 0); car.vz = 12;
  stepVehicle(car, input(0, 0.6), COMPACT, flat);
  expect(car.yawRate).toBeGreaterThan(0); expect(car.yawRate).toBeLessThan(0.3);
  let maximumSlip = 0, maximumRate = 0;
  for (let tick = 0; tick < 180; tick++) {
    stepVehicle(car, input(0.35, Math.floor(tick / 30) % 2 ? -0.3 : 0.3), COMPACT, flat);
    maximumSlip = Math.max(maximumSlip, Math.abs(slip(car))); maximumRate = Math.max(maximumRate, Math.abs(car.yawRate));
    for (const value of Object.values(car)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  }
  expect(maximumSlip).toBeLessThan(0.55); expect(maximumRate).toBeLessThan(1.5);
  expect(speed(car)).toBeGreaterThan(5);
});

test('handbrake releases rear grip; a countersteer recovers a moving drift rather than snapping yaw', () => {
  const car = createVehicle(COMPACT, 0, 0, 0);
  run(car, 120, input(1)); run(car, 15, input(0.4, 0.55));
  const normal = { ...car }, beforeYaw = car.yaw;
  run(normal, 9, input(0, 0.55)); run(car, 9, input(0, 0.55, 0, true));
  expect(Math.abs(slip(car))).toBeGreaterThan(Math.abs(slip(normal)) + 0.15);
  expect(car.yaw - beforeYaw).toBeGreaterThan(normal.yaw - beforeYaw);
  expect(speed(car)).toBeGreaterThan(8);
  run(car, 12, input(0.6, -0.4)); run(car, 60, input(0.6));
  expect(Math.abs(slip(car))).toBeLessThan(0.08);
  expect(Math.abs(car.yawRate)).toBeLessThan(0.08);
  expect(speed(car)).toBeGreaterThan(6);
});

test('sprung pitch and roll respond to load transfer without falsely colliding with flat terrain', () => {
  const { world } = terrain(() => 0), car = createVehicle(COMPACT, 32, 0, 20);
  const first = stepVehicle(car, input(1), COMPACT, world);
  expect(first.blocked).toBeNull(); expect(car.pitch).toBeGreaterThan(0); expect(car.pitch).toBeLessThan(0.015);
  expect(run(car, 60, input(1), world).blocked).toBeNull();
  expect(car.pitch).toBeGreaterThan(0.025);
  expect(run(car, 15, input(0, 0.4), world).blocked).toBeNull();
  expect(car.roll).toBeLessThan(-0.02);
  expect(run(car, 20, input(0, 0, 1), world).blocked).toBeNull();
  expect(car.pitch).toBeLessThan(-0.02);
  run(car, 90, input(0, 0, 1), world);
  expect(Math.abs(car.pitch)).toBeLessThan(0.001); expect(Math.abs(car.roll)).toBeLessThan(0.001);
});

test('legal sloped ground is drivable from rest without reaching outside the swept footprint', () => {
  const { world, hf } = terrain((_x, z) => 0.18 * z);
  const car = createVehicle(COMPACT, 32, hf.heightAt(32, 24), 24);
  expect(run(car, 120, input(0.65), world).blocked).toBeNull();
  expect(car.z).toBeGreaterThan(30);
  expect(car.groundPitch).toBeCloseTo(Math.atan(0.18), 2);
  expect(car.y - car.rideOffset).toBeCloseTo(hf.heightAt(car.x, car.z), 2);
});

test('a high unsupported car falls, lands with suspension compression, and settles; no hovering or tunneling', () => {
  const { world } = terrain(() => 0), car = createVehicle(COMPACT, 32, 8, 32);
  let airborne = false, landed = false, compressed = 0, impact = 0, minimumY = Infinity;
  for (let tick = 0; tick < 120; tick++) {
    const result = stepVehicle(car, input(0, 0, 0, true), COMPACT, world);
    airborne ||= !car.grounded; landed ||= airborne && car.grounded;
    compressed = Math.min(compressed, car.rideOffset); impact = Math.max(impact, result.impactSpeed); minimumY = Math.min(minimumY, car.y);
  }
  expect(airborne).toBe(true); expect(landed).toBe(true); expect(impact).toBeGreaterThan(10);
  expect(compressed).toBeLessThan(-0.03); expect(minimumY).toBeGreaterThan(-COMPACT.clearance);
  expect(car.grounded).toBe(true); expect(Math.abs(car.y)).toBeLessThan(0.005); expect(Math.abs(car.vy)).toBeLessThan(0.01);
});

test('persistent steering against a thin wall cannot tunnel; replay includes yaw and suspension rates', () => {
  const { world, structs } = terrain(() => 0);
  structs.add(1, 32, 2, 42, 0, 0, 100);
  const car = createVehicle(COMPACT, 32, 0, 30);
  let blocked = false;
  for (let tick = 0; tick < 120; tick++) { const result = stepVehicle(car, input(1, 0.12), COMPACT, world); blocked ||= result.blocked !== null; }
  expect(blocked).toBe(true); expect(car.z).toBeLessThan(40.2);
  const a = createVehicle(COMPACT, 32, 2, 24), b = structuredClone(a);
  for (let tick = 0; tick < 180; tick++) {
    const command = input(tick < 140 ? 0.6 : 0, tick % 60 < 30 ? 0.25 : -0.25, 0, tick >= 65 && tick < 73);
    stepVehicle(a, command, COMPACT, world); stepVehicle(b, command, COMPACT, world);
  }
  expect(b).toEqual(a);
});

// These use the actual terrain/structure collision adapter, not an always-clear world.
test('a ramp crest permits takeoff and landing, while a nose-up wall impact still falls safely', () => {
  const { world } = terrain((_x, z) => z < 30 ? 0 : z < 40 ? (z - 30) * 0.2 : z < 43 ? 2 : z < 44 ? (44 - z) * 2 : 0);
  const car = createVehicle(COMPACT, 32, 0, 22); car.vz = 12;
  let airborne = false, landed = false, blocked: string | null = null;
  for (let tick = 0; tick < 120; tick++) {
    const result = stepVehicle(car, input(0.4), COMPACT, world);
    blocked ??= result.blocked; airborne ||= !car.grounded; landed ||= airborne && car.grounded;
  }
  expect(blocked).toBeNull(); expect(airborne).toBe(true); expect(landed).toBe(true);
  expect(car.z).toBeGreaterThan(55); expect(car.grounded).toBe(true); expect(Math.abs(car.y)).toBeLessThan(0.01);
  const barrier = terrain(() => 0); barrier.structs.add(1, 32, 2, 42, 0, 0, 100);
  const falling = createVehicle(COMPACT, 32, 3, 35); falling.vz = 20; falling.pitch = 0.5; falling.roll = 0.2;
  expect(run(falling, 120, input(0, 0, 0, true), barrier.world).blocked).not.toBeNull();
  expect(falling.z).toBeLessThan(40); expect(falling.grounded).toBe(true);
  expect(Math.abs(falling.y)).toBeLessThan(0.01); expect(Math.abs(falling.vy)).toBeLessThan(0.01);
});
