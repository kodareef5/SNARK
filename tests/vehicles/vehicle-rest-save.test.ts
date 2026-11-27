// A vehicle at rest shifts by a hair at each heartbeat for as long as it stands (server/urban.ts). Its record is left as
// it is until a number of its state has gone a hair's width, and any switch, or more than a hair, is saved at once.

import { expect, test } from "bun:test";
import { JET_VEHICLE } from "../../content/vehicles/jet.ts";
import { VEHICLE_COMPONENT, VehicleSaver, startVehicle } from "../../server/vehicles/save.ts";
import type { EntityRecord } from "../../server/records.ts";
import { Body as SimBody } from "../../shared/sim/character.ts";

const HAIR = 1e-3;

function parked() {
  const b = new SimBody();
  b.yaw = 0;
  startVehicle(b, JET_VEHICLE);
  const rec = { pid: 7, extra: new Map<number, Uint8Array>() } as unknown as EntityRecord;
  const saver = new VehicleSaver();
  expect(saver.write(rec, b, JET_VEHICLE.movement, HAIR)).toBe(true);
  return { b, rec, saver, first: rec.extra.get(VEHICLE_COMPONENT)! };
}

test("a hair's shift of a vehicle at rest is not saved, and the record keeps what it held", () => {
  const { b, rec, saver, first } = parked();
  b.vy = -9.8e-8;
  b.vehicleQy = Math.fround(b.vehicleQy + 5e-4);
  b.vehicleRoll = 1.8e-5;
  expect(saver.write(rec, b, JET_VEHICLE.movement, HAIR)).toBe(false);
  expect(rec.extra.get(VEHICLE_COMPONENT)).toBe(first);
  // The same shift of one that is not at rest is saved, as every change of it is.
  expect(saver.write(rec, b, JET_VEHICLE.movement)).toBe(true);
});

test("more than a hair, a switch, or a hair many times over is saved", () => {
  for (const change of [
    (b: SimBody) => void (b.vx = 0.01),
    (b: SimBody) => void (b.vehicleEngineOn = true),
    (b: SimBody) => void (b.grounded = false),
  ]) {
    const { b, rec, saver } = parked();
    change(b);
    expect(saver.write(rec, b, JET_VEHICLE.movement, HAIR)).toBe(true);
  }
  // A slow slide is saved each time it has gone a hair's width from what the record holds, so the record is never far.
  const { b, rec, saver } = parked();
  let saves = 0;
  for (let n = 0; n < 100; n++) {
    b.vehicleRideOffset = Math.fround(b.vehicleRideOffset + 1e-4);
    if (saver.write(rec, b, JET_VEHICLE.movement, HAIR)) saves++;
  }
  expect(saves).toBeGreaterThanOrEqual(8);
  expect(saves).toBeLessThanOrEqual(10);
  // The ride offset is the twelfth number of the component, after its version byte.
  const kept = rec.extra.get(VEHICLE_COMPONENT)!;
  const held = new DataView(kept.buffer, kept.byteOffset, kept.byteLength).getFloat32(1 + 11 * 4, true);
  expect(Math.abs(held - b.vehicleRideOffset)).toBeLessThanOrEqual(HAIR * 1.01);
});
