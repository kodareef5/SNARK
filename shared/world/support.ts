// Support is never stored. Whether a piece stands, and how firmly, is worked out from the rows: by the server to judge and by
// the client to show the same judgement before asking. Nodes are cached until forget(), so the questions of one collapse share them.
//
// A piece with a key is judged by its base's lattice. Its stability is its material's most, less the cheapest way to it
// from a piece that stands by itself, and it stands while that is at least what its form needs. A link costs:
//
//   0  straight up: a wall on a wall, a post on a post, either on a slab that carries (a foundation), a slab over a post
//      at its middle; stairs on any slab; a door in its doorway
//   1  a wall, or a post at the middle of a side, to a slab on its top plane; a wall or a post on a slab that does not
//      carry (a ceiling); a wall or a post hung under a slab, which then holds nothing itself
//   2  a slab to the slab across a shared side; a post at a corner to a slab on its top plane
//
// and one more wherever the lower piece is upright and does not carry (a railing). Every link is read from the cells the
// piece's form relates to, by its class, layer, span and cells: a new form needs no rule here.
//
// A piece with no key (a thing, a piece the adoption shim left free) is judged the old way, by sockets and metres.
// That half of this file is marked and goes with the shim.

import { STRUCT_UNITS, chunkAt } from "../coords.ts";
import { KEY_FOUND, keyOfPose } from "./lattice/adopt.ts";
import { FORM_LAYERS, HALF_SIDE_M, STOREY_LEVELS, type FormTable } from "./lattice/forms.ts";
import { poseOf, type Frame, type LatticeKey, type LatticePose } from "./lattice/frames.ts";
import { CLS_CORNERS, CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, LVL_MOST, M_MOST, SIDE, canon, canonical, cellOf, dirTurn, key0, key1, keyAnchor, keyCls, keyDir, keyLvl, tupleStep, tupleWithin } from "./lattice/module.ts";
import { Cells, cellAt, edgeFaces, elementVertices, faceEdges, formCells, vertexEdges, vertexFaces } from "./lattice/occupancy.ts";
import { ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_THING, ROLE_WALL, floorTop, frameAxes, makeSockets, overPiece, socketsFor, units, type PieceTables } from "./snap.ts";
import { Found, type StructureStore } from "./structures.ts";

/** The stability of a piece that stands by itself, for a material that says no other. */
export const STABILITY = 4;
/** What a link takes off: across a shared side, from a side's wall or post, from a corner's post, hung, and on a piece that does not carry. */
const COST_BESIDE = 2;
const COST_SIDE = 1;
const COST_CORNER = 2;
const COST_HUNG = 1;
const COST_LOOSE = 1;
/** Added to a cost in a node's list: the piece hangs from that one, and so holds nothing by it. */
const HUNG = 16;
/** The most pieces wouldFall lists. */
export const FALL_MOST = 256;
/** Metres on the flat a link moves support for each unit it costs, at most: a slab to the next is two for a side of 3 m. */
const METRES_A_COST = (SIDE * HALF_SIDE_M) / COST_BESIDE;

/** Horizontal metres a ceiling with no key may be from a piece that stands straight up. LOAD_REACH is the same for any other piece held sideways. */
export const CEILING_REACH = 6.5;
export const LOAD_REACH = 5;
/** Lattice units. A pillar whose foot is at most this far above the ground stands on the ground. */
const FOOT = STRUCT_UNITS / 4;
/** Metres. A joined piece is at most two half-sides away, plus a little. */
const NEAR = 3.1;
/** Metres a neighbour's box may fall short of a piece's height band by lattice rounding and still be looked at. */
const BAND = 0.05;
/** Work units to build one node, and each cell read for it costs a quarter more. A search step costs 1. 16,000 are about a millisecond. */
export const COST_NODE = 6;
/** Work units for a piece found not to stand: what removing it and telling of it will cost the tick. */
const COST_FALL = 24;

const SLAB = FORM_LAYERS.indexOf("slab");
const FILL = FORM_LAYERS.indexOf("fill");
const WALL = FORM_LAYERS.indexOf("wall");
const LEAF = FORM_LAYERS.indexOf("leaf");
const POST = FORM_LAYERS.indexOf("post");
const FOOTING = FORM_LAYERS.indexOf("footing");

const sockets = makeSockets();
const axes = new Int32Array(4);
const own = new Cells();
const sides = new Cells();
const faces = new Cells();
const verts = new Cells();
const mids = new Cells();
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
const NONE: number[] = [];
const m = new Int32Array(8);

/** Adds the square named from the tuple at `m[0]` along `d`, at `lvl` in the slab layer, to `out`. A cell off the lattice has a first word of 0. */
function square(out: Cells, d: number, lvl: number): void {
  canonical(CLS_SQUARE, m, 0, d, m, 4);
  const n = out.n++;
  const on = tupleWithin(m, 4, M_MOST);
  out.k0[n] = on ? key0(CLS_SQUARE, m[4]!, m[5]!, m[6]!) : 0;
  out.k1[n] = on ? key1(m[7]!, lvl, canon.dir, SLAB, 0, 0) : 0;
}

/** The square to each side of the edge a key names, to `out`: occupancy's edgeFaces without its triangles. */
function edgeSquares(k0: number, k1: number, lvl: number, out: Cells): void {
  const d = keyDir(k1);
  keyAnchor(k0, k1, m, 0);
  out.n = 0;
  square(out, d, lvl);
  square(out, dirTurn(d, -3), lvl);
}

/** The squares across the four sides of the square a key names, to `out`: each is the same square a side further on. */
function squaresAcross(k0: number, k1: number, lvl: number, out: Cells): void {
  const d = keyDir(k1);
  out.n = 4;
  for (let s = 0; s < 4; s++) {
    keyAnchor(k0, k1, m, 0);
    tupleStep(m, 0, dirTurn(d, s * 3 - 3), SIDE, m, 0);
    const on = tupleWithin(m, 0, M_MOST);
    out.k0[s] = on ? key0(CLS_SQUARE, m[0]!, m[1]!, m[2]!) : 0;
    out.k1[s] = on ? key1(m[3]!, lvl, d, SLAB, 0, 0) : 0;
  }
}

/** The vertex at the middle of the edge a key names, at `lvl` in the post layer, to `out[at]`. */
function edgeMiddle(k0: number, k1: number, lvl: number, out: Cells, at: number): void {
  keyAnchor(k0, k1, m, 0);
  tupleStep(m, 0, keyDir(k1), SIDE / 2, m, 0);
  const on = tupleWithin(m, 0, M_MOST);
  out.k0[at] = on ? key0(CLS_VERTEX, m[0]!, m[1]!, m[2]!) : 0;
  out.k1[at] = on ? key1(m[3]!, lvl, 0, POST, 0, 0) : 0;
}

/** What support reads of the content: the pieces' tables and each kind's most stability, 4 where none is given. */
export interface SupportTables extends PieceTables {
  readonly stabilityCap?: Uint8Array;
}

/** A cached description of one piece: its place, and what holds it. */
export class SupportNode {
  /** -1 for a piece not yet built. */
  readonly ref: number;
  readonly kind: number;
  readonly role: number;
  /** Lattice units. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Stands by itself: a foundation, a pillar with its foot in the ground, or a thing on the ground. */
  readonly root: boolean;
  /** Its frame and key, or a frame of 0 for a piece with none. */
  readonly fr: number;
  readonly k0: number;
  readonly k1: number;
  /** A keyed piece: the refs of the pieces it stands on or beside, and what each link costs. */
  readonly sup: number[];
  readonly cost: number[];
  /** A keyed piece: the slabs it hangs from, read when it is first asked about. */
  hosts: number[] | null = null;
  /** A piece with no key: the links it stands directly on. For a door, its frame. */
  readonly under: number[];
  /** With no key, whether it stands straight up: 0 not asked, 1 yes, 2 no. Valid only for the round in `round`. */
  straight = 0;
  round = 0;
  /** Id of the search that last visited it, and its cost from the piece asked about in that search. */
  seen = 0;
  d = 0;
  via: SupportNode | null = null;
  hung = false;
  /** In the round in `round`: its cost from a piece that stands by itself is at least this, or exactly this. */
  lo = 0;
  exact = false;
  /** Scratch for the Collapse that uses these nodes. */
  mark = 0;
  private joined: number[] | null;
  private held: number[] | null;
  private readonly by: Support;

  constructor(by: Support, ref: number, kind: number, role: number, x: number, y: number, z: number, root: boolean, fr: number, k0: number, k1: number, sup: number[], cost: number[], under: number[], links: number[] | null, over: number[] | null) {
    this.by = by;
    this.ref = ref;
    this.kind = kind;
    this.role = role;
    this.x = x;
    this.y = y;
    this.z = z;
    this.root = root;
    this.fr = fr;
    this.k0 = k0;
    this.k1 = k1;
    this.sup = sup;
    this.cost = cost;
    this.under = under;
    this.joined = links;
    this.held = over;
  }

  /** Refs of the pieces joined to it: those that hold it and those it holds. A keyed piece's are read when first asked for. */
  get links(): number[] {
    if (this.joined === null) this.join();
    return this.joined!;
  }

  /** The links it holds straight up, at no cost: what loses its footing with it however high. */
  get over(): number[] {
    if (this.held === null) this.join();
    return this.held!;
  }

  private join(): void {
    this.joined = [];
    this.held = [];
    this.by.joins(this, this.joined, this.held);
  }
}

export class Support {
  /** Work done since the caller last zeroed it. See COST_NODE. */
  work = 0;
  /** Pieces the last question visited. */
  visited = 0;
  /**
   * Past this much work standsNode gives a question up instead of building another node, and sets `cut`. A cut question has no
   * answer. Asked again it gets further, because the nodes are kept and each ask builds at least one more.
   */
  limit = Infinity;
  cut = false;
  private asking = false;
  private made = 0;
  private readonly structs: StructureStore;
  private readonly tables: SupportTables;
  private readonly forms: FormTable | null;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly nodes = new Map<number, SupportNode>();
  private readonly near = new Found();
  private readonly queue: SupportNode[] = [];
  private round = 1;
  private search = 0;
  /** Per kind: what a link from it adds where it is the lower piece, the stability it must keep, 1 if it stands anywhere and 2 if on the ground, and its most stability. */
  private readonly loose: Uint8Array;
  private readonly need: Uint8Array;
  private readonly rooted: Uint8Array;
  private readonly cap: Uint8Array;
  private readonly capMost: number;
  /** Per kind: 1 if its form is one cell, of one edge and at most a storey. */
  private readonly single: Uint8Array;
  /** Whether no form fills a triangle, so the only slab across a square's side is a square. Reading triangles too gives the same answers. */
  plain = true;
  /** Whether some form is a footing. */
  private footed = false;
  /** Metres on the flat within which a lost piece may have been holding another. */
  private readonly far: number;
  /** The search's pieces still to read, by their cost: each one's ref, the piece it was met from, and whether it hangs from that. */
  private readonly refs: number[][] = [];
  private readonly vias: SupportNode[][] = [];
  private readonly hungs: boolean[][] = [];
  /** The pieces the search has read. */
  private readonly met: SupportNode[] = [];
  /** The links of the piece being described. */
  private readonly sRef: number[] = [];
  private readonly sCost: number[] = [];
  private reads = 0;
  /** Pieces counted as gone while wouldFall runs. */
  private readonly absent = new Set<number>();
  private readonly tried: Frame[] = [];
  private readonly rows = new Found();

  constructor(structs: StructureStore, tables: SupportTables, heightAt: (x: number, z: number) => number) {
    this.structs = structs;
    this.tables = tables;
    this.heightAt = heightAt;
    const forms = (this.forms = structs.forms);
    const n = tables.role.length;
    this.loose = new Uint8Array(n);
    this.need = new Uint8Array(n);
    this.rooted = new Uint8Array(n);
    this.cap = new Uint8Array(n).fill(STABILITY);
    this.single = new Uint8Array(n);
    let most = STABILITY;
    // Metres a piece of some form may reach past what its class does: a triangle from its corner, a wall along its further sides.
    let slack = 0;
    for (let k = 0; forms && k < n && k < forms.cls.length; k++) {
      const f = forms.def[k];
      if (!f) continue;
      this.loose[k] = f.carries ? 0 : COST_LOOSE;
      this.need[k] = f.need ?? 0;
      this.rooted[k] = f.root === "always" ? 1 : f.root === "grounded" ? 2 : 0;
      this.cap[k] = tables.stabilityCap?.[k] || STABILITY;
      this.single[k] = f.cells === undefined && f.span <= STOREY_LEVELS ? 1 : 0;
      if (f.cls === "triangle") this.plain = false;
      if (f.layer === "footing") this.footed = true;
      most = Math.max(most, this.cap[k]!);
      let along = Math.abs(forms.atI[k]!);
      for (const c of f.cells ?? []) along = Math.max(along, Math.abs(c[0] * SIDE - forms.atI[k]!));
      slack = Math.max(slack, (Math.max(along, Math.abs(forms.atJ[k]!)) + (forms.cls[k] === CLS_TRIANGLE ? 1 : 0)) * HALF_SIDE_M);
    }
    this.capMost = most;
    for (let d = 0; d <= most; d++) {
      this.refs.push([]);
      this.vias.push([]);
      this.hungs.push([]);
    }
    // Links that cost nothing are followed by `over`. The rest move support METRES_A_COST for each unit, and each piece on the way its slack twice.
    this.far = Math.max(CEILING_REACH, most * METRES_A_COST + (most + 1) * 2 * slack) + 0.1;
  }

  /** Drops every cached node. Call when the world may have changed. */
  forget(): void {
    this.nodes.clear();
    this.frees.clear();
  }

  /** Invalidates what the nodes remember of their standing after a piece is removed. The nodes are kept. */
  again(): void {
    this.round++;
  }

  /** Whether the piece a node was made of is still there with the same kind and position. */
  alive(n: SupportNode): boolean {
    const t = this.structs.chunks[Math.floor(n.ref / 65536)];
    const slot = n.ref & 0xffff;
    return !!t && slot < t.high && t.kind[slot] === n.kind && units(t.x[slot]!) === n.x && units(t.y[slot]!) === n.y && units(t.z[slot]!) === n.z;
  }

  /** The node of the piece at `ref`, built on first use. Null if nothing is built there, it is not a building piece, or the question was cut. */
  node(ref: number): SupportNode | null {
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || !t.fr || t.fr[slot] === 0 || !this.forms) return this.free(ref);
    const known = this.nodes.get(ref);
    if (known && this.alive(known)) return this.absent.size > 0 && this.absent.has(ref) ? null : known;
    // A piece that is gone has no node. One that changed in place since it was described (a door that was opened) is
    // described again, or it would count as gone and never be judged.
    if (slot >= t.high || t.kind[slot] === 0 || this.tables.role[t.kind[slot]!]! < 0 || (this.absent.size > 0 && this.absent.has(ref))) return null;
    // The budget ran out mid-question. Give up before paying for another node.
    if (this.asking && this.made > 0 && this.work > this.limit) {
      this.cut = true;
      return null;
    }
    this.made++;
    const n = this.describe(t.kind[slot]!, t.fr[slot]!, t.k0![slot]!, t.k1![slot]!, ref);
    this.nodes.set(ref, n);
    return n;
  }

  /**
   * Builds the node of a piece of `kind` at a key of frame `fr`: the pieces that hold it, read from the cells its form
   * relates to. `self` is its ref, or -1 for a piece not yet built.
   */
  describe(kind: number, fr: number, k0: number, k1: number, self = -1): SupportNode {
    const { structs, tables } = this;
    let x: number;
    let y: number;
    let z: number;
    const t = self >= 0 ? structs.chunks[Math.floor(self / 65536)] : undefined;
    if (t) {
      x = units(t.x[self & 0xffff]!);
      y = units(t.y[self & 0xffff]!);
      z = units(t.z[self & 0xffff]!);
    } else {
      poseOf(structs.frames.get(fr)!, k0, k1, this.forms!, kind, pose);
      ({ x, y, z } = pose);
    }
    const root = this.rootAt(kind, x, y, z);
    this.sRef.length = this.sCost.length = this.reads = 0;
    // What holds a piece that stands by itself is not asked.
    if (!root) this.under(kind, fr, k0, k1, self, false);
    this.work += COST_NODE + (this.reads >> 2);
    return new SupportNode(this, self, kind, tables.role[kind]!, x, y, z, root, fr, k0, k1, this.sRef.slice(), this.sCost.slice(), NONE, null, null);
  }

  /** Whether a piece of `kind` at (x, y, z) lattice units stands by itself: its form says always, or on the ground and its foot is in it. */
  private rootAt(kind: number, x: number, y: number, z: number): boolean {
    const rooted = this.rooted[kind]!;
    if (rooted !== 2) return rooted === 1;
    return y - units(this.tables.halfY[kind]!) <= Math.ceil(this.heightAt(x / STRUCT_UNITS, z / STRUCT_UNITS) * STRUCT_UNITS) + FOOT;
  }

  /** Notes a link of the piece being described. A piece met twice keeps its cheaper link. */
  private put(ref: number, cost: number): void {
    const at = this.sRef.indexOf(ref);
    if (at < 0) {
      this.sRef.push(ref);
      this.sCost.push(cost);
    } else if (cost < this.sCost[at]!) this.sCost[at] = cost;
  }

  private kindOf(ref: number): number {
    return this.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  }

  private lvlOf(ref: number): number {
    return keyLvl(this.structs.chunks[Math.floor(ref / 65536)]!.k1![ref & 0xffff]!);
  }

  /** The piece entered in exactly a cell, or -1: `self` and a cell off the lattice give -1. */
  private at(fr: number, k0: number, k1: number, self: number): number {
    if (k0 === 0) return -1;
    this.reads++;
    const ref = this.structs.occupied.at(fr, k0, k1);
    return ref === self ? -1 : ref;
  }

  /** The piece that covers a cell's level from that level or under it, or -1. */
  private covering(fr: number, k0: number, k1: number, self: number): number {
    if (k0 === 0) return -1;
    this.reads += 4;
    const ref = this.structs.occupied.covering(fr, k0, k1);
    return ref === self ? -1 : ref;
  }

  /** The upright piece under level `lvl` in a cell of level `lvl - 1`, if a storey of it ends at `lvl`, or -1. */
  private ending(fr: number, k0: number, k1: number, lvl: number, self: number): number {
    const ref = this.covering(fr, k0, k1, self);
    if (ref < 0) return -1;
    const up = lvl - this.lvlOf(ref);
    const span = this.forms!.span[this.kindOf(ref)]!;
    return up === span || (up < span && up % STOREY_LEVELS === 0) ? ref : -1;
  }

  /** The upright piece that stands from level `lvl` in a cell of that level, or -1. */
  private starting(fr: number, k0: number, k1: number, lvl: number, self: number): number {
    const ref = this.covering(fr, k0, k1, self);
    return ref >= 0 && this.lvlOf(ref) === lvl ? ref : -1;
  }

  /** The cells a piece of `kind` covers at a key, to `own`, as formCells gives them. False if one is off the lattice. */
  private cells(kind: number, k0: number, k1: number): boolean {
    if (this.single[kind] === 0) return formCells(this.forms!, kind, k0, k1, own);
    own.n = 1;
    own.k0[0] = k0;
    own.k1[0] = cellOf(k1);
    own.reach[0] = Math.max(1, this.forms!.span[kind]!);
    return keyLvl(k1) + own.reach[0] - 1 <= LVL_MOST;
  }

  /** Notes each slab at `lvl` beside the edge of a cell, at `cost`, or at what it adds as the lower piece where `cost` is -1. */
  private beside(fr: number, k0: number, k1: number, lvl: number, cost: number, self: number): void {
    if (this.plain) edgeSquares(k0, k1, lvl, faces);
    else edgeFaces(k0, k1, lvl, SLAB, faces);
    for (let f = 0; f < faces.n; f++) {
      const ref = this.at(fr, faces.k0[f]!, faces.k1[f]!, self);
      if (ref >= 0) this.put(ref, cost < 0 ? this.loose[this.kindOf(ref)]! : cost);
    }
  }

  /**
   * Notes each slab at `lvl` round the vertex of a key: those it is a corner of at `corner`, the middle of at `middle`,
   * and the middle of a side of at `side`, each plus `more`. A cost of -1 is what the slab adds as the lower piece.
   */
  private around(fr: number, k0: number, k1: number, lvl: number, corner: number, middle: number, side: number, more: number, self: number): void {
    vertexFaces(k0, k1, lvl, SLAB, faces);
    for (let f = 0; f < faces.n; f++) {
      if (this.plain && f >= 12 && f < 24) continue;
      const ref = this.at(fr, faces.k0[f]!, faces.k1[f]!, self);
      const cost = f < 24 ? corner : middle;
      if (ref >= 0) this.put(ref, cost < 0 ? this.loose[this.kindOf(ref)]! : cost + more);
    }
    vertexEdges(k0, k1, lvl, SLAB, mids);
    for (let e = 12; e < mids.n; e++) if (mids.k0[e] !== 0) this.beside(fr, mids.k0[e]!, mids.k1[e]!, lvl, side < 0 ? -1 : side + more, self);
  }

  /** Notes each slab across a side of the slab a key names, square or triangle. */
  private across(fr: number, k0: number, k1: number, lvl: number, self: number): void {
    if (this.plain && keyCls(k0) === CLS_SQUARE) {
      squaresAcross(k0, k1, lvl, faces);
      for (let f = 0; f < 4; f++) {
        const ref = this.at(fr, faces.k0[f]!, faces.k1[f]!, self);
        if (ref >= 0) this.put(ref, COST_BESIDE);
      }
      return;
    }
    const mine = cellOf(cellAt(k1, lvl, SLAB));
    faceEdges(k0, k1, lvl, SLAB, sides);
    for (let s = 0; s < sides.n; s++) {
      if (sides.k0[s] === 0) continue;
      edgeFaces(sides.k0[s]!, sides.k1[s]!, lvl, SLAB, faces);
      for (let f = 0; f < faces.n; f++) {
        if (faces.k0[f] === k0 && faces.k1[f] === mine) continue;
        const ref = this.at(fr, faces.k0[f]!, faces.k1[f]!, self);
        if (ref >= 0) this.put(ref, COST_BESIDE);
      }
    }
  }

  /**
   * Adds to the scratch lists the pieces a piece of `kind` at a key stands on or beside, and each link's cost. `flat`
   * leaves out the walls and posts under a slab, for a caller that reads them from the walls and posts (`tops`).
   */
  private under(kind: number, fr: number, k0: number, k1: number, self: number, flat: boolean): void {
    const forms = this.forms!;
    const layer = forms.layer[kind]!;
    const lvl = keyLvl(k1);
    const loose = this.loose;
    const low = lvl > -LVL_MOST;
    if (layer === SLAB) {
      this.across(fr, k0, k1, lvl, self);
      if (!low || flat) return;
      faceEdges(k0, k1, lvl - 1, WALL, sides);
      for (let s = 0; s < sides.n; s++) {
        const e0 = sides.k0[s]!;
        const e1 = sides.k1[s]!;
        if (e0 === 0) continue;
        // The wall under this side, and the post under its middle.
        const wall = this.ending(fr, e0, e1, lvl, self);
        if (wall >= 0) this.put(wall, COST_SIDE + loose[this.kindOf(wall)]!);
        edgeMiddle(e0, e1, lvl - 1, mids, 0);
        const post = this.ending(fr, mids.k0[0]!, mids.k1[0]!, lvl, self);
        if (post >= 0) this.put(post, COST_SIDE + loose[this.kindOf(post)]!);
      }
      // The posts under its corners, and under its middle if it has one.
      elementVertices(k0, k1, lvl - 1, POST, verts);
      const corners = CLS_CORNERS[keyCls(k0)]!;
      for (let v = 0; v < verts.n; v++) {
        const post = this.ending(fr, verts.k0[v]!, verts.k1[v]!, lvl, self);
        if (post >= 0) this.put(post, (v < corners ? COST_CORNER : 0) + loose[this.kindOf(post)]!);
      }
    } else if (layer === WALL) {
      if (!this.cells(kind, k0, k1)) return;
      for (let c = 0; c < own.n; c++) {
        const c0 = own.k0[c]!;
        const c1 = own.k1[c]!;
        if (keyLvl(c1) !== lvl) continue;
        // What it stands on: a wall or a footing under it, or a slab's side.
        const under = low ? this.ending(fr, c0, cellAt(c1, lvl - 1, WALL), lvl, self) : -1;
        if (under >= 0) this.put(under, loose[this.kindOf(under)]!);
        const footing = this.footed ? this.at(fr, c0, cellAt(c1, lvl, FOOTING), self) : -1;
        if (footing >= 0) this.put(footing, loose[this.kindOf(footing)]!);
        this.beside(fr, c0, c1, lvl, -1, self);
      }
    } else if (layer === POST) {
      const under = low ? this.ending(fr, k0, cellAt(k1, lvl - 1, POST), lvl, self) : -1;
      if (under >= 0) this.put(under, loose[this.kindOf(under)]!);
      this.around(fr, k0, k1, lvl, -1, -1, -1, 0, self);
    } else if (layer === FILL) {
      // Stairs stand on the slab of their face, at no cost.
      const slab = this.at(fr, k0, cellAt(k1, lvl, SLAB), self);
      if (slab >= 0) this.put(slab, 0);
    } else if (layer === LEAF) {
      // A leaf stands in its host: the wall of its edge, or the slab of its face.
      if (!this.cells(kind, k0, k1)) return;
      const edge = keyCls(k0) === CLS_EDGE;
      for (let c = 0; c < own.n; c++) {
        const host = edge ? this.covering(fr, own.k0[c]!, cellAt(own.k1[c]!, keyLvl(own.k1[c]!), WALL), self) : this.at(fr, own.k0[c]!, cellAt(own.k1[c]!, lvl, SLAB), self);
        if (host >= 0) this.put(host, 0);
      }
    }
  }

  /**
   * Adds to the scratch lists the slabs on the planes a wall's or a post's storeys end at, and what each link costs the
   * slab. Those slabs hold it in turn where it hangs, at COST_HUNG.
   */
  private tops(kind: number, fr: number, k0: number, k1: number, self: number): void {
    const forms = this.forms!;
    const layer = forms.layer[kind]!;
    const mine = this.loose[kind]!;
    if (layer === WALL) {
      if (!this.cells(kind, k0, k1)) return;
      for (let c = 0; c < own.n; c++) {
        const end = keyLvl(own.k1[c]!) + own.reach[c]!;
        if (end <= LVL_MOST) this.beside(fr, own.k0[c]!, own.k1[c]!, end, COST_SIDE + mine, self);
      }
    } else if (layer === POST) {
      const top = keyLvl(k1) + forms.span[kind]!;
      if (top <= LVL_MOST) this.around(fr, k0, k1, top, COST_CORNER, 0, COST_SIDE, mine, self);
    }
  }

  /** Adds to the scratch lists the pieces a piece of `kind` at a key holds, and each link's cost: `under` and `tops`, from the other end. */
  private holds(kind: number, fr: number, k0: number, k1: number, self: number): void {
    const forms = this.forms!;
    const layer = forms.layer[kind]!;
    const lvl = keyLvl(k1);
    const mine = this.loose[kind]!;
    const low = lvl > -LVL_MOST;
    if (layer === SLAB) {
      this.across(fr, k0, k1, lvl, self);
      faceEdges(k0, k1, lvl, WALL, sides);
      for (let s = 0; s < sides.n; s++) {
        const e0 = sides.k0[s]!;
        const e1 = sides.k1[s]!;
        if (e0 === 0) continue;
        const wall = this.starting(fr, e0, e1, lvl, self);
        if (wall >= 0) this.put(wall, mine);
        edgeMiddle(e0, e1, lvl, mids, 0);
        const m0 = mids.k0[0]!;
        const m1 = mids.k1[0]!;
        const post = this.starting(fr, m0, m1, lvl, self);
        if (post >= 0) this.put(post, mine);
        if (!low) continue;
        const hung = this.ending(fr, e0, cellAt(e1, lvl - 1, WALL), lvl, self);
        if (hung >= 0) this.put(hung, COST_HUNG + HUNG);
        const below = this.ending(fr, m0, cellAt(m1, lvl - 1, POST), lvl, self);
        if (below >= 0) this.put(below, COST_HUNG + HUNG);
      }
      elementVertices(k0, k1, lvl, POST, verts);
      for (let v = 0; v < verts.n; v++) {
        const post = this.starting(fr, verts.k0[v]!, verts.k1[v]!, lvl, self);
        if (post >= 0) this.put(post, mine);
        const below = low ? this.ending(fr, verts.k0[v]!, cellAt(verts.k1[v]!, lvl - 1, POST), lvl, self) : -1;
        if (below >= 0) this.put(below, COST_HUNG + HUNG);
      }
      for (const on of [FILL, LEAF]) {
        const ref = this.at(fr, k0, cellAt(k1, lvl, on), self);
        if (ref >= 0) this.put(ref, 0);
      }
    } else if (layer === WALL) {
      this.tops(kind, fr, k0, k1, self);
      if (!this.cells(kind, k0, k1)) return;
      const top = lvl + forms.span[kind]!;
      for (let c = 0; c < own.n; c++) {
        const c0 = own.k0[c]!;
        const c1 = own.k1[c]!;
        const from = keyLvl(c1);
        const leaf = this.at(fr, c0, cellAt(c1, from, LEAF), self);
        if (leaf >= 0) this.put(leaf, 0);
        const on = from + own.reach[c]! === top && top <= LVL_MOST ? this.starting(fr, c0, cellAt(c1, top, WALL), top, self) : -1;
        if (on >= 0) this.put(on, mine);
      }
    } else if (layer === POST) {
      const top = lvl + forms.span[kind]!;
      if (top > LVL_MOST) return;
      this.tops(kind, fr, k0, k1, self);
      const on = this.starting(fr, k0, cellAt(k1, top, POST), top, self);
      if (on >= 0) this.put(on, mine);
    } else if (layer === FOOTING) {
      const on = this.starting(fr, k0, cellAt(k1, lvl, WALL), lvl, self);
      if (on >= 0) this.put(on, mine);
    }
  }

  /** Fills a keyed node's `links` and `over`. A piece that hangs from a slab is no link the slab stands by, so it is in neither's `over`. */
  joins(n: SupportNode, links: number[], over: number[]): void {
    this.sRef.length = this.sCost.length = this.reads = 0;
    this.holds(n.kind, n.fr, n.k0, n.k1, n.ref);
    for (let i = 0; i < this.sRef.length; i++) {
      links.push(this.sRef[i]!);
      if (this.sCost[i] === 0) over.push(this.sRef[i]!);
    }
    // A piece that stands by itself was not asked what it stands on.
    this.sRef.length = this.sCost.length = 0;
    if (n.root) this.under(n.kind, n.fr, n.k0, n.k1, n.ref, false);
    for (const ref of n.root ? this.sRef : n.sup) if (!links.includes(ref)) links.push(ref);
    this.work += this.reads >> 2;
  }

  /** Asked afresh. A built structure that is not a building piece stands, and an empty ref does not. */
  standsRef(ref: number): boolean {
    this.forget();
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    const n = this.node(ref);
    return n === null || this.standsNode(n);
  }

  /**
   * Asked afresh by pose, for a piece already built (pass its ref as `self`) or one about to be. A kind that is not a
   * building piece stands. The pose is given its key in each base it is a free slot of, as the adoption shim would: a
   * pose says no turn of 30 or 60 degrees, so a piece turned so is asked about by its key (stabilityAt).
   */
  stands(kind: number, x: number, y: number, z: number, yaw: number, self = -1): boolean {
    this.visited = 0;
    if (this.tables.role[kind]! < 0) return true;
    this.forget();
    const { structs, forms } = this;
    if (forms && forms.cls[kind]! >= 0) {
      if (self >= 0 && structs.keyAt(self, key)) return this.standsNode(this.describe(kind, key.fr, key.k0, key.k1, self));
      const { chunksX, chunksZ } = structs.dims;
      const chunk = chunkAt(structs.dims, x / STRUCT_UNITS, z / STRUCT_UNITS);
      const cx = chunk % chunksX;
      const cz = (chunk - cx) / chunksX;
      const tried = this.tried;
      tried.length = 0;
      let keyed = false;
      for (let nz = Math.max(0, cz - 1); nz <= Math.min(chunksZ - 1, cz + 1); nz++) {
        for (let nx = Math.max(0, cx - 1); nx <= Math.min(chunksX - 1, cx + 1); nx++) {
          for (const f of structs.frames.listed(nz * chunksX + nx)) {
            if (tried.includes(f)) continue;
            tried.push(f);
            if (keyOfPose(f, forms, kind, x, y, z, yaw, key) !== KEY_FOUND || !structs.fits(kind, f.gid, key.k0, key.k1)) continue;
            poseOf(f, key.k0, key.k1, forms, kind, pose);
            if (pose.x !== x || pose.y !== y || pose.z !== z || pose.yaw !== yaw) continue;
            keyed = true;
            if (this.standsNode(this.describe(kind, f.gid, key.k0, key.k1))) return true;
          }
        }
      }
      if (keyed) return false;
    }
    return this.standsNode(this.describeFree(kind, x, y, z, yaw, self));
  }

  /** Uses the cached nodes as they are. If `cut` is set afterwards, the question was given up (see `limit`). */
  standsNode(n: SupportNode): boolean {
    this.visited = 0;
    this.cut = false;
    this.made = 0;
    this.asking = true;
    const stands = n.fr === 0 ? this.askFree(n) : this.reach(n, this.cap[n.kind]! - this.need[n.kind]!) >= 0;
    this.asking = false;
    if (!stands && !this.cut) this.work += COST_FALL;
    return stands;
  }

  /**
   * The stability of the piece `ref`, asked afresh: its material's most for one that stands by itself, less the cheapest
   * way to it from one. -1 if nothing holds it within that, or nothing is built there. A piece with no key, and a
   * structure that is no building piece, has its most while it stands.
   */
  stability(ref: number): number {
    this.forget();
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return -1;
    const n = this.node(ref);
    return n === null ? STABILITY : this.stabilityNode(n);
  }

  /** The stability a piece of `kind` would have at a key of frame `fr`, not yet built there, as `stability` says it. */
  stabilityAt(kind: number, fr: number, k0: number, k1: number): number {
    if (!this.forms || this.forms.cls[kind]! < 0 || !this.structs.frames.get(fr)) return -1;
    this.forget();
    return this.stabilityNode(this.describe(kind, fr, k0, k1));
  }

  /** Uses the cached nodes as they are, as standsNode does. */
  stabilityNode(n: SupportNode): number {
    const cap = this.cap[n.kind]!;
    if (n.fr === 0) return this.standsNode(n) ? cap : -1;
    this.visited = 0;
    this.cut = false;
    this.made = 0;
    this.asking = true;
    const cost = this.reach(n, cap);
    this.asking = false;
    return cost < 0 ? -1 : cap - cost;
  }

  /**
   * The cheapest way to a keyed piece from one that stands by itself, if it costs at most `bound`, else -1; -2 if the
   * question was cut. Nodes remember what a search proves of them until again(), so the questions of a wave share it.
   */
  private reach(n: SupportNode, bound: number): number {
    if (n.root) return 0;
    const round = this.round;
    if (n.round !== round) {
      n.round = round;
      n.lo = 0;
      n.exact = false;
    }
    if (n.hosts === null) {
      this.sRef.length = this.sCost.length = this.reads = 0;
      this.tops(n.kind, n.fr, n.k0, n.k1, n.ref);
      this.work += this.reads >> 2;
      n.hosts = this.sRef.length > 0 ? this.sRef.slice() : NONE;
    }
    // What an earlier search of this round proved is the answer for a piece that hangs from nothing.
    if (n.hosts.length === 0 && (n.exact || n.lo > bound)) return n.lo <= bound ? n.lo : -1;
    const search = ++this.search;
    const { refs, vias, hungs, met } = this;
    for (let d = 0; d <= this.capMost; d++) refs[d]!.length = vias[d]!.length = hungs[d]!.length = 0;
    met.length = 0;
    n.seen = search;
    n.d = 0;
    n.via = null;
    n.hung = false;
    met.push(n);
    let best = bound + 1;
    let end: SupportNode | null = null;
    for (let k = 0; k < n.sup.length; k++) {
      const to = n.cost[k]!;
      if (to >= best) continue;
      refs[to]!.push(n.sup[k]!);
      vias[to]!.push(n);
      hungs[to]!.push(false);
    }
    // Only the piece asked about may hang: one that hangs holds nothing.
    if (COST_HUNG < best) {
      for (const host of n.hosts) {
        refs[COST_HUNG]!.push(host);
        vias[COST_HUNG]!.push(n);
        hungs[COST_HUNG]!.push(true);
      }
    }
    scan: for (let d = 0; d < best; d++) {
      const stack = refs[d]!;
      // The last met is read first, so a column is gone down before the next is begun. A link that costs nothing adds to this stack.
      while (stack.length > 0) {
        const p = this.node(stack.pop()!);
        const via = vias[d]!.pop()!;
        const hung = hungs[d]!.pop()!;
        if (this.cut) return -2;
        if (!p || p.fr === 0 || p.seen === search) continue;
        p.seen = search;
        p.d = d;
        p.via = via;
        p.hung = hung;
        met.push(p);
        this.visited++;
        this.work++;
        if (p.root) {
          best = d;
          end = p;
          break scan;
        }
        if (p.round !== round) {
          p.round = round;
          p.lo = 0;
          p.exact = false;
        } else if (p.exact) {
          if (d + p.lo < best) {
            best = d + p.lo;
            end = p;
          }
          continue;
        } else if (d + p.lo > bound) continue;
        const sup = p.sup;
        const cost = p.cost;
        for (let k = 0; k < sup.length; k++) {
          const to = d + cost[k]!;
          if (to >= best) continue;
          refs[to]!.push(sup[k]!);
          vias[to]!.push(p);
          hungs[to]!.push(false);
        }
      }
    }
    if (end === null) {
      // Nothing within the bound. A piece met at cost d is itself more than bound - d from anything that stands by itself.
      for (const p of met) this.atLeast(p, bound - p.d + 1, round);
      return -1;
    }
    for (const p of met) this.atLeast(p, best - p.d, round);
    // Each piece on the way found is exactly as far as the rest of the way. The piece asked about is, unless it hangs by it.
    let last = end;
    for (let q = end; q !== n; q = q.via!) {
      q.lo = best - q.d;
      q.exact = true;
      last = q;
    }
    if (!last.hung) {
      n.lo = best;
      n.exact = true;
    }
    return best;
  }

  private atLeast(p: SupportNode, lo: number, round: number): void {
    if (p.round !== round) {
      p.round = round;
      p.lo = lo;
      p.exact = false;
    } else if (!p.exact && lo > p.lo) p.lo = lo;
  }

  /**
   * The stability of every piece of frame `fr` in one pass, for an overlay: the frame's rows to `rows` as rowsOf lists
   * them, and each one's number to `out` as `stability` gives it. Returns the count. `out` must hold that many.
   */
  stabilities(fr: number, rows: Found, out: Int8Array): number {
    const { structs } = this;
    const forms = this.forms;
    const n = forms ? structs.rowsOf(fr, rows) : 0;
    if (n === 0) return 0;
    const refs = rows.refs;
    // Each row's place in the list, by chunk and slot.
    const index = new Map<number, Int32Array>();
    for (let i = 0; i < n; i++) {
      const chunk = Math.floor(refs[i]! / 65536);
      let of = index.get(chunk);
      if (!of) index.set(chunk, (of = new Int32Array(structs.chunks[chunk]!.high).fill(-1)));
      of[refs[i]! & 0xffff] = i;
    }
    // Links as holder, held and cost, then gathered by holder.
    let from = new Int32Array(n * 8);
    let to = new Int32Array(n * 8);
    let cost = new Uint8Array(n * 8);
    let links = 0;
    const first = new Int32Array(n + 2);
    const link = (by: number, on: number, c: number): void => {
      if (links === from.length) {
        const grown = [new Int32Array(links * 2), new Int32Array(links * 2), new Uint8Array(links * 2)] as const;
        grown[0].set(from);
        grown[1].set(to);
        grown[2].set(cost);
        [from, to, cost] = grown;
      }
      from[links] = by;
      to[links] = on;
      cost[links++] = c;
      first[by + 2]!++;
    };
    let chunkOf = -1;
    let ofChunk: Int32Array | undefined;
    const where = (ref: number): number => {
      const chunk = Math.floor(ref / 65536);
      if (chunk !== chunkOf) ofChunk = index.get((chunkOf = chunk));
      return ofChunk ? ofChunk[ref & 0xffff]! : -1;
    };
    const dist = new Uint8Array(n).fill(255);
    const ready: number[][] = [];
    for (let d = 0; d <= this.capMost; d++) ready.push([]);
    const sRef = this.sRef;
    const sCost = this.sCost;
    for (let i = 0; i < n; i++) {
      const ref = refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const kind = t.kind[slot]!;
      const k0 = t.k0![slot]!;
      const k1 = t.k1![slot]!;
      const root = this.rootAt(kind, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!));
      if (root) {
        dist[i] = 0;
        ready[0]!.push(i);
      } else {
        // A slab is told of its walls and posts by them, below.
        sRef.length = sCost.length = 0;
        this.under(kind, fr, k0, k1, ref, true);
        for (let k = 0; k < sRef.length; k++) {
          const by = where(sRef[k]!);
          if (by >= 0) link(by, i, sCost[k]!);
        }
      }
      const layer = forms!.layer[kind]!;
      if (layer !== WALL && layer !== POST) continue;
      sRef.length = sCost.length = 0;
      this.tops(kind, fr, k0, k1, ref);
      for (let k = 0; k < sRef.length; k++) {
        const slab = where(sRef[k]!);
        if (slab < 0) continue;
        link(i, slab, sCost[k]!);
        if (!root) link(slab, i, COST_HUNG + HUNG);
      }
    }
    for (let i = 0; i < n; i++) first[i + 2]! += first[i + 1]!;
    const held = new Int32Array(links);
    const heldCost = new Uint8Array(links);
    for (let k = 0; k < links; k++) {
      const at = first[from[k]! + 1]!++;
      held[at] = to[k]!;
      heldCost[at] = cost[k]!;
    }
    // Outward from the pieces that stand by themselves, nearest first. A piece that hangs is numbered and not gone on from.
    const hangs = new Uint8Array(n).fill(255);
    for (let d = 0; d <= this.capMost; d++) {
      const list = ready[d]!;
      for (let j = 0; j < list.length; j++) {
        const i = list[j]!;
        if (dist[i] !== d) continue;
        for (let k = first[i]!; k < first[i + 1]!; k++) {
          const o = held[k]!;
          const c = heldCost[k]!;
          if (c >= HUNG) {
            if (d + c - HUNG < hangs[o]!) hangs[o] = d + c - HUNG;
          } else if (d + c < dist[o]! && d + c <= this.capMost) {
            dist[o] = d + c;
            ready[d + c]!.push(o);
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const cap = this.cap[this.kindOf(refs[i]!)]!;
      const least = Math.min(dist[i]!, hangs[i]!);
      out[i] = least <= cap ? cap - least : -1;
    }
    return n;
  }

  /**
   * The pieces that would fall if `ref` were removed, found by working the collapse out with nothing removed: their refs
   * to `out`, up to its length and FALL_MOST, in no order. Returns how many. `ref` itself is not one of them.
   */
  wouldFall(ref: number, out: Uint32Array): number {
    this.forget();
    const most = Math.min(out.length, FALL_MOST);
    const first = this.node(ref);
    if (!first || most === 0) return 0;
    const absent = this.absent;
    const doubt: number[] = [];
    const waiting = new Set<number>();
    const rows = this.rows;
    // Everything a lost piece may have held is in doubt: what is near it, and near whatever stood straight on it, however high.
    const lose = (lost: SupportNode): void => {
      const column = [lost];
      for (let i = 0; i < column.length; i++) {
        const from = column[i]!;
        for (const above of from.over) {
          const o = this.node(above);
          if (o && !column.includes(o)) column.push(o);
        }
        const n = this.dependents(from.x, from.z, -1, rows);
        for (let k = 0; k < n; k++) {
          const r = rows.refs[k]!;
          if (absent.has(r) || waiting.has(r)) continue;
          waiting.add(r);
          doubt.push(r);
        }
      }
    };
    absent.add(ref);
    this.round++;
    lose(first);
    let count = 0;
    while (doubt.length > 0 && count < most) {
      const r = doubt.pop()!;
      waiting.delete(r);
      const n = this.node(r);
      if (!n || this.standsNode(n)) continue;
      out[count++] = r;
      absent.add(r);
      this.round++;
      lose(n);
    }
    absent.clear();
    this.forget();
    return count;
  }

  /**
   * Every building piece that a piece at (x, z) lattice units could have been helping to hold up: all within reach
   * horizontally, at any height. Writes their refs to `out` and returns how many.
   */
  dependents(x: number, z: number, self: number, found: Found): number {
    const { structs, tables } = this;
    const mx = x / STRUCT_UNITS;
    const mz = z / STRUCT_UNITS;
    const far = this.far;
    const n = structs.query(mx - far, mz - far, mx + far, mz + far, found);
    const out = found.refs;
    // A piece listed costs half a search step.
    this.work += COST_NODE + (n >> 1);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const ref = out[i]!;
      if (ref === self) continue;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      if (tables.role[t.kind[slot]!]! < 0) continue;
      const dx = t.x[slot]! - mx;
      const dz = t.z[slot]! - mz;
      if (dx * dx + dz * dz <= far * far) out[count++] = ref;
    }
    return count;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Going away with the adoption shim: pieces with no key, judged by sockets and by reach in metres. A thing rests on a
  // floor by `describeFree` until things have a rule of their own. Everything from here down is deleted with `inPlace`.
  // A piece with no key is of turn class 0, so its sockets lie along frameAxes of its yaw alone.

  /** Nodes made the old way, of any row a question about a piece with no key met. */
  private readonly frees = new Map<number, SupportNode>();

  /** The old node of the piece at `ref`, whether or not it has a key. Null as `node` is. */
  private free(ref: number): SupportNode | null {
    const known = this.frees.get(ref);
    if (known && this.alive(known)) return this.absent.size > 0 && this.absent.has(ref) ? null : known;
    const t = this.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0 || this.tables.role[t.kind[slot]!]! < 0 || (this.absent.size > 0 && this.absent.has(ref))) return null;
    if (this.asking && this.made > 0 && this.work > this.limit) {
      this.cut = true;
      return null;
    }
    this.made++;
    const n = this.describeFree(t.kind[slot]!, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!), t.yaw[slot]!, ref);
    this.frees.set(ref, n);
    return n;
  }

  /** Builds the old node of a piece of `kind` at (x, y, z) lattice units facing `yaw`. `self` is its ref, or -1 for a piece not yet built. */
  private describeFree(kind: number, x: number, y: number, z: number, yaw: number, self: number): SupportNode {
    const { structs, tables } = this;
    const role = tables.role[kind]!;
    const half = units(tables.halfY[kind]!);
    const door = tables.doorway[kind] === 1;
    const hulls = tables.parts.hulls;
    const links: number[] = [];
    const under: number[] = [];
    const over: number[] = [];
    // A pillar's foot may be up to FOOT above the ground. A thing gets no such margin.
    const ground = role === ROLE_PILLAR || role === ROLE_THING ? Math.ceil(this.heightAt(x / STRUCT_UNITS, z / STRUCT_UNITS) * STRUCT_UNITS) : 0;
    const root = role === ROLE_FOUNDATION || (role === ROLE_PILLAR && y - half <= ground + FOOT) || (role === ROLE_THING && y - half <= ground);
    const mx = x / STRUCT_UNITS;
    const mz = z / STRUCT_UNITS;
    // A joined piece reaches into this one's own height: its socket is at most the two half heights away.
    const n = structs.query(mx - NEAR, mz - NEAR, mx + NEAR, mz + NEAR, this.near, (y - half) / STRUCT_UNITS - BAND, (y + half) / STRUCT_UNITS + BAND);
    const near = this.near.refs;
    // An entry the query passes over for its height counts a quarter of one it returns, so that work stays a measure of time.
    this.work += COST_FREE + n + (structs.passed >> 2);
    for (let i = 0; i < n; i++) {
      const ref = near[i]!;
      if (ref === self) continue;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const ok = t.kind[slot]!;
      const orole = tables.role[ok]!;
      if (orole < 0) continue;
      const ox = units(t.x[slot]!);
      const oy = units(t.y[slot]!);
      const oz = units(t.z[slot]!);
      const ohalf = units(tables.halfY[ok]!);
      // A thing joins nothing. It stands on the floor under its foot, if its middle is over that floor: over its box's top, or
      // where its convex parts have their top (floorTop, which a thing that fell rests by).
      if (orole === ROLE_THING) continue;
      if (role === ROLE_THING) {
        const sloped = hulls !== undefined && hulls.start[ok + 1]! > hulls.start[ok]!;
        if ((orole === ROLE_FOUNDATION || orole === ROLE_CEILING) && (sloped ? floorTop(structs, tables, ref, x, z) === y - half : oy + ohalf === y - half && overPiece(ox, oz, t.yaw[slot]!, x, z))) {
          links.push(ref);
          under.push(ref);
        }
        continue;
      }
      // Either this piece sits in a socket of the other, or the other sits in a socket of this piece.
      const onIt = inPlace(orole, ohalf, tables.doorway[ok] === 1, ox, oy, oz, t.yaw[slot]!, role, half, x, y, z);
      let inMine = false;
      if (!onIt) {
        inMine = inPlace(role, half, door, x, y, z, yaw, orole, ohalf, ox, oy, oz);
        if (!inMine) continue;
      }
      links.push(ref);
      // A door stands on its frame. Any other piece stands on what its foot is on, except that a ceiling holds nothing straight up.
      if (role === ROLE_DOOR ? onIt && orole === ROLE_WALL : onIt && orole !== ROLE_CEILING && oy + ohalf === y - half) under.push(ref);
      // The same rule from below gives what stands on it.
      if (orole === ROLE_DOOR ? role === ROLE_WALL : role !== ROLE_CEILING && y + half === oy - ohalf) {
        if (inMine || (onIt && inPlace(role, half, door, x, y, z, yaw, orole, ohalf, ox, oy, oz))) over.push(ref);
      }
    }
    return new SupportNode(this, self, kind, role, x, y, z, root, 0, 0, 0, NONE, NONE, under, links, over);
  }

  private askFree(n: SupportNode): boolean {
    if (this.straight(n, 0)) return true;
    if (this.cut || n.role === ROLE_DOOR || n.role === ROLE_THING) return false;
    // Held sideways. Search its links for a piece that stands straight up within reach.
    const reach = (n.role === ROLE_CEILING ? CEILING_REACH : LOAD_REACH) * STRUCT_UNITS;
    const reach2 = reach * reach;
    const queue = this.queue;
    const search = ++this.search;
    queue.length = 0;
    n.seen = search;
    queue.push(n);
    for (let at = 0; at < queue.length; at++) {
      const from = queue[at]!;
      for (const ref of from.links) {
        const o = this.free(ref);
        if (this.cut) return false;
        // A door holds nothing up, and the search does not pass through one.
        if (!o || o.seen === search || o.role === ROLE_DOOR) continue;
        o.seen = search;
        const dx = o.x - n.x;
        const dz = o.z - n.z;
        if (dx * dx + dz * dz > reach2) continue;
        this.visited++;
        this.work++;
        if (this.straight(o, 0)) return true;
        if (this.cut) return false;
        queue.push(o);
      }
    }
    return false;
  }

  /**
   * Whether a piece stands by itself or directly on a piece that does. For a door, whether its frame is there. For a thing, whether
   * the piece it was set on is there.
   */
  private straight(n: SupportNode, depth: number): boolean {
    if (n.root) return true;
    if (n.round === this.round && n.straight !== 0) return n.straight === 1;
    // Marked as not standing until known, so a ring of pieces cannot hold itself up. The depth cap is deeper than anything can be built.
    n.round = this.round;
    n.straight = 2;
    if (depth > 400) return false;
    for (const ref of n.under) {
      const o = this.free(ref);
      this.work++;
      if (o && (n.role === ROLE_DOOR || n.role === ROLE_THING || this.straight(o, depth + 1))) {
        n.straight = 1;
        return true;
      }
      // The question was cut, so nothing is known about this piece.
      if (this.cut) {
        n.straight = 0;
        return false;
      }
    }
    return false;
  }
}

/** Work units to build one node the old way, as COST_NODE was when 16,000 units were first set to a millisecond. */
const COST_FREE = 24;

/** Whether a piece of role `b` at (bx, by, bz) sits in one of the sockets a piece of role `a` at (ax, ay, az) facing `ayaw` offers it. */
function inPlace(a: number, ah: number, adoor: boolean, ax: number, ay: number, az: number, ayaw: number, b: number, bh: number, bx: number, by: number, bz: number): boolean {
  // No socket is further up or down than the two half heights together.
  const dy = by - ay;
  if (dy > ah + bh || dy < -(ah + bh)) return false;
  socketsFor(a, b, ah, bh, adoor, sockets);
  if (sockets.n === 0) return false;
  frameAxes(ayaw, axes);
  const dx = bx - ax;
  const dz = bz - az;
  for (let k = 0; k < sockets.n; k++) {
    if (sockets.dy[k] !== dy) continue;
    const i = sockets.i[k]!;
    const j = sockets.j[k]!;
    if (i * axes[0]! + j * axes[2]! === dx && i * axes[1]! + j * axes[3]! === dz) return true;
  }
  return false;
}
