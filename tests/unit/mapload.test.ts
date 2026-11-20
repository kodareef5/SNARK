// The page's map as its parts come (client/core/mapload.ts): its head and its landmarks' definitions before anything; the
// ground within reach of the body and its overviews alone, which the first frame waits for, by the rule the map's build
// holds to its budget; then the rest nearest first to where the body is and is heading, the overviews before the rest but
// for what is within RING, each sector's ground before its statics, four at once while that is within RING and two
// otherwise, and the statics handed over once all have come. A part that fails is asked for again, the wait between asks
// counted here with no clock.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { nextTask, type Get } from "../../client/core/fetched.ts";
import { AFTER_AT_ONCE, CITY_NEAR, DAMAGED_MOST, FIRST_REACH, MapLoader, RETRY_FIRST, RETRY_MOST, RING, ROAD_REACH, StagedMap, URGENT_AT_ONCE, firstFrameParts, handOverParts, type Place } from "../../client/core/mapload.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { PREDICTED_REACH } from "../../client/core/session.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { OVERVIEW_CHUNKS, mapHeightfield, mapTops, nodeLayers, parseMap, partsOf, readHead, readPart, squareOf, writeMap, type MapData, type MapPart, type MapStatics, type NodeLayer, type OverviewPiece } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { ROAD_PLANES, roadSamples } from "../../shared/world/roadframe.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { cornerMap, flatMap, wideMap } from "../fixtures/map.ts";
import { nodePack, nodeRegistry } from "../fixtures/nodeworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** wideMap with a landmark, whose definitions are its land part, and none of its nodes listed (see the test of those below). */
function landed(): MapData {
  const m = wideMap();
  return { ...m, nodes: m.nodes.filter((l) => !("first" in l)), content: { landmarks: [{ name: "hut", x: 300, y: 10, z: 300, yaw: 0 }], defs: [{ type: "structure", class: "static", id: "hut:wall", mesh: "box", color: 5, half: [2, 2, 0.2], hp: 50 }] as never } };
}

const file = writeMap(landed());
const whole = parseMap(file);
const head = readHead(file);

/** No wait between asks, where nothing fails. */
const NOW = { wait: () => Promise.resolve() };

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
/** Whether a part is an overview or ground within RING of (x, z). */
const ringed = (p: MapPart, x: number, z: number): boolean => (p.kind === "overview" || p.kind === "ground") && off(p, x, z) <= RING;
/**
 * The order the loader asks for the parts left in with the body at (x, z): what is within RING; the overviews within
 * `near` (CITY_NEAR) and then its sectors; the overviews past it; the rest; each nearest first and a sector's ground
 * before its statics.
 */
const rank = (p: MapPart, x: number, z: number, near = CITY_NEAR): number => (ringed(p, x, z) ? 0 : (off(p, x, z) <= near ? 1 : 3) + (p.kind === "overview" ? 0 : 1)) * 1e6 + off(p, x, z) + (p.kind === "statics" ? 0.5 : 0);
/** Answers the waiting requests until `done` holds. */
const until = async (s: { answer(k?: number): Promise<void> }, done: () => boolean): Promise<void> => {
  while (!done()) await s.answer();
};

test("after the first frame the page asks for the rest nearest first: the overviews and ground within the ring four at once, then the other overviews within the city's reach, then the rest two at once, an overview past that reach among them, each sector's ground before its statics; and hands the statics over once every part has come", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  // Past FIRST_REACH of the west overview, which comes after the first frame, and past the city's reach as this test has it.
  const body = { x: 3500, z: 448, vx: 0, vz: 0 };
  const reach = 2600;
  let handed: MapStatics | null = null;
  let drawn = false;
  void loader!.follow(() => body, { arrived: (t, all) => all && (handed = t), near: reach }).then(() => (drawn = true));
  await settle();
  const near = firstFrameParts(head, body.x, body.z);
  const rest = head.parts.filter((p) => (p.kind === "overview" || p.kind === "ground" || p.kind === "statics") && !near.includes(p));
  const before = s.asked.length;
  await until(s, () => drawn);
  const urgent = rest.filter((p) => ringed(p, body.x, body.z));
  // This map has ground within the ring and past it, and an overview past it, so each is tested.
  expect([rest.some((p) => p.kind === "overview" && !urgent.includes(p)), urgent.length > 1, urgent.length <= URGENT_AT_ONCE, rest.length > urgent.length]).toEqual([true, true, true, true]);
  // What is within the ring is asked for at once, and nothing else while it is the nearest left.
  expect(s.waiting.map((w) => w.url).sort()).toEqual(urgent.map(nameOf).sort());
  let most = 0;
  while (s.waiting.length > 0) {
    if (s.waiting.every((w) => !urgent.map(nameOf).includes(w.url))) most = Math.max(most, s.waiting.length);
    await s.answer();
  }
  expect(most).toBe(AFTER_AT_ONCE);
  // Each the nearest of those left when it was asked for by the loader's order.
  const order = s.asked.slice(before).filter((url) => !near.some((p) => nameOf(p) === url)).map((url) => rest.find((p) => nameOf(p) === url)!);
  for (let k = 1; k < order.length; k++) expect(rank(order[k]!, body.x, body.z, reach)).toBeGreaterThanOrEqual(rank(order[k - 1]!, body.x, body.z, reach));
  expect(order.length).toBe(rest.length);
  // The west overview, past the city's reach, after every sector's ground and statics within it and before any past it.
  const west = order.findIndex((p) => p.kind === "overview");
  const within = order.filter((p, k) => p.kind !== "overview" && off(p, body.x, body.z) <= reach && k > west);
  expect([within.length, order.slice(0, west).some((p) => p.kind !== "overview" && off(p, body.x, body.z) > reach)]).toEqual([0, false]);
  expect(loader!.staged.hf.exactIn(0, 0, head.dims.chunksX * CHUNK_SIZE, head.dims.chunksZ * CHUNK_SIZE)).toBe(true);
  await settle();
  expect(wholeStatics(handed)).toBe(true);
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

test("the statics of the sectors within reach of the body are handed over once their ground and statics have come, before the rest have, and then the whole map's", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const body = { x: 100, z: 448, vx: 0, vz: 0 };
  const reach = 1200;
  const handed: [MapStatics, boolean][] = [];
  void loader!.follow(() => body, { arrived: (t, all) => handed.push([t, all]), near: reach });
  const near = head.parts.filter((p) => (p.kind === "ground" || p.kind === "statics") && off(p, body.x, body.z) <= reach);
  const inSector = (p: MapPart): number => {
    const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
    let n = 0;
    for (let cz = sq.cz0; cz < sq.cz1; cz++) for (let cx = sq.cx0; cx < sq.cx1; cx++) n += head.counts[cz * head.dims.chunksX + cx]!;
    return n;
  };
  const rows = near.filter((p) => p.kind === "statics").reduce((n, p) => n + inSector(p), 0);
  // The map has sectors past that reach, and statics within it.
  expect([near.length < head.parts.filter((p) => p.kind === "ground" || p.kind === "statics").length, rows > 0]).toEqual([true, true]);
  let at = -1;
  while (s.waiting.length > 0 || handed.length === 0) {
    await s.answer();
    if (handed.length > 0 && at < 0) at = s.answered;
  }
  await s.drain();
  await settle();
  // Handed round the body as soon as its last part there came, with those sectors' rows alone; then whole.
  const came = s.asked.slice(0, at).map((url) => url.slice(4));
  expect(near.every((p) => came.includes(p.name))).toBe(true);
  expect(head.parts.filter((p) => p.kind === "statics").every((p) => came.includes(p.name))).toBe(false);
  expect([handed.length, handed[0]![1], handed[0]![0].length, handed[1]![1]]).toEqual([2, false, rows, true]);
  expect(wholeStatics(handed[1]![0])).toBe(true);
});

test("the page asks for the head, then the land, then nothing until it knows where the body is; then that sector's ground and its overview alone, then the rest nearest first, and the statics last", async () => {
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
  void loader!.follow(() => body, { arrived: (t) => (handed = t) }).then(() => (near = true));
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
  expect([staged.hf.heights, staged.hf.tint, [...staged.nodes]]).toEqual([whole.heights, whole.tint, [...whole.nodes]]);
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
  const within = roads.filter((p) => off(p, 300, 600) <= ROAD_REACH);
  expect(new Set(s.asked.filter((url) => url.includes("/road.")))).toEqual(new Set(within.map(nameOf)));
  expect(within.length).toBeLessThan(roads.length);
  await s.drain();
  const held = loader!.staged.hf.road!, cellsOf = (p: MapPart): number => (readPart(h, p, framed.subarray(p.at, p.at + p.length)) as { road: { across: Uint8Array } }).road.across.length;
  expect(held.bytes).toBe(within.reduce((k, p) => k + cellsOf(p) * ROAD_PLANES, 0));
  // Gone east, the sectors a sector past ROAD_REACH are let go and those now within it asked for; one let go while it
  // was under way is not held when it comes.
  [body.x, body.z] = [4000, 600];
  loader!.lookRoads();
  const kept = roads.filter((p) => held.has(p.col * 4096 + p.row));
  expect(kept.every((p) => off(p, 4000, 600) <= ROAD_REACH + SECTOR_CHUNKS * CHUNK_SIZE)).toBe(true);
  const east = roads.filter((p) => off(p, 4000, 600) <= ROAD_REACH);
  expect(east.every((p) => s.waiting.some((w) => w.url === nameOf(p)) || held.has(p.col * 4096 + p.row))).toBe(true);
  [body.x, body.z] = [300, 600];
  loader!.lookRoads();
  await s.drain();
  expect(east.filter((p) => off(p, 300, 600) > ROAD_REACH + SECTOR_CHUNKS * CHUNK_SIZE).some((p) => held.has(p.col * 4096 + p.row))).toBe(false);
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
  void loader!.follow(() => body).then(() => (drawn = true));
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
  expect([s.asked.filter((u) => u === nameOf(failing)).length, loader!.staged.hf.heights]).toEqual([2, whole.heights]);
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
    get: (async (url: string) => {
      s.asked.push(url);
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
      return loader.follow(() => body, { say: (line) => late.push(line), arrived: (t) => (out.statics = t) }).then(() => (out.first = "drawn"));
    },
  ).catch((e: unknown) => (out.first = e instanceof Error ? e.message : String(e)));
  await quiet(s);
  return out;
}

/** Whether the statics handed over are the whole map's. */
test("the city's tops come after everything within the far city's reach, with the overviews past it, each square's after its overview, and nothing waits for them: the whole map's statics are handed over while they are still on their way", async () => {
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
  const handed: boolean[] = [];
  // Every part is answered as soon as it is asked but the tops, each answered only while nothing else waits.
  const isTops = (url: string): boolean => parts.some((p) => nameOf(p) === url);
  let topsCame = 0;
  let topsLeft = -1;
  void loader!.follow(() => body, { arrived: (_, all) => (handed.push(all), all && (topsLeft = parts.length - topsCame)), near: reach });
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
  // The whole map's statics did not wait for the tops still to come.
  expect([handed, topsLeft > 0]).toEqual([[false, true], true]);
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
        expect([where, times, t.loader!.staged.hf.heights, [...t.loader!.staged.nodes]]).toEqual([where, times, whole.heights, [...whole.nodes]]);
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

test("a sector's statics are set in the whole map's as they come, a pause after each slice read and each slice set; the hand-over's own steps are taken with a pause between, by a message the page sends itself, to their end", async () => {
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
  const handed: [MapStatics, boolean, number][] = [];
  function* arriving(t: MapStatics, whole: boolean): Generator<void, void> {
    for (let k = 0; k < 5; k++) yield;
    handed.push([t, whole, pauses]);
  }
  void loader!.follow(() => ({ x: 100, z: 100, vx: 0, vz: 0 }), { arriving });
  await s.drain();
  for (let k = 0; k < 200 && handed.length === 0; k++) await settle();
  channel.port1.close();
  // Read and set, three steps each; then the hand-over's five: the whole map's, the sector being all of it.
  expect([handed.length, handed[0]![1], handed[0]![2]]).toEqual([1, true, 3 + 3 + 5]);
  const t = handed[0]![0];
  expect([t.first, t.kind, t.x, t.y, t.z, t.yaw]).toEqual([all.statics.first, all.statics.kind, all.statics.x, all.statics.y, all.statics.z, all.statics.yaw]);
});

test("a part that comes damaged or as another's is refused by name and asked for again; the third time the map is broken: before the first frame the page fails saying which, after it the player is told and the statics never come", async () => {
  // The overview the body stands in, which the first frame waits for.
  const overview = firstFrameParts(head, 1056, 448).find((p) => p.kind === "overview")!;
  const statics = head.parts.filter((p) => p.kind === "statics")[1]!;
  const damaged = (name: string) => `map: its part ${name} is damaged or another's: its bytes are not those its head names`;
  const once = await trial((name, ask) => (name === overview.name && ask === 1 ? "damage" : name === statics.name && ask <= 2 ? "other" : null));
  // The land came and the page said so before the body's place was known; then the overview there failed once.
  expect([once.first, wholeStatics(once.statics), once.said, once.late]).toEqual(["drawn", true, ["", `loading the map: ${damaged(overview.name)}; asking again in 0.5 s`, ""], [`${damaged(statics.name)}; asking again in 0.5 s`, `${damaged(statics.name)}; asking again in 1 s`, `the map's ${statics.name} came, at ask 3`]]);
  const early = await trial((name) => (name === overview.name ? "damage" : null));
  expect([early.first, early.s.asked.filter((u) => u === `map/${overview.name}`).length]).toEqual([`${damaged(overview.name)}, at each of ${DAMAGED_MOST} asks: the map is broken`, DAMAGED_MOST]);
  const late = await trial((name) => (name === statics.name ? "other" : null));
  expect([late.first, late.statics, late.late.at(-1)]).toEqual(["drawn", null, `${damaged(statics.name)}, at each of ${DAMAGED_MOST} asks: the map is broken`]);
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
  expect([s.asked.filter((u) => u.includes("/ground.")).length, loader.staged.hf.heights, [...loader.staged.nodes]]).toEqual([4, map.heights, [...map.nodes]]);
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
    frame(): Uint8ClampedArray {
      scene.now += 1000 / 60;
      raster.render(scene.build(cam, null));
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
  for (let f = 0; f < 60; f++) want.frame();
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
    let [frames, wrong] = [0, 0];
    for (let f = 0; f < 120; f++) {
      if (s.waiting.length > 0 && rng.int(3) === 0) await s.answer(rng.int(s.waiting.length));
      await settle();
      if (!drawn) continue;
      for (let k = 0; k < hf.heights.length; k++) if (hf.heights[k] !== map.heights[k] && hf.heights[k] !== filled.hf.heights[k]) wrong++;
      scene.frame();
      frames++;
    }
    await s.drain();
    for (let f = 0; f < 40; f++) scene.frame();
    expect([wrong, frames > 60, hf.heights, scene.frame()]).toEqual([0, true, map.heights, picture]);
  }
});
