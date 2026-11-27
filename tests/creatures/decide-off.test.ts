// The stuck ladder (server/decide/nav.ts) changes nothing until it acts: with its points off, or only watched, a world
// moves as one with no decider at all, to the bit, every second of the way.
import { expect, test } from "bun:test";
import { SCENES, decideBy, hashes } from "../fixtures/decide-scenes.ts";

const NAMES = ["pen", "pastWall", "deadEnd", "woodGoals", "hunt", "flight"];

for (const name of NAMES) {
  test(`${name}: off and watched run as with no decider, hashed every second`, () => {
    const runs = ["detached", "off", "watch"].map((way) => {
      const s = SCENES[name]!(1);
      try {
        decideBy(s.w, way);
        const h = hashes(s);
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
