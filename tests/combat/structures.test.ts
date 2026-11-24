import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { BLAST_MS } from "../../client/core/shots.ts";
import { slopeKind } from "../../content/slopes.ts";
import { dress } from "../../server/commands/combat.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, EVENT_BLAST, EVENT_HIT } from "../../shared/net/protocol.ts";
import { SURFACE_GROUND } from "../../shared/net/rockets.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { camp, clearing } from "../kit/kit.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const EYE = 1.62;

/** The survivor stands at the south end of a level range, looking north. */
function range(deep = 30) {
  const { h, ada: s, me: rec, at } = camp({ place: clearing(24, deep, 1.5) });
  const pilot = h.pilots[0]!;
  h.run(300);
  const structs = h.world.structs;
  /** A wall across the range `far` metres off. Returns its ref. */
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
  expect(castWorld(w, at.x, at.y + 2, at.z, 0, -1, 0, 5)).toBe(HIT_TERRAIN);
  const facing = (): number[] => [rayHit.nx, rayHit.ny, rayHit.nz].map((v) => Math.round(v * 1000) / 1000 + 0);
  expect(facing()).toEqual([0, 1, 0]);
  const k = id("wall");
  structs.add(k, at.x, at.y + 1.5, at.z + 6, 0, 0, 1500);
  expect(castWorld(w, at.x, at.y + 1, at.z, 0, 0, 1, 20)).toBe(HIT_STRUCTURE);
  expect(facing()).toEqual([0, 0, -1]);
  expect(rayHit.t).toBeCloseTo(5.9, 3);
  castWorld(w, at.x, at.y + 1, at.z + 12, 0, 0, -1, 20);
  expect(facing()).toEqual([0, 0, 1]);
  castWorld(w, at.x, at.y + 6, at.z + 6, 0, -1, 0, 20);
  expect(facing()).toEqual([0, 1, 0]);
  // Yaw 8192 is an eighth of a turn, and the normal turns with the wall.
  structs.add(k, at.x + 6, at.y + 1.5, at.z + 6, 8192, 0, 1500);
  expect(castWorld(w, at.x + 6, at.y + 1, at.z, 0, 0, 1, 20)).toBe(HIT_STRUCTURE);
  expect(Math.hypot(rayHit.nx, rayHit.ny, rayHit.nz)).toBeCloseTo(1, 6);
  expect(Math.abs(rayHit.nx)).toBeCloseTo(Math.SQRT1_2, 3);
  expect(rayHit.nz).toBeCloseTo(-Math.SQRT1_2, 3);
  // A slope's normal points up and downhill.
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
  face(-6);
  swing(h, pilot);
  expect(hp(thatch)).toBe(1600 - 8);
  expect([combat.structureHits, combat.lastStructure.damage, combat.lastStructure.left]).toEqual([1, 8, 1592]);
  const told = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(told.map((ev) => [ev.zone, ev.damage, ev.kill])).toEqual([[ZONE_NONE, 8, false]]);
  face(0);
  swing(h, pilot);
  face(6);
  swing(h, pilot);
  expect([hp(wood), hp(stone), combat.structureHits]).toEqual([10000, 10000, 1]);
  // A blow that does nothing costs the hatchet no durability.
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
  // With 30 health left, two blows of 20 bring it down.
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
  // About half of the stone arrows stick in the wall.
  h.run(900);
  for (let n = 0; n < 6; n++) {
    aimAt(1.2 + n * 0.2);
    loose(h, pilot);
  }
  expect([hp(wood), combat.structureHits]).toEqual([10000, 0]);
  expect(shots.stuckCount).toBeGreaterThanOrEqual(1);
  // 10,000 health is sixty flame arrows' worth, so the wall starts the test with a thousand left.
  structs.damage(wood, 9000);
  // A flame arrow does 55 of fire, which counts three times on wood.
  h.host.items.load(rec, slot, id("arrow_flame"), 1);
  h.run(900);
  aimAt(1.5);
  loose(h, pilot);
  expect(hp(wood)).toBe(1000 - 165);
  expect(combat.lastStructure).toEqual({ ref: wood, damage: 165, left: 835 });
  const told = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(told.at(-1)!.damage).toBe(165);
  expect(told.at(-1)!.z).toBeCloseTo(h.world.ents.z[h.ent(s)]! + 11.9, 0);
  // Six leave it at 10, and the seventh brings it down.
  for (let n = 0; n < 5; n++) loose(h, pilot);
  expect(hp(wood)).toBe(1000 - 165 * 6);
  loose(h, pilot);
  expect(hp(wood)).toBe(0);
  expect(combat.lastStructure.left).toBe(0);
  expect(s.events.filter((ev) => ev.kind === EVENT_HIT).at(-1)!.kill).toBe(true);
  expect(structs.chunks[Math.floor(wood / 65536)]!.kind[wood & 0xffff]).toBe(0);
  const fired = shots.fired;
  loose(h, pilot, 1500);
  expect(shots.fired).toBe(fired + 1);
  expect(shots.lastEnd.z).toBeGreaterThan(h.world.ents.z[h.ent(s)]! + 14);
  // The client's copy of the world lost the wall too.
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
  // The first throw finds where a grenade lands. At 18 m/s with a little loft it carries some twenty metres.
  lob();
  expect(shots.thrownCount).toBe(1);
  expect(inv.count[slot]).toBe(9);
  const g = shots.thrownAt(0);
  h.run(300);
  expect(g.y - at.y).toBeGreaterThan(2);
  expect(live()).toBe(1);
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
  // The fuse is five seconds from the throw.
  h.run(1400);
  expect(shots.bursts).toBe(1);
  expect([shots.thrownCount, live()]).toEqual([0, 0]);
  // Where it lay, to the 64th of a metre an event carries a place in, on the ground, and the grenade's own blast.
  expect(s.events.filter((ev) => ev.kind === EVENT_BLAST).map((ev) => [ev.far, Math.abs(ev.z - lie.z) < 0.02, ev.item, ev.id, ev.surface])).toEqual([[6, true, id("grenade"), 0, SURFACE_GROUND]]);
  expect(h.host.combat.hits + h.host.combat.structureHits).toBe(0);

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
  // Each wall is 2.4 m off at its nearest, which leaves 72% of a blast reaching 6 m (Grenade). A blast does more than twice as much to stone as to wood
  // and under a third as much to metal.
  const fade = (d: number): number => (d <= 1 ? 1 : 1 - (d - 1) / 5);
  expect(1500 - hp(stone)).toBeCloseTo(788 * 2.3325 * fade(2.4), 0);
  expect(3000 - hp(metal)).toBeCloseTo(788 * 0.3008 * fade(2.4), 0);
  // Against a blast each of the five flak pieces of 100 counts once, so a sixth gets through and every piece is worn.
  const lostNear = full - health(near);
  const lostFar = full - health(far);
  const lostClad = full - health(clad);
  // Distance runs from the blast to the body's middle, less its girth. At 1.4 m most of the blast lands, at 4.4 m two fifths.
  // A body takes ARK's 175 (Grenade), and what is built 4.5 times that (D435).
  const reach = (level: number): number => fade(Math.hypot(level, 0.9 - (lie.y + 0.05 - at.y)) - 0.4);
  expect(lostNear).toBeCloseTo(175 * reach(1.4), -0.5);
  expect(lostFar).toBeCloseTo(175 * reach(4.4), -0.5);
  expect(lostFar).toBeLessThan(lostNear * 0.45);
  expect(lostClad).toBeCloseTo(lostNear / 6, -1);
  const cinv = h.host.items.inv(h.host.records.byPid.get(clad.pid)!);
  for (let k = 0; k < 5; k++) expect(cinv.dur[cinv.armor + k]).toBeLessThan(120);
  // The dummy behind the stone wall is within reach of the blast and shielded by the wall.
  expect(Math.hypot(ents.x[hidden.e]! - lie.x, ents.z[hidden.e]! - lie.z)).toBeLessThan(5);
  expect(health(hidden)).toBe(full);
  // One hit event for each of the three bodies, and one for the two walls together: what the blast did to both, where it was.
  const reports = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(reports.length).toBe(4);
  const walls = reports.filter((ev) => Math.abs(ev.x - lie.x) < 0.01 && Math.abs(ev.z - lie.z) < 0.01);
  expect(walls.map((ev) => ev.damage)).toEqual([Math.round(1500 - hp(stone) + 3000 - hp(metal))]);
  lob();
  h.run(5600);
  expect(hp(stone)).toBe(0);
  // Dropped at her own feet, it kills her and earns no experience.
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

test("a sloped piece takes a blast by its nearest part, not by the air its box holds over the ramp's low end", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const g = flatGround(h, 12, 12);
  const structs = h.world.structs;
  // A ramp rising 2 m over 6 m toward +Z, its top 0.2 m over its middle line, its box 1.2 m each way of its middle.
  const kind = reg.index.get(slopeKind("ramp"))!;
  const [x, y, z] = [g.x + 6, g.y + 1.2, g.z + 6];
  const ramp = structs.add(kind, x, y, z, 0, 0, 16000);
  const hp = (): number => structs.chunks[Math.floor(ramp / 65536)]!.hp[ramp & 0xffff]!;
  const src = { by: null, x, z, item: 0, base: 100, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  const lost = (dy: number, dz: number): number => {
    const before = hp();
    h.host.combat.blast(src, x, y + dy, z + dz, 5);
    return before - hp();
  };
  // Just over the slope, and 1 m up in its box over the low end, 1.63 m over the slope there and 1.55 m off it.
  const on = lost(0.25, 0);
  const air = lost(1, -2.5);
  const off = (1 + 2.5 / 3 - 0.2) * Math.cos(Math.atan(1 / 3));
  expect(on).toBeGreaterThan(0);
  expect(air / on).toBeCloseTo(1 - (off - 1) / 4, 2);
  // Out of reach of its parts, though within reach of its box's top.
  expect(lost(5.6, -2.5)).toBe(0);
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
  // `place` stands the wall three metres ahead.
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
  // Health is part of the chunk, so damage bumps the chunk's version and it is sent and saved again.
  expect(structs.chunks[chunk]!.version).toBe(version + 1);
  expect(structs.damage(ref, 0)).toBe(9900);
  expect(structs.damage(999999999, 5)).toBe(-1);
  run(300);
  expect(app.session.world!.structs.chunks[chunk]!.hp[ref & 0xffff]).toBe(9900);
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
  expect(structs.chunks[chunk]!.kind[ref & 0xffff] === 0 || structs.chunks[chunk]!.hp[ref & 0xffff]! < 9900).toBe(true);
});
