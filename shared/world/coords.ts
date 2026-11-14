// ARK's map coordinates. Latitude and longitude each run 0 to 100 across the map: latitude 0 is the north edge and 100 the
// south, longitude 0 is the west edge and 100 the east. North is +Z. The axes are right-handed with +Y up, so on a north-up
// map +X points west and east is -X: minimapImage (client/core/hud.ts) puts x = sizeX at its left edge and x = 0 at its right.

/** The size of a map in metres. A Heightfield is one. */
export interface MapExtent {
  readonly sizeX: number;
  readonly sizeZ: number;
}

export function latOf(m: MapExtent, z: number): number {
  return (1 - z / m.sizeZ) * 100;
}

export function lonOf(m: MapExtent, x: number): number {
  return (1 - x / m.sizeX) * 100;
}

export function zOfLat(m: MapExtent, lat: number): number {
  return (1 - lat / 100) * m.sizeZ;
}

export function xOfLon(m: MapExtent, lon: number): number {
  return (1 - lon / 100) * m.sizeX;
}

/** As every screen writes a place: "47.3 lat  50.0 lon". */
export function latLonText(lat: number, lon: number): string {
  return `${lat.toFixed(1)} lat  ${lon.toFixed(1)} lon`;
}
