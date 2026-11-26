// The terrain's pictures (D253): the whole map at every fourth sample and a window round the camera, whose pictures hold
// a sample at its own place modulo their size. A twin of what the shell does with them, the rectangles it puts and the
// wrapped fetch of the pinned terrain text, gives every tile the map's own samples, and the lit texts' normal and cover
// the rasterizer's; fine tiles never read past their window; the window steps within the upload allowance. A tile's
// mesh puts its ground before its skirts, which the shell draws behind it.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { zoomed } from "../../client/core/optics.ts";
import { FramePacket, PASS_FAR, PASS_NEAR, SOURCE_MAP, SOURCE_WINDOW, TILE_QUADS } from "../../client/core/render/packet.ts";
import { COARSE, TerrainLod, WINDOW, WINDOW_MOVE, coarseGround, groundNormal, groundSize, groundTint, tileMesh, tilePicture, type GroundBudget } from "../../client/core/render/terrain.ts";
import { tileRows, type Drawn } from "../../client/core/render/uniforms.ts";
import { groundCover, groundWander } from "../../client/core/render/world-surfaces.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { RoadSectors } from "../../shared/world/roadframe.ts";

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

/**
 * The shell's pictures as it fills them: the whole map's pair, and the window's, into which it puts each rectangle core
 * put together at its texels; and where the window's corner is in them, as the tiles' uniform row says (uniforms.ts).
 */
class Twin {
  readonly hf: Heightfield;
  readonly size;
  readonly coarse;
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  readonly wrap = new Float64Array(2);
  drawn = -1;

  constructor(hf: Heightfield) {
    this.hf = hf;
    this.size = groundSize(hf);
    this.coarse = coarseGround(hf);
    const n = this.size.width[SOURCE_WINDOW]! * this.size.height[SOURCE_WINDOW]!;
    this.heights = new Uint16Array(n);
    this.tint = new Uint8Array(n);
  }

  /** gl.ts draw(): each rectangle of the frame, its rows one after another, put at its texels. */
  take(p: FramePacket): void {
    const w = this.size.width[SOURCE_WINDOW]!, parts = p.groundParts;
    for (let n = 0; n < p.groundPartCount * 5; n += 5) {
      const [x, y, cols, rows, at] = [parts[n]!, parts[n + 1]!, parts[n + 2]!, parts[n + 3]!, parts[n + 4]!];
      for (let r = 0; r < rows; r++) {
        this.heights.set(p.groundHeights.subarray(at + r * cols, at + (r + 1) * cols), (y + r) * w + x);
        this.tint.set(p.groundTint.subarray(at + r * cols, at + (r + 1) * cols), (y + r) * w + x);
      }
    }
    this.drawn = p.groundWindow[0]!;
    tileRows(SOURCE_WINDOW).find((r) => r.name === "uWrap")!.fill!({ p, ground: this.size } as unknown as Drawn, this.wrap);
  }

  /** Where the text fetches sample (i, j) of picture `source`: the window's wrapped round its size from its corner. */
  texel(source: number, i: number, j: number): number {
    const [w, h] = [this.size.width[source]!, this.size.height[source]!];
    return source === SOURCE_MAP ? j * w + i : ((j + this.wrap[1]!) % h) * w + ((i + this.wrap[0]!) % w);
  }

  /** FLAT_TERRAIN_VERTEX's fetch of grid point (gx, gz) of tile `t`, as gl.ts step() feeds it: camera-relative x, height and z, and the tint. */
  vertex(p: FramePacket, t: number, gx: number, gz: number): number[] {
    const source = p.tileSource[t * 4 + 3]!;
    const [oi, oj, stride] = [p.tileSource[t * 4]!, p.tileSource[t * 4 + 1]!, p.tileSource[t * 4 + 2]!];
    const [w, h] = [this.size.width[source]!, this.size.height[source]!];
    const i = Math.min(oi + gx * stride, w - 1);
    const j = Math.min(oj + gz * stride, h - 1);
    const heights = source === SOURCE_MAP ? this.coarse.heights : this.heights;
    const tint = source === SOURCE_MAP ? this.coarse.tint : this.tint;
    const hf = this.hf;
    const cell = this.size.cell[source]!;
    const at = this.texel(source, i, j);
    return [p.tiles[t * 4]! + (i - oi) * cell, hf.minY + heights[at]! * hf.stepY - p.camY, p.tiles[t * 4 + 1]! + (j - oj) * cell, tint[at]!];
  }

  /**
   * LIT_TERRAIN_VERTEX's normal at grid point (gx, gz) of tile `t`: the heights a stride either side in the picture's
   * own samples, held to the picture, and whether one was held.
   */
  normal(p: FramePacket, t: number, gx: number, gz: number): { n: number[]; held: boolean } {
    const source = p.tileSource[t * 4 + 3]!;
    const [oi, oj, stride] = [p.tileSource[t * 4]!, p.tileSource[t * 4 + 1]!, p.tileSource[t * 4 + 2]!];
    const [w, h] = [this.size.width[source]!, this.size.height[source]!];
    const heights = source === SOURCE_MAP ? this.coarse.heights : this.heights;
    const at = (i: number, j: number): number => heights[this.texel(source, i, j)]!;
    const cell = this.size.cell[source]!;
    const [i, j] = [Math.min(oi + gx * stride, w - 1), Math.min(oj + gz * stride, h - 1)];
    const [l, r, b, f] = [Math.max(i - stride, 0), Math.min(i + stride, w - 1), Math.max(j - stride, 0), Math.min(j + stride, h - 1)];
    const x = ((at(r, j) - at(l, j)) * this.hf.stepY) / ((r - l) * cell);
    const z = ((at(i, f) - at(i, b)) * this.hf.stepY) / ((f - b) * cell);
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
    const tint = source === SOURCE_MAP ? this.coarse.tint : this.tint;
    const at = (i: number, j: number): number => tint[this.texel(source, i, j)]!;
    const wander = new Float64Array(2);
    groundWander(x, z, footprint, wander);
    const s = Math.min(Math.max(p.tileSource[t * 4]! + u / cell + wander[0]! / cell, 0), w - 1);
    const r = Math.min(Math.max(p.tileSource[t * 4 + 1]! + v / cell + wander[1]! / cell, 0), h - 1);
    const [i, j] = [Math.min(Math.floor(s), w - 2), Math.min(Math.floor(r), h - 2)];
    return groundCover(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1), s - i, r - j);
  }

  /** How many samples of the window drawn are not the map's own. */
  off(p: FramePacket): number {
    const [w, h] = [this.size.width[SOURCE_WINDOW]!, this.size.height[SOURCE_WINDOW]!], [wi, wj] = [p.groundWindow[1]!, p.groundWindow[2]!];
    let off = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.heights[this.texel(SOURCE_WINDOW, i, j)] !== this.hf.heights[(wj + j) * this.hf.nx + wi + i] || this.tint[this.texel(SOURCE_WINDOW, i, j)] !== this.hf.tint[(wj + j) * this.hf.nx + wi + i]) off++;
    return off;
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

test("the shell's wrapped fetch gives every tile's vertex the map's height, tint, normal and cover as the window steps", () => {
  const hf = rough(48);
  const lod = new TerrainLod(hf);
  const twin = new Twin(hf);
  const budget = allowance(1 * MB);
  const off: string[] = [];
  const size = groundSize(hf);
  const picture = { i: 0, j: 0, step: 1, lastI: 0, lastJ: 0 };
  const normal = new Float64Array(3);
  const rng = new Rng(6);
  let [checked, fromWindow, inBoth, steps, held, covers] = [0, 0, 0, 0, 0, 0];
  let corner = "";
  // Along the map's diagonal, 30 m a frame, turning: the window steps on the way, its pictures wrapped.
  for (let f = 0; f < 64; f++) {
    budget.next();
    const cam = camera(700 + f * 30, 680 + f * 30, hf, f * 0.4);
    const p = frame(lod, cam, budget);
    if (corner !== "" && corner !== `${p.groundWindow[1]} ${p.groundWindow[2]}`) steps++;
    corner = `${p.groundWindow[1]} ${p.groundWindow[2]}`;
    twin.take(p);
    expect(placed(hf, p)).toBe(true);
    expect(twin.off(p)).toBe(0);
    // Every frame that puts samples, and every twelfth.
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
  expect([fromWindow > 100, inBoth > 10, steps >= 4, held > 100]).toEqual([true, true, true, true]);
});

test("no fine tile reads past its window on a 10 km walk with 20 teleports; each step is in its frame", () => {
  const hf = rough(64);
  const lod = new TerrainLod(hf);
  const rng = new Rng(253);
  const budget = allowance(tierOf("medium").uploadBytes);
  const size = groundSize(hf);
  const rowBytes = size.width[SOURCE_WINDOW]! * 3;
  let [x, z, heading] = [2048, 2048, 0];
  let [walked, teleports, fills, steps, wait, longest, coarser, coarserWalking, spentMost, stepMost] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let drawn = "";
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
    const now = `${p.groundWindow[0]} ${p.groundWindow[1]} ${p.groundWindow[2]}`;
    if (now !== drawn) {
      if (f % 25 > 5 && p.groundWindow[0] === 0) (steps++, (stepMost = Math.max(stepMost, budget.spent)));
      drawn = now;
      middle = [(p.groundWindow[1]! + (WINDOW - 1) / 2) * hf.cell, (p.groundWindow[2]! + (WINDOW - 1) / 2) * hf.cell];
      longest = Math.max(longest, wait);
      wait = 0;
    } else if (Math.max(Math.abs(x - middle[0]!), Math.abs(z - middle[1]!)) >= WINDOW_MOVE && x > 1024 && x < 3072 && z > 1024 && z < 3072) wait++;
    coarser += lod.coarser;
    if (teleports === 0 || f % 25 > 5) coarserWalking += lod.coarser;
  }
  // A teleport's window: 1,025 rows of 3,075 bytes at 1 MB a frame, four frames, once the first window is in.
  expect(Math.ceil(WINDOW / Math.floor(MB / rowBytes))).toBe(4);
  expect(spentMost).toBeLessThanOrEqual(MB);
  expect(longest).toBeLessThanOrEqual(1);
  // A walking step is a strip of 128 columns or rows, 0.39 MB, or both, in the frame it is wanted.
  expect(steps).toBeGreaterThan(10);
  expect(stepMost).toBeLessThanOrEqual(2 * 128 * rowBytes);
  expect(fills).toBeGreaterThan(steps);
  // Tiles are drawn coarser only for the frames after a teleport, before the new window is in.
  expect(coarser).toBeGreaterThan(0);
  expect(coarserWalking).toBe(0);
});

test("the pictures take 6.3 MB on 8 km, from 50, reserved and made again after a lost context", () => {
  const eight = groundSize({ nx: 4097, nz: 4097, cell: TERRAIN_CELL });
  expect([eight.width, eight.height, eight.cell]).toEqual([[1025, 1025], [1025, 1025], [8, 2]]);
  expect([+(eight.bytes / 1e6).toFixed(2), +((4097 * 4097 * 3) / 1e6).toFixed(1)]).toEqual([6.3, 50.4]);

  const hf = rough(40);
  const lod = new TerrainLod(hf);
  const budget = allowance(0.5 * MB);
  const cam = camera(1200, 1300, hf);
  // The first window is filled whole, past the allowance, since nothing finer than 8 m can be drawn without it.
  let p = frame(lod, cam, budget);
  // 1,153 rows and columns from 128, wrapped at 1,025: four rectangles.
  const parts = (q: FramePacket): number[][] => Array.from({ length: q.groundPartCount }, (_, n) => [...q.groundParts.subarray(n * 5, n * 5 + 5)]);
  expect([...p.groundWindow]).toEqual([0, 128, 128, 0]);
  expect(parts(p)).toEqual([[128, 128, 897, 897, 0], [0, 128, 128, 897, 897 * 897], [128, 0, 897, 128, 1025 * 897], [0, 0, 128, 128, 1025 * 897 + 897 * 128]]);
  expect([budget.reserved.get("terrain"), budget.spent]).toEqual([groundSize(hf).bytes, 1025 * 1025 * 3]);
  budget.next();
  p = frame(lod, cam, budget);
  expect([...p.groundWindow, p.groundPartCount]).toEqual([0, 128, 128, -1, 0]);
  // A lost context: the next frame fills the window whole again, and the reserve is what it was.
  lod.reset();
  budget.next();
  p = frame(lod, cam, budget);
  expect([p.groundWindow[0], p.groundWindow[3], p.groundPartCount, budget.spent, budget.reserved.size]).toEqual([0, 0, 4, 1025 * 1025 * 3, 1]);
});

test("a 340 m move puts the 128 columns the window gains, 0.39 MB, and is drawn from that frame", () => {
  const hf = rough(40);
  const lod = new TerrainLod(hf);
  const twin = new Twin(hf);
  const budget = allowance(1 * MB);
  twin.take(frame(lod, camera(1200, 1300, hf), budget));
  const seen: number[][] = [];
  for (let f = 0; f < 3; f++) {
    budget.next();
    const p = frame(lod, camera(1540, 1300, hf), budget);
    twin.take(p);
    expect(twin.off(p)).toBe(0);
    const fine = Array.from({ length: p.tileCount }, (_, t) => t).filter((t) => p.tileSource[t * 4 + 3] === SOURCE_WINDOW);
    seen.push([...p.groundWindow, budget.spent, fine.length > 0 ? p.tileOrigin[fine[0]! * 2]! - p.tileSource[fine[0]! * 4]! : -1]);
    if (f === 0) {
      // Columns 1,153 to 1,280 of the map, texels 128 to 255, all 1,025 rows from 128, wrapped at the picture's foot.
      expect(Array.from({ length: p.groundPartCount }, (_, n) => [...p.groundParts.subarray(n * 5, n * 5 + 5)])).toEqual([[128, 128, 128, 897, 0], [128, 0, 128, 128, 128 * 897]]);
    }
  }
  expect(seen).toEqual([
    [0, 256, 128, 0, 128 * 1025 * 3, 256],
    [0, 256, 128, -1, 0, 256],
    [0, 256, 128, -1, 0, 256],
  ]);
});

test("a corner that shares nothing with the window is filled in bands, drawn coarse until its last", () => {
  const hf = rough(80);
  const lod = new TerrainLod(hf);
  const twin = new Twin(hf);
  const budget = allowance(1 * MB);
  twin.take(frame(lod, camera(1200, 1300, hf), budget));
  const seen: number[][] = [];
  for (let f = 0; f < 5; f++) {
    budget.next();
    const p = frame(lod, camera(3600, 3500, hf), budget);
    twin.take(p);
    let samples = 0;
    for (let n = 0; n < p.groundPartCount; n++) samples += p.groundParts[n * 5 + 2]! * p.groundParts[n * 5 + 3]!;
    seen.push([p.groundWindow[0]!, p.groundWindow[0]! >= 0 ? p.groundWindow[1]! : -1, samples / 1025, lod.coarser > 0 ? 1 : 0]);
  }
  // 341 rows a frame of 1,025 samples round corner (1,280, 1,280), 1,152 from the one before.
  expect(seen).toEqual([
    [-1, -1, 341, 1],
    [-1, -1, 341, 1],
    [-1, -1, 341, 1],
    [0, 1280, 2, 0],
    [0, 1280, 0, 0],
  ]);
  const p = frame(lod, camera(3600, 3500, hf));
  expect([p.groundWindow[1], p.groundWindow[2], twin.off(p)]).toEqual([1280, 1280, 0]);
});

test("a sector held inside the window puts its own columns and rows again, in bands within the allowance", () => {
  const hf = rough(40);
  const lod = new TerrainLod(hf);
  const twin = new Twin(hf);
  const cam = camera(1200, 1300, hf);
  const bandBytes = 32 * 161 * 3, budget = allowance(bandBytes);
  twin.take(frame(lod, cam, budget));
  budget.next();
  twin.take(frame(lod, cam, budget));
  // Chunks 5 to 9 across and 10 to 12 down take new samples, as a sector's ground sets them.
  const per = 32;
  for (let j = 10 * per; j <= 13 * per; j++) for (let i = 5 * per; i <= 10 * per; i++) hf.heights[j * hf.nx + i] = 9000 + ((i + j) % 50);
  hf.hold(5, 10, 10, 13);
  const bands: number[][] = [];
  for (let f = 0; f < 6; f++) {
    budget.next();
    const p = frame(lod, cam, budget);
    twin.take(p);
    expect(budget.spent).toBeLessThanOrEqual(bandBytes);
    for (let n = 0; n < p.groundPartCount; n++) bands.push([...p.groundParts.subarray(n * 5, n * 5 + 5)]);
  }
  // Columns 160 to 320 and rows 320 to 416 of the map, 32 rows a frame, at their own texels.
  expect(bands).toEqual([[160, 320, 161, 32, 0], [160, 352, 161, 32, 0], [160, 384, 161, 32, 0], [160, 416, 161, 1, 0]]);
  expect(twin.off(frame(lod, cam, budget))).toBe(0);
});

test("the roads' picture takes every cell for a new window, then only what a square or a step changes", () => {
  const hf = rough(40);
  const lod = new TerrainLod(hf);
  hf.road = new RoadSectors();
  const cam = camera(1200, 1300, hf);
  const parts = (p: FramePacket): number[][] => Array.from({ length: p.roadPartCount }, (_, n) => [...p.roadParts.subarray(n * 5, n * 5 + 5)]);
  const square = (d: number, v = 1) => ({ across: new Uint8Array(10 * d).fill(v), along: new Uint8Array(10 * d), half: new Uint8Array(10 * d), lanes: new Uint8Array(10 * d) });
  const budget = allowance(MB);
  const step = (): FramePacket => (budget.next(), frame(lod, cam, budget));
  // The window's corner is sample 128 a side, cell 64 of the frame's, whose picture is 513 cells a side, wrapped.
  expect(parts(step())).toEqual([[64, 64, 449, 449, 0], [0, 64, 64, 449, 449 * 449], [64, 0, 449, 64, 513 * 449], [0, 0, 64, 64, 513 * 449 + 449 * 64]]);
  expect(parts(step())).toEqual([]);
  hf.road.put(1, 200, 150, 10, square(5));
  const p = step();
  expect(parts(p)).toEqual([[200, 150, 10, 5, 0]]);
  expect(p.roadBytes[0]).toBe(1);
  expect(parts(step())).toEqual([]);
  // Past the window's last cell nothing is copied; the square let go inside it is.
  hf.road.put(2, 200, 600, 10, square(5));
  expect(parts(step())).toEqual([]);
  hf.road.drop(1);
  expect(parts(step())).toEqual([[200, 150, 10, 5, 0]]);
  // A square 400 cells tall at an allowance of 100 of its rows a frame goes in bands.
  const tall = allowance(100 * 10 * 4);
  hf.road.put(3, 100, 70, 10, square(400));
  const got: number[][][] = [];
  for (let f = 0; f < 6; f++) (tall.next(), got.push(parts(frame(lod, cam, tall))));
  expect(got).toEqual([[[100, 70, 10, 100, 0]], [[100, 170, 10, 100, 0]], [[100, 270, 10, 100, 0]], [[100, 370, 10, 100, 0]], [], []]);
  // Moved 340 m, the window steps 128 samples: the picture takes the 64 columns of cells it gains, that frame alone.
  const moved: number[][][] = [];
  for (let f = 0; f < 4; f++) (budget.next(), moved.push(parts(frame(lod, camera(1540, 1300, hf), budget))));
  expect(moved).toEqual([[[64, 64, 64, 449, 0], [64, 0, 64, 64, 64 * 449]], [], [], []]);
});

test("with bounds kept by the heightfield, a chunk's box is its bound, read without a scan of its samples", () => {
  const hf = rough(8);
  hf.bounds = new Uint16Array(64 * 2).map((_, k) => (k % 2 ? 200 : 100));
  const lod = new TerrainLod(hf);
  expect([lod.lowest(10, 10, 300, 300), lod.farthestFrom(hf.minY)]).toEqual([hf.minY + 100 * hf.stepY, 200 * hf.stepY]);
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

test("through a sight the ground in view is chosen as if it stood the zoom's times nearer, finer where the window has it, and what casts as it was", () => {
  const hf = rough(32);
  const lod = new TerrainLod(hf);
  const cam = camera(1024, 300, hf);
  cam.pitch = -0.02;
  const narrow = zoomed(cam.fovY, 6);
  cam.fovY = narrow;
  cam.update();
  // The finest stride a tile has in view, and how many tiles; the window comes first, in whatever frames it takes.
  const finest = (p: FramePacket): number => Math.min(...Array.from({ length: p.tileCount }, (_, n) => p.tiles[n * 4 + 3]!));
  const tilesAt = (p: FramePacket, from: number): number => Array.from({ length: p.tileCount }, (_, n) => n).filter((n) => Math.hypot(p.tiles[n * 4]!, p.tiles[n * 4 + 1]! - from) < 400).length;
  for (let f = 0; f < 40; f++) frame(lod, cam, allowance(64 << 20));
  const plain = frame(lod, cam, allowance(64 << 20));
  cam.zoom = 6;
  for (let f = 0; f < 40; f++) frame(lod, cam, allowance(64 << 20));
  const zoomedIn = frame(lod, cam, allowance(64 << 20));
  expect(zoomedIn.tileCount).toBeGreaterThan(plain.tileCount);
  expect(finest(zoomedIn)).toBeLessThanOrEqual(finest(plain));
  // 600 m ahead, in the window round the camera: more and finer tiles.
  expect(tilesAt(zoomedIn, 600)).toBeGreaterThan(tilesAt(plain, 600));
  expect(placed(hf, zoomedIn)).toBe(true);
});

test("the fine window centres where a sight that magnifies is on, and back on the camera once it is lowered", () => {
  const hf = rough(64);
  const lod = new TerrainLod(hf);
  const cam = camera(400, 400, hf);
  const middle = (p: FramePacket): number[] => [(p.groundWindow[1]! + (WINDOW - 1) / 2) * hf.cell, (p.groundWindow[2]! + (WINDOW - 1) / 2) * hf.cell];
  let p = frame(lod, cam);
  expect(Math.hypot(middle(p)[0]! - 1025, middle(p)[1]! - 1025)).toBeLessThan(700);
  // On a point 3 km off: the window is filled there and drawn from there, within the map.
  lod.centreX = 2700;
  lod.centreZ = 2600;
  for (let f = 0; f < 4; f++) p = frame(lod, cam);
  expect(Math.hypot(middle(p)[0]! - 2700, middle(p)[1]! - 2600)).toBeLessThan(WINDOW_MOVE);
  expect(placed(hf, p)).toBe(true);
  lod.centreX = lod.centreZ = NaN;
  for (let f = 0; f < 4; f++) p = frame(lod, cam);
  expect(Math.hypot(middle(p)[0]! - 400, middle(p)[1]! - 400)).toBeLessThan(1100);
});
