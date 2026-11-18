import { expect, test } from "bun:test";
import { Past } from "../../server/history.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { defaultLook, LOOK_REGIONS } from "../../shared/anim/look.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_NONE, stanceEye } from "../../shared/sim/character.ts";
import { V_HEALTH, V_OXYGEN } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function riding() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  const session = h.join("host-rider"); h.run(400);
  const c = h.client(session)!, { ents, reg } = h.world, rider = h.host.records.byPid.get(c.pid)!;
  const e = h.host.spawnCreature("core:parasaur", 70, 65, 1), mount = h.host.records.byPid.get(ents.pid[e]!)!;
  mount.team = rider.team; mount.saddle = reg.index.get("core:saddle_parasaur")!;
  h.host.refreshBody(mount); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
  ents.setPosition(c.ent, 68, 0, 65);
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK); h.run(180);
  expect(h.host.riding.riding(c)).toBe(true);
  // The course controls the host height; freeze locomotion while the real host still runs oxygen, contacts and pins.
  ents.mode[e] = MODE_NONE;
  return { h, c, e, rider, mount, ents };
}

test("host oxygen uses the current saddle head across the waterline before the old rider proxy is repinned", () => {
  const { h, c, e, rider, ents } = riding();
  try {
    const sv = h.host.survival, eye = new Float64Array(3);
    expect(h.host.riding.eye(c.ent, eye)).toBe(true);
    const proxy = ents.y[c.ent]! + stanceEye(h.reg.move[c.kind]!, ents.stance[c.ent]!);
    expect(Math.abs(eye[1]! - proxy)).toBeGreaterThan(.1);
    h.world.hf.seaLevel = (eye[1]! + proxy) * .5;
    h.server.tick();
    expect(sv.isSubmerged(rider)).toBe(eye[1]! < h.world.hf.seaLevel);
    h.world.hf.seaLevel = eye[1]! + .2;
    for (let tick = 0; tick < 6; tick++) h.server.tick();
    expect(sv.isSubmerged(rider)).toBe(true);
    const submergedOxygen = sv.value(rider, V_OXYGEN);
    expect(submergedOxygen).toBeLessThan(rider.vitals!.max[V_OXYGEN]! / 1e6);
    // The mount has surfaced this tick; its rider still has the previous underwater feet until the later pin.
    ents.setPosition(e, ents.x[e]!, ents.y[e]! + 2, ents.z[e]!);
    expect(ents.y[c.ent]! + stanceEye(h.reg.move[c.kind]!, ents.stance[c.ent]!)).toBeLessThan(h.world.hf.seaLevel);
    h.server.tick();
    expect(sv.isSubmerged(rider)).toBe(false);
    for (let tick = 0; tick < 3; tick++) h.server.tick();
    expect(sv.value(rider, V_OXYGEN)).toBeGreaterThan(submergedOxygen);
    expect(sv.value(rider, V_HEALTH)).toBe(100);
  } finally { h.host.shutdown(); }
});

test("host keeps its pre-combat saddle pin, refreshes a contact-reported mount, then records the refreshed rider", () => {
  const { h, c, e, ents } = riding();
  const contacts = h.host.urban.contacts!, oldContacts = contacts.step, oldCombat = h.host.combat.step;
  try {
    let preCombat = false, contactStage = false;
    const startX = ents.x[c.ent]!, startY = ents.y[c.ent]!;
    ents.setPosition(e, ents.x[e]! + 1, ents.y[e]!, ents.z[e]!);
    h.host.combat.step = () => {
      expect(ents.x[c.ent]! - startX).toBeCloseTo(1, 5);
      preCombat = true;
      oldCombat.call(h.host.combat);
    };
    // Controlled contact producer isolates the host's ordering from the chassis/contact solver's separate course.
    contacts.step = () => {
      expect(preCombat).toBe(true);
      ents.setPosition(e, ents.x[e]! + .8, ents.y[e]! + .2, ents.z[e]!);
      ents.vx[e] = 3;
      contactStage = true;
      return [e];
    };
    h.server.tick();
    expect(contactStage).toBe(true);
    expect(ents.x[c.ent]! - startX).toBeCloseTo(1.8, 4);
    expect(ents.y[c.ent]! - startY).toBeCloseTo(.2, 4);
    expect(ents.vx[c.ent]).toBe(3);
    expect(ents.seat[c.ent]).toBe(e + 1);
    const recorded = new Past();
    expect(h.world.history.at(h.world.tick, c.ent, recorded)).toBe(true);
    expect(recorded.x).toBe(ents.x[c.ent]!);
    expect(recorded.hostX).toBe(ents.x[e]!);
  } finally {
    contacts.step = oldContacts; h.host.combat.step = oldCombat; h.host.shutdown();
  }
});

test("vehicle oxygen follows the posed pilot head in an inverted cabin, independent of body proportions and using the current host position", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const session = h.join("head-water-pilot"); h.run(400);
    const c = h.client(session)!, { ents } = h.world, rec = h.host.records.byPid.get(c.pid)!;
    const vehicle = h.host.spawnVehicle("core:helicopter", 70, 65, rec.team), def = h.reg.vehicle[ents.kind[vehicle]!]!;
    const entry = def.seats[0]!.entry;
    ents.setPosition(c.ent, 70 + entry[0], entry[1], 65 + entry[2]);
    expect(h.host.urban.mount(c, vehicle)).toBe(RESULT_OK); h.run(1200);
    expect(c.drive).toBe(vehicle);
    const row = ents.vrow[vehicle]!, eye = new Float64Array(3), sv = h.host.survival;
    ents.setPosition(vehicle, 70, 5, 65);
    ents.vehicleQx[row] = ents.vehicleQy[row] = ents.vehicleQz[row] = 0; ents.vehicleQw[row] = 1;
    expect(h.host.urban.eye(c.ent, eye)).toBe(true);
    const shortHead = eye[1]!, look = defaultLook();
    look[LOOK_REGIONS + 5] = 127; // Longer neck; the pelvis stays fitted to the same seat.
    ents.looks.set(c.ent, look);
    expect(h.host.urban.eye(c.ent, eye)).toBe(true);
    expect(eye[1]!).toBe(shortHead);
    const uprightHead = eye[1]!;
    ents.vehicleQz[row] = 1; ents.vehicleQw[row] = 0;
    expect(h.host.urban.eye(c.ent, eye)).toBe(true);
    expect(eye[1]! + uprightHead).toBeCloseTo(10, 5);
    // Even after pinning, the world-up crouch offset points the wrong way in an inverted cabin.
    h.host.urban.syncAfterContact(vehicle);
    const proxy = ents.y[c.ent]! + stanceEye(h.reg.move[c.kind]!, ents.stance[c.ent]!);
    expect(proxy - eye[1]!).toBeGreaterThan(1);
    h.world.hf.seaLevel = (proxy + eye[1]!) * .5;
    // Run the real host pipeline without advancing aircraft physics, so the selected attitude stays fixed.
    h.world.tick++;
    h.server.onStep!(h.world.tick);
    expect(sv.isSubmerged(rec)).toBe(true);
    const oldFeet = ents.y[c.ent]!;
    ents.setPosition(vehicle, 70, 8, 65);
    expect(ents.y[c.ent]).toBe(oldFeet);
    h.world.tick++;
    h.server.onStep!(h.world.tick);
    expect(sv.isSubmerged(rec)).toBe(false);
  } finally { h.host.shutdown(); }
});

test("host oxygen reads current driver and passenger head positions when a compact changes immersion", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const sessions = [h.join("head-water-driver"), h.join("head-water-passenger")]; h.run(400);
    const clients = sessions.map(s => h.client(s)!), records = clients.map(c => h.host.records.byPid.get(c.pid)!);
    records[1]!.team = records[0]!.team;
    const { ents } = h.world, car = h.host.spawnVehicle("core:compact", 70, 65, records[0]!.team, 0);
    const def = h.reg.vehicle[ents.kind[car]!]!;
    for (let i = 0; i < clients.length; i++) {
      const entry = def.seats[i]!.entry;
      ents.setPosition(clients[i]!.ent, 70 + entry[0] + Math.sign(entry[0]) * .4, entry[1], 65 + entry[2]);
      expect(h.host.urban.mount(clients[i]!, car)).toBe(RESULT_OK);
    }
    h.run(900);
    expect(ents.seatSlot[clients[0]!.ent]).toBe(1); expect(ents.seatSlot[clients[1]!.ent]).toBe(2);
    ents.setPosition(car, 70, 2, 65);
    const eye = new Float64Array(3), heads: number[] = [];
    for (const c of clients) { expect(h.host.urban.eye(c.ent, eye)).toBe(true); heads.push(eye[1]!); }
    h.world.hf.seaLevel = Math.min(...heads) - .05;
    for (const c of clients) expect(ents.y[c.ent]! + stanceEye(h.reg.move[c.kind]!, ents.stance[c.ent]!)).toBeLessThan(h.world.hf.seaLevel);
    h.world.tick++; h.server.onStep!(h.world.tick);
    for (const rec of records) expect(h.host.survival.isSubmerged(rec)).toBe(false);
    h.world.hf.seaLevel = Math.max(...heads) + .05;
    for (let tick = 0; tick < 3; tick++) { h.world.tick++; h.server.onStep!(h.world.tick); }
    for (const rec of records) {
      expect(h.host.survival.isSubmerged(rec)).toBe(true);
      expect(h.host.survival.value(rec, V_OXYGEN)).toBeLessThan(rec.vitals!.max[V_OXYGEN]! / 1e6);
    }
  } finally { h.host.shutdown(); }
});
