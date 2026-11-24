// The plasma rifle and pistol (planning/workstreams/plasma.md): bolts that fly straight and are gone at their reach, told
// to those near in few bytes, drawn by another's client where the server's are, and harmful to thatch and wood alone.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import "../../client/core/render/city-late.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { BOLT_BACK_MOST, bolt, packBolt, readBolt, writeBolt } from "../../shared/net/bolts.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, EVENT_BLAST, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { DMG_ENERGY } from "../../shared/sim/damage.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = TICK_DT * 1000;

/** A survivor at the south end of a level range with the plasma kit, `gun` in hand and loaded, looking north and `pitch` up. */
function armed(gun: string, pitch: number) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(500);
  h.say(s, "enablecheats");
  const g = flatGround(h, 24, 44);
  const at = { x: g.x + 12, z: g.z + 1.5, y: g.y };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const pilot = h.pilots[0]!;
  [pilot.yaw, pilot.pitch] = [0, pitch];
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  h.say(s, "kit plasma");
  const slot = takeInHand(h, s, id(gun));
  h.run(6000);
  expect(h.host.items.inv(rec).loaded[slot]).toBeGreaterThan(0);
  expect(s.own.act).toBe(ACT_NONE);
  return { h, s, pilot, rec, at, slot };
}

test("a plasma bolt flies straight at its speed, and is gone at its reach having met nothing", () => {
  const { h, pilot } = armed("rifle_plasma", 0.3);
  const shots = h.host.projectiles;
  pilot.buttons |= BTN_PRIMARY;
  let waited = 0;
  while (shots.flyingCount === 0 && waited++ < 30) h.run(TICK_MS);
  pilot.buttons &= ~BTN_PRIMARY;
  expect(shots.flyingCount).toBe(1);
  const first = { ...shots.flyingAt(0) };
  expect(Math.hypot(first.vx, first.vy, first.vz)).toBeCloseTo(240, 3);
  let last = first;
  let ticks = 0;
  for (; shots.flyingCount > 0 && ticks < 100; ticks++) {
    last = { ...shots.flyingAt(0) };
    h.run(TICK_MS);
  }
  // It does not fall: its way at the end is its way at the start.
  expect([last.vx, last.vy, last.vz]).toEqual([first.vx, first.vy, first.vz]);
  // 300 m at 240 m/s is 38 ticks, less those the server flew it at once to where its shooter saw it.
  expect(ticks).toBeLessThanOrEqual(38);
  expect(ticks).toBeGreaterThan(38 - BOLT_BACK_MOST);
  expect(Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z)).toBeLessThanOrEqual(300);
  expect(shots.struck).toBe(0);
  expect(shots.blasts).toBe(0);
});

test("the plasma rifle fires four times a second while its trigger is held, and the pistol once a press", () => {
  const rifle = armed("rifle_plasma", 0.3);
  rifle.pilot.buttons |= BTN_PRIMARY;
  rifle.h.run(2000);
  rifle.pilot.buttons &= ~BTN_PRIMARY;
  expect(rifle.h.host.projectiles.fired).toBeGreaterThanOrEqual(7);
  expect(rifle.h.host.projectiles.fired).toBeLessThanOrEqual(9);
  const pistol = armed("pistol_plasma", 0.3);
  pistol.pilot.buttons |= BTN_PRIMARY;
  pistol.h.run(2000);
  pistol.pilot.buttons &= ~BTN_PRIMARY;
  expect(pistol.h.host.projectiles.fired).toBe(1);
});

test("a bolt harms what it meets and no more: a dummy takes the cell's 150, and nothing goes off", () => {
  const { h, s, pilot, at } = armed("rifle_plasma", 0);
  const e = h.host.spawnCreature("core:dummy", at.x, at.z + 20, 1);
  const beside = h.host.spawnCreature("core:dummy", at.x + 1.2, at.z + 20, 1);
  h.run(200);
  // Aimed and still, the rifle goes where it looks.
  pilot.pitch = Math.atan2(1.0 - 1.62, 20);
  pilot.buttons |= BTN_SECONDARY;
  h.run(800);
  const health = (ent: number): number => h.host.survival.value(h.host.records.byPid.get(h.world.ents.pid[ent]!)!, 0);
  const before = [health(e), health(beside)];
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 2);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(600);
  expect(h.host.projectiles.fired).toBe(1);
  expect(h.host.projectiles.struck).toBe(1);
  expect(before[0]! - health(e)).toBeCloseTo(150, 0);
  expect(health(beside)).toBe(before[1]!);
  expect(h.host.projectiles.blasts).toBe(0);
  expect(s.events.some((ev) => ev.kind === EVENT_BLAST)).toBe(false);
});

test("energy burns thatch, chars wood and leaves stone and metal whole", () => {
  const takes = (material: string): number => {
    const kind = reg.defs.findIndex((d) => d?.type === "structure" && d.material === `core:${material}`);
    expect(kind, material).toBeGreaterThan(0);
    return reg.structTakes[kind]![DMG_ENERGY]!;
  };
  expect([takes("mat_thatch"), takes("mat_wood"), takes("mat_stone"), takes("mat_metal")]).toEqual([1, 0.25, 0, 0]);
});

test("a bolt is told in under a hundred bits: its start to 2 cm, its way to a twentieth of a degree", () => {
  const w = new BitWriter(64);
  const packed = new Uint32Array(10);
  const way = [Math.sin(2.1) * Math.cos(-0.4), Math.sin(-0.4), Math.cos(2.1) * Math.cos(-0.4)] as const;
  packBolt(5123.4567, 87.654, 9001.2345, way[0], way[1], way[2], packed, 0);
  packBolt(12.5, -3.25, 40000.75, 0, 1, 0, packed, 5);
  writeBolt(w, packed, 0, id("plasma_cell"), 4, false, 0);
  const first = w.pos;
  writeBolt(w, packed, 5, id("plasma_cell"), 99, true, id("plasma_cell"));
  // The first of a message names its ammunition, and each after it of the same says so in a bit.
  expect(first).toBe(115);
  expect(w.pos - first).toBe(99);
  const r = new BitReader();
  r.reset(w.bytes());
  readBolt(r, 0);
  expect(Math.hypot(bolt.x - 5123.4567, bolt.z - 9001.2345)).toBeLessThan(0.02);
  expect(Math.abs(bolt.y - 87.654)).toBeLessThan(0.02);
  expect(Math.acos(bolt.dx * way[0] + bolt.dy * way[1] + bolt.dz * way[2]) * (180 / Math.PI)).toBeLessThan(0.05);
  expect([bolt.ammo, bolt.back, bolt.silenced]).toEqual([id("plasma_cell"), 4, false]);
  readBolt(r, bolt.ammo);
  expect([bolt.x, bolt.y, bolt.z, bolt.ammo, bolt.back, bolt.silenced]).toEqual([12.5, -3.25, 40000.75, id("plasma_cell"), BOLT_BACK_MOST, true]);
  expect(bolt.dy).toBeCloseTo(1, 6);
  expect(r.overflow).toBe(false);
});

for (const latencyMs of [40, 150]) {
  test(`at ${latencyMs} ms another's client draws a bolt where the server's is, with its flash, and bursts it where it ends`, () => {
    const h = new Harness({}, 1, 60, { dev: true });
    const pack = corePack();
    const app = new App(h.join("ada", { latencyMs }, { manual: true }), h.reg, pack);
    const eve = new App(h.join("eve", { latencyMs }, { manual: true }), h.reg, pack);
    let seen = eve.frame(0, 1280, 720);
    const run = (ms: number, each?: () => void): void =>
      h.run(ms, (now) => {
        app.frame(now, 1280, 720);
        seen = eve.frame(now, 1280, 720);
        each?.();
      });
    run(500);
    const say = (who: App, line: string): void => {
      who.session.text(line);
      run(300);
    };
    say(app, "enablecheats");
    say(eve, "enablecheats");
    const g = flatGround(h, 24, 44);
    const at = { x: g.x + 12, z: g.z + 1.5 };
    say(app, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
    say(eve, `tp ${(at.x + 8).toFixed(3)} ${(at.z + 10).toFixed(3)}`);
    say(app, "kit plasma");
    // Both clients are driven frame by frame, so the rifle is moved to the hand and chosen here.
    const inv = app.session.inventory!;
    const from = inv.item.indexOf(id("rifle_plasma"));
    if (from !== inv.hotbar) app.session.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("rifle_plasma"))));
    run(150);
    app.session.command(CMD_SELECT, (w) => w.u8(0));
    run(6000);
    // Up and north, into the open: the bolt flies its whole reach.
    app.controls.yaw = 0;
    app.controls.pitch = 0.3;
    run(300);
    const shots = h.host.projectiles;
    const speed = reg.ammoSpeed[id("plasma_cell")]!;
    let apart = -1;
    let flashed = false;
    let drawn = false;
    app.controls.mouseButton(0, true);
    run(400, () => {
      if (eve.shots.flashes.length > 0) flashed = true;
      if (apart >= 0 || eve.shots.flying.length === 0 || shots.flyingCount === 0) return;
      // The first sight of it: how far its copy is from the server's own, along the one line they both fly.
      const mine = eve.shots.flying[0]!;
      const real = shots.flyingAt(0);
      apart = Math.hypot(real.x - mine.x, real.y - mine.y, real.z - mine.z);
      drawn = [...seen!.drawMesh.subarray(0, seen!.drawCount)].some((m, d) => (seen!.drawFlags[d]! & DRAW_SKINNED) !== 0 && pack.header.meshes[m]!.id === "core:plasma_bolt");
    });
    app.controls.mouseButton(0, false);
    expect(apart).toBeGreaterThanOrEqual(0);
    // The message took the link's time to come, and the server's bolt flew on meanwhile: no further than that and a tick.
    expect(apart).toBeLessThanOrEqual((latencyMs / TICK_MS + 2) * speed * TICK_DT);
    expect(flashed).toBe(true);
    expect(drawn).toBe(true);
    expect(eve.session.events.some((ev) => ev.kind === EVENT_SHOT)).toBe(false);
    // Gone at its reach on every side, and nothing burst in the open air.
    run(1600);
    expect([shots.flyingCount, app.shots.flying.length, eve.shots.flying.length]).toEqual([0, 0, 0]);
    expect(eve.shots.bursts.length).toBe(0);
    // Into the ground ahead: each client bursts its own copy there, and the server sends no blast.
    app.controls.pitch = -0.2;
    run(300);
    let burst = false;
    app.controls.mouseButton(0, true);
    run(500, () => {
      if (eve.shots.bursts.length > 0 && app.shots.bursts.length > 0) burst = true;
    });
    app.controls.mouseButton(0, false);
    expect(burst).toBe(true);
    expect(shots.blasts).toBe(0);
  });
}
