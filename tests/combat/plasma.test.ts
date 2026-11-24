// The plasma rifle and pistol (planning/workstreams/plasma.md): bolts that fly straight and are gone at their reach, told
// to those near in few bytes, drawn by another's client where the server's are, and harmful to thatch and wood alone.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import type { Characters } from "../../client/core/render/characters.ts";
import { RemoteSample, type ClientSession, type CombatEvent } from "../../client/core/session.ts";
import { Shots } from "../../client/core/shots.ts";
import "../../client/core/render/city-late.ts";
import { DRAW_SKINNED, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_DT } from "../../shared/coords.ts";
import { BOLT_BACK_MOST, BOLT_MINE, BOLT_SILENCED, BOLT_WET, bolt, packBolt, readBolt, writeBolt } from "../../shared/net/bolts.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, EVENT_BLAST, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { BTN_PRIMARY, BTN_SECONDARY, STANCE_PRONE, STANCE_STAND } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
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

test("a bolt is told in a hundred and three bits: its start to 2 cm, its way to a twentieth of a degree", () => {
  const w = new BitWriter(96);
  const packed = new Uint32Array(10);
  const way = [Math.sin(2.1) * Math.cos(-0.4), Math.sin(-0.4), Math.cos(2.1) * Math.cos(-0.4)] as const;
  packBolt(5123.4567, 87.654, 9001.2345, way[0], way[1], way[2], packed, 0);
  packBolt(12.5, -3.25, 40000.75, 0, 1, 0, packed, 5);
  writeBolt(w, packed, 0, id("plasma_cell"), 4, 0, 0);
  const first = w.pos;
  writeBolt(w, packed, 5, id("plasma_cell"), 99, BOLT_SILENCED | BOLT_MINE, id("plasma_cell"));
  // The first of a message names its ammunition, and each after it of the same says so in a bit.
  expect(first).toBe(119);
  expect(w.pos - first).toBe(103);
  // One that had ended when it was told says how far it had gone, in 13 bits more; one that left slower than its
  // ammunition flies, a bow's half drawn, says at what share in 8. The ticks since it left are whole, and never one more.
  const second = w.pos;
  writeBolt(w, packed, 0, id("plasma_cell"), 3.9, BOLT_WET, id("plasma_cell"), 19.6, 0.75);
  expect(w.pos - second).toBe(124);
  const r = new BitReader();
  r.reset(w.bytes());
  readBolt(r, 0);
  expect(Math.hypot(bolt.x - 5123.4567, bolt.z - 9001.2345)).toBeLessThan(0.02);
  expect(Math.abs(bolt.y - 87.654)).toBeLessThan(0.02);
  expect(Math.acos(bolt.dx * way[0] + bolt.dy * way[1] + bolt.dz * way[2]) * (180 / Math.PI)).toBeLessThan(0.05);
  expect([bolt.ammo, bolt.back, bolt.silenced, bolt.wet, bolt.mine]).toEqual([id("plasma_cell"), 4, false, false, false]);
  readBolt(r, bolt.ammo);
  expect([bolt.x, bolt.y, bolt.z, bolt.ammo, bolt.back, bolt.silenced, bolt.wet, bolt.mine]).toEqual([12.5, -3.25, 40000.75, id("plasma_cell"), BOLT_BACK_MOST, true, false, true]);
  expect(bolt.dy).toBeCloseTo(1, 6);
  expect([bolt.ended, bolt.speed]).toEqual([0, 1]);
  readBolt(r, bolt.ammo);
  expect(Math.abs(bolt.ended - 19.6)).toBeLessThan(1 / 16);
  expect(Math.abs(bolt.speed - 0.75)).toBeLessThan(1 / 255);
  expect([bolt.back, bolt.wet, bolt.mine]).toEqual([3, true, false]);
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

test("both streamed clients draw every plasma effect glowing from its first frame", () => {
  const whole = corePackBytes();
  const { files, manifest } = splitPack(whole, "core", paging(reg, parsePack(whole)));
  const boot = parsePack(files[manifest.boot]!.bytes);
  const effects = ["core:plasma_bolt", "core:plasma_flash", "core:plasma_burst"];
  for (const id of effects) {
    const level = manifest.meshes.find((mesh) => mesh.id === id)!.levels[0]!;
    expect(level.file).toBe(manifest.boot);
    expect(level.parts.length).toBeGreaterThan(1);
    expect(level.surface).toBeUndefined();
  }
  expect(boot.meshIndex.has("core:rifle_plasma")).toBe(false);
  const first = (): Manifest => parseManifest(JSON.stringify(bootManifest(manifest)));
  const h = new Harness({}, 1, 60, { dev: true });
  // Every fetch takes 150 ms to begin, so what a shot is drawn with must have been asked for before the shot.
  const nets = [new FakeNet(files.map((f) => f.bytes), { latencyMs: 150, bytesPerSecond: 2e6 }), new FakeNet(files.map((f) => f.bytes), { latencyMs: 150, bytesPerSecond: 2e6 })];
  const app = new App(h.join("ada", { latencyMs: 40 }, { manual: true }), h.reg, boot, { manifest: first(), port: nets[0]! });
  const eve = new App(h.join("eve", { latencyMs: 40 }, { manual: true }), h.reg, boot, { manifest: first(), port: nets[1]! });
  const drawn = [new Set<string>(), new Set<string>()];
  /** Frames in which the shooter's own bolt was in the air, and those of them in which it was drawn with its glowing material. */
  let flying = 0, glowing = 0;
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      for (const net of nets) net.advance(now);
      [app, eve].forEach((a, k) => {
        const p = a.frame(now, 1280, 720);
        let lit = false;
        if (p) for (let d = 0; d < p.drawCount; d++) {
          if ((p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
          const mesh = manifest.meshes[p.drawMesh[d]!]!.id;
          drawn[k]!.add(mesh);
          if (effects.includes(mesh)) {
            expect(p.drawFlags[d]! & DRAW_TEXTURED).toBe(DRAW_TEXTURED);
            expect(manifest.materials![p.drawMaterial[d]!]!.id).toBe("core:plasma/plasma");
            if (mesh === "core:plasma_bolt") lit = true;
          }
        }
        if (k === 0 && a.shots.flying.length > 0) {
          flying++;
          if (lit) glowing++;
        }
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
  for (const seen of drawn) expect(effects.filter((m) => !seen.has(m))).toEqual([]);
  expect(drawn[0]!.has("core:rifle_plasma")).toBe(true);
  // From the first shot on: no frame had a bolt in the air and nothing glowing drawn for it.
  expect(flying).toBeGreaterThan(20);
  expect(glowing).toBe(flying);
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

// A gun for measuring with: it goes exactly where it looks, and its round is the rifle's bolt but for its harm.
const LANCE: readonly Def[] = [
  { type: "item", class: "weapon", id: "core:test_lance", stack: 1, weapon: { kind: "gun", ammo: ["core:test_lance_bolt"], clip: 1, reload: 1, uses: 100, mesh: "core:rifle", hold: "rifle" } },
  { type: "item", class: "ammo", id: "core:test_lance_bolt", stack: 100, ammo: { damage: 10, type: "energy", speed: 240, gravity: 0, reach: 300, mesh: "core:dart" } },
];

for (const crossing of [false, true]) {
  test(`a bolt's last piece meets a body ${crossing ? "that only reaches its line after the bolt is gone: it is not harmed" : "standing in it"}`, () => {
    const made = compileContent([...CORE_CONTENT, ...LANCE]);
    expect(made.errors).toEqual([]);
    const lance = made.registry!;
    const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) }, lance);
    const s = h.join("ada");
    h.run(1000);
    h.say(s, "enablecheats");
    const at = { x: 24 * CHUNK_SIZE, z: 24 * CHUNK_SIZE - 600 };
    h.say(s, `tp ${at.x} ${at.z}`);
    h.run(500);
    const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
    h.host.items.mint(rec, lance.index.get("core:test_lance")!, 1);
    h.host.items.mint(rec, lance.index.get("core:test_lance_bolt")!, 5);
    h.run(300);
    takeInHand(h, s, lance.index.get("core:test_lance")!);
    h.run(3000);
    const pilot = h.pilots[0]!;
    [pilot.yaw, pilot.pitch] = [0, 0];
    h.run(300);
    const ents = h.world.ents;
    const ground = ents.y[h.ent(s)]!;
    const dummy = h.host.spawnCreature("core:dummy", at.x + 60, at.z + 200, 1);
    expect(dummy).toBeGreaterThanOrEqual(0);
    h.run(300);
    const shots = h.host.projectiles;
    pilot.buttons |= BTN_PRIMARY;
    for (let t = 0; shots.flyingCount === 0 && t < 30; t++) h.run(TICK_MS);
    pilot.buttons &= ~BTN_PRIMARY;
    expect(shots.flyingCount).toBe(1);
    const bolt = shots.flyingAt(0) as unknown as { x: number; z: number; oz: number; gone: number };
    // A body crossing at 45 m/s is 1.5 m from the line a tick before it reaches it.
    const SPEED = 45;
    let share = -1;
    for (let t = 0; t < 60 && shots.flyingCount > 0; t++) {
      const left = 300 - bolt.gone;
      const piece = 240 * TICK_DT;
      // The bolt's last piece is the next tick's when under one is left, and the tick before it when under two are.
      const within = left <= piece ? 0 : left <= 2 * piece ? 1 : -1;
      if (within >= 0) {
        if (within === 0) share = left / piece;
        // Just short of where the bolt is gone: on its line as that tick ends, and for one crossing, a tick's travel off before.
        ents.setPosition(dummy, bolt.x + (crossing ? within * SPEED * TICK_DT : 0), ground, bolt.oz + 300 - 0.4);
      }
      h.run(TICK_MS);
    }
    // The last piece took under two thirds of its tick, so one crossing was still a body's width off when the bolt was gone.
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.66);
    expect(shots.flyingCount).toBe(0);
    expect(shots.struck).toBe(crossing ? 0 : 1);
  });
}

/** Two clients drawn frame by frame on level ground: ada, who shoots, 1.5 m into a range that runs north, and eve. */
function watched(shooterMs: number, eveAt: readonly [number, number], wide = false) {
  const h = new Harness({}, 1, 60, wide ? { dev: true, map: writeMap(flatMap(48)) } : { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", { latencyMs: shooterMs }, { manual: true }), h.reg, pack);
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
  const g = wide ? null : flatGround(h, 24, 44);
  const at = g ? { x: g.x + 12, z: g.z + 1.5, y: g.y } : { x: 24 * CHUNK_SIZE, z: 24 * CHUNK_SIZE - 600, y: 0 };
  say(app, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  say(eve, `tp ${(at.x + eveAt[0]).toFixed(3)} ${(at.z + eveAt[1]).toFixed(3)}`);
  if (!g) at.y = h.world.ents.y[h.ent(app.session)]!;
  /** Gives ada `kit` and puts `item` in her hand. */
  const arm = (kit: string, item: number): void => {
    say(app, `kit ${kit}`);
    const inv = app.session.inventory!;
    const from = inv.item.indexOf(item);
    if (from !== inv.hotbar) app.session.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(item)));
    run(150);
    app.session.command(CMD_SELECT, (w) => w.u8(0));
    run(6000);
  };
  return { h, app, eve, run, at, arm };
}

test("one a bolt hits sees it burst on their own body, and not fly on through them", () => {
  // Eighty metres up the range: further than the server flies the bolt as it fires, so each client finds the end itself.
  const FAR = 80;
  const { h, app, eve, run, at, arm } = watched(20, [0, FAR], true);
  h.host.survival.gods.add(h.client(eve.session)!.pid);
  arm("plasma", id("rifle_plasma"));
  app.controls.yaw = 0;
  app.controls.pitch = Math.atan2(1.0 - 1.62, FAR);
  app.controls.mouseButton(2, true);
  run(1000);
  let past = 0;
  let burst: { x: number; z: number } | null = null;
  app.controls.mouseButton(0, true);
  run(100);
  app.controls.mouseButton(0, false);
  run(900, () => {
    for (const f of eve.shots.flying) if (f.z > at.z + FAR + 1) past++;
    burst ??= eve.shots.bursts[0] ? { x: eve.shots.bursts[0].x, z: eve.shots.bursts[0].z } : null;
  });
  expect(h.host.projectiles.struck).toBe(1);
  expect(past).toBe(0);
  expect(burst).not.toBeNull();
  expect(Math.abs(burst!.z - (at.z + FAR))).toBeLessThan(1);
  expect(Math.abs(burst!.x - at.x)).toBeLessThan(1);
});

for (const [what, far, latencyMs] of [["a bolt", 7, 20], ["a bolt", 7, 45], ["a bolt", 7, 110], ["a half-drawn arrow", 2, 45], ["a half-drawn arrow", 2, 110]] as const) {
  test(`over a link of ${latencyMs} ms another's client never draws ${what} beyond a wall ${far} m from its muzzle`, () => {
    const { h, app, eve, run, at, arm } = watched(latencyMs, [6, 3]);
    h.world.structs.add(id("wall"), at.x, at.y + 1.5, at.z + far, 0, 0, 10000);
    if (what === "a bolt") arm("plasma", id("rifle_plasma"));
    else arm("bow", id("bow"));
    app.controls.yaw = 0;
    app.controls.pitch = 0;
    run(500);
    let seen = 0, past = 0;
    const watch = (): void => {
      seen = Math.max(seen, eve.shots.flying.length + eve.shots.bursts.length + eve.shots.ends.length);
      for (const f of eve.shots.flying) if (f.z > at.z + far) past++;
    };
    app.controls.mouseButton(0, true);
    // A bow is fully drawn in 36 ticks: let go at half of that.
    run(what === "a bolt" ? 100 : 18 * TICK_MS, watch);
    app.controls.mouseButton(0, false);
    run(1500, watch);
    expect(h.host.projectiles.fired).toBe(1);
    // It was told, and ended at the wall on the watcher's screen as on the server.
    expect(seen).toBeGreaterThan(0);
    expect(past).toBe(0);
    expect(Math.abs(h.host.projectiles.lastEnd.z - (at.z + far - 0.1))).toBeLessThan(0.05);
  });
}

test("a bolt the server flew part of a tick as it fired is told as not flown, and stops at a wall within that tick's reach", () => {
  const { h, app, eve, run, at, arm } = watched(20, [6, 3]);
  // 6.9 m off: past the 6 m the server flies it at once, short of the 8 m a whole tick would carry a copy untested.
  const far = 6.9;
  h.world.structs.add(id("wall"), at.x, at.y + 1.5, at.z + far, 0, 0, 10000);
  arm("plasma", id("rifle_plasma"));
  app.controls.yaw = 0;
  app.controls.pitch = 0;
  run(500);
  // The shooter's view is three quarters of a tick old, whatever its link.
  h.host.combat.viewTick = () => h.world.tick - 0.75;
  let seen = 0, past = 0;
  const watch = (): void => {
    seen = Math.max(seen, eve.shots.flying.length + eve.shots.bursts.length);
    for (const f of eve.shots.flying) if (f.z > at.z + far) past++;
  };
  app.controls.mouseButton(0, true);
  run(100, watch);
  app.controls.mouseButton(0, false);
  run(1000, watch);
  expect(h.host.projectiles.fired).toBe(1);
  expect(Math.abs(h.host.projectiles.lastEnd.z - (at.z + far - 0.1))).toBeLessThan(0.05);
  expect(seen).toBeGreaterThan(0);
  expect(past).toBe(0);
});

for (const how of ["lying down", "dead"] as const) {
  test(`one ${how} sees a bolt that passes over them fly on, as the server flies it`, () => {
    const FAR = 80;
    const { h, app, eve, run, at, arm } = watched(20, [0, FAR], true);
    arm("plasma", id("rifle_plasma"));
    if (how === "lying down") {
      eve.key("KeyX", true);
      eve.key("KeyX", false);
      run(1500);
      expect(eve.session.own.stance).toBe(STANCE_PRONE);
    } else {
      const rec = h.host.records.byPid.get(h.client(eve.session)!.pid)!;
      h.host.survival.add(rec, V_HEALTH, -1e6);
      run(1500);
      expect(eve.session.ownHandle).toBe(0);
    }
    // Level, at the height of a standing head: over one lying down, and over where one fell.
    app.controls.yaw = 0;
    app.controls.pitch = 0;
    app.controls.mouseButton(2, true);
    run(1000);
    let past = 0, bursts = 0;
    app.controls.mouseButton(0, true);
    run(100);
    app.controls.mouseButton(0, false);
    run(900, () => {
      for (const f of eve.shots.flying) if (f.z > at.z + FAR + 2) past++;
      bursts = Math.max(bursts, eve.shots.bursts.filter((b) => Math.abs(b.z - (at.z + FAR)) < 3).length);
    });
    expect(h.host.projectiles.fired).toBe(1);
    expect(h.host.projectiles.struck).toBe(0);
    expect(bursts).toBe(0);
    expect(past).toBeGreaterThan(0);
  });
}

/** A client's shots alone, on a harness's world, told what a session would tell them: its own body at (x, z), and `events`. */
function shotsAlone(h: Harness, x: number, z: number) {
  const shots = new Shots(h.reg, corePack());
  const events: CombatEvent[] = [];
  const own = { x, y: h.world.hf.heightAt(x, z), z, kind: id("survivor"), stance: 0, seat: 0 };
  const session = { fired: [], inventory: null, held: -1, events, own, ownHandle: 1, driving: -1 } as unknown as ClientSession;
  let tick = 100;
  /** The others it draws: none, until a test puts some in. */
  const others = new RemoteSample();
  /** Steps a quarter of a tick, and returns how far along +Z from `z` each flying round is drawn. */
  const quarter = (): number[] => {
    tick += 0.25;
    shots.absorb(session, h.world, tick * TICK_MS);
    shots.step(h.world, others, tick, tick * TICK_MS);
    const drawn: number[] = [];
    const ch = { loose: (_p: unknown, _mesh: number, _x: number, _y: number, dz: number) => (drawn.push(dz - z), true) } as unknown as Characters;
    const cam = { x: 0, y: 0, z: 0, boxVisible: () => true } as unknown as Camera;
    shots.draw(ch, {} as FramePacket, cam, tick);
    return drawn;
  };
  const shot = (more: Partial<CombatEvent>): CombatEvent => ({ kind: EVENT_SHOT, x, y: own.y + 1.6, z, zone: 0, damage: 0, kill: false, blocked: false, bearing: 0, side: false, silenced: false, name: "", item: id("plasma_cell"), far: 0, level: 0, xp: 0, flies: true, vx: 0, vy: 0, vz: 240, back: 0, rays: 1, seed: 0, id: 0, own: false, surface: 0, made: 0, ...more });
  return { shots, events, own, others, quarter, shot };
}

test("on any screen a bolt passes over another who lies down or lies dead, and ends on one who stands", () => {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  h.run(100);
  const [x, z] = [24 * CHUNK_SIZE, 24 * CHUNK_SIZE - 600];
  const reach = (stance: number, dead: boolean, far = 40): number => {
    const { events, own, others, quarter, shot } = shotsAlone(h, x, z);
    // Another survivor `far` m north. The bolt leaves 20 m north of the watcher, level, at the height of a standing head.
    const st = new AnimState();
    st.stance = stance;
    st.dead = dead;
    others.count = 1;
    others.id[0] = 7;
    others.kind[0] = id("survivor");
    [others.x[0], others.y[0], others.z[0]] = [x, own.y, z + far];
    others.anim[0] = st.pack();
    others.cue[0] = st.packCue();
    events.push(shot({ z: z + 20, mine: true }));
    let furthest = 0;
    for (let q = 0; q < 40; q++) for (const at of quarter()) furthest = Math.max(furthest, at);
    return furthest;
  };
  expect(reach(STANCE_STAND, false)).toBeLessThan(40);
  // One who stands 4 m from where it leaves is in its first piece, and is not passed through either.
  expect(reach(STANCE_STAND, false, 24)).toBeLessThan(24);
  expect(reach(STANCE_PRONE, false)).toBeGreaterThan(60);
  expect(reach(STANCE_STAND, true)).toBeGreaterThan(60);
});

test("a grazing bolt hits the nearer body from either direction", () => {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  const x = 24 * CHUNK_SIZE, z = x - 600;
  const kind = id("survivor"), radius = h.reg.bodyRadius[kind]!;
  for (const alongX of [false, true]) for (const sign of [-1, 1]) for (const gap of [0, 0.01]) {
    const { shots, events, own, others, quarter, shot } = shotsAlone(h, x, z);
    others.count = 2;
    for (let i = 0; i < others.count; i++) {
      const along = sign * (6 - 2 * i);
      others.kind[i] = kind;
      others.x[i] = x + (alongX ? along : 0);
      others.z[i] = z + (alongX ? 0 : along);
      others.y[i] = own.y;
    }
    events.push(shot({
      x: alongX ? x : x + radius + gap, z: alongX ? z + radius + gap : z, mine: true,
      vx: alongX ? sign * 240 : 0, vz: alongX ? 0 : sign * 240,
    }));
    quarter();
    if (gap === 0) {
      expect(shots.bursts).toHaveLength(1);
      const hit = shots.bursts[0]!;
      expect(alongX ? hit.x - x : hit.z - z).toBeCloseTo(sign * (4 - radius), 5);
    } else {
      expect(shots.bursts).toHaveLength(0);
      expect(shots.flying).toHaveLength(1);
    }
  }
});

test("between ticks a bolt is never drawn past its reach, nor past a wall it is about to meet", () => {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  h.run(100);
  const [x, z] = [24 * CHUNK_SIZE, 24 * CHUNK_SIZE - 600];
  // Its own, from 20 m behind the body, so that the body is not in its way.
  const open = shotsAlone(h, x, z);
  open.events.push(open.shot({ z: z + 20, mine: true }));
  let furthest = 0, frames = 0;
  for (let q = 0; q < 200; q++) for (const at of open.quarter()) [furthest, frames] = [Math.max(furthest, at), frames + 1];
  expect(frames).toBeGreaterThan(100);
  expect(furthest).toBeLessThanOrEqual(320 + 1e-6);
  expect(furthest).toBeGreaterThan(316);
  // A wall 30 m on: its near face is 0.1 m short of its middle.
  h.world.structs.add(id("wall"), x, h.world.hf.heightAt(x, z) + 1.5, z + 50, 0, 0, 10000);
  const walled = shotsAlone(h, x, z);
  walled.events.push(walled.shot({ z: z + 20, mine: true }));
  furthest = 0;
  let burst = 0;
  for (let q = 0; q < 40; q++) {
    for (const at of walled.quarter()) furthest = Math.max(furthest, at);
    burst = Math.max(burst, walled.shots.bursts.length);
  }
  expect(furthest).toBeLessThanOrEqual(49.9 + 1e-6);
  expect(furthest).toBeGreaterThan(44);
  expect(burst).toBe(1);
});

test("a throw told back to its thrower passes through their own body on their screen; another's ends on it", () => {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  h.run(100);
  const [x, z] = [24 * CHUNK_SIZE, 24 * CHUNK_SIZE - 600];
  for (const mine of [true, false]) {
    // A round from 30 m south, level, at chest height: the body stands in its way.
    const { shots, events, own, quarter, shot } = shotsAlone(h, x, z);
    events.push(shot({ z: z - 30, y: own.y + 1.0, mine }));
    let furthest = -Infinity, burst = 0;
    for (let q = 0; q < 40; q++) {
      for (const at of quarter()) furthest = Math.max(furthest, at);
      burst = Math.max(burst, shots.bursts.length);
    }
    // Another's is never drawn past the near side of the body, not for a frame.
    if (mine) expect(furthest).toBeGreaterThan(20);
    else expect(furthest).toBeLessThan(-0.2);
    expect(burst).toBe(mine ? 0 : 1);
  }
});

test("a thrown bola is told to its thrower as its own, and to another as not", () => {
  const { h, app, eve, run, arm } = watched(20, [3, 0]);
  arm("bola", id("bola"));
  app.controls.yaw = 0;
  app.controls.pitch = 0.6;
  run(300);
  // Each client's copy of it, as it flies: whose it takes it for.
  const own: boolean[][] = [[], []];
  // A bola is held two seconds to its full throw, and leaves the hand when let go.
  app.controls.mouseButton(0, true);
  run(2000);
  app.controls.mouseButton(0, false);
  run(1500, () => [app, eve].forEach((a, k) => a.shots.flying.forEach((f) => own[k]!.push(f.own))));
  expect(h.host.projectiles.fired).toBe(1);
  expect(own[0]!.length).toBeGreaterThan(0);
  expect(own[1]!.length).toBeGreaterThan(0);
  expect([own[0]!.every((o) => o), own[1]!.some((o) => o)]).toEqual([true, false]);
});

test("an arrow a crossbow sends into the water is drawn by another's client slowed as the server slows it", () => {
  const { h, app, eve, run, arm } = watched(110, [3, 0]);
  const w = h.world;
  // A spot on the shore with the sea a few metres off toward `yaw`, as tests/combat/shooting.test.ts finds it.
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
  app.session.text(`tp ${shore!.x} ${shore!.z}`);
  eve.session.text(`tp ${shore!.x + 2} ${shore!.z + 2}`);
  run(500);
  arm("crossbow", id("crossbow"));
  app.controls.yaw = shore!.yaw;
  // At the surface ten metres out: a shallow way in, so the arrow is long under water before it finds the bottom.
  app.controls.pitch = Math.atan2(w.hf.seaLevel - (w.hf.heightAt(shore!.x, shore!.z) + 1.62), 10);
  run(500);
  const shots = h.host.projectiles;
  let compared = 0;
  app.controls.mouseButton(0, true);
  run(100);
  app.controls.mouseButton(0, false);
  run(1500, () => {
    if (eve.shots.flying.length === 0 || shots.flyingCount === 0) return;
    const mine = eve.shots.flying[0]!;
    const real = shots.flyingAt(0);
    // Once both are under water: the copy goes as slowly as the server's, and is near it.
    if (real.y > w.hf.seaLevel - 0.3 || mine.y > w.hf.seaLevel - 0.3) return;
    compared++;
    expect(Math.hypot(mine.vx, mine.vy, mine.vz)).toBeLessThan(35);
    expect(Math.hypot(real.x - mine.x, real.y - mine.y, real.z - mine.z)).toBeLessThan(8);
  });
  expect(shots.fired).toBe(1);
  expect(compared).toBeGreaterThan(0);
});
