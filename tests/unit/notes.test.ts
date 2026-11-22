// Bug report mode's page side (client/core/notes): the performance record, written in place with nothing made a frame,
// its rows by the frame and by the second, its summary that leaves a picture's frames out, and the copies of the first
// frame's numbers it keeps.

import { expect, test } from "bun:test";
import type { App } from "../../client/core/app.ts";
import { FrameRing } from "../../client/core/assets/frames.ts";
import * as copies from "../../client/core/notes/copies.ts";
import { C, CELLS, FLAG_AFTER_SHOT, FLAG_GPU, FLAG_SHOT, FRAME_FIELDS, FRAME_SLOTS, PerfRing, SECOND_FIELDS, T } from "../../client/core/notes/ring.ts";
import { FrameSampler, type FrameExtra } from "../../client/core/notes/sample.ts";
import { DRAW_BLEND, DRAW_NEAR, FRAME, FramePacket, STEP_BODY, STEP_FAR, STEP_FAR_SEE, STEP_NEAR, STEP_NEAR_SEE, TRANSIENT_BUFFER, BEND_BUFFERS } from "../../client/core/render/packet.ts";
import { FAR_BUFFER } from "../../client/core/render/far.ts";
import { FAR_NODE_BUFFERS } from "../../client/core/render/farnodes.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS, TICK_RATE } from "../../shared/coords.ts";
import * as character from "../../shared/sim/character.ts";
import * as streets from "../../shared/world/streets.ts";
import { stripComments } from "../../tools/policy.ts";

test("the notes' copies of the first frame's numbers are the numbers", () => {
  expect([copies.TICK_RATE, copies.CHUNK_SIZE, copies.SECTOR_CHUNKS, copies.FRAME_SUN]).toEqual([TICK_RATE, CHUNK_SIZE, SECTOR_CHUNKS, FRAME.sun]);
  expect([copies.VERGES, copies.WALKS, copies.KERBS, copies.STREET_ONE_WAY, copies.STREET_PAIRED]).toEqual([streets.VERGES, streets.WALKS, streets.KERBS, streets.STREET_ONE_WAY, streets.STREET_PAIRED]);
  const modes = [character.MODE_NONE, character.MODE_WALK, character.MODE_SWIM, character.MODE_GHOST, character.MODE_FLY, character.MODE_FLYER];
  expect(modes).toEqual([0, 1, 2, 3, 4, 5]);
  expect(copies.MODE_NAMES.length as number).toBe(modes.length);
  expect([copies.DRAW_BLEND, copies.DRAW_NEAR]).toEqual([DRAW_BLEND, DRAW_NEAR]);
  expect([STEP_NEAR, STEP_FAR, STEP_FAR_SEE, STEP_NEAR_SEE, STEP_BODY].map((s) => copies.STEP_NAMES[s])).toEqual(["near", "far", "far see-through", "near see-through", "body"]);
  expect([copies.NODE_BUFFERS, copies.FAR_BUFFER, copies.FAR_NODE_BUFFERS, copies.BEND_BUFFERS, copies.TRANSIENT_BUFFER]).toEqual([NODE_BUFFERS, FAR_BUFFER, FAR_NODE_BUFFERS, BEND_BUFFERS, TRANSIENT_BUFFER]);
});

/**
 * Where a function's code would make something each time it runs: an array or record written out, `new`, a closure, a
 * template, a spread, or a call that hands back a new array or string. Indexing (`a[k]`) and blocks are not.
 */
function makes(fn: (...args: never[]) => unknown): string[] {
  const src = stripComments(fn.toString(), true).replace(/^[^{]*\{/, "");
  const found: string[] = [];
  for (const [what, re] of [
    ["an array", /(^|[=(,:?&|!]|\breturn)\s*\[/m],
    ["a record", /(^|[=(,:?]|\breturn)\s*\{/m],
    ["new", /\bnew\s/],
    ["a closure", /=>|\bfunction\b/],
    ["a template", /`/],
    ["a spread", /\.\.\./],
    ["a new array or string", /\.(map|filter|slice|concat|subarray|join|split|toFixed|flat|flatMap)\(|\bArray\.(from|of)\(|\bString\(|\bJSON\./],
  ] as const) if (re.test(src)) found.push(what);
  return found;
}

/** A frame as the sampler is handed it. */
const extra = (over: Partial<FrameExtra> = {}): FrameExtra => ({ build: 0, scene: 0, gpu: -1, glDraws: 0, longMs: 0, longTasks: 0, shotMs: 0, flags: 0, heap: 0, ...over });

/** An app as far as the sampler reads it: a session, a governor, the data utility's ring, no scene. */
interface Fake { frames: FrameRing | null; session: { stats: { rttTicks: number; margin: number; bytesIn: number; snapshots: number; corrections: number }; own: { x: number; y: number; z: number } }; scene: null; governor: { level: number }; interval: number; nowMs: number }
function app(frames: FrameRing | null): Fake {
  return { frames, session: { stats: { rttTicks: 3, margin: 2, bytesIn: 0, snapshots: 0, corrections: 0 }, own: { x: 10, y: 2, z: 30 } }, scene: null, governor: { level: 1 }, interval: 16, nowMs: 0 };
}

test("a frame's row is written in place: the sampler and the ring make nothing a frame, and it costs a few microseconds", () => {
  expect(makes(PerfRing.prototype.record)).toEqual([]);
  expect(makes(FrameSampler.prototype.sample)).toEqual([]);
  // The check sees what it looks for.
  expect(makes(function (this: { a: number[] }) { this.a = [1, 2]; })).toEqual(["an array"]);
  expect(makes(function (this: { a: object }) { this.a = { b: 1 }; })).toEqual(["a record"]);
  const ring = new PerfRing(), sampler = new FrameSampler(), a = app(new FrameRing()), p = new FramePacket(), e = extra();
  const t0 = performance.now(), n = 200_000;
  for (let i = 0; i < n; i++) {
    a.nowMs = i * 16.6;
    a.frames!.record(a.nowMs, 16.6, 4, 0, null, null);
    sampler.sample(ring, a as unknown as App, p, 4, 0, e);
  }
  const each = ((performance.now() - t0) * 1000) / n;
  expect(each).toBeLessThan(20);
  expect(ring.rows).toBe(n);
});

test("frames are rows of the data utility's frames, row for row, and the seconds keep where the survivor was", () => {
  const frames = new FrameRing(), ring = new PerfRing(), sampler = new FrameSampler(), a = app(frames), p = new FramePacket();
  p.drawCount = 900;
  p.triangles = 2_000_000;
  for (let i = 0; i < 300; i++) {
    a.nowMs = 1000 + i * 10;
    a.interval = i === 150 ? 80 : 10;
    a.session.own.x = 10 + i;
    a.session.stats.bytesIn += 100;
    frames.record(a.nowMs, a.interval, 4, 0, null, null);
    sampler.sample(ring, a as unknown as App, p, 4, 1, extra({ flags: i === 200 ? FLAG_SHOT : i === 201 ? FLAG_AFTER_SHOT : 0, gpu: i < 100 ? 5 : -1, heap: 300, shotMs: i === 200 ? 3 : 0 }));
  }
  expect(FRAME_FIELDS.length).toBe(CELLS + 1);
  for (const back of [0, 1, 99]) expect(ring.at[ring.row(back)]).toBe(frames.at[frames.row(back)]!);
  const rows = ring.frames(1000, 4000);
  expect(rows.length).toBe(300);
  expect([rows[150]![0], rows[150]![1 + C.interval], rows[150]![1 + C.draws], rows[150]![1 + C.triangles], rows[5]![1 + C.bytesIn], rows[0]![1 + C.rttMs]]).toEqual([1500, 80, 900, 2_000_000, 100, 100]);
  expect(rows[99]![1 + C.flags]! & FLAG_GPU).toBe(FLAG_GPU);
  // Three seconds, the last whole; each knows where the survivor was at its end.
  const seconds = ring.secondRows(1000);
  expect(seconds.map((s) => [s[0], s[1], s[SECOND_FIELDS.indexOf("x")]])).toEqual([[0, 100, 109], [1, 100, 209], [2, 100, 309]]);
  expect(seconds[1]![SECOND_FIELDS.indexOf("over50")]).toBe(1);
  expect(seconds[0]![SECOND_FIELDS.indexOf("gpuMs")]).toBe(5);
  expect(seconds[2]![SECOND_FIELDS.indexOf("gpuMs")]).toBe(-1);
  // The picture's frame and the one after are left out of the summary, and named so.
  const sum = ring.summary(1000, 4000);
  expect([sum.frames, sum.left, sum.middle, sum.worst, sum.gpu?.frames, sum.gpu?.middle, sum.heap]).toEqual([298, 2, 10, 80, 100, 5, 300]);
  expect(sum.over50).toBeCloseTo(1 / 298, 3);
  expect(ring.worst(1000, 4000, 3).map((r) => r[1 + C.interval])).toEqual([80, 10, 10]);
});

test("the ring holds its last frames and seconds, and a second no frame was drawn in is empty", () => {
  const ring = new PerfRing();
  for (let i = 0; i < FRAME_SLOTS + 10; i++) {
    ring.sample[C.interval] = 16;
    ring.totals[T.requests] = i;
    ring.record(i < 100 ? i * 10 : 5000 + i * 10);
  }
  expect(ring.row(FRAME_SLOTS)).toBe(-1);
  expect(ring.frames(0, Infinity).length).toBe(FRAME_SLOTS);
  const seconds = ring.secondRows(0);
  // Seconds 1 to 4 had no frame, so they are not rows.
  expect(seconds[0]![0]).toBe(0);
  expect(seconds[1]![0]).toBe(6);
  expect(seconds[0]![SECOND_FIELDS.indexOf("requests")]).toBe(99);
});
