// The admin map's window on the world: where it looks and how near, as pixels to a metre and the place at its middle, north
// up. A place on the map is the world's metres, +x west and +z north (shared/world/coords.ts), so east is to the right as x
// falls. Pans and zooms keep the place under the pointer where it is, and the window's middle on the map.

import type { FramedDims } from "../../../shared/coords.ts";
import { COORD_UNIT, SECTOR_UNITS, latOf, lonOf, xOfLon, zOfLat, type MapExtent } from "../../../shared/world/coords.ts";

/** The most pixels to a metre the map zooms in to, and the share of the fitted scale it zooms out to. */
export const SCALE_MOST = 4;
const OUT_MOST = 0.5;
/** The share of the window the whole map fills when fitted. */
const FIT_FILL = 0.96;

export class MapWindow {
  readonly map: MapExtent;
  /** The window's size in CSS pixels. */
  width = 1;
  height = 1;
  /** Pixels to a metre, and the place at the window's middle. */
  scale = 1;
  x = 0;
  z = 0;
  /** Whether it shows the whole map, which it keeps doing as the window is resized. */
  fitted = true;

  constructor(map: MapExtent) {
    this.map = map;
    this.fit();
  }

  /** The scale at which the whole map fills the window. */
  fitScale(): number {
    return Math.min(this.width / this.map.sizeX, this.height / this.map.sizeZ) * FIT_FILL;
  }

  fit(): void {
    this.scale = this.fitScale();
    this.x = this.map.sizeX / 2;
    this.z = this.map.sizeZ / 2;
    this.fitted = true;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (this.fitted) this.fit();
    else this.clamp();
  }

  /** Where a place falls on the window, in CSS pixels from its top left. */
  sx(x: number): number {
    return this.width / 2 + (this.x - x) * this.scale;
  }

  sy(z: number): number {
    return this.height / 2 + (this.z - z) * this.scale;
  }

  /** The place under a point of the window. */
  worldX(sx: number): number {
    return this.x - (sx - this.width / 2) / this.scale;
  }

  worldZ(sy: number): number {
    return this.z - (sy - this.height / 2) / this.scale;
  }

  /** Zooms by `factor` about the window's point (sx, sy), which stays over the same place. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const wx = this.worldX(sx);
    const wz = this.worldZ(sy);
    this.scale = Math.max(this.fitScale() * OUT_MOST, Math.min(SCALE_MOST, this.scale * factor));
    this.x = wx + (sx - this.width / 2) / this.scale;
    this.z = wz + (sy - this.height / 2) / this.scale;
    this.fitted = false;
    this.clamp();
  }

  /** Moves the map with a drag of (dx, dy) pixels: what was under the pointer stays under it. */
  pan(dx: number, dy: number): void {
    this.x += dx / this.scale;
    this.z += dy / this.scale;
    this.fitted = false;
    this.clamp();
  }

  /** Puts a place at the window's middle, at `scale` if given. */
  look(x: number, z: number, scale = this.scale): void {
    this.scale = Math.max(this.fitScale() * OUT_MOST, Math.min(SCALE_MOST, scale));
    this.x = x;
    this.z = z;
    this.fitted = false;
    this.clamp();
  }

  /** Metres across the window's wider side. */
  span(): number {
    return Math.max(this.width, this.height) / this.scale;
  }

  /** Keeps the window's middle on the map. */
  private clamp(): void {
    this.x = Math.max(0, Math.min(this.map.sizeX, this.x));
    this.z = Math.max(0, Math.min(this.map.sizeZ, this.z));
  }
}

/** A line of the grid: its latitude or longitude, where it falls across the window in pixels, and whether it is numbered. */
export interface GridLine {
  k: number;
  at: number;
  sector: boolean;
  numbered: boolean;
}

/** The fewest pixels between two lines a unit apart for each unit to be drawn, and for each to be numbered. */
const UNIT_PIXELS = 24;
const UNIT_NUMBERED = 64;
/** The fewest pixels between two sectors for each to be numbered. */
const SECTOR_NUMBERED = 40;

/**
 * The lines of latitude and longitude within the map and the window: every sector's (ten units, 1,024 m), every unit's
 * where they stand far enough apart, and which carry their number, as the players' map screen draws them.
 */
export function gridLines(d: FramedDims, w: MapWindow): { lon: GridLine[]; lat: GridLine[] } {
  const unit = COORD_UNIT * w.scale;
  const step = unit >= UNIT_PIXELS ? 1 : SECTOR_UNITS;
  const every = unit >= UNIT_NUMBERED ? 1 : SECTOR_UNITS * (SECTOR_UNITS * unit < SECTOR_NUMBERED ? 2 : 1);
  // A line at 0 found by rounding up from just below it is -0, which is written 0 alike but compares otherwise.
  const line = (k: number, at: number): GridLine => ({ k: k || 0, at, sector: k % SECTOR_UNITS === 0, numbered: k % every === 0 });
  const lon: GridLine[] = [];
  const lat: GridLine[] = [];
  // Longitude grows east, as x falls; latitude grows south, as z falls.
  const west = Math.min(w.map.sizeX, w.worldX(0));
  const east = Math.max(0, w.worldX(w.width));
  for (let k = Math.ceil(lonOf(d, west) / step - 1e-6) * step; k <= lonOf(d, east) + 1e-6; k += step) lon.push(line(k, w.sx(xOfLon(d, k))));
  const north = Math.min(w.map.sizeZ, w.worldZ(0));
  const south = Math.max(0, w.worldZ(w.height));
  for (let k = Math.ceil(latOf(d, north) / step - 1e-6) * step; k <= latOf(d, south) + 1e-6; k += step) lat.push(line(k, w.sy(zOfLat(d, k))));
  return { lon, lat };
}
