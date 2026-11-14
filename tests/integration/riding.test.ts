import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { EntityRecord } from "../../server/records.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_FEED, CMD_MOVE, CMD_OPEN, CMD_ORDER, ORDER_UNSADDLE, RESULT_BUSY, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_USE, STANCE_CROUCH, STANCE_STAND, stanceEye } from "../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

function stable(species: string, host: { dbPath?: string } = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  const g = flatGround(h, 120, 24);
  const at = { x: g.x + 10, z: g.z + 12, y: g.y };
  for (const [s, dx] of [[ada, 0], [bob, -4]] as const) {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + dx).toFixed(3)} ${at.z.toFixed(3)}`);
  }
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.say(ada, "setting TamingSpeedMultiplier 60");
  const e = h.host.spawnCreature(`core:${species}`, at.x, at.z + 3.2, 1);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, 0);
  // Knocked out and hungry with its food in it, the creature tames at once.
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  h.host.survival.add(rec, V_FOOD, -80);
  h.host.items.mint(rec, id(species === "parasaur" ? "berry" : "meat"), 1);
  rec.tame!.by = me.pid;
  h.run(500);
  expect([rec.team, rec.out]).toEqual([me.team, false]);
  return { h, ada, bob, at, me, e, rec };
}

/** Returns the result the server sent with no sequence number, or -1. */
function press(h: Harness, s: ClientSession, e: number): number {
  const ents = h.world.ents;
  const me = h.ent(s);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
  h.run(150);
  let told = -1;
  s.onResult = (seq, c) => void (seq === 0 && (told = c));
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  return told;
}

function saddle(h: Harness, s: ClientSession, e: number, item: string): number {
  h.say(s, `give ${item} 1`);
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  if (!s.open) s.command(CMD_OPEN, (w: BitWriter) => w.u32(e));
  h.run(200);
  const inv = s.inventory!;
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_OPEN, 1), w.varint(0), w.u16(0), w.u16(id(item))));
  h.run(150);
  s.command(CMD_FEED, (w: BitWriter) => (w.varint(0), w.u16(id(item))));
  h.run(150);
  return code;
}

test("a saddle is put on a creature of one's tribe that it fits; saddled, the use button gets on it and off it; nobody else's to ride, and not without one", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-ride-"));
  const dbPath = join(dir, "world.db");
  let { h, ada, bob, at, me, e, rec } = stable("raptor", { dbPath });
  const ents = h.world.ents;
  const riding = h.host.riding;
  expect(press(h, ada, e)).toBe(-1);
  expect([ada.open !== null, ada.subject?.saddled, h.client(ada)!.drive]).toEqual([true, false, -1]);
  expect(riding.mount(h.client(ada)!, e)).toBe(RESULT_SHORT);
  expect(saddle(h, ada, e, "saddle_parasaur")).toBe(RESULT_INVALID);
  expect(h.host.items.inv(rec).total(id("saddle_parasaur"))).toBe(1);
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(0), w.bits(BOX_SELF, 1), w.varint(ada.inventory!.free()), w.u16(0), w.u16(id("saddle_parasaur"))));
  h.run(150);
  expect(saddle(h, ada, e, "saddle_raptor")).toBe(RESULT_OK);
  h.run(400);
  expect([rec.saddle, h.host.items.inv(rec).total(id("saddle_raptor")), ada.subject?.saddled]).toEqual([id("saddle_raptor"), 0, true]);
  ada.command(4);
  h.run(200);
  expect([riding.mount(h.client(bob)!, e), press(h, bob, e), h.client(bob)!.drive]).toEqual([RESULT_NOT_YOURS, -1, -1]);
  // seat is the mount's entity index plus one, and 0 off a mount.
  expect(press(h, ada, e)).toBe(-1);
  expect([h.client(ada)!.drive, ada.driving, riding.mounted, ents.driven[e], ents.seat[h.ent(ada)]]).toEqual([e, e, 1, 1, e + 1]);
  expect(ents.stance[h.ent(ada)]).toBe(STANCE_CROUCH);
  expect(Math.hypot(ents.x[h.ent(ada)]! - ents.x[e]!, ents.z[h.ent(ada)]! - ents.z[e]!)).toBeLessThan(1);
  expect(ents.y[h.ent(ada)]! - ents.y[e]!).toBeGreaterThan(0.3);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_ORDER, (w: BitWriter) => (w.u32(e), w.u8(ORDER_UNSADDLE)));
  h.run(150);
  expect([code, riding.mount(h.client(bob)!, e)]).toEqual([RESULT_BUSY, RESULT_NOT_YOURS]);
  const remote = new RemoteSample();
  bob.sampleRemote(remote);
  const seen = Array.from(remote.id.subarray(0, remote.count)).indexOf(h.ent(ada));
  expect(remote.seat[seen]).toBe(e + 1);

  h.pilots[0]!.buttons = BTN_USE;
  h.run(100);
  h.pilots[0]!.buttons = 0;
  h.run(300);
  expect([h.client(ada)!.drive, ada.driving, riding.dismounted, ents.driven[e], ents.seat[h.ent(ada)], ents.stance[h.ent(ada)]]).toEqual([-1, -1, 1, 0, 0, STANCE_STAND]);
  const beside = Math.hypot(ents.x[h.ent(ada)]! - ents.x[e]!, ents.z[h.ent(ada)]! - ents.z[e]!);
  expect(beside).toBeGreaterThan(0.8);
  expect(beside).toBeLessThan(2.2);
  expect(Math.abs(ents.y[h.ent(ada)]! - at.y)).toBeLessThan(0.1);

  // The saddle survives a restart. Unsaddling needs a free slot on the creature.
  const pid = rec.pid;
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  rec = h.host.records.byPid.get(pid)!;
  e = h.host.records.entOf.get(pid)!;
  expect(rec.saddle).toBe(id("saddle_raptor"));
  ada = h.join("ada");
  h.run(600);
  h.say(ada, "enablecheats");
  const order = (what: number): number => {
    let got = -1;
    ada.onResult = (seq, c) => void (seq !== 0 && (got = c));
    ada.command(CMD_ORDER, (w: BitWriter) => (w.u32(e), w.u8(what)));
    h.run(150);
    return got;
  };
  while (h.host.items.mint(rec, id("hatchet"), 1) === 1);
  expect(order(ORDER_UNSADDLE)).toBe(RESULT_FULL);
  h.host.items.burn(rec, 0, 1);
  expect([order(ORDER_UNSADDLE), rec.saddle, h.host.items.inv(rec).total(id("saddle_raptor")), order(ORDER_UNSADDLE)]).toEqual([RESULT_OK, 0, 1, RESULT_INVALID]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
  void me;
});

test("ridden, a mount goes where its rider's inputs send it with nothing corrected; her look turns it at its own rate; its bite is hers to give, and half of what it earns is hers", () => {
  const { h, ada, at, me, e, rec } = stable("raptor");
  const ents = h.world.ents;
  rec.saddle = id("saddle_raptor");
  expect(press(h, ada, e)).toBe(-1);
  expect(ada.driving).toBe(e);
  const pilot = h.pilots[0]!;
  pilot.yaw = Math.PI / 2;
  pilot.pitch = 0;
  h.run(1500);
  const corrections = ada.stats.corrections;
  const x0 = ents.x[e]!;
  pilot.moveZ = 127;
  h.run(4000);
  const went = ents.x[e]! - x0;
  expect(went).toBeGreaterThan(reg.move[id("raptor")]!.walkSpeed * 4 * 0.8);
  expect(ada.stats.corrections - corrections).toBe(0);
  expect(Math.hypot(ada.own.x - ents.x[e]!, ada.own.z - ents.z[e]!)).toBeLessThan(1.5);
  expect(Math.hypot(ents.x[h.ent(ada)]! - ents.x[e]!, ents.z[h.ent(ada)]! - ents.z[e]!)).toBeLessThan(1);
  // A raptor turns 240 degrees a second, so 200 ms brings it round about 48 degrees.
  pilot.moveZ = 0;
  h.run(500);
  const facing = ents.yaw[e]!;
  pilot.yaw = -Math.PI / 2;
  h.run(200);
  const turned = Math.abs(((ents.yaw[e]! - facing + 32768) & 0xffff) - 32768) / 65536 * 360;
  expect(turned).toBeGreaterThan(20);
  expect(turned).toBeLessThan(80);
  h.run(800);
  expect(Math.abs((((ents.yaw[e]! - 49152 + 32768) & 0xffff) - 32768))).toBeLessThan(400);
  expect(ada.stats.corrections - corrections).toBe(0);

  const prey = h.host.spawnCreature("core:parasaur", ents.x[e]! - 2.5, ents.z[e]!, 1);
  const wild = h.host.records.byPid.get(ents.pid[prey]!)!;
  h.host.creatures.mind.stay(prey, h.world.tick + 3000);
  h.host.survival.add(wild, V_HEALTH, -(h.host.survival.value(wild, V_HEALTH) - 10));
  const xp = [rec.xp, me.xp];
  pilot.pitch = 0.1;
  pilot.buttons = BTN_PRIMARY;
  h.run(700);
  pilot.buttons = 0;
  h.run(500);
  expect([h.host.combat.last.by, h.host.combat.last.victim, h.host.combat.last.killed]).toEqual([rec.pid, wild.pid, true]);
  expect(rec.xp - xp[0]!).toBeGreaterThan(0);
  expect(me.xp - xp[1]!).toBeCloseTo((rec.xp - xp[0]!) / 2, 5);
  expect(ada.stats.corrections - corrections).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
  void at;
});

test("a rider is shot where she sits; a saddle is her mount's armor; a mount that goes under puts her off", () => {
  const { h, ada, bob, at, e, rec } = stable("parasaur");
  const ents = h.world.ents;
  const combat = h.host.combat;
  rec.saddle = id("saddle_parasaur");
  press(h, ada, e);
  expect(ada.driving).toBe(e);
  h.run(500);
  const rider = h.ent(ada);
  expect(ents.y[rider]! - at.y).toBeGreaterThan(1.2);
  // Rays from her side at rising heights find her in some zone. The highest passes over her head.
  const rays = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.3].map((up) => [combat.castBodies(h.ent(bob), ents.x[rider]! - 12, ents.y[rider]! + up, ents.z[rider]!, 1, 0, 0, 40), combat.zone]);
  const found = rays.filter((r) => r[0] === rider);
  expect(found.length).toBeGreaterThan(2);
  expect(found.every((r) => r[1] !== ZONE_NONE)).toBe(true);
  expect(rays[rays.length - 1]![0]).toBe(-1);
  // A ray under her finds the mount. One at the spot she stood on before mounting finds nothing.
  expect(combat.castBodies(h.ent(bob), ents.x[rider]! - 12, at.y + 1.0, ents.z[rider]!, 1, 0, 0, 40)).toBe(e);
  expect(combat.castBodies(h.ent(bob), at.x - 12, at.y + 1.5, at.z, 1, 0, 0, 11.5)).toBe(-1);
  expect(ZONE_NONE).toBe(0);

  // A saddle of 25 halves a 60 point blow.
  const blow = (): number => {
    const before = h.host.survival.value(rec, V_HEALTH);
    combat.land({ by: null, x: at.x, z: at.z, item: 0, base: 60, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 }, e, 2, ents.x[e]!, ents.y[e]! + 1, ents.z[e]!, 3);
    return before - h.host.survival.value(rec, V_HEALTH);
  };
  const saddled = blow();
  expect(saddled).toBeCloseTo(30, 1);
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(300);
  expect([rec.out, ada.driving, h.client(ada)!.drive, ents.seat[rider], h.host.riding.dismounted]).toEqual([true, -1, -1, 0, 1]);
  expect(Math.abs(ents.y[rider]! - at.y)).toBeLessThan(0.1);
  rec.saddle = 0;
  expect(blow()).toBeCloseTo(60, 1);
});

test("in the whole client: riding, the mount is drawn where the rider predicts it, with the rider on its seat, seen from behind", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const run = (ms: number) => {
    let packet = null as ReturnType<App["frame"]>;
    h.run(ms, (now) => (packet = app.frame(now, 1280, 720)));
    return packet!;
  };
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 60, 20);
  s.text(`tp ${(g.x + 8).toFixed(3)} ${(g.z + 10).toFixed(3)}`);
  run(300);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const e = h.host.spawnCreature("core:raptor", g.x + 8, g.z + 13, 1);
  const rec: EntityRecord = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.team = me.team;
  rec.saddle = id("saddle_raptor");
  h.host.refreshBody(rec);
  h.host.creatures.claimed(e);
  h.host.creatures.mind.stay(e, 0xffffffff);
  app.controls.yaw = 0;
  app.controls.pitch = -0.2;
  run(400);
  app.key("KeyE", true);
  run(80);
  app.key("KeyE", false);
  run(500);
  expect([s.driving, h.client(s)!.drive]).toEqual([e, e]);
  // The mount is drawn as her own body. scene.skip keeps the server's copy from being drawn too.
  app.controls.key("KeyW", true);
  const packet = run(1500);
  const scene = app.scene!;
  expect([scene.own?.kind, scene.own?.id, scene.skip, scene.own?.firstPerson]).toEqual([id("raptor"), e, e, false]);
  expect(Math.hypot(scene.own!.x - s.own.x, scene.own!.z - s.own.z)).toBeLessThan(0.6);
  const mesh = pack.meshIndex.get("core:raptor")!;
  let mounts = 0;
  for (let d = 0; d < packet.drawCount; d++) if (packet.drawMesh[d] === mesh && (packet.drawFlags[d]! & DRAW_SKINNED) !== 0) mounts += packet.drawInstances[d]!;
  expect(mounts).toBe(1);
  expect(Math.hypot(app.cam.x - s.own.x, app.cam.y - s.own.y, app.cam.z - s.own.z)).toBeGreaterThan(2);
  // F opens the mount's inventory without dismounting.
  app.controls.key("KeyW", false);
  app.key("KeyF", true);
  run(300);
  expect([s.open !== null, s.subject?.saddled, s.driving]).toEqual([true, true, e]);
});
