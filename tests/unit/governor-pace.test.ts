import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { TARGET_MS, ladder } from "../../client/core/governor.ts";
import { run } from "../fixtures/frames.ts";

test("at a step's edge, on a display at 120 or 60 a second shared with another job's bursts, the governor moves at most once in three seconds and never takes the sun's shadows", () => {
  const shadowless = ladder(tierOf("ultra"), 2).findIndex((l) => l.tier.shadows.cascades === 0);
  expect(shadowless).toBe(ladder(tierOf("ultra"), 2).length - 1);
  for (const display of [1000 / 120, 1000 / 60]) {
    for (const quantized of [true, false]) {
      // Just over the miss at the tier, just under it a step down; another job takes a fifth more of the card for a
      // quarter of a second in every half.
      const { governor } = run(5, (t, level) => ({ gpu: TARGET_MS * 1.06 * 0.96 ** level * (t % 500 < 250 ? 1.2 : 1), display, work: 10 }), { tier: "ultra", dpr: 2, quantized });
      const at = governor.steps.map((s) => s.at);
      const gaps = at.slice(1).map((t, k) => t - at[k]!);
      expect(governor.moved).toBeLessThanOrEqual(5 * 20);
      expect(Math.min(Infinity, ...gaps)).toBeGreaterThanOrEqual(3000);
      expect(governor.steps.some((s) => s.level >= shadowless)).toBe(false);
    }
  }
});
