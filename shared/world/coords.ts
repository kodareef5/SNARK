// Two ways to say where a place is on a map, kept apart.
//
// The coordinate a player reads, as ARK writes it: latitude and longitude in units of 102.4 m from 0,0 at the map's display
// origin, its top left. Longitude grows east and latitude south, and neither is negative on the map. Ten units are a sector,
// 1,024 m. The origin is a point of the lattice every map sits on (shared/coords.ts), so a place reads the same when its
// map is widened on any side.
//
// A place's share of the map's picture: 0 to 1 across the built extent, west to east and north to south. North is +Z. The
// axes are right-handed with +Y up, so on a north-up map +X points west and east is -X.

import { CHUNK_SIZE, type FramedDims } from "../coords.ts";

/** Metres in a unit of latitude or longitude: a tenth of a sector. */
export const COORD_UNIT = 102.4;
/** Units of latitude or longitude across a sector. */
export const SECTOR_UNITS = 10;
/** Units across a chunk, CHUNK_SIZE / COORD_UNIT, written out so that it is exact. */
const CHUNK_UNITS = 0.625;

/** Units east of the display origin. */
export function lonOf(d: FramedDims, x: number): number {
  return (d.originX - d.frameX - x / CHUNK_SIZE) * CHUNK_UNITS;
}

/** Units south of the display origin. */
export function latOf(d: FramedDims, z: number): number {
  return (d.originZ - d.frameZ - z / CHUNK_SIZE) * CHUNK_UNITS;
}

export function xOfLon(d: FramedDims, lon: number): number {
  return (d.originX - d.frameX - lon / CHUNK_UNITS) * CHUNK_SIZE;
}

export function zOfLat(d: FramedDims, lat: number): number {
  return (d.originZ - d.frameZ - lat / CHUNK_UNITS) * CHUNK_SIZE;
}

/** As every screen writes a place, latitude first: "47.3 lat  50.0 lon". */
export function latLonText(lat: number, lon: number): string {
  return `${lat.toFixed(1)} lat  ${lon.toFixed(1)} lon`;
}

/** The size of a map in metres. A Heightfield is one. */
export interface MapExtent {
  readonly sizeX: number;
  readonly sizeZ: number;
}

/** Where x falls across the map's picture: 0 at the built extent's west edge, 1 at its east. */
export function mapU(m: MapExtent, x: number): number {
  return 1 - x / m.sizeX;
}

/** Where z falls down the map's picture: 0 at the built extent's north edge, 1 at its south. */
export function mapV(m: MapExtent, z: number): number {
  return 1 - z / m.sizeZ;
}

export function xOfU(m: MapExtent, u: number): number {
  return (1 - u) * m.sizeX;
}

export function zOfV(m: MapExtent, v: number): number {
  return (1 - v) * m.sizeZ;
}
