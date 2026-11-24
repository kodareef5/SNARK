import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { OVERVIEW_CHUNKS, squareOf, type MapHead, type MapPart } from "../../shared/world/mapfile.ts";

/**
 * Metres round the body whose ground a prediction may read: what a tick's step reaches, a vehicle's length, and the way
 * from the snapshot a replay starts at, at 250 m/s on a link of 200 ms. Its body is predicted only where every chunk this
 * near holds the map's own ground (shared/world/heightfield.ts), and the page's first frame waits for the sectors it meets.
 */
export const PREDICTED_REACH = 128;

/**
 * Metres round the body whose overviews the first frame waits for, so the ground there is drawn finer than the head's
 * coarse picture and its trees stand: the far trees' reach on the high tier (assets/tiers.ts), within half an overview's
 * side, so at most four.
 */
export const FIRST_REACH = 2048;

/**
 * Whether the first frame waits for part `p` wherever the body is: the landmarks' definitions, and on a map with a listed
 * node layer every sector's ground and so every overview, since the head does not say that layer's slots a chunk and a
 * node source counts them as it is made.
 */
export function everywhere(head: MapHead, p: MapPart): boolean {
  return p.kind === "land" || ((p.kind === "ground" || p.kind === "overview") && head.layers.some((rule) => rule.type === 1));
}

/** A square of the lattice by its column and row, as a number. */
export const squareKey = (col: number, row: number): number => col * 4096 + row;
/** The overview's square a sector's lies in: both are squares of the lattice, and a sector's lies within one overview's. */
export const overviewOf = (sector: { readonly col: number; readonly row: number }): number => squareKey(Math.floor((sector.col * SECTOR_CHUNKS) / OVERVIEW_CHUNKS), Math.floor((sector.row * SECTOR_CHUNKS) / OVERVIEW_CHUNKS));

/**
 * The parts the first frame waits for with the body at (x, z), besides the head, in the head's order: those it waits for
 * everywhere, the ground of each sector within PREDICTED_REACH of it on both axes, where the body is predicted from the
 * first frame on, the overviews those sectors lie in, which hold their nodes and their water, and those less than
 * FIRST_REACH from it. The loader asks by it, and the map's build holds its worst over the map to a budget
 * (tools/map/pack.ts).
 */
export function firstFrameParts(head: MapHead, x: number, z: number): MapPart[] {
  const r = PREDICTED_REACH;
  const grounds = head.parts.filter((p) => {
    if (p.kind !== "ground") return false;
    const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
    return sq.cx0 * CHUNK_SIZE <= x + r && sq.cx1 * CHUNK_SIZE >= x - r && sq.cz0 * CHUNK_SIZE <= z + r && sq.cz1 * CHUNK_SIZE >= z - r;
  });
  const under = new Set(grounds.map(overviewOf));
  return head.parts.filter((p) => everywhere(head, p) || grounds.includes(p) || (p.kind === "overview" && (under.has(squareKey(p.col, p.row)) || partDistance(head, p, x, z) < FIRST_REACH)));
}

/** Metres from (x, z) to the map's part `p`'s square, an overview's (whose tops are of the same square) or a sector's. */
export function partDistance(head: MapHead, p: MapPart, x: number, z: number): number {
  const sq = squareOf(head.dims, p.kind === "overview" || p.kind === "tops" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
}
