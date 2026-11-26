// Pieces the layers placed twice: the same kind at the same place with the same turn and bend, as the map will hold them.
// Two doors of a building lay the same approach, two bays the beam between them, two cells the slab they share. The
// first stays, with what the build knows of it (known.ts).

import { STRUCT_UNITS } from "../../shared/coords.ts";
import { toYaw } from "../map/layers.ts";
import type { StaticPiece } from "./statics.ts";

/** A run of `pieces` something keeps by its place: where it starts and how many it is. */
export interface PieceRun { firstPiece: number; blocks: number }

/**
 * Takes every later twin out of `pieces`, in place and in order; gives how many went. `runs` kept by place (the ruins'
 * records of their buildings' pieces) are moved to where their pieces now are.
 */
export function dropTwins(pieces: StaticPiece[], runs: readonly PieceRun[] = []): number {
  const n = pieces.length, unit = (v: number): number => Math.round(v * STRUCT_UNITS);
  // A bucket a 64 m square, so one set of keys is small and let go before the next.
  const cell = (v: number): number => Math.floor(unit(v) / (64 * STRUCT_UNITS)) & 255;
  const bucketOf = (p: StaticPiece): number => (cell(p.x) << 8) | cell(p.z);
  const first = new Uint32Array(65537);
  for (const p of pieces) first[bucketOf(p) + 1]!++;
  for (let b = 0; b < 65536; b++) first[b + 1]! += first[b]!;
  const order = new Uint32Array(n), at = first.slice(0, 65536);
  for (let i = 0; i < n; i++) order[at[bucketOf(pieces[i]!)]!++] = i;
  const twin = new Uint8Array(n), seen = new Set<string>();
  let gone = 0;
  for (let b = 0; b < 65536; b++) {
    if (first[b + 1]! - first[b]! < 2) continue;
    seen.clear();
    for (let k = first[b]!; k < first[b + 1]!; k++) {
      const p = pieces[order[k]!]!;
      const key = `${p.kind} ${unit(p.x)} ${unit(p.y)} ${unit(p.z)} ${toYaw(p.yaw)}${p.bend ? ` ${Array.from(p.bend).join(",")}` : ""}`;
      if (seen.has(key)) {
        twin[order[k]!] = 1;
        gone++;
      } else seen.add(key);
    }
  }
  if (gone === 0) return 0;
  // Where each piece goes: its place less the twins before it.
  const to = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) to[i + 1] = to[i]! + 1 - twin[i]!;
  for (const r of runs) {
    const end = to[Math.min(n, r.firstPiece + r.blocks)]!;
    r.firstPiece = to[Math.min(n, r.firstPiece)]!;
    r.blocks = end - r.firstPiece;
  }
  for (let i = 0; i < n; i++) if (twin[i] === 0) pieces[to[i]!] = pieces[i]!;
  pieces.length = to[n]!;
  return gone;
}
