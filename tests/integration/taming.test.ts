// Knock-out taming, at the reference's numbers.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { MIND_HUNT, MIND_WANDER, STANCE_AGGRESSIVE, STANCE_NEUTRAL, STANCE_PASSIVE } from "../../server/behavior.ts";
import type { EntityRecord } from "../../server/records.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_FEED, CMD_MOVE, CMD_NAME, CMD_OPEN, CMD_ORDER, ORDER_ALL, ORDER_FOLLOW, ORDER_LEVEL, ORDER_STANCE, ORDER_STAY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** Ada is in survival.gods, so nothing harms her. */
function camp(host: { dbPath?: string } = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6, y: g.y };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(rec.pid);
  return { h, ada, at, rec };
}

/** A creature `far` metres north of `at`, knocked out by raising its torpor past its maximum. */
function knockOut(h: Harness, at: { x: number; z: number }, species: string, far: number, level: number): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(`core:${species}`, at.x, at.z + far, level);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, h.world.tick + 30);
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  expect(rec.out).toBe(true);
  return { e, rec };
}

function press(h: Harness, s: ClientSession, e: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
  h.run(150);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
}

/** `slot` is a slot of the creature the survivor has open. */
function give(h: Harness, s: ClientSession, item: string, count: number, slot: number): void {
  h.say(s, `give ${item} ${count}`);
  const inv = s.inventory!;
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_OPEN, 1), w.varint(slot), w.u16(0), w.u16(id(item))));
  h.run(150);
}

test("a raptor of level 30 on raw meat, as the reference has it: fifteen pieces, one every fifty seconds, 81.0% well, twelve levels for it; and it is hers, named, awake", () => {
  const { h, ada, at, rec: me } = camp();
  const taming = h.host.taming;
  const survival = h.host.survival;
  const { e, rec } = knockOut(h, at, "raptor", 2.6, 30);
  const down = h.world.tick;
  expect([rec.tame !== null, rec.tame!.affinity, rec.team, rec.genome!.level]).toEqual([true, 0, 0, 30]);
  expect(rec.vitals!.max[V_TORPOR]! / 1e6).toBeCloseTo(180 * (1 + 0.06 * 29), 3);
  press(h, ada, e);
  expect([ada.open !== null, ada.open?.inventory.cap, ada.subject?.taming, ada.subject?.owned, ada.subject?.level, ada.subject?.progress]).toEqual([true, 20, true, false, 30, 0]);
  expect(ada.subject!.te).toBe(1);
  // Knocked out, it loses a point of food a second, and a piece of meat is worth fifty, so it eats every fifty seconds.
  give(h, ada, "meat", 20, 0);
  give(h, ada, "meat", 20, 1);
  expect(h.host.items.inv(rec).total(id("meat"))).toBe(40);
  h.run(20000);
  expect([taming.bites, rec.tame!.by]).toEqual([0, me.pid]);
  const bitesAt: number[] = [];
  for (let k = 0; k < 800 && rec.tame; k++) {
    const before = taming.bites;
    h.run(1000);
    if (taming.bites > before) bitesAt.push(Math.round((h.world.tick - down) / TICK_RATE / 10) * 10);
  }
  expect(bitesAt).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750]);
  expect([taming.bites, taming.tamed, rec.tame, rec.team, rec.out]).toEqual([15, 1, null, me.team, false]);
  expect(Math.round(rec.te * 1000) / 10).toBe(81);
  expect(rec.genome!.level).toBe(42);
  expect(survival.value(rec, V_TORPOR)).toBe(0);
  h.run(3000);
  expect([h.host.creatures.mind.mind[e], h.host.creatures.mind.targetOf(e)]).toEqual([MIND_WANDER, -1]);
  // The name is cleaned: trimmed, and without the angle brackets.
  expect(ada.tamed).toEqual([{ handle: h.world.ents.handleOf(e), kind: id("raptor"), level: 42, te: 81 }]);
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  ada.command(CMD_NAME, (w: BitWriter) => (w.u32(ada.tamed[0]!.handle), w.string("  Blue <1>  ")));
  h.run(300);
  expect([code, rec.name]).toEqual([RESULT_OK, "Blue 1"]);
  const remote = new RemoteSample();
  ada.sampleRemote(remote);
  const i = Array.from(remote.id.subarray(0, remote.count)).indexOf(e);
  expect([remote.name[i], remote.team[i], remote.level[i]]).toEqual(["Blue 1", me.team, 42]);
  const wild = h.host.spawnCreature("core:parasaur", at.x + 12, at.z + 12, 1);
  h.run(100);
  for (const [handle, want] of [[ada.ownHandle, RESULT_INVALID], [h.world.ents.handleOf(wild), RESULT_NOT_YOURS]] as const) {
    ada.command(CMD_NAME, (w: BitWriter) => (w.u32(handle), w.string("Mine")));
    h.run(200);
    expect(code).toBe(want);
  }
  expect(h.host.items.audit()).toEqual([]);
});

test("a tame finishes on the same tick whether or not anyone is there, across a restart; fed by no hand it is nobody's until someone looks into it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-tame-"));
  const dbPath = join(dir, "world.db");
  // At four times the taming speed a level 30 raptor takes four pieces, which is two hundred seconds.
  const finish = (away: boolean): { ticks: number; te: number; level: number } => {
    let { h, ada, at, rec: me } = camp(away ? { dbPath } : {});
    h.say(ada, "setting TamingSpeedMultiplier 4");
    const { e, rec } = knockOut(h, at, "raptor", 2.6, 30);
    const down = h.world.tick;
    press(h, ada, e);
    give(h, ada, "meat", 20, 0);
    let pid = rec.pid;
    if (away) {
      h.say(ada, `tp ${(at.x + 300).toFixed(3)} ${(at.z + 300).toFixed(3)}`);
      h.run(60000);
      h.host.shutdown();
      h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
      expect(h.host.records.byPid.get(pid)!.tame).toMatchObject({ by: me.pid });
      expect(h.host.records.byPid.get(pid)!.tame!.affinity).toBeGreaterThan(0);
    }
    const now = (): EntityRecord => h.host.records.byPid.get(pid)!;
    // A creature that has just been tamed gets stay(0xffffffff), which marks the tick.
    let wonAt = -1;
    const mind = h.host.creatures.mind;
    const stay = mind.stay.bind(mind);
    mind.stay = (who, until) => {
      if (until === 0xffffffff) wonAt = h.world.tick;
      stay(who, until);
    };
    for (let k = 0; k < 400 && now().tame; k++) h.run(1000);
    pid = now().pid;
    expect([now().tame, now().team]).toEqual([null, me.team]);
    const done = { ticks: wonAt - down, te: now().te, level: now().genome!.level };
    h.host.shutdown();
    void ada;
    return done;
  };
  const watched = finish(false);
  const unwatched = finish(true);
  // Two hundred seconds after it went down, give or take the few ticks a request takes to arrive.
  expect(Math.abs(watched.ticks - 200 * TICK_RATE)).toBeLessThan(6);
  expect(unwatched).toEqual(watched);
  // Four pieces leave 98.5% effectiveness, which is fourteen levels.
  expect([Math.round(watched.te * 1000) / 10, watched.level]).toEqual([98.5, 44]);
  rmSync(dir, { recursive: true, force: true });

  // Food minted into it has no feeder, so the finished tame is nobody's until the first survivor opens it.
  const { h, ada, at, rec: me } = camp();
  h.say(ada, "setting TamingSpeedMultiplier 30");
  const { e, rec } = knockOut(h, at, "raptor", 2.6, 1);
  h.host.items.mint(rec, id("meat"), 5);
  h.run(53000);
  expect([h.host.taming.bites, rec.tame !== null, rec.team]).toEqual([1, true, 0]);
  press(h, ada, e);
  h.run(3000);
  expect([rec.tame, rec.team, h.host.taming.tamed]).toEqual([null, me.team, 1]);
});

test("a narcotic keeps it under, one after another; harm costs how well it is done; awake by itself, all it was given is lost; a parasaur eats berries", () => {
  const { h, ada, at, rec: me } = camp();
  const taming = h.host.taming;
  const survival = h.host.survival;
  const { e, rec } = knockOut(h, at, "raptor", 2.6, 30);
  // Torpor is lowered to leave room for a narcotic to add to it. The creature stays out until it has none.
  survival.add(rec, V_TORPOR, -150);
  press(h, ada, e);
  give(h, ada, "narcotic", 3, 5);
  give(h, ada, "meat", 5, 0);
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  const feed = (slot: number, item: string): number => {
    ada.command(CMD_FEED, (w: BitWriter) => (w.varint(slot), w.u16(id(item))));
    h.run(150);
    return code;
  };
  // Meat cannot be force-fed. A narcotic can, and adds forty torpor over eight seconds with no drain meanwhile.
  expect(feed(0, "meat")).toBe(RESULT_INVALID);
  const most = rec.vitals!.max[V_TORPOR]! / 1e6;
  h.run(1000);
  const before = survival.value(rec, V_TORPOR);
  expect([rec.out, before < most - 130]).toEqual([true, true]);
  expect(feed(5, "narcotic")).toBe(RESULT_OK);
  h.run(8000 - 150);
  expect(survival.value(rec, V_TORPOR) - before).toBeCloseTo(40, 0);
  // Two doses queue. The second starts when the first ends, so they add eighty torpor over sixteen seconds.
  const mid = survival.value(rec, V_TORPOR);
  feed(5, "narcotic");
  feed(5, "narcotic");
  h.run(8000);
  expect(survival.value(rec, V_TORPOR) - mid).toBeGreaterThan(38);
  expect(survival.value(rec, V_TORPOR) - mid).toBeLessThan(43);
  h.run(8200);
  expect(survival.value(rec, V_TORPOR) - mid).toBeCloseTo(80, 0);
  expect([taming.doses, h.host.items.inv(rec).total(id("narcotic"))]).toEqual([3, 0]);

  // Harm of a fifth of its health costs a fifth of its taming effectiveness.
  h.run(30000);
  expect(taming.bites).toBe(1);
  const well = ada.subject!.te;
  expect(Math.round(well * 1000) / 10).toBe(98.5);
  h.host.combat.onHarm.emit(rec, (rec.vitals!.max[V_HEALTH]! / 1e6) * 0.2);
  h.run(500);
  expect(ada.subject!.te).toBeCloseTo(well * 0.8, 2);
  expect(ada.subject!.progress).toBeCloseTo(200 / 3000, 2);
  survival.add(rec, V_TORPOR, -survival.value(rec, V_TORPOR) - 1);
  h.run(500);
  expect([rec.out, rec.tame, taming.lost, rec.team, ada.open, ada.subject]).toEqual([false, null, 1, 0, null, null]);
  press(h, ada, e);
  expect([ada.open, feed(0, "meat")]).toEqual([null, RESULT_DENIED]);
  h.host.creatures.remove(e);

  // A parasaur ignores meat. At twenty times the speed one berry tames it, once it is twelve seconds hungry.
  h.say(ada, "setting TamingSpeedMultiplier 20");
  const p = knockOut(h, at, "parasaur", 4.5, 1);
  press(h, ada, p.e);
  expect(ada.open?.inventory.cap).toBe(30);
  give(h, ada, "meat", 3, 0);
  h.run(15000);
  expect([taming.tamed, p.rec.tame!.affinity]).toEqual([0, 0]);
  const food = survival.value(p.rec, V_FOOD);
  give(h, ada, "berry", 4, 1);
  h.run(1000);
  expect([taming.tamed, p.rec.team, p.rec.out, h.host.items.inv(p.rec).total(id("berry"))]).toEqual([1, me.team, false, 3]);
  expect(survival.value(p.rec, V_FOOD)).toBeGreaterThan(food + 15);
  expect(h.host.items.audit()).toEqual([]);
});

/** Tames a creature for `s` at once. Sets TamingSpeedMultiplier to 60 so that one piece of food is enough. */
function tameNow(h: Harness, s: ClientSession, at: { x: number; z: number }, species: string, dx: number, far: number): { e: number; rec: EntityRecord } {
  h.say(s, "setting TamingSpeedMultiplier 60");
  const made = knockOut(h, { x: at.x + dx, z: at.z }, species, far, 1);
  h.host.survival.add(made.rec, V_FOOD, -80);
  h.host.items.mint(made.rec, id(species === "parasaur" ? "berry" : "meat"), 1);
  h.host.creatures.mind.stay(made.e, 0);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  made.rec.tame!.by = me.pid;
  h.run(500);
  expect([made.rec.team, made.rec.out]).toEqual([me.team, false]);
  return made;
}

test("a creature that is somebody's follows and stays, by word or by whistle, for its tribe and nobody else; it is looked into awake, eats of what it carries, and takes levels", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-own-"));
  const dbPath = join(dir, "world.db");
  let { h, ada, at, rec: me } = camp({ dbPath });
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x + 3).toFixed(3)} ${(at.z - 2).toFixed(3)}`);
  const raptor = tameNow(h, ada, at, "raptor", 0, 3);
  const para = tameNow(h, ada, at, "parasaur", 8, 4);
  const far = tameNow(h, ada, at, "raptor", 0, 3);
  let ents = h.world.ents;
  let mind = h.host.creatures.mind;
  expect([mind.owned.has(raptor.e), mind.owned.has(para.e), mind.stance[raptor.e], mind.leader[raptor.e]]).toEqual([true, true, STANCE_NEUTRAL, -1]);
  // The third is moved out of a whistle's reach.
  ents.x[far.e] = at.x + 60;
  ents.z[far.e] = at.z + 20;
  const order = (s: ClientSession, which: number, what: number): number => {
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(CMD_ORDER, (w: BitWriter) => (w.u32(which >>> 0), w.u8(what)));
    h.run(150);
    return code;
  };
  const gap = (e: number, s: ClientSession): number => Math.hypot(ents.x[e]! - ents.x[h.ent(s)]!, ents.z[e]! - ents.z[h.ent(s)]!);
  // A follower stops a few steps short of her.
  expect(order(ada, raptor.e, ORDER_FOLLOW)).toBe(RESULT_OK);
  const stood = [ents.x[para.e]!, ents.z[para.e]!];
  h.say(ada, `tp ${(at.x - 14).toFixed(3)} ${(at.z + 14).toFixed(3)}`);
  h.run(6000);
  expect(gap(raptor.e, ada)).toBeLessThan(4.2);
  expect(gap(raptor.e, ada)).toBeGreaterThan(1.5);
  expect([ents.x[para.e], ents.z[para.e], raptor.rec.follow, mind.leader[raptor.e]]).toEqual([...stood, me.pid, h.ent(ada)]);
  expect(order(ada, raptor.e, ORDER_STAY)).toBe(RESULT_OK);
  const left = [ents.x[raptor.e]!, ents.z[raptor.e]!];
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.run(3000);
  expect([Math.hypot(ents.x[raptor.e]! - left[0]!, ents.z[raptor.e]! - left[1]!) < 0.5, raptor.rec.follow]).toEqual([true, 0]);
  // ORDER_ALL is a whistle. The one sixty metres off does not hear it.
  expect(order(ada, ORDER_ALL, ORDER_FOLLOW)).toBe(RESULT_OK);
  h.run(7000);
  expect([gap(raptor.e, ada) < 4.2, gap(para.e, ada) < 5.5, far.rec.follow, mind.leader[far.e]]).toEqual([true, true, 0, -1]);
  expect(order(ada, ORDER_ALL, ORDER_STAY)).toBe(RESULT_OK);
  expect([raptor.rec.follow, para.rec.follow]).toEqual([0, 0]);
  // Bob's whistle succeeds but reaches none of hers.
  expect([order(bob, raptor.e, ORDER_FOLLOW), order(bob, ORDER_ALL, ORDER_FOLLOW), raptor.rec.follow]).toEqual([RESULT_NOT_YOURS, RESULT_OK, 0]);
  expect([order(ada, h.ent(bob), ORDER_FOLLOW), order(ada, raptor.e, 9), order(ada, far.e, ORDER_FOLLOW)]).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_FAR]);

  press(h, bob, raptor.e);
  expect(bob.open).toBeNull();
  press(h, ada, raptor.e);
  expect([ada.open !== null, ada.subject?.owned, ada.subject?.taming, ada.subject?.id, ada.subject?.stance, ada.subject?.following, ada.subject?.points]).toEqual([true, true, false, raptor.e, STANCE_NEUTRAL, false, 0]);
  // It eats when she closes its inventory.
  h.host.survival.add(raptor.rec, V_FOOD, -120);
  give(h, ada, "meat", 6, 0);
  const food = h.host.survival.value(raptor.rec, V_FOOD);
  // A piece is worth fifty, and it eats as many as fit under its maximum.
  const pieces = Math.floor((raptor.rec.vitals!.max[V_FOOD]! / 1e6 - food) / 50);
  expect(pieces).toBeGreaterThanOrEqual(2);
  expect(h.host.taming.meals).toBe(0);
  ada.command(CMD_CLOSE);
  h.run(500);
  expect([h.host.taming.meals, h.host.items.inv(raptor.rec).total(id("meat"))]).toEqual([pieces, 6 - pieces]);
  expect(h.host.survival.value(raptor.rec, V_FOOD) - food).toBeGreaterThan(50 * pieces - 5);
  expect(raptor.rec.mealDue).toBeGreaterThan(h.world.tick + 30 * TICK_RATE);

  // A tamed point in health is worth 5.4%. Stat 8, torpor, takes no points.
  h.host.progression.addXp(raptor.rec, 40);
  const points = h.host.progression.statPoints(raptor.rec);
  expect(points).toBeGreaterThan(0);
  const most = raptor.rec.vitals!.max[V_HEALTH]!;
  expect([order(ada, raptor.e, ORDER_LEVEL + 0), order(ada, raptor.e, ORDER_LEVEL + 8)]).toEqual([RESULT_OK, RESULT_INVALID]);
  expect([raptor.rec.genome!.tamed[0], h.host.progression.statPoints(raptor.rec)]).toEqual([1, points - 1]);
  expect(raptor.rec.vitals!.max[V_HEALTH]! / most).toBeCloseTo(1.054, 3);
  for (let k = 1; k < points; k++) order(ada, raptor.e, ORDER_LEVEL + 6);
  expect(order(ada, raptor.e, ORDER_LEVEL + 6)).toBe(RESULT_SHORT);

  expect([order(ada, raptor.e, ORDER_STANCE + STANCE_AGGRESSIVE), order(ada, raptor.e, ORDER_FOLLOW)]).toEqual([RESULT_OK, RESULT_OK]);
  const pid = raptor.rec.pid;
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ents = h.world.ents;
  mind = h.host.creatures.mind;
  const again = h.host.records.byPid.get(pid)!;
  const e2 = h.host.records.entOf.get(pid)!;
  expect([again.stance, again.follow, again.team, again.genome!.tamed[0], again.name]).toEqual([STANCE_AGGRESSIVE, me.pid, me.team, 1, ""]);
  ada = h.join("ada");
  h.run(2500);
  expect([mind.owned.has(e2), mind.stance[e2], mind.leader[e2]]).toEqual([true, STANCE_AGGRESSIVE, h.ent(ada)]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("what it does about others is its stance: passive, nothing; neutral, it goes for what hurts it or its tribe; aggressive, for any wild thing it sees; and a wild hunter goes for it", () => {
  const { h, ada, at, rec: me } = camp();
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const mine = tameNow(h, ada, at, "raptor", 0, 3);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  const stance = (which: number): void => {
    ada.command(CMD_ORDER, (w: BitWriter) => (w.u32(mine.e), w.u8(ORDER_STANCE + which)));
    h.run(150);
    expect(code).toBe(RESULT_OK);
  };
  const grazer = h.host.spawnCreature("core:parasaur", at.x + 10, at.z + 6, 1);
  mind.stay(grazer, h.world.tick + 3000);
  h.run(2500);
  expect([mind.mind[mine.e], mind.targetOf(mine.e)]).toEqual([MIND_WANDER, -1]);
  stance(STANCE_PASSIVE);
  h.host.creatures.provoke(mine.e, ents.x[grazer]!, ents.z[grazer]!, grazer);
  h.run(1000);
  expect(mind.targetOf(mine.e)).toBe(-1);
  stance(STANCE_NEUTRAL);
  h.host.creatures.provoke(mine.e, ents.x[grazer]!, ents.z[grazer]!, grazer);
  expect([mind.mind[mine.e], mind.targetOf(mine.e)]).toEqual([MIND_HUNT, grazer]);
  stance(STANCE_PASSIVE);
  expect(mind.targetOf(mine.e)).toBe(-1);
  // It defends her against a wild attacker, and does nothing when the attacker is of her own tribe.
  stance(STANCE_NEUTRAL);
  h.host.creatures.provoke(h.ent(ada), ents.x[grazer]!, ents.z[grazer]!, grazer);
  expect(mind.targetOf(mine.e)).toBe(grazer);
  stance(STANCE_PASSIVE);
  stance(STANCE_NEUTRAL);
  const other = tameNow(h, ada, at, "parasaur", -9, 4);
  h.host.creatures.provoke(h.ent(ada), ents.x[other.e]!, ents.z[other.e]!, other.e);
  h.host.creatures.provoke(mine.e, ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!, h.ent(ada));
  expect(mind.targetOf(mine.e)).toBe(-1);

  expect(mine.rec.xp).toBe(0);
  stance(STANCE_AGGRESSIVE);
  h.run(1500);
  expect([mind.mind[mine.e], mind.targetOf(mine.e)]).toEqual([MIND_HUNT, grazer]);
  const wild = h.host.records.byPid.get(ents.pid[grazer]!)!;
  // The grazer flees east off the plaza, among the rocks and trees, and the raptor gives up the hunt and takes it up again
  // more than once, so the chase is given time: it takes about 63,000 ticks.
  for (let k = 0; k < 240 && h.host.records.byPid.has(wild.pid); k++) h.run(500);
  expect(h.host.records.byPid.has(wild.pid)).toBe(false);
  expect(mine.rec.xp).toBeGreaterThan(0);
  expect([h.host.records.byPid.has(other.rec.pid), h.host.survival.value(other.rec, V_HEALTH) > 150, me.dead]).toEqual([true, true, false]);

  // Ada and her raptor are moved out of sight, so the wild raptor hunts her parasaur. The parasaur is neutral, so once hurt it turns on the raptor.
  // Beside her raptor, wherever the fight left it, on a spot clear of trees and rocks.
  const move = h.world.reg.move[ents.kind[h.ent(ada)]!]!;
  const [bx, bz] = [[0, -3], [3, 0], [-3, 0], [0, 3]].map(([dx, dz]) => [ents.x[mine.e]! + dx!, ents.z[mine.e]! + dz!]).find(([x, z]) => capsuleFree(h.world, x!, groundUnder(h.world.hf, x!, z!, move.radius), z!, move.radius, move.height))!;
  h.say(ada, `tp ${bx!.toFixed(3)} ${bz!.toFixed(3)}`);
  stance(STANCE_PASSIVE);
  h.say(ada, `tp ${(at.x + 80).toFixed(3)} ${(at.z + 8).toFixed(3)}`);
  ents.x[mine.e] = at.x + 85;
  const hunter = h.host.spawnCreature("core:raptor", ents.x[other.e]! + 9, ents.z[other.e]! + 2, 1);
  h.run(1200);
  expect([mind.mind[hunter], mind.targetOf(hunter)]).toEqual([MIND_HUNT, other.e]);
  for (let k = 0; k < 20 && mind.targetOf(other.e) !== hunter; k++) h.run(500);
  expect(mind.targetOf(other.e)).toBe(hunter);
  expect(h.host.items.audit()).toEqual([]);
});

test("at its tribe's limit a creature fed full waits, and whoever is looking into it is told so once, and once more each time it is opened again", () => {
  const { h, ada, at, rec: me } = camp();
  tameNow(h, ada, at, "raptor", -4, 3);
  h.say(ada, "setting MaxPersonalTamedDinos 1");
  const { e, rec } = knockOut(h, at, "raptor", 2.6, 1);
  press(h, ada, e);
  expect(ada.open).not.toBeNull();
  const notices = (): number => ada.log.filter((l) => l.text === "Your tribe has as many tamed creatures as it may (1).").length;
  // One piece is all it needs at this server's rate. It eats it with her looking on.
  h.host.survival.add(rec, V_FOOD, -80);
  give(h, ada, "meat", 1, 0);
  h.run(2000);
  expect([rec.team, rec.tame !== null, ada.open !== null, notices()]).toEqual([0, true, true, 1]);
  ada.command(CMD_CLOSE);
  h.run(300);
  press(h, ada, e);
  h.run(1000);
  expect([ada.open !== null, notices()]).toEqual([true, 2]);
  // With room in the tribe, it is hers the next time she looks.
  h.say(ada, "setting MaxPersonalTamedDinos 2");
  h.run(500);
  expect(rec.team).toBe(0);
  ada.command(CMD_CLOSE);
  h.run(300);
  press(h, ada, e);
  h.run(500);
  expect([rec.team, rec.tame, notices()]).toEqual([me.team, null, 2]);
});

test("a hungry tame's kill leaves its body where it fell, and the tame carries none of it off (Raw Meat)", () => {
  const { h, ada, at } = camp();
  const ents = h.world.ents;
  const mine = tameNow(h, ada, at, "raptor", 0, 3);
  // It is hungry by more than two pieces and carries nothing, so no meal is due.
  h.host.survival.add(mine.rec, V_FOOD, -120);
  h.host.taming.meal(mine.rec);
  expect([h.host.items.inv(mine.rec).total(id("meat")), mine.rec.mealDue, h.host.taming.meals]).toEqual([0, 0, 0]);
  const prey = h.host.spawnCreature("core:grazer", ents.x[mine.e]!, ents.z[mine.e]! + 3, 1);
  const preyRec = h.host.records.byPid.get(ents.pid[prey]!)!;
  h.host.survival.add(preyRec, V_HEALTH, 1 - h.host.survival.value(preyRec, V_HEALTH));
  h.host.creatures.mind.stay(prey, h.world.tick + 3000);
  h.host.creatures.provoke(mine.e, ents.x[prey]!, ents.z[prey]!, prey);
  for (let k = 0; k < 40 && h.host.records.byPid.has(preyRec.pid); k++) h.run(250);
  expect(h.host.records.byPid.has(preyRec.pid)).toBe(false);
  // The meat is in the grazer's body, for a tool. The raptor eats only what it is given.
  h.run(1000);
  expect([h.host.taming.meals, h.host.items.inv(mine.rec).total(id("meat")), h.host.corpses.count]).toEqual([0, 0, 1]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a tame given meat eats it however its inventory came to be shut: by the key that opened it, or by its keeper leaving the server", () => {
  for (const how of ["key", "leave"] as const) {
    const { h, ada, at } = camp();
    const mine = tameNow(h, ada, at, "raptor", 0, 2.6);
    h.host.creatures.mind.stay(mine.e, 0xffffffff);
    h.host.survival.add(mine.rec, V_FOOD, -120);
    press(h, ada, mine.e);
    expect(ada.open).not.toBeNull();
    give(h, ada, "meat", 6, 0);
    expect([h.host.taming.meals, h.host.items.inv(mine.rec).total(id("meat"))]).toEqual([0, 6]);
    // A piece is worth fifty, and it eats as many as fit under its maximum.
    const pieces = Math.floor((mine.rec.vitals!.max[V_FOOD]! / 1e6 - h.host.survival.value(mine.rec, V_FOOD)) / 50);
    expect(pieces).toBeGreaterThanOrEqual(2);
    if (how === "key") ada.command(CMD_OPEN, (w: BitWriter) => w.u32(mine.e));
    else ada.close();
    h.run(how === "leave" ? 7000 : 500);
    expect([how, h.client(ada)?.open ?? 0, h.host.taming.meals, h.host.items.inv(mine.rec).total(id("meat"))]).toEqual([how, 0, pieces, 6 - pieces]);
  }
});

test("a creature that is somebody's is next due to eat at the same moment after a restart as before it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-meal-"));
  const dbPath = join(dir, "world.db");
  const { h, ada, at } = camp({ dbPath });
  const { rec } = tameNow(h, ada, at, "raptor", 0, 3);
  // It is short of full by less than a piece of meat, so its next meal is due hours from now.
  h.host.survival.add(rec, V_FOOD, 1e6);
  h.host.survival.add(rec, V_FOOD, -20);
  h.host.items.mint(rec, id("meat"), 5);
  h.host.taming.meal(rec);
  const due = rec.mealDue;
  expect(due).toBeGreaterThan(h.world.tick + 3600 * TICK_RATE);
  h.run(1000);
  h.host.shutdown();
  const again = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  expect(again.host.records.byPid.get(rec.pid)!.mealDue).toBe(due);
  again.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
