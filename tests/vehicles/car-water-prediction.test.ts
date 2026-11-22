import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { CMD_VEHICLE, RESULT_BUSY, RESULT_OK, VEHICLE_REPAIR } from "../../shared/net/protocol.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("a damaged car predicts flooding exactly, then publishes one paid repair after physical shore recovery", () => {
  const map = flatMap(2, { seaLevel: 1.2 }), side = Math.sqrt(map.heights.length);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    map.heights[z * side + x] = Math.round((Math.max(0, (64 - z * 2) * .1) - map.minY) / map.stepY);
  }
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map) });
  try {
    const s = h.join("water-mechanic"); h.run(400);
    const c = h.client(s)!, a = h.world.ents, actor = h.host.records.byPid.get(c.pid)!;
    const car = h.host.spawnVehicle("core:compact", 64, 66, actor.team), v = a.vrow[car]!;
    const rec = h.host.records.byPid.get(a.pid[car]!)!, def = h.reg.vehicle[a.kind[car]!]!;
    if (!isWheelVehicle(def)) throw new Error("compact must be wheeled");
    const handle = makeHandle(car, a.gen[car]!), health = () => h.host.survival.value(rec, V_HEALTH);
    const beside = (x: number, z: number) => {
      a.setPosition(c.ent, x, h.world.hf.heightAt(x, z) + .05, z);
      a.vx[c.ent] = a.vy[c.ent] = a.vz[c.ent] = 0;
      h.world.history.discontinuity(c.ent);
    };
    beside(65.8, 66.12);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(1800);
    expect(s.driving).toBe(car);
    expect(a.vehicleFlooding[v]!).toBeGreaterThan(0);
    expect(a.y[car]! + def.spec.clearance).toBeLessThan(map.seaLevel);
    const floatingY = a.y[car]!;
    expect(floatingY).toBeGreaterThan(.15);

    s.prediction.enabled = true;
    h.host.survival.hurt(rec, 300, 0);
    h.run(500); // The single authoritative hit is received before measuring continued prediction.
    expect(s.prediction.differences).toHaveLength(1);
    expect(s.prediction.differences[0]!.fields.some(field => field.name === "vehicleHullCondition")).toBe(true);
    const hull = a.vehicleHullCondition[v]!, damagedHealth = health();
    expect(hull).toBeLessThan(.7);
    s.prediction.differences.length = 0;
    const corrections = s.stats.corrections, states = s.stats.stateCorrections;
    h.run(70000);
    expect(health()).toBeGreaterThan(damagedHealth);
    expect(a.vehicleHullCondition[v]).toBe(hull);
    expect(a.vehicleFlooding[v]!).toBeGreaterThan(.99);
    expect(a.vehicleEngineCondition[v]).toBe(0);
    expect(a.y[car]!).toBeLessThan(floatingY - .1);
    expect(s.stats.corrections).toBe(corrections); expect(s.stats.stateCorrections).toBe(states);
    expect(s.prediction.differences).toEqual([]); expect(s.prediction.dropped).toBe(0);

    const materials = ["core:ingot", "core:polymer", "core:electronics"].map(name => h.reg.index.get(name)!);
    for (const item of materials) h.host.items.mint(actor, item, 100);
    const inv = h.host.items.inv(actor), before = materials.map(item => inv.total(item));
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_BUSY);
    expect(materials.map(item => inv.total(item))).toEqual(before);
    s.prediction.enabled = false;
    h.host.urban.dismount(c); h.run(1200); expect(c.drive).toBe(-1);
    const sunkZ = a.z[car]!;
    for (let push = 0; push < 28 && a.y[car]! + def.spec.clearance < map.seaLevel + .05; push++) {
      beside(a.x[car]!, a.z[car]! + 3.2);
      expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_OK);
      h.run(3100);
    }
    expect(a.z[car]!).toBeLessThan(sunkZ - 10);
    expect(a.y[car]! + def.spec.clearance).toBeGreaterThan(map.seaLevel);
    expect(a.vehicleEngineCondition[v]).toBe(0);

    beside(a.x[car]! + 1.8, a.z[car]! + .12);
    h.pilots[0]!.buttons = BTN_JUMP; // Hold the ordinary handbrake while servicing the recovered car on its bank.
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(1500);
    expect(s.driving).toBe(car);
    const unrepairedHull = a.vehicleHullCondition[v]!, unrepairedHealth = health();
    s.prediction.enabled = true; s.prediction.differences.length = 0;
    let result = -1;
    s.onResult = (_, code) => { result = code; };
    s.command(CMD_VEHICLE, w => { w.u8(VEHICLE_REPAIR); w.u32(handle); });
    h.run(500);
    expect(result).toBe(RESULT_OK);
    expect(materials.map(item => inv.total(item))).toEqual(before.map((n, i) => n - [40, 10, 8][i]!));
    expect(a.vehicleEngineCondition[v]).toBe(.25);
    expect(a.vehicleHullCondition[v]).toBe(Math.fround(Math.min(1, unrepairedHull + .25)));
    expect(health()).toBeGreaterThan(unrepairedHealth + 199);
    expect(s.prediction.differences).toHaveLength(1);
    expect(s.prediction.differences[0]!.fields.some(field => field.name === "vehicleHullCondition")).toBe(true);
    expect(s.prediction.differences[0]!.fields.some(field => field.name === "vehicleEngineCondition")).toBe(true);
    const repairCorrections = s.stats.corrections, repairStates = s.stats.stateCorrections;
    const repairedHull = a.vehicleHullCondition[v]!, repairedHealth = health();
    s.prediction.differences.length = 0;
    h.run(5000);
    expect(health()).toBeGreaterThan(repairedHealth);
    expect(a.vehicleHullCondition[v]).toBe(repairedHull);
    expect(a.vehicleEngineCondition[v]).toBe(.25);
    expect(s.stats.corrections).toBe(repairCorrections); expect(s.stats.stateCorrections).toBe(repairStates);
    expect(s.prediction.differences).toEqual([]); expect(s.prediction.dropped).toBe(0);
    expect(materials.map(item => inv.total(item))).toEqual(before.map((n, i) => n - [40, 10, 8][i]!));
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
