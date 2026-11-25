import type { Registry } from "../../shared/content/registry.ts";
import { GroundPages } from "../../client/core/ground/pages.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { Heightfield, TERRAIN_CELL, type GroundView, type TintView } from "../../shared/world/heightfield.ts";
import { nodeLayers, squaresOf, type NodeLayer } from "../../shared/world/mapfile.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";

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

  override stepsAt(i: number, j: number): number {
    return this.from.stepsAt(i, j);
  }

  override every(i0: number, j0: number, step: number, w: number, h: number, heights: Uint16Array | null, tint: Uint8Array | null): void {
    this.from.every(i0, j0, step, w, h, heights, tint);
  }
}

/** Every sample of `hf` as a dense heightfield holds them, read through its methods: its heights, tints and ground classes. */
export function denseOf(hf: Heightfield): { heights: Uint16Array; tint: Uint8Array; ground: Uint8Array } {
  const heights = hf.window(0, 0, hf.nx - 1, hf.nz - 1);
  const t = hf.tints(0, 0, hf.nx - 1, hf.nz - 1), tint = new Uint8Array(hf.nx * hf.nz);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) tint[j * hf.nx + i] = t.tint[t.off + j * t.stride + i]!;
  const gz = (hf.nz + 1) >> 1, ground = new Uint8Array(hf.groundX * gz), streets = hf.streets;
  hf.streets = null;
  for (let j = 0; j < gz; j++) for (let i = 0; i < hf.groundX; i++) ground[j * hf.groundX + i] = hf.groundClassAt(i * 2 * hf.cell, j * 2 * hf.cell);
  hf.streets = streets;
  return { heights, tint, ground };
}

/** Every node `layers` stand on `hf` under `reg`, chunk by chunk and slot by slot, as its kind, form, place and turn. */
export function nodesOf(hf: Heightfield, reg: Registry, layers: readonly NodeLayer[]): string[] {
  const source = nodeLayers(hf.dims, hf, reg, layers);
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const out: string[] = [];
  for (let c = 0; c < hf.dims.chunksX * hf.dims.chunksZ && source; c++) {
    for (let k = 0; k < source.perChunk; k++) {
      source.at(c, k, spot);
      if (spot.kind !== 0) out.push(`${c} ${k} ${spot.kind} ${spot.form} ${spot.x} ${spot.y} ${spot.z} ${spot.yaw}`);
    }
  }
  return out;
}

/** `dense`'s ground as the page's pages hold it, every sector held; a sample read outside them all would be poisoned. */
export function pagesOf(dense: Heightfield): GroundPages {
  const hf = new GroundPages(dense.dims, dense.minY, dense.stepY, { sample: () => 65535 });
  const per = CHUNK_SIZE / TERRAIN_CELL;
  for (const sq of squaresOf(hf.dims, SECTOR_CHUNKS)) {
    const [i0, j0, w, d] = [sq.cx0 * per, sq.cz0 * per, (sq.cx1 - sq.cx0) * per + 1, (sq.cz1 - sq.cz0) * per + 1];
    const tint = new Uint8Array(w * d), gw = ((w - 1) >> 1) + 1, ground = new Uint8Array(gw * (((d - 1) >> 1) + 1));
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) tint[j * w + i] = dense.tintOf(i0 + i, j0 + j);
    for (let k = 0; k < ground.length; k++) ground[k] = dense.ground.length ? dense.ground[(j0 / 2 + Math.floor(k / gw)) * dense.groundX + i0 / 2 + (k % gw)]! : 0;
    hf.put({ kind: "ground", sq, heights: dense.window(i0, j0, i0 + w - 1, j0 + d - 1), tint, ground, listed: [] });
  }
  hf.seaLevel = dense.seaLevel;
  hf.water = dense.water;
  hf.bounds = dense.bounds;
  hf.road = dense.road;
  hf.streets = dense.streets;
  return hf;
}
