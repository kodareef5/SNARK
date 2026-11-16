import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
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
