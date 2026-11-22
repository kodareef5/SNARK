// The display's interval kept apart from the game's rate (D1120). A frame is judged against the target, the fastest the
// page has kept up since it began or since the display changed, snapped to a display's rate, which a slow stretch cannot
// drag down; the budget's panel and a report's summary say both, and count a frame late against the target.

import { expect, test } from "bun:test";
import type { App } from "../../client/core/app.ts";
import { FrameRing, REFRESH_RATES, RefreshTarget, refreshOf } from "../../client/core/assets/frames.ts";
import { frameStrip } from "../../client/core/notes/budget.ts";
import { PerfRing, SECOND_FIELDS } from "../../client/core/notes/ring.ts";
import { FrameSampler, type FrameExtra } from "../../client/core/notes/sample.ts";
import { FramePacket } from "../../client/core/render/packet.ts";

const extra: FrameExtra = { build: 0, scene: 0, gpu: -1, glDraws: 0, longMs: 0, longTasks: 0, shotMs: 0, flags: 0, heap: 0 };

/**
 * A page's frames as the app takes them: each frame's interval to the data utility's target (App.frame), its row to the
 * data utility's ring (App.drawn) and to the record (notes/sample.ts). `play` draws `seconds` at `hz` and says from
 * when to when on the page's clock.
 */
function page() {
  const frames = new FrameRing(), ring = new PerfRing(), sampler = new FrameSampler(), p = new FramePacket();
  const app = { frames, session: { stats: { rttTicks: 0, margin: 0, bytesIn: 0, snapshots: 0, corrections: 0 }, own: { x: 0, y: 0, z: 0 } }, scene: null, governor: { level: 0 }, interval: 0, nowMs: 0 };
  // Begun off a whole millisecond, so no frame falls on the edge of a second.
  let t = 0.25;
  const frame = (interval: number): void => {
    t += interval;
    app.interval = interval;
    app.nowMs = t;
    frames.target.frame(interval);
    frames.record(t, interval, 2, 0, null, null);
    sampler.sample(ring, app as unknown as App, p, 2, 0, extra);
  };
  const play = (hz: number, seconds: number): { from: number; to: number } => {
    const from = t + 1000 / hz;
    for (let n = Math.round(seconds * hz); n > 0; n--) frame(1000 / hz);
    return { from, to: t };
  };
  return { frames, ring, frame, play, now: () => t };
}

test("a window's rate is snapped to the first display's rate it comes within 8% of, never under 60 nor over 240", () => {
  expect(REFRESH_RATES[0]).toBe(60);
  const asked = [59.94, 61, 30, 45, 75, 89.5, 100, 119.8, 125, 143.9, 165, 240, 400];
  expect(asked.map(refreshOf)).toEqual([60, 60, 60, 60, 75, 90, 100, 120, 120, 144, 165, 240, 240]);
});

test("three seconds at 60 then four at 30: the target stays at 60, and the panel and the report call the slow stretch late", () => {
  const pg = page();
  pg.play(60, 3);
  const slow = pg.play(30, 4);
  expect(pg.frames.target.hz).toBe(60);
  // The report's summary of the slow stretch: the display's interval, the game's middle, every frame late, each two intervals.
  const s = pg.ring.summary(slow.from, slow.to);
  expect([s.frames, s.target, s.middle, s.late, s.worstIntervals]).toEqual([120, 16.67, 33.33, 1, 2]);
  // Each of its seconds counts its frames late against 60 too, and says what the target was.
  const seconds = pg.ring.secondRows(0), late = SECOND_FIELDS.indexOf("late"), target = SECOND_FIELDS.indexOf("targetMs");
  expect(seconds.filter((r) => r[0]! >= 4 && r[0]! <= 6).map((r) => [r[1], r[late], r[target]])).toEqual([[30, 30, 16.67], [30, 30, 16.67], [30, 30, 16.67]]);
  expect(seconds.filter((r) => r[0]! <= 2).map((r) => r[late])).toEqual([0, 0, 0]);
  // The panel: its line where the display's interval is, the rate in words, and the frames late against it.
  const strip = frameStrip(pg.frames, pg.now());
  expect(strip.target).toBeCloseTo(1000 / 60, 6);
  expect(strip.title).toBe("30 fps of 60 · 33.3 ms a frame");
  expect(strip.late).toBe(120);
  expect(strip.line).toBe(`last 5 s: 120 of ${strip.counted} frames late, the worst 33.3 ms (2.0 display intervals)`);
});

test("a steady 60 is on time: no frame late, in the panel or the report", () => {
  const pg = page();
  const all = pg.play(60, 10);
  const s = pg.ring.summary(all.from, all.to);
  expect([s.target, s.middle, s.late, s.worstIntervals]).toEqual([16.67, 16.67, 0, 1]);
  const strip = frameStrip(pg.frames, pg.now());
  expect([strip.title, strip.late, strip.counted >= 300]).toEqual(["60 fps of 60 · 16.7 ms a frame", 0, true]);
  expect(strip.line).toBe(`last 5 s: 0 of ${strip.counted} frames late, the worst 16.7 ms (1.0 display intervals)`);
});

test("a display at 120 that the game holds at a steady 60 is half rate: every frame two display intervals, late", () => {
  const pg = page();
  // A quarter second at the display's own rate, as a page shows while it connects, is enough to know it.
  pg.play(120, 0.25);
  const held = pg.play(60, 6);
  expect(pg.frames.target.hz).toBe(120);
  const s = pg.ring.summary(held.from, held.to);
  expect([s.target, s.middle, s.late, s.worstIntervals]).toEqual([8.33, 16.67, 1, 2]);
  expect(frameStrip(pg.frames, pg.now()).title).toBe("60 fps of 120 · 16.7 ms a frame");
});

test("a hidden tab, a long pause or a burst after it leaves the target as it was", () => {
  const pg = page();
  pg.play(60, 2);
  // Paused ten seconds, then hidden, where a browser draws a frame a second, then a few frames at once on coming back.
  pg.frame(10000);
  pg.play(1, 20);
  for (let k = 0; k < 4; k++) pg.frame(0.5);
  expect(pg.frames.target.hz).toBe(60);
  const after = pg.play(30, 3);
  expect(pg.frames.target.hz).toBe(60);
  expect(pg.ring.summary(after.from, after.to).late).toBe(1);
  // A long stretch at 60 with one long frame in every window does not move it either.
  for (let k = 0; k < 40; k++) {
    for (let n = 0; n < 29; n++) pg.frame(1000 / 60);
    pg.frame(400);
  }
  expect(pg.frames.target.hz).toBe(60);
});

test("a page that starts slow and speeds up takes the faster rate once it keeps it, and only then", () => {
  const pg = page();
  // Never faster than 30: the target is 60, what every display shows at least, so the game is half rate.
  const start = pg.play(30, 5);
  expect(pg.frames.target.hz).toBe(60);
  expect(pg.ring.summary(start.from, start.to).late).toBe(1);
  // A few fast frames are not a rate kept up.
  for (let n = 0; n < 10; n++) pg.frame(1000 / 120);
  pg.play(30, 1);
  expect(pg.frames.target.hz).toBe(60);
  pg.play(90, 1);
  expect(pg.frames.target.hz).toBe(90);
  pg.play(45, 3);
  expect(pg.frames.target.hz).toBe(90);
  expect(frameStrip(pg.frames, pg.now()).title).toBe("45 fps of 90 · 22.2 ms a frame");
});

test("a new display is learnt again from its own frames", () => {
  const t = new RefreshTarget();
  const feed = (hz: number, n: number): void => {
    for (let k = 0; k < n; k++) t.frame(1000 / hz);
  };
  feed(144, 60);
  expect(t.hz).toBe(144);
  // Moved to a display at 60: on the old one's target every frame would be late, until the display's change is told.
  feed(60, 300);
  expect(t.hz).toBe(144);
  t.reset();
  expect(t.hz).toBe(60);
  feed(60, 300);
  expect(t.hz).toBe(60);
  // The first frame's interval, 0, says nothing.
  t.frame(0);
  expect(t.hz).toBe(60);
});
