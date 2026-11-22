import { expect, test } from 'bun:test';
import { CORE_CONTENT } from '../../content/core.ts';
import { compileContent } from '../../shared/content/registry.ts';
import { ASPHALT, COMPACT } from '../../content/vehicles/compact.ts';
import { quatRotate } from '../../shared/math/quat.ts';
import { createVehicle, stepVehicle, type VehicleSurface } from '../../shared/sim/vehicle.ts';
import { vehicleRotation } from '../../shared/sim/vehicle-frame.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';

const coast = { throttle: 0, steer: 0, brake: 0, handbrake: false, neutral: true };
function native(height: (x: number, z: number) => number, surface: VehicleSurface = ASPHALT) {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 1, -128, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, height(x, z));
  const structs = new StructureStore(dims, new Float32Array([0, 90]), new Float32Array([0, .075]), new Float32Array([0, 90]));
  return { hf, structs, world: new StaticVehicleWorld({ hf, structs }, () => surface) };
}
function attitude(s: ReturnType<typeof createVehicle>, pitch: number, roll = 0) {
  const q = new Float64Array(4); vehicleRotation({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch, roll }, q);
  [s.qx, s.qy, s.qz, s.qw] = [q[0]!, q[1]!, q[2]!, q[3]!];
}

test('a fifteen-centimetre kerb is crossed straight and obliquely at five, fifteen and thirty metres per second', () => {
  const { world, structs } = native(() => 0); structs.add(1, 100, .075, 130, 0, 0, 100);
  for (const yaw of [0, Math.PI / 6]) for (const speed of [5, 15, 30]) {
    const car = createVehicle(COMPACT, 64, 0, 32, yaw); car.vx = speed * Math.sin(yaw); car.vz = speed * Math.cos(yaw);
    let crossingSpeed = Infinity;
    for (let tick = 0; tick < 120; tick++) {
      stepVehicle(car, { ...coast, throttle: .3, neutral: false }, COMPACT, world);
      if (car.z > 37 && car.z < 45) crossingSpeed = Math.min(crossingSpeed, Math.hypot(car.vx, car.vz));
    }
    expect(car.z).toBeGreaterThan(50); expect(car.y).toBeCloseTo(.15, 2);
    if (speed === 15) expect(crossingSpeed).toBeGreaterThan(speed * .7);
  }
});

test('gravity acts along a frictionless fifteen-degree slope, while the parking brake holds a twenty-five-degree road', () => {
  const angle = Math.PI / 12, { hf, world } = native((_x, z) => Math.tan(angle) * z, { id: 'frictionless', grip: 0, rolling: 0, drag: 0 });
  const car = createVehicle(COMPACT, 64, hf.heightAt(64, 40), 40); attitude(car, angle);
  for (let tick = 0; tick < 30; tick++) stepVehicle(car, coast, COMPACT, world);
  const tangent = car.vz * Math.cos(angle) + car.vy * Math.sin(angle);
  expect(tangent).toBeCloseTo(-COMPACT.gravity! * Math.sin(angle), 1);
  const steep = 25 * Math.PI / 180, road = native((_x, z) => Math.tan(steep) * z);
  const parked = createVehicle(COMPACT, 64, road.hf.heightAt(64, 40), 40); attitude(parked, steep);
  for (let tick = 0; tick < 120; tick++) stepVehicle(parked, { ...coast, handbrake: true }, COMPACT, road.world);
  expect(Math.abs(parked.z - 40)).toBeLessThan(.1); expect(Math.hypot(parked.vx, parked.vy, parked.vz)).toBeLessThan(.05);
});

test('a freely spinning chassis completes a rollover and rests inverted without an upright servo', () => {
  const { world } = native(() => 0), car = createVehicle(COMPACT, 64, 3, 64); car.rollRate = 7;
  const q = new Float64Array(4), up = new Float64Array(3); let inverted = false;
  for (let tick = 0; tick < 240; tick++) {
    stepVehicle(car, coast, COMPACT, world); vehicleRotation(car, q); quatRotate(q, 0, 0, 1, 0, up, 0);
    inverted ||= up[1]! < -.5;
    expect(Math.abs(q[0]! * q[0]! + q[1]! * q[1]! + q[2]! * q[2]! + q[3]! * q[3]! - 1)).toBeLessThan(1e-10);
    expect(Math.max(Math.abs(car.pitchRate), Math.abs(car.yawRate), Math.abs(car.rollRate))).toBeLessThanOrEqual(12);
  }
  expect(inverted).toBe(true); expect(up[1]).toBeLessThan(-.99); expect(car.y).toBeCloseTo(COMPACT.height, 2);
  expect(car.grounded).toBe(true); expect(Math.hypot(car.vx, car.vy, car.vz)).toBeLessThan(.02);
  expect(world.blocked(car, car, COMPACT)).toBeNull();
});

test('uphill and downhill slope landings retain tangent momentum', () => {
  for (const angle of [-20, 20].map(degrees => degrees * Math.PI / 180)) {
    const { world, hf } = native((_x, z) => Math.tan(angle) * (z - 40));
    const car = createVehicle(COMPACT, 64, 3, 40); attitude(car, angle); car.vz = 12 * Math.cos(angle); car.vy = 12 * Math.sin(angle);
    let airborne = false, landed = false;
    for (let tick = 0; tick < 90; tick++) {
      stepVehicle(car, coast, COMPACT, world); airborne ||= !car.grounded;
      if (airborne && car.grounded && car.y - hf.heightAt(car.x, car.z) < .2) {
        landed = true;
        expect(car.vz * Math.cos(angle) + car.vy * Math.sin(angle)).toBeGreaterThan(6);
        break;
      }
    }
    expect(landed).toBe(true);
  }
});


test('the authored six-metre ramp is climbed and its crest launches at five, twelve and twenty metres per second', () => {
  const reg = compileContent(CORE_CONTENT).registry!;
  for (const speed of [5, 12, 20]) {
    const { hf } = native(() => 0), structs = new StructureStore({ chunksX: 4, chunksZ: 4 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    // The real sloped slab rises two metres; its authored low surface is at local y=-.8.
    structs.add(reg.index.get('core:zslope_ramp')!, 64, .8, 43, 0, 0, 100);
    const world = new StaticVehicleWorld({ hf, structs }, () => ASPHALT), car = createVehicle(COMPACT, 64, 0, 37); car.vz = speed;
    let top = 0, left = -1, landed = -1;
    for (let tick = 0; tick < 180; tick++) {
      stepVehicle(car, { ...coast, throttle: 1, neutral: false }, COMPACT, world); top = Math.max(top, car.y);
      if (car.z > 47 && !car.grounded && left < 0) left = tick;
      if (left >= 0 && car.grounded && car.z > 49 && Math.abs(car.vy) < .5) { landed = tick; break; }
    }
    expect(top).toBeGreaterThan(2); expect(left).toBeGreaterThanOrEqual(0);
    expect(landed).toBeGreaterThan(left); expect(landed - left).toBeLessThan(60);
    expect(world.blocked(car, car, COMPACT)).toBeNull();
  }
});

test('fifteen and thirty centimetre deck edges descend without hanging, including continuous suspension support', () => {
  for (const height of [.15, .3]) {
    const { hf } = native(() => 0);
    const structs = new StructureStore({ chunksX: 4, chunksZ: 4 }, new Float32Array([0, 30]), new Float32Array([0, height / 2]), new Float32Array([0, 20]));
    structs.add(1, 64, height / 2, 40, 0, 0, 100);
    const world = new StaticVehicleWorld({ hf, structs }, () => ASPHALT), car = createVehicle(COMPACT, 64, height, 52, Math.PI / 6);
    car.vx = 10 * Math.sin(car.yaw); car.vz = 10 * Math.cos(car.yaw);
    for (let tick = 0; tick < 90; tick++) stepVehicle(car, { ...coast, throttle: .3, neutral: false }, COMPACT, world);
    expect(car.z).toBeGreaterThan(70); expect(Math.abs(car.y)).toBeLessThan(.02);
    expect(car.grounded).toBe(true); expect(Math.hypot(car.vx, car.vz)).toBeGreaterThan(8);
    expect(world.blocked(car, car, COMPACT)).toBeNull();
  }
});

test('ordinary kerbs and wheel landings report support closing separately from wall impacts', () => {
  const { world, structs } = native(() => 0); structs.add(1, 100, .075, 130, 0, 0, 100);
  for (const speed of [2, 5, 15, 30]) {
    const car = createVehicle(COMPACT, 64, 0, 32); car.vz = speed;
    let wall = 0, landing = 0;
    for (let tick = 0; tick < 120; tick++) {
      const hit = stepVehicle(car, { ...coast, throttle: .3, neutral: false }, COMPACT, world);
      wall = Math.max(wall, hit.impactSpeed); landing = Math.max(landing, hit.landSpeed);
    }
    expect(car.z).toBeGreaterThan(50); expect(wall).toBe(0); expect(landing).toBeLessThan(12);
  }
  const flat = native(() => 0);
  for (const height of [1, 3, 8]) {
    const car = createVehicle(COMPACT, 64, height, 64); let wall = 0, landing = 0;
    for (let tick = 0; tick < 120; tick++) {
      const hit = stepVehicle(car, { ...coast, handbrake: true }, COMPACT, flat.world);
      wall = Math.max(wall, hit.impactSpeed); landing = Math.max(landing, hit.landSpeed);
    }
    expect(wall).toBe(0); expect(landing).toBeGreaterThan(4);
    if (height < 4) expect(landing).toBeLessThan(12); else expect(landing).toBeGreaterThan(12);
  }
});
