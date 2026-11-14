// Node positions are a pure function of the map, the same on the server and every client, never saved and never sent. The only
// state is which nodes are used up. Chunks near a body are loaded into a StructureStore, so collision and drawing reuse that code.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import type { Heightfield } from "./heightfield.ts";
import { StructureStore } from "./structures.ts";

export interface NodeSpot {
  /** Content index, or 0 if the slot is empty on this map. */
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** `at` must be a pure function of its arguments. */
export interface NodeSource {
  /** Slots per chunk, at most 256. */
  readonly perChunk: number;
  at(chunk: number, index: number, out: NodeSpot): void;
}

function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Scatters nodes by a hash. A slot is empty where `allow` says no, the ground is lower than 0.3 m above sea level, or the slope is
 * too steep. `kinds` lists content indices, repeated for weight. `halfY` is each kind's half height, so the node stands on the ground.
 */
export function scatterNodes(dims: MapDims, hf: Heightfield, seed: number, perChunk: number, kinds: readonly number[], halfY: Float32Array, allow: (x: number, z: number) => boolean): NodeSource {
  return {
    perChunk,
    at(chunk, index, out) {
      out.kind = 0;
      if (kinds.length === 0) return;
      const h = mix(seed, chunk, index);
      const g = mix(h, index, chunk);
      const x = (chunkCx(dims, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
      const z = (chunkCz(dims, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
      if (!allow(x, z)) return;
      const y = hf.heightAt(x, z);
      if (y < hf.seaLevel + 0.3 || hf.slopeCosAt(x, z) < 0.85) return;
      const kind = kinds[g % kinds.length]!;
      out.kind = kind;
      out.x = x;
      out.y = y + halfY[kind]!;
      out.z = z;
      out.yaw = (g >>> 8) & 0xffff;
    },
  };
}

/** chunk * 65536 + slot, as for structures. */
export function nodeRef(chunk: number, index: number): number {
  return chunk * 65536 + index;
}

export class NodeField {
  readonly store: StructureStore;
  readonly source: NodeSource;
  /** Per chunk, the number of bodies or viewers keeping it filled. */
  private readonly refs: Uint16Array;
  private readonly spot: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  private readonly dims: MapDims;
  private readonly hits: Float32Array;

  /** `hits` gives each kind's starting hit count. */
  constructor(dims: MapDims, halfX: Float32Array, halfY: Float32Array, halfZ: Float32Array, soft: Uint8Array, hits: Float32Array, source: NodeSource) {
    this.dims = dims;
    this.source = source;
    this.hits = hits;
    this.store = new StructureStore(dims, halfX, halfY, halfZ, soft);
    this.refs = new Uint16Array(chunkCount(dims));
  }

  isLoaded(chunk: number): boolean {
    return this.refs[chunk]! > 0;
  }

  /**
   * Retains (delta +1) or releases (delta -1) the square of chunks within `radius` of `center`. A chunk fills when its count leaves
   * zero, with every node of the map except those `gone` reports, at the hit count `left` gives or else the kind's full count.
   */
  retain(center: number, radius: number, delta: number, gone: (chunk: number, index: number) => boolean, left?: (chunk: number, index: number) => number): void {
    const dims = this.dims;
    const cx = chunkCx(dims, center);
    const cz = chunkCz(dims, center);
    for (let z = Math.max(0, cz - radius); z <= Math.min(dims.chunksZ - 1, cz + radius); z++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(dims.chunksX - 1, cx + radius); x++) {
        const chunk = z * dims.chunksX + x;
        const before = this.refs[chunk]!;
        this.refs[chunk] = before + delta;
        if (before === 0 && delta > 0) this.fill(chunk, gone, left);
        else if (before === 1 && delta < 0) this.store.dropChunk(chunk);
      }
    }
  }

  private fill(chunk: number, gone: (chunk: number, index: number) => boolean, left?: (chunk: number, index: number) => number): void {
    const spot = this.spot;
    for (let i = 0; i < this.source.perChunk; i++) {
      this.source.at(chunk, i, spot);
      if (spot.kind === 0 || gone(chunk, i)) continue;
      const hp = left ? left(chunk, i) : -1;
      this.store.put(chunk, i, spot.kind, spot.x, spot.y, spot.z, spot.yaw, 0, hp >= 0 ? hp : this.hits[spot.kind]!, 1);
    }
  }

  /** `present` false marks the node used up, true grown back. Does nothing if its chunk is not filled. */
  set(chunk: number, index: number, present: boolean): void {
    if (!this.isLoaded(chunk)) return;
    const spot = this.spot;
    if (!present) {
      this.store.put(chunk, index, 0, 0, 0, 0, 0, 0, 0, 1);
      return;
    }
    this.source.at(chunk, index, spot);
    if (spot.kind !== 0) this.store.put(chunk, index, spot.kind, spot.x, spot.y, spot.z, spot.yaw, 0, this.hits[spot.kind]!, 1);
  }

  /** The content index the map defines for the slot, used up or not. */
  kindAt(chunk: number, index: number): number {
    this.source.at(chunk, index, this.spot);
    return this.spot.kind;
  }
}
