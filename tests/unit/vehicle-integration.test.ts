import { expect, test } from "bun:test";
import { COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { EntityView, SentView, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { Body, BTN_JUMP } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { packVehiclePose, packVehicleRide, packVehicleDoors, packVehicleDrive, quantVehicleWheel, stepVehicleBody, unpackVehicleGear, unpackVehicleRpm, vehicleShifting, unpackVehiclePitch, unpackVehicleRoll, unpackVehicleSteering } from "../../shared/sim/vehicle-body.ts";
import { flatWorld } from "../fixtures/world.ts";

test("a vehicle restores through the real Body wire and replays exactly from a mid-turn snapshot", () => {
  const world = flatWorld();
  const authority = new Body(), predicted = new Body();
  const kind = world.kind("core:compact");
  authority.kind = kind; authority.x = 40; authority.z = 40;
  authority.vehicle = true; authority.fuel = COMPACT_VEHICLE.spec.fuelCapacity;
  authority.vehiclePayloadMass = 380;
  const store = new EntityStore(world.dims, 4);
  const e = store.create(kind, 40, 0, 40, 0);
  const w = new BitWriter(128), r = new BitReader();
  for (let tick = 0; tick < 120; tick++) {
    const steer = tick < 50 ? 60 : -45;
    const throttle = tick < 95 ? 127 : -127;
    const buttons = tick > 110 ? BTN_JUMP : 0;
    stepVehicleBody(world, authority, steer, throttle, buttons, COMPACT_VEHICLE);
    store.storeBody(e, authority); store.loadBody(e, authority);
    if (tick === 31) {
      writeBody(w, authority); r.reset(w.bytes()); readBody(r, predicted);
      expect(r.overflow).toBe(false); expect(predicted.equals(authority)).toBe(true);
    } else if (tick > 31) {
      stepVehicleBody(world, predicted, steer, throttle, buttons, COMPACT_VEHICLE);
      expect(predicted.equals(authority)).toBe(true);
    }
  }
  expect(authority.x).not.toBe(40);
  expect(authority.fuel).toBeLessThan(COMPACT_VEHICLE.spec.fuelCapacity);
});

test("a seated passenger carries attachment identity through the ordinary snapshot", () => {
  const a = new Body(), b = new Body();
  a.seat = 20001; a.seatSlot = 2; a.seatGen = 4095;
  a.bloom = 73; a.kick = 29; a.rounds = 6;
  const w = new BitWriter(128), r = new BitReader();
  writeBody(w, a); r.reset(w.bytes()); readBody(r, b);
  expect(b.equals(a)).toBe(true);
  a.seat = a.seatSlot = a.seatGen = 0; w.reset();
  writeBody(w, a); r.reset(w.bytes()); readBody(r, b);
  expect(b.equals(a)).toBe(true);
});

test("vehicle-only visual changes travel in entity deltas and preserve the occupant's parent generation", () => {
  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 4);
  const car = store.create(1, 20, 0, 20, 0), person = store.create(2, 20, 0, 20, 0);
  store.setSeat(person, car, 2);
  store.setGear(person, new Uint16Array([1, 2, 3, 4, 5, 6])); store.on[person] = 1;
  const cur = new SentView(), sent = new SentView(), seen = new EntityView();
  const pose = packVehiclePose(0.1, -0.08, 0.2);
  cur.push(car, store.gen[car]!, 1, 5120, 0, 5120, 0, 0, 0, 0, 0, pose, 200);
  cur.push(person, store.gen[person]!, 2, 5120, 0, 5120, 0, 0, 0);
  const w = new BitWriter(1024), r = new BitReader();
  writeViewDelta(w, null, cur, sent, 8192, 0, store);
  r.reset(w.bytes()); expect(readViewDelta(r, null, seen)).toBe(true);
  expect(seen.vehiclePose[0]).toBe(pose);
  expect([seen.seat[1], seen.seatSlot[1], seen.seatGen[1]]).toEqual([car + 1, 2, store.gen[car]]);
  expect(Array.from(seen.gear[1]!)).toEqual([1, 2, 3, 4, 5, 6]); expect(seen.on[1]).toBe(1);
  const changed = packVehiclePose(0.12, -0.1, -0.3);
  cur.vehiclePose[0] = changed; cur.vehicleWheel[0] = quantVehicleWheel(1.5);
  const next = new SentView(), updated = new EntityView(); w.reset();
  writeViewDelta(w, sent, cur, next, 8192, 0, store);
  r.reset(w.bytes()); expect(readViewDelta(r, seen, updated)).toBe(true);
  expect(updated.vehiclePose[0]).toBe(changed);
  expect(updated.vehicleWheel[0]).toBe(cur.vehicleWheel[0]);
  expect(updated.seatSlot[1]).toBe(2); expect(updated.seatGen[1]).toBe(store.gen[car]!);
  expect(updated.on[1]).toBe(1);
  expect(unpackVehiclePitch(changed)).toBeCloseTo(0.12, 2);
  expect(unpackVehicleRoll(changed)).toBeCloseTo(-0.1, 2);
  expect(unpackVehicleSteering(changed)).toBeCloseTo(-0.3, 2);
  // Suspension and a door can change with no position, steering or wheel change.
  cur.vehicleRide[0] = packVehicleRide(.09, -.06, .075, true);
  cur.vehicleDoors[0] = packVehicleDoors(.8, .2);
  const suspended = new SentView(), shown = new EntityView(); w.reset();
  writeViewDelta(w, next, cur, suspended, 8192, 0, store);
  r.reset(w.bytes()); expect(readViewDelta(r, updated, shown)).toBe(true);
  expect(shown.vehicleRide[0]).toBe(cur.vehicleRide[0]!);
  expect(shown.vehicleDoors[0]).toBe(cur.vehicleDoors[0]!);
  // Engine-only changes must survive a delta, including RPM above the former 14-bit ceiling.
  cur.vehicleDrive[0] = packVehicleDrive(3, 30000, true);
  const geared = new SentView(), engine = new EntityView(); w.reset();
  writeViewDelta(w, suspended, cur, geared, 8192, 0, store);
  r.reset(w.bytes()); expect(readViewDelta(r, shown, engine)).toBe(true);
  expect(unpackVehicleGear(engine.vehicleDrive[0]!)).toBe(3);
  expect(unpackVehicleRpm(engine.vehicleDrive[0]!)).toBe(30000);
  expect(vehicleShifting(engine.vehicleDrive[0]!)).toBe(true);
  expect(engine.vehicleRide[0]).toBe(shown.vehicleRide[0]!);
});

test("growing and recycling entity slots cannot retain a vehicle's fuel or seat claim", () => {
  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 2, 4);
  const a = store.create(1, 10, 0, 10, 0), b = store.create(2, 10, 0, 10, 0);
  store.vehicle[a] = 1; store.fuel[a] = 17; store.vehicleRoll[a] = 0.25;
  store.vehicleGear[a] = 3; store.vehicleRpm[a] = 4300;
  store.vehicleShiftTime[a] = .5; store.vehiclePayloadMass[a] = 380;
  store.setSeat(b, a, 2);
  store.create(1, 12, 0, 10, 0);
  expect(store.fuel[a]).toBe(17); expect(store.seatGen[b]).toBe(store.gen[a]!);
  expect([store.vehicleGear[a], store.vehicleRpm[a], store.vehicleShiftTime[a], store.vehiclePayloadMass[a]]).toEqual([3, 4300, .5, 380]);
  store.create(1, 14, 0, 10, 0); store.destroy(a);
  const recycled = store.create(2, 16, 0, 10, 0);
  expect(recycled).toBe(a);
  expect([store.vehicle[a], store.fuel[a], store.vehicleRoll[a], store.seatSlot[a], store.seatGen[a]]).toEqual([0, 0, 0, 0, 0]);
  expect([store.vehicleGear[a], store.vehicleRpm[a], store.vehicleShiftTime[a], store.vehiclePayloadMass[a]]).toEqual([0, 0, 0, 0]);
  expect(store.seatGen[b]).not.toBe(store.gen[a]!);
});
