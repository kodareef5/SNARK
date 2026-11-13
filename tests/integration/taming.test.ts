// Taming: a creature knocked out and fed, at the reference's numbers.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { MIND_HUNT, MIND_WANDER, STANCE_AGGRESSIVE, STANCE_NEUTRAL, STANCE_PASSIVE } from "../../server/behavior.ts";
import type { EntityRecord } from "../../server/records.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_FEED, CMD_MOVE, CMD_NAME, CMD_ORDER, ORDER_ALL, ORDER_FOLLOW, ORDER_LEVEL, ORDER_STANCE, ORDER_STAY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** A world with ada in it, on level ground, with cheats and unharmed by anything. */
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

/** A creature `far` metres in front of where ada stands, made to stand, and knocked out: its torpor put to its most. */
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

/** Look at the creature `e` and press the use button. */
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

/** Give a survivor some of an item and put all of it into the creature it has open. */
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
  // It can be tamed from the moment it is down. Nothing has been given it, and it is nobody's.
  expect([rec.tame !== null, rec.tame!.affinity, rec.team, rec.genome!.level]).toEqual([true, 0, 0, 30]);
  expect(rec.vitals!.max[V_TORPOR]! / 1e6).toBeCloseTo(180 * (1 + 0.06 * 29), 3);
  // Looked into where it lies: twenty slots, and how it is.
  press(h, ada, e);
  expect([ada.open !== null, ada.open?.inventory.cap, ada.subject?.taming, ada.subject?.owned, ada.subject?.level, ada.subject?.progress]).toEqual([true, 20, true, false, 30, 0]);
  expect(ada.subject!.te).toBe(1);
  // Forty pieces of raw meat put in it. It is not hungry enough yet: lying there it loses a point of food a second, and a piece is fifty.
  give(h, ada, "meat", 20, 0);
  give(h, ada, "meat", 20, 1);
  expect(h.host.items.inv(rec).total(id("meat"))).toBe(40);
  h.run(20000);
  expect([taming.bites, rec.tame!.by]).toEqual([0, me.pid]);
  // Fifty seconds after it went down, the first piece; then one every fifty seconds.
  const bitesAt: number[] = [];
  for (let k = 0; k < 800 && rec.tame; k++) {
    const before = taming.bites;
    h.run(1000);
    if (taming.bites > before) bitesAt.push(Math.round((h.world.tick - down) / TICK_RATE / 10) * 10);
  }
  expect(bitesAt).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750]);
  // Fifteen pieces, 750 seconds, 81.0%: it is hers, twelve levels the better for it, and awake.
  expect([taming.bites, taming.tamed, rec.tame, rec.team, rec.out]).toEqual([15, 1, null, me.team, false]);
  expect(Math.round(rec.te * 1000) / 10).toBe(81);
  expect(rec.genome!.level).toBe(42);
  expect(survival.value(rec, V_TORPOR)).toBe(0);
  // It stands where it woke and goes for nobody, her least of all.
  h.run(3000);
  expect([h.host.creatures.mind.mind[e], h.host.creatures.mind.targetOf(e)]).toEqual([MIND_WANDER, -1]);
  // She was told, with what it is and how well: and names it. Its name and its tribe are what others see of it.
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
  // Her own survivor is not a creature to be named, and a wild one is nobody's to name.
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
  // Taming four times as fast, so that a raptor of level 30 takes four pieces: two hundred seconds.
  const finish = (away: boolean): { ticks: number; te: number; level: number } => {
    let { h, ada, at, rec: me } = camp(away ? { dbPath } : {});
    h.say(ada, "rule tamingSpeed 4");
    const { e, rec } = knockOut(h, at, "raptor", 2.6, 30);
    const down = h.world.tick;
    press(h, ada, e);
    give(h, ada, "meat", 20, 0);
    let pid = rec.pid;
    if (away) {
      // She leaves it lying there and goes far off; the world is stopped and started again part way; nobody comes back.
      h.say(ada, `tp ${(at.x + 300).toFixed(3)} ${(at.z + 300).toFixed(3)}`);
      h.run(60000);
      h.host.shutdown();
      h = new Harness({}, 1, 60, { dev: true, dbPath });
      expect(h.host.records.byPid.get(pid)!.tame).toMatchObject({ by: me.pid });
      expect(h.host.records.byPid.get(pid)!.tame!.affinity).toBeGreaterThan(0);
    }
    const now = (): EntityRecord => h.host.records.byPid.get(pid)!;
    // The tick it is won on, noted as it happens: a creature that has just been tamed is told to stand.
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
  // Two hundred seconds after it went down, to within the tick or two a request takes to arrive; and the same tick both times.
  expect(Math.abs(watched.ticks - 200 * TICK_RATE)).toBeLessThan(6);
  expect(unwatched).toEqual(watched);
  // Four pieces at four times the worth each: 98.5% well, and fourteen levels.
  expect([Math.round(watched.te * 1000) / 10, watched.level]).toEqual([98.5, 44]);
  rmSync(dir, { recursive: true, force: true });

  // Food put in it by no hand: it eats, and is full of what it needs, but is nobody's. The first to look into it has it.
  const { h, ada, at, rec: me } = camp();
  h.say(ada, "rule tamingSpeed 30");
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
  // (Some of its torpor is taken off, so that there is room to see a narcotic add to it. It stays under until it has none.)
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
  // Meat is not fed by hand: it eats when it is hungry. A narcotic is: forty torpor over eight seconds, and nothing shaken off meanwhile.
  expect(feed(0, "meat")).toBe(RESULT_INVALID);
  const most = rec.vitals!.max[V_TORPOR]! / 1e6;
  h.run(1000);
  const before = survival.value(rec, V_TORPOR);
  expect([rec.out, before < most - 130]).toEqual([true, true]);
  expect(feed(5, "narcotic")).toBe(RESULT_OK);
  h.run(8000 - 150);
  expect(survival.value(rec, V_TORPOR) - before).toBeCloseTo(40, 0);
  // Two at once: the second begins when the first has done. Sixteen seconds, eighty torpor (or as much as it holds).
  const mid = survival.value(rec, V_TORPOR);
  feed(5, "narcotic");
  feed(5, "narcotic");
  h.run(8000);
  expect(survival.value(rec, V_TORPOR) - mid).toBeGreaterThan(38);
  expect(survival.value(rec, V_TORPOR) - mid).toBeLessThan(43);
  h.run(8200);
  expect(survival.value(rec, V_TORPOR) - mid).toBeCloseTo(80, 0);
  expect([taming.doses, h.host.items.inv(rec).total(id("narcotic"))]).toEqual([3, 0]);

  // A minute after it went down it has eaten once. Hurt for a fifth of its health as it lies there, a fifth of how well it was going is gone.
  h.run(30000);
  expect(taming.bites).toBe(1);
  const well = ada.subject!.te;
  expect(Math.round(well * 1000) / 10).toBe(98.5);
  h.host.combat.onHarm!(rec, (rec.vitals!.max[V_HEALTH]! / 1e6) * 0.2);
  h.run(500);
  expect(ada.subject!.te).toBeCloseTo(well * 0.8, 2);
  expect(ada.subject!.progress).toBeCloseTo(200 / 3000, 2);
  // It comes round by itself: what it was given is lost, there is nothing more to look into, and it is nobody's.
  survival.add(rec, V_TORPOR, -survival.value(rec, V_TORPOR) - 1);
  h.run(500);
  expect([rec.out, rec.tame, taming.lost, rec.team, ada.open, ada.subject]).toEqual([false, null, 1, 0, null, null]);
  // Awake, it is not to be fed or looked into.
  press(h, ada, e);
  expect([ada.open, feed(0, "meat")]).toEqual([null, RESULT_DENIED]);
  h.host.creatures.remove(e);

  // A parasaur: berries are what it eats; meat lying in it is not. Twenty times as fast, one berry does it, when it is twelve seconds hungry.
  h.say(ada, "rule tamingSpeed 20");
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

/** Tame a creature for `s` at once: knocked out, hungry, with one piece of what it likes in it, and looked into. Taming is made fast enough for one piece to do. */
function tameNow(h: Harness, s: ClientSession, at: { x: number; z: number }, species: string, dx: number, far: number): { e: number; rec: EntityRecord } {
  h.say(s, "rule tamingSpeed 60");
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
  // (The third is taken off beyond a whistle's reach.)
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
  // Told to follow, it comes after her wherever she goes and stops a few steps off; the other stays where it is.
  expect(order(ada, raptor.e, ORDER_FOLLOW)).toBe(RESULT_OK);
  const stood = [ents.x[para.e]!, ents.z[para.e]!];
  h.say(ada, `tp ${(at.x - 14).toFixed(3)} ${(at.z + 14).toFixed(3)}`);
  h.run(6000);
  expect(gap(raptor.e, ada)).toBeLessThan(4.2);
  expect(gap(raptor.e, ada)).toBeGreaterThan(1.5);
  expect([ents.x[para.e], ents.z[para.e], raptor.rec.follow, mind.leader[raptor.e]]).toEqual([...stood, me.pid, h.ent(ada)]);
  // Told to stay, it stays when she goes.
  expect(order(ada, raptor.e, ORDER_STAY)).toBe(RESULT_OK);
  const left = [ents.x[raptor.e]!, ents.z[raptor.e]!];
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.run(3000);
  expect([Math.hypot(ents.x[raptor.e]! - left[0]!, ents.z[raptor.e]! - left[1]!) < 0.5, raptor.rec.follow]).toEqual([true, 0]);
  // A whistle: every one of hers that hears it comes; the one sixty metres off does not hear.
  expect(order(ada, ORDER_ALL, ORDER_FOLLOW)).toBe(RESULT_OK);
  h.run(7000);
  expect([gap(raptor.e, ada) < 4.2, gap(para.e, ada) < 5.5, far.rec.follow, mind.leader[far.e]]).toEqual([true, true, 0, -1]);
  expect(order(ada, ORDER_ALL, ORDER_STAY)).toBe(RESULT_OK);
  expect([raptor.rec.follow, para.rec.follow]).toEqual([0, 0]);
  // Not another tribe's to order, by word or by whistle; nor is a survivor a creature to be ordered, nor nonsense an order.
  expect([order(bob, raptor.e, ORDER_FOLLOW), order(bob, ORDER_ALL, ORDER_FOLLOW), raptor.rec.follow]).toEqual([RESULT_NOT_YOURS, RESULT_OK, 0]);
  expect([order(ada, h.ent(bob), ORDER_FOLLOW), order(ada, raptor.e, 9), order(ada, far.e, ORDER_FOLLOW)]).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_FAR]);

  // Awake, it is looked into by its tribe and not by a stranger. She is shown whose it is, which it is, and what it is doing.
  press(h, bob, raptor.e);
  expect(bob.open).toBeNull();
  press(h, ada, raptor.e);
  expect([ada.open !== null, ada.subject?.owned, ada.subject?.taming, ada.subject?.id, ada.subject?.stance, ada.subject?.following, ada.subject?.points]).toEqual([true, true, false, raptor.e, STANCE_NEUTRAL, false, 0]);
  // Meat put in it, and it is hungry: shut, it eats a piece, at once and then as it hungers.
  h.host.survival.add(raptor.rec, V_FOOD, -120);
  give(h, ada, "meat", 6, 0);
  const food = h.host.survival.value(raptor.rec, V_FOOD);
  // (A piece is fifty: as many as it is short of full by.)
  const pieces = Math.floor((raptor.rec.vitals!.max[V_FOOD]! / 1e6 - food) / 50);
  expect(pieces).toBeGreaterThanOrEqual(2);
  expect(h.host.taming.meals).toBe(0);
  ada.command(CMD_CLOSE);
  h.run(500);
  expect([h.host.taming.meals, h.host.items.inv(raptor.rec).total(id("meat"))]).toEqual([pieces, 6 - pieces]);
  expect(h.host.survival.value(raptor.rec, V_FOOD) - food).toBeGreaterThan(50 * pieces - 5);
  // The next when it is hungry enough again: not for a long while.
  expect(raptor.rec.mealDue).toBeGreaterThan(h.world.tick + 30 * TICK_RATE);

  // It has earned levels: one is put into its health, which grows by what a tamed point is worth; none into what takes none; and then it has none.
  h.host.progression.addXp(raptor.rec, 40);
  const points = h.host.progression.statPoints(raptor.rec);
  expect(points).toBeGreaterThan(0);
  const most = raptor.rec.vitals!.max[V_HEALTH]!;
  expect([order(ada, raptor.e, ORDER_LEVEL + 0), order(ada, raptor.e, ORDER_LEVEL + 8)]).toEqual([RESULT_OK, RESULT_INVALID]);
  expect([raptor.rec.genome!.tamed[0], h.host.progression.statPoints(raptor.rec)]).toEqual([1, points - 1]);
  expect(raptor.rec.vitals!.max[V_HEALTH]! / most).toBeCloseTo(1.054, 3);
  for (let k = 1; k < points; k++) order(ada, raptor.e, ORDER_LEVEL + 6);
  expect(order(ada, raptor.e, ORDER_LEVEL + 6)).toBe(RESULT_SHORT);

  // Its stance and whom it follows are part of the world.
  expect([order(ada, raptor.e, ORDER_STANCE + STANCE_AGGRESSIVE), order(ada, raptor.e, ORDER_FOLLOW)]).toEqual([RESULT_OK, RESULT_OK]);
  const pid = raptor.rec.pid;
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  ents = h.world.ents;
  mind = h.host.creatures.mind;
  const again = h.host.records.byPid.get(pid)!;
  const e2 = h.host.records.entOf.get(pid)!;
  expect([again.stance, again.follow, again.team, again.genome!.tamed[0], again.name]).toEqual([STANCE_AGGRESSIVE, me.pid, me.team, 1, ""]);
  // She comes back: it is hers, aggressive, and follows her again.
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
  // Neutral, with a wild parasaur grazing ten metres off and its own tribe all round it: it goes for nothing.
  const grazer = h.host.spawnCreature("core:parasaur", at.x + 10, at.z + 6, 1);
  mind.stay(grazer, h.world.tick + 3000);
  h.run(2500);
  expect([mind.mind[mine.e], mind.targetOf(mine.e)]).toEqual([MIND_WANDER, -1]);
  // Passive, something hurts it: it does nothing about it.
  stance(STANCE_PASSIVE);
  h.host.creatures.provoke(mine.e, ents.x[grazer]!, ents.z[grazer]!, grazer);
  h.run(1000);
  expect(mind.targetOf(mine.e)).toBe(-1);
  // Neutral, the same: it goes for what did it. Made passive in the middle of that, it lets go.
  stance(STANCE_NEUTRAL);
  h.host.creatures.provoke(mine.e, ents.x[grazer]!, ents.z[grazer]!, grazer);
  expect([mind.mind[mine.e], mind.targetOf(mine.e)]).toEqual([MIND_HUNT, grazer]);
  stance(STANCE_PASSIVE);
  expect(mind.targetOf(mine.e)).toBe(-1);
  // Neutral, and she is the one hurt, by something wild near it: it comes to her help. Hurt by one of her own, it does nothing.
  stance(STANCE_NEUTRAL);
  h.host.creatures.provoke(h.ent(ada), ents.x[grazer]!, ents.z[grazer]!, grazer);
  expect(mind.targetOf(mine.e)).toBe(grazer);
  stance(STANCE_PASSIVE);
  stance(STANCE_NEUTRAL);
  const other = tameNow(h, ada, at, "parasaur", -9, 4);
  h.host.creatures.provoke(h.ent(ada), ents.x[other.e]!, ents.z[other.e]!, other.e);
  h.host.creatures.provoke(mine.e, ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!, h.ent(ada));
  expect(mind.targetOf(mine.e)).toBe(-1);

  // Aggressive: it sees the wild one and goes for it, never her or the other of hers; it kills it, and what it earned by that is its own.
  expect(mine.rec.xp).toBe(0);
  stance(STANCE_AGGRESSIVE);
  h.run(1500);
  expect([mind.mind[mine.e], mind.targetOf(mine.e)]).toEqual([MIND_HUNT, grazer]);
  const wild = h.host.records.byPid.get(ents.pid[grazer]!)!;
  for (let k = 0; k < 120 && h.host.records.byPid.has(wild.pid); k++) h.run(500);
  expect(h.host.records.byPid.has(wild.pid)).toBe(false);
  expect(mine.rec.xp).toBeGreaterThan(0);
  expect([h.host.records.byPid.has(other.rec.pid), h.host.survival.value(other.rec, V_HEALTH) > 150, me.dead]).toEqual([true, true, false]);

  // A wild raptor, with her out of its sight: it goes for the parasaur that is hers. That one is neutral: hurt, it turns on it.
  h.say(ada, `tp ${ents.x[mine.e]!.toFixed(3)} ${(ents.z[mine.e]! - 3).toFixed(3)}`);
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
