// A drone's camera feed as a picture (client/core/render/feed.ts, client/core/air-feed.ts): its view and signal in the
// frame block, its grade, its share of the canvas, and what a weak signal does to it.

import { expect, test } from "bun:test";
import { AIR_FEED_RANGE, AirFeed, FEED_ZOOM_MAX, feedSignal } from "../../client/core/air-feed.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FEED_LEAST, FEED_SATURATION, burstOdds, feedLook, feedPicture, feedShare, freezeOdds } from "../../client/core/render/feed.ts";
import { FRAME, FramePacket, OPTIC_AT, OPTIC_BURST_AT, OPTIC_FEED, OPTIC_FEED_AT, OPTIC_HEAT, OPTIC_NIGHT } from "../../client/core/render/packet.ts";
import { opticFrame, postFrame, type Optic } from "../../client/core/render/post.ts";
import { graded } from "../../client/core/render/surface.ts";
import { NIGHT_GAIN } from "../../client/core/visor.ts";

const optic = (): Optic => ({ mode: 0, gain: 1, grain: 0 });

test("the feed's view, signal and burst reach the frame block, night and heat inside it", () => {
  const p = new FramePacket(), high = tierOf("high"), feed = new AirFeed(), out = optic();
  postFrame(p.frame, high, 14, 1080);
  feed.frame(out, 0.4, 1, 0.5);
  opticFrame(p.frame, high, out, 9);
  // The feed's own view is plain light to every shader; the feed rides fOptic.w and its burst fPhosphor.a.
  expect([p.frame[OPTIC_AT], p.frame[OPTIC_AT + 2], p.frame[OPTIC_FEED_AT], p.frame[OPTIC_BURST_AT]]).toEqual([0, 9, Math.fround(1.4), 0.5]);
  feed.cycle();
  feed.frame(out, 0.4, 0, 0);
  opticFrame(p.frame, high, out, 9);
  expect([p.frame[OPTIC_AT], p.frame[OPTIC_FEED_AT]]).toEqual([OPTIC_NIGHT, Math.fround(1.4)]);
  expect(out.gain).toBe(NIGHT_GAIN);
  feed.cycle();
  feed.frame(out, 1, 1, 0);
  opticFrame(p.frame, high, out, 9);
  expect([p.frame[OPTIC_AT], p.frame[OPTIC_FEED_AT]]).toEqual([OPTIC_HEAT, 2]);
  feed.cycle();
  expect(feed.mode).toBe(OPTIC_FEED);
  // Medium has no finish: the grade still knows the feed, and no grain or burst is asked of it.
  const medium = tierOf("medium");
  feed.frame(out, 0.4, 1, 0.5);
  opticFrame(p.frame, medium, out, 9);
  expect([p.frame[OPTIC_FEED_AT], p.frame[OPTIC_BURST_AT], p.frame[OPTIC_AT + 1]]).toEqual([Math.fround(1.4), 0, 0]);
});

test("the feed's grade drains most colour and cools what is left, in its twin as on the GPU", () => {
  const p = new FramePacket(), medium = tierOf("medium");
  postFrame(p.frame, medium, 14, 720);
  p.frame[FRAME.saturation] = 1;
  p.frame[FRAME.gamma] = 1;
  const plain = [0.6, 0.2, 0.1];
  graded(plain, p.frame);
  const fed = [0.6, 0.2, 0.1];
  opticFrame(p.frame, medium, { ...optic(), mode: OPTIC_FEED, feed: true, signal: 1 }, 0);
  graded(fed, p.frame);
  const spread = (c: number[]): number => Math.max(...c) - Math.min(...c);
  expect(spread(fed)).toBeLessThan(spread(plain) * (FEED_SATURATION + 0.1));
  const grey = [0.3, 0.3, 0.3];
  graded(grey, p.frame);
  expect(grey[2]!).toBeGreaterThan(grey[0]!);
});

test("the feed draws its scene from fewer pixels, near 540 rows and never under its least share", () => {
  expect(feedShare(1, 1080)).toBe(0.5);
  expect(feedShare(1, 2160)).toBe(FEED_LEAST);
  expect(feedShare(1, 720)).toBe(0.75);
  // A share already under it is kept.
  expect(feedShare(0.4, 1080)).toBe(0.4);
});

test("the signal falls from whole near the rack to none at the feed's range", () => {
  expect(feedSignal(0)).toBe(1);
  expect(feedSignal(AIR_FEED_RANGE * 0.2)).toBe(1);
  expect(feedSignal(AIR_FEED_RANGE)).toBe(0);
  let last = 1;
  for (let d = 0; d <= AIR_FEED_RANGE; d += 50) {
    expect(feedSignal(d)).toBeLessThanOrEqual(last);
    last = feedSignal(d);
  }
  expect(feedSignal(AIR_FEED_RANGE * 0.6)).toBeGreaterThan(0.2);
  expect(feedSignal(AIR_FEED_RANGE * 0.6)).toBeLessThan(0.8);
});

test("a weaker signal adds noise, coarse blocks, torn bands, lost rows, bursts and frozen frames", () => {
  const good = feedLook(1, 0), weak = feedLook(0.3, 0), lost = feedLook(0, 0);
  for (const key of ["noise", "chroma", "block", "tear", "drop", "flicker", "slide"] as const) {
    expect(weak[key]).toBeGreaterThan(good[key]);
    expect(lost[key]).toBeGreaterThan(weak[key]);
  }
  expect([good.block, good.tear, good.drop, good.flicker]).toEqual([0, 0, 0, 0]);
  // A burst tears a good picture for a moment.
  const burst = feedLook(1, 1);
  expect(burst.tear).toBeGreaterThan(0);
  expect(burst.block).toBeGreaterThan(0);
  expect(burstOdds(0)).toBeGreaterThan(burstOdds(0.5));
  expect(burstOdds(0.5)).toBeGreaterThan(burstOdds(1));
  expect(freezeOdds(1)).toBe(0);
  expect(freezeOdds(0)).toBeGreaterThan(freezeOdds(0.2));
  expect(freezeOdds(0.2)).toBeGreaterThan(0);
});

test("the software twin's picture strays further from the scene the weaker the signal", () => {
  const w = 160, h = 90;
  const scene = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    scene.set([60 + (x % 40) * 3, 90 + (y % 30) * 3, 120, 255], i * 4);
  }
  const off = (signal: number, burst: number): number => {
    const pic = Uint8ClampedArray.from(scene);
    feedPicture(pic, w, h, 0.5, signal, burst, 77);
    let sum = 0;
    for (let i = 0; i < pic.length; i += 4) sum += Math.abs(pic[i]! - scene[i]!) + Math.abs(pic[i + 1]! - scene[i + 1]!);
    return sum / (w * h);
  };
  expect(off(0.1, 0.6)).toBeGreaterThan(off(1, 0) * 1.3);
});

test("the wheel zooms the feed within its least and most", () => {
  const feed = new AirFeed();
  feed.wheel(-40);
  expect(feed.zoom).toBe(FEED_ZOOM_MAX);
  feed.wheel(40);
  expect(feed.zoom).toBe(1);
  feed.wheel(-1);
  expect(feed.zoom).toBeCloseTo(1.25, 9);
});
