// The scoreboard's arithmetic (tools/decide/board.ts, fit.ts's grading) on cases worked by hand.
import { expect, test } from "bun:test";
import type { EpisodeScore, Score } from "../../shared/decide/scoreboard.ts";
import { GATE, boardHtml, eceOf, gateOf, regretInterval, summarize, type Graded } from "../../tools/decide/board.ts";
import { gradeOne, type Example } from "../../tools/decide/fit.ts";

const example = (cost: number[], target: number[]): Example => ({
  k: cost.length, n: 0, x: new Float32Array(0), offset: new Float64Array(cost.length), mask: new Uint8Array(cost.length),
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
const ep = (name: string, arrived: number, cost: number): EpisodeScore => ({ name, scenes: 50, arrived, ticks: 600, healthLost: 0, stuckTicks: 10, cells: 100, cost, decideMicros: 20 });

test("the gate passes a scorer that meets every mark and names each one missed", () => {
  expect(gateOf(good(), { hasState: true, mine: ep("m", 40, 700), rule: ep("rule", 38, 720) })).toEqual({ pass: true, why: [] });
  const bad = { ...good(), decisions: 1500, regretRatio: 0.8, interval: [0.7, 0.95] as [number, number], worstFamily: 1.2, ece: 0.07, blind: { state: 0.05, columns: 0.5, shuffled: 0 }, microsFast: 30, bytes: GATE.bytes + 1 };
  const v = gateOf(bad, { hasState: true, mine: ep("m", 30, 900), rule: ep("rule", 38, 720) });
  expect(v.pass).toBe(false);
  expect(v.why.map((w) => w.split(/[:,]/)[0])).toEqual([
    "not measurable", "regret is 0.800 of the rule's", "the interval's top is 0.950", "its worst held-out family is 1.200 of the rule's", "ECE is 0.070",
    "hiding the state costs only 0.050 more log loss", "one answer takes 30.0 µs at the 99th percentile", `its weights are ${GATE.bytes + 1} bytes`, "whole episodes", "whole episodes",
  ]);
  // A scorer that wins single decisions and is never played whole is not passed.
  expect(gateOf(good(), { hasState: true }).why).toEqual(["no whole episodes were played"]);
  // A profile with no state has none to hide.
  expect(gateOf({ ...good(), blind: { state: NaN, columns: 0.5, shuffled: NaN } }, { hasState: false, mine: ep("m", 40, 700), rule: ep("rule", 38, 720) }).pass).toBe(true);
});

test("the board's page fetches nothing from outside it", () => {
  const s = { ...good(), reliability: [{ said: 0.25, happened: 0.3, answers: 40 }, { said: 0.75, happened: 0.7, answers: 60 }] };
  const html = boardHtml({ made: "now", revision: "abc", points: [{ point: "lab.ring", profile: "ring.mid", headroom: 0.2, episodes: [ep("rule", 38, 720)], scores: [s] }] });
  expect(html).toContain("<svg");
  expect(html).toContain('name="viewport"');
  expect(html).not.toMatch(/<script|<link|src=|url\(|@import|https?:/);
});
