import { expect, test } from "bun:test";
import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { Governor, JOIN_MS, ladder, middleMean } from "../../client/core/governor.ts";
import { HudModel } from "../../client/core/hud.ts";
import { curve, leaves, phoneSoaks, run } from "../fixtures/frames.ts";

/** Each step leaves this share of the GPU's time: a made-up card on which every step buys a little. */
const leave = (level: number): number => 0.88 ** level;
/**
 * The share of the GPU's time each of high's steps left of the level before on this Mac, in tools/bench/gpu.ts's base
 * scene at the iPhone's pixel ratio, frame by frame the least of three runs at a load of 5 to 17 (a step that measured
 * slower is taken as buying nothing). A louder run in this order gave 0.73 and 0.58 for the first two and nothing past.
 */
const MAC_SHARES: Readonly<Record<string, number>> = {
  "the farther cascade every other frame": 0.894,
  "shadows to 60% as far": 0.704,
  "85% of the pixels a side": 1,
  "far trees, rocks and bushes to 70% as far": 0.99,
  "one cascade fewer": 0.772,
  "70% of the pixels a side": 0.937,
  "no sun shadows": 1,
};

test("a tier's levels are its steps that change something, in the frame's order from its foot, and none touches the near nodes or the far bases", () => {
  const names = (tier: string, dpr: number) => ladder(tierOf(tier), dpr).map((l) => l.name);
  expect(names("high", 3)).toEqual(["the tier", "leaves: the frame's triangles to 75%", "far trees, rocks and bushes to 70% as far", "leaves: the frame's triangles to 50%", "the farther cascade every other frame", "shadows to 60% as far", "one cascade fewer", "no sun shadows", "85% of the pixels a side", "70% of the pixels a side", "bodies a level coarser"]);
  // A screen of one device pixel a CSS pixel has no pixels to spare; low poly casts nothing.
  expect(names("medium", 1)).not.toContain("85% of the pixels a side");
  expect(names("lowpoly", 1)).toEqual(["the tier", "leaves: the frame's triangles to 75%", "far trees, rocks and bushes to 70% as far", "leaves: the frame's triangles to 50%", "bodies a level coarser"]);
  expect(ladder(tierOf("medium"), 3).map((l) => [l.tier.budget.triangles, l.tier.bodyError])).toEqual([[2e6, 1], [1.5e6, 1], [1.5e6, 1], ...Array(7).fill([1e6, 1]), [1e6, 2]]);
  for (const t of TIERS) {
    for (const { tier } of ladder(t, 3)) {
      expect([tier.nodes, tier.reach.bases, tier.split, tier.view, tier.texture, tier.name]).toEqual([t.nodes, t.reach.bases, t.split, t.view, t.texture, t.name]);
      expect(tier.pixelRatio === t.pixelRatio || tier.pixelRatio >= 1).toBe(true);
    }
  }
  // The same tier and screen give the same copies, so the renderer's programs are made once.
  expect(ladder(tierOf("high"), 3)[3]!.tier).toBe(ladder(tierOf("high"), 3)[3]!.tier);
});

test("the mean of the middle eight tenths is not moved by a hitch", () => {
  expect(middleMean([...Array(19).fill(16.7), 400])).toBeCloseTo(16.7, 5);
  expect(middleMean([...Array(10).fill(16.7), ...Array(10).fill(33.3)])).toBeCloseTo(25, 5);
});

test("the iPhone's kept soaks, replayed with what each step left on this Mac's GPU, end no slower than their first minute", () => {
  const soaks = phoneSoaks();
  expect(soaks.length).toBe(3);
  for (const { points, tier } of soaks) {
    const left = leaves(tier, 3, MAC_SHARES);
    const { minutes, governor } = run(10, (t, level) => ({ gpu: curve(points)(t) * left[level]! }), { tier });
    expect(minutes.at(-1)!.median).toBeLessThanOrEqual(Math.min(points[0]!, minutes[0]!.median) + 0.5);
    for (const m of minutes.slice(1)) expect(m.median).toBeLessThan(17.8);
    // It went down as the phone warmed, and never tried back up while it did.
    expect(governor.steps.length).toBeGreaterThanOrEqual(2);
    expect(governor.steps.filter((s) => s.why.startsWith("the try missed")).length).toBe(0);
  }
});

test("a hitch, a collected heap, uploads, a hidden page and a lost context are no reason to step", () => {
  const { governor } = run(5, (t) => {
    const s = Math.floor(t / 1000);
    if (s === 60 && t % 1000 < 20) return { gpu: 400 };
    if (s === 90) return { gpu: 14, gap: 30000 };
    if (s >= 120 && s < 125) return { gpu: 45, busy: true };
    if (s >= 150 && s < 152) return { gpu: 60 };
    return { gpu: 14 };
  });
  expect(governor.steps).toEqual([]);
  // A lost context: the page draws nothing and then sends everything again.
  const g = new Governor();
  run(1, () => ({ gpu: 14 }), { governor: g });
  g.pause(60000);
  run(1, (t) => ({ gpu: t < 15000 ? 40 : 14 }), { governor: g });
  expect(g.steps).toEqual([]);
});

test("nothing counts in the first seconds after a join, or after a tier the player chose", () => {
  const { governor } = run(0.24, () => ({ gpu: 30 }));
  expect(governor.steps).toEqual([]);
  const g = run(1, (_, level) => ({ gpu: 30 * leave(level) })).governor;
  expect(g.level).toBeGreaterThan(0);
  // The player picks another tier: the governor starts again from it, and waits.
  expect(g.tier(tierOf("medium"), true, 3, 61000)).toBe(tierOf("medium"));
  expect(g.level).toBe(0);
  expect(g.steps.at(-1)!.why).toBe("a tier chosen");
  expect(JOIN_MS).toBeGreaterThanOrEqual(10000);
});

test("main-thread load is not the GPU's, and steps that buy nothing are undone", () => {
  // Our code takes 22 of 25 ms: no GPU step would help.
  expect(run(5, () => ({ gpu: 8, ours: 25 })).governor.steps).toEqual([]);
  // A display held at 30 a second (an iPhone saving power): every frame 33 ms, the GPU idle. Not a reason to step.
  expect(run(5, () => ({ gpu: 5, display: 1000 / 30 })).governor.steps).toEqual([]);
  // Frames slowed by something no step touches, the GPU idle as far as our code can tell. A step buys nothing, so does
  // the next, and both are undone and passed over; the governor rests 1, 2, 4 and 8 minutes, tries the steps not passed
  // over, and ends at the tier. With no crowns near to give, the leaves steps (1 and 3) are passed by.
  const { governor } = run(20, () => ({ gpu: 24 }));
  expect(governor.level).toBe(0);
  const rests = governor.steps.filter((s) => s.why.includes("not what is slow")).length;
  expect(rests).toBeLessThanOrEqual(5);
  expect(governor.steps.length).toBeLessThanOrEqual(rests * 3);
  expect(governor.steps.filter((s) => s.why.endsWith("ms a frame")).map((s) => s.level)).toEqual([2, 5, 7, 9]);
  // A step this card does not need is passed for the next, which it does.
  const passed = run(2, (_, level) => ({ gpu: 20 * [1, 0.95, 0.95, 0.8][Math.min(level, 3)]!, crowns: 1e6 })).governor;
  expect(passed.steps.map((s) => s.level)).toEqual([1, 2, 3]);
  expect(passed.steps[2]!.why).toBe("the step before took 19 ms to 19");
  // Two that buy nothing are undone and passed over, and the next miss goes to the step past them.
  const over = run(3, (_, level) => ({ gpu: 22 * [1, 0.9, 0.9, 0.9, 0.7][Math.min(level, 4)]!, crowns: 1e6 })).governor;
  expect(over.steps.map((s) => s.level)).toEqual([1, 2, 3, 1, 4]);
});

test("leaves go first where crowns near can give, and are passed by where they cannot", () => {
  // A wood: crowns near take a third of the frame, and the first step buys enough.
  const wood = run(3, (_, level) => ({ gpu: 19 * leave(level), work: 3e6, crowns: 1e6 })).governor;
  expect(wood.steps.map((s) => s.name)).toEqual(["leaves: the frame's triangles to 75%"]);
  // A base with no trees: the first step taken is the far trees', then the shadows'.
  const base = run(3, (_, level) => ({ gpu: 24 * leave(level), work: 3e6 })).governor;
  expect(base.steps.map((s) => s.name).slice(0, 2)).toEqual(["far trees, rocks and bushes to 70% as far", "the farther cascade every other frame"]);
});

test("a scene too heavy for good goes to the last step and stays there, trying the level above rarely", () => {
  const { minutes, governor } = run(40, (_, level) => ({ gpu: 60 * leave(level) }));
  expect(minutes.at(-1)!.level).toBe(ladder(tierOf("high"), 3).length - 1);
  const tries = governor.steps.filter((s) => s.why.includes("with no missed frame")).length;
  expect(tries).toBeLessThanOrEqual(5);
  // Each try missed and was undone at once.
  expect(governor.steps.filter((s) => s.why.startsWith("the try missed")).length).toBe(tries);
});

test("a scene that lightens is drawn at its tier again, and one that lightens and comes back does not flap", () => {
  // Heavy for two minutes, then a fifth of the work and of the GPU's time.
  const { minutes } = run(10, (t, level) => (t < 120000 ? { gpu: 26 * leave(level), work: 3e6 } : { gpu: 6 * leave(level), work: 6e5 }));
  expect(minutes[1]!.most).toBeGreaterThan(1);
  expect(minutes.at(-1)!.level).toBe(0);
  // A camera that turns from a heavy base to the sea and back every 20 s for twenty minutes.
  const turning = run(12, (t, level) => (Math.floor(t / 20000) % 2 === 0 ? { gpu: 24 * leave(level), work: 3e6 } : { gpu: 9 * leave(level), work: 6e5 }));
  const tries = turning.governor.steps.filter((s) => s.level < (turning.governor.steps[turning.governor.steps.indexOf(s) - 1]?.level ?? 0)).length;
  expect(tries).toBeLessThanOrEqual(8);
});

test("where the GPU is timed, a desktop whose frames come in whole display intervals steps only when the GPU is full", () => {
  // The GPU takes 12 ms but frames come at 16.7 and 33.3 by turns, as a busy compositor may give them.
  const idle = run(5, (t) => ({ gpu: 12, timed: true, display: Math.floor(t / 16.7) % 2 ? 1000 / 30 : 1000 / 60 }), { quantized: true });
  expect(idle.governor.steps).toEqual([]);
  // A GPU at 22 ms is stepped down until it fits, and the step up is tried only where the steps say it would fit.
  const full = run(10, (_, level) => ({ gpu: 22 * leave(level), timed: true }), { quantized: true });
  expect(full.governor.level).toBeGreaterThan(0);
  expect(full.minutes.at(-1)!.median).toBeLessThan(17.2);
  expect(full.governor.steps.filter((s) => s.why.startsWith("the try missed")).length).toBe(0);
});

test("the frame numbers say what the governor did", () => {
  const hud = new HudModel();
  [hud.fps, hud.steady] = [60, " (2 down: 85% of the pixels a side)"];
  hud.formatReadout();
  expect(hud.readout[2]!.startsWith("60 fps (2 down: 85% of the pixels a side)  ")).toBe(true);
});

test("a held level never moves, as the pages that pin pictures and hashes have it", () => {
  const g = new Governor();
  g.held = 0;
  const { governor } = run(3, () => ({ gpu: 40 }), { governor: g });
  expect([governor.level, governor.steps.length]).toEqual([0, 0]);
  g.held = 2;
  expect(g.tier(tierOf("high"), true, 3, 0)).toBe(ladder(tierOf("high"), 3)[2]!.tier);
  // Turned off by the player, the tier is drawn as it is.
  const on = run(1, (_, level) => ({ gpu: 30 * leave(level) })).governor;
  expect(on.tier(tierOf("high"), false, 3, 70000)).toBe(tierOf("high"));
});
