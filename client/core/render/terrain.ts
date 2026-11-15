// A quadtree over the map. A node far enough away is drawn as one tile of 32 x 32 quads. Otherwise its four children are considered.
// Every tile has the same triangle count, so cost follows screen coverage. Level 0 tiles are single chunks and match the collision surface.
// A tile reads its heights and tints from one of two pairs of pictures on the card (D253): the whole map at every COARSE-th
// sample, or a window WINDOW samples a side round the camera. Tiles of COARSE samples a quad and coarser read the whole
// map's; finer ones read the window's, and a node is cut into those only where it lies inside the window.

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { Camera } from "./camera.ts";
import { MAX_TILES, SOURCE_MAP, SOURCE_WINDOW, TILE_QUADS, type FramePacket } from "./packet.ts";

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

/** Each source's pictures, SOURCE_MAP's then SOURCE_WINDOW's: samples across and down, and metres between samples. */
export interface GroundSize {
  readonly width: readonly number[];
  readonly height: readonly number[];
  readonly cell: readonly number[];
  /** Bytes on the card: the whole map's pair and two copies of the window's, one drawn while the other is filled. */
  readonly bytes: number;
}

export function groundSize(hf: Pick<Heightfield, "nx" | "nz" | "cell">): GroundSize {
  const width = [Math.ceil((hf.nx - 1) / COARSE) + 1, Math.min(WINDOW, hf.nx)];
  const height = [Math.ceil((hf.nz - 1) / COARSE) + 1, Math.min(WINDOW, hf.nz)];
  return { width, height, cell: [hf.cell * COARSE, hf.cell], bytes: (width[0]! * height[0]! + 2 * width[1]! * height[1]!) * SAMPLE_BYTES };
}

/** The whole map's pair: the height and tint of every COARSE-th sample. A map's side is whole chunks, so its last sample is one. */
export function coarseGround(hf: Heightfield): { heights: Uint16Array; tint: Uint8Array } {
  const size = groundSize(hf);
  const [w, h] = [size.width[SOURCE_MAP]!, size.height[SOURCE_MAP]!];
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

  /** The tiles to draw, and the window's work this frame. Without a budget a window is filled whole in the frame it is wanted. */
  select(cam: Camera, packet: FramePacket, viewDistance: number, budget?: GroundBudget): void {
    this.follow(cam, packet, budget);
    this.coarser = 0;
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
      if (!cam.boxVisible(x0, y0, z0, x0 + size, y1, z0 + size)) continue;
      const dx = x0 > 0 ? x0 : x0 + size < 0 ? -(x0 + size) : 0;
      const dz = z0 > 0 ? z0 : z0 + size < 0 ? -(z0 + size) : 0;
      const dy = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > viewDistance) continue;
      const stride = (size / hf.cell / TILE_QUADS) | 0;
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
        this.coarser++;
      }
      const n = packet.tileCount;
      if (n === MAX_TILES) return;
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
      // Its skirt hangs two quads under its lowest sample.
      packet.tilePass[n] = cam.passes(x0, y0 - 2 * stride * hf.cell, z0, x0 + size, y1, z0 + size);
      packet.tileCount = n + 1;
      packet.triangles += TILE_QUADS * TILE_QUADS * 2;
    }
  }

  /** Whether a node's samples, as far as the map has them, lie inside the window drawn. */
  private inside(i0: number, j0: number, span: number): boolean {
    const hf = this.hf;
    const [w, h] = [this.size.width[SOURCE_WINDOW]!, this.size.height[SOURCE_WINDOW]!];
    return this.drawn >= 0 && i0 >= this.drawnI && j0 >= this.drawnJ && Math.min(i0 + span, hf.nx - 1) < this.drawnI + w && Math.min(j0 + span, hf.nz - 1) < this.drawnJ + h;
  }

  /**
   * Keeps a window round the camera. Once the camera is WINDOW_MOVE from the middle of the one drawn, the other copy is
   * filled round it, rows a frame within the frame's upload allowance, and drawn from the frame its last rows go. The
   * first is filled whole: until a window is in, nothing finer than the whole map's pair is drawn.
   */
  private follow(cam: Camera, p: FramePacket, budget?: GroundBudget): void {
    const hf = this.hf;
    const [w, h] = [this.size.width[SOURCE_WINDOW]!, this.size.height[SOURCE_WINDOW]!];
    const corner = (at: number, n: number, side: number): number => Math.max(0, Math.min(n - side, Math.round((at / hf.cell - (side - 1) / 2) / SNAP) * SNAP));
    const [i, j] = [corner(cam.x, hf.nx, w), corner(cam.z, hf.nz, h)];
    const off = Math.max(Math.abs(cam.x / hf.cell - this.drawnI - (w - 1) / 2), Math.abs(cam.z / hf.cell - this.drawnJ - (h - 1) / 2)) * hf.cell;
    const wanted = this.drawn < 0 || (off >= WINDOW_MOVE && (i !== this.drawnI || j !== this.drawnJ));
    if (wanted && (this.fill < 0 || i !== this.fillI || j !== this.fillJ)) {
      if (this.drawn < 0) budget?.reserve("terrain", this.size.bytes);
      [this.fill, this.fillI, this.fillJ, this.row] = [this.drawn < 0 ? 0 : 1 - this.drawn, i, j, 0];
    }
    const g = p.groundWindow;
    g[3] = -1;
    if (this.fill >= 0) {
      const bytes = w * SAMPLE_BYTES;
      const rows = this.drawn < 0 || !budget ? h - this.row : Math.min(h - this.row, Math.max(1, Math.floor(budget.left / bytes)));
      budget?.spend(rows * bytes);
      g.set([this.fill, this.fillI, this.fillJ, this.row, rows], 3);
      this.row += rows;
      if (this.row === h) [this.drawn, this.drawnI, this.drawnJ, this.fill] = [this.fill, this.fillI, this.fillJ, -1];
    }
    g.set([this.drawn, this.drawnI, this.drawnJ]);
  }
}
