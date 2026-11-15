// The rules every creature follows, shown first on the dodo at ARK's numbers (ark.wiki.gg, Dodo, Fall Damage, Whistles and
// Aggression Level, 2026-11-15): its flock takes fright together, it is hurt by falls and drowns, a tame runs at its tamed
// speed, her creatures obey the orders to wander and to attack, and unclaimed young follow the survivor nearest them.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { MIND_FLEE, MIND_HUNT, MIND_WANDER, STANCE_NEUTRAL, STANCE_YOURS } from "../../server/behavior.ts";
import type { EntityRecord } from "../../server/records.ts";
import { CAUSE_DROWNED, CAUSE_FALL } from "../../server/survival.ts";
import { AnimState, CUE_STARTLE } from "../../shared/anim/pose.ts";
import { TICK_DT, TICK_RATE } from "../../shared/coords.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_ORDER, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_STANCE, ORDER_WANDER, ORDER_YOURS, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_SPRINT, Body, MODE_SWIM, STAMINA_UNITS, stepBody } from "../../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH, V_OXYGEN, V_TORPOR } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { flatWorld } from "../fixtures/world.ts";

/** Ada stands on level ground with cheats on, and nothing harms her. */
function camp(opts: { reg?: Registry; dbPath?: string } = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...(opts.dbPath ? { dbPath: opts.dbPath } : {}) }, opts.reg);
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  return { h, ada, g, at, me };
}

const recOf = (h: Harness, e: number): EntityRecord => h.host.records.byPid.get(h.world.ents.pid[e]!)!;

/** A wild one of `kind` standing where it is put until it is hurt. */
function put(h: Harness, x: number, z: number, kind = "core:dodo"): number {
  const e = h.host.spawnCreature(kind, x, z, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  h.host.creatures.mind.stay(e, h.world.tick + 1e6);
  return e;
}

/** Ada's own, standing until told otherwise. */
function tame(h: Harness, me: EntityRecord, x: number, z: number): { e: number; rec: EntityRecord } {
  const e = put(h, x, z);
  const rec = recOf(h, e);
  expect(h.host.taming.give(rec, me, 0.9, "forced")).toBe(true);
  return { e, rec };
}

/** Sends an order and returns its result. ORDER_ATTACK carries `target`. */
function order(h: Harness, s: ClientSession, which: number, what: number, target = 0): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_ORDER, (w: BitWriter) => (w.u32(which >>> 0), w.u8(what), what === ORDER_ATTACK ? w.u32(target >>> 0) : 0));
  h.run(150);
  return code;
}

/** Records the cause of every death. Removing a body touches its vitals again, which tells of its death again. */
function causes(h: Harness): Map<number, number> {
  const seen = new Map<number, number>();
  const was = h.host.survival.onDeath;
  h.host.survival.onDeath = (rec, cause, by) => {
    if (!seen.has(rec.pid)) seen.set(rec.pid, cause);
    was?.(rec, cause, by);
  };
  return seen;
}

test("a flock of twenty with one struck: the nineteen within 15 m take fright with it, stand through their startle and then run from the blow; one further off and one of another kind do not", () => {
  const { h, ada, g } = camp();
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const [cx, cz] = [g.x + 20, g.z + 18];
  const flock: number[] = [];
  for (let i = 0; i < 20; i++) flock.push(put(h, cx + ((i % 5) - 2) * 1.5, cz + (Math.floor(i / 5) - 1.5) * 1.5));
  const victim = flock[12]!;
  const far = put(h, cx + 16, cz);
  const other = put(h, cx - 10, cz + 4, "core:parasaur");
  h.run(1500);
  const me = h.ent(ada);
  expect(Math.hypot(ents.x[far]! - ents.x[victim]!, ents.z[far]! - ents.z[victim]!)).toBeGreaterThan(15);
  expect(Math.hypot(ents.x[other]! - ents.x[victim]!, ents.z[other]! - ents.z[victim]!)).toBeLessThan(15);
  const alarmed = mind.alarmed;
  const struck = h.world.tick;
  h.host.creatures.provoke(victim, ents.x[me]!, ents.z[me]!, me);
  expect([flock.every((e) => mind.mind[e] === MIND_FLEE), mind.alarmed - alarmed, mind.mind[far], mind.mind[other]]).toEqual([true, 19, MIND_WANDER, MIND_WANDER]);
  // Each is startled from this tick.
  const st = new AnimState();
  expect(flock.every((e) => (st.unpack(0, ents.cue[e]!), st.cue === CUE_STARTLE && st.cueStart === (struck & 255)))).toBe(true);

  // Through its startled clip it stands and does not turn, so its feet do not slide, even when hit again half way.
  const hold = h.world.anims[ents.kind[victim]!]!.startled!.frames - 1;
  const from = flock.map((e) => [ents.x[e]!, ents.z[e]!, ents.yaw[e]!, Math.hypot(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!)] as const);
  let slid = 0;
  let again = false;
  h.run(((hold + 6) * 1000) / TICK_RATE, () => {
    const t = h.world.tick - struck;
    if (!again && t >= hold / 2) {
      again = true;
      h.host.creatures.provoke(victim, ents.x[me]!, ents.z[me]!, me);
    }
    if (t < hold) flock.forEach((e, i) => void (ents.x[e] !== from[i]![0] || ents.z[e] !== from[i]![1] || ents.yaw[e] !== from[i]![2] ? slid++ : 0));
  });
  expect([again, slid]).toEqual([true, 0]);
  h.run(2500);
  // Then every one is further from her, and the struck one runs at 136.5 units a second.
  expect(flock.filter((e, i) => Math.hypot(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!) > from[i]![3] + 1.5).length).toBe(20);
  const [x, z] = [ents.x[victim]!, ents.z[victim]!];
  h.run(1000);
  expect(Math.hypot(ents.x[victim]! - x, ents.z[victim]! - z)).toBeCloseTo(1.365, 1);
  h.run(4000);
  expect(flock.every((e) => mind.mind[e] === MIND_WANDER)).toBe(true);

  // Hit where it stands, with nothing to run from, it runs the way it faces.
  const lone = put(h, g.x + 4, g.z + 26);
  ents.yaw[lone] = mind.look[lone] = 20000;
  h.run(500);
  const [lx, lz] = [ents.x[lone]!, ents.z[lone]!];
  h.host.creatures.provoke(lone, lx, lz, -1);
  h.run(((hold + 60) * 1000) / TICK_RATE);
  const way = Math.atan2(ents.x[lone]! - lx, ents.z[lone]! - lz);
  expect(Math.hypot(ents.x[lone]! - lx, ents.z[lone]! - lz)).toBeGreaterThan(1.5);
  expect(Math.abs(way - (20000 / 65536) * Math.PI * 2)).toBeLessThan(0.15);
});

test("in a kind that fights, those near the one struck turn on whoever struck it", () => {
  const raptor = CORE_CONTENT.find((d) => d.id === "core:raptor")!;
  const { registry } = compileContent([...CORE_CONTENT, { ...raptor, id: "core:raptor_pack", temper: "defends", alarm: 15 } as (typeof CORE_CONTENT)[number]]);
  const { h, ada, g } = camp({ reg: registry! });
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const pack = [0, 1, 2, 3].map((i) => put(h, g.x + 8 + i * 3, g.z + 22, "core:raptor_pack"));
  const far = put(h, g.x + 36, g.z + 6, "core:raptor_pack");
  h.run(1000);
  const me = h.ent(ada);
  // Struck by nobody, there is nobody to turn on.
  h.host.creatures.provoke(pack[0]!, ents.x[pack[0]!]! + 2, ents.z[pack[0]!]!, -1);
  expect(pack.map((e) => mind.targetOf(e))).toEqual([-1, -1, -1, -1]);
  h.host.creatures.provoke(pack[0]!, ents.x[me]!, ents.z[me]!, me);
  expect([...pack.map((e) => mind.targetOf(e)), mind.targetOf(far)]).toEqual([me, me, me, me, -1]);
  expect(pack.every((e) => mind.mind[e] === MIND_HUNT)).toBe(true);
});

test("a dodo dropped from 6 m lands unhurt, from 7 m is hurt as a creature's landing hurts, and from 20 m dies of the fall; driven, the creature takes the fall", () => {
  const { h, ada, g, me } = camp();
  const ents = h.world.ents;
  const died = causes(h);
  /** Lifts `e` by `height` and lets it fall, and returns the health it lost. */
  const drop = (e: number, height: number): number => {
    const rec = recOf(h, e);
    const before = h.host.survival.value(rec, V_HEALTH);
    let least = before;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.setPosition(e, ents.x[e]!, ents.y[e]! + height, ents.z[e]!);
    ents.vy[e] = 0;
    h.run(3000, () => void (rec.dead || (least = Math.min(least, h.host.survival.value(rec, V_HEALTH)))));
    return before - least;
  };
  // ARK's creatures are hurt from a third more speed than its survivors (12 m/s here), and by two thirds as much:
  // 16 m/s, from 6.4 m under this world's gravity of 20, and 4.67 health for each metre a second over that.
  const a = put(h, g.x + 6, g.z + 20);
  expect(drop(a, 6)).toBe(0);
  const hurt = drop(a, 7);
  expect(hurt).toBeGreaterThan(1.5);
  expect(hurt).toBeLessThan(5);
  const pid = recOf(h, a).pid;
  drop(a, 20);
  expect(died.get(pid)).toBe(CAUSE_FALL);

  // A tame she drives lands as hard, and it is the one hurt.
  const t = tame(h, me, g.x + 30, g.z + 20);
  expect(h.host.game.take(h.client(ada)!, t.e)).toBe(true);
  h.run(500);
  const lost = drop(t.e, 9);
  expect(lost).toBeGreaterThan(8);
  expect(lost).toBeLessThan(17);
  expect(died.has(t.rec.pid)).toBe(false);
});

test("out cold under water a dodo's 150 oxygen lasts 50 seconds, then it drowns; awake it comes up for air, and fleeing it swims at its swim speed", () => {
  const { h, ada, g, me } = camp();
  const ents = h.world.ents;
  const sv = h.host.survival;
  const died = causes(h);
  const sea = h.world.hf.seaLevel;
  const [px, pz] = [PROVING_POOL.x, PROVING_POOL.z];
  expect(h.world.hf.heightAt(px, pz)).toBeLessThan(sea - 5);
  h.say(ada, `tp ${(px + 12).toFixed(3)} ${(pz + 0.5).toFixed(3)}`);
  /** Puts `e` 3 m under the surface of the pool. */
  const sink = (e: number, x: number): void => {
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.setPosition(e, x, sea - 3, pz);
    ents.vy[e] = 0;
  };
  const cold = put(h, g.x + 6, g.z + 20);
  const out = recOf(h, cold);
  sv.add(out, V_TORPOR, out.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(500);
  expect(out.out).toBe(true);
  sink(cold, px - 3);
  h.run(45000);
  // Three a second, from its first tick under.
  expect(sv.value(out, V_OXYGEN)).toBeGreaterThan(13);
  expect(sv.value(out, V_OXYGEN)).toBeLessThan(18);
  expect(sv.value(out, V_HEALTH)).toBe(40);
  h.run(7000);
  expect(sv.value(out, V_OXYGEN)).toBe(0);
  expect(sv.value(out, V_HEALTH)).toBeLessThan(40);
  h.run(5000);
  expect(died.get(out.pid)).toBe(CAUSE_DROWNED);

  // Awake, it rises to float with its head out, and has all its breath back.
  const up = put(h, g.x + 10, g.z + 20);
  const rec = recOf(h, up);
  sink(up, px + 3);
  h.run(10000);
  expect([ents.mode[up], sv.value(rec, V_OXYGEN), died.has(rec.pid)]).toEqual([MODE_SWIM, 150, false]);
  expect(ents.y[up]! + h.reg.move[ents.kind[up]!]!.eyeHeight).toBeGreaterThan(sea);
  // Struck, it runs through the water at 300 units a second, its swim speed, and does not sprint.
  const her = h.ent(ada);
  h.host.creatures.provoke(up, ents.x[her]!, ents.z[her]!, her);
  h.run(4000);
  const [x, z] = [ents.x[up]!, ents.z[up]!];
  h.run(1000);
  expect(Math.hypot(ents.x[up]! - x, ents.z[up]! - z)).toBeCloseTo(3, 1);
  expect(me.dead).toBe(false);
});

test("a tame runs at 95.55 units a second where a wild dodo runs at 136.5, led or driven, and her prediction of the one she drives needs no correction", () => {
  const { h, ada, g, me } = camp();
  const ents = h.world.ents;
  const pilot = h.pilots[0]!;
  // Led: she is 30 m off, so it runs to catch her up.
  const led = tame(h, me, g.x + 4, g.z + 14);
  expect(order(h, ada, led.e, ORDER_FOLLOW)).toBe(RESULT_OK);
  h.say(ada, `tp ${(g.x + 36).toFixed(3)} ${(g.z + 14).toFixed(3)}`);
  h.run(3000);
  const [lx, lz] = [ents.x[led.e]!, ents.z[led.e]!];
  h.run(1000);
  expect(Math.hypot(ents.x[led.e]! - lx, ents.z[led.e]! - lz)).toBeCloseTo(0.9555, 2);

  // Driven: the server and her client step it with the same tamed numbers.
  const t = tame(h, me, g.x + 6, g.z + 4);
  h.run(500);
  expect(h.host.game.take(h.client(ada)!, t.e)).toBe(true);
  h.run(500);
  expect(ada.driving).toBe(t.e);
  const corrections = ada.stats.corrections + ada.stats.stateCorrections;
  pilot.yaw = Math.PI / 2;
  pilot.moveZ = 1;
  pilot.buttons = BTN_SPRINT;
  h.run(2500);
  const [x, z] = [ents.x[t.e]!, ents.z[t.e]!];
  h.run(1000);
  expect(Math.hypot(ents.x[t.e]! - x, ents.z[t.e]! - z)).toBeCloseTo(0.9555, 2);
  pilot.moveZ = 0;
  pilot.buttons = 0;
  h.run(500);
  expect(ada.stats.corrections + ada.stats.stateCorrections).toBe(corrections);
  expect(Math.hypot(ada.own.x - ents.x[t.e]!, ada.own.z - ents.z[t.e]!)).toBeLessThan(1e-3);
});

test("a dodo's walking costs 0.025 stamina a second, as near as whole units a tick come, and only standing gets it back", () => {
  const w = flatWorld();
  const p = w.reg.move[w.kind("core:dodo")]!;
  expect([p.staminaWalk, w.reg.move[w.kind("core:raptor")]!.staminaWalk]).toEqual([1, 0]);
  const b = new Body();
  b.x = b.z = 40;
  b.y = w.hf.heightAt(40, 40);
  b.grounded = true;
  b.stamina = 50 * STAMINA_UNITS;
  for (let i = 0; i < 10 * TICK_RATE; i++) stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
  expect(b.stamina).toBe(50 * STAMINA_UNITS - 10 * TICK_RATE);
  for (let i = 0; i < TICK_RATE; i++) stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
  expect(b.stamina).toBe(50 * STAMINA_UNITS - 10 * TICK_RATE + TICK_RATE * p.staminaRegen);
});

test("burning harms a dodo by its fire multiplier, three eighths of what it harms a survivor", () => {
  const { h, g } = camp();
  const e = put(h, g.x + 6, g.z + 20);
  const rec = recOf(h, e);
  const burning = h.reg.index.get("core:burning")!;
  h.host.buffs.give(rec, burning);
  const before = h.host.survival.value(rec, V_HEALTH);
  h.run(4000);
  // 8 a second times 0.375, less the 0.2 a second it mends.
  expect(before - h.host.survival.value(rec, V_HEALTH)).toBeCloseTo(4 * (8 * 0.375 - 0.2), 1);
});

test("her creatures wander, go for what she points at and take up her target, as ARK's whistles and menu have them, and refuse what they should", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-orders-"));
  const dbPath = join(dir, "world.db");
  let { h, ada, g, at, me } = camp({ dbPath });
  let ents = h.world.ents;
  let mind = h.host.creatures.mind;
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x - 1).toFixed(3)} ${(at.z + 7).toFixed(3)}`);
  const a = tame(h, me, at.x + 2, at.z + 3);
  const b = tame(h, me, at.x - 2, at.z + 3);
  const wild = put(h, at.x + 8, at.z + 8);
  h.run(500);

  // Wander, from the menu: it follows nobody and walks about, untethered. Bob's order, an order to a wild one and a
  // whistle are refused, as the reference has no whistle for it.
  expect([order(h, bob, a.e, ORDER_WANDER), order(h, ada, wild, ORDER_WANDER), order(h, ada, ORDER_ALL, ORDER_WANDER)]).toEqual([RESULT_NOT_YOURS, RESULT_NOT_YOURS, RESULT_INVALID]);
  expect(order(h, ada, a.e, ORDER_FOLLOW)).toBe(RESULT_OK);
  expect(order(h, ada, a.e, ORDER_WANDER)).toBe(RESULT_OK);
  expect([a.rec.wander, a.rec.follow, mind.wanders[a.e], mind.leader[a.e]]).toEqual([true, 0, 1, -1]);
  const [wx, wz] = [ents.x[a.e]!, ents.z[a.e]!];
  h.run(15000);
  expect(Math.hypot(ents.x[a.e]! - wx, ents.z[a.e]! - wz)).toBeGreaterThan(1);
  expect(order(h, ada, a.e, ORDER_FOLLOW)).toBe(RESULT_OK);
  expect([a.rec.wander, mind.wanders[a.e], mind.leader[a.e]]).toEqual([false, 0, h.ent(ada)]);

  // Attack this target: what she points at must be alive, of no tribe of hers, within 100 m and in her sight.
  const her = h.ent(ada);
  expect([order(h, ada, a.e, ORDER_ATTACK, b.e), order(h, ada, a.e, ORDER_ATTACK, her), order(h, ada, a.e, ORDER_ATTACK, 0xfffffff0)]).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_INVALID]);
  const gone = put(h, at.x - 8, at.z + 8);
  h.host.survival.hurt(recOf(h, gone), 1000, 0);
  h.run(200);
  expect(order(h, ada, a.e, ORDER_ATTACK, gone)).toBe(RESULT_INVALID);
  let distant = -1;
  for (let k = 0; k < 40 && distant < 0; k++) distant = h.host.spawnCreature("core:dodo", at.x + 105 + k, at.z + (k % 7) * 3, 1);
  expect(distant).toBeGreaterThanOrEqual(0);
  expect(order(h, ada, a.e, ORDER_ATTACK, distant)).toBe(RESULT_FAR);
  // A wall stands between her eye and the wild one behind it.
  const hidden = put(h, at.x + 12, at.z - 4);
  const dz = ents.z[hidden]! - ents.z[her]!;
  const dx = ents.x[hidden]! - ents.x[her]!;
  const yaw = Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * 65536) & 0xffff;
  h.world.structs.add(h.reg.index.get("core:wall_wood")!, ents.x[her]! + dx / 2, g.y + 1.5, ents.z[her]! + dz / 2, yaw, 0, 10000);
  expect(order(h, ada, a.e, ORDER_ATTACK, hidden)).toBe(RESULT_DENIED);
  // Bob is a target. By whistle both go for him, wherever he goes, until the neutral whistle calls them off.
  expect(order(h, ada, ORDER_ALL, ORDER_ATTACK, h.ent(bob))).toBe(RESULT_OK);
  expect([mind.targetOf(a.e), mind.targetOf(b.e)]).toEqual([h.ent(bob), h.ent(bob)]);
  const bobRec = h.host.records.byPid.get(h.client(bob)!.pid)!;
  h.run(6000);
  expect(h.host.survival.value(bobRec, V_HEALTH)).toBeLessThan(100);
  expect(order(h, ada, ORDER_ALL, ORDER_STANCE + STANCE_NEUTRAL)).toBe(RESULT_OK);
  expect([mind.targetOf(a.e), mind.targetOf(b.e)]).toEqual([-1, -1]);
  // One she drives goes where she takes it.
  expect(h.host.game.take(h.client(ada)!, b.e)).toBe(true);
  h.run(300);
  expect(order(h, ada, b.e, ORDER_ATTACK, h.ent(bob))).toBe(RESULT_BUSY);
  h.host.game.release(h.client(ada)!);
  h.run(300);

  // Attack your target: one so set goes for what she hurts. A neutral one does not.
  expect(order(h, ada, a.e, ORDER_YOURS)).toBe(RESULT_OK);
  expect([a.rec.stance, mind.stance[a.e], mind.stance[b.e]]).toEqual([STANCE_YOURS, STANCE_YOURS, STANCE_NEUTRAL]);
  h.host.creatures.provoke(wild, ents.x[her]!, ents.z[her]!, her);
  expect([mind.targetOf(a.e), mind.targetOf(b.e)]).toEqual([wild, -1]);
  expect(order(h, ada, ORDER_ALL, ORDER_YOURS)).toBe(RESULT_OK);
  expect([mind.stance[a.e], mind.stance[b.e], mind.targetOf(a.e)]).toEqual([STANCE_YOURS, STANCE_YOURS, -1]);

  // The wander and the stance are kept across a restart.
  expect(order(h, ada, a.e, ORDER_WANDER)).toBe(RESULT_OK);
  const pid = a.rec.pid;
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ents = h.world.ents;
  mind = h.host.creatures.mind;
  const again = h.host.records.byPid.get(pid)!;
  ada = h.join("ada");
  h.run(1500);
  const e2 = h.host.records.entOf.get(pid)!;
  expect([again.wander, again.stance, again.follow, mind.wanders[e2], mind.stance[e2], (ents.flags[e2]! & F_ALIVE) !== 0]).toEqual([true, STANCE_YOURS, 0, 1, STANCE_YOURS, true]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("an unclaimed young dodo follows the survivor nearest it within its sight, and once claimed follows only when told", () => {
  const { h, ada, g, at } = camp();
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  h.host.survival.gods.add(h.host.records.byPid.get(h.client(ada)!.pid)!.pid);
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(g.x + 36).toFixed(3)} ${(g.z + 26).toFixed(3)}`);
  const y = put(h, at.x, at.z + 9);
  const rec = recOf(h, y);
  rec.span = 1e6;
  rec.grown = h.world.tick + 1e6;
  ents.setYoung(y, rec.span, rec.grown);
  const gap = (s: ClientSession): number => Math.hypot(ents.x[y]! - ents.x[h.ent(s)]!, ents.z[y]! - ents.z[h.ent(s)]!);
  h.run(20000);
  expect([mind.leader[y], gap(ada) < 4]).toEqual([h.ent(ada), true]);
  // She goes beyond its sight, 20 m; Bob is near.
  h.say(ada, `tp ${(ents.x[y]! - 25).toFixed(3)} ${ents.z[y]!.toFixed(3)}`);
  h.say(bob, `tp ${(ents.x[y]! + 7).toFixed(3)} ${(ents.z[y]! + 1).toFixed(3)}`);
  h.run(20000);
  expect([mind.leader[y], gap(bob) < 4]).toEqual([h.ent(bob), true]);
  // Bob goes beyond its sight too, and it waits.
  h.say(ada, `tp ${(ents.x[y]! - 25).toFixed(3)} ${ents.z[y]!.toFixed(3)}`);
  h.say(bob, `tp ${(ents.x[y]! + 25).toFixed(3)} ${ents.z[y]!.toFixed(3)}`);
  h.run(1000);
  const [x, z] = [ents.x[y]!, ents.z[y]!];
  h.run(5000);
  expect([mind.leader[y], ents.x[y], ents.z[y]]).toEqual([-1, x, z]);
  // Claimed by her, it stays where it is until she says otherwise.
  h.say(ada, `tp ${(x - 6).toFixed(3)} ${z.toFixed(3)}`);
  h.run(2000);
  expect(h.host.breeding.claim(h.client(ada)!, rec)).toBe(RESULT_OK);
  const [cx, cz] = [ents.x[y]!, ents.z[y]!];
  h.run(8000);
  expect([mind.leader[y], Math.hypot(ents.x[y]! - cx, ents.z[y]! - cz) < 0.3]).toEqual([-1, true]);
});
