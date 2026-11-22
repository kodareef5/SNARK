// Twenty minutes of a hundred wild pteranodons over the proving ground (flyers.test.ts has the rest of their minds). Slow
// by nature, so in the slow tier.

import { expect, test } from "bun:test";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { flock, spread, watch, watched } from "../fixtures/flyers.ts";

test("left 20 minutes, 100 wild pteranodons over the proving ground fly and land by turns, aloft 55 to 92% of the time, never inside anything, stuck or in the water", () => {
  const { h } = watched([[96, 96], [416, 96], [96, 416], [416, 416]]);
  const list = flock(h, 100, (rng) => [PROVING_POOL.x + rng.range(-60, 60), PROVING_POOL.z + rng.range(-60, 60)]);
  expect([list.length, h.host.creatures.awakeCount]).toEqual([100, 100]);
  const w = watch(h, list, 20 * 60);
  const [low, high] = spread(w.aloft);
  expect([w.inside, w.stuck, w.wet, w.badLandings]).toEqual([0, 0, 0, 0]);
  expect([low >= 0.55, high <= 0.92]).toEqual([true, true]);
  // Each lands every few minutes, stays up no longer than its longest leg and approach, rests no longer than its longest rest,
  // and goes no higher than its highest cruise over the tallest thing there, the obelisk's 90 m.
  expect(Math.min(...w.landings)).toBeGreaterThanOrEqual(5);
  expect([w.longestUp < 240, w.longestDown <= 61, w.highest < 90 + 40 + 5]).toEqual([true, true, true]);
  h.host.shutdown();
});
