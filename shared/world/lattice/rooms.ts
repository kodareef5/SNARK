// The air a base's pieces shut in. An air cell is the air over one face of a frame's lattice (a square or a triangle)
// between two slabs of that face that follow each other: a floor and the ceiling over it, whatever levels they are on.
// Air over a face with no slab under it and one over it is open air. Air passes between two cells across the side their
// faces share, at each level both reach, unless a wall shuts that level; and through a slab only by an open hatch. A cell
// is outside where air reaches it from open air, and the rest are rooms. Nothing here knows a frame's yaw or its place.

import type { FormDef, FormTable } from "./forms.ts";
import { LEVEL_M, STOREY_LEVELS } from "./forms.ts";
import { ownDir, riseAt } from "./frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, CLS_VERTEX, SIDE, dirTurn, elementCorners, key1, keyAnchor, keyCls, keyDir, keyFlip, keyLvl, keyM3, type Tuples } from "./module.ts";
import { Cells, NO_REF, Occupancy, elementVertices, faceEdges, formCells } from "./occupancy.ts";

/** What a flood takes a window for: open, as sight and weather find it, or shut, as a body does. */
export const SENSE_SIGHT = 0;
export const SENSE_BODY = 1;

/** What a piece shuts of its edge or face. A leaf is a door or a hatch; a sloped wall shuts only the side of a roof. */
const FULL = 1;
const DOORWAY = 2;
const WINDOW = 4;
const LEAF = 8;
const SLOPED = 16;

/** What a kind is to a flood. */
const W_NONE = 0;
const W_SLAB = 1;
const W_WALL = 2;
const W_EDGE_LEAF = 3;
const W_FACE_LEAF = 4;
const W_UNKNOWN = 255;

/** A cell's `pass`: air goes through the slab over it, and through the one under it. */
const PASS_UP = 1;
const PASS_DOWN = 2;

const FULL_TURN = 0xfff;
const EPS = 1e-6;

const cells = new Cells();
const sides = new Cells();
const ends = new Cells();
const m = new Int32Array(20);

/** One room of a finished flood: how many air cells it has, and each doorway or hatch on it with its leaf (NO_REF for none) and whether that shuts it. */
export interface Room {
  cells: number;
  doors: { ref: number; leaf: number; shut: boolean }[];
}

/** A finished flood: its air cells, a face's together from the lowest up, and the room each is in. */
export class Flooded {
  cells = 0;
  /** Per cell: its face, its lowest level and the level over its highest, and its room, or -1 for outside air. */
  face = new Int32Array(0);
  lo = new Int16Array(0);
  hi = new Int16Array(0);
  room = new Int32Array(0);
  /** Per cell: three bits a corner of its face, the levels a roof over it rises there; and its PASS_ bits. */
  rise = new Uint16Array(0);
  pass = new Uint8Array(0);
  /** Per face the flood knew: its first cell, or -1, and how many it has. */
  faces = 0;
  first = new Int32Array(0);
  count = new Int32Array(0);
  rooms = 0;
  inside = 0;
  /** Each doorway or hatch a cell met: the cell, the piece, its leaf or NO_REF, and whether it was shut. */
  doors = 0;
  doorCell = new Int32Array(0);
  doorRef = new Uint32Array(0);
  doorLeaf = new Uint32Array(0);
  doorShut = new Uint8Array(0);

  /** Room for one more cell. */
  cell(): number {
    const n = this.cells++;
    if (n === this.face.length) {
      const size = Math.max(64, n * 2);
      this.face = grown(this.face, size);
      this.lo = grown(this.lo, size);
      this.hi = grown(this.hi, size);
      this.room = grown(this.room, size);
      this.rise = grown(this.rise, size);
      this.pass = grown(this.pass, size);
    }
    return n;
  }

  door(cell: number, ref: number, leaf: number, shut: boolean): void {
    const n = this.doors++;
    if (n === this.doorCell.length) {
      const size = Math.max(16, n * 2);
      this.doorCell = grown(this.doorCell, size);
      this.doorRef = grown(this.doorRef, size);
      this.doorLeaf = grown(this.doorLeaf, size);
      this.doorShut = grown(this.doorShut, size);
    }
    this.doorCell[n] = cell;
    this.doorRef[n] = ref;
    this.doorLeaf[n] = leaf;
    this.doorShut[n] = shut ? 1 : 0;
  }
}

function grown<T extends Int32Array | Int16Array | Uint32Array | Uint16Array | Uint8Array>(a: T, size: number): T {
  if (a.length >= size) return a;
  const b = new (a.constructor as new (n: number) => T)(size);
  b.set(a);
  return b;
}

/** Quarter storeys in a height of metres, a part of one counting whole. */
const levels = (metres: number): number => Math.ceil(metres / LEVEL_M - EPS);

/** An upright outline's height at its -X end and at its +X end, in levels. */
function endHeights(f: FormDef): [number, number] {
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const p of f.outline) {
    u0 = Math.min(u0, p[0]);
    u1 = Math.max(u1, p[0]);
  }
  let h0 = 0;
  let h1 = 0;
  for (const p of f.outline) {
    if (Math.abs(p[0] - u0) < EPS) h0 = Math.max(h0, p[1]);
    if (Math.abs(p[0] - u1) < EPS) h1 = Math.max(h1, p[1]);
  }
  return [levels(h0), levels(h1)];
}

/**
 * The rooms of one base, or of the part of one a caller gives it. Pieces are told to it by their keys as they come and
 * go; `flood` then finds the air again, a limited number of cells a call, and `found` is the last flood it finished.
 */
export class Enclosure {
  readonly forms: FormTable;
  readonly sense: number;
  /** Asked once for each face, with its corners: whether air over it is open air whatever closes it (a caller's own bound). */
  open: ((corners: Tuples, n: number) => boolean) | null = null;
  /** Pieces have come or gone since `found` was found. */
  stale = false;
  /** Whether the last flood finished found other cells, or any cell on the other side of outside, than the one before it. */
  changed = false;
  /** Whether its cells are other cells than the one before had. Where they are the same, `faceMoved` and `edgeMoved` say which changed sides. */
  rebuilt = false;
  found = new Flooded();
  private next = new Flooded();

  /** Vertices, edges and faces by their keys, to their index. One a piece has named stays until `clear`. */
  private ids = new Occupancy();
  private vertices = 0;
  private edges = 0;
  private faces = 0;
  /** Per vertex, its list of the faces with a corner there: `ref` the face, `bits` the twelfths of a turn it fills. */
  private vertexHead = new Int32Array(0);
  /** Per edge: its list of pieces, lowest first; the square to its left and right, then the triangle; and its two ends. */
  private edgeHead = new Int32Array(0);
  private edgeFace = new Int32Array(0);
  private edgeVertex = new Int32Array(0);
  /** Per face: its key, its list of slabs and hatch leaves, lowest first, whether it is open air, and per side its edge twice plus 1 where the face is to that edge's right (-1 for none), and its corners' vertices. */
  private faceK0 = new Uint32Array(0);
  private faceK1 = new Uint32Array(0);
  private faceHead = new Int32Array(0);
  private faceOpen = new Uint8Array(0);
  private faceEdge = new Int32Array(0);
  private faceVertex = new Int32Array(0);
  /** List nodes: the next, the levels from `lo` up to `hi`, what it shuts, a number of its kind's, and the piece. */
  private nodes = 0;
  private free = -1;
  private nodeNext = new Int32Array(0);
  private nodeLo = new Int16Array(0);
  private nodeHi = new Int16Array(0);
  private nodeBits = new Uint16Array(0);
  private nodeAux = new Int32Array(0);
  private nodeRef = new Uint32Array(0);
  /** Per kind, once asked: what it is to a flood, what it shuts, and a number: a doorway's levels up to the top of its opening, a sloped wall's two heights, a roof's rise at its own corners. */
  private what: Uint8Array;
  private bits: Uint8Array;
  private aux: Int32Array;

  /** A flood under way: 0 not begun, 1 finding cells face by face, 2 joining them cell by cell. */
  private phase = 0;
  private cursor = 0;
  private parent = new Int32Array(0);
  private roomOf = new Int32Array(0);
  /** Per face and per vertex, the flood that last moved a cell of the face, or of a face with a corner there, across outside. */
  private faceMark = new Int32Array(0);
  private vertexMark = new Int32Array(0);
  private floods = 0;
  /** Answers `roundFilled` gave of the last flood, three numbers each: the vertex plus one, the levels, the answer. */
  private asked = new Int32Array(3 * 64);
  private askedMask = 63;

  constructor(forms: FormTable, sense = SENSE_SIGHT) {
    this.forms = forms;
    this.sense = sense;
    const n = forms.def.length;
    this.what = new Uint8Array(n).fill(W_UNKNOWN);
    this.bits = new Uint8Array(n);
    this.aux = new Int32Array(n);
  }

  /** Forgets every piece. */
  clear(): void {
    this.ids = new Occupancy();
    this.vertices = this.edges = this.faces = this.nodes = 0;
    this.free = -1;
    this.found.cells = this.found.faces = this.found.rooms = this.found.inside = this.found.doors = 0;
    this.stale = false;
    this.changed = this.rebuilt = false;
    this.phase = 0;
    this.asked.fill(0);
    this.faceMark.fill(0);
    this.vertexMark.fill(0);
  }

  private learn(kind: number): number {
    const f = this.forms.def[kind];
    let what = W_NONE;
    let bits = 0;
    let aux = 0;
    const shuts = (closes: FormDef["closes"]): number => (closes === "full" ? FULL : closes === "doorway" ? DOORWAY : closes === "window" ? WINDOW : 0);
    if (f && f.layer === "slab" && (f.size ?? 2) === SIDE) {
      what = W_SLAB;
      bits = f.closes === undefined ? FULL : shuts(f.closes);
      aux = this.forms.rise[kind]!;
    } else if (f && f.layer === "wall") {
      const [h0, h1] = endHeights(f);
      bits = shuts(f.closes);
      if (h0 !== h1) {
        bits = (bits & FULL) | SLOPED;
        aux = h0 | (h1 << 4);
      } else if (bits === DOORWAY) {
        // Over its opening a doorway is wall.
        for (const cut of f.openings ?? []) aux = Math.max(aux, levels(cut.y1));
        aux = aux === 0 ? f.span : Math.min(f.span, aux);
      }
      if (bits !== 0) what = W_WALL;
    } else if (f && f.layer === "leaf") {
      what = f.cls === "edge" ? W_EDGE_LEAF : (f.size ?? 2) === SIDE || f.cls === "triangle" ? W_FACE_LEAF : W_NONE;
      bits = LEAF | (f.closes === "full" ? FULL : 0);
    }
    this.bits[kind] = bits;
    this.aux[kind] = aux;
    return (this.what[kind] = what);
  }

  private whatOf(kind: number): number {
    if (!(kind > 0 && kind < this.what.length)) return W_NONE;
    const what = this.what[kind]!;
    return what === W_UNKNOWN ? this.learn(kind) : what;
  }

  private vertex(k0: number, k1: number): number {
    const cell = key1(keyM3(k1), 0, 0, 0, 0, 0);
    let v = this.ids.at(1, k0, cell);
    if (v >= 0) return v;
    v = this.vertices++;
    if (v === this.vertexHead.length) this.vertexHead = grown(this.vertexHead, Math.max(64, v * 2));
    this.vertexHead[v] = -1;
    this.ids.put(1, k0, cell, v);
    return v;
  }

  private edge(k0: number, k1: number): number {
    const cell = key1(keyM3(k1), 0, keyDir(k1), 0, 0, 0);
    let e = this.ids.at(1, k0, cell);
    if (e >= 0) return e;
    e = this.edges++;
    if (e === this.edgeHead.length) {
      const size = Math.max(64, e * 2);
      this.edgeHead = grown(this.edgeHead, size);
      this.edgeFace = grown(this.edgeFace, size * 4);
      this.edgeVertex = grown(this.edgeVertex, size * 2);
    }
    this.edgeHead[e] = -1;
    this.edgeFace.fill(-1, e * 4, e * 4 + 4);
    this.ids.put(1, k0, cell, e);
    elementVertices(k0, cell, 0, 0, ends);
    for (let k = 0; k < 2; k++) this.edgeVertex[e * 2 + k] = ends.k0[k] === 0 ? -1 : this.vertex(ends.k0[k]!, ends.k1[k]!);
    return e;
  }

  private face(k0: number, k1: number): number {
    const cell = key1(keyM3(k1), 0, keyDir(k1), 0, 0, 0);
    let f = this.ids.at(1, k0, cell);
    if (f >= 0) return f;
    f = this.faces++;
    if (f === this.faceHead.length) {
      const size = Math.max(64, f * 2);
      this.faceK0 = grown(this.faceK0, size);
      this.faceK1 = grown(this.faceK1, size);
      this.faceHead = grown(this.faceHead, size);
      this.faceOpen = grown(this.faceOpen, size);
      this.faceEdge = grown(this.faceEdge, size * 4);
      this.faceVertex = grown(this.faceVertex, size * 4);
    }
    this.faceK0[f] = k0;
    this.faceK1[f] = cell;
    this.faceHead[f] = -1;
    this.ids.put(1, k0, cell, f);
    const cls = keyCls(k0);
    const d = keyDir(k1);
    const n = cls === CLS_SQUARE ? 4 : 3;
    this.faceEdge.fill(-1, f * 4, f * 4 + 4);
    this.faceVertex.fill(-1, f * 4, f * 4 + 4);
    faceEdges(k0, cell, 0, 0, sides);
    for (let k = 0; k < n; k++) {
      if (sides.k0[k] === 0) continue;
      // Going round its corners a face is to the left of each side, and an edge's own direction is one of the first six.
      const right = dirTurn(d, k * CLS_STEP[cls]!) >= 6 ? 1 : 0;
      const e = this.edge(sides.k0[k]!, sides.k1[k]!);
      this.faceEdge[f * 4 + k] = e * 2 + right;
      this.edgeFace[e * 4 + (cls === CLS_SQUARE ? 0 : 2) + right] = f;
    }
    elementVertices(k0, cell, 0, 0, sides);
    for (let k = 0; k < n; k++) {
      if (sides.k0[k] === 0) continue;
      const v = (this.faceVertex[f * 4 + k] = this.vertex(sides.k0[k]!, sides.k1[k]!));
      // From corner k the face fills a quarter turn, or a sixth, on from the side that leaves it.
      const from = dirTurn(d, k * CLS_STEP[cls]!);
      let turn = 0;
      for (let i = 0; i < (cls === CLS_SQUARE ? 3 : 2); i++) turn |= 1 << dirTurn(from, i);
      this.vertexHead[v] = this.node(this.vertexHead[v]!, 0, 0, turn, 0, f);
    }
    keyAnchor(k0, cell, m, 0);
    elementCorners(cls, m, 0, d, m, 4);
    this.faceOpen[f] = this.open?.(m.subarray(4, 4 + 4 * n), n) ? 1 : 0;
    return f;
  }

  /** A new node before `next`. */
  private node(next: number, lo: number, hi: number, bits: number, aux: number, ref: number): number {
    let n = this.free;
    if (n >= 0) this.free = this.nodeNext[n]!;
    else {
      n = this.nodes++;
      if (n === this.nodeNext.length) {
        const size = Math.max(256, n * 2);
        this.nodeNext = grown(this.nodeNext, size);
        this.nodeLo = grown(this.nodeLo, size);
        this.nodeHi = grown(this.nodeHi, size);
        this.nodeBits = grown(this.nodeBits, size);
        this.nodeAux = grown(this.nodeAux, size);
        this.nodeRef = grown(this.nodeRef, size);
      }
    }
    this.nodeNext[n] = next;
    this.nodeLo[n] = lo;
    this.nodeHi[n] = hi;
    this.nodeBits[n] = bits;
    this.nodeAux[n] = aux;
    this.nodeRef[n] = ref;
    return n;
  }

  /** Puts a node in the list at `heads[at]`, kept lowest first. */
  private enter(heads: Int32Array, at: number, lo: number, hi: number, bits: number, aux: number, ref: number): void {
    const next = this.nodeNext;
    let before = -1;
    let n = heads[at]!;
    while (n >= 0 && this.nodeLo[n]! <= lo) {
      before = n;
      n = next[n]!;
    }
    const made = this.node(n, lo, hi, bits, aux, ref);
    if (before < 0) heads[at] = made;
    else this.nodeNext[before] = made;
  }

  /** Takes the node of piece `ref` at level `lo` out of the list at `heads[at]`. */
  private leave(heads: Int32Array, at: number, lo: number, ref: number): void {
    const next = this.nodeNext;
    let before = -1;
    for (let n = heads[at]!; n >= 0; before = n, n = next[n]!) {
      if (this.nodeRef[n] !== ref || this.nodeLo[n] !== lo) continue;
      if (before < 0) heads[at] = next[n]!;
      else next[before] = next[n]!;
      next[n] = this.free;
      this.free = n;
      return;
    }
  }

  /**
   * Tells it a piece of `kind` stands at this key. `ref` is the caller's name for it, which doors are told by. Returns
   * the index of its face, or of its first edge, for the asks below that take one; -1 for a piece that shuts nothing
   * and is no leaf (a post, stairs, a half wall), which a flood has no use for.
   */
  add(kind: number, k0: number, k1: number, ref: number): number {
    return this.tell(kind, k0, k1, ref, true);
  }

  /** Tells it the piece `add` was told of is gone. */
  remove(kind: number, k0: number, k1: number, ref: number): void {
    this.tell(kind, k0, k1, ref, false);
  }

  private tell(kind: number, k0: number, k1: number, ref: number, comes: boolean): number {
    const what = this.whatOf(kind);
    if (what === W_NONE) return -1;
    const bits = this.bits[kind]!;
    const lvl = keyLvl(k1);
    let at = -1;
    if (what === W_SLAB || what === W_FACE_LEAF) {
      if (keyCls(k0) !== CLS_SQUARE && keyCls(k0) !== CLS_TRIANGLE) return -1;
      at = this.face(k0, k1);
      if (!comes) this.leave(this.faceHead, at, lvl, ref);
      else this.enter(this.faceHead, at, lvl, lvl, bits, what === W_SLAB && this.aux[kind] !== 0 ? riseAt(this.forms, kind, k0, k1) : 0, ref);
    } else {
      if (keyCls(k0) !== CLS_EDGE) return -1;
      // A piece on one edge for at most a storey covers its own cell alone.
      const span = this.forms.span[kind]!;
      if (this.forms.def[kind]!.cells === undefined && span <= STOREY_LEVELS) {
        cells.n = 1;
        cells.k0[0] = k0;
        cells.k1[0] = k1;
        cells.reach[0] = Math.max(1, span);
      } else if (!formCells(this.forms, kind, k0, k1, cells)) return -1;
      let aux = this.aux[kind]!;
      // A sloped wall's heights at its edge's first end and at its far one: its own -X is the first unless turned or flipped.
      if ((bits & SLOPED) !== 0 && ((keyDir(k1) !== ownDir(this.forms, kind, k1)) !== (keyFlip(k1) === 1))) aux = (aux >> 4) | ((aux & 15) << 4);
      else if ((bits & DOORWAY) !== 0) aux += lvl;
      for (let i = 0; i < cells.n; i++) {
        const e = this.edge(cells.k0[i]!, cells.k1[i]!);
        const lo = keyLvl(cells.k1[i]!);
        if (i === 0) at = e;
        if (!comes) this.leave(this.edgeHead, e, lo, ref);
        else this.enter(this.edgeHead, e, lo, lo + cells.reach[i]!, bits, aux, ref);
      }
    }
    this.stale = true;
    this.phase = 0;
    return at;
  }

  /** The node of a leaf that shuts level `lvl` in the list from `n`, or -1. */
  private leafAt(n: number, lvl: number): number {
    for (; n >= 0 && this.nodeLo[n]! <= lvl; n = this.nodeNext[n]!) {
      const bits = this.nodeBits[n]!;
      if ((bits & LEAF) !== 0 && (bits & FULL) !== 0 && (this.nodeHi[n]! > lvl || this.nodeLo[n] === lvl)) return n;
    }
    return -1;
  }

  /** Whether air goes through the slab at node `n` of face `f`. A hatch found is noted for cell `c`. */
  private through(w: Flooded, f: number, n: number, c: number): boolean {
    const bits = this.nodeBits[n]!;
    if ((bits & FULL) !== 0) return false;
    if ((bits & WINDOW) !== 0) return this.sense !== SENSE_BODY;
    if ((bits & DOORWAY) === 0) return true;
    const leaf = this.leafAt(this.faceHead[f]!, this.nodeLo[n]!);
    w.door(c, this.nodeRef[n]!, leaf < 0 ? NO_REF : this.nodeRef[leaf]!, leaf >= 0);
    return leaf < 0;
  }

  /** Finds the cells of face `f`: the air between each slab and the next one up. */
  private column(w: Flooded, f: number): void {
    w.first[f] = -1;
    w.count[f] = 0;
    let under = -1;
    for (let n = this.faceHead[f]!; n >= 0; n = this.nodeNext[n]!) {
      if ((this.nodeBits[n]! & LEAF) !== 0) continue;
      if (under >= 0 && this.nodeLo[n]! > this.nodeLo[under]!) {
        const c = w.cell();
        if (w.count[f]!++ === 0) w.first[f] = c;
        w.face[c] = f;
        w.lo[c] = this.nodeLo[under]!;
        w.hi[c] = this.nodeLo[n]!;
        w.rise[c] = this.nodeAux[n]!;
        w.pass[c] = (this.through(w, f, n, c) ? PASS_UP : 0) | (this.through(w, f, under, c) ? PASS_DOWN : 0);
      }
      under = n;
    }
  }

  private root(c: number): number {
    const parent = this.parent;
    while (parent[c] !== c) c = parent[c] = parent[parent[c]!]!;
    return c;
  }

  /** Makes two cells one room. The greater root stays, so outside air, the last, is always its room's. */
  private join(a: number, b: number): void {
    a = this.root(a);
    b = this.root(b);
    if (a < b) this.parent[a] = b;
    else this.parent[b] = a;
  }

  /** The side of face `g` that is edge `e`, or -1. */
  private sideOf(g: number, e: number): number {
    for (let k = 0; k < 4; k++) if (this.faceEdge[g * 4 + k]! >> 1 === e && this.faceEdge[g * 4 + k]! >= 0) return k;
    return -1;
  }

  /** The levels a roof of this rise stands over corner `k` of its face. */
  private riseFrom(rise: number, k: number): number {
    return (rise >> (3 * k)) & 7;
  }

  /** The cell of face `g` whose air reaches level `lvl` at its side on edge `e`: one the level is in, or the top one under a roof that is that high all along the side. */
  private reaching(w: Flooded, g: number, lvl: number, e: number): number {
    if (g < 0) return -1;
    const first = w.first[g]!;
    if (first < 0) return -1;
    const top = first + w.count[g]! - 1;
    for (let c = first; c <= top; c++) {
      if (lvl < w.lo[c]!) return -1;
      if (lvl < w.hi[c]!) return c;
    }
    const rise = w.rise[top]!;
    if (rise === 0) return -1;
    const k = this.sideOf(g, e);
    const n = keyCls(this.faceK0[g]!) === CLS_SQUARE ? 4 : 3;
    return k >= 0 && lvl < w.hi[top]! + Math.min(this.riseFrom(rise, k), this.riseFrom(rise, (k + 1) % n)) ? top : -1;
  }

  /**
   * The level up to which edge `e` is shut from level `lvl`: `lvl` itself where air passes there. A wall shuts its
   * levels, a doorway those a shut leaf covers and those over its opening, a window only for a body.
   */
  private shut(w: Flooded, e: number, lvl: number, c: number): number {
    for (let n = this.edgeHead[e]!; n >= 0 && this.nodeLo[n]! <= lvl; n = this.nodeNext[n]!) {
      const bits = this.nodeBits[n]!;
      if (this.nodeHi[n]! <= lvl || (bits & (LEAF | SLOPED)) !== 0) continue;
      if ((bits & FULL) !== 0) return this.nodeHi[n]!;
      if ((bits & WINDOW) !== 0) return this.sense === SENSE_BODY ? this.nodeHi[n]! : lvl;
      if (lvl >= this.nodeAux[n]!) return this.nodeHi[n]!;
      const leaf = this.leafAt(this.edgeHead[e]!, lvl);
      if (w.doors === 0 || w.doorCell[w.doors - 1] !== c || w.doorRef[w.doors - 1] !== this.nodeRef[n]) w.door(c, this.nodeRef[n]!, leaf < 0 ? NO_REF : this.nodeRef[leaf]!, leaf >= 0);
      return leaf < 0 ? lvl : Math.min(this.nodeHi[leaf]!, this.nodeAux[n]!);
    }
    return lvl;
  }

  /** Whether a gable shuts the side of a roof on edge `e` from level `lvl`: a sloped wall as high at each end, or walls that high. */
  private gabled(w: Flooded, e: number, lvl: number, first: number, far: number, c: number): boolean {
    for (let n = this.edgeHead[e]!; n >= 0 && this.nodeLo[n]! <= lvl; n = this.nodeNext[n]!) {
      const bits = this.nodeBits[n]!;
      if (this.nodeLo[n] === lvl && (bits & SLOPED) !== 0 && (bits & FULL) !== 0 && (this.nodeAux[n]! & 15) >= first && this.nodeAux[n]! >> 4 >= far) return true;
    }
    const top = lvl + Math.max(first, far);
    let at = lvl;
    while (at < top) {
      const to = this.shut(w, e, at, c);
      if (to === at) return false;
      at = to;
    }
    return true;
  }

  /** Joins cell `c` to every cell its air reaches, and to outside air where it reaches that. */
  private link(w: Flooded, c: number): void {
    const out = w.cells;
    const f = w.face[c]!;
    const lo = w.lo[c]!;
    const hi = w.hi[c]!;
    const rise = w.rise[c]!;
    const pass = w.pass[c]!;
    const last = c === w.first[f]! + w.count[f]! - 1;
    if ((pass & PASS_UP) !== 0 && !last) this.join(c, c + 1);
    let open = this.faceOpen[f] === 1 || ((pass & PASS_UP) !== 0 && last) || ((pass & PASS_DOWN) !== 0 && c === w.first[f]);
    const n = keyCls(this.faceK0[f]!) === CLS_SQUARE ? 4 : 3;
    for (let k = 0; k < n && !open; k++) {
      const packed = this.faceEdge[f * 4 + k]!;
      open = packed < 0;
      if (open) break;
      const e = packed >> 1;
      const beyond = 1 - (packed & 1);
      const square = this.edgeFace[e * 4 + beyond]!;
      const triangle = this.edgeFace[e * 4 + 2 + beyond]!;
      const from = this.riseFrom(rise, k);
      const to = this.riseFrom(rise, (k + 1) % n);
      // Under a roof the cell's air stands as high as the roof's lower end all along this side.
      const top = hi + Math.min(from, to);
      for (let lvl = lo; lvl < top; ) {
        const until = this.shut(w, e, lvl, c);
        if (until > lvl) {
          lvl = until;
          continue;
        }
        const a = this.reaching(w, square, lvl, e);
        const b = this.reaching(w, triangle, lvl, e);
        open = a < 0 && b < 0;
        if (open) break;
        if (a >= 0) this.join(c, a);
        if (b >= 0) this.join(c, b);
        lvl++;
      }
      if (open || from === to) continue;
      // Over that the roof slopes along the side: a gable shuts it, or the air goes on under a roof that slopes the same.
      const first = (packed & 1) === 0 ? from : to;
      const far = (packed & 1) === 0 ? to : from;
      const low = Math.min(from, to);
      if (this.gabled(w, e, top, first - low, far - low, c)) continue;
      let met = false;
      for (let i = 0; i < 2; i++) {
        const g = i === 0 ? square : triangle;
        if (g < 0 || w.first[g]! < 0) continue;
        const other = w.first[g]! + w.count[g]! - 1;
        const side = this.sideOf(g, e);
        const corners = keyCls(this.faceK0[g]!) === CLS_SQUARE ? 4 : 3;
        // The other face goes round the other way, so its side leaves the corner this one comes to.
        if (side < 0 || w.hi[other]! + this.riseFrom(w.rise[other]!, side) !== hi + to || w.hi[other]! + this.riseFrom(w.rise[other]!, (side + 1) % corners) !== hi + from) continue;
        this.join(c, other);
        met = true;
      }
      open = !met;
    }
    if (open) this.join(c, out);
  }

  /**
   * Finds the air again where pieces have come or gone, doing at most `limit` faces and cells of work. True once `found`
   * is the flood of what stands now; false where it stopped short, to be called again. `found` stays the last finished
   * flood until then, and a piece told in between starts the flood over.
   */
  flood(limit = Infinity): boolean {
    if (!this.stale) return true;
    const w = this.next;
    let work = 0;
    if (this.phase === 0) {
      w.cells = w.doors = 0;
      w.faces = this.faces;
      w.first = grown(w.first, this.faces);
      w.count = grown(w.count, this.faces);
      this.cursor = 0;
      this.phase = 1;
    }
    if (this.phase === 1) {
      for (; this.cursor < w.faces; this.cursor++) {
        if (work++ >= limit) return false;
        this.column(w, this.cursor);
      }
      this.parent = grown(this.parent, w.cells + 1);
      for (let c = 0; c <= w.cells; c++) this.parent[c] = c;
      this.cursor = 0;
      this.phase = 2;
    }
    for (; this.cursor < w.cells; this.cursor++) {
      if (work++ >= limit) return false;
      this.link(w, this.cursor);
    }
    // Rooms are numbered in the order their first cells come.
    const was = this.found;
    this.roomOf = grown(this.roomOf, w.cells + 1);
    this.roomOf.fill(-1, 0, w.cells + 1);
    w.rooms = w.inside = 0;
    this.faceMark = grown(this.faceMark, this.faces);
    this.vertexMark = grown(this.vertexMark, this.vertices);
    const flood = ++this.floods;
    let same = was.cells === w.cells;
    let moved = false;
    for (let c = 0; c < w.cells; c++) {
      const root = this.root(c);
      if (root === w.cells) w.room[c] = -1;
      else {
        if (this.roomOf[root] === -1) this.roomOf[root] = w.rooms++;
        w.room[c] = this.roomOf[root]!;
        w.inside++;
      }
      same = same && was.face[c] === w.face[c] && was.lo[c] === w.lo[c] && was.hi[c] === w.hi[c];
      if (!same || was.room[c]! < 0 === w.room[c]! < 0) continue;
      moved = true;
      const f = w.face[c]!;
      this.faceMark[f] = flood;
      for (let k = 0; k < 4; k++) if (this.faceVertex[f * 4 + k]! >= 0) this.vertexMark[this.faceVertex[f * 4 + k]!] = flood;
    }
    this.rebuilt = !same;
    this.changed = !same || moved;
    this.found = w;
    this.next = was;
    while (this.askedMask + 1 < 16 * this.vertices) this.askedMask = this.askedMask * 2 + 1;
    if (this.asked.length < 3 * (this.askedMask + 1)) this.asked = new Int32Array(3 * (this.askedMask + 1));
    else this.asked.fill(0);
    this.phase = 0;
    this.stale = false;
    return true;
  }

  /** The index of the face, the edge or the vertex a key names, or -1 where no piece has named it. */
  elementAt(k0: number, k1: number): number {
    return this.ids.at(1, k0, key1(keyM3(k1), 0, keyCls(k0) === CLS_VERTEX ? 0 : keyDir(k1), 0, 0, 0));
  }

  /** The corners of face `g` as tuples, to `out`. Returns how many. */
  faceCorners(g: number, out: Tuples): number {
    keyAnchor(this.faceK0[g]!, this.faceK1[g]!, out, 0);
    return elementCorners(keyCls(this.faceK0[g]!), out, 0, keyDir(this.faceK1[g]!), out, 0);
  }

  /** Over face `g`, the levels from `lo` up to `hi`: 1 where room air fills them all, 0 where the face has no air cell at any, -1 otherwise. */
  filled(g: number, lo: number, hi: number): number {
    const w = this.found;
    if (g < 0 || g >= w.faces || w.first[g]! < 0) return 0;
    const first = w.first[g]!;
    const end = first + w.count[g]!;
    if (hi <= w.lo[first]! || lo >= w.hi[end - 1]!) return 0;
    if (lo < w.lo[first]! || hi > w.hi[end - 1]!) return -1;
    // Storeys are mostly one height, so the cell a level is in is guessed, then walked to.
    let c = Math.min(end - 1, first + Math.floor((lo - w.lo[first]!) / (w.hi[first]! - w.lo[first]!)));
    while (w.lo[c]! > lo) c--;
    while (w.hi[c]! <= lo) c++;
    for (; c < end && w.lo[c]! < hi; c++) if (w.room[c]! < 0) return -1;
    return 1;
  }

  /** Whether room air fills the levels from `lo` up to `hi` on one side of edge `e`: its left, or with `right` 1 its right. */
  sideFilled(e: number, right: number, lo: number, hi: number): boolean {
    const a = this.filled(this.edgeFace[e * 4 + right]!, lo, hi);
    const b = this.filled(this.edgeFace[e * 4 + 2 + right]!, lo, hi);
    return a >= 0 && b >= 0 && a + b > 0;
  }

  /** Whether room air fills the levels from `lo` up to `hi` all the way round vertex `v`. */
  roundFilled(v: number, lo: number, hi: number): boolean {
    if (v < 0) return false;
    // Each wall that ends at a vertex asks the same of it, so the last answers are kept until the next flood.
    const levels = ((lo & 0xffff) << 16) | (hi & 0xffff);
    const at = ((Math.imul(v, 0x9e3779b1) ^ Math.imul(levels, 0x85ebca6b)) >>> 8) & this.askedMask;
    const asked = this.asked;
    if (asked[at * 3] === v + 1 && asked[at * 3 + 1] === levels) return asked[at * 3 + 2] === 1;
    let turn = 0;
    for (let n = this.vertexHead[v]!; n >= 0 && turn >= 0; n = this.nodeNext[n]!) {
      const filled = this.filled(this.nodeRef[n]!, lo, hi);
      turn = filled < 0 ? -1 : filled > 0 ? turn | this.nodeBits[n]! : turn;
    }
    asked[at * 3] = v + 1;
    asked[at * 3 + 1] = levels;
    asked[at * 3 + 2] = turn === FULL_TURN ? 1 : 0;
    return turn === FULL_TURN;
  }

  /** Whether room air fills the levels from `lo` up to `hi` on both sides of edge `e`, and with `ends` all round both its ends. */
  edgeFilled(e: number, lo: number, hi: number, ends = false): boolean {
    if (e < 0 || e >= this.edges || !this.sideFilled(e, 0, lo, hi) || !this.sideFilled(e, 1, lo, hi)) return false;
    return !ends || (this.roundFilled(this.edgeVertex[e * 2]!, lo, hi) && this.roundFilled(this.edgeVertex[e * 2 + 1]!, lo, hi));
  }

  /** After a flood that kept its cells: whether air over face `g` changed sides. */
  faceMoved(g: number): boolean {
    return this.faceMark[g] === this.floods;
  }

  /** After a flood that kept its cells: whether air beside edge `e`, or round either of its ends, changed sides. */
  edgeMoved(e: number): boolean {
    for (let i = 0; i < 4; i++) if (this.edgeFace[e * 4 + i]! >= 0 && this.faceMark[this.edgeFace[e * 4 + i]!] === this.floods) return true;
    for (let k = 0; k < 2; k++) if (this.edgeVertex[e * 2 + k]! >= 0 && this.vertexMark[this.edgeVertex[e * 2 + k]!] === this.floods) return true;
    return false;
  }

  /** Whether room air fills the levels from `lo` up to `hi` all round every corner of face `g`. */
  cornersFilled(g: number, lo: number, hi: number): boolean {
    if (g < 0 || g >= this.faces) return false;
    for (let k = 0; k < (keyCls(this.faceK0[g]!) === CLS_SQUARE ? 4 : 3); k++) if (!this.roundFilled(this.faceVertex[g * 4 + k]!, lo, hi)) return false;
    return true;
  }

  /** The cell of the air at a face's key and level, or -1. Under a roof, the levels up to its top are its cell's. */
  cellAt(k0: number, k1: number): number {
    const w = this.found;
    const g = this.elementAt(k0, k1);
    const cls = keyCls(k0);
    if (g < 0 || g >= w.faces || w.first[g]! < 0 || (cls !== CLS_SQUARE && cls !== CLS_TRIANGLE)) return -1;
    const lvl = keyLvl(k1);
    const top = w.first[g]! + w.count[g]! - 1;
    for (let c = w.first[g]!; c <= top; c++) if (lvl >= w.lo[c]! && lvl < w.hi[c]!) return c;
    let high = 0;
    for (let k = 0; k < 4; k++) high = Math.max(high, this.riseFrom(w.rise[top]!, k));
    return lvl >= w.hi[top]! && lvl < w.hi[top]! + high ? top : -1;
  }

  /** The room of the air at a face's key and level, or -1 for outside air. */
  roomAt(k0: number, k1: number): number {
    const c = this.cellAt(k0, k1);
    return c < 0 ? -1 : this.found.room[c]!;
  }

  /** Whether the air at a face's key and level is in a room. */
  indoorsAt(k0: number, k1: number): boolean {
    return this.roomAt(k0, k1) >= 0;
  }

  /**
   * Whether a piece of `kind` at this key has outside air on it, and so is seen from outside: a slab with none of a room
   * over it or under it, an edge's piece with none on a side at a level of its own, stairs not in a room, a post not in
   * one all round. A piece this does not judge has: a footing, a quarter slab, a sloped wall.
   */
  borders(kind: number, k0: number, k1: number): boolean {
    const f = this.forms.def[kind];
    if (!f) return true;
    const lvl = keyLvl(k1);
    const cls = keyCls(k0);
    if (cls === CLS_VERTEX) return f.layer !== "post" || !this.roundFilled(this.elementAt(k0, k1), lvl, lvl + f.span);
    if (cls === CLS_EDGE) {
      if (f.layer === "footing" || (this.whatOf(kind) === W_WALL && (this.bits[kind]! & SLOPED) !== 0) || !formCells(this.forms, kind, k0, k1, cells)) return true;
      for (let i = 0; i < cells.n; i++) if (!this.edgeFilled(this.elementAt(cells.k0[i]!, cells.k1[i]!), keyLvl(cells.k1[i]!), keyLvl(cells.k1[i]!) + cells.reach[i]!)) return true;
      return false;
    }
    if ((f.size ?? 2) !== SIDE && cls === CLS_SQUARE) return true;
    const g = this.elementAt(k0, k1);
    return f.span > 0 ? this.filled(g, lvl, lvl + f.span) !== 1 : this.filled(g, lvl, lvl + 1) !== 1 || this.filled(g, lvl - 1, lvl) !== 1;
  }

  /** The rooms of the last flood, each with its doorways and hatches. */
  rooms(): Room[] {
    const w = this.found;
    const out: Room[] = Array.from({ length: w.rooms }, () => ({ cells: 0, doors: [] }));
    for (let c = 0; c < w.cells; c++) if (w.room[c]! >= 0) out[w.room[c]!]!.cells++;
    for (let d = 0; d < w.doors; d++) {
      const room = w.room[w.doorCell[d]!]!;
      if (room >= 0 && !out[room]!.doors.some((o) => o.ref === w.doorRef[d])) out[room]!.doors.push({ ref: w.doorRef[d]!, leaf: w.doorLeaf[d]!, shut: w.doorShut[d] === 1 });
    }
    return out;
  }
}

/** What `enclose` reads of a structure store. */
export interface EnclosedRows {
  readonly chunks: readonly ({ readonly kind: Uint16Array; readonly k0: Uint32Array | null; readonly k1: Uint32Array | null } | null)[];
  rowsOf(fr: number, out: { refs: Uint32Array }): number;
}

const rows = { refs: new Uint32Array(0) };

/** Tells `into` every row of frame `fr` of a store, by its ref, in place of what it held. It is then to be flooded. */
export function enclose(store: EnclosedRows, fr: number, into: Enclosure): void {
  into.clear();
  const n = store.rowsOf(fr, rows);
  for (let i = 0; i < n; i++) {
    const ref = rows.refs[i]!;
    const t = store.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    into.add(t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, ref);
  }
}

/** Whether the air at a face's key and level in frame `fr` is in a room, by that frame's flood in `floods`. A frame with none is outdoors. */
export function indoorsAt(floods: ReadonlyMap<number, Enclosure>, fr: number, k0: number, k1: number): boolean {
  return floods.get(fr)?.indoorsAt(k0, k1) ?? false;
}
