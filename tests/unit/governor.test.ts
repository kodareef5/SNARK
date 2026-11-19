import { expect, test } from "bun:test";
import { TIERS, canvasRatio, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { Governor, JOIN_MS, PHONE_MS, TARGET_MS, ladder, middleMean, workMs } from "../../client/core/governor.ts";
import { HudModel } from "../../client/core/hud.ts";
import { levels, replay, sceneOf } from "../../tools/bench/governor.ts";
import { phoneSoaks, run } from "../fixtures/frames.ts";
import { artTest } from "../fixtures/needs-art.ts";

/** Each step leaves this share of the GPU's time: a made-up card on which every step buys a little. */
const leave = (level: number): number => 0.88 ** level;

test("a tier's levels are its steps that change something, the light target first, then levels and leaves and small details last, none takes the sun's shadows, and none touches the near nodes or the far bases", () => {
  const names = (tier: string, dpr: number) => ladder(tierOf(tier), dpr).map((l) => l.name);
  const details = "small details: half the pool, of each burst and of the fill";
  const levels = ["levels: half again the error", "levels: twice the error", "levels: three times the error"];
  const city = "the far city's levels to 70% as far";
  const target = "no light target";
  expect(names("high", 3)).toEqual(["the tier", target, levels[0], city, "leaves: the frame's triangles to 75%", "the farther cascade every other frame", levels[1], "far trees, rocks and bushes to 70% as far", "leaves: the frame's triangles to 50%", levels[2], "one cascade fewer", "bodies a level coarser", "85% of the pixels a side", "70% of the pixels a side", details]);
  // A screen of one device pixel a CSS pixel has no pixels to spare; low poly casts nothing.
  expect(names("medium", 1)).not.toContain("85% of the pixels a side");
  expect(names("lowpoly", 1)).toEqual(["the tier", levels[0], city, "leaves: the frame's triangles to 75%", levels[1], "far trees, rocks and bushes to 70% as far", "leaves: the frame's triangles to 50%", levels[2], "bodies a level coarser", details]);
  const medium = ladder(tierOf("medium"), 3).map((l) => [l.tier.budget.triangles, Math.round(l.tier.threshold * 100) / 100, l.tier.shadows.cascades, l.tier.bodyError, l.tier.pixelRatio, l.tier.details.pool]);
  expect(medium).toEqual([[2e6, 0.22, 2, 1, 1.5, 1536], [2e6, 0.33, 2, 1, 1.5, 1536], [2e6, 0.33, 2, 1, 1.5, 1536], [1.5e6, 0.33, 2, 1, 1.5, 1536], [1.5e6, 0.33, 2, 1, 1.5, 1536], [1.5e6, 0.44, 2, 1, 1.5, 1536], [1.5e6, 0.44, 2, 1, 1.5, 1536], [1e6, 0.44, 2, 1, 1.5, 1536], [1e6, 0.66, 2, 1, 1.5, 1536], [1e6, 0.66, 1, 1, 1.5, 1536], [1e6, 0.66, 1, 2, 1.5, 1536], [1e6, 0.66, 1, 2, 1.27, 1536], [1e6, 0.66, 1, 2, 1.05, 1536], [1e6, 0.66, 1, 2, 1.05, 768]]);
  // The far city's step draws the same forms nearer, so nothing made of them is made again.
  const form = ({ to: _, ...f }: { to: number }) => f;
  const [atTier, nearer] = [ladder(tierOf("medium"), 3)[1]!.tier.city.levels, ladder(tierOf("medium"), 3)[2]!.tier.city.levels];
  expect([nearer.map(form), nearer.map((l) => l.to)]).toEqual([atTier.map(form), atTier.map((l) => l.to * 0.7)]);
  for (const t of TIERS) {
    for (const { tier } of ladder(t, 3)) {
      expect([tier.nodes, tier.reach.bases, tier.split, tier.view, tier.texture, tier.name, tier.shadows.distance, tier.shadows.size]).toEqual([t.nodes, t.reach.bases, t.split, t.view, t.texture, t.name, t.shadows.distance, t.shadows.size]);
      expect(tier.pixelRatio === t.pixelRatio || tier.pixelRatio >= 1).toBe(true);
    }
  }
  // The same tier and screen give the same copies, so the renderer's programs are made once.
  expect(ladder(tierOf("high"), 3)[3]!.tier).toBe(ladder(tierOf("high"), 3)[3]!.tier);
});

test("high and ultra give back the light target first of all, which keeps the grade and contact, and no tier draws past the screen's own pixels to give back", () => {
  const own = "no more pixels than the screen's own";
  const target = "no light target";
  const names = (tier: string, dpr: number) => ladder(tierOf(tier), dpr).map((l) => l.name);
  const after = ["small details: half the pool, of each burst and of the fill"];
  expect(names("ultra", 1).slice(0, 3)).toEqual(["the tier", target, "levels: half again the error"]);
  expect(names("ultra", 1).slice(-2)).toEqual(["bodies a level coarser", ...after]);
  expect(names("ultra", 1.5).slice(-4)).toEqual(["bodies a level coarser", "85% of the pixels a side", "70% of the pixels a side", ...after]);
  for (const t of TIERS) for (const dpr of [1, 1.5, 2, 3]) expect(names(t.name, dpr).includes(own)).toBe(false);
  for (const t of TIERS) expect(names(t.name, 3).includes(target)).toBe(t.post !== null);
  const ultra = ladder(tierOf("ultra"), 1);
  expect(ultra.map((l) => [l.tier.post !== null, l.tier.contact])).toEqual([[true, true], ...ultra.slice(1).map(() => [false, true])]);
  expect(ultra.map((l) => canvasRatio(l.tier, 1.5, 2560, 1440)).slice(0, 3)).toEqual([1.5, 1.5, 1.5]);
});

test("a frame's work counts what it casts into the sun's maps beside what it draws, at the iPhone's costs", () => {
  expect(workMs(1e6, 0, 0, 0, 1024)).toBeCloseTo(6.5, 5);
  // A triangle cast into the touch rule's 1,024 maps asks a quarter of what drawing it does, into a 2,048 one three fifths.
  expect(workMs(0, 0, 1e6, 0, 1024) / workMs(1e6, 0, 0, 0, 1024)).toBeCloseTo(0.28, 2);
  expect(workMs(0, 0, 1e6, 0, 2048) / workMs(1e6, 0, 0, 0, 1024)).toBeCloseTo(0.58, 2);
  expect(workMs(0, 1024, 0, 1024, 1024)).toBeCloseTo(2048 * PHONE_MS.draw, 5);
});

test("the mean of the middle eight tenths is not moved by a hitch", () => {
  expect(middleMean([...Array(19).fill(16.7), 400])).toBeCloseTo(16.7, 5);
  expect(middleMean([...Array(10).fill(16.7), ...Array(10).fill(33.3)])).toBeCloseTo(25, 5);
});

artTest("the iPhone's kept soaks, replayed with what each step leaves of the phone's GPU in the soak's own scene, hold 60 a second at minute 10 and never step back while the phone warms", () => {
  const soaks = phoneSoaks();
  expect(soaks.length).toBe(3);
  for (const soak of soaks) {
    const rows = levels(sceneOf(soak), forTouch(tierOf(soak.tier), true), 4);
    const left = rows.map((r) => r.ms / rows[0]!.ms);
    // Every level leaves less than the one before it, or the same where its step has nothing to take in the scene.
    for (let l = 1; l < left.length; l++) expect(left[l]!).toBeLessThanOrEqual(left[l - 1]! + 0.005);
    const { minutes, steps } = replay(soak, left);
    expect(minutes[9]!.median, soak.name).toBeLessThanOrEqual(TARGET_MS + 0.5);
    for (const m of minutes.slice(1)) expect(m.median, soak.name).toBeLessThan(17.8);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.filter((s) => s.name.startsWith("back from")), soak.name).toEqual([]);
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
  // Frames slowed by something no step touches, and not paced by the display. A step buys nothing, so does the next,
  // and both are undone and passed over; the governor rests 1, 2, 4 and 8 minutes, tries the steps not passed over, and
  // ends at the tier. With no crowns near to give and no far city, the leaves steps (4 and 8) and the far city's (3) are
  // passed by.
  const { governor } = run(20, (t) => ({ gpu: 24 + 3 * Math.sin(t / 37) }));
  expect(governor.level).toBe(0);
  const rests = governor.steps.filter((s) => s.why.includes("not what is slow")).length;
  expect(rests).toBeLessThanOrEqual(5);
  expect(governor.steps.length).toBeLessThanOrEqual(rests * 3);
  expect(governor.steps.filter((s) => s.why.endsWith("ms a frame")).map((s) => s.level)).toEqual([1, 5, 7, 10, 12]);
  // A step this card does not need is passed for the next, which it does.
  const passed = run(2, (_, level) => ({ gpu: 20 * [1, 0.95, 0.95, 0.8][Math.min(level, 3)]!, crowns: 1, city: 1 })).governor;
  expect(passed.steps.map((s) => s.level)).toEqual([1, 2, 3]);
  expect(passed.steps[2]!.why).toBe("the step before took 19 ms to 19");
  // Two that buy nothing are undone and passed over, and the next miss goes to the step past them.
  const over = run(3, (_, level) => ({ gpu: 22 * [1, 0.9, 0.9, 0.9, 0.7][Math.min(level, 4)]!, crowns: 1, city: 1 })).governor;
  expect(over.steps.map((s) => s.level)).toEqual([1, 2, 3, 1, 4]);
});

test("leaves give where crowns near can and the far city's step where it draws much, and each is passed by where it cannot", () => {
  // A wood: crowns near take a third of the frame. The light target and levels give first, then leaves.
  const target = "no light target";
  const wood = run(3, (_, level) => ({ gpu: 24 * leave(level), work: 20, crowns: 7 })).governor;
  expect(wood.steps.map((s) => s.name)).toEqual([target, "levels: half again the error", "leaves: the frame's triangles to 75%"]);
  // A base with no trees: from levels to the farther cascade, the leaves' step passed by, and the far city's.
  const base = run(3, (_, level) => ({ gpu: 24 * leave(level), work: 20 })).governor;
  expect(base.steps.map((s) => s.name)).toEqual([target, "levels: half again the error", "the farther cascade every other frame"]);
  // Downtown: the far city a third of the frame's work. Levels give first, then the far city's levels nearer.
  const downtown = run(3, (_, level) => ({ gpu: 24 * leave(level), work: 20, city: 7 })).governor;
  expect(downtown.steps.map((s) => s.name)).toEqual([target, "levels: half again the error", "the far city's levels to 70% as far"]);
});

test("a scene too heavy for good goes to the last step and stays there, trying the level above rarely", () => {
  const { minutes, governor } = run(40, (_, level) => ({ gpu: 108 * leave(level) }));
  expect(minutes.at(-1)!.level).toBe(ladder(tierOf("high"), 3).length - 1);
  const tries = governor.steps.filter((s) => s.why.includes("with no missed frame")).length;
  expect(tries).toBeLessThanOrEqual(5);
  // Each try missed and was undone at once.
  expect(governor.steps.filter((s) => s.why.startsWith("the try missed")).length).toBe(tries);
});

test("a scene that lightens is drawn at its tier again, and one that lightens and comes back does not flap", () => {
  // Heavy for two minutes, then a fifth of the work and of the GPU's time.
  const { minutes } = run(10, (t, level) => (t < 120000 ? { gpu: 26 * leave(level), work: 20 } : { gpu: 6 * leave(level), work: 4 }));
  expect(minutes[1]!.most).toBeGreaterThan(1);
  expect(minutes.at(-1)!.level).toBe(0);
  // A camera that turns from a heavy base to the sea and back every 20 s for twelve minutes.
  const turning = run(12, (t, level) => (Math.floor(t / 20000) % 2 === 0 ? { gpu: 24 * leave(level), work: 20 } : { gpu: 9 * leave(level), work: 4 }));
  const tries = turning.governor.steps.filter((s) => s.level < (turning.governor.steps[turning.governor.steps.indexOf(s) - 1]?.level ?? 0)).length;
  expect(tries).toBeLessThanOrEqual(8);
});

test("with no GPU timer and a display that shows only whole intervals, a GPU at 22 ms that reads as a steady 33.3 is stepped down until frames come at 16.7, and a try back up that finds 33.3 again is undone", () => {
  // A card with no crowns near and no far city, on which the leaves' and the far city's steps buy nothing.
  const bought = (level: number): number => ladder(tierOf("high"), 3).slice(1, level + 1).filter((l) => !l.leaves && !l.city).length;
  const { minutes, governor } = run(30, (_, level) => ({ gpu: 22 * leave(bought(level)) }), { quantized: true });
  expect(governor.steps[0]!.why).toBe("33 ms a frame, 2 display intervals");
  expect(governor.level).toBeGreaterThan(0);
  for (const m of minutes.slice(2)) expect(m.median).toBeLessThan(17.2);
  const tries = governor.steps.filter((s) => s.why.includes("with no missed frame"));
  expect(tries.length).toBeGreaterThan(0);
  expect(governor.steps.filter((s) => s.why.startsWith("the try missed")).length).toBe(tries.length);
  expect(governor.paced).toBe(0);
});

test("a display at half rate, saving power, is told from a slow GPU by stepping once through the ladder, which moves nothing: the tier comes back and is kept", () => {
  for (const quantized of [true, false]) {
    const { minutes, governor } = run(20, () => ({ gpu: 5, display: 1000 / 30 }), { quantized });
    // Every level but the leaves' and the far city's, passed by with no crowns near to give and no city, and then back to
    // the tier.
    const every = ladder(tierOf("high"), 3).flatMap((l, k) => (k > 0 && !l.leaves && !l.city ? [k] : []));
    expect(governor.steps.map((s) => s.level)).toEqual([...every, 0]);
    expect(governor.steps.at(-1)!.why).toBe("frames stayed at 33 ms at every level: the display's rate");
    expect([governor.level, Math.round(governor.paced)]).toEqual([0, 33]);
    expect(minutes.at(-1)!.level).toBe(0);
    expect(minutes.slice(2).every((m) => m.most === 0)).toBe(true);
  }
  // Shown faster again, as when the phone leaves its power saving, it is a 60 a second display once more, and a GPU that
  // then falls behind it is stepped down.
  const back = run(12, (t, level) => (t < 300000 ? { gpu: 5, display: 1000 / 30 } : { gpu: (t < 420000 ? 5 : 22) * leave(level) })).governor;
  expect(back.paced).toBe(0);
  expect(back.level).toBeGreaterThan(0);
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
