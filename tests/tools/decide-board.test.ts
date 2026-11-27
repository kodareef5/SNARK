// The scoreboard's arithmetic (tools/decide/board.ts, fit.ts's grading) on cases worked by hand.
import { expect, test } from "bun:test";
import type { EpisodeScore, Score } from "../../shared/decide/scoreboard.ts";
import { GATE, against, boardHtml, eceOf, episodeWhy, gateOf, meanInterval, regretInterval, ruleGate, summarize, type Graded } from "../../tools/decide/board.ts";
import { layoutOf } from "../../tools/decide/catalog.ts";
import { gradeOne, type Example } from "../../tools/decide/fit.ts";

const example = (cost: number[], target: number[]): Example => ({
  k: cost.length, n: 0, x: new Float32Array(0), scale: 1, offset: new Float64Array(cost.length), fixed: new Float64Array(cost.length), mask: new Uint8Array(cost.length),
  target: Float64Array.from(target), cost: Float64Array.from(cost), group: "flat/pen/1", family: "pen", map: "flat",
});

test("regret is the cost above the best candidate, and the rule's beside it", () => {
  const g = gradeOne("choice", example([10, 5, 20], [0, 1, 0]), Float64Array.of(0.2, 0.7, 0.1), Float64Array.of(0.9, 0.05, 0.05));
  expect([g.regret, g.ruleRegret, g.disagree]).toEqual([0, 5, true]);
  expect(g.brier).toBeCloseTo(0.04 + 0.09 + 0.01, 12);
  expect(g.logLoss).toBeCloseTo(-Math.log(0.7), 12);
  expect([g.said, g.happened]).toEqual([0.7, 1]);
  // Uniform has no pick: its regret is the mean over what it may choose.
  const u = gradeOne("choice", example([10, 5, 20], [0, 1, 0]), Float64Array.of(1 / 3, 1 / 3, 1 / 3), Float64Array.of(0.9, 0.05, 0.05));
  expect(u.regret).toBeCloseTo(20 / 3, 12);
});

test("calibration error is read in bands of a tenth, each weighed by its answers", () => {
  const { ece, reliability } = eceOf([0.05, 0.15, 0.95, 0.95], [0, 0, 1, 0]);
  expect(ece).toBeCloseTo(0.25 * 0.05 + 0.25 * 0.15 + 0.5 * 0.45, 12);
  expect(reliability.map((b) => [b.answers, b.happened])).toEqual([[1, 0], [1, 0], [2, 0.5]]);
  expect(reliability[2]!.said).toBeCloseTo(0.95, 12);
});

const graded = (group: string, regret: number, rule: number, family = "pen"): Graded => ({ group, family, map: "flat", regret, ruleRegret: rule, disagree: rule > 0, logLoss: 1, brier: 0.1, said: 0.5, happened: 0.5 });

test("the interval is drawn over whole scenes, not over their rows", () => {
  // Ten rows of one scene against one row of another: by rows the share would be near 10/11 every time.
  const g = [...Array.from({ length: 10 }, () => graded("a", 1, 1)), graded("b", 0, 1)];
  expect(regretInterval(g, 2000, 3)).toEqual([0, 1]);
  const s = summarize("m", "linear", g);
  expect([s.decisions, s.scenes, s.regretRatio]).toEqual([11, 2, 10 / 11]);
});

test("the worst family is the one whose share of the rule's regret is highest", () => {
  const s = summarize("m", "linear", [graded("a", 1, 2, "pen"), graded("b", 3, 2, "crowd"), graded("c", 0, 2, "crowd")]);
  expect(s.worstFamily).toBe(0.75);
  expect(s.regretRatio).toBeCloseTo(4 / 6, 12);
});

function good(): Score {
  return {
    name: "m", kind: "linear", decisions: 2400, scenes: 2400, regret: 3, regretRatio: 0.6, interval: [0.5, 0.8], worstFamily: 1, disagreeRatio: 0.5,
    logLoss: 1, brier: 0.2, ece: 0.03, reliability: [], blind: { state: 0.2, columns: 0.5, shuffled: 0.15 }, microsFast: 4, microsSlow: 9, medianFast: 2, medianSlow: 5, bytes: 4000, gate: { pass: false, why: [] },
  };
}
/** Fifty layouts of one family, the first `arrived` of them arrived, each costing `cost` (or as `each` says). */
const ep = (name: string, arrived: number, cost: number, each: (i: number) => number = () => cost, family = "pen"): EpisodeScore => ({
  name, scenes: 50, arrived, ticks: 600, healthLost: 0, stuckTicks: 10, searches: 2, cells: 100, cost, decideMicros: 20,
  families: { [family]: { scenes: 50, arrived, ticks: 600 } },
  layouts: Array.from({ length: 50 }, (_, i) => ({ family, seed: i + 1, route: 50, arrived: i < arrived, ticks: 600, healthLost: 0, acted: 1, cost: each(i) })),
});

test("the gate passes a scorer that meets every mark and names each one missed", () => {
  expect(gateOf(good(), { hasState: true, mine: ep("m", 40, 700), rule: ep("rule", 38, 720) })).toEqual({ pass: true, why: [] });
  const bad = { ...good(), decisions: 1500, regretRatio: 0.8, interval: [0.7, 0.95] as [number, number], worstFamily: 1.2, ece: 0.07, blind: { state: 0.05, columns: 0.5, shuffled: 0 }, microsFast: 30, bytes: GATE.bytes + 1 };
  const v = gateOf(bad, { hasState: true, mine: ep("m", 30, 900), rule: ep("rule", 38, 720) });
  expect(v.pass).toBe(false);
  expect(v.why.map((w) => w.split(/[:,]/)[0])).toEqual([
    "not measurable", "regret is 0.800 of the rule's", "the interval's top is 0.950", "its worst held-out family is 1.200 of the rule's", "ECE is 0.070",
    "hiding the state costs only 0.050 of its gain over uniform", "one answer takes 30.0 µs at the 99th percentile", `its weights are ${GATE.bytes + 1} bytes`, "whole episodes", "whole episodes", "whole episodes", "whole episodes",
  ]);
  // A scorer that wins single decisions and is never played whole is not passed.
  expect(gateOf(good(), { hasState: true }).why).toEqual(["no whole episodes were played"]);
  // A profile with no state has none to hide.
  expect(gateOf({ ...good(), blind: { state: NaN, columns: 0.5, shuffled: NaN } }, { hasState: false, mine: ep("m", 40, 700), rule: ep("rule", 38, 720) }).pass).toBe(true);
});

test("with no decisions held out the gate says so once and still reads whole episodes", () => {
  const none = { ...good(), decisions: 0, scenes: 0, regretRatio: NaN, interval: [NaN, NaN] as [number, number], worstFamily: NaN, ece: NaN, blind: { state: NaN, columns: NaN, shuffled: NaN } };
  expect(gateOf(none, { hasState: true, mine: ep("m", 37, 700), rule: ep("rule", 38, 720) }).why.map((w) => w.split(":")[0])).toEqual(["single decisions", "whole episodes", "whole episodes", "whole episodes"]);
});

test("scenes of one base layout are resampled together", () => {
  // Each pair's two scenes cancel: resampled apart the mean wanders, resampled as pairs it cannot.
  const diff = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? -50 : 50)), units = diff.map((_, i) => `gap/${i >> 1}`);
  const [low, top] = meanInterval(diff, 1000, 1);
  expect(top - low).toBeGreaterThan(10);
  expect(meanInterval(diff, 1000, 1, units)).toEqual([0, 0]);
  // The same for single decisions: one scene of each pair is all regret, the other none.
  const g = Array.from({ length: 40 }, (_, i) => ({ ...graded(`flat/gap/${i + 1}`, i % 2 === 0 ? 2 : 0, 1) }));
  const apart = regretInterval(g, 1000, 1), together = regretInterval(g, 1000, 1, (group) => `gap/${(Number(group.split("/").pop()) + 1) >> 1}`);
  expect(apart[1] - apart[0]).toBeGreaterThan(0.2);
  expect(together).toEqual([1, 1]);
  // The gate's whole-episode interval takes the layout of each scene from the catalog's.
  const scene = (seed: number, cost: number) => ({ family: "gap", seed, route: 40, arrived: true, ticks: 900, healthLost: 0, acted: 1, cost });
  const rule: EpisodeScore = { ...ep("rule", 40, 700), layouts: Array.from({ length: 40 }, (_, i) => scene(i + 1, 700)) };
  const mine: EpisodeScore = { ...ep("m", 40, 690), layouts: Array.from({ length: 40 }, (_, i) => scene(i + 1, i % 2 === 0 ? 630 : 750)) };
  expect(against(mine, rule, layoutOf).units.slice(0, 4)).toEqual(["gap/1", "gap/1", "gap/2", "gap/2"]);
  expect(episodeWhy(mine, rule, 1, layoutOf)).toEqual([]);
  expect(episodeWhy(mine, rule, 1)).toEqual([expect.stringContaining("the interval of its cost less the rule's reaches")]);
});

test("ECE is a bar only where the point's probability is read", () => {
  const off = { ...good(), ece: 0.2 };
  expect(gateOf(off, { hasState: true, calibrated: false, mine: ep("m", 40, 700), rule: ep("rule", 38, 720) }).pass).toBe(true);
  expect(gateOf(off, { hasState: true, calibrated: true, mine: ep("m", 40, 700), rule: ep("rule", 38, 720) }).why).toEqual(["ECE is 0.200, above 0.05"]);
});

test("whole episodes fail a scorer that loses a family, loses more than it gains, or saves no clear cost", () => {
  const rule = ep("rule", 38, 720);
  // As many arrivals, but layouts 0 to 2 lost and 38 to 40 gained: as many lost as gained passes.
  const swapped = { ...ep("m", 38, 700), layouts: ep("m", 38, 700).layouts!.map((l, i) => ({ ...l, arrived: i >= 3 && i < 41 })) };
  expect(episodeWhy(swapped, rule)).toEqual([]);
  // Four lost and three gained.
  const worse = { ...ep("m", 37, 700), layouts: ep("m", 37, 700).layouts!.map((l, i) => ({ ...l, arrived: i >= 4 && i < 41 })) };
  expect(episodeWhy(worse, rule).map((w) => w.split(":")[1]!.trim().split(" ").slice(0, 4).join(" "))).toEqual(["it arrives in 37", "in pen it arrives", "it loses 4 of"]);
  // A mean under the rule's whose saving is one layout's luck.
  const lucky = ep("m", 38, 719, (i) => (i === 0 ? 670 : 720));
  expect(episodeWhy(lucky, rule)).toEqual([expect.stringContaining("the interval of its cost less the rule's reaches 0.0")]);
  expect(meanInterval([-2, -2, -2])).toEqual([-2, -2]);
});

test("neither a scorer nor the rule passes where it loses whole episodes to today's code", () => {
  expect(gateOf(good(), { hasState: true, mine: ep("m", 40, 700), rule: ep("rule", 38, 720), today: ep("today", 45, 650) }).why).toEqual(["whole episodes: it arrives in 40 of 50, today's code in 45"]);
  expect(ruleGate(ep("rule", 9, 5000), ep("today", 47, 2000))).toEqual({ pass: false, why: ["whole episodes: the rule arrives in 9 of 50, today's code in 47"] });
  expect(ruleGate(ep("rule", 47, 1900), ep("today", 47, 2000)).pass).toBe(true);
});

test("the board's page fetches nothing from outside it", () => {
  const s = { ...good(), reliability: [{ said: 0.25, happened: 0.3, answers: 40 }, { said: 0.75, happened: 0.7, answers: 60 }] };
  const html = boardHtml({ made: "now", revision: "abc", points: [{ point: "lab.ring", profile: "ring.mid", headroom: 0.2, episodes: [ep("rule", 38, 720)], scores: [s] }] });
  expect(html).toContain("<svg");
  expect(html).toContain('name="viewport"');
  expect(html).not.toMatch(/<script|<link|src=|url\(|@import|https?:/);
});
