import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { boatPlacement } from "../../shared/world/boat.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { BOAT_COURSE, boatCourse } from "../../tools/boat/course.ts";
import { seedBoatPreview } from "../../tools/boat/dev.ts";
import { Harness } from "../fixtures/net.ts";

test("the native boat course starts dry, seeds all variants and three passengers once, and keeps a deep departure lane", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(boatCourse()) });
  try {
    const { world } = h, spawn = BOAT_COURSE.spawn;
    expect(world.hf.heightAt(spawn.x, spawn.z)).toBeGreaterThan(world.hf.waterAt(spawn.x, spawn.z));
    expect(seedBoatPreview(h.host)).toBe(3); h.run(1800); expect(seedBoatPreview(h.host)).toBe(0);
    const boats = [...h.host.records.byPid.values()].filter(r => h.reg.vehicle[r.kind]?.movement === "boat"); expect(boats).toHaveLength(3);
    const ready = boats.find(r => h.reg.ids[r.kind] === "core:boat")!, e = h.host.records.entOf.get(ready.pid)!, ents = world.ents;
    expect(h.host.items.inv(ready).total(h.reg.index.get("core:boat_assembly")!)).toBe(1);
    const slots = []; for (let i = 0; i < ents.cap; i++) if (ents.seat[i] === e + 1) slots.push(ents.seatSlot[i]);
    expect(slots.sort()).toEqual([2, 3, 4]); expect(h.host.items.audit()).toEqual([]);
    const def = h.reg.vehicle[ready.kind]!; if (def.movement !== "boat") throw new Error("boat missing");
    expect(boatPlacement(world, 128, -.35, 112, 0, def)).toBe(true);
    expect(world.hf.heightAt(128, 440)).toBeGreaterThan(0);
  } finally { h.host.shutdown(); }
});
