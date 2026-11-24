// Which piece fills each cell of each base's lattice: one open-addressing table for a whole store, from (frame, cell) to ref.
// A cell is a key with its turn and flip cleared (module.cellOf). A piece has one entry for each edge or face it covers and
// each storey of its height, and an entry reaches up to four levels from its own, so asking who covers a level also looks at
// the levels just under it. An entry is 16 bytes and the table is kept between 35% and 70% full: 23 to 46 bytes an entry.

import { CLS_EDGE, CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, DIRECTIONS, LVL_MOST, M_MOST, SIDE, canon, canonical, dirTurn, elementCorners, key0, key1, keyAnchor, keyCls, keyDir, keyLayer, keyLvl, keyM3, tupleStep, tupleWithin } from "./module.ts";
import { STOREY_LEVELS, type FormTable } from "./forms.ts";

/** In a list of refs, where no piece is. No ref is this: a chunk has at most 65,535 slots. */
export const NO_REF = 0xffffffff;
/** The most cells one list holds: the faces round a vertex are 27. */
export const CELLS_MOST = 64;

/** The bits of a key's second word that are the cell: m3, level, direction and layer. */
const CELL = (1 << 26) - 1;
const LVL_ONE = 1 << 10;
const WORDS = 4;

/** Cells as key words. A cell off the lattice has a first word of 0, which no key has. */
export class Cells {
  n = 0;
  readonly k0 = new Uint32Array(CELLS_MOST);
  readonly k1 = new Uint32Array(CELLS_MOST);
  /** For a piece's own cells: the levels each reaches up from its own. */
  readonly reach = new Uint8Array(CELLS_MOST);
}

/** A cell with the low two bits of its level cleared: the four levels of a storey start their search at one slot. */
const STOREY = ~(3 << 10);

/** Where the search for a cell starts. A storey's levels share it, so asking who covers a level reads one or two runs of slots. */
function mix(fr: number, k0: number, cell: number): number {
  let h = Math.imul(fr, 0x9e3779b1) ^ Math.imul(k0, 0x85ebca6b) ^ Math.imul(cell & STOREY, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

export class Occupancy {
  /** Entries held. */
  size = 0;
  /** Slots, a power of two. A slot is four words: frame (0 for an empty slot), k0, the cell with its reach less one above it, ref. */
  private cap = 16;
  private slots = new Uint32Array(16 * WORDS);
  /** Per layer, how many levels under a level an entry that covers it may be: the longest reach put there, less one. */
  readonly deep = new Uint8Array(8);

  /** Bytes the table holds. */
  get bytes(): number {
    return this.slots.byteLength;
  }

  /** The slot of a cell's entry, or -1. */
  private find(fr: number, k0: number, cell: number): number {
    const slots = this.slots;
    const mask = this.cap - 1;
    for (let i = mix(fr, k0, cell) & mask; ; i = (i + 1) & mask) {
      const at = i * WORDS;
      const f = slots[at]!;
      if (f === 0) return -1;
      if (f === fr && slots[at + 1] === k0 && (slots[at + 2]! & CELL) === cell) return i;
    }
  }

  /** Enters `ref` in a cell, reaching `reach` levels up from its own (1 to 64). False, and nothing changes, if the cell has an entry. */
  put(fr: number, k0: number, k1: number, ref: number, reach = 1): boolean {
    const cell = k1 & CELL;
    if ((this.size + 1) * 10 > this.cap * 7) this.grow();
    const slots = this.slots;
    const mask = this.cap - 1;
    let i = mix(fr, k0, cell) & mask;
    for (; slots[i * WORDS] !== 0; i = (i + 1) & mask) if (slots[i * WORDS] === fr && slots[i * WORDS + 1] === k0 && (slots[i * WORDS + 2]! & CELL) === cell) return false;
    slots[i * WORDS] = fr;
    slots[i * WORDS + 1] = k0;
    slots[i * WORDS + 2] = (cell | ((reach - 1) << 26)) >>> 0;
    slots[i * WORDS + 3] = ref;
    this.size++;
    const layer = cell >>> 23;
    if (reach - 1 > this.deep[layer]!) this.deep[layer] = reach - 1;
    return true;
  }

  private grow(): void {
    const old = this.slots;
    this.cap *= 2;
    const slots = (this.slots = new Uint32Array(this.cap * WORDS));
    const mask = this.cap - 1;
    for (let at = 0; at < old.length; at += WORDS) {
      if (old[at] === 0) continue;
      let i = mix(old[at]!, old[at + 1]!, old[at + 2]! & CELL) & mask;
      while (slots[i * WORDS] !== 0) i = (i + 1) & mask;
      slots.set(old.subarray(at, at + WORDS), i * WORDS);
    }
  }

  /** Takes a cell's entry out. False if it had none. */
  take(fr: number, k0: number, k1: number): boolean {
    let i = this.find(fr, k0, k1 & CELL);
    if (i < 0) return false;
    const slots = this.slots;
    const mask = this.cap - 1;
    // Each later entry of the run moves back into the gap if its own slot is at or before the gap, so no search stops short.
    for (let j = (i + 1) & mask; slots[j * WORDS] !== 0; j = (j + 1) & mask) {
      const home = mix(slots[j * WORDS]!, slots[j * WORDS + 1]!, slots[j * WORDS + 2]! & CELL) & mask;
      if (((j - home) & mask) < ((j - i) & mask)) continue;
      slots.copyWithin(i * WORDS, j * WORDS, j * WORDS + WORDS);
      i = j;
    }
    slots[i * WORDS] = 0;
    this.size--;
    return true;
  }

  /** The ref entered in exactly this cell, or -1. */
  at(fr: number, k0: number, k1: number): number {
    const i = this.find(fr, k0, k1 & CELL);
    return i < 0 ? -1 : this.slots[i * WORDS + 3]!;
  }

  /** The ref of the piece that covers this cell's level of its edge, face or vertex, from this level or one under it, or -1. */
  covering(fr: number, k0: number, k1: number): number {
    const cell = k1 & CELL;
    const lvl = (cell >>> 10) & 511;
    const deep = Math.min(this.deep[cell >>> 23]!, lvl - 1);
    for (let k = 0; k <= deep; k++) {
      const i = this.find(fr, k0, cell - k * LVL_ONE);
      if (i >= 0 && this.slots[i * WORDS + 2]! >>> 26 >= k) return this.slots[i * WORDS + 3]!;
    }
    return -1;
  }

  /** Whether nothing covers any of the `reach` levels from this cell's up: what a piece needs of each cell it is to take. */
  free(fr: number, k0: number, k1: number, reach = 1): boolean {
    const cell = k1 & CELL;
    const lvl = (cell >>> 10) & 511;
    for (let up = 1; up < reach && lvl + up < 512; up++) if (this.find(fr, k0, cell + up * LVL_ONE) >= 0) return false;
    return this.covering(fr, k0, cell) < 0;
  }

  /** For each of `cells`, the ref of the piece that covers it, or NO_REF, to `out`. Returns how many have one. */
  among(fr: number, cells: Cells, out: Uint32Array): number {
    let found = 0;
    for (let i = 0; i < cells.n; i++) {
      const ref = cells.k0[i] === 0 ? -1 : this.covering(fr, cells.k0[i]!, cells.k1[i]!);
      out[i] = ref < 0 ? NO_REF : ref;
      if (ref >= 0) found++;
    }
    return found;
  }
}

const m = new Int32Array(24);

/** Adds the element of class `cls` named from the tuple at `m[at]` along `d` to `out`, at `lvl` in `layer`. */
function push(out: Cells, cls: number, at: number, d: number, lvl: number, layer: number): void {
  canonical(cls, m, at, dirTurn(d, 0), m, 20);
  const n = out.n++;
  const on = tupleWithin(m, 20, M_MOST) && Math.abs(lvl) <= LVL_MOST;
  out.k0[n] = on ? key0(cls, m[20]!, m[21]!, m[22]!) : 0;
  out.k1[n] = on ? key1(m[23]!, lvl, canon.dir, layer, 0, 0) : 0;
  out.reach[n] = 1;
}

/**
 * The cells a piece of `kind` covers in the slot its key names, each with its reach, to `out`: for each edge its form
 * lists (one, unless it lists more), one cell for each storey of its span. False if one is off the lattice.
 */
export function formCells(forms: FormTable, kind: number, k0: number, k1: number, out: Cells): boolean {
  const span = Math.max(1, forms.span[kind]!);
  const listed = forms.def[kind]!.cells;
  const lvl = keyLvl(k1);
  const dir = keyDir(k1);
  const layer = keyLayer(k1);
  const cls = keyCls(k0);
  out.n = 0;
  if (lvl + span - 1 > LVL_MOST) return false;
  keyAnchor(k0, k1, m, 0);
  for (let c = 0, count = listed ? listed.length : Math.ceil(span / STOREY_LEVELS); c < count; c++) {
    const along = listed ? listed[c]![0] : 0;
    const up = listed ? listed[c]![1] : c * STOREY_LEVELS;
    tupleStep(m, 0, dir, along * SIDE, m, 4);
    if (!tupleWithin(m, 4, M_MOST)) return false;
    const n = out.n++;
    out.k0[n] = key0(cls, m[4]!, m[5]!, m[6]!);
    out.k1[n] = key1(m[7]!, lvl + up, dir, layer, 0, 0);
    out.reach[n] = Math.min(STOREY_LEVELS, span - up);
  }
  return true;
}

/**
 * The faces either side of the edge a key names, at `lvl` in `layer`, to `out`: the square to its left and to its right,
 * then the triangle to its left and to its right. Left is toward +Z for an edge along +X.
 */
export function edgeFaces(k0: number, k1: number, lvl: number, layer: number, out: Cells): void {
  const d = keyDir(k1);
  keyAnchor(k0, k1, m, 0);
  out.n = 0;
  push(out, CLS_SQUARE, 0, d, lvl, layer);
  push(out, CLS_SQUARE, 0, d - 3, lvl, layer);
  push(out, CLS_TRIANGLE, 0, d, lvl, layer);
  push(out, CLS_TRIANGLE, 0, d - 2, lvl, layer);
}

/** The sides of the square or triangle a key names, at `lvl` in `layer`, to `out`: side k runs from corner k to the next. */
export function faceEdges(k0: number, k1: number, lvl: number, layer: number, out: Cells): void {
  const cls = keyCls(k0);
  const d = keyDir(k1);
  keyAnchor(k0, k1, m, 0);
  const corners = elementCorners(cls, m, 0, d, m, 0);
  out.n = 0;
  for (let k = 0; k < corners; k++) push(out, CLS_EDGE, 4 * k, d + k * CLS_STEP[cls]!, lvl, layer);
}

/**
 * The edges round the vertex a key names, at `lvl` in `layer`, to `out`: the twelve that end there, by direction, then
 * the six it is the middle of.
 */
export function vertexEdges(k0: number, k1: number, lvl: number, layer: number, out: Cells): void {
  keyAnchor(k0, k1, m, 0);
  out.n = 0;
  for (let d = 0; d < DIRECTIONS; d++) push(out, CLS_EDGE, 0, d, lvl, layer);
  for (let d = 0; d < DIRECTIONS / 2; d++) {
    tupleStep(m, 0, d, -SIDE / 2, m, 4);
    push(out, CLS_EDGE, 4, d, lvl, layer);
  }
}

/**
 * The faces round the vertex a key names, at `lvl` in `layer`, to `out`: the twelve squares with a corner there, by
 * direction, the twelve triangles, then the three squares it is the middle of.
 */
export function vertexFaces(k0: number, k1: number, lvl: number, layer: number, out: Cells): void {
  keyAnchor(k0, k1, m, 0);
  out.n = 0;
  for (let d = 0; d < DIRECTIONS; d++) push(out, CLS_SQUARE, 0, d, lvl, layer);
  for (let d = 0; d < DIRECTIONS; d++) push(out, CLS_TRIANGLE, 0, d, lvl, layer);
  for (let d = 0; d < 3; d++) {
    tupleStep(m, 0, d, -SIDE / 2, m, 4);
    tupleStep(m, 4, d + 3, -SIDE / 2, m, 4);
    push(out, CLS_SQUARE, 4, d, lvl, layer);
  }
}

/**
 * The vertices of the edge, square or triangle a key names, at `lvl` in `layer`, to `out`: its corners in order, then
 * the middle of an edge or a square.
 */
export function elementVertices(k0: number, k1: number, lvl: number, layer: number, out: Cells): void {
  const cls = keyCls(k0);
  const d = keyDir(k1);
  keyAnchor(k0, k1, m, 0);
  const corners = elementCorners(cls, m, 0, d, m, 0);
  out.n = 0;
  for (let k = 0; k < corners; k++) push(out, 0, 4 * k, 0, lvl, layer);
  if (cls === CLS_TRIANGLE) return;
  tupleStep(m, 0, d, SIDE / 2, m, 16);
  if (cls === CLS_SQUARE) tupleStep(m, 16, dirTurn(d, 3), SIDE / 2, m, 16);
  if (cls !== 0) push(out, 0, 16, 0, lvl, layer);
}

/** A cell's second word at another level and in another layer: the cell over or under it, or a leaf in a wall's edge. */
export function cellAt(k1: number, lvl: number, layer: number): number {
  return key1(keyM3(k1), lvl, keyDir(k1), layer, 0, 0);
}
