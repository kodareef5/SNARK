// The arithmetic of breeding: litters, the wait after an egg, and growing up by hundredths.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BIRTH_HUNGER, BIRTH_SCALE, BIRTH_SHARE, GROWN, MATE_RANGE, MATE_SECONDS, STAGES, growthStep, litter, mateWait, stageOf, stepTick, youngHunger, youngScale, youngShare } from "../../shared/sim/breeding.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("one mating in ten gives twins and one in fifty triplets; a female then waits between eighteen and forty-eight hours", () => {
  expect([litter(0), litter(0.0199), litter(0.02), litter(0.1199), litter(0.1201), litter(0.999)]).toEqual([3, 3, 2, 2, 1, 1]);
  const rng = new Rng(7);
  const seen = [0, 0, 0, 0];
  let least = Infinity;
  let most = 0;
  for (let k = 0; k < 200000; k++) {
    seen[litter(rng.float())]!++;
    const wait = mateWait(rng.float());
    least = Math.min(least, wait);
    most = Math.max(most, wait);
  }
  expect(seen[1]! / 200000).toBeCloseTo(0.88, 2);
  expect(seen[2]! / 200000).toBeCloseTo(0.1, 2);
  expect(seen[3]! / 200000).toBeCloseTo(0.02, 2);
  expect(least).toBeGreaterThanOrEqual(18 * 3600);
  expect(most).toBeLessThan(48 * 3600);
  expect(least).toBeLessThan(18.1 * 3600);
  expect(most).toBeGreaterThan(47.9 * 3600);
  // The two values the reference does not publish, as they were chosen.
  expect([MATE_SECONDS, MATE_RANGE]).toEqual([30, 8]);
});

test("growing up is a hundred steps, each beginning on a tick known from the two it was born and will be grown on", () => {
  const rng = new Rng(11);
  for (let k = 0; k < 300; k++) {
    const born = 1 + rng.int(1000000);
    // From the least a young one is ever given (a hundred ticks) to more than a parasaur takes.
    const span = k < 20 ? GROWN + k : GROWN + rng.int(4000000);
    const grown = born + span;
    expect([growthStep(born, grown, born - 5), growthStep(born, grown, born), growthStep(born, grown, grown - 1) < GROWN, growthStep(born, grown, grown), growthStep(born, grown, grown + 99)]).toEqual([0, 0, true, GROWN, GROWN]);
    let last = born;
    for (let step = 1; step <= GROWN; step++) {
      const at = stepTick(born, grown, step);
      // The first tick of the step: on it the step is this one, and a tick before it was the one before.
      expect([growthStep(born, grown, at), growthStep(born, grown, at - 1), at > last]).toEqual([step, step - 1, true]);
      last = at;
    }
    expect(stepTick(born, grown, GROWN)).toBe(grown);
  }
  // One that was never young is grown.
  expect([growthStep(0, 0, 0), growthStep(0, 0, 12345)]).toEqual([GROWN, GROWN]);
});

test("a baby to a tenth grown, a juvenile to half, an adolescent until it is grown; a tenth of a grown one's health and food at birth, and 510 times its hunger", () => {
  expect([0, 9, 10, 49, 50, 99, 100].map((s) => STAGES[stageOf(s)])).toEqual(["baby", "baby", "juvenile", "juvenile", "adolescent", "adolescent", "grown"]);
  expect([youngShare(0), youngShare(50), youngShare(GROWN)]).toEqual([BIRTH_SHARE, 0.55, 1]);
  expect(youngHunger(GROWN)).toBe(1);
  // Each hundredth hungers as the middle of it would on an even fall from 510 to 1: so the whole of growing up eats what the even fall would.
  expect(youngHunger(0)).toBeCloseTo(BIRTH_HUNGER - 509 * 0.005, 9);
  let sum = 0;
  for (let s = 0; s < GROWN; s++) {
    sum += youngHunger(s);
    expect(youngHunger(s)).toBeGreaterThan(youngHunger(s + 1));
    expect(youngShare(s)).toBeLessThan(youngShare(s + 1));
  }
  expect(sum / GROWN).toBeCloseTo((BIRTH_HUNGER + 1) / 2, 9);
  // Drawn a quarter of a grown one's size at birth, full size when grown, evenly between; and at any moment between ticks.
  expect([youngScale(BIRTH_SCALE, 100, 300, 100), youngScale(BIRTH_SCALE, 100, 300, 300), youngScale(BIRTH_SCALE, 0, 0, 5)]).toEqual([0.25, 1, 1]);
  expect(youngScale(BIRTH_SCALE, 100, 300, 200.5)).toBeCloseTo(0.25 + 0.75 * (100.5 / 200), 12);
});

test("the two creatures that breed do so at the reference's times, each laying an egg of its own", () => {
  const reg = coreRegistry();
  const of = (name: string): number => reg.index.get(`core:${name}`)!;
  expect([reg.incubateTicks[of("parasaur")], reg.matureTicks[of("parasaur")], reg.breedEgg[of("parasaur")]]).toEqual([5142 * TICK_RATE, 95238 * TICK_RATE, of("egg_parasaur")]);
  expect([reg.incubateTicks[of("raptor")], reg.matureTicks[of("raptor")], reg.breedEgg[of("raptor")]]).toEqual([7199 * TICK_RATE, 133333 * TICK_RATE, of("egg_raptor")]);
  expect([reg.birthScale[of("parasaur")], reg.birthScale[of("survivor")]]).toEqual([BIRTH_SCALE, 1]);
  // Everything else does not: survivors, and the box that grazes.
  expect([reg.breedEgg[of("survivor")], reg.breedEgg[of("grazer")], reg.matureTicks[of("grazer")]]).toEqual([0xffff, 0xffff, 0]);
});
