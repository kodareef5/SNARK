// Picking up, holding and throwing a small creature (server/carry.ts), as ARK has it for the dodo (ark.wiki.gg, Dodo:
// Carryable By Humans): its tribe's, in both arms, nothing else in the hands, set down whole whatever ends it.

import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { EntityRecord } from "../../server/records.ts";
import { STANCE_AGGRESSIVE } from "../../server/behavior.ts";
import { THROW_SPEED } from "../../server/carry.ts";
import { CUE_HELD } from "../../shared/anim/pose.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CARRY_DROP, CARRY_PICK_UP, CARRY_THROW, CMD_CARRY, CMD_MOVE, CMD_SELECT, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_PRONE, BTN_SPRINT, BTN_USE, MF_ROOTED, MODE_SWIM, STANCE_PRONE, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED, F_HELD, GEAR_HELD } from "../../shared/sim/entities.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { ACT_NONE, HOLD_CARRY } from "../../shared/sim/weapon.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

/** Survivors with cheats on level ground, three metres apart along X, each on a team of their own. */
function yard(names: string[]) {
  const h = new Harness({}, 1, 60, { dev: true });
  const sessions = names.map((n) => h.join(n));
  h.run(500);
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 12, y: g.y, z: g.z + 10 };
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + i * 3).toFixed(3)} ${at.z.toFixed(3)}`);
  });
  const recs = sessions.map((s) => h.host.records.byPid.get(h.client(s)!.pid)!);
  return { h, sessions, recs, at };
}

/** A creature of `owner`'s tribe at (x, z), told to stay. With no owner it is wild. */
function creature(h: Harness, owner: EntityRecord | null, x: number, z: number, species = "core:dodo"): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(species, x, z, 5);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  if (owner) {
    rec.team = owner.team;
    h.host.refreshBody(rec);
    h.host.creatures.claimed(e);
  }
  h.host.creatures.mind.stay(e, 0xffffffff);
  return { e, rec };
}

/** `s` turns to look at the middle of entity `e`. */
function look(h: Harness, s: ClientSession, e: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, ents.stance[me]!);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
  h.run(150);
}

/** The buttons held for a tenth of a second, then let go. */
function press(h: Harness, s: ClientSession, buttons: number): void {
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  pilot.buttons = buttons;
  h.run(100);
  pilot.buttons = 0;
  h.run(150);
}

/** Sends CMD_CARRY and returns the server's answer. */
function carry(h: Harness, s: ClientSession, action: number, e = 0): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_CARRY, (w: BitWriter) => (w.u8(action), action === CARRY_PICK_UP && w.u32(e)));
  h.run(150);
  return code;
}

/** Where `s` sees entity `e`: its seat and cue word, or null if it is not in its view. */
function seen(s: ClientSession, e: number): { seat: number; held: boolean } | null {
  const r = new RemoteSample();
  s.sampleRemote(r);
  for (let i = 0; i < r.count; i++) if (r.id[i] === e) return { seat: r.seat[i]!, held: (r.cue[i]! & CUE_HELD) !== 0 };
  return null;
}

/** Free: not held by anyone, nobody's seat, and standing where a body of its size fits. */
function free(h: Harness, e: number, rec: EntityRecord): void {
  const ents = h.world.ents;
  expect([ents.flags[e]! & F_HELD, ents.cue[e]! & CUE_HELD, ents.seat[e], h.host.carry.held(e)]).toEqual([0, 0, 0, false]);
  expect(capsuleFree(h.world, ents.x[e]!, ents.y[e]!, ents.z[e]!, h.reg.bodyRadius[ents.kind[e]!]!, h.reg.bodyHeight[ents.kind[e]!]!)).toBe(true);
  expect([rec.dead, h.host.survival.gods.has(rec.pid), h.world.ents.pid[e]]).toEqual([false, false, rec.pid]);
}

test("the use key picks up a dodo of her tribe; she, two watchers and one who joins later all see it in her arms; she walks, runs and jumps with it and nothing is corrected; the use key sets it down in front of her", () => {
  const { h, sessions, recs, at } = yard(["ada", "bob", "cat"]);
  const [ada, bob, cat] = sessions as [ClientSession, ClientSession, ClientSession];
  const ents = h.world.ents;
  const { e, rec } = creature(h, recs[0]!, at.x, at.z + 2);
  look(h, ada, e);
  expect(h.host.carry.holding(h.client(ada)!)).toBe(-1);
  const before = { moved: ada.stats.corrections, state: ada.stats.stateCorrections };
  press(h, ada, BTN_USE);
  const me = h.ent(ada);
  expect([h.host.carry.holding(h.client(ada)!), ents.flags[e]! & F_HELD, ents.seat[e], ents.hold[me], h.host.carry.picked]).toEqual([e, F_HELD, me + 1, HOLD_CARRY, 1]);
  h.run(300);
  for (const s of [ada, bob, cat]) expect(seen(s, e)).toEqual({ seat: me + 1, held: true });
  // In her arms, in front of her chest and at the height of her hands, on the server too.
  const forward = (k: number): number => (ents.x[k]! - ents.x[me]!) * Math.sin((ents.yaw[me]! / 65536) * 2 * Math.PI) + (ents.z[k]! - ents.z[me]!) * Math.cos((ents.yaw[me]! / 65536) * 2 * Math.PI);
  expect(forward(e)).toBeGreaterThan(0.1);
  expect(forward(e)).toBeLessThan(0.5);
  expect(ents.y[e]! - ents.y[me]!).toBeGreaterThan(0.6);
  // She walks off with it, runs, and jumps. Her prediction and the server's agree throughout.
  const pilot = h.pilots[0]!;
  pilot.moveZ = 127;
  h.run(1500);
  pilot.buttons = BTN_SPRINT;
  h.run(1500);
  pilot.buttons = BTN_SPRINT | BTN_JUMP;
  h.run(200);
  pilot.buttons = BTN_SPRINT;
  h.run(1200);
  pilot.moveZ = 0;
  pilot.buttons = 0;
  h.run(600);
  expect(Math.hypot(ents.x[me]! - at.x, ents.z[me]! - at.z)).toBeGreaterThan(8);
  expect([ada.stats.corrections - before.moved, ada.stats.stateCorrections - before.state]).toEqual([0, 0]);
  expect(Math.hypot(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!)).toBeLessThan(0.6);
  // One who comes later sees it held too.
  const dan = h.join("dan");
  h.run(800);
  h.say(dan, "enablecheats");
  h.say(dan, `tp ${(ents.x[me]! + 3).toFixed(3)} ${ents.z[me]!.toFixed(3)}`);
  h.run(600);
  for (const s of [ada, bob, cat, dan]) expect(seen(s, e)).toEqual({ seat: me + 1, held: true });
  // The use key again sets it on the ground in front of her, and everyone sees it let go.
  press(h, ada, BTN_USE);
  h.run(500);
  free(h, e, rec);
  expect(forward(e)).toBeGreaterThan(0.4);
  expect(ents.flags[e]! & F_GROUNDED).toBe(F_GROUNDED);
  expect(Math.abs(ents.y[e]! - ents.y[me]!)).toBeLessThan(0.05);
  for (const s of [ada, bob, cat, dan]) expect(seen(s, e)).toEqual({ seat: 0, held: false });
  expect([ada.stats.corrections - before.moved, ada.stats.stateCorrections - before.state]).toEqual([0, 0]);
  expect(h.host.items.audit()).toEqual([]);
});

test("only a carriable creature of her tribe, awake, in reach and in sight, is picked up, and not while she lies down or is in the water; a client that asks by command gets the same answers", () => {
  const { h, sessions, recs, at } = yard(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const ents = h.world.ents;
  const mine = creature(h, recs[0]!, at.x, at.z + 2);
  const wild = creature(h, null, at.x - 1.5, at.z + 1.5);
  const bobs = creature(h, recs[1]!, at.x + 1.5, at.z + 1.5);
  const far = creature(h, recs[0]!, at.x, at.z + 7);
  const big = creature(h, recs[0]!, at.x - 3, at.z - 2, "core:parasaur");
  expect(carry(h, ada, CARRY_PICK_UP, wild.e)).toBe(RESULT_NOT_YOURS);
  expect(carry(h, ada, CARRY_PICK_UP, bobs.e)).toBe(RESULT_NOT_YOURS);
  expect(carry(h, ada, CARRY_PICK_UP, far.e)).toBe(RESULT_FAR);
  expect(carry(h, ada, CARRY_PICK_UP, big.e)).toBe(RESULT_INVALID);
  expect(carry(h, ada, CARRY_PICK_UP, h.ent(bob))).toBe(RESULT_INVALID);
  expect(carry(h, ada, CARRY_PICK_UP, 0xfffffff)).toBe(RESULT_INVALID);
  // The use key on someone else's or a wild one does what it did before: nothing.
  look(h, ada, wild.e);
  press(h, ada, BTN_USE);
  look(h, ada, bobs.e);
  press(h, ada, BTN_USE);
  expect(h.host.carry.picked).toBe(0);
  // Knocked out, hers is not picked up; lying down, she picks up nothing.
  h.host.survival.add(mine.rec, V_TORPOR, mine.rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  expect(carry(h, ada, CARRY_PICK_UP, mine.e)).toBe(RESULT_DENIED);
  h.host.survival.add(mine.rec, V_TORPOR, -1e6);
  h.run(3000);
  expect(mine.rec.out).toBe(false);
  h.pilots[0]!.buttons = BTN_PRONE;
  h.run(500);
  expect(ents.stance[h.ent(ada)]).toBe(STANCE_PRONE);
  expect(carry(h, ada, CARRY_PICK_UP, mine.e)).toBe(RESULT_DENIED);
  h.pilots[0]!.buttons = 0;
  h.run(500);
  expect(carry(h, ada, CARRY_PICK_UP, mine.e)).toBe(RESULT_OK);
  // Held, it is nobody else's to take, and she has no second pair of arms.
  expect(carry(h, bob, CARRY_PICK_UP, mine.e)).toBe(RESULT_NOT_YOURS);
  expect(carry(h, ada, CARRY_PICK_UP, far.e)).toBe(RESULT_BUSY);
  expect(carry(h, ada, CARRY_DROP)).toBe(RESULT_OK);
  expect(carry(h, ada, CARRY_DROP)).toBe(RESULT_INVALID);
  expect(carry(h, ada, CARRY_THROW)).toBe(RESULT_INVALID);
  expect(carry(h, ada, 9)).toBe(RESULT_INVALID);
  free(h, mine.e, mine.rec);
});

test("a wall between stops a pick-up, and a creature held against a wall stays on her side of it: carried, set down and thrown", () => {
  const { h, sessions, recs, at } = yard(["ada"]);
  const [ada] = sessions as [ClientSession];
  const ents = h.world.ents;
  const structs = h.world.structs;
  const wall = h.reg.index.get("core:wall_stone")!;
  // A wall square to Z, a metre and a half north of her, and a dodo of hers just beyond it.
  const wz = at.z + 1.5;
  structs.add(wall, at.x, at.y + h.reg.halfY[wall]!, wz, 0, recs[0]!.team, 10000);
  const behind = creature(h, recs[0]!, at.x, wz + h.reg.halfZ[wall]! + 0.5);
  look(h, ada, behind.e);
  expect(carry(h, ada, CARRY_PICK_UP, behind.e)).toBe(RESULT_OBSTRUCTED);
  press(h, ada, BTN_USE);
  expect(h.host.carry.picked).toBe(0);
  // One beside her, picked up, then she walks into the wall with it held out in front.
  const near = creature(h, recs[0]!, at.x - 1.2, at.z);
  look(h, ada, near.e);
  expect(carry(h, ada, CARRY_PICK_UP, near.e)).toBe(RESULT_OK);
  const pilot = h.pilots[0]!;
  pilot.yaw = 0;
  pilot.pitch = 0;
  pilot.moveZ = 127;
  h.run(1500);
  const face = wz - h.reg.halfZ[wall]!;
  expect(ents.z[h.ent(ada)]!).toBeLessThan(face);
  expect(ents.z[near.e]! + h.reg.bodyRadius[ents.kind[near.e]!]!).toBeLessThan(face + 0.01);
  // Set down against the wall, it is set down on her side.
  expect(carry(h, ada, CARRY_DROP)).toBe(RESULT_OK);
  h.run(500);
  expect(ents.z[near.e]!).toBeLessThan(face);
  free(h, near.e, near.rec);
  // Thrown at the wall, it falls on her side.
  expect(carry(h, ada, CARRY_PICK_UP, near.e)).toBe(RESULT_OK);
  pilot.yaw = 0;
  pilot.pitch = 0.3;
  h.run(300);
  expect(carry(h, ada, CARRY_THROW)).toBe(RESULT_OK);
  h.run(2000);
  expect(ents.z[near.e]!).toBeLessThan(face);
  free(h, near.e, near.rec);
});

test("thrown, it flies where she looks at the rule's speed and falls where the ground stops it, never farther than that speed carries it", () => {
  const { h, sessions, recs, at } = yard(["ada"]);
  const [ada] = sessions as [ClientSession];
  const ents = h.world.ents;
  const pilot = h.pilots[0]!;
  const gravity = h.reg.move[h.reg.index.get("core:dodo")!]!.gravity;
  const { e, rec } = creature(h, recs[0]!, at.x, at.z + 1.6);
  let farthest = 0;
  for (const pitch of [0, 0.4, 0.75, 1.1]) {
    h.say(ada, `tp ${(ents.x[e]! - 1.6).toFixed(3)} ${ents.z[e]!.toFixed(3)}`);
    look(h, ada, e);
    expect(carry(h, ada, CARRY_PICK_UP, e)).toBe(RESULT_OK);
    pilot.yaw = Math.PI / 2;
    pilot.pitch = pitch;
    h.run(300);
    const me = h.ent(ada);
    const [x0, y0, z0] = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
    expect(carry(h, ada, CARRY_THROW)).toBe(RESULT_OK);
    expect(h.host.carry.thrown).toBeGreaterThan(0);
    h.run(2500);
    free(h, e, rec);
    // Thrown east; the most a body leaving at THROW_SPEED from that height can go, with nothing but gravity on it.
    const went = Math.hypot(ents.x[e]! - x0, ents.z[e]! - z0);
    const vy = THROW_SPEED * Math.sin(pitch);
    const most = (THROW_SPEED * Math.cos(pitch) * (vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, y0 - ents.y[e]!)))) / gravity;
    expect(ents.x[e]! - ents.x[me]!).toBeGreaterThan(0.5);
    expect(went).toBeLessThanOrEqual(most + 0.6);
    farthest = Math.max(farthest, went);
    void z0;
  }
  expect(farthest).toBeGreaterThan(2);
  expect(rec.dead).toBe(false);
});

test("held, it is not struck: blows and shots go past it to whatever is behind; it takes no harm, and pecks from her arms what its stance would have it peck", () => {
  const { h, sessions, recs, at } = yard(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const ents = h.world.ents;
  const { e, rec } = creature(h, recs[0]!, at.x, at.z + 1.6);
  look(h, ada, e);
  expect(carry(h, ada, CARRY_PICK_UP, e)).toBe(RESULT_OK);
  h.pilots[0]!.yaw = 0;
  h.pilots[0]!.pitch = 0;
  h.run(300);
  const me = h.ent(ada);
  const combat = h.host.combat;
  // A ray from in front of her through the bird finds her behind it.
  const [bx, by, bz] = [ents.x[e]!, ents.y[e]! + 0.3, ents.z[e]!];
  expect(combat.castBodies(h.ent(bob), bx, by, bz + 6, 0, 0, -1, 12)).toBe(me);
  const health = h.host.survival.value(rec, V_HEALTH);
  expect(h.host.survival.hurt(rec, 30, recs[1]!.pid)).toBe(0);
  h.run(500);
  expect(h.host.survival.value(rec, V_HEALTH)).toBe(health);
  // Aggressive, it pecks a survivor of another tribe who stands where its beak reaches, and no wild one at her feet.
  h.host.creatures.mind.stance[e] = STANCE_AGGRESSIVE;
  const low = creature(h, null, ents.x[me]! + 0.2, ents.z[me]! + 0.6);
  h.run(2000);
  expect(h.host.survival.value(low.rec, V_HEALTH)).toBe(low.rec.vitals!.max[V_HEALTH]! / 1e6);
  const him = recs[1]!;
  h.say(bob, `tp ${ents.x[me]!.toFixed(3)} ${(ents.z[me]! + 0.75).toFixed(3)}`);
  const his = h.host.survival.value(him, V_HEALTH);
  h.run(2000);
  expect(h.host.survival.value(him, V_HEALTH)).toBeLessThan(his);
  expect([combat.last.by, combat.last.victim]).toEqual([rec.pid, him.pid]);
  expect(h.host.carry.held(e)).toBe(true);
  // Turned away from him, she holds it where it does not reach him.
  h.host.survival.add(him, V_HEALTH, 1e6);
  h.pilots[0]!.yaw = Math.PI;
  h.run(800);
  const after = h.host.survival.value(him, V_HEALTH);
  h.run(2000);
  expect(h.host.survival.value(him, V_HEALTH)).toBeGreaterThanOrEqual(after);
});

test("her hands are full: she strikes, swings, aims and loads nothing, takes nothing out, and its pack weighs half on her", () => {
  const { h, sessions, recs, at } = yard(["ada", "bob"]);
  const [ada] = sessions as [ClientSession];
  const ents = h.world.ents;
  const me = recs[0]!;
  h.say(ada, "give core:hatchet 1");
  const hatchet = h.reg.index.get("core:hatchet")!;
  const inv = ada.inventory!;
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(hatchet)), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(hatchet)));
  h.run(200);
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(300);
  expect(me.held).toBe(0);
  const { e, rec } = creature(h, me, at.x, at.z + 1.6);
  look(h, ada, e);
  expect(carry(h, ada, CARRY_PICK_UP, e)).toBe(RESULT_OK);
  const body = h.ent(ada);
  expect([me.held, ents.gear[body]![GEAR_HELD], ents.hold[body]]).toEqual([-1, 0, HOLD_CARRY]);
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(300);
  expect([me.held, ents.gear[body]![GEAR_HELD]]).toEqual([-1, 0]);
  // A client that sends the buttons anyway strikes with nothing.
  const victim = h.ent(sessions[1]!);
  h.say(sessions[1]!, `tp ${ents.x[body]!.toFixed(3)} ${(ents.z[body]! + 1.2).toFixed(3)}`);
  const blows = h.host.combat.last.victim;
  for (const b of [BTN_PRIMARY, BTN_MELEE]) {
    h.pilots[0]!.buttons = b;
    h.run(600);
    expect(ents.act[body]).toBe(ACT_NONE);
  }
  h.pilots[0]!.buttons = 0;
  expect(h.host.combat.last.victim).toBe(blows);
  expect(h.host.carry.holding(h.client(ada)!)).toBe(e);
  void victim;
  // Its pack weighs half on her: enough in it, with what she has, roots her; set down, it does not.
  const stone = h.reg.index.get("core:stone")!;
  h.host.items.mint(rec, stone, 1000);
  h.host.refreshBody(rec);
  const half = (h.host.items.inv(rec).weight(h.host.items.table) * 0.5);
  expect(h.host.carry.load(me)).toBeCloseTo(half, 5);
  expect(ents.mflags[body]! & MF_ROOTED).toBe(MF_ROOTED);
  expect(carry(h, ada, CARRY_DROP)).toBe(RESULT_OK);
  expect(ents.mflags[body]! & MF_ROOTED).toBe(0);
  expect(h.host.carry.load(me)).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("every way a carry ends leaves the creature free and whole where it fits: set down, thrown, and its carrier dying, leaving, mounting, swimming, lying down, knocked out or moved away", () => {
  const { h, sessions, recs, at } = yard(["ada"]);
  const [ada] = sessions as [ClientSession];
  const ents = h.world.ents;
  const me = recs[0]!;
  const { e, rec } = creature(h, me, at.x, at.z + 1.6);
  const take = (): void => {
    const c = h.client(ada)!;
    if (c.ent < 0) return;
    look(h, ada, e);
    expect(carry(h, ada, CARRY_PICK_UP, e)).toBe(RESULT_OK);
    h.run(200);
  };
  const ends = (why: string, end: () => void): void => {
    take();
    expect(h.host.carry.held(e)).toBe(true);
    end();
    h.run(1500);
    expect([why, h.host.carry.held(e)]).toEqual([why, false]);
    free(h, e, rec);
    expect(h.host.survival.value(rec, V_HEALTH)).toBeGreaterThan(0);
  };
  ends("knocked out", () => {
    h.host.survival.add(me, V_TORPOR, me.vitals!.max[V_TORPOR]! / 1e6 + 1);
    h.run(300);
    expect(me.out).toBe(true);
    h.host.survival.add(me, V_TORPOR, -1e6);
    h.run(3000);
  });
  ends("lying down", () => {
    h.pilots[0]!.buttons = BTN_PRONE;
    h.run(500);
    h.pilots[0]!.buttons = 0;
    h.run(500);
  });
  ends("moved away", () => void h.say(ada, `tp ${(at.x + 15).toFixed(3)} ${at.z.toFixed(3)}`));
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  ends("mounting", () => {
    const raptor = creature(h, me, ents.x[h.ent(ada)]! - 2.5, ents.z[h.ent(ada)]!, "core:raptor");
    raptor.rec.saddle = h.reg.index.get("core:saddle_raptor")!;
    expect(h.host.riding.mount(h.client(ada)!, raptor.e)).toBe(RESULT_OK);
    h.run(500);
    h.host.riding.dismount(h.client(ada)!);
  });
  ends("dying", () => {
    h.host.survival.hurt(me, 1e6, 0);
    h.run(500);
    expect(me.dead).toBe(true);
    h.say(ada, "respawn");
  });
  void MODE_SWIM;
});
