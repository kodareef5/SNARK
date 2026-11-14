// Bodies by the cell they stand in, so a search about a point reads only the bodies near it. The caller fills it afresh on
// each tick it is used. Bodies in a cell come last added first, so the same adds give the same order.

import { CHUNK_SIZE, type MapDims } from "../shared/coords.ts";

/** Metres. A cell's side: a creature's sight of 22 m covers six or seven across. */
export const BODY_CELL = 8;
const CELLS = CHUNK_SIZE / BODY_CELL;

export class BodyGrid {
  /** What `near` found, in the first entries. Read it after the call, which may replace it with a larger one. */
  found = new Int32Array(64);
  count = 0;
  private ents = new Int32Array(64);
  private next = new Int32Array(64);
  private readonly cols: number;
  private readonly rows: number;
  private readonly chunksX: number;
  /** Per chunk that has held a body, the last body added to each of its cells, or -1. */
  private readonly heads: (Int32Array | null)[];
  /** Chunks holding a body since the last clear, each marked with the clear it follows. */
  private readonly used: number[] = [];
  private readonly usedAt: Uint32Array;
  private clears = 1;

  constructor(dims: MapDims) {
    this.chunksX = dims.chunksX;
    this.cols = dims.chunksX * CELLS;
    this.rows = dims.chunksZ * CELLS;
    this.heads = new Array(dims.chunksX * dims.chunksZ).fill(null);
    this.usedAt = new Uint32Array(dims.chunksX * dims.chunksZ);
  }

  clear(): void {
    for (const c of this.used) this.heads[c]!.fill(-1);
    this.used.length = 0;
    this.count = 0;
    this.clears++;
  }

  add(e: number, x: number, z: number): void {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / BODY_CELL)));
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor(z / BODY_CELL)));
    const chunk = Math.floor(cz / CELLS) * this.chunksX + Math.floor(cx / CELLS);
    let heads = this.heads[chunk];
    if (!heads) heads = this.heads[chunk] = new Int32Array(CELLS * CELLS).fill(-1);
    const cell = (cz % CELLS) * CELLS + (cx % CELLS);
    if (this.usedAt[chunk] !== this.clears) {
      this.usedAt[chunk] = this.clears;
      this.used.push(chunk);
    }
    const n = this.count++;
    if (n === this.ents.length) {
      const ents = new Int32Array(n * 2);
      ents.set(this.ents);
      this.ents = ents;
      const next = new Int32Array(n * 2);
      next.set(this.next);
      this.next = next;
    }
    this.ents[n] = e;
    this.next[n] = heads[cell]!;
    heads[cell] = n;
  }

  /**
   * Writes the bodies added in cells that meet the square reaching `r` from (x, z) each way to `found`, and returns how many.
   * Some are further than `r`: the caller measures.
   */
  near(x: number, z: number, r: number): number {
    const cx0 = Math.max(0, Math.floor((x - r) / BODY_CELL));
    const cz0 = Math.max(0, Math.floor((z - r) / BODY_CELL));
    const cx1 = Math.min(this.cols - 1, Math.floor((x + r) / BODY_CELL));
    const cz1 = Math.min(this.rows - 1, Math.floor((z + r) / BODY_CELL));
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const heads = this.heads[Math.floor(cz / CELLS) * this.chunksX + Math.floor(cx / CELLS)];
        if (!heads) continue;
        for (let k = heads[(cz % CELLS) * CELLS + (cx % CELLS)]!; k >= 0; k = this.next[k]!) {
          if (n === this.found.length) {
            const found = new Int32Array(n * 2);
            found.set(this.found);
            this.found = found;
          }
          this.found[n++] = this.ents[k]!;
        }
      }
    }
    return n;
  }
}
