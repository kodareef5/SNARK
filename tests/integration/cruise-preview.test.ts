import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_USE, MODE_SWIM, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { CRUISE_COURSE, cruiseCourse } from "../../tools/cruise/course.ts";
import { seedCruisePreview } from "../../tools/cruise/dev.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { Harness } from "../fixtures/net.ts";

test("the cruise port launch is usable from its real dry berth and the independent save never duplicates it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-cruise-preview-")), dbPath = join(dir, "world.db");
  const map = cruiseCourse(), options = { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map), dbPath };
  let h: Harness | null = null;
  try {
    h = new Harness({}, 629, 60, options);
    expect(assertCruisePlaced(map, h.world.structs, h.reg).length).toBe(map.statics.length);
    expect(seedCruisePreview(h.host)).toBe(1); expect(seedCruisePreview(h.host)).toBe(0);
    const s = h.join("marina-visitor"); h.run(400);
    const c = h.client(s)!, ents = h.world.ents, berth = CRUISE_COURSE.utility;
    expect(ents.x[c.ent]!).toBeCloseTo(CRUISE_COURSE.spawn.x, 2); expect(ents.z[c.ent]!).toBeCloseTo(CRUISE_COURSE.spawn.z, 2);
    const rec = [...h.host.records.byPid.values()].find(r => r.name === "Cruise port utility launch")!;
    const boat = h.host.records.entOf.get(rec.pid)!, gas = h.reg.index.get("core:gasoline")!;
    expect(h.world.hf.waterAt(berth.x, berth.z)).toBe(0);
    expect(h.world.hf.heightAt(berth.x, berth.z)).toBeLessThan(-10);
    expect(ents.vehicleEngineOn[boat]).toBe(0); expect(ents.vehicleFlooding[boat]).toBe(0);
    expect(h.host.items.inv(rec).total(gas)).toBe(20);
    // The ordinary use ray reaches the stern ladder from the actual timber finger pier, with dry, supported feet.
    ents.setPosition(c.ent, berth.x + 2.4, .75, berth.z - 4); c.ownDirty = true; h.run(300);
    expect(ents.flags[c.ent]! & F_GROUNDED).not.toBe(0); expect(ents.mode[c.ent]).not.toBe(MODE_SWIM);
    expect(ents.y[c.ent]!).toBeCloseTo(.75, 2);
    const pilot = h.pilots[0]!, move = h.reg.move[ents.kind[c.ent]!]!;
    const dx = ents.x[boat]! + 1.03 - ents.x[c.ent]!, dz = ents.z[boat]! - 3.4 - ents.z[c.ent]!;
    const dy = ents.y[boat]! + .73 - (ents.y[c.ent]! + stanceEye(move, ents.stance[c.ent]!));
    pilot.yaw = Math.atan2(dx, dz); pilot.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(1200);
    expect(c.drive).toBe(boat); expect(ents.seatSlot[c.ent]).toBe(1);
    const pid = rec.pid, fuel = ents.fuel[boat]!, origin = new TextDecoder().decode(rec.extra.get(VEHICLE_ORIGIN));
    expect(origin).toBe(`${CRUISE_COURSE.id}/cruise-utility-launch`); expect(h.host.items.audit()).toEqual([]);
    h.host.shutdown(); h = new Harness({}, 629, 60, options);
    expect(seedCruisePreview(h.host)).toBe(0);
    const saved = h.host.records.byPid.get(pid)!, restored = h.host.records.entOf.get(pid)!;
    expect(saved.name).toBe("Cruise port utility launch"); expect(h.host.items.inv(saved).total(gas)).toBe(20);
    expect(h.world.ents.fuel[restored]).toBe(fuel);
    expect([...h.host.records.byPid.values()].filter(r => new TextDecoder().decode(r.extra.get(VEHICLE_ORIGIN)) === origin)).toHaveLength(1);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
