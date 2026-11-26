// The jet's weapons through the real server and clients: the cannon's rounds judged at the pilot's view tick and credited
// to the pilot, a locked missile that chases a helicopter down and goes off with the rocket's look, a missile's fuse that
// meets a craft in the sky, idle weapons that cost nothing, and racks kept across a restart and filled at the bench.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { EVENT_BLAST, RESULT_OK } from "../../shared/net/protocol.ts";
import { SURFACE_AIR, SURFACE_VEHICLE } from "../../shared/net/rockets.ts";
import { BURST_LOOKS } from "../../shared/content/kinds/weapons.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import type { SkyPoint, SkyTaken, SkyTarget } from "../../server/sky.ts";
import { ARMS, LOCK_LOCKED, WARN_MISSILE } from "../../server/vehicle-weapons.ts";
import { WARN_SEEKING } from "../../client/core/arms.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A pilot in a jet parked at (x, z) facing +Z, its nose level. Returns the jet's entity. */
function board(h: Harness, pilot: number, x: number, z: number): number {
  const s = h.sessions[pilot]!, c = h.client(s)!, ents = h.world.ents;
  const e = h.host.spawnVehicle("core:jet", x, z, 0, 0);
  expect(e).toBeGreaterThanOrEqual(0);
  const entry = h.reg.vehicle[ents.kind[e]!]!.seats[0]!.entry;
  ents.setPosition(c.ent, x + entry[0], entry[1], z + entry[2]);
  expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
  h.run(1500);
  expect(c.drive).toBe(e);
  return e;
}

/** Runs `before` at the start of the weapons' step each tick, then the step. */
function beforeWeapons(h: Harness, before: () => void): void {
  const weapons = h.host.vehicleWeapons, step = weapons.step.bind(weapons);
  weapons.step = () => { before(); step(); };
}

test("the cannon's rounds are judged where the pilot saw its target, and credited to the pilot", () => {
  for (const late of [false, true]) {
    const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(8)) });
    try {
      const pilot = h.join("pilot", { latencyMs: 90 }), target = h.join("target"); h.run(1200);
      const c = h.client(pilot)!, t = h.client(target)!, ents = h.world.ents;
      const e = board(h, 0, 200, 200);
      const muzzle = h.reg.vehicle[ents.kind[e]!]!.weapons!.cannon!.muzzle;
      // The target stands on a slab 50 m ahead, its chest at the height of the gun.
      h.world.structs.add(h.reg.index.get("core:slab")!, 200 + muzzle[0], muzzle[1] - 1.5, 250, 0, 0, 1);
      ents.setPosition(t.ent, 200 + muzzle[0], muzzle[1] - 1.25, 250);
      h.run(1500);
      const rec = h.host.records.byPid.get(t.pid)!, health = (): number => rec.vitals!.at(V_HEALTH, h.world.tick), before = health();
      // It steps aside: long before the press, or on the very tick the press reaches the server, after the pilot saw it.
      let moved = false;
      beforeWeapons(h, () => {
        if (late && !moved && (c.heldButtons & BTN_PRIMARY) !== 0) { moved = true; ents.setPosition(t.ent, 203 + muzzle[0], muzzle[1] - 1.25, 250); }
      });
      if (!late) { ents.setPosition(t.ent, 203 + muzzle[0], muzzle[1] - 1.25, 250); h.run(2000); }
      h.pilots[0]!.buttons = BTN_PRIMARY; h.run(110); h.pilots[0]!.buttons = 0; h.run(600);
      expect(h.host.vehicleWeapons.rounds).toBeGreaterThan(0);
      const after = health();
      if (late) {
        expect(after).toBeLessThan(before);
        expect(h.host.combat.last.by).toBe(c.pid);
        expect(h.host.combat.last.victim).toBe(t.pid);
      } else expect(after).toBe(before);
      // The pilot is told its rounds left.
      expect(pilot.arms.now?.rounds).toBe(220 - h.host.vehicleWeapons.rounds);
    } finally { h.host.shutdown(); }
  }
});

test("a missile locked on a helicopter chases it down, its crew warned, and goes off as a rocket", () => {
  const h = new Harness({}, 6, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(16)) });
  try {
    const pilot = h.join("pilot"), crew = h.join("crew"), near = h.join("near"); h.run(1200);
    const c = h.client(pilot)!, passenger = h.client(crew)!, ents = h.world.ents;
    const e = board(h, 0, 300, 100);
    const heli = h.host.spawnVehicle("core:helicopter", 330, 700, 0, 0);
    const def = h.reg.vehicle[ents.kind[heli]!]!, entry = def.seats[1]!.entry;
    ents.setPosition(passenger.ent, 330 + entry[0], entry[1], 700 + entry[2]);
    expect(h.host.urban.mount(passenger, heli)).toBe(RESULT_OK); h.run(1500);
    ents.setPosition(h.client(near)!.ent, 330, 0, 650);
    // Up and drifting: its engine runs and nobody flies it, so it sinks slowly and slides across the jet's nose.
    const v = ents.vrow[heli]!;
    ents.setPosition(heli, 330, 110, 700); h.world.history.discontinuity(heli);
    ents.flags[heli] = ents.flags[heli]! & ~F_GROUNDED;
    ents.vehicleEngineOn[v] = 1; ents.vehicleRotorRpm[v] = 410; ents.vehicleCollective[v] = .55; ents.vx[heli] = 10;
    const heliPid = ents.pid[heli]!;
    let warned = 0, locked = false;
    h.pilots[0]!.buttons = BTN_SECONDARY;
    for (let k = 0; k < 40 && !locked; k++) {
      h.run(100); warned = Math.max(warned, crew.arms.warned);
      locked = h.host.vehicleWeapons.lockOf(e).state === LOCK_LOCKED;
    }
    expect(locked).toBe(true);
    expect(h.host.vehicleWeapons.lockOf(e).entity).toBe(heli);
    h.run(200);
    expect(pilot.arms.now?.lock).toBe(LOCK_LOCKED);
    expect(pilot.arms.now?.handle).toBe(makeHandle(heli, ents.gen[heli]!));
    expect(warned).toBeGreaterThanOrEqual(WARN_SEEKING);
    expect(pilot.arms.warned).toBe(0);
    near.events.length = 0;
    h.pilots[0]!.buttons = 0;
    h.run(150);
    expect(h.host.vehicleWeapons.launched).toBe(1);
    expect(pilot.arms.now?.missiles).toBe(5);
    let chased = false;
    for (let k = 0; k < 60 && h.host.vehicleWeapons.flying.length > 0; k++) { h.run(100); chased ||= crew.arms.warned === WARN_MISSILE; }
    expect(chased).toBe(true);
    expect(h.host.vehicleWeapons.detonated).toBe(1);
    // Downed by the pilot's missile: the blow that killed it was the pilot's, and it lies as a helicopter's wreck.
    expect([h.host.combat.last.victim, h.host.combat.last.killed]).toEqual([heliPid, true]);
    expect(h.host.records.byPid.get(heliPid)?.dead ?? true).toBe(true);
    expect([...h.host.corpses.bodies.values()].some(b => b.wreck && h.reg.ids[b.kind] === "core:helicopter")).toBe(true);
    expect(h.host.combat.last.by).toBe(c.pid);
    // Those near are told the blast with the missile as what blew, by its fuse in the air or on the hull, so they draw the
    // rocket's fireball.
    h.run(300);
    const blast = near.events.find(ev => ev.kind === EVENT_BLAST)!;
    expect(h.reg.ids[blast.item]).toBe("core:jet_missile");
    expect(BURST_LOOKS[h.reg.burstLook[blast.item]!]).toBe("rocket");
    expect([SURFACE_AIR, SURFACE_VEHICLE]).toContain(blast.surface);
    expect(blast.far).toBe(10);
  } finally { h.host.shutdown(); }
});

test("a missile locks a craft only the sky knows, and its blast reaches it as a heavy blow", () => {
  const h = new Harness({}, 7, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(16)) });
  try {
    const pilot = h.join("pilot"), near = h.join("near"); h.run(1200);
    const e = board(h, 0, 300, 100);
    h.world.ents.setPosition(h.client(near)!.ent, 300, 0, 650);
    // A craft 11 m across, crossing the jet's nose 600 m out at 60 m/s and 140 m up.
    const hits: { share: number; heavy: boolean }[] = [];
    const start = h.world.tick;
    const where = (t: number, out: SkyPoint): void => { out.x = 240 + (t - start) * 2; out.y = 140; out.z = 700; out.vx = 60; out.vy = 0; out.vz = 0; };
    const ufo: SkyTarget = {
      name: "Unidentified craft", lockable: true, radius: 11,
      at(t, out) { where(t, out); return true; },
      ray: () => Infinity,
      gap(x, y, z, t) { const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }; where(t, p); return Math.hypot(x - p.x, y - p.y, z - p.z) - 11; },
      take(_src, share, heavy): SkyTaken { hits.push({ share, heavy }); return { taken: share * 100, blocked: false, killed: false }; },
    };
    h.host.combat.sky.add(ufo);
    h.pilots[0]!.buttons = BTN_SECONDARY;
    for (let k = 0; k < 40 && h.host.vehicleWeapons.lockOf(e).state !== LOCK_LOCKED; k++) h.run(100);
    expect(h.host.vehicleWeapons.lockOf(e).sky).toBe(ufo);
    h.run(150);
    expect(pilot.arms.now?.target).toBe(2);
    expect(pilot.arms.now?.name).toBe("Unidentified craft");
    near.events.length = 0;
    h.pilots[0]!.buttons = 0;
    for (let k = 0; k < 60 && (h.host.vehicleWeapons.launched === 0 || h.host.vehicleWeapons.flying.length > 0); k++) h.run(100);
    expect(h.host.vehicleWeapons.detonated).toBe(1);
    expect(hits.length).toBe(1);
    expect(hits[0]!.heavy).toBe(true);
    expect(hits[0]!.share).toBeGreaterThan(.5);
    h.run(300);
    expect(near.events.find(ev => ev.kind === EVENT_BLAST)?.surface).toBe(SURFACE_VEHICLE);
    // A sky target warns nobody.
    expect(pilot.arms.warned).toBe(0);
  } finally { h.host.shutdown(); }
});

test("a missile with nothing locked is not fired", () => {
  const h = new Harness({}, 9, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(16)) });
  try {
    const pilot = h.join("pilot"); h.run(1200);
    board(h, 0, 300, 100);
    h.pilots[0]!.buttons = BTN_SECONDARY; h.run(500); h.pilots[0]!.buttons = 0; h.run(500);
    expect([h.host.vehicleWeapons.launched, pilot.arms.now?.missiles, pilot.arms.now?.lock]).toEqual([0, 6, 0]);
  } finally { h.host.shutdown(); }
});

test("racks emptied in flight are kept across a restart and filled again at the bench", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-jet-arms-")), dbPath = join(dir, "world.db");
  let h = new Harness({}, 10, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(8)), dbPath });
  try {
    h.join("pilot"); h.run(1200);
    const e = board(h, 0, 200, 200), pid = h.world.ents.pid[e]!;
    h.pilots[0]!.buttons = BTN_PRIMARY; h.run(1000); h.pilots[0]!.buttons = 0; h.run(300);
    const fired = h.host.vehicleWeapons.rounds;
    expect(fired).toBeGreaterThan(5);
    expect(h.host.vehicleWeapons.words(h.host.records.byPid.get(pid)!)).toBe(`cannon ${220 - fired}/220, missiles 6/6`);
    h.host.shutdown();
    h = new Harness({}, 10, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(8)), dbPath });
    const s = h.join("pilot"); h.run(1200);
    const rec = h.host.records.byPid.get(pid)!;
    expect(rec.part(ARMS)?.rounds).toBe(220 - fired);
    expect(h.host.vehicleWeapons.full(rec)).toBe(false);
    // Out, stopped, with the bench's materials: one repair fills the drum.
    const c = h.client(s)!, actor = h.host.records.byPid.get(c.pid)!, e2 = h.host.records.entOf.get(pid)!;
    for (const id of ["core:ingot", "core:polymer", "core:electronics"]) h.host.items.mint(actor, h.reg.index.get(id)!, 100);
    const entry = h.reg.vehicle[h.world.ents.kind[e2]!]!.seats[0]!.entry;
    h.world.ents.setPosition(c.ent, h.world.ents.x[e2]! + entry[0], 0, h.world.ents.z[e2]! + entry[2]);
    h.run(300);
    expect(h.host.vehicles.repair(c, makeHandle(e2, h.world.ents.gen[e2]!))).toBe(RESULT_OK);
    expect(h.host.vehicleWeapons.full(rec)).toBe(true);
    expect(h.host.vehicleWeapons.words(rec)).toBe("cannon 220/220, missiles 6/6");
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("weapons nobody holds cost nothing a tick", () => {
  const h = new Harness({}, 11, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(8)) });
  try {
    h.join("pilot"); h.run(1200);
    board(h, 0, 200, 200);
    h.run(1000);
    const weapons = h.host.vehicleWeapons;
    expect([weapons.rounds, weapons.launched, weapons.flying.length, weapons.lockOf(h.client(h.sessions[0]!)!.drive).state]).toEqual([0, 0, 0, 0]);
  } finally { h.host.shutdown(); }
});
