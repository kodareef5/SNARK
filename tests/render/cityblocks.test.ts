// The city past the far city as blocks from the map's tops (client/core/render/blocks.ts, cityblocks.ts): how a tile is
// made, how its runs give way to whoever else draws a chunk, the hand-over at the far city's reach as the rasterizer
// draws it, a piece gone, the ground coming under a tile, and the blocks' job on the far city's threads.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BLOCK, BLOCK_TILE_METRES, FAR_BLOCK, FARTHEST_BLOCK, TOP_CELLS, blocksBounds, makeBlocks, type BlocksJob, type BlocksMade } from "../../client/core/render/blocks.ts";
import { BLOCK_SLOTS, COARSER_FROM, COARSEST_FROM, CityBlocks } from "../../client/core/render/cityblocks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { HeldTops } from "../../client/core/render/blocks.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { ThreadedCityMaker, type CityMade, type CityThread } from "../../client/core/render/citymake.ts";
import { CITY_BUFFER, CITY_SLOTS } from "../../client/core/render/farcity.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { farTopByte } from "../../shared/world/tactical.ts";
import { building, cityWorld } from "../fixtures/cityworld.ts";
import { CitySquare, CityStatics, type ChunkSquare } from "../../shared/world/city.ts";
import { MapStatics } from "../../shared/world/mapfile.ts";

/** The draws of a frame's city blocks, and of its far city. */
const blockDraws = (p: FramePacket): number[] => [...p.drawBuffer.subarray(0, p.drawCount).keys()].filter((d) => p.drawBuffer[d] === CITY_BUFFER && p.drawSlot[d]! >= BLOCK_SLOTS && p.drawSlot[d]! < CITY_SLOTS);
const cityDraws = (p: FramePacket): number[] => [...p.drawBuffer.subarray(0, p.drawCount).keys()].filter((d) => p.drawBuffer[d] === CITY_BUFFER && p.drawSlot[d]! >= CITY_SLOTS);
const indices = (p: FramePacket, draws: number[]): number => draws.reduce((n, d) => n + p.drawIndexCount[d]!, 0);

test("a block stands where two of its four cells are filled or one stands 16 m, its top over the ground as the terrain draws it, in its tallest cell's colour, its foot under every quad that holds it", () => {
  const top = new Uint8Array(TOP_CELLS);
  const tint = new Uint8Array(TOP_CELLS);
  const set = (col: number, row: number, metres: number, colour: number): void => {
    top[row * 16 + col] = farTopByte(metres);
    tint[row * 16 + col] = colour;
  };
  // Block 0: two cells, the taller in colour 7. Block 1: one cell of 10 m, which makes none. Block 2: one of 20 m.
  // Block 3: two of 4 m.
  set(0, 0, 20, 7);
  set(1, 1, 10, 9);
  set(4, 0, 10, 9);
  set(8, 1, 20, 11);
  set(12, 0, 4, 13);
  set(13, 0, 4, 13);
  // Ground rising a metre each 8 m eastward, from 5 m: a sample of every fourth, as the terrain draws it past its window.
  const w = 9;
  const heights = Uint16Array.from({ length: w * w }, (_, k) => (5 + (k % w)) * 64);
  const job: BlocksJob = { id: 3, chunksX: 1, ox: 0, oz: 0, chunks: Int32Array.of(0), size: BLOCK, top, tint, i0: 0, j0: 0, w, heights, minY: 0, stepY: 1 / 64 };
  const made = makeBlocks(job);
  expect([made.id, [...made.chunks], made.first[0], made.count[0]]).toEqual([3, [0], 0, 3 * 5 * 6]);
  const b = blocksBounds(made.tall);
  const view = new DataView(made.data.buffer);
  const at = (v: number, a: number): number => (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * b.half[a]! + b.center[a]! + (a === 1 ? made.base : 0);
  // Each block's corners: its lowest, its roof and its colours.
  const blocks = new Map<number, { tops: Set<number>; low: number; colour: Set<number> }>();
  for (let v = 0; v < made.data.length / VERTEX_BYTES; v++) {
    const k = Math.floor(Math.min(at(v, 0), 63.99) / 16);
    const e = blocks.get(k) ?? { tops: new Set(), low: Infinity, colour: new Set() };
    e.low = Math.min(e.low, at(v, 1));
    e.colour.add(made.data[v * VERTEX_BYTES + 6]!);
    blocks.set(k, e);
  }
  for (let f = 0; f < made.data.length / VERTEX_BYTES / 4; f++) {
    const ys = [0, 1, 2, 3].map((e) => at(f * 4 + e, 1));
    if (ys.every((y) => Math.abs(y - ys[0]!) < 0.02)) blocks.get(Math.floor(Math.min(at(f * 4, 0), 63.99) / 16))!.tops.add(Math.round(ys[0]! * 10) / 10);
  }
  // The middle of the quad under a block is halfway along its diagonal: half a metre over its west corners.
  expect([...blocks.keys()].sort()).toEqual([0, 2, 3]);
  expect([...blocks.get(0)!.tops, ...blocks.get(2)!.tops, ...blocks.get(3)!.tops]).toEqual([5.5 + 20, 9.5 + 20, 11.5 + 4]);
  expect([...blocks.get(0)!.colour, ...blocks.get(2)!.colour, ...blocks.get(3)!.colour]).toEqual([7, 11, 13]);
  // Every foot goes 2 m under the lowest corner of the 64 m quad round it, the ground's 5 m at the chunk's west edge.
  for (const e of blocks.values()) expect(e.low).toBeCloseTo(3, 1);
  expect([made.base, made.low[0]]).toEqual([3, 0]);
  expect(made.base + made.high[0]!).toBeCloseTo(29.5, 1);
  // Of 16 m blocks, four cells a side, standing where four of the sixteen are filled or one 16 m tall: the first and the
  // third stand for their 20 m cells, the second's one cell of 10 m and the fourth's two of 4 m make none. Each stands on
  // the ground at its middle, a metre over its west corners.
  const far = makeBlocks({ ...job, size: FAR_BLOCK, top: top.slice(), tint: tint.slice(), heights: heights.slice() });
  const fv = new DataView(far.data.buffer), fb = blocksBounds(far.tall);
  const y = (v: number): number => (fv.getInt16(v * VERTEX_BYTES + 2, true) / 32767) * fb.half[1]! + fb.center[1]! + far.base;
  const roofs: number[] = [];
  for (let f = 0; f < far.data.length / VERTEX_BYTES / 4; f++) if ([1, 2, 3].every((e) => Math.abs(y(f * 4 + e) - y(f * 4)) < 0.02)) roofs.push(Math.round(y(f * 4) * 10) / 10);
  expect(roofs.sort((a, b) => a - b)).toEqual([6 + 20, 10 + 20]);
  expect(far.count[0]! / 6).toBeLessThan(made.count[0]! / 6);
});

/** A city of frame buildings two chunks apart over a map `chunks` a side, each `storeys` tall. */
const grid = (chunks: number, storeys: number) => {
  const statics = [];
  for (let cz = 1; cz < chunks; cz += 2) for (let cx = 1; cx < chunks; cx += 2) statics.push(...building(cx * CHUNK_SIZE + 32, cz * CHUNK_SIZE + 32, 0, storeys));
  return statics;
};

test("the blocks of a tile are drawn in runs of the chunks no one else draws, fading in where that one fades out, and none it draws whole", () => {
  const w = cityWorld({ chunks: 16, statics: grid(16, 3), tops: true, late: true, width: 160, height: 90 });
  w.look(512, 0, 512, 900, 0.3, 400);
  w.frame();
  const blocks = w.scene.blocks!;
  // Chunks drawn whole elsewhere: the first two rows; fading at 800 m: the next two; the rest drawn by the blocks alone.
  const runs: { first: number; count: number; fade: number }[] = [];
  const shown = (chunk: number): number => (chunk < 32 ? -1 : chunk < 64 ? 800 : 0);
  blocks.draw(w.cam, 4000, shown, (_slot, first, count, _ox, _oy, _oz, passes, fade, near) => {
    expect(passes).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(0);
    runs.push({ first, count, fade });
  });
  expect(runs.length).toBeGreaterThan(1);
  expect(runs.filter((r) => r.fade !== 0).every((r) => r.fade === -800)).toBe(true);
  expect(runs.some((r) => r.fade === -800) && runs.some((r) => r.fade === 0)).toBe(true);
  // With every chunk drawn by the blocks alone, more is drawn; with every chunk drawn whole elsewhere, none.
  let all = 0;
  blocks.draw(w.cam, 4000, () => 0, (_s, _f, count) => void (all += count));
  let none = 0;
  blocks.draw(w.cam, 4000, () => -1, (_s, _f, count) => void (none += count));
  const kept = runs.reduce((n, r) => n + r.count, 0);
  expect([none, kept > 0, kept < all]).toEqual([0, true, true]);
  // Nothing past the view's end.
  let short = 0;
  blocks.draw(w.cam, 300, () => 0, (_s, _f, count) => void (short += count));
  expect(short).toBe(0);
});

test("past the far city's reach its buildings are blocks, faded in over the pixels its fade drops, and short of the fade the picture is the far city's alone", () => {
  const reach = 700;
  const tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, city: reach, bases: 0 } };
  const make = (tops: boolean) => {
    const w = cityWorld({ chunks: 32, statics: grid(32, 4), tops, tier, width: 320, height: 180 });
    w.scene.viewDistance = 1900;
    // From the air at the map's south-west corner, looking north-east across it.
    [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [20, 260, 20, Math.PI / 4, -0.22];
    for (let f = 0; f < 4; f++) w.frame();
    return w;
  };
  const without = make(false);
  const p0 = without.frame();
  expect(blockDraws(p0)).toEqual([]);
  const was = without.raster.color.slice();
  const w = make(true);
  const p = w.frame();
  const drawn = blockDraws(p);
  expect(drawn.length).toBeGreaterThan(0);
  // A run fades in at the reach or is drawn whole; and the far city fades out at it.
  for (const d of drawn) expect([0, Math.fround(-w.scene.alongGround(reach))]).toContain(p.drawFade[d]!);
  expect(cityDraws(p).some((d) => p.drawFade[d] === Math.fround(w.scene.alongGround(reach)))).toBe(true);
  // Where a pixel's ray meets the ground short of where the far city fades, what it shows is nearer still: there not a
  // pixel moved. Past its reach the blocks drew buildings over what was nothing.
  const ray = new Float64Array(3);
  let same = 0;
  let near = 0;
  let gained = 0;
  for (let i = 0; i < w.W * w.H; i++) {
    w.cam.ray(((i % w.W) + 0.5) / w.W, (Math.floor(i / w.W) + 0.5) / w.H, ray);
    const ground = ray[1]! < 0 ? w.cam.y / -ray[1]! : Infinity;
    const changed = [0, 1, 2].some((k) => w.raster.color[i * 4 + k] !== was[i * 4 + k]);
    if (ground < w.scene.alongGround(reach) * (1 - w.scene.assets.tier.fade)) {
      near++;
      if (!changed) same++;
    }
    if (changed && ground > reach) gained++;
  }
  expect(near).toBeGreaterThan(1000);
  expect(same).toBe(near);
  expect(gained).toBeGreaterThan(1000);
});

test("city blocks yield to streamed meshes and disappear when a tower falls", () => {
  const statics = grid(32, 4);
  // A tower of 20 storeys and 32 m a side beyond the far city's reach.
  statics.push(...building(14 * CHUNK_SIZE + 32, 14 * CHUNK_SIZE + 32, 0, 20, 4));
  const tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, city: 700, bases: 600 } };
  const w = cityWorld({ chunks: 32, statics, tops: true, late: true, tier, width: 320, height: 180 });
  w.scene.viewDistance = 2400;
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [20, 260, 20, Math.PI / 4, -0.22];
  // The far feed's cells of every chunk within 800 m, which the far blocks draw to their reach before the statics come.
  for (let c = 0; c < 32 * 32; c++) {
    const [x, z] = [(c % 32) * CHUNK_SIZE + 32, Math.floor(c / 32) * CHUNK_SIZE + 32];
    if (Math.hypot(x - 20, z - 20) < 800 && w.server.chunks[c]) w.send(c);
  }
  let p = w.frame();
  p = w.frame();
  const before = blockDraws(p);
  expect(before.length).toBeGreaterThan(0);
  expect(cityDraws(p)).toEqual([]);
  // The blocks give way to the far feed's at their reach, and to nothing else.
  for (const d of before) expect([0, -600]).toContain(p.drawFade[d]!);
  expect(before.some((d) => p.drawFade[d] === -600)).toBe(true);
  // The statics come, and the far city's levels are made; then the blocks give way to it at its reach.
  w.arrive();
  // The tile waits for missing-piece lists. Finish its mesh on the first eligible frame.
  for (let f = 0; f < 5; f++) expect(cityDraws(w.frame(false, 60))).toEqual([]);
  w.scene.city!.makeMs = Infinity;
  p = w.frame(false, 60);
  expect(cityDraws(p).length).toBeGreaterThan(0);
  for (const d of blockDraws(p)) expect([0, Math.fround(-w.scene.alongGround(700))]).toContain(p.drawFade[d]!);
  const tower = w.chunkOf(14 * CHUNK_SIZE + 32, 14 * CHUNK_SIZE + 32);
  const tall = w.raster.color.slice();
  const had = indices(p, blockDraws(p));
  // The tower falls: its pieces over 8 m go from the server's store, and the far feed tells of its chunk.
  const t = w.server.chunks[tower]!;
  for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && t.y[s]! > 8) w.server.remove(tower * 65536 + s);
  w.send(tower);
  for (let f = 0; f < 4; f++) p = w.frame();
  expect(w.scene.city!.goneOf(tower)).not.toBeNull();
  expect(indices(p, blockDraws(p))).toBeLessThan(had);
  let changed = 0;
  for (let i = 0; i < w.W * w.H; i++) if ([0, 1, 2].some((k) => w.raster.color[i * 4 + k] !== tall[i * 4 + k])) changed++;
  expect(changed).toBeGreaterThan(20);
  expect(BLOCK_TILE_METRES).toBe(16 * CHUNK_SIZE);
});

test("a tile of blocks is made again when the ground its blocks stand on changes, and not when ground comes that leaves those samples as they were", () => {
  const w = cityWorld({ chunks: 32, statics: grid(32, 4), tops: true, late: true, width: 160, height: 90 });
  // A client's ground, which comes a part at a time.
  w.hf.holdNone();
  w.scene.viewDistance = 3000;
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [20, 260, 20, Math.PI / 4, -0.22];
  for (let f = 0; f < 3; f++) w.frame();
  const made = (): number => (w.frame(), w.scene.blocks!.stats.made);
  expect(made()).toBe(0);
  // A sector's ground comes that holds the same samples: nothing is made again.
  w.hf.hold(0, 0, 16, 16);
  expect(made()).toBe(0);
  // An overview's ground comes 3 m over what stood for it, under the tile east of that: it is made again.
  const side = (16 * CHUNK_SIZE) / w.hf.cell / 4 + 1;
  w.hf.fill(16, 0, 32, 16, 4, new Uint16Array(side * side).fill((3 - w.hf.minY) / w.hf.stepY), new Uint8Array(side * side).fill(12));
  expect(made()).toBeGreaterThan(0);
  expect(made()).toBe(0);
});

test("on the far city's threads a tile of blocks is made apart from the levels, before the city's kinds have come, and goes back to the blocks alone", () => {
  const posted: { m: unknown; thread: CityThread }[] = [];
  const open = (): CityThread => {
    const thread: CityThread = { onmessage: null, postMessage: (m) => void posted.push({ m, thread }) };
    return thread;
  };
  const maker = new ThreadedCityMaker(open, 2);
  let made = 0;
  maker.onMade = () => made++;
  const job: BlocksJob = { id: 9, chunksX: 1, ox: 0, oz: 0, chunks: Int32Array.of(0), size: BLOCK, top: new Uint8Array(TOP_CELLS), tint: new Uint8Array(TOP_CELLS), i0: 0, j0: 0, w: 9, heights: new Uint16Array(81), minY: 0, stepY: 1 / 64 };
  maker.blocks(job);
  // Each thread is started with no kinds yet, and the job goes to one of them.
  expect(posted.map((p) => Object.keys(p.m as object)[0])).toEqual(["kinds", "kinds", "blocks"]);
  const back: BlocksMade = makeBlocks({ ...job, top: new Uint8Array(TOP_CELLS), tint: new Uint8Array(TOP_CELLS), heights: new Uint16Array(81) });
  posted.at(-1)!.thread.onmessage!({ data: back });
  const levels: CityMade[] = [];
  expect([maker.built(), maker.built(), maker.take(levels), made]).toEqual([back, null, 0, 0]);
});

test("a tile of blocks past 4 km is made of coarser blocks, 32 m past 4.8 km, and made again of 8 m ones as the camera comes near it, with no tile let go of meanwhile", () => {
  const dims = { chunksX: 128, chunksZ: 16 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  hf.heights.fill(64 * 64);
  // A building of 20 m in the first chunk of the second tile, 1 km east, and of the eighth, 7 km east.
  const top = new Uint8Array(TOP_CELLS * 2), tint = new Uint8Array(TOP_CELLS * 2);
  for (let k = 0; k < 2; k++) for (const c of [0, 1, 16, 17]) [top[k * TOP_CELLS + c], tint[k * TOP_CELLS + c]] = [farTopByte(20), 5];
  const tops = new HeldTops(dims);
  tops.take({ chunks: Uint32Array.of(16, 112), top, tint });
  const jobs: BlocksJob[] = [];
  const made: BlocksMade[] = [];
  const maker = { onMade: null, start: () => {}, make: () => {}, take: () => 0, blocks: (job: BlocksJob) => void (jobs.push(job), made.push(makeBlocks(job))), built: () => made.shift() ?? null };
  const blocks = new CityBlocks({ tops, maker }, dims, hf, 0, Uint8Array.from({ length: 256 }, (_, i) => i), new Uint8Array(0));
  const cam = new Camera();
  const p = new FramePacket();
  const budget = { spend: () => {}, reserve: () => {} };
  const frames = (x: number, n: number): void => {
    for (let f = 0; f < n; f++) {
      [cam.x, cam.y, cam.z, cam.yaw] = [x, 100, 512, Math.PI / 2];
      cam.update();
      p.beginFrame();
      blocks.update(p, budget, cam, 8000, null, null);
    }
  };
  frames(10, 4);
  const sizes = (): [number, number][] => jobs.map((j) => [j.chunks[0]!, j.size]);
  expect(sizes()).toEqual([[16, BLOCK], [112, FARTHEST_BLOCK]]);
  expect([COARSER_FROM, COARSEST_FROM]).toEqual([4000, 4800]);
  // Nearer the far tile, past the turn back: it is made again of 8 m blocks, and the near one, its edge now 4.95 km off,
  // of 16 m ones: past 4 km but short of 4.8 km and the margin that keeps a tile from flickering between sizes.
  jobs.length = 0;
  p.beginFrame();
  frames(7000, 4);
  expect(sizes().sort((a, b) => a[0] - b[0])).toEqual([[16, FAR_BLOCK], [112, BLOCK]]);
  expect(p.assetDrops.length).toBe(0);
});

test("before the map's statics, a chunk the far feed has told of as emptied is drawn as nothing within the far blocks' reach, not as the map's blocks of it", () => {
  const tier = { ...tierOf("medium"), reach: { ...tierOf("medium").reach, city: 700, bases: 600 } };
  const w = cityWorld({ chunks: 32, statics: grid(32, 4), tops: true, late: true, tier, width: 320, height: 180 });
  w.scene.viewDistance = 2400;
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [20, 260, 20, Math.PI / 4, -0.22];
  // A building 290 m off whose chunk the far feed has not told of: the blocks draw it.
  const chunk = w.chunkOf(3 * CHUNK_SIZE + 32, 3 * CHUNK_SIZE + 32);
  let p = w.frame();
  p = w.frame();
  const had = indices(p, blockDraws(p));
  // It is torn down whole, and the far feed says so: it is the far blocks' to draw, as nothing.
  const t = w.server.chunks[chunk]!;
  for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0) w.server.remove(chunk * 65536 + s);
  w.send(chunk);
  for (let f = 0; f < 3; f++) p = w.frame();
  expect(indices(p, blockDraws(p))).toBeLessThan(had);
});

/** Square `sq` of the whole `city`'s rows, as a page sets a sector's in (map-statics.ts). */
function squareOf(whole: CityStatics, held: CityStatics, sq: ChunkSquare): CitySquare {
  const map = whole.squareOf(0)!.map, chunksX = whole.dims.chunksX, w = sq.cx1 - sq.cx0, n = w * (sq.cz1 - sq.cz0);
  const first = new Uint32Array(n + 1), rows: number[] = [];
  for (let k = 0; k < n; k++) {
    const c = (sq.cz0 + Math.floor(k / w)) * chunksX + sq.cx0 + (k % w);
    for (let r = map.first[c]!; r < map.first[c + 1]!; r++) rows.push(r);
    first[k + 1] = rows.length;
  }
  const rowsOf = { first, kind: Uint16Array.from(rows, (r) => map.kind[r]!), yaw: Uint16Array.from(rows, (r) => map.yaw[r]!), x: Float32Array.from(rows, (r) => map.x[r]!), y: Float32Array.from(rows, (r) => map.y[r]!), z: Float32Array.from(rows, (r) => map.z[r]!), bends: new Map() };
  const steps = CitySquare.steps(whole.dims, sq, rowsOf, held.bentKind);
  for (let s = steps.next(); ; s = steps.next()) if (s.done) return s.value;
}

test("a city held a sector at a time: one set in or let go remakes no other's tiles, and blocks draw a sector not held", () => {
  const w = cityWorld({ chunks: 32, statics: grid(32, 4), tops: true, late: true, width: 320, height: 180 });
  w.scene.viewDistance = 2400;
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [20, 260, 20, Math.PI / 4, -0.22];
  const held = CityStatics.held(w.dims, 4, (w.statics.squareOf(0)!.map as MapStatics).kinds, w.reg);
  const sectors: ChunkSquare[] = [0, 1, 2, 3].map((n) => ({ cx0: (n % 2) * 16, cz0: Math.floor(n / 2) * 16, cx1: (n % 2) * 16 + 16, cz1: Math.floor(n / 2) * 16 + 16 }));
  held.set(0, squareOf(w.statics, held, sectors[0]!));
  w.arrive(held);
  const uploads = new Set<number>(), drops: number[] = [];
  const run = (frames: number): FramePacket => {
    let p!: FramePacket;
    for (let f = 0; f < frames; f++) {
      p = w.frame(false, 60);
      for (const u of p.assetUploads) if (u.slot >= CITY_SLOTS) uploads.add(u.slot);
      for (const d of p.assetDrops) if (d >= CITY_SLOTS) drops.push(d);
    }
    return p;
  };
  let p = run(8);
  const city = w.scene.city!;
  city.makeMs = Infinity;
  // A chunk of the sector east, not held: the far city has no tile of it, and the blocks draw it.
  const east = 3 * 32 + 21;
  expect([cityDraws(p).length > 0, blockDraws(p).length > 0, city.isFar(east), city.shows(east), w.statics.in(east) > 0]).toEqual([true, true, false, 0, true]);
  const first = new Set(uploads);
  uploads.clear();
  drops.length = 0;
  held.set(1, squareOf(w.statics, held, sectors[1]!));
  p = run(8);
  // The new sector's tiles are made; none of those before is let go.
  expect([w.scene.city, uploads.size > 0, drops.filter((d) => first.has(d)), city.isFar(east)]).toEqual([city, true, [], true]);
  const second = new Set(uploads);
  drops.length = 0;
  held.drop(1);
  p = run(2);
  expect([drops.length > 0, drops.every((d) => second.has(d)), city.isFar(east), blockDraws(p).length > 0]).toEqual([true, true, false, true]);
});
