import { expect, test } from 'bun:test';
import { ASPHALT, COMPACT } from '../../content/vehicles/compact.ts';
import { createVehicle, stepVehicle } from '../../shared/sim/vehicle.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';

const idle = { throttle: 0, steer: 0, brake: 0, handbrake: false };
function sea(floor = -30) {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -64, 1 / 256);
  hf.heights.fill(Math.round((floor + 64) * 256)); hf.seaLevel = 0;
  const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
  return { hf, world: new StaticVehicleWorld({ hf, structs }, () => ASPHALT) };
}

test('a healthy compact floats about twenty seconds, then loses trapped air and sinks at a bounded terminal rate', () => {
  const { world } = sea(), car = createVehicle(COMPACT, 64, -.75, 64);
  let roofUnder = -1, fastestSink = 0;
  for (let tick = 0; tick < 1200; tick++) {
    stepVehicle(car, idle, COMPACT, world);
    if (roofUnder < 0 && car.y + COMPACT.height < 0) roofUnder = tick / 30;
    if (tick > 90) fastestSink = Math.max(fastestSink, -car.vy);
  }
  expect(roofUnder).toBeGreaterThan(18); expect(roofUnder).toBeLessThan(26);
  expect(fastestSink).toBeLessThanOrEqual(2); expect(car.flooding).toBeGreaterThan(.8);
  expect(car.engineCondition).toBe(0); expect(car.engineOn).toBe(false);
  expect(car.hullCondition).toBe(1);
});

test('a twenty-five metre-per-second water entry loses speed through drag, and a submerged engine cannot power seabed wheels', () => {
  const { world } = sea(), car = createVehicle(COMPACT, 64, .6, 40); car.vz = 25; car.vy = -4;
  for (let tick = 0; tick < 30; tick++) stepVehicle(car, { ...idle, throttle: 1 }, COMPACT, world);
  expect(Math.hypot(car.vx, car.vz)).toBeLessThan(8); expect(car.y).toBeGreaterThan(-2);
  const shallow = sea(-2), drowned = createVehicle(COMPACT, 64, -2, 64), fuel = drowned.fuel;
  for (let tick = 0; tick < 120; tick++) stepVehicle(drowned, { ...idle, throttle: 1 }, COMPACT, shallow.world);
  expect(drowned.engineCondition).toBe(0); expect(drowned.engineOn).toBe(false); expect(drowned.fuel).toBe(fuel);
  expect(Math.abs(drowned.z - 64)).toBeLessThan(.001); expect(Math.abs(drowned.vz)).toBeLessThan(.001);
});

test('engine intake immersion follows inverted attitude, remains broken after recovery, and starts after repair', () => {
  const { world, hf } = sea(), car = createVehicle(COMPACT, 64, .9, 64);
  car.qz = 1; car.qw = 0;
  stepVehicle(car, { ...idle, throttle: 1 }, COMPACT, world);
  expect(car.engineCondition).toBe(0);
  hf.seaLevel = -100; hf.heights.fill(64 * 256); car.y = 0; car.qz = 0; car.qw = 1;
  car.vx = car.vy = car.vz = car.pitchRate = car.yawRate = car.rollRate = 0;
  for (let tick = 0; tick < 60; tick++) stepVehicle(car, { ...idle, throttle: 1 }, COMPACT, world);
  expect(car.engineOn).toBe(false); expect(Math.abs(car.vz)).toBeLessThan(.01);
  car.engineCondition = .25;
  for (let tick = 0; tick < 60; tick++) stepVehicle(car, { ...idle, throttle: 1 }, COMPACT, world);
  expect(car.engineOn).toBe(true); expect(car.vz).toBeGreaterThan(10);
});

test('load and hull damage shorten the float, and restored flooding continues instead of resetting', () => {
  const { world } = sea();
  for (const damaged of [false, true]) {
    const car = createVehicle(COMPACT, 64, -.75, 64); if (damaged) car.hullCondition = .3; else car.payloadMass = 400;
    let under = -1;
    for (let tick = 0; tick < 450; tick++) {
      stepVehicle(car, idle, COMPACT, world);
      if (car.y + COMPACT.height < 0) { under = tick / 30; break; }
    }
    expect(under).toBeGreaterThan(0); expect(under).toBeLessThan(12);
    const restored = structuredClone(car), before = restored.flooding;
    for (let tick = 0; tick < 60; tick++) { stepVehicle(car, idle, COMPACT, world); stepVehicle(restored, idle, COMPACT, world); }
    expect(restored).toEqual(car); expect(restored.flooding).toBeGreaterThan(before);
  }
});
