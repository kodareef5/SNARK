// A map's own buildings as drawn past the near rows: its static pieces, known from the map file and never sent, made into
// the faces a far drawing needs. Each form is a pure function of a chunk's standing pieces (and its neighbours', which
// may hide its faces) and the ground, so a client makes the same faces wherever it stands.
//
// - Boxes (boxPart, mergedPart): every standing piece's box, less each face another box holds whole or the ground hides,
//   boxes of one colour and cross-section in a line along an axis merged into one. With no gap and nothing left out it
//   is the near drawing of the chunk in one mesh; with gaps up to `gap` metres bridged and boxes no longer than `least`
//   left out it is a lighter one with the same frames, floors and broken tops.
// - Cells (cellPart): the pieces set into cells in each building's own frame (a chunk's pieces grouped by their turn short
//   of a quarter), the air outside flooded in, and the faces between a filled cell and that air merged into rectangles
//   of one colour: a building's mass, for where its storeys are a pixel or two.

import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS, chunkAt, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { Heightfield } from "./heightfield.ts";
import type { MapStatic } from "./mapfile.ts";
import { TACTICAL_CELL, farTopByte } from "./tactical.ts";

const QUARTER = YAW_UNITS / 4;

/** The map's static pieces by the chunk their centre is in, as a structure store holds them. */
export class CityStatics {
  readonly dims: MapDims;
  /** Chunk `c` holds pieces `first[c]` up to `first[c + 1]`, in the order the map lists them. */
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  /** Centres in world metres, as float32 like a chunk table, so a bake of them matches the server's. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Per content index: half extents and palette colour. */
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  readonly color: Uint8Array;

  constructor(dims: MapDims, statics: readonly MapStatic[], reg: Registry) {
    this.dims = dims;
    const chunks = chunkCount(dims);
    const kinds = new Uint16Array(statics.length);
    const of = new Uint32Array(statics.length);
    const first = (this.first = new Uint32Array(chunks + 1));
    let n = 0;
    statics.forEach((s, i) => {
      const k = reg.index.get(s.kind);
      if (k === undefined || reg.defs[k]?.type !== "structure") return;
      kinds[i] = k;
      of[i] = chunkAt(dims, s.x, s.z);
      first[of[i]! + 1]!++;
      n++;
    });
    for (let c = 0; c < chunks; c++) first[c + 1]! += first[c]!;
    const at = first.slice(0, chunks);
    this.kind = new Uint16Array(n);
    this.yaw = new Uint16Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    statics.forEach((s, i) => {
      if (kinds[i] === 0) return;
      const r = at[of[i]!]!++;
      this.kind[r] = kinds[i]!;
      this.yaw[r] = s.yaw;
      this.x[r] = s.x;
      this.y[r] = s.y;
      this.z[r] = s.z;
    });
    this.halfX = reg.halfX;
    this.halfY = reg.halfY;
    this.halfZ = reg.halfZ;
    this.color = Uint8Array.from(reg.defs, (d) => (d?.type === "structure" ? d.color : 0));
  }

  get count(): number {
    return this.kind.length;
  }

  /** Pieces of `chunk`. */
  in(chunk: number): number {
    return this.first[chunk + 1]! - this.first[chunk]!;
  }
}

/**
 * One chunk's form: four corners a face, x and z from the chunk's corner and y in the world, counter-clockwise seen from
 * outside, and a palette colour a face; with the box that holds it, x and z from the chunk's corner.
 */
export interface CityPart {
  readonly pos: Float32Array;
  readonly color: Uint8Array;
  readonly faces: number;
  readonly box: readonly number[];
}

export const EMPTY_PART: CityPart = { pos: new Float32Array(0), color: new Uint8Array(0), faces: 0, box: [0, 0, 0, 0, 0, 0] };

/** Which pieces of a chunk are gone: a byte a piece in the chunk's order, 1 for gone. Null for none. */
export type Gone = Uint8Array | null;

/** Faces being made, and the box that holds them. */
class Out {
  pos = new Float32Array(12 * 1024);
  color = new Uint8Array(1024);
  faces = 0;
  readonly box = new Float64Array(6);
  x0 = 0;
  z0 = 0;

  reset(x0: number, z0: number): void {
    this.faces = 0;
    this.x0 = x0;
    this.z0 = z0;
    this.box.fill(Infinity, 0, 3).fill(-Infinity, 3, 6);
  }

  /** A face of the world corners `c` at `at`, 12 numbers in order round it. */
  quad(c: ArrayLike<number>, at: number, col: number): void {
    const f = this.faces++;
    if (f === this.color.length) {
      const pos = new Float32Array(this.pos.length * 2);
      pos.set(this.pos);
      this.pos = pos;
      const color = new Uint8Array(this.color.length * 2);
      color.set(this.color);
      this.color = color;
    }
    const p = this.pos;
    const b = this.box;
    for (let k = 0; k < 4; k++) {
      const x = c[at + k * 3]! - this.x0;
      const y = c[at + k * 3 + 1]!;
      const z = c[at + k * 3 + 2]! - this.z0;
      p[f * 12 + k * 3] = x;
      p[f * 12 + k * 3 + 1] = y;
      p[f * 12 + k * 3 + 2] = z;
      if (x < b[0]!) b[0] = x;
      if (x > b[3]!) b[3] = x;
      if (y < b[1]!) b[1] = y;
      if (y > b[4]!) b[4] = y;
      if (z < b[2]!) b[2] = z;
      if (z > b[5]!) b[5] = z;
    }
    this.color[f] = col;
  }

  part(): CityPart {
    if (this.faces === 0) return EMPTY_PART;
    return { pos: this.pos.slice(0, this.faces * 12), color: this.color.slice(0, this.faces), faces: this.faces, box: Array.from(this.box) };
  }
}

const out = new Out();

/** How far a corner may stand outside a box and still be held by it, in metres. */
const HELD = 0.02;
/** Cells of the grid boxes are found by when testing what holds a face. */
const GRID = 4;
/** The grid covers the chunk and this much round it, which the widest piece reaches across. */
const MARGIN = 16;
const GRID_SIDE = (CHUNK_SIZE + 2 * MARGIN) / GRID;

/**
 * The corners of each face of a box, as bits of its eight corners (1 for +x, 2 for +y, 4 for +z), in order round it seen
 * from outside. Faces are +x, -x, +y, -y, +z, -z.
 */
const FACE_CORNERS = Uint8Array.from(
  [0, 1, 2, 3, 4, 5].flatMap((f) => {
    const a = f >> 1;
    const plus = (f & 1) === 0;
    // u x v points out: (a + 1, a + 2) for a face looking + along its axis, swapped for one looking -.
    const u = plus ? (a + 1) % 3 : (a + 2) % 3;
    const v = plus ? (a + 2) % 3 : (a + 1) % 3;
    const base = plus ? 1 << a : 0;
    return [base, base | (1 << u), base | (1 << u) | (1 << v), base | (1 << v)];
  }),
);

/** Boxes to make faces of: centre, half extents, the cosine and sine of their turn; a colour; whether its faces are wanted. */
class Boxes {
  n = 0;
  f = new Float64Array(8 * 1024);
  color = new Uint8Array(1024);
  own = new Uint8Array(1024);

  push(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: number, s: number, color: number, own: boolean): void {
    if (this.n === this.color.length) {
      const f = new Float64Array(this.f.length * 2);
      f.set(this.f);
      this.f = f;
      const col = new Uint8Array(this.color.length * 2);
      col.set(this.color);
      this.color = col;
      const o = new Uint8Array(this.own.length * 2);
      o.set(this.own);
      this.own = o;
    }
    const o = this.n * 8;
    const f = this.f;
    f[o] = cx;
    f[o + 1] = cy;
    f[o + 2] = cz;
    f[o + 3] = hx;
    f[o + 4] = hy;
    f[o + 5] = hz;
    f[o + 6] = c;
    f[o + 7] = s;
    this.color[this.n] = color;
    this.own[this.n] = own ? 1 : 0;
    this.n++;
  }
}

const boxes = new Boxes();
const gridCount = new Uint32Array(GRID_SIDE * GRID_SIDE + 1);
const gridFill = new Uint32Array(GRID_SIDE * GRID_SIDE);
let gridList = new Uint32Array(16384);
/** A box's eight corners in the world, and a face's four. */
const corners = new Float64Array(24);
const face = new Float64Array(12);

/** Puts the standing pieces of the chunks round `chunk` that reach within MARGIN of it in `boxes`, and with `own` its own. */
function gather(city: CityStatics, chunk: number, gone: (chunk: number) => Gone, own: boolean): void {
  const { dims, first, kind, yaw, x, y, z, halfX, halfY, halfZ, color } = city;
  const cx = chunkCx(dims, chunk);
  const cz = chunkCz(dims, chunk);
  const [x0, z0] = [cx * CHUNK_SIZE, cz * CHUNK_SIZE];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncz < 0 || ncx >= dims.chunksX || ncz >= dims.chunksZ || (!own && dx === 0 && dz === 0)) continue;
      const c = ncz * dims.chunksX + ncx;
      const g = gone(c);
      for (let i = first[c]!; i < first[c + 1]!; i++) {
        if (g && g[i - first[c]!] === 1) continue;
        const k = kind[i]!;
        const r = Math.max(halfX[k]!, halfZ[k]!) * 1.5;
        if (x[i]! + r < x0 - MARGIN || x[i]! - r > x0 + CHUNK_SIZE + MARGIN || z[i]! + r < z0 - MARGIN || z[i]! - r > z0 + CHUNK_SIZE + MARGIN) continue;
        const a = (yaw[i]! / YAW_UNITS) * TAU;
        boxes.push(x[i]!, y[i]!, z[i]!, halfX[k]!, halfY[k]!, halfZ[k]!, detCos(a), detSin(a), color[k]!, c === chunk);
      }
    }
  }
}

/**
 * The faces of the standing pieces of `chunk`, less those another standing piece holds whole (this chunk's or a
 * neighbour's) and those under the ground: its near drawing as one mesh. `gone(c)` says which pieces of chunk `c` are gone.
 */
export function boxPart(city: CityStatics, chunk: number, hf: Heightfield, gone: (chunk: number) => Gone): CityPart {
  return mergedPart(city, chunk, hf, gone, -1, 0);
}

/** Whether box `q` holds the world point (wx, wy, wz). */
function holds(q: number, wx: number, wy: number, wz: number): boolean {
  const B = boxes.f;
  const o = q * 8;
  const dx = wx - B[o]!;
  const dz = wz - B[o + 2]!;
  const c = B[o + 6]!;
  const s = B[o + 7]!;
  return Math.abs(c * dx - s * dz) <= B[o + 3]! + HELD && Math.abs(s * dx + c * dz) <= B[o + 5]! + HELD && Math.abs(wy - B[o + 1]!) <= B[o + 4]! + HELD;
}

/** The faces of `boxes` marked own, less those another box holds whole and those under the ground. */
function faces(dims: MapDims, chunk: number, hf: Heightfield): CityPart {
  const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
  out.reset(x0, z0);
  const n = boxes.n;
  const B = boxes.f;
  const gx0 = x0 - MARGIN;
  const gz0 = z0 - MARGIN;
  // Each box in every grid cell its turned box reaches, counted and then listed.
  gridCount.fill(0);
  for (let pass = 0; pass < 2; pass++) {
    for (let q = 0; q < n; q++) {
      const o = q * 8;
      const c = Math.abs(B[o + 6]!);
      const s = Math.abs(B[o + 7]!);
      const ex = c * B[o + 3]! + s * B[o + 5]! + HELD;
      const ez = s * B[o + 3]! + c * B[o + 5]! + HELD;
      const i0 = Math.max(0, Math.floor((B[o]! - ex - gx0) / GRID));
      const i1 = Math.min(GRID_SIDE - 1, Math.floor((B[o]! + ex - gx0) / GRID));
      const j0 = Math.max(0, Math.floor((B[o + 2]! - ez - gz0) / GRID));
      const j1 = Math.min(GRID_SIDE - 1, Math.floor((B[o + 2]! + ez - gz0) / GRID));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = j * GRID_SIDE + i;
          if (pass === 0) gridCount[cell + 1]!++;
          else gridList[gridFill[cell]!++] = q;
        }
      }
    }
    if (pass === 0) {
      for (let c = 0; c < GRID_SIDE * GRID_SIDE; c++) gridCount[c + 1]! += gridCount[c]!;
      if (gridList.length < gridCount[GRID_SIDE * GRID_SIDE]!) gridList = new Uint32Array(gridCount[GRID_SIDE * GRID_SIDE]! * 2);
      gridFill.set(gridCount.subarray(0, GRID_SIDE * GRID_SIDE));
    }
  }
  for (let q = 0; q < n; q++) {
    if (boxes.own[q] !== 1) continue;
    const o = q * 8;
    const [bx, by, bz, hx, hy, hz, c, s] = [B[o]!, B[o + 1]!, B[o + 2]!, B[o + 3]!, B[o + 4]!, B[o + 5]!, B[o + 6]!, B[o + 7]!];
    for (let k = 0; k < 8; k++) {
      const lx = k & 1 ? hx : -hx;
      const lz = k & 4 ? hz : -hz;
      corners[k * 3] = c * lx + s * lz + bx;
      corners[k * 3 + 1] = (k & 2 ? hy : -hy) + by;
      corners[k * 3 + 2] = c * lz - s * lx + bz;
    }
    const ground = hf.heightAt(bx, bz);
    for (let f = 0; f < 6; f++) {
      for (let m = 0; m < 4; m++) {
        const k = FACE_CORNERS[f * 4 + m]!;
        face[m * 3] = corners[k * 3]!;
        face[m * 3 + 1] = corners[k * 3 + 1]!;
        face[m * 3 + 2] = corners[k * 3 + 2]!;
      }
      // Under the ground: a face looking down onto it, or all four corners below it.
      if (f === 3 && face[1]! <= ground + 0.1) continue;
      let above = false;
      for (let m = 0; m < 4 && !above; m++) above = face[m * 3 + 1]! > hf.heightAt(face[m * 3]!, face[m * 3 + 2]!) + 0.05;
      if (!above) continue;
      // Held whole by one other box, found in the grid cell of the face's middle.
      const gi = Math.floor(((face[0]! + face[6]!) / 2 - gx0) / GRID);
      const gj = Math.floor(((face[2]! + face[8]!) / 2 - gz0) / GRID);
      let held = false;
      if (gi >= 0 && gj >= 0 && gi < GRID_SIDE && gj < GRID_SIDE) {
        const cell = gj * GRID_SIDE + gi;
        for (let e = gridCount[cell]!; e < gridCount[cell + 1]! && !held; e++) {
          const h = gridList[e]!;
          held = h !== q && holds(h, face[0]!, face[1]!, face[2]!) && holds(h, face[3]!, face[4]!, face[5]!) && holds(h, face[6]!, face[7]!, face[8]!) && holds(h, face[9]!, face[10]!, face[11]!);
        }
      }
      if (!held) out.quad(face, 0, boxes.color[q]!);
    }
  }
  return out.part();
}

// Scratch for a frame's boxes: least and most corners in the frame and a colour, seven numbers a box.
let framed = new Float64Array(7 * 1024);
let spare = new Float64Array(7 * 1024);
let keys = new Int32Array(5 * 1024);
let order: number[] = [];

/** The frames of the standing pieces of chunk `c`: their turns short of a quarter, in the order first met. */
function framesOf(city: CityStatics, chunk: number, g: Gone): number[] {
  const frames: number[] = [];
  const from = city.first[chunk]!;
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    if (g && g[i - from] === 1) continue;
    const f = city.yaw[i]! % QUARTER;
    if (!frames.includes(f)) frames.push(f);
  }
  return frames;
}

/** Puts the standing pieces of `chunk` turned by `f` short of a quarter in `framed`, in the frame turned by (c, s). Returns how many. */
function frameBoxes(city: CityStatics, chunk: number, g: Gone, f: number, c: number, s: number): number {
  const { first, kind, yaw, x, y, z, halfX, halfY, halfZ, color } = city;
  const from = first[chunk]!;
  let nb = 0;
  for (let i = from; i < first[chunk + 1]!; i++) {
    if ((g && g[i - from] === 1) || yaw[i]! % QUARTER !== f) continue;
    const k = kind[i]!;
    const odd = Math.floor(yaw[i]! / QUARTER) % 2 === 1;
    const hx = odd ? halfZ[k]! : halfX[k]!;
    const hz = odd ? halfX[k]! : halfZ[k]!;
    // The world to the frame: the inverse of the turn a piece's vertices are given.
    const lx = c * x[i]! - s * z[i]!;
    const lz = s * x[i]! + c * z[i]!;
    if ((nb + 1) * 7 > framed.length) {
      const grown = new Float64Array(framed.length * 2);
      grown.set(framed);
      framed = grown;
    }
    const o = nb * 7;
    framed[o] = lx - hx;
    framed[o + 1] = y[i]! - halfY[k]!;
    framed[o + 2] = lz - hz;
    framed[o + 3] = lx + hx;
    framed[o + 4] = y[i]! + halfY[k]!;
    framed[o + 5] = lz + hz;
    framed[o + 6] = color[k]!;
    nb++;
  }
  return nb;
}

/**
 * The standing pieces of `chunk` with fewer boxes: in each frame, boxes of one colour and one cross-section in a line
 * along an axis, no more than `gap` metres apart, become one box (a row of floor plates, a beam along them), and boxes no
 * longer than `least` metres are left out. Faces held by another box or under the ground go, the neighbouring chunks'
 * pieces holding faces as they stand. A gap below 0 merges nothing.
 */
export function mergedPart(city: CityStatics, chunk: number, hf: Heightfield, gone: (chunk: number) => Gone, gap: number, least: number): CityPart {
  if (city.in(chunk) === 0) return EMPTY_PART;
  boxes.n = 0;
  gather(city, chunk, gone, gap < 0 && least <= 0);
  if (gap >= 0 || least > 0) {
    const g = gone(chunk);
    for (const f of framesOf(city, chunk, g)) {
      const a = (f / YAW_UNITS) * TAU;
      const c = detCos(a);
      const s = detSin(a);
      let nb = frameBoxes(city, chunk, g, f, c, s);
      if (gap >= 0) nb = merge(nb, gap);
      for (let b = 0; b < nb; b++) {
        const o = b * 7;
        const [hx, hy, hz] = [(framed[o + 3]! - framed[o]!) / 2, (framed[o + 4]! - framed[o + 1]!) / 2, (framed[o + 5]! - framed[o + 2]!) / 2];
        if (Math.max(hx, hy, hz) * 2 <= least) continue;
        const [fx, fy, fz] = [framed[o]! + hx, framed[o + 1]! + hy, framed[o + 2]! + hz];
        // Back to the world from the frame, as a piece's vertices are turned.
        boxes.push(c * fx + s * fz, fy, c * fz - s * fx, hx, hy, hz, c, s, framed[o + 6]!, true);
      }
    }
  }
  return faces(city.dims, chunk, hf);
}

/** Merges the `nb` boxes in `framed` along y, x, z and y again, as mergedPart says. Returns how many are left. */
function merge(nb: number, gap: number): number {
  if (keys.length < nb * 5) keys = new Int32Array(nb * 10);
  for (const ax of [1, 0, 2, 1]) {
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    // What must match, to the centimetre: the colour and the box across the axis.
    for (let b = 0; b < nb; b++) {
      keys[b * 5] = framed[b * 7 + 6]!;
      keys[b * 5 + 1] = Math.round(framed[b * 7 + u]! * 100);
      keys[b * 5 + 2] = Math.round(framed[b * 7 + 3 + u]! * 100);
      keys[b * 5 + 3] = Math.round(framed[b * 7 + v]! * 100);
      keys[b * 5 + 4] = Math.round(framed[b * 7 + 3 + v]! * 100);
    }
    order.length = nb;
    for (let b = 0; b < nb; b++) order[b] = b;
    order.sort((p, q) => {
      for (let e = 0; e < 5; e++) if (keys[p * 5 + e] !== keys[q * 5 + e]) return keys[p * 5 + e]! - keys[q * 5 + e]!;
      return framed[p * 7 + ax]! - framed[q * 7 + ax]!;
    });
    if (spare.length < framed.length) spare = new Float64Array(framed.length);
    let kept = 0;
    let lastKey = -1;
    for (let e = 0; e < nb; e++) {
      const b = order[e]!;
      if (kept > 0) {
        let same = true;
        for (let k = 0; k < 5 && same; k++) same = keys[lastKey * 5 + k] === keys[b * 5 + k];
        const l = (kept - 1) * 7;
        if (same && framed[b * 7 + ax]! <= spare[l + 3 + ax]! + gap) {
          spare[l + 3 + ax] = Math.max(spare[l + 3 + ax]!, framed[b * 7 + 3 + ax]!);
          continue;
        }
      }
      spare.set(framed.subarray(b * 7, b * 7 + 7), kept * 7);
      lastKey = b;
      kept++;
    }
    [framed, spare] = [spare, framed];
    nb = kept;
  }
  return nb;
}

/** Cells of the far feed along a chunk's side (tactical.ts), and how wide a piece may be and still fill only its centre's. */
const FAR_SIDE = CHUNK_SIZE / TACTICAL_CELL;
const SMALL_HALF = TACTICAL_CELL / 2;

/**
 * Calls `each` with each far feed cell of its chunk piece `i` fills and the top byte it gives that cell, by
 * tactical.ts bakeChunk's rule: a narrow piece its centre's cell, a wide one every cell whose centre its turned box,
 * grown by half a cell, reaches.
 */
function pieceCells(city: CityStatics, i: number, x0: number, z0: number, hf: Heightfield, each: (cell: number, top: number) => void): void {
  const k = city.kind[i]!;
  // A float32, as the bake keeps a cell's top.
  const h = Math.fround(city.y[i]! + city.halfY[k]!);
  const hx = city.halfX[k]!;
  const hz = city.halfZ[k]!;
  const px = city.x[i]! - x0;
  const pz = city.z[i]! - z0;
  const top = (c: number): number => farTopByte(h - hf.heightAt(x0 + ((c % FAR_SIDE) + 0.5) * TACTICAL_CELL, z0 + (Math.floor(c / FAR_SIDE) + 0.5) * TACTICAL_CELL));
  if (hx <= SMALL_HALF && hz <= SMALL_HALF) {
    const cx = Math.min(FAR_SIDE - 1, Math.max(0, (px / TACTICAL_CELL) | 0));
    const cz = Math.min(FAR_SIDE - 1, Math.max(0, (pz / TACTICAL_CELL) | 0));
    each(cz * FAR_SIDE + cx, top(cz * FAR_SIDE + cx));
    return;
  }
  const a = city.yaw[i]! * (TAU / YAW_UNITS);
  const sn = detSin(a);
  const cs = detCos(a);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
  const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  const cx0 = Math.max(0, Math.floor((px - ex) / TACTICAL_CELL));
  const cx1 = Math.min(FAR_SIDE - 1, Math.floor((px + ex) / TACTICAL_CELL));
  const cz0 = Math.max(0, Math.floor((pz - ez) / TACTICAL_CELL));
  const cz1 = Math.min(FAR_SIDE - 1, Math.floor((pz + ez) / TACTICAL_CELL));
  for (let cz = cz0; cz <= cz1; cz++) {
    const dz = (cz + 0.5) * TACTICAL_CELL - pz;
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = (cx + 0.5) * TACTICAL_CELL - px;
      if (Math.abs(dx * cs - dz * sn) >= hx + SMALL_HALF || Math.abs(dx * sn + dz * cs) >= hz + SMALL_HALF) continue;
      each(cz * FAR_SIDE + cx, top(cz * FAR_SIDE + cx));
    }
  }
}

/** The far feed's top byte of each cell of `chunk` as its standing pieces alone would give it (tactical.ts FarCells.top). */
export function cityTops(city: CityStatics, chunk: number, hf: Heightfield, gone: Gone): Uint8Array {
  const tops = new Uint8Array(FAR_SIDE * FAR_SIDE);
  const from = city.first[chunk]!;
  const [x0, z0] = [chunkCx(city.dims, chunk) * CHUNK_SIZE, chunkCz(city.dims, chunk) * CHUNK_SIZE];
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    if (gone && gone[i - from] === 1) continue;
    pieceCells(city, i, x0, z0, hf, (c, t) => void (tops[c] = Math.max(tops[c]!, t)));
  }
  return tops;
}

/**
 * Marks in `gone` (a byte a piece of `chunk`) each piece the far feed's tops show cannot stand: one whose top byte in a
 * cell it fills is over the top the feed sent for that cell, since standing it would have made that cell at least as
 * tall. `tops` is the cells' top bytes as sent, all 0 for a chunk sent empty. Returns how many it marked.
 */
export function goneByCells(city: CityStatics, chunk: number, hf: Heightfield, tops: Uint8Array, gone: Uint8Array): number {
  const from = city.first[chunk]!;
  const [x0, z0] = [chunkCx(city.dims, chunk) * CHUNK_SIZE, chunkCz(city.dims, chunk) * CHUNK_SIZE];
  let marked = 0;
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    if (gone[i - from] === 1) continue;
    let over = false;
    pieceCells(city, i, x0, z0, hf, (c, t) => void (over ||= t > tops[c]!));
    if (over) {
      gone[i - from] = 1;
      marked++;
    }
  }
  return marked;
}

/**
 * Marks in `gone` (a byte a piece of `chunk`) each piece of the map the near store's table of that chunk does not hold
 * as it was set down: same kind, centre and turn. Returns how many it marked.
 */
export function goneByRows(city: CityStatics, chunk: number, rows: { readonly high: number; readonly kind: Uint16Array; readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; readonly yaw: Uint16Array }, gone: Uint8Array): number {
  const held = new Set<string>();
  for (let s = 0; s < rows.high; s++) if (rows.kind[s] !== 0) held.add(`${rows.kind[s]},${rows.x[s]},${rows.y[s]},${rows.z[s]},${rows.yaw[s]}`);
  const from = city.first[chunk]!;
  let marked = 0;
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    const there = held.has(`${city.kind[i]},${city.x[i]},${city.y[i]},${city.z[i]},${city.yaw[i]}`);
    gone[i - from] = there ? 0 : 1;
    if (!there) marked++;
  }
  return marked;
}

// Scratch for cells: whether each is filled, and for each of its six faces (+x, -x, +y, -y, +z, -z) how far out a box
// reaches that way, the area the box it is coloured by shows that way, and its colour; which empty cells the air outside
// reaches, with a stack for flooding it and a mask for a slice of faces.
let cellColour = new Uint8Array(1 << 16);
let faceReach = new Float32Array(6 << 16);
let faceArea = new Float32Array(6 << 16);
let faceColour = new Uint8Array(6 << 16);
let outside = new Uint8Array(1 << 16);
/** A face takes the colour of the box showing it most area among those reaching within this many metres of the outermost. */
const FACE_DEPTH = 1;
let stack = new Int32Array(1 << 16);
let mask = new Int16Array(4096);
/** A box takes a cell it covers at least this share of, along each axis; or, along an axis it takes none of, the one it covers most. */
const TAKES = 0.3;
const rect = new Float64Array(12);

/**
 * The standing pieces of `chunk` in cells `size` metres wide and `tall` tall in each frame, with only the faces between a
 * filled cell and the air outside, merged into rectangles of one colour. A face looking down onto the ground goes.
 */
export function cellPart(city: CityStatics, chunk: number, hf: Heightfield, gone: Gone, size: number, tall: number): CityPart {
  const x0 = chunkCx(city.dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(city.dims, chunk) * CHUNK_SIZE;
  out.reset(x0, z0);
  const step = [size, tall, size];
  for (const f of framesOf(city, chunk, gone)) {
    const a = (f / YAW_UNITS) * TAU;
    const c = detCos(a);
    const s = detSin(a);
    const nb = frameBoxes(city, chunk, gone, f, c, s);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let b = 0; b < nb; b++) {
      for (let ax = 0; ax < 3; ax++) {
        lo[ax] = Math.min(lo[ax]!, framed[b * 7 + ax]!);
        hi[ax] = Math.max(hi[ax]!, framed[b * 7 + 3 + ax]!);
      }
    }
    // The grid starts a cell short of the lowest corner, so the outside air wraps it.
    const o = [lo[0]! - size, lo[1]! - tall, lo[2]! - size];
    const n = [Math.ceil((hi[0]! - o[0]!) / size) + 1, Math.ceil((hi[1]! - o[1]!) / tall) + 1, Math.ceil((hi[2]! - o[2]!) / size) + 1];
    const [nx, ny, nz] = n as [number, number, number];
    const N = nx * ny * nz;
    if (cellColour.length < N) {
      cellColour = new Uint8Array(N * 2);
      faceReach = new Float32Array(N * 12);
      faceArea = new Float32Array(N * 12);
      faceColour = new Uint8Array(N * 12);
      outside = new Uint8Array(N * 2);
      stack = new Int32Array(N * 2);
    }
    cellColour.fill(0, 0, N);
    faceReach.fill(-Infinity, 0, N * 6);
    faceArea.fill(-1, 0, N * 6);
    // The cells each box takes: those it covers TAKES of along each axis, or along an axis it takes none of, the one it covers most.
    const spans = new Int32Array(nb * 6);
    for (let b = 0; b < nb; b++) {
      for (let ax = 0; ax < 3; ax++) {
        const l = (framed[b * 7 + ax]! - o[ax]!) / step[ax]!;
        const h = (framed[b * 7 + 3 + ax]! - o[ax]!) / step[ax]!;
        const cover = (i: number): number => Math.min(h, i + 1) - Math.max(l, i);
        let i0 = Math.floor(l);
        let i1 = Math.ceil(h) - 1;
        while (i0 < i1 && cover(i0) < TAKES) i0++;
        while (i1 > i0 && cover(i1) < TAKES) i1--;
        if (i0 === i1 && cover(i0) < TAKES && cover(i0 + 1) > cover(i0)) i0 = i1 = i0 + 1;
        spans[b * 6 + ax] = i0;
        spans[b * 6 + ax + 3] = i1;
      }
    }
    // A face of a cell is coloured as that side of the pieces in it shows: first how far out the outermost reaches, then
    // the colour of the box showing most area that way among those within FACE_DEPTH of it, so a wall gives a front its
    // colour over the slab edge before it.
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < nb; b++) {
        const B = b * 7;
        for (let k = spans[b * 6 + 2]!; k <= spans[b * 6 + 5]!; k++) {
          for (let j = spans[b * 6 + 1]!; j <= spans[b * 6 + 4]!; j++) {
            for (let i = spans[b * 6]!; i <= spans[b * 6 + 3]!; i++) {
              const cell = (k * ny + j) * nx + i;
              cellColour[cell] = 1;
              const at = [i, j, k];
              for (let d = 0; d < 6; d++) {
                const ax = d >> 1;
                const reach = d & 1 ? -framed[B + ax]! : framed[B + 3 + ax]!;
                const e = cell * 6 + d;
                if (pass === 0) {
                  if (reach > faceReach[e]!) faceReach[e] = reach;
                  continue;
                }
                if (reach < faceReach[e]! - FACE_DEPTH) continue;
                let area = 1;
                for (const w of [(ax + 1) % 3, (ax + 2) % 3]) {
                  const c0 = o[w]! + at[w]! * step[w]!;
                  area *= Math.max(0, Math.min(framed[B + 3 + w]!, c0 + step[w]!) - Math.max(framed[B + w]!, c0));
                }
                if (area > faceArea[e]!) {
                  faceArea[e] = area;
                  faceColour[e] = framed[B + 6]!;
                }
              }
            }
          }
        }
      }
    }
    // The air outside, flooded in from the grid's sides.
    outside.fill(0, 0, N);
    let sp = 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (i !== 0 && j !== 0 && k !== 0 && i !== nx - 1 && j !== ny - 1 && k !== nz - 1) continue;
          const cell = (k * ny + j) * nx + i;
          if (cellColour[cell] === 0 && outside[cell] === 0) {
            outside[cell] = 1;
            stack[sp++] = cell;
          }
        }
      }
    }
    const nxy = nx * ny;
    const visit = (m: number): void => {
      if (cellColour[m] !== 0 || outside[m] !== 0) return;
      outside[m] = 1;
      stack[sp++] = m;
    };
    while (sp > 0) {
      const cell = stack[--sp]!;
      const i = cell % nx;
      const j = Math.floor(cell / nx) % ny;
      const k = Math.floor(cell / nxy);
      if (i > 0) visit(cell - 1);
      if (i < nx - 1) visit(cell + 1);
      if (j > 0) visit(cell - nx);
      if (j < ny - 1) visit(cell + nx);
      if (k > 0) visit(cell - nxy);
      if (k < nz - 1) visit(cell + nxy);
    }
    // Faces between a filled cell and the air outside, a slice at a time along each axis, merged greedily.
    const stride = [1, nx, nxy];
    for (let ax = 0; ax < 3; ax++) {
      for (const sign of [1, -1]) {
        const u = sign > 0 ? (ax + 1) % 3 : (ax + 2) % 3;
        const v = sign > 0 ? (ax + 2) % 3 : (ax + 1) % 3;
        const nu = n[u]!;
        const nv = n[v]!;
        const na = n[ax]!;
        const [sa, su, sv] = [stride[ax]!, stride[u]!, stride[v]!];
        const across = sign * sa;
        const way = ax * 2 + (sign > 0 ? 0 : 1);
        if (mask.length < nu * nv) mask = new Int16Array(nu * nv * 2);
        for (let d = 0; d < na; d++) {
          const e = d + sign;
          if (e < 0 || e >= na) continue;
          let any = false;
          for (let jv = 0; jv < nv; jv++) {
            let cell = d * sa + jv * sv;
            const row = jv * nu;
            for (let iu = 0; iu < nu; iu++, cell += su) {
              if (cellColour[cell] !== 0 && outside[cell + across] === 1) {
                mask[row + iu] = faceColour[cell * 6 + way]! + 1;
                any = true;
              } else mask[row + iu] = 0;
            }
          }
          if (!any) continue;
          const plane = o[ax]! + (sign > 0 ? d + 1 : d) * step[ax]!;
          for (let jv = 0; jv < nv; jv++) {
            for (let iu = 0; iu < nu; ) {
              const m = mask[jv * nu + iu]!;
              if (m === 0) {
                iu++;
                continue;
              }
              let w = 1;
              while (iu + w < nu && mask[jv * nu + iu + w] === m) w++;
              let h = 1;
              grow: while (jv + h < nv) {
                for (let q = 0; q < w; q++) if (mask[(jv + h) * nu + iu + q] !== m) break grow;
                h++;
              }
              for (let q = 0; q < h; q++) mask.fill(0, (jv + q) * nu + iu, (jv + q) * nu + iu + w);
              // The rectangle's corners in the frame, round it from its least corner, then into the world.
              const u0 = o[u]! + iu * step[u]!;
              const u1 = u0 + w * step[u]!;
              const v0 = o[v]! + jv * step[v]!;
              const v1 = v0 + h * step[v]!;
              iu += w;
              const p = [0, 0, 0];
              p[ax] = plane;
              const us = [u0, u1, u1, u0];
              const vs = [v0, v0, v1, v1];
              for (let k = 0; k < 4; k++) {
                p[u] = us[k]!;
                p[v] = vs[k]!;
                rect[k * 3] = c * p[0]! + s * p[2]!;
                rect[k * 3 + 1] = p[1]!;
                rect[k * 3 + 2] = c * p[2]! - s * p[0]!;
              }
              if (ax === 1 && sign < 0 && plane <= hf.heightAt((rect[0]! + rect[6]!) / 2, (rect[2]! + rect[8]!) / 2) + tall / 2) continue;
              out.quad(rect, 0, m - 1);
            }
          }
        }
      }
    }
  }
  return out.part();
}
