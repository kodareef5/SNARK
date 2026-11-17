import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("a boat's current SQLite state preserves impact momentum above its powered cruising speed", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-boat-momentum-"));
  const map = writeMap(flatMap(2, { seaLevel: 3, vehicles: [{ kind: "core:boat", id: "impact-boat", x: 64, z: 64, yaw: 0 }] }));
  const options = { dev: true, clips: NO_CLIPS, rigs: [], dbPath: join(dir, "world.db"), map };
  let h: Harness | null = null;
  try {
    h = new Harness({}, 1, 60, options);
    const rec = [...h.host.records.byPid.values()].find(r => h!.reg.ids[r.kind] === "core:boat")!, pid = rec.pid;
    const e = h.host.records.entOf.get(pid)!, a = h.world.ents, def = h.reg.vehicle[rec.kind]!;
    a.vx[e] = 30; a.vy[e] = -8; a.vz[e] = 20; a.vehicleYawRate[a.vrow[e]!] = 5;
    const velocity = [a.vx[e]!, a.vy[e]!, a.vz[e]!];
    expect(Math.hypot(velocity[0]!, velocity[2]!)).toBeGreaterThan(def.spec.maxForward);
    h.host.urban.changed(e);
    h.host.shutdown(); h = null;

    h = new Harness({}, 1, 60, options);
    const restored = h.host.records.entOf.get(pid)!, out = h.world.ents;
    expect([out.vx[restored], out.vy[restored], out.vz[restored]]).toEqual(velocity);
    expect(out.vehicleYawRate[out.vrow[restored]!]).toBe(5);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
