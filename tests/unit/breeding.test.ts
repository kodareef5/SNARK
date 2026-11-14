import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BIRTH_HUNGER, BIRTH_SCALE, BIRTH_SHARE, GROWN, MATE_RANGE, MATE_SECONDS, STAGES, growthStep, leftAtPeriod, leftAtSpeed, litter, mateWait, maturity, regrow, stageOf, stepTick, youngHunger, youngScale, youngShare } from "../../shared/sim/breeding.ts";
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
  // The reference game does not publish these two, so the values are this project's choice.
  expect([MATE_SECONDS, MATE_RANGE]).toEqual([30, 8]);
});

test("growing up is a hundred steps, each beginning on a tick known from how long it takes and when it ends", () => {
  const rng = new Rng(11);
  for (let k = 0; k < 300; k++) {
    const born = 1 + rng.int(1000000);
    // Spans run from the minimum of GROWN ticks to more than a parasaur takes.
    const span = k < 20 ? GROWN + k : GROWN + rng.int(4000000);
    const grown = born + span;
    expect([growthStep(span, grown, born - 5), growthStep(span, grown, born), growthStep(span, grown, grown - 1) < GROWN, growthStep(span, grown, grown), growthStep(span, grown, grown + 99)]).toEqual([0, 0, true, GROWN, GROWN]);
    let last = born;
    for (let step = 1; step <= GROWN; step++) {
      const at = stepTick(span, grown, step);
      expect([growthStep(span, grown, at), growthStep(span, grown, at - 1), at > last]).toEqual([step, step - 1, true]);
      last = at;
    }
    expect(stepTick(span, grown, GROWN)).toBe(grown);
    expect([maturity(span, grown, born), maturity(span, grown, born + span / 2), maturity(span, grown, grown)]).toEqual([0, 0.5, 1]);
  }
  // A creature that was never young (span 0) is grown.
  expect([growthStep(0, 0, 0), growthStep(0, 0, 12345), maturity(0, 0, 7)]).toEqual([GROWN, GROWN, 1]);
  // A young one slowed part way through can have begun before tick 0. Only the span and the end tick are kept, so with
  // span 1000 ending at 300 it is 70 hundredths grown at tick 0 and reaches step 71 at tick 10.
  expect([growthStep(1000, 300, 0), growthStep(1000, 300, 299), stepTick(1000, 300, 71), maturity(1000, 300, 100)]).toEqual([70, 99, 10, 0.8]);
});

test("a baby to a tenth grown, a juvenile to half, an adolescent until it is grown; a tenth of a grown one's health and food at birth, and 510 times its hunger", () => {
  expect([0, 9, 10, 49, 50, 99, 100].map((s) => STAGES[stageOf(s)])).toEqual(["baby", "baby", "juvenile", "juvenile", "adolescent", "adolescent", "grown"]);
  expect([youngShare(0), youngShare(50), youngShare(GROWN)]).toEqual([BIRTH_SHARE, 0.55, 1]);
  expect(youngHunger(GROWN)).toBe(1);
  // Each hundredth uses the hunger at its middle on a linear fall from 510 to 1, so growing up eats what the linear fall would.
  expect(youngHunger(0)).toBeCloseTo(BIRTH_HUNGER - 509 * 0.005, 9);
  let sum = 0;
  for (let s = 0; s < GROWN; s++) {
    sum += youngHunger(s);
    expect(youngHunger(s)).toBeGreaterThan(youngHunger(s + 1));
    expect(youngShare(s)).toBeLessThan(youngShare(s + 1));
  }
  expect(sum / GROWN).toBeCloseTo((BIRTH_HUNGER + 1) / 2, 9);
  expect([youngScale(BIRTH_SCALE, 200, 300, 100), youngScale(BIRTH_SCALE, 200, 300, 300), youngScale(BIRTH_SCALE, 0, 0, 5)]).toEqual([0.25, 1, 1]);
  expect(youngScale(BIRTH_SCALE, 200, 300, 200.5)).toBeCloseTo(0.25 + 0.75 * (100.5 / 200), 12);
});

test("the two creatures that breed do so at the reference's times, each laying an egg of its own", () => {
  const reg = coreRegistry();
  const of = (name: string): number => reg.index.get(`core:${name}`)!;
  expect([reg.incubateTicks[of("parasaur")], reg.matureTicks[of("parasaur")], reg.breedEgg[of("parasaur")]]).toEqual([5142 * TICK_RATE, 95238 * TICK_RATE, of("egg_parasaur")]);
  expect([reg.incubateTicks[of("raptor")], reg.matureTicks[of("raptor")], reg.breedEgg[of("raptor")]]).toEqual([7199 * TICK_RATE, 133333 * TICK_RATE, of("egg_raptor")]);
  expect([reg.birthScale[of("parasaur")], reg.birthScale[of("survivor")]]).toEqual([BIRTH_SCALE, 1]);
  // A breedEgg of 0xffff means the species does not breed.
  expect([reg.breedEgg[of("survivor")], reg.breedEgg[of("grazer")], reg.matureTicks[of("grazer")]]).toEqual([0xffff, 0xffff, 0]);
});

test("re-timing: what is left of a time a rule divides or multiplies; and a young one whose growing is made faster or slower is never less grown for it", () => {
  // leftAtSpeed is for a time a rule divides, such as hatching. Twice the speed leaves half, rounded up and never zero.
  expect([leftAtSpeed(1000, 1, 2), leftAtSpeed(1001, 1, 2), leftAtSpeed(1000, 2, 1), leftAtSpeed(1000, 10, 50), leftAtSpeed(1, 1, 1000), leftAtSpeed(777, 3, 3)]).toEqual([500, 501, 2000, 200, 1, 777]);
  // leftAtPeriod is for a time a rule multiplies, such as a wait. Twice the rule leaves twice the wait.
  expect([leftAtPeriod(1000, 1, 2), leftAtPeriod(1000, 2, 1), leftAtPeriod(1000, 1, 0.002), leftAtPeriod(1, 1, 0.001), leftAtPeriod(777, 3, 3)]).toEqual([2000, 500, 2, 1, 777]);

  const rng = new Rng(29);
  const out: [number, number] = [0, 0];
  for (let n = 0; n < 4000; n++) {
    const span = GROWN + rng.int(3000000);
    const tick = 1 + rng.int(5000000);
    // The tick is anywhere in its growing, the last tick included.
    const grown = tick + 1 + rng.int(span);
    const k = n % 5 === 0 ? 1 : Math.exp((rng.float() - 0.5) * 12);
    const step = growthStep(span, grown, tick);
    regrow(span, grown, tick, k, out);
    const [span2, grown2] = out;
    const left = Math.max(1, Math.ceil((grown - tick) * k));
    expect([grown2 - tick, span2 >= GROWN]).toEqual([left, true]);
    const step2 = growthStep(span2, grown2, tick);
    // It stays on the same hundredth unless too little is left to tell one hundredth from the next.
    expect(step2).toBeGreaterThanOrEqual(step);
    if (left >= GROWN * 2 && span2 > GROWN) expect(step2).toBe(step);
    if (k === 1) expect([span2, grown2]).toEqual([span, grown]);
    expect(stepTick(span2, grown2, step2 + 1)).toBeGreaterThan(tick);
  }
  // Slowed a hundredfold at tick 1000, nine tenths grown. The new span puts its start before tick 0, and nothing needs that tick.
  regrow(1000, 1100, 1000, 100, out);
  expect([out, growthStep(out[0], out[1], 1000), out[1] - out[0] < 0]).toEqual([[100000, 11000], 90, true]);
  // A grown creature, or one that was never young, is left alone.
  regrow(1000, 500, 600, 3, out);
  expect(out).toEqual([1000, 500]);
  regrow(0, 0, 600, 3, out);
  expect(out).toEqual([0, 0]);
});
