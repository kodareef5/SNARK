import { expect, test } from "bun:test";
import { EV_HITCH, EV_LONG, EV_STALL, EV_UPLOAD, EV_CORRECTION, EVENTS_KEPT, LagEvents, MERGE_MS, Rises, type FrameFacts } from "../../client/core/debug/events.ts";

const TARGET = 1000 / 60;

/** Runs `intervals` through the events as frames of a page on a 60 Hz display, numbering frames on from the last run. */
const f: FrameFacts = { at: 0, interval: 0, target: TARGET, upload: 0, frame: 0, shot: false };
function run(e: LagEvents, intervals: readonly number[], start = 0): number {
  if (start === 0) f.frame = 0;
  f.at = start;
  for (const ms of intervals) {
    f.at += ms;
    f.interval = ms;
    f.frame++;
    e.frame(f, () => `frame ${f.frame}`);
  }
  return f.at;
}

test("a steady game makes no events, at full rate or at half", () => {
  const full = new LagEvents(), half = new LagEvents();
  run(full, Array(600).fill(TARGET));
  run(half, Array(600).fill(TARGET * 2));
  expect(full.list).toEqual([]);
  expect(half.list).toEqual([]);
});

test("a frame that stands out is a hitch, a long frame or a stall", () => {
  const e = new LagEvents();
  let at = run(e, Array(60).fill(TARGET));
  at = run(e, [30], at);
  at = run(e, Array(60).fill(TARGET), at);
  at = run(e, [80], at);
  at = run(e, Array(60).fill(TARGET), at);
  run(e, [400], at);
  expect(e.list.map((x) => x.kind)).toEqual([EV_HITCH, EV_LONG, EV_STALL]);
  expect(e.list.map((x) => x.size)).toEqual([30, 80, 400]);
  expect(e.list[1]!.cause).toBe("frame 122");
});

test("frames late in a burst join one event that keeps its worst", () => {
  const e = new LagEvents();
  const at = run(e, Array(60).fill(TARGET));
  run(e, [30, TARGET, 45, TARGET, 70, TARGET], at);
  expect(e.list.length).toBe(1);
  const burst = e.list[0]!;
  expect([burst.kind, burst.size, burst.count]).toEqual([EV_LONG, 70, 3]);
  expect(burst.cause).toBe("frame 65");
});

test("a frame with a picture being taken is not an event", () => {
  const e = new LagEvents();
  const at = run(e, Array(60).fill(TARGET));
  e.frame({ at: at + 40, interval: 40, target: TARGET, upload: 0, frame: 61, shot: true }, () => "");
  expect(e.list).toEqual([]);
});

test("slow uploads and other notes join by kind within the merge time", () => {
  const e = new LagEvents();
  e.frame({ at: 10, interval: TARGET, target: TARGET, upload: 12, frame: 1, shot: false }, () => "");
  e.note(100, EV_CORRECTION, 1, "");
  e.note(100 + MERGE_MS - 1, EV_CORRECTION, 1, "");
  e.note(100 + 3 * MERGE_MS, EV_CORRECTION, 2, "big");
  expect(e.list.map((x) => [x.kind, x.count, x.size])).toEqual([[EV_UPLOAD, 1, 12], [EV_CORRECTION, 2, 1], [EV_CORRECTION, 1, 2]]);
});

test("the list keeps the newest events and counts the fresh ones", () => {
  const e = new LagEvents();
  for (let i = 0; i < EVENTS_KEPT + 10; i++) e.note(i * MERGE_MS * 2, EV_CORRECTION, 1, "");
  expect(e.list.length).toBe(EVENTS_KEPT);
  expect(e.list[0]!.at).toBe(10 * MERGE_MS * 2);
  expect(e.fresh).toBe(EVENTS_KEPT + 10);
  expect(e.between(0, 30 * MERGE_MS, []).length).toBe(6);
});

test("a counter's rise is what it gained since it was last read", () => {
  const r = new Rises();
  expect([r.rise(0, 5), r.rise(0, 5), r.rise(0, 9), r.rise(1, 3)]).toEqual([0, 0, 4, 0]);
});

test("a frame's check makes nothing", () => {
  const e = new LagEvents();
  const g: FrameFacts = { at: 0, interval: TARGET, target: TARGET, upload: 0, frame: 0, shot: false };
  const cause = (): string => "";
  for (let i = 0; i < 200; i++) e.frame(g, cause);
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) {
    g.at += TARGET;
    e.frame(g, cause);
  }
  expect(process.memoryUsage().heapUsed - before).toBeLessThan(200_000);
});
