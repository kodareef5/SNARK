// The far feed as a client holds it (S_FAR): every tribe's structures within the reach it asked for, as 4 m cells of colour
// and height, kept for the connection to draw bases on the horizon. It carries no owner and never feeds the map, whose
// cells come by TacticalRadius (tactical.ts).

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import type { BitReader } from "../../shared/net/codec.ts";
import { FarCells, TACTICAL_CELL, readFar } from "../../shared/world/tactical.ts";

export class FarStore {
  /** A chunk with no filled cell has no entry. */
  readonly chunks = new Map<number, FarCells>();
  /** Counts the messages that changed a chunk. `changed` holds that count per chunk at its last change, so a drawing can tell which to build again. */
  version = 0;
  changed = new Uint32Array(0);
  private dims: MapDims | null = null;
  private spare = new FarCells();

  /** S_FAR after its type. */
  read(r: BitReader, dims: MapDims): void {
    const got = this.spare;
    const chunk = readFar(r, got);
    const count = dims.chunksX * dims.chunksZ;
    if (chunk < 0 || chunk >= count) return;
    if (this.changed.length !== count) {
      this.dims = dims;
      this.changed = new Uint32Array(count);
    }
    const was = this.chunks.get(chunk);
    if (got.filled === 0) {
      if (!was) return;
      this.chunks.delete(chunk);
      this.spare = was;
    } else {
      this.chunks.set(chunk, got);
      this.spare = was ?? new FarCells();
    }
    this.changed[chunk] = ++this.version;
  }

  /** What stands in the 4 m cell at (x, z): 0 for nothing, else its palette colour in the second byte over its top byte (farTopMetres). */
  cellAt(x: number, z: number): number {
    const dims = this.dims;
    if (!dims || x < 0 || z < 0 || x >= dims.chunksX * CHUNK_SIZE || z >= dims.chunksZ * CHUNK_SIZE) return 0;
    const chunk = chunkAt(dims, x, z);
    const cells = this.chunks.get(chunk);
    if (!cells) return 0;
    const side = CHUNK_SIZE / TACTICAL_CELL;
    const at = Math.floor((z - chunkCz(dims, chunk) * CHUNK_SIZE) / TACTICAL_CELL) * side + Math.floor((x - chunkCx(dims, chunk) * CHUNK_SIZE) / TACTICAL_CELL);
    return cells.top[at] === 0 ? 0 : (cells.tint[at]! << 8) | cells.top[at]!;
  }
}
