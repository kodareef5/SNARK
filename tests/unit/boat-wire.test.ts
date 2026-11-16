import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { EntityView, SentView, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { packBoatWater, unpackBoatHullCondition, unpackBoatFlooding, packVehicleQuaternionPair, unpackVehicleQuaternion, interpolateRotorPhase } from "../../shared/sim/vehicle-presentation.ts";
import { Body } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";

test("flooding and hull health survive growth, body replay and snapshots, and clear on recycled occupants", () => {
  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 1), a = new Body(), b = new Body();
  const e = store.create(1, 20, -2, 20, 0);
  Object.assign(a, { vehicle: true, kind: 1, x: 20, y: -2, z: 20, vehicleQx: 1, vehicleQw: 0,
    vehicleEngineOn: false, vehicleRpm: Math.fround(1234.5), vehicleGear: -1,
    vehicleHullCondition: Math.fround(.43), vehicleFlooding: Math.fround(.64), vehicleEngineCondition: Math.fround(.72) });
  store.storeBody(e, a);
  for (let i = 0; i < 20; i++) store.create(2, 25, 0, 25, 0);
  store.loadBody(e, b); expect(b.equals(a)).toBe(true);
  const copy = new Body(); copy.copy(a); expect(copy.equals(a)).toBe(true);
  copy.vehicleFlooding = .1; expect(copy.equals(a)).toBe(false);
  copy.copy(a); copy.vehicleHullCondition = 1; expect(copy.equals(a)).toBe(false);
  const writer = new BitWriter(256), reader = new BitReader();
  writer.bits(5, 3); writeBody(writer, a); reader.reset(writer.bytes()); reader.bits(3); readBody(reader, b);
  expect(reader.overflow).toBe(false); expect(b.equals(a)).toBe(true);
  // Reading an ordinary survivor into a previously flooded boat body must clear every marine field.
  const survivor = new Body(); writer.reset(); writeBody(writer, survivor); reader.reset(writer.bytes()); readBody(reader, b);
  expect(b.equals(survivor)).toBe(true);
  store.destroy(e); expect(store.create(2, 25, 0, 25, 0)).toBe(e); store.loadBody(e, b);
  expect([b.vehicleHullCondition, b.vehicleFlooding, b.vehicleEngineCondition, b.vehicleQw]).toEqual([1, 0, 1, 1]);
});


test("stationary flooding and inverted attitude reach observers through delta snapshots", () => {
  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 1), e = store.create(1, 20, -2, 20, 0);
  const current = new SentView(), sent = new SentView(), seen = new EntityView();
  current.push(e, store.gen[e]!, 1, 5120, 10240, 5120, 0, 0, 0);
  const w = new BitWriter(1024), r = new BitReader();
  writeViewDelta(w, null, current, sent, 8192, 0, store); r.reset(w.bytes());
  expect(readViewDelta(r, null, seen)).toBe(true);
  current.vehicleWater[0] = packBoatWater(.42, .71);
  current.vehicleAttitudeA[0] = packVehicleQuaternionPair(1, 0);
  current.vehicleAttitudeB[0] = packVehicleQuaternionPair(0, 0);
  const next = new SentView(), shown = new EntityView(); w.reset();
  writeViewDelta(w, sent, current, next, 8192, 0, store); r.reset(w.bytes());
  expect(readViewDelta(r, seen, shown)).toBe(true);
  expect(shown.qx[0]).toBe(seen.qx[0]);
  expect(shown.vehicleWater[0]).toBe(current.vehicleWater[0]);
  expect(unpackBoatHullCondition(shown.vehicleWater[0]!)).toBeCloseTo(.42, 2);
  expect(unpackBoatFlooding(shown.vehicleWater[0]!)).toBeCloseTo(.71, 2);
  const q = [0, 0, 0, 1]; unpackVehicleQuaternion(shown.vehicleAttitudeA[0]!, shown.vehicleAttitudeB[0]!, q);
  expect(q).toEqual([1, 0, 0, 0]);
  const grown = new SentView(); for (let i = 0; i < 300; i++) grown.copyFrom(shown, 0);
  expect(grown.vehicleWater[299]).toBe(shown.vehicleWater[0]);
  // A repair can restore the implicit zero value through an update too.
  current.vehicleWater[0] = packBoatWater(1, 0); w.reset();
  writeViewDelta(w, next, current, new SentView(), 8192, 0, store); r.reset(w.bytes());
  const dry = new EntityView(); expect(readViewDelta(r, shown, dry)).toBe(true);
  expect([unpackBoatHullCondition(dry.vehicleWater[0]!), unpackBoatFlooding(dry.vehicleWater[0]!)]).toEqual([1, 0]);
});

test("outboard phase interpolation keeps full forward and reverse revolutions", () => {
  for (const rpm of [5600, -5600]) {
    const a = 5.8, dt = .1, turn = 2 * Math.PI, advance = rpm * turn / 60 * dt, b = ((a + advance) % turn + turn) % turn;
    expect(interpolateRotorPhase(a, b, rpm, rpm, dt, .5)).toBeCloseTo(a + advance / 2, 6);
  }
});
