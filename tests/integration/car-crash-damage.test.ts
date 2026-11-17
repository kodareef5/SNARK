import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function crash(speed: number, angle: number, damaged = false) {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const driver = h.join("crash-driver"), passenger = h.join("crash-passenger"); h.run(500);
    const a = h.client(driver)!, b = h.client(passenger)!, ents = h.world.ents;
    ents.setPosition(a.ent, 65.8, 0, 64.12); ents.setPosition(b.ent, 62.2, 0, 64.12);
    h.world.history.discontinuity(a.ent); h.world.history.discontinuity(b.ent);
    const car = h.host.spawnVehicle("core:compact", 64, 64, 0);
    expect(h.host.urban.mount(a, car)).toBe(RESULT_OK); expect(h.host.urban.mount(b, car)).toBe(RESULT_OK); h.run(1300);
    const record = h.host.records.byPid.get(ents.pid[car]!)!, actorA = h.host.records.byPid.get(a.pid)!, actorB = h.host.records.byPid.get(b.pid)!;
    const hp = () => h.host.survival.value(record, V_HEALTH), occupants = () => [h.host.survival.value(actorA, V_HEALTH), h.host.survival.value(actorB, V_HEALTH)];
    if (damaged) h.host.survival.hurt(record, hp() - 50, 0);
    const before = hp(), protectedHealth = occupants(), hurts: number[] = [], hurt = h.host.survival.hurt.bind(h.host.survival);
    h.host.survival.hurt = (rec, points, by, cause, impact) => { const taken = hurt(rec, points, by, cause, impact); if (rec === record && taken > 0) hurts.push(taken); return taken; };
    const wall = h.reg.index.get("core:wall")!;
    for (let x = 34; x <= 112; x += 3) h.world.structs.add(wall, x, 1.5, 70, 0, 0, 10000);
    const v = ents.vrow[car]!;
    ents.vehicleYaw[v] = Math.fround(angle); ents.yaw[car] = Math.round(angle * 65536 / (Math.PI * 2)) & 65535;
    ents.vehicleQx[v] = ents.vehicleQz[v] = 0; ents.vehicleQy[v] = Math.fround(Math.sin(angle / 2)); ents.vehicleQw[v] = Math.fround(Math.cos(angle / 2));
    ents.vx[car] = Math.fround(Math.sin(angle) * speed); ents.vz[car] = Math.fround(Math.cos(angle) * speed);
    h.run(1800);
    expect(occupants()).toEqual(protectedHealth);
    const destroyed = record.dead || h.host.records.entOf.get(record.pid) !== car;
    expect(ents.seat[a.ent]).toBe(destroyed ? 0 : car + 1); expect(ents.seat[b.ent]).toBe(destroyed ? 0 : car + 1);
    return { damage: before - hp(), charges: hurts.length, destroyed, speed: Math.hypot(ents.vx[car]!, ents.vz[car]!) };
  } finally { h.host.shutdown(); }
}

test("car hull damage uses normal impact speed, charges a crash once and protects seated occupants", () => {
  const bump = crash(5, 0), headOn = crash(20, 0), scrape = crash(20, Math.PI * 5 / 12);
  expect(bump.damage).toBe(0); expect(bump.charges).toBe(0);
  expect(headOn.damage).toBeGreaterThan(50); expect(headOn.charges).toBe(1);
  expect(scrape.damage).toBeLessThan(headOn.damage * .2);
  expect(scrape.speed).toBeGreaterThan(5);
});

test("destroying a damaged car in a crash releases both occupants without crash injury", () => {
  const result = crash(20, 0, true);
  expect(result.destroyed).toBe(true); expect(result.charges).toBe(1);
});

for (const height of [1, 3, 8]) test(`a ${height}m car landing ${height < 4 ? "preserves normal-driving health" : "charges hard-landing damage"}`, () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const e = h.host.spawnVehicle("core:compact", 64, 64, 0), a = h.world.ents;
    const rec = h.host.records.byPid.get(a.pid[e]!)!, hurt = h.host.survival.hurt.bind(h.host.survival), charges: number[] = [];
    h.host.survival.hurt = (r, points, by, cause, impact) => { const taken = hurt(r, points, by, cause, impact); if (r === rec && taken > 0) charges.push(taken); return taken; };
    a.setPosition(e, 64, height, 64); a.flags[e] = a.flags[e]! & ~F_GROUNDED;
    h.run(3000);
    expect(a.y[e]!).toBeLessThan(.2);
    if (height < 4) expect(charges).toEqual([]);
    else { expect(charges.length).toBe(1); expect(charges[0]!).toBeGreaterThan(10); }
  } finally { h.host.shutdown(); }
});

for (const speed of [5, 15, 30]) test(`driving a 15cm kerb at ${speed}m/s causes no hull damage`, () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const s = h.join("kerb-driver"); h.run(400);
    const c = h.client(s)!, a = h.world.ents;
    a.setPosition(c.ent, 65.8, 0, 64.12); h.world.history.discontinuity(c.ent);
    const e = h.host.spawnVehicle("core:compact", 64, 64, 0), rec = h.host.records.byPid.get(a.pid[e]!)!;
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1300); expect(c.drive).toBe(e);
    const ceiling = h.reg.index.get("core:ceiling")!;
    h.world.structs.add(ceiling, 64, .15 - h.reg.halfY[ceiling]!, 68, 0, 0, 10000);
    const hurt = h.host.survival.hurt.bind(h.host.survival), charges: number[] = [];
    h.host.survival.hurt = (r, points, by, cause, impact) => { const taken = hurt(r, points, by, cause, impact); if (r === rec && taken > 0) charges.push(taken); return taken; };
    a.vz[e] = speed; h.pilots[0]!.moveZ = 1; h.run(1800);
    expect(a.z[e]!).toBeGreaterThan(71);
    expect(charges).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("queued crash damage cannot injure a replacement vehicle in a recycled recipient slot", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const a = h.world.ents, first = h.host.spawnVehicle("core:compact", 64, 60, 0), second = h.host.spawnVehicle("core:compact", 64, 65, 0, Math.PI);
    const other = h.host.records.byPid.get(a.pid[second]!)!, beforeOther = h.host.survival.value(other, V_HEALTH);
    a.vz[first] = 20; a.vz[second] = -20;
    const contacts = h.host.urban.contacts!;
    contacts.capture(first); contacts.capture(second);
    a.setPosition(first, 64, 0, 60 + 2 / 3); a.setPosition(second, 64, 0, 65 - 2 / 3);
    expect(contacts.step()).toContain(first);
    expect(h.host.survival.value(other, V_HEALTH)).toBe(beforeOther); // Still queued at the contact boundary.
    h.host.creatures.remove(first);
    // The entity store reuses slots FIFO. Cycle the other free slots through its public API.
    const fillerKind = h.reg.index.get("core:dodo")!;
    for (let i = 2; i < a.cap; i++) {
      const filler = a.create(fillerKind, 10, 0, 10, 0);
      expect(filler).not.toBe(first); a.destroy(filler);
    }
    const replacement = h.host.spawnVehicle("core:compact", 30, 30, 0);
    expect(replacement).toBe(first);
    const rec = h.host.records.byPid.get(a.pid[replacement]!)!, v = a.vrow[replacement]!;
    const health = h.host.survival.value(rec, V_HEALTH), engine = a.vehicleEngineCondition[v]!, hull = a.vehicleHullCondition[v]!;
    h.world.tick++; h.host.urban.beforeStep();
    expect(h.host.survival.value(other, V_HEALTH)).toBeLessThan(beforeOther); // The original other recipient is still charged.
    expect(h.host.survival.value(rec, V_HEALTH)).toBe(health);
    expect(a.vehicleEngineCondition[v]).toBe(engine); expect(a.vehicleHullCondition[v]).toBe(hull);
  } finally { h.host.shutdown(); }
});
