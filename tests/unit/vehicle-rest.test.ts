import { expect, test } from 'bun:test';
import { COMPACT, COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { Body, BTN_JUMP } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { vehicleRotation } from '../../shared/sim/vehicle-frame.ts';
import { createVehicle, stepVehicle } from '../../shared/sim/vehicle.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';

function road(angle: number, cross: boolean) {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 1, -64, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, Math.tan(angle) * ((cross ? x : z) - 64));
  const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
  return { hf, structs };
}
function body(angle: number, cross: boolean) {
  const b = new Body(), q = new Float64Array(4); b.vehicle = true; b.x = b.z = 64; b.fuel = COMPACT.fuelCapacity;
  vehicleRotation({ x: 64, y: 0, z: 64, yaw: 0, pitch: cross ? 0 : angle, roll: cross ? angle : 0 }, q);
  [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return b;
}
// This is Urban's actual sleep eligibility, including f32 Body storage and spring/angular quietness.
function rests(b: Body) {
  return b.grounded && b.vx === 0 && b.vz === 0 &&
    [b.vy, b.vehiclePitchRate, b.vehicleYawRate, b.vehicleRollRate, b.vehicleRideVelocity].every(n => Math.abs(n) < .001);
}

test('parked rounded Bodies hold cross and longitudinal slopes for sixty seconds and qualify for sleep', () => {
  for (const degrees of [2, 5, 10, 15, 25]) for (const cross of [false, true]) {
    const angle = degrees * Math.PI / 180, world = road(angle, cross), b = body(angle, cross);
    let quiet = 0;
    for (let tick = 0; tick < 1800; tick++) {
      stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
      if (rests(b)) quiet++;
    }
    expect(Math.hypot(b.x - 64, b.z - 64)).toBeLessThan(.08);
    expect(quiet).toBeGreaterThan(1700); expect(rests(b)).toBe(true);
  }
});

test('parking rest wakes when brakes are released or supporting terrain disappears', () => {
  const angle = 10 * Math.PI / 180, world = road(angle, true), b = body(angle, true);
  for (let tick = 0; tick < 120; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
  expect(rests(b)).toBe(true);
  b.vz = 2;
  for (let tick = 0; tick < 30; tick++) stepVehicleBody(world, b, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, false);
  expect(b.z - 64).toBeGreaterThan(1);
  const flat = road(0, false), dropped = body(0, false);
  stepVehicleBody(flat, dropped, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
  expect(rests(dropped)).toBe(true);
  for (let z = 0; z < flat.hf.nz; z++) for (let x = 0; x < flat.hf.nx; x++) flat.hf.setSample(x, z, -3);
  // Urban's idle heartbeat still calls the solver at least once per thirty ticks.
  stepVehicleBody(flat, dropped, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
  expect(dropped.grounded).toBe(false); expect(dropped.vy).toBeLessThan(-.5); expect(rests(dropped)).toBe(false);
});

test('a handbrake cannot hold a slope without surface friction', () => {
  const angle = 10 * Math.PI / 180, terrain = road(angle, true), q = new Float64Array(4);
  const world = new StaticVehicleWorld(terrain, () => ({ id: 'ice', grip: 0, rolling: 0, drag: 0 }));
  const car = createVehicle(COMPACT, 64, 0, 64); vehicleRotation({ ...car, qx: undefined, qy: undefined, qz: undefined, qw: undefined, roll: angle }, q);
  [car.qx, car.qy, car.qz, car.qw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  for (let tick = 0; tick < 60; tick++) stepVehicle(car, { throttle: 0, steer: 0, brake: 0, handbrake: true, pilot: false }, COMPACT, world);
  expect(64 - car.x).toBeGreaterThan(3); expect(car.vx).toBeLessThan(-3);
});

test('a parked car arrests a real shove on fifteen and twenty degree cross slopes', () => {
  for (const degrees of [15, 20]) for (const shove of [1, 2, 4]) {
    const angle = degrees * Math.PI / 180, world = road(angle, true), b = body(angle, true);
    for (let tick = 0; tick < 90; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    b.vx = -shove; const x = b.x, z = b.z;
    for (let tick = 0; tick < 300; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(1.5); expect(rests(b)).toBe(true);
  }
});

test('neighbouring roof and side drop poses sleep on the real quantized hillside', () => {
  for (const [roll, yaw] of [[Math.PI, 0], [Math.PI, Math.PI / 12], [-Math.PI / 2, Math.PI / 6]]) {
    const angle = 5 * Math.PI / 180, world = road(angle, false), b = body(0, false), q = new Float64Array(4);
    b.x = 32; b.z = 40; b.y = 3 + Math.tan(angle) * (b.z - 64);
    vehicleRotation({ x: b.x, y: b.y, z: b.z, yaw: yaw!, pitch: 0, roll: roll! }, q);
    [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
    for (let tick = 0; tick < 120; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    let path = 0, quiet = 0;
    for (let tick = 0; tick < 1800; tick++) {
      const x = b.x, y = b.y, z = b.z;
      stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
      path += Math.hypot(b.x - x, b.y - y, b.z - z); if (rests(b)) quiet++;
    }
    expect(path).toBeLessThan(.03); expect(quiet).toBeGreaterThan(1750);
  }
});

test('a fully flooded overturned car rests on the real bed and wakes when pushed', () => {
  for (const roll of [Math.PI / 2, Math.PI]) {
    const world = road(0, false), b = body(0, false), q = new Float64Array(4); world.hf.seaLevel = 3;
    b.y = 3; b.vehicleFlooding = 1; b.vehicleEngineCondition = 0;
    vehicleRotation({ x: b.x, y: b.y, z: b.z, yaw: .2, pitch: 0, roll }, q);
    [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
    for (let tick = 0; tick < 300; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    expect(rests(b)).toBe(true); const z = b.z; b.vz = 1;
    for (let tick = 0; tick < 15; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    expect(Math.abs(b.z - z)).toBeGreaterThan(.01);
  }
});

test('oblique side drops keep real contact patches and hull friction while tipping on quantized slopes', () => {
  for (const [degrees, yaw, drop] of [[5, 60, 3], [8, 30, 2.2], [12, 60, 2.2], [20, 30, 2.2], [20, 45, 2.2]]) {
    const world = road(degrees! * Math.PI / 180, false), b = body(0, false), q = new Float64Array(4); b.y = drop!;
    vehicleRotation({ x: b.x, y: b.y, z: b.z, yaw: yaw! * Math.PI / 180, pitch: 0, roll: Math.PI / 2 }, q);
    [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
    for (let tick = 0; tick < 120; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    expect(Math.hypot(b.x - 64, b.z - 64)).toBeLessThan(2); expect(rests(b)).toBe(true);
    const x = b.x, z = b.z;
    for (let tick = 0; tick < 1800; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(.03); expect(rests(b)).toBe(true);
  }
});

test('dropped side and roof Bodies settle on flat and gently sloping terrain and remain asleep for sixty seconds', () => {
  for (const [roll, slope] of [[Math.PI / 2, 0], [Math.PI, 0], [Math.PI / 2, 5 * Math.PI / 180]]) {
    const world = road(slope!, false), b = body(0, false), q = new Float64Array(4); b.y = 3;
    vehicleRotation({ x: b.x, y: b.y, z: b.z, yaw: 0, pitch: 0, roll: roll! }, q);
    [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
    for (let tick = 0; tick < 120; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    let path = 0, quiet = 0;
    for (let tick = 0; tick < 1800; tick++) {
      const x = b.x, y = b.y, z = b.z;
      stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
      path += Math.hypot(b.x - x, b.y - y, b.z - z); if (rests(b)) quiet++;
    }
    expect(path).toBeLessThan(.03); expect(quiet).toBeGreaterThan(1750);
    b.vz = 1; const before = b.z;
    for (let tick = 0; tick < 15; tick++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, COMPACT_VEHICLE, undefined, undefined, false);
    expect(Math.abs(b.z - before)).toBeGreaterThan(.01);
  }
});

test('an overturned overhang cannot sleep with its centre of mass beyond the actual supporting post', () => {
  const world = road(0, false);
  for (let z = 0; z < world.hf.nz; z++) for (let x = 0; x < world.hf.nx; x++) world.hf.setSample(x, z, -4);
  world.structs = new StructureStore(world.hf.dims, new Float32Array([0, .12]), new Float32Array([0, .5]), new Float32Array([0, 1.5]));
  world.structs.add(1, 63.25, .5, 64, 0, 0, 100);
  const car = createVehicle(COMPACT, 64, 2.5, 64), q = new Float64Array(4);
  vehicleRotation({ x: car.x, y: car.y, z: car.z, yaw: 0, pitch: 0, roll: Math.PI }, q);
  [car.qx, car.qy, car.qz, car.qw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const adapter = new StaticVehicleWorld(world);
  expect(adapter.contact(car, { ...car, y: car.y - .01 }, COMPACT)?.balanced).not.toBe(true);
  for (let tick = 0; tick < 90; tick++) stepVehicle(car, { throttle: 0, steer: 0, brake: 0, handbrake: true, pilot: false }, COMPACT, adapter);
  expect(car.y).toBeLessThan(1.5);
});
