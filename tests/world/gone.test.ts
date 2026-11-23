// The list of a chunk's map pieces gone as it travels (shared/world/gone.ts).

import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { GoneList, NONE_GONE, fallen, goneSlots, readGone, writeGone } from "../../shared/world/gone.ts";
import { parseMap, placeStatics, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** The bytes of a list after the message's type, and the list read back from them. */
function sent(chunk: number, version: number, slots: number[]): { bytes: number; back: GoneList; chunk: number } {
  const w = new BitWriter(16384);
  writeGone(w, chunk, version, Uint16Array.from(slots));
  const back = new GoneList();
  return { bytes: w.byteLength, chunk: readGone(new BitReader(w.bytes().slice()), back), back };
}

test("a list of pieces gone comes back as it was sent, as runs or as bits, whichever is smaller", () => {
  const one = sent(7, 1, [41]);
  expect([one.chunk, one.back.version, [...one.back.slots], one.bytes]).toEqual([7, 1, [41], 6]);
  // A chunk levelled is one run, whatever it held.
  const all = Array.from({ length: 2000 }, (_, s) => s);
  const levelled = sent(300, 9, all);
  expect([levelled.chunk, [...levelled.back.slots].length, levelled.back.slots[1999], levelled.bytes]).toEqual([300, 2000, 1999, 8]);
  // Every other piece gone is a bit a slot: 2,000 slots in 250 bytes and the head.
  const odd = all.filter((s) => s % 2 === 1);
  const holes = sent(300, 10, odd);
  expect([...holes.back.slots]).toEqual(odd);
  expect(holes.bytes).toBeLessThanOrEqual(256);
  // Runs far apart stay runs.
  const apart = sent(65535, 200, [3, 4, 5, 900, 20000, 20001, 65534]);
  expect([apart.chunk, apart.back.version, [...apart.back.slots]]).toEqual([65535, 200, [3, 4, 5, 900, 20000, 20001, 65534]]);
  expect(apart.bytes).toBeLessThanOrEqual(17);
  // Nothing gone says so in five bytes.
  const none = sent(12, 3, []);
  expect([none.chunk, none.back.version, none.back.slots.length, none.bytes]).toEqual([12, 3, 0, 5]);
});

test("a list cut short or naming a slot no chunk has is refused", () => {
  const w = new BitWriter(16384);
  writeGone(w, 5, 1, Uint16Array.from({ length: 900 }, (_, s) => s * 2));
  const got = new GoneList();
  expect(readGone(new BitReader(w.bytes().slice(0, 40)), got)).toBe(-1);
  w.reset();
  w.u16(5);
  w.varint(1);
  w.bool(false);
  w.varint(1);
  w.varint(65535);
  w.bool(true);
  w.varint(5);
  expect(readGone(new BitReader(w.bytes().slice()), got)).toBe(-1);
});

test("a chunk's list is its emptied map slots, and the same list comes back as the one before", () => {
  const reg = coreRegistry();
  const statics: MapStatic[] = Array.from({ length: 12 }, (_, i) => ({ kind: "core:pillar", x: 70 + i * 4, y: 3.3, z: 70, yaw: 0 }));
  const map = parseMap(writeMap(flatMap(4, { statics })));
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const chunk = structs.held[0]!;
  expect(goneSlots(reg, structs, chunk, NONE_GONE)).toBe(NONE_GONE);
  // A piece hurt and a piece built change the chunk and not its list.
  structs.damage(chunk * 65536 + 3, 1);
  structs.add(reg.index.get("core:wall_stone")!, 80, 1.88, 80, 0, 7, 100);
  expect(goneSlots(reg, structs, chunk, NONE_GONE)).toBe(NONE_GONE);
  structs.remove(chunk * 65536 + 5);
  structs.remove(chunk * 65536 + 9);
  const list = goneSlots(reg, structs, chunk, NONE_GONE);
  expect([...list]).toEqual([5, 9]);
  structs.damage(chunk * 65536 + 4, 1);
  expect(goneSlots(reg, structs, chunk, list)).toBe(list);
  // Only an empty slot has fallen today.
  expect([fallen(reg, 0), fallen(reg, reg.index.get("core:pillar")!)]).toEqual([true, false]);
});
