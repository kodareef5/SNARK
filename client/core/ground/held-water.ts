// A page's water as its overviews come and go (client/core/mapload.ts). The chunks that may hold water and their layout
// never change, so the block is made once and shared. Each overview's square keeps its own chunks with water and its
// bodies' boxes over them: an overview taken in or let go measures its own squares again, merges the squares' boxes, and
// one with no water chunk does nothing.

import { OVERVIEW_CHUNKS, type MapHead } from "../../../shared/world/mapfile.ts";
import { MapWater, emptyBoxes, widen } from "../../../shared/world/water.ts";
import { squareKey } from "../map-first.ts";
import type { Chunks } from "./pages.ts";

/** An overview's square of the lattice: its column and row, and its chunks. */
type Square = Chunks & { readonly col: number; readonly row: number };

interface Part {
  /** Its chunks that hold water, ascending, and its bodies' boxes over their squares. */
  readonly chunks: Uint32Array;
  readonly box: Float64Array;
}

export class HeldWater {
  water: MapWater;
  /** Squares looked at in the last change: what one costs. */
  visited = 0;
  private readonly head: MapHead;
  private readonly chunkList: Uint32Array;
  private readonly parts = new Map<number, Part>();

  /** Starting from `water`, every chunk the map may hold water in laid out in it. */
  constructor(head: MapHead, water: MapWater) {
    this.head = head;
    this.water = water;
    this.chunkList = water.chunks();
    const { dims } = head, by = new Map<number, number[]>();
    for (const c of this.chunkList) {
      const key = squareKey(Math.floor(((c % dims.chunksX) + dims.frameX) / OVERVIEW_CHUNKS), Math.floor((Math.floor(c / dims.chunksX) + dims.frameZ) / OVERVIEW_CHUNKS));
      let list = by.get(key);
      if (!list) by.set(key, (list = []));
      list.push(c);
    }
    for (const [key, list] of by) this.parts.set(key, { chunks: Uint32Array.from(list), box: emptyBoxes(water.bodies.length) });
    for (const part of this.parts.values()) this.measure(part);
  }

  /**
   * Overview square `sq`'s squares set by `fill`, given its chunks that hold water, and the water made again over the same
   * squares; nothing where it has no such chunk.
   */
  change(sq: Square, fill: (chunks: Uint32Array, was: MapWater) => void): MapWater {
    this.visited = 0;
    const part = this.parts.get(squareKey(sq.col, sq.row));
    if (!part) return this.water;
    const was = this.water;
    fill(part.chunks, was);
    this.measure(part);
    const box = emptyBoxes(was.bodies.length);
    for (const p of this.parts.values()) {
      for (let k = 0; k < box.length; k += 4) {
        if (p.box[k]! < box[k]!) box[k] = p.box[k]!;
        if (p.box[k + 1]! < box[k + 1]!) box[k + 1] = p.box[k + 1]!;
        if (p.box[k + 2]! > box[k + 2]!) box[k + 2] = p.box[k + 2]!;
        if (p.box[k + 3]! > box[k + 3]!) box[k + 3] = p.box[k + 3]!;
      }
    }
    const head = this.head;
    return (this.water = new MapWater(head.dims, head.minY, head.stepY, was.cell, was.bodies, this.chunkList, was.squares, { block: was.block, box }));
  }

  /** `part`'s boxes from its squares as they are. */
  private measure(part: Part): void {
    const w = this.water;
    part.box.set(emptyBoxes(w.bodies.length));
    widen(this.head.dims, w.cell, part.chunks, w.block, w.squares, part.box);
    this.visited += part.chunks.length * w.side * w.side;
  }
}
