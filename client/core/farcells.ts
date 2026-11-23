// The far feed as a client holds it (S_FAR): every tribe's structures within the reach it asked for, as 4 m cells of colour
// and height, kept for the connection to draw bases on the horizon. It carries no owner and never feeds the map, whose
// cells come by TacticalRadius (tactical.ts). Once the server knows the client holds the map's statics, a chunk's cells
// leave the map's own pieces out, and which of those are gone comes as a list (gonelists.ts).

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz, type MapDims } from "../../shared/coords.ts";
import type { BitReader } from "../../shared/net/codec.ts";
import { FarCells, TACTICAL_CELL, readFar } from "../../shared/world/tactical.ts";

export class FarStore {
  /** A chunk with no filled cell has no entry. */
  readonly chunks = new Map<number, FarCells>();
  /**
   * Counts the messages that changed a chunk. `changed` holds that count per chunk at its last change, so a drawing can tell
   * which to build again, and 0 for a chunk never told of.
   */
  version = 0;
  changed = new Uint32Array(0);
  /** Per chunk: 1 where the cells last told of it count the map's own pieces, so a top under a piece's shows the piece gone. */
  full = new Uint8Array(0);
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
      this.full = new Uint8Array(count);
    }
    this.full[chunk] = got.built ? 0 : 1;
    const was = this.chunks.get(chunk);
    if (got.filled === 0) {
      // Sent empty though never sent filled, with the map's pieces counted: those are gone, which the far city must hear.
      if (was) {
        this.chunks.delete(chunk);
        this.spare = was;
      }
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
