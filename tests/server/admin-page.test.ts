// The /admin/ page's logic, headless (client/core/admin): the map's window and grid, its ground from the overviews alone, the
// bases as squares, the frame of survivors it draws, the health verdict, finding and sorting survivors, and the charts' axes.

import { expect, test } from "bun:test";
import type { Minutes, Stats, SurvivorRow } from "../../shared/admin.ts";
import { MINUTE_FIELDS } from "../../shared/admin.ts";
import { framed } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { COORD_UNIT, latOf, lonOf, xOfLon, zOfLat } from "../../shared/world/coords.ts";
import { mapHeightfield, parseMap, partsOf, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { CELL_FILLED, Cells } from "../../shared/world/tactical.ts";
import { baseColour, baseSquares } from "../../client/core/admin/bases.ts";
import { SPANS, chartRuns, clockText, joinMinutes, niceStep, timeTicks, valueAxis } from "../../client/core/admin/chart.ts";
import { agoText, bytesText, counted, idWords, msText, spanText } from "../../client/core/admin/format.ts";
import { DOT_DEAD, DOT_OFFLINE, DOT_ONLINE, dotAt, liveFrame } from "../../client/core/admin/frame.ts";
import { OVERVIEW_CELL, groundPicture, loadGround, pictureExtent, pictureSide } from "../../client/core/admin/ground.ts";
import { FAILING, STRAINED, WELL, recentLoop, verdict } from "../../client/core/admin/health.ts";
import { deathsText, findSurvivors, placeText, seenText, sortSurvivors } from "../../client/core/admin/table.ts";
import { MapWindow, SCALE_MOST, gridLines } from "../../client/core/admin/view.ts";
import { cornerMap } from "../fixtures/map.ts";

test("the map's window is north up with east to the right, zooms about the pointer, and keeps its middle on the map", () => {
  const map = { sizeX: 4000, sizeZ: 2000 };
  const w = new MapWindow(map);
  w.resize(800, 600);
  // Fitted: the wider side fills the window, short of a margin, and the map's middle is the window's.
  expect(w.scale).toBeCloseTo((800 / 4000) * 0.96, 9);
  expect([w.sx(2000), w.sy(1000)]).toEqual([400, 300]);
  // x = 0 is the map's east edge, on the right; z = sizeZ its north edge, at the top.
  expect(w.sx(0)).toBeGreaterThan(w.sx(4000));
  expect(w.sy(2000)).toBeLessThan(w.sy(0));
  expect([w.worldX(w.sx(1234)), w.worldZ(w.sy(567))].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1234, 567]);
  // A zoom keeps what is under the pointer under it.
  const [px, py] = [610, 140];
  const [wx, wz] = [w.worldX(px), w.worldZ(py)];
  w.zoomAt(3, px, py);
  expect([w.worldX(px) - wx, w.worldZ(py) - wz].map((v) => Math.abs(v) < 1e-6)).toEqual([true, true]);
  expect(w.fitted).toBe(false);
  // A drag moves what was under the pointer with it.
  const [ax, az] = [w.worldX(300), w.worldZ(200)];
  w.pan(50, -20);
  expect([w.worldX(350) - ax, w.worldZ(180) - az].map((v) => Math.abs(v) < 1e-6)).toEqual([true, true]);
  // The window's middle stays on the map, and zoom stops at its bounds.
  w.pan(1e7, 1e7);
  expect([w.x, w.z]).toEqual([4000, 2000]);
  w.zoomAt(1e9, 400, 300);
  expect(w.scale).toBe(SCALE_MOST);
  w.zoomAt(1e-9, 400, 300);
  expect(w.scale).toBeCloseTo(w.fitScale() * 0.5, 9);
  // Fitting again holds through a resize; a look puts a place in the middle.
  w.fit();
  w.resize(400, 400);
  expect([w.x, w.z, w.scale]).toEqual([2000, 1000, (400 / 4000) * 0.96]);
  w.look(100, 200, 1);
  expect([w.sx(100), w.sy(200), w.scale, w.fitted]).toEqual([200, 200, 1, false]);
});

test("the grid's lines are the map's latitudes and longitudes, every sector numbered, and every unit where they stand apart", () => {
  // An 8 km map off the lattice's corner.
  const d = framed({ chunksX: 128, chunksZ: 120, frameX: 2000, frameZ: 2010 });
  const w = new MapWindow({ sizeX: 128 * 64, sizeZ: 120 * 64 });
  w.resize(600, 600);
  const far = gridLines(d, w);
  // Fitted, a unit is under 24 pixels: sector lines only, at their places, each where its coordinate says, and numbered.
  // Its west edge is longitude 0 and its east 80; its north edge latitude 8.75, its room above, and its south 83.75.
  expect([far.lon.map((l) => l.k), far.lat.map((l) => l.k)]).toEqual([[0, 10, 20, 30, 40, 50, 60, 70, 80], [10, 20, 30, 40, 50, 60, 70, 80]]);
  for (const l of [...far.lon, ...far.lat]) expect([l.sector, l.numbered]).toEqual([true, true]);
  for (const l of far.lon) expect(l.at).toBeCloseTo(w.sx(xOfLon(d, l.k)), 9);
  for (const l of far.lat) expect(l.at).toBeCloseTo(w.sy(zOfLat(d, l.k)), 9);
  // Within the map: from its west edge to its east, and its north edge to its south.
  expect(far.lon.every((l) => l.k >= lonOf(d, w.map.sizeX) - 1e-9 && l.k <= lonOf(d, 0) + 1e-9)).toBe(true);
  expect(far.lat.every((l) => l.k >= latOf(d, w.map.sizeZ) - 1e-9 && l.k <= latOf(d, 0) + 1e-9)).toBe(true);
  // Near, every unit has a line and a number; the sectors' are marked.
  w.look(w.map.sizeX / 2, w.map.sizeZ / 2, 80 / COORD_UNIT);
  const near = gridLines(d, w);
  expect(near.lon.length).toBeGreaterThan(5);
  expect(near.lon.every((l, i) => i === 0 || Math.abs(l.k - near.lon[i - 1]!.k - 1) < 1e-9)).toBe(true);
  expect(near.lon.every((l) => l.numbered && l.sector === (Math.round(l.k) % 10 === 0))).toBe(true);
});

test("the ground is painted from the overviews alone: every fourth sample of the map's own, its tints and its water", async () => {
  const bytes = writeMap(cornerMap());
  const files = new Map(partsOf(bytes).map((p) => [p.name, p.bytes]));
  const head = readHead(bytes);
  const asked: string[] = [];
  const { hf } = await loadGround(async (url) => {
    asked.push(url);
    return files.get(url.slice(url.lastIndexOf("/") + 1))!;
  }, `../map/${head.name}`);
  // The head and the four overviews whose corner is the map's middle, beside the head; no sector's ground.
  expect(asked.length).toBe(5);
  expect(asked.every((u) => u.startsWith("../map/"))).toBe(true);
  expect(head.parts.filter((p) => p.kind === "overview").length).toBe(4);
  const full = mapHeightfield(parseMap(bytes));
  expect([hf.cell, hf.nx, hf.nz]).toEqual([OVERVIEW_CELL, (full.nx - 1) / 4 + 1, (full.nz - 1) / 4 + 1]);
  let wrong = 0;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) if (hf.heights[j * hf.nx + i] !== full.heights[j * 4 * full.nx + i * 4] || hf.tint[j * hf.nx + i] !== full.tint[j * 4 * full.nx + i * 4]) wrong++;
  expect(wrong).toBe(0);
  expect([hf.waterAt(192, 200), hf.waterAt(100, 10), hf.seaLevel]).toEqual([full.waterAt(192, 200), full.waterAt(100, 10), 0]);
  // The picture: a pixel to a sample along the longer side, at least 256, the square centred on the map.
  expect(pictureSide(hf)).toBe(256);
  const rgba = groundPicture(hf, defaultPalette());
  expect(rgba.length).toBe(256 * 256 * 4);
  // The pond's middle is water's colour, bluer than it is red; the hills beside it are not.
  const at = (x: number, z: number): number[] => {
    const e = pictureExtent(hf);
    const [px, py] = [Math.floor(((e.west - x) / e.side) * 256), Math.floor(((e.north - z) / e.side) * 256)];
    return [...rgba.subarray((py * 256 + px) * 4, (py * 256 + px) * 4 + 3)];
  };
  expect(at(192, 200)[2]! > at(192, 200)[0]!).toBe(true);
  expect(pictureExtent({ sizeX: 4000, sizeZ: 2000 })).toEqual({ west: 4000, north: 3000, side: 4000 });
});

test("a base's cells are squares on the world where its chunk is, in its pieces' colour drawn toward its tribe's, and the chosen tribe's in green", () => {
  const dims = { chunksX: 4, chunksZ: 3 };
  const cells = new Cells();
  cells.level = 1;
  cells.teamCount = 2;
  cells.teams[0] = 0;
  cells.teams[1] = 9;
  // At level 1 a chunk is 8 cells of 8 m a side. Cell (2, 1) is tribe 9's, cell (0, 0) nobody's.
  cells.info[1 * 8 + 2] = CELL_FILLED | (1 << 3) | 3;
  cells.tint[1 * 8 + 2] = 5;
  cells.info[0] = CELL_FILLED | 1;
  cells.tint[0] = 2;
  const palette = defaultPalette();
  const squares = baseSquares(dims, [{ chunk: 6, cells }], palette, 0);
  // Chunk 6 is column 2, row 1: its corner at x 128, z 64.
  expect(squares.map((s) => [s.x, s.z, s.size, s.team])).toEqual([
    [128, 64, 8, 0],
    [128 + 16, 64 + 8, 8, 9],
  ]);
  expect(squares[1]!.colour).toBe(baseColour(palette, 5, 3, 9, 0));
  const red = (c: number): number => c >> 16, green = (c: number): number => (c >> 8) & 255;
  const chosen = baseSquares(dims, [{ chunk: 6, cells }], palette, 9)[1]!.colour;
  expect(green(chosen) > red(chosen)).toBe(true);
  expect(red(squares[1]!.colour) > green(squares[1]!.colour) - 40).toBe(true);
});

/** A survivor as the server lists one, with what a test does not care about filled in. */
function row(name: string, more: Partial<SurvivorRow> = {}): SurvivorRow {
  return { pid: name.length * 1000 + name.charCodeAt(0), name, tribe: "", team: 0, level: 1, online: false, dead: false, out: false, x: 0, z: 0, riding: "", lastLogin: null, lastSeen: null, playMs: null, deaths: [], ...more };
}

test("the live frame has the online drawn over the offline, and a tap finds the dot under it", () => {
  const rows = [row("Ann", { online: true, x: 10, z: 10 }), row("Bo", { x: 50, z: 50 }), row("Cy", { online: true, dead: true, x: 90, z: 90 })];
  const all = liveFrame(5000, rows, true);
  expect([all.at, all.live]).toEqual([5000, true]);
  expect(all.dots.map((d) => [d.name, d.state])).toEqual([["Bo", DOT_OFFLINE], ["Cy", DOT_DEAD], ["Ann", DOT_ONLINE]]);
  expect(liveFrame(5000, rows, false).dots.map((d) => d.name)).toEqual(["Cy", "Ann"]);
  const place = (d: { x: number; z: number }): [number, number] => [d.x, d.z];
  expect(dotAt(all, place, 52, 47, 6)?.name).toBe("Bo");
  expect(dotAt(all, place, 70, 70, 6)).toBeNull();
});

test("a survivor is found by a few letters of its name or its tribe, names that start so first, and the online lead every order but the alphabet", () => {
  const rows = [
    row("Marta Reyes", { tribe: "Gulls", lastSeen: 100, level: 30, playMs: 9e6 }),
    row("Ana Martin", { tribe: "Ospreys", online: true, lastSeen: 999, level: 5, playMs: 1e6, deaths: [{ tick: 1, at: null, x: 0, z: 0 }] }),
    row("Mart", { tribe: "", lastSeen: 500, level: 12, playMs: 5e6 }),
    row("Zed", { tribe: "Martians", lastSeen: null, level: 2 }),
  ];
  expect(findSurvivors(rows, "mart").map((r) => r.name)).toEqual(["Marta Reyes", "Mart", "Ana Martin", "Zed"]);
  expect(findSurvivors(rows, "  ").length).toBe(4);
  expect(findSurvivors(rows, "ana osp").map((r) => r.name)).toEqual(["Ana Martin"]);
  expect(findSurvivors(rows, "nobody")).toEqual([]);
  const names = (key: Parameters<typeof sortSurvivors>[1]): string[] => sortSurvivors(rows, key).map((r) => r.name);
  expect(names("seen")).toEqual(["Ana Martin", "Mart", "Marta Reyes", "Zed"]);
  expect(names("name")).toEqual(["Ana Martin", "Mart", "Marta Reyes", "Zed"]);
  expect(names("level")).toEqual(["Ana Martin", "Marta Reyes", "Mart", "Zed"]);
  expect(names("played")).toEqual(["Ana Martin", "Marta Reyes", "Mart", "Zed"]);
  expect(names("tribe")).toEqual(["Ana Martin", "Marta Reyes", "Zed", "Mart"]);
  expect(names("deaths")[0]).toBe("Ana Martin");
  const now = 10 * 3_600_000;
  expect([seenText(rows[1]!, now), seenText({ ...rows[1]!, dead: true }, now), seenText(rows[3]!, now), seenText({ ...rows[0]!, lastSeen: now - 3 * 3_600_000 }, now)]).toEqual(["online", "online, dead", "never seen", "3 h ago"]);
  expect(deathsText({ ...rows[0]!, deaths: [{ tick: 9, at: null, x: 0, z: 0 }, { tick: 90, at: now - 120_000, x: 0, z: 0 }] }, now)).toBe("2, last 2 min ago");
  expect(deathsText(rows[1]!, now)).toBe("1, last at tick 1");
  const d = readHead(writeMap(cornerMap())).dims;
  expect(placeText(d, xOfLon(d, 12.5), zOfLat(d, 40))).toBe("40.0 lat  12.5 lon");
});

/** Stats as the server says them, the loop running at `p50` ms a tick for ten seconds. */
function stats(p50: number, more: { late?: number; dropped?: number; perSecond?: number; failing?: boolean; bodies?: number; refused?: number; long?: Stats["ticks"]["long"] } = {}): Stats {
  const n = 10;
  const col = (v: number): number[] => Array.from({ length: n }, () => v);
  return {
    at: 1e12,
    world: { name: "Isla", dev: false, tick: 9000, startedAt: 1e12 - 3_600_000, cluster: "" },
    map: { id: "core:isla", label: "Isla", sizeX: 8192, sizeZ: 8192, chunksX: 128, chunksZ: 128 },
    ticks: { rate: 30, budget: 1000 / 30, ran: 9000, dropped: more.dropped ?? 0, seconds: { at: col(0).map((_, i) => 1e12 - (n - i) * 1000), ticks: col(more.perSecond ?? 30), p50: col(p50), worst: col(p50 * 2), late: col(more.late ?? 2), dropped: col(0).map((_, i) => (i === n - 1 ? (more.dropped ?? 0) : 0)) }, long: more.long ?? { own: 0, core: 0, page: 0 } },
    online: { now: 3, max: 70 },
    bodies: { count: more.bodies ?? 1000, max: 20000, reserve: 70, refused: more.refused ?? 0, groups: {}, kinds: [] },
    memory: { rss: 5e8, heapUsed: 2e8, heapTotal: 3e8 },
    save: { file: "world.db", bytes: 1e8, commits: 50000, failing: more.failing ? { seconds: 75, tries: 9, code: "SQLITE_FULL", error: "database or disk is full" } : null, checkpoint: { ms: 4, pages: 0 }, backups: [] },
    log: { on: true, why: "", from: 1e12 - 86_400_000, to: 1e12, fromTick: 0, toTick: 9000, bytes: 1e7, cap: 1 << 30, segments: 3 },
    settings: [],
    modules: [],
  };
}

test("the verdict leads with the worst thing wrong: the save failing, then falling behind, then strain, else healthy", () => {
  const well = verdict(stats(4));
  expect([well.level, well.word, well.reasons]).toEqual([WELL, "Healthy", []]);
  expect(well.line).toBe("ticks 4.0 ms typical, 8.0 ms at worst of 33.3 ms · on time · 3 survivors online");
  expect(recentLoop(stats(4))).toEqual({ perSecond: 30, typical: 4, worst: 8, late: 2, dropped: 0, seconds: 10 });
  const busy = verdict(stats(20));
  expect([busy.level, busy.word, busy.reasons]).toEqual([STRAINED, "Strained", ["ticks take 20.0 ms of their 33.3 ms"]]);
  const behind = verdict(stats(30, { perSecond: 22, late: 400 }));
  expect([behind.level, behind.word, behind.reasons[0]]).toEqual([FAILING, "Falling behind", "falling behind: 22.0 ticks a second of 30"]);
  const saving = verdict(stats(30, { failing: true, dropped: 4 }));
  expect([saving.level, saving.word]).toEqual([FAILING, "Not saving"]);
  expect(saving.reasons[0]).toBe("the save has failed for 1 min (SQLITE_FULL); what happens now is lost if it stops");
  expect(saving.reasons[1]).toBe("falling behind: 30.0 ticks a second of 30, 4 ticks given up");
  const full = verdict(stats(4, { bodies: 19000, refused: 12 }));
  expect([full.level, full.reasons]).toEqual([STRAINED, ["19,000 bodies of the 19,930 the world has room for", "12 bodies refused for want of room since the start"]]);
  const none = verdict({ ...stats(4), ticks: { ...stats(4).ticks, seconds: { at: [], ticks: [], p50: [], worst: [], late: [], dropped: [] } } });
  expect([none.level, none.reasons]).toEqual([STRAINED, ["no tick has been timed yet"]]);
  // Strained by its long ticks, a server says whose they were; a healthy one with a few says nothing of them.
  const long = { own: 2, core: 14, page: 1 };
  const shared = verdict(stats(20, { long }));
  expect([shared.level, shared.reasons]).toEqual([STRAINED, ["ticks take 20.0 ms of their 33.3 ms", "of the ticks over 33.3 ms in the last two minutes, 2 were the server's own work, 14 waited for a core and 1 for pages"]]);
  expect(verdict(stats(4, { long })).reasons).toEqual([]);
});

test("charts: round steps up a value axis, round times of the reader's clock along the foot, and runs broken where nothing was timed", () => {
  expect([niceStep(33.3, 3), niceStep(7, 3), niceStep(950, 4), niceStep(0.04, 2), niceStep(0, 3)]).toEqual([20, 5, 500, 0.02, 1]);
  expect(valueAxis(12, 33.3)).toEqual({ top: 40, ticks: [0, 20, 40] });
  expect(valueAxis(130, 33.3)).toEqual({ top: 150, ticks: [0, 50, 100, 150] });
  expect(valueAxis(0, 4)).toEqual({ top: 4, ticks: [0, 2, 4] });
  // The hour's marks fall on the reader's hour: five hours behind UTC, 14:00 there is 19:00 UTC.
  const t0 = Date.UTC(2026, 10, 18, 18, 47), t1 = t0 + 6 * 3_600_000;
  const marks = timeTicks(t0, t1, 6, 300);
  expect(marks.map((t) => clockText(t, 300))).toEqual(["14:00", "15:00", "16:00", "17:00", "18:00", "19:00"]);
  expect(timeTicks(t0, t0 + 3_600_000, 4, 0).map((t) => clockText(t, 0))).toEqual(["19:00", "19:15", "19:30", "19:45"]);
  expect(clockText(Date.UTC(2026, 0, 1, 3, 4, 5), -60, true)).toBe("04:04:05");
  expect(SPANS.map((s) => s.label)).toEqual(["1 h", "6 h", "24 h"]);
  // Two runs where three minutes went untimed, scaled to a 100 by 50 chart with its top at 10.
  const at = [0, 60_000, 120_000, 300_000, 360_000];
  expect(chartRuns(at, [0, 5, 10, 20, 2.5], 0, 400_000, 10, 100, 50, 90_000)).toEqual([
    [0, 50, 15, 25, 30, 0],
    [75, 0, 90, 37.5],
  ]);
  // Minutes asked for again join those held, and a day before the newest is let go.
  const minutes = (from: number, n: number): Minutes => ({ next: from + n, columns: Object.fromEntries(MINUTE_FIELDS.map((f) => [f, Array.from({ length: n }, (_, i) => (f === "at" ? (from + i) * 60_000 : from + i))])) as Minutes["columns"] });
  const held = joinMinutes(joinMinutes(null, minutes(0, 1000)), minutes(1000, 1000));
  expect([held.next, held.columns.at.length, held.columns.at[0], held.columns.p50.at(-1)]).toEqual([2000, 1441, 559 * 60_000, 1999]);
  expect(joinMinutes(minutes(0, 0), minutes(0, 2)).columns.at).toEqual([0, 60_000]);
});

test("numbers are written short enough for a tile", () => {
  expect([bytesText(512), bytesText(1500), bytesText(2_340_000), bytesText(612e6), bytesText(1.25e9)]).toEqual(["512 B", "1.5 KB", "2.3 MB", "612 MB", "1.3 GB"]);
  expect([spanText(45_000), spanText(12 * 60_000), spanText(3 * 3_600_000), spanText(3 * 3_600_000 + 12 * 60_000), spanText(4 * 86_400_000 + 6 * 3_600_000)]).toEqual(["45 s", "12 min", "3 h", "3 h 12 min", "4 d 6 h"]);
  expect([agoText(1000, 5000), agoText(0, 90_000)]).toEqual(["just now", "1 min ago"]);
  expect([msText(0.42), msText(4.123), msText(33.33), msText(250)]).toEqual(["0.42 ms", "4.1 ms", "33.3 ms", "250 ms"]);
  expect([idWords("core:wild_boar"), counted(1, "survivor"), counted(1200, "body", "bodies")]).toEqual(["wild boar", "1 survivor", "1,200 bodies"]);
});
