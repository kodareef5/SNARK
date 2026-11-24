import { expect, test } from "bun:test";
import { framed, CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import type { LogMark } from "../../shared/survivor-log.ts";
import type { MapHead, MapPart } from "../../shared/world/mapfile.ts";
import { DEFAULT_LAYERS, nextEvent, readInvestigation, windowEvents, writeInvestigation } from "../../client/core/admin/investigation.ts";
import { Recall } from "../../client/core/admin/recall.ts";
import { streetsInView } from "../../client/core/admin/street-view.ts";
import { Timeline } from "../../client/core/admin/timeline.ts";
import { MapWindow } from "../../client/core/admin/view.ts";

test("a shared replay link restores its time, selected item, survivor, and map", () => {
  const from = new URLSearchParams("locale=en&at=1500&from=1000&to=2000&survivor=12&layers=streets,events&x=0&z=21&zoom=.15&item=core:spear|3|1");
  const to = new URLSearchParams("locale=en");
  const state = readInvestigation(from);
  expect(state).toEqual({
    at: 1500, start: 1000, end: 2000, survivor: 12, camera: { x: 0, z: 21, zoom: 0.15 },
    item: { item: "core:spear", quality: 3, blueprint: true }, layers: ["streets", "events"],
  });
  writeInvestigation(to, state);
  expect(readInvestigation(to)).toEqual(state);
  expect(to.get("locale")).toBe("en");
});

test("invalid replay values are ignored and empty layers can be restored", () => {
  const state = readInvestigation(new URLSearchParams("at=NaN&from=3&to=2&survivor=1.7&x=1&z=2&zoom=0&item=bad|NaN|1&layers=wrong"));
  expect(state).toEqual({ at: null, start: null, end: null, survivor: 0, item: null, layers: [], camera: null });
  const query = new URLSearchParams();
  writeInvestigation(query, state);
  expect(readInvestigation(query).layers).toEqual([]);
  expect(readInvestigation(new URLSearchParams()).layers).toEqual(DEFAULT_LAYERS);
});

test("event navigation moves in time through the chosen kind and visible window", () => {
  const mark = (wall: number, kind: LogMark["kind"]): LogMark => ({ wall, kind, tick: wall, pid: 1, name: "Ada", text: "", cache: 0 });
  const events = windowEvents([mark(1200, "death"), mark(700, "death"), mark(1100, "admin"), mark(900, "death"), mark(1000, "death")], 800, 1200, "death");
  expect(nextEvent(events, 1000, -1)?.wall).toBe(900);
  expect(nextEvent(events, 1000, 1)?.wall).toBe(1200);
  expect(nextEvent(events, 900, -1)).toBeNull();
  expect(nextEvent(events, 1200, 1)).toBeNull();
});

test("street reads stay in the map window and favour its centre", () => {
  const sector = CHUNK_SIZE * SECTOR_CHUNKS;
  const dims = framed({ chunksX: 4 * SECTOR_CHUNKS, chunksZ: 4 * SECTOR_CHUNKS, frameX: 10 * SECTOR_CHUNKS, frameZ: 20 * SECTOR_CHUNKS });
  const part = (col: number, row: number, kind: MapPart["kind"]): MapPart => ({ col, row, kind, at: 0, length: 0, hash: "", name: `${kind}-${col}-${row}` });
  const missed = part(13, 23, "streets"), centred = part(11, 21, "streets"), edge = part(12, 21, "streets");
  const head: Pick<MapHead, "dims" | "parts"> = { dims, parts: [missed, edge, part(11, 21, "ground"), centred] };
  const view = new MapWindow({ sizeX: 4 * sector, sizeZ: 4 * sector });
  view.resize(400, 400);
  view.look(1.7 * sector, 1.5 * sector, 250 / sector);
  expect(streetsInView(head, view, 8)).toEqual([centred, edge]);
  expect(streetsInView(head, view, 1)).toEqual([centred]);
});

test("a holding response cannot replace the variant selected after it", async () => {
  let resolveOlder: (value: unknown) => void = () => {};
  const older = new Promise<unknown>((resolve) => { resolveOlder = resolve; });
  const r = new Recall(async (path) => path.includes("blueprint=0") ? older : []);
  const t = new Timeline();
  t.setSpan(1000, 61_000);
  const late = r.fetchHolders("core:spear", 0, false, t);
  expect(await r.fetchHolders("core:spear", 0, false, t)).toBe(false);
  expect(await r.fetchHolders("core:spear", 0, true, t)).toBe(true);
  resolveOlder([{ pid: 9 }]);
  expect(await late).toBe(false);
  expect(r.holdersFor("core:spear", 0, true, t)?.holders).toEqual([]);
  expect(r.holdersFor("core:spear", 0, false, t)).toBeNull();
  r.forgetHolders();
  expect(r.holdersFor("core:spear", 0, true, t)).toBeNull();
});

test("returning to a cached window keeps a pending old seek from replacing it", async () => {
  let release: (value: unknown) => void = () => {};
  const waiting = new Promise<unknown>((resolve) => { release = resolve; });
  const r = new Recall(async (path) => {
    if (path.startsWith("log/survivors.json")) return path.includes("from=61000&") ? waiting : [];
    if (path.startsWith("log/positions.json")) return { step: Number(new URLSearchParams(path.split("?")[1]).get("step")), tracks: [] };
    if (path.startsWith("log/marks.json")) return { marks: [], more: false };
    return [];
  });
  const t = new Timeline();
  t.setSpan(1000, 241_000);
  t.show(1000, 31_000);
  expect(await r.fetchWindow(t)).toBe(true);
  const cached = r.windowFor(t);
  t.show(76_000, 106_000);
  const old = r.fetchWindow(t);
  expect(r.windowFor(t)).toBeNull();
  t.show(1000, 31_000);
  expect(await r.fetchWindow(t)).toBe(false);
  release([]);
  expect(await old).toBe(false);
  expect(r.windowFor(t)).toBe(cached);
});
