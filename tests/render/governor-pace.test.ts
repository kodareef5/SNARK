import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { TARGET_MS, ladder } from "../../client/core/governor.ts";
import { run } from "../fixtures/frames.ts";

test("at a step's edge, on a display at 120 or 60 a second shared with another job's bursts, the governor moves at most once in three seconds, and no level of any tier takes the sun's shadows", () => {
  for (const t of TIERS) for (const dpr of [1, 2, 3]) for (const l of ladder(t, dpr)) expect(l.tier.shadows.cascades > 0).toBe(t.shadows.cascades > 0);
  for (const display of [1000 / 120, 1000 / 60]) {
    for (const quantized of [true, false]) {
      for (const heavy of [1.06, 2]) {
        // Just over the miss at the tier, or twice it; another job takes a fifth more of the card for a quarter of a second in every half.
        const { governor } = run(5, (t, level) => ({ gpu: TARGET_MS * heavy * 0.96 ** level * (t % 500 < 250 ? 1.2 : 1), display, work: 10 }), { tier: "ultra", dpr: 2, quantized });
        const at = governor.steps.map((s) => s.at);
        const gaps = at.slice(1).map((t, k) => t - at[k]!);
        expect(governor.moved).toBeLessThanOrEqual(5 * 20);
        expect(Math.min(Infinity, ...gaps)).toBeGreaterThanOrEqual(3000);
      }
    }
  }
});
