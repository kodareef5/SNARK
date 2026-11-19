// The tribes' bases on the admin map, read from /admin/bases.bin (server/admin/bases.ts): each chunk's cells as the players'
// map has them, turned into squares on the world's metres with their colours.

import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { BitReader } from "../../../shared/net/codec.ts";
import { Cells, OWNER_OTHER, TACTICAL_CELL, levelSide, readCells } from "../../../shared/world/tactical.ts";

/** One chunk's cells, and which chunk. */
export interface BaseChunk {
  chunk: number;
  cells: Cells;
}

/** A filled cell: its south-east corner and side in metres, its colour as 0xRRGGBB, and the team whose piece it shows (0 for nobody's). */
export interface BaseSquare {
  x: number;
  z: number;
  size: number;
  colour: number;
  team: number;
}

/** The chunks of a bases answer, or null for one that does not read. */
export function readBases(bytes: Uint8Array): BaseChunk[] | null {
  const r = new BitReader(bytes);
  const n = r.varint();
  const out: BaseChunk[] = [];
  for (let k = 0; k < n && !r.overflow; k++) {
    const cells = new Cells();
    const chunk = readCells(r, cells);
    if (chunk < 0) return null;
    out.push({ chunk, cells });
  }
  return r.overflow ? null : out;
}

/** A tribe's own colour over its pieces', so a base stands out from the ground; the chosen survivor's tribe in green. */
const TRIBE = [236, 176, 72];
const CHOSEN = [96, 226, 128];

/**
 * A cell's colour: its tallest piece's, lighter the taller it stands, then drawn toward a tribe's amber, or green for the
 * `chosen` team, or darkened for nobody's piece in a chunk with a base.
 */
export function baseColour(palette: Uint8Array, tint: number, band: number, team: number, chosen: number): number {
  const lift = 0.78 + band * 0.045;
  const towards = team === 0 ? null : team === chosen ? CHOSEN : TRIBE;
  const rgb = [0, 1, 2].map((c) => {
    const v = palette[tint * 4 + c]! * lift;
    return Math.min(255, Math.round(towards ? v + (towards[c]! - v) * 0.5 : v * 0.7));
  });
  return (rgb[0]! << 16) | (rgb[1]! << 8) | rgb[2]!;
}

/** Every filled cell of the bases as a square in the world. */
export function baseSquares(dims: MapDims, bases: readonly BaseChunk[], palette: Uint8Array, chosen: number): BaseSquare[] {
  const out: BaseSquare[] = [];
  for (const { chunk, cells } of bases) {
    const n = levelSide(cells.level);
    const size = TACTICAL_CELL << cells.level;
    const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = cells.info[j * n + i]!;
        if (v === 0) continue;
        const owner = (v >> 3) & 7;
        // A team past the chunk's seven is some tribe's all the same.
        const team = owner === OWNER_OTHER ? -1 : cells.teams[owner]!;
        out.push({ x: x0 + i * size, z: z0 + j * size, size, colour: baseColour(palette, cells.tint[j * n + i]!, v & 7, team, chosen), team });
      }
    }
  }
  return out;
}
