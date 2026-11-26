// The hair clock's arithmetic: a cut that starts the clock again keeps the part-grown unit of the part not cut, and a clock
// moved before a world's first tick keeps all that grew.

import { expect, test } from "bun:test";
import { LOOK_BEARD_LENGTH, LOOK_HAIR_LENGTH, defaultLook } from "../../shared/anim/look.ts";
import { HAIR_TICK, bakeHair, bakeHairUp, beardAt, carrySteps, hairClock } from "../../shared/people/hair.ts";
import { Rng } from "../../shared/rng.ts";

test("a clock started again with its carry keeps the beard's growth to within a step", () => {
  const rng = new Rng(3);
  for (let k = 0; k < 2000; k++) {
    const rate = [1, 7, 250, 1000, 2000, 30000, 1_000_000][rng.int(7)]!;
    const look = defaultLook();
    look[LOOK_BEARD_LENGTH] = rng.int(40);
    const start = hairClock(rng.int(1 << 24)), now = start + rng.int(1 << 22);
    const baked = look.slice();
    bakeHair(baked, start, now, rate);
    const again = Math.max(0, hairClock(now) - carrySteps(start, now, rate) * HAIR_TICK);
    expect(again).toBeLessThanOrEqual(now);
    for (const later of [now, now + HAIR_TICK, now + 37 * HAIR_TICK, now + 5000 * HAIR_TICK]) {
      const kept = beardAt(baked, again, later, rate), was = beardAt(look, start, later, rate);
      expect(kept).toBeLessThanOrEqual(was);
      // At most the growth of one clock step behind.
      expect(was - kept).toBeLessThanOrEqual(Math.ceil(rate / 40000));
    }
  }
});

test("a clock moved before tick 0 keeps all that grew until then, rounded up", () => {
  for (const rate of [1, 1000, 30000, 1_000_000]) {
    for (const start of [-1024, -7 * 1024, -40_000 * 1024]) {
      const look = defaultLook();
      look[LOOK_HAIR_LENGTH] = 10;
      const up = look.slice();
      bakeHairUp(up, start, 0, rate);
      for (const t of [0, 3 * HAIR_TICK, 90 * HAIR_TICK]) {
        const exact = Math.min(255, 10 + Math.floor((Math.floor(t / HAIR_TICK) - start / HAIR_TICK) * rate / 40000));
        const got = Math.min(255, up[LOOK_HAIR_LENGTH]! + Math.floor(Math.floor(t / HAIR_TICK) * rate / 40000));
        expect(got).toBeGreaterThanOrEqual(exact);
        expect(got - exact).toBeLessThanOrEqual(1);
      }
    }
  }
});
