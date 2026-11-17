import { expect, test } from 'bun:test';
import { COMPACT, COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { createVehicle } from '../../shared/sim/vehicle.ts';
import { applyVehicleImpulse, integrateVehiclePose, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from '../../shared/sim/vehicle-rigid.ts';
import { vehiclePoint, vehicleRotation } from '../../shared/sim/vehicle-frame.ts';
import { carMeetsCapsule, carMeetsVehicle } from '../../shared/world/vehicle.ts';

function attitude(car: ReturnType<typeof createVehicle>, pitch: number, roll: number) {
  const q = new Float64Array(4); vehicleRotation({ x: car.x, y: car.y, z: car.z, yaw: car.yaw, pitch, roll }, q);
  [car.qx, car.qy, car.qz, car.qw] = [q[0]!, q[1]!, q[2]!, q[3]!];
}

test('world impulse at a rotated car COM translates it without angular impulse', () => {
  const car = createVehicle(COMPACT, 20, 5, 30, .4); attitude(car, .3, 1.2); car.payloadMass = 200;
  const point = new Float64Array(3); vehiclePoint(car, [0, COMPACT.height * .35, 0], point);
  applyVehicleImpulse(car, COMPACT, point[0]!, point[1]!, point[2]!, 1300, 2600, -1300);
  expect(car.vx).toBeCloseTo(1, 10); expect(car.vy).toBeCloseTo(2, 10); expect(car.vz).toBeCloseTo(-1, 10);
  expect(Math.abs(car.pitchRate) + Math.abs(car.yawRate) + Math.abs(car.rollRate)).toBeLessThan(1e-12);
});

test('point inverse mass predicts the actual normal velocity change including angular motion', () => {
  const car = createVehicle(COMPACT, 20, 5, 30, .4); attitude(car, -.2, .6);
  const point = new Float64Array(3), before = new Float64Array(3), after = new Float64Array(3);
  vehiclePoint(car, [.8, .8, 1.8], point);
  vehiclePointVelocity(car, COMPACT, point[0]!, point[1]!, point[2]!, before);
  const inverse = vehiclePointInverseMass(car, COMPACT, point[0]!, point[1]!, point[2]!, 1, 0, 0);
  applyVehicleImpulse(car, COMPACT, point[0]!, point[1]!, point[2]!, 1500, 0, 0);
  vehiclePointVelocity(car, COMPACT, point[0]!, point[1]!, point[2]!, after);
  expect(after[0]! - before[0]!).toBeCloseTo(1500 * inverse, 9);
  expect(Math.abs(car.yawRate) + Math.abs(car.rollRate)).toBeGreaterThan(.1);
});

test('equal and opposite point impulses conserve linear momentum for unequal loaded cars', () => {
  const a = createVehicle(COMPACT, 0, 0, 0), b = createVehicle(COMPACT, 2, 0, 0); b.payloadMass = 400;
  a.vx = 10; b.vx = -2;
  const ma = vehicleMassProperties(COMPACT, a).mass, mb = vehicleMassProperties(COMPACT, b).mass, before = a.vx * ma + b.vx * mb;
  applyVehicleImpulse(a, COMPACT, 1, .6, 1, -4000, 0, 0); applyVehicleImpulse(b, COMPACT, 1, .6, 1, 4000, 0, 0);
  expect(a.vx * ma + b.vx * mb).toBeCloseTo(before, 9);
});

test('free rotation preserves world COM and quaternion norm through an upside-down attitude', () => {
  const car = createVehicle(COMPACT, 20, 5, 30), before = new Float64Array(3), after = new Float64Array(3);
  vehiclePoint(car, [0, COMPACT.height * .35, 0], before); car.rollRate = 2;
  for (let i = 0; i < 200; i++) integrateVehiclePose(car, COMPACT, .01);
  vehiclePoint(car, [0, COMPACT.height * .35, 0], after);
  for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i]!, 9);
  expect(Math.abs(car.roll)).toBeGreaterThan(2);
});

test('car interaction geometry follows its full attitude and places a centred face hit centrally', () => {
  const car = createVehicle(COMPACT, 20, 5, 30); attitude(car, 0, Math.PI / 2);
  expect(carMeetsCapsule(COMPACT, car, 18.9, 4.8, 30, .2, .4)).not.toBeNull();
  expect(carMeetsCapsule(COMPACT, car, 20, 6.2, 30, .1, .3)).toBeNull();
  const a = createVehicle(COMPACT, 20, 0, 30), b = createVehicle(COMPACT, 20, 0, 33.8);
  const hit = carMeetsVehicle(COMPACT, a, COMPACT_VEHICLE, b)!;
  expect(hit.nz).toBeLessThan(-.99); expect(hit.x).toBeCloseTo(20, 9); expect(hit.depth).toBeCloseTo(.2, 8);
});
