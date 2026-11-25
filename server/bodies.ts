// Bodies by the cell they stand in, so a search about a point reads only the bodies near it. The caller fills it afresh on
// each tick it is used. Bodies in a cell come last added first, so the same adds give the same order.

import { CHUNK_SIZE, type MapDims } from "../shared/coords.ts";

/** Metres. A cell's side: a creature's sight of 22 m covers six or seven across. */
export const BODY_CELL = 8;

export class BodyGrid {
  /** What `near` found, in the first entries. Read it after the call, which may replace it with a larger one. */
  found = new Int32Array(64);
  count = 0;
  private ents = new Int32Array(64);
  private next = new Int32Array(64);
  /** Where each body added stood, and how far it reaches (`add`). */
  private xs = new Float64Array(64);
  private zs = new Float64Array(64);
  private reachOf = new Float64Array(64);
  private readonly cell: number;
  private readonly per: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly chunksX: number;
  /** Per chunk that has held a body, the last body added to each of its cells, or -1. */
  private readonly heads: (Int32Array | null)[];
  /** Per chunk, the most any body added to each cell reaches from where it stands (`add`'s `reach`). */
  private readonly reaches: (Float32Array | null)[];
  /** The most any body added since the last clear reaches. */
  private most = 0;
  /** The cells given a body since the last clear, each by its chunk and its place in the chunk, in the first `dirty`. */
  private dirtyChunk = new Int32Array(64);
  private dirtyCell = new Int32Array(64);
  private dirty = 0;

  /** `cell` is the side of a cell in metres, which divides a chunk. */
  constructor(dims: MapDims, cell = BODY_CELL) {
    this.cell = cell;
    this.per = CHUNK_SIZE / cell;
    this.chunksX = dims.chunksX;
    this.cols = dims.chunksX * this.per;
    this.rows = dims.chunksZ * this.per;
    this.heads = new Array(dims.chunksX * dims.chunksZ).fill(null);
    this.reaches = new Array(dims.chunksX * dims.chunksZ).fill(null);
  }

  /** Empties only the cells given a body: a crowd over a thousand chunks fills few cells of each. */
  clear(): void {
    const heads = this.heads, reaches = this.reaches, chunks = this.dirtyChunk, cells = this.dirtyCell;
    for (let k = 0; k < this.dirty; k++) {
      const c = chunks[k]!, cell = cells[k]!;
      heads[c]![cell] = -1;
      reaches[c]![cell] = 0;
    }
    this.dirty = 0;
    this.count = 0;
    this.most = 0;
  }

  /** Adds body `e` standing at (x, z), reaching `reach` metres from there (for `touching`). */
  add(e: number, x: number, z: number, reach = 0): void {
    const per = this.per;
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor(z / this.cell)));
    const chunk = Math.floor(cz / per) * this.chunksX + Math.floor(cx / per);
    let heads = this.heads[chunk];
    if (!heads) {
      heads = this.heads[chunk] = new Int32Array(per * per).fill(-1);
      this.reaches[chunk] = new Float32Array(per * per);
    }
    const cell = (cz % per) * per + (cx % per);
    if (heads[cell] === -1) {
      const d = this.dirty++;
      if (d === this.dirtyChunk.length) {
        const chunks = new Int32Array(d * 2), cells = new Int32Array(d * 2);
        chunks.set(this.dirtyChunk);
        cells.set(this.dirtyCell);
        this.dirtyChunk = chunks;
        this.dirtyCell = cells;
      }
      this.dirtyChunk[d] = chunk;
      this.dirtyCell[d] = cell;
    }
    const reaches = this.reaches[chunk]!;
    if (reach > reaches[cell]!) reaches[cell] = reach;
    if (reach > this.most) this.most = reach;
    const n = this.count++;
    if (n === this.ents.length) {
      const ents = new Int32Array(n * 2);
      ents.set(this.ents);
      this.ents = ents;
      const next = new Int32Array(n * 2);
      next.set(this.next);
      this.next = next;
      for (const key of ["xs", "zs", "reachOf"] as const) {
        const grown = new Float64Array(n * 2);
        grown.set(this[key]);
        this[key] = grown;
      }
    }
    this.ents[n] = e;
    this.xs[n] = x;
    this.zs[n] = z;
    this.reachOf[n] = reach;
    this.next[n] = heads[cell]!;
    heads[cell] = n;
  }

  /**
   * Writes the bodies added in cells that meet the square reaching `r` from (x, z) each way to `found`, and returns how many.
   * Some are further than `r`: the caller measures.
   */
  near(x: number, z: number, r: number): number {
    return this.gather(x, z, r, false);
  }

  /** As `near`, but only the bodies whose reach (`add`'s) meets the circle of `r` about (x, z): no caller need measure. */
  touching(x: number, z: number, r: number): number {
    return this.gather(x, z, r, true);
  }

  private gather(x: number, z: number, r: number, reach: boolean): number {
    const size = this.cell, per = this.per, pad = reach ? r + this.most : r;
    const cx0 = Math.max(0, Math.floor((x - pad) / size));
    const cz0 = Math.max(0, Math.floor((z - pad) / size));
    const cx1 = Math.min(this.cols - 1, Math.floor((x + pad) / size));
    const cz1 = Math.min(this.rows - 1, Math.floor((z + pad) / size));
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      const gz = Math.max(cz * size - z, 0, z - (cz + 1) * size);
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = Math.floor(cz / per) * this.chunksX + Math.floor(cx / per);
        const heads = this.heads[chunk];
        if (!heads) continue;
        const cell = (cz % per) * per + (cx % per);
        if (reach) {
          const gx = Math.max(cx * size - x, 0, x - (cx + 1) * size), most = r + this.reaches[chunk]![cell]!;
          if (gx * gx + gz * gz > most * most) continue;
        }
        for (let k = heads[cell]!; k >= 0; k = this.next[k]!) {
          if (reach) {
            const dx = this.xs[k]! - x, dz = this.zs[k]! - z, most = r + this.reachOf[k]!;
            if (dx * dx + dz * dz > most * most) continue;
          }
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
