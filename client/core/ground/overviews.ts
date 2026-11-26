// The overviews a page holds. Each is a square of 4,096 m: every fourth sample (8 m) and its tint, its chunks' bounds, its
// node layers' pictures and slots' bits, and its water. It is held while it is within the view (map-want.ts) and let go a
// sector past it, a band of chunk rows at a time. A sample of a sector not held is its overview's where that is held, as
// Heightfield.fill lays it, else the head's coarse picture's (mapload.ts StagedMap).

import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { TERRAIN_CELL } from "../../../shared/world/heightfield.ts";
import { COARSE_STEP, OVERVIEW_CHUNKS, OVERVIEW_STEP, squareOf, type HeldNodeBits, type MapHead, type NodeLayer, type OverviewPiece, type Square } from "../../../shared/world/mapfile.ts";
import type { SlotBits } from "../../../shared/world/nodes.ts";

/** An overview held. */
export interface OverviewBlock {
  readonly sq: Square;
  /** Every fourth sample of its square and its tint, row by row, `w` a row. */
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  readonly w: number;
  /** Its first sample. */
  readonly i0: number;
  readonly j0: number;
  /** The chunk rows whose samples are its own, `from` up to `to`: it fills and goes a band at a time. */
  from: number;
  to: number;
  /** Whether its nodes stand: from the end of its fill to the start of its going. */
  nodes: boolean;
  /** By node layer: its picture, its slots' bits where none stands, and where the footing's other kind does. */
  readonly pictures: readonly (Uint8Array | null)[];
  readonly out: readonly (Uint8Array | null)[];
  readonly other: readonly (Uint8Array | null)[];
}

/** Samples a chunk's side spans. */
const PER = CHUNK_SIZE / TERRAIN_CELL;

/**
 * Sample (li, lj) of a picture of every `step`-th sample, `w` a row, its last cells `lastX` and `lastZ`: its height as the
 * picture's two triangles a cell, split as the ground's are, have it, rounded, and its tint from bit 16 (Heightfield.fill).
 */
function laid(h: Uint16Array, t: Uint8Array, w: number, step: number, lastX: number, lastZ: number, li: number, lj: number): number {
  // On the picture's own grid a sample is the picture's, as the triangles have it there.
  if (li % step === 0 && lj % step === 0) {
    const k = (lj / step) * w + li / step;
    return h[k]! | (t[k]! << 16);
  }
  let cx = (li / step) | 0, cz = (lj / step) | 0;
  if (cx > lastX) cx = lastX;
  if (cz > lastZ) cz = lastZ;
  const u = (li - cx * step) / step, v = (lj - cz * step) / step;
  const k = cz * w + cx, h00 = h[k]!, h11 = h[k + w + 1]!;
  const q = Math.round(u >= v ? h00 + (h[k + 1]! - h00) * u + (h11 - h[k + 1]!) * v : h00 + (h11 - h[k + w]!) * u + (h[k + w]! - h00) * v);
  // The tint is the nearest sample's, a half rounded up.
  return q | (t[(cz + Math.round(v)) * w + cx + Math.round(u)]! << 16);
}

export class Overviews {
  readonly head: MapHead;
  /** By square on the lattice, from the map's first: its block or null. */
  private readonly blocks: (OverviewBlock | null)[];
  private readonly across: number;
  private readonly col0: number;
  private readonly row0: number;
  /** Per chunk column and row, its square's column and row from the first. */
  private readonly colOf: Int32Array;
  private readonly rowOf: Int32Array;
  private readonly coarseHeights: Uint16Array;
  private readonly coarseTint: Uint8Array;
  /** Bumped when a block's nodes stand or go. */
  version = 0;

  constructor(head: MapHead) {
    this.head = head;
    this.coarseHeights = head.coarse.heights;
    this.coarseTint = head.coarse.tint;
    const { dims } = head;
    this.col0 = Math.floor(dims.frameX / OVERVIEW_CHUNKS);
    this.row0 = Math.floor(dims.frameZ / OVERVIEW_CHUNKS);
    this.colOf = Int32Array.from({ length: dims.chunksX }, (_, cx) => Math.floor((cx + dims.frameX) / OVERVIEW_CHUNKS) - this.col0);
    this.rowOf = Int32Array.from({ length: dims.chunksZ }, (_, cz) => Math.floor((cz + dims.frameZ) / OVERVIEW_CHUNKS) - this.row0);
    this.across = this.colOf[dims.chunksX - 1]! + 1;
    this.blocks = new Array<OverviewBlock | null>(this.across * (this.rowOf[dims.chunksZ - 1]! + 1)).fill(null);
  }

  private slot(col: number, row: number): number {
    return (row - this.row0) * this.across + col - this.col0;
  }

  /** The block of square (col, row), or null. */
  at(col: number, row: number): OverviewBlock | null {
    return this.blocks[this.slot(col, row)] ?? null;
  }

  /** The blocks held. */
  held(): OverviewBlock[] {
    return this.blocks.filter((b): b is OverviewBlock => b !== null);
  }

  /** A block for `piece`, in place of any its square had, none of whose rows are its own yet. */
  begin(piece: OverviewPiece): OverviewBlock {
    const sq = piece.sq;
    const block: OverviewBlock = { sq, heights: piece.heights, tint: piece.tint, w: ((sq.cx1 - sq.cx0) * PER) / OVERVIEW_STEP + 1, i0: sq.cx0 * PER, j0: sq.cz0 * PER, from: sq.cz0, to: sq.cz0, nodes: false, pictures: piece.pictures, out: piece.out, other: piece.other };
    this.blocks[this.slot(sq.col, sq.row)] = block;
    return block;
  }

  /** Square (col, row)'s block let go, if it is still `block`. */
  end(block: OverviewBlock): void {
    const k = this.slot(block.sq.col, block.sq.row);
    if (this.blocks[k] === block) this.blocks[k] = null;
  }

  /** Whether `block` is still its square's. */
  holds(block: OverviewBlock): boolean {
    return this.blocks[this.slot(block.sq.col, block.sq.row)] === block;
  }

  /** The block whose own sample (i, j) is: one of the up to four squares it lies on, at a chunk row it holds. */
  private holding(i: number, j: number): OverviewBlock | null {
    const { chunksX, chunksZ } = this.head.dims;
    if (i % PER !== 0 && j % PER !== 0) {
      const cz = Math.min(chunksZ - 1, (j / PER) | 0), b = this.blocks[this.rowOf[cz]! * this.across + this.colOf[Math.min(chunksX - 1, (i / PER) | 0)]!];
      return b && cz >= b.from && cz < b.to ? b : null;
    }
    const xhi = Math.min(chunksX - 1, Math.floor(i / PER)), xlo = i % PER === 0 && i > 0 ? Math.min(chunksX - 1, i / PER - 1) : xhi;
    const zhi = Math.min(chunksZ - 1, Math.floor(j / PER)), zlo = j % PER === 0 && j > 0 ? Math.min(chunksZ - 1, j / PER - 1) : zhi;
    for (let r = this.rowOf[zlo]!; r <= this.rowOf[zhi]!; r++) {
      for (let c = this.colOf[xlo]!; c <= this.colOf[xhi]!; c++) {
        const b = this.blocks[r * this.across + c];
        if (b && ((zlo >= b.from && zlo < b.to) || (zhi >= b.from && zhi < b.to))) return b;
      }
    }
    return null;
  }

  /**
   * The stored height sample (i, j) stands in with, and its tint from bit 16: its overview's where that holds it, else the
   * coarse picture's.
   */
  sample(i: number, j: number): number {
    const b = this.holding(i, j);
    if (b) return laid(b.heights, b.tint, b.w, OVERVIEW_STEP, b.w - 2, b.heights.length / b.w - 2, i - b.i0, j - b.j0);
    return laid(this.coarseHeights, this.coarseTint, this.head.dims.chunksX + 1, COARSE_STEP, this.head.dims.chunksX - 1, this.head.dims.chunksZ - 1, i, j);
  }

  /**
   * The head's node layers as a page holds them: a listed one's rows set in as its sectors come (mapload.ts), and a
   * scattered or zoned one's picture and bits read from the blocks whose nodes stand, none standing elsewhere.
   */
  layers(): NodeLayer[] {
    const { dims } = this.head;
    const out: NodeLayer[] = [];
    let shared = -1;
    this.head.layers.forEach((rule, k) => {
      if (rule.type === 1) return void out.push({ kinds: rule.kinds, first: new Uint32Array(dims.chunksX * dims.chunksZ + 1), kind: new Uint8Array(0), x: new Uint16Array(0), z: new Uint16Array(0), yaw: new Uint16Array(0) });
      // A zoned layer that shares its picture reads the picture of the zoned layer before it.
      const own = rule.type === 2 && rule.shared ? shared : k;
      if (rule.type === 2) shared = own;
      const held = this.bits(k, own, rule.perChunk, rule.type === 0 ? rule.allowCell : rule.zoneCell, rule.type === 0);
      if (rule.type === 0) out.push({ seed: rule.seed, perChunk: rule.perChunk, kinds: rule.kinds, allowCell: rule.allowCell, allow: null, held });
      else out.push({ seed: rule.seed, perChunk: rule.perChunk, zones: rule.zones, zoneCell: rule.zoneCell, zone: NO_ZONE, ...(rule.codes ? { codes: rule.codes } : {}), held });
    });
    return out;
  }

  /** Layer `k`'s bits and picture `pic`'s squares of `cell` metres, as bits where `bits` (a scattered layer's) else bytes. */
  private bits(k: number, pic: number, perChunk: number, cell: number, bits: boolean): HeldNodeBits {
    const { dims } = this.head;
    const per = CHUNK_SIZE / Math.max(1, cell);
    return {
      slots: (chunk: number, into: SlotBits): boolean => {
        const cx = chunk % dims.chunksX, cz = Math.floor(chunk / dims.chunksX);
        const b = this.blocks[this.rowOf[cz]! * this.across + this.colOf[cx]!];
        if (!b || !b.nodes) return false;
        into.out = b.out[k]!;
        into.other = b.other[k]!;
        into.at = ((cz - b.sq.cz0) * (b.sq.cx1 - b.sq.cx0) + cx - b.sq.cx0) * perChunk;
        return true;
      },
      picture: (sx: number, sz: number): number => {
        const cx = Math.min(dims.chunksX - 1, Math.max(0, Math.floor(sx / per))), cz = Math.min(dims.chunksZ - 1, Math.max(0, Math.floor(sz / per)));
        const b = this.blocks[this.rowOf[cz]! * this.across + this.colOf[cx]!];
        const p = b?.nodes ? b.pictures[pic] : null;
        if (!p) return 0;
        const at = (sz - b!.sq.cz0 * per) * (b!.sq.cx1 - b!.sq.cx0) * per + sx - b!.sq.cx0 * per;
        return bits ? (p[at >> 3]! >> (at & 7)) & 1 : p[at]!;
      },
    };
  }

  /** The square of overview (col, row). */
  square(col: number, row: number): Square | null {
    return squareOf(this.head.dims, OVERVIEW_CHUNKS, col, row);
  }
}

const NO_ZONE = new Uint8Array(0);
