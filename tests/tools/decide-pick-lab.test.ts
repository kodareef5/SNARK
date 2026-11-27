// The lab for nav.pick and nav.reach (tools/decide/pick.ts): seeded scenes, the cost, the oracle and the report.
import { expect, test } from "bun:test";
import type { Pin } from "../../server/pins.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { PICK_FAMILIES, REACH_FAMILIES, againstPick, costOf, drawPick, earlyGiveUp, groupLine, seePick, type Played, type PickSeen } from "../../tools/decide/pick.ts";

const played = (arrived: number[], extra: Partial<Played> = {}): Played => ({ arrived, failed: arrived.map(() => -1), ended: -1, danger: 0, cost: 0, first: 0, pickMicros: [], reachMicros: [], priceMicros: [], decideMicros: [], hash: 0, ...extra });

test("every family draws the same scene from a seed, and another from the next", () => {
  for (const family of [...PICK_FAMILIES, ...REACH_FAMILIES]) {
    const a = drawPick(family, 4), b = drawPick(family, 4), c = drawPick(family, 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(a.choices.some((ch) => !ch.detour)).toBe(true);
    expect(a.course).toBe((REACH_FAMILIES as readonly string[]).includes(family));
  }
});

test("a choice missed costs two horizons, a priority weighs twice a step, a detour visited takes its worth off", () => {
  const s = drawPick("priority", 1), H = s.horizon / TICK_RATE;
  const [lo, hi] = [s.choices[0]!.place.priority, s.choices[1]!.place.priority];
  const w = [2 ** lo, 2 ** hi];
  expect(costOf(s, [], played([10, 20]))).toBeCloseTo((w[0]! * 10 + w[1]! * 20) / (w[0]! + w[1]!), 6);
  expect(costOf(s, [], played([10, -1]))).toBeCloseTo((w[0]! * 10 + w[1]! * 2 * H) / (w[0]! + w[1]!), 6);
  const d = drawPick("detour", 1);
  expect(costOf(d, [], played([30, 12])) - costOf(d, [], played([30, -1]))).toBeCloseTo(-10, 6);
  const pin = { x: 0, z: 0, radius: 1, pull: -1 } as Pin;
  expect(costOf(d, [pin], played([30, -1], { danger: 2 })) - costOf(d, [pin], played([30, -1]))).toBeCloseTo(6, 6);
});

test("a choice near by line and far by way: the oracle forces each, and the rule's is the cheaper", () => {
  const s = drawPick("wayFar", 3);
  const seen = seePick(s);
  expect(seen.forced.length).toBe(2);
  expect(seen.forced.every((c) => Number.isFinite(c))).toBe(true);
  // The rule's cost is that of the candidate it picked, played again.
  expect(Math.abs(seen.forced[seen.rulePick]! - seen.rule.cost)).toBeLessThan(1);
  expect(seen.rule.cost).toBeLessThanOrEqual(seen.today.cost);
  expect(groupLine("wayFar", [seen])).toContain("headroom");
});

test("a leg shut in is given up early under the rule, and rightly", () => {
  const seen = seePick(drawPick("shutIn", 2));
  expect(seen.today.arrived[0]).toBe(-1);
  expect(earlyGiveUp(seen, seen.rule)).toBe("right");
  expect(seen.rule.cost).toBeLessThan(seen.today.cost);
  // The oracle gives it up at once, or never: at once is the cheaper.
  expect(seen.forced[0]!).toBeLessThan(seen.forced[1]!);
});

test("against an earlier run, a scene that reaches fewer ends is lost and more is gained", () => {
  const one = (arrived: number[]): PickSeen => ({ family: "wayFar", seed: 1, kind: "core:raptor", fact: "", course: false, detours: [0, 0], today: played(arrived), rule: played(arrived), forced: [], rulePick: 0 });
  expect(againstPick([one([5, 9])], [one([5, -1])], "rule").lost.length).toBe(1);
  expect(againstPick([one([5, -1])], [one([5, 9])], "rule").gained.length).toBe(1);
  expect(againstPick([one([5, 9])], [one([6, 9])], "today")).toEqual({ gained: [], lost: [] });
});
