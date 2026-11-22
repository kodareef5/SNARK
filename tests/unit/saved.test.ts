// A feature's saved component (server/saved.ts): declared in one place, written only for a record that has some, read
// back, moved to another clock, and kept as bytes by a build that does not know it.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { RecordCodec, idMap, rebaseTicks } from "../../server/persist/codec.ts";
import { EntityRecord } from "../../server/records.ts";
import { SAVED, moved, saved, savedAs, savedId } from "../../server/saved.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader } from "../../shared/net/codec.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const codec = new RecordCodec(Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, reg.ids.map((name, i) => [name, i]), reg.ids.length), false);
const row = (rec: EntityRecord) => ({ pid: rec.pid, kind: rec.kind, x: 0, y: 0, z: 0, yaw: 0, data: codec.encode(rec).slice() });

/** The numbers of a record's components, in the order they lie in its bytes. */
function numbers(data: Uint8Array): number[] {
  const r = new BitReader(data);
  r.u8();
  r.string(256);
  const out: number[] = [];
  for (let n = r.varint(); n > 0; n--) {
    out.push(r.varint());
    r.blob(1 << 20);
  }
  return out;
}

// What this file's feature keeps: a tick on the records it has marked, and on no other record in the process.
const marks = new WeakMap<EntityRecord, { at: number }>();
const MARK = saved({
  name: "test: a mark",
  has: (rec) => marks.has(rec),
  write: (rec, w) => w.uint53(marks.get(rec)!.at),
  read: (rec, r) => void marks.set(rec, { at: r.uint53() }),
  rebase(rec, delta) {
    const mark = marks.get(rec);
    if (mark) mark.at = moved(mark.at, delta);
  },
});

test("a declared component is saved for a record that has some, costs one that has none nothing, and reads back", () => {
  const rec = new EntityRecord(41, reg.index.get("core:dodo")!);
  rec.team = 3;
  const plain = row(rec);
  expect(numbers(plain.data)).not.toContain(MARK.id);
  marks.set(rec, { at: 5000 });
  const marked = row(rec);
  expect(numbers(marked.data)).toContain(MARK.id);
  expect(marked.data.length).toBeGreaterThan(plain.data.length);
  const back = codec.decode(marked)!;
  expect([marks.get(back), back.team]).toEqual([{ at: 5000 }, 3]);
  expect(codec.encode(back)).toEqual(marked.data);
  expect(marks.has(codec.decode(plain)!)).toBe(false);
});

test("a record's components lie in its bytes by rising number, whatever order their files loaded in", () => {
  const rec = new EntityRecord(42, reg.index.get("core:dodo")!);
  rec.team = 3;
  rec.dead = true;
  marks.set(rec, { at: 1 });
  const found = numbers(row(rec).data);
  expect(found.length).toBeGreaterThan(2);
  expect(found).toEqual([...found].sort((a, b) => a - b));
  expect(SAVED.map((s) => s.id)).toEqual(SAVED.map((s) => s.id).sort((a, b) => a - b));
});

test("a component's number is made from its name alone, and no two declared share one", () => {
  expect(savedId("test: a mark")).toBe(MARK.id);
  expect(savedAs(MARK.id)).toBe(MARK);
  expect(savedId("test: another")).not.toBe(MARK.id);
  // Clear of the numbers kept by hand in a record's other bytes: under 128, and the three-letter tags.
  for (const s of SAVED) expect(s.id >= 128 && s.id < 1 << 21).toBe(true);
  expect(new Set(SAVED.map((s) => s.id)).size).toBe(SAVED.length);
  expect(() => saved({ name: "test: a mark", has: () => false, write: () => {}, read: () => {} })).toThrow('two saved components are called "test: a mark"');
});

test("a component's ticks move with the record to another clock, and 0 stays none", () => {
  const rec = new EntityRecord(43, reg.index.get("core:dodo")!);
  marks.set(rec, { at: 5000 });
  rec.expiresAt = 700;
  rebaseTicks(rec, 250);
  expect([marks.get(rec)!.at, rec.expiresAt]).toEqual([5250, 950]);
  rebaseTicks(rec, -100000);
  expect([marks.get(rec)!.at, rec.expiresAt]).toEqual([1, 1]);
  expect([moved(0, 250), moved(0, -250)]).toEqual([0, 0]);
});

test("the bytes of a component this build does not know are kept and written back", () => {
  const rec = new EntityRecord(44, reg.index.get("core:dodo")!);
  rec.team = 3;
  const unknown = savedId("test: nobody declared this");
  expect(savedAs(unknown)).toBeUndefined();
  rec.extra.set(unknown, Uint8Array.of(9, 8, 7));
  const saved = row(rec);
  const back = codec.decode(saved)!;
  expect([...back.extra]).toEqual([[unknown, Uint8Array.of(9, 8, 7)]]);
  expect(codec.encode(back)).toEqual(saved.data);
});
