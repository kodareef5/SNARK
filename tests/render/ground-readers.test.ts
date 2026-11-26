// The page's readers of the ground reach its samples only through the heightfield's views and methods, so ground held
// in pieces gives the answers the dense array gives (planning/workstreams/maps-v3.md, phase 6). PagedGround's own arrays
// are noise: a reader of them would differ.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { dustColour, groundAt as dustGround } from "../../client/core/details/ground.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { farPart } from "../../client/core/render/far.ts";
import { FinishNear } from "../../client/core/render/finish-near.ts";
import { Lakes } from "../../client/core/render/lakes.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { overGround } from "../../client/core/render/skyopen.ts";
import { COARSE, TerrainLod, coarseArea, coarseGround, groundNormal, groundSize, groundTint, tilePicture, type GroundBudget } from "../../client/core/render/terrain.ts";
import { seaBank, seaDepth, seaFrame } from "../../client/core/render/water.ts";
import { groundAt as stepGround, paved } from "../../client/core/sound/ground.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { paintRelief } from "../../shared/world/relief.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { FarCells } from "../../shared/world/tactical.ts";
import { farWorld } from "../fixtures/farworld.ts";
import { LAKES, lakesMap, lakesWater } from "../fixtures/lakes.ts";
import { PagedGround } from "../fixtures/paged-ground.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** Hills with every sample's tint its own, the sea at 0 over part of them. */
function hills(chunks: number): Heightfield {
  const hf = new Heightfield({ chunksX: chunks, chunksZ: chunks }, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      hf.setSample(i, j, 30 * Math.sin(i / 70) * Math.cos(j / 50) + 3 * Math.sin(i / 3 + j / 5));
      hf.tint[j * hf.nx + i] = (i * 31 + j * 17) & 255;
    }
  }
  hf.seaLevel = 0;
  return hf;
}

const unbounded: GroundBudget = { left: Infinity, spend() {}, reserve() {} };

function camera(x: number, z: number, hf: Heightfield, yaw: number): Camera {
  const cam = new Camera();
  [cam.x, cam.z, cam.y, cam.yaw, cam.pitch, cam.aspect] = [x, z, hf.heightAt(x, z) + 20, yaw, -0.2, 16 / 9];
  cam.split = tierOf("medium").split;
  cam.update();
  return cam;
}

/** A hash of a run of samples. */
function hash(a: ArrayLike<number>, from: number, to: number): number {
  let h = 2166136261;
  for (let k = from; k < to; k++) h = Math.imul(h ^ a[k]!, 16777619);
  return h >>> 0;
}

/** What the terrain hands the card in a frame: its tiles, its window, and the samples of each rectangle it puts. */
function handed(p: FramePacket): number[] {
  const out = [p.tileCount, hash(p.tiles, 0, p.tileCount * 4), hash(p.tileSource, 0, p.tileCount * 4), ...p.groundWindow];
  for (let n = 0; n < p.groundPartCount; n++) {
    const [cols, rows, at] = [p.groundParts[n * 5 + 2]!, p.groundParts[n * 5 + 3]!, p.groundParts[n * 5 + 4]!];
    out.push(...p.groundParts.subarray(n * 5, n * 5 + 5), hash(p.groundHeights, at, at + cols * rows), hash(p.groundTint, at, at + cols * rows));
  }
  return out;
}

test("the terrain's pictures, window, bounds, normals and covers are the dense ones on paged ground", () => {
  const dense = hills(48), paged = new PagedGround(dense);
  expect(coarseGround(paged)).toEqual(coarseGround(dense));
  expect(coarseArea(paged, 5, 7, 20, 11)).toEqual(coarseArea(dense, 5, 7, 20, 11));
  const [a, b] = [new TerrainLod(dense), new TerrainLod(paged)];
  const size = groundSize(dense), picture = { i: 0, j: 0, step: 1, lastI: 0, lastJ: 0 };
  const [n1, n2] = [new Float64Array(3), new Float64Array(3)];
  const rng = new Rng(11);
  let [frames, checked] = [0, 0];
  for (let f = 0; f < 40; f++) {
    const [x, z] = f === 20 ? [2900, 2800] : [600 + f * 40, 700 + f * 35];
    const budget: GroundBudget = { left: 1 << 20, spend() {}, reserve() {} };
    const [p, q] = [new FramePacket(), new FramePacket()];
    a.select(camera(x, z, dense, f * 0.3), p, 3000, f % 3 === 0 ? unbounded : budget);
    b.select(camera(x, z, dense, f * 0.3), q, 3000, f % 3 === 0 ? unbounded : budget);
    expect(handed(q)).toEqual(handed(p));
    frames++;
    for (let t = 0; t < p.tileCount; t += 7) {
      tilePicture(p, t, size, picture);
      const stride = p.tiles[t * 4 + 3]!;
      for (let k = 0; k < 6; k++) {
        const i = Math.min(p.tileOrigin[t * 2]! + rng.int(33) * stride, dense.nx - 1), j = Math.min(p.tileOrigin[t * 2 + 1]! + rng.int(33) * stride, dense.nz - 1);
        groundNormal(dense, picture, i, j, stride, n1, 0);
        groundNormal(paged, picture, i, j, stride, n2, 0);
        expect([...n2]).toEqual([...n1]);
        const [gx, gz] = [p.tileOrigin[t * 2]! * dense.cell + rng.range(0, 32 * p.tiles[t * 4 + 2]!), p.tileOrigin[t * 2 + 1]! * dense.cell + rng.range(0, 32 * p.tiles[t * 4 + 2]!)];
        const foot = rng.range(0, 1);
        expect(groundTint(paged, picture, gx, gz, foot)).toBe(groundTint(dense, picture, gx, gz, foot));
        checked++;
      }
    }
  }
  for (let k = 0; k < 40; k++) {
    const [x, z] = [rng.range(0, dense.sizeX - 300), rng.range(0, dense.sizeZ - 300)];
    expect(b.lowest(x, z, x + 300, z + 200)).toBe(a.lowest(x, z, x + 300, z + 200));
  }
  expect([frames, checked > 500, paged.views > 1000]).toEqual([40, true, true]);
});

test("the sea's depth and bank and a point's height over the ground read the same on paged ground", () => {
  const dense = hills(48), paged = new PagedGround(dense);
  const lod = new TerrainLod(dense), p = new FramePacket(), cam = camera(1500, 1400, dense, 0.4);
  lod.select(cam, p, 3000);
  const size = groundSize(dense);
  seaFrame(p.frame, dense, size, p.groundWindow, cam.x, cam.z, 0, cam.y);
  p.frame[FRAME.farScale] = 0.25;
  const rng = new Rng(8);
  const bank = (hf: Heightfield, rx: number, rz: number): number[] => Object.values(seaBank(p.frame, hf, size, p.groundWindow, rx, rz, -cam.y, 1, { soft: 0, built: 0, still: 0, muddy: 0, grade: 0 }));
  for (let k = 0; k < 3000; k++) {
    const [rx, rz] = [rng.range(-2500, 2500), rng.range(-2500, 2500)];
    const [s1, s2]: number[][] = [[], []];
    expect(seaDepth(p.frame, paged, size, p.groundWindow, rx, rz, undefined, s2)).toBe(seaDepth(p.frame, dense, size, p.groundWindow, rx, rz, undefined, s1));
    expect(s2).toEqual(s1);
    expect(bank(paged, rx, rz)).toEqual(bank(dense, rx, rz));
    expect(overGround(paged, COARSE, p.frame, cam.y, rx, 0, rz)).toBe(overGround(dense, COARSE, p.frame, cam.y, rx, 0, rz));
  }
});

test("footsteps, dust and the map screen read the same tints on paged ground", () => {
  const dense = hills(16), paged = new PagedGround(dense);
  const palette = defaultPalette();
  const rng = new Rng(2);
  for (let k = 0; k < 4000; k++) {
    const [x, z] = [rng.range(-5, dense.sizeX + 5), rng.range(-5, dense.sizeZ + 5)];
    const y = dense.heightAt(x, z) + rng.range(-0.5, 0.6);
    expect([paved(paged, x, z), stepGround(paged, x, y, z), dustGround(paged, x, y, z)]).toEqual([paved(dense, x, z), stepGround(dense, x, y, z), dustGround(dense, x, y, z)]);
    const [c1, c2] = [[0, 0, 0], [0, 0, 0]];
    expect(dustColour(paged, palette, dustGround(dense, x, y, z), x, z, c2)).toBe(dustColour(dense, palette, dustGround(dense, x, y, z), x, z, c1));
    expect(c2).toEqual(c1);
  }
  for (const [zoom, col, row] of [[0, 0, 0], [1, 1, 0], [2, 1, 2]] as const) {
    const [t1, t2] = [new Uint32Array(64 * 64), new Uint32Array(64 * 64)];
    paintRelief(dense, palette, zoom, col, row, 64, t1);
    paintRelief(paged, palette, zoom, col, row, 64, t2);
    expect(t2).toEqual(t1);
  }
});

test("the lakes' tiles, the far blocks' feet and the finishes' look are the same on paged ground", () => {
  const m = lakesMap();
  const dense = new Heightfield(m.dims, TERRAIN_CELL, m.minY, m.stepY, m.heights, m.tint);
  dense.seaLevel = LAKES.sea;
  dense.water = lakesWater();
  const paged = new PagedGround(dense);
  const tiles = (hf: Heightfield): Uint8Array[] => {
    const p = new FramePacket();
    new Lakes(hf, hf.water!, 0).update(p, unbounded, 128, 128, 1e5);
    return p.assetUploads.map((u) => u.data);
  };
  const made = tiles(dense);
  expect(made.length).toBeGreaterThan(0);
  expect(tiles(paged)).toEqual(made);

  const hilly = hills(8), pieces = new PagedGround(hilly), rng = new Rng(3);
  for (let n = 0; n < 60; n++) {
    const cells = new FarCells();
    const c = rng.int(256);
    cells.top[c] = 1 + rng.int(200);
    cells.tint[c] = 9;
    const [cx, cz] = [rng.int(8), rng.int(8)];
    expect(farPart(cells, cx * CHUNK_SIZE, cz * CHUNK_SIZE, 0, 0, pieces).pos).toEqual(farPart(cells, cx * CHUNK_SIZE, cz * CHUNK_SIZE, 0, 0, hilly).pos);
  }

  const reg = coreRegistry(), store = new StructureStore(hilly.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const [near, far] = [new FinishNear(reg, false), new FinishNear(reg, false)];
  for (let f = 0; f < 12; f++) {
    near.update(200 + f * 3, 2, 230, hilly, store, 514, 2);
    far.update(200 + f * 3, 2, 230, pieces, store, 514, 2);
  }
  expect(far.stats.looks).toBeGreaterThan(0);
  expect([...far.metres]).toEqual([...near.metres]);
});

test("a scene drawn from paged ground hands the card and the rasterizer what the dense ground does", () => {
  const ground = (x: number, z: number): number => 25 * Math.sin(x / 90) * Math.cos(z / 70) + 2 * Math.sin(x / 7);
  const tint = (x: number, z: number): number => (Math.floor(x / 6) * 7 + Math.floor(z / 10) * 3) & 255;
  const [w, v] = [farWorld({ chunks: 24, ground, tint }), farWorld({ chunks: 24, ground, tint, paged: true })];
  for (const k of [0, 1, 2]) {
    for (const s of [w, v]) s.look(700 + k * 200, 10, 760, 140, 0.6 + k, 12);
    const [p, q] = [w.frame(true), v.frame(true)];
    expect(handed(q)).toEqual(handed(p));
    expect(v.raster.color).toEqual(w.raster.color);
  }
});

test("a scene drawn from ground pages, every sector held, hands the card and the rasterizer what dense ground does", () => {
  const ground = (x: number, z: number): number => 25 * Math.sin(x / 90) * Math.cos(z / 70) + 2 * Math.sin(x / 7);
  const tint = (x: number, z: number): number => (Math.floor(x / 6) * 7 + Math.floor(z / 10) * 3) & 255;
  const [w, v] = [farWorld({ chunks: 40, ground, tint }), farWorld({ chunks: 40, ground, tint, paged: "pages" })];
  for (const k of [0, 1, 2]) {
    for (const s of [w, v]) s.look(980 + k * 200, 10, 1040, 140, 0.6 + k, 12);
    const [p, q] = [w.frame(true), v.frame(true)];
    expect(handed(q)).toEqual(handed(p));
    expect(v.raster.color).toEqual(w.raster.color);
  }
});
