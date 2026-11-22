import { expect, test } from "bun:test";
import { BOAT_VEHICLE as def } from "../../content/vehicles/boat.ts";
import { rayVehicle, useVehicle } from "../../shared/sim/vehicle-frame.ts";

test("boat combat rays and name tags hit actual rigid parts rather than filling the open cockpit", () => {
  expect(rayVehicle(def, 0, 0, 0, 0, 4, .4, 0, -1, 0, 0, def.spec.height)).toBeCloseTo(2.7, 5);
  expect(rayVehicle(def, 0, 0, 0, 0, 4, 1.6, 0, -1, 0, 0, def.spec.height)).toBe(Infinity);
  expect(rayVehicle(def, 0, 0, 0, 0, 0, 1.1, -6, 0, 0, 1, def.spec.height)).toBeCloseTo(1.92, 5);
  expect(rayVehicle(def, 0, 0, 0, 0, 0, 2.1, 4, 0, 0, -1, def.beltline)).toBe(Infinity);
  expect(rayVehicle(def, 0, 0, 0, 0, 0, 2.1, 4, 0, 0, -1, def.spec.height)).toBeCloseTo(2.5, 5);
});

test("the use key meets a boat by its whole hull, its open cockpit too, and the outboard behind it", () => {
  // Over the gunwale into the cockpit, where a shot passes, the use key meets the hull's side.
  expect(useVehicle(def, 0, 0, 0, 0, 4, 1.6, 0, -1, 0, 0)).toBeCloseTo(2.7, 5);
  expect(useVehicle(def, 0, 0, 0, 0, 4, .4, 0, -1, 0, 0)).toBeCloseTo(2.7, 5);
  // Standing on its deck is already looking at it.
  expect(useVehicle(def, 0, 0, 0, 0, 0, .8, 0, 0, 0, 1)).toBe(0);
  // Astern, the outboard is met before the transom.
  expect(useVehicle(def, 0, 0, 0, 0, 0, 1.1, -6, 0, 0, 1)).toBeCloseTo(1.92, 5);
  expect(useVehicle(def, 0, 0, 0, 0, 4, 3, 0, -1, 0, 0)).toBe(Infinity);
});

test("boat targeting transforms the real hull through full quaternion attitude", () => {
  const a = Math.SQRT1_2;
  expect(rayVehicle(def, 62, 3, 64, 0, 61.6, 7, 64, 0, -1, 0, def.spec.height,
    { pitch: 0, roll: Math.PI / 2, qx: 0, qy: 0, qz: a, qw: a })).toBeCloseTo(2.7, 5);
});
