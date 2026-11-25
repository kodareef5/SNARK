// A quadtree over the map. A node far enough away is drawn as one tile of 32 x 32 quads. Otherwise its four children are considered.
// Every tile has the same triangle count, so cost follows screen coverage. Level 0 tiles are single chunks and match the collision surface.
// A tile reads its heights and tints from one of two pairs of pictures on the card (D253): the whole map at every COARSE-th
// sample, or a window WINDOW samples a side round the camera. Tiles of COARSE samples a quad and coarser read the whole
// map's; finer ones read the window's, and a node is cut into those only where it lies inside the window. The window's
// pictures hold map sample (i, j) at texel (i, j) modulo their size, as the streets' do (streets.ts), so a move writes
// only the columns or rows it gains; core puts them together from the heightfield, a rectangle at a time.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { ROAD_PLANES, ROAD_STEP, roadSamples, type RoadSectors } from "../../../shared/world/roadframe.ts";
import type { Camera } from "./camera.ts";
import { GROUND_PARTS, MAX_TILES, SOURCE_MAP, SOURCE_WINDOW, TILE_CASTS, TILE_QUADS, type FramePacket } from "./packet.ts";
import { groundCover, groundWander } from "./world-surfaces.ts";
import { StreetRegion } from "./streets.ts";

/** The whole map's pair takes every fourth sample: 1,025 a side on an 8 km map. */
export const COARSE = 4;
/** The window's side in samples: 2 km at 2 m. */
export const WINDOW = 1025;
/** The window moves round the camera once the camera is this many metres from its middle along either axis. */
export const WINDOW_MOVE = 256;
/** A height of 16 bits and a tint of 8. */
const SAMPLE_BYTES = 3;
/** The window's corner is on the grid of the largest nodes that are cut into window tiles, so each is inside it or not. */
const SNAP = TILE_QUADS * COARSE;

/** The frame's upload allowance and the card's budget, as assets/residency.ts keeps them. */
export interface GroundBudget {
  readonly left: number;
  spend(bytes: number): void;
  reserve(name: string, bytes: number): void;
}

/** The shadow cascades, a bit each, that ground in a camera-relative box casts into (render/shadow.ts). */
export type CastTest = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => number;

/** Each source's pictures, SOURCE_MAP's then SOURCE_WINDOW's: samples across and down, and metres between samples. */
export interface GroundSize {
  readonly width: readonly number[];
  readonly height: readonly number[];
  readonly cell: readonly number[];
  /** Bytes on the card: the whole map's pair and the window's. */
  readonly bytes: number;
}

/** The cell, of `n` cells `size` metres wide, that `v` metres falls in, held to the row. */
function cellOf(v: number, size: number, n: number): number {
  return Math.max(0, Math.min(n - 1, Math.floor(v / size)));
}

export function groundSize(hf: Pick<Heightfield, "nx" | "nz" | "cell">): GroundSize {
  const width = [Math.ceil((hf.nx - 1) / COARSE) + 1, Math.min(WINDOW, hf.nx)];
  const height = [Math.ceil((hf.nz - 1) / COARSE) + 1, Math.min(WINDOW, hf.nz)];
  return { width, height, cell: [hf.cell * COARSE, hf.cell], bytes: (width[0]! * height[0]! + width[1]! * height[1]!) * SAMPLE_BYTES };
}

/** The whole map's pair: the height and tint of every COARSE-th sample. A map's side is whole chunks, so its last sample is one. */
export function coarseGround(hf: Heightfield): { heights: Uint16Array; tint: Uint8Array } {
  return coarseArea(hf, 0, 0, hf.dims.chunksX, hf.dims.chunksZ);
}

/**
 * The whole map's pair over chunks cx0, cz0 up to cx1, cz1, their far edges among them, as the card takes it again where
 * the ground changed (Heightfield.changes): the corner and the size in the pair's samples, and their heights and tints.
 */
export function coarseArea(hf: Heightfield, cx0: number, cz0: number, cx1: number, cz1: number): { i: number; j: number; w: number; h: number; heights: Uint16Array; tint: Uint8Array } {
  const per = CHUNK_SIZE / hf.cell / COARSE;
  const i0 = cx0 * per, j0 = cz0 * per;
  const w = cx1 * per - i0 + 1, h = cz1 * per - j0 + 1;
  const heights = new Uint16Array(w * h);
  const tint = new Uint8Array(w * h);
  hf.every(i0 * COARSE, j0 * COARSE, COARSE, w, h, heights, tint);
  return { i: i0, j: j0, w, h, heights, tint };
}

/**
 * Where the picture a tile reads lies in the map's samples: its corner, how many apart it holds them, and its last sample
 * across and down, counted in its own.
 */
export interface GroundPicture {
  i: number;
  j: number;
  step: number;
  lastI: number;
  lastJ: number;
}

/** The picture tile `t` of frame `p` reads, into `out`. */
export function tilePicture(p: FramePacket, t: number, size: GroundSize, out: GroundPicture): GroundPicture {
  const source = p.tileSource[t * 4 + 3]!;
  const window = source === SOURCE_WINDOW;
  out.i = window ? p.groundWindow[1]! : 0;
  out.j = window ? p.groundWindow[2]! : 0;
  out.step = window ? 1 : COARSE;
  out.lastI = size.width[source]! - 1;
  out.lastJ = size.height[source]! - 1;
  return out;
}

/**
 * The normal the lit tiers light the ground by at sample (i, j) of a tile `stride` samples a quad, as LIT_TERRAIN_VERTEX
 * takes it from picture `pic`: from the heights a stride either side, as far as the picture holds them. Into `out` at
 * `at`.
 */
export function groundNormal(hf: Heightfield, pic: GroundPicture, i: number, j: number, stride: number, out: Float64Array, at: number): void {
  const l = Math.max(i - stride, pic.i), r = Math.min(i + stride, pic.i + pic.lastI * pic.step);
  const b = Math.max(j - stride, pic.j), f = Math.min(j + stride, pic.j + pic.lastJ * pic.step);
  const v = hf.view(l, b, r, f), h = v.heights, s = v.stride, o = v.off;
  const gx = ((h[o + j * s + r]! - h[o + j * s + l]!) * hf.stepY) / ((r - l) * hf.cell);
  const gz = ((h[o + f * s + i]! - h[o + b * s + i]!) * hf.stepY) / ((f - b) * hf.cell);
  const n = Math.hypot(gx, 1, gz);
  out[at] = -gx / n;
  out[at + 1] = 1 / n;
  out[at + 2] = -gz / n;
}

const wander = new Float64Array(2);

/**
 * The tint the lit tiers' ground takes at ground point (x, z) of a tile that reads picture `pic`, a pixel `footprint`
 * metres wide, as LIT_TERRAIN_FRAGMENT chooses it from the picture's own samples (world-surfaces.ts `groundCover`).
 */
export function groundTint(hf: Heightfield, pic: GroundPicture, x: number, z: number, footprint: number): number {
  groundWander(x, z, footprint, wander);
  const metres = hf.cell * pic.step;
  const s = Math.min(Math.max((x + wander[0]!) / metres - pic.i / pic.step, 0), pic.lastI);
  const t = Math.min(Math.max((z + wander[1]!) / metres - pic.j / pic.step, 0), pic.lastJ);
  const i = Math.min(Math.floor(s), pic.lastI - 1), j = Math.min(Math.floor(t), pic.lastJ - 1);
  const a = pic.i + i * pic.step, b = pic.j + j * pic.step;
  const v = hf.tints(a, b, a + pic.step, b + pic.step), at = v.off + b * v.stride + a, down = pic.step * v.stride;
  return groundCover(v.tint[at]!, v.tint[at + pic.step]!, v.tint[at + down]!, v.tint[at + down + pic.step]!, s - i, t - j);
}

/**
 * Steps of the depth buffer by which a tile's skirt is drawn behind the ground. A skirt meets the ground along the
 * tile's border, and where the buffer could not tell them apart, as on low poly far off, it showed through the ground
 * there as a dark dotted line.
 */
export const SKIRT_BEHIND = 4;

/**
 * The mesh drawn once per tile: its grid of TILE_QUADS a side, then a skirt that repeats the border vertices and drops
 * them, which hides gaps between tiles of different detail. A vertex is its grid column and row and 1 if dropped, then
 * 0. The grid's indices come first, `ground` of them, so that the skirt can be drawn apart, SKIRT_BEHIND steps back.
 */
export function tileMesh(): { vertices: Uint8Array; indices: Uint16Array; ground: number } {
  const row = TILE_QUADS + 1;
  const verts: number[] = [];
  const index: number[] = [];
  for (let z = 0; z < row; z++) for (let x = 0; x < row; x++) verts.push(x, z, 0, 0);
  for (let z = 0; z < TILE_QUADS; z++) {
    for (let x = 0; x < TILE_QUADS; x++) {
      const a = z * row + x;
      // Same split and colour corner as the collision surface and the reference rasterizer.
      index.push(a + row + 1, a + 1, a, a + row, a + row + 1, a);
    }
  }
  const ground = index.length;
  const edge = (x: number, z: number): number => (verts.push(x, z, 1, 0), verts.length / 4 - 1);
  const side = (x0: number, z0: number, x1: number, z1: number): void => {
    const a = z0 * row + x0;
    const b = z1 * row + x1;
    const c = edge(x0, z0);
    const d = edge(x1, z1);
    index.push(a, b, c, b, d, c);
  };
  for (let i = 0; i < TILE_QUADS; i++) {
    side(i, 0, i + 1, 0);
    side(i, TILE_QUADS, i + 1, TILE_QUADS);
    side(0, i, 0, i + 1);
    side(TILE_QUADS, i, TILE_QUADS, i + 1);
  }
  return { vertices: Uint8Array.from(verts), indices: Uint16Array.from(index), ground };
}

export class TerrainLod {
  /** Distance, in tile widths, beyond which a tile is detailed enough. */
  detail = 2.5;
  readonly levels: number;
  readonly size: GroundSize;
  /** Tiles the last frame drew as they were, a level coarser, because the window drawn did not hold their children. */
  coarser = 0;
  /** Per tile of the last frame's list, its lowest and highest sample, camera-relative. */
  readonly low = new Float32Array(MAX_TILES);
  readonly high = new Float32Array(MAX_TILES);
  private readonly hf: Heightfield;
  private readonly minY: Float32Array[] = [];
  private readonly maxY: Float32Array[] = [];
  private readonly width: number[] = [];
  private readonly stack = new Int32Array(4 * 64);
  /**
   * The window drawn with: 0 while the pictures hold the one whose corner is sample (drawnI, drawnJ) whole, -1 while
   * they hold none; and the corner it steps to, a strip of columns or rows a frame (`step`).
   */
  private drawn = -1;
  private drawnI = 0;
  private drawnJ = 0;
  private goalI = 0;
  private goalJ = 0;
  /** While no window is held, the corner the pictures are filled round, rows a frame from `row`. */
  private filling = false;
  private fillI = 0;
  private fillJ = 0;
  private row = 0;
  /** No window was held since the pictures were made: the first is filled whole. */
  private fresh = true;
  /** Samples of the window drawn that changed since they went on the card, from (patchI, patchJ) up to (patchI1, patchJ1): put again. */
  private patchI = 0;
  private patchJ = 0;
  private patchI1 = 0;
  private patchJ1 = 0;
  /** This frame's samples put together for the card (packet groundHeights), and the roads' frame's bytes; made when first needed. */
  private heights = new Uint16Array(0);
  private tint = new Uint8Array(0);
  private roadBytes = new Uint8Array(0);
  private used = 0;
  private roadUsed = 0;
  /**
   * The roads' frame as its picture holds it: 0 while it holds that of the window drawn whole, else -1, and its corner in
   * the frame's cells; the frame held and its version; then its cells still to copy again, from (roadI, roadJ) up to
   * (roadI1, roadJ1).
   */
  private readonly roadFor = Int32Array.of(-1, 0, 0);
  private roadOf: RoadSectors | null = null;
  private roadVersion = 0;
  private roadI = 0;
  private roadJ = 0;
  private roadI1 = 0;
  private roadJ1 = 0;
  private readonly roadChanges: number[] = [];
  /** The heightfield's changes taken in. */
  private seen: number;

  constructor(hf: Heightfield) {
    this.hf = hf;
    this.size = groundSize(hf);
    const cx = hf.dims.chunksX;
    const cz = hf.dims.chunksZ;
    let levels = 1;
    while (1 << (levels - 1) < Math.max(cx, cz)) levels++;
    this.levels = levels;
    for (let level = 0; level < levels; level++) {
      const w = Math.ceil(cx / (1 << level));
      const d = Math.ceil(cz / (1 << level));
      this.width.push(w);
      this.minY.push(new Float32Array(w * d));
      this.maxY.push(new Float32Array(w * d));
    }
    this.measure(0, 0, cx, cz);
    this.seen = hf.changes.length;
  }

  /**
   * Height range per node over chunks cx0, cz0 up to cx1, cz1, finest level first, and of every node above them: from the
   * heightfield's bounds where it keeps them, else from the samples as they are.
   */
  private measure(cx0: number, cz0: number, cx1: number, cz1: number): void {
    const hf = this.hf;
    const per = Math.round(CHUNK_SIZE / hf.cell);
    const w0 = this.width[0]!, lo0 = this.minY[0]!, hi0 = this.maxY[0]!;
    // The stored steps' least and most, a sample's height rising with its step: a whole map's are 66 million samples.
    const bounds = hf.bounds;
    for (let tz = cz0; tz < cz1; tz++) {
      for (let tx = cx0; tx < cx1; tx++) {
        let a = 65535;
        let b = 0;
        if (bounds) {
          a = bounds[(tz * w0 + tx) * 2]!;
          b = bounds[(tz * w0 + tx) * 2 + 1]!;
        } else for (let j = tz * per, v = hf.view(tx * per, j, (tx + 1) * per, (tz + 1) * per), heights = v.heights; j <= (tz + 1) * per; j++) {
          for (let k = v.off + j * v.stride + tx * per, end = k + per; k <= end; k++) {
            const q = heights[k]!;
            if (q < a) a = q;
            if (q > b) b = q;
          }
        }
        lo0[tz * w0 + tx] = hf.minY + a * hf.stepY;
        hi0[tz * w0 + tx] = hf.minY + b * hf.stepY;
      }
    }
    for (let level = 1; level < this.levels; level++) {
      cx0 >>= 1;
      cz0 >>= 1;
      cx1 = (cx1 + 1) >> 1;
      cz1 = (cz1 + 1) >> 1;
      const w = this.width[level]!, lo = this.minY[level]!, hi = this.maxY[level]!;
      const pw = this.width[level - 1]!, plo = this.minY[level - 1]!, phi = this.maxY[level - 1]!;
      const pd = plo.length / pw;
      for (let tz = cz0; tz < cz1; tz++) {
        for (let tx = cx0; tx < cx1; tx++) {
          let a = Infinity;
          let b = -Infinity;
          for (let k = 0; k < 4; k++) {
            const px = tx * 2 + (k & 1);
            const pz = tz * 2 + (k >> 1);
            if (px >= pw || pz >= pd) continue;
            a = Math.min(a, plo[pz * pw + px]!);
            b = Math.max(b, phi[pz * pw + px]!);
          }
          lo[tz * w + tx] = a;
          hi[tz * w + tx] = b;
        }
      }
    }
  }

  /**
   * Takes in the samples that changed since the last frame: their chunks' height ranges are measured again, with the
   * chunks round them whose edges they share, and the rows of the window drawn that hold them are put again in place; a
   * window being filled is filled again from the first of its rows they change.
   */
  private take(): void {
    const hf = this.hf, c = hf.changes;
    const per = Math.round(CHUNK_SIZE / hf.cell);
    const w = this.size.width[SOURCE_WINDOW]!, h = this.size.height[SOURCE_WINDOW]!;
    const { chunksX, chunksZ } = hf.dims;
    for (; this.seen < c.length; this.seen += 4) {
      const cx0 = c[this.seen]!, cz0 = c[this.seen + 1]!, cx1 = c[this.seen + 2]!, cz1 = c[this.seen + 3]!;
      this.measure(Math.max(0, cx0 - 1), Math.max(0, cz0 - 1), Math.min(chunksX, cx1 + 1), Math.min(chunksZ, cz1 + 1));
      const i0 = cx0 * per, j0 = cz0 * per, i1 = cx1 * per, j1 = cz1 * per;
      const meets = (i: number, j: number, rows: number): boolean => i0 < i + w && i1 >= i && j0 < j + rows && j1 >= j;
      if (this.drawn >= 0 && meets(this.drawnI, this.drawnJ, h)) {
        const open = this.patchI < this.patchI1 && this.patchJ < this.patchJ1;
        this.patchI = open ? Math.min(this.patchI, i0) : i0;
        this.patchJ = open ? Math.min(this.patchJ, j0) : j0;
        this.patchI1 = open ? Math.max(this.patchI1, i1 + 1) : i1 + 1;
        this.patchJ1 = open ? Math.max(this.patchJ1, j1 + 1) : j1 + 1;
      }
      if (this.filling && meets(this.fillI, this.fillJ, this.row)) this.row = Math.max(0, j0 - this.fillJ);
    }
  }

  /** The streets' pictures round the camera (streets.ts), for the desktop's lit tiers' straight street edges. */
  readonly streets = new StreetRegion();
  /** After a lost context the card holds no window and no roads' frame, and the next frame fills them whole. */
  reset(): void {
    this.drawn = -1;
    this.filling = false;
    this.fresh = true;
    this.patchI1 = this.patchI;
    this.roadFor[0] = -1;
    this.streets.reset();
  }

  /**
   * The tiles to draw, and the window's work this frame. Without a budget a window is filled whole in the frame it is
   * wanted. With `casts`, each tile is marked with the shadow cascades it casts into.
   */
  select(cam: Camera, packet: FramePacket, viewDistance: number, budget?: GroundBudget, casts?: CastTest): void {
    this.take();
    this.follow(cam, packet, budget);
    this.followRoad(packet, budget);
    // Only the tiers that read the finishes in full draw the streets' edges (programs.ts GROUND_STREETS).
    this.streets.follow(packet.tier.lit && packet.tier.finish === "full" ? this.hf.streets : null, cam.x, cam.z, packet);
    this.coarser = 0;
    this.walk(cam, packet, viewDistance, casts ?? null, false);
  }

  /**
   * After `select`, the tiles out of view that cast into a shadow cascade, which no depth range draws. They are chosen as
   * the view chooses tiles, by distance and the window, so the ground casts as it is drawn. False if the list filled.
   */
  casters(cam: Camera, packet: FramePacket, viewDistance: number, casts: CastTest): boolean {
    return this.walk(cam, packet, viewDistance, casts, true);
  }

  /** How far the ground anywhere on the map stands from height `y`, up or down, at most. */
  farthestFrom(y: number): number {
    const top = this.levels - 1;
    let most = 0;
    for (let k = 0; k < this.minY[top]!.length; k++) most = Math.max(most, y - this.minY[top]![k]!, this.maxY[top]![k]! - y);
    return most;
  }

  /** A bound under the ground in a rectangle of the world: the lowest of the nodes it touches, at the finest level where they are at most three a side. */
  lowest(x0: number, z0: number, x1: number, z1: number): number {
    let level = 0;
    while (level < this.levels - 1 && (CHUNK_SIZE << level) * 2 < Math.max(x1 - x0, z1 - z0)) level++;
    const size = CHUNK_SIZE << level;
    const w = this.width[level]!;
    const lows = this.minY[level]!;
    const d = lows.length / w;
    const i0 = cellOf(x0, size, w), i1 = cellOf(x1, size, w), j1 = cellOf(z1, size, d);
    let low = Infinity;
    for (let j = cellOf(z0, size, d); j <= j1; j++) for (let i = i0; i <= i1; i++) low = Math.min(low, lows[j * w + i]!);
    return low;
  }

  /**
   * Walks the quadtree. For the view, the tiles in view, marked with the cascades `casts` finds; for `shadows`, those out
   * of view that cast. Returns false if the list filled.
   */
  private walk(cam: Camera, packet: FramePacket, viewDistance: number, casts: CastTest | null, shadows: boolean): boolean {
    const hf = this.hf;
    const top = this.levels - 1;
    const stack = this.stack;
    let sp = 0;
    const tw = this.width[top]!;
    const td = this.minY[top]!.length / tw;
    for (let tz = 0; tz < td; tz++) {
      for (let tx = 0; tx < tw; tx++) {
        stack[sp++] = top;
        stack[sp++] = tx;
        stack[sp++] = tz;
      }
    }
    while (sp > 0) {
      const tz = stack[--sp]!;
      const tx = stack[--sp]!;
      const level = stack[--sp]!;
      const w = this.width[level]!;
      if (tx >= w || tz >= this.minY[level]!.length / w) continue;
      const size = CHUNK_SIZE << level;
      const x0 = tx * size - cam.x;
      const z0 = tz * size - cam.z;
      const y0 = this.minY[level]![tz * w + tx]! - cam.y;
      const y1 = this.maxY[level]![tz * w + tx]! - cam.y;
      const stride = (size / hf.cell / TILE_QUADS) | 0;
      // A tile's skirt hangs two quads under its lowest sample.
      const skirt = y0 - 2 * stride * hf.cell;
      const seen = cam.boxVisible(x0, y0, z0, x0 + size, y1, z0 + size);
      // For shadows a node is walked while it may cast, since its children's boxes lie within its own.
      let bits = shadows ? casts!(x0, skirt, z0, x0 + size, y1, z0 + size) : 0;
      if (shadows ? bits === 0 : !seen) continue;
      const dx = x0 > 0 ? x0 : x0 + size < 0 ? -(x0 + size) : 0;
      const dz = z0 > 0 ? z0 : z0 + size < 0 ? -(z0 + size) : 0;
      const dy = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > viewDistance) continue;
      const i0 = Math.round((tx * size) / hf.cell);
      const j0 = Math.round((tz * size) / hf.cell);
      // Children finer than the whole map's pair read the window, so a node outside it is drawn as it is. Through a sight
      // the view's tiles are chosen as if they stood its zoom times nearer (Camera.zoom, D1078); what casts is not.
      if (level > 0 && dist < size * this.detail * (shadows ? 1 : cam.zoom)) {
        if (stride >= 2 * COARSE || this.inside(i0, j0, stride * TILE_QUADS)) {
          for (let k = 0; k < 4; k++) {
            stack[sp++] = level - 1;
            stack[sp++] = tx * 2 + (k & 1);
            stack[sp++] = tz * 2 + (k >> 1);
          }
          continue;
        }
        if (!shadows) this.coarser++;
      }
      // The view's walk listed this tile.
      if (shadows && seen) continue;
      if (!shadows && casts) bits = casts(x0, skirt, z0, x0 + size, y1, z0 + size);
      const n = packet.tileCount;
      if (n === MAX_TILES) return false;
      packet.tiles[n * 4] = x0;
      packet.tiles[n * 4 + 1] = z0;
      packet.tiles[n * 4 + 2] = stride * hf.cell;
      packet.tiles[n * 4 + 3] = stride;
      packet.tileOrigin[n * 2] = i0;
      packet.tileOrigin[n * 2 + 1] = j0;
      const coarse = stride % COARSE === 0;
      const src = packet.tileSource;
      src[n * 4] = coarse ? i0 / COARSE : i0 - this.drawnI;
      src[n * 4 + 1] = coarse ? j0 / COARSE : j0 - this.drawnJ;
      src[n * 4 + 2] = coarse ? stride / COARSE : stride;
      src[n * 4 + 3] = coarse ? SOURCE_MAP : SOURCE_WINDOW;
      packet.tilePass[n] = (seen ? cam.passes(x0, skirt, z0, x0 + size, y1, z0 + size) : 0) | (bits * TILE_CASTS);
      this.low[n] = y0;
      this.high[n] = y1;
      packet.tileCount = n + 1;
      if (seen) packet.triangles += TILE_QUADS * TILE_QUADS * 2;
    }
    return true;
  }

  /** Whether a node's samples, as far as the map has them, lie inside the window drawn. */
  private inside(i0: number, j0: number, span: number): boolean {
    const hf = this.hf;
    const w = this.size.width[SOURCE_WINDOW]!, h = this.size.height[SOURCE_WINDOW]!;
    return this.drawn >= 0 && i0 >= this.drawnI && j0 >= this.drawnJ && Math.min(i0 + span, hf.nx - 1) < this.drawnI + w && Math.min(j0 + span, hf.nz - 1) < this.drawnJ + h;
  }

  /**
   * Where the fine window is centred: on the camera, or through a sight that magnifies far on what it is on (D1087), where
   * the ground round the body cannot be seen. NaN for the camera.
   */
  centreX = NaN;
  centreZ = NaN;

  /**
   * Keeps a window round the camera. Once the camera is WINDOW_MOVE from the middle of the one drawn, the window steps to
   * a corner round it, a strip of the columns or rows it gains a frame, SNAP of them at least and more within the frame's
   * upload allowance; each frame's window is whole. A corner that shares nothing with the window drawn is filled again,
   * rows a frame within the allowance, drawn from the frame its last rows go and nothing finer than the whole map's pair
   * meanwhile. The first is filled whole. Samples of the window drawn that changed are put again, a band a frame.
   */
  private follow(cam: Camera, p: FramePacket, budget?: GroundBudget): void {
    const hf = this.hf;
    const w = this.size.width[SOURCE_WINDOW]!, h = this.size.height[SOURCE_WINDOW]!;
    const corner = (at: number, n: number, side: number): number => Math.max(0, Math.min(n - side, Math.round((at / hf.cell - (side - 1) / 2) / SNAP) * SNAP));
    const cx = Number.isNaN(this.centreX) ? cam.x : this.centreX, cz = Number.isNaN(this.centreZ) ? cam.z : this.centreZ;
    const i = corner(cx, hf.nx, w), j = corner(cz, hf.nz, h);
    const g = p.groundWindow;
    g[3] = -1;
    p.groundPartCount = 0;
    this.used = 0;
    if (this.drawn >= 0) {
      const off = Math.max(Math.abs(cx / hf.cell - this.drawnI - (w - 1) / 2), Math.abs(cz / hf.cell - this.drawnJ - (h - 1) / 2)) * hf.cell;
      if (off >= WINDOW_MOVE && (i !== this.drawnI || j !== this.drawnJ)) {
        this.goalI = i;
        this.goalJ = j;
      }
      if (Math.abs(this.goalI - this.drawnI) >= w || Math.abs(this.goalJ - this.drawnJ) >= h) this.refill(this.goalI, this.goalJ);
    } else if (!this.filling || i !== this.fillI || j !== this.fillJ) {
      if (this.fresh) budget?.reserve("terrain", this.size.bytes);
      this.refill(i, j);
    }
    // Rows a frame within the allowance, at least one; all of them while the first window comes or with no allowance.
    const band = (left: number, bytes: number): number => (this.fresh || !budget ? left : Math.min(left, Math.max(1, Math.floor(budget.left / bytes))));
    if (this.filling) {
      const rows = band(h - this.row, w * SAMPLE_BYTES);
      budget?.spend(rows * w * SAMPLE_BYTES);
      this.put(p, this.fillI, this.fillJ + this.row, w, rows);
      this.row += rows;
      if (this.row === h) {
        this.drawn = 0;
        this.drawnI = this.goalI = this.fillI;
        this.drawnJ = this.goalJ = this.fillJ;
        this.filling = this.fresh = false;
      }
    } else if (this.drawnI !== this.goalI || this.drawnJ !== this.goalJ) this.step(p, w, h, budget);
    else {
      // Of the samples that changed, those inside the window drawn, a band of their rows a frame.
      const i0 = Math.max(this.patchI, this.drawnI), i1 = Math.min(this.patchI1, this.drawnI + w);
      const j0 = Math.max(this.patchJ, this.drawnJ), j1 = Math.min(this.patchJ1, this.drawnJ + h);
      if (i0 < i1 && j0 < j1) {
        const rows = band(j1 - j0, (i1 - i0) * SAMPLE_BYTES);
        budget?.spend(rows * (i1 - i0) * SAMPLE_BYTES);
        this.put(p, i0, j0, i1 - i0, rows);
        this.patchI = i0;
        this.patchJ = j0 + rows;
        this.patchI1 = i1;
        this.patchJ1 = j1;
      } else this.patchI1 = this.patchI;
    }
    if (p.groundPartCount > 0) {
      g[3] = 0;
      p.groundHeights = this.heights;
      p.groundTint = this.tint;
    }
    g[0] = this.drawn;
    g[1] = this.drawnI;
    g[2] = this.drawnJ;
  }

  /** From now on no window is held: the pictures are filled round corner (i, j), rows a frame. */
  private refill(i: number, j: number): void {
    this.drawn = -1;
    this.filling = true;
    this.fillI = this.goalI = i;
    this.fillJ = this.goalJ = j;
    this.row = 0;
    this.patchI1 = this.patchI;
  }

  /**
   * The window drawn a step on towards its goal: along x, SNAP columns at least and as many more as the allowance has room
   * for, then along z with what is left; the samples it gains go on the card.
   */
  private step(p: FramePacket, w: number, h: number, budget?: GroundBudget): void {
    this.framing = p;
    const fromI = this.drawnI, fromJ = this.drawnJ;
    const along = (left: number, bytes: number, least: number): number => (budget ? Math.min(left, Math.max(least, Math.floor(budget.left / bytes / SNAP) * SNAP)) : left);
    const di = along(Math.abs(this.goalI - fromI), h * SAMPLE_BYTES, SNAP);
    budget?.spend(di * h * SAMPLE_BYTES);
    this.drawnI += Math.sign(this.goalI - fromI) * di;
    const dj = along(Math.abs(this.goalJ - fromJ), w * SAMPLE_BYTES, di > 0 ? 0 : SNAP);
    budget?.spend(dj * w * SAMPLE_BYTES);
    this.drawnJ += Math.sign(this.goalJ - fromJ) * dj;
    gained(fromI, fromJ, this.drawnI, this.drawnJ, w, h, this.putGained);
  }

  private framing: FramePacket | null = null;
  private readonly putGained = (i0: number, j0: number, w: number, h: number): void => this.put(this.framing!, i0, j0, w, h);

  /**
   * The samples of map rectangle (i0, j0) of `w` by `h` put together for the card from the heightfield: in rectangles that
   * do not cross the pictures' edges, where they wrap, a view of each.
   */
  private put(p: FramePacket, i0: number, j0: number, w: number, h: number): void {
    const hf = this.hf, side = this.size.width[SOURCE_WINDOW]!, down = this.size.height[SOURCE_WINDOW]!;
    if (this.heights.length === 0) {
      this.heights = new Uint16Array(side * down);
      this.tint = new Uint8Array(side * down);
    }
    for (let y = j0; y < j0 + h; ) {
      const ty = y % down, rows = Math.min(j0 + h - y, down - ty);
      for (let x = i0; x < i0 + w; ) {
        const tx = x % side, cols = Math.min(i0 + w - x, side - tx), n = p.groundPartCount++, at = this.used;
        if (n >= GROUND_PARTS) throw new Error("the terrain window's parts overflow the frame's list");
        const parts = p.groundParts;
        parts[n * 5] = tx;
        parts[n * 5 + 1] = ty;
        parts[n * 5 + 2] = cols;
        parts[n * 5 + 3] = rows;
        parts[n * 5 + 4] = at;
        const v = hf.view(x, y, x + cols - 1, y + rows - 1);
        for (let r = 0; r < rows; r++) this.heights.set(v.heights.subarray(v.off + (y + r) * v.stride + x, v.off + (y + r) * v.stride + x + cols), at + r * cols);
        const t = hf.tints(x, y, x + cols - 1, y + rows - 1);
        if (t.tint.length > 0) for (let r = 0; r < rows; r++) this.tint.set(t.tint.subarray(t.off + (y + r) * t.stride + x, t.off + (y + r) * t.stride + x + cols), at + r * cols);
        this.used += cols * rows;
        x += cols;
      }
      y += rows;
    }
  }

  /**
   * The cells of the roads' frame (Heightfield `road`) the picture under the window drawn takes this frame, into
   * `p.roadParts`: all of them the frame a window is first drawn round a corner that shares none of the one before,
   * those the window gains as it steps, and those the squares that came or went since cover, a band a frame within the
   * upload allowance.
   */
  private followRoad(p: FramePacket, budget?: GroundBudget): void {
    const road = this.hf.road, f = this.roadFor;
    p.roadPartCount = 0;
    this.roadUsed = 0;
    if (!road || this.drawn < 0) return;
    const rw = roadSamples(this.size.width[SOURCE_WINDOW]!), rh = roadSamples(this.size.height[SOURCE_WINDOW]!);
    const ci = this.drawnI / ROAD_STEP, cj = this.drawnJ / ROAD_STEP, bytes = ROAD_PLANES;
    const whole = road !== this.roadOf || f[0]! < 0 || Math.abs(ci - f[1]!) >= rw || Math.abs(cj - f[2]!) >= rh || !road.changedSince(this.roadVersion, this.roadChanges);
    this.roadOf = road;
    this.roadVersion = road.version;
    if (whole) {
      this.roadI1 = this.roadI;
      budget?.spend(rw * rh * bytes);
      this.putRoad(p, ci, cj, rw, rh);
    } else {
      const c = this.roadChanges;
      for (let k = 0; k < c.length; k += 4) {
        if (c[k]! >= ci + rw || c[k + 2]! <= ci || c[k + 1]! >= cj + rh || c[k + 3]! <= cj) continue;
        const open = this.roadI < this.roadI1 && this.roadJ < this.roadJ1;
        this.roadI = open ? Math.min(this.roadI, c[k]!) : c[k]!;
        this.roadJ = open ? Math.min(this.roadJ, c[k + 1]!) : c[k + 1]!;
        this.roadI1 = open ? Math.max(this.roadI1, c[k + 2]!) : c[k + 2]!;
        this.roadJ1 = open ? Math.max(this.roadJ1, c[k + 3]!) : c[k + 3]!;
      }
      if (ci !== f[1] || cj !== f[2]) {
        budget?.spend((rw * rh - (rw - Math.abs(ci - f[1]!)) * (rh - Math.abs(cj - f[2]!))) * bytes);
        this.framing = p;
        gained(f[1]!, f[2]!, ci, cj, rw, rh, this.putRoadGained);
      } else {
        const i0 = Math.max(this.roadI, ci), i1 = Math.min(this.roadI1, ci + rw), j0 = Math.max(this.roadJ, cj), j1 = Math.min(this.roadJ1, cj + rh);
        if (i0 < i1 && j0 < j1) {
          const rows = !budget ? j1 - j0 : Math.min(j1 - j0, Math.max(1, Math.floor(budget.left / ((i1 - i0) * bytes))));
          budget?.spend(rows * (i1 - i0) * bytes);
          this.putRoad(p, i0, j0, i1 - i0, rows);
          this.roadI = i0;
          this.roadJ = j0 + rows;
          this.roadI1 = i1;
          this.roadJ1 = j1;
        } else this.roadI1 = this.roadI;
      }
    }
    f[0] = 0;
    f[1] = ci;
    f[2] = cj;
    if (p.roadPartCount > 0) p.roadBytes = this.roadBytes;
  }

  private readonly putRoadGained = (i0: number, j0: number, w: number, h: number): void => this.putRoad(this.framing!, i0, j0, w, h);

  /** The roads' frame's cells of rectangle (i0, j0) of `w` by `h` copied for the card, in rectangles that do not cross the picture's edges. */
  private putRoad(p: FramePacket, i0: number, j0: number, w: number, h: number): void {
    const road = this.hf.road!, side = roadSamples(this.size.width[SOURCE_WINDOW]!), down = roadSamples(this.size.height[SOURCE_WINDOW]!);
    if (this.roadBytes.length === 0) this.roadBytes = new Uint8Array(side * down * ROAD_PLANES);
    for (let y = j0; y < j0 + h; ) {
      const ty = y % down, rows = Math.min(j0 + h - y, down - ty);
      for (let x = i0; x < i0 + w; ) {
        const tx = x % side, cols = Math.min(i0 + w - x, side - tx), n = p.roadPartCount++, at = this.roadUsed;
        if (n >= GROUND_PARTS) throw new Error("the roads' frame's parts overflow the frame's list");
        const parts = p.roadParts;
        parts[n * 5] = tx;
        parts[n * 5 + 1] = ty;
        parts[n * 5 + 2] = cols;
        parts[n * 5 + 3] = rows;
        parts[n * 5 + 4] = at;
        road.copy(x, y, cols, rows, this.roadBytes.subarray(at * ROAD_PLANES));
        this.roadUsed += cols * rows;
        x += cols;
      }
      y += rows;
    }
  }
}

/**
 * What a window `w` by `h` gains moving its corner from (i0, j0) to (i1, j1), which it overlaps: the columns it gains
 * with all its new rows, then the rows it gains with the columns it kept, each to `put` as a map rectangle.
 */
export function gained(i0: number, j0: number, i1: number, j1: number, w: number, h: number, put: (i: number, j: number, w: number, h: number) => void): void {
  if (i1 !== i0) put(i1 > i0 ? i0 + w : i1, j1, Math.abs(i1 - i0), h);
  if (j1 !== j0) put(Math.max(i0, i1), j1 > j0 ? j0 + h : j1, w - Math.abs(i1 - i0), Math.abs(j1 - j0));
}
