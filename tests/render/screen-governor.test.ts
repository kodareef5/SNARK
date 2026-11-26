// The governor gives the screens on props up before anything else (client/core/governor.ts STEPS), whatever they buy,
// and passes their steps by where no screen draws what a step takes.
import { expect, test } from "bun:test";
import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { PRINTS_DRAWN, SCREENS_DECODING, SCREENS_DRAWN, SCREENS_MANY, SCREENS_UPLOADING, STEPS, ladder } from "../../client/core/governor.ts";
import { run } from "../fixtures/frames.ts";

const SCREEN_STEPS = ["screens: clips at 10 frames a second", "screens: stills only", "screens: the nearest 8", "screens: off"];
const ALL = SCREENS_UPLOADING | SCREENS_DECODING | SCREENS_MANY | SCREENS_DRAWN;
/** Each step past the screens' leaves this share of the GPU's time; the screens' buy nothing. */
const leave = (level: number): number => 0.88 ** Math.max(0, level - SCREEN_STEPS.length);

test("the screens' steps come before every other step, in their order", () => {
  expect(STEPS.slice(0, 4).map((s) => s.name)).toEqual(SCREEN_STEPS);
  expect(STEPS.slice(0, 4).map((s) => s.screens)).toEqual([SCREENS_UPLOADING, SCREENS_DECODING, SCREENS_MANY, SCREENS_DRAWN]);
  // Prints on clothes as swatches come next, taken whatever they buy where a print is drawn.
  expect([STEPS[4]!.name, STEPS[4]!.screens]).toEqual(["prints: swatches", PRINTS_DRAWN]);
  expect(STEPS.slice(5).every((s) => !s.screens)).toBe(true);
  expect(ladder(tierOf("medium"), 2).find((l) => l.name === "prints: swatches")!.tier.prints).toEqual({ side: 256, layers: 32, swatches: true });
  expect(ladder(tierOf("lowpoly"), 1).some((l) => l.name === "prints: swatches")).toBe(false);
  for (const t of TIERS) {
    const names = ladder(t, 2).map((l) => l.name);
    const last = Math.max(...SCREEN_STEPS.map((n) => names.indexOf(n)));
    expect(names.slice(1).findIndex((n) => !n.startsWith("screens:"))).toBe(last);
  }
});

test("each screens' step takes its share, and stills stops the ball's clip too", () => {
  const high = ladder(tierOf("high"), 2).slice(0, 5).map((l) => [l.tier.screens.fps, l.tier.screens.video, l.tier.screens.count, l.tier.orb.video]);
  expect(high).toEqual([[30, 2, 32, true], [10, 2, 32, true], [10, 0, 32, false], [10, 0, 8, false], [10, 0, 0, false]]);
  // The steps past them keep the screens off.
  expect(ladder(tierOf("high"), 2).slice(5).every((l) => l.tier.screens.count === 0 && l.tier.screens.video === 0)).toBe(true);
  // Low poly plays no clip and draws eight at most: it has only the last.
  expect(ladder(tierOf("lowpoly"), 1).filter((l) => l.screens).map((l) => l.name)).toEqual(["screens: off"]);
});

test("with screens drawn, slow frames give them up first though they buy nothing, and the steps after go on as before", () => {
  const { governor } = run(3, (_, level) => ({ gpu: 24 * leave(level), screens: ALL }));
  expect(governor.steps.slice(0, 5).map((s) => s.name)).toEqual([...SCREEN_STEPS, "the scene at 90% a side"]);
  // Nothing was undone for the screens buying nothing.
  expect(governor.steps.some((s) => s.why.includes("not what is slow"))).toBe(false);
});

test("with prints drawn too, slow frames give them up after the screens, as swatches, then go on as before", () => {
  const { governor } = run(3, (_, level) => ({ gpu: 24 * leave(level - 1), screens: ALL | PRINTS_DRAWN }));
  expect(governor.steps.slice(0, 6).map((s) => s.name)).toEqual([...SCREEN_STEPS, "prints: swatches", "the scene at 90% a side"]);
  expect(governor.steps.some((s) => s.why.includes("not what is slow"))).toBe(false);
});

test("with no screen drawn their steps are passed by, down and back up", () => {
  const { governor } = run(10, (t, level) => (t < 120000 ? { gpu: 26 * leave(level), work: 20 } : { gpu: 6 * leave(level), work: 4 }));
  expect(governor.steps.length).toBeGreaterThan(1);
  expect(governor.steps.every((s) => s.level === 0 || s.level > SCREEN_STEPS.length)).toBe(true);
  expect(governor.level).toBe(0);
});

test("coming back up, a screens' step is passed by where what it takes would not be drawn", () => {
  // Many screens in view but none showing a clip: back up through the nearest eight and the screens off, not the clips' steps.
  const { governor } = run(12, (t, level) => (t < 120000 ? { gpu: 26 * leave(level), work: 20, screens: SCREENS_DRAWN | SCREENS_MANY } : { gpu: 6 * leave(level), work: 4, screens: SCREENS_DRAWN | SCREENS_MANY }));
  const reached = new Set(governor.steps.map((s) => s.level));
  expect(reached.has(1) || reached.has(2)).toBe(false);
  expect(reached.has(3)).toBe(true);
  expect(governor.level).toBe(0);
});
