import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("inverted flooded car attitude, mechanical hull and motion survive SQLite restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-car-attitude-")), dbPath = join(dir, "world.db");
  const map = writeMap(flatMap(2, { vehicles: [{ kind: "core:compact", id: "test-car", x: 42, z: 42, yaw: 0 }] }));
  let h: Harness | null = null;
  try {
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const rec = [...h.host.records.byPid.values()].find(r => h!.reg.ids[r.kind] === "core:compact")!, pid = rec.pid;
    const e = h.host.records.entOf.get(pid)!, ents = h.world.ents, v = ents.vrow[e]!;
    const stone = h.reg.index.get("core:stone")!; h.host.items.mint(rec, stone, 17);
    ents.vehicleQz[v] = 1; ents.vehicleQw[v] = 0; ents.vehicleRoll[v] = Math.PI;
    ents.vehicleHullCondition[v] = .37; ents.vehicleFlooding[v] = .8; ents.vehicleEngineCondition[v] = 0; ents.fuel[v] = 11;
    ents.vx[e] = 45; ents.vy[e] = -8; ents.vehicleRollRate[v] = 4;
    h.host.urban.changed(e);
    h.host.shutdown(); h = null;
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const saved = h.host.records.byPid.get(pid)!, restored = h.host.records.entOf.get(pid)!, out = h.world.ents, row = out.vrow[restored]!;
    expect(h.host.items.inv(saved).total(stone)).toBe(17); expect(out.fuel[row]).toBe(11);
    expect(saved.extra.get(0x757262)![0]).toBe(8);
    expect(out.vx[restored]).toBe(45); expect(out.vy[restored]).toBe(-8); expect(out.vehicleRollRate[row]).toBe(4);
    const up = [0, 0, 0];
    vehiclePoint({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: out.vehicleQx[row]!, qy: out.vehicleQy[row]!, qz: out.vehicleQz[row]!, qw: out.vehicleQw[row]! }, [0, 1, 0], up);
    expect(up[1]!).toBeCloseTo(-1, 5);
    expect(out.vehicleHullCondition[row]!).toBeCloseTo(.37, 6);
    expect(out.vehicleEngineCondition[row]).toBe(0);
    expect(out.vehicleFlooding[row]!).toBeCloseTo(.8, 6);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
