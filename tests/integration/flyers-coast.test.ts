// The wild flock endurance proof through the coastal city, scheduled independently of the proving ground proof.
// Shared seeded setup and every-tick observations live in fixtures/flyers.ts.

import { expect, test } from "bun:test";
import { coast, flock, spread, watch, watched } from "../fixtures/flyers.ts";

test("left 20 minutes, 100 wild pteranodons over a coast of frame towers to 192 m go round and over them and land on the beach and the streets, never inside anything, stuck or in the sea", () => {
  const { h } = watched([[64, 64], [320, 64], [64, 320], [320, 320]], { map: coast() });
  const list = flock(h, 100, (rng) => [110 + rng.range(-10, 30), 192 + rng.range(-100, 100)]);
  expect(list.length).toBe(100);
  const w = watch(h, list, 20 * 60);
  const [low, high] = spread(w.aloft);
  expect([w.inside, w.stuck, w.wet, w.badLandings]).toEqual([0, 0, 0, 0]);
  expect([low >= 0.55, high <= 0.92]).toEqual([true, true]);
  expect(Math.min(...w.landings)).toBeGreaterThanOrEqual(5);
  expect([w.longestUp < 240, w.longestDown <= 61]).toEqual([true, true]);
  // The towers were in their way: they went round them.
  expect(h.host.creatures.mind.turned).toBeGreaterThan(100);
  h.host.shutdown();
}, 60_000);
