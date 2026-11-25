import { Heightfield, type GroundView, type TintView } from "../../shared/world/heightfield.ts";

/**
 * Ground held in pieces, as a page will hold it (planning/workstreams/maps-v3.md, phase 6): its own arrays are noise, so
 * a reader of them reads wrong; its samples come only through its methods and views, and each view is a fresh copy of
 * its box alone, so a read outside the box is undefined.
 */
export class PagedGround extends Heightfield {
  readonly from: Heightfield;
  views = 0;

  constructor(from: Heightfield, span = 24) {
    const noise = (n: number, k: number): number => (Math.imul(n + 1, 2654435761) >>> k) & 0xffff;
    super(from.dims, from.cell, from.minY, from.stepY, Uint16Array.from(from.heights, (_, n) => noise(n, 7)), Uint8Array.from(from.tint, (_, n) => noise(n, 11) & 255));
    this.from = from;
    this.span = span;
    this.seaLevel = from.seaLevel;
    this.water = from.water;
    this.bounds = from.bounds;
    this.road = from.road;
    this.streets = from.streets;
  }

  private box(i0: number, j0: number, i1: number, j1: number): void {
    if (!(i0 >= 0 && j0 >= 0 && i0 <= i1 && j0 <= j1 && i1 < this.nx && j1 < this.nz)) throw new Error(`box ${i0}, ${j0}, ${i1}, ${j1} is off the map`);
    this.views++;
  }

  override view(i0: number, j0: number, i1: number, j1: number): GroundView {
    this.box(i0, j0, i1, j1);
    const w = i1 - i0 + 1;
    return { heights: this.from.window(i0, j0, i1, j1), stride: w, off: -(j0 * w + i0) };
  }

  override tints(i0: number, j0: number, i1: number, j1: number): TintView {
    this.box(i0, j0, i1, j1);
    const w = i1 - i0 + 1, tint = new Uint8Array(w * (j1 - j0 + 1));
    for (let j = j0; j <= j1; j++) tint.set(this.from.tint.subarray(j * this.nx + i0, j * this.nx + i0 + w), (j - j0) * w);
    return { tint, stride: w, off: -(j0 * w + i0) };
  }

  override tintOf(i: number, j: number): number {
    return this.from.tintOf(i, j);
  }

  override sample(i: number, j: number): number {
    return this.from.sample(i, j);
  }

  override heightAt(x: number, z: number): number {
    return this.from.heightAt(x, z);
  }

  override slopeCosAt(x: number, z: number): number {
    return this.from.slopeCosAt(x, z);
  }

  override window(i0: number, j0: number, i1: number, j1: number): Uint16Array {
    return this.from.window(i0, j0, i1, j1);
  }
}
