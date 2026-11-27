// What a stuck mover does besides choose a heading (server/decide/actions.ts, `nav.do`), beside today's code and beside
// the ladder without it, on seeded scenes (tests/fixtures/decide-scenes.ts).
import { expect, test } from "bun:test";
import type { Nav } from "../../server/decide/nav.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SCENES, blockerLeaves, decideBy, hashes } from "../fixtures/decide-scenes.ts";

const LADDER = "nav.snag=rule,nav.ring=rule";
const DO = `${LADDER},nav.do=rule`;

interface Seen {
  arrived: boolean;
  /** Ticks into the run at which the first mover first stood 2.5 m outside the middle of its pen; -1 for never. */
  out: number;
  /** The furthest the first mover strayed east or west of where it began, in metres. */
  aside: number;
  started: Record<string, number>;
  bites: number;
  /** Health of every piece in the world, before and after. */
  before: number;
  after: number;
  hashes: number[];
}

function health(s: ReturnType<(typeof SCENES)[string]>): number {
  let total = 0;
  for (const t of s.w.world.structs.chunks) if (t) for (let i = 0; i < t.high; i++) if (t.kind[i] !== 0) total += t.hp[i]!;
  return total;
}

/** Plays scene `name` decided by `way`; the trike of `blocker` walks off `leaves` ticks in. */
function run(name: string, way: string, leaves = 3 * TICK_RATE): Seen {
  const s = SCENES[name]!(1);
  try {
    decideBy(s.w, way);
    const mind = s.w.host.creatures.mind, ents = s.w.world.ents, e = s.movers[0]!;
    const x0 = ents.x[e]!, before = health(s);
    let out = -1, aside = 0;
    const h = hashes(s, (t) => {
      if (name === "blocker" && t === leaves) blockerLeaves(s);
      if (out < 0 && Math.max(Math.abs(ents.x[e]! - 128), Math.abs(ents.z[e]! - 128)) > 6 + 2.5) out = t;
      if (name === "blocker") aside = Math.max(aside, Math.abs(ents.x[e]! - x0));
    });
    const nav = mind.ladder as Nav;
    return { arrived: s.goal ? mind.arrived(e, 1.5) : false, out, aside, started: { ...nav.actions!.started }, bites: mind.bites, before, after: health(s), hashes: h };
  } finally {
    s.w.host.shutdown();
  }
}

test("a raptor penned by walls lower than its jump jumps out; today it stays in", () => {
  const today = run("lowPen", ""), ladder = run("lowPen", LADDER), acts = run("lowPen", DO);
  expect([today.out, today.arrived]).toEqual([-1, false]);
  // The ladder alone finds no way out of a closed pen.
  expect([ladder.out, ladder.arrived]).toEqual([-1, false]);
  expect(acts.started.jump).toBeGreaterThan(0);
  expect([acts.out > 0, acts.arrived]).toEqual([true, true]);
});

test("a stuck hunter bites through thatch to its prey, never through stone", () => {
  const today = run("walledPrey", ""), thatch = run("walledPrey", DO), stone = run("stonedPrey", DO);
  // Today it gives the hunt up at the wall and bites nothing.
  expect([today.bites, today.after]).toEqual([0, today.before]);
  expect(thatch.started.bite).toBeGreaterThan(0);
  expect(thatch.bites).toBeGreaterThan(10);
  expect(thatch.after).toBeLessThan(thatch.before);
  // A bite cannot harm stone, as today's rule at the prey's side has it: it is never tried.
  expect([stone.started.bite, stone.bites, stone.after]).toEqual([0, 0, stone.before]);
});

test("a raptor waits for a trike that is walking out of its way, and goes on", () => {
  // The trike sets off while the raptor is pressed behind it.
  const acts = run("blocker", DO, 1.5 * TICK_RATE);
  expect(acts.started.wait).toBeGreaterThan(0);
  expect(acts.arrived).toBe(true);
  // It stood its ground in line behind the trike rather than going round it.
  expect(acts.aside).toBeLessThan(1);
});

test("a raptor does not wait for a trike that stands in its way: it goes round", () => {
  const acts = run("blocker", DO);
  expect(acts.started.wait).toBe(0);
  expect(acts.arrived).toBe(true);
  expect(acts.aside).toBeGreaterThan(1);
});

test("with nav.do off or watched the ladder runs the same, to the bit", () => {
  for (const name of ["lowPen", "walledPrey", "blocker"]) {
    const off = run(name, `${LADDER},nav.do=off`), watch = run(name, `${LADDER},nav.do=watch`);
    expect([name, watch.hashes]).toEqual([name, off.hashes]);
  }
});
