// What the review of 2026-11-14 found: ways through a wall, into a box or onto a mount, each of which was once possible, and what a dead tame leaves.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { FLOOR_THICK, FOUNDATION_THICK, WALL_THICK } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_STRUCT, RESULT_DENIED, RESULT_FAR, RESULT_LOCKED, RESULT_OK, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { BTN_USE, STANCE_CROUCH, stanceEye, stanceHeight } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import { frameAxes, poseAt, type Pose } from "../../shared/world/snap.ts";
import { NO_PIN, STRUCT_LOCK, STRUCT_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;

/** Survivors with cheats on level ground, two metres apart. */
function arena(names: string[], wide = 40, deep = 24) {
  const h = new Harness({}, 1, 60, { dev: true });
  const sessions = names.map((n) => h.join(n));
  h.run(500);
  const g = flatGround(h, wide, deep);
  const at = { x: g.x + wide / 2, y: g.y, z: g.z + deep / 2 };
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + i * 2).toFixed(3)} ${(at.z - 8).toFixed(3)}`);
  });
  const recs = sessions.map((s) => h.host.records.byPid.get(h.client(s)!.pid)!);
  return { h, sessions, recs, at };
}

function press(h: Harness, s: ClientSession, buttons: number): void {
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  pilot.buttons = buttons;
  h.run(100);
  pilot.buttons = 0;
  h.run(150);
}

test("a wall built at a turn that leaves its pieces a hair apart is still a wall: the use key and a named use do not reach the box behind where two of its pieces join", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [, bob] = sessions as [ClientSession, ClientSession];
  const structs = h.world.structs;
  const ents = h.world.ents;
  const team = recs[0]!.team;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const join = (target: number, piece: string, k: number): number => {
    expect(poseAt(structs, reg, target, id(piece), k, 0, pose)).toBe(true);
    return structs.add(id(piece), pose.x / U, pose.y / U, pose.z / U, pose.yaw, team, 10000);
  };
  const place = (ref: number): [number, number, number] => {
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    return [t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]!];
  };
  // Of all turns, this one has the longest whole-number frame: joined pieces stood 2.7 mm apart as rays measured them.
  const yaw = 8048;
  const axes = new Int32Array(4);
  frameAxes(yaw, axes);
  const length = Math.hypot(axes[0]!, axes[1]!);
  expect(length).toBeGreaterThan(768.69);
  const [ax, az, nx, nz] = [axes[0]! / length, axes[1]! / length, axes[2]! / length, axes[3]! / length];
  // Ada's two foundations side by side, with a wall along the same edge of each.
  const f1 = structs.add(id("foundation_stone"), at.x, at.y + FOUNDATION_THICK / 2, at.z, yaw, team, 15000);
  const f2 = join(f1, "foundation_stone", 1);
  const walls = [join(f1, "wall_stone", 0), join(f2, "wall_stone", 0)];
  const [x1, , z1] = place(walls[0]!);
  const [x2, , z2] = place(walls[1]!);
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;

  // Bob stands outside, a metre and a half from the wall, straight out from where its two pieces join.
  h.say(bob, `tp ${(mx + nx * 1.5).toFixed(5)} ${(mz + nz * 1.5).toFixed(5)}`, 200);
  const me = h.ent(bob);
  const eye = ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, 0);
  // Ada's box stands on the foundation behind the wall, on the line from Bob through the join. It has no lock.
  const back = 1.2 / Math.hypot(mx - ents.x[me]!, mz - ents.z[me]!);
  const top = place(f1)[1] + FOUNDATION_THICK / 2;
  const box = structs.add(id("storage_box"), mx + (mx - ents.x[me]!) * back, top + reg.halfY[id("storage_box")]!, mz + (mz - ents.z[me]!) * back, yaw, team, 500);
  const state = h.host.fixtures.ensure(box);
  expect(h.host.items.mint(state, id("ingot"), 150)).toBe(150);
  expect(h.host.fixtures.locked(box)).toBe(false);
  const [bx, by, bz] = place(box);

  // He looks at the box. His look, as the server will cast it, meets the wall within a third of a millimetre of the join.
  const pilot = h.pilots[1]!;
  pilot.yaw = Math.atan2(bx - ents.x[me]!, bz - ents.z[me]!);
  pilot.pitch = Math.atan2(by - eye, Math.hypot(bx - ents.x[me]!, bz - ents.z[me]!));
  h.run(200);
  const c = h.client(bob)!;
  const d = [0, 0, 0];
  lookDirection(c.heldYaw, c.heldPitch, d);
  expect(castWorld(h.world, ents.x[me]!, eye, ents.z[me]!, d[0]!, d[1]!, d[2]!, 3.5)).toBe(HIT_STRUCTURE);
  expect(walls).toContain(rayHit.ref);
  const hx = ents.x[me]! + d[0]! * rayHit.t - mx;
  const hz = ents.z[me]! + d[2]! * rayHit.t - mz;
  expect(Math.abs(hx * ax + hz * az)).toBeLessThan(0.0003);

  press(h, bob, BTN_USE);
  expect(bob.open).toBeNull();
  let code = -1;
  bob.onResult = (seq, result) => void (seq !== 0 && (code = result));
  bob.command(CMD_STRUCT, (w: BitWriter) => (w.u32(box), w.u8(STRUCT_USE), w.u16(NO_PIN)));
  h.run(200);
  expect([code, bob.open]).toEqual([RESULT_FAR, null]);
  expect(h.host.items.inv(state).total(id("ingot"))).toBe(150);
});

/** Sends a CMD_STRUCT for `ref` and returns its result code. */
function act(h: Harness, s: ClientSession, ref: number, action: number, code = -1): number {
  let got = -1;
  s.onResult = (seq, result) => void (seq !== 0 && (got = result));
  s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), code >= 0 ? w.u16(code) : 0));
  h.run(150);
  return got;
}

/** Asks to take the first stack of the open container into the survivor's first slot. */
function grab(s: ClientSession, item: number): void {
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(0), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(item)));
}

test("a lock or a new PIN shuts a box for a stranger who has it open, at once: not one more thing leaves it", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const ingot = id("ingot");
  // Ada's box stands in front of the two of them. It has no lock, so Bob, who is not of her tribe, may open it.
  const box = h.world.structs.add(id("storage_box"), at.x + 1, at.y + reg.halfY[id("storage_box")]!, at.z - 6, 0, recs[0]!.team, 500);
  const state = h.host.fixtures.ensure(box);
  expect(h.host.items.mint(state, ingot, 100)).toBe(100);
  const left = (): number => h.host.items.inv(state).total(ingot);
  expect([act(h, bob, box, STRUCT_USE, NO_PIN), bob.open?.name]).toEqual([RESULT_OK, "storage box"]);

  // She locks it, and in the same moment he asks for what is in it.
  ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(box), w.u8(STRUCT_LOCK)));
  grab(bob, ingot);
  h.run(200);
  expect([h.host.fixtures.locked(box), left(), bob.open?.name]).toEqual([true, 100, undefined]);
  expect(act(h, bob, box, STRUCT_USE, NO_PIN)).toBe(RESULT_LOCKED);

  // She sets a PIN and he opens it with that. She sets another: it is shut for him again, until he has the new one.
  expect(act(h, ada, box, STRUCT_PIN, 1234)).toBe(RESULT_OK);
  expect([act(h, bob, box, STRUCT_USE, 1234), bob.open?.name]).toEqual([RESULT_OK, "storage box"]);
  ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(box), w.u8(STRUCT_PIN), w.u16(4321)));
  grab(bob, ingot);
  h.run(200);
  expect([left(), bob.open?.name]).toEqual([100, undefined]);
  expect([act(h, bob, box, STRUCT_USE, 4321), bob.open?.name]).toEqual([RESULT_OK, "storage box"]);
  // With the PIN he has it as before: it stays open, and what he takes is his.
  h.run(300);
  grab(bob, ingot);
  h.run(200);
  expect([left(), bob.open?.name, bob.inventory!.total(ingot)]).toEqual([0, "storage box", 100]);
});

test("a member put out of a tribe can no longer empty its vault or ride its mount", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const ingot = id("ingot");
  const enlist = (): void => {
    h.say(ada, "tribe invite bob");
    h.say(bob, "tribe accept");
    expect(recs[1]!.team).toBe(recs[0]!.team);
  };
  h.say(ada, "tribe create Wolves");
  enlist();
  // The tribe's vault, locked, with a member's hands in it.
  const vault = h.world.structs.add(id("vault"), at.x + 1, at.y + reg.halfY[id("vault")]!, at.z - 6, 0, recs[0]!.team, 50000);
  const state = h.host.fixtures.ensure(vault);
  state.lock = 1;
  expect(h.host.items.mint(state, ingot, 100)).toBe(100);
  expect([act(h, bob, vault, STRUCT_USE, NO_PIN), bob.open?.name]).toEqual([RESULT_OK, "vault"]);

  // He is put out, and in the same moment asks for what is in it.
  ada.text("tribe kick bob");
  grab(bob, ingot);
  h.run(300);
  expect(recs[1]!.team).not.toBe(recs[0]!.team);
  expect([h.host.items.inv(state).total(ingot), bob.open?.name]).toEqual([100, undefined]);
  expect(act(h, bob, vault, STRUCT_USE, NO_PIN)).toBe(RESULT_LOCKED);

  // Back in the tribe, he gets on its saddled mount. Put out again, he is put off it.
  enlist();
  const e = h.host.spawnCreature("core:parasaur", at.x + 5, at.z - 8, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const mount = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  mount.team = recs[0]!.team;
  mount.saddle = id("saddle_parasaur");
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.host.creatures.claimed(e);
  const c = h.client(bob)!;
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  h.run(200);
  expect(c.drive).toBe(e);
  h.say(ada, "tribe kick bob");
  expect([c.drive, h.world.ents.seat[c.ent]]).toEqual([-1, 0]);
});

test("a rider with no room to get off beside her mount is set down where it stood, not left at the seat with her head through the ceiling", () => {
  const { h, sessions, recs, at } = arena(["ada"]);
  const ada = sessions[0]!;
  const world = h.world;
  const ents = world.ents;
  const p = reg.move[id("survivor")]!;
  // Her raptor, saddled, with her on it. A raptor is lower than a survivor stands.
  const e = h.host.spawnCreature("core:raptor", at.x, at.z, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const mount = h.host.records.byPid.get(ents.pid[e]!)!;
  mount.team = recs[0]!.team;
  mount.saddle = id("saddle_raptor");
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.host.creatures.claimed(e);
  h.say(ada, `tp ${(at.x - 2).toFixed(3)} ${at.z.toFixed(3)}`);
  const c = h.client(ada)!;
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  h.run(200);
  const body = c.ent;
  // A stall around the raptor: a wall a metre off on every side, and a floor above that it fits under and she does not.
  const [mx, my, mz] = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  const under = my + 1.6;
  for (const [dx, dz, yaw] of [[1, 0, 16384], [-1, 0, 16384], [0, 1, 0], [0, -1, 0]] as const) expect(world.structs.add(id("wall_stone"), mx + dx, my + 1.5, mz + dz, yaw, 99, 10000)).toBeGreaterThanOrEqual(0);
  expect(world.structs.add(id("ceiling_stone"), mx, under + FLOOR_THICK / 2, mz, 0, 99, 10000)).toBeGreaterThanOrEqual(0);
  h.run(200);
  expect(c.drive).toBe(e);
  // Seated, her head is above that floor.
  expect(ents.y[body]! + p.crouchHeight).toBeGreaterThan(under);
  /** Whether her body is in space a body may be in, and under the floor. */
  const legal = (): boolean[] => {
    const tall = stanceHeight(p, ents.stance[body]!);
    return [capsuleFree(world, ents.x[body]!, ents.y[body]!, ents.z[body]!, p.radius, tall), ents.y[body]! + tall < under];
  };

  // She gets off. There is no room on either side or behind, so she is down in the stall with the raptor, crouched.
  press(h, ada, BTN_USE);
  expect([c.drive, ents.seat[body], ents.stance[body], legal()]).toEqual([-1, 0, STANCE_CROUCH, [true, true]]);

  // She gets on again, and the raptor is killed under her: the same.
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  h.run(200);
  expect(ents.y[body]! + p.crouchHeight).toBeGreaterThan(under);
  h.host.survival.add(mount, V_HEALTH, -1e9);
  h.run(300);
  expect([c.drive, ents.seat[body], legal()]).toEqual([-1, 0, [true, true]]);
});

test("a vault that comes down whole does not come down on whoever stands under it: they are moved aside, on their own side of any wall", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const world = h.world;
  const structs = world.structs;
  const ents = world.ents;
  const team = recs[0]!.team;
  const p = reg.move[id("survivor")]!;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const join = (target: number, piece: string, k: number): number => {
    expect(poseAt(structs, reg, target, id(piece), k, 0, pose)).toBe(true);
    return structs.add(id(piece), pose.x / U, pose.y / U, pose.z / U, pose.yaw, team, 10000);
  };
  const row = (ref: number) => {
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    return { kind: t.kind[ref & 0xffff]!, x: t.x[ref & 0xffff]!, y: t.y[ref & 0xffff]!, z: t.z[ref & 0xffff]! };
  };
  // Two foundations side by side. On the far one a wall, and from its top a floor back over the near one, three metres up.
  const near = structs.add(id("foundation_stone"), at.x, at.y + FOUNDATION_THICK / 2, at.z, 0, team, 15000);
  const far = join(near, "foundation_stone", 0);
  const wall = join(far, "wall_stone", 2);
  const floor = join(wall, "ceiling_stone", 0);
  expect([row(floor).x, row(floor).z]).toEqual([row(near).x, row(near).z]);
  // The house next door stands a hand's breadth off, and has a wall on the edge that faces this one.
  const next = structs.add(id("foundation_stone"), at.x + 3.2, at.y + FOUNDATION_THICK / 2, at.z, 0, team, 15000);
  const screen = join(next, "wall_stone", 3);
  // The vault stands on the upper floor with its side a hand from over that wall. It holds something.
  const half = reg.halfY[id("vault")]!;
  const vault = structs.add(id("vault"), row(near).x + 0.8, row(floor).y + FLOOR_THICK / 2 + half, at.z, 0, team, 50000);
  const vx = row(vault).x;
  const state = h.host.fixtures.ensure(vault);
  expect(h.host.items.mint(state, id("ingot"), 100)).toBe(100);
  expect(h.host.build.support.standsRef(vault)).toBe(true);
  // Ada stands on the lower floor right under it, and Bob under its corner, by the wall.
  const top = row(near).y + FOUNDATION_THICK / 2;
  h.say(ada, `tp ${vx.toFixed(3)} ${top.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${(vx + 0.35).toFixed(3)} ${top.toFixed(3)} ${(at.z + 0.6).toFixed(3)}`);
  const bodies = [h.ent(ada), h.ent(bob)];
  const was = bodies.map((e) => [ents.x[e]!, ents.z[e]!] as const);
  for (const e of bodies) expect(capsuleFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)).toBe(true);

  // The wall that holds the floor goes. The floor falls, and the vault comes down onto the foundation.
  structs.damage(wall, 1e9, world.tick);
  h.run(600);
  expect([row(floor).kind, h.host.build.landed, state.at >= 0]).toEqual([0, 1, true]);
  const landed = row(state.at);
  expect([landed.kind, landed.x, landed.z, landed.y, row(screen).kind]).toEqual([id("vault"), vx, row(near).z, top + half, id("wall_stone")]);
  expect(h.host.items.inv(state).total(id("ingot"))).toBe(100);
  // Neither is inside it. Each stands within two metres of where it stood, and still on the vault's side of the wall.
  bodies.forEach((e, i) => {
    expect(capsuleFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)).toBe(true);
    expect(Math.hypot(ents.x[e]! - was[i]![0], ents.z[e]! - was[i]![1])).toBeLessThan(2);
    expect(ents.x[e]!).toBeLessThan(row(screen).x - WALL_THICK / 2);
  });
});

test("wrong PINs are counted against the survivor who gives them, and each one past the third makes the next wait twice as long", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob", "cy"]);
  const [, bob, cy] = sessions as [ClientSession, ClientSession, ClientSession];
  // Ada's box, locked with a PIN. Bob and Cy are not of her tribe.
  const box = h.world.structs.add(id("storage_box"), at.x + 1, at.y + reg.halfY[id("storage_box")]!, at.z - 6, 0, recs[0]!.team, 500);
  const state = h.host.fixtures.ensure(box);
  state.lock = 1;
  state.pin = 4071;
  const guess = (s: ClientSession, pin: number): number => h.host.build.use(h.client(s)!, box, pin);
  // From here the clock is moved on by hand, and nothing else in the world runs.
  const pass = (seconds: number): void => void (h.world.tick += seconds * TICK_RATE);

  // Three wrong, and then even the right one must wait half a minute.
  expect([1, 2, 3].map((pin) => guess(bob, pin))).toEqual([RESULT_DENIED, RESULT_DENIED, RESULT_DENIED]);
  expect(guess(bob, 4071)).toBe(RESULT_WAIT);
  // After it, one more wrong one is judged and the wait is a whole minute: half of it gone, he still waits.
  pass(30);
  expect([guess(bob, 4), guess(bob, 5)]).toEqual([RESULT_DENIED, RESULT_WAIT]);
  pass(30);
  expect(guess(bob, 5)).toBe(RESULT_WAIT);
  pass(30);
  expect(guess(bob, 5)).toBe(RESULT_DENIED);
  // He goes on for an hour, trying every ten seconds. Three every half minute used to be judged: 360 in the hour.
  let judged = 0;
  for (let t = 0; t < 3600; t += 10) {
    pass(10);
    if (guess(bob, 6) === RESULT_DENIED) judged++;
  }
  expect(judged).toBeLessThanOrEqual(5);
  // His guessing keeps nobody else waiting, and the right PIN ends a survivor's own count.
  expect([guess(cy, 7), guess(cy, 8), guess(cy, 4071)]).toEqual([RESULT_DENIED, RESULT_DENIED, RESULT_OK]);
  expect(h.client(cy)!.open).toBe(state.pid);
  expect(guess(cy, 4071)).toBe(RESULT_OK);
  expect([1, 2].map((pin) => guess(cy, pin))).toEqual([RESULT_DENIED, RESULT_DENIED]);
});

artTest("a tame that dies leaves what it carried and its saddle in its body where it fell, for anyone to take, as in the reference", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const bob = sessions[1]!;
  const { records, items } = h.host;
  const ents = h.world.ents;
  const [ingot, meat, saddle] = [id("ingot"), id("meat"), id("saddle_parasaur")];
  // Ada's parasaur, saddled and named, carrying metal and meat.
  const e = h.host.spawnCreature("core:parasaur", at.x + 6, at.z - 8, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const tame = records.byPid.get(ents.pid[e]!)!;
  tame.team = recs[0]!.team;
  tame.name = "Dolly";
  tame.saddle = saddle;
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.host.creatures.claimed(e);
  expect([items.mint(tame, ingot, 30), items.mint(tame, meat, 5)]).toEqual([30, 5]);
  h.run(100);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  // Meat keeps four times as long inside a creature.
  const fresh = h.reg.spoilTicks[meat]!;
  const carried = items.inv(tame);
  expect(carried.spoilAt[carried.item.indexOf(meat)]! - h.world.tick).toBeGreaterThan(fresh * 3.9);

  h.host.survival.add(tame, V_HEALTH, -1e9);
  h.run(200);
  expect(records.byPid.has(tame.pid)).toBe(false);
  // Its body lies where it fell, with everything in it (server/corpses.ts). Out of the creature, the meat has a quarter of
  // the time it had left.
  const left = [...h.host.corpses.bodies.values()];
  expect(left.map((b) => b.rec.name)).toEqual(["Dolly"]);
  const cache = left[0]!.rec;
  const inv = items.inv(cache);
  expect([inv.total(ingot), inv.total(meat), inv.total(saddle)]).toEqual([30, 5, 1]);
  expect(Math.hypot(cache.x - x, cache.z - z)).toBeLessThan(0.5);
  const keeps = inv.spoilAt[inv.item.indexOf(meat)]! - h.world.tick;
  expect([keeps > fresh * 0.9, keeps <= fresh]).toEqual([true, true]);
  // It lies as long as what a dead survivor leaves.
  const lies = cache.expiresAt - h.world.tick;
  expect([lies > h.host.death.lifetime(id("cache")) - 10, lies <= h.host.death.lifetime(id("cache"))]).toEqual([true, true]);
  expect(items.audit()).toEqual([]);

  // Bob, who is not of her tribe, walks up once it has come to rest, opens it and takes the saddle.
  h.run(3000);
  expect(left[0]!.fall!.still).toBe(true);
  const mid = h.host.corpses.middle(left[0]!);
  h.say(bob, `tp ${(mid.x - 1.5).toFixed(3)} ${mid.z.toFixed(3)}`);
  const pilot = h.pilots[1]!;
  pilot.yaw = Math.PI / 2;
  pilot.pitch = Math.atan2(mid.y - (ents.y[h.ent(bob)]! + 1.62), 1.5);
  h.run(200);
  press(h, bob, BTN_USE);
  expect(bob.open?.name).toBe("Dolly");
  const from = bob.open!.inventory.item.indexOf(saddle);
  bob.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(saddle)));
  h.run(200);
  expect([bob.inventory!.total(saddle), items.inv(cache).total(saddle)]).toEqual([1, 0]);
});
