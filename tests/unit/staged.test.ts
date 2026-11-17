// A client's ground as it comes a part at a time (shared/world/heightfield.ts): every sample filled from its overview, then
// each sector's own set over it, in any order, with a record of which chunks hold their own.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { FramePacket, SOURCE_WINDOW } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { TerrainLod, coarseGround, groundSize, type GroundBudget } from "../../client/core/render/terrain.ts";
import { ReliefTiles, paintRelief } from "../../client/core/tactical.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { ground, groundUnder } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, joinParts, mapHeightfield, nodeLayers, parseMap, readHead, readPart, setGround, writeMap, type GroundPiece, type MapHead, type NodeLayer, type OverviewPiece } from "../../shared/world/mapfile.ts";
import { StagedMap } from "../../client/core/mapload.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { cornerMap, wideMap } from "../fixtures/map.ts";
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
  staged.settle();
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
  // The card's two copies of the window, filled from the heightfield as the shell fills them.
  const copies = [new Uint16Array(w * h), new Uint16Array(w * h)];
  const budget = allowance(1 << 20);
  const cam = new Camera();
  [cam.y, cam.pitch, cam.aspect] = [200, -0.3, 16 / 9];
  const order = scrambled(grounds, 7);
  let [drawn, corner, frames, stale] = [-1, [0, 0], 0, 0];
  for (let f = 0; f < 400; f++) {
    budget.next();
    [cam.x, cam.z] = [600 + f * 6, 300];
    cam.update();
    if (f % 9 === 4 && order.length > 0) land(hf, order.pop()!);
    const p = new FramePacket();
    lod.select(cam, p, 4000, budget);
    const [d, wi, wj, copy, fi, fj, row, rows] = p.groundWindow;
    expect(budget.spent).toBeLessThanOrEqual(f === 0 ? w * h * 3 : 1 << 20);
    for (let r = row!; copy! >= 0 && r < row! + rows!; r++) copies[copy!]!.set(hf.heights.subarray((fj! + r) * hf.nx + fi!, (fj! + r) * hf.nx + fi! + w), r * w);
    [drawn, corner] = [d!, [wi!, wj!]];
    // Each sample drawn is the map's own or the overview's.
    let wrong = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = (corner[1]! + j) * hf.nx + corner[0]! + i, v = copies[drawn]![j * w + i]!;
        if (v !== whole.heights[k] && v !== filled[k]) wrong++;
      }
    }
    expect(wrong).toBe(0);
    frames++;
    let same = true;
    for (let j = 0; j < h && same; j++) for (let i = 0; i < w && same; i++) same = copies[drawn]![j * w + i] === hf.heights[(corner[1]! + j) * hf.nx + corner[0]! + i];
    if (!same) stale++;
  }
  // Once every sector has come, the window drawn holds the map's own; it was behind it for a few frames at a time.
  expect([order.length, frames, stale > 0, stale < 200]).toEqual([0, 400, true, true]);
  let off = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (copies[drawn]![j * w + i] !== whole.heights[(corner[1]! + j) * hf.nx + corner[0]! + i]) off++;
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
