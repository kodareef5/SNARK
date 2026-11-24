// The rocket launcher on the server (planning/workstreams/rocket.md), read off the line as sent, whatever a client makes of it.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { BLASTS_A_TICK } from "../../server/projectiles.ts";
import type { Source } from "../../server/combat.ts";
import type { EngramDef, ItemDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { packBolt } from "../../shared/net/bolts.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EVENT_BLAST, EVENT_BOLTS, EVENT_HIT, EVENT_ROCKET, EVENT_SHOT, S_EVENT } from "../../shared/net/protocol.ts";
import { MADE_METAL, MADE_STONE, MADE_THATCH, MADE_UNKNOWN, MADE_WOOD, ROCKET_AGE_MOST, ROCKET_IDS, SURFACE_AIR, SURFACE_BODY, SURFACE_BUILT, SURFACE_GROUND, SURFACE_VEHICLE, SURFACE_WATER, blast, blastSeed, readBlast, readRocket, rocket, writeBlast, writeRocket } from "../../shared/net/rockets.ts";
import { BTN_PRIMARY, BTN_SECONDARY, stanceEye } from "../../shared/sim/character.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const LAUNCHER = id("rocket_launcher");
const ROCKET = id("rocket");
const SPEED = reg.ammoSpeed[ROCKET]!;

interface ToldRocket { x: number; y: number; z: number; dx: number; dy: number; dz: number; ammo: number; id: number; age: number; own: boolean; tick: number; bytes: number }
interface ToldBlast { x: number; y: number; z: number; dx: number; dy: number; dz: number; radius: number; item: number; id: number; surface: number; made: number; tick: number; bytes: number }
interface ToldHit { x: number; y: number; z: number; damage: number; killed: boolean; tick: number }
interface Told { rockets: ToldRocket[]; blasts: ToldBlast[]; hits: ToldHit[]; shots: number }

/** What the server sends `s` of rockets, blasts, hits and other shots from now on, each with the tick it was sent in and its bytes on the line. */
function tap(h: Harness, s: ClientSession): Told {
  const conn = h.client(s)!.conn;
  const send = conn.send.bind(conn);
  const told: Told = { rockets: [], blasts: [], hits: [], shots: 0 };
  const r = new BitReader();
  conn.send = (channel: number, data: Uint8Array): void => {
    if (data[0] === S_EVENT) {
      r.reset(data);
      r.u8();
      const kind = r.u8();
      if (kind === EVENT_ROCKET) {
        readRocket(r);
        told.rockets.push({ ...rocket, tick: h.world.tick, bytes: data.length });
      } else if (kind === EVENT_BLAST) {
        readBlast(r);
        told.blasts.push({ ...blast, tick: h.world.tick, bytes: data.length });
      } else if (kind === EVENT_HIT) {
        const [x, y, z] = [r.f32(), r.f32(), r.f32()];
        r.bits(4);
        told.hits.push({ x, y, z, damage: r.u16(), killed: r.bool(), tick: h.world.tick });
      } else if (kind === EVENT_SHOT || kind === EVENT_BOLTS) told.shots++;
      expect(r.overflow).toBe(false);
    }
    send(channel, data);
  };
  return told;
}

/** Ada at the south end of level ground looking north with her sights up, and whoever else is named standing by her. */
function range(...others: string[]) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  const friends = others.map((name) => h.join(name));
  h.run(500);
  h.say(s, "enablecheats");
  const g = flatGround(h, 40, 40);
  const at = { x: g.x + 20, z: g.z + 2, y: g.y };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  friends.forEach((f, k) => {
    h.say(f, "enablecheats");
    h.say(f, `tp ${(at.x + 3 + k * 2).toFixed(3)} ${at.z.toFixed(3)}`);
  });
  const pilot = h.pilots[0]!;
  pilot.yaw = pilot.pitch = 0;
  pilot.buttons = BTN_SECONDARY;
  h.run(300);
  const c = h.client(s)!;
  const rec = h.host.records.byPid.get(c.pid)!;
  const ents = h.world.ents;
  const shots = h.host.projectiles;
  const dummy = (dx: number, dz: number): number => h.host.spawnCreature("core:dummy", at.x + dx, at.z + dz, 1);
  const health = (e: number): number => h.host.survival.value(h.host.records.byPid.get(ents.pid[e]!)!, V_HEALTH);
  /** Turns her to the point (x, y, z), waits for the aim to settle, and sends `count` rockets from her eye in one tick. */
  const launch = (x: number, y: number, z: number, count = 1): void => {
    const me = h.ent(s);
    const eye = ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, ents.stance[me]!);
    pilot.yaw = Math.atan2(x - ents.x[me]!, z - ents.z[me]!);
    pilot.pitch = Math.atan2(y - eye, Math.hypot(x - ents.x[me]!, z - ents.z[me]!));
    h.run(500);
    for (let k = 0; k < count; k++) shots.launch(c, rec, LAUNCHER, 0, ROCKET, 1);
  };
  /** Steps the server one tick: a client's frame is half of one. */
  const step = (): void => {
    const tick = h.world.tick;
    while (h.world.tick === tick) h.run(1000 / 60);
  };
  /** Steps a tick at a time until no round flies. */
  const land = (most = 400): void => {
    for (let ticks = 0; shots.flyingCount > 0 && ticks < most; ticks++) step();
  };
  return { h, s, friends, pilot, c, rec, at, ents, shots, dummy, health, launch, step, land };
}

test("the launcher and its rocket are ARK's, and the rocket flies 300 m nearly level", () => {
  const byId = new Map(CORE_CONTENT.map((d) => [d.id, d] as const));
  const row = (name: string): unknown[] => {
    const d = byId.get(`core:${name}`) as ItemDef;
    const e = byId.get(`core:engram-${name}`) as EngramDef;
    return [name, d.class, d.stack, d.weight, e.level, e.cost, d.craft!.at, d.craft!.seconds, d.craft!.count ?? 1, d.craft!.needs.map((n) => `${n.count} ${n.item.slice(5)}`).join(", ")];
  };
  // Rocket Launcher and Rocket Propelled Grenade, ark.wiki.gg, read on 2026-11-21.
  expect([row("rocket_launcher"), row("rocket")]).toEqual([
    ["rocket_launcher", "weapon", 1, 20, 87, 32, "core:fabricator", 15, 1, "80 polymer, 50 ingot, 60 paste"],
    ["rocket", "ammo", 100, 0.1, 87, 8, "core:fabricator", 1, 1, "40 gunpowder, 10 crystal, 20 paste, 10 polymer, 12 ingot"],
  ]);
  const w = (byId.get("core:rocket_launcher") as ItemDef).weapon!;
  expect([w.kind, w.ammo, w.clip, w.reload, w.uses, w.power]).toEqual(["gun", ["core:rocket"], 1, 4, 20, 1]);
  // 250 to a body within 7.5 m, and 7,350 to wood. Its speed, its fall and its reach are ours: 150 ticks of flight.
  expect([reg.damage[ROCKET], reg.ammoBlast[ROCKET], reg.structureMul[LAUNCHER]! * 250, SPEED, reg.ammoGravity[ROCKET], reg.ammoFlightTicks[ROCKET]]).toEqual([250, 7.5, 7350, 60, 2, 150]);
});

test("a rocket and a blast are read as written, in 16 and 17 bytes", () => {
  const w = new BitWriter(128);
  const packed = new Uint32Array(5);
  const way = [Math.sin(2.1) * Math.cos(-0.4), Math.sin(-0.4), Math.cos(2.1) * Math.cos(-0.4)] as const;
  packBolt(5123.4567, 87.654, 9001.2345, way[0], way[1], way[2], packed, 0);
  writeRocket(w, packed, 0, ROCKET, ROCKET_IDS - 1, 37.4, true);
  expect(w.pos).toBe(16 * 8);
  // A blast on a wall that faces down and east, and one in the air with no round.
  const out = [Math.cos(-0.7), Math.sin(-0.7), 0] as const;
  writeBlast(w, 12.5, -3.25, 40000.75, out[0], out[1], out[2], 7.5, ROCKET, 513, SURFACE_BUILT, MADE_METAL);
  expect(w.pos - 16 * 8).toBe(133);
  writeBlast(w, 300.01, 44.02, 7.99, 0, 1, 0, 6, 0, 0, SURFACE_AIR, MADE_UNKNOWN);
  // An age past what a message says is said as the most, and a reach is told to a quarter of a metre.
  writeRocket(w, packed, 0, ROCKET, 1, 9000, false);
  const r = new BitReader();
  r.reset(w.bytes());
  readRocket(r);
  expect(Math.hypot(rocket.x - 5123.4567, rocket.z - 9001.2345)).toBeLessThan(0.02);
  expect(Math.abs(rocket.y - 87.654)).toBeLessThan(0.02);
  expect(Math.acos(rocket.dx * way[0] + rocket.dy * way[1] + rocket.dz * way[2]) * (180 / Math.PI)).toBeLessThan(0.05);
  expect([rocket.ammo, rocket.id, rocket.age, rocket.own]).toEqual([ROCKET, ROCKET_IDS - 1, 37, true]);
  readBlast(r);
  expect([blast.x, blast.y, blast.z, blast.radius, blast.item, blast.id, blast.surface, blast.made]).toEqual([12.5, -3.25, 40000.75, 7.5, ROCKET, 513, SURFACE_BUILT, MADE_METAL]);
  expect(Math.acos(blast.dx * out[0] + blast.dy * out[1] + blast.dz * out[2]) * (180 / Math.PI)).toBeLessThan(0.05);
  readBlast(r);
  expect(Math.hypot(blast.x - 300.01, blast.y - 44.02, blast.z - 7.99)).toBeLessThan(0.03);
  expect([blast.dy > 0.9999, blast.radius, blast.item, blast.id, blast.surface, blast.made]).toEqual([true, 6, 0, 0, SURFACE_AIR, MADE_UNKNOWN]);
  readRocket(r);
  expect([rocket.id, rocket.age, rocket.own]).toEqual([1, ROCKET_AGE_MOST, false]);
  expect(r.overflow).toBe(false);
  // Every client draws a blast from its round's number and its place: the same from what each read, another for another.
  expect(blastSeed(513, 12.5, -3.25, 40000.75)).toBe(blastSeed(513, 12.51, -3.24, 40000.76));
  expect(blastSeed(513, 12.5, -3.25, 40000.75)).not.toBe(blastSeed(514, 12.5, -3.25, 40000.75));
});

test("a rocket is told to its shooter as its own and to others by number, and bursts in the air at its reach", () => {
  const { h, s, friends, pilot, rec, shots, step, land } = range("bob");
  h.host.items.mint(rec, LAUNCHER, 1);
  h.host.items.mint(rec, ROCKET, 2);
  h.run(300);
  takeInHand(h, s, LAUNCHER);
  h.run(4600);
  const [mine, theirs] = [tap(h, s), tap(h, friends[0]!)];
  // Nearly straight up, so that it meets nothing and stays over the map.
  pilot.pitch = 1.45;
  h.run(400);
  pilot.buttons |= BTN_PRIMARY;
  let waited = 0;
  while (shots.flyingCount === 0 && waited++ < 30) step();
  pilot.buttons &= ~BTN_PRIMARY;
  expect(shots.flyingCount).toBe(1);
  const number = shots.numberAt(0);
  expect(number).toBeGreaterThan(0);
  // One message each, in place of the shot any other round is told by.
  expect(mine.rockets.map((r) => [r.id, r.ammo, r.own])).toEqual([[number, ROCKET, true]]);
  expect(theirs.rockets.map((r) => [r.id, r.ammo, r.own])).toEqual([[number, ROCKET, false]]);
  expect([mine.shots, theirs.shots]).toEqual([0, 0]);
  const told = theirs.rockets[0]!;
  expect([told.x, told.y, told.z, told.age]).toEqual([mine.rockets[0]!.x, mine.rockets[0]!.y, mine.rockets[0]!.z, mine.rockets[0]!.age]);
  // Flown ahead by its age from where it is said to have left, a copy is where the server's is.
  const real = shots.flyingAt(0);
  const flown = ((h.world.tick - told.tick + told.age) * SPEED) / TICK_RATE;
  expect(Math.hypot(told.x + told.dx * flown - real.x, told.y + told.dy * flown - real.y, told.z + told.dz * flown - real.z)).toBeLessThan(SPEED / TICK_RATE + 0.5);
  for (let k = 0; k < 100; k++) step();
  expect([shots.flyingCount, shots.blasts]).toEqual([1, 0]);
  land();
  expect(shots.blasts).toBe(1);
  // 300 m at 60 m/s is 150 ticks from when it left, and it goes off on the tick after.
  const ticks = mine.blasts[0]!.tick - told.tick + told.age;
  expect(ticks).toBeGreaterThanOrEqual(150);
  expect(ticks).toBeLessThanOrEqual(152);
  // In the open air, its way out straight up, no further from where it left than its reach.
  expect(mine.blasts.map((b) => [b.id, b.item, b.radius, b.surface, b.made, b.dy > 0.999])).toEqual([[number, ROCKET, 7.5, SURFACE_AIR, MADE_UNKNOWN, true]]);
  expect(theirs.blasts.map((b) => b.id)).toEqual([number]);
  const far = Math.hypot(mine.blasts[0]!.x - told.x, mine.blasts[0]!.y - told.y, mine.blasts[0]!.z - told.z);
  expect(far).toBeGreaterThan(250);
  expect(far).toBeLessThanOrEqual(300);
  expect([mine.rockets.length, theirs.rockets.length]).toEqual([1, 1]);
  // 16 and 17 bytes, under the message's type and the event's kind.
  expect([told.bytes, mine.blasts[0]!.bytes]).toEqual([18, 19]);
  expect(h.host.items.audit()).toEqual([]);
});

test("one who comes within hearing of a flying rocket is told of it once, with its age then", () => {
  const { h, s, friends, at, shots, launch, land } = range("eve");
  const eve = friends[0]!;
  // Eve stands 263 m north of where the rocket leaves: past hearing of the launch, and within it a few metres on.
  h.say(eve, `tp ${at.x.toFixed(3)} ${(at.z + 263).toFixed(3)}`);
  const there = { x: h.world.ents.x[h.ent(eve)]!, z: h.world.ents.z[h.ent(eve)]! };
  const [mine, hers] = [tap(h, s), tap(h, eve)];
  launch(at.x, at.y + 60, at.z + 100);
  const number = shots.numberAt(0);
  // The shooter's client flew none for a launch it did not make, and is told all the same.
  expect(mine.rockets.map((r) => r.id)).toEqual([number]);
  expect(hers.rockets.length).toBe(0);
  const first = mine.rockets[0]!;
  expect(Math.hypot(first.x - there.x, first.z - there.z)).toBeGreaterThan(260);
  land();
  expect(hers.rockets.map((r) => [r.id, r.ammo, r.own])).toEqual([[number, ROCKET, false]]);
  const late = hers.rockets[0]!;
  // Its age is the ticks since it left: what the shooter was told, and the ticks since.
  expect(late.age).toBe(first.age + late.tick - first.tick);
  expect(late.age).toBeGreaterThan(0);
  expect(late.age).toBeLessThanOrEqual(16);
  expect([late.x, late.y, late.z]).toEqual([first.x, first.y, first.z]);
  // Flown that far, it is within her hearing, and eight ticks before it was not.
  const along = (ticks: number): number => Math.hypot(late.x + (late.dx * SPEED * ticks) / TICK_RATE - there.x, late.z + (late.dz * SPEED * ticks) / TICK_RATE - there.z);
  expect(along(late.age)).toBeLessThan(261);
  expect(along(late.age - 8)).toBeGreaterThan(259);
  // She is told where it ended too, by the same number.
  expect(shots.blasts).toBe(1);
  expect(hers.blasts.map((b) => b.id)).toEqual([number]);
});

test("a blast says its rocket's number, what it went off on and the way out of it", () => {
  const { h, s, at, ents, shots, dummy, launch, land } = range();
  const told = tap(h, s);
  const structs = h.world.structs;
  /** Sends a rocket at the point and returns its blast with the number it flew under and the unit way it was going. */
  const fire = (x: number, y: number, z: number): ToldBlast & { number: number; way: number[] } => {
    const [rockets, blasts] = [told.rockets.length, told.blasts.length];
    launch(x, y, z);
    const number = shots.numberAt(0);
    land();
    expect([told.rockets.length - rockets, told.blasts.length - blasts]).toEqual([1, 1]);
    const r = told.rockets[told.rockets.length - 1]!;
    return { ...told.blasts[told.blasts.length - 1]!, number, way: [r.dx, r.dy, r.dz] };
  };
  const round = (b: ToldBlast): number[] => [b.dx, b.dy, b.dz].map((v) => Math.round(v * 100) / 100 + 0);
  // The ground 14 m ahead: on it, its way out up, a little short of it.
  const ground = fire(at.x, at.y, at.z + 14);
  expect([ground.id, ground.item, ground.radius, ground.surface, ground.made, round(ground)]).toEqual([ground.number, ROCKET, 7.5, SURFACE_GROUND, MADE_UNKNOWN, [0, 1, 0]]);
  expect(Math.abs(ground.z - (at.z + 14))).toBeLessThan(1.5);
  expect(Math.abs(ground.y - at.y)).toBeLessThan(0.1);
  // A wall of each material that faces her: built, of that, its way out back at her.
  const walls: [string, number][] = [["wall_thatch", MADE_THATCH], ["wall_wood", MADE_WOOD], ["wall", MADE_STONE], ["wall_metal", MADE_METAL]];
  for (const [k, [kind, made]] of walls.entries()) {
    structs.add(id(kind), at.x - 12 + k * 8, at.y + 1.5, at.z + 30, 0, 0, 1e6);
    const wall = fire(at.x - 12 + k * 8, at.y + 1.5, at.z + 30);
    expect([kind, wall.id, wall.surface, wall.made, round(wall)]).toEqual([kind, wall.number, SURFACE_BUILT, made, [0, 0, -1]]);
    expect(wall.z).toBeLessThan(at.z + 30);
  }
  // A dummy: a body, its way out back the way the rocket came.
  const d = dummy(-8, 16);
  h.run(300);
  const body = fire(ents.x[d]!, ents.y[d]! + 1, ents.z[d]!);
  expect([body.id, body.surface, body.made]).toEqual([body.number, SURFACE_BODY, MADE_UNKNOWN]);
  expect(body.dx * body.way[0]! + body.dy * body.way[1]! + body.dz * body.way[2]!).toBeLessThan(-0.99);
  expect(shots.lastEnd.on).toBe(d);
  // A parked car: a vehicle.
  const car = h.host.spawnVehicle("core:compact", at.x + 10, at.z + 18, 0, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  h.run(500);
  const hull = fire(ents.x[car]!, ents.y[car]! + 0.6, ents.z[car]!);
  expect([hull.id, hull.surface, shots.lastEnd.on]).toEqual([hull.number, SURFACE_VEHICLE, car]);
  // Each flew under a number of its own, taken in turn.
  expect(told.blasts.map((b) => b.id)).toEqual(told.blasts.map((_, k) => told.blasts[0]!.id + k));
});

test("a rocket into water goes off on it, its way out up", () => {
  const { h, s, pilot, c, rec, shots, land } = range();
  const w = h.world;
  // A spot on the shore, with the sea a few metres off toward `yaw`.
  let shore: { x: number; z: number; yaw: number } | null = null;
  for (let x = 40; x < w.hf.sizeX - 40 && !shore; x += 8) {
    for (let z = 40; z < w.hf.sizeZ - 40 && !shore; z += 8) {
      const y = w.hf.heightAt(x, z);
      if (y < w.hf.seaLevel + 0.4 || y > w.hf.seaLevel + 2.5) continue;
      for (let k = 0; k < 8 && !shore; k++) {
        const a = (k * Math.PI) / 4;
        if (w.hf.heightAt(x + Math.sin(a) * 14, z + Math.cos(a) * 14) < w.hf.seaLevel - 2.5 && w.hf.heightAt(x + Math.sin(a) * 9, z + Math.cos(a) * 9) < w.hf.seaLevel - 0.5) shore = { x, z, yaw: a };
      }
    }
  }
  expect(shore).not.toBeNull();
  h.say(s, `tp ${shore!.x} ${shore!.z}`);
  const told = tap(h, s);
  const me = h.ent(s);
  pilot.yaw = shore!.yaw;
  pilot.pitch = Math.atan2(w.hf.seaLevel - (w.ents.y[me]! + stanceEye(reg.move[w.ents.kind[me]!]!, w.ents.stance[me]!)), 12);
  h.run(500);
  shots.launch(c, rec, LAUNCHER, 0, ROCKET, 1);
  const number = shots.numberAt(0);
  land();
  expect(shots.lastEnd.on).toBe(-2);
  expect(told.blasts.map((b) => [b.id, b.surface, b.made, b.dy > 0.999])).toEqual([[number, SURFACE_WATER, MADE_UNKNOWN, true]]);
  expect(Math.abs(told.blasts[0]!.y - w.hf.seaLevel)).toBeLessThan(0.1);
});

test("a blast that damages many pieces sends its shooter one hit report, at its centre, for all of it", () => {
  const { h, s, rec, at, shots, launch, land } = range();
  const structs = h.world.structs;
  // Six wooden walls round a point 16 m ahead, none touching another, open to the south where the rocket comes.
  const centre = { x: at.x, z: at.z + 16 };
  const refs = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = ((k + 0.5) * Math.PI) / 3;
    return structs.add(id("wall_wood"), centre.x + Math.sin(a) * 5, at.y + 1.5, centre.z + Math.cos(a) * 5, 0, 0, 100000);
  });
  const hp = (ref: number): number => {
    const t = structs.chunks[Math.floor(ref / 65536)];
    return t && t.kind[ref & 0xffff] !== 0 ? t.hp[ref & 0xffff]! : 0;
  };
  const told = tap(h, s);
  const built = h.host.combat.structureHits;
  launch(centre.x, at.y, centre.z);
  land();
  expect(shots.blasts).toBe(1);
  const lost = refs.map((ref) => 100000 - hp(ref));
  expect(h.host.combat.structureHits - built).toBe(6);
  expect(lost.every((v) => v > 0)).toBe(true);
  // One report where it sent six: where the blast was, and what all of it did.
  expect(told.hits.length).toBe(1);
  const [hit, burst] = [told.hits[0]!, told.blasts[0]!];
  expect(Math.hypot(hit.x - burst.x, hit.y - burst.y, hit.z - burst.z)).toBeLessThan(0.03);
  expect(Math.abs(hit.damage - lost.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(1);
  expect(hit.killed).toBe(false);
  // A wall that a blast destroys is said in its report: one that stands apart from the six, and from what the map built.
  const weak = structs.add(id("wall_wood"), at.x - 10, at.y + 1.5, at.z + 6, 0, 0, 50);
  launch(at.x - 10, at.y + 1.5, at.z + 6);
  land();
  expect(hp(weak)).toBe(0);
  expect(told.hits.slice(1).map((v) => [v.damage, v.killed])).toEqual([[50, true]]);
  // A blow on one piece outside a blast is still a report of its own, where it landed.
  const src: Source = { by: rec, x: at.x, z: at.z, item: 0, base: 40, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  h.host.combat.hitStructure(src, refs[1]!, centre.x, at.y + 1, centre.z + 3);
  expect(told.hits.slice(2).map((v) => [v.damage, v.killed, v.z])).toEqual([[40, false, Math.fround(centre.z + 3)]]);
  // A blast that does more than a report can say is said as the most it can.
  h.host.combat.blast({ ...src, item: LAUNCHER, base: 5000 }, centre.x, at.y + 0.5, centre.z, 7.5);
  expect(told.hits.slice(3).map((v) => [v.damage, v.killed])).toEqual([[65535, false]]);
});

test("the third blast of a tick is judged the tick after, and harms as the others did", () => {
  const { h, s, c, rec, at, ents, shots, dummy, health, launch, step } = range();
  const d = dummy(0, 18);
  h.run(300);
  const told = tap(h, s);
  const combat = h.host.combat;
  // Three rockets leave in one tick for the ground before the dummy, and end in one tick.
  launch(ents.x[d]!, at.y, ents.z[d]! - 2.5, 3);
  expect([0, 1, 2].map((k) => shots.numberAt(k))).toEqual([0, 1, 2].map((k) => shots.numberAt(0) + k));
  const [hits, full] = [combat.hits, health(d)];
  for (let ticks = 0; shots.flyingCount > 0 && ticks < 60; ticks++) step();
  const ended = h.world.tick;
  // All three are told at once, and two of them judged.
  expect([shots.blasts, told.blasts.length, told.blasts.every((b) => b.tick === ended)]).toEqual([3, 3, true]);
  expect([combat.hits - hits, shots.waitingCount]).toEqual([BLASTS_A_TICK, 1]);
  const two = full - health(d);
  expect(two).toBeGreaterThan(0);
  step();
  expect([combat.hits - hits, shots.waitingCount]).toEqual([3, 0]);
  // The one that waited did what each of the others did. The dummy mends a little meanwhile.
  expect(Math.abs(full - health(d) - two * 1.5)).toBeLessThan(2);
  expect(told.blasts.length).toBe(3);
  // Grenades are counted with them: three thrown in a tick go off in a tick on the ground, and the third waits one.
  const grenade = id("grenade");
  for (let k = 0; k < 3; k++) shots.lob(c, rec, grenade, 0);
  for (let ticks = 0; shots.bursts < 3 && ticks < 200; ticks++) step();
  expect([shots.bursts, shots.waitingCount]).toEqual([3, 1]);
  expect(told.blasts.slice(3).map((b) => [b.item, b.id, b.surface, b.radius])).toEqual([0, 1, 2].map(() => [grenade, 0, SURFACE_GROUND, reg.blast[grenade]!]));
  step();
  expect(shots.waitingCount).toBe(0);
});
