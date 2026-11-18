// The admin page's timeline over the survivor log, headless (client/core/admin): the window and the playhead, what is
// fetched for a window and at what step, moving between samples, session gaps, the frame at a moment, the window's
// figures, what was held summed from changes, and the time axis for windows of days.

import { expect, test } from "bun:test";
import { LOG_ALIVE, LOG_AWAY, LOG_DEAD, type LogChanges, type LogPositions, type LogSurvivor, type LogTrack } from "../../shared/survivor-log.ts";
import { dayText, momentText, tickText, timeStep } from "../../client/core/admin/chart.ts";
import { DOT_AWAY, DOT_DEAD, DOT_ONLINE } from "../../client/core/admin/frame.ts";
import { changeText, heldAt, heldText, itemName, nearestChange } from "../../client/core/admin/holding.ts";
import { figures, frameAt, onlineCounts, placeAt, rowsAt, sampleBefore, sessionAt, tailOf } from "../../client/core/admin/past.ts";
import { Recall, holdingAt } from "../../client/core/admin/recall.ts";
import { POINTS, PRESETS, Timeline, WINDOW_LEAST, fetchSpan, localMoment, localText, serves, stepFor } from "../../client/core/admin/timeline.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 17, 18, 0, 0);

test("the timeline shows the last hour as the log's end comes, follows it while live, and keeps its window in the span", () => {
  const t = new Timeline();
  expect(t.known).toBe(false);
  t.setSpan(T0, T0 + 5 * H);
  expect([t.start, t.end, t.at, t.live]).toEqual([T0 + 4 * H, T0 + 5 * H, T0 + 5 * H, true]);
  // Live, the window and the playhead follow the end.
  t.setSpan(T0, T0 + 5 * H + 1000);
  expect([t.end, t.at]).toEqual([T0 + 5 * H + 1000, T0 + 5 * H + 1000]);
  // A seek leaves live; the window, which no longer reaches the end after a pan, stays put as the end moves.
  t.seek(T0 + 4.5 * H);
  t.pan(-H);
  const kept = [t.start, t.end];
  t.setSpan(T0, T0 + 6 * H);
  expect([t.live, t.at, [t.start, t.end]]).toEqual([false, T0 + 4.5 * H, kept]);
  // A seek outside the window brings the window to it, at its width.
  t.seek(T0 + 0.25 * H);
  expect([t.start, t.end]).toEqual([T0, T0 + H]);
  // Zoom keeps the moment under the pointer, and stops at the least and at the whole span.
  t.zoomAt(0.5, T0 + 0.5 * H);
  expect([t.start, t.end]).toEqual([T0 + 0.25 * H, T0 + 0.75 * H]);
  t.zoomAt(1e-9, T0 + 0.5 * H);
  expect(t.end - t.start).toBe(WINDOW_LEAST);
  t.zoomAt(1e9, T0);
  expect([t.start, t.end]).toEqual([T0, T0 + 6 * H]);
  t.show(T0 - 10 * H, T0 - 9 * H);
  expect([t.start, t.end]).toEqual([T0, T0 + H]);
  // Back to live: the window ends at now.
  t.goLive();
  expect([t.live, t.at, t.end, t.end - t.start]).toEqual([true, T0 + 6 * H, T0 + 6 * H, H]);
  expect(PRESETS.map((p) => p.label)).toEqual(["10 min", "1 h", "6 h", "1 day", "1 week"]);
  // A pixel of the strip is a moment of the window, and back.
  expect(t.time(t.x(T0 + 5.5 * H, 800), 800)).toBeCloseTo(T0 + 5.5 * H, 3);
});

test("playing moves the playhead at its speed, keeps it in a window that moves on, and stops at the log's end", () => {
  const t = new Timeline();
  t.setSpan(T0, T0 + 2 * H);
  t.seek(T0 + 0.5 * H);
  t.show(T0, T0 + H);
  t.playing = true;
  t.speed = 60;
  t.advance(1000);
  expect(t.at).toBe(T0 + 0.5 * H + 60_000);
  // Near the window's end it moves on, the playhead a tenth from its end.
  t.advance(25_000);
  expect(t.at).toBe(T0 + 0.5 * H + 26 * 60_000);
  expect([t.end - t.start, t.end - t.at]).toEqual([H, 0.1 * H]);
  t.speed = 3600;
  t.advance(10_000);
  expect([t.at, t.playing, t.end]).toEqual([T0 + 2 * H, false, T0 + 2 * H]);
  // Live does not play.
  t.goLive();
  t.playing = true;
  t.advance(1000);
  expect(t.at).toBe(T0 + 2 * H);
});

test("a window asks for its places at a step that shares about 12,000 points among those online, a stretch wider than it, on whole seconds", () => {
  expect(stepFor(H, 1)).toBe(500);
  expect(stepFor(H, 50)).toBe(15_000);
  expect(stepFor(24 * H, 200)).toBe(1_800_000);
  expect(stepFor(60_000, 3)).toBe(100);
  expect(stepFor(H, 10, 2000)).toBe(30_000);
  expect(POINTS).toBe(12_000);
  const t = new Timeline();
  t.setSpan(T0 + 123, T0 + 10 * H + 456);
  t.seek(T0 + 5 * H);
  t.show(T0 + 4 * H + 400, T0 + 6 * H + 400);
  expect(fetchSpan(t)).toEqual([T0 + 3 * H, T0 + 7 * H + 1000]);
  // At the span's ends it stops there, on whole seconds.
  t.show(T0, T0 + H);
  expect(fetchSpan(t)[0]).toBe(T0);
  // What is held serves a pan inside it and a zoom in to twice as fine; not a pan past it, nor a zoom in further.
  const held = { from: T0, to: T0 + 4 * H, step: 10_000 };
  expect(serves(held, T0 + H, T0 + 3 * H, 10_000)).toBe(true);
  expect(serves(held, T0 + H, T0 + 3 * H, 5000)).toBe(true);
  expect(serves(held, T0 + H, T0 + 3 * H, 2000)).toBe(false);
  expect(serves(held, T0 + 3 * H, T0 + 5 * H, 10_000)).toBe(false);
  // The log's end moves every second: an end a few seconds past what is held is served until it is fetched again.
  expect(serves(held, T0 + 3 * H, T0 + 4 * H + 3000, 10_000)).toBe(true);
  expect(serves(null, T0, T0 + H, 1000)).toBe(false);
});

test("a moment typed in a date and time field is read on the reader's clock", () => {
  // Five hours behind UTC: nine last night there is two in the morning UTC.
  expect(localMoment("2026-11-17T21:00", 300)).toBe(Date.UTC(2026, 10, 18, 2, 0));
  expect(localMoment("2026-11-17T21:00:30", 300)).toBe(Date.UTC(2026, 10, 18, 2, 0, 30));
  expect(localMoment("nine last night", 300)).toBeNull();
  expect(localText(Date.UTC(2026, 10, 18, 2, 0), 300)).toBe("2026-11-17T21:00");
});

/** A track of samples a second apart from `from`, walking +x a metre a second; `state` and `seat` alike throughout. */
function walk(pid: number, from: number, n: number, state = LOG_ALIVE, seat = 0): LogTrack {
  const wall = Array.from({ length: n }, (_, i) => from + i * 1000);
  return { pid, name: `s${pid}`, wall, tick: wall.map((_, i) => i * 30), x: wall.map((_, i) => 100 + i), y: wall.map(() => 4), z: wall.map(() => 50), state: wall.map(() => state), seat: wall.map(() => seat) };
}

function survivor(pid: number, sessions: [number, number | null][], tribe = ""): LogSurvivor {
  return { pid, name: `s${pid}`, playMs: 0, sessions: sessions.map(([from, to]) => ({ began: from, from, fromTick: 0, to, toTick: to === null ? null : 0, team: pid * 10, tribe, why: to === null ? "" : "left" })) };
}

test("between two samples a survivor is on the line between them; past a gap it stays at the earlier; before its first it is nowhere", () => {
  const tr = walk(1, T0, 10);
  expect([sampleBefore(tr.wall, T0 - 1), sampleBefore(tr.wall, T0), sampleBefore(tr.wall, T0 + 2500), sampleBefore(tr.wall, T0 + 99_000)]).toEqual([-1, 0, 2, 9]);
  expect(placeAt(tr, T0 + 2500, 2500)).toEqual({ x: 102.5, z: 50, state: LOG_ALIVE, seat: 0 });
  expect(placeAt(tr, T0 + 9000 + 60_000, 2500)!.x).toBe(109);
  expect(placeAt(tr, T0 - 2000, 2500)!.x).toBe(100);
  expect(placeAt(tr, T0 - 3000, 2500)).toBeNull();
  // A step thinned past the gap is not walked across: the survivor stays at the earlier sample.
  const thin = { ...tr, wall: [T0, T0 + 60_000], x: [100, 160], z: [50, 50], state: [0, 0], seat: [0, 0], y: [4, 4], tick: [0, 1800] };
  expect(placeAt(thin, T0 + 30_000, 2500)!.x).toBe(100);
  // A tail is the samples of the last stretch then the place now, none from before the session began.
  expect(tailOf(tr, T0 + 4500, 3000, 2500, T0)).toEqual([102, 50, 103, 50, 104, 50, 104.5, 50]);
  expect(tailOf(tr, T0 + 4500, 3000, 2500, T0 + 4000)).toEqual([104, 50, 104.5, 50]);
});

test("the map at a moment has only those online then, where they were, as they were, on what they rode, and with a tail", () => {
  const end = T0 + 600_000;
  const positions: LogPositions = { from: T0, to: end, step: 1000, seats: ["", "core:compact"], tracks: [walk(1, T0, 300), walk(2, T0, 300, LOG_DEAD), walk(3, T0 + 100_000, 200, LOG_AWAY), walk(4, T0, 300, LOG_ALIVE, 1)] };
  // Survivor 3 left at T0 + 200 s; survivor 4 came back at T0 + 250 s after leaving at T0 + 60 s.
  const survivors = [survivor(1, [[T0, null]]), survivor(2, [[T0, null]]), survivor(3, [[T0 + 100_000, T0 + 200_000]]), survivor(4, [[T0, T0 + 60_000], [T0 + 250_000, null]])];
  expect(sessionAt(survivors[3]!, T0 + 100_000, end)).toBeNull();
  expect(sessionAt(survivors[3]!, T0 + 260_000, end)!.from).toBe(T0 + 250_000);
  expect(sessionAt(survivors[0]!, end, end)!.from).toBe(T0);
  const at = frameAt(T0 + 150_500, survivors, positions, end, 5000);
  expect([at.at, at.live]).toEqual([T0 + 150_500, false]);
  // Survivor 4 was offline then: not drawn at its last place as if present.
  expect(at.dots.map((d) => [d.pid, d.state, d.riding, d.team])).toEqual([[2, DOT_DEAD, "", 20], [3, DOT_AWAY, "", 30], [1, DOT_ONLINE, "", 10]]);
  expect(at.dots.find((d) => d.pid === 1)!.x).toBe(250.5);
  expect(at.dots.find((d) => d.pid === 1)!.tail).toEqual([246, 50, 247, 50, 248, 50, 249, 50, 250, 50, 250.5, 50]);
  // Survivor 3's tail starts with its session.
  expect(at.dots.find((d) => d.pid === 3)!.tail![0]).toBe(146);
  const later = frameAt(T0 + 260_000, survivors, positions, end, 5000);
  expect(later.dots.find((d) => d.pid === 4)!.riding).toBe("core:compact");
  expect(later.dots.some((d) => d.pid === 3)).toBe(false);
  // The table at a moment: those online first, with what they did in the window.
  const rows = rowsAt(T0 + 100_000, survivors, positions, [{ wall: T0 + 50_000, tick: 0, kind: "death", pid: 2, name: "s2", text: "fall", cache: 0 }], T0, end, end);
  expect(rows.map((r) => [r.pid, r.online, r.playMs, r.sessions, r.deaths])).toEqual([[1, true, 600_000, 1, 0], [2, true, 600_000, 1, 1], [3, true, 100_000, 1, 0], [4, false, 410_000, 2, 0]]);
  expect(Number.isNaN(rows[3]!.x)).toBe(true);
});

test("the window's figures: online across it, the most at once, who played most, and deaths by cause", () => {
  const end = T0 + 4 * H;
  const survivors = [survivor(1, [[T0, T0 + 2 * H], [T0 + 3 * H, null]], "Gulls"), survivor(2, [[T0 + H, T0 + 2.5 * H]]), survivor(3, [[T0 + 1.5 * H, T0 + 1.6 * H]])];
  expect(onlineCounts(survivors, T0, end, 8, end)).toEqual([1, 1, 2, 3, 2, 1, 1, 1]);
  const marks = [
    { wall: T0 + 0.5 * H, tick: 1, kind: "death" as const, pid: 1, name: "s1", text: "fall", cache: 0 },
    { wall: T0 + 1.2 * H, tick: 2, kind: "death" as const, pid: 2, name: "s2", text: "creature", cache: 9 },
    { wall: T0 + 1.3 * H, tick: 3, kind: "death" as const, pid: 1, name: "s1", text: "fall", cache: 0 },
    { wall: T0 + 1.4 * H, tick: 4, kind: "admin" as const, pid: 0, name: "op", text: "give stone 5", cache: 0 },
    { wall: T0 + 9 * H, tick: 5, kind: "death" as const, pid: 1, name: "s1", text: "fall", cache: 0 },
  ];
  const f = figures(survivors, marks, T0, end, end);
  expect([f.survivors, f.sessions, f.playMs, f.peak, f.peakAt, f.deaths, f.causes, f.commands]).toEqual([3, 4, 3 * H + 1.5 * H + 0.1 * H, 3, T0 + 1.5 * H, 3, [["fall", 2], ["creature", 1]], 1]);
  expect(f.players.map((p) => [p.pid, p.playMs, p.sessions, p.tribe])).toEqual([[1, 3 * H, 2, "Gulls"], [2, 1.5 * H, 1, ""], [3, 0.1 * H, 1, ""]]);
  // Clipped to a narrower window.
  expect(figures(survivors, marks, T0 + 2 * H, T0 + 3 * H, end).players.map((p) => [p.pid, p.playMs])).toEqual([[2, 0.5 * H]]);
});

const changes: LogChanges = {
  pid: 7,
  name: "Ana",
  from: T0,
  to: T0 + H,
  before: [{ item: "core:stone", quality: 0, blueprint: false, count: 5 }],
  after: [],
  gained: [],
  lost: [],
  entries: [
    { wall: T0 + 60_000, tick: 1, gained: [{ item: "core:stone", quality: 0, blueprint: false, count: 3 }, { item: "core:spear", quality: 3, blueprint: false, count: 1 }], lost: [] },
    { wall: T0 + 120_000, tick: 2, gained: [{ item: "core:spear", quality: 2, blueprint: true, count: 1 }], lost: [{ item: "core:stone", quality: 0, blueprint: false, count: 8 }] },
  ],
  more: false,
};

test("what was held at a moment is the window's first holding with each change up to it added", () => {
  expect(heldAt(changes, T0 + 1000)).toEqual([{ item: "core:stone", quality: 0, blueprint: false, count: 5 }]);
  expect(heldAt(changes, T0 + 60_000).map((h) => [h.item, h.quality, h.count])).toEqual([["core:spear", 3, 1], ["core:stone", 0, 8]]);
  expect(heldAt(changes, T0 + 3_000_000).map((h) => [h.item, h.quality, h.blueprint, h.count])).toEqual([["core:spear", 2, true, 1], ["core:spear", 3, false, 1]]);
  // The window's own lists are not changed by it.
  expect(changes.before[0]!.count).toBe(5);
  expect([nearestChange(changes.entries, T0), nearestChange(changes.entries, T0 + 100_000), nearestChange([], T0)]).toEqual([0, 1, -1]);
  const labels = { "core:spear": "Spear" };
  expect(itemName({ item: "core:spear", quality: 3, blueprint: false }, labels)).toBe("journeyman Spear");
  expect(itemName({ item: "core:metal_ingot", quality: 0, blueprint: true }, labels)).toBe("metal ingot blueprint");
  expect(heldText({ item: "core:stone", quality: 0, blueprint: false, count: 1200 }, labels)).toBe("1,200 stone");
  expect(changeText(changes.entries[1]!, labels)).toBe("+apprentice Spear blueprint, −8 stone");
});

test("the page asks for a window once, then only when a pan or a zoom leaves what it holds, and drops an answer a newer ask overtook", async () => {
  const asked: string[] = [];
  let slow: (() => void) | null = null;
  const get = async (path: string): Promise<unknown> => {
    asked.push(path.slice(0, path.indexOf("?")));
    // The second ask for a window's survivors waits until the test lets it go.
    if (path.startsWith("log/survivors.json") && slow === null && asked.filter((p) => p === "log/survivors.json").length === 2) await new Promise<void>((done) => (slow = done));
    if (path.startsWith("log/survivors.json")) return [survivor(1, [[T0, null]])];
    if (path.startsWith("log/positions.json")) return { from: T0, to: T0 + H, step: Number(/step=(\d+)/.exec(path)![1]), seats: [""], tracks: [] };
    if (path.startsWith("log/marks.json")) return { marks: [], more: false };
    if (path.startsWith("log/track.json")) return { from: T0, to: T0 + H, step: Number(/step=(\d+)/.exec(path)![1]), seats: [""], tracks: [] };
    if (path.startsWith("log/changes.json")) return changes;
    if (path.startsWith("log/holders.json")) return [{ pid: 1, name: "s1", quality: 0, blueprint: false, from: T0, to: null, most: 3 }];
    return [];
  };
  const r = new Recall(get);
  const t = new Timeline();
  t.setSpan(T0, T0 + 10 * H);
  t.seek(T0 + 5 * H);
  t.show(T0 + 4 * H, T0 + 6 * H);
  expect(await r.fetchWindow(t)).toBe(true);
  expect(asked).toEqual(["log/survivors.json", "log/positions.json", "log/marks.json", "log/items.json"]);
  expect([r.window!.from, r.window!.to, r.window!.step]).toEqual([T0 + 3 * H, T0 + 7 * H, stepFor(4 * H, 1)]);
  // A small pan is served by what is held.
  t.pan(30 * 60_000);
  expect(await r.fetchWindow(t)).toBe(false);
  expect(asked.length).toBe(4);
  // A pan past it asks again; while that ask waits, a newer one overtakes it, and the older answer is dropped.
  t.pan(3 * H);
  const older = r.fetchWindow(t);
  t.pan(H);
  const newer = r.fetchWindow(t);
  expect(await newer).toBe(true);
  slow!();
  expect(await older).toBe(false);
  expect(r.window!.to).toBe(T0 + 10 * H);
  // A chosen survivor's track is finer, and its changes come with it; asked once while it serves.
  expect(await r.fetchChosen(7, t)).toBe(true);
  expect(await r.fetchChosen(7, t)).toBe(false);
  expect(r.chosen!.changes.name).toBe("Ana");
  r.forget();
  expect(r.chosen).toBeNull();
  expect(await r.fetchHolders("core:stone", 0, null, t)).toBe(true);
  expect(asked.at(-1)).toBe("log/holders.json");
  expect([...holdingAt(r.holders!.holders, T0 + H, T0 + 10 * H)]).toEqual([1]);
  expect([...holdingAt(r.holders!.holders, T0 - 1, T0 + 10 * H)]).toEqual([]);
});

test("the time axis marks days where its window spans days, and the clock to the second where it spans seconds", () => {
  const offset = 300;
  const midnight = Date.UTC(2026, 10, 18, 5, 0);
  expect(dayText(midnight, offset)).toBe("Wed 18 Nov");
  expect(momentText(midnight + 75_500, offset)).toBe("Wed 18 Nov 00:01:15");
  expect([timeStep(T0, T0 + 3 * 86_400_000, 6), timeStep(T0, T0 + 3 * 86_400_000, 3)]).toEqual([43_200_000, 86_400_000]);
  expect(tickText(midnight, 3_600_000, offset)).toBe("Wed 18 Nov");
  expect(tickText(midnight + 3_600_000, 3_600_000, offset)).toBe("01:00");
  expect(tickText(midnight + 15_000, 5000, offset)).toBe("00:00:15");
  expect(timeStep(T0, T0 + 30_000, 6)).toBe(5000);
});
