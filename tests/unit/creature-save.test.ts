import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
// A feature declares what it saves as its file loads (server/saved.ts): the soul balls' mark.
import "../../server/balls.ts";
import { RecordCodec, idMap, rebaseTicks } from "../../server/persist/codec.ts";
import { EntityRecord } from "../../server/records.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { FLAG_BLUEPRINT, Inventory } from "../../shared/sim/items.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const id = (name: string) => reg.index.get(`core:${name}`)!;
const codec = new RecordCodec(Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, reg.ids.map((name, i) => [name, i]), reg.ids.length), false);

test("plate modes and the current inventory component survive the same saved creature", () => {
  for (const mode of [0, 1, 2]) {
    const rec = new EntityRecord(77, id("parasaur"));
    rec.creatureMode = mode;
    rec.team = 8;
    const inv = rec.inv = new Inventory(8, 8);
    inv.set(0, id("berry"), 87, 0, 0, 12000);
    inv.set(2, id("rifle"), 1, 3, 1234, 0);
    inv.setGear(2, id("round_rifle"), 7, id("scope"));
    inv.set(5, id("spear"), 1, 1, 0, 0, FLAG_BLUEPRINT);
    const row = { pid: rec.pid, kind: rec.kind, x: 1, y: 2, z: 3, yaw: 400, data: codec.encode(rec).slice() };
    const restored = codec.decode(row)!;
    expect(restored).not.toBeNull();
    expect([restored.creatureMode, restored.team]).toEqual([mode, 8]);
    expect(restored.inv!.item).toEqual(inv.item);
    expect(restored.inv!.count).toEqual(inv.count);
    expect(restored.inv!.dur).toEqual(inv.dur);
    expect(restored.inv!.flags).toEqual(inv.flags);
    expect(codec.encode(restored)).toEqual(row.data);
  }
});

test("a tame kept in a soul ball is saved as kept, and the ball that names it with its charge; one not kept writes nothing more", () => {
  const rec = new EntityRecord(91, id("raptor"));
  rec.team = 8;
  rec.name = "Bitey";
  rec.saddle = id("saddle_raptor");
  const plain = codec.encode(rec).slice();
  rec.stored = 123456;
  const row = { pid: rec.pid, kind: rec.kind, x: 1, y: 2, z: 3, yaw: 400, data: codec.encode(rec).slice() };
  // The mark is a component of its own: a record without it is byte for byte what it was before there were soul balls.
  expect(row.data.length).toBeGreaterThan(plain.length);
  const back = codec.decode(row)!;
  expect([back.stored, back.name, back.saddle, back.team]).toEqual([123456, "Bitey", id("saddle_raptor"), 8]);
  expect(codec.encode(back)).toEqual(row.data);
  back.stored = 0;
  expect(codec.encode(back)).toEqual(plain);
  // On another clock it has been kept as long, and never becomes one not kept.
  rec.stored = 123456;
  rebaseTicks(rec, 1000);
  expect(rec.stored).toBe(124456);
  rebaseTicks(rec, -10000000);
  expect(rec.stored).toBe(1);

  // Its holder: a full ball naming it, held at full charge in one slot and running down in another.
  const holder = new EntityRecord(92, id("survivor"));
  const inv = (holder.inv = new Inventory(8, 8));
  inv.set(1, id("soul_ball_full"), 1, 0, 0, 0xffffffff);
  inv.setRef(1, 91);
  inv.set(4, id("soul_ball_full"), 1, 0, 0, 77760500);
  inv.setRef(4, 93);
  inv.set(6, id("soul_ball"), 1, 0, 0, 0);
  const held = codec.decode({ pid: 92, kind: holder.kind, x: 0, y: 0, z: 0, yaw: 0, data: codec.encode(holder).slice() })!;
  expect([held.inv!.item[1], held.inv!.spoilAt[1], held.inv!.refOf(1), held.inv!.spoilAt[4], held.inv!.refOf(4), held.inv!.item[6], held.inv!.refOf(6)]).toEqual([id("soul_ball_full"), 0xffffffff, 91, 77760500, 93, id("soul_ball"), 0]);
  // A charge held full names no tick, and a change of clock leaves it held.
  rebaseTicks(held, 5000);
  expect([held.inv!.spoilAt[1], held.inv!.spoilAt[4]]).toEqual([0xffffffff, 77765500]);
});
