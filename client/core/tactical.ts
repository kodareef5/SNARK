// The client's part of the map: what the server has sent of structures and friends beyond the view.

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import type { BitReader } from "../../shared/net/codec.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { Cells, Marks, TACTICAL_CELL, levelSide, readCells, readMarks } from "../../shared/world/tactical.ts";

/** Structure cells by chunk, kept for as long as the session lasts, and the latest marks. */
export class MapStore {
  /** A chunk with no filled cell has no entry. */
  readonly chunks = new Map<number, Cells>();
  readonly marks = new Marks();
  /** Counts changes to the cells. */
  version = 0;
  private hf: Heightfield | null = null;
  private scratch = new Cells();

  /** S_TACTICAL after its type. */
  readCells(r: BitReader, hf: Heightfield): void {
    this.hf = hf;
    const got = this.scratch;
    const chunk = readCells(r, got);
    if (chunk < 0 || chunk >= hf.dims.chunksX * hf.dims.chunksZ) return;
    this.version++;
    const was = this.chunks.get(chunk);
    if (got.teamCount === 0) {
      this.chunks.delete(chunk);
      return;
    }
    this.chunks.set(chunk, got);
    this.scratch = was ?? new Cells();
  }

  /** S_MARKS after its type. */
  readMarks(r: BitReader, hf: Heightfield): void {
    readMarks(r, hf, this.marks);
  }

  /**
   * What is known to stand at (x, z): 0 for nothing, else the cell's palette colour in the second byte over its CELL_ byte
   * (shared/world/tactical.ts). The cell may be 4, 8, 16 or 32 m wide, as the server last sent its chunk.
   */
  cellAt(x: number, z: number): number {
    const at = this.find(x, z);
    return at < 0 ? 0 : (this.found!.tint[at]! << 8) | this.found!.info[at]!;
  }

  /** The team whose structure stands at (x, z). 0 for none, for nobody's, and for a team the chunk does not name. */
  teamAt(x: number, z: number): number {
    const at = this.find(x, z);
    return at < 0 ? 0 : (this.found!.teams[(this.found!.info[at]! >> 3) & 7] ?? 0);
  }

  private found: Cells | null = null;

  /** Index of the filled cell at (x, z) in `found`, or -1. */
  private find(x: number, z: number): number {
    const hf = this.hf;
    if (!hf || x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return -1;
    const chunk = chunkAt(hf.dims, x, z);
    const cells = this.chunks.get(chunk);
    if (!cells) return -1;
    const size = TACTICAL_CELL << cells.level;
    const at = Math.floor((z - chunkCz(hf.dims, chunk) * CHUNK_SIZE) / size) * levelSide(cells.level) + Math.floor((x - chunkCx(hf.dims, chunk) * CHUNK_SIZE) / size);
    this.found = cells;
    return cells.info[at] === 0 ? -1 : at;
  }
}
