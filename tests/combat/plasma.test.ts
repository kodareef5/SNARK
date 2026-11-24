// The plasma rifle and pistol (planning/workstreams/plasma.md): bolts that fly straight and are gone at their reach, told
// to those near in few bytes, drawn by another's client where the server's are, and harmful to thatch and wood alone.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import "../../client/core/render/city-late.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, TICK_DT } from "../../shared/coords.ts";
import { BOLT_BACK_MOST, bolt, packBolt, readBolt, writeBolt } from "../../shared/net/bolts.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, EVENT_BLAST, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { DMG_ENERGY } from "../../shared/sim/damage.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { paging } from "../../tools/build-client.ts";
import { bootManifest, splitPack } from "../../tools/pack/split.ts";
import { flatGround } from "../fixtures/arena.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack, corePackBytes } from "../fixtures/pack.ts";
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
  const { h, pilot, at } = armed("rifle_plasma", 0.3);
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
  // Where it was last seen is where its last piece began: within a tick's 8 m of the 300 it reaches, and not past them.
  const gone = Math.hypot(last.x - at.x, last.y - (at.y + 1.62), last.z - at.z);
  expect(gone).toBeLessThanOrEqual(300);
  expect(gone).toBeGreaterThan(300 - 240 * TICK_DT - 0.5);
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

test("a bolt is told in a hundred bits: its start to 2 cm, its way to a twentieth of a degree", () => {
  const w = new BitWriter(64);
  const packed = new Uint32Array(10);
  const way = [Math.sin(2.1) * Math.cos(-0.4), Math.sin(-0.4), Math.cos(2.1) * Math.cos(-0.4)] as const;
  packBolt(5123.4567, 87.654, 9001.2345, way[0], way[1], way[2], packed, 0);
  packBolt(12.5, -3.25, 40000.75, 0, 1, 0, packed, 5);
  writeBolt(w, packed, 0, id("plasma_cell"), 4, false, 0);
  const first = w.pos;
  writeBolt(w, packed, 5, id("plasma_cell"), 99, true, id("plasma_cell"));
  // The first of a message names its ammunition, and each after it of the same says so in a bit.
  expect(first).toBe(116);
  expect(w.pos - first).toBe(100);
  // One that had ended when it was told says how far it had gone, in 13 bits more.
  const second = w.pos;
  writeBolt(w, packed, 0, id("plasma_cell"), 3, false, id("plasma_cell"), 19.6);
  expect(w.pos - second).toBe(113);
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
  expect(bolt.ended).toBe(0);
  readBolt(r, bolt.ammo);
  expect(Math.abs(bolt.ended - 19.6)).toBeLessThan(1 / 16);
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
      // A bolt's flash points the way its shot left: north, and up as the rifle looks.
      for (const f of [...eve.shots.flashes, ...app.shots.flashes]) {
        expect(Math.abs(f.dy - Math.sin(0.3))).toBeLessThan(0.05);
        expect(f.dz).toBeGreaterThan(0.9);
      }
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

test("a client whose assets stream, as the browser's do, draws its own bolt and another's, their flashes and their bursts", () => {
  // The build's own split: the boot pack holds no mesh of any shot, and each comes in a page when first asked for.
  const whole = corePackBytes();
  const { files, manifest } = splitPack(whole, "core", paging(reg, parsePack(whole)));
  const boot = parsePack(files[manifest.boot]!.bytes);
  expect(boot.meshIndex.has("core:plasma_bolt")).toBe(false);
  const first = (): Manifest => parseManifest(JSON.stringify(bootManifest(manifest)));
  const h = new Harness({}, 1, 60, { dev: true });
  const nets = [new FakeNet(files.map((f) => f.bytes), { latencyMs: 30, bytesPerSecond: 2e6 }), new FakeNet(files.map((f) => f.bytes), { latencyMs: 30, bytesPerSecond: 2e6 })];
  const app = new App(h.join("ada", { latencyMs: 40 }, { manual: true }), h.reg, boot, { manifest: first(), port: nets[0]! });
  const eve = new App(h.join("eve", { latencyMs: 40 }, { manual: true }), h.reg, boot, { manifest: first(), port: nets[1]! });
  const drawn = [new Set<string>(), new Set<string>()];
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      for (const net of nets) net.advance(now);
      [app, eve].forEach((a, k) => {
        const p = a.frame(now, 1280, 720);
        if (p) for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_SKINNED) !== 0) drawn[k]!.add(manifest.meshes[p.drawMesh[d]!]!.id);
      });
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
  const inv = app.session.inventory!;
  const from = inv.item.indexOf(id("rifle_plasma"));
  if (from !== inv.hotbar) app.session.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("rifle_plasma"))));
  run(150);
  app.session.command(CMD_SELECT, (w) => w.u8(0));
  run(6000);
  // Level and a little down, so the bolts cross the open ground and end on it. Nothing of them was drawn before the first.
  app.controls.yaw = 0;
  app.controls.pitch = -0.05;
  run(300);
  expect([drawn[0]!.has("core:plasma_bolt"), drawn[1]!.has("core:plasma_bolt")]).toEqual([false, false]);
  app.controls.mouseButton(0, true);
  run(1500);
  app.controls.mouseButton(0, false);
  run(500);
  for (const seen of drawn) expect(["core:plasma_bolt", "core:plasma_flash", "core:plasma_burst"].filter((m) => !seen.has(m))).toEqual([]);
  expect(drawn[0]!.has("core:rifle_plasma")).toBe(true);
});

/** A survivor in the middle of a wide flat map with the rifle in hand and loaded, aimed level and north, over a link of `latencyMs`. */
function onTheFlat(latencyMs: number) {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  const s = h.join("ada", { latencyMs });
  h.run(1000);
  h.say(s, "enablecheats");
  const at = { x: 24 * CHUNK_SIZE, z: 24 * CHUNK_SIZE - 600, y: 0 };
  h.say(s, `tp ${at.x} ${at.z}`);
  h.run(500);
  at.y = h.world.ents.y[h.ent(s)]!;
  h.say(s, "kit plasma");
  takeInHand(h, s, id("rifle_plasma"));
  h.run(6000);
  const pilot = h.pilots[0]!;
  [pilot.yaw, pilot.pitch] = [0, 0];
  // Aimed and still, the rifle goes where it looks.
  pilot.buttons |= BTN_SECONDARY;
  h.run(1000);
  return { h, s, pilot, at };
}

for (const latencyMs of [0, 45, 110]) {
  test(`over a link of ${latencyMs} ms a bolt meets a wall 299 m off and never one 301 m off`, () => {
    for (const far of [299, 301]) {
      const { h, pilot, at } = onTheFlat(latencyMs);
      const wall = id("wall");
      h.world.structs.add(wall, at.x, at.y + 1.5, at.z + far, 0, 0, 10000);
      const shots = h.host.projectiles;
      shots.lastEnd.z = -1;
      pilot.buttons |= BTN_PRIMARY;
      h.run(TICK_MS * 2);
      pilot.buttons &= ~BTN_PRIMARY;
      h.run(2500);
      expect(shots.fired).toBe(1);
      expect(shots.flyingCount).toBe(0);
      // The wall is 0.2 m thick about its middle: one within reach is met on its near face.
      if (far < 300) expect(Math.abs(shots.lastEnd.z - (at.z + far - 0.1))).toBeLessThan(0.05);
      else expect(shots.lastEnd.z).toBe(-1);
    }
  });
}

test("a client far up a bolt's way is told of it, though out of hearing of its muzzle, and one as far to the side is not", () => {
  const { h, pilot, at } = onTheFlat(40);
  const place = (name: string, x: number, z: number) => {
    const s = h.join(name, { latencyMs: 40 });
    h.run(500);
    h.say(s, "enablecheats");
    h.say(s, `tp ${x} ${z}`);
    return s;
  };
  // 240 m is within hearing of the muzzle. 280 m is not, and is 20 m short of where the bolt is gone.
  const near = place("bea", at.x + 4, at.z + 240);
  const far = place("cyd", at.x + 4, at.z + 280);
  const aside = place("dee", at.x + 280, at.z);
  h.run(500);
  for (const s of [near, far, aside]) s.events.length = 0;
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 2);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(600);
  expect(h.host.projectiles.fired).toBe(1);
  const told = (s: typeof near): number => s.events.filter((ev) => ev.kind === EVENT_SHOT && ev.flies).length;
  expect([told(near), told(far), told(aside)]).toEqual([1, 1, 0]);
});

for (const far of [8, 20]) {
  test(`another's client bursts a bolt on a body ${far} m from its muzzle, and draws none flying on past it`, () => {
    const h = new Harness({}, 1, 60, { dev: true });
    const pack = corePack();
    // The shooter's link is slow, so the server flies the bolt several ticks at once, and through the body, as it fires.
    const app = new App(h.join("ada", { latencyMs: 110 }, { manual: true }), h.reg, pack);
    const eve = new App(h.join("eve", { latencyMs: 20 }, { manual: true }), h.reg, pack);
    const run = (ms: number, each?: () => void): void =>
      h.run(ms, (now) => {
        app.frame(now, 1280, 720);
        eve.frame(now, 1280, 720);
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
    say(eve, `tp ${(at.x + 8).toFixed(3)} ${(at.z + 12).toFixed(3)}`);
    say(app, "kit plasma");
    const inv = app.session.inventory!;
    const from = inv.item.indexOf(id("rifle_plasma"));
    if (from !== inv.hotbar) app.session.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("rifle_plasma"))));
    run(150);
    app.session.command(CMD_SELECT, (w) => w.u8(0));
    run(6000);
    expect(h.host.spawnCreature("core:dummy", at.x, at.z + far, 1)).toBeGreaterThanOrEqual(0);
    app.controls.yaw = 0;
    app.controls.pitch = Math.atan2(1.0 - 1.62, far);
    app.controls.mouseButton(2, true);
    run(1000);
    let past = 0;
    let burst: { x: number; z: number } | null = null;
    app.controls.mouseButton(0, true);
    run(100);
    app.controls.mouseButton(0, false);
    run(900, () => {
      for (const f of eve.shots.flying) if (f.z > at.z + far + 1) past++;
      burst ??= eve.shots.bursts[0] ? { x: eve.shots.bursts[0].x, z: eve.shots.bursts[0].z } : null;
    });
    expect(h.host.projectiles.struck).toBe(1);
    expect(past).toBe(0);
    expect(burst).not.toBeNull();
    // On the body's near side, within its width of its middle.
    expect(Math.abs(burst!.z - (at.z + far))).toBeLessThan(1);
    expect(Math.abs(burst!.x - at.x)).toBeLessThan(1);
  });
}
