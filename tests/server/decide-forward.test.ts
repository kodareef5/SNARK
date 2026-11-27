// The decision engine (shared/decide): a table in, a probability for each candidate out.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hashString as ownHash } from "../../shared/decide/hash.ts";
import { hashString } from "../../shared/hash.ts";
import { addPass, stick } from "../../shared/decide/combine.ts";
import { answer, decide, inputsAt, linear, scoreTable, type Model } from "../../shared/decide/forward.ts";
import { inputsOf, profile, profileHash } from "../../shared/decide/profile.ts";
import { PICK, PROFILES, RING_MID, SNAG } from "../../shared/decide/profiles.ts";
import { RULE_MID, RULE_PICK, RULE_SNAG, RULES, ruleOf } from "../../shared/decide/rules.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { signed, soon, span, unit } from "../../shared/decide/units.ts";
import { readModel, writeModel } from "../../shared/decide/weights.ts";

const PLAIN = profile("test.plain", "choice", false, ["calm"], ["good", "bad"]);
const RING = profile("test.ring", "choice", true, [], ["free"]);
const YES = profile("test.yes", "yes", false, [], ["a", "b"]);

const sum = (a: Float32Array, n: number): number => a.subarray(0, n).reduce((s, v) => s + v, 0);

test("a line of weights scores each candidate from the state and its own row", () => {
  const m = ruleOf(PLAIN, { state: { calm: 10 }, own: { good: 2, bad: -1 }, constant: 0.5 });
  const t = tableFor(PLAIN, 4);
  t.clear(3);
  t.state[0] = 1;
  t.rows.set([1, 0, 0, 1, 0.5, 0.5]);
  scoreTable(m, PLAIN, t);
  expect(Array.from(t.score.subarray(0, 3))).toEqual([12.5, 9.5, 11]);
  expect(decide(m, PLAIN, t)).toBe(0);
  expect(sum(t.out, 3)).toBeCloseTo(1, 6);
  expect(t.out[0]).toBeGreaterThan(t.out[2]!);
});

test("one hidden layer scores through its units, each shut below zero", () => {
  const m: Model = { profile: PLAIN.name, hash: profileHash(PLAIN), inputs: 3, hidden: 2, w1: Float32Array.of(0, 1, 0, 0, 0, 1), b1: Float32Array.of(-0.5, 0), w2: Float32Array.of(4, -2), b2: 1, temperature: 1 };
  const t = tableFor(PLAIN, 2);
  t.clear(2);
  t.rows.set([1, 0, 0.25, 1]);
  scoreTable(m, PLAIN, t);
  // good 1: unit 0 is 0.5, unit 1 is 0. good 0.25: unit 0 is shut, unit 1 is 1.
  expect(Array.from(t.score.subarray(0, 2))).toEqual([3, -1]);
});

test("a masked candidate is never chosen and has no probability", () => {
  const t = tableFor(PLAIN, 3);
  t.clear(3);
  t.score.set([5, 1, 2]);
  t.mask[0] = 1;
  expect(answer("choice", t)).toBe(2);
  expect(t.out[0]).toBe(0);
  expect(sum(t.out, 3)).toBeCloseTo(1, 6);
  t.mask.fill(1);
  expect(answer("choice", t)).toBe(-1);
  expect(sum(t.out, 3)).toBe(0);
});

test("a bias moves the choice whatever the weights say", () => {
  const t = tableFor(PLAIN, 2);
  t.clear(2);
  t.score.set([3, 1]);
  expect(answer("choice", t)).toBe(0);
  t.bias[1] = 4;
  expect(answer("choice", t)).toBe(1);
});

test("a higher temperature spreads the probabilities and keeps the choice", () => {
  const t = tableFor(PLAIN, 2);
  t.clear(2);
  t.score.set([2, 0]);
  expect(answer("choice", t, 1)).toBe(0);
  const sharp = t.out[0]!;
  expect(answer("choice", t, 4)).toBe(0);
  expect(t.out[0]).toBeLessThan(sharp);
  expect(t.out[0]).toBeGreaterThan(0.5);
});

test("a yes table answers with one probability", () => {
  const m = ruleOf(YES, { own: { a: 2, b: -2 } });
  const t = tableFor(YES, 1);
  t.clear(1);
  t.rows.set([1, 0]);
  expect(decide(m, YES, t)).toBe(0);
  expect(t.out[0]).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
  t.rows.set([0, 1]);
  decide(m, YES, t);
  expect(t.out[0]).toBeCloseTo(1 / (1 + Math.exp(2)), 6);
});

test("a ring's candidate reads the one on either side, the last beside the first", () => {
  const t = tableFor(RING, 4);
  t.clear(4);
  t.rows.set([0.1, 0.2, 0.3, 0.4]);
  const x = new Float32Array(inputsOf(RING));
  inputsAt(RING, t, 0, x);
  expect(Array.from(x).map((v) => Math.round(v * 10))).toEqual([1, 4, 2]);
  inputsAt(RING, t, 3, x);
  expect(Array.from(x).map((v) => Math.round(v * 10))).toEqual([4, 3, 1]);
});

test("turning a ring turns its answer the same way", () => {
  const m = ruleOf(RING, { own: { free: 2 }, beside: { free: 0.5 } });
  const rows = [0.9, 0.1, 0.4, 0.8, 0.2, 0.6];
  const a = tableFor(RING, 6), b = tableFor(RING, 6);
  a.clear(6);
  b.clear(6);
  a.rows.set(rows);
  b.rows.set(rows.map((_, i) => rows[(i + 2) % 6]!));
  const pa = decide(m, RING, a), pb = decide(m, RING, b);
  expect(pb).toBe((pa + 6 - 2) % 6);
  for (let i = 0; i < 6; i++) expect(b.out[i]).toBeCloseTo(a.out[(i + 2) % 6]!, 6);
});

test("the state changes nothing through a line of weights, and a cross lets it reverse the choice", () => {
  const plain = profile("test.urgent", "choice", false, ["urgency"], ["priority", "travel"]);
  const crossed = profile("test.urgent", "choice", false, ["urgency"], ["priority", "travel"], [["urgency", "travel"]]);
  const pick = (p: typeof plain, m: Model, urgency: number): [number, number] => {
    const t = tableFor(p, 2);
    t.clear(2);
    t.state[0] = urgency;
    // A wanted place far off, and a lesser one near.
    t.rows.set([1, 0.9, 0.5, 0.1]);
    const chosen = decide(m, p, t);
    return [chosen, Math.round(t.out[0]! * 1000)];
  };
  // However the state is weighed, it adds the same to both and the probabilities do not move.
  const flat = ruleOf(plain, { state: { urgency: 4 }, own: { priority: 3, travel: -1 } });
  expect(pick(plain, flat, 0)).toEqual(pick(plain, flat, 1));
  // With urgency crossed into the travel time, the same two places are chosen the other way round in a hurry.
  const hurry = ruleOf(crossed, { own: { priority: 3, travel: -1 }, cross: { "urgency*travel": -3 } });
  expect(pick(crossed, hurry, 0)[0]).toBe(0);
  expect(pick(crossed, hurry, 1)[0]).toBe(1);
  expect(inputsOf(crossed)).toBe(inputsOf(plain) + 1);
  expect(profileHash(crossed)).not.toBe(profileHash(plain));
  expect(() => profile("bad", "choice", false, ["a"], ["b"], [["a", "c" as "b"]])).toThrow();
});

test("the rules use their crosses: pain is paid deep in trouble, and haste picks the nearer place", () => {
  const t = tableFor(RING_MID, 4), c = RING_MID.c, w = RING_MID.columns.length;
  const wade = (rung: number): number => {
    t.clear(4);
    t.state[RING_MID.s.rung] = rung;
    // Open water to the north, and the only dry way a short run to the south.
    t.rows[0 * w + c.run] = t.rows[0 * w + c.runHigh] = 1;
    t.rows[0 * w + c.wet] = 1;
    t.rows[0 * w + c.hurt] = 0.6;
    t.rows[2 * w + c.run] = t.rows[2 * w + c.runHigh] = 0.45;
    return decide(RULE_MID, RING_MID, t);
  };
  expect([wade(0), wade(1)]).toEqual([2, 0]);
  const p = tableFor(PICK, 2), pc = PICK.c, pw = PICK.columns.length;
  const place = (urgency: number): number => {
    p.clear(2);
    p.state[PICK.s.urgency] = urgency;
    p.rows[0 * pw + pc.priority] = 1;
    p.rows[0 * pw + pc.travelSoon] = 0.9;
    p.rows[1 * pw + pc.priority] = 0.6;
    p.rows[1 * pw + pc.travelSoon] = 0.1;
    return decide(RULE_PICK, PICK, p);
  };
  expect([place(0), place(1)]).toEqual([0, 1]);
});

test("passes over the same candidates add, and a heading any pass masks stays masked", () => {
  const far = tableFor(RING, 3), near = tableFor(RING, 3), all = tableFor(RING, 3);
  for (const t of [far, near, all]) t.clear(3);
  far.score.set([3, 2, 0]);
  near.score.set([0, 1, 4]);
  near.mask[2] = 1;
  far.bias[1] = 0.25;
  addPass(all, far, 1);
  addPass(all, near, 2);
  expect(Array.from(all.score.subarray(0, 3))).toEqual([3, 4, 8]);
  expect(answer("choice", all)).toBe(1);
  expect(all.bias[1]).toBe(0.25);
  // The heading held is a little likelier to be held again.
  all.mask[2] = 0;
  all.score.set([3, 3, 3]);
  all.bias.fill(0);
  stick(all, 2, 0.5);
  expect(answer("choice", all)).toBe(2);
});

test("weights are read only for the profile and columns they were made for", () => {
  const m = ruleOf(PLAIN, { own: { good: 1.5 }, constant: -0.25 });
  m.temperature = 1.5;
  const file = JSON.parse(JSON.stringify(writeModel(m, { from: "a test" })));
  const back = readModel(file, PLAIN);
  expect(typeof back).toBe("object");
  expect(Array.from((back as Model).w1)).toEqual(Array.from(m.w1));
  expect([(back as Model).b2, (back as Model).temperature]).toEqual([-0.25, 1.5]);
  const moved = profile("test.plain", "choice", false, ["calm"], ["bad", "good"]);
  expect(readModel(file, moved)).toContain("other columns");
  expect(readModel(file, RING)).toContain("not test.ring");
  expect(readModel({ ...file, w1: [1] }, PLAIN)).toContain("wrong length");
  expect(readModel(null, PLAIN)).toContain("not a weights file");
});

test("every profile has a hand rule of its own size", () => {
  expect(RULES.map((m) => m.profile).sort()).toEqual(PROFILES.map((p) => p.name).sort());
  for (const p of PROFILES) {
    const m = RULES.find((r) => r.profile === p.name)!;
    expect([p.name, m.inputs, m.hash]).toEqual([p.name, inputsOf(p), profileHash(p)]);
    expect(readModel(writeModel(m), p)).not.toBeString();
  }
  expect(linear(RING_MID, 1).w1.length).toBe(RING_MID.state.length + 3 * RING_MID.columns.length + RING_MID.crosses.length);
});

test("the mid rule picks the free heading, wider openings first, and shuns one that failed", () => {
  const t = tableFor(RING_MID, 8);
  const c = RING_MID.c, w = RING_MID.columns.length;
  const fill = (runs: number[]): void => {
    t.clear(8);
    for (let i = 0; i < 8; i++) t.rows[i * w + c.run] = t.rows[i * w + c.runHigh] = runs[i]!;
  };
  // A wall ahead, a narrow gap at 2 and a wide opening at 5 to 7.
  fill([0.1, 0.1, 1, 0.1, 0.1, 1, 1, 1]);
  expect(decide(RULE_MID, RING_MID, t)).toBe(6);
  t.rows[6 * w + c.tried] = 1;
  expect([5, 7]).toContain(decide(RULE_MID, RING_MID, t));
  // Free ground that drops away loses to ground that does not.
  fill([1, 1, 0, 0, 0, 0, 0, 0]);
  t.rows[0 * w + c.drop] = 1;
  expect(decide(RULE_MID, RING_MID, t)).toBe(1);
});

test("the snag rule is surer the slower a mover gains and nearly sure once it is stuck", () => {
  const t = tableFor(SNAG, 1), c = SNAG.c;
  const ask = (pace: number, gain: number, stuck: number): number => {
    t.clear(1);
    t.rows[c.pace] = pace;
    t.rows[c.gain1] = t.rows[c.gain2] = t.rows[c.gain4] = gain;
    t.rows[c.stuck] = stuck;
    decide(RULE_SNAG, SNAG, t);
    return t.out[0]!;
  };
  const moving = ask(1, 1, 0), slowing = ask(0.3, 0.2, 0.3), stuck = ask(0, 0, 1);
  expect(moving).toBeLessThan(0.05);
  expect(slowing).toBeGreaterThan(moving);
  expect(stuck).toBeGreaterThan(slowing);
  expect(stuck).toBeGreaterThan(0.7);
});

test("the engine names nothing outside its own folder", () => {
  const dir = join(import.meta.dir, "../../shared/decide");
  for (const file of readdirSync(dir)) {
    const outside = [...readFileSync(join(dir, file), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!).filter((from) => !/^\.\/[a-z-]+\.ts$/.test(from));
    expect([file, outside]).toEqual([file, []]);
  }
  // Its own hash is the game's, so a profile's hash is the same wherever the engine is lifted to.
  for (const s of ["", "ring.mid|choice", "né 日本"]) expect(ownHash(s)).toBe(hashString(s));
});

test("a span is never under the world's grain nor under a reaction's run", () => {
  // A rex is measured by its own radius, a dodo by the grain, a missile by how far it flies before it can react.
  expect(span(2.5, 1, 6, 0.1)).toBe(2.5);
  expect(span(0.4, 1, 1.5, 0.1)).toBe(1);
  expect(span(0.05, 1, 100, 0.1)).toBe(10);
  expect([unit(5, 4), unit(-1, 4), unit(1, 4)]).toEqual([1, 0, 0.25]);
  expect([signed(-9, 4), signed(2, 4)]).toEqual([-1, 0.5]);
  expect([soon(0, 3), soon(3, 3)]).toEqual([0, 0.5]);
});
