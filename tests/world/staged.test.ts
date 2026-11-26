// A client's ground as it comes a part at a time (shared/world/heightfield.ts): every sample filled from its overview, then
// each sector's own set over it, in any order, with a record of which chunks hold their own.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { FramePacket, SOURCE_WINDOW } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { COARSE, TerrainLod, coarseArea, coarseGround, groundSize, type GroundBudget } from "../../client/core/render/terrain.ts";
import { Lakes } from "../../client/core/render/lakes.ts";
import { ReliefTiles, paintRelief } from "../../client/core/tactical.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { ground, groundUnder } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, joinParts, mapHeightfield, nodeLayers, parseMap, readHead, readPart, setGround, writeMap, type GroundPiece, type MapHead, type NodeLayer, type OverviewPiece } from "../../shared/world/mapfile.ts";
import type { NodeSource, NodeSpot } from "../../shared/world/nodes.ts";
import { BAND_CHUNKS, StagedMap } from "../../client/core/mapload.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { MapWater } from "../../shared/world/water.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { cornerMap, wideMap } from "../fixtures/map.ts";
import { denseOf, nodesOf } from "../fixtures/paged-ground.ts";
import { nodePack, nodeRegistry } from "../fixtures/nodeworld.ts";

const PER = CHUNK_SIZE / TERRAIN_CELL;
/** Off the lattice's grids: two overviews and ten sectors, the first column of each 8 chunks wide. */
const file = writeMap(wideMap());
const whole = mapHeightfield(parseMap(file));

/** A map's file read as a client takes it: its head, its overviews and its sectors' grounds, each read alone. */
function partsOf(file: Uint8Array): { head: MapHead; overviews: OverviewPiece[]; grounds: GroundPiece[] } {
  const head = readHead(file);
  const read = (kind: string) => head.parts.filter((p) => p.kind === kind).map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length)));
  return { head, overviews: read("overview") as OverviewPiece[], grounds: read("ground") as GroundPiece[] };
}

/** The ground of the map with its overviews' water and no sector held, every sample `poison` until an overview fills it. */
function staged(head: MapHead, overviews: readonly OverviewPiece[], poison = 65535): Heightfield {
  const hf = mapHeightfield(joinParts(head, overviews, false));
  hf.heights.fill(poison);
  hf.holdNone();
  return hf;
}

const fill = (hf: Heightfield, o: OverviewPiece): void => hf.fill(o.sq.cx0, o.sq.cz0, o.sq.cx1, o.sq.cz1, OVERVIEW_STEP, o.heights, o.tint);
const land = (hf: Heightfield, g: GroundPiece): void => (setGround(hf.dims, hf.heights, hf.tint, g), hf.hold(g.sq.cx0, g.sq.cz0, g.sq.cx1, g.sq.cz1));

test("a sample not yet held is its overview's: as an 8 m tile draws it, its two triangles split as the ground's, and its nearest coarse sample's tint", () => {
  const { head, overviews } = partsOf(file);
  const hf = staged(head, overviews);
  for (const o of overviews) fill(hf, o);
  // The overview's ground as a heightfield of 8 m, whose heightAt is the triangles the coarse tiles draw.
  const coarse = new Heightfield(head.dims, TERRAIN_CELL * OVERVIEW_STEP, head.minY, head.stepY, Uint16Array.from(coarseGround(whole).heights));
  let wrong = 0;
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const want = Math.round((coarse.heightAt(i * hf.cell, j * hf.cell) - head.minY) / head.stepY);
      const near = (Math.round(j / OVERVIEW_STEP) * OVERVIEW_STEP) * hf.nx + Math.round(i / OVERVIEW_STEP) * OVERVIEW_STEP;
      if (hf.heights[j * hf.nx + i] !== want || hf.tint[j * hf.nx + i] !== whole.tint[near]) wrong++;
    }
  }
  expect(wrong).toBe(0);
  // Every fourth sample is the map's own, so the whole map's picture on the card is right before any sector comes.
  expect(coarseGround(hf)).toEqual(coarseGround(whole));
  expect([hf.exact.every((e) => e === 0), hf.exactIn(0, 0, 10, 10)]).toEqual([true, false]);
});

test("sectors set in any order over the overviews' ground leave it the map's, and the record says which chunks are their own all the while", () => {
  const { head, overviews, grounds } = partsOf(file);
  for (const seed of [1, 2, 3]) {
    const rng = new Rng(seed);
    const order = [...grounds];
    for (let k = order.length - 1; k > 0; k--) {
      const r = rng.int(k + 1);
      [order[k], order[r]] = [order[r]!, order[k]!];
    }
    const hf = staged(head, overviews);
    // An overview may even come after a sector it covers: the sector's samples, its edges among them, stay its own.
    const late = overviews.slice(seed % 2);
    for (const o of overviews.slice(0, seed % 2)) fill(hf, o);
    land(hf, order[0]!);
    for (const o of late) fill(hf, o);
    const filled = Uint16Array.from(hf.heights);
    for (const g of order.slice(1)) land(hf, g);
    // Each chunk is the map's own once its sector came, and the overviews' before, but for its edges a sector held shares.
    expect([hf.heights, hf.tint, hf.exact.every((e) => e === 1)]).toEqual([whole.heights, whole.tint, true]);
    const first = order[0]!.sq;
    let moved = 0;
    for (let j = first.cz0 * PER; j <= first.cz1 * PER; j++) for (let i = first.cx0 * PER; i <= first.cx1 * PER; i++) if (filled[j * hf.nx + i] !== whole.heights[j * hf.nx + i]) moved++;
    expect([moved, hf.changes.length / 4]).toEqual([0, overviews.length + grounds.length]);
  }
});

test("a box is exact where every chunk it touches holds its own, the box held to the map", () => {
  const { head, overviews, grounds } = partsOf(file);
  const hf = staged(head, overviews);
  for (const o of overviews) fill(hf, o);
  const g = grounds.find((p) => p.sq.cx0 > 0 && p.sq.cz0 > 0)!;
  land(hf, g);
  const [x0, z0, x1, z1] = [g.sq.cx0 * CHUNK_SIZE, g.sq.cz0 * CHUNK_SIZE, g.sq.cx1 * CHUNK_SIZE, g.sq.cz1 * CHUNK_SIZE];
  expect(hf.exactIn(x0, z0, x1 - 0.01, z1 - 0.01)).toBe(true);
  expect(hf.exactIn(x0 - 0.01, z0, x1 - 0.01, z1 - 0.01)).toBe(false);
  expect(hf.exactIn(x0, z0, x1, z1 - 0.01)).toBe(g.sq.cx1 === head.dims.chunksX);
  // A whole map's ground holds all its own, off its edges too.
  expect([whole.exactIn(-500, -500, 1e6, 1e6), whole.changes.length]).toEqual([true, 0]);
  const [a, b] = [hf.exact.filter((e) => e === 1).length, (g.sq.cx1 - g.sq.cx0) * (g.sq.cz1 - g.sq.cz0)];
  expect(a).toBe(b);
});

/** `items` in an order of `seed`'s. */
function scrambled<T>(items: readonly T[], seed: number): T[] {
  const rng = new Rng(seed);
  const out = [...items];
  for (let k = out.length - 1; k > 0; k--) {
    const r = rng.int(k + 1);
    [out[k], out[r]] = [out[r]!, out[k]!];
  }
  return out;
}

/** The corner map as a client holds it with its overviews in and no sector yet, and its sectors' grounds. */
function cornerStaged(file: Uint8Array): { staged: StagedMap; grounds: GroundPiece[] } {
  const { head, overviews, grounds } = partsOf(file);
  const staged = new StagedMap(head);
  for (const o of overviews) staged.take(o);
  return { staged, grounds };
}

/** A scene of the corner map's `hf` and node `layers`: its ground, its pond and its far trees, rocks and bushes, drawn by the rasterizer every frame from over the corner. */
function cornerScene(hf: Heightfield, layers: readonly NodeLayer[]) {
  const reg = nodeRegistry();
  const pack = nodePack();
  const farNodes = { nodes: nodeLayers(hf.dims, hf, reg, layers)!, held: () => false, gone: () => undefined, changes: new NodeChanges(hf.dims), ground: hf };
  const scene = new Scene({ dims: hf.dims, hf, structs: new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), far: { cells: new FarStore(), complete: () => false }, farNodes }, reg, pack);
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 120;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.aspect] = [192, 70, 60, 0, -0.5, 4 / 3];
  const raster = new Rasterizer(160, 120, pack, hf);
  return {
    frame(): Uint8ClampedArray {
      scene.now += 1000 / 60;
      raster.render(scene.build(cam, null));
      return raster.color;
    },
  };
}

test("once every sector has come, in any order and between frames, the picture is that of the map held whole from the start: its ground's ranges, its pond and its far trees made again", () => {
  const file = writeMap(cornerMap());
  const map = parseMap(file);
  const want = cornerScene(mapHeightfield(map), map.nodes);
  const before = Uint8ClampedArray.from(want.frame());
  for (let f = 1; f < 60; f++) want.frame();
  const picture = want.frame();
  for (const seed of [4, 5]) {
    const { staged, grounds } = cornerStaged(file);
    const got = cornerScene(staged.hf, staged.nodes);
    // The overviews' ground is drawn until the sectors come, and it is not the map's own.
    expect(got.frame()).not.toEqual(before);
    const order = scrambled(grounds, seed);
    for (let f = 1; f < 60; f++) {
      if (f % 5 === 0 && order.length > 0) staged.take(order.pop()!);
      got.frame();
    }
    expect(got.frame()).toEqual(picture);
  }
});

/** A frame's allowance as the residency keeps one: `bytes` a frame. */
function allowance(bytes: number): GroundBudget & { spent: number; next(): void } {
  return {
    spent: 0,
    get left() {
      return Math.max(0, bytes - this.spent);
    },
    spend(n: number) {
      this.spent += n;
    },
    reserve() {},
    next() {
      this.spent = 0;
    },
  };
}

test("the window round the camera is filled again where its sectors come, within the frame's allowance, and is never drawn with a sample that is neither the map's own nor its overview's", () => {
  const { head, overviews, grounds } = partsOf(file);
  const hf = staged(head, overviews);
  for (const o of overviews) fill(hf, o);
  const filled = Uint16Array.from(hf.heights);
  const lod = new TerrainLod(hf);
  const size = groundSize(hf);
  const [w, h] = [size.width[SOURCE_WINDOW]!, size.height[SOURCE_WINDOW]!];
  // The card's picture of the window, which holds a sample at its own place modulo its size, filled as the shell fills it.
  const picture = new Uint16Array(w * h);
  const texel = (i: number, j: number): number => (j % h) * w + (i % w);
  const budget = allowance(1 << 20);
  const cam = new Camera();
  [cam.y, cam.pitch, cam.aspect] = [200, -0.3, 16 / 9];
  const order = scrambled(grounds, 7);
  let [corner, frames, stale] = [[0, 0], 0, 0];
  for (let f = 0; f < 400; f++) {
    budget.next();
    [cam.x, cam.z] = [600 + f * 6, 300];
    cam.update();
    if (f % 9 === 4 && order.length > 0) land(hf, order.pop()!);
    const p = new FramePacket();
    lod.select(cam, p, 4000, budget);
    expect(budget.spent).toBeLessThanOrEqual(f === 0 ? w * h * 3 : 1 << 20);
    const parts = p.groundParts;
    for (let n = 0; n < p.groundPartCount * 5; n += 5) {
      for (let r = 0; r < parts[n + 3]!; r++) picture.set(p.groundHeights.subarray(parts[n + 4]! + r * parts[n + 2]!, parts[n + 4]! + (r + 1) * parts[n + 2]!), (parts[n + 1]! + r) * w + parts[n]!);
    }
    expect(p.groundWindow[0]).toBe(0);
    corner = [p.groundWindow[1]!, p.groundWindow[2]!];
    // Each sample drawn is the map's own or the overview's.
    let wrong = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = (corner[1]! + j) * hf.nx + corner[0]! + i, v = picture[texel(corner[0]! + i, corner[1]! + j)]!;
        if (v !== whole.heights[k] && v !== filled[k]) wrong++;
      }
    }
    expect(wrong).toBe(0);
    frames++;
    let same = true;
    for (let j = 0; j < h && same; j++) for (let i = 0; i < w && same; i++) same = picture[texel(corner[0]! + i, corner[1]! + j)] === hf.heights[(corner[1]! + j) * hf.nx + corner[0]! + i];
    if (!same) stale++;
  }
  // Once every sector has come, the window drawn holds the map's own; a sector's columns go in a frame or a few.
  expect([order.length, frames, stale < 200]).toEqual([0, 400, true]);
  let off = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (picture[texel(corner[0]! + i, corner[1]! + j)] !== whole.heights[(corner[1]! + j) * hf.nx + corner[0]! + i]) off++;
  expect(off).toBe(0);
  // Its chunks' height ranges are measured again: the bound under any box is the whole map's.
  const fresh = new TerrainLod(whole);
  for (let k = 0; k < 50; k++) expect(lod.lowest(k * 90, k * 25, k * 90 + 300, k * 25 + 64)).toBe(fresh.lowest(k * 90, k * 25, k * 90 + 300, k * 25 + 64));
});

test("the map screen's tiles that show ground that came are painted again in their place, one a step", () => {
  const { head, overviews, grounds } = partsOf(file);
  const hf = staged(head, overviews);
  for (const o of overviews) fill(hf, o);
  const palette = defaultPalette();
  const tiles = new ReliefTiles(hf, palette);
  for (const [zoom, col, row] of [[0, 0, 0], [2, 1, 1], [2, 3, 1]] as const) {
    expect(tiles.tile(zoom, col, row)).toBeNull();
    tiles.step();
  }
  const kept = (zoom: number, col: number, row: number): Uint32Array => tiles.tile(zoom, col, row)!.rgba;
  const painted = (zoom: number, col: number, row: number, of: Heightfield): Uint32Array => {
    const out = new Uint32Array(256 * 256);
    paintRelief(of, palette, zoom, col, row, 256, out);
    return out;
  };
  expect(kept(0, 0, 0)).not.toEqual(painted(0, 0, 0, whole));
  for (const g of grounds) land(hf, g);
  const version = tiles.version;
  for (let k = 0; k < 3; k++) tiles.step();
  expect([tiles.version - version, tiles.held]).toEqual([3, 3]);
  for (const [zoom, col, row] of [[0, 0, 0], [2, 1, 1], [2, 3, 1]] as const) expect(kept(zoom, col, row)).toEqual(painted(zoom, col, row, whole));
  tiles.step();
  expect(tiles.version - version).toBe(3);
});

test("the ground under a body is found again at the same place once its sector has come", () => {
  const { head, overviews, grounds } = partsOf(file);
  const hf = staged(head, overviews);
  for (const o of overviews) fill(hf, o);
  const g = grounds[3]!;
  const [x, z] = [(g.sq.cx0 + 2.3) * CHUNK_SIZE, (g.sq.cz0 + 1.7) * CHUNK_SIZE];
  const under = groundUnder(hf, x, z, 0.4);
  land(hf, g);
  const [again, normal] = [groundUnder(hf, x, z, 0.4), { ...ground }];
  expect([again, normal]).toEqual([groundUnder(whole, x, z, 0.4), { ...ground }]);
  expect(again).not.toBe(under);
});

/** Every array buffer `root` reaches through its fields, arrays, maps and sets. */
function reached(root: object): Set<ArrayBufferLike> {
  const buffers = new Set<ArrayBufferLike>();
  const seen = new Set<object>();
  const todo: unknown[] = [root];
  while (todo.length > 0) {
    const v = todo.pop();
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (ArrayBuffer.isView(v)) buffers.add(v.buffer);
    else if (v instanceof Map) for (const [k, x] of v) todo.push(k, x);
    else if (v instanceof Set || Array.isArray(v)) todo.push(...v);
    else for (const k of Object.keys(v)) todo.push((v as Record<string, unknown>)[k]);
  }
  return buffers;
}

test("a sector's ground is a page of its part's own arrays, the dense one is gone, and of a listed layer's rows only those are kept", () => {
  for (const listed of [false, true]) {
    const file = writeMap(cornerMap(listed));
    const map = parseMap(file);
    const { staged, grounds } = cornerStaged(file);
    for (const g of grounds) staged.take(g);
    const held = reached(staged);
    const rows = grounds.flatMap((g) => g.listed.filter((r) => r !== null)).map((r) => r!.kind.buffer);
    expect([listed, grounds.every((g) => held.has(g.heights.buffer) && held.has(g.tint.buffer)), rows.length > 0, rows.every((b) => held.has(b)), staged.hf.heights.length]).toEqual([listed, true, listed, true, 0]);
    const chunks = map.dims.chunksX * map.dims.chunksZ, reg = nodeRegistry();
    expect([listed, denseOf(staged.hf).heights, standing(nodeLayers(map.dims, staged.hf, reg, staged.nodes)!, chunks)]).toEqual([listed, mapHeightfield(map).heights, standing(nodeLayers(map.dims, mapHeightfield(map), reg, map.nodes)!, chunks)]);
  }
});

/** Every node `source` stands, chunk by chunk and slot by slot, as its kind, form, place and turn; the ground's height left out. */
function standing(source: NodeSource, chunks: number): string[] {
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const out: string[] = [];
  for (let c = 0; c < chunks; c++) {
    for (let k = 0; k < source.perChunk; k++) {
      source.at(c, k, spot);
      if (spot.kind !== 0) out.push(`${c} ${k} ${spot.kind} ${spot.form} ${spot.x} ${spot.z} ${spot.yaw}`);
    }
  }
  return out;
}

test("before any overview the ground is the head's coarse picture as a 64 m tile draws it, the pond stands flat on it and no node stands; each overview then brings its square's ground, nodes and water, and once all have come they are the map's", () => {
  const file = writeMap(cornerMap());
  const map = parseMap(file);
  const { head, overviews } = partsOf(file);
  const staged = new StagedMap(head);
  const hf = staged.hf;
  // The coarse picture as a heightfield of 64 m, whose heightAt is the triangles a tile that coarse draws; a sample's tint the nearest corner's.
  const coarse = new Heightfield(head.dims, CHUNK_SIZE, head.minY, head.stepY, Uint16Array.from(head.coarse.heights));
  let wrong = 0;
  const got = denseOf(hf);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const want = Math.round((coarse.heightAt(i * hf.cell, j * hf.cell) - head.minY) / head.stepY);
      if (got.heights[j * hf.nx + i] !== want || got.tint[j * hf.nx + i] !== head.coarse.tint[Math.round(j / PER) * 7 + Math.round(i / PER)]) wrong++;
    }
  }
  // Most of the 64 m square round the corner in the pond's middle is under it: that corner names it and stands under its surface.
  const pond = 3 * 7 + 3;
  expect([wrong, head.coarse.bodies![pond], hf.water!.bodyAt(192, 192), hf.waterAt(192, 192), hf.heightAt(192, 192) < 7.5]).toEqual([0, 1, 1, 7.5, true]);
  // The lakes draw it from the first frame: a tile of its faces goes on the card.
  const p = new FramePacket();
  new Lakes(hf, hf.water!, 0).update(p, { spend() {}, reserve() {} }, 192, 192, 2000);
  expect(p.assetUploads.length).toBe(1);
  const reg = nodeRegistry();
  const chunks = head.dims.chunksX * head.dims.chunksZ;
  const nodes = nodeLayers(hf.dims, hf, reg, staged.nodes)!;
  const all = standing(nodeLayers(map.dims, mapHeightfield(map), reg, map.nodes)!, chunks);
  expect([standing(nodes, chunks), all.length > 100]).toEqual([[], true]);
  // Each overview, the nodes of its square's chunks and no others.
  const inside = (o: OverviewPiece) => (line: string): boolean => {
    const c = Number(line.split(" ")[0]);
    return c % 6 >= o.sq.cx0 && c % 6 < o.sq.cx1 && Math.floor(c / 6) >= o.sq.cz0 && Math.floor(c / 6) < o.sq.cz1;
  };
  const came: OverviewPiece[] = [];
  for (const o of scrambled(overviews, 8)) {
    staged.take(o);
    came.push(o);
    expect(standing(nodes, chunks)).toEqual(all.filter((line) => came.some((q) => inside(q)(line))));
  }
  // The water of every overview, its squares where the map holds them and none in a chunk the coarse picture alone reached.
  const [w, v] = [hf.water!, map.water!];
  let squares = 0;
  for (let z = 1; z < hf.sizeZ; z += 2) for (let x = 1; x < hf.sizeX; x += 2) if (w.bodyAt(x, z) !== v.bodyAt(x, z)) squares++;
  expect([squares, [...w.chunks()].filter((c) => !v.chunks().includes(c)).every((c) => w.squares.subarray(w.block[c]!, w.block[c]! + w.side * w.side).every((b) => b === 0))]).toEqual([0, true]);
  expect([...w.box]).toEqual([...v.box]);
});

test("a sector's ground that comes before its overview waits for it: none of its chunks holds its own until the overview has come, and then each does, its ground the map's", () => {
  const { head, overviews, grounds } = partsOf(file);
  const staged = new StagedMap(head);
  const g = grounds.find((p) => p.sq.cx0 > 0)!;
  const o = overviews.find((q) => q.sq.cx0 <= g.sq.cx0 && q.sq.cx1 >= g.sq.cx1)!;
  staged.take(g);
  expect([staged.hf.exact.every((e) => e === 0), staged.hf.changes.length / 4]).toEqual([true, 1]);
  staged.take(o);
  let off = 0;
  const got = denseOf(staged.hf).heights;
  for (let j = g.sq.cz0 * PER; j <= g.sq.cz1 * PER; j++) for (let i = g.sq.cx0 * PER; i <= g.sq.cx1 * PER; i++) if (got[j * whole.nx + i] !== whole.heights[j * whole.nx + i]) off++;
  const [x0, z0, x1, z1] = [g.sq.cx0 * CHUNK_SIZE, g.sq.cz0 * CHUNK_SIZE, g.sq.cx1 * CHUNK_SIZE - 0.01, g.sq.cz1 * CHUNK_SIZE - 0.01];
  // The coarse picture, the overview a band at a time, and the sector held.
  const bands = Math.ceil((o.sq.cz1 - o.sq.cz0) / BAND_CHUNKS);
  expect([off, staged.hf.exactIn(x0, z0, x1, z1), staged.hf.exact.filter((e) => e === 1).length, staged.hf.changes.length / 4]).toEqual([0, true, (g.sq.cx1 - g.sq.cx0) * (g.sq.cz1 - g.sq.cz0), 2 + bands]);
});

test("the whole map's pair on the card, made once and sent again where a fill changed the ground, is at every step what a picture made then would be, and the map's own once the overviews have come", () => {
  const { head, overviews, grounds } = partsOf(file);
  const staged = new StagedMap(head);
  const hf = staged.hf;
  const card = coarseGround(hf);
  const across = groundSize(hf).width[0]!;
  let seen = hf.changes.length;
  let sent = 0;
  // A sector's hold changes no sample the pair takes: its overview had set every one of them as the map's own.
  expect(COARSE % OVERVIEW_STEP).toBe(0);
  for (const piece of scrambled([...overviews, ...grounds], 9)) {
    staged.take(piece);
    for (const c = hf.changes; seen < c.length; seen += 4) {
      if (!hf.filled[seen / 4]) continue;
      const a = coarseArea(hf, c[seen]!, c[seen + 1]!, c[seen + 2]!, c[seen + 3]!);
      for (let r = 0; r < a.h; r++) {
        card.heights.set(a.heights.subarray(r * a.w, (r + 1) * a.w), (a.j + r) * across + a.i);
        card.tint.set(a.tint.subarray(r * a.w, (r + 1) * a.w), (a.j + r) * across + a.i);
      }
      sent += a.w * a.h;
    }
    expect(card).toEqual(coarseGround(hf));
  }
  // The overviews' squares a band at a time, a row two bands share sent with each, and none of the sectors'.
  const bands = (p: { sq: { cz0: number; cz1: number } }): number[] => Array.from({ length: Math.ceil((p.sq.cz1 - p.sq.cz0) / BAND_CHUNKS) }, (_, k) => Math.min(BAND_CHUNKS, p.sq.cz1 - p.sq.cz0 - k * BAND_CHUNKS));
  expect([card, sent]).toEqual([coarseGround(whole), overviews.reduce((n, p) => n + bands(p).reduce((m, rows) => m + ((p.sq.cx1 - p.sq.cx0) * 8 + 1) * (rows * 8 + 1), 0), 0)]);
});

/** Each chunk's lowest and highest sample, edges among them, in stored steps. */
function ranges(hf: Heightfield): Uint16Array {
  const { chunksX, chunksZ } = hf.dims, out = new Uint16Array(chunksX * chunksZ * 2), heights = denseOf(hf).heights;
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      let [a, b] = [65535, 0];
      for (let j = cz * PER; j <= cz * PER + PER; j++) for (let i = cx * PER; i <= cx * PER + PER; i++) [a, b] = [Math.min(a, heights[j * hf.nx + i]!), Math.max(b, heights[j * hf.nx + i]!)];
      [out[(cz * chunksX + cx) * 2], out[(cz * chunksX + cx) * 2 + 1]] = [a, b];
    }
  }
  return out;
}

test("a staged map's chunk bounds hold every sample at every step, with no scan of the map, and are its own once its overview came", () => {
  const { head, overviews, grounds } = partsOf(file);
  const own = ranges(whole);
  for (const seed of [10, 11, 12]) {
    const staged = new StagedMap(head);
    const hf = staged.hf, bounds = hf.bounds!;
    const lod = new TerrainLod(hf);
    const came = new Set<OverviewPiece>();
    const under = (c: number): boolean => [...came].some((o) => c % hf.dims.chunksX >= o.sq.cx0 && c % hf.dims.chunksX < o.sq.cx1 && Math.floor(c / hf.dims.chunksX) >= o.sq.cz0 && Math.floor(c / hf.dims.chunksX) < o.sq.cz1);
    const steps = scrambled([...overviews, ...grounds], seed);
    for (let k = 0; k <= steps.length; k++) {
      if (k > 0) staged.take(steps[k - 1]!);
      if (k > 0 && steps[k - 1]!.kind === "overview") came.add(steps[k - 1] as OverviewPiece);
      const now = ranges(hf);
      let loose = 0, wrong = 0;
      for (let c = 0; c < now.length / 2; c++) {
        if (now[c * 2]! < bounds[c * 2]! || now[c * 2 + 1]! > bounds[c * 2 + 1]!) loose++;
        if (under(c) && (bounds[c * 2] !== own[c * 2] || bounds[c * 2 + 1] !== own[c * 2 + 1])) wrong++;
      }
      expect([seed, k, loose, wrong]).toEqual([seed, k, 0, 0]);
    }
    // The tiles' boxes, read from the bounds, are those measured from the whole map's samples.
    const p = new FramePacket(), cam = new Camera();
    lod.select(cam, p, 100);
    const fresh = new TerrainLod(whole);
    for (let k = 0; k < 50; k++) expect(lod.lowest(k * 90, k * 25, k * 90 + 300, k * 25 + 64)).toBe(fresh.lowest(k * 90, k * 25, k * 90 + 300, k * 25 + 64));
  }
});

test("an overview let go a band a step stands in with the coarse picture, its water and nodes gone; taken again it is as before", () => {
  const file = writeMap(cornerMap());
  const { head, overviews } = partsOf(file);
  const staged = new StagedMap(head), bare = new StagedMap(head), reg = nodeRegistry();
  const o = overviews.find((q) => q.sq.cx0 === 0 && q.sq.cz0 === 0)!;
  const g = partsOf(file).grounds.find((q) => q.sq.cx0 === 0 && q.sq.cz0 === 0)!;
  for (const q of overviews) staged.take(q);
  staged.take(g);
  const [held, nodes, water] = [denseOf(staged.hf), nodesOf(staged.hf, reg, staged.nodes), [...staged.hf.water!.squares]];
  const seen = staged.hf.changes.length;
  let steps = 0;
  for (const s = staged.release(o.sq.col, o.sq.row); !s.next().done; ) steps++;
  const bands = Math.ceil((o.sq.cz1 - o.sq.cz0) / BAND_CHUNKS);
  // Its sector's page stays; every other sample of it is the coarse picture's, as a map with no overview has it.
  const now = denseOf(staged.hf), coarse = denseOf(bare.hf), page = (k: number): boolean => k % staged.hf.nx <= g.sq.cx1 * PER && Math.floor(k / staged.hf.nx) <= g.sq.cz1 * PER;
  let wrong = 0;
  for (let k = 0; k < now.heights.length; k++) if (Math.floor(k / staged.hf.nx) < o.sq.cz1 * PER && k % staged.hf.nx < o.sq.cx1 * PER && now.heights[k] !== (page(k) ? held.heights[k] : coarse.heights[k])) wrong++;
  expect([steps, (staged.hf.changes.length - seen) / 4, staged.hf.filled.slice(seen / 4).every((f) => f), wrong]).toEqual([bands - 1, bands, true, 0]);
  let wet = 0;
  for (let z = 1; z < o.sq.cz1 * CHUNK_SIZE; z += 2) for (let x = 1; x < o.sq.cx1 * CHUNK_SIZE; x += 2) if (staged.hf.water!.bodyAt(x, z) !== bare.hf.water!.bodyAt(x, z)) wet++;
  expect([wet, nodesOf(staged.hf, reg, staged.nodes).length < nodes.length]).toEqual([0, true]);
  staged.take(o);
  expect([denseOf(staged.hf), nodesOf(staged.hf, reg, staged.nodes), [...staged.hf.water!.squares]]).toEqual([held, nodes, water]);
});

test("each band of an overview carries its chunks' own bounds when its change is taken", () => {
  const { head, overviews } = partsOf(file);
  const own = ranges(whole), staged = new StagedMap(head), hf = staged.hf, bounds = hf.bounds!, w = head.dims.chunksX;
  for (const o of overviews) {
    const g = staged.steps(o);
    let bands = 0;
    for (let done = false; !done; ) {
      done = g.next().done === true;
      const c = hf.changes, at = c.length - 4;
      let wrong = 0;
      for (let cz = c[at + 1]!; cz < c[at + 3]!; cz++) for (let cx = c[at]!; cx < c[at + 2]!; cx++) if (bounds[(cz * w + cx) * 2] !== own[(cz * w + cx) * 2] || bounds[(cz * w + cx) * 2 + 1] !== own[(cz * w + cx) * 2 + 1]) wrong++;
      expect([bands++, wrong]).toEqual([bands - 1, 0]);
    }
    expect(bands).toBe(Math.ceil((o.sq.cz1 - o.sq.cz0) / BAND_CHUNKS));
  }
});

test("lakes drawn while an overview comes a band a frame end as those drawn after it came", () => {
  const { head, overviews } = partsOf(file);
  const staged = new StagedMap(head), hf = staged.hf;
  const lakes = new Lakes(hf, hf.water!, 0), budget = { spend() {}, reserve() {} };
  const live = new Map<number, Uint8Array>();
  const frame = (l: Lakes, into: Map<number, Uint8Array>): void => {
    const p = new FramePacket();
    l.update(p, budget, 2000, 600, 1e5);
    for (const s of p.assetDrops) into.delete(s);
    for (const u of p.assetUploads) into.set(u.slot, u.data);
  };
  frame(lakes, live);
  for (const o of overviews) for (const g = staged.steps(o); ; ) {
    frame(lakes, live);
    if (g.next().done) break;
  }
  // One tile is made again a frame, so enough frames for every tile.
  for (let k = 0; k < 64; k++) frame(lakes, live);
  const fresh = new Map<number, Uint8Array>();
  frame(new Lakes(hf, hf.water!, 0), fresh);
  const sorted = (m: Map<number, Uint8Array>): string[] => [...m.values()].map((d) => Buffer.from(d).toString("base64")).sort();
  expect([live.size > 0, sorted(live)]).toEqual([true, sorted(fresh)]);
});

/** The water `staged` holds, and one made fresh from its squares: its block, its bodies' boxes and its squares. */
const waterNow = (staged: StagedMap): unknown[] => {
  const w = staged.hf.water!, fresh = new MapWater(w.dims, staged.head.minY, staged.head.stepY, w.cell, w.bodies, w.chunks(), w.squares.slice());
  return [[...w.block], [...w.box], [...w.squares], [...fresh.block], [...fresh.box]];
};

test("after any run of overviews taken and let go, the water is one made fresh over the same overviews", () => {
  for (const map of [cornerMap(), wideMap()]) {
    const { head, overviews } = partsOf(writeMap(map));
    const staged = new StagedMap(head), rng = new Rng(17);
    const held = new Set<OverviewPiece>();
    for (let step = 0; step < 24; step++) {
      const o = overviews[rng.int(overviews.length)]!;
      if (held.has(o)) for (const s = staged.release(o.sq.col, o.sq.row); !s.next().done; );
      else staged.take(o);
      if (held.has(o)) held.delete(o);
      else held.add(o);
      const again = new StagedMap(head);
      for (const q of overviews) if (held.has(q)) again.take(q);
      const [now, alone] = [waterNow(staged), waterNow(again)];
      expect([step, now[1], now[2]]).toEqual([step, now[4], alone[2]]);
      expect(now[0]).toEqual(now[3]);
    }
  }
});

test("an overview with no water does no work on the water, and one with some only its own chunks", () => {
  const map = wideMap(), w = map.water!;
  // Water in the east overview alone: the west one is the map's first 8 chunk columns.
  const grid = new Uint16Array(560 * 160);
  for (let j = 30; j < 70; j++) for (let i = 80; i < 540; i += 3) grid[j * 560 + i] = 1 + (i % 2);
  const dry = { ...map, water: MapWater.fromGrid(map.dims, map.minY, map.stepY, w.cell, w.bodies, grid) };
  const { head, overviews } = partsOf(writeMap(dry));
  const staged = new StagedMap(head), waters = staged.waters!, before = staged.hf.water;
  const west = overviews.find((o) => o.sq.cx0 === 0)!, east = overviews.find((o) => o.sq.cx0 > 0)!;
  staged.take(west);
  expect([waters.visited, staged.hf.water]).toEqual([0, before]);
  staged.take(east);
  const side = CHUNK_SIZE / w.cell;
  expect(waters.visited).toBe(staged.hf.water!.chunks().length * side * side);
});
