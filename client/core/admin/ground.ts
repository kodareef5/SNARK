// The admin map's picture of the ground, painted as the players' map paints it (paintRelief in client/core/tactical.ts)
// from the map's overviews alone: every fourth sample, 8 m apart, which every map file has and the page fetches as the game
// does. All of a 16 km map's overviews are some 12 MB where its whole ground is some 40, and at 8 m a pixel the picture holds
// all they show.

import { Heightfield, TERRAIN_CELL } from "../../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, joinWater, readHead, readPart, type MapHead, type OverviewPiece } from "../../../shared/world/mapfile.ts";
import { paintRelief } from "../tactical.ts";

/** Metres between an overview's samples. */
export const OVERVIEW_CELL = TERRAIN_CELL * OVERVIEW_STEP;
/** The picture's side in pixels at the least and the most. */
const SIDE_LEAST = 256;
const SIDE_MOST = 2048;

/** The map's ground from its overviews, every one of which must be given: a heightfield of OVERVIEW_CELL with tints and water. */
export function overviewGround(head: MapHead, pieces: readonly OverviewPiece[]): Heightfield {
  const hf = new Heightfield(head.dims, OVERVIEW_CELL, head.minY, head.stepY);
  hf.seaLevel = head.seaLevel;
  hf.holdNone();
  // Each overview's grid is this heightfield's own samples, so a step of one copies it.
  for (const p of pieces) hf.fill(p.sq.cx0, p.sq.cz0, p.sq.cx1, p.sq.cz1, 1, p.heights, p.tint);
  if (head.water) hf.water = joinWater(head, pieces.map((p) => p.water!));
  return hf;
}

/**
 * The map whose head is at `url` and its ground from its overviews, each part checked against the hash its head names. `get`
 * fetches a file's bytes; the parts are beside the head, as the server's map routes serve them (server/main.ts mapRoutes).
 */
export async function loadGround(get: (url: string) => Promise<Uint8Array>, url: string): Promise<{ head: MapHead; hf: Heightfield }> {
  const head = readHead(await get(url));
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const pieces = await Promise.all(
    head.parts.filter((p) => p.kind === "overview").map(async (p) => {
      const piece = readPart(head, p, await get(base + p.name));
      if (piece.kind !== "overview") throw new Error(`map: ${p.name} is not an overview`);
      return piece;
    }),
  );
  return { head, hf: overviewGround(head, pieces) };
}

/** The side of the ground's picture: a pixel to a sample along the map's longer side, within SIDE_LEAST and SIDE_MOST. */
export function pictureSide(hf: Heightfield): number {
  return Math.max(SIDE_LEAST, Math.min(SIDE_MOST, Math.ceil(Math.max(hf.sizeX, hf.sizeZ) / hf.cell)));
}

/**
 * The whole map's ground, north up, as RGBA bytes `side` pixels square: the square as wide as the map's longer side, centred
 * on the map, as the players' map draws its farthest zoom. Where it reaches past a shorter side is not ground.
 */
export function groundPicture(hf: Heightfield, palette: Uint8Array, side = pictureSide(hf)): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint32Array(side * side);
  paintRelief(hf, palette, 0, 0, 0, side, out);
  return new Uint8ClampedArray(out.buffer);
}

/** Where the ground's picture lies, in the world's metres: its west and north edges and its side. */
export function pictureExtent(hf: { sizeX: number; sizeZ: number }): { west: number; north: number; side: number } {
  const side = Math.max(hf.sizeX, hf.sizeZ);
  return { west: (hf.sizeX + side) / 2, north: (hf.sizeZ + side) / 2, side };
}
