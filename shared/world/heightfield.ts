// Terrain as a quantized height grid.
//
// The surface is defined once, here: each grid cell is two triangles split along
// the diagonal from (i, j) to (i+1, j+1). Collision, prediction and LOD 0
// rendering all use this triangulation, so what is drawn is what is solid.
//
// Everything below the surface is solid. "Under the map" is therefore a state
// the simulation can test for directly instead of a place a player can stand.

import { CHUNK_SIZE, type MapDims } from "../coords.ts";

export const TERRAIN_CELL = 2;

export class Heightfield {
  readonly dims: MapDims;
  /** Metres between samples. */
  readonly cell: number;
  /** Samples per axis (cells + 1). */
  readonly nx: number;
  readonly nz: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly minY: number;
  /** Metres per stored height unit. */
  readonly stepY: number;
  readonly heights: Uint16Array;
  /** Palette index per sample, used only for drawing. */
  readonly tint: Uint8Array;

  /**
   * `stepY` is the height of one stored unit. Use a power-of-two fraction such
   * as 1/256 so that round heights (sea level, floors) are represented exactly.
   */
  constructor(dims: MapDims, cell: number, minY: number, stepY: number, heights?: Uint16Array, tint?: Uint8Array) {
    this.dims = dims;
    this.cell = cell;
    this.sizeX = dims.chunksX * CHUNK_SIZE;
    this.sizeZ = dims.chunksZ * CHUNK_SIZE;
    this.nx = Math.round(this.sizeX / cell) + 1;
    this.nz = Math.round(this.sizeZ / cell) + 1;
    this.minY = minY;
    this.stepY = stepY;
    this.heights = heights ?? new Uint16Array(this.nx * this.nz);
    this.tint = tint ?? new Uint8Array(this.nx * this.nz);
    if (this.heights.length !== this.nx * this.nz || this.tint.length !== this.nx * this.nz) {
      throw new Error("heightfield data does not match map dimensions");
    }
  }

  /** Height of sample (i, j) in metres. */
  sample(i: number, j: number): number {
    return this.minY + this.heights[j * this.nx + i]! * this.stepY;
  }

  setSample(i: number, j: number, y: number): void {
    let q = Math.round((y - this.minY) / this.stepY);
    if (q < 0) q = 0;
    else if (q > 65535) q = 65535;
    this.heights[j * this.nx + i] = q;
  }

  /** Surface height at (x, z). Positions outside the map use the nearest edge. */
  heightAt(x: number, z: number): number {
    const nx = this.nx;
    let fx = x / this.cell;
    let fz = z / this.cell;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0;
    else if (fz > this.nz - 1) fz = this.nz - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > this.nz - 2) j = this.nz - 2;
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    const hts = this.heights;
    const h00 = hts[k]!;
    const h11 = hts[k + nx + 1]!;
    let q: number;
    if (u >= v) {
      const h10 = hts[k + 1]!;
      q = h00 + (h10 - h00) * u + (h11 - h10) * v;
    } else {
      const h01 = hts[k + nx]!;
      q = h00 + (h11 - h01) * u + (h01 - h00) * v;
    }
    return this.minY + q * this.stepY;
  }

  /** Cosine of the slope angle at (x, z): 1 is flat, 0 is vertical. */
  slopeCosAt(x: number, z: number): number {
    const nx = this.nx;
    let fx = x / this.cell;
    let fz = z / this.cell;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0;
    else if (fz > this.nz - 1) fz = this.nz - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > this.nz - 2) j = this.nz - 2;
    const k = j * nx + i;
    const hts = this.heights;
    const h00 = hts[k]!;
    const h11 = hts[k + nx + 1]!;
    let dx: number;
    let dz: number;
    if (fx - i >= fz - j) {
      const h10 = hts[k + 1]!;
      dx = h10 - h00;
      dz = h11 - h10;
    } else {
      const h01 = hts[k + nx]!;
      dx = h11 - h01;
      dz = h01 - h00;
    }
    const s = this.stepY / this.cell;
    dx *= s;
    dz *= s;
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }
}
