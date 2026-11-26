// The ground's 2 m samples painted from the streets' sections (planning/workstreams/streets.md): each sample takes the band
// the streets' planes (shared/world/streets.ts chunkPlanes) put it in, as the ground's text on a desktop's lit tiers draws
// it, so the stepped ground of a phone and low poly, the wheel's 4 m classes and everything the build sets on the ground
// (walks, furniture, plants) agree with the straight edges.
//
// - On a carriageway, or a corner's fill, a sample is street (roads.png's 1) where it is free.
// - In a verge's band it takes the verge's kind (`verge`, which tint.ts colours by), and a walk there is taken up.
// - In a walk's band it is sidewalk (use.png's 1).
// - Within STREET_MARGIN past the walk's band, or past the verge's where a side has no walk, a sidewalk is taken up:
//   the walks the data made by rule half a metre off the kerb, and the made walks of both carriageways of a pair, which
//   lay on its median.
// A sample under a footprint or the water, a crossing's, or a plaza's under a walk, is left as it was.

import { CHUNK_SIDE, PLANE_BYTES, chunkPlanes, vergeOf, type StreetSectors } from "../../../shared/world/streets.ts";
import type { Grid } from "../base.ts";
import type { Band, Gone } from "./yield.ts";

/** What use.png's values say (tools/mapdata/streets.py USE), as ground.ts reads them. */
const SIDEWALK = 1, CROSSING = 2, PLAZA = 4;
/** A paved verge's kind (shared/world/streets.ts VERGES). */
const PAVED = 4;

export interface Painted { road: number; verge: number; walk: number; cleared: number }

/** How far past a gone street's edge the data's samples of its asphalt and its crossings lie, and its walks ran. */
const ROAD_PAST = 1.5, WALK_PAST = 4.5;

export interface TakenUp { road: number; walk: number; crossing: number }

/**
 * Takes up what the data painted for the roads that are gone (yield.ts): each street and crossing sample on a gone
 * band or just past it, and each sidewalk sample beside one the data made walks along, where no road that is left is
 * as near. The bands are in the data's metres, as the samples are: `cell` apart from the grid's west and north edges.
 */
export function takeUp(bands: readonly Band[], own: Gone, walked: Gone, grid: Grid, roads: Uint8Array, use: Uint8Array): TakenUp {
  const { nx, nz, cell, west, north } = grid;
  const out: TakenUp = { road: 0, walk: 0, crossing: 0 };
  for (const b of bands) for (let i = 1; i < b.line.length; i++) {
    const [ax, az] = b.line[i - 1] as [number, number], [bx, bz] = b.line[i] as [number, number], r = b.half + WALK_PAST;
    const [c0, c1] = [Math.max(0, Math.floor((Math.min(ax, bx) - r - west) / cell)), Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + r - west) / cell))];
    const [r0, r1] = [Math.max(0, Math.floor((north - Math.max(az, bz) - r) / cell)), Math.min(nz - 1, Math.ceil((north - Math.min(az, bz) + r) / cell))];
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const k = row * nx + col, [e, n] = [west + col * cell, north - row * cell];
      if ((roads[k] === 1 || use[k] === CROSSING) && own(e, n, ROAD_PAST) < Infinity) {
        if (roads[k] === 1) { roads[k] = 0; out.road++; }
        if (use[k] === CROSSING) { use[k] = 0; out.crossing++; }
      }
      if (use[k] === SIDEWALK && walked(e, n, WALK_PAST) < Infinity) { use[k] = 0; out.walk++; }
    }
  }
  return out;
}

/**
 * Paints `roads`, `use` and `verge` (a byte a sample, the verge's kind or 0) of the map `grid` frames from the streets
 * `held`, in the samples' own order (row 0 north, column 0 west). `free(i)` is whether sample i may change at all.
 */
export function paintStreets(held: StreetSectors, grid: Grid, roads: Uint8Array, use: Uint8Array, verge: Uint8Array, free: (i: number) => boolean): Painted {
  const { nx, nz } = grid;
  const chunksX = grid.sizeX / 64, chunksZ = grid.sizeZ / 64;
  const dist = new Uint8Array(CHUNK_SIDE * CHUNK_SIDE * PLANE_BYTES), kinds = new Uint8Array(dist.length);
  const out: Painted = { road: 0, verge: 0, walk: 0, cleared: 0 };
  for (let cz = 0; cz < chunksZ; cz++) for (let cx = 0; cx < chunksX; cx++) {
    if (!chunkPlanes(held, cx, cz, dist, kinds)) continue;
    for (let j = 0; j < CHUNK_SIDE; j++) for (let i = 0; i < CHUNK_SIDE; i++) {
      const b = (j * CHUNK_SIDE + i) * PLANE_BYTES;
      if (dist[b] === 0 && dist[b + 1] === 0 && dist[b + 2] === 0) continue;
      // The map's sample (32 cx + i, 32 cz + j) is the base's column nx - 1 - that, row nz - 1 - that: x is west, z north.
      const col = nx - 1 - (cx * CHUNK_SIDE + i), row = nz - 1 - (cz * CHUNK_SIDE + j), k = row * nx + col;
      if (col < 0 || row < 0 || !free(k) || use[k] === CROSSING) continue;
      if (dist[b]! > 128) {
        if (roads[k] === 0) { roads[k] = 1; out.road++; }
        continue;
      }
      if (roads[k] !== 0) continue;
      if (dist[b + 1]! > 128) {
        const kind = vergeOf(kinds[b]!);
        if (kind === 0) continue;
        verge[k] = kind;
        out.verge++;
        if (use[k] === SIDEWALK || (kind === PAVED && use[k] === 0)) use[k] = kind === PAVED ? PLAZA : 0;
      } else if (dist[b + 2]! > 128) {
        if (use[k] !== SIDEWALK && use[k] !== PLAZA) { use[k] = SIDEWALK; out.walk++; }
        verge[k] = 0;
      } else if (use[k] === SIDEWALK) {
        use[k] = 0;
        out.cleared++;
      }
    }
  }
  return out;
}
