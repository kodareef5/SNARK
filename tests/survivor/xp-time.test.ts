// Experience that comes with time (server/experience.ts): the drip to a living survivor, and to a tame near one of its tribe.
// A Harness leaves it out (tests/fixtures/net.ts), so each test here asks for it.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { DRIP_PER_MINUTE, DRIP_TICKS, SHARE_RANGE } from "../../server/experience.ts";
import { Rules } from "../../server/settings/rules.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { camp, creature, put, record, restart, survivor, tame, until } from "../kit/kit.ts";

const MINUTE = 60_000;
const DRIP = { GenericXPMultiplier: 1 };

test("a living survivor gains ARK's drip each minute, and its own screen has the fraction", () => {
  const { h, ada, me } = camp({ rules: DRIP });
  const xp = me.xp;
  h.run(MINUTE);
  expect(me.xp - xp).toBeCloseTo(DRIP_PER_MINUTE, 6);
  expect(DRIP_PER_MINUTE).toBe(0.66);
  h.run(500);
  expect(ada.progress.xp).toBeCloseTo(me.xp, 6);
});

test("GenericXPMultiplier and XPMultiplier multiply the drip, and 0 ends it", () => {
  const fast = camp({ rules: { GenericXPMultiplier: 5, XPMultiplier: 2 } });
  const xp = fast.me.xp;
  fast.h.run(MINUTE);
  expect(fast.me.xp - xp).toBeCloseTo(DRIP_PER_MINUTE * 10, 6);
  const none = camp({ rules: { GenericXPMultiplier: 0 } });
  none.h.run(MINUTE);
  expect(none.me.xp).toBe(0);
  // The server ships with it on.
  expect(new Rules().num("GenericXPMultiplier")).toBe(1);
});

test("a dead survivor gains nothing with time", () => {
  const { h, ada, me } = camp({ rules: DRIP });
  h.say(ada, "suicide");
  expect(me.dead).toBe(true);
  const xp = me.xp;
  h.run(MINUTE);
  expect(me.xp).toBe(xp);
});

test("a tame gains the drip only with a survivor of its tribe within 100 m; a wild creature never", () => {
  const { h, ada, at } = camp({ rules: DRIP });
  const near = tame(h, ada, "dodo");
  const far = tame(h, ada, "dodo", { at: { x: at.x + 6, z: at.z + 6 } });
  const wild = creature(h, "dodo", { x: at.x - 6, z: at.z + 6 });
  h.world.ents.x[far.e] = at.x + SHARE_RANGE + 20;
  for (const body of [near, far, wild]) h.host.creatures.mind.stay(body.e, h.world.tick + 120 * TICK_RATE);
  const was = [near.rec.xp, far.rec.xp, wild.rec.xp];
  h.run(MINUTE);
  expect(near.rec.xp - was[0]!).toBeCloseTo(DRIP_PER_MINUTE, 6);
  expect([far.rec.xp - was[1]!, wild.rec.xp - was[2]!]).toEqual([0, 0]);
});

test("each body has its own tick of the drip, so no tick gives it to all of them", () => {
  const { h, ada, at, me } = camp({ rules: DRIP });
  const bob = record(h, survivor(h, "bob", { at: { x: at.x + 3, z: at.z } }));
  const pets = [tame(h, ada, "dodo"), tame(h, ada, "dodo", { at: { x: at.x + 6, z: at.z + 6 } }), tame(h, ada, "dodo", { at: { x: at.x - 6, z: at.z + 6 } })];
  for (const pet of pets) h.host.creatures.mind.stay(pet.e, h.world.tick + 60 * TICK_RATE);
  const bodies = [me, bob, ...pets.map((pet) => pet.rec)];
  // The tick on which each gained, over one whole round of them.
  const when: number[][] = bodies.map(() => []);
  for (let t = 0; t < DRIP_TICKS; t++) {
    const was = bodies.map((rec) => rec.xp);
    h.server.tick();
    bodies.forEach((rec, i) => void (rec.xp > was[i]! && when[i]!.push(h.world.tick % DRIP_TICKS)));
  }
  // Once each in the round, on the tick its own record id names.
  expect(when).toEqual(bodies.map((rec) => [rec.pid % DRIP_TICKS]));
  expect(new Set(when.flat()).size).toBe(bodies.length);
});

test("the drip writes no record of its own, and is saved within the minute with where the body stands", () => {
  const { h, me } = camp({ rules: DRIP, save: true });
  const saved = (): number => h.host.persistence!.store.loadEntities().find((rec) => rec.pid === me.pid)?.xp ?? -1;
  h.run(2000);
  const dirty = h.host.records.dirty;
  // Over a round of the drip, the tick that gives it leaves her record as the tick before it did.
  let gained = 0;
  for (let t = 0; t < DRIP_TICKS; t++) {
    const was = me.xp;
    dirty.delete(me.pid);
    h.server.tick();
    if (me.xp > was) gained += dirty.has(me.pid) ? 100 : 1;
  }
  expect(gained).toBe(1);
  h.run(MINUTE);
  // The save has all but the last minute's.
  expect(me.xp - saved()).toBeLessThanOrEqual(DRIP_PER_MINUTE + 1e-9);
  expect(saved()).toBeGreaterThan(0);
});

test("a stationary tame keeps its last passive XP after sleeping and restarting", () => {
  const at = { x: 128, z: 128 };
  const { h, ada } = camp({ place: { map: writeMap(flatMap(8)), at: () => at }, rules: DRIP, save: true });
  const { rec, e } = tame(h, ada, "dodo");
  h.host.creatures.mind.stay(e, h.world.tick + 60 * TICK_RATE);
  h.run(2000);
  const savedXp = () => h.host.persistence!.store.loadEntities().find((r) => r.pid === rec.pid)?.xp;
  const before = rec.xp;
  expect(until(h, () => rec.xp > before && rec.xp !== savedXp(), 21)).toBe(true);
  const earned = rec.xp;
  const ents = h.world.ents;
  expect([rec.x, rec.y, rec.z]).toEqual([ents.x[e], ents.y[e], ents.z[e]]);
  put(h, ada, { x: 480, z: 480 });
  expect(h.host.creatures.isChunkAwake(ents.chunk[e]!)).toBe(false);
  const loaded = restart(h);
  try {
    expect(loaded.host.records.byPid.get(rec.pid)?.xp).toBe(earned);
  } finally {
    loaded.host.shutdown();
  }
});
