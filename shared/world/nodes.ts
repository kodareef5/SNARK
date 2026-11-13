// Resource nodes: trees, rocks, bushes. A fourth class of state.
//
// Where nodes stand is map data: a pure function of the map, the same on the
// server and on every client, never saved and never sent. A node is named by
// its chunk and its slot in that chunk, and that name never changes. The only
// state is which nodes have been used up, and that is small.
//
// Nodes near a body are held in a StructureStore of their own, so collision
// and drawing use the code structures already have. Chunks are filled when a
// body comes near and emptied when the last one leaves, so memory follows the
// players, not the map.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import type { Heightfield } from "./heightfield.ts";
import { StructureStore } from "./structures.ts";

export interface NodeSpot {
  /** Content index of the node, or 0 if this slot is empty on this map. */
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A map's nodes. `at` must be a pure function of its arguments. */
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
 * Nodes scattered over a map by a hash: each slot of each chunk gets a place
 * and a kind, or nothing where `allow` says no, the ground is under water, or
 * the slope is too steep to stand a tree on. `kinds` lists content indices,
 * repeated for weight; `halfY` gives each kind's half height, so it stands on
 * the ground.
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

/** Node reference in the field's store: chunk * 65536 + slot, as for structures. */
export function nodeRef(chunk: number, index: number): number {
  return chunk * 65536 + index;
}

export class NodeField {
  readonly store: StructureStore;
  readonly source: NodeSource;
  /** Bodies (or viewers) keeping each chunk filled. */
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
   * Keep the square of chunks within `radius` of `center` filled (delta +1) or
   * let go of it (delta -1). A chunk is filled when its count leaves zero:
   * every node the map puts there, except those `gone` says are used up, with
   * the hit count `left` gives (or the kind's full count).
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

  /** A node is used up (false) or has grown back (true). Nothing happens if its chunk is not filled. */
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

  /** Content index of the node at a slot as the map defines it, used up or not. */
  kindAt(chunk: number, index: number): number {
    this.source.at(chunk, index, this.spot);
    return this.spot.kind;
  }
}
