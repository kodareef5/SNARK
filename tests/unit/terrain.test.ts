// The terrain's pictures (D253): the whole map at every fourth sample and a window round the camera. A twin of what
// the shell does with them, the rows it copies and the vertex fetch of the pinned terrain text, gives every tile the
// map's own samples, and the lit texts' normal and cover the rasterizer's; fine tiles never read past their window; the
// window follows within the upload allowance. A tile's mesh puts its ground before its skirts, which the shell draws
// behind it.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FramePacket, PASS_FAR, PASS_NEAR, SOURCE_MAP, SOURCE_WINDOW, TILE_QUADS } from "../../client/core/render/packet.ts";
import { COARSE, TerrainLod, WINDOW, WINDOW_MOVE, coarseGround, groundNormal, groundSize, groundTint, tileMesh, tilePicture, type GroundBudget } from "../../client/core/render/terrain.ts";
import { groundCover, groundWander } from "../../client/core/render/world-surfaces.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";

const MB = 1 << 20;

/** A square map `chunks` a side of rough ground 30 m deep, each sample's height and tint unlike its neighbours', so a sample read from the wrong place shows. */
function rough(chunks: number): Heightfield {
  const hf = new Heightfield({ chunksX: chunks, chunksZ: chunks }, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      hf.heights[j * hf.nx + i] = 4000 + (((i * 37) ^ (j * 91)) % 2000);
      hf.tint[j * hf.nx + i] = (i * 31 + j * 17) & 255;
    }
  }
  return hf;
}

/** A frame's allowance as the residency keeps one: `bytes` a frame, and what was reserved. */
function allowance(bytes: number): GroundBudget & { spent: number; reserved: Map<string, number>; next(): void } {
  return {
    spent: 0,
    reserved: new Map(),
    get left() {
      return Math.max(0, bytes - this.spent);
    },
    spend(n: number) {
      this.spent += n;
    },
    reserve(name: string, n: number) {
      this.reserved.set(name, n);
    },
    next() {
      this.spent = 0;
    },
  };
}

/** The shell's pictures as it fills them: the whole map's pair, and two copies of the window's into which it copies rows of the heightfield. */
class Twin {
  readonly hf: Heightfield;
  readonly size;
  readonly coarse;
  readonly heights: Uint16Array[];
  readonly tint: Uint8Array[];
  drawn = -1;

  constructor(hf: Heightfield) {
    this.hf = hf;
    this.size = groundSize(hf);
    this.coarse = coarseGround(hf);
    const n = this.size.width[SOURCE_WINDOW]! * this.size.height[SOURCE_WINDOW]!;
    this.heights = [new Uint16Array(n), new Uint16Array(n)];
    this.tint = [new Uint8Array(n), new Uint8Array(n)];
  }

  /** gl.ts draw(): rows `row` to `row + rows` of copy `copy`, from the heightfield with a row length of its width, starting at the corner's row and column. */
  take(p: FramePacket): void {
    const [drawn, , , copy, i, j, row, rows] = p.groundWindow;
    const w = this.size.width[SOURCE_WINDOW]!;
    for (let r = row; copy >= 0 && r < row + rows; r++) {
      const from = (j + r) * this.hf.nx + i;
      this.heights[copy]!.set(this.hf.heights.subarray(from, from + w), r * w);
      this.tint[copy]!.set(this.hf.tint.subarray(from, from + w), r * w);
    }
    this.drawn = drawn;
  }

  /** FLAT_TERRAIN_VERTEX's fetch of grid point (gx, gz) of tile `t`, as gl.ts step() feeds it: camera-relative x, height and z, and the tint. */
  vertex(p: FramePacket, t: number, gx: number, gz: number): number[] {
    const source = p.tileSource[t * 4 + 3]!;
    const [oi, oj, stride] = [p.tileSource[t * 4]!, p.tileSource[t * 4 + 1]!, p.tileSource[t * 4 + 2]!];
    const [w, h] = [this.size.width[source]!, this.size.height[source]!];
    const i = Math.min(oi + gx * stride, w - 1);
    const j = Math.min(oj + gz * stride, h - 1);
    const heights = source === SOURCE_MAP ? this.coarse.heights : this.heights[this.drawn]!;
    const tint = source === SOURCE_MAP ? this.coarse.tint : this.tint[this.drawn]!;
    const hf = this.hf;
    const cell = this.size.cell[source]!;
    return [p.tiles[t * 4]! + (i - oi) * cell, hf.minY + heights[j * w + i]! * hf.stepY - p.camY, p.tiles[t * 4 + 1]! + (j - oj) * cell, tint[j * w + i]!];
  }

  /**
   * LIT_TERRAIN_VERTEX's normal at grid point (gx, gz) of tile `t`: the heights a stride either side in the picture's
   * own samples, held to the picture, and whether one was held.
   */
  normal(p: FramePacket, t: number, gx: number, gz: number): { n: number[]; held: boolean } {
    const source = p.tileSource[t * 4 + 3]!;
    const [oi, oj, stride] = [p.tileSource[t * 4]!, p.tileSource[t * 4 + 1]!, p.tileSource[t * 4 + 2]!];
    const [w, h] = [this.size.width[source]!, this.size.height[source]!];
    const heights = source === SOURCE_MAP ? this.coarse.heights : this.heights[this.drawn]!;
    const cell = this.size.cell[source]!;
    const [i, j] = [Math.min(oi + gx * stride, w - 1), Math.min(oj + gz * stride, h - 1)];
    const [l, r, b, f] = [Math.max(i - stride, 0), Math.min(i + stride, w - 1), Math.max(j - stride, 0), Math.min(j + stride, h - 1)];
    const x = ((heights[j * w + r]! - heights[j * w + l]!) * this.hf.stepY) / ((r - l) * cell);
    const z = ((heights[f * w + i]! - heights[b * w + i]!) * this.hf.stepY) / ((f - b) * cell);
    const n = Math.hypot(x, 1, z);
    return { n: [-x / n, 1 / n, -z / n], held: r - l < 2 * stride || f - b < 2 * stride };
  }

  /**
   * LIT_TERRAIN_FRAGMENT's cover at (u, v) metres into tile `t`, ground point (x, z), a pixel `footprint` metres wide:
   * where the vertex text puts the point in the picture, moved by the wander, and the four samples round it there.
   */
  cover(p: FramePacket, t: number, u: number, v: number, x: number, z: number, footprint: number): number {
    const source = p.tileSource[t * 4 + 3]!;
    const [w, h, cell] = [this.size.width[source]!, this.size.height[source]!, this.size.cell[source]!];
    const tint = source === SOURCE_MAP ? this.coarse.tint : this.tint[this.drawn]!;
    const wander = new Float64Array(2);
    groundWander(x, z, footprint, wander);
    const s = Math.min(Math.max(p.tileSource[t * 4]! + u / cell + wander[0]! / cell, 0), w - 1);
    const r = Math.min(Math.max(p.tileSource[t * 4 + 1]! + v / cell + wander[1]! / cell, 0), h - 1);
    const [i, j] = [Math.min(Math.floor(s), w - 2), Math.min(Math.floor(r), h - 2)];
    return groundCover(tint[j * w + i]!, tint[j * w + i + 1]!, tint[(j + 1) * w + i]!, tint[(j + 1) * w + i + 1]!, s - i, r - j);
  }
}

/** The map's own sample under grid point (gx, gz) of tile `t`, as the rasterizer reads it from the tile's corner and stride. */
function truth(hf: Heightfield, p: FramePacket, t: number, gx: number, gz: number): number[] {
  const stride = p.tiles[t * 4 + 3]!;
  const i = Math.min(p.tileOrigin[t * 2]! + gx * stride, hf.nx - 1);
  const j = Math.min(p.tileOrigin[t * 2 + 1]! + gz * stride, hf.nz - 1);
  return [i * hf.cell - p.camX, hf.sample(i, j) - p.camY, j * hf.cell - p.camZ, hf.tint[j * hf.nx + i]!];
}

function camera(x: number, z: number, hf: Heightfield, yaw = 0): Camera {
  const cam = new Camera();
  [cam.x, cam.z, cam.y, cam.yaw, cam.pitch, cam.aspect] = [x, z, hf.heightAt(x, z) + 30, yaw, -0.2, 16 / 9];
  cam.split = tierOf("medium").split;
  cam.update();
  return cam;
}

function frame(lod: TerrainLod, cam: Camera, budget?: GroundBudget, view = 4000): FramePacket {
  const p = new FramePacket();
  [p.camX, p.camY, p.camZ] = [cam.x, cam.y, cam.z];
  lod.select(cam, p, view, budget);
  return p;
}

/** Whether every sample a SOURCE_WINDOW tile reads lies inside the window it reads, and every other tile reads the whole map's pair. */
function placed(hf: Heightfield, p: FramePacket): boolean {
  const { width, height } = groundSize(hf);
  for (let t = 0; t < p.tileCount; t++) {
    const stride = p.tiles[t * 4 + 3]!;
    const [i0, j0] = [p.tileOrigin[t * 2]!, p.tileOrigin[t * 2 + 1]!];
    const span = stride * TILE_QUADS;
    if (p.tileSource[t * 4 + 3] === SOURCE_MAP) {
      if (stride % COARSE !== 0 || p.tileSource[t * 4] * COARSE !== i0) return false;
      continue;
    }
    const [drawn, wi, wj] = p.groundWindow;
    if (drawn < 0 || stride >= COARSE || i0 < wi || j0 < wj) return false;
    if (Math.min(i0 + span, hf.nx - 1) >= wi + width[SOURCE_WINDOW]! || Math.min(j0 + span, hf.nz - 1) >= wj + height[SOURCE_WINDOW]!) return false;
  }
  return true;
}

test("the shell's fetch, twinned, gives every vertex of every tile the map's height and tint and the lit tiers' normal and cover, from either pair, over tile lists split in two ranges and a refill", () => {
  const hf = rough(48);
  const lod = new TerrainLod(hf);
  const twin = new Twin(hf);
  const budget = allowance(1 * MB);
  const off: string[] = [];
  const size = groundSize(hf);
  const picture = { i: 0, j: 0, step: 1, lastI: 0, lastJ: 0 };
  const normal = new Float64Array(3);
  const rng = new Rng(6);
  let [checked, fromWindow, inBoth, swaps, held, covers] = [0, 0, 0, 0, 0, 0];
  // Along the map's diagonal, 30 m a frame, turning: windows are filled in bands and swapped on the way.
  for (let f = 0; f < 64; f++) {
    budget.next();
    const cam = camera(700 + f * 30, 680 + f * 30, hf, f * 0.4);
    const p = frame(lod, cam, budget);
    if (p.groundWindow[0] !== twin.drawn && twin.drawn >= 0) swaps++;
    twin.take(p);
    expect(placed(hf, p)).toBe(true);
    // Every frame that fills or swaps, and every twelfth.
    if (f % 12 !== 0 && p.groundWindow[3] < 0) continue;
    for (let t = 0; t < p.tileCount; t++) {
      if (p.tileSource[t * 4 + 3] === SOURCE_WINDOW) fromWindow++;
      if (p.tilePass[t] === ((1 << PASS_NEAR) | (1 << PASS_FAR))) inBoth++;
      for (let gz = 0; gz <= TILE_QUADS; gz++) {
        for (let gx = 0; gx <= TILE_QUADS; gx++) {
          const [a, b] = [twin.vertex(p, t, gx, gz), truth(hf, p, t, gx, gz)];
          checked++;
          if (a.some((v, k) => v !== b[k]) && off.length < 5) off.push(`frame ${f} tile ${t} (${gx}, ${gz}): ${a.join(", ")} against ${b.join(", ")}`);
          // The rasterizer's normal, from the map's own samples, is the one the text takes from the picture.
          const stride = p.tiles[t * 4 + 3]!;
          const [i, j] = [Math.min(p.tileOrigin[t * 2]! + gx * stride, hf.nx - 1), Math.min(p.tileOrigin[t * 2 + 1]! + gz * stride, hf.nz - 1)];
          groundNormal(hf, tilePicture(p, t, size, picture), i, j, stride, normal, 0);
          const lit = twin.normal(p, t, gx, gz);
          // Held to the window's edge inside the map, where the rasterizer, reading the map, must hold its normal as well.
          if (lit.held && p.tileSource[t * 4 + 3] === SOURCE_WINDOW && i > 0 && j > 0 && i < hf.nx - 1 && j < hf.nz - 1) held++;
          if (lit.n.some((v, k) => v !== normal[k]) && off.length < 5) off.push(`frame ${f} tile ${t} (${gx}, ${gz}): normal ${lit.n.join(", ")} against ${normal.join(", ")}`);
        }
      }
      // The rasterizer's cover, from the map's own samples, is the one the fragment text takes from the picture, near
      // and far, with the wander and without.
      for (let k = 0; k < 8; k++) {
        const span = TILE_QUADS * p.tiles[t * 4 + 2]!;
        const [u, v, footprint] = [rng.range(0, span), rng.range(0, span), rng.range(0, 1)];
        const [x, z] = [p.tileOrigin[t * 2]! * hf.cell + u, p.tileOrigin[t * 2 + 1]! * hf.cell + v];
        const [a, b] = [twin.cover(p, t, u, v, x, z, footprint), groundTint(hf, tilePicture(p, t, size, picture), x, z, footprint)];
        covers++;
        if (a !== b && off.length < 5) off.push(`frame ${f} tile ${t} at ${x}, ${z}: cover ${a} against ${b}`);
      }
    }
  }
  expect(off).toEqual([]);
  expect(checked).toBeGreaterThan(200000);
  expect(covers).toBeGreaterThan(1500);
  expect([fromWindow > 100, inBoth > 10, swaps >= 4, held > 100]).toEqual([true, true, true, true]);
});

test("no fine tile reads past its window over a 10 km random walk with 20 teleports; the window comes within the allowance and refills as the camera moves 256 m", () => {
  const hf = rough(64);
  const lod = new TerrainLod(hf);
  const rng = new Rng(253);
  const budget = allowance(tierOf("medium").uploadBytes);
  const size = groundSize(hf);
  const rowBytes = size.width[SOURCE_WINDOW]! * 3;
  let [x, z, heading] = [2048, 2048, 0];
  let [walked, teleports, fills, swaps, wait, longest, coarser, coarserWalking, spentMost] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let drawn = -1;
  let middle = [0, 0];
  for (let f = 0; walked < 10000; f++) {
    budget.next();
    if (f > 0 && f % 25 === 0 && teleports < 20) {
      [x, z] = [rng.range(0, 4096), rng.range(0, 4096)];
      teleports++;
      wait = 0;
    } else {
      heading += rng.range(-0.4, 0.4);
      const [nx, nz] = [x + Math.cos(heading) * 20, z + Math.sin(heading) * 20];
      if (nx < 0 || nz < 0 || nx > 4096 || nz > 4096) heading += Math.PI;
      else [x, z, walked] = [nx, nz, walked + 20];
    }
    // Fine tiles reach about 1 km, so the view need go no further.
    const p = frame(lod, camera(x, z, hf, rng.range(0, 2 * Math.PI)), budget, 1500);
    expect(placed(hf, p)).toBe(true);
    if (f > 0) spentMost = Math.max(spentMost, budget.spent);
    if (p.groundWindow[3] >= 0) fills++;
    if (p.groundWindow[0] !== drawn) {
      swaps++;
      drawn = p.groundWindow[0]!;
      middle = [(p.groundWindow[1]! + (WINDOW - 1) / 2) * hf.cell, (p.groundWindow[2]! + (WINDOW - 1) / 2) * hf.cell];
      longest = Math.max(longest, wait);
      wait = 0;
    } else if (Math.max(Math.abs(x - middle[0]!), Math.abs(z - middle[1]!)) >= WINDOW_MOVE && x > 1024 && x < 3072 && z > 1024 && z < 3072) wait++;
    coarser += lod.coarser;
    if (teleports === 0 || f % 25 > 5) coarserWalking += lod.coarser;
  }
  // 1,025 rows of 3,075 bytes at 1 MB a frame: four frames, each within the allowance, once the first window is in.
  expect(Math.ceil(WINDOW / Math.floor(MB / rowBytes))).toBe(4);
  expect(spentMost).toBeLessThanOrEqual(MB);
  expect(longest).toBeLessThanOrEqual(4);
  expect(swaps).toBeGreaterThan(teleports);
  expect(fills).toBeGreaterThan(swaps * 3);
  // Tiles are drawn coarser only for the frames after a teleport, before the new window is in.
  expect(coarser).toBeGreaterThan(0);
  expect(coarserWalking).toBe(0);
});

test("the pictures take 9.5 MB on the card on 8 km, from 50, reserved in the ledger and made again after a lost context", () => {
  const eight = groundSize({ nx: 4097, nz: 4097, cell: TERRAIN_CELL });
  expect([eight.width, eight.height, eight.cell]).toEqual([[1025, 1025], [1025, 1025], [8, 2]]);
  expect([+(eight.bytes / 1e6).toFixed(2), +((4097 * 4097 * 3) / 1e6).toFixed(1)]).toEqual([9.46, 50.4]);

  const hf = rough(40);
  const lod = new TerrainLod(hf);
  const budget = allowance(0.5 * MB);
  const cam = camera(1200, 1300, hf);
  // The first window is filled whole, past the allowance, since nothing finer than 8 m can be drawn without it.
  let p = frame(lod, cam, budget);
  expect([...p.groundWindow]).toEqual([0, 128, 128, 0, 128, 128, 0, 1025]);
  expect([budget.reserved.get("terrain"), budget.spent]).toEqual([groundSize(hf).bytes, 1025 * 1025 * 3]);
  budget.next();
  p = frame(lod, cam, budget);
  expect([...p.groundWindow]).toEqual([0, 128, 128, -1, 0, 0, 0, 0]);
  // A lost context: the next frame fills the window whole again, and the reserve is what it was.
  lod.reset();
  budget.next();
  p = frame(lod, cam, budget);
  expect([p.groundWindow[0], p.groundWindow[3], p.groundWindow[7], budget.reserved.size]).toEqual([0, 0, 1025, 1]);
});

test("a refill goes in bands within the allowance; tiles read the window drawn until the frame its last band goes", () => {
  const hf = rough(40);
  const lod = new TerrainLod(hf);
  const budget = allowance(1 * MB);
  frame(lod, camera(1200, 1300, hf), budget);
  const seen: number[][] = [];
  for (let f = 0; f < 6; f++) {
    budget.next();
    const p = frame(lod, camera(1540, 1300, hf), budget);
    const fine = Array.from({ length: p.tileCount }, (_, t) => t).filter((t) => p.tileSource[t * 4 + 3] === SOURCE_WINDOW);
    seen.push([...p.groundWindow, fine.length > 0 ? p.tileOrigin[fine[0]! * 2]! - p.tileSource[fine[0]! * 4]! : -1]);
  }
  // 341 rows a frame; the copy drawn and the corner fine tiles count from change in the frame of the fourth band.
  expect(seen).toEqual([
    [0, 128, 128, 1, 256, 128, 0, 341, 128],
    [0, 128, 128, 1, 256, 128, 341, 341, 128],
    [0, 128, 128, 1, 256, 128, 682, 341, 128],
    [1, 256, 128, 1, 256, 128, 1023, 2, 256],
    [1, 256, 128, -1, 0, 0, 0, 0, 256],
    [1, 256, 128, -1, 0, 0, 0, 0, 256],
  ]);
});

test("a tile's mesh is its ground, then skirts that hang from the ground's border vertices, so the shell can draw the skirts apart, behind the ground", () => {
  const { vertices, indices, ground } = tileMesh();
  const row = TILE_QUADS + 1;
  const dropped = (v: number): boolean => vertices[v * 4 + 2] === 1;
  const border = (v: number): boolean => [vertices[v * 4], vertices[v * 4 + 1]].some((c) => c === 0 || c === TILE_QUADS);
  expect([ground, indices.length - ground]).toEqual([TILE_QUADS * TILE_QUADS * 6, 4 * TILE_QUADS * 6]);
  const odd: number[] = [];
  for (let k = 0; k < indices.length; k += 3) {
    const corners = [indices[k]!, indices[k + 1]!, indices[k + 2]!];
    // A skirt's corners lie on the border, and those not dropped are the ground's own vertices there.
    const fits = k < ground ? corners.every((v) => v < row * row) : corners.every(border) && corners.some(dropped) && corners.every((v) => dropped(v) || v < row * row);
    if (!fits) odd.push(k);
  }
  expect(odd).toEqual([]);
});
