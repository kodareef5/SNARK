// The lab's trainer (tools/decide/fit.ts) on synthetic tables whose answers are known.
import { expect, test } from "bun:test";
import { profile, type Profile } from "../../shared/decide/profile.ts";
import { writeModel } from "../../shared/decide/weights.ts";
import { Rng } from "../../shared/rng.ts";
import { eceOf } from "../../tools/decide/board.ts";
import type { Decision } from "../../tools/decide/dataset.ts";
import { layoutOf } from "../../tools/decide/catalog.ts";
import { examples, fit, grade, probabilities, scoreModel, splitExamples, unitOf, type Example } from "../../tools/decide/fit.ts";
import { draw } from "../../tools/decide/random.ts";

const CHOICE = profile("test.choice", "choice", false, ["calm"], ["good", "bad", "noise"]);
const YES = profile("test.yes", "yes", false, [], ["a", "b"]);

const gumbel = (rng: Rng) => -Math.log(-Math.log(1 - rng.float() * 0.999999));

/** Choices of four whose utility is 2 good - bad, the best of each of eight seeds of Gumbel luck labelled. */
function choices(n: number, seed: number): Decision[] {
  const rng = new Rng(seed), k = 4, S = 8;
  return Array.from({ length: n }, (_, i) => {
    const rows = Float32Array.from({ length: k * 3 }, () => rng.float());
    const costs = new Float32Array(k * S);
    for (let c = 0; c < k; c++) for (let s = 0; s < S; s++) costs[c * S + s] = 100 - (2 * rows[c * 3]! - rows[c * 3 + 1]!) - gumbel(rng) * 0.5;
    return { seed: i, family: i % 5 === 0 ? "val" : "train", map: "flat", ordinal: 0, tick: 0, pick: 0, label: 0, seeds: S, readings: 1, tables: [{ profile: CHOICE.name, k, state: Float32Array.of(rng.float()), rows, bias: new Float32Array(k), mask: new Uint8Array(k) }], costs, today: new Float32Array(S).fill(NaN) };
  });
}

function yeses(n: number, seed: number, label: (a: number, b: number, rng: Rng) => number, binary = false): Decision[] {
  const rng = new Rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = binary ? rng.int(2) + (rng.float() - 0.5) * 0.1 : rng.float() * 2 - 1, b = binary ? rng.int(2) + (rng.float() - 0.5) * 0.1 : rng.float() * 2 - 1;
    return { seed: i, family: "f", map: "flat", ordinal: 0, tick: 0, pick: 0, label: label(a, b, rng), seeds: 0, readings: 3, tables: [{ profile: YES.name, k: 1, state: new Float32Array(0), rows: Float32Array.of(a, b), bias: new Float32Array(1), mask: new Uint8Array(1) }], costs: new Float32Array(0), today: new Float32Array(0) };
  });
}

const ex = (ds: Decision[], p: Profile): Example[] => examples(ds, p, [p], new Map(), 0);

test("with no validation family, whole layouts validate: a pair is never split", () => {
  const of = (family: string, n: number): Decision[] => choices(n, 5).map((d, i) => ({ ...d, seed: i + 1, family }));
  const all = [...ex(of("gap", 60), CHOICE), ...ex(of("intentU", 60), CHOICE), ...ex(of("trees", 60), CHOICE)];
  const split = { held: [], heldMaps: [], validation: [] };
  const sides = (s: { train: Example[]; val: Example[] }) => {
    const train = new Set(s.train.map((e) => unitOf({ layout: layoutOf }, e.group)));
    return { val: s.val.length, shared: s.val.filter((e) => train.has(unitOf({ layout: layoutOf }, e.group))).length };
  };
  // By seed alone, most validation rows of a pair or an intent have their companion scene in training.
  const bySeed = sides(splitExamples(all, split));
  expect(bySeed.shared).toBeGreaterThan(bySeed.val / 3);
  const byLayout = sides(splitExamples(all, { ...split, layout: layoutOf }));
  expect(byLayout.shared).toBe(0);
  expect(byLayout.val).toBeGreaterThan(all.length / 10);
  // A validation family, where the data has one, is used as it was.
  expect(splitExamples(all, { ...split, validation: ["trees"], layout: layoutOf }).val.every((e) => e.family === "trees")).toBe(true);
});

test("the catalog numbers a scene's base layout as the scenes are drawn", () => {
  for (const family of ["ford", "gap"] as const) for (let seed = 1; seed <= 12; seed++) expect(draw(family, seed).pair!.id).toBe(layoutOf(family, seed));
  for (const family of ["intentU", "intentTrees"] as const) for (let seed = 1; seed <= 12; seed++) expect(draw(family, seed).intent!.id).toBe(layoutOf(family, seed));
  expect([layoutOf("trees", 7), layoutOf("miami", 12)]).toEqual([7, 12]);
});

test("a line of weights recovers the rule behind its labels and beats uniform", () => {
  const all = ex(choices(1500, 3), CHOICE), train = all.filter((e) => e.family === "train"), val = all.filter((e) => e.family === "val");
  const { model } = fit(CHOICE, train, val, { kind: "linear", seed: 1 });
  const w = model.w1, at = (c: string) => w[CHOICE.state.length + CHOICE.c[c as "good"]]!;
  expect(at("good")).toBeGreaterThan(0);
  expect(at("bad")).toBeLessThan(0);
  expect(at("good")).toBeGreaterThan(-at("bad") * 1.4);
  expect(Math.abs(at("noise"))).toBeLessThan(0.25 * at("good"));
  const test = ex(choices(500, 4), CHOICE);
  const mean = (g: ReturnType<typeof grade>, f: (x: (typeof g)[number]) => number) => g.reduce((s, x) => s + f(x), 0) / g.length;
  const mine = grade("choice", test, model, null), flat = grade("choice", test, null, null);
  expect(mean(mine, (x) => x.logLoss)).toBeLessThan(mean(flat, (x) => x.logLoss) - 0.1);
  expect(mean(mine, (x) => x.regret)).toBeLessThan(mean(flat, (x) => x.regret) * 0.6);
});

test("its yes probabilities are calibrated on fresh data", () => {
  const truth = (a: number, b: number, rng: Rng) => (rng.float() < 1 / (1 + Math.exp(-(1.5 * a - b + 0.3))) ? 1 : 0);
  const { model } = fit(YES, ex(yeses(4000, 5, truth), YES), ex(yeses(1500, 6, truth), YES), { kind: "linear", seed: 1 });
  const test = ex(yeses(6000, 7, truth), YES), p = new Float64Array(1);
  const said = test.map((e) => (probabilities("yes", e, (c) => scoreModel(model, e.x, c * e.n), model.temperature, p), p[0]!));
  expect(eceOf(said, test.map((e) => e.target[0]!)).ece).toBeLessThan(0.05);
  expect(model.w1[0]).toBeGreaterThan(1);
  expect(model.w1[1]).toBeLessThan(-0.6);
});

test("one hidden layer learns an exclusive-or of two columns that a line cannot", () => {
  const xor = (a: number, b: number) => (Math.round(a) !== Math.round(b) ? 1 : 0);
  const train = ex(yeses(2000, 8, xor, true), YES), val = ex(yeses(500, 9, xor, true), YES), test = ex(yeses(1000, 10, xor, true), YES);
  const loss = (m: ReturnType<typeof fit>["model"]) => grade("yes", test, m, null).reduce((s, g) => s + g.logLoss, 0) / test.length;
  const line = fit(YES, train, val, { kind: "linear", seed: 1 }).model, layer = fit(YES, train, val, { kind: "hidden", hidden: 8, seed: 1 }).model;
  expect(loss(line)).toBeGreaterThan(0.6);
  expect(loss(layer)).toBeLessThan(0.2);
});

test("training twice with one seed gives the same weights byte for byte", () => {
  const all = ex(choices(300, 11), CHOICE), train = all.filter((e) => e.family === "train"), val = all.filter((e) => e.family === "val");
  for (const kind of ["linear", "hidden"] as const) {
    const a = JSON.stringify(writeModel(fit(CHOICE, train, val, { kind, hidden: 6, seed: 4 }).model));
    const b = JSON.stringify(writeModel(fit(CHOICE, train, val, { kind, hidden: 6, seed: 4 }).model));
    expect(a).toBe(b);
  }
  const other = JSON.stringify(writeModel(fit(CHOICE, train, val, { kind: "hidden", hidden: 6, seed: 5 }).model));
  expect(other).not.toBe(JSON.stringify(writeModel(fit(CHOICE, train, val, { kind: "hidden", hidden: 6, seed: 4 }).model)));
});
