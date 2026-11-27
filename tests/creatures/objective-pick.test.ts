// Objectives and legs under the decider (server/decide/nav-pick.ts, nav-reach.ts, server/courses.ts): what nav.pick and
// nav.reach change for a mover with an objective or a course, and that off and watched they change nothing.
import { expect, test } from "bun:test";
import type { Nav } from "../../server/decide/nav.ts";
import { Reach } from "../../server/decide/nav-reach.ts";
import { pullAt, pullToward } from "../../server/decide/nav-pick.ts";
import { LEG_LEAST } from "../../server/courses.ts";
import type { Pin } from "../../server/pins.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { RING_FAR } from "../../shared/decide/profiles.ts";
import { COURSE_ONCE, course, type Objective, type Waypoint } from "../../shared/world/course.ts";
import { flatMap } from "../fixtures/map.ts";
import { hashes, wallX, wallZ } from "../fixtures/decide-scenes.ts";
import { lab, type Lab } from "../../tools/decide/world.ts";

const place = (x: number, z: number, priority = 1, radius = 1.5): Waypoint => ({ x, z, radius, kind: 0, priority, pull: 0 });
/** A team the movers of these scenes are put in, so the pins of it are theirs. */
const TEAM = 77;

/** A world with a player close to every mover, so its picks are priced by a way. */
function near(): Lab {
  const w = lab(flatMap(4), 1);
  w.host.creatures.mind.close?.fill(1);
  return w;
}

/** A raptor south of a U open to the north, with a choice inside the U near by line and another in the open further off. */
function walled(policy: string, back = false): { w: Lab; e: number; o: Objective } {
  const w = back ? lab(flatMap(4), 1) : near();
  wallX(w, 110, 146, 108);
  wallZ(w, 110, 108, 130);
  wallZ(w, 146, 108, 130);
  const e = w.host.spawnCreature("core:raptor", 128, 100, 1);
  w.world.ents.team[e] = TEAM;
  w.host.decide.set(policy);
  return { w, e, o: { choices: [{ place: place(128, 115), detour: false }, { place: place(150, 85), detour: false }] } };
}

/** The choices reached in turn, with the second each was reached at, within `seconds`. */
function walk(w: Lab, e: number, o: Objective, seconds: number): [number, number][] {
  const order: [number, number][] = [];
  const t0 = w.world.tick;
  w.host.courses.aim(e, o, { arrived: (_e, i) => void order.push([i, Math.round((w.world.tick - t0) / TICK_RATE)]) });
  for (let t = 0; t < seconds * TICK_RATE && w.host.courses.has(e); t++) w.tick();
  return order;
}

test("a choice near by line and far by way is left for later, where a player is near", () => {
  const today = walled("");
  const plain = walk(today.w, today.e, today.o, 120);
  today.w.host.shutdown();
  const ruled = walled("nav.pick=rule");
  const rule = walk(ruled.w, ruled.e, ruled.o, 120);
  ruled.w.host.shutdown();
  // With no player near, the pick is priced by sight and line alone, and goes as the plain pick does.
  const far = walled("nav.pick=rule", true);
  const unpriced = walk(far.w, far.e, far.o, 120);
  far.w.host.shutdown();
  expect(plain.map(([i]) => i)).toEqual([0, 1]);
  expect(rule.map(([i]) => i)).toEqual([1, 0]);
  expect(unpriced.map(([i]) => i)).toEqual([0, 1]);
  // Both finish; the rule is at its first choice sooner, and done no later.
  expect(rule[0]![1]).toBeLessThan(plain[0]![1]);
  expect(rule[1]![1]).toBeLessThanOrEqual(plain[1]![1]);
});

test("off and watched, an objective walks as with no decider, hashed every second", () => {
  const runs = ["detached", "", "nav.pick=watch,nav.reach=watch"].map((way) => {
    const s = walled(way === "detached" ? "" : way);
    if (way === "detached") {
      s.w.host.courses.pick = null;
      s.w.host.courses.reach = null;
      s.w.host.courses.legEnded = null;
      (s.w.host.creatures.mind as { decide: unknown }).decide = null;
    }
    s.w.host.courses.aim(s.e, s.o, {});
    const h = hashes({ w: s.w, movers: [s.e], ticks: 60 * TICK_RATE });
    const pick = s.w.host.decide.report().points.find((p) => p.name === "nav.pick")!.counts;
    s.w.host.shutdown();
    return { h, answered: pick.answered, applied: pick.applied };
  });
  expect(runs[1]!.h).toEqual(runs[0]!.h);
  expect(runs[2]!.h).toEqual(runs[0]!.h);
  expect([runs[1]!.answered, runs[2]!.answered > 0, runs[2]!.applied]).toEqual([0, true, 0]);
});

test("a pin that repels beside the nearer choice sends the rule to the other", () => {
  const go = (pin: boolean): number[] => {
    const w = lab(flatMap(4), 1);
    const e = w.host.spawnCreature("core:raptor", 128, 128, 1);
    w.world.ents.team[e] = TEAM;
    w.host.decide.set("nav.pick=rule");
    if (pin) w.host.pins.place(TEAM, 1, 128, 150, 1, true, "danger");
    const o: Objective = { choices: [{ place: place(128, 140), detour: false }, { place: place(128, 100), detour: false }] };
    const order = walk(w, e, o, 90).map(([i]) => i);
    w.host.shutdown();
    return order;
  };
  expect(go(false)).toEqual([0, 1]);
  expect(go(true)).toEqual([1, 0]);
});

test("the rule takes a detour worth its seconds off the way, and not one behind a wall", () => {
  const go = (wall: boolean): number[] => {
    const w = near();
    // Off the way by 9 m: past the plain look aside's slack, an extra few seconds by the open way.
    if (wall) wallZ(w, 133, 100, 172);
    const e = w.host.spawnCreature("core:raptor", 128, 110, 1);
    w.host.decide.set("nav.pick=rule");
    const o: Objective = { choices: [{ place: place(128, 160), detour: false }, { place: place(137, 135, 1, 1), detour: true }] };
    const order = walk(w, e, o, 90).map(([i]) => i);
    w.host.shutdown();
    return order;
  };
  expect(go(false)).toEqual([1, 0]);
  expect(go(true)).toEqual([0]);
});

/** A raptor beside a sealed room, on a course into it and then out to the yard. */
function sealed(policy: string): { w: Lab; e: number; failed: [number, number][]; arrived: number[] } {
  const w = lab(flatMap(4), 1);
  wallX(w, 120, 136, 120);
  wallX(w, 120, 136, 136);
  wallZ(w, 120, 120, 136);
  wallZ(w, 136, 120, 136);
  const e = w.host.spawnCreature("core:raptor", 150, 128, 1);
  w.host.decide.set(policy);
  const failed: [number, number][] = [], arrived: number[] = [];
  const t0 = w.world.tick;
  w.host.courses.give(e, course([place(128, 128), place(160, 128)], COURSE_ONCE), {
    failed: (_e, at) => void failed.push([at, Math.round((w.world.tick - t0) / TICK_RATE)]),
    arrived: (_e, at) => void arrived.push(at),
  });
  return { w, e, failed, arrived };
}

test("a leg nav.reach doubts is given up early, told, and the next walked", () => {
  const today = sealed("");
  for (let t = 0; t < 60 * TICK_RATE; t++) today.w.tick();
  expect(today.failed).toEqual([]);
  today.w.host.shutdown();
  const ruled = sealed("nav.reach=rule");
  for (let t = 0; t < 60 * TICK_RATE && ruled.arrived.length === 0; t++) ruled.w.tick();
  ruled.w.host.shutdown();
  expect(ruled.failed.length).toBe(1);
  expect(ruled.failed[0]![0]).toBe(0);
  expect(ruled.failed[0]![1]).toBeLessThan(LEG_LEAST / 4);
  expect(ruled.arrived).toEqual([1]);
});

test("nav.reach judges a leg at its own deadline, and a leg reached as reached", () => {
  const w = lab(flatMap(4), 1);
  const e = w.host.spawnCreature("core:raptor", 128, 128, 1);
  w.host.decide.set("nav.reach=rule");
  const reach = w.host.creatures.mind.reacher as Reach;
  expect(reach).toBeInstanceOf(Reach);
  const arrived: number[] = [];
  w.host.courses.give(e, course([place(128, 140), place(128, 110)], COURSE_ONCE), { arrived: (_e, at) => void arrived.push(at) });
  w.tick();
  const asked = w.world.tick, ends = w.host.courses.legEnds(e);
  expect(ends).toBeGreaterThan(asked + LEG_LEAST * TICK_RATE - 5);
  // The deadline is the leg's, not a fixed 30 s.
  expect(Math.abs(reach.point.due!(e, asked) - ends)).toBeLessThanOrEqual(2);
  for (let t = 0; t < 30 * TICK_RATE && arrived.length === 0; t++) w.tick();
  expect(arrived).toEqual([0]);
  w.tick();
  const out = new Float32Array(8);
  // Now on the next leg, the answer given on the first reads that the first was reached.
  reach.point.outcome!(e, w.world.tick, out, asked);
  expect(out[0]).toBe(1);
  w.host.shutdown();
});

test("a pin's pull reaches the far pass of a tame of its tribe on the ladder", () => {
  const pins: Pin[] = [{ id: 1, x: 10, z: 0, radius: 5, kind: 1, priority: 5, pull: -1, label: "", author: 1, shared: true, at: 0, expires: 0 }];
  const v = { x: 0, z: 0 };
  pullToward(pins, 0, 0, v);
  // Away from a pin that repels, a half at twice its radius.
  expect([v.x, v.z]).toEqual([-0.5, 0]);
  expect(pullAt(pins, place(12, 0))).toBe(-1);
  expect(pullAt(pins, place(30, 0))).toBe(0);

  const w = lab(flatMap(4), 1);
  wallX(w, 116, 140, 116);
  wallX(w, 116, 140, 140);
  wallZ(w, 116, 116, 140);
  wallZ(w, 140, 116, 140);
  const e = w.host.spawnCreature("core:raptor", 128, 128, 1);
  w.world.ents.team[e] = TEAM;
  w.host.pins.place(TEAM, 1, 150, 128, 1, true, "");
  w.host.decide.set("nav.snag=rule,nav.ring=rule");
  w.host.decide.look(0, 1 << 30);
  w.host.creatures.mind.goTo(e, 128, 160, 2);
  let far: { rows: number[]; k: number } | undefined;
  for (let t = 0; t < 20 * TICK_RATE && !far; t++) {
    w.tick();
    far = w.host.decide.recent.flatMap((r) => r.tables).find((tb) => tb.profile === RING_FAR.name);
  }
  expect(far).toBeDefined();
  const k = far!.k, width = RING_FAR.columns.length, pull = RING_FAR.c.pull;
  // Heading 0 is north (+z) and they count clockwise from above, so a quarter round is east (+x), toward the pin.
  expect(far!.rows[(k / 4) * width + pull]!).toBeLessThan(-0.2);
  expect(far!.rows[((3 * k) / 4) * width + pull]!).toBeGreaterThan(0.2);
  expect((w.host.creatures.mind.ladder as Nav).rings.pullOf).not.toBeNull();
  w.host.shutdown();
});

test("a mover the rule sent elsewhere goes back to the plain pick when the rule is turned off", () => {
  const s = walled("nav.pick=rule");
  s.w.host.courses.aim(s.e, s.o, {});
  for (let t = 0; t < 2 * TICK_RATE; t++) s.w.tick();
  expect(s.w.host.courses.making(s.e)).toBe(1);
  s.w.host.decide.set("");
  s.w.tick();
  expect(s.w.host.courses.making(s.e)).toBe(0);
  s.w.host.shutdown();
});
