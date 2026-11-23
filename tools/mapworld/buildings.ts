// The map's buildings section from what the build knows (known.ts): the pieces put in the order a map holds them, each
// building's together and by storey, and each building's row with its frame as the ruins laid it out.
//
// A building's pieces stand where its first piece stood in the list, storeys ascending, and within a storey as its maker
// placed them. A piece of no building keeps its place among the others. So one building's pieces in a chunk are one run of
// slots, and nothing else in the chunk moves but to make room.

import { YAW_UNITS } from "../../shared/coords.ts";
import { Buildings, STOREY, type BuildingRow, type BuildingStair } from "../../shared/world/buildings.ts";
import { STOREY_UNSAID, knownOf } from "./known.ts";

/** A building as the ruins made it, in lattice metres and degrees, as its pieces are until the map is written. */
export interface SiteBuilding extends Omit<BuildingRow, "yaw" | "stairs"> {
  /** Degrees, as a frame's (ruin-geometry.ts). */
  readonly yaw: number;
  readonly stairs: readonly BuildingStair[];
}

/** Pieces in a map's order, and for each the place among `buildings` of the one it is a piece of, or -1, and its storey. */
export interface Ordered<P> {
  readonly pieces: P[];
  readonly of: Int32Array;
  readonly storey: Uint8Array;
}

/** `pieces` in the order a map holds them. A storey left unsaid is the one the piece's height over its building's base is in. */
export function orderPieces<P extends { readonly y: number }>(pieces: readonly P[], buildings: readonly { readonly base: number }[]): Ordered<P> {
  const n = pieces.length;
  const owner = new Int32Array(n).fill(-1), storeys = new Uint8Array(n);
  const members = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    const k = knownOf(p);
    if (!k || k.owner < 0 || !buildings[k.owner]) return;
    owner[i] = k.owner;
    storeys[i] = k.storey !== STOREY_UNSAID ? k.storey : Math.max(0, Math.min(254, Math.floor((p.y - buildings[k.owner]!.base + 0.25) / STOREY)));
    const list = members.get(k.owner);
    if (list) list.push(i);
    else members.set(k.owner, [i]);
  });
  const out: Ordered<P> = { pieces: new Array<P>(n), of: new Int32Array(n), storey: new Uint8Array(n) };
  let at = 0;
  const put = (i: number): void => {
    out.pieces[at] = pieces[i]!;
    out.of[at] = owner[i]!;
    out.storey[at++] = storeys[i]!;
  };
  for (let i = 0; i < n; i++) {
    const b = owner[i]!;
    if (b < 0) put(i);
    else if (members.get(b)![0] === i) for (const m of members.get(b)!.slice().sort((p, q) => storeys[p]! - storeys[q]! || p - q)) put(m);
  }
  return out;
}

/**
 * The map's buildings: `buildings` moved from lattice metres to a map's whose corner is at (x0, z0), and the runs of the
 * slots `ordered`'s pieces will take in a map of `dims`.
 */
export function mapBuildings(dims: { chunksX: number; chunksZ: number; frameX?: number; frameZ?: number }, buildings: readonly SiteBuilding[], ordered: Ordered<{ readonly kind: string; readonly x: number; readonly z: number }>, x0: number, z0: number): Buildings {
  const rows = buildings.map((b): BuildingRow => ({ ...b, x: b.x - x0, z: b.z - z0, yaw: Math.round((b.yaw / 360) * YAW_UNITS) & (YAW_UNITS - 1) }));
  const moved = { *[Symbol.iterator]() { for (const p of ordered.pieces) yield { kind: p.kind, x: p.x - x0, z: p.z - z0 }; } };
  return Buildings.of(dims, rows, moved, ordered.of, ordered.storey);
}
