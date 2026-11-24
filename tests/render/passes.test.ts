import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { HAND_NEAR } from "../../client/core/render/hand.ts";
import { DRAW_BLEND, DRAW_WATER, FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { BENCH_FRAMES, PASSES, PASS_CASTERS, PASS_DOME, PASS_NEAR, PassClock, effectsOff, packetWithout, tierWithout, type QueryGl } from "../../client/core/passes.ts";
import { BenchRun, alternateSpread, passSpread } from "../../client/core/bench-run.ts";
import type { MapProgress } from "../../client/core/mapload.ts";

/** A card that runs each query `ms` long and has its result two frames later, or never where `timed` is false. */
function card(ms: (pass: number) => number, timed = true) {
  let frame = 0;
  let open: { at: number; ms: number } | null = null;
  const order: number[] = [];
  const reads: unknown[] = [];
  const gl: QueryGl & { frame(): void; lost: boolean; reads: unknown[] } = {
    lost: false,
    reads,
    bindFramebuffer: (_, fb) => void reads.push(fb),
    readPixels: () => void reads.push("read"),
    frame: () => void frame++,
    getExtension: (name) => (timed && name === "EXT_disjoint_timer_query_webgl2" ? {} : null),
    getParameter: () => false,
    isContextLost: () => gl.lost,
    createQuery: () => ({ at: -1, ms: 0 }),
    deleteQuery: () => {},
    beginQuery: (_, q) => void (open = Object.assign(q as { at: number; ms: number }, { at: frame, ms: ms(order.length) })),
    endQuery: () => void (open = null),
    getQueryParameter: (q, name) => ((q as { at: number }).at <= frame - 2 ? (name === 0x8867 ? true : (q as { ms: number }).ms * 1e6) : false),
  };
  return { gl, order, open: () => open };
}

test("the clock times each pass a frame marks, or the frame whole, and hands frames back as their results come", () => {
  const c = card((k) => [0.1, 1, 2, 0.5][k % 4]!);
  const clock = new PassClock(c.gl, true);
  const each = (): void => {
    for (const pass of [0, PASS_CASTERS, PASS_NEAR, PASS_DOME]) [clock.mark(pass), c.order.push(pass)];
    clock.end();
    c.gl.frame();
  };
  each();
  expect(clock.take()).toEqual([]);
  each();
  const taken = clock.take();
  expect(taken.length).toBe(1);
  const want = PASSES.map((_, i) => [0.1, 1, 2, 0, 0.5][[0, PASS_CASTERS, PASS_NEAR, 99, PASS_DOME].indexOf(i)] ?? 0);
  taken[0]!.forEach((ms, i) => expect(ms).toBeCloseTo(want[i]!, 9));
  // The frame whole, as the governor reads it: one query a frame, which a frame's first mark opens.
  const whole = new PassClock(card(() => 7).gl, false);
  expect(whole.on).toBe(true);
  // A browser with no timer queries times nothing.
  const none = new PassClock(card(() => 7, false).gl, true);
  none.mark(0);
  none.end();
  expect([none.on, none.take()]).toEqual([false, []]);
  // A lost context takes the frames awaited with it.
  c.gl.lost = true;
  expect(clock.take()).toEqual([]);
  c.gl.lost = false;
  c.gl.frame();
  c.gl.frame();
  expect(clock.take()).toEqual([]);
});

test("on the page's clock a frame is timed whole, from its first mark until a pixel of the canvas is read back, with or without timer queries", () => {
  let now = 0;
  const c = card(() => 7, false);
  c.gl.getParameter = () => "the scene's target";
  const clock = new PassClock(c.gl, true, () => now);
  expect(clock.on).toBe(true);
  for (const ms of [3, 5]) {
    clock.mark(0);
    now += 1;
    clock.mark(PASS_CASTERS);
    now += ms - 1;
    clock.end();
  }
  expect(clock.take()).toEqual([[3], [5]]);
  // The read is of the canvas, and the framebuffer read before is put back.
  expect(c.gl.reads.slice(0, 3)).toEqual([null, "read", "the scene's target"]);
  expect(clock.take()).toEqual([]);
});

test("a run that turns effects off every other frame: each kind's median, and each other frame against its own either side", () => {
  // A view that grows dearer as it turns, the frames without the effect a millisecond cheaper.
  const frames = Array.from({ length: 9 }, (_, i) => 10 + i * 0.5 - (i % 2 ? 1 : 0));
  const other = frames.map((_, i) => i % 2 === 1);
  expect(alternateSpread(frames, other)).toEqual({ own: 12, other: 10.5, less: -1, least: -1 });
  expect(alternateSpread(frames, frames.map(() => false))).toBeNull();
});

test("a pass's spread and the frame's, by pass where passes were timed", () => {
  expect(passSpread([])).toBeNull();
  expect(passSpread([[2], [4], [3]])).toEqual({ frame: { median: 3, p95: 3 } });
  const by = passSpread([PASSES.map(() => 1), PASSES.map(() => 2), PASSES.map(() => 3)])!;
  expect([by.casters, by.frame]).toEqual([{ median: 2, p95: 2 }, { median: PASSES.length * 2, p95: PASSES.length * 2 }]);
});

test("a bench run measures once the scene is still, turns its view from then, and reports its frames once", () => {
  const run = new BenchRun();
  const p = new FramePacket();
  const drawn = { drawCalls: 10, canvas: [100, 100], renderer: "a card", userAgent: "a browser", card: { bytes: 1024, textures: 512 }, squeeze: 0 };
  let now = 0;
  let report: ReturnType<BenchRun["frame"]> = null;
  for (let f = 0; f < 60 + BENCH_FRAMES + 10; f++, now += 16.7) {
    // The view's clock: a sixtieth of a second for each frame measured before this one, whatever the frames took.
    expect(run.since(now)).toBeCloseTo(f <= 61 ? 0 : (Math.min(f - 61, BENCH_FRAMES) * 1000) / 60, 6);
    const got = run.frame(now, 1, f > 60 ? [[5]] : [], p, f >= 1, drawn);
    if (got) [report, now] = [got, now];
  }
  expect(report!.frames).toBe(BENCH_FRAMES);
  expect(report!.frameMs.median).toBeCloseTo(16.7, 5);
  expect([report!.gpuMs, (report!.gpuFrames as number[]).length, report!.renderer, report!.alternate]).toEqual([{ frame: { median: 5, p95: 5 } }, BENCH_FRAMES, "a card", null]);
});

test("a bench run's clock begins at the frame the scene is still and steps a sixtieth of a second a frame however long the frames took", () => {
  const drawn = { drawCalls: 10, canvas: [100, 100], renderer: "a card", userAgent: "a browser", card: { bytes: 1024, textures: 512 }, squeeze: 0 };
  /** A run whose frames take `ms(f)`: the scene's clock at each frame, and at which frames the view turned. */
  const runAt = (ms: (f: number) => number): { scene: number[]; wall: number[] } => {
    const run = new BenchRun(), p = new FramePacket(), scene: number[] = [], wall: number[] = [];
    let now = 1000;
    for (let f = 0; f < 60 + BENCH_FRAMES + 40; f++, now += ms(f)) {
      // The shell asks for the clock before the frame is built, and tells the run of the frame once it is drawn.
      scene.push(run.clock(now));
      wall.push(now);
      run.frame(now, 1, [], p, true, drawn);
    }
    return { scene, wall };
  };
  // The 60th frame drawn alike after the first is the one the run says the scene is still at.
  const STILL_AT = 60, step = 1000 / 60;
  const steady = runAt(() => step), halting = runAt((f) => (f % 3 === 0 ? 50 : 33.3));
  for (const r of [steady, halting]) {
    // None up to it; from the next frame a sixtieth of a second a frame on from it, after the run's report too.
    for (let f = 0; f <= STILL_AT; f++) expect(r.scene[f]).toBe(-1);
    for (let f = STILL_AT + 1; f < r.scene.length; f++) expect(r.scene[f]).toBeCloseTo((f - STILL_AT) * step, 6);
  }
  // The halting run's frames took more than twice as long on the page's clock; on the run's they did not.
  expect(halting.wall.at(-1)! - halting.wall[STILL_AT]!).toBeGreaterThan(2 * (steady.wall.at(-1)! - steady.wall[STILL_AT]!));
  for (const f of [61, 200, 900, 999]) expect(halting.scene[f]).toBe(steady.scene[f]!);
});

test("a bench run waits for the whole map before the still frames it starts after, and says what it waited for", () => {
  // The map's parts come over the first 200 frames, the whole map's statics are handed over at the 150th and the road
  // parts round the body held at the 180th; the scene is still and nothing else is on its way all the while.
  const progress = (f: number): MapProgress => ({ left: Math.max(0, 200 - f), parts: 200, near: f >= 50, whole: f >= 150, roads: f >= 180 ? 0 : 3 });
  const run = new BenchRun();
  const p = new FramePacket();
  let f = 0, began = -1, asked = 0;
  const drawn = { drawCalls: 10, canvas: [100, 100], renderer: "a card", userAgent: "a browser", card: { bytes: 1024, textures: 512 }, squeeze: 0, map: () => (asked++, progress(f)) };
  let report: ReturnType<BenchRun["frame"]> = null;
  for (let now = 0; f < 300 + BENCH_FRAMES && !report; f++, now += 16.7) {
    if (began < 0 && run.since(now) > 0) began = f;
    report = run.frame(now, 1, [[5]], p, true, drawn);
  }
  // Begun at the 60th still frame from the 200th, the first with the whole map, and turning from the next but one; the
  // map asked of only until then.
  expect([began, asked]).toEqual([261, 201]);
  expect(report!.waited).toEqual({ mapMs: Math.round(200 * 16.7), map: progress(200), stillFrames: 60, gaveUp: false });
  expect("map" in report!).toBe(false);
});

test("effects off from the address: those in the tier, one copy a tier, and those in the built frame", () => {
  expect([...effectsOff("shadows,nothing,band")]).toEqual(["shadows", "band"]);
  expect(effectsOff(null).size).toBe(0);
  const high = tierOf("high");
  expect(tierWithout(high, effectsOff(null))).toBe(high);
  const off = tierWithout(high, effectsOff("shadows,clouds,farblocks,farnodes"));
  expect([off.shadows.cascades, off.clouds, off.reach.bases, off.reach.trees, off.reach.rocks]).toEqual([0, 0, 0, 0, 0]);
  expect(tierWithout(high, effectsOff("shadows,clouds,farblocks,farnodes"))).toBe(off);
  const p = new FramePacket();
  p.frame[FRAME.haze] = 3;
  p.drawCount = 2;
  [p.drawFlags[0], p.drawFlags[1], p.drawHand[0], p.drawHand[1]] = [DRAW_BLEND | DRAW_WATER, DRAW_BLEND, HAND_NEAR, -1];
  packetWithout(p, effectsOff("haze,water,band"));
  expect([p.frame[FRAME.haze], p.drawFlags[0], p.drawHand[0], p.drawHand[1], p.frame[FRAME.edgesOff]]).toEqual([0, DRAW_BLEND, 0, -1, 0]);
  p.frame.fill(1, FRAME.contact);
  packetWithout(p, effectsOff("contact"));
  expect([p.frame[FRAME.eyes - 1], p.frame[FRAME.eyes]]).toEqual([0, 1]);
  packetWithout(p, effectsOff("edges"));
  expect(p.frame[FRAME.edgesOff]).toBe(1);
  // The walls' weathering is the lane's second bit, so a run can turn either off alone.
  packetWithout(p, effectsOff("weather"));
  expect(p.frame[FRAME.edgesOff]).toBe(2);
  packetWithout(p, effectsOff("edges,weather"));
  expect(p.frame[FRAME.edgesOff]).toBe(3);
});
