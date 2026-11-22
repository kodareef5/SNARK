import { vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { RESULT_BUSY, RESULT_FAR, RESULT_INVALID, RESULT_NO_SUPPORT, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, VEHICLE_DEPLOY } from "../../shared/net/protocol.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { foundVehicle, VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const MAP = writeMap(flatMap(2));
function setup(dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: MAP, dbPath });
  const session = h.join("mechanic"); h.run(400);
  const c = h.client(session)!, actor = h.host.records.byPid.get(c.pid)!;
  h.world.ents.setPosition(c.ent, 58, 0, 64);
  return { h, c, actor };
}

test("an assembly consumes exactly once after legal placement, while unsupported, occupied and malformed requests spend nothing", () => {
  const { h, c, actor } = setup();
  try {
    const kit = h.reg.index.get("core:helicopter_assembly")!, inv = h.host.items.inv(actor);
    h.host.items.mint(actor, kit, 1);
    const slot = inv.item.indexOf(kit);
    expect(h.host.vehicles.deploy(c, slot, 66, 4, 64, 0)).toBe(RESULT_NO_SUPPORT);
    expect(inv.total(kit)).toBe(1);
    const w = new BitWriter(32); w.u8(VEHICLE_DEPLOY); w.u8(slot); w.f32(66);
    expect(h.host.vehicles.command(c, new BitReader(w.bytes()))).toBe(RESULT_INVALID);
    expect(inv.total(kit)).toBe(1);
    expect(h.host.vehicles.deploy(c, slot, 66, 0, 64, 0)).toBe(RESULT_OK);
    expect(inv.total(kit)).toBe(0);
    const heli = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === "core:helicopter")!;
    const e = h.host.records.entOf.get(heli.pid)!;
    expect(heli.team).toBe(actor.team); expect(h.world.ents.fuel[h.world.ents.vrow[e]!]).toBe(0);
    expect(h.world.ents.vehicleEngineCondition[h.world.ents.vrow[e]!]).toBe(1);
    expect(h.host.vehicles.deploy(c, slot, 66, 0, 64, 0)).toBe(RESULT_INVALID);
    h.host.items.mint(actor, kit, 1);
    expect(h.host.vehicles.deploy(c, slot, 67, 0, 64, 0)).toBe(RESULT_NO_SUPPORT);
    expect(inv.total(kit)).toBe(1); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("gmsummon parks a helicopter for the tribe, fuelled; driver parks one with a civilian getting in as its pilot", () => {
  const { h, c, actor } = setup();
  try {
    const session = h.sessions[0]!, ents = h.world.ents, heli = h.reg.index.get("core:helicopter")!;
    h.say(session, "enablecheats");
    expect(h.say(session, "gmsummon helicopter")[0]).toMatch(/^summoned core:helicopter \d+ m ahead, your tribe's$/);
    const mine = [...h.host.records.byPid.values()].find(r => r.kind === heli)!, e = h.host.records.entOf.get(mine.pid)!;
    expect(mine.team).toBe(actor.team);
    expect(ents.fuel[ents.vrow[e]!]).toBe(h.reg.vehicle[heli]!.spec.fuelCapacity);
    ents.setPosition(c.ent, ents.x[e]! + 30, 0, ents.z[e]!);
    expect(h.say(session, "driver helicopter")[0]).toMatch(/^spawned core:helicopter \d+ m ahead, a civilian getting in at its wheel$/);
    h.run(1500);
    const pilot = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === "core:civilian")!;
    const flown = [...h.host.records.byPid.values()].find(r => r.kind === heli && r.team === 0)!;
    expect(h.host.urban.occupancy.occupant(flown.pid, "pilot")).toBe(pilot.pid);
  } finally { h.host.shutdown(); }
});

test("maintenance requires a stopped authorized nearby aircraft and preserves the inventory ledger", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, actor.team, 0, { fuel: .1, hull: .5, engine: .4, rotor: .3 });
    expect(e).toBeGreaterThanOrEqual(0);
    const ents = h.world.ents, rec = h.host.records.byPid.get(ents.pid[e]!)!, handle = makeHandle(e, ents.gen[e]!);
    const fuel = h.reg.index.get("core:gasoline")!, ingot = h.reg.index.get("core:ingot")!;
    h.host.items.mint(actor, fuel, 2);
    expect(h.host.vehicles.refuel(c, handle, 1)).toBe(RESULT_OK);
    expect(ents.fuel[ents.vrow[e]!]).toBe(15); expect(h.host.items.inv(actor).total(fuel)).toBe(1);
    ents.vehicleEngineOn[ents.vrow[e]!] = 1;
    expect(h.host.vehicles.refuel(c, handle)).toBe(RESULT_BUSY);
    ents.vehicleEngineOn[ents.vrow[e]!] = 0; ents.vehicleRotorRpm[ents.vrow[e]!] = 60;
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_BUSY);
    ents.vehicleRotorRpm[ents.vrow[e]!] = 0;
    h.host.items.mint(actor, ingot, 40);
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_SHORT);
    expect(h.host.items.inv(actor).total(ingot)).toBe(40);
    h.host.items.mint(actor, h.reg.index.get("core:polymer")!, 10);
    h.host.items.mint(actor, h.reg.index.get("core:electronics")!, 8);
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_OK);
    expect(h.host.survival.value(rec, V_HEALTH)).toBeCloseTo(1050, 4);
    expect(ents.vehicleEngineCondition[ents.vrow[e]!]).toBeCloseTo(.65, 5);
    expect(ents.vehicleRotorCondition[ents.vrow[e]!]).toBeCloseTo(.55, 5);
    expect(h.host.items.inv(actor).total(ingot)).toBe(0);
    expect(h.host.vehicles.refuel(c, makeHandle(e, ents.gen[e]! + 1))).toBe(RESULT_INVALID);
    h.host.setSetting("serverPVE", "True"); rec.team = actor.team + 20;
    expect(h.host.vehicles.refuel(c, handle)).toBe(RESULT_NOT_YOURS);
    rec.team = actor.team; ents.setPosition(c.ent, 90, 0, 64);
    expect(h.host.vehicles.refuel(c, handle)).toBe(RESULT_FAR);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("found condition and full inverted attitude survive SQLite reload without rerolling or duplicating the aircraft", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-heli-save-")), dbPath = join(dir, "world.db");
  const placement = { kind: "core:helicopter_police", id: "police-yard", x: 42, z: 42, yaw: 16384, condition: [.25, .85] as const, fuel: [.1, .5] as const };
  const map = writeMap(flatMap(2, { vehicles: [placement] }));
  let h: Harness | null = null;
  try {
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const record = [...h.host.records.byPid.values()].find(r => h!.reg.ids[r.kind] === placement.kind)!, pid = record.pid;
    const e = h.host.records.entOf.get(pid)!, ents = h.world.ents;
    const rolled = foundVehicle("test:flat", placement, 1);
    expect(ents.vehicleEngineCondition[ents.vrow[e]!]).toBeCloseTo(rolled.engine!, 6);
    expect(ents.fuel[ents.vrow[e]!]).toBeCloseTo(rolled.fuel! * 100, 5);
    expect(new TextDecoder().decode(record.extra.get(VEHICLE_ORIGIN))).toBe("test:flat/police-yard");
    ents.setPosition(e, 42, 25, 42); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vehicleQx[ents.vrow[e]!] = 1; ents.vehicleQy[ents.vrow[e]!] = ents.vehicleQz[ents.vrow[e]!] = ents.vehicleQw[ents.vrow[e]!] = 0;
    ents.vehiclePitch[ents.vrow[e]!] = Math.PI; ents.vx[e] = 75; ents.vy[e] = -85; ents.vz[e] = 64;
    ents.vehicleRotorRpm[ents.vrow[e]!] = 250; ents.vehicleRotorPhase[ents.vrow[e]!] = .8; ents.vehicleCollective[ents.vrow[e]!] = .7;
    h.host.urban.changed(e);
    const fuel = ents.fuel[ents.vrow[e]!]!, engine = ents.vehicleEngineCondition[ents.vrow[e]!]!;
    h.host.shutdown(); h = null;
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const restored = h.host.records.entOf.get(pid)!, out = h.world.ents;
    expect([...h.host.records.byPid.values()].filter(r => h!.reg.ids[r.kind] === placement.kind)).toHaveLength(1);
    expect(out.vehicleQx[out.vrow[restored]!]).toBe(1); expect(out.vehicleQw[out.vrow[restored]!]).toBe(0);
    expect(Math.abs(out.vehiclePitch[out.vrow[restored]!]!)).toBeCloseTo(Math.PI, 6);
    expect([out.vx[restored], out.vy[restored], out.vz[restored]]).toEqual([75, -85, 64]);
    expect(out.vehicleCollective[out.vrow[restored]!]).toBeCloseTo(.7, 6);
    expect(out.vehicleEngineCondition[out.vrow[restored]!]).toBe(engine); expect(out.fuel[out.vrow[restored]!]).toBe(fuel);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("destroyed aircraft retain cargo in the native falling salvage wreck and release their occupants", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, actor.team), ents = h.world.ents;
    expect(e).toBeGreaterThanOrEqual(0);
    const rec = h.host.records.byPid.get(ents.pid[e]!)!, cargo = h.reg.index.get("core:ingot")!;
    h.host.items.mint(rec, cargo, 13);
    ents.setPosition(c.ent, 63.85, 0, 64.65);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1000);
    expect(c.drive).toBe(e);
    ents.setPosition(e, 62, 30, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vx[e] = 3; ents.vy[e] = -4;
    h.host.urban.changed(e);
    h.host.survival.hurt(rec, 1e6, 0);
    h.run(50);
    expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0);
    const wreck = [...h.host.corpses.bodies.values()].find(b => h.reg.ids[b.kind] === "core:helicopter")!;
    expect(wreck).toBeDefined(); expect(wreck.drop).not.toBeNull();
    expect(h.host.items.inv(wreck.rec).total(cargo)).toBe(13);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("an authored rooftop height is respected and static impact reports use the damage threshold", () => {
  const { h, actor } = setup();
  try {
    const ceiling = h.reg.index.get("core:ceiling")!, y = 8 + h.reg.halfY[ceiling]!;
    for (let x = -3; x <= 3; x += 3) for (let z = -3; z <= 3; z += 3) h.world.structs.add(ceiling, 35 + x, 8, 35 + z, 0, 0, 100);
    const e = h.host.spawnVehicle("core:helicopter_rescue", 35, 35, actor.team, 0, { y });
    expect(e).toBeGreaterThanOrEqual(0);
    const ents = h.world.ents, rec = h.host.records.byPid.get(ents.pid[e]!)!, health = h.host.survival.value(rec, V_HEALTH);
    expect(ents.y[e]).toBeCloseTo(y, 4);
    vehicleStep.impactSpeed = 2; vehicleStep.landSpeed = 0; vehicleStep.rotorHit = vehicleStep.propHit = vehicleStep.water = false;
    h.host.urban.impact(e); h.host.urban.step();
    expect(h.host.survival.value(rec, V_HEALTH)).toBe(health);
    expect(ents.vehicleEngineCondition[ents.vrow[e]!]).toBe(1); expect(ents.vehicleRotorCondition[ents.vrow[e]!]).toBe(1);
    vehicleStep.impactSpeed = 12;
    h.host.urban.impact(e); h.host.urban.step();
    expect(h.host.survival.value(rec, V_HEALTH)).toBeLessThan(health);
    expect(ents.vehicleEngineCondition[ents.vrow[e]!]).toBeLessThan(1);
  } finally { h.host.shutdown(); }
});

test("aircraft contacts respect altitude and seated crew while solid cabin impacts use native combat", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, actor.team), ents = h.world.ents;
    expect(e).toBeGreaterThanOrEqual(0);
    ents.setPosition(c.ent, 63.85, 0, 64.65);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1000);
    const target = h.host.spawnCreature("core:civilian", 64, 64, 1);
    expect(target).toBeGreaterThanOrEqual(0);
    const victim = h.host.records.byPid.get(ents.pid[target]!)!, health = h.host.survival.value(victim, V_HEALTH);
    const contacts = h.host.urban.contacts!, before = contacts.contacts;
    ents.setPosition(e, 62, 10, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    contacts.capture(e); ents.setPosition(e, 63, 10, 64); contacts.step();
    expect(h.host.survival.value(victim, V_HEALTH)).toBe(health);
    expect(contacts.contacts).toBe(before);
    ents.setPosition(target, 64, 10.8, 64); h.world.history.untrack(target); h.world.history.track(target);
    ents.setPosition(e, 62, 10, 64); contacts.capture(e);
    ents.setPosition(e, 63, 10, 64); ents.vx[e] = 30;
    contacts.step();
    expect(contacts.contacts).toBe(before + 1);
    expect(h.host.survival.value(victim, V_HEALTH)).toBeLessThan(health);
    expect(ents.x[e]!).toBeLessThan(63);
    expect(ents.seat[c.ent]).toBe(e + 1);
  } finally { h.host.shutdown(); }
});

test("parking reserves the complete rotor discs of both aircraft", () => {
  const { h, actor } = setup();
  try {
    expect(h.host.spawnVehicle("core:helicopter", 62, 64, actor.team)).toBeGreaterThanOrEqual(0);
    // Cabins do not meet here; the two main rotors do. Neither a found placement nor a kit may create this overlap.
    expect(h.host.spawnVehicle("core:helicopter_police", 68, 64, actor.team)).toBe(-1);
    expect(h.host.spawnVehicle("core:helicopter_police", 72, 64, actor.team)).toBeGreaterThanOrEqual(0);
  } finally { h.host.shutdown(); }
});

test("an actor striking a parked hull transfers actor momentum instead of a full-aircraft crash impulse", () => {
  const { h, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, actor.team), ents = h.world.ents;
    const target = h.host.spawnCreature("core:civilian", 63.9, 64.6, 1);
    ents.setPosition(target, 63.9, .2, 64.6); h.world.history.untrack(target); h.world.history.track(target);
    const rec = h.host.records.byPid.get(ents.pid[e]!)!, health = h.host.survival.value(rec, V_HEALTH), contacts = h.host.urban.contacts!;
    contacts.capture(e); ents.setPosition(target, 63.3, .2, 64.6); ents.vx[target] = -36;
    expect(contacts.step()).toContain(e); h.host.urban.step();
    expect(h.host.survival.value(rec, V_HEALTH)).toBe(health);
    expect(ents.vehicleEngineCondition[ents.vrow[e]!]).toBe(1);
    expect(ents.flags[e]! & F_GROUNDED).not.toBe(0);
  } finally { h.host.shutdown(); }
});

test("a disconnected pilot releases control while the healthy aircraft lands with its remaining passenger attached", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, actor.team), ents = h.world.ents;
    ents.setPosition(c.ent, 63.85, 0, 64.65);
    const passenger = h.host.spawnCreature("core:civilian", 60.25, 64.65, 1);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
    expect(h.host.urban.seatNpc(passenger, e, "front")).toBe(RESULT_OK); h.run(1000);
    expect(c.drive).toBe(e); expect(ents.seatSlot[passenger]).toBe(2);
    ents.setPosition(e, 62, 12, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vehicleRotorRpm[ents.vrow[e]!] = 410; ents.vehicleEngineOn[ents.vrow[e]!] = 1; ents.vehicleCollective[ents.vrow[e]!] = .6;
    h.host.urban.syncAfterContact(e);
    h.ends[0]!.close(); h.run(250);
    expect(c.drive).toBe(-1);
    h.run(16000);
    expect(ents.y[e]!).toBeLessThan(.08); expect(ents.flags[e]! & F_GROUNDED).not.toBe(0);
    expect(ents.vehicleEngineOn[ents.vrow[e]!]).toBe(0); expect(ents.vehicleRotorRpm[ents.vrow[e]!]).toBe(0);
    expect(ents.seat[passenger]).toBe(e + 1); expect(ents.seatSlot[passenger]).toBe(2);
    expect(h.host.survival.value(h.host.records.byPid.get(ents.pid[e]!)!, V_HEALTH)).toBeGreaterThan(1300);
  } finally { h.host.shutdown(); }
});

test("a failed rotor crash enters native wreck recovery without leaving an occupant attached to its recycled entity", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, actor.team), ents = h.world.ents, pid = ents.pid[e]!;
    ents.setPosition(c.ent, 63.85, 0, 64.65);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1000);
    ents.setPosition(e, 62, 30, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vehicleEngineCondition[ents.vrow[e]!] = 0; ents.vehicleRotorCondition[ents.vrow[e]!] = 0; ents.fuel[ents.vrow[e]!] = 0;
    h.host.urban.syncAfterContact(e); h.run(6000);
    expect(h.host.records.entOf.has(pid)).toBe(false);
    expect(c.drive).toBe(-1); if (c.ent >= 0) expect(ents.seat[c.ent]).toBe(0);
    expect([...h.host.corpses.bodies.values()].some(b => h.reg.ids[b.kind] === "core:helicopter")).toBe(true);
    expect(h.host.urban.occupancy.seatOf(c.pid)).toBeNull();
  } finally { h.host.shutdown(); }
});
