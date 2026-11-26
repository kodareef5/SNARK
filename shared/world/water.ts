// Water standing on its own flat surface, apart from the sea: a lake, a pond, a reservoir, a reach of a river. Each is a
// body with a name and a surface on the heights' lattice, and the map says which body each of its squares belongs to. A
// body's water is wherever the ground of one of its squares is under its surface, as the sea's is wherever the ground is
// under the sea; a square of no body has the sea's. ARK's water is volumes with flat tops in the same way.
//
// The squares are kept by chunk, and only for chunks that hold water, so a map with ten lakes holds a few hundred kilobytes.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../coords.ts";

/** The most bodies a map holds: a square's number is a u16 counting from 1. */
export const MAX_WATER_BODIES = 65535;

export interface WaterBody {
  /** What the map calls it, which may be empty. */
  readonly name: string;
  /** Its surface in the heights' units over the map's minY, so that it stands exactly on their lattice. */
  readonly level: number;
}

export class MapWater {
  readonly dims: MapDims;
  /** Metres a square: 1, 2, 4, 8, 16, 32 or 64. */
  readonly cell: number;
  /** Squares along a chunk's side. */
  readonly side: number;
  readonly bodies: readonly WaterBody[];
  /** By body number counting from 1, its surface in metres; 0 is unused. */
  readonly surface: Float64Array;
  /** By body number, the box its squares cover: min x, min z, max x, max z in metres, empty where it has none. */
  readonly box: Float64Array;
  /** By chunk, where its squares start in `squares`, or -1 for a chunk that holds none. */
  readonly block: Int32Array;
  /** Per chunk that holds water, side by side squares row by row from z = 0: a body's number, or 0. */
  readonly squares: Uint16Array;

  /**
   * `chunks` lists the chunks holding water in ascending order, and `squares` their blocks in that order. `made` gives
   * the block and the bodies' boxes where the caller keeps them up to date itself, as `blockOf` and `widen` make them.
   */
  constructor(dims: MapDims, minY: number, stepY: number, cell: number, bodies: readonly WaterBody[], chunks: Uint32Array, squares: Uint16Array, made?: { readonly block: Int32Array; readonly box: Float64Array }) {
    this.dims = dims;
    this.cell = cell;
    this.side = CHUNK_SIZE / cell;
    this.bodies = bodies;
    this.squares = squares;
    this.block = made?.block ?? blockOf(dims, cell, chunks);
    this.surface = new Float64Array(bodies.length + 1);
    for (let b = 0; b < bodies.length; b++) this.surface[b + 1] = minY + bodies[b]!.level * stepY;
    this.box = made?.box ?? widen(dims, cell, chunks, this.block, squares, emptyBoxes(bodies.length));
  }

  /**
   * Bodies and a number a square over the whole map, row by row from z = 0 (`(sizeX / cell) * (sizeZ / cell)` of them), as a
   * tool makes them; the chunks with none are left out.
   */
  static fromGrid(dims: MapDims, minY: number, stepY: number, cell: number, bodies: readonly WaterBody[], grid: Uint16Array): MapWater {
    const side = CHUNK_SIZE / cell;
    const across = dims.chunksX * side;
    const chunks: number[] = [];
    const blocks: Uint16Array[] = [];
    for (let c = 0; c < chunkCount(dims); c++) {
      const cx = c % dims.chunksX;
      const cz = Math.floor(c / dims.chunksX);
      const block = new Uint16Array(side * side);
      let any = false;
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const b = grid[(cz * side + j) * across + cx * side + i]!;
          block[j * side + i] = b;
          if (b !== 0) any = true;
        }
      }
      if (!any) continue;
      chunks.push(c);
      blocks.push(block);
    }
    const squares = new Uint16Array(blocks.length * side * side);
    blocks.forEach((b, k) => squares.set(b, k * side * side));
    return new MapWater(dims, minY, stepY, cell, bodies, Uint32Array.from(chunks), squares);
  }

  /** The chunks holding water, in ascending order. */
  chunks(): Uint32Array {
    const out: number[] = [];
    for (let c = 0; c < this.block.length; c++) if (this.block[c]! >= 0) out.push(c);
    return Uint32Array.from(out);
  }

  /** The number of the body whose square holds (x, z), or 0. A place off the map takes the nearest square on it. */
  bodyAt(x: number, z: number): number {
    const dims = this.dims;
    let cx = Math.floor(x / CHUNK_SIZE);
    let cz = Math.floor(z / CHUNK_SIZE);
    if (cx < 0) cx = 0;
    else if (cx >= dims.chunksX) cx = dims.chunksX - 1;
    if (cz < 0) cz = 0;
    else if (cz >= dims.chunksZ) cz = dims.chunksZ - 1;
    const at = this.block[cz * dims.chunksX + cx]!;
    if (at < 0) return 0;
    const side = this.side;
    let i = Math.floor((x - cx * CHUNK_SIZE) / this.cell);
    let j = Math.floor((z - cz * CHUNK_SIZE) / this.cell);
    if (i < 0) i = 0;
    else if (i >= side) i = side - 1;
    if (j < 0) j = 0;
    else if (j >= side) j = side - 1;
    return this.squares[at + j * side + i]!;
  }
}

/** By chunk, where its squares start for chunks `chunks` laid out in that order, -1 for one that holds none. */
export function blockOf(dims: MapDims, cell: number, chunks: ArrayLike<number>): Int32Array {
  const side = CHUNK_SIZE / cell, per = side * side, block = new Int32Array(chunkCount(dims)).fill(-1);
  for (let k = 0; k < chunks.length; k++) block[chunks[k]!] = k * per;
  return block;
}

/** Boxes of `bodies` bodies and the sea's number 0, each empty: four numbers a body, min x and z then max. */
export function emptyBoxes(bodies: number): Float64Array {
  const box = new Float64Array((bodies + 1) * 4);
  for (let b = 0; b <= bodies; b++) box.set([Infinity, Infinity, -Infinity, -Infinity], b * 4);
  return box;
}

/** `box` widened by every square of a body in the chunks `chunks`, their squares read through `block`. */
export function widen(dims: MapDims, cell: number, chunks: ArrayLike<number>, block: Int32Array, squares: Uint16Array, box: Float64Array): Float64Array {
  const side = CHUNK_SIZE / cell, per = side * side;
  for (let k = 0; k < chunks.length; k++) {
    const c = chunks[k]!, at = block[c]!;
    const x0 = (c % dims.chunksX) * CHUNK_SIZE;
    const z0 = Math.floor(c / dims.chunksX) * CHUNK_SIZE;
    for (let s = 0; s < per; s++) {
      const b = squares[at + s]!;
      if (b === 0) continue;
      const x = x0 + (s % side) * cell;
      const z = z0 + Math.floor(s / side) * cell;
      const o = b * 4;
      if (x < box[o]!) box[o] = x;
      if (z < box[o + 1]!) box[o + 1] = z;
      if (x + cell > box[o + 2]!) box[o + 2] = x + cell;
      if (z + cell > box[o + 3]!) box[o + 3] = z + cell;
    }
  }
  return box;
}

/** Whether the water at (x, z) is the sea's: no body's square holds it. */
export function seaHere(water: MapWater | null, x: number, z: number): boolean {
  return water === null || water.bodyAt(x, z) === 0;
}

/**
 * How far along a ray from (ox, oy, oz) along (dx, dy, dz) it first goes down through the surface of a body, inside that
 * body's squares, at most `reach`; Infinity if it meets none. The sea is each caller's own test, kept as it was, asking
 * `seaHere` where it meets it. A ray starting under a body's surface is not met by it.
 */
export function bodyAlong(water: MapWater | null, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): number {
  if (water === null || !(dy < 0)) return Infinity;
  const { surface, box } = water;
  let best = Infinity;
  for (let b = 1; b < surface.length; b++) {
    const s = surface[b]!;
    if (!(oy > s)) continue;
    const t = (s - oy) / dy;
    if (t > reach || t >= best) continue;
    const x = ox + dx * t;
    const z = oz + dz * t;
    const o = b * 4;
    if (x < box[o]! || z < box[o + 1]! || x > box[o + 2]! || z > box[o + 3]! || water.bodyAt(x, z) !== b) continue;
    best = t;
  }
  return best;
}
