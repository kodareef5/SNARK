// Each grid cell is two triangles split along the diagonal from (i, j) to (i+1, j+1). Collision, prediction and LOD 0 rendering
// all use this triangulation, so what is drawn is what is solid. Everything below the surface is solid.

import { CHUNK_SIZE, type MapDims } from "../coords.ts";
import type { MapWater } from "./water.ts";

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
  /** Palette index per sample, used only for drawing. Empty for a server's ground, which draws nothing. */
  readonly tint: Uint8Array;
  /** Height of the sea's surface, set by the code that builds the map. -Infinity for a map with no sea. */
  seaLevel = -Infinity;
  /** Water standing on its own surfaces, apart from the sea (water.ts), or null for a map with none. */
  water: MapWater | null = null;

  /** Use a power-of-two fraction such as 1/256 for `stepY`, so round heights (sea level, floors) are exact. */
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
    if (this.heights.length !== this.nx * this.nz || (this.tint.length !== 0 && this.tint.length !== this.nx * this.nz)) {
      throw new Error("heightfield data does not match map dimensions");
    }
  }

  /** In metres. */
  sample(i: number, j: number): number {
    return this.minY + this.heights[j * this.nx + i]! * this.stepY;
  }

  setSample(i: number, j: number, y: number): void {
    let q = Math.round((y - this.minY) / this.stepY);
    if (q < 0) q = 0;
    else if (q > 65535) q = 65535;
    this.heights[j * this.nx + i] = q;
  }

  /** Positions outside the map use the nearest edge. */
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

  /**
   * The height of the water's surface over (x, z): the body's whose square holds it, else the sea's, -Infinity for none.
   * There is water where the ground is under it. Every test of the sea asks this, so a map with no bodies is as it was.
   */
  waterAt(x: number, z: number): number {
    const w = this.water;
    if (w === null) return this.seaLevel;
    const b = w.bodyAt(x, z);
    return b === 0 ? this.seaLevel : w.surface[b]!;
  }

  /** The samples from (i0, j0) to (i1, j1), both included, row by row. */
  window(i0: number, j0: number, i1: number, j1: number): Uint16Array {
    const w = i1 - i0 + 1;
    const out = new Uint16Array(w * (j1 - j0 + 1));
    for (let j = j0; j <= j1; j++) out.set(this.heights.subarray(j * this.nx + i0, j * this.nx + i0 + w), (j - j0) * w);
    return out;
  }

  /** Cosine of the slope angle. 1 is flat, 0 is vertical. */
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

/** The ground's shape as Heightfield gives it: its scale, and samples from `window` with where they start in it. */
export interface HeightPart {
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly minY: number;
  readonly stepY: number;
  readonly i0: number;
  readonly j0: number;
  /** Samples a row. */
  readonly w: number;
  readonly heights: Uint16Array;
}

/** Heightfield.heightAt over a part of its samples, to the bit: for a worker sent only those. */
export class HeightWindow {
  private readonly part: HeightPart;

  constructor(part: HeightPart) {
    this.part = part;
  }

  heightAt(x: number, z: number): number {
    const { cell, nx, nz, minY, stepY, i0, j0, w, heights: hts } = this.part;
    let fx = x / cell;
    let fz = z / cell;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1) fx = nx - 1;
    if (fz < 0) fz = 0;
    else if (fz > nz - 1) fz = nz - 1;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > nx - 2) i = nx - 2;
    if (j > nz - 2) j = nz - 2;
    const u = fx - i;
    const v = fz - j;
    if (i < i0 || j < j0 || i + 1 >= i0 + w || j + 1 >= j0 + hts.length / w) throw new Error(`the ground at ${x}, ${z} is outside the part sent`);
    const k = (j - j0) * w + i - i0;
    const h00 = hts[k]!;
    const h11 = hts[k + w + 1]!;
    let q: number;
    if (u >= v) {
      const h10 = hts[k + 1]!;
      q = h00 + (h10 - h00) * u + (h11 - h10) * v;
    } else {
      const h01 = hts[k + w]!;
      q = h00 + (h11 - h01) * u + (h01 - h00) * v;
    }
    return minY + q * stepY;
  }
}
