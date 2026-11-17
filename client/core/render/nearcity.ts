// A chunk the near store holds whole draws its standing statics of a kind drawn as one box (content/ruins.ts) from one
// mesh made for it, in place of an instance each: its every-box form (shared/world/city.ts mergedPart, touching boxes of
// one colour merged), which is the far city's nearest level, so the hand-over between the two shows nothing. Its faces
// go in the order the near store lays a chunk's 16 m cells (scene.ts), so that a run of cells in view is one draw.
//
// A face is held by the pieces round it that stand drawn as boxes, its chunk's and its neighbours'. A busy chunk is made
// in bands of rows of cells, a band a step, its chunk's other pieces holding its faces as its neighbours' do, so that no
// step takes much of a frame. Its vertices are stored within bounds of the chunk on a lattice of a power of two metres
// an axis, so that two chunks on the same lattice put a corner at the same place.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { mergedPart, type CityPart, type CityStatics, type Ground } from "../../../shared/world/city.ts";
import { quadBytes } from "./packet.ts";

/** Metres along z of a band's rows: a row of the near store's cells. */
const ROW = 16;
const ROWS = CHUNK_SIZE / ROW;
/** A chunk with more of its pieces in its mesh than this is made in two bands, and past twice this in four. */
export const BAND_PIECES = 400;
/** The finest step a vertex is stored to, in metres. */
const FINEST = 2 ** -12;

/** A chunk's mesh as made. */
export interface NearMade {
  /** Four vertices a face, drawn with the quads' indices (packet.ts quadIndices). */
  readonly data: Uint8Array;
  readonly faces: number;
  readonly indexBytes: 2 | 4;
  /** What the vertices are stored within: x and z from the chunk's corner, y in the world. */
  readonly bounds: { readonly center: readonly number[]; readonly half: readonly number[] };
  /** Per cell in the near store's order (cellOrder), its first face, and the end of the last. */
  readonly cellFirst: Uint32Array;
  /** Per cell, the box its faces lie in, as `bounds` measures, least then most; empty where it has none. */
  readonly cellBox: Float32Array;
}

/** The cell of `side` a side holding (x, z) from a chunk's corner, in the near store's order: a row, then the next back the other way. */
export function cellOrder(side: number, x: number, z: number): number {
  const i = Math.min(side - 1, Math.max(0, Math.floor((x * side) / CHUNK_SIZE)));
  const j = Math.min(side - 1, Math.max(0, Math.floor((z * side) / CHUNK_SIZE)));
  return j * side + (j & 1 ? side - 1 - i : i);
}

/**
 * The making of chunk `chunk`'s mesh, a band at a time. `mine` marks the chunk's pieces the mesh draws, in the city's
 * order; `holds(c)` marks a neighbour's pieces that stand drawn as boxes, which hold faces, or is null for none.
 */
export class NearMaking {
  readonly chunk: number;
  /** How many bands it is made in, and the pieces each step is made with: its band's, and those that hold their faces. */
  readonly bands: number;
  private readonly city: CityStatics;
  private readonly ground: Ground;
  private readonly side: number;
  /** Rows of the city: the chunk's pieces in the mesh by band, and by chunk round it the pieces that hold faces. */
  private readonly own: number[][];
  private readonly around = new Map<number, number[]>();
  /** The chunk whose list carries the chunk's pieces of other bands, which hold faces as a neighbour's do. */
  private readonly beside: number;
  private readonly parts: CityPart[] = [];

  constructor(city: CityStatics, chunk: number, ground: Ground, mine: Uint8Array, holds: (c: number) => Uint8Array | null, side: number) {
    this.city = city;
    this.chunk = chunk;
    this.ground = ground;
    this.side = side;
    const dims = city.dims;
    const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    const z0 = cz * CHUNK_SIZE;
    const from = city.first[chunk]!;
    let n = 0;
    for (let i = 0; i < mine.length; i++) n += mine[i]!;
    this.beside = cx + 1 < dims.chunksX ? chunk + 1 : cx > 0 ? chunk - 1 : cz + 1 < dims.chunksZ ? chunk + dims.chunksX : cz > 0 ? chunk - dims.chunksX : -1;
    this.bands = this.beside < 0 || n <= BAND_PIECES ? 1 : n <= 2 * BAND_PIECES ? 2 : ROWS;
    this.own = Array.from({ length: this.bands }, () => []);
    for (let i = 0; i < mine.length; i++) {
      if (mine[i] !== 1) continue;
      const row = Math.min(ROWS - 1, Math.max(0, Math.floor((city.z[from + i]! - z0) / ROW)));
      this.own[Math.floor((row * this.bands) / ROWS)]!.push(from + i);
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || cx + dx < 0 || cz + dz < 0 || cx + dx >= dims.chunksX || cz + dz >= dims.chunksZ) continue;
        const c = (cz + dz) * dims.chunksX + cx + dx;
        const h = holds(c);
        const rows: number[] = [];
        if (h) for (let i = 0; i < h.length; i++) if (h[i] === 1) rows.push(city.first[c]! + i);
        if (rows.length > 0) this.around.set(c, rows);
      }
    }
  }

  get done(): boolean {
    return this.parts.length === this.bands;
  }

  /** Pieces the next step is made with. */
  get cost(): number {
    let n = 0;
    for (const rows of this.around.values()) n += rows.length;
    for (const band of this.own) n += band.length;
    return n;
  }

  /** Makes the faces of the next band. */
  step(): void {
    const b = this.parts.length;
    const others: number[] = [];
    for (let k = 0; k < this.bands; k++) if (k !== b) others.push(...this.own[k]!);
    this.parts.push(mergedPart(view(this.city, this.chunk, this.own[b]!, this.beside, others, this.around), this.chunk, this.ground, none, 0.01, 0));
  }

  /** The mesh, once every band is made: its faces in cell order, stored on the lattice. */
  finish(): NearMade {
    let faces = 0;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const part of this.parts) {
      faces += part.faces;
      for (let a = 0; a < 3 && part.faces > 0; a++) {
        box[a] = Math.min(box[a]!, part.box[a]!);
        box[a + 3] = Math.max(box[a + 3]!, part.box[a + 3]!);
      }
    }
    const center = [0, 0, 0], half = [1, 1, 1], step = [1, 1, 1];
    for (let a = 0; a < 3 && faces > 0; a++) {
      // The finest power of two that holds the box, its middle on the lattice.
      let s = FINEST;
      const mid = (box[a]! + box[a + 3]!) / 2;
      while (32767 * s < Math.max(box[a + 3]! - Math.round(mid / s) * s, Math.round(mid / s) * s - box[a]!)) s *= 2;
      step[a] = s;
      center[a] = Math.round(mid / s) * s;
      half[a] = 32767 * s;
    }
    const cells = this.side * this.side;
    const cellOf = new Uint8Array(faces);
    const cellFirst = new Uint32Array(cells + 1);
    let f = 0;
    for (const part of this.parts) {
      for (let k = 0; k < part.faces; k++, f++) {
        const p = part.pos;
        const x = (p[k * 12]! + p[k * 12 + 3]! + p[k * 12 + 6]! + p[k * 12 + 9]!) / 4;
        const z = (p[k * 12 + 2]! + p[k * 12 + 5]! + p[k * 12 + 8]! + p[k * 12 + 11]!) / 4;
        cellOf[f] = cellOrder(this.side, x, z);
        cellFirst[cellOf[f]! + 1]!++;
      }
    }
    for (let c = 0; c < cells; c++) cellFirst[c + 1]! += cellFirst[c]!;
    const at = cellFirst.slice(0, cells);
    const cellBox = new Float32Array(cells * 6);
    for (let c = 0; c < cells; c++) cellBox.fill(Infinity, c * 6, c * 6 + 3).fill(-Infinity, c * 6 + 3, c * 6 + 6);
    const data = new Uint8Array(faces * 4 * VERTEX_BYTES);
    const view = new DataView(data.buffer);
    f = 0;
    for (const part of this.parts) {
      for (let k = 0; k < part.faces; k++, f++) {
        const c = cellOf[f]!, to = at[c]!++;
        for (let e = 0; e < 4; e++) {
          const o = (to * 4 + e) * VERTEX_BYTES;
          for (let a = 0; a < 3; a++) {
            const q = Math.max(-32767, Math.min(32767, Math.round((part.pos[k * 12 + e * 3 + a]! - center[a]!) / step[a]!)));
            view.setInt16(o + a * 2, q, true);
            // The box of what is stored, which is what is drawn.
            const v = center[a]! + q * step[a]!;
            if (v < cellBox[c * 6 + a]!) cellBox[c * 6 + a] = v;
            if (v > cellBox[c * 6 + 3 + a]!) cellBox[c * 6 + 3 + a] = v;
          }
          data[o + 6] = part.color[k]!;
        }
      }
    }
    return { data, faces, indexBytes: quadBytes(faces), bounds: { center, half }, cellFirst, cellBox };
  }
}

const none = (): null => null;

/**
 * The city as one step of a making sees it: `chunk` holding the rows `own`, the chunk `beside` holding `others` and its
 * share of `around`, and every other chunk round it its share of `around`.
 */
function view(city: CityStatics, chunk: number, own: readonly number[], beside: number, others: readonly number[], around: ReadonlyMap<number, readonly number[]>): CityStatics {
  const dims: MapDims = city.dims;
  const lists = new Map<number, readonly number[]>(around);
  lists.set(chunk, own);
  if (others.length > 0) lists.set(beside, [...(around.get(beside) ?? []), ...others]);
  const order = [...lists.keys()].sort((a, b) => a - b);
  const n = order.reduce((s, c) => s + lists.get(c)!.length, 0);
  const first = new Uint32Array(chunkCount(dims) + 1);
  const kind = new Uint16Array(n), yaw = new Uint16Array(n), x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  let at = 0, c = 0;
  for (const k of order) {
    for (; c <= k; c++) first[c] = at;
    for (const i of lists.get(k)!) {
      kind[at] = city.kind[i]!;
      yaw[at] = city.yaw[i]!;
      x[at] = city.x[i]!;
      y[at] = city.y[i]!;
      z[at] = city.z[i]!;
      at++;
    }
  }
  first.fill(at, c);
  const { halfX, halfY, halfZ, color, plain, walked, look } = city;
  return { dims, first, kind, yaw, x, y, z, halfX, halfY, halfZ, color, plain, walked, look, count: n, in: (k: number) => first[k + 1]! - first[k]! } as CityStatics;
}
