// The page's map as its parts come (client/core/mapload.ts): its head and its landmarks' definitions before anything; the
// ground within reach of the body and its overviews alone, which the first frame waits for, by the rule the map's build
// holds to its budget; then what the page wants (map-want.ts) nearest first to where the body is and is heading, the
// overviews before the rest but for what is within RING, each sector's ground before its statics, four at once while that
// is within RING and two otherwise, and the statics held handed over once those within reach have come. A part that fails
// is asked for again, the wait between asks counted here with no clock.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { nextTask, type Get } from "../../client/core/fetched.ts";
import { AFTER_AT_ONCE, BAND_CHUNKS, DAMAGED_MOST, FIRST_REACH, LOOK_EVERY, MapLoader, RETRY_FIRST, RETRY_MOST, RING, ROADS_AT_ONCE, ROAD_EVERY, ROAD_REACH, StagedMap, URGENT_AT_ONCE, firstFrameParts, handOverParts, type Place } from "../../client/core/mapload.ts";
import { HeldStatics } from "../../client/core/map-statics.ts";
import { pageBytes } from "../../client/core/ground/pages.ts";
import { KEEP_PAST, type WantFrom } from "../../client/core/map-want.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { BEND_BUFFERS } from "../../client/core/render/packet.ts";
import { Scene, type RenderWorld } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { PREDICTED_REACH } from "../../client/core/session.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS, chunkAt } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BEND_SHORTS, packBend, placeKerb } from "../../shared/world/bends.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { COARSE_STEP, OVERVIEW_CHUNKS, OVERVIEW_STEP, mapHeightfield, mapTops, nodeLayers, parseMap, partsOf, readHead, readPart, squareOf, writeMap, type MapData, type MapPart, type MapStatic, type MapStatics, type NodeLayer, type OverviewPiece, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { ROAD_PLANES, roadSamples } from "../../shared/world/roadframe.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { cornerMap, flatMap, wideMap } from "../fixtures/map.ts";
import { denseOf, nodesOf } from "../fixtures/paged-ground.ts";
import { nodePack, nodeRegistry } from "../fixtures/nodeworld.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** wideMap with a landmark, whose definitions are its land part, and none of its nodes listed (see the test of those below). */
function landed(): MapData {
  const m = wideMap();
  return { ...m, nodes: m.nodes.filter((l) => !("first" in l)), content: { landmarks: [{ name: "hut", x: 300, y: 10, z: 300, yaw: 0 }], defs: [{ type: "structure", class: "static", id: "hut:wall", mesh: "box", color: 5, half: [2, 2, 0.2], hp: 50 }] as never } };
}

const file = writeMap(landed());
const whole = parseMap(file);
const head = readHead(file);

/** What a staged map holds, read through its methods: its samples, their tints and the nodes its layers stand. */
const heldOf = (staged: StagedMap): unknown[] => [denseOf(staged.hf).heights, denseOf(staged.hf).tint, nodesOf(staged.hf, coreRegistry(), staged.nodes)];
/** The same of a map held whole. */
const mapOf = (map: MapData): unknown[] => [map.heights, map.tint, nodesOf(mapHeightfield(map), coreRegistry(), map.nodes)];

/** No wait between asks, where nothing fails. */
const NOW = { wait: () => Promise.resolve() };
/** A page that wants all of this map: a view and a statics reach past its corners. */
const ALL = (): WantFrom => ({ view: 1e5, statics: 1e5 });
/** Bytes the store of statics holds with no sector: its sector of each chunk. */
const INDEX = head.counts.length * 2;
/** Bytes of a sector's index of its chunks' first rows. */
const sectorIndex = (p: MapPart): number => {
  const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
  return ((sq.cx1 - sq.cx0) * (sq.cz1 - sq.cz0) + 1) * 4;
};

/** Lets every promise the answers so far started run its course. */
const settle = (): Promise<void> => new Promise((go) => setTimeout(go, 0));

/**
 * A server of a map's head and parts that answers each request only when the test says, counting the bytes it sent, and
 * how many requests were open at most. `change` stands in for what the wire did to a part.
 */
function heldServer(of: Uint8Array, change: (url: string, bytes: Uint8Array) => Uint8Array = (_, b) => b, status: (url: string, ask: number) => number = () => 200) {
  const files = new Map(partsOf(of).map((p) => [`map/${p.name}`, p.bytes]));
  const waiting: { url: string; go: () => void }[] = [];
  const s = {
    asked: [] as string[],
    waiting,
    answered: 0,
    bytes: 0,
    most: 0,
    get: ((url: string) =>
      new Promise<Response>((done) => {
        s.asked.push(url);
        s.most = Math.max(s.most, waiting.length + 1);
        const body = files.get(url);
        const answer = status(url, s.asked.filter((u) => u === url).length);
        waiting.push({ url, go: () => ((s.bytes += body?.length ?? 0), s.answered++, done(answer !== 200 ? new Response("not now", { status: answer }) : body ? new Response(change(url, body)) : new Response("not found", { status: 404 }))) });
      })) as Get,
    /** Answers the waiting request at `k`, and lets what follows from it run. */
    async answer(k = 0): Promise<void> {
      waiting.splice(k, 1)[0]!.go();
      await settle();
    },
    /** Answers every request, those it brings on too, until none is waiting. */
    async drain(pick: (n: number) => number = () => 0): Promise<void> {
      await settle();
      while (waiting.length > 0) await s.answer(pick(waiting.length));
    },
  };
  return s;
}

const nameOf = (p: MapPart): string => `map/${p.name}`;
/** Metres from (x, z) to a part's square, an overview's or a sector's. */
const off = (p: MapPart, x: number, z: number): number => {
  const sq = squareOf(head.dims, p.kind === "overview" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
};
/** Whether a part is an overview, ground or statics within RING of (x, z). */
const ringed = (p: MapPart, x: number, z: number): boolean => (p.kind === "overview" || p.kind === "ground" || p.kind === "statics") && off(p, x, z) <= RING;
/**
 * The order the loader asks for the parts wanted with the body at (x, z): what is within RING; the overviews within the
 * statics reach `near` and then its sectors; the overviews past it; the rest; each nearest first and a sector's ground
 * before its statics.
 */
const rank = (p: MapPart, x: number, z: number, near = 1e5): number => (ringed(p, x, z) ? 0 : (off(p, x, z) <= near ? 1 : 3) + (p.kind === "overview" ? 0 : 1)) * 1e6 + off(p, x, z) + (p.kind === "statics" ? 0.5 : 0);
/** Whether `t` holds the map's rows in the chunks of `sectors` and none elsewhere. */
const rowsOfSectors = (t: MapStatics | null, sectors: readonly MapPart[]): boolean => {
  if (!t) return false;
  const all = whole.statics, mine = new Uint8Array(head.counts.length);
  for (const p of sectors) {
    const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
    for (let cz = sq.cz0; cz < sq.cz1; cz++) for (let cx = sq.cx0; cx < sq.cx1; cx++) mine[cz * head.dims.chunksX + cx] = 1;
  }
  for (let c = 0; c < head.counts.length; c++) {
    const [from, to] = [t.first[c]!, t.first[c + 1]!];
    if (to - from !== (mine[c] ? all.first[c + 1]! - all.first[c]! : 0)) return false;
    for (let k = 0; k < to - from; k++) for (const col of ["kind", "yaw", "x", "y", "z"] as const) if (t[col][from + k] !== all[col][all.first[c]! + k]) return false;
  }
  return true;
};
/** Answers the waiting requests until `done` holds. */
const until = async (s: { answer(k?: number): Promise<void> }, done: () => boolean): Promise<void> => {
  while (!done()) await s.answer();
};

test("after the first frame the page asks for what it wants nearest first, what is in the ring four at once", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  // Past FIRST_REACH of the west overview, which comes after the first frame, and past the statics reach this test has.
  const body = { x: 3500, z: 448, vx: 0, vz: 0 };
  const reach = 2600;
  let handed: MapStatics | null = null;
  let drawn = false;
  void loader!.follow(() => body, { arrived: (t) => (handed = t), want: () => ({ view: 1e5, statics: reach }) }).then(() => (drawn = true));
  await settle();
  const near = firstFrameParts(head, body.x, body.z);
  // Every overview within the view, and the ground and statics within the statics reach.
  const rest = head.parts.filter((p) => (p.kind === "overview" || ((p.kind === "ground" || p.kind === "statics") && off(p, body.x, body.z) <= reach)) && !near.includes(p));
  const before = s.asked.length;
  await until(s, () => drawn);
  const urgent = rest.filter((p) => ringed(p, body.x, body.z)).sort((a, b) => rank(a, body.x, body.z, reach) - rank(b, body.x, body.z, reach));
  // This map has parts within the ring and past it, an overview past the reach, and statics past it not wanted.
  expect([rest.some((p) => p.kind === "overview" && !urgent.includes(p)), urgent.length > 1, rest.length > urgent.length, head.parts.some((p) => p.kind === "statics" && off(p, body.x, body.z) > reach)]).toEqual([true, true, true, true]);
  // What is within the ring is asked for first, four at once.
  expect(s.waiting.map((w) => w.url).sort()).toEqual(urgent.slice(0, URGENT_AT_ONCE).map(nameOf).sort());
  let most = 0;
  while (s.waiting.length > 0) {
    if (s.waiting.every((w) => !urgent.map(nameOf).includes(w.url))) most = Math.max(most, s.waiting.length);
    await s.answer();
  }
  expect(most).toBe(AFTER_AT_ONCE);
  // Each the nearest of those left when it was asked for by the loader's order, and nothing it does not want.
  const order = s.asked.slice(before).filter((url) => !near.some((p) => nameOf(p) === url)).map((url) => rest.find((p) => nameOf(p) === url)!);
  for (let k = 1; k < order.length; k++) expect(rank(order[k]!, body.x, body.z, reach)).toBeGreaterThanOrEqual(rank(order[k - 1]!, body.x, body.z, reach));
  expect(order.length).toBe(rest.length);
  // The west overview, past the reach, after every sector's ground and statics within it.
  const west = order.findIndex((p) => p.kind === "overview" && off(p, body.x, body.z) > reach);
  expect(order.slice(west).some((p) => p.kind !== "overview")).toBe(false);
  await settle();
  expect(rowsOfSectors(handed, rest.filter((p) => p.kind === "statics"))).toBe(true);
  expect(loader!.progress()).toEqual({ left: 0, parts: rest.length + near.filter((p) => p.kind !== "land").length, near: true, settled: true, roads: 0 });
});

test("while the game's socket is held back the map comes one part at a time, and as many as before once it is not", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  let held = true;
  let drawn = false;
  void loader!.follow(() => body, { held: () => held }).then(() => (drawn = true));
  await settle();
  await until(s, () => drawn);
  let most = 0;
  for (let k = 0; k < 6; k++) {
    most = Math.max(most, s.waiting.length);
    await s.answer();
  }
  expect(most).toBe(1);
  held = false;
  await s.answer();
  expect(s.waiting.length).toBeGreaterThan(1);
  await s.drain();
});

test("the statics are handed over once those within reach have come, and again as the body moves on", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const body = { x: 100, z: 448, vx: 0, vz: 0 };
  const reach = 1200;
  const handed: MapStatics[] = [];
  void loader!.follow(() => body, { arrived: (t) => handed.push(t), want: () => ({ view: 1e5, statics: reach }) });
  const statics = head.parts.filter((p) => p.kind === "statics");
  const within = (x: number, d = reach): MapPart[] => statics.filter((p) => off(p, x, body.z) <= d);
  // The map has statics within that reach and past it.
  expect([within(100).length > 0, within(100).length < statics.length]).toEqual([true, true]);
  await s.drain();
  await settle();
  // Handed over with those sectors' rows alone, and none past the reach asked for.
  expect([handed.length, rowsOfSectors(handed[0]!, within(100)), statics.filter((p) => s.asked.includes(nameOf(p))).length]).toEqual([1, true, within(100).length]);
  // Gone east: what is now within reach comes and is handed over with what is still within a sector of it; the rest is let go.
  body.x = 3500;
  loader!.look();
  await s.drain();
  await settle();
  const kept = statics.filter((p) => within(3500).includes(p) || (within(100).includes(p) && off(p, 3500, body.z) <= reach + KEEP_PAST));
  expect([handed.length, rowsOfSectors(handed[1]!, kept), loader!.held.size]).toEqual([2, true, kept.length]);
  const gone = within(100).find((p) => !kept.includes(p))!;
  const sq = squareOf(head.dims, SECTOR_CHUNKS, gone.col, gone.row)!;
  expect(loader!.held.find(sq.cz0 * head.dims.chunksX + sq.cx0)).toBeNull();
  // Back again, the sector let go is asked for once more.
  body.x = 100;
  loader!.look();
  await s.drain();
  expect(s.asked.filter((url) => url === nameOf(gone)).length).toBe(2);
});

test("a sector a reader still holds chunks of is kept past what is wanted, and tops go a sector past the view", async () => {
  const map = landed();
  const f = writeMap({ ...map, tops: mapTops(map, coreRegistry()) });
  const h = readHead(f);
  const s = heldServer(f);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${h.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const body = { x: 100, z: 448, vx: 0, vz: 0 };
  const start = chunkAt(h.dims, body.x, body.z);
  let keep: MapPart | null = null;
  loader!.held.keep = (p) => p === keep;
  void loader!.follow(() => body, { want: () => ({ view: 1500, statics: 1200 }) });
  for (let k = 0; k < 20; k++) {
    await s.drain();
    await settle();
  }
  keep = loader!.held.partOf(start);
  const statics = loader!.held.parts.filter((p) => loader!.held.has(p));
  expect([keep !== null && loader!.held.has(keep), statics.length > 1, loader!.staged.tops.top(start) !== null]).toEqual([true, true, true]);
  body.x = 4400;
  loader!.look();
  await s.drain();
  // The sector the reader holds stays; the rest round the start go, and so do the tops there.
  expect([loader!.held.has(keep!), statics.filter((p) => p !== keep && loader!.held.has(p)).length, loader!.staged.tops.top(start)]).toEqual([true, 0, null]);
  // Once it holds none, it goes too.
  const kept = keep!;
  keep = null;
  loader!.look();
  expect(loader!.held.has(kept)).toBe(false);
});

/** A flat map three sectors wide, west to east, with a straight raised kerb in the middle of each. */
function kerbed(): MapData {
  const dims = { chunksX: 3 * SECTOR_CHUNKS, chunksZ: SECTOR_CHUNKS };
  const samples = (dims.chunksX * CHUNK_SIZE / TERRAIN_CELL + 1) * (dims.chunksZ * CHUNK_SIZE / TERRAIN_CELL + 1);
  const statics: MapStatic[] = [0, 1, 2].flatMap((k) =>
    placeKerb({ x: [k * 1024 + 520, k * 1024 + 550], z: [512, 512], y: [0, 0] }, 1, { kerb: "raised", walk: 3, panel: 1.5, seed: 9 + k, wear: 0.3 }).map((p) => {
      const bend = new Int16Array(BEND_SHORTS);
      packBend(bend, 0, p.bend);
      return { kind: p.kind, x: p.x, y: p.y, z: p.z, yaw: Math.round((p.yaw / 360) * 65536) & 0xffff, bend };
    }),
  );
  return flatMap(4, { dims, heights: new Uint16Array(samples).fill(32 * 256), tint: new Uint8Array(samples).fill(1), statics });
}

test("a sector's kerbs are drawn once its statics come: the body walks on into a sector held back", async () => {
  const file = writeMap(kerbed()), h = readHead(file), reg = coreRegistry(), dims = h.dims;
  const whole = parseMap(file).statics;
  const statics = h.parts.filter((p) => p.kind === "statics");
  // West to east: A, where the body starts, B, where it goes, and C, past the reach from both.
  const [a, b, c] = [0, 1, 2].map((k) => statics.find((p) => squareOf(dims, SECTOR_CHUNKS, p.col, p.row)!.cx0 === k * SECTOR_CHUNKS)!);
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${h.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const body = { x: 535, z: 512, vx: 0, vz: 0 };
  // The near store, its world's city as the session makes it of each hand-over (session.ts staticsSteps).
  const world: { -readonly [K in keyof RenderWorld]: RenderWorld[K] } = { dims, hf: loader!.staged.hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), far: { cells: new FarStore(), complete: () => true } };
  const handed: number[] = [];
  void loader!.follow(() => body, { arrived: (t) => (handed.push(loader!.held.size), (world.city = { statics: new CityStatics(dims, t, reg), complete: () => true })), want: () => ({ view: 4000, statics: 300 }) });
  // Everything is answered but B's statics.
  const held = (url: string): boolean => url === nameOf(b!);
  for (let k = s.waiting.findIndex((w) => !held(w.url)); k >= 0 || handed.length === 0; k = s.waiting.findIndex((w) => !held(w.url))) {
    if (k < 0) await settle();
    else await s.answer(k);
  }
  // Handed over with A's rows, and none of B's.
  expect([handed, s.asked.includes(nameOf(a!)), s.asked.includes(nameOf(b!)), world.city!.statics.in(chunkAt(dims, 535, 512)) > 0, world.city!.statics.in(chunkAt(dims, 1559, 512))]).toEqual([[1], true, false, true, 0]);
  // The body walks into B, whose chunk the server sends with its kerb as the map set it down.
  [body.x, body.z] = [1559, 514];
  loader!.look();
  const chunk = chunkAt(dims, 1559, 512);
  for (let r = whole.first[chunk]!; r < whole.first[chunk + 1]!; r++) world.structs.put(chunk, r - whole.first[chunk]!, reg.index.get(whole.kinds[whole.kind[r]!]!)!, whole.x[r]!, whole.y[r]!, whole.z[r]!, whole.yaw[r]!, 0, 100, 1);
  world.structs.setVersion(chunk, 1);
  const scene = new Scene(world, reg, corePack());
  scene.assets.tier = tierOf("medium");
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.aspect] = [1559, 12, 516, 0, -1.3, 4 / 3];
  /** The bends a frame puts on the card for B's chunk, as text, those that are not blank; or null where it puts none up. */
  const frame = (): string[] | null => {
    scene.now += 1000 / 60;
    const up = scene.build(cam, null).uploads.find((u) => u.buffer === chunk + BEND_BUFFERS);
    if (!up) return null;
    const bends = new Int16Array(up.data.buffer, up.data.byteOffset, up.data.byteLength / 2), out: string[] = [];
    for (let i = 0; i < bends.length; i += 8) if (bends[i] !== 0) out.push(Array.from(bends.subarray(i, i + 8)).join(" "));
    return out.sort();
  };
  const mine = whole.bends.get(chunk)!, want = Array.from({ length: mine.slot.length }, (_, k) => Array.from(mine.bend.subarray(k * 8, k * 8 + 8)).join(" ")).sort();
  expect(want.length).toBeGreaterThan(0);
  // Before B's statics come its chunk is laid out with no bend to draw its kerb by.
  expect(frame()).toEqual([]);
  // B's statics come and A's and B's are handed over: the next frame lays the chunk out again with its bends.
  await s.answer(s.waiting.findIndex((w) => w.url === nameOf(b!)));
  for (let k = 0; k < 4; k++) await settle();
  expect(handed).toEqual([1, 2]);
  expect(frame()).toEqual(want);
  // C, past the reach from both, is never asked for, and the chunk keeps its bends.
  await s.drain();
  expect(s.asked.includes(nameOf(c!))).toBe(false);
  const again = frame();
  expect(again === null || Bun.deepEquals(again, want)).toBe(true);
});

test("the page asks for the head, then the land, then nothing until it knows where the body is; then that sector's ground and its overview alone, then the rest nearest first", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await settle();
  expect(s.asked).toEqual([`map/${head.name}`]);
  await s.answer();
  const first = head.parts.filter((p) => p.kind === "land").map(nameOf);
  expect(s.asked.slice(1)).toEqual(first);
  await s.drain();
  expect(loader).not.toBeNull();
  const { staged } = loader!;
  // Its land is the definitions the welcome's registry is compiled with.
  expect(staged.content).toEqual(whole.content);
  await settle();
  expect(s.asked.length).toBe(1 + first.length);
  // The body stands in the middle of a sector: only that one, the overview it lies in and the other overview, within
  // FIRST_REACH, come before the first frame.
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  let near = false;
  let handed: MapStatics | null = null;
  void loader!.follow(() => body, { arrived: (t) => (handed = t), want: ALL }).then(() => (near = true));
  await settle();
  const mine = head.parts.filter((p) => (p.kind === "ground" && off(p, body.x, body.z) <= PREDICTED_REACH) || (p.kind === "overview" && off(p, body.x, body.z) < FIRST_REACH));
  expect([s.asked.slice(1 + first.length), mine.map((p) => p.kind)]).toEqual([mine.map(nameOf), ["overview", "overview", "ground"]]);
  await until(s, () => near);
  expect([near, staged.hf.exactIn(body.x - PREDICTED_REACH, body.z - PREDICTED_REACH, body.x + PREDICTED_REACH, body.z + PREDICTED_REACH)]).toEqual([true, true]);
  // Then each ask the nearest of those left to where the body is then; it jumps across the map halfway.
  let left = head.parts.filter((p) => (p.kind === "overview" || p.kind === "ground" || p.kind === "statics") && !s.asked.includes(nameOf(p)));
  for (const url of s.waiting.map((w) => w.url)) left = left.filter((p) => nameOf(p) !== url);
  const total = left.length;
  while (left.length > 0) {
    if (left.length === Math.floor(total / 2)) [body.x, body.z] = [100, 1200];
    await s.answer();
    for (const url of s.asked.slice(s.asked.length - 1)) {
      const p = left.find((q) => nameOf(q) === url);
      if (!p) continue;
      expect(rank(p, body.x, body.z)).toBe(Math.min(...left.map((q) => rank(q, body.x, body.z))));
      left = left.filter((q) => q !== p);
    }
  }
  await s.drain();
  expect(heldOf(staged)).toEqual(mapOf(whole));
  expect(wholeStatics(handed)).toBe(true);
});

test("a map's roads' frame is asked for only once the first frame's parts have come, for the sectors within ROAD_REACH of the body, held a sector at a time, and let go a sector past it", async () => {
  const m = landed();
  const nx = m.dims.chunksX * 32 + 1, cells = roadSamples(nx), n = cells * roadSamples(m.dims.chunksZ * 32 + 1);
  const plane = (v: number): Uint8Array => new Uint8Array(n).fill(v);
  const framed = writeMap({ ...m, road: { across: plane(128), along: plane(4), half: plane(40), lanes: plane(2) } });
  const h = readHead(framed), roads = h.parts.filter((p) => p.kind === "road");
  // Nothing the first frame or the hand-over waits for is a road part.
  expect([firstFrameParts(h, 300, 600).some((p) => p.kind === "road"), handOverParts(h).some((p) => p.kind === "road")]).toEqual([false, false]);
  const off = (p: MapPart, x: number, z: number): number => {
    const sq = squareOf(h.dims, SECTOR_CHUNKS, p.col, p.row)!;
    return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
  };
  const s = heldServer(framed);
  let loader: MapLoader | null = null;
  // The looks at the roads wait for nothing here: each is taken when the test takes it.
  void MapLoader.start(s.get, `map/${h.name}`, { wait: () => new Promise(() => {}) }).then((l) => (loader = l));
  await s.drain();
  const body = { x: 300, z: 600, vx: 0, vz: 0 };
  let near = false;
  void loader!.follow(() => body).then(() => (near = true));
  await settle();
  while (!near) await s.answer();
  expect(s.asked.slice(0, s.answered).some((url) => url.includes("/road."))).toBe(false);
  await settle();
  const within = roads.filter((p) => off(p, 300, 600) <= ROAD_REACH).sort((a, b) => off(a, 300, 600) - off(b, 300, 600));
  // The nearest first, ROADS_AT_ONCE at a time.
  expect(s.waiting.map((w) => w.url).filter((url) => url.includes("/road."))).toEqual(within.slice(0, ROADS_AT_ONCE).map(nameOf));
  expect(within.length).toBeGreaterThan(ROADS_AT_ONCE);
  expect(within.length).toBeLessThan(roads.length);
  await s.drain();
  expect(new Set(s.asked.filter((url) => url.includes("/road.")))).toEqual(new Set(within.map(nameOf)));
  const held = loader!.staged.hf.road!, cellsOf = (p: MapPart): number => (readPart(h, p, framed.subarray(p.at, p.at + p.length)) as { road: { across: Uint8Array } }).road.across.length;
  expect(held.bytes).toBe(within.reduce((k, p) => k + cellsOf(p) * ROAD_PLANES, 0));
  // Gone east, the sectors a sector past ROAD_REACH are let go and those now within it asked for; one let go while it
  // was under way is not held when it comes.
  [body.x, body.z] = [4000, 600];
  loader!.lookRoads();
  const kept = roads.filter((p) => held.has(p.col * 4096 + p.row));
  expect(kept.every((p) => off(p, 4000, 600) <= ROAD_REACH + SECTOR_CHUNKS * CHUNK_SIZE)).toBe(true);
  const east = roads.filter((p) => off(p, 4000, 600) <= ROAD_REACH);
  const going = s.waiting.filter((w) => w.url.includes("/road."));
  expect([going.length, going.every((w) => east.some((p) => nameOf(p) === w.url))]).toEqual([ROADS_AT_ONCE, true]);
  [body.x, body.z] = [300, 600];
  loader!.lookRoads();
  await s.drain();
  expect(east.filter((p) => off(p, 300, 600) > ROAD_REACH + SECTOR_CHUNKS * CHUNK_SIZE).some((p) => held.has(p.col * 4096 + p.row))).toBe(false);
});

test("a road part that fails waits out its backoff before it is asked again; one damaged three times is never asked again", async () => {
  const m = landed();
  const n = roadSamples(m.dims.chunksX * 32 + 1) * roadSamples(m.dims.chunksZ * 32 + 1);
  const plane = (v: number): Uint8Array => new Uint8Array(n).fill(v);
  const framed = writeMap({ ...m, road: { across: plane(128), along: plane(4), half: plane(40), lanes: plane(2) } });
  const h = readHead(framed);
  const sector = (p: MapPart): number => {
    const sq = squareOf(h.dims, SECTOR_CHUNKS, p.col, p.row)!;
    return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - 300, 300 - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - 600, 600 - sq.cz1 * CHUNK_SIZE, 0));
  };
  const within = h.parts.filter((p) => p.kind === "road" && sector(p) <= ROAD_REACH).sort((a, b) => sector(a) - sector(b));
  const [late, bad] = [within[0]!, within[1]!];
  const s = heldServer(framed, (url, b) => (url === nameOf(bad) ? b.map((v, i) => (i === 7 ? v ^ 1 : v)) : b), (url, ask) => (url === nameOf(late) && ask === 1 ? 503 : 200));
  // Every wait, a look's at the roads among them, ends when the test says.
  const waits: number[] = [], ends: (() => void)[] = [], said: string[] = [];
  const wait = (ms: number): Promise<void> => (waits.push(ms), new Promise<void>((go) => ends.push(go)));
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${h.name}`, { wait }).then((l) => (loader = l));
  await s.drain();
  let near = false;
  void loader!.follow(() => ({ x: 300, z: 600, vx: 0, vz: 0 }), { say: (line) => said.push(line) }).then(() => (near = true));
  await settle();
  while (!near) await s.answer();
  await s.drain();
  const asks = (p: MapPart): number => s.asked.filter((u) => u === nameOf(p)).length;
  // Both failed, and every other road part within reach came meanwhile; looking again asks for neither while they wait.
  loader!.lookRoads();
  await settle();
  const held = loader!.staged.hf.road!, key = (p: MapPart): number => p.col * 4096 + p.row;
  expect([asks(late), asks(bad), waits.filter((ms) => ms !== ROAD_EVERY), within.slice(2).every((p) => held.has(key(p)))]).toEqual([1, 1, [RETRY_FIRST, RETRY_FIRST], true]);
  // Their waits end: the one that failed comes; the damaged one is asked for again until its third, and the map's roads there are broken.
  for (let k = 0; k < 6; k++) {
    for (let j = 0; j < 4; j++) await settle();
    ends.splice(0).forEach((go) => go());
    await s.drain();
  }
  for (let k = 0; k < 3; k++) loader!.lookRoads();
  await s.drain();
  expect([asks(late), held.has(key(late)), asks(bad), held.has(key(bad))]).toEqual([2, true, DAMAGED_MOST, false]);
  expect(said.at(-1)).toContain(`at each of ${DAMAGED_MOST} asks: the map is broken`);
});

test("a part that fails gives up its lane while it waits: every part left is asked for though each one asked fails and waits", async () => {
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  const near = firstFrameParts(head, body.x, body.z).filter((p) => p.kind !== "land");
  const rest = head.parts.filter((p) => (p.kind === "overview" || p.kind === "ground" || p.kind === "statics") && !near.includes(p));
  // Every part after the first frame's fails at its first ask, and its wait never ends.
  const s = heldServer(file, undefined, (url, ask) => (ask === 1 && rest.some((p) => nameOf(p) === url) ? 503 : 200));
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, { wait: () => new Promise(() => {}) }).then((l) => (loader = l));
  await s.drain();
  void loader!.follow(() => body, { want: ALL });
  await s.drain();
  const asked = s.asked.filter((url) => rest.some((p) => nameOf(p) === url));
  // Each asked for once, and all of them waiting still.
  expect([rest.length > URGENT_AT_ONCE + AFTER_AT_ONCE, asked.length, new Set(asked).size]).toEqual([true, rest.length, rest.length]);
  const progress = loader!.progress();
  expect(progress.left).toBe(progress.parts - near.length);
});

test("the first frame on this map waits for its head, its land, the overviews within reach and at most four sectors' ground, as firstFrameParts says: counted, not timed", async () => {
  const count = async (body: Place): Promise<number[]> => {
    const s = heldServer(file);
    let loader: MapLoader | null = null;
    void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
    await s.drain();
    let near = false;
    void loader!.follow(() => body).then(() => (near = true));
    await settle();
    while (!near) await s.answer();
    // The loader asked for the head and what the rule names there, and nothing else.
    expect(s.asked.slice(0, s.answered)).toEqual([`map/${head.name}`, ...firstFrameParts(head, body.x, body.z).map(nameOf)]);
    return [s.answered, s.bytes];
  };
  const size = (kinds: string[]): number => head.bytes + head.parts.filter((p) => kinds.includes(p.kind)).reduce((n, p) => n + p.length, 0);
  // In a sector's middle, one sector's ground; at the corner of four, four; both overviews, within FIRST_REACH of either
  // place. The page fetched 5.07 MB before its first frame here, a ground part holding its classes for a wheel as well
  // (MapData.ground). The same parts as when the first frame waited for every overview, and the head 7,638 bytes more
  // since it holds the whole map coarse (COAR): 1,129,968 and 2,522,716 bytes then.
  expect(await count({ x: 1056, z: 448, vx: 0, vz: 0 })).toEqual([5, 1137606]);
  expect(await count({ x: 1536, z: 896, vx: 0, vz: 0 })).toEqual([8, 2530354]);
  // Past FIRST_REACH of the west overview, in a sector's middle: the head, the land, one overview and one ground.
  expect((await count({ x: 3000, z: 448, vx: 0, vz: 0 }))[0]).toBe(4);
  expect([size(["land", "overview"]), size(["land", "overview", "ground"])]).toEqual([388770, 5074890]);
  // Off the map's sectors' corners: two sectors along an edge, one in a middle; and every corner, at most four.
  for (const [x, z] of [[1024, 448], [100, 100], [0, 0], [2048, 1024], [3200, 1280]] as const) await count({ x, z, vx: 0, vz: 0 });
});


test("after a failure a sector goes back among those left by its distance: asked for again once its wait is out, when it is the nearest of them", async () => {
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  const behind = head.parts.filter((p) => p.kind === "ground" && off(p, body.x, body.z) > 0).sort((a, b) => off(a, body.x, body.z) - off(b, body.x, body.z));
  const failing = behind[0]!;
  const s = heldServer(file, undefined, (url, ask) => (url === nameOf(failing) && ask === 1 ? 503 : 200));
  const waits: number[] = [];
  let release = (): void => {};
  const wait = (ms: number): Promise<void> => (waits.push(ms), new Promise<void>((go) => (release = go)));
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, { wait }).then((l) => (loader = l));
  await s.drain();
  let drawn = false;
  void loader!.follow(() => body, { want: ALL }).then(() => (drawn = true));
  await settle();
  await until(s, () => drawn);
  // The nearest behind the body is among those asked for first. It fails, and its lane waits while the others go on.
  expect(s.waiting.map((w) => w.url)).toContain(nameOf(failing));
  await s.answer(s.waiting.findIndex((w) => w.url === nameOf(failing)));
  for (let k = 0; k < URGENT_AT_ONCE; k++) await s.answer();
  expect([waits, s.asked.filter((u) => u === nameOf(failing)).length]).toEqual([[RETRY_FIRST], 1]);
  // The body goes across the map and the wait ends: from then on each ask is the nearest to it of those left, the failed one among them.
  let left = [...behind.filter((p) => !s.asked.includes(nameOf(p))), failing];
  [body.x, body.z] = [3500, 1200];
  let seen = s.asked.length;
  const check = (): void => {
    for (const url of s.asked.slice(seen).filter((u) => u.includes("/ground."))) {
      const p = left.find((q) => nameOf(q) === url)!;
      expect(off(p, body.x, body.z)).toBe(Math.min(...left.map((q) => off(q, body.x, body.z))));
      left = left.filter((q) => q !== p);
    }
    seen = s.asked.length;
  };
  release();
  await settle();
  check();
  while (left.length > 0) {
    await s.answer(s.waiting.findIndex((w) => w.url.includes("/ground.")));
    check();
  }
  await s.drain();
  expect([s.asked.filter((u) => u === nameOf(failing)).length, denseOf(loader!.staged.hf).heights]).toEqual([2, whole.heights]);
});

/** What a request for a part may come to on the wire: an answer of `status`, no answer, its bytes changed, or another part's. */
type Fault = number | "drop" | "damage" | "other";

/**
 * A server of the map that answers at once, but for the asks `fault` names, by the part's name and how many times it has
 * been asked for, with that.
 */
function faultyServer(of: Uint8Array, fault: (name: string, ask: number) => Fault | null) {
  const files = new Map(partsOf(of).map((p) => [`map/${p.name}`, p.bytes]));
  const asks = new Map<string, number>();
  const s = {
    asked: [] as string[],
    refreshed: [] as string[],
    get: (async (url: string, init?: Parameters<Get>[1]) => {
      s.asked.push(url);
      if (init?.cache === "reload") s.refreshed.push(url);
      const name = url.slice(4);
      const n = (asks.get(name) ?? 0) + 1;
      asks.set(name, n);
      const f = fault(name, n);
      if (f === "drop") throw new TypeError("Load failed");
      if (typeof f === "number") return new Response("not now", { status: f });
      const body = f === "other" ? files.get(`map/${head.parts.find((p) => p.kind === "ground")!.name}`)! : files.get(url)!;
      return new Response(f === "damage" ? body.map((v, i) => (i === 7 ? v ^ 1 : v)) : body);
    }) as Get,
  };
  return s;
}

/** Lets the loader run until it asks for nothing more for a while. */
async function quiet(s: { asked: string[] }): Promise<void> {
  for (let k = 0, n = -1; k < 400 && n !== s.asked.length; k++) {
    n = s.asked.length;
    for (let j = 0; j < 8; j++) await settle();
  }
}

/**
 * The page's map on a server whose `fault`s are as given, the body at `body`: every wait between asks counted, and after
 * `most` of them none ends, as a page left open on a part that fails for good. What the page says before the first frame
 * and after it, whether the first frame came or why not, and the statics it was handed.
 */
async function trial(fault: (name: string, ask: number) => Fault | null, body = { x: 1056, z: 448, vx: 0, vz: 0 }, most = 12) {
  const s = faultyServer(file, fault);
  const waits: number[] = [];
  const said: string[] = [];
  const late: string[] = [];
  const out = { s, waits, said, late, first: null as string | null, statics: null as MapStatics | null, loader: null as MapLoader | null };
  const wait = (ms: number): Promise<void> => (waits.push(ms), waits.length > most ? new Promise(() => {}) : Promise.resolve());
  void MapLoader.start(s.get, `map/${head.name}`, { say: (line) => said.push(line), wait }).then(
    (loader) => {
      out.loader = loader;
      return loader.follow(() => body, { say: (line) => late.push(line), arrived: (t) => (out.statics = t), want: ALL }).then(() => (out.first = "drawn"));
    },
  ).catch((e: unknown) => (out.first = e instanceof Error ? e.message : String(e)));
  await quiet(s);
  return out;
}

/** Whether the statics handed over are the whole map's. */
test("the city's tops come after what is within the statics reach, each square's after its overview, and wait for nothing", async () => {
  const map = landed();
  const tops = mapTops(map, coreRegistry());
  const f = writeMap({ ...map, tops });
  const h = readHead(f);
  const parts = h.parts.filter((p) => p.kind === "tops");
  // The map has statics in more than one overview's square, so more than one part of tops.
  expect(parts.length).toBeGreaterThan(1);
  const s = heldServer(f);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${h.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  expect(s.asked.some((url) => url.includes("/tops."))).toBe(false);
  const body = { x: 100, z: 448, vx: 0, vz: 0 };
  const reach = 1200;
  const handed: number[] = [];
  // Every part is answered as soon as it is asked but the tops, each answered only while nothing else waits.
  const isTops = (url: string): boolean => parts.some((p) => nameOf(p) === url);
  let topsCame = 0;
  let topsLeft = -1;
  void loader!.follow(() => body, { arrived: () => (handed.push(loader!.held.size), handed.length === 1 && (topsLeft = parts.length - topsCame)), want: () => ({ view: 1e5, statics: reach }) });
  await settle();
  // The order parts were answered in, and how many had been answered when each was asked.
  const answered: string[] = [];
  const askedBefore = new Map<string, number>();
  const note = (): void => s.waiting.forEach((w) => askedBefore.has(w.url) || askedBefore.set(w.url, answered.length));
  note();
  while (s.waiting.length > 0) {
    const k = Math.max(0, s.waiting.findIndex((w) => !isTops(w.url)));
    if (isTops(s.waiting[k]!.url)) topsCame++;
    answered.push(s.waiting[k]!.url);
    await s.answer(k);
    note();
  }
  await settle();
  // The statics were handed over while tops were still to come.
  expect([handed.length > 0, topsLeft > 0]).toEqual([true, true]);
  // Each was asked for once everything within the reach had come, the nearest square's first.
  const squareOff = (p: MapPart): number => {
    const sq = squareOf(h.dims, OVERVIEW_CHUNKS, p.col, p.row)!;
    return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - body.x, body.x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - body.z, body.z - sq.cz1 * CHUNK_SIZE, 0));
  };
  const asked = (p: MapPart): number => s.asked.indexOf(nameOf(p));
  const within = h.parts.filter((p) => (p.kind === "overview" || p.kind === "ground" || p.kind === "statics") && off(p, body.x, body.z) <= reach);
  const first = parts.reduce((a, b) => (asked(a) < asked(b) ? a : b));
  expect(Math.max(...within.map((p) => answered.indexOf(nameOf(p))))).toBeLessThan(askedBefore.get(nameOf(first))!);
  expect(squareOff(first)).toBe(Math.min(...parts.map(squareOff)));
  // A square's tops after its overview, where the first frame did not wait for that.
  const overviews = h.parts.filter((p) => p.kind === "overview");
  for (const p of parts) {
    const o = overviews.find((q) => q.col === p.col && q.row === p.row)!;
    expect(asked(o) < 0 || asked(o) < asked(p)).toBe(true);
  }
  // They came, and the page holds every chunk's cells as the map has them.
  expect(loader!.staged.tops.version).toBe(parts.length);
  for (let k = 0; k < tops.chunks.length; k++) expect([...loader!.staged.tops.top(tops.chunks[k]!)!]).toEqual([...tops.top.subarray(k * 256, (k + 1) * 256)]);
  expect(s.asked.filter(isTops).length).toBe(parts.length);
});

const wholeStatics = (t: MapStatics | null): boolean => t !== null && [t.first, t.kind, t.x, t.y, t.z, t.yaw].every((col, k) => Bun.deepEquals(col, [whole.statics.first, whole.statics.kind, whole.statics.x, whole.statics.y, whole.statics.z, whole.statics.yaw][k]));

test("a part that fails once, three times or for good, before the first frame or after it, near the body or behind it, ground or statics, is asked for again after a wait that doubles to its cap; what has come is kept; the statics are handed over whole once every part has come", async () => {
  const of = (kind: string, k = 0): MapPart => head.parts.filter((p) => p.kind === kind)[k]!;
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  const near = head.parts.find((p) => p.kind === "ground" && off(p, body.x, body.z) === 0)!;
  const behind = head.parts.filter((p) => p.kind === "ground" && off(p, body.x, body.z) > 0).at(-1)!;
  const parts = { head: { name: head.name } as MapPart, land: of("land"), overview: of("overview", 1), near, behind, statics: of("statics", 2) };
  for (const [where, part] of Object.entries(parts)) {
    for (const times of [1, 3, Infinity]) {
      const t = await trial((name, ask) => (name === part.name && ask <= times ? (ask % 2 === 0 ? "drop" : 503) : null), body);
      const asks = t.s.asked.filter((u) => u === `map/${part.name}`).length;
      const before = where !== "behind" && where !== "statics";
      if (times !== Infinity) {
        // Each ask after the first waited: 0.5 s, then 1 and 2.
        expect([where, times, asks, t.waits, t.first, wholeStatics(t.statics)]).toEqual([where, times, times + 1, [500, 1000, 2000].slice(0, times), "drawn", true]);
        expect([where, times, heldOf(t.loader!.staged)]).toEqual([where, times, mapOf(whole)]);
      } else {
        // For good: the waits double to 8 s and stay there, the page asking all the while; what came is kept.
        expect([where, asks, t.waits]).toEqual([where, 13, [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000]]);
        expect([where, t.first, t.statics]).toEqual([where, before ? null : "drawn", null]);
        // Past the first frame every other part came, asked for once.
        const others = head.parts.filter((p) => p.kind !== "tops" && p.name !== part.name);
        if (!before) expect([where, others.every((p) => t.s.asked.filter((u) => u === `map/${p.name}`).length === 1)]).toEqual([where, true]);
      }
    }
  }
});

test("a sector's statics are set in as they come, a pause after each slice read and set; the hand-over's steps pause too", async () => {
  // Three slices of pieces and some in one sector: each slice is a step as it is read and as it is set in its chunks.
  const statics = Array.from({ length: 100000 }, (_, i) => ({ kind: i % 3 === 0 ? "core:wall" : "core:floor", x: (i % 250) + 0.5, y: 33, z: Math.floor(i / 400) + 0.5, yaw: (i * 64) & 0xffff }));
  const big = writeMap(flatMap(4, { statics }));
  const all = parseMap(big);
  const channel = new MessageChannel();
  let pauses = 0;
  const pause = nextTask(channel);
  const s = heldServer(big);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${readHead(big).name}`, { ...NOW, pause: () => (pauses++, pause()) }).then((l) => (loader = l));
  await s.drain();
  const handed: [MapStatics, number][] = [];
  let copy: MapStatics | null = null;
  function* arriving(): Generator<void, void> {
    for (let k = 0; k < 5; k++) yield;
    handed.push([copy!, pauses]);
  }
  void loader!.follow(() => ({ x: 100, z: 100, vx: 0, vz: 0 }), { arrived: (t) => (copy = t), arriving });
  await s.drain();
  for (let k = 0; k < 200 && handed.length === 0; k++) await settle();
  channel.port1.close();
  // Read and set, three steps each; the tool's copy of the one sector held, two; then the hand-over's five.
  expect([handed.length, handed[0]![1]]).toEqual([1, 3 + 3 + 2 + 5]);
  const t = handed[0]![0];
  expect([t.first, t.kind, t.x, t.y, t.z, t.yaw]).toEqual([all.statics.first, all.statics.kind, all.statics.x, all.statics.y, all.statics.z, all.statics.yaw]);
});

test("a damaged part is asked for again; the third time the map is broken, or after the first frame that sector's statics", async () => {
  // The overview the body stands in, which the first frame waits for.
  const overview = firstFrameParts(head, 1056, 448).find((p) => p.kind === "overview")!;
  const statics = head.parts.filter((p) => p.kind === "statics")[1]!;
  const damaged = (name: string) => `map: its part ${name} is damaged or another's: its bytes are not those its head names`;
  const once = await trial((name, ask) => (name === overview.name && ask === 1 ? "damage" : name === statics.name && ask <= 2 ? "other" : null));
  expect(once.s.refreshed).toEqual([nameOf(overview), nameOf(statics), nameOf(statics)]);
  // The land came and the page said so before the body's place was known; then the overview there failed once.
  expect([once.first, wholeStatics(once.statics), once.said, once.late]).toEqual(["drawn", true, ["", `loading the map: ${damaged(overview.name)}; asking again in 0.5 s`, ""], [`${damaged(statics.name)}; asking again in 0.5 s`, `${damaged(statics.name)}; asking again in 1 s`, `the map's ${statics.name} came, at ask 3`]]);
  const early = await trial((name) => (name === overview.name ? "damage" : null));
  expect([early.first, early.s.asked.filter((u) => u === `map/${overview.name}`).length]).toEqual([`${damaged(overview.name)}, at each of ${DAMAGED_MOST} asks: the map is broken`, DAMAGED_MOST]);
  const late = await trial((name) => (name === statics.name ? "other" : null));
  // The rest are handed over without it, and its pieces are left out.
  const sq = squareOf(head.dims, SECTOR_CHUNKS, statics.col, statics.row)!;
  let left = 0, there = 0;
  for (let cz = sq.cz0; cz < sq.cz1; cz++) {
    const row = cz * head.dims.chunksX;
    left += late.statics ? late.statics.first[row + sq.cx1]! - late.statics.first[row + sq.cx0]! : 1;
    there += whole.statics.first[row + sq.cx1]! - whole.statics.first[row + sq.cx0]!;
  }
  expect(there).toBeGreaterThan(0);
  expect([late.first, late.statics !== null && !wholeStatics(late.statics), left, late.late.at(-1)]).toEqual(["drawn", true, 0, `${damaged(statics.name)}, at each of ${DAMAGED_MOST} asks: the map is broken; the pieces of sector ${statics.col}, ${statics.row} are left out`]);
});

test("the player is told: before the first frame what the page waits for, and nothing once it waits for nothing that failed; after it, of a part that keeps failing at its third, sixth and twelfth failure in a row, and when it came", async () => {
  const land = head.parts.find((p) => p.kind === "land")!;
  const behind = head.parts.filter((p) => p.kind === "ground").at(-1)!;
  const t = await trial((name, ask) => (name === land.name && ask <= 2 ? 503 : name === behind.name && ask <= 12 ? 503 : null), undefined, 40);
  const failed = (name: string) => `map/${name}: the server answered 503: "not now"`;
  expect(t.said).toEqual([`loading the map: ${failed(land.name)}; asking again in 0.5 s`, `loading the map: ${failed(land.name)}; asking again in 1 s`, "", ""]);
  expect(t.late).toEqual([3, 6, 12].map((n) => `the map is coming slowly: ${failed(behind.name)}, ${n} times in a row; asking again in ${Math.min(RETRY_MOST, RETRY_FIRST * 2 ** (n - 1)) / 1000} s`).concat([`the map's ${behind.name} came, at ask 13`]));
  expect(wholeStatics(t.statics)).toBe(true);
});

test("a map with a listed node layer brings all its ground before any node source is made: the head does not say its slots a chunk", async () => {
  const listed = writeMap(cornerMap(true));
  const s = heldServer(listed);
  const loading = MapLoader.start(s.get, `map/${readHead(listed).name}`, NOW);
  await s.drain();
  const loader = await loading;
  const map = parseMap(listed);
  expect([s.asked.filter((u) => u.includes("/ground.")).length, heldOf(loader.staged)]).toEqual([4, mapOf(map)]);
  let near = false;
  void loader.follow(() => null).then(() => (near = true));
  await settle();
  expect([near, s.waiting.every((w) => w.url.includes("/statics."))]).toEqual([true, true]);
});

/** A scene of the corner map's ground and node layers, drawn by the rasterizer from over its corner. */
function cornerScene(hf: Heightfield, layers: readonly NodeLayer[]) {
  const reg = nodeRegistry();
  const pack = nodePack();
  const farNodes = { nodes: nodeLayers(hf.dims, hf, reg, layers)!, held: () => false, gone: () => undefined, changes: new NodeChanges(hf.dims), ground: hf };
  const scene = new Scene({ dims: hf.dims, hf, structs: new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), far: { cells: new FarStore(), complete: () => false }, farNodes }, reg, pack);
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 120;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.aspect] = [150, 60, 40, 0.4, -0.45, 4 / 3];
  const raster = new Rasterizer(160, 120, pack, hf);
  return {
    /**
     * A frame, its picture drawn where `draw` says: else the rasterizer takes what it gives the card alone, as a frame no
     * picture is taken of. A drawn frame of this scene is some 49,000 triangles in the software rasterizer, about 20 ms.
     */
    frame(draw = true): Uint8ClampedArray {
      scene.now += 1000 / 60;
      const p = scene.build(cam, null);
      if (draw) raster.render(p);
      else raster.take(p);
      return raster.color;
    },
  };
}

test("parts come late and in a scrambled order: every frame's ground is the map's own or its overview's, never a sample not yet set, and once all have come the picture is the whole map's", async () => {
  const corner = writeMap(cornerMap());
  const map = parseMap(corner);
  const ch = readHead(corner);
  // The overviews' ground alone, which stands in for each sector's.
  const filled = new StagedMap(ch);
  for (const p of ch.parts.filter((q) => q.kind === "overview")) filled.take(readPart(ch, p, corner.subarray(p.at, p.at + p.length)) as OverviewPiece);
  const want = cornerScene(mapHeightfield(map), map.nodes);
  for (let f = 0; f < 60; f++) want.frame(false);
  const picture = want.frame();
  for (const seed of [1, 2]) {
    const rng = new Rng(seed);
    const s = heldServer(corner);
    const loading = MapLoader.start(s.get, `map/${ch.name}`, NOW);
    await s.drain((n) => rng.int(n));
    const loader = await loading;
    const hf = loader.staged.hf;
    const scene = cornerScene(hf, loader.staged.nodes);
    let drawn = false;
    void loader.follow(() => ({ x: 150, z: 150, vx: 0, vz: 0 })).then(() => (drawn = true));
    let [frames, wrong, pictures] = [0, 0, 0];
    for (let f = 0; f < 120; f++) {
      // Each frame a part came in is drawn, and those between are taken by the card alone.
      const came = s.waiting.length > 0 && rng.int(3) === 0;
      if (came) await s.answer(rng.int(s.waiting.length));
      await settle();
      if (!drawn) continue;
      const [now, stand] = [denseOf(hf).heights, denseOf(filled.hf).heights];
      for (let k = 0; k < now.length; k++) if (now[k] !== map.heights[k] && now[k] !== stand[k]) wrong++;
      scene.frame(came);
      frames++;
      if (came) pictures++;
    }
    await s.drain();
    for (let f = 0; f < 40; f++) scene.frame(false);
    expect([wrong, frames > 60, pictures > 0, denseOf(hf).heights, scene.frame()]).toEqual([0, true, true, map.heights, picture]);
  }
});

test("standing still, nothing is asked for once the page has settled, however often it looks", async () => {
  const s = heldServer(file);
  const ticks: (() => void)[] = [];
  const every = (ms: number): Promise<void> => (expect(ms).toBe(LOOK_EVERY), new Promise<void>((go) => ticks.push(go)));
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, { ...NOW, every }).then((l) => (loader = l));
  await s.drain();
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  void loader!.follow(() => body, { want: () => ({ view: 2000, statics: 1200 }) });
  await s.drain();
  await settle();
  expect(loader!.progress().settled).toBe(true);
  const asked = s.asked.length;
  // A minute of looks.
  for (let k = 0; k < 60; k++) {
    ticks.splice(0).forEach((go) => go());
    await settle();
  }
  expect([s.asked.length - asked, s.waiting.length, loader!.progress().settled]).toEqual([0, 0, true]);
  // The body moves on and the next look asks for what is wanted there.
  body.x = 3800;
  ticks.splice(0).forEach((go) => go());
  await settle();
  expect([s.waiting.length > 0, loader!.progress().settled]).toEqual([true, false]);
  await s.drain();
});

test("a page set down far off is not settled before its next look", async () => {
  const s = heldServer(file);
  const ticks: (() => void)[] = [];
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, { ...NOW, every: () => new Promise<void>((go) => ticks.push(go)) }).then((l) => (loader = l));
  await s.drain();
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  void loader!.follow(() => body, { want: () => ({ view: 2000, statics: 1200 }) });
  await s.drain();
  await settle();
  expect(loader!.progress().settled).toBe(true);
  // A respawn or a tool's jump: until the clock's next look nothing is asked for, though the ground there is not held.
  const asked = s.asked.length;
  body.x = 3800;
  await settle();
  expect([s.asked.length - asked, loader!.staged.hf.exactIn(body.x - 1, body.z - 1, body.x + 1, body.z + 1), loader!.progress().settled]).toEqual([0, false, false]);
  // Back where it was, it is settled again without a look.
  body.x = 1056;
  expect(loader!.progress().settled).toBe(true);
});

test("ground pages past their budget go farthest first but round the body, and an overview past the view goes; both come again", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const grounds = head.parts.filter((p) => p.kind === "ground"), page = (p: MapPart): number => pageBytes(squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!);
  const body = { x: 100, z: 448, vx: 0, vz: 0 };
  const pinned = (x: number): MapPart[] => grounds.filter((p) => off(p, x, 448) <= ROAD_REACH);
  // Room for the pages round the body and the nearest one more of those wanted.
  const budget = pinned(100).reduce((n, p) => n + page(p), 0) + Math.max(...grounds.map(page));
  const go = async (): Promise<void> => {
    loader!.look();
    for (let k = 0; k < 10; k++) {
      await s.drain();
      await settle();
    }
  };
  void loader!.follow(() => body, { want: () => ({ view: 1500, statics: 2500, ground: budget }) });
  await go();
  const staged = loader!.staged, hf = staged.hf, sq = (p: MapPart) => squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
  const held = (): MapPart[] => grounds.filter((p) => hf.holds(sq(p)));
  const nearest = (x: number): MapPart => grounds.filter((p) => !pinned(x).includes(p)).sort((a, b) => off(a, x, 448) - off(b, x, 448))[0]!;
  expect([pinned(100).every((p) => held().includes(p)), held().length, held().includes(nearest(100)), hf.bytes <= budget]).toEqual([true, pinned(100).length + 1, true, true]);
  const before = denseOf(hf);
  const west = staged.overviews.held().find((b) => b.sq.cx0 === 0)!;
  expect(west.sq.cx1 * CHUNK_SIZE).toBeLessThan(4400 - 1500 - KEEP_PAST);
  body.x = 4400;
  await go();
  // The west's pages and overview are gone: its samples stand in with the coarse picture, and none of its nodes stands.
  const coarse = new StagedMap(head).hf;
  const westNodes = nodesOf(hf, coreRegistry(), staged.nodes).filter((line) => Number(line.split(" ")[0]) % head.dims.chunksX < west.sq.cx1);
  const room = budget - pinned(4400).reduce((n, p) => n + page(p), 0) >= page(nearest(4400)) ? 1 : 0;
  expect([pinned(4400).every((p) => held().includes(p)), held().length, held().some((p) => pinned(100).includes(p)), staged.overviews.held().includes(west), hf.stepsAt(50, 50), westNodes]).toEqual([true, pinned(4400).length + room, false, false, coarse.stepsAt(50, 50), []]);
  body.x = 100;
  await go();
  expect(denseOf(hf)).toEqual(before);
});

test("past the budget, the statics kept beyond their reach go farthest first", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const statics = head.parts.filter((p) => p.kind === "statics");
  const rows = (p: MapPart): number => {
    const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
    let n = 0;
    for (let cz = sq.cz0; cz < sq.cz1; cz++) for (let cx = sq.cx0; cx < sq.cx1; cx++) n += head.counts[cz * head.dims.chunksX + cx]!;
    return n;
  };
  const body = { x: 100, z: 448, vx: 0, vz: 0 }, reach = 1100;
  // Room for what is wanted where the body goes and one more of those kept past their reach.
  const there = statics.filter((p) => off(p, 2600, 448) <= reach), spare = statics.filter((p) => off(p, 100, 448) <= reach && !there.includes(p) && off(p, 2600, 448) <= reach + KEEP_PAST);
  expect(spare.length).toBeGreaterThan(1);
  const bytes = (p: MapPart): number => rows(p) * 16 + sectorIndex(p);
  const budget = there.reduce((n, p) => n + bytes(p), 0) + Math.max(...spare.map(bytes)) + INDEX;
  void loader!.follow(() => body, { want: () => ({ view: 1e5, statics: reach, budget }) });
  await s.drain();
  body.x = 2600;
  loader!.look();
  await s.drain();
  // The loader reads its own head, so its parts are found by name.
  const names = new Set(loader!.held.parts.filter((p) => loader!.held.has(p)).map((p) => p.name));
  const held = statics.filter((p) => names.has(p.name));
  const kept = held.filter((p) => !there.includes(p)), gone = spare.filter((p) => !held.includes(p));
  expect([there.every((p) => held.includes(p)), loader!.held.bytes <= budget, kept.length > 0, gone.length > 0]).toEqual([true, true, true, true]);
  expect(Math.max(...kept.map((p) => off(p, 2600, 448)))).toBeLessThanOrEqual(Math.min(...gone.map((p) => off(p, 2600, 448))));
});

test("an overview is filled a band of chunk rows a step, to the samples one fill gives", () => {
  const staged = new StagedMap(head), once = new Heightfield(head.dims, TERRAIN_CELL, head.minY, head.stepY);
  once.holdNone();
  once.fill(0, 0, head.dims.chunksX, head.dims.chunksZ, COARSE_STEP, head.coarse.heights, head.coarse.tint);
  const overviews = head.parts.filter((p) => p.kind === "overview");
  for (const p of overviews) {
    const piece = readPart(head, p, file.subarray(p.at, p.at + p.length)) as OverviewPiece;
    let steps = 0;
    for (const g = staged.steps(piece); !g.next().done; ) steps++;
    const sq = piece.sq;
    once.fill(sq.cx0, sq.cz0, sq.cx1, sq.cz1, OVERVIEW_STEP, piece.heights, piece.tint);
    expect(steps).toBe(Math.ceil((sq.cz1 - sq.cz0) / BAND_CHUNKS) - 1);
  }
  expect(Math.max(...overviews.map((p) => squareOf(head.dims, OVERVIEW_CHUNKS, p.col, p.row)!).map((sq) => sq.cz1 - sq.cz0))).toBeGreaterThan(BAND_CHUNKS);
  expect([denseOf(staged.hf).heights, denseOf(staged.hf).tint]).toEqual([once.heights, once.tint]);
});

test("the store of statics finds a chunk's rows in its sector, and in the table made of those held", () => {
  const held = new HeldStatics(head);
  const statics = head.parts.filter((p) => p.kind === "statics");
  const all = whole.statics;
  const set = (p: MapPart): void => {
    const steps = held.set(p, readPart(head, p, file.subarray(p.at, p.at + p.length)) as StaticsPiece);
    while (!steps.next().done);
  };
  const told: MapPart[] = [];
  held.onSet((p) => told.push(p));
  const [a, b] = [statics[0]!, statics[1]!];
  set(a);
  set(b);
  /** Whether each chunk's rows are the map's where its sector is held, and none are found where it is not. */
  const same = (): boolean =>
    head.counts.every((n, c) => {
      const r = held.find(c), part = held.partOf(c);
      if (!part || !held.has(part)) return r === null;
      if (!r || r.to - r.from !== n) return false;
      for (let k = 0; k < n; k++) for (const col of ["kind", "yaw", "x", "y", "z"] as const) if (r[col][r.from + k] !== all[col][all.first[c]! + k]) return false;
      return true;
    });
  expect([same(), told, held.size, held.bytes, held.pieces > 0]).toEqual([true, [a, b], 2, held.pieces * 16 + sectorIndex(a) + sectorIndex(b) + INDEX, true]);
  // The table holds both; the sectors read their rows from it from then on, and one let go is found no more.
  const g = held.table();
  let t = g.next();
  while (!t.done) t = g.next();
  expect(rowsOfSectors(t.value, [a, b])).toBe(true);
  expect(same()).toBe(true);
  held.drop(a);
  expect([same(), held.size]).toEqual([true, 1]);
  set(a);
  expect(same()).toBe(true);
});

test("a sector let go is told to the city's reader by its place, and its rows are not kept", async () => {
  const held = new HeldStatics(head), city = held.follow(coreRegistry());
  const p = head.parts.find((q) => q.kind === "statics")!, n = held.parts.indexOf(p);
  const steps = held.set(p, readPart(head, p, file.subarray(p.at, p.at + p.length)) as StaticsPiece);
  while (!steps.next().done);
  const seen = new Uint32Array(city.size), told: [string, boolean][] = [];
  const read = (): void => city.news(seen, (sq, on) => void told.push([`${sq.cx0} ${sq.cz0} ${sq.cx1} ${sq.cz1}`, on]));
  read();
  const square = new WeakRef(city.square(n)!), place = told[0]![0];
  held.drop(p);
  read();
  expect(told).toEqual([[place, true], [place, false]]);
  await settle();
  Bun.gc(true);
  expect(square.deref()).toBeUndefined();
});

test("a budget short of the statics wanted holds the nearest of them, as far as it reaches", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const body = { x: 2600, z: 448, vx: 0, vz: 0 };
  const held = new HeldStatics(head);
  const wanted = head.parts.filter((p) => p.kind === "statics" && off(p, body.x, body.z) <= 1500).sort((a, b) => off(a, body.x, body.z) - off(b, body.x, body.z));
  expect(wanted.length).toBeGreaterThan(3);
  const budget = held.bytesOf(wanted[0]!) + held.bytesOf(wanted[1]!) + held.bytesOf(wanted[2]!) + INDEX;
  void loader!.follow(() => body, { want: () => ({ view: 1e5, statics: 1500, budget }) });
  await s.drain();
  const names = new Set(loader!.held.parts.filter((p) => loader!.held.has(p)).map((p) => p.name));
  expect([...names].sort()).toEqual(wanted.slice(0, 3).map((p) => p.name).sort());
  expect(wanted.slice(3).some((p) => s.asked.includes(nameOf(p)))).toBe(false);
  expect(loader!.progress().settled).toBe(true);
});

test("a focus far from the body brings its ground in place past the budget, and its overviews", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const grounds = head.parts.filter((p) => p.kind === "ground"), page = (p: MapPart): number => pageBytes(squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!);
  const body = { x: 4400, z: 448, vx: 0, vz: 0 }, focus = { x: 100, z: 448 };
  const round = (x: number): MapPart[] => grounds.filter((p) => off(p, x, 448) <= ROAD_REACH);
  // Room for the body's pages alone; the west overview is past the body's view.
  const budget = round(4400).reduce((n, p) => n + page(p), 0);
  let sighted: { x: number; z: number } | null = null;
  void loader!.follow(() => body, { want: () => ({ view: 1500, statics: 600, ground: budget, camera: body, focus: sighted }) });
  const go = async (): Promise<void> => {
    loader!.look();
    for (let k = 0; k < 10; k++) {
      await s.drain();
      await settle();
    }
  };
  await go();
  const hf = loader!.staged.hf, held = (p: MapPart): boolean => hf.holds(squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!);
  expect([round(100).some(held), loader!.staged.overviews.held().some((b) => b.sq.cx0 === 0), loader!.progress().settled]).toEqual([false, false, true]);
  sighted = focus;
  await go();
  expect([round(100).every(held), round(4400).every(held), loader!.staged.overviews.held().some((b) => b.sq.cx0 === 0), loader!.progress().settled]).toEqual([true, true, true, true]);
});

test("a sector's ground waiting for its overview is not counted as come", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  // The first frame in the east; then a view short of the west overview, and the fine window's ground, which reaches into it.
  const body = { x: 4400, z: 448, vx: 0, vz: 0 };
  void loader!.follow(() => body, { want: () => ({ view: 300, statics: 300 }) });
  const go = async (): Promise<void> => {
    loader!.look();
    for (let k = 0; k < 10; k++) {
      await s.drain();
      await settle();
    }
  };
  await go();
  body.x = 1700;
  await go();
  const waiting = head.parts.filter((p) => p.kind === "ground" && loader!.staged.waits(squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!));
  expect([waiting.length > 0, loader!.progress().left, loader!.progress().settled]).toEqual([true, waiting.length, false]);
});
