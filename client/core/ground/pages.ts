// The page's 2 m ground, held a sector at a time: each page its sector's heights, tints and ground classes as its part
// brought them, its edges among them. A sample no page holds stands in as Heightfield.fill would have laid it: its
// overview's, else the head's coarse picture's (overviews.ts). A sample on the edge of a page held is the page's, as a fill
// leaves a chunk's own. The server, the tools and the tests keep the dense Heightfield; every reader asks through its
// methods and views, so this one answers from its pages (planning/workstreams/maps-v3.md, phase 6).

import { CHUNK_SIZE, SECTOR_CHUNKS, type MapDims } from "../../../shared/coords.ts";
import { Heightfield, TERRAIN_CELL, type GroundView, type TintView } from "../../../shared/world/heightfield.ts";
import type { GroundPiece, Square } from "../../../shared/world/mapfile.ts";
import { streetClass } from "../../../shared/world/streets.ts";

/** What a sample no page holds stands in with: its stored height and its tint. */
export interface StandIn {
  /** Its stored height, and its tint from bit 16. */
  sample(i: number, j: number): number;
}

/** A sector's ground held. */
interface Page {
  readonly sq: Square;
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  readonly ground: Uint8Array;
  /** Its first sample, its samples a row and down, and its ground classes a row. */
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly d: number;
  readonly gw: number;
  /** Itself as Heightfield.view and tints give it. */
  readonly view: GroundView;
  readonly tints: TintView;
}

/** Samples a chunk's side spans. */
const PER = CHUNK_SIZE / TERRAIN_CELL;

/** A sector's chunks, cx0, cz0 up to cx1, cz1. */
export type Chunks = Pick<Square, "cx0" | "cz0" | "cx1" | "cz1">;

/** The bytes a sector's page holds. */
export const pageBytes = (sq: Chunks): number => {
  const w = (sq.cx1 - sq.cx0) * PER + 1, d = (sq.cz1 - sq.cz0) * PER + 1;
  return w * d * 3 + (((w - 1) >> 1) + 1) * (((d - 1) >> 1) + 1);
};

export class GroundPages extends Heightfield {
  /** By sector on the lattice, from the map's first: its page or null. */
  private readonly pages: (Page | null)[];
  private readonly across: number;
  /** Per chunk column and row, its sector's column and row from the first. */
  private readonly colOf: Int32Array;
  private readonly rowOf: Int32Array;
  private readonly stand: StandIn;
  /** The copies a view or tints across pages hands out, good until the next call. */
  private scratch = new Uint16Array(0);
  private scratchTint = new Uint8Array(0);
  private readonly box: GroundView = { heights: this.scratch, stride: 0, off: 0 };
  private readonly tintBox: TintView = { tint: this.scratchTint, stride: 0, off: 0 };
  /** Bytes of the pages held, and how many. */
  bytes = 0;
  count = 0;

  constructor(dims: MapDims, minY: number, stepY: number, stand: StandIn) {
    super(dims, TERRAIN_CELL, minY, stepY, undefined, undefined, undefined, true);
    this.stand = stand;
    // A chunk lies in one sector, so a view a chunk wide is in one page.
    this.span = PER;
    const { chunksX, chunksZ, frameX, frameZ } = this.dims;
    const c0 = Math.floor(frameX / SECTOR_CHUNKS), r0 = Math.floor(frameZ / SECTOR_CHUNKS);
    this.colOf = Int32Array.from({ length: chunksX }, (_, cx) => Math.floor((cx + frameX) / SECTOR_CHUNKS) - c0);
    this.rowOf = Int32Array.from({ length: chunksZ }, (_, cz) => Math.floor((cz + frameZ) / SECTOR_CHUNKS) - r0);
    this.across = this.colOf[chunksX - 1]! + 1;
    this.pages = new Array<Page | null>(this.across * (this.rowOf[chunksZ - 1]! + 1)).fill(null);
    this.holdNone();
  }

  /** The page of the sector chunk (cx, cz) lies in, or null. */
  private chunkPage(cx: number, cz: number): Page | null {
    return this.pages[this.rowOf[cz]! * this.across + this.colOf[cx]!]!;
  }

  /** A page that holds sample (i, j), its edges among them, or null. */
  private pageOf(i: number, j: number): Page | null {
    const { chunksX, chunksZ } = this.dims;
    const cx = Math.min(chunksX - 1, (i / PER) | 0), cz = Math.min(chunksZ - 1, (j / PER) | 0);
    const p = this.chunkPage(cx, cz);
    if (p) return p;
    const left = i % PER === 0 && i > 0 && i / PER - 1 < chunksX, up = j % PER === 0 && j > 0 && j / PER - 1 < chunksZ;
    return (left && this.chunkPage(i / PER - 1, cz)) || (up && this.chunkPage(cx, j / PER - 1)) || (left && up && this.chunkPage(i / PER - 1, j / PER - 1)) || null;
  }

  /** Sector `piece.sq`'s ground held from now on: its part's own arrays, kept as they came. */
  put(piece: GroundPiece): void {
    const sq = piece.sq, w = (sq.cx1 - sq.cx0) * PER + 1, d = (sq.cz1 - sq.cz0) * PER + 1, i0 = sq.cx0 * PER, j0 = sq.cz0 * PER;
    const k = this.rowOf[sq.cz0]! * this.across + this.colOf[sq.cx0]!;
    if (this.pages[k]) this.bytes -= pageBytes(sq);
    else this.count++;
    this.pages[k] = { sq, heights: piece.heights, tint: piece.tint, ground: piece.ground, i0, j0, w, d, gw: ((w - 1) >> 1) + 1, view: { heights: piece.heights, stride: w, off: -(j0 * w + i0) }, tints: { tint: piece.tint, stride: w, off: -(j0 * w + i0) } };
    this.bytes += pageBytes(sq);
    this.hold(sq.cx0, sq.cz0, sq.cx1, sq.cz1);
  }

  /** Sector `sq`'s page let go: its samples stand in again, a change as a fill is. */
  drop(sq: Chunks): void {
    const k = this.rowOf[sq.cz0]! * this.across + this.colOf[sq.cx0]!;
    if (!this.pages[k]) return;
    this.pages[k] = null;
    this.bytes -= pageBytes(sq);
    this.count--;
    for (let z = sq.cz0; z < sq.cz1; z++) this.exact.fill(0, z * this.dims.chunksX + sq.cx0, z * this.dims.chunksX + sq.cx1);
    this.standing(sq.cx0, sq.cz0, sq.cx1, sq.cz1);
  }

  /** The arrays of every page held. */
  held(): ArrayBufferView[][] {
    return this.pages.filter((p): p is Page => p !== null).map((p) => [p.heights, p.tint, p.ground]);
  }

  /** Whether sector `sq`'s page is held. */
  holds(sq: Chunks): boolean {
    return this.pages[this.rowOf[sq.cz0]! * this.across + this.colOf[sq.cx0]!] !== null;
  }

  /** The stand-ins of chunks cx0, cz0 up to cx1, cz1 changed (an overview came or went there): a change as a fill is. */
  standing(cx0: number, cz0: number, cx1: number, cz1: number): void {
    this.changes.push(cx0, cz0, cx1, cz1);
    this.filled.push(true);
  }

  override fill(): void {
    throw new Error("ground pages are not filled: their stand-ins are read where no page is held");
  }

  override setSample(): void {
    throw new Error("ground pages are set a sector at a time");
  }

  override stepsAt(i: number, j: number): number {
    const p = this.pageOf(i, j);
    return p ? p.heights[(j - p.j0) * p.w + i - p.i0]! : this.stand.sample(i, j) & 0xffff;
  }

  override tintOf(i: number, j: number): number {
    const p = this.pageOf(i, j);
    return p ? p.tint[(j - p.j0) * p.w + i - p.i0]! : this.stand.sample(i, j) >>> 16;
  }

  override sample(i: number, j: number): number {
    return this.minY + this.stepsAt(i, j) * this.stepY;
  }

  override groundClassAt(x: number, z: number): number {
    const i = Math.round(x / this.cell), j = Math.round(z / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0;
    const p = this.pageOf(i, j);
    const cell = p ? p.ground[((j >> 1) - (p.j0 >> 1)) * p.gw + (i >> 1) - (p.i0 >> 1)]! : 0;
    return this.streets ? streetClass(this.streets, x, z, cell) : cell;
  }

  override heightAt(x: number, z: number): number {
    const nx = this.nx;
    let fx = x / this.cell;
    let fz = z / this.cell;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0;
    else if (fz > this.nz - 1) fz = this.nz - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > this.nz - 2) j = this.nz - 2;
    const u = fx - i;
    const v = fz - j;
    // A cell lies in its chunk's page, its far edges among it.
    const p = this.chunkPage((i / PER) | 0, (j / PER) | 0);
    let h00: number, h10: number, h01: number, h11: number;
    if (p) {
      const w = p.w, k = (j - p.j0) * w + i - p.i0, hts = p.heights;
      h00 = hts[k]!;
      h10 = hts[k + 1]!;
      h01 = hts[k + w]!;
      h11 = hts[k + w + 1]!;
    } else {
      h00 = this.stepsAt(i, j);
      h10 = this.stepsAt(i + 1, j);
      h01 = this.stepsAt(i, j + 1);
      h11 = this.stepsAt(i + 1, j + 1);
    }
    const q = u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
    return this.minY + q * this.stepY;
  }

  override slopeCosAt(x: number, z: number): number {
    const nx = this.nx;
    let fx = x / this.cell;
    let fz = z / this.cell;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0;
    else if (fz > this.nz - 1) fz = this.nz - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > this.nz - 2) j = this.nz - 2;
    const p = this.chunkPage((i / PER) | 0, (j / PER) | 0);
    let h00: number, h10: number, h01: number, h11: number;
    if (p) {
      const w = p.w, k = (j - p.j0) * w + i - p.i0, hts = p.heights;
      h00 = hts[k]!;
      h10 = hts[k + 1]!;
      h01 = hts[k + w]!;
      h11 = hts[k + w + 1]!;
    } else {
      h00 = this.stepsAt(i, j);
      h10 = this.stepsAt(i + 1, j);
      h01 = this.stepsAt(i, j + 1);
      h11 = this.stepsAt(i + 1, j + 1);
    }
    let dx: number;
    let dz: number;
    if (fx - i >= fz - j) {
      dx = h10 - h00;
      dz = h11 - h10;
    } else {
      dx = h11 - h01;
      dz = h01 - h00;
    }
    const s = this.stepY / this.cell;
    dx *= s;
    dz *= s;
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** The page that holds the whole box from (i0, j0) to (i1, j1), or null. */
  private within(i0: number, j0: number, i1: number, j1: number): Page | null {
    const p = this.chunkPage(Math.min(this.dims.chunksX - 1, (i0 / PER) | 0), Math.min(this.dims.chunksZ - 1, (j0 / PER) | 0));
    return p && i0 >= p.i0 && j0 >= p.j0 && i1 < p.i0 + p.w && j1 < p.j0 + p.d ? p : null;
  }

  override view(i0: number, j0: number, i1: number, j1: number): GroundView {
    const p = this.within(i0, j0, i1, j1);
    if (p) return p.view;
    const w = i1 - i0 + 1, n = w * (j1 - j0 + 1);
    if (this.scratch.length < n) this.box.heights = this.scratch = new Uint16Array(n);
    this.copy(i0, j0, i1, j1, this.scratch, null);
    this.box.stride = w;
    this.box.off = -(j0 * w + i0);
    return this.box;
  }

  override tints(i0: number, j0: number, i1: number, j1: number): TintView {
    const p = this.within(i0, j0, i1, j1);
    if (p) return p.tints;
    const w = i1 - i0 + 1, n = w * (j1 - j0 + 1);
    if (this.scratchTint.length < n) this.tintBox.tint = this.scratchTint = new Uint8Array(n);
    this.copy(i0, j0, i1, j1, null, this.scratchTint);
    this.tintBox.stride = w;
    this.tintBox.off = -(j0 * w + i0);
    return this.tintBox;
  }

  override window(i0: number, j0: number, i1: number, j1: number): Uint16Array {
    const out = new Uint16Array((i1 - i0 + 1) * (j1 - j0 + 1));
    this.copy(i0, j0, i1, j1, out, null);
    return out;
  }

  override every(i0: number, j0: number, step: number, w: number, h: number, heights: Uint16Array | null, tint: Uint8Array | null): void {
    const [lastI, lastJ] = [this.nx - 1, this.nz - 1];
    for (let b = 0; b < h; b++) {
      const j = Math.min(lastJ, j0 + b * step);
      for (let a = 0; a < w; a++) {
        const i = Math.min(lastI, i0 + a * step), p = this.pageOf(i, j);
        if (p) {
          const k = (j - p.j0) * p.w + i - p.i0;
          if (heights) heights[b * w + a] = p.heights[k]!;
          if (tint) tint[b * w + a] = p.tint[k]!;
        } else {
          const q = this.stand.sample(i, j);
          if (heights) heights[b * w + a] = q & 0xffff;
          if (tint) tint[b * w + a] = q >>> 16;
        }
      }
    }
  }

  /**
   * The box from (i0, j0) to (i1, j1) row by row into `heights` and `tint`, either may be null: each sector's stand-ins
   * where no page holds it, then each page held over them, edges and all.
   */
  private copy(i0: number, j0: number, i1: number, j1: number, heights: Uint16Array | null, tint: Uint8Array | null): void {
    const w = i1 - i0 + 1, { chunksX, chunksZ } = this.dims;
    // The chunk before the box too, where the box starts on its far edge: a page there holds that edge.
    const cx0 = Math.max(0, Math.min(chunksX - 1, Math.ceil(i0 / PER) - 1)), cx1 = Math.min(chunksX - 1, (i1 / PER) | 0);
    const cz0 = Math.max(0, Math.min(chunksZ - 1, Math.ceil(j0 / PER) - 1)), cz1 = Math.min(chunksZ - 1, (j1 / PER) | 0);
    for (let pass = 0; pass < 2; pass++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const p = this.chunkPage(cx, cz);
          // A chunk's samples, its far edges among them, within the box; a page's whole, once, from its first chunk met.
          if (pass === 0 && !p) {
            for (let j = Math.max(j0, cz * PER); j <= Math.min(j1, cz * PER + PER); j++) {
              for (let i = Math.max(i0, cx * PER); i <= Math.min(i1, cx * PER + PER); i++) {
                const q = this.stand.sample(i, j);
                if (heights) heights[(j - j0) * w + i - i0] = q & 0xffff;
                if (tint) tint[(j - j0) * w + i - i0] = q >>> 16;
              }
            }
          } else if (pass === 1 && p && cx === Math.max(cx0, p.sq.cx0) && cz === Math.max(cz0, p.sq.cz0)) {
            const a = Math.max(i0, p.i0), b = Math.min(i1, p.i0 + p.w - 1);
            for (let j = Math.max(j0, p.j0); j <= Math.min(j1, p.j0 + p.d - 1); j++) {
              const from = (j - p.j0) * p.w + a - p.i0, to = (j - j0) * w + a - i0;
              if (heights) heights.set(p.heights.subarray(from, from + b - a + 1), to);
              if (tint) tint.set(p.tint.subarray(from, from + b - a + 1), to);
            }
          }
        }
      }
    }
  }
}
