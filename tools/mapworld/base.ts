// The registered layers a map is made from (assets/source/maps/<name>/base, described by its VALUES.md), read north up as
// the pictures hold them: index row * nx + column, row 0 at the north and column 0 at the west.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE, FRAME_MIDDLE } from "../../shared/coords.ts";
import { readGrey } from "../map/png.ts";
import { TransverseMercator } from "./geo.ts";
import { readFloatTiff, type FloatRaster } from "./tiff.ts";

/** A map's source frame, map.json: a rectangle of whole chunks in the local Transverse Mercator round its centre. */
export interface MapInfo {
  readonly bathymetry?: string;
  /** The NAVD88 height height.png's zero stands for: -100 m unless a city's ground stands higher than 555 m. */
  readonly height_zero_m?: number;
  /** West to east, then south to north. */
  readonly size_m: readonly [number, number];
  readonly chunks: readonly [number, number];
  readonly grid_samples: readonly [number, number];
  readonly spacing_m: number;
  /** West, south, east and north edges in metres east and north of the projection's centre. */
  readonly bounds: readonly [number, number, number, number];
  /** The lattice column and row of its south-east corner (shared/coords.ts). */
  readonly frame: readonly [number, number];
  readonly center_lon_lat: readonly [number, number];
}

/**
 * Where a map's samples lie: nx columns west to east and nz rows north to south, `cell` metres apart, index row * nx +
 * column. The build places things in lattice metres, x west and z north of the lattice's middle corner (shared/coords.ts),
 * so that a map cut from another, or widened, works every place out with the same numbers where the two overlap: a
 * sample's x is x1 - cell * column and z is z1 - cell * row. The map's own engine metres are x - x0 and z - z0, which the
 * build turns places into as it writes the layers. A sample's column and row from the corner the north-west noise is read
 * from are column + noiseWest / cell and row + noiseNorth / cell.
 */
export interface Grid {
  readonly nx: number;
  readonly nz: number;
  readonly cell: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  /** Edges in metres east and north of the projection's centre. */
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  /** The east and south edges in lattice metres, and the west and north. */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly noiseWest: number;
  readonly noiseNorth: number;
}

/**
 * The corner north-west noise is read from, in lattice metres west and north of the lattice's middle corner: the north-west
 * corner of a map 127 chunks a side at the middle, as the five cities were built, so that their ground keeps its bytes.
 */
const NOISE_CORNER = 127 * CHUNK_SIZE;

/** The grid of a rectangle given by its west, south, east and north edges, `cell` metres a sample, its corner at `frame`. */
export function gridAt(bounds: readonly [number, number, number, number], cell = 2, frame: readonly [number, number] = [FRAME_MIDDLE, FRAME_MIDDLE]): Grid {
  const [west, south, east, north] = bounds;
  const sizeX = east - west;
  const sizeZ = north - south;
  const x0 = (frame[0] - FRAME_MIDDLE) * CHUNK_SIZE;
  const z0 = (frame[1] - FRAME_MIDDLE) * CHUNK_SIZE;
  return { nx: sizeX / cell + 1, nz: sizeZ / cell + 1, cell, sizeX, sizeZ, west, south, east, north, x0, z0, x1: x0 + sizeX, z1: z0 + sizeZ, noiseWest: NOISE_CORNER - sizeX - x0, noiseNorth: NOISE_CORNER - sizeZ - z0 };
}

/** A map.json's grid, which must say the same in its bounds, its sizes, its chunks and its samples. */
export function gridOf(info: MapInfo): Grid {
  const g = gridAt(info.bounds, info.spacing_m, info.frame);
  const agrees = [info.size_m[0] === g.sizeX, info.size_m[1] === g.sizeZ, info.chunks[0] * CHUNK_SIZE === g.sizeX, info.chunks[1] * CHUNK_SIZE === g.sizeZ, info.grid_samples[0] === g.nx, info.grid_samples[1] === g.nz];
  if (agrees.includes(false)) throw new Error(`map.json's bounds ${info.bounds.join(", ")} are not its size_m, chunks of ${CHUNK_SIZE} m and grid_samples`);
  return g;
}

export class Base {
  readonly folder: string;
  readonly info: MapInfo;
  readonly grid: Grid;
  readonly tm: TransverseMercator;
  private readonly cache = new Map<string, Uint8Array | Uint16Array>();

  constructor(folder: string) {
    this.folder = folder;
    this.info = JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as MapInfo;
    this.grid = gridOf(this.info);
    this.tm = new TransverseMercator(this.info.center_lon_lat[1], this.info.center_lon_lat[0]);
  }

  /** Samples in all. */
  get samples(): number {
    return this.grid.nx * this.grid.nz;
  }

  /** An 8-bit layer of base/, at its own size. */
  bytes(name: string): Uint8Array {
    return this.read(name) as Uint8Array;
  }

  /** NAVD88 metres of the elevation model at each sample, NaN where it has none. */
  elevation(): Float32Array {
    const raw = this.read("height") as Uint16Array;
    const valid = this.bytes("height_valid");
    const out = new Float32Array(raw.length);
    const zero = this.info.height_zero_m ?? -100;
    for (let i = 0; i < raw.length; i++) out[i] = valid[i] === 255 ? raw[i]! / 100 + zero : NaN;
    return out;
  }

  /** The coastal elevation model map.json names, resampled to each sample, bilinearly, in NAVD88 metres; null for a frame with no sea. */
  bathymetry(): Float32Array | null {
    const named = this.info.bathymetry;
    if (!named) return null;
    const tif = readFloatTiff(new Uint8Array(readFileSync(join(this.folder, "base", named))));
    const { nx, nz } = this.grid;
    const out = new Float32Array(nx * nz);
    // Longitude and latitude are found every 64 m and taken between: the projection bends far less than a sample over that.
    const step = 32;
    const across = Math.ceil((nx - 1) / step) + 1;
    const down = Math.ceil((nz - 1) / step) + 1;
    const lon = new Float64Array(across * down);
    const lat = new Float64Array(across * down);
    for (let r = 0; r < down; r++) {
      for (let c = 0; c < across; c++) {
        const [e, no] = this.metres(Math.min(nx - 1, c * step), Math.min(nz - 1, r * step));
        [lon[r * across + c], lat[r * across + c]] = this.tm.inverse(e, no);
      }
    }
    for (let row = 0; row < nz; row++) {
      const r0 = Math.min(down - 2, Math.floor(row / step));
      const fr = (row - r0 * step) / step;
      for (let col = 0; col < nx; col++) {
        const c0 = Math.min(across - 2, Math.floor(col / step));
        const fc = (col - c0 * step) / step;
        const k = r0 * across + c0;
        const mixAt = (g: Float64Array): number => (g[k]! * (1 - fc) + g[k + 1]! * fc) * (1 - fr) + (g[k + across]! * (1 - fc) + g[k + across + 1]! * fc) * fr;
        out[row * nx + col] = sample(tif, mixAt(lon), mixAt(lat));
      }
    }
    return out;
  }

  /** Metres east and north of the centre of sample (column, row). */
  metres(col: number, row: number): [number, number] {
    return [this.grid.west + col * this.grid.cell, this.grid.north - row * this.grid.cell];
  }

  /** The sample a longitude and latitude falls on, as a fractional column and row. */
  toSample(lon: number, lat: number): [number, number] {
    const [e, no] = this.tm.forward(lon, lat);
    return [(e - this.grid.west) / this.grid.cell, (this.grid.north - no) / this.grid.cell];
  }

  private read(name: string): Uint8Array | Uint16Array {
    let got = this.cache.get(name);
    if (!got) {
      got = readGrey(new Uint8Array(readFileSync(join(this.folder, "base", `${name}.png`))), `${name}.png`).data;
      this.cache.set(name, got);
    }
    return got;
  }
}

function sample(t: FloatRaster, x: number, y: number): number {
  const fx = Math.min(t.width - 1.000001, Math.max(0, (x - t.x0) / t.dx));
  const fy = Math.min(t.height - 1.000001, Math.max(0, (y - t.y0) / t.dy));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const v = fy - j;
  const at = (a: number, b: number): number => t.data[b * t.width + a]!;
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
}
