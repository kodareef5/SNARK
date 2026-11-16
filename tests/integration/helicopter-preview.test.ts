import { expect, test } from "bun:test";
import { seedHelicopterPreview } from "../../tools/helicopter/dev.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { Harness } from "../fixtures/net.ts";

test("the isolated local preview seeds all three liveries, service supplies and three seated passengers once", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    expect(seedHelicopterPreview(h.host)).toBe(3); h.run(1600);
    expect(seedHelicopterPreview(h.host)).toBe(0);
    const aircraft = [...h.host.records.byPid.values()].filter(r => h.reg.vehicle[r.kind]?.movement === "rotor");
    expect(aircraft).toHaveLength(3);
    const ready = aircraft.find(r => h.reg.ids[r.kind] === "core:helicopter")!, e = h.host.records.entOf.get(ready.pid)!;
    expect(h.host.items.inv(ready).total(h.reg.index.get("core:helicopter_assembly")!)).toBe(1);
    const ents = h.world.ents, slots = [];
    for (let i = 0; i < ents.cap; i++) if (ents.seat[i] === e + 1) slots.push(ents.seatSlot[i]);
    expect(slots.sort()).toEqual([2, 3, 4]); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
