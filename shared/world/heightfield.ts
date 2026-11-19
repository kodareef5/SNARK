// Each grid cell is two triangles split along the diagonal from (i, j) to (i+1, j+1). Collision, prediction and LOD 0 rendering
// all use this triangulation, so what is drawn is what is solid. Everything below the surface is solid.
//
// A client's ground comes a part at a time (shared/world/mapfile.ts): every sample is first filled from the head's coarse
// picture, then from its overview, and each sector then sets its own. `exact` says which chunks hold the map's own
// samples, and `changes` where samples changed.

import { CHUNK_SIZE, chunkCount, framed, type FramedDims, type MapDims } from "../coords.ts";
import type { MapWater } from "./water.ts";

export const TERRAIN_CELL = 2;

export class Heightfield {
  /** With its frame and display origin, the defaults where the dims it was made with give none. */
  readonly dims: FramedDims;
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
  /**
   * What the ground is to a wheel, a class each two samples a side (4 m, vehicle-surface.ts GROUND_CLASS): the cell of
   * sample (i, j) is (i >> 1, j >> 1), `groundX` a row. Unlike the tint it is what the ground does, so the server keeps it.
   * Empty where a map gives none: every place is then plain ground.
   */
  readonly ground: Uint8Array;
  readonly groundX: number;
  /** Height of the sea's surface, set by the code that builds the map. -Infinity for a map with no sea. */
  seaLevel = -Infinity;
  /** Water standing on its own surfaces, apart from the sea (water.ts), or null for a map with none. */
  water: MapWater | null = null;
  /**
   * Per chunk, row by row, 1 where its samples are the map's own and 0 where they stand in for them until its sector is
   * set (`hold`). A heightfield is made with all its own.
   */
  readonly exact: Uint8Array;
  /**
   * Each change to the samples since the heightfield was made, oldest first, four numbers a change: the chunks it covers,
   * cx0, cz0 up to but not including cx1, cz1. A reader that made something of the samples makes it again where they changed.
   */
  readonly changes: number[] = [];

  /** Use a power-of-two fraction such as 1/256 for `stepY`, so round heights (sea level, floors) are exact. */
  constructor(dims: MapDims, cell: number, minY: number, stepY: number, heights?: Uint16Array, tint?: Uint8Array, ground?: Uint8Array) {
    this.dims = framed(dims);
    this.cell = cell;
    this.sizeX = dims.chunksX * CHUNK_SIZE;
    this.sizeZ = dims.chunksZ * CHUNK_SIZE;
    this.nx = Math.round(this.sizeX / cell) + 1;
    this.nz = Math.round(this.sizeZ / cell) + 1;
    this.minY = minY;
    this.stepY = stepY;
    this.heights = heights ?? new Uint16Array(this.nx * this.nz);
    this.tint = tint ?? new Uint8Array(this.nx * this.nz);
    this.groundX = (this.nx + 1) >> 1;
    this.ground = ground ?? new Uint8Array(0);
    if (this.heights.length !== this.nx * this.nz || (this.tint.length !== 0 && this.tint.length !== this.nx * this.nz) ||
      (this.ground.length !== 0 && this.ground.length !== this.groundX * ((this.nz + 1) >> 1))) {
      throw new Error("heightfield data does not match map dimensions");
    }
    this.exact = new Uint8Array(chunkCount(dims)).fill(1);
  }

  /** The ground's class where (x, z) stands (GROUND_CLASS); 0, plain ground, off the map or where it has none. */
  groundClassAt(x: number, z: number): number {
    if (this.ground.length === 0) return 0;
    const i = Math.round(x / this.cell);
    const j = Math.round(z / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0;
    return this.ground[(j >> 1) * this.groundX + (i >> 1)]!;
  }

  /** From now on no chunk holds its own samples until it is held: a client's ground, which comes a part at a time. */
  holdNone(): void {
    this.exact.fill(0);
  }

  /**
   * Fills the samples of chunks cx0, cz0 up to cx1, cz1 that are not their own from every `step`th sample of them, given
   * from the first chunk's corner row by row with its far edges: a height as the two triangles of the coarse cell, split as
   * the ground's are, have it there, rounded, which is how a tile that coarse draws it, and a tint the nearest coarse
   * sample's. A sample on the edge of a chunk that holds its own is left as it is.
   */
  fill(cx0: number, cz0: number, cx1: number, cz1: number, step: number, heights: Uint16Array, tint: Uint8Array): void {
    const per = CHUNK_SIZE / this.cell;
    const w = ((cx1 - cx0) * per) / step + 1;
    const d = heights.length / w;
    const [i0, j0, nx, cx] = [cx0 * per, cz0 * per, this.nx, this.dims.chunksX];
    for (let z = cz0; z < cz1; z++) {
      for (let x = cx0; x < cx1; x++) {
        if (this.exact[z * cx + x] === 1) continue;
        for (let j = z * per; j <= z * per + per; j++) {
          const edgeJ = j === z * per || j === z * per + per;
          const cj = Math.min(d - 2, Math.floor((j - j0) / step));
          const v = (j - j0 - cj * step) / step;
          for (let i = x * per; i <= x * per + per; i++) {
            if ((edgeJ || i === x * per || i === x * per + per) && this.ownSample(i, j)) continue;
            const ci = Math.min(w - 2, Math.floor((i - i0) / step));
            const u = (i - i0 - ci * step) / step;
            const k = cj * w + ci;
            const h00 = heights[k]!, h11 = heights[k + w + 1]!;
            const q = u >= v ? h00 + (heights[k + 1]! - h00) * u + (h11 - heights[k + 1]!) * v : h00 + (h11 - heights[k + w]!) * u + (heights[k + w]! - h00) * v;
            this.heights[j * nx + i] = Math.round(q);
            if (this.tint.length > 0) this.tint[j * nx + i] = tint[(cj + Math.round(v)) * w + ci + Math.round(u)]!;
          }
        }
      }
    }
    this.changes.push(cx0, cz0, cx1, cz1);
  }

  /** Chunks cx0, cz0 up to cx1, cz1 hold their own samples from now on, which the caller has just set. */
  hold(cx0: number, cz0: number, cx1: number, cz1: number): void {
    for (let z = cz0; z < cz1; z++) this.exact.fill(1, z * this.dims.chunksX + cx0, z * this.dims.chunksX + cx1);
    this.changes.push(cx0, cz0, cx1, cz1);
  }

  /** Whether every chunk the box from (x0, z0) to (x1, z1) metres touches holds its own samples, the box held to the map. */
  exactIn(x0: number, z0: number, x1: number, z1: number): boolean {
    const { chunksX, chunksZ } = this.dims;
    const at = (v: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor(v / CHUNK_SIZE)));
    const [a, b, c, e] = [at(x0, chunksX), at(x1, chunksX), at(z0, chunksZ), at(z1, chunksZ)];
    for (let z = c; z <= e; z++) for (let x = a; x <= b; x++) if (this.exact[z * chunksX + x] === 0) return false;
    return true;
  }

  /** Whether sample (i, j) is one of a chunk that holds its own: any of the up to four chunks it is a corner or an edge of. */
  private ownSample(i: number, j: number): boolean {
    const per = CHUNK_SIZE / this.cell;
    const { chunksX, chunksZ } = this.dims;
    const x1 = Math.min(chunksX - 1, Math.floor(i / per)), x0 = i % per === 0 ? Math.max(0, i / per - 1) : x1;
    const z1 = Math.min(chunksZ - 1, Math.floor(j / per)), z0 = j % per === 0 ? Math.max(0, j / per - 1) : z1;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.exact[z * chunksX + x] === 1) return true;
    return false;
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
