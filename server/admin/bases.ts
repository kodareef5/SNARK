// The tribes' bases for the admin map: every chunk that holds a structure of a tribe, as the players' map has it from the
// one bake (D138, server/tactical.ts), in the same bytes S_TACTICAL sends a player. Chunks of nobody's pieces alone, such
// as a city's ruins, are left out.
//
// Layout: a varint count of chunks, then each chunk's fields as writeCells writes them, one after another on the bits.

import { BitWriter } from "../../shared/net/codec.ts";
import { writeCells, type Summary } from "../../shared/world/tactical.ts";

/** Bytes writeCells takes for a chunk at the most: its head, seven teams and 256 cells of a run each. */
const CHUNK_BYTES_MOST = 8 + 7 * 5 + 256 * 3;

/** Whether a chunk's summary holds a cell of some tribe's. */
export function isBase(s: Summary | null): s is Summary {
  if (!s || s.filled === 0) return false;
  for (let i = 0; i < s.teamCount; i++) if (s.teams[i] !== 0) return true;
  return false;
}

/** A number that changes whenever any chunk's cells change: the sum of their versions. */
export function basesVersion(summaries: readonly (Summary | null)[]): number {
  let v = 0;
  for (const s of summaries) if (s) v += s.version;
  return v;
}

/** Every base's cells at `level`, 0 (4 m) to 3 (32 m). */
export function basesOf(summaries: readonly (Summary | null)[], level: number): Uint8Array {
  const chunks: number[] = [];
  summaries.forEach((s, chunk) => isBase(s) && chunks.push(chunk));
  const w = new BitWriter(8 + chunks.length * CHUNK_BYTES_MOST);
  w.varint(chunks.length);
  for (const chunk of chunks) writeCells(w, chunk, summaries[chunk]!, level);
  return w.bytes().slice();
}
