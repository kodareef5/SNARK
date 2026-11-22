import { expect, test } from 'bun:test';
import { ASPHALT, COMPACT, COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { Body } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { createVehicle, stepVehicle } from '../../shared/sim/vehicle.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';
import { box, StaticVehicleSolids } from '../../shared/world/vehicle-solid.ts';

function world(height: (x: number, z: number) => number, half: [number, number, number] = [.1, 2, .1]) {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 1, -16, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, height(x, z));
  const structs = new StructureStore(dims, new Float32Array([0, half[0]]), new Float32Array([0, half[1]]), new Float32Array([0, half[2]]));
  return { world: new StaticVehicleWorld({ hf, structs }, () => ASPHALT), structs };
}
const coast = { throttle: 0, steer: 0, brake: 0, handbrake: false, neutral: true };

test('a swept bounding-box corner outside the chamfered car is clear', () => {
  const { world: w, structs } = world(() => 0);
  structs.add(1, 33.7, 2, 30.3, 0, 0, 100);
  const from = createVehicle(COMPACT, 29, 0, 32, Math.PI / 4), to = { ...from, x: 32 };
  expect(w.blocked(from, to, COMPACT)).toBeNull();
});

test('an initial overlap can escape its original face but cannot cross that obstacle or another one', () => {
  const { world: w, structs } = world(() => 0);
  structs.add(1, 50, 2, 48.3, 0, 0, 100);
  const from = createVehicle(COMPACT, 50, 0, 50);
  expect(w.blocked(from, { ...from, z: 50.2 }, COMPACT)).toBeNull();
  expect(w.blocked(from, { ...from, z: 45 }, COMPACT)).toStartWith('structure:');
  structs.add(1, 50, 2, 52.5, 0, 0, 100);
  expect(w.blocked(from, { ...from, z: 51 }, COMPACT)).toStartWith('structure:');
});

test('a glancing wall contact retains tangent speed and reports only normal closing speed', () => {
  const { world: w, structs } = world(() => 0, [.05, 3, 30]);
  structs.add(1, 50, 3, 60, 0, 0, 100);
  const car = createVehicle(COMPACT, 48.95, 0, 50); car.vx = 4; car.vz = 20;
  const hit = stepVehicle(car, coast, COMPACT, w);
  expect(hit.blocked).toStartWith('structure:');
  expect(hit.impactSpeed).toBeGreaterThan(2); expect(hit.impactSpeed).toBeLessThan(4.01);
  expect(car.vz).toBeGreaterThan(19); expect(Math.abs(car.vx)).toBeLessThan(.3);
  expect(car.z).toBeGreaterThan(50 + 20 / 30 * .8);
});

test('resting and separating contacts report no fresh impact', () => {
  const { world: w } = world(() => 0);
  w.contact = () => ({ reason: 'structure:0', nx: -1, ny: 0, nz: 0 });
  for (const vx of [0, -4]) {
    const car = createVehicle(COMPACT, 48, 0, 50); car.vx = vx; car.vz = 20;
    expect(stepVehicle(car, coast, COMPACT, w).impactSpeed).toBe(0);
  }
});

test('a car leaving a terrain ledge at thirty degrees falls instead of hanging beside the edge', () => {
  const { world: w } = world((_x, z) => z <= 60 ? 3 : 0);
  const car = createVehicle(COMPACT, 40, 3, 52, Math.PI / 3); car.vx = 5 * Math.sin(car.yaw); car.vz = 5 * Math.cos(car.yaw);
  let left = -1, landed = -1;
  for (let tick = 0; tick < 150; tick++) {
    stepVehicle(car, { ...coast, throttle: .3, neutral: false }, COMPACT, w);
    if (!car.grounded && left < 0) left = tick;
    if (left >= 0 && car.grounded && car.y < .1) { landed = tick; break; }
  }
  expect(left).toBeGreaterThanOrEqual(0); expect(landed).toBeGreaterThan(left);
  expect(landed - left).toBeLessThan(60); expect(car.z).toBeGreaterThan(61);
});


test('a car held into a wall engages reverse and travels away through the rounded Body path', () => {
  for (const held of [30, 60, 120]) {
    const { world: w, structs } = world(() => 0, [.2, 1.5, 6]); structs.add(1, 40, 1.5, 40, 0, 0, 100);
    const body = new Body(); body.vehicle = true; body.fuel = 40; body.x = 32; body.z = 38;
    body.vehicleYaw = Math.PI / 2; body.vehicleQy = body.vehicleQw = Math.SQRT1_2;
    for (let tick = 0; tick < 90 + held; tick++) stepVehicleBody(w.world, body, 0, 127, 0, COMPACT_VEHICLE);
    const pinned = body.x; expect(pinned).toBeLessThan(37.85); expect(Math.abs(body.vx)).toBeLessThan(.025);
    let reversed = -1;
    for (let tick = 0; tick < 120; tick++) {
      stepVehicleBody(w.world, body, 0, -127, 0, COMPACT_VEHICLE);
      if (reversed < 0 && body.vehicleGear === -1) reversed = tick;
    }
    expect(reversed).toBeGreaterThanOrEqual(0); expect(reversed).toBeLessThan(15);
    expect(pinned - body.x).toBeGreaterThan(3);
  }
});

test('steady wall pressure bounds contact work and cannot accumulate hidden inward speed', () => {
  const { world: w, structs } = world(() => 0, [.2, 1.5, 6]); structs.add(1, 40, 1.5, 40, 0, 0, 100);
  const car = createVehicle(COMPACT, 37.8, 0, 38, Math.PI / 2), throttle = { ...coast, throttle: 1, neutral: false };
  for (let tick = 0; tick < 90; tick++) stepVehicle(car, throttle, COMPACT, w);
  const contact = w.contact.bind(w); let queries = 0;
  w.contact = (...args) => { queries++; return contact(...args); };
  const before = car.x;
  for (let tick = 0; tick < 60; tick++) stepVehicle(car, throttle, COMPACT, w);
  expect(Math.abs(car.x - before)).toBeLessThan(.02); expect(Math.abs(car.vx)).toBeLessThan(.025);
  expect(queries / 60).toBeLessThan(24); expect(w.penetration(car, COMPACT)?.depth ?? 0).toBeLessThan(.002);
});

test('symmetric heightfield waves cannot create a preferred lateral steering direction', () => {
  for (const [axis, sign] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]] as const) {
    const wave = (x: number, z: number) => .4 * Math.sin((axis === 'z' ? z : x) * Math.PI / 8);
    const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 1, -16, 1 / 256);
    for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, wave(x, z));
    const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
    const adapter = new StaticVehicleWorld({ hf, structs }, () => ASPHALT), start = sign > 0 ? 10 : 246;
    const x = axis === 'x' ? start : 128, z = axis === 'z' ? start : 128, yaw = axis === 'z' ? sign > 0 ? 0 : Math.PI : sign * Math.PI / 2;
    const car = createVehicle(COMPACT, x, wave(x, z), z, yaw); car.vx = axis === 'x' ? sign * 30 : 0; car.vz = axis === 'z' ? sign * 30 : 0;
    for (let tick = 0; tick < 150; tick++) stepVehicle(car, { ...coast, throttle: 30 / COMPACT.maxForward * .62, neutral: false }, COMPACT, adapter);
    expect(Math.abs(axis === 'z' ? car.x - x : car.z - z)).toBeLessThan(.01);
    expect(Math.abs(axis === 'z' ? car.z - z : car.x - x)).toBeGreaterThan(90);
  }
});

test('terrain preserves every blocking compound hazard without retaining a clear hazard from another query', () => {
  const { world: w } = world(() => 0), solids = new StaticVehicleSolids(w.world);
  const hull = box([0, 0, 0], [1, .5, 1]), hazard = { ...box([0, .3, 0], [.2, .5, .2]), hazard: true };
  const clearHazard = { ...box([0, 2, 0], [.2, .5, .2]), hazard: true };
  const at = { x: 64, y: 0, z: 64, qx: 0, qy: 0, qz: 0, qw: 1 };
  expect(solids.blocked(at, at, [hull, hazard])?.hazard).toBe(true);
  expect(solids.blocked(at, at, [hazard, hull])?.hazard).toBe(true);
  expect(solids.blocked(at, at, [hull, clearHazard])?.hazard).toBe(false);
});

test('quarter-metre and five-sixteenths bridge deck rises retain useful speed and clear twelve pieces', () => {
  for (const rise of [.25, .3125]) for (const direction of [1, -1]) {
    const { world: w, structs } = world(() => 0, [6, .5, 1.75]), length = 3.5, count = 12;
    const top = (i: number) => 1 + (direction > 0 ? i : count - 1 - i) * rise;
    for (let i = 0; i < count; i++) structs.add(1, 64, top(i) - .5, 40 + length / 2 + i * length, 0, 0, 100);
    const car = createVehicle(COMPACT, 64, top(0), 41); car.vz = 15; let minimum = Infinity;
    for (let tick = 0; tick < 150; tick++) {
      stepVehicle(car, { ...coast, throttle: .5, neutral: false }, COMPACT, w);
      if (car.z < 40 + count * length - 2) minimum = Math.min(minimum, Math.hypot(car.vx, car.vz));
    }
    expect(minimum / 15).toBeGreaterThan(rise === .25 ? .6 : .3);
    expect(car.z).toBeGreaterThan(40 + count * length);
  }
});

test('high-speed legacy stepped decks dissipate supported pitch without overturning or trapping the car', () => {
  for (const rise of [.25, .3125]) for (const length of [2.5, 3.5]) for (const speed of [20, 25]) for (const throttle of [.5, 1]) {
    const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 1, -16, 1 / 256);
    for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, 0);
    const structs = new StructureStore(dims, new Float32Array([0, 3, 3]), new Float32Array([0, .5, .5]), new Float32Array([0, length / 2, 10]));
    structs.add(2, 64, .5, 30, 0, 0, 100);
    for (let i = 0; i < 12; i++) structs.add(1, 64, .5 + i * rise, 40 + length / 2 + i * length, 0, 0, 100);
    const w = new StaticVehicleWorld({ hf, structs }, () => ASPHALT), car = createVehicle(COMPACT, 64, 1, 26); car.vz = speed;
    const end = 40 + 10.5 * length; let lowestUp = 1, minimum = Infinity;
    for (let tick = 0; tick < 300 && car.z < end; tick++) {
      stepVehicle(car, { ...coast, throttle, neutral: false }, COMPACT, w);
      lowestUp = Math.min(lowestUp, 1 - 2 * (car.qx! ** 2 + car.qz! ** 2));
      if (car.z > 40 + length * 1.2) minimum = Math.min(minimum, Math.hypot(car.vx, car.vz));
    }
    expect(car.z).toBeGreaterThanOrEqual(end); expect(lowestUp).toBeGreaterThan(.5);
    expect(minimum / speed).toBeGreaterThan(.35); expect(Math.abs(car.x - 64)).toBeLessThan(.1);
  }
});

test('splitting a coplanar deck across the bumper preserves its contact centre and straight crossing', () => {
  const contacts: number[][] = [], outcomes: number[][] = [];
  for (const split of [false, true]) {
    const { world: w, structs } = world(() => 0, [split ? 2 : 4, .15, 10]);
    if (split) {
      structs.add(1, 62.6, .15, 80, 0, 0, 100); structs.add(1, 66.6, .15, 80, 0, 0, 100);
    } else structs.add(1, 64.6, .15, 80, 0, 0, 100);
    const start = createVehicle(COMPACT, 64, 0, 68), hit = w.contact(start, { ...start, z: 68.4 }, COMPACT);
    expect(hit).not.toBeNull(); contacts.push([hit!.x!, hit!.y!, hit!.z!, hit!.nx, hit!.ny, hit!.nz]);
    const car = createVehicle(COMPACT, 64, 0, 58); car.vz = 20;
    let minUp = 1;
    for (let tick = 0; tick < 60; tick++) { stepVehicle(car, { ...coast, throttle: 1, neutral: false }, COMPACT, w); minUp = Math.min(minUp, 1 - 2 * (car.qx! ** 2 + car.qz! ** 2)); }
    expect(minUp).toBeGreaterThan(.8); expect(Math.abs(car.x - 64)).toBeLessThan(.05);
    outcomes.push([car.x, car.y, car.z]);
  }
  contacts[0]!.forEach((value, i) => expect(contacts[1]![i]).toBeCloseTo(value, 3));
  outcomes[0]!.forEach((value, i) => expect(outcomes[1]![i]).toBeCloseTo(value, 1));
});

test('separate coplanar support islands do not create a contact in the empty space between them', () => {
  const { world: w } = world(() => 0), dims = w.world.hf.dims;
  const structs = new StructureStore(dims, new Float32Array([0, .1, .8]), new Float32Array([0, .075, .075]), new Float32Array([0, .2, .2]));
  structs.add(1, 63.2, .075, 70.5, 0, 0, 100); structs.add(2, 64.1, .075, 69.5, 0, 0, 100);
  const environment = new StaticVehicleWorld({ hf: w.world.hf, structs }), car = createVehicle(COMPACT, 64, 0, 70);
  const hit = environment.contact(car, car, COMPACT);
  expect(hit).not.toBeNull(); expect(hit!.ny).toBeGreaterThan(.99);
  expect(hit!.x!).toBeLessThan(63.31); expect(hit!.z!).toBeGreaterThan(70.29);
});
