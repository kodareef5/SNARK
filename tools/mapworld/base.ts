// The registered layers a map is made from (assets/source/maps/<name>/base, described by its VALUES.md), read north up as
// the pictures hold them: index row * side + column, row 0 at the north and column 0 at the west.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readGrey } from "../map/png.ts";
import { TransverseMercator } from "./geo.ts";
import { readFloatTiff, type FloatRaster } from "./tiff.ts";

export interface MapInfo {
  readonly bathymetry?: string;
  readonly size_m: number;
  readonly chunks: number;
  readonly grid_samples: number;
  readonly spacing_m: number;
  readonly bounds: readonly [number, number, number, number];
  readonly center_lon_lat: readonly [number, number];
}

export class Base {
  readonly folder: string;
  readonly info: MapInfo;
  /** Samples a side. */
  readonly n: number;
  readonly tm: TransverseMercator;
  private readonly cache = new Map<string, Uint8Array | Uint16Array>();

  constructor(folder: string) {
    this.folder = folder;
    this.info = JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as MapInfo;
    this.n = this.info.grid_samples;
    this.tm = new TransverseMercator(this.info.center_lon_lat[1], this.info.center_lon_lat[0]);
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
    for (let i = 0; i < raw.length; i++) out[i] = valid[i] === 255 ? raw[i]! / 100 - 100 : NaN;
    return out;
  }

  /** The coastal elevation model map.json names, else the one GeoTIFF in base/bathymetry, resampled to each sample, bilinearly, in NAVD88 metres. */
  bathymetry(): Float32Array {
    const folder = join(this.folder, "base", "bathymetry");
    const named = this.info.bathymetry;
    const tifs = named ? [] : readdirSync(folder).filter((f) => f.endsWith(".tif"));
    if (!named && tifs.length !== 1) throw new Error(`${folder} should hold one coastal elevation model, or map.json name one, and holds ${tifs.length}`);
    const tif = readFloatTiff(new Uint8Array(readFileSync(named ? join(this.folder, "base", named) : join(folder, tifs[0]!))));
    const n = this.n;
    const out = new Float32Array(n * n);
    // Longitude and latitude are found every 64 m and taken between: the projection bends far less than a sample over that.
    const step = 32;
    const knots = Math.ceil((n - 1) / step) + 1;
    const lon = new Float64Array(knots * knots);
    const lat = new Float64Array(knots * knots);
    for (let r = 0; r < knots; r++) {
      for (let c = 0; c < knots; c++) {
        const [e, no] = this.metres(Math.min(n - 1, c * step), Math.min(n - 1, r * step));
        [lon[r * knots + c], lat[r * knots + c]] = this.tm.inverse(e, no);
      }
    }
    for (let row = 0; row < n; row++) {
      const r0 = Math.min(knots - 2, Math.floor(row / step));
      const fr = (row - r0 * step) / step;
      for (let col = 0; col < n; col++) {
        const c0 = Math.min(knots - 2, Math.floor(col / step));
        const fc = (col - c0 * step) / step;
        const k = r0 * knots + c0;
        const mixAt = (g: Float64Array): number => (g[k]! * (1 - fc) + g[k + 1]! * fc) * (1 - fr) + (g[k + knots]! * (1 - fc) + g[k + knots + 1]! * fc) * fr;
        out[row * n + col] = sample(tif, mixAt(lon), mixAt(lat));
      }
    }
    return out;
  }

  /** Metres east and north of the centre of sample (column, row). */
  metres(col: number, row: number): [number, number] {
    const half = this.info.size_m / 2;
    return [-half + col * this.info.spacing_m, half - row * this.info.spacing_m];
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
