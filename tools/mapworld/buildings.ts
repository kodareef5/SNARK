// The map's buildings section from what the build knows (known.ts): the pieces put in the order a map holds them, each
// building's together and by storey, and each building's row with its frame as the ruins laid it out.
//
// A building's pieces stand where its first piece stood in the list, storeys ascending, and within a storey as its maker
// placed them. A piece of no building keeps its place among the others. So one building's pieces in a chunk are one run of
// slots, and nothing else in the chunk moves but to make room.

import { STRUCT_UNITS, YAW_UNITS, chunkAt } from "../../shared/coords.ts";
import { HIT_PREFIX } from "../../shared/world/bends.ts";
import { Buildings, STOREY, STOREY_SLACK, type BuildingRow, type BuildingStair } from "../../shared/world/buildings.ts";
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
    storeys[i] = k.storey !== STOREY_UNSAID ? k.storey : Math.max(0, Math.min(254, Math.floor((p.y - buildings[k.owner]!.base + STOREY_SLACK) / STOREY)));
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

/**
 * What the layouts knew of each piece, by the slot a map's file puts it in: `counts[c]` pieces of chunk `c`, one chunk's
 * after another's and a chunk's in the order of their slots, each with its tile, -1 where it was placed by none, and its
 * storey. What the map's buildings section does not hold, kept beside the map for the check of the two (building-places.ts).
 */
export interface KnownPlaces {
  readonly counts: Uint16Array;
  readonly i: Int16Array;
  readonly j: Int16Array;
  readonly storey: Uint8Array;
}

/** The places `ordered`'s pieces were known by, laid out by chunk and slot as a map of `dims` whose corner is at (x0, z0) holds them. */
export function knownPlaces(dims: { chunksX: number; chunksZ: number }, ordered: Ordered<{ readonly kind: string; readonly x: number; readonly z: number }>, x0: number, z0: number): KnownPlaces {
  const chunkOf = (p: { x: number; z: number }): number => chunkAt(dims, Math.round((p.x - x0) * STRUCT_UNITS) / STRUCT_UNITS, Math.round((p.z - z0) * STRUCT_UNITS) / STRUCT_UNITS);
  const listed = ordered.pieces.filter((p) => !p.kind.startsWith(HIT_PREFIX));
  const counts = new Uint16Array(dims.chunksX * dims.chunksZ);
  for (const p of listed) counts[chunkOf(p)]!++;
  const at = new Uint32Array(counts.length);
  for (let c = 1; c < counts.length; c++) at[c] = at[c - 1]! + counts[c - 1]!;
  const out = { counts, i: new Int16Array(listed.length).fill(-1), j: new Int16Array(listed.length).fill(-1), storey: new Uint8Array(listed.length) };
  ordered.pieces.forEach((p, n) => {
    if (p.kind.startsWith(HIT_PREFIX)) return;
    const row = at[chunkOf(p)]!++, k = knownOf(p);
    out.storey[row] = ordered.storey[n]!;
    if (k && ordered.of[n]! >= 0) [out.i[row], out.j[row]] = [k.i, k.j];
  });
  return out;
}

const KNOWN_MAGIC = 0x504b4e53;

/** `known` as a file's bytes: "SNKP", the chunks and the pieces as u32s, then the columns. */
export function encodeKnown(known: KnownPlaces): Uint8Array {
  const n = known.storey.length, chunks = known.counts.length;
  const out = new Uint8Array(12 + chunks * 2 + n * 5), view = new DataView(out.buffer);
  [KNOWN_MAGIC, chunks, n].forEach((v, k) => view.setUint32(k * 4, v, true));
  let at = 12;
  for (const column of [known.counts, known.i, known.j, known.storey]) {
    out.set(new Uint8Array(column.buffer, column.byteOffset, column.byteLength), at);
    at += column.byteLength;
  }
  return out;
}

export function decodeKnown(bytes: Uint8Array): KnownPlaces {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(0, true) !== KNOWN_MAGIC) throw new Error("not a file of pieces' known places");
  const chunks = view.getUint32(4, true), n = view.getUint32(8, true);
  if (bytes.length !== 12 + chunks * 2 + n * 5) throw new Error("the file of pieces' known places is cut short");
  const cut = (at: number, length: number): ArrayBuffer => bytes.slice(at, at + length).buffer as ArrayBuffer;
  return { counts: new Uint16Array(cut(12, chunks * 2)), i: new Int16Array(cut(12 + chunks * 2, n * 2)), j: new Int16Array(cut(12 + chunks * 2 + n * 2, n * 2)), storey: new Uint8Array(cut(12 + chunks * 2 + n * 4, n)) };
}
