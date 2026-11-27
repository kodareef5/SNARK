// The stuck ladder (server/decide/nav.ts) under the hand rule, beside today's code on the same seeded scenes
// (tests/fixtures/decide-scenes.ts): movers that are snagged, stuck or told there is no way get out.
import { expect, test } from "bun:test";
import { MIND_FLEE, MIND_HUNT } from "../../server/behavior.ts";
import type { Nav } from "../../server/decide/nav.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { scoreTable } from "../../shared/decide/forward.ts";
import { RULES } from "../../shared/decide/rules.ts";
import { SCENES, blockerLeaves, decideBy, hashes, type Scene } from "../fixtures/decide-scenes.ts";

const RULE = "nav.snag=rule,nav.ring=rule";
const ways = ["off", RULE] as const;

interface Seen {
  /** Ticks into the run at which the first mover arrived, first stood in water, first reached the patient rung; -1 for never. */
  arrived: number;
  wet: number;
  patient: number;
  /** The longest run of ticks the first mover stood still short of its goal. */
  stood: number;
  /** For every mover: ticks stuck or pinned, and times it began to be stuck, pinned, or turning from a wall. */
  troubled: number;
  starts: number;
  /** The first mover at the end: where, its mind, and how fast it went. */
  x: number;
  z: number;
  mind: number;
  speed: number;
  s: Scene;
}

/** Runs scene `name` decided `way`, calling `each` after every tick, and keeps the scene open for the caller to read. */
function run(name: string, way: string, each?: (s: Scene, t: number) => void): Seen {
  const s = SCENES[name]!(1);
  decideBy(s.w, way);
  const mind = s.w.host.creatures.mind, ents = s.w.world.ents, hf = s.w.world.hf, e = s.movers[0]!;
  const seen: Seen = { arrived: -1, wet: -1, patient: -1, stood: 0, troubled: 0, starts: 0, x: 0, z: 0, mind: 0, speed: 0, s };
  const was = s.movers.map(() => [0, 0, 0]);
  let still = 0;
  hashes(s, (t) => {
    each?.(s, t);
    const x = ents.x[e]!, z = ents.z[e]!;
    if (seen.arrived < 0 && s.goal && mind.arrived(e, 1.5)) seen.arrived = t;
    if (seen.wet < 0 && hf.waterAt(x, z) - hf.heightAt(x, z) > 0.1) seen.wet = t;
    if (seen.patient < 0 && mind.rung[e]! >= 3) seen.patient = t;
    still = Math.hypot(ents.vx[e]!, ents.vz[e]!) < 0.2 && seen.arrived < 0 ? still + 1 : 0;
    seen.stood = Math.max(seen.stood, still);
    s.movers.forEach((m, k) => {
      const now = [mind.stuck[m]! > 0 ? 1 : 0, mind.pinned[m]! > 0 ? 1 : 0, mind.leaving[m]!];
      if (now[0] || now[1]) seen.troubled++;
      for (let j = 0; j < 3; j++) if (now[j] && !was[k]![j]) seen.starts++;
      was[k] = now;
    });
  });
  Object.assign(seen, { x: ents.x[e]!, z: ents.z[e]!, mind: mind.mind[e]!, speed: Math.hypot(ents.vx[e]!, ents.vz[e]!) });
  return seen;
}

/** Each way of deciding scene `name`, closed after. */
function both(name: string, each?: (s: Scene, t: number) => void): [Seen, Seen] {
  return ways.map((way) => {
    const seen = run(name, way, each);
    seen.s.w.host.shutdown();
    return seen;
  }) as [Seen, Seen];
}

test("a raptor behind a U-shaped dead end arrives; today it stands at the wall", () => {
  const [today, rule] = both("deadEnd");
  // Today its search runs out inside the U, it follows the way that ends short to the wall and stands there.
  expect([today.arrived, today.z > 296 && today.z < 300]).toEqual([-1, true]);
  expect(rule.arrived).toBeGreaterThan(0);
});

test("wanderers in a wood are stuck, pinned and turning from trees far less", () => {
  const [today, rule] = both("woodWander");
  expect(rule.troubled).toBeLessThan(today.troubled / 3);
  expect(rule.starts).toBeLessThan(today.starts / 2);
});

test("a stuck raptor keeps dry until the patient rung, then soon wades out", () => {
  const [today, rule] = both("wet");
  // Today: no way the search can take, so it stands at the north wall the whole time.
  expect([today.arrived, today.wet, today.patient]).toEqual([-1, -1, -1]);
  expect(rule.patient).toBeGreaterThan(0);
  expect(rule.wet).toBeGreaterThan(rule.patient);
  // It backs out the way it came in, which leads into the water, rather than circling the pen.
  expect(rule.wet - rule.patient).toBeLessThan(5 * TICK_RATE);
  expect(rule.arrived).toBeGreaterThan(rule.wet);
});

test("wanderers in a pen are stuck less often, and far less long", () => {
  const [today, rule] = both("pen");
  expect(rule.starts).toBeLessThanOrEqual(today.starts);
  expect(rule.troubled).toBeLessThan(today.troubled / 5);
});

test("tame wanderers in a wood hold the ladder's headings as wild ones do", () => {
  const [today, rule] = both("ownedWander");
  expect(rule.troubled).toBeLessThan(today.troubled / 3);
  expect(rule.starts).toBeLessThan(today.starts / 3);
});

test("a raptor held up by a trike that walks off goes on and never stands long", () => {
  const [today, rule] = both("blocker", (s, t) => t === 3 * TICK_RATE && blockerLeaves(s));
  for (const seen of [today, rule]) {
    expect(seen.arrived).toBeGreaterThan(0);
    expect(seen.stood).toBeLessThan(2 * TICK_RATE);
  }
});

test("a cached far ring turns with the world, not the mover, round a corner", () => {
  const s = SCENES.corner!(1);
  try {
    decideBy(s.w, RULE);
    const mind = s.w.host.creatures.mind, ents = s.w.world.ents, e = s.movers[0]!;
    const nav = mind.ladder as Nav, ring = nav.ringPoint;
    const ask = (p: Parameters<typeof scoreTable>[1], t: Parameters<typeof scoreTable>[2]): number => (scoreTable(RULES.find((m) => m.profile === p.name)!, p, t), 1);
    const goal = s.goal!, k = nav.k;
    const tick = s.w.world.tick;
    nav.enter(e, tick, 1);
    const column = (): number[] => Array.from({ length: k }, (_, i) => ring.tables[0]!.table.rows[i * 9]!);
    ring.answer(e, tick, 1, ask);
    const filled = column();
    // It turns a quarter, then a half, and edges along the wall, all within the far ring's life.
    for (const [turn, dt] of [[16384, 10], [32768, 20], [49152, 30]] as const) {
      ents.yaw[e] = (ents.yaw[e]! + turn) & 0xffff;
      ents.x[e] = ents.x[e]! + 0.2;
      const pick = ring.answer(e, tick + dt, 1, ask);
      expect(nav.farFilled(e)).toBe(tick);
      expect(column()).toEqual(filled);
      // The heading chosen still leads toward the goal, however the mover now faces.
      const a = (pick / k) * Math.PI * 2;
      expect(Math.sin(a) * (goal.x - ents.x[e]!) + Math.cos(a) * (goal.z - ents.z[e]!)).toBeGreaterThan(0);
    }
  } finally {
    s.w.host.shutdown();
  }
  const [today, rule] = both("corner");
  expect([today.arrived > 0, rule.arrived > 0]).toEqual([true, true]);
});

test("no mover ends a scene standing short of its goal", () => {
  for (const name of ["pastWall", "deadEnd", "woodGoals", "wet", "blocker", "corner"]) {
    // Where each mover was a second before the end: one that has not arrived must have moved since.
    const last: number[] = [];
    const seen = run(name, RULE, (s, t) => {
      if (name === "blocker" && t === 3 * TICK_RATE) blockerLeaves(s);
      if (t === s.ticks - TICK_RATE) for (const e of s.movers) last.push(s.w.world.ents.x[e]!, s.w.world.ents.z[e]!);
    });
    try {
      const mind = seen.s.w.host.creatures.mind, ents = seen.s.w.world.ents;
      const movers = name === "blocker" ? seen.s.movers.slice(0, 1) : seen.s.movers;
      movers.forEach((e, k) => {
        const moved = Math.hypot(ents.x[e]! - last[2 * k]!, ents.z[e]! - last[2 * k + 1]!);
        expect([name, e, mind.arrived(e, 1.5) || moved > 0.5]).toEqual([name, e, true]);
      });
    } finally {
      seen.s.w.host.shutdown();
    }
  }
});

test("a hunter whose search comes back short keeps after its prey", () => {
  const near: number[][] = [[], []];
  const minds: number[][] = [[], []];
  let way = 0;
  const [today, rule] = ways.map((w, i) => {
    way = i;
    const seen = run("hunt", w, (s, t) => {
      if (t % TICK_RATE !== 0) return;
      const ents = s.w.world.ents, e = s.movers[0]!, prey = s.prey!;
      near[way]!.push(Math.hypot(ents.x[e]! - ents.x[prey]!, ents.z[e]! - ents.z[prey]!));
      minds[way]!.push(s.w.host.creatures.mind.mind[e]!);
    });
    seen.s.w.host.shutdown();
    return seen;
  });
  // Today it runs from the prey within its first seconds.
  expect(minds[0]!.slice(0, 5)).toContain(MIND_FLEE);
  expect(today.mind).not.toBe(MIND_HUNT);
  // Under the rule it is still hunting at the end, and never more than its sight from the prey.
  expect(minds[1]!.every((m) => m === MIND_HUNT)).toBe(true);
  expect(Math.max(...near[1]!)).toBeLessThan(30);
  expect(rule.mind).toBe(MIND_HUNT);
  // Its nose caught in the narrow slot, it backs out rather than stand pressing there.
  expect(rule.stood).toBeLessThan(2 * TICK_RATE);
});
