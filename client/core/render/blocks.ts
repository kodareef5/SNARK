// The city as blocks from its tops (shared/world/mapfile.ts MapTops: the far feed's 4 m cells of each chunk as the map
// places its statics, which come in parts behind the ground): what stands for the city past the far city's reach and
// wherever a tile of the far city has nothing made (cityblocks.ts). A chunk's cells are taken in blocks of BLOCK metres,
// the quads of the ground the terrain draws past its window (terrain.ts COARSE), or farther off of FAR_BLOCK metres, and
// each filled block is a column from under the ground to its top, in the far feed's colour. A tile of chunks is made where the far city's levels are made
// (citymake.ts), on a worker in the browser, from its chunks' cells and the ground at every COARSE-th sample. Here too is
// how columns are made into faces, as the far blocks of bases (far.ts) make theirs at 4 m.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../../../shared/coords.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import type { MapTops } from "../../../shared/world/mapfile.ts";
import { TACTICAL_CELL, farTopMetres } from "../../../shared/world/tactical.ts";
import { quadBytes } from "./packet.ts";

/**
 * Metres a side of a block: two or three pixels at the far city's reach, where blocks take over, and a chunk of them makes
 * about two fifths of the faces its 4 m cells would; and farther off (cityblocks.ts), where an 8 m block is a pixel or
 * less, a quarter as many blocks.
 */
export const BLOCK = 8;
export const FAR_BLOCK = 16;
/** Chunks along a tile of blocks' side, and its side in metres. */
export const BLOCK_TILE = 16;
export const BLOCK_TILE_METRES = BLOCK_TILE * CHUNK_SIZE;
/**
 * A block stands where as many of its 4 m cells are filled as it has along a side, two of an 8 m block's four, or one that
 * stands this tall: no tower is lost from the skyline.
 */
const LONE = 16;
/** Tops of touching blocks of one colour this close are one roof, at their mean. */
const CLOSE = 2;
/**
 * Metres a block's foot goes under the lowest corner of every quad of the ground from its own side to BLOCK <<
 * (FOOT_LEVELS - 1) across that holds it, which is as coarse as the terrain draws within 8 km (2,048 m tiles of 64 m
 * quads), and under what the finer ground of the terrain's window may dip within a block.
 */
const FOOT = 2;
const FOOT_LEVELS = 4;

const SIDE = CHUNK_SIZE / TACTICAL_CELL;
const N = CHUNK_SIZE / BLOCK;
/** Cells of the far feed a chunk has. */
export const TOP_CELLS = SIDE * SIDE;

/** The city's tops as the page holds them: each overview square's tops part as it comes (mapload.ts), or a map's whole. */
export class HeldTops {
  /** Counts the parts taken. */
  version = 0;
  /** Per chunk, `version` when its cells came, 0 while they have not. */
  readonly came: Uint32Array;
  private readonly pieces: MapTops[] = [];
  /** Per chunk: the piece holding its cells, 1 on, or 0 for none; and its row there. */
  private readonly piece: Uint16Array;
  private readonly row: Uint32Array;

  constructor(dims: MapDims) {
    this.came = new Uint32Array(chunkCount(dims));
    this.piece = new Uint16Array(this.came.length);
    this.row = new Uint32Array(this.came.length);
  }

  take(tops: MapTops): void {
    const n = this.pieces.push(tops);
    this.version++;
    for (let k = 0; k < tops.chunks.length; k++) {
      const c = tops.chunks[k]!;
      this.piece[c] = n;
      this.row[c] = k;
      this.came[c] = this.version;
    }
  }

  /** `chunk`'s cells' top bytes (tactical.ts farTopByte, 0 for empty), or null where none have come or none is filled. */
  top(chunk: number): Uint8Array | null {
    const p = this.pieces[this.piece[chunk]! - 1];
    return p ? p.top.subarray(this.row[chunk]! * TOP_CELLS, (this.row[chunk]! + 1) * TOP_CELLS) : null;
  }

  /** `chunk`'s cells' palette colours as the far feed lists them, or null as `top`. */
  tint(chunk: number): Uint8Array | null {
    const p = this.pieces[this.piece[chunk]! - 1];
    return p ? p.tint.subarray(this.row[chunk]! * TOP_CELLS, (this.row[chunk]! + 1) * TOP_CELLS) : null;
  }
}

/** Faces as columns are made into them: four corners a face, a palette colour a corner, and the box round them. */
export interface Columns {
  readonly pos: number[];
  readonly color: number[];
  readonly box: number[];
}

// Scratch for a square of cells: which are in a roof or a face already, and a queue of cells.
const used = new Uint8Array(TOP_CELLS);
const queue = new Int16Array(TOP_CELLS);
/** The four ways a side can face, as steps to the neighbouring cell. */
const WAYS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The faces of columns on `n` by `n` cells `size` metres wide (n at most 16), the first's corner at (x0, z0), less
 * (ox, oz), into `out`: each `filled` cell from `feet` to `tops` in metres, in colour `tint`. Touching tops of one colour
 * within `close` of the first of them (the larger of each two cells') are taken as one roof at their mean, which `tops`
 * keeps. Tops of one height and colour are merged into rectangles, and a side is drawn where the neighbour is lower or
 * empty, merged along its row, down to the higher of that neighbour's top and the lowest foot of its run. A side on the
 * square's edge is always drawn, so a square's columns do not depend on its neighbours.
 */
export function columnFaces(n: number, size: number, x0: number, z0: number, ox: number, oz: number, filled: Uint8Array, tops: Float64Array, feet: Float64Array, tint: Uint8Array, close: Float64Array, out: Columns): void {
  const cells = n * n;
  used.fill(0, 0, cells);
  for (let c = 0; c < cells; c++) {
    if (filled[c] === 0 || used[c]) continue;
    let count = 1;
    let head = 0;
    let sum = 0;
    queue[0] = c;
    used[c] = 1;
    while (head < count) {
      const q = queue[head++]!;
      sum += tops[q]!;
      for (let way = 0; way < 4; way++) {
        const i = (q % n) + WAYS[way]![0];
        const j = Math.floor(q / n) + WAYS[way]![1];
        const r = j * n + i;
        if (i < 0 || j < 0 || i >= n || j >= n || filled[r] === 0 || used[r] || tint[r] !== tint[c]) continue;
        if (Math.abs(tops[r]! - tops[c]!) > Math.max(close[r]!, close[c]!)) continue;
        used[r] = 1;
        queue[count++] = r;
      }
    }
    for (let k = 0; k < count; k++) tops[queue[k]!] = sum / count;
  }
  const { pos, color, box } = out;
  // A face is a corner and two edges whose cross product points out, as tools/pack/write.ts boxMesh has them.
  const face = (x: number, y: number, z: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, col: number): void => {
    x -= ox;
    z -= oz;
    pos.push(x, y, z, x + ux, y + uy, z + uz, x + ux + vx, y + uy + vy, z + uz + vz, x + vx, y + vy, z + vz);
    color.push(col, col, col, col);
    // The far corner is the corner and both edges; the box takes both ends of each axis.
    const far = [x + ux + vx, y + uy + vy, z + uz + vz];
    [x, y, z].forEach((v, a) => {
      box[a] = Math.min(box[a]!, v, far[a]!);
      box[a + 3] = Math.max(box[a + 3]!, v, far[a]!);
    });
  };
  const C = size;
  used.fill(0, 0, cells);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if (filled[c] === 0 || used[c]) continue;
      const same = (q: number): boolean => used[q] === 0 && filled[q] !== 0 && tops[q] === tops[c] && tint[q] === tint[c];
      let w = 1;
      while (i + w < n && same(c + w)) w++;
      let d = 1;
      grow: while (j + d < n) {
        for (let k = 0; k < w; k++) if (!same((j + d) * n + i + k)) break grow;
        d++;
      }
      for (let k = 0; k < d; k++) used.fill(1, (j + k) * n + i, (j + k) * n + i + w);
      face(x0 + i * C, tops[c]!, z0 + j * C, 0, 0, d * C, w * C, 0, 0, tint[c]!);
    }
  }
  for (const way of WAYS) {
    const di = way[0], dj = way[1];
    for (let line = 0; line < n; line++) {
      // The run of sides being merged: where it began, the top, the neighbour's top and the colour each of it has, and
      // its bottom. A side down to the ground goes to the lowest foot of its run, which is under the ground everywhere.
      let from = -1;
      let t = 0;
      let nt = 0;
      let b = 0;
      let col = 0;
      for (let step = 0; step <= n; step++) {
        let has = false;
        let st = 0;
        let sn = 0;
        let sc = 0;
        let c = 0;
        if (step < n) {
          const i = di !== 0 ? line : step;
          const j = di !== 0 ? step : line;
          c = j * n + i;
          const ni = i + di;
          const nj = j + dj;
          const q = nj * n + ni;
          sn = ni >= 0 && nj >= 0 && ni < n && nj < n && filled[q] !== 0 ? tops[q]! : -Infinity;
          if (filled[c] !== 0 && sn < tops[c]!) {
            has = true;
            st = tops[c]!;
            sc = tint[c]!;
          }
        }
        if (from >= 0 && has && st === t && sn === nt && sc === col) {
          b = Math.min(b, Math.max(sn, feet[c]!));
          continue;
        }
        if (from >= 0) {
          const a = from * C;
          const e = step * C;
          const h = t - b;
          if (di === 1) face(x0 + (line + 1) * C, b, z0 + a, 0, h, 0, 0, 0, e - a, col);
          else if (di === -1) face(x0 + line * C, b, z0 + e, 0, h, 0, 0, 0, a - e, col);
          else if (dj === 1) face(x0 + e, b, z0 + (line + 1) * C, 0, h, 0, a - e, 0, 0, col);
          else face(x0 + a, b, z0 + line * C, 0, h, 0, e - a, 0, 0, col);
          from = -1;
        }
        if (has) {
          from = step;
          t = st;
          nt = sn;
          b = Math.max(sn, feet[c]!);
          col = sc;
        }
      }
    }
  }
}

/** A tile of blocks to make: its chunks' cells and the ground under it, and nothing else of the map. */
export interface BlocksJob {
  readonly id: number;
  /** The map's chunks a row, the tile's corner in metres, and its chunks with cells, in the order its mesh holds them. */
  readonly chunksX: number;
  readonly ox: number;
  readonly oz: number;
  readonly chunks: Int32Array;
  /** Metres a side of its blocks, BLOCK or FAR_BLOCK. */
  readonly size: number;
  /** TOP_CELLS of each of those chunks: their top bytes, and their colours as drawn. */
  readonly top: Uint8Array;
  readonly tint: Uint8Array;
  /** The ground at every COARSE-th sample under the tile, from that sample (i0, j0) on, `w` a row, as Heightfield holds it. */
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly heights: Uint16Array;
  readonly minY: number;
  readonly stepY: number;
}

/** A tile of blocks made: its vertices, drawn with the quads' indices (packet.ts quadIndices), and each chunk's run of those. */
export interface BlocksMade {
  readonly id: number;
  readonly blocks: true;
  /** The job's chunks, in the order its mesh holds them. */
  readonly chunks: Int32Array;
  readonly data: Uint8Array;
  readonly indexBytes: 2 | 4;
  readonly first: Uint32Array;
  readonly count: Uint32Array;
  /** Where its heights are stored from, in whole metres in the world, and how tall it is from there. */
  readonly base: number;
  readonly tall: number;
  /** Each chunk's faces' lowest and highest, from `base`. */
  readonly low: Float32Array;
  readonly high: Float32Array;
}

/** Every buffer of a job, or of what was made, to move it to another thread rather than copy it. */
export function blocksBuffers(m: BlocksJob | BlocksMade): ArrayBuffer[] {
  const all = "blocks" in m ? [m.chunks, m.data, m.first, m.count, m.low, m.high] : [m.chunks, m.top, m.tint, m.heights];
  return all.map((a) => a.buffer as ArrayBuffer);
}

// Scratch for a chunk's blocks.
const filled = new Uint8Array(N * N);
const tops = new Float64Array(N * N);
const feet = new Float64Array(N * N);
const tint = new Uint8Array(N * N);
const close = new Float64Array(N * N).fill(CLOSE);

/** The tile of blocks `job` asks for: each chunk's columns, its vertices stored within the tile's square and from its base. */
export function makeBlocks(job: BlocksJob): BlocksMade {
  const { chunks, w, heights, minY, stepY, size } = job;
  // Cells a block takes along a side, blocks a chunk's side, and samples of the ground every BLOCK a block's side.
  const per = size / TACTICAL_CELL, n = CHUNK_SIZE / size, s0 = size / BLOCK;
  const rows = heights.length / w;
  const at = (i: number, j: number): number => minY + heights[Math.min(rows - 1, Math.max(0, j - job.j0)) * w + Math.min(w - 1, Math.max(0, i - job.i0))]! * stepY;
  const out: Columns = { pos: [], color: [], box: [] };
  const faces = new Uint32Array(chunks.length + 1);
  const low = new Float32Array(chunks.length);
  const high = new Float32Array(chunks.length);
  for (let k = 0; k < chunks.length; k++) {
    const cx = chunks[k]! % job.chunksX, cz = Math.floor(chunks[k]! / job.chunksX);
    const ci = cx * N, cj = cz * N;
    const top = job.top.subarray(k * TOP_CELLS, (k + 1) * TOP_CELLS);
    filled.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // The block's 4 m cells: how many are filled, and the tallest, whose colour it takes.
        let count = 0;
        let most = -1;
        for (let b = 0; b < per; b++) {
          for (let a = 0; a < per; a++) {
            const c = (j * per + b) * SIDE + i * per + a;
            if (top[c] === 0) continue;
            count++;
            if (most < 0 || top[c]! > top[most]!) most = c;
          }
        }
        if (count === 0 || (count < per && farTopMetres(top[most]!) < LONE)) continue;
        const o = j * n + i;
        const I = ci + i * s0, J = cj + j * s0;
        // The ground at a block's middle as the terrain's quad over it has it: halfway along the diagonal its two triangles share.
        tops[o] = (at(I, J) + at(I + s0, J + s0)) / 2 + farTopMetres(top[most]!);
        let foot = Infinity;
        for (let l = Math.log2(s0); l < FOOT_LEVELS; l++) {
          const s = 1 << l;
          const i0 = Math.floor(I / s) * s, j0 = Math.floor(J / s) * s;
          foot = Math.min(foot, at(i0, j0), at(i0 + s, j0), at(i0, j0 + s), at(i0 + s, j0 + s));
        }
        feet[o] = foot - FOOT;
        tint[o] = job.tint[k * TOP_CELLS + most]!;
        filled[o] = 1;
      }
    }
    out.box.length = 0;
    out.box.push(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    columnFaces(n, size, cx * CHUNK_SIZE, cz * CHUNK_SIZE, job.ox, job.oz, filled, tops, feet, tint, close, out);
    faces[k + 1] = out.color.length / 4;
    low[k] = out.box[1]!;
    high[k] = out.box[4]!;
  }
  const total = faces[chunks.length]!;
  let base = 0;
  let tall = 1;
  if (total > 0) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < chunks.length; k++) {
      if (faces[k + 1] === faces[k]) continue;
      lo = Math.min(lo, low[k]!);
      hi = Math.max(hi, high[k]!);
    }
    base = Math.floor(lo);
    tall = Math.ceil(hi - base) + 1;
  }
  const data = new Uint8Array(total * 4 * VERTEX_BYTES);
  const view = new DataView(data.buffer);
  const half = [BLOCK_TILE_METRES / 2, tall / 2, BLOCK_TILE_METRES / 2];
  const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - half[a]!) / half[a]!) * 32767)));
  const { pos, color } = out;
  for (let v = 0; v < total * 4; v++) {
    const o = v * VERTEX_BYTES;
    view.setInt16(o, q(pos[v * 3]!, 0), true);
    view.setInt16(o + 2, q(pos[v * 3 + 1]! - base, 1), true);
    view.setInt16(o + 4, q(pos[v * 3 + 2]!, 2), true);
    data[o + 6] = color[v]!;
  }
  const first = new Uint32Array(chunks.length);
  const count = new Uint32Array(chunks.length);
  for (let k = 0; k < chunks.length; k++) {
    first[k] = faces[k]! * 6;
    count[k] = (faces[k + 1]! - faces[k]!) * 6;
    low[k] = faces[k + 1] === faces[k] ? 0 : low[k]! - base;
    high[k] = faces[k + 1] === faces[k] ? 0 : high[k]! - base;
  }
  return { id: job.id, blocks: true, chunks, data, indexBytes: quadBytes(total), first, count, base, tall, low, high };
}

/** The bounds a tile of blocks `tall` metres tall is stored within: its square, and its height from its base. */
export const blocksBounds = (tall: number): { center: readonly number[]; half: readonly number[] } => ({ center: [BLOCK_TILE_METRES / 2, tall / 2, BLOCK_TILE_METRES / 2], half: [BLOCK_TILE_METRES / 2, tall / 2, BLOCK_TILE_METRES / 2] });
