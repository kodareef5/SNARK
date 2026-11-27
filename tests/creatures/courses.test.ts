// Courses (server/courses.ts): tames ordered to a pin, to where their owner looks, and round pins in order; how other
// orders, removed pins, walls, whistle range and a restart end or keep them; and a runner that costs nothing idle.

import { expect, test } from "bun:test";
import { orderMove, orderPatrol } from "../../client/core/courses.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { GOAL_NONE, GOAL_WALK } from "../../server/behavior.ts";
import { LEG_LEAST, ORDERED, REACH_LOW_TICKS, legSeconds } from "../../server/courses.ts";
import { PIN_REACH, lookPlace } from "../../server/pins.ts";
import type { EntityRecord } from "../../server/records.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { CMD_ORDER, ORDER_ALL, ORDER_FOLLOW, ORDER_MOVE, ORDER_PATROL, ORDER_STAY, ORDER_WANDER } from "../../shared/net/protocol.ts";
import { COURSE_ONCE, course, type Objective, type Waypoint } from "../../shared/world/course.ts";
import type { Harness } from "../fixtures/net.ts";
import { MIDDLE, camp, record, restart, room, survivor } from "../kit/kit.ts";

/** Ada with cheats on the field, and a way to give her a tame raptor at a spot. */
function ground(o: Parameters<typeof camp>[0] = {}) {
  const c = camp({ god: true, ...o });
  return { ...c, tame: (x: number, z: number, owner: EntityRecord = c.me) => tameAt(c.h, owner, x, z) };
}

function tameAt(h: Harness, owner: EntityRecord, x: number, z: number, species = "core:raptor"): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(species, x, z, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  expect(h.host.taming.give(rec, owner, 0.9, "forced")).toBe(true);
  return { e, rec };
}

/** A pin of kind go for `rec`'s team at (x, z), counted reached within `radius` metres. */
function pin(h: Harness, rec: EntityRecord, x: number, z: number, radius = 1.5, label = "") {
  const p = h.host.pins.place(rec.team, rec.pid, x, z, 0, true, label);
  p.radius = radius;
  return p;
}

const flat = (h: Harness, e: number, x: number, z: number): number => Math.hypot(h.world.ents.x[e]! - x, h.world.ents.z[e]! - z);
const order = (s: ClientSession, which: number, what: number): number => s.command(CMD_ORDER, (w) => (w.u32(which >>> 0), w.u8(what)));

/** The points a mover made for, in turn, sampled every 100 ms for `ms`. */
function legs(h: Harness, e: number, ms: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    h.run(100);
    const at = h.host.courses.of(e)?.at ?? -1;
    if (out.at(-1) !== at) out.push(at);
  }
  return out;
}

test("a tame ordered to a pin walks there and stays", () => {
  const { h, ada, me, at, tame } = ground();
  const t = tame(at.x + 2, at.z);
  const p = pin(h, me, at.x + 2, at.z + 25);
  orderMove(ada, t.e, p.id);
  h.run(15000);
  expect(flat(h, t.e, p.x, p.z)).toBeLessThan(1.5);
  expect(t.rec.part(ORDERED)).toMatchObject({ what: ORDER_MOVE, pins: [p.id] });
  h.run(3000);
  expect(flat(h, t.e, p.x, p.z)).toBeLessThan(1.5);
  expect(h.host.courses.has(t.e)).toBe(false);
});

test("a tame ordered to where its owner looks goes where the server's own ray meets the ground", () => {
  const { h, ada, at, tame } = ground();
  const t = tame(at.x + 2, at.z);
  const pilot = h.pilots[h.sessions.indexOf(ada)]!;
  pilot.yaw = 0;
  pilot.pitch = -Math.atan2(1.6, 18);
  h.run(500);
  const looked = { x: 0, z: 0 };
  expect(lookPlace(h.world, h.ent(ada), PIN_REACH, looked)).toBe(true);
  expect(looked.z - at.z).toBeGreaterThan(10);
  orderMove(ada, t.e, 0);
  h.run(12000);
  const o = t.rec.part(ORDERED)!;
  expect([o.what, o.pins.length]).toEqual([ORDER_MOVE, 0]);
  expect(Math.hypot(o.x - looked.x, o.z - looked.z)).toBeLessThan(0.05);
  expect(flat(h, t.e, looked.x, looked.z)).toBeLessThan(2);
  // Looking at the sky, there is nowhere to go.
  pilot.pitch = 1.2;
  h.run(300);
  orderMove(ada, t.e, 0);
  h.run(300);
  expect(t.rec.part(ORDERED)!.x).toBe(o.x);
});

test("a patrol of three pins is walked in order, round as a loop and back and forth", () => {
  const { h, ada, me, at, tame } = ground();
  const ps = [pin(h, me, at.x, at.z + 12), pin(h, me, at.x + 14, at.z + 22), pin(h, me, at.x - 14, at.z + 22)];
  const loop = tame(at.x + 1, at.z);
  const back = tame(at.x - 1, at.z);
  orderPatrol(ada, loop.e, ps.map((p) => p.id), false);
  orderPatrol(ada, back.e, ps.map((p) => p.id), true);
  h.run(100);
  expect(back.rec.part(ORDERED)).toMatchObject({ what: ORDER_PATROL, back: true, pins: ps.map((p) => p.id) });
  const seen = { loop: [] as number[], back: [] as number[] };
  for (let t = 0; t < 600; t++) {
    h.run(100);
    for (const [name, m] of [["loop", loop], ["back", back]] as const) {
      const now = h.host.courses.of(m.e)?.at ?? -1;
      if (seen[name].at(-1) !== now) seen[name].push(now);
    }
    if (seen.loop.length >= 6 && seen.back.length >= 6) break;
  }
  expect(seen.loop.slice(0, 6)).toEqual([0, 1, 2, 0, 1, 2]);
  expect(seen.back.slice(0, 6)).toEqual([0, 1, 2, 1, 0, 1]);
});

test("follow, stay and wander each end a patrol at once, and its goal with it", () => {
  const { h, ada, me, at, tame } = ground();
  const ps = [pin(h, me, at.x, at.z + 20), pin(h, me, at.x + 20, at.z + 20)];
  const mind = h.host.creatures.mind;
  for (const what of [ORDER_FOLLOW, ORDER_STAY, ORDER_WANDER]) {
    const t = tame(at.x + 2, at.z);
    orderPatrol(ada, t.e, ps.map((p) => p.id), false);
    h.run(1000);
    expect([h.host.courses.has(t.e), mind.goalPace[t.e]]).toEqual([true, GOAL_WALK]);
    order(ada, t.e, what);
    h.run(200);
    expect([h.host.courses.has(t.e), mind.goalPace[t.e], t.rec.part(ORDERED)!.what]).toEqual([false, GOAL_NONE, 0]);
  }
});

test("a removed pin ends a move to it, and a patrol walks on by the pins left", () => {
  const { h, ada, me, at, tame } = ground();
  const mind = h.host.creatures.mind;
  const goal = pin(h, me, at.x, at.z + 40);
  const mover = tame(at.x + 2, at.z);
  orderMove(ada, mover.e, goal.id);
  h.run(1000);
  expect(h.host.courses.has(mover.e)).toBe(true);
  h.host.pins.remove(me.team, goal.id);
  h.run(1500);
  expect([h.host.courses.has(mover.e), mind.goalPace[mover.e], mover.rec.part(ORDERED)!.what]).toEqual([false, GOAL_NONE, 0]);

  const ps = [pin(h, me, at.x, at.z + 12), pin(h, me, at.x + 14, at.z + 22), pin(h, me, at.x - 14, at.z + 22)];
  const walker = tame(at.x - 2, at.z);
  orderPatrol(ada, walker.e, ps.map((p) => p.id), false);
  h.run(500);
  h.host.pins.remove(me.team, ps[1]!.id);
  const seen = legs(h, walker.e, 40000);
  expect(walker.rec.part(ORDERED)!.pins).toEqual([ps[0]!.id, ps[2]!.id]);
  expect(seen.slice(0, 4)).toEqual([0, 1, 0, 1]);
  // With every pin gone the patrol ends, and it stays where it is.
  h.host.pins.remove(me.team, ps[0]!.id);
  h.host.pins.remove(me.team, ps[2]!.id);
  h.run(1500);
  expect([h.host.courses.has(walker.e), mind.goalPace[walker.e], walker.rec.part(ORDERED)!.what]).toEqual([false, GOAL_NONE, 0]);
});

test("a leg into a sealed room is given up after its time, the next is taken, and the orderer is told", () => {
  const { h, ada, me } = ground({ place: room() });
  const inside = pin(h, me, MIDDLE.x, MIDDLE.z, 1, "the vault");
  const outside = pin(h, me, MIDDLE.x + 22, MIDDLE.z, 1.5, "yard");
  const t = tameAt(h, me, MIDDLE.x + 12, MIDDLE.z);
  orderPatrol(ada, t.e, [inside.id, outside.id], false);
  h.run(500);
  const ticks = Math.round(legSeconds(12, h.reg.tamedMove[t.rec.kind]!.walkSpeed) * TICK_RATE);
  expect(ticks).toBe(LEG_LEAST * TICK_RATE);
  h.run(((ticks - 3 * TICK_RATE) * 1000) / TICK_RATE);
  expect(h.host.courses.of(t.e)!.at).toBe(0);
  expect(flat(h, t.e, MIDDLE.x, MIDDLE.z)).toBeGreaterThan(2.5);
  h.run(5000);
  expect(h.host.courses.of(t.e)!.at).toBe(1);
  expect(h.host.tameOrders.missed).toBe(1);
  expect(ada.log.some((l) => l.text.includes("could not find a way to the vault"))).toBe(true);
});

test("ORDER_ALL reaches only the orderer's tribe's tames in whistle range", () => {
  const { h, ada, me, at, tame } = ground();
  const bob = survivor(h, "bob", { at: { x: at.x + 4, z: at.z } });
  const near = [tame(at.x + 3, at.z + 2), tame(at.x - 3, at.z + 2)];
  const far = tame(at.x + 60, at.z);
  const bobs = tame(at.x, at.z + 4, record(h, bob));
  const p = pin(h, me, at.x, at.z + 20);
  orderMove(ada, ORDER_ALL, p.id);
  h.run(300);
  expect([...near, far, bobs].map((t) => h.host.courses.has(t.e))).toEqual([true, true, false, false]);
  // Bob may not send his tame to Ada's pin.
  orderMove(bob, bobs.e, p.id);
  h.run(300);
  expect(h.host.courses.has(bobs.e)).toBe(false);
});

test("a patrol is taken up again by a body made again and after a restart", () => {
  const g = ground({ save: true });
  const { ada, me, at, tame } = g;
  let h = g.h;
  const ps = [pin(h, me, at.x, at.z + 15), pin(h, me, at.x + 15, at.z + 15)];
  const t = tame(at.x + 2, at.z);
  orderPatrol(ada, t.e, ps.map((p) => p.id), true);
  h.run(500);
  h.host.creatures.remove(t.e);
  expect(h.host.courses.has(t.e)).toBe(false);
  const again = h.host.creatures.adopt(t.rec);
  expect(h.host.courses.of(again)?.points.map((p) => p.x)).toEqual(ps.map((p) => p.x));
  h.run(1000);
  const pid = t.rec.pid;
  h = restart(h);
  const rec = h.host.records.byPid.get(pid)!;
  const e = h.host.records.entOf.get(pid)!;
  expect(rec.part(ORDERED)).toMatchObject({ what: ORDER_PATROL, back: true, pins: ps.map((p) => p.id) });
  const c = h.host.courses.of(e)!;
  expect([c.points.map((p) => [p.x, p.z]), c.mode]).toEqual([ps.map((p) => [p.x, p.z]), 2]);
  h.host.shutdown();
});

test("the runner steps only movers with a course, and costs nothing with none", () => {
  const { h, ada, me, at, tame } = ground();
  const courses = h.host.courses;
  const t = tame(at.x + 2, at.z);
  tame(at.x - 2, at.z);
  h.run(2000);
  expect([courses.stepped, courses.count]).toEqual([0, 0]);
  orderMove(ada, t.e, pin(h, me, at.x, at.z + 30).id);
  h.run(100);
  const from = courses.stepped;
  h.run(1000);
  expect(courses.stepped - from).toBe(TICK_RATE);
});

test("a flyer is refused a course with a plain reason", () => {
  const { h, ada, me, at } = ground();
  const ptera = tameAt(h, me, at.x + 3, at.z, "core:pteranodon");
  expect(h.host.courses.refuse(ptera.e)).toContain("flyer");
  orderMove(ada, ptera.e, pin(h, me, at.x, at.z + 20).id);
  h.run(300);
  expect([h.host.courses.has(ptera.e), ptera.rec.part(ORDERED)?.what ?? 0]).toEqual([false, 0]);
});

test("a reach under its floor for five seconds gives a leg up early", () => {
  const { h, me, at, tame } = ground();
  const courses = h.host.courses;
  const t = tame(at.x + 2, at.z);
  const failed: number[] = [];
  courses.reach = () => 0.1;
  courses.give(t.e, course([pin(h, me, at.x, at.z + 60), pin(h, me, at.x, at.z + 61)], COURSE_ONCE), { failed: (_e, i) => void failed.push(i) });
  h.run(((REACH_LOW_TICKS - 10) * 1000) / TICK_RATE);
  expect(failed).toEqual([]);
  h.run(1000);
  expect(failed).toEqual([0]);
  courses.reach = null;
  expect(courses.of(t.e)!.at).toBe(1);
});

/** A place to make for, by Waypoint's fields. */
const place = (x: number, z: number, priority: number, radius = 1.5): Waypoint => ({ x, z, radius, kind: 0, priority, pull: 0 });

test("an objective goes to the highest priority, then the nearest, picking again from what is left", () => {
  const { h, at, tame } = ground();
  const t = tame(at.x, at.z);
  const o: Objective = { choices: [{ place: place(at.x + 6, at.z + 6, 1), detour: false }, { place: place(at.x - 12, at.z + 12, 3), detour: false }, { place: place(at.x + 18, at.z + 18, 1), detour: false }] };
  const order: number[] = [];
  let ended = 0;
  expect(h.host.courses.aim(t.e, o, { arrived: (_e, i) => void order.push(i), ended: () => void ended++ })).toBe("");
  h.run(40000);
  expect([order, ended]).toEqual([[1, 0, 2], 1]);
});

test("a detour near the way is visited once on the way, and a picker that acts chooses", () => {
  const { h, at, tame } = ground();
  const courses = h.host.courses;
  const t = tame(at.x, at.z);
  const o: Objective = { choices: [{ place: place(at.x, at.z + 30, 1), detour: false }, { place: place(at.x + 3, at.z + 14, 0, 1), detour: true }, { place: place(at.x + 40, at.z + 14, 0, 1), detour: true }] };
  const order: number[] = [];
  courses.aim(t.e, o, { arrived: (_e, i) => void order.push(i) });
  h.run(25000);
  expect(order).toEqual([1, 0]);

  const u = tame(at.x - 4, at.z);
  const picks: number[] = [];
  // Asked, it sends the mover for the last choice still open.
  courses.pick = {
    on: () => true,
    acts: () => true,
    ask: (e) => {
      const o = courses.objectiveOf(e)!, open = o.choices.map((_c, i) => i).filter((i) => courses.open(e, i));
      picks.push(open.length);
      courses.take(e, open.at(-1)!, -1);
    },
  };
  const near = { choices: [{ place: place(at.x - 4, at.z + 5, 5), detour: false }, { place: place(at.x - 4, at.z + 12, 0), detour: false }] };
  const went: number[] = [];
  courses.aim(u.e, near, { arrived: (_e, i) => void went.push(i) });
  h.run(15000);
  courses.pick = null;
  expect([went, picks]).toEqual([[1, 0], [2, 1]]);
});
