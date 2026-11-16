import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("an inverted crash keeps its attitude, momentum and cargo through falling salvage, SQLite reload and final ground contact", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-heli-wreck-")), dbPath = join(dir, "world.db"), map = writeMap(flatMap(2));
  let h: Harness | null = null;
  try {
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const e = h.host.spawnVehicle("core:helicopter", 64, 64, 0), ents = h.world.ents;
    const rec = h.host.records.byPid.get(ents.pid[e]!)!, cargo = h.reg.index.get("core:ingot")!;
    h.host.items.mint(rec, cargo, 11);
    ents.setPosition(e, 64, 40, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vehicleQx[e] = 1; ents.vehicleQy[e] = ents.vehicleQz[e] = ents.vehicleQw[e] = 0;
    ents.vx[e] = 4; ents.vy[e] = -8; ents.vehicleRotorRpm[e] = 410; ents.vehicleEngineOn[e] = 1;
    h.host.urban.changed(e); h.host.survival.hurt(rec, 1e6, 0); h.run(100);
    const b = [...h.host.corpses.bodies.values()].find(b => b.wreck)!;
    expect(b).toBeDefined(); expect(b.fall).toBeNull(); expect(b.drop).not.toBeNull(); expect(b.y).toBeLessThan(40);
    expect([b.wreck!.qx, b.wreck!.qw]).toEqual([1, 0]);
    expect([ents.vehicleQx[b.e], ents.vehicleQw[b.e], ents.vehicleRotorRpm[b.e], ents.vehicleEngineOn[b.e]]).toEqual([1, 0, 0, 0]);
    expect(h.host.items.inv(b.rec).total(cargo)).toBe(11);
    const pid = b.rec.pid, y = b.y, vx = b.wreck!.vx, vy = b.wreck!.vy;
    h.host.shutdown(); h = null;
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const loaded = h.host.corpses.bodies.get(pid)!;
    expect(loaded.wreck).not.toBeNull(); expect(loaded.y).toBeCloseTo(y, 1);
    expect([loaded.wreck!.qx, loaded.wreck!.qw, loaded.wreck!.vx, loaded.wreck!.vy]).toEqual([1, 0, vx, vy]);
    expect(h.world.ents.vehicleQx[loaded.e]).toBe(1);
    h.run(6000);
    expect(loaded.drop).toBeNull(); expect(loaded.y).toBeGreaterThan(3.30); expect(loaded.y).toBeLessThan(3.34);
    expect([loaded.wreck!.qx, loaded.wreck!.qw]).toEqual([1, 0]);
    expect(h.host.items.inv(loaded.rec).total(cargo)).toBe(11); expect(h.host.items.audit()).toEqual([]);
    const middle = h.host.corpses.middle(loaded);
    expect(middle.y).toBeLessThan(loaded.y - 1);
    expect(h.host.corpses.hit(loaded.e, middle.x, middle.y, middle.z - 10, 0, 0, 1, 20)).toBeLessThan(10);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("rigid salvage rests on a roof and falls again when its actual support is dismantled", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const e = h.host.spawnVehicle("core:helicopter", 64, 64, 0), ents = h.world.ents;
    const rec = h.host.records.byPid.get(ents.pid[e]!)!, ceiling = h.reg.index.get("core:ceiling")!, refs: number[] = [];
    for (const x of [-6, -3, 0, 3, 6]) for (const z of [-6, -3, 0, 3, 6]) refs.push(h.world.structs.add(ceiling, 64 + x, 10, 64 + z, 0, 0, 100));
    ents.setPosition(e, 64, 35, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vehicleQx[e] = 1; ents.vehicleQy[e] = ents.vehicleQz[e] = ents.vehicleQw[e] = 0;
    h.host.urban.changed(e); h.host.survival.hurt(rec, 1e6, 0); h.run(4000);
    const b = [...h.host.corpses.bodies.values()].find(b => b.wreck)!;
    expect(b.drop).toBeNull(); expect(b.y).toBeGreaterThan(13.40); expect(b.y).toBeLessThan(13.45);
    for (const ref of refs) expect(h.world.structs.remove(ref)).toBe(true);
    h.run(5000);
    expect(b.drop).toBeNull(); expect(b.y).toBeGreaterThan(3.30); expect(b.y).toBeLessThan(3.34);
    expect([b.wreck!.qx, b.wreck!.qw]).toEqual([1, 0]);
  } finally { h.host.shutdown(); }
});
