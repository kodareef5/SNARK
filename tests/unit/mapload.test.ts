// The page's map as its parts come (client/core/mapload.ts): its head, its landmarks' definitions and its overviews before
// anything; the ground within reach of the body alone, which the first frame waits for, by the rule the map's build holds to
// its budget; then the rest of the ground nearest first to where the body is and is heading, six at once, and the statics
// last, all of them. A part that fails is asked for again, the wait between asks counted here with no clock.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import type { Get } from "../../client/core/fetched.ts";
import { DAMAGED_MOST, MapLoader, PARTS_AT_ONCE, RETRY_FIRST, RETRY_MOST, StagedMap, firstFrameParts, type Place } from "../../client/core/mapload.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { PREDICTED_REACH } from "../../client/core/session.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield, nodeLayers, parseMap, partsOf, readHead, readPart, squareOf, writeMap, type MapData, type MapPart, type MapStatics, type NodeLayer, type OverviewPiece } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { cornerMap, wideMap } from "../fixtures/map.ts";
import { nodePack, nodeRegistry } from "../fixtures/nodeworld.ts";

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
/** Metres from (x, z) to a part's sector. */
const off = (p: MapPart, x: number, z: number): number => {
  const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
};

test("told to bring the whole ground first, the page draws nothing until every ground part has come, and then asks for the statics one at a time", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await s.drain();
  const before = s.asked.length;
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  let drawn = false;
  let handed: MapStatics | null = null;
  void loader!.follow(() => body, { arrived: (t) => (handed = t), whole: true }).then(() => (drawn = true));
  await settle();
  const grounds = head.parts.filter((p) => p.kind === "ground").map(nameOf);
  const statics = head.parts.filter((p) => p.kind === "statics").map(nameOf);
  // Every ground part is answered before anything is drawn, and no statics part is asked for meanwhile.
  while (s.asked.length - before < grounds.length || s.waiting.some((w) => grounds.includes(w.url))) {
    expect(drawn).toBe(false);
    expect(s.waiting.every((w) => grounds.includes(w.url))).toBe(true);
    await s.answer();
  }
  await settle();
  expect([drawn, loader!.staged.hf.exactIn(0, 0, head.dims.chunksX * CHUNK_SIZE, head.dims.chunksZ * CHUNK_SIZE)]).toEqual([true, true]);
  expect(s.asked.slice(before, before + grounds.length).sort()).toEqual([...grounds].sort());
  // Then the statics, never two at once.
  let most = 0;
  while (s.waiting.length > 0) {
    most = Math.max(most, s.waiting.length);
    expect(statics.includes(s.waiting[0]!.url)).toBe(true);
    await s.answer();
  }
  await settle();
  expect(most).toBe(1);
  expect(s.asked.slice(before + grounds.length)).toEqual(statics);
  expect(handed).not.toBeNull();
  expect(handed!.length).toBe(whole.statics.length);
});

test("the page asks for the head, then the land and the overviews, then nothing until it knows where the body is; then that sector's ground alone, then the rest nearest first six at once, and the statics last", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`, NOW).then((l) => (loader = l));
  await settle();
  expect(s.asked).toEqual([`map/${head.name}`]);
  await s.answer();
  const first = head.parts.filter((p) => p.kind === "land" || p.kind === "overview").map(nameOf);
  expect(s.asked.slice(1)).toEqual(first);
  await s.drain();
  expect(loader).not.toBeNull();
  const { staged } = loader!;
  // Its land is the definitions the welcome's registry is compiled with.
  expect(staged.content).toEqual(whole.content);
  await settle();
  expect(s.asked.length).toBe(1 + first.length);
  // The body stands in the middle of a sector: only that one comes before the first frame.
  const body = { x: 1056, z: 448, vx: 0, vz: 0 };
  let near = false;
  let handed: MapStatics | null = null;
  void loader!.follow(() => body, { arrived: (t) => (handed = t) }).then(() => (near = true));
  await settle();
  const grounds = head.parts.filter((p) => p.kind === "ground");
  const mine = grounds.filter((p) => off(p, body.x, body.z) <= PREDICTED_REACH);
  expect([s.asked.slice(1 + first.length), mine.length]).toEqual([mine.map(nameOf), 1]);
  await s.answer();
  await settle();
  expect([near, staged.hf.exactIn(body.x - PREDICTED_REACH, body.z - PREDICTED_REACH, body.x + PREDICTED_REACH, body.z + PREDICTED_REACH)]).toEqual([true, true]);
  // Then six at once, each the nearest of those left to where the body is then; it jumps across the map halfway.
  const rest = grounds.filter((p) => !mine.includes(p));
  expect(s.waiting.length).toBe(PARTS_AT_ONCE);
  const asked = s.asked.length;
  let left = [...rest];
  for (const url of s.asked.slice(asked - PARTS_AT_ONCE)) left = left.filter((p) => nameOf(p) !== url);
  while (left.length > 0) {
    if (left.length === 2) [body.x, body.z] = [100, 1200];
    await s.answer();
    const url = s.asked.at(-1)!;
    const best = Math.min(...left.map((p) => off(p, body.x, body.z)));
    const p = left.find((q) => nameOf(q) === url)!;
    expect(off(p, body.x, body.z)).toBe(best);
    left = left.filter((q) => q !== p);
  }
  // The statics are asked for once every ground part has been, and come only once all of the ground has.
  const statics = head.parts.filter((p) => p.kind === "statics").map(nameOf);
  while (s.waiting.some((w) => !statics.includes(w.url))) await s.answer(s.waiting.findIndex((w) => !statics.includes(w.url)));
  expect(handed).toBeNull();
  await s.drain();
  expect([s.most, s.asked.slice(-statics.length).sort()]).toEqual([PARTS_AT_ONCE, [...statics].sort()]);
  expect([staged.hf.heights, staged.hf.tint, [...staged.nodes]]).toEqual([whole.heights, whole.tint, [...whole.nodes]]);
  expect(wholeStatics(handed)).toBe(true);
});

test("the first frame on this map waits for its head, its land, its two overviews and at most four sectors' ground, as firstFrameParts says: counted, not timed", async () => {
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
  // In a sector's middle, one sector's ground; at the corner of four, four. The page fetched 4.71 MB before its first frame here.
  expect(await count({ x: 1056, z: 448, vx: 0, vz: 0 })).toEqual([5, 1072143]);
  expect(await count({ x: 1536, z: 896, vx: 0, vz: 0 })).toEqual([8, 2357208]);
  expect([size(["land", "overview"]), size(["land", "overview", "ground"])]).toEqual([381132, 4705002]);
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
  void loader!.follow(() => body);
  await settle();
  await s.answer();
  // The nearest behind the body is among the six asked for first. It fails, and its lane waits while the others go on.
  expect(s.waiting.map((w) => w.url)).toContain(nameOf(failing));
  await s.answer(s.waiting.findIndex((w) => w.url === nameOf(failing)));
  for (let k = 0; k < PARTS_AT_ONCE; k++) await s.answer();
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

test("a part that comes damaged or as another's is refused by name and asked for again; the third time the map is broken: before the first frame the page fails saying which, after it the player is told and the statics never come", async () => {
  const overview = head.parts.find((p) => p.kind === "overview")!;
  const statics = head.parts.filter((p) => p.kind === "statics")[1]!;
  const damaged = (name: string) => `map: its part ${name} is damaged or another's: its bytes are not those its head names`;
  const once = await trial((name, ask) => (name === overview.name && ask === 1 ? "damage" : name === statics.name && ask <= 2 ? "other" : null));
  expect([once.first, wholeStatics(once.statics), once.said[0], once.late]).toEqual(["drawn", true, `loading the map: ${damaged(overview.name)}; asking again in 0.5 s`, [`${damaged(statics.name)}; asking again in 0.5 s`, `${damaged(statics.name)}; asking again in 1 s`, `the map's ${statics.name} came, at ask 3`]]);
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
