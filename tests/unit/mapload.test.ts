// The page's map as its parts come (client/core/mapload.ts): its head, its landmarks' definitions and its overviews before
// anything; the ground within reach of the body alone, which the first frame waits for; then the rest of the ground nearest
// first to where the body is and is heading, six at once, and the statics last, all of them.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { readStatics, type Get } from "../../client/core/fetched.ts";
import { MapLoader, PARTS_AT_ONCE, StagedMap, type Place } from "../../client/core/mapload.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { PREDICTED_REACH } from "../../client/core/session.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield, nodeLayers, parseMap, partsOf, readHead, readPart, squareOf, writeMap, type MapData, type MapPart, type NodeLayer, type OverviewPiece } from "../../shared/world/mapfile.ts";
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

/** Lets every promise the answers so far started run its course. */
const settle = (): Promise<void> => new Promise((go) => setTimeout(go, 0));

/**
 * A server of a map's head and parts that answers each request only when the test says, counting the bytes it sent, and
 * how many requests were open at most. `change` stands in for what the wire did to a part.
 */
function heldServer(of: Uint8Array, change: (url: string, bytes: Uint8Array) => Uint8Array = (_, b) => b) {
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
        waiting.push({ url, go: () => ((s.bytes += body?.length ?? 0), s.answered++, done(body ? new Response(change(url, body)) : new Response("not found", { status: 404 }))) });
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

test("the page asks for the head, then the land and the overviews, then nothing until it knows where the body is; then that sector's ground alone, then the rest nearest first six at once, and the statics last", async () => {
  const s = heldServer(file);
  let loader: MapLoader | null = null;
  void MapLoader.start(s.get, `map/${head.name}`).then((l) => (loader = l));
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
  void loader!.follow(() => body).then(() => (near = true));
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
  let came = false;
  void loader!.statics.then(() => (came = true));
  while (s.waiting.some((w) => !statics.includes(w.url))) await s.answer(s.waiting.findIndex((w) => !statics.includes(w.url)));
  await s.drain();
  expect([came, s.most, s.asked.slice(-statics.length).sort()]).toEqual([true, PARTS_AT_ONCE, [...statics].sort()]);
  expect([staged.hf.heights, staged.hf.tint, [...staged.nodes]]).toEqual([whole.heights, whole.tint, [...whole.nodes]]);
  const t = await readStatics(loader!.statics, () => Promise.resolve());
  expect([t.first, t.kind, t.x, t.y, t.z, t.yaw]).toEqual([whole.statics.first, whole.statics.kind, whole.statics.x, whole.statics.y, whole.statics.z, whole.statics.yaw]);
});

test("the first frame on this map waits for its head, its land, its two overviews and at most four sectors' ground: counted, not timed", async () => {
  const count = async (body: Place): Promise<number[]> => {
    const s = heldServer(file);
    let loader: MapLoader | null = null;
    void MapLoader.start(s.get, `map/${head.name}`).then((l) => (loader = l));
    await s.drain();
    let near = false;
    void loader!.follow(() => body).then(() => (near = true));
    await settle();
    while (!near) await s.answer();
    return [s.answered, s.bytes];
  };
  const size = (kinds: string[]): number => head.bytes + head.parts.filter((p) => kinds.includes(p.kind)).reduce((n, p) => n + p.length, 0);
  // In a sector's middle, one sector's ground; at the corner of four, four. The page fetched 4.71 MB before its first frame here.
  expect(await count({ x: 1056, z: 448, vx: 0, vz: 0 })).toEqual([5, 1072143]);
  expect(await count({ x: 1536, z: 896, vx: 0, vz: 0 })).toEqual([8, 2357208]);
  expect([size(["land", "overview"]), size(["land", "overview", "ground"])]).toEqual([381132, 4705002]);
});

/** What a promise came to: null, or the message it failed with. */
const outcome = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)));

test("a part that comes damaged, or as another's, or not at all, is refused with its name, before the first frame or after", async () => {
  const [a, b] = [head.parts.find((p) => p.kind === "overview")!, head.parts.filter((p) => p.kind === "ground")[3]!];
  const damaged = heldServer(file, (url, bytes) => (url === nameOf(a) ? bytes.map((v, i) => (i === 7 ? v ^ 1 : v)) : bytes));
  const started = outcome(MapLoader.start(damaged.get, `map/${head.name}`));
  await damaged.drain();
  expect(await started).toBe(`map: its part ${a.name} is damaged or another's: its bytes are not those its head names`);
  const other = partsOf(file).find((p) => p.name === head.parts.find((q) => q.kind === "ground")!.name)!.bytes;
  const swapped = heldServer(file, (url, bytes) => (url === nameOf(b) ? other : bytes));
  const loading = MapLoader.start(swapped.get, `map/${head.name}`);
  await swapped.drain();
  const loader = await loading;
  const sq = squareOf(head.dims, SECTOR_CHUNKS, b.col, b.row)!;
  const near = outcome(loader.follow(() => ({ x: (sq.cx0 + 1) * CHUNK_SIZE, z: (sq.cz0 + 1) * CHUNK_SIZE, vx: 0, vz: 0 })));
  await swapped.drain();
  expect([await near, await outcome(loader.statics)]).toEqual([`map: its part ${b.name} is damaged or another's: its bytes are not those its head names`, `map: its part ${b.name} is damaged or another's: its bytes are not those its head names`]);
  // After the first frame a part that fails ends the statics, which the page reads.
  const late = heldServer(file, (url, bytes) => (url === nameOf(b) ? bytes.subarray(1) : bytes));
  const lateLoading = MapLoader.start(late.get, `map/${head.name}`);
  await late.drain();
  const l = await lateLoading;
  const first = outcome(l.follow(() => ({ x: 100, z: 100, vx: 0, vz: 0 })));
  const read = outcome(readStatics(l.statics, () => Promise.resolve()));
  await late.drain();
  expect([await first, await read]).toEqual([null, `map: its part ${b.name} is damaged or another's: its bytes are not those its head names`]);
  const gone = heldServer(file);
  const missing = outcome(MapLoader.start(gone.get, "map/head.0123456789abcdef.part"));
  await gone.drain();
  expect(await missing).toBe('map/head.0123456789abcdef.part: the server answered 404: "not found"');
});

test("a map with a listed node layer brings all its ground before any node source is made: the head does not say its slots a chunk", async () => {
  const listed = writeMap(cornerMap(true));
  const s = heldServer(listed);
  const loading = MapLoader.start(s.get, `map/${readHead(listed).name}`);
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
    const loading = MapLoader.start(s.get, `map/${ch.name}`);
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
