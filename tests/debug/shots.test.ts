// The debug bar's pictures (client/core/debug/shots.ts) with a port that answers when the test says: one every two
// seconds, one asked for after the gap, the most kept, a failed one forgotten, none while paused.

import { expect, test } from "bun:test";
import type { Picture } from "../../client/core/debug/port.ts";
import { SHOT_LIMITS, ShotRing } from "../../client/core/debug/shots.ts";

/** A port whose pictures come or fail when the test says, and which notes what it was asked and what it freed. */
class FakePort {
  readonly asked: { wide: number; quality: number; come: (p: Picture) => void; fail: (e: Error) => void }[] = [];
  readonly dropped: string[] = [];
  shot(wide: number, quality: number): { ms: number; picture: Promise<Picture> } {
    let come!: (p: Picture) => void, fail!: (e: Error) => void;
    const picture = new Promise<Picture>((yes, no) => ((come = yes), (fail = no)));
    this.asked.push({ wide, quality, come, fail });
    return { ms: 0.25, picture };
  }
  drop(p: Picture): void {
    this.dropped.push(p.url);
  }
  /** Picture `n`, counted from 0, comes. */
  answer(n: number, bytes = 1000): void {
    this.asked[n]!.come({ url: `blob:${n}`, blob: null, w: 640, h: 360, bytes });
  }
}

/** Lets every answer reach the ring. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/** Runs frames every `step` ms from `from` to `to`, taking each picture that is due; returns when each was taken. */
function run(ring: ShotRing, from: number, to: number, step = 100): number[] {
  const taken: number[] = [];
  for (let t = from; t < to; t += step) if (ring.due(t)) (ring.take(t, t / step), taken.push(t));
  return taken;
}

test("a picture comes every two seconds, at most 640 across", () => {
  const port = new FakePort(), ring = new ShotRing(port);
  expect(run(ring, 0, 10_000)).toEqual([0, 2000, 4000, 6000, 8000]);
  expect(port.asked.map((a) => a.wide)).toEqual([640, 640, 640, 640, 640]);
  expect(port.asked[0]!.quality).toBe(SHOT_LIMITS.quality);
  expect(ring.making).toBe(5);
});

test("a picture asked for waits until a second has passed since the last", async () => {
  const port = new FakePort(), ring = new ShotRing(port);
  ring.take(0, 0);
  ring.ask("stall");
  ring.ask("late frame");
  expect(run(ring, 100, 3100)).toEqual([1000, 3000]);
  // Asked long after the last, it is taken at once.
  ring.ask("snapshot gap");
  expect(run(ring, 4500, 4600)).toEqual([4500]);
  for (let n = 0; n < 4; n++) port.answer(n);
  await settle();
  expect(ring.shots.map((s) => [s.at, s.why])).toEqual([[0, ""], [1000, "stall"], [3000, ""], [4500, "snapshot gap"]]);
  expect(ring.shots.map((s) => s.frame)).toEqual([0, 10, 30, 45]);
});

test("ninety are kept, and the oldest is freed through the port", async () => {
  const port = new FakePort(), ring = new ShotRing(port);
  for (let n = 0; n < 95; n++) {
    ring.take(n * 2000, n);
    port.answer(n, 1000 + n);
  }
  await settle();
  expect(ring.shots.length).toBe(90);
  expect(port.dropped).toEqual(["blob:0", "blob:1", "blob:2", "blob:3", "blob:4"]);
  expect(ring.shots[0]!.picture.url).toBe("blob:5");
  expect(ring.bytes).toBe(ring.shots.reduce((sum, s) => sum + s.picture.bytes, 0));
  expect(ring.making).toBe(0);
});

test("a picture that fails is forgotten", async () => {
  const port = new FakePort(), ring = new ShotRing(port);
  run(ring, 0, 6000);
  port.answer(0);
  port.asked[1]!.fail(new Error("the card was lost"));
  port.answer(2);
  await settle();
  expect(ring.shots.map((s) => s.picture.url)).toEqual(["blob:0", "blob:2"]);
  expect([ring.failed, ring.making, ring.bytes]).toEqual([1, 0, 2000]);
});

test("paused, the ring takes none and keeps no ask for later", () => {
  const port = new FakePort(), ring = new ShotRing(port);
  ring.paused = true;
  ring.ask("stall");
  expect(run(ring, 0, 10_000)).toEqual([]);
  ring.paused = false;
  expect(run(ring, 10_000, 11_000)).toEqual([10_000]);
  expect(port.asked.length).toBe(1);
});

test("pictures come out of order kept in order, and the nearest found", async () => {
  const port = new FakePort(), ring = new ShotRing(port);
  run(ring, 0, 6000);
  for (const n of [2, 0, 1]) port.answer(n);
  await settle();
  expect(ring.shots.map((s) => s.at)).toEqual([0, 2000, 4000]);
  expect([-50, 900, 1100, 2900, 3100, 1e9].map((t) => ring.nearest(t)!.at)).toEqual([0, 0, 2000, 2000, 4000, 4000]);
  expect(new ShotRing(port).nearest(0)).toBeNull();
});

test("a clear frees what is kept and what comes after it", async () => {
  const port = new FakePort(), ring = new ShotRing(port);
  run(ring, 0, 4000);
  port.answer(0);
  await settle();
  ring.clear();
  expect([ring.shots.length, ring.bytes, port.dropped]).toEqual([0, 0, ["blob:0"]]);
  port.answer(1);
  await settle();
  expect([ring.shots.length, port.dropped]).toEqual([0, ["blob:0", "blob:1"]]);
  // The schedule starts again.
  expect(ring.due(4000)).toBe(true);
});
