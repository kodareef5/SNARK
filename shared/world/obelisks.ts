// An obelisk as a map sets it down (content/terminals.ts): the obelisk standing on the ground at its place, and its terminal
// on the ground a step in front of it along its facing, turned to face the way it does, so a survivor walks up to it there.

import type { Registry } from "../content/registry.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { chunkAt } from "../coords.ts";
import type { MapData, MapStatic } from "./mapfile.ts";
import type { StructureStore } from "./structures.ts";

export const OBELISK = "core:obelisk";
export const TRAVEL_TERMINAL = "core:travel_terminal";
/** Metres of ground between the obelisk's face and its terminal's back. */
const STEP = 1.5;
/** The obelisk is this many of its pieces, one on another: a piece is at most 32 m tall. */
export const OBELISK_PIECES = 3;

/** Where an obelisk stands: a name for it, its place, and the way its terminal faces in 1/65,536 turns. */
export interface ObeliskPlace {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** The obelisk's pieces, then its terminal's. `ground` is the height of the ground at a place. */
export function obeliskStatics(reg: Registry, at: ObeliskPlace, ground: (x: number, z: number) => number): MapStatic[] {
  const obelisk = reg.index.get(OBELISK);
  const terminal = reg.index.get(TRAVEL_TERMINAL);
  if (obelisk === undefined || terminal === undefined) throw new Error(`an obelisk needs content "${OBELISK}" and "${TRAVEL_TERMINAL}"`);
  const a = ((at.yaw & 0xffff) / 65536) * TAU;
  const away = reg.halfX[obelisk]! + STEP + reg.halfZ[terminal]!;
  const tx = at.x + detSin(a) * away;
  const tz = at.z + detCos(a) * away;
  const foot = ground(at.x, at.z);
  const half = reg.halfY[obelisk]!;
  const pieces: MapStatic[] = [];
  for (let i = 0; i < OBELISK_PIECES; i++) pieces.push({ kind: OBELISK, x: at.x, y: foot + half * (2 * i + 1), z: at.z, yaw: at.yaw & 0xffff });
  pieces.push({ kind: TRAVEL_TERMINAL, x: tx, y: ground(tx, tz) + reg.halfY[terminal]!, z: tz, yaw: at.yaw & 0xffff });
  return pieces;
}

/**
 * Sets down the map's obelisks and terminals that `structs` lacks: a save made before its map had them gets them as it loads,
 * since a map's pieces are otherwise set down only in a new world. Returns how many pieces it set down.
 */
export function restoreObelisks(map: MapData, structs: StructureStore, reg: Registry): number {
  let n = 0;
  for (const s of map.statics) {
    if (s.kind !== OBELISK && s.kind !== TRAVEL_TERMINAL) continue;
    const kind = reg.index.get(s.kind);
    if (kind === undefined) continue;
    const t = structs.chunks[chunkAt(structs.dims, s.x, s.z)];
    let there = false;
    for (let i = 0; t && i < t.high && !there; i++) there = t.kind[i] === kind && Math.abs(t.x[i]! - s.x) < 0.01 && Math.abs(t.y[i]! - s.y) < 0.01 && Math.abs(t.z[i]! - s.z) < 0.01;
    if (!there && structs.add(kind, s.x, s.y, s.z, s.yaw, 0, reg.maxHp[kind]!) >= 0) n++;
  }
  return n;
}
