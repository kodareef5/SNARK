import { expect, test } from "bun:test";
import { COMPACT } from "../../content/vehicles/compact.ts";
import { createVehicle, type VehicleState, type VehicleContact } from "../../shared/sim/vehicle.ts";
import { vehicleMassProperties, vehiclePointInverseMass } from "../../shared/sim/vehicle-rigid.ts";
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

test("off-centre fracture spends wood work plus deformation and reports its exact energy loss without losing tangent momentum", () => {
  const car = createVehicle(COMPACT, 0, 0, 0); car.vx = 12; car.vz = 34; car.yawRate = 2; car.rollRate = .4;
  const before = energy(car), tangent = car.vx, spin = car.yawRate, impulse = fracture.impulse(car, COMPACT, hit, form);
  expect(Number.isFinite(impulse)).toBe(true); const absorbed = fracture.apply(car, COMPACT, hit, form, impulse);
  const lost = before - energy(car);
  expect(lost).toBeGreaterThan(fracture.work[form]!); expect(lost).toBeLessThan(before);
  const inverse = vehiclePointInverseMass(car, COMPACT, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
  expect(absorbed * absorbed).toBeCloseTo(2 * lost * inverse, 8);
  expect(car.vx).toBe(tangent); expect(car.yawRate).not.toBe(spin); expect(car.vz).toBeLessThan(34);
  expect(absorbed).toBeGreaterThan(0); expect(Number.isFinite(energy(car))).toBe(true);
});

test("huge tangential speed, separation and stone resist while the short harvested stump needs less fracture work", () => {
  const car = createVehicle(COMPACT, 0, 0, 0); car.vx = 120; car.vz = 2;
  expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, form))).toBe(true);
  car.vz = -34; expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, form))).toBe(true);
  car.vz = 34;
  expect(Number.isFinite(fracture.impulse(car, COMPACT, hit, forms.left[form]!))).toBe(true);
  expect(fracture.work[forms.left[form]!]!).toBeLessThan(fracture.work[form]!);
  expect(Number.isNaN(fracture.impulse(car, COMPACT, hit, forms.first[reg.index.get("core:rock")!]!))).toBe(true);
});

for (const [name, x, tangent] of [["central", 0, 0], ["corner", .85, 0], ["glancing", .85, 20]] as const) {
  test(`${name} wood contact crosses its energy threshold continuously and increasing speed cannot lower absorbed impact`, () => {
    const contact: VehicleContact = { ...hit, x, y: COMPACT.height * .35 };
    const seed = createVehicle(COMPACT, 0, 0, 0);
    const inverse = vehiclePointInverseMass(seed, COMPACT, contact.x!, contact.y!, contact.z!, 0, 0, -1);
    const threshold = Math.sqrt(2 * fracture.work[form]! * inverse);
    let absorbedBefore = 0;
    for (const extra of [-.001, .001, .1, 1, 3, 10]) {
      const car = createVehicle(COMPACT, 0, 0, 0); car.vx = tangent; car.vz = threshold + extra;
      const impulse = fracture.impulse(car, COMPACT, contact, form);
      if (extra < 0) {
        expect(Number.isNaN(impulse)).toBe(true); expect(contact.restitution ?? 0).toBeLessThan(.000001); absorbedBefore = car.vz; continue;
      }
      const before = energy(car), absorbed = fracture.apply(car, COMPACT, contact, form, impulse), after = energy(car);
      expect(Number.isFinite(impulse)).toBe(true); expect(absorbed).toBeGreaterThanOrEqual(absorbedBefore); absorbedBefore = absorbed;
      expect(after).toBeLessThan(before); expect(car.vx).toBe(tangent);
      if (extra === .001) expect(threshold + extra - impulse * inverse).toBeLessThan(threshold * .02);
      expect(Number.isFinite(car.yawRate)).toBe(true);
    }
  });
}

test("the tree-only cargo cap preserves actual momentum while extra inventory cannot buy a lower fracture threshold", () => {
  const contact = { ...hit, x: 0, y: COMPACT.height * .35 };
  const curb = COMPACT.mass!;
  const threshold = Math.sqrt(2 * fracture.work[form]! / (curb * 1.5));
  for (const payload of [curb * .5, 5000, 19000]) {
    const car = createVehicle(COMPACT, 0, 0, 0); car.payloadMass = payload; car.vz = threshold - .001;
    expect(Number.isNaN(fracture.impulse(car, COMPACT, contact, form))).toBe(true);
    car.vz = threshold + 3; const before = energy(car), inverse = vehiclePointInverseMass(car, COMPACT, contact.x!, contact.y!, contact.z!, 0, 0, -1);
    const impulse = fracture.impulse(car, COMPACT, contact, form); fracture.apply(car, COMPACT, contact, form, impulse);
    expect(car.vz).toBeCloseTo(threshold + 3 - impulse * inverse, 8); expect(energy(car)).toBeLessThan(before);
    expect(vehicleMassProperties(COMPACT, car).mass).toBe(curb + payload);
  }
});
