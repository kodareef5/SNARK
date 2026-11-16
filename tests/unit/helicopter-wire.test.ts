import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { EntityView, SentView, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { Body } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { packVehiclePose } from "../../shared/sim/vehicle-body.ts";
import { interpolateRotorPhase, packVehicleQuaternionPair, packVehicleRotor, packVehicleSystems, unpackVehicleQuaternion } from "../../shared/sim/vehicle-presentation.ts";

test("inverted rotorcraft state survives store growth, snapshots and slot recycling", () => {
  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 1), a = new Body(), b = new Body();
  const e = store.create(1, 20, 40, 20, 0);
  a.vehicle = true; a.kind = 1; a.x = 20; a.y = 40; a.z = 20;
  a.vehicleQx = 1; a.vehicleQw = 0; a.vehiclePitchRate = Math.fround(2.3);
  a.vehicleRotorRpm = Math.fround(389.4); a.vehicleRotorPhase = Math.fround(5.7);
  a.vehicleCollective = Math.fround(.73); a.vehicleEngineOn = true;
  a.vehicleEngineCondition = Math.fround(.72); a.vehicleRotorCondition = Math.fround(.85);
  store.storeBody(e, a);
  for (let i = 0; i < 20; i++) store.create(2, 25, 0, 25, 0);
  store.loadBody(e, b); expect(b.equals(a)).toBe(true);
  const writer = new BitWriter(256), reader = new BitReader();
  writer.bits(5, 3); writeBody(writer, b); reader.reset(writer.bytes()); reader.bits(3); readBody(reader, b);
  expect(reader.overflow).toBe(false); expect(b.equals(a)).toBe(true);
  a.vehiclePitchRate = 0;
  a.vehicle = false; a.vehicleQx = 0; a.vehicleQw = 1; a.vehicleRotorRpm = a.vehicleRotorPhase = a.vehicleCollective = 0;
  a.vehicleEngineOn = false; a.vehicleEngineCondition = a.vehicleRotorCondition = 1;
  writer.reset(); writeBody(writer, a); reader.reset(writer.bytes()); readBody(reader, b);
  expect(b.equals(a)).toBe(true);
  store.destroy(e); const reused = store.create(2, 25, 0, 25, 0);
  expect(reused).toBe(e); store.loadBody(reused, b);
  expect([b.vehicleQx, b.vehicleQw, b.vehicleCollective, b.vehicleEngineOn]).toEqual([0, 1, 0, false]);
  // A plain entity's implicit rotor defaults must clear a previously read aircraft's state.
  expect([b.vehicleQx, b.vehicleQw, b.vehicleCollective, b.vehicleEngineOn]).toEqual([0, 1, 0, false]);
});

test("observer receives rotor and full inverted attitude changes without a position update", () => {
  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 1), e = store.create(1, 20, 40, 20, 0);
  const current = new SentView(), sent = new SentView(), seen = new EntityView();
  current.push(e, store.gen[e]!, 1, 5120, 10240, 5120, 0, 0, 0, 0, 0, packVehiclePose(0, 0, 0));
  const w = new BitWriter(1024), r = new BitReader();
  writeViewDelta(w, null, current, sent, 8192, 0, store); r.reset(w.bytes());
  expect(readViewDelta(r, null, seen)).toBe(true);
  current.vehicleRotor[0] = packVehicleRotor(410, 5.4);
  current.vehicleSystems[0] = packVehicleSystems(18, 90, .6, .9, true);
  current.vehicleAttitudeA[0] = packVehicleQuaternionPair(1, 0);
  current.vehicleAttitudeB[0] = packVehicleQuaternionPair(0, 0);
  const next = new SentView(), shown = new EntityView(); w.reset();
  writeViewDelta(w, sent, current, next, 8192, 0, store); r.reset(w.bytes());
  expect(readViewDelta(r, seen, shown)).toBe(true);
  expect(shown.vehicleRotor[0]).toBe(current.vehicleRotor[0]);
  expect(shown.vehicleSystems[0]).toBe(current.vehicleSystems[0]);
  const q = [0, 0, 0, 1]; unpackVehicleQuaternion(shown.vehicleAttitudeA[0]!, shown.vehicleAttitudeB[0]!, q);
  expect(q).toEqual([1, 0, 0, 0]);
});

test("fast rotor interpolation preserves full turns rather than reversing across snapshot phases", () => {
  const turn = Math.PI * 2, rpm = 410, seconds = .1, advance = rpm * turn / 60 * seconds;
  const a = 5.8, b = (a + advance) % turn;
  expect(interpolateRotorPhase(a, b, rpm, rpm, seconds, .5)).toBeCloseTo(a + advance * .5, 6);
});
