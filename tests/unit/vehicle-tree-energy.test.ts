import { expect, test } from "bun:test";
import { COMPACT } from "../../content/vehicles/compact.ts";
import { createVehicle, type VehicleState } from "../../shared/sim/vehicle.ts";
import { vehicleMassProperties } from "../../shared/sim/vehicle-rigid.ts";
import { TreeFracture } from "../../shared/sim/vehicle-tree.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), forms = nodeForms(reg), fracture = new TreeFracture(reg, forms);
const form = fracture.work.findIndex(work => work > 10000 && work < 100000);
const hit = { reason: "node:0", nx: 0, ny: 0, nz: -1, x: .7, y: .7, z: 1.8 };
const energy = (s: VehicleState): number => {
  const p = vehicleMassProperties(COMPACT, s);
  return .5 * (p.mass * (s.vx ** 2 + s.vy ** 2 + s.vz ** 2) + p.ix * s.pitchRate ** 2 + p.iy * s.yawRate ** 2 + p.iz * s.rollRate ** 2);
};

test("off-centre fracture removes exactly its work from translation plus rotation and preserves tangent momentum", () => {
  const car = createVehicle(COMPACT, 0, 0, 0); car.vx = 12; car.vz = 34; car.yawRate = 2; car.rollRate = .4;
  const before = energy(car), tangent = car.vx, spin = car.yawRate, impulse = fracture.impulse(car, COMPACT, hit, form);
  expect(Number.isFinite(impulse)).toBe(true); const absorbed = fracture.apply(car, COMPACT, hit, form, impulse);
  expect(before - energy(car)).toBeCloseTo(fracture.work[form]!, 5);
  expect(car.vx).toBe(tangent); expect(car.yawRate).not.toBe(spin); expect(car.vz).toBeLessThan(34);
  expect(absorbed).toBeGreaterThan(0); expect(Number.isFinite(energy(car))).toBe(true);
});

test("huge tangential speed, separation, harvested stumps and stone cannot masquerade as a tree-fracturing impact", () => {
  const car = createVehicle(COMPACT, 0, 0, 0); car.vx = 120; car.vz = 2;
  expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, form))).toBe(true);
  car.vz = -34; expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, form))).toBe(true);
  car.vz = 34;
  expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, forms.left[form]!))).toBe(true);
  expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, forms.first[reg.index.get("core:rock")!]!))).toBe(true);
});
