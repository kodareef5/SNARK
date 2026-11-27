// The decider's points (server/decide/nav.ts and the rest) change nothing until they act: with every point off, or only
// watched, a world moves as one with no decider at all, to the bit, every second of the way.
import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { SCENES, blockerLeaves, decideBy, hashes } from "../fixtures/decide-scenes.ts";

const NAMES = ["pen", "pastWall", "deadEnd", "woodGoals", "hunt", "flight", "woodWander", "ownedWander", "wet", "blocker", "lowPen", "walledPrey", "stonedPrey"];
/** Seconds of each scene compared, at most. */
const SECONDS = 40;
/** Questions answered while watched, by point, over every scene. */
const watched: Record<string, number> = {};

for (const name of NAMES) {
  test(`${name}: off and watched run as with no decider, hashed every second`, () => {
    const runs = ["detached", "off", "watch"].map((way) => {
      const s = SCENES[name]!(1);
      try {
        decideBy(s.w, way);
        s.ticks = Math.min(s.ticks, SECONDS * TICK_RATE);
        const h = hashes(s, (t) => name === "blocker" && t === 3 * TICK_RATE && blockerLeaves(s));
        if (way === "watch") for (const p of s.w.host.decide.report().points) watched[p.name] = (watched[p.name] ?? 0) + p.counts.answered;
        const answered = s.w.host.decide.report().points.reduce((n, p) => n + p.counts.answered, 0);
        const applied = s.w.host.decide.report().points.reduce((n, p) => n + p.counts.applied, 0);
        return { h, answered, applied };
      } finally {
        s.w.host.shutdown();
      }
    });
    const [none, off, watch] = runs as [(typeof runs)[0], (typeof runs)[0], (typeof runs)[0]];
    expect(off.h).toEqual(none.h);
    expect(watch.h).toEqual(none.h);
    // Off asks nothing; watched answers and acts on none.
    expect([off.answered, watch.answered > 0, watch.applied]).toEqual([0, true, 0]);
  });
}

test("every point that can be asked while watched was asked", () => {
  // nav.do is asked only of a mover the ladder has made stuck, which watching never does (tests/creatures/decide-do.test.ts).
  for (const name of ["nav.snag", "nav.ring", "nav.reach", "nav.probe"]) expect([name, watched[name]! > 0]).toEqual([name, true]);
});
