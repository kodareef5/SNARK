// A quadtree over the map. A node far enough away is drawn as one tile of 32 x 32 quads. Otherwise its four children are considered.
// Every tile has the same triangle count, so cost follows screen coverage. Level 0 tiles are single chunks and match the collision surface.
// A tile reads its heights and tints from one of two pairs of pictures on the card (D253): the whole map at every COARSE-th
// sample, or a window WINDOW samples a side round the camera. Tiles of COARSE samples a quad and coarser read the whole
// map's; finer ones read the window's, and a node is cut into those only where it lies inside the window.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { Camera } from "./camera.ts";
import { MAX_TILES, SOURCE_MAP, SOURCE_WINDOW, TILE_CASTS, TILE_QUADS, type FramePacket } from "./packet.ts";

/** The whole map's pair takes every fourth sample: 1,025 a side on an 8 km map. */
export const COARSE = 4;
/** The window's side in samples: 2 km at 2 m. */
export const WINDOW = 1025;
/** The window is filled again round the camera once the camera is this many metres from its middle along either axis. */
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
  /** Bytes on the card: the whole map's pair and two copies of the window's, one drawn while the other is filled. */
  readonly bytes: number;
}

/** The cell, of `n` cells `size` metres wide, that `v` metres falls in, held to the row. */
function cellOf(v: number, size: number, n: number): number {
  return Math.max(0, Math.min(n - 1, Math.floor(v / size)));
}

export function groundSize(hf: Pick<Heightfield, "nx" | "nz" | "cell">): GroundSize {
  const width = [Math.ceil((hf.nx - 1) / COARSE) + 1, Math.min(WINDOW, hf.nx)];
  const height = [Math.ceil((hf.nz - 1) / COARSE) + 1, Math.min(WINDOW, hf.nz)];
  return { width, height, cell: [hf.cell * COARSE, hf.cell], bytes: (width[0]! * height[0]! + 2 * width[1]! * height[1]!) * SAMPLE_BYTES };
}

/** The whole map's pair: the height and tint of every COARSE-th sample. A map's side is whole chunks, so its last sample is one. */
export function coarseGround(hf: Heightfield): { heights: Uint16Array; tint: Uint8Array } {
  const size = groundSize(hf);
  const w = size.width[SOURCE_MAP]!, h = size.height[SOURCE_MAP]!;
  const heights = new Uint16Array(w * h);
  const tint = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const at = Math.min(j * COARSE, hf.nz - 1) * hf.nx + Math.min(i * COARSE, hf.nx - 1);
      heights[j * w + i] = hf.heights[at]!;
      tint[j * w + i] = hf.tint[at]!;
    }
  }
  return { heights, tint };
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
  private readonly hf: Heightfield;
  private readonly minY: Float32Array[] = [];
  private readonly maxY: Float32Array[] = [];
  private readonly width: number[] = [];
  private readonly stack = new Int32Array(4 * 64);
  /**
   * The window drawn with: its copy, 0 or 1, or -1 while there is none, and the sample of its corner. Then the copy
   * being filled, or -1, the corner it is filled round and the next row to fill.
   */
  private drawn = -1;
  private drawnI = 0;
  private drawnJ = 0;
  private fill = -1;
  private fillI = 0;
  private fillJ = 0;
  private row = 0;

  constructor(hf: Heightfield) {
    this.hf = hf;
    this.size = groundSize(hf);
    const cx = hf.dims.chunksX;
    const cz = hf.dims.chunksZ;
    let levels = 1;
    while (1 << (levels - 1) < Math.max(cx, cz)) levels++;
    this.levels = levels;

    // Height range per node, finest level first.
    const per = Math.round(CHUNK_SIZE / hf.cell);
    for (let level = 0; level < levels; level++) {
      const w = Math.ceil(cx / (1 << level));
      const d = Math.ceil(cz / (1 << level));
      const lo = new Float32Array(w * d).fill(Infinity);
      const hi = new Float32Array(w * d).fill(-Infinity);
      if (level === 0) {
        for (let tz = 0; tz < d; tz++) {
          for (let tx = 0; tx < w; tx++) {
            let a = Infinity;
            let b = -Infinity;
            for (let j = tz * per; j <= (tz + 1) * per; j++) {
              for (let i = tx * per; i <= (tx + 1) * per; i++) {
                const y = hf.sample(i, j);
                if (y < a) a = y;
                if (y > b) b = y;
              }
            }
            lo[tz * w + tx] = a;
            hi[tz * w + tx] = b;
          }
        }
      } else {
        const pw = this.width[level - 1]!;
        const plo = this.minY[level - 1]!;
        const phi = this.maxY[level - 1]!;
        const pd = plo.length / pw;
        for (let tz = 0; tz < d; tz++) {
          for (let tx = 0; tx < w; tx++) {
            for (let k = 0; k < 4; k++) {
              const px = tx * 2 + (k & 1);
              const pz = tz * 2 + (k >> 1);
              if (px >= pw || pz >= pd) continue;
              lo[tz * w + tx] = Math.min(lo[tz * w + tx]!, plo[pz * pw + px]!);
              hi[tz * w + tx] = Math.max(hi[tz * w + tx]!, phi[pz * pw + px]!);
            }
          }
        }
      }
      this.width.push(w);
      this.minY.push(lo);
      this.maxY.push(hi);
    }
  }

  /** After a lost context the card holds no window, and the next frame fills one whole. */
  reset(): void {
    this.drawn = this.fill = -1;
  }

  /**
   * The tiles to draw, and the window's work this frame. Without a budget a window is filled whole in the frame it is
   * wanted. With `casts`, each tile is marked with the shadow cascades it casts into.
   */
  select(cam: Camera, packet: FramePacket, viewDistance: number, budget?: GroundBudget, casts?: CastTest): void {
    this.follow(cam, packet, budget);
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
      // Children finer than the whole map's pair read the window, so a node outside it is drawn as it is.
      if (level > 0 && dist < size * this.detail) {
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
   * Keeps a window round the camera. Once the camera is WINDOW_MOVE from the middle of the one drawn, the other copy is
   * filled round it, rows a frame within the frame's upload allowance, and drawn from the frame its last rows go. The
   * first is filled whole: until a window is in, nothing finer than the whole map's pair is drawn.
   */
  private follow(cam: Camera, p: FramePacket, budget?: GroundBudget): void {
    const hf = this.hf;
    const w = this.size.width[SOURCE_WINDOW]!, h = this.size.height[SOURCE_WINDOW]!;
    const corner = (at: number, n: number, side: number): number => Math.max(0, Math.min(n - side, Math.round((at / hf.cell - (side - 1) / 2) / SNAP) * SNAP));
    const i = corner(cam.x, hf.nx, w), j = corner(cam.z, hf.nz, h);
    const off = Math.max(Math.abs(cam.x / hf.cell - this.drawnI - (w - 1) / 2), Math.abs(cam.z / hf.cell - this.drawnJ - (h - 1) / 2)) * hf.cell;
    const wanted = this.drawn < 0 || (off >= WINDOW_MOVE && (i !== this.drawnI || j !== this.drawnJ));
    if (wanted && (this.fill < 0 || i !== this.fillI || j !== this.fillJ)) {
      if (this.drawn < 0) budget?.reserve("terrain", this.size.bytes);
      this.fill = this.drawn < 0 ? 0 : 1 - this.drawn;
      this.fillI = i;
      this.fillJ = j;
      this.row = 0;
    }
    const g = p.groundWindow;
    g[3] = -1;
    if (this.fill >= 0) {
      const bytes = w * SAMPLE_BYTES;
      const rows = this.drawn < 0 || !budget ? h - this.row : Math.min(h - this.row, Math.max(1, Math.floor(budget.left / bytes)));
      budget?.spend(rows * bytes);
      g[3] = this.fill;
      g[4] = this.fillI;
      g[5] = this.fillJ;
      g[6] = this.row;
      g[7] = rows;
      this.row += rows;
      if (this.row === h) { this.drawn = this.fill; this.drawnI = this.fillI; this.drawnJ = this.fillJ; this.fill = -1; }
    }
    g[0] = this.drawn;
    g[1] = this.drawnI;
    g[2] = this.drawnJ;
  }
}
