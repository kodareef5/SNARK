// A plan is a blueprint set down in the world as holograms: where it stands, how it is turned, and which of its pieces
// are filled. Here are its record and bytes, its pieces as keys in its frame, and the judge that says of each piece
// whether it could be built, in the order the pieces would be filled. The server keeps plans (server/plans.ts) and the
// client shows the same judgement before it asks (client/core/plans.ts). A plan is never a row.

import type { StructureDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import type { BitReader, BitWriter } from "../net/codec.ts";
import { RESULT_OBSTRUCTED, RESULT_OK, RESULT_TERRAIN, RESULT_TOO_HIGH } from "../net/protocol.ts";
import { BLUEPRINT_PIECES_MOST, TIER_ANY, decodeBlueprint, placeBlueprint, type Blueprint, type BlueprintFault, type BlueprintForms } from "./blueprint.ts";
import { LEVEL_UNITS, worldOf, yawOf } from "./lattice/basis.ts";
import { FORM_LAYERS, type FormDef, type FormTable } from "./lattice/forms.ts";
import { Frame, ownDir, poseOf, type LatticePose } from "./lattice/frames.ts";
import { LVL_MOST, M_MOST, cellOf, keyLayer, keyLvl } from "./lattice/module.ts";
import { Cells, Occupancy, formCells } from "./lattice/occupancy.ts";
import { makeVerdict, validatePlan, type Site } from "./lattice/place.ts";
import { LIFT_MAX, LIFT_MIN, freePose, type PieceTables, type Pose } from "./snap.ts";
import type { StructureStore } from "./structures.ts";
import { STABILITY, pretendRef, type Pretend, type Support } from "./support.ts";

/** Bytes of blueprint one plan may hold: a base of 2,000 pieces is about 4,000. */
export const PLAN_BYTES_MOST = 12 * 1024;
/** Bytes of blueprint in one CMD_PLAN_PART. */
export const PLAN_PART_BYTES = 480;
/** The gid of a plan's frame while no piece of it stands. No frame is ever made under it. */
export const GID_UNMADE = 0xfffffffe;
/** Metres from a builder's eye that a plan's piece may be filled, and from the builder that a plan's anchor may be set. */
export const PLAN_FILL_REACH = 48;
export const PLAN_SET_REACH = 32;

/** What the judge says of a piece. */
export const PIECE_FINE = 0;
/** The same form stands on its key already: it counts as filled. */
export const PIECE_BUILT = 1;
/** Another piece fills its cell. */
export const PIECE_OCCUPIED = 2;
/** Something built overlaps it. */
export const PIECE_OVERLAP = 3;
export const PIECE_TERRAIN = 4;
export const PIECE_HIGH = 5;
/** Another plan of the tribe has a piece there. */
export const PIECE_PLAN = 6;
/** Nothing would hold it up, with every piece before it built. */
export const PIECE_UNSUPPORTED = 7;
/** Another tribe's foundation is too near. */
export const PIECE_ENEMY = 8;
/** Off the map or the lattice, or at a turn no piece is built at yet. */
export const PIECE_OFF = 9;
export const PIECE_STATES = 10;

export const PIECE_WORDS: readonly string[] = ["fine", "already built", "its place is taken", "something built is in the way", "the ground is in the way", "too far above the ground", "another plan is there", "nothing would hold it up", "too near another tribe's foundation", "off the lattice"];

/** A rank past every cost: a blocked piece, then one nothing holds. */
export const RANK_BLOCKED = 254;
export const RANK_UNSUPPORTED = 255;

/** The materials a blueprint's tiers name, in order. Any other takes the next number as the registry lists it. */
const TIERS: readonly string[] = ["thatch", "wood", "stone", "metal"];

/** What a registry's pieces are to a blueprint: each kind's form name and tier, and the kind of each. */
export interface PieceBook {
  readonly forms: BlueprintForms;
  /** Per kind: its form's name, or "" for a kind that is no lattice piece. */
  readonly name: readonly string[];
  readonly tier: Int8Array;
  /** Per kind: the kind a piece is copied as. An open door is copied shut. */
  readonly copied: Uint16Array;
  /** The kind of a form at a tier, or 0. TIER_ANY is the form's lowest tier. */
  kindOf(form: string, tier: number): number;
}

const books = new WeakMap<Registry, PieceBook>();

export function pieceBook(reg: Registry): PieceBook {
  const known = books.get(reg);
  if (known) return known;
  const n = reg.ids.length;
  const forms: Record<string, FormDef> = {};
  const name: string[] = new Array<string>(n).fill("");
  const tier = new Int8Array(n).fill(-1);
  const copied = new Uint16Array(n);
  const tiers = [...TIERS];
  const kinds = new Map<string, number>();
  for (let k = 1; k < n; k++) {
    const form = reg.forms.def[k];
    const item = reg.pieceItem[k]!;
    if (!form || item === 0) continue;
    const def = reg.defs[k] as StructureDef;
    // The item sets down the shut door, and that is the form copied.
    const own = reg.places[item]!.includes(k) ? k : reg.opens[k]!;
    if (own === 0 || !reg.forms.def[own]) continue;
    copied[k] = own;
    if (own !== k) continue;
    const shape = def.shape ?? reg.ids[k]!;
    const short = shape.slice(shape.indexOf(":") + 1);
    const word = short.startsWith("shape_") ? short.slice(6) : short;
    const mat = (def.material ?? "").replace(/^.*:(mat_)?/, "");
    let t = tiers.indexOf(mat);
    if (t < 0) t = tiers.push(mat) - 1;
    if (t >= TIER_ANY) continue;
    name[k] = word;
    tier[k] = t;
    forms[word] ??= form;
    kinds.set(`${word}/${t}`, k);
  }
  for (let k = 1; k < n; k++) {
    if (copied[k] !== 0 && copied[k] !== k) {
      name[k] = name[copied[k]!]!;
      tier[k] = tier[copied[k]!]!;
    }
  }
  const book: PieceBook = {
    forms,
    name,
    tier,
    copied,
    kindOf(form, t) {
      if (t !== TIER_ANY) return kinds.get(`${form}/${t}`) ?? 0;
      for (let any = 0; any < TIER_ANY; any++) {
        const kind = kinds.get(`${form}/${any}`);
        if (kind) return kind;
      }
      return 0;
    },
  };
  books.set(reg, book);
  return book;
}

/** One paste: the blueprint, where it stands and how it is turned, whose it is, and what of it is filled. */
export interface PlanRecord {
  id: number;
  team: number;
  /** The survivor who set it down. */
  by: number;
  /** The frame it stands in, or 0 while that frame has no piece: its first piece then makes the frame at the pose below. */
  fr: number;
  /** Its frame's origin in lattice units and its turn: as the frame was when the plan was set, or is to be made. */
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  /** Where the blueprint's anchor is in the frame: a tuple and a level. */
  m0: number;
  m1: number;
  m2: number;
  m3: number;
  lvl: number;
  /** Steps of 30 degrees about the anchor, 0 to 11, after the mirror. */
  turn: number;
  mirror: boolean;
  /** The tick it goes at unless a piece is filled first. */
  expires: number;
  /** The blueprint, as encodeBlueprint wrote it. */
  bytes: Uint8Array;
  /** A bit a piece, in the order of the blueprint as placed (placePlan): set once a row has stood on its key. */
  filled: Uint8Array;
}

export function writePlan(w: BitWriter, p: PlanRecord): void {
  w.varint(p.id);
  w.varint(p.team);
  w.varint(p.by);
  w.varint(p.fr);
  w.sbits(p.ox, 32);
  w.sbits(p.oy, 32);
  w.sbits(p.oz, 32);
  w.u16(p.yaw);
  w.sbits(p.m0, 11);
  w.sbits(p.m1, 11);
  w.sbits(p.m2, 11);
  w.sbits(p.m3, 11);
  w.sbits(p.lvl, 10);
  w.bits(p.turn, 4);
  w.bool(p.mirror);
  w.u32(p.expires);
  w.blob(p.bytes);
  w.blob(p.filled);
}

/** Null for one that runs past its end or says what no plan may. */
export function readPlan(r: BitReader): PlanRecord | null {
  const p: PlanRecord = {
    id: r.varint(),
    team: r.varint(),
    by: r.varint(),
    fr: r.varint(),
    ox: r.sbits(32),
    oy: r.sbits(32),
    oz: r.sbits(32),
    yaw: r.u16(),
    m0: r.sbits(11),
    m1: r.sbits(11),
    m2: r.sbits(11),
    m3: r.sbits(11),
    lvl: r.sbits(10),
    turn: r.bits(4),
    mirror: r.bool(),
    expires: r.u32(),
    bytes: r.blob(PLAN_BYTES_MOST),
    filled: r.blob(BLUEPRINT_PIECES_MOST / 8 + 1),
  };
  return r.overflow || p.turn > 11 ? null : p;
}

export const filledAt = (filled: Uint8Array, i: number): boolean => (filled[i >> 3]! & (1 << (i & 7))) !== 0;

export function setFilled(filled: Uint8Array, i: number): void {
  filled[i >> 3] = filled[i >> 3]! | (1 << (i & 7));
}

export function countFilled(filled: Uint8Array, n: number): number {
  let count = 0;
  for (let i = 0; i < n; i++) if (filledAt(filled, i)) count++;
  return count;
}

/** A plan's pieces as they stand in its frame, in the blueprint's order once placed. */
export interface Placed {
  readonly n: number;
  readonly blueprint: Blueprint;
  readonly kind: Uint16Array;
  readonly k0: Uint32Array;
  readonly k1: Uint32Array;
}

export type PlacedRead = { readonly ok: true; readonly placed: Placed } | { readonly ok: false; readonly fault: BlueprintFault | { readonly reason: "off the lattice"; readonly piece: number } | { readonly reason: "no such piece"; readonly name: string } };

/** The pieces a record's blueprint comes to, mirrored, turned and moved to its anchor, each with the kind that builds it. */
export function placePlan(book: PieceBook, bytes: Uint8Array, mirror: boolean, turn: number, m: ArrayLike<number>, lvl: number): PlacedRead {
  const read = decodeBlueprint(bytes, book.forms);
  if (!read.ok) return read;
  return placePieces(book, read.blueprint, mirror, turn, m, lvl);
}

export function placePieces(book: PieceBook, bp: Blueprint, mirror: boolean, turn: number, m: ArrayLike<number>, lvl: number): PlacedRead {
  const moved = placeBlueprint(bp, book.forms, mirror, turn, m, lvl);
  if (!moved.ok) return { ok: false, fault: { reason: "off the lattice", piece: moved.pieces[0] ?? 0 } };
  const pieces = moved.blueprint.pieces;
  const n = pieces.length;
  const kind = new Uint16Array(n);
  const k0 = new Uint32Array(n);
  const k1 = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    const k = book.kindOf(p.form, p.tier);
    if (k === 0) return { ok: false, fault: { reason: "no such piece", name: `${p.form} of tier ${p.tier}` } };
    kind[i] = k;
    k0[i] = p.k0;
    k1[i] = p.k1;
  }
  return { ok: true, placed: { n, blueprint: moved.blueprint, kind, k0, k1 } };
}

/** The frame a record's pieces are keyed in: the one made, or one of its pose under GID_UNMADE. */
export function planFrame(structs: StructureStore, p: PlanRecord): Frame {
  return (p.fr !== 0 ? structs.frames.get(p.fr) : undefined) ?? new Frame(GID_UNMADE, p.ox, p.oy, p.oz, p.yaw & (YAW_UNITS - 1), p.team);
}

/** Order within one cost: what holds comes before what it holds straight up. */
const LAYER_RANK: readonly number[] = FORM_LAYERS.map((l) => ["slab", "footing", "wall", "post", "fill", "leaf"].indexOf(l));

/** The order pieces are filled in: by rank, then level, then layer, then place. */
export function fillOrder(placed: Placed, rank: Uint8Array): Uint16Array {
  const { n, k1 } = placed;
  const order = new Uint16Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  return order.sort((a, b) => rank[a]! - rank[b]! || keyLvl(k1[a]!) - keyLvl(k1[b]!) || LAYER_RANK[keyLayer(k1[a]!)]! - LAYER_RANK[keyLayer(k1[b]!)]! || a - b);
}

/** A table from a piece's cell to its place among the pieces, for one frame. */
export class CellIndex {
  private readonly slots: Int32Array;
  private readonly mask: number;
  private readonly k0: Uint32Array;
  private readonly k1: Uint32Array;

  constructor(placed: Placed) {
    let cap = 16;
    while (cap < placed.n * 2) cap *= 2;
    this.slots = new Int32Array(cap).fill(-1);
    this.mask = cap - 1;
    this.k0 = placed.k0;
    this.k1 = placed.k1;
    for (let i = 0; i < placed.n; i++) {
      let h = this.start(placed.k0[i]!, cellOf(placed.k1[i]!));
      while (this.slots[h] !== -1) h = (h + 1) & this.mask;
      this.slots[h] = i;
    }
  }

  private start(k0: number, cell: number): number {
    let h = Math.imul(k0, 0x85ebca6b) ^ Math.imul(cell, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return (h ^ (h >>> 13)) & this.mask;
  }

  /** The piece whose cell this key names, or -1. */
  at(k0: number, k1: number): number {
    const cell = cellOf(k1);
    for (let h = this.start(k0, cell); ; h = (h + 1) & this.mask) {
      const i = this.slots[h]!;
      if (i < 0) return -1;
      if (this.k0[i] === k0 && cellOf(this.k1[i]!) === cell) return i;
    }
  }
}

/** A piece's place as one number: half metres on the flat and up, and its layer. What two plans in different frames clash by. */
export function spotOf(x: number, y: number, z: number, layer: number): number {
  const qx = Math.round(x * 2) & 0x3ffff;
  const qz = Math.round(z * 2) & 0x3ffff;
  const qy = (Math.round(y * 2) + 2048) & 0xfff;
  return ((qx * 0x40000 + qz) * 0x1000 + qy) * 8 + layer;
}

const U = STRUCT_UNITS;
const spot: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };

/** The spots of every piece not filled, for `spotOf`'s test. */
export function planSpots(forms: FormTable, f: Frame, placed: Placed, filled: Uint8Array): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < placed.n; i++) {
    if (filledAt(filled, i)) continue;
    poseOf(f, placed.k0[i]!, placed.k1[i]!, forms, placed.kind[i]!, spot);
    out.add(spotOf(spot.x / U, spot.y / U, spot.z / U, keyLayer(placed.k1[i]!)));
  }
  return out;
}

/** What the judge asks of whoever runs it, beside the rows. */
export interface PlanAsks {
  /** The lattice's own checks of a place: the store, the tables and the ground. It answers nothing of bodies, tribes, caps or support. */
  readonly site: Site;
  /** A Support of the judge's own: it is given pieces to pretend. */
  readonly support: Support;
  /** Whether another tribe has built too near (x, z) metres. */
  enemy(x: number, z: number): boolean;
  /** Whether another plan of the tribe has a piece in this cell of frame `fr`, or at this place in metres. */
  other(fr: number, k0: number, k1: number, x: number, y: number, z: number): boolean;
}

/** Passes over the pieces that support may take: each takes out what the pass before found nothing to hold. */
const PASSES_MOST = 8;

/**
 * Judges a plan a part at a time. `step(n)` looks at up to `n` pieces and says whether it is done. First each piece by
 * itself: built already, its place taken, overlapped, the ground, another plan, another tribe. Then support, with every
 * piece that is fine counted as built: a piece's rank is the cost of the cheapest way to it from one that stands by
 * itself, so pieces filled by rank each stand on those before them. A piece nothing holds is taken out and the rest
 * are asked again, until a pass takes none out.
 */
export class PlanJudge {
  n = 0;
  state = new Uint8Array(0);
  /** The ref of what is in a piece's way, where a built piece is. */
  by = new Uint32Array(0);
  rank = new Uint8Array(0);
  /** Each piece's place, in lattice units. */
  x = new Int32Array(0);
  y = new Int32Array(0);
  z = new Int32Array(0);
  /** How many pieces are in each state. */
  readonly counts = new Uint32Array(PIECE_STATES);
  done = true;
  /** Pieces looked at so far, over every pass: what the work cost. */
  looked = 0;
  private placed: Placed | null = null;
  private frame: Frame | null = null;
  private made = false;
  private team = 0;
  private asks: PlanAsks | null = null;
  private book: PieceBook | null = null;
  private phase = 0;
  private at = 0;
  private pass = 0;
  private fell = 0;
  private pretend: { frame: Frame; occupied: Occupancy; kind: Uint16Array; k0: Uint32Array; k1: Uint32Array } | null = null;
  private readonly verdict = makeVerdict();
  private readonly cells = new Cells();

  /** `frame` is the plan's (planFrame), and `filled` the pieces a row has stood on, which are passed over. */
  begin(book: PieceBook, placed: Placed, frame: Frame, team: number, asks: PlanAsks, filled: Uint8Array | null = null): void {
    const n = (this.n = placed.n);
    if (this.state.length < n) {
      this.state = new Uint8Array(n);
      this.by = new Uint32Array(n);
      this.rank = new Uint8Array(n);
      this.x = new Int32Array(n);
      this.y = new Int32Array(n);
      this.z = new Int32Array(n);
    }
    this.state.fill(PIECE_FINE, 0, n);
    this.rank.fill(RANK_BLOCKED, 0, n);
    if (filled) for (let i = 0; i < n; i++) if (filledAt(filled, i)) this.state[i] = PIECE_BUILT;
    this.counts.fill(0);
    this.placed = placed;
    this.frame = frame;
    this.made = frame.gid !== GID_UNMADE;
    this.team = team;
    this.asks = asks;
    this.book = book;
    this.phase = this.at = this.pass = this.fell = this.looked = 0;
    this.pretend = null;
    this.done = false;
  }

  step(pieces: number): boolean {
    while (!this.done && pieces > 0) {
      if (this.phase === 0) pieces -= this.alone(pieces);
      else pieces -= this.held(pieces);
    }
    return this.done;
  }

  /** Each piece by itself, up to `most` of them. Returns how many. */
  private alone(most: number): number {
    const placed = this.placed!;
    const asks = this.asks!;
    const frame = this.frame!;
    const structs = asks.site.structs;
    const book = this.book!;
    const v = this.verdict;
    const end = Math.min(this.n, this.at + most);
    const from = this.at;
    for (let i = from; i < end; i++) {
      const kind = placed.kind[i]!;
      const k0 = placed.k0[i]!;
      const k1 = placed.k1[i]!;
      this.by[i] = 0xffffffff;
      const stands = this.made && this.state[i] !== PIECE_BUILT ? structs.occupied.at(frame.gid, k0, k1) : -1;
      if (stands >= 0 && book.name[structs.chunks[Math.floor(stands / 65536)]!.kind[stands & 0xffff]!] === book.name[kind]) this.state[i] = PIECE_BUILT;
      if (this.state[i] === PIECE_BUILT) {
        poseOf(frame, k0, k1, structs.forms!, kind, v.pose);
      } else {
        // The eye is not asked: a plan's reach is its builder's to keep.
        const code = validatePlan(asks.site, kind, this.team, frame, k0, k1, NaN, NaN, NaN, v);
        let state = PIECE_FINE;
        if (code === RESULT_OBSTRUCTED) {
          state = this.made && !structs.fits(kind, frame.gid, k0, k1) ? PIECE_OCCUPIED : PIECE_OVERLAP;
          this.by[i] = v.a;
        } else if (code === RESULT_TERRAIN) state = PIECE_TERRAIN;
        else if (code === RESULT_TOO_HIGH) state = PIECE_HIGH;
        else if (code !== RESULT_OK) state = PIECE_OFF;
        else if (asks.other(frame.gid, k0, k1, v.pose.x / U, v.pose.y / U, v.pose.z / U)) state = PIECE_PLAN;
        else if (asks.enemy(v.pose.x / U, v.pose.z / U)) state = PIECE_ENEMY;
        this.state[i] = state;
      }
      this.x[i] = v.pose.x;
      this.y[i] = v.pose.y;
      this.z[i] = v.pose.z;
    }
    this.at = end;
    this.looked += end - from;
    if (end === this.n) this.pretending();
    return Math.max(1, end - from);
  }

  /** Counts every fine piece as built, for support to read. */
  private pretending(): void {
    const placed = this.placed!;
    const forms = this.asks!.site.structs.forms!;
    const frame = this.frame!;
    const occupied = new Occupancy();
    const kind = new Uint16Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== PIECE_FINE || !formCells(forms, placed.kind[i]!, placed.k0[i]!, placed.k1[i]!, this.cells)) continue;
      kind[i] = placed.kind[i]!;
      for (let c = 0; c < this.cells.n; c++) occupied.put(frame.gid, this.cells.k0[c]!, this.cells.k1[c]!, pretendRef(i), this.cells.reach[c]!);
    }
    this.pretend = { frame, occupied, kind, k0: placed.k0, k1: placed.k1 };
    this.phase = 1;
    this.at = this.pass = this.fell = 0;
    this.asks!.support.forget();
  }

  /** Support for up to `most` pieces of the pass under way. Returns how many were looked at. */
  private held(most: number): number {
    const placed = this.placed!;
    const asks = this.asks!;
    const support = asks.support;
    const pretend = this.pretend!;
    const forms = asks.site.structs.forms!;
    const caps = (asks.site.tables as { stabilityCap?: Uint8Array }).stabilityCap;
    support.pretend = pretend as Pretend;
    let looked = 0;
    let i = this.at;
    for (; i < this.n && looked < most; i++) {
      if (pretend.kind[i] === 0) continue;
      looked++;
      const kind = placed.kind[i]!;
      const node = support.node(pretendRef(i));
      const stability = node ? support.stabilityNode(node) : -1;
      const cap = caps?.[kind] || STABILITY;
      if (stability < 0 || stability < (forms.def[kind]!.need ?? 0)) {
        this.state[i] = PIECE_UNSUPPORTED;
        this.rank[i] = RANK_UNSUPPORTED;
        this.fell++;
      } else this.rank[i] = cap - stability;
    }
    support.pretend = null;
    this.at = i;
    this.looked += looked;
    if (i < this.n) return Math.max(1, looked);
    // What nothing holds holds nothing: without it, the rest are asked again.
    if (this.fell > 0 && ++this.pass < PASSES_MOST) {
      for (let k = 0; k < this.n; k++) {
        if (this.state[k] !== PIECE_UNSUPPORTED || pretend.kind[k] === 0) continue;
        pretend.kind[k] = 0;
        formCells(forms, placed.kind[k]!, placed.k0[k]!, placed.k1[k]!, this.cells);
        for (let c = 0; c < this.cells.n; c++) pretend.occupied.take(pretend.frame.gid, this.cells.k0[c]!, this.cells.k1[c]!);
      }
      this.at = this.fell = 0;
      support.forget();
      return Math.max(1, looked);
    }
    support.forget();
    this.pretend = null;
    this.counts.fill(0);
    for (let k = 0; k < this.n; k++) this.counts[this.state[k]!]!++;
    this.done = true;
    return Math.max(1, looked);
  }

  /** Pieces something is in the way of: every state but fine, built and unsupported. */
  get blocked(): number {
    const c = this.counts;
    return this.n - c[PIECE_FINE]! - c[PIECE_BUILT]! - c[PIECE_UNSUPPORTED]!;
  }
}

/** How many of each item a plan's pieces still to fill would take: item ids and counts, most first. */
export function planCost(reg: Registry, placed: Placed, skip: (i: number) => boolean): { item: number; count: number }[] {
  const tally = new Map<number, number>();
  for (let i = 0; i < placed.n; i++) {
    if (skip(i)) continue;
    const item = reg.pieceItem[placed.kind[i]!]!;
    tally.set(item, (tally.get(item) ?? 0) + 1);
  }
  return [...tally].map(([item, count]) => ({ item, count })).sort((a, b) => b.count - a.count || a.item - b.item);
}

/**
 * The piece a plan is set down by: its lowest piece that stands anywhere, the first of them in the blueprint's order, or
 * else the first piece. A plan on open ground has it where a foundation set there by hand would be.
 */
export function planFooting(forms: FormTable, placed: Placed): number {
  let best = -1;
  for (let i = 0; i < placed.n; i++) {
    if (forms.def[placed.kind[i]!]!.root !== "always") continue;
    if (best < 0 || keyLvl(placed.k1[i]!) < keyLvl(placed.k1[best]!)) best = i;
  }
  return best < 0 ? 0 : best;
}

const at: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };

/**
 * The origin of the frame, turned `yaw`, in which the piece of `kind` keyed (k0, k1) has its collider origin at (x, y, z)
 * lattice units. A key's place is its frame's origin plus whole lattice units, so this is exact at every yaw: it is
 * baseOrigin for a foundation in a base's first slot.
 */
export function frameFor(forms: FormTable, kind: number, k0: number, k1: number, x: number, y: number, z: number, yaw: number, out: { ox: number; oy: number; oz: number }): void {
  const f = new Frame(GID_UNMADE, 0, 0, 0, yaw & (YAW_UNITS - 1), 0);
  poseOf(f, k0, k1, forms, kind, at);
  out.ox = x - at.x;
  out.oy = y - at.y;
  out.oz = z - at.z;
}

const footing: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/**
 * The origin of a new frame turned `yaw` in which a plan's footing lies where a foundation set down by hand at (x, z)
 * metres would, raised `lift` steps: the pose a plan on open ground is sent with. False where the footing is no piece
 * that goes on open ground.
 */
export function planGround(heightAt: (x: number, z: number) => number, tables: PieceTables, forms: FormTable, placed: Placed, x: number, z: number, yaw: number, lift: number, out: { ox: number; oy: number; oz: number }): boolean {
  const foot = planFooting(forms, placed);
  const kind = placed.kind[foot]!;
  if (forms.def[kind]!.root !== "always") return false;
  const steps = lift < LIFT_MIN ? LIFT_MIN : lift > LIFT_MAX ? LIFT_MAX : lift;
  if (!freePose(heightAt, tables, kind, x, z, yawOf(yaw & (YAW_UNITS - 1), ownDir(forms, kind, placed.k1[foot]!)), steps, footing)) return false;
  frameFor(forms, kind, placed.k0[foot]!, placed.k1[foot]!, footing.x, footing.y, footing.z, yaw, out);
  return true;
}

const world = new Int32Array(2);
const tuple = new Int32Array(4);

/** Where a record's anchor is, in metres on the flat: what its chunk and its distance from a builder are read from. */
export function planAnchor(p: PlanRecord, out: { x: number; y: number; z: number }): void {
  const f = new Frame(GID_UNMADE, p.ox, p.oy, p.oz, p.yaw & (YAW_UNITS - 1), 0);
  tuple[0] = p.m0;
  tuple[1] = p.m1;
  tuple[2] = p.m2;
  tuple[3] = p.m3;
  worldOf(f.basis, f.ox, f.oz, tuple, 0, world, 0);
  out.x = world[0]! / U;
  out.z = world[1]! / U;
  out.y = (p.oy + p.lvl * LEVEL_UNITS) / U;
}

/** Whether a record's numbers are ones a plan may have: a pose on the map and an anchor on the lattice. */
export function planSound(p: PlanRecord, chunksX: number, chunksZ: number): boolean {
  const whole = Number.isInteger(p.ox) && Number.isInteger(p.oy) && Number.isInteger(p.oz);
  const x = p.ox / U;
  const z = p.oz / U;
  if (!whole || !(x >= 0 && z >= 0 && x < chunksX * CHUNK_SIZE && z < chunksZ * CHUNK_SIZE) || Math.abs(p.oy / U) > 4096) return false;
  return Math.abs(p.m0) <= M_MOST && Math.abs(p.m1) <= M_MOST && Math.abs(p.m2) <= M_MOST && Math.abs(p.m3) <= M_MOST && Math.abs(p.lvl) <= LVL_MOST && p.turn >= 0 && p.turn <= 11;
}
