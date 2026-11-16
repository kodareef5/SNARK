import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BOAT_ART } from "../../content/vehicles/boat-art.ts";
import { makeHandle } from "../../shared/ids.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { RESULT_BUSY, RESULT_FAR, RESULT_INVALID, RESULT_NO_SUPPORT, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, VEHICLE_DEPLOY } from "../../shared/net/protocol.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { boatMeetsCapsule } from "../../shared/world/boat.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { foundVehicle, VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const MAP = writeMap(flatMap(2, { seaLevel: 3 }));
function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: MAP });
  const session = h.join("boat-mechanic"); h.run(400);
  const c = h.client(session)!, actor = h.host.records.byPid.get(c.pid)!;
  h.world.ents.setPosition(c.ent, 56, 1.65, 64);
  const def = h.reg.vehicle[h.reg.index.get("core:boat")!]!;
  if (!isBoatVehicle(def)) throw new Error("boat definition missing");
  return { h, c, actor, session, def, y: boatRestY(def.spec, 3) };
}

test("boat assembly requires real depth and exact waterline, spends once, and rejects occupied or malformed requests", () => {
  const { h, c, actor, y } = setup();
  try {
    const kit = h.reg.index.get("core:boat_assembly")!, inv = h.host.items.inv(actor);
    h.host.items.mint(actor, kit, 1); const slot = inv.item.indexOf(kit);
    expect(h.host.vehicles.deploy(c, slot, 64, y + 1, 64, 0)).toBe(RESULT_NO_SUPPORT);
    const w = new BitWriter(32); w.u8(VEHICLE_DEPLOY); w.u8(slot); w.f32(64);
    expect(h.host.vehicles.command(c, new BitReader(w.bytes()))).toBe(RESULT_INVALID);
    expect(inv.total(kit)).toBe(1);
    h.world.hf.seaLevel = .2;
    expect(h.host.vehicles.deploy(c, slot, 64, .2 - (3 - y), 64, 0)).toBe(RESULT_NO_SUPPORT);
    expect(inv.total(kit)).toBe(1); h.world.hf.seaLevel = 3;
    expect(h.host.vehicles.deploy(c, slot, 64, y, 64, 0)).toBe(RESULT_OK);
    expect(inv.total(kit)).toBe(0);
    const boat = [...h.host.records.byPid.values()].find(r => h.reg.ids[r.kind] === "core:boat")!, e = h.host.records.entOf.get(boat.pid)!;
    expect(boat.team).toBe(actor.team); expect(h.world.ents.fuel[e]).toBe(0); expect(h.world.ents.vehicleHullCondition[e]).toBe(1);
    h.host.items.mint(actor, kit, 1);
    expect(h.host.vehicles.deploy(c, slot, 65, y, 64, 0)).toBe(RESULT_NO_SUPPORT);
    expect(inv.total(kit)).toBe(1); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("a swimmer services a stable floating boat without ground contact; motion, running engine, ownership and stale handles reject spending", () => {
  const { h, c, actor, def } = setup();
  try {
    const e = h.host.spawnVehicle("core:boat", 61, 64, actor.team, 0, { fuel: .1, hull: .5, engine: .4 });
    expect(e).toBeGreaterThanOrEqual(0);
    const ents = h.world.ents, rec = h.host.records.byPid.get(ents.pid[e]!)!, handle = makeHandle(e, ents.gen[e]!);
    const fuel = h.reg.index.get("core:gasoline")!, ingot = h.reg.index.get("core:ingot")!;
    expect(ents.flags[e]! & F_GROUNDED).toBe(0);
    h.host.items.mint(actor, fuel, 2);
    expect(h.host.vehicles.refuel(c, handle, 1)).toBe(RESULT_OK);
    expect(ents.fuel[e]).toBeCloseTo(def.spec.fuelCapacity * .1 + 5, 5);
    ents.vehicleEngineOn[e] = 1;
    expect(h.host.vehicles.refuel(c, handle, 1)).toBe(RESULT_BUSY);
    ents.vehicleEngineOn[e] = 0; ents.vz[e] = .4;
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_BUSY);
    ents.vz[e] = 0; ents.vehicleFlooding[e] = .2;
    h.host.items.mint(actor, ingot, 40);
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_SHORT);
    expect(h.host.items.inv(actor).total(ingot)).toBe(40);
    h.host.items.mint(actor, h.reg.index.get("core:polymer")!, 10);
    h.host.items.mint(actor, h.reg.index.get("core:electronics")!, 8);
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_OK);
    expect(ents.vehicleEngineCondition[e]).toBeCloseTo(.65, 5);
    expect(ents.vehicleHullCondition[e]).toBeCloseTo(.75, 5); expect(ents.vehicleFlooding[e]).toBe(0);
    expect(h.host.vehicles.refuel(c, makeHandle(e, ents.gen[e]! + 1))).toBe(RESULT_INVALID);
    h.host.setSetting("serverPVE", "True"); rec.team = actor.team + 20;
    expect(h.host.vehicles.refuel(c, handle)).toBe(RESULT_NOT_YOURS);
    rec.team = actor.team; ents.setPosition(c.ent, 95, 1.65, 64);
    expect(h.host.vehicles.refuel(c, handle)).toBe(RESULT_FAR);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("four swimmers share the ladder, fill distinct seats, and leave safely at the water surface", () => {
  const { h, c, actor, session } = setup();
  try {
    const crew = [session, h.join("boat-two"), h.join("boat-three"), h.join("boat-four")]; h.run(400);
    const ents = h.world.ents;
    for (let i = 0; i < crew.length; i++) ents.setPosition(h.client(crew[i]!)!.ent, 90 + i * 3, 1.65, 90);
    const e = h.host.spawnVehicle("core:boat", 62, 64, actor.team), pid = ents.pid[e]!;
    expect(e).toBeGreaterThanOrEqual(0);
    const anchor = BOAT_ART.anchors.boarding_water;
    for (let i = 0; i < crew.length; i++) {
      const client = h.client(crew[i]!)!;
      ents.setPosition(client.ent, 62 + anchor[0], 1.65, 64 + anchor[2]); ents.mode[client.ent] = MODE_SWIM;
      expect(h.host.urban.mount(client, e)).toBe(RESULT_OK); h.run(1400);
      expect(ents.seatSlot[client.ent]).toBe(i + 1);
      expect(h.host.urban.occupancy.seatOf(client.pid)?.host).toBe(pid);
    }
    expect(c.drive).toBe(e);
    for (const member of crew) {
      const client = h.client(member)!;
      h.host.urban.dismount(client); h.run(1400);
      expect(ents.seat[client.ent]).toBe(0); expect(client.drive).toBe(-1); expect(ents.mode[client.ent]).toBe(MODE_SWIM);
      expect(ents.y[client.ent]!).toBeGreaterThan(1); expect(ents.y[client.ent]!).toBeLessThan(2);
      // Clear the shared landing before the next passenger climbs down.
      ents.setPosition(client.ent, 90, 1.65, 90);
    }
  } finally { h.host.shutdown(); }
});

for (const inverted of [true, false]) test(`crew can escape a moving ${inverted ? "capsized" : "flooding"} boat into clear water, while new boarding is refused`, () => {
  const { h, c, actor, def } = setup();
  try {
    const visitor = h.join("boat-rescuer"); h.run(400);
    const ents = h.world.ents, guest = h.client(visitor)!;
    ents.setPosition(guest.ent, 95, 1.65, 95);
    const e = h.host.spawnVehicle("core:boat", 62, 64, actor.team), anchor = BOAT_ART.anchors.boarding_water;
    ents.setPosition(c.ent, 62 + anchor[0], 1.65, 64 + anchor[2]);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1400); expect(c.drive).toBe(e);
    ents.vehicleQz[e] = inverted ? 1 : 0; ents.vehicleQw[e] = inverted ? 0 : 1;
    ents.vehicleRoll[e] = inverted ? Math.PI : 0; ents.vehicleFlooding[e] = inverted ? 0 : .65;
    h.host.urban.syncAfterContact(e);
    ents.setPosition(guest.ent, 62 + anchor[0], 1.65, 64 + anchor[2]);
    expect(h.host.urban.mount(guest, e)).not.toBe(RESULT_OK);
    ents.vx[e] = 2; ents.vy[e] = -.1;
    // Commit through the real seat authority before motion changes this deliberately distressed pose.
    h.host.urban.dismount(c); h.world.tick += 45; h.host.urban.beforeStep();
    expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0); expect(ents.mode[c.ent]).toBe(MODE_SWIM);
    expect([ents.vx[c.ent], ents.vy[c.ent], ents.vz[c.ent]]).toEqual([2, Math.fround(-.1), 0]);
    expect(ents.y[c.ent]!).toBeGreaterThan(1); expect(ents.y[c.ent]!).toBeLessThan(2);
    const move = h.reg.move[ents.kind[c.ent]!]!;
    expect(boatMeetsCapsule(def, { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: 0, pitch: 0, roll: ents.vehicleRoll[e]!,
      qx: 0, qy: 0, qz: ents.vehicleQz[e]!, qw: ents.vehicleQw[e]! }, ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, move.radius, move.height)).toBeNull();
    expect(ents.seat[guest.ent]).toBe(0);
    h.run(1200); expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0);
  } finally { h.host.shutdown(); }
});

test("an emergency boat exit rechecks its path at commit and cannot place the swimmer through new obstructions", () => {
  const { h, c, actor } = setup();
  try {
    const ents = h.world.ents, e = h.host.spawnVehicle("core:boat", 62, 64, actor.team), anchor = BOAT_ART.anchors.boarding_water;
    ents.setPosition(c.ent, 62 + anchor[0], 1.65, 64 + anchor[2]);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1400);
    ents.vehicleQz[e] = 1; ents.vehicleQw[e] = 0; ents.vehicleRoll[e] = Math.PI;
    h.host.urban.syncAfterContact(e); h.host.urban.dismount(c);
    const before = [ents.x[c.ent], ents.y[c.ent], ents.z[c.ent]], ceiling = h.reg.index.get("core:ceiling")!;
    for (let x = -6; x <= 6; x += 3) for (let z = -6; z <= 6; z += 3) h.world.structs.add(ceiling, 62 + x, 3, 64 + z, 0, 0, 100);
    h.world.tick += 45; h.host.urban.beforeStep();
    expect(c.drive).toBe(e); expect(ents.seat[c.ent]).toBe(e + 1);
    expect([ents.x[c.ent], ents.y[c.ent], ents.z[c.ent]]).toEqual(before);
  } finally { h.host.shutdown(); }
});

test("found boats keep condition, flooding, cargo and origin across SQLite reload without duplicating their placement", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-boat-save-")), dbPath = join(dir, "world.db");
  const placement = { kind: "core:boat_police", id: "police-berth", x: 42, z: 42, yaw: 16384, condition: [.3, .85] as const, fuel: [.1, .5] as const };
  const map = writeMap(flatMap(2, { seaLevel: 3, vehicles: [placement] }));
  let h: Harness | null = null;
  try {
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const record = [...h.host.records.byPid.values()].find(r => h!.reg.ids[r.kind] === placement.kind)!, pid = record.pid;
    const e = h.host.records.entOf.get(pid)!, ents = h.world.ents, rolled = foundVehicle("test:flat", placement, 1);
    expect(ents.vehicleEngineCondition[e]).toBeCloseTo(rolled.engine!, 6);
    const stone = h.reg.index.get("core:stone")!; h.host.items.mint(record, stone, 17);
    ents.vehicleFlooding[e] = .17; ents.vehicleEngineOn[e] = 1; ents.vehicleGear[e] = -1; ents.vehicleRpm[e] = 1800;
    ents.vx[e] = 2; ents.vz[e] = -1; h.host.urban.changed(e);
    const fuel = ents.fuel[e]!, engine = ents.vehicleEngineCondition[e]!, health = h.host.survival.value(record, V_HEALTH);
    h.host.shutdown(); h = null;
    h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const saved = h.host.records.byPid.get(pid)!, restored = h.host.records.entOf.get(pid)!, out = h.world.ents;
    expect([...h.host.records.byPid.values()].filter(r => h!.reg.ids[r.kind] === placement.kind)).toHaveLength(1);
    expect(new TextDecoder().decode(saved.extra.get(VEHICLE_ORIGIN))).toBe("test:flat/police-berth");
    expect(out.vehicleFlooding[restored]).toBeCloseTo(.17, 6); expect(out.vehicleGear[restored]).toBe(-1);
    expect(out.vehicleEngineOn[restored]).toBe(1); expect(out.vehicleRpm[restored]).toBe(1800);
    expect([out.vx[restored], out.vz[restored], out.fuel[restored], out.vehicleEngineCondition[restored]]).toEqual([2, -1, fuel, engine]);
    expect(h.host.survival.value(saved, V_HEALTH)).toBe(health); expect(h.host.items.inv(saved).total(stone)).toBe(17);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("a shore shove adds bounded momentum without moving the boat, and rejects repeated or uphill recovery", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:boat", 62, 64, actor.team), ents = h.world.ents;
    const handle = makeHandle(e, ents.gen[e]!), hf = h.world.hf;
    for (let row = 0; row < hf.nz; row++) for (let col = 0; col < hf.nx; col++) hf.setSample(col, row, Math.max(0, Math.min(3.2, (62 - col * hf.cell) * .4)));
    ents.setPosition(e, 55, 3.2, 64); ents.flags[e] = ents.flags[e]! | F_GROUNDED;
    ents.setPosition(c.ent, 52.5, 3.2, 64);
    const before = [ents.x[e], ents.y[e], ents.z[e]];
    expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_OK);
    expect([ents.x[e], ents.y[e], ents.z[e]]).toEqual(before);
    expect(ents.vx[e]!).toBeGreaterThan(0); expect(ents.vx[e]!).toBeLessThanOrEqual(1.25); expect(ents.vz[e]).toBe(0);
    expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_BUSY);
    ents.vx[e] = 0; h.world.tick += 91;
    ents.setPosition(c.ent, 57.5, 3.2, 64);
    expect(h.host.vehicles.recover(c, handle)).toBe(RESULT_NO_SUPPORT);
    expect([ents.x[e], ents.y[e], ents.z[e]]).toEqual(before);
  } finally { h.host.shutdown(); }
});

test("destroying a loaded boat releases its swimmer crew and preserves cargo in a sinking native salvage wreck", () => {
  const { h, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:boat", 62, 64, actor.team), ents = h.world.ents;
    const rec = h.host.records.byPid.get(ents.pid[e]!)!, cargo = h.reg.index.get("core:ingot")!;
    h.host.items.mint(rec, cargo, 13);
    const anchor = BOAT_ART.anchors.boarding_water;
    ents.setPosition(c.ent, 62 + anchor[0], 1.65, 64 + anchor[2]);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1400); expect(c.drive).toBe(e);
    const y = ents.y[e]!; ents.vehicleFlooding[e] = .17;
    h.host.survival.hurt(rec, 1e6, 0); h.run(100);
    expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0);
    expect(ents.mode[c.ent]).toBe(MODE_SWIM); expect(ents.z[c.ent]!).toBeLessThan(60.5);
    const wreck = [...h.host.corpses.bodies.values()].find(b => h.reg.ids[b.kind] === "core:boat")!;
    expect(wreck.wreck).toBeDefined(); expect(h.host.items.inv(wreck.rec).total(cargo)).toBe(13);
    expect(ents.vehicleFlooding[wreck.e]!).toBeGreaterThanOrEqual(.17); expect(ents.vehicleFlooding[wreck.e]!).toBeLessThan(.2);
    h.run(3000); expect(wreck.y).toBeLessThan(y);
    const handle = makeHandle(wreck.e, ents.gen[wreck.e]!);
    ents.setPosition(c.ent, wreck.x + 3, 1.65, wreck.z);
    expect(h.host.vehicles.refuel(c, handle)).toBe(RESULT_INVALID); expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_INVALID);
    const before = h.host.items.inv(actor).total(cargo);
    expect(h.host.corpses.struck(actor, wreck.e, 1e6, h.reg.index.get("core:pick")!)).toBe(true);
    expect(h.host.corpses.bodies.has(wreck.rec.pid)).toBe(false);
    expect(h.host.items.inv(actor).total(cargo)).toBeGreaterThan(before); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
