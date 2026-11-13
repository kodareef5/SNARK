import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { BLAST_MS } from "../../client/core/shots.ts";
import { dress } from "../../server/commands/combat.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, EVENT_BLAST, EVENT_HIT } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const EYE = 1.62;

/** A survivor with cheats at the south end of a level range, looking north, and a way to stand a wall across it. */
function range(deep = 30) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(500);
  h.say(s, "enablecheats");
  const pilot = h.pilots[0]!;
  const g = flatGround(h, 24, deep);
  const at = { x: g.x + 12, z: g.z + 1.5, y: g.y };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  pilot.yaw = 0;
  pilot.pitch = 0;
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const structs = h.world.structs;
  /** A wall of `kind` across the range `far` metres off; returns its reference. */
  const wall = (kind: string, far: number, side = 0): number => {
    const k = id(kind);
    const def = reg.defs[k] as { hp: number };
    return structs.add(k, at.x + side, at.y + 1.5, at.z + far, 0, 0, def.hp);
  };
  const hp = (ref: number): number => {
    const t = structs.chunks[Math.floor(ref / 65536)];
    return t && t.kind[ref & 0xffff] !== 0 ? t.hp[ref & 0xffff]! : 0;
  };
  const arm = (kit: string, weapon: string, ms: number): number => {
    h.say(s, `kit ${kit}`);
    const slot = takeInHand(h, s, id(weapon));
    h.run(ms);
    return slot;
  };
  return { h, s, pilot, rec, at, wall, hp, arm, structs };
}

function swing(h: Harness, pilot: Pilot): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 8);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * 22);
}

function loose(h: Harness, pilot: Pilot, ms = 900): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 45);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(ms);
}

test("a ray says which way the surface it hit faces: level ground, a slope, and each face of a wall however it is turned", () => {
  const { h, at, structs } = range();
  const w = h.world;
  // Level ground looks straight up.
  expect(castWorld(w, at.x, at.y + 2, at.z, 0, -1, 0, 5)).toBe(HIT_TERRAIN);
  const facing = (): number[] => [rayHit.nx, rayHit.ny, rayHit.nz].map((v) => Math.round(v * 1000) / 1000 + 0);
  expect(facing()).toEqual([0, 1, 0]);
  // A wall across the range: hit from the south it faces south, from the north north, from above up.
  const k = id("wall");
  structs.add(k, at.x, at.y + 1.5, at.z + 6, 0, 0, 1500);
  expect(castWorld(w, at.x, at.y + 1, at.z, 0, 0, 1, 20)).toBe(HIT_STRUCTURE);
  expect(facing()).toEqual([0, 0, -1]);
  expect(rayHit.t).toBeCloseTo(5.9, 3);
  castWorld(w, at.x, at.y + 1, at.z + 12, 0, 0, -1, 20);
  expect(facing()).toEqual([0, 0, 1]);
  castWorld(w, at.x, at.y + 6, at.z + 6, 0, -1, 0, 20);
  expect(facing()).toEqual([0, 1, 0]);
  // Turned an eighth of a turn, its face is turned with it: still square to the wall, still toward where the ray came from.
  structs.add(k, at.x + 6, at.y + 1.5, at.z + 6, 8192, 0, 1500);
  expect(castWorld(w, at.x + 6, at.y + 1, at.z, 0, 0, 1, 20)).toBe(HIT_STRUCTURE);
  expect(Math.hypot(rayHit.nx, rayHit.ny, rayHit.nz)).toBeCloseTo(1, 6);
  expect(Math.abs(rayHit.nx)).toBeCloseTo(Math.SQRT1_2, 3);
  expect(rayHit.nz).toBeCloseTo(-Math.SQRT1_2, 3);
  // A slope faces up and out of the hill.
  let found = false;
  for (let x = 40; x < w.hf.sizeX - 40 && !found; x += 16) {
    for (let z = 40; z < w.hf.sizeZ - 40 && !found; z += 16) {
      const rise = w.hf.heightAt(x + 1, z) - w.hf.heightAt(x - 1, z);
      if (Math.abs(rise) < 0.6) continue;
      castWorld(w, x, w.hf.heightAt(x, z) + 3, z, 0, -1, 0, 6);
      expect(rayHit.ny).toBeGreaterThan(0.5);
      expect(rayHit.ny).toBeLessThan(0.99);
      expect(Math.sign(rayHit.nx)).toBe(-Math.sign(rise));
      expect(Math.hypot(rayHit.nx, rayHit.ny, rayHit.nz)).toBeCloseTo(1, 6);
      found = true;
    }
  }
  expect(found).toBe(true);
});

test("what a thing is built of decides what harms it: fists and a hatchet bring thatch down, and do nothing to wood or stone", () => {
  const { h, s, pilot, rec, wall, hp, arm } = range();
  const combat = h.host.combat;
  const thatch = wall("wall_thatch", 1.6, -6);
  const wood = wall("wall_wood", 1.6);
  const stone = wall("wall", 1.6, 6);
  const face = (side: number): void => {
    h.say(s, `tp ${(h.world.ents.x[h.ent(s)]! * 0 + rangeX + side).toFixed(3)} ${rangeZ.toFixed(3)}`);
    pilot.yaw = 0;
    pilot.pitch = -0.1;
    h.run(200);
  };
  const rangeX = h.world.ents.x[h.ent(s)]!;
  const rangeZ = h.world.ents.z[h.ent(s)]!;
  // Bare hands: thatch gives, wood and stone do not.
  face(-6);
  swing(h, pilot);
  expect(hp(thatch)).toBe(1600 - 8);
  expect([combat.structureHits, combat.lastStructure.damage, combat.lastStructure.left]).toEqual([1, 8, 1592]);
  // The one who struck is told, as for a body: where, and how much.
  const told = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(told.map((ev) => [ev.zone, ev.damage, ev.kill])).toEqual([[ZONE_NONE, 8, false]]);
  face(0);
  swing(h, pilot);
  face(6);
  swing(h, pilot);
  expect([hp(wood), hp(stone), combat.structureHits]).toEqual([10000, 10000, 1]);
  // A stone hatchet: nothing to wood or stone, and no wear for a blow that did nothing; its twenty to thatch, and worn by it.
  const slot = arm("tools", "hatchet", 700);
  const inv = h.host.items.inv(rec);
  face(0);
  swing(h, pilot);
  face(6);
  swing(h, pilot);
  expect([hp(wood), hp(stone), inv.dur[slot]]).toEqual([10000, 10000, 60]);
  face(-6);
  swing(h, pilot);
  expect(hp(thatch)).toBe(1592 - 20);
  expect(inv.dur[slot]).toBe(59);
  // Worn nearly through already, two more blows bring it down, and it is gone from the world.
  h.world.structs.damage(thatch, 1572 - 30);
  for (let n = 0; n < 2; n++) swing(h, pilot);
  expect(hp(thatch)).toBe(0);
  expect(combat.lastStructure.left).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("a flame arrow burns a wooden wall; a stone arrow does nothing to it and stands in it; thatch comes down and takes its arrows with it", () => {
  const { h, s, pilot, rec, wall, hp, arm, structs } = range();
  const combat = h.host.combat;
  const shots = h.host.projectiles;
  const wood = wall("wall_wood", 12);
  const slot = arm("bow", "bow", 400);
  const aimAt = (height: number): void => {
    pilot.yaw = 0;
    pilot.pitch = Math.atan2(height - EYE + 0.15, 12);
  };
  // Stone arrows: no harm to wood. About half of them stand in it.
  h.run(900);
  for (let n = 0; n < 6; n++) {
    aimAt(1.2 + n * 0.2);
    loose(h, pilot);
  }
  expect([hp(wood), combat.structureHits]).toEqual([10000, 0]);
  expect(shots.stuckCount).toBeGreaterThanOrEqual(1);
  // A wooden wall has ten thousand health, sixty flame arrows' worth. This one has been burning a while: a thousand left.
  structs.damage(wood, 9000);
  // Flame arrows: fifty-five of fire, three times over on wood.
  h.host.items.load(rec, slot, id("arrow_flame"), 1);
  h.run(900);
  aimAt(1.5);
  loose(h, pilot);
  expect(hp(wood)).toBe(1000 - 165);
  expect(combat.lastStructure).toEqual({ ref: wood, damage: 165, left: 835 });
  const told = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(told.at(-1)!.damage).toBe(165);
  expect(told.at(-1)!.z).toBeCloseTo(h.world.ents.z[h.ent(s)]! + 11.9, 0);
  // Five more bring it to ten; the seventh brings it down, and says so.
  for (let n = 0; n < 5; n++) loose(h, pilot);
  expect(hp(wood)).toBe(1000 - 165 * 6);
  loose(h, pilot);
  expect(hp(wood)).toBe(0);
  expect(combat.lastStructure.left).toBe(0);
  expect(s.events.filter((ev) => ev.kind === EVENT_HIT).at(-1)!.kill).toBe(true);
  expect(structs.chunks[Math.floor(wood / 65536)]!.kind[wood & 0xffff]).toBe(0);
  // The next arrow flies through where it stood.
  const fired = shots.fired;
  loose(h, pilot, 1500);
  expect(shots.fired).toBe(fired + 1);
  expect(shots.lastEnd.z).toBeGreaterThan(h.world.ents.z[h.ent(s)]! + 14);
  // The client's copy of the world lost the wall too: its own rays pass.
  const cw = s.world!;
  expect(castWorld(cw, h.world.ents.x[h.ent(s)]!, h.world.ents.y[h.ent(s)]! + 1.2, h.world.ents.z[h.ent(s)]!, 0, 0, 1, 13)).not.toBe(HIT_STRUCTURE);
  expect(h.host.items.audit()).toEqual([]);
});

test("a grenade is thrown in an arc, bounces, lies, and goes off after five seconds: stone takes it hard, metal barely, bodies by how near and what is between", () => {
  const { h, s, pilot, rec, at, hp, structs } = range(46);
  const shots = h.host.projectiles;
  const survival = h.host.survival;
  const ents = h.world.ents;
  h.say(s, "kit grenades");
  const slot = takeInHand(h, s, id("grenade"));
  h.run(700);
  const inv = h.host.items.inv(rec);
  expect(inv.count[slot]).toBe(10);
  const lob = (): void => {
    pilot.pitch = 0.12;
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 12);
    pilot.buttons &= ~BTN_PRIMARY;
  };
  const live = (): number => {
    let n = 0;
    for (let e = 0; e < ents.cap; e++) if ((ents.flags[e]! & 1) !== 0 && ents.kind[e] === id("grenade_live")) n++;
    return n;
  };
  // The first, into the open, to see where one lands: eighteen metres a second and a little loft carry it some twenty metres.
  lob();
  expect(shots.thrownCount).toBe(1);
  expect(inv.count[slot]).toBe(9);
  const g = shots.thrownAt(0);
  // In the air it is a thing in the world that every client is sent, rising at first.
  h.run(300);
  expect(g.y - at.y).toBeGreaterThan(2);
  expect(live()).toBe(1);
  // It comes down, bounces on, and lies.
  let bounced = 0;
  let last = g.y;
  let rising = true;
  h.run(3600, () => {
    if (g.y > last + 1e-4 && !rising) bounced++;
    rising = g.y > last + 1e-4;
    last = g.y;
  });
  expect(bounced).toBeGreaterThanOrEqual(1);
  expect(g.resting).toBe(true);
  expect(g.y - at.y).toBeLessThan(0.1);
  expect(g.z - at.z).toBeGreaterThan(16);
  expect(g.z - at.z).toBeLessThan(40);
  expect(Math.abs(g.x - at.x)).toBeLessThan(0.5);
  expect(shots.bursts).toBe(0);
  const lie = { x: g.x, y: g.y, z: g.z };
  // Five seconds from the throw it goes off, hurting nothing, and is gone from the world.
  h.run(1400);
  expect(shots.bursts).toBe(1);
  expect([shots.thrownCount, live()]).toEqual([0, 0]);
  expect(s.events.filter((ev) => ev.kind === EVENT_BLAST).map((ev) => [ev.far, Math.round(ev.z - lie.z)])).toEqual([[5, 0]]);
  expect(h.host.combat.hits + h.host.combat.structureHits).toBe(0);

  // Now things about that spot: a stone wall beyond it, a metal one to its side, and bodies.
  const stone = structs.add(id("wall"), lie.x, at.y + 1.5, lie.z + 2.5, 0, 0, 1500);
  const metal = structs.add(id("wall_metal"), lie.x + 2.5, at.y + 1.5, lie.z, 16384, 0, 3000);
  const dummy = (dx: number, dz: number, armor = false): { e: number; pid: number } => {
    const e = h.host.spawnCreature("core:dummy", lie.x + dx, lie.z + dz, 1);
    const drec = h.host.records.byPid.get(ents.pid[e]!)!;
    if (armor) for (const part of ["hat", "shirt", "gloves", "pants", "boots"]) dress(h.host, drec, id(`flak_${part}`));
    return { e, pid: drec.pid };
  };
  const near = dummy(-1.4, 0);
  const clad = dummy(0, -1.4, true);
  const far = dummy(-4.4, 0);
  const hidden = dummy(0, 3.6);
  const health = (d: { pid: number }): number => survival.value(h.host.records.byPid.get(d.pid)!, V_HEALTH);
  h.run(300);
  const full = health(near);
  // The same throw lands in the same place.
  lob();
  h.run(4000);
  const again = shots.thrownAt(0);
  expect([again.resting, Math.round((again.x - lie.x) * 100), Math.round((again.z - lie.z) * 100)]).toEqual([true, 0, 0]);
  expect([hp(stone), hp(metal), health(near)]).toEqual([1500, 3000, full]);
  h.run(1400);
  expect(shots.bursts).toBe(2);
  // The walls: each is 2.4 m off at its nearest, which is 65% of the blast. A blast does more than twice as much to stone as to wood, and under a third as much to metal.
  const fade = (d: number): number => (d <= 1 ? 1 : 1 - (d - 1) / 4);
  expect(1500 - hp(stone)).toBeCloseTo(788 * 2.3325 * fade(2.4), 0);
  expect(3000 - hp(metal)).toBeCloseTo(788 * 0.3008 * fade(2.4), 0);
  // The bodies in the open: the nearer the worse; flak (five pieces of 100, each counted once: a sixth gets through) keeps most of it out and is worn all over.
  const lostNear = full - health(near);
  const lostFar = full - health(far);
  const lostClad = full - health(clad);
  // A body is measured from the blast to its middle, less its girth: at 1.4 m most of it lands, at 4.4 m a quarter.
  const reach = (level: number): number => fade(Math.hypot(level, 0.9 - (lie.y + 0.05 - at.y)) - 0.4);
  expect(lostNear).toBeCloseTo(788 * reach(1.4), -0.5);
  expect(lostFar).toBeCloseTo(788 * reach(4.4), -0.5);
  expect(lostFar).toBeLessThan(lostNear * 0.3);
  expect(lostClad).toBeCloseTo(lostNear / 6, -1);
  const cinv = h.host.items.inv(h.host.records.byPid.get(clad.pid)!);
  for (let k = 0; k < 5; k++) expect(cinv.dur[cinv.armor + k]).toBeLessThan(120);
  // The one behind the stone wall, within reach of the blast, was shielded by it.
  expect(Math.hypot(ents.x[hidden.e]! - lie.x, ents.z[hidden.e]! - lie.z)).toBeLessThan(5);
  expect(health(hidden)).toBe(full);
  // The thrower, far off, is told what it did: a number for each thing it hurt.
  expect(s.events.filter((ev) => ev.kind === EVENT_HIT).length).toBe(5);
  // One more brings what is left of the stone wall down.
  lob();
  h.run(5600);
  expect(hp(stone)).toBe(0);
  // Dropped at her own feet, it kills the one who threw it like anyone, and she has no credit for it.
  const xp = rec.xp;
  pilot.pitch = -1.45;
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 12);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(5600);
  expect(rec.dead).toBe(true);
  expect(rec.xp).toBe(xp);
  expect(h.host.items.audit()).toEqual([]);
});

test("damage to something built is saved with it, and a client is shown a blast", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  let packet = app.frame(0, 1280, 720);
  const run = (ms: number): void => h.run(ms, (now) => (packet = app.frame(now, 1280, 720)));
  const say = (line: string): void => {
    app.session.text(line);
    run(200);
  };
  run(500);
  say("enablecheats");
  const g = flatGround(h, 24, 30);
  say(`tp ${(g.x + 12).toFixed(3)} ${(g.z + 1.5).toFixed(3)}`);
  app.controls.yaw = 0;
  run(200);
  // The console stands a wall three metres ahead, facing the caller.
  say("place wall_wood");
  expect(app.session.log.at(-1)!.text).toBe("placed core:wall_wood (10000 health)");
  say("place nothing");
  expect(app.session.log.at(-1)!.text).toBe('no structure "nothing"');
  const structs = h.world.structs;
  expect(castWorld(h.world, g.x + 12, g.y + 1, g.z + 1.5, 0, 0, 1, 10)).toBe(HIT_STRUCTURE);
  const ref = rayHit.ref;
  expect(rayHit.t).toBeCloseTo(2.9, 1);
  const chunk = Math.floor(ref / 65536);
  const version = structs.chunks[chunk]!.version;
  expect(structs.damage(ref, 100)).toBe(9900);
  // Its health is part of the chunk: the chunk changed, so it is sent and saved again.
  expect(structs.chunks[chunk]!.version).toBe(version + 1);
  expect(structs.damage(ref, 0)).toBe(9900);
  expect(structs.damage(999999999, 5)).toBe(-1);
  run(300);
  expect(app.session.world!.structs.chunks[chunk]!.hp[ref & 0xffff]).toBe(9900);
  // A grenade at her feet, looking down: the flash is drawn while it lasts.
  say("god");
  say("kit grenades");
  const s = app.session;
  const inv = s.inventory!;
  s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id("grenade"))), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("grenade"))));
  run(150);
  s.command(CMD_SELECT, (w) => w.u8(0));
  run(700);
  app.controls.pitch = -1.2;
  app.controls.mouseButton(0, true);
  run(400);
  app.controls.mouseButton(0, false);
  expect(h.host.projectiles.thrownCount).toBe(1);
  const meshes = (): string[] => [...packet!.drawMesh.subarray(0, packet!.drawCount)].filter((_, d) => (packet!.drawFlags[d]! & DRAW_SKINNED) !== 0).map((m) => pack.header.meshes[m]!.id);
  app.controls.pitch = -0.6;
  run(4000);
  expect(app.shots.blasts.length).toBe(0);
  for (let n = 0; n < 60 && h.host.projectiles.bursts === 0; n++) run(1000 / 30);
  expect(h.host.projectiles.bursts).toBe(1);
  run(50);
  expect(app.shots.blasts.length).toBe(1);
  expect(meshes()).toContain("core:blast");
  run(BLAST_MS + 100);
  expect(app.shots.blasts.length).toBe(0);
  expect(meshes()).not.toContain("core:blast");
  // The wall in front of her took it; she, a god, did not.
  expect(structs.chunks[chunk]!.kind[ref & 0xffff] === 0 || structs.chunks[chunk]!.hp[ref & 0xffff]! < 9900).toBe(true);
});
