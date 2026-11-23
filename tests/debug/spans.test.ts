// The debug bar's record of where each frame's time went (client/core/debug/spans.ts): slots made once, rows kept in
// place, the mean and the slowest of many frames, and the shell's and the card's spans placed when a frame is closed.

import { expect, test } from "bun:test";
import { FRAME_ROWS, LANE_CARD, LANE_FRAME, MOST_SLOTS, SpanFrame, SpanRing } from "../../client/core/debug/spans.ts";
import type { FramePart } from "../../client/core/frame.ts";
import { PASSES, PASS_FINISH, PASS_MAKING, PASS_NEAR, type PassCpu } from "../../client/core/passes.ts";
import { walk, type Frame, type PassRow } from "../../client/core/render/pass.ts";
import { stripComments } from "../../tools/policy.ts";

/** A clock the test sets by hand. */
const clock = (): { t: number; now(): number } => ({ t: 0, now() { return this.t; } });

/** The slot `name` under `parent`, -1 where there is none: unlike `slot`, it makes none. */
const find = (ring: SpanRing, name: string, parent: number): number => ring.names.findIndex((n, s) => n === name && ring.parents[s] === parent);

/** Slot `s` in row `row`: its first start and its ms. */
const cell = (ring: SpanRing, row: number, s: number): number[] => [ring.start[row * MOST_SLOTS + s]!, ring.ms[row * MOST_SLOTS + s]!];

/** Where a function would make something each time it runs, as tests/ui/notes.test.ts reads it. */
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

test("a slot is made once by its name and parent, with its depth and lane", () => {
  const ring = new SpanRing(clock());
  expect(ring.names.slice(0, 7)).toEqual(["frame", "card", "browser", "input", "app", "ui", "gl"]);
  const app = ring.slot("app", LANE_FRAME), part = ring.slot("director", app);
  expect([app, ring.slot("director", app)]).toEqual([find(ring, "app", LANE_FRAME), part]);
  // The same name under another parent is another slot.
  const root = ring.slot("director", -1);
  expect(root).not.toBe(part);
  expect([ring.depths[part], ring.lane(part), ring.depths[root], ring.lane(root)]).toEqual([2, LANE_FRAME, 0, root]);
  // Each pass drawn has a slot under "gl", and under "card", by the pass clock's names.
  const gl = find(ring, "gl", LANE_FRAME);
  expect(PASSES.filter((name) => find(ring, name, gl) < 0 || find(ring, name, LANE_CARD) < 0)).toEqual([]);
  // Past the most none is made, and time given to none is not kept.
  while (ring.names.length < MOST_SLOTS) ring.slot(`more ${ring.names.length}`, root);
  expect(ring.slot("one too many", root)).toBe(-1);
  ring.begin(0);
  ring.add(-1, 0, 5);
  ring.end();
  expect(ring.ms.subarray(0, MOST_SLOTS).every((ms) => ms === 0)).toBe(true);
});

test("a slot run twice in a frame keeps its first start and adds up its ms", () => {
  const ring = new SpanRing(clock()), sound = ring.slot("sound", ring.slot("app", LANE_FRAME));
  ring.begin(1000);
  ring.add(sound, 1002, 1005);
  ring.add(sound, 1010, 1011);
  ring.end();
  expect([ring.rows, ring.at[ring.row(0)]]).toEqual([1, 1000]);
  expect(cell(ring, ring.row(0), sound)).toEqual([2, 4]);
  // A slot that did not run has no start and no time.
  expect(cell(ring, ring.row(0), LANE_CARD)).toEqual([NaN, 0]);
});

test("a row begun and never ended is cleared by the next begin", () => {
  const ring = new SpanRing(clock()), a = ring.slot("a", -1), b = ring.slot("b", -1);
  ring.begin(0);
  ring.add(a, 1, 2);
  ring.begin(100);
  ring.add(b, 101, 103);
  ring.end();
  expect([ring.rows, ring.at[ring.row(0)], cell(ring, ring.row(0), a), cell(ring, ring.row(0), b)]).toEqual([1, 100, [NaN, 0], [1, 2]]);
  // Outside a row nothing is kept, and an end or a close with none begun commits nothing.
  ring.add(b, 200, 300);
  ring.end();
  ring.close(Float64Array.of(200, 201, 202, 203, 204), null);
  expect([ring.rows, cell(ring, ring.row(0), b)]).toEqual([1, [1, 2]]);
});

test("the ring keeps its last FRAME_ROWS frames", () => {
  const ring = new SpanRing(clock());
  for (let k = 0; k < FRAME_ROWS + 5; k++) {
    ring.begin(k);
    ring.end();
  }
  expect([ring.row(-1), ring.row(FRAME_ROWS), ring.at[ring.row(0)], ring.at[ring.row(FRAME_ROWS - 1)]]).toEqual([-1, -1, FRAME_ROWS + 4, 5]);
});

test("the mean of frames by slot, and the slowest of them", () => {
  const ring = new SpanRing(clock()), x = ring.slot("x", LANE_FRAME), y = ring.slot("y", LANE_FRAME);
  for (let k = 0; k < 10; k++) {
    const at = 1000 * (k + 1);
    ring.begin(at);
    // x runs a ms longer each frame; y runs 2 ms in the even frames, a ms later each frame.
    ring.add(x, at + 1, at + 1 + k);
    if (k % 2 === 0) ring.add(y, at + 4 + k, at + 6 + k);
    ring.close(Float64Array.of(at, at, at, at, at + (k === 6 ? 50 : 10)), null);
  }
  const mean = new SpanFrame();
  expect(ring.mean(0, 10, mean)).toBe(10);
  // y's start is its mean over the frames it ran in; its ms is over all ten.
  expect([mean.start[x], mean.ms[x], mean.start[y], mean.ms[y], mean.at, mean.frames]).toEqual([1, 4.5, 8, 1, 10000, 10]);
  // The latest four, and the latest alone, in which y did not run.
  expect(ring.mean(0, 4, mean)).toBe(4);
  expect([mean.ms[x], mean.start[y], mean.ms[y]]).toEqual([7.5, 11, 1]);
  expect(ring.mean(0, 1, mean)).toBe(1);
  expect([mean.start[y], mean.ms[y]]).toEqual([NaN, 0]);
  // Asked for more than are kept, it gives the mean of those kept.
  expect(ring.mean(5, 100, mean)).toBe(5);
  // The slowest by the frame's own ms: of three alike, the latest.
  expect([ring.at[ring.slowest(10)], ring.at[ring.slowest(3)], ring.at[ring.slowest(4, 3)], ring.slowest(0)]).toEqual([7000, 10000, 7000, -1]);
  expect(ring.read(ring.slowest(10), new SpanFrame()).ms[LANE_FRAME]).toBe(50);
});

test("a closed frame holds the shell's spans, each pass drawn and the card's", () => {
  const c = clock(), ring = new SpanRing(c), gl = find(ring, "gl", LANE_FRAME);
  const cpu: PassCpu = { start: new Float64Array(PASSES.length).fill(NaN), ms: new Float64Array(PASSES.length), began: 1011, ended: 1019 };
  cpu.start[PASS_NEAR] = 2;
  cpu.ms[PASS_NEAR] = 3;
  cpu.start[PASS_FINISH] = 6;
  cpu.ms[PASS_FINISH] = 1.5;
  const card = new Float64Array(PASSES.length);
  card[PASS_MAKING] = 0.5;
  card[PASS_NEAR] = 2;
  card[PASS_FINISH] = 1;
  ring.begin(1000);
  ring.add(find(ring, "app", LANE_FRAME), 1001.5, 1008.5);
  ring.card(card, 2);
  ring.close(Float64Array.of(1000, 1001, 1009, 1010, 1020), cpu);
  const at = (name: string, parent: number): number[] => cell(ring, ring.row(0), find(ring, name, parent));
  expect([at("frame", -1), at("input", LANE_FRAME), at("app", LANE_FRAME), at("ui", LANE_FRAME), at("gl", LANE_FRAME)]).toEqual([[0, 20], [0, 1], [1.5, 7], [9, 1], [10, 10]]);
  expect([at("near", gl), at("finish", gl), at("far", gl)]).toEqual([[13, 3], [17, 1.5], [NaN, 0]]);
  // The card's passes are laid end to end from the frame's start.
  expect([at("card", -1), at("making", LANE_CARD), at("near", LANE_CARD), at("finish", LANE_CARD), at("far", LANE_CARD)]).toEqual([[0, 3.5], [0, 0.5], [0.5, 2], [2.5, 1], [NaN, 0]]);
  // A draw of another frame is left out, and so is a draw that did not end.
  const marks = Float64Array.of(3000, 3001, 3009, 3010, 3020);
  ring.begin(3000);
  ring.close(marks, cpu);
  expect(at("near", gl)).toEqual([NaN, 0]);
  cpu.began = 3011;
  ring.begin(3000);
  ring.close(marks, cpu);
  expect(at("near", gl)).toEqual([NaN, 0]);
  cpu.ended = 3019;
  ring.begin(3000);
  ring.close(marks, cpu);
  expect(at("near", gl)).toEqual([13, 3]);
  // The card's frame timed whole is one span; without the shell's marks the frame runs from its begin until now.
  c.t = 2030;
  ring.begin(2000);
  ring.card(Float64Array.of(4), 1);
  ring.close(new Float64Array(5), cpu);
  expect([at("card", -1), at("making", LANE_CARD), at("frame", -1), at("near", gl)]).toEqual([[0, 4], [NaN, 0], [0, 30], [NaN, 0]]);
});

test("a slot's children come in the order they first ran in a frame", () => {
  const ring = new SpanRing(clock()), p = ring.slot("p", -1), a = ring.slot("a", p), b = ring.slot("b", p), c = ring.slot("c", p);
  ring.begin(0);
  ring.add(c, 1, 2);
  ring.add(a, 3, 4);
  ring.add(c, 5, 6);
  ring.add(p, 0, 10);
  ring.end();
  const frame = ring.read(ring.row(0), new SpanFrame());
  // b did not run; c ran first and again later.
  expect([ring.children(p, frame, [b]), ring.children(-1, frame, [])]).toEqual([[c, a], [p]]);
  expect(ring.read(-1, frame).frames).toBe(0);
});

test("timed passes and parts run in their list's order, each by its name", () => {
  const ring = new SpanRing(clock()), calls: string[] = [], f = {} as Frame;
  const hook = (name: string) => (): void => void calls.push(name);
  const rows: PassRow[] = [["a", { update: hook("a update"), draw: hook("a draw") }], ["b", { draw: hook("b draw") }], ["c", { update: hook("c update") }]];
  const plain = walk(rows.map((r) => r[1]));
  plain.update(f);
  plain.draw(f);
  const want = calls.splice(0), update = ring.slot("update", -1), draw = ring.slot("draw", -1);
  const timed = ring.walk(rows, update, draw);
  ring.begin(0);
  timed.update(f);
  timed.draw(f);
  ring.end();
  expect(calls).toEqual(want);
  const has = (name: string, parent: number): boolean => !Number.isNaN(cell(ring, ring.row(0), find(ring, name, parent))[0]!);
  expect([has("a", update), has("c", update), has("a", draw), has("b", draw), find(ring, "b", update), find(ring, "c", draw)]).toEqual([true, true, true, true, -1, -1]);
  // A timed part stands for the part it wraps, as a guarded part does, and for the part a guarded one wraps.
  const inner: FramePart = { step: hook("inner") }, guarded = { part: inner, step: hook("guarded") };
  const parts = ring.parts([["inner", inner], ["guarded", guarded]], LANE_FRAME) as (FramePart & { part: FramePart })[];
  for (const part of parts) part.step({} as never);
  expect([parts[0]!.part, parts[1]!.part, calls.slice(-2)]).toEqual([inner, inner, ["inner", "guarded"]]);
});

test("a frame of 100 slots makes nothing and costs a few microseconds", () => {
  for (const fn of [SpanRing.prototype.now, SpanRing.prototype.begin, SpanRing.prototype.add, SpanRing.prototype.end, SpanRing.prototype.close, SpanRing.prototype.card]) expect(makes(fn), fn.name).toEqual([]);
  const ring = new SpanRing();
  const part = ring.parts([["part", { step: () => {} }]], LANE_FRAME)[0]!, hooks = ring.walk([["pass", { update: () => {}, draw: () => {} }]], LANE_FRAME, LANE_FRAME);
  for (const fn of [part.step, hooks.update, hooks.draw]) expect(makes(fn)).toEqual([]);
  // The check sees what it looks for.
  expect(makes(function (this: { a: number[] }) { this.a = [1, 2]; })).toEqual(["an array"]);
  const app = ring.slot("app", LANE_FRAME), slots = Int16Array.from({ length: 100 }, (_, i) => ring.slot(`slot ${i}`, i < 50 ? app : LANE_FRAME));
  const marks = new Float64Array(5), card = new Float64Array(PASSES.length).fill(0.25), n = 20_000, t0 = performance.now();
  for (let k = 0; k < n; k++) {
    marks[0] = ring.now();
    ring.begin(marks[0]);
    for (let i = 0; i < slots.length; i++) ring.add(slots[i]!, marks[0], ring.now());
    marks[1] = marks[2] = marks[3] = marks[4] = ring.now();
    ring.card(card, 2);
    ring.close(marks, null);
  }
  const each = ((performance.now() - t0) * 1000) / n;
  expect(each).toBeLessThan(60);
  expect(ring.rows).toBe(n);
});
