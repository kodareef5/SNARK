// The ladder's points one at a time (server/decide/nav.ts): what each asks, and what its answer does to the mover.
import { expect, test } from "bun:test";
import { SEARCH_CELLS } from "../../server/behavior.ts";
import type { Nav } from "../../server/decide/nav.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { scoreTable } from "../../shared/decide/forward.ts";
import type { Profile } from "../../shared/decide/profile.ts";
import { SURE } from "../../shared/decide/profiles.ts";
import { RULES } from "../../shared/decide/rules.ts";
import type { Table } from "../../shared/decide/table.ts";
import { HIT_NONE, castWorld } from "../../shared/world/ray.ts";
import { stateHash } from "../../tools/decide/world.ts";
import { SCENES, decideBy, hashes, type Scene } from "../fixtures/decide-scenes.ts";

const RULE = "nav.snag=rule,nav.ring=rule";
const rule = (p: Profile, t: Table): number => (scoreTable(RULES.find((m) => m.profile === p.name)!, p, t), 1);

/** The rule, but the first `doubt` questions of nav.sure answer no; how many it was asked is in `asked.n`. */
function doubting(doubt: number, asked: { n: number }) {
  return (p: Profile, t: Table): number => {
    rule(p, t);
    if (p === SURE && asked.n++ < doubt) t.score[0] = -10 - asked.n;
    return 1;
  };
}

test("a stuck pick nav.sure doubts is passed over for the next, twice at most", () => {
  const s = SCENES.corner!(1);
  try {
    decideBy(s.w, RULE);
    const nav = s.w.host.creatures.mind.ladder as Nav, ring = nav.ringPoint, e = s.movers[0]!, tick = s.w.world.tick;
    nav.enter(e, tick, 2);
    const asked = { n: 0 };
    const sure = ring.answer(e, tick, 2, doubting(0, asked));
    // Sure of the first pick, it asks once and keeps it.
    expect(asked.n).toBe(1);
    const once = { n: 0 }, next = ring.answer(e, tick, 2, doubting(1, once));
    expect([once.n, next !== sure]).toEqual([2, true]);
    // Doubting every pick, it looks at three and holds the surest of them, the first; the two passed over are marked tried.
    const all = { n: 0 }, kept = ring.answer(e, tick, 2, doubting(99, all));
    expect(kept).toBe(sure);
    ring.apply(e, tick, 2, kept);
    const tried = nav.describe(e)!.tried as number;
    expect([(tried >> sure) & 1, bits(tried)]).toEqual([0, 2]);
    // Wary, it is not asked.
    const wary = { n: 0 };
    nav.enter(e, tick, 1);
    ring.answer(e, tick + 100, 1, doubting(99, wary));
    expect(wary.n).toBe(0);
  } finally {
    s.w.host.shutdown();
  }
});

function bits(v: number): number {
  let n = 0;
  for (; v !== 0; v &= v - 1) n++;
  return n;
}

test("a patient raptor is let go the tick its points are turned off", () => {
  const T = 7 * TICK_RATE;
  /** The dead end under the rule to tick T; then `after` turns the decider away, and the world runs 20 s more. */
  const run = (after: (s: Scene) => void): { rung: number[]; hashes: number[]; at: { rung: number; held: number; slot: boolean; budget: number } } => {
    const s = SCENES.deadEnd!(1);
    try {
      decideBy(s.w, "*=rule");
      const mind = s.w.host.creatures.mind, e = s.movers[0]!, nav = mind.ladder as Nav;
      for (let t = 0; t < T; t++) s.w.tick();
      const rung = [mind.rung[e]!];
      after(s);
      const inner = mind as unknown as { searching: number; finder: { budget: number } };
      const at = { rung: mind.rung[e]!, held: nav.held(e, s.w.world.tick), slot: nav.describe(e) !== null, budget: inner.searching === e ? inner.finder.budget : 0 };
      const h: number[] = [];
      for (let t = 1; t <= 20 * TICK_RATE; t++) {
        s.w.tick();
        if (t % TICK_RATE === 0) h.push(stateHash(s.w.world));
      }
      rung.push(mind.rung[e]!);
      return { rung, hashes: h, at };
    } finally {
      s.w.host.shutdown();
    }
  };
  const off = run((s) => s.w.host.decide.set(""));
  const gone = run((s) => {
    // The decider taken away by hand: no ladder, nobody on it, and a search under way kept to an ordinary budget.
    const mind = s.w.host.creatures.mind as unknown as { decide: unknown; ladder: unknown; rung: Uint8Array; searching: number; finder: { budget: number } };
    mind.decide = null;
    mind.ladder = null;
    mind.rung.fill(0);
    if (mind.searching === s.movers[0] && mind.finder.budget > SEARCH_CELLS) mind.finder.budget = SEARCH_CELLS;
  });
  expect(off.rung[0]).toBe(3);
  expect(off.at).toEqual({ rung: 0, held: -1, slot: false, budget: off.at.budget });
  expect(off.at.budget).toBeLessThanOrEqual(SEARCH_CELLS);
  expect(off.hashes).toEqual(gone.hashes);
  expect(off.rung[1]).toBe(0);
});

/** Pins of every mover of scene `name` against something built or grown, over seeds 1 and 2, decided `way`. */
function pinsOnPieces(name: string, way: string): number {
  let pins = 0;
  for (const seed of [1, 2]) {
    const s = SCENES[name]!(seed);
    try {
      decideBy(s.w, way);
      const mind = s.w.host.creatures.mind, ents = s.w.world.ents, w = s.w.world, was = s.movers.map(() => 0);
      hashes(s, () => s.movers.forEach((e, k) => {
        const pinned = mind.pinned[e]! > 0 ? 1 : 0;
        if (pinned && !was[k]) {
          // A knee ray from its middle or either shoulder along its facing meets what it pressed on.
          const p = mind.walkerOf(e)!, a = (ents.yaw[e]! / 65536) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
          const y = w.hf.heightAt(ents.x[e]!, ents.z[e]!) + 0.3 * p.height;
          if ([-0.9, 0, 0.9].some((side) => castWorld(w, ents.x[e]! + dz * side * p.radius, y, ents.z[e]! - dx * side * p.radius, dx, 0, dz, p.radius + 0.5, true) !== HIT_NONE)) pins++;
        }
        was[k] = pinned;
      }));
    } finally {
      s.w.host.shutdown();
    }
  }
  return pins;
}

test("wanderers that look before they walk press into walls and trees far less", () => {
  const pen = [pinsOnPieces("pen", ""), pinsOnPieces("pen", "nav.probe=rule")];
  const wood = [pinsOnPieces("woodWander", ""), pinsOnPieces("woodWander", "nav.probe=rule")];
  expect(pen[1]!).toBeLessThan(pen[0]! / 3);
  expect(wood[1]!).toBeLessThan(wood[0]! * 0.65);
});

test("nav.reach says how likely a hunter is to catch its prey, lower as its time runs", () => {
  const seen = (way: string): number[] => {
    const s = SCENES.hunt!(1);
    try {
      decideBy(s.w, way);
      const mind = s.w.host.creatures.mind, out: number[] = [];
      hashes(s, (t) => t % (5 * TICK_RATE) === 0 && out.push(mind.reachOf(s.movers[0]!)));
      return out;
    } finally {
      s.w.host.shutdown();
    }
  };
  // Watched, it is asked and nothing is kept for anyone to read.
  expect(seen("nav.reach=watch").every((v) => v === -1)).toBe(true);
  const rule = seen("nav.snag=rule,nav.ring=rule,nav.reach=rule");
  expect(rule.every((v) => v > 0 && v <= 1)).toBe(true);
  expect(rule[rule.length - 1]!).toBeLessThan(rule[0]!);
});
