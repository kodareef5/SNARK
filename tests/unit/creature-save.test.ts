import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { RecordCodec, idMap } from "../../server/persist/codec.ts";
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
