// Trims: what is drawn where built pieces meet and is no piece. A joint stands at a corner where walls end, and a skirt
// hangs under a foundation's open side. The client finds them from what stands round each corner of a base's lattice
// (shared/world/lattice/occupancy.ts), so a trim has no row, no collider and nothing on the wire. A wall's end gives way
// to the joint at it, and a ceiling's side to the wall under it: those are bits of the piece's own instance (piece-fit.ts).
//
// A tier's trims are meshes of its pack, by name: <ns>:joint_sq_<tier> a square joint, <ns>:joint_r15_<tier> and
// <ns>:joint_r21_<tier> twelve-sided ones of 0.15 m and 0.21 m, <ns>:skirt_<tier>. <ns> and <tier> are its pieces'
// material's, core:mat_<tier>. A joint's mesh stands on its corner from the level up a storey, and a skirt's hangs from
// the middle of its side, its +X along the side and its +Z outward. A tier with no square joint has no trims, and its
// pieces yield nothing.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS } from "../../../shared/coords.ts";
import { levelY, worldOf, yawOf } from "../../../shared/world/lattice/basis.ts";
import { FORM_LAYERS, STOREY_LEVELS, type FormTable } from "../../../shared/world/lattice/forms.ts";
import { ownDir, type Frame } from "../../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, DIRECTIONS, M_MOST, SIDE, dirTurn, elementCorners, key0, key1, keyAnchor, keyCls, keyDir, keyLvl, keyM3, tupleStep, tupleWithin } from "../../../shared/world/lattice/module.ts";
import { Cells, cellAt, edgeFaces, faceEdges, formCells, vertexEdges } from "../../../shared/world/lattice/occupancy.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import { DRAW_PIECE } from "./packet.ts";
import type { PieceLooks } from "./piece-state.ts";

/** Each tier's rank, the highest at a corner giving its joint, and whether its walls run on through a straight run with no joint. */
const TIER_RULES: Readonly<Record<string, readonly [rank: number, runsOn: boolean]>> = { thatch: [0, false], wood: [1, false], stone: [2, true], metal: [3, true] };
/** Metres from a chunk's side within which a piece's trims may turn on what stands in the next chunk: a side and a half, and a wall's thickness. */
const BORDER = 4.7;
/** Metres from a chunk's side within which a wall at a corner may be the next chunk's: half a side, and the most a base's vectors stretch it. */
const CORNER_BORDER = 1.6;
/** Metres from a chunk's side past which the walls under a slab's sides are all the chunk's own. */
const SLAB_BORDER = 3.2;
/** The bits of a key's second word that are its cell, and where a base's place among the chunk's goes over them in the table's keys. */
const CELL = (1 << 26) - 1;
const BASES_MOST = 63;
/** A corner's flags: walls of more than one piece end at it; they are not alike, or their tier does not run on; one begins under its level; the next chunk's walls may end at it. */
const SEVERAL = 1, UNALIKE = 2, UNDER = 4, EDGE = 8;
/** In the table, an edge whose wall has a level top at the key's level. */
const TOP = -2;

const WALL = FORM_LAYERS.indexOf("wall");
const POST = FORM_LAYERS.indexOf("post");
const SLAB = FORM_LAYERS.indexOf("slab");

interface Tier {
  readonly rank: number;
  readonly runsOn: boolean;
  /** Its meshes, -1 for one its pack has not. */
  readonly sq: number;
  readonly r15: number;
  readonly r21: number;
  readonly skirt: number;
}

/** What a chunk's trims are, as `lay` leaves them until it is next called. */
export interface TrimLayout {
  count: number;
  /** Per trim: its mesh, the slot of the piece that owns it, where it stands in metres, its yaw and turn class as a row has them, and the quarter storeys it is cut to, 0 for none. */
  mesh: Uint16Array;
  owner: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Uint16Array;
  tw: Uint8Array;
  cut: Uint8Array;
  /** Per slot of the chunk: what of the piece yields, the low bits of its fit byte. */
  yields: Uint8Array;
  /** The chunks round this one whose pieces these turn on, a bit each: a row of three, then the next, its own left out. */
  borders: number;
}

/** The place among the eight chunks round one of the chunk `dx` and `dz` chunks off. */
export const borderBit = (dx: number, dz: number): number => {
  const n = (dz + 1) * 3 + dx + 1;
  return 1 << (n < 4 ? n : n - 1);
};

export class Trims {
  /** Whether any tier has trims. With none, nothing is laid and no piece yields. */
  readonly any: boolean;
  private readonly forms: FormTable | undefined;
  private readonly looks: PieceLooks;
  private readonly tiers: Tier[] = [];
  /** Per kind, its tier in `tiers`, or -1. */
  private readonly tierOf: Int8Array;
  private readonly out: TrimLayout = { count: 0, mesh: new Uint16Array(64), owner: new Uint16Array(64), x: new Float32Array(64), y: new Float32Array(64), z: new Float32Array(64), yaw: new Uint16Array(64), tw: new Uint8Array(64), cut: new Uint8Array(64), yields: new Uint8Array(0), borders: 0 };
  private readonly cells = new Cells();
  private readonly round = new Cells();
  private readonly m = new Int32Array(24);
  private readonly at = new Int32Array(2);
  /** The bases of the chunk being laid. */
  private readonly bases: Frame[] = [];
  /**
   * For the chunk being laid, an open table from a base and a cell to a number: a corner's place in the columns below,
   * or TOP for an edge. A slot is of this laying where `gen` says so, so a laying clears nothing.
   */
  private cap = 4096;
  private tk0 = new Uint32Array(this.cap);
  private tk1 = new Uint32Array(this.cap);
  private tgen = new Uint32Array(this.cap);
  private tval = new Int32Array(this.cap);
  private gen = 0;
  private held = 0;
  /**
   * The corners its walls end at, each: its key and base; the ways walls leave it by, a bit each; the storeys its tallest
   * reaches; its highest tier; the first wall met, its reach and tier; its flags; and its joint, as `decide` packs it.
   */
  private corners = 0;
  private ck0 = new Uint32Array(256);
  private ck1 = new Uint32Array(256);
  private cbase = new Uint8Array(256);
  private cmask = new Uint16Array(256);
  private ctall = new Uint8Array(256);
  private ctier = new Int8Array(256);
  private cfirst = new Uint32Array(256);
  private creach = new Uint8Array(256);
  private clike = new Int8Array(256);
  private cflags = new Uint8Array(256);
  private cjoint = new Int32Array(256);
  /** Its walls' ends, each: the wall's slot, its corner, and the way it leaves it by in the low four bits under what of it yields there. */
  private ends = 0;
  private eslot = new Uint16Array(256);
  private ecorner = new Uint32Array(256);
  private ebits = new Uint8Array(256);

  /** `find` gives a mesh's index by its id, or -1. */
  constructor(reg: Registry, find: (id: string) => number, looks: PieceLooks) {
    this.forms = reg.forms;
    this.looks = looks;
    this.tierOf = new Int8Array(reg.defs.length).fill(-1);
    const named = new Map<string, number>();
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k]!;
      if (!this.forms?.def[k] || d.type !== "structure") continue;
      const made = /^([^:]+):mat_(.+)$/.exec(d.material ?? "");
      if (!made) continue;
      const id = `${made[1]}:${made[2]}`;
      if (!named.has(id)) {
        const mesh = (name: string): number => find(`${made[1]}:${name}_${made[2]}`);
        const rule = TIER_RULES[made[2]!] ?? [0, false];
        const sq = mesh("joint_sq");
        named.set(id, this.tiers.length);
        // Without the square joint the tier's meshes are not made to give way, so it has none of the rest either.
        this.tiers.push({ rank: rule[0], runsOn: rule[1], sq, r15: sq < 0 ? -1 : mesh("joint_r15"), r21: sq < 0 ? -1 : mesh("joint_r21"), skirt: sq < 0 ? -1 : mesh("skirt") });
      }
      this.tierOf[k] = named.get(id)!;
    }
    this.any = this.tiers.some((t) => t.sq >= 0);
    // A trim is laid out as a piece is, so its mesh is drawn as one.
    for (const t of this.tiers) for (const mesh of [t.sq, t.r15, t.r21, t.skirt]) if (mesh >= 0) looks.flag[mesh] = DRAW_PIECE;
  }

  /**
   * The trims of chunk `chunk`, whose corner is at (x0, z0) metres, and what its pieces yield; null where it can have
   * none. A corner well inside the chunk is known from the chunk's own walls, gathered in one pass; one by its side is
   * asked of the base's cells, where the next chunk's walls are too.
   */
  lay(store: StructureStore, chunk: number, t: ChunkTable, x0: number, z0: number): TrimLayout | null {
    const forms = this.forms;
    if (!this.any || !forms || !t.fr) return null;
    const out = this.out, bases = this.bases;
    out.count = 0;
    out.borders = 0;
    if (out.yields.length < t.high) out.yields = new Uint8Array(Math.max(t.high, out.yields.length * 2));
    else out.yields.fill(0, 0, t.high);
    bases.length = 0;
    this.gen++;
    this.held = this.corners = this.ends = 0;
    const fr = t.fr, k0 = t.k0!, k1 = t.k1!;
    let slabs = 0, last: Frame | null = null, base = -1;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || fr[s] === 0 || this.tierOf[kind]! < 0) continue;
      const layer = forms.layer[kind]!;
      if (layer !== WALL && layer !== SLAB) continue;
      // What stands within a side of the chunk's edge may meet a piece of the next chunk.
      const lx = t.x[s]! - x0, lz = t.z[s]! - z0;
      const dx = lx < BORDER ? -1 : lx > CHUNK_SIZE - BORDER ? 1 : 0, dz = lz < BORDER ? -1 : lz > CHUNK_SIZE - BORDER ? 1 : 0;
      if (dx !== 0) out.borders |= borderBit(dx, 0);
      if (dz !== 0) out.borders |= borderBit(0, dz);
      if (dx !== 0 && dz !== 0) out.borders |= borderBit(dx, dz);
      if (layer === SLAB) {
        slabs++;
        continue;
      }
      if (last === null || last.gid !== fr[s]) {
        const f = store.frames.get(fr[s]!);
        if (!f) continue;
        base = bases.indexOf(f);
        if (base < 0) base = bases.length < BASES_MOST ? bases.push(f) - 1 : -1;
        last = base < 0 ? null : f;
      }
      if (base >= 0) this.wall(last!, base, chunk * 65536 + s, kind, k0[s]!, k1[s]!, x0, z0);
    }
    for (let c = 0; c < this.corners; c++) this.cjoint[c] = this.decide(store, c);
    for (let e = 0; e < this.ends; e++) {
      const c = this.ecorner[e]!, joint = this.cjoint[c]!;
      if (joint === 0) continue;
      const s = this.eslot[e]!, bits = this.ebits[e]!;
      // The wall that leaves the corner by its lowest way draws the joint.
      if ((bits & 15) === ((joint >> 20) & 15)) {
        keyAnchor(this.ck0[c]!, this.ck1[c]!, this.m, 0);
        this.push(joint & 0xffff, s, bases[this.cbase[c]!]!, this.m, 0, keyLvl(this.ck1[c]!), (joint >> 16) & 15, (joint >> 24) & 15);
      }
      out.yields[s]! |= bits >> 4;
    }
    for (let s = 0; slabs > 0 && s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || fr[s] === 0 || this.tierOf[kind]! < 0 || forms.layer[kind] !== SLAB) continue;
      const f = store.frames.get(fr[s]!);
      const lx = t.x[s]! - x0, lz = t.z[s]! - z0;
      const inside = lx > SLAB_BORDER && lz > SLAB_BORDER && lx < CHUNK_SIZE - SLAB_BORDER && lz < CHUNK_SIZE - SLAB_BORDER;
      if (f) this.slab(store, f, inside ? bases.indexOf(f) : -1, chunk, s, kind, k0[s]!, k1[s]!);
    }
    return out;
  }

  /** The table's slot of a base's cell, or -1; with `add`, a slot made for it, holding -1 until it is given a number. */
  private seek(k0: number, k1x: number, add: boolean): number {
    const mask = this.cap - 1, gen = this.gen;
    let h = Math.imul(k0, 0x9e3779b1) ^ Math.imul(k1x, 0x85ebca6b);
    h ^= h >>> 15;
    for (let i = h & mask; ; i = (i + 1) & mask) {
      if (this.tgen[i] !== gen) {
        if (!add) return -1;
        this.tgen[i] = gen;
        this.tk0[i] = k0;
        this.tk1[i] = k1x;
        this.tval[i] = -1;
        this.held++;
        return i;
      }
      if (this.tk0[i] === k0 && this.tk1[i] === k1x) return i;
    }
  }

  /** Doubles the table once it is half full, so a search is short. */
  private room(): void {
    if (this.held * 2 < this.cap) return;
    const k0 = this.tk0, k1 = this.tk1, gens = this.tgen, vals = this.tval, gen = this.gen;
    this.cap *= 2;
    this.tk0 = new Uint32Array(this.cap);
    this.tk1 = new Uint32Array(this.cap);
    this.tgen = new Uint32Array(this.cap);
    this.tval = new Int32Array(this.cap);
    this.held = 0;
    for (let i = 0; i < k0.length; i++) if (gens[i] === gen) this.tval[this.seek(k0[i]!, k1[i]!, true)] = vals[i]!;
  }

  private push(mesh: number, owner: number, f: Frame, m: Int32Array, mi: number, lvl: number, dir: number, cut: number): void {
    const out = this.out;
    if (out.count === out.mesh.length) {
      const n = out.count * 2;
      out.mesh = grown(out.mesh, n);
      out.owner = grown(out.owner, n);
      out.yaw = grown(out.yaw, n);
      out.x = grown(out.x, n);
      out.y = grown(out.y, n);
      out.z = grown(out.z, n);
      out.tw = grown(out.tw, n);
      out.cut = grown(out.cut, n);
    }
    const i = out.count++;
    worldOf(f.basis, f.ox, f.oz, m, mi, this.at, 0);
    out.mesh[i] = mesh;
    out.owner[i] = owner;
    out.x[i] = this.at[0]! / STRUCT_UNITS;
    out.y[i] = levelY(f.oy, lvl) / STRUCT_UNITS;
    out.z[i] = this.at[1]! / STRUCT_UNITS;
    out.yaw[i] = yawOf(f.yaw, dir);
    out.tw[i] = dir % 3;
    out.cut[i] = cut;
  }

  /** Notes a wall at the corners its cells end at, and its level top over each edge it stands on. `ref` is its own. */
  private wall(f: Frame, base: number, ref: number, kind: number, k0: number, k1: number, x0: number, z0: number): void {
    const forms = this.forms!, cells = this.cells, m = this.m, def = forms.def[kind]!;
    const wide = def.cells, span = Math.max(1, forms.span[kind]!);
    // A wall of one edge and one storey is its own cell.
    if (wide || span > STOREY_LEVELS) {
      if (!formCells(forms, kind, k0, k1, cells)) return;
    } else {
      cells.n = 1;
      cells.k0[0] = k0;
      cells.k1[0] = k1 & CELL;
      cells.reach[0] = span;
    }
    const dir = keyDir(k1), own = ownDir(forms, kind, k1), tier = this.tierOf[kind]!;
    const fitted = this.looks.yields[kind] === 1 && this.tiers[tier]!.sq >= 0;
    const level = def.edges?.[0] === undefined || def.edges[0].profile === "flat";
    let first = 0, last = 0;
    for (const c of wide ?? []) {
      first = Math.min(first, c[0]);
      last = Math.max(last, c[0]);
    }
    keyAnchor(k0, k1, m, 0);
    for (let c = 0; c < cells.n; c++) {
      const along = wide ? wide[c]![0] : 0, lvl = keyLvl(cells.k1[c]!), reach = cells.reach[c]!;
      if (level) {
        this.room();
        this.tval[this.seek(cells.k0[c]!, ((cellAt(cells.k1[c]!, lvl + reach, WALL) & CELL) | (base << 26)) >>> 0, true)] = TOP;
      }
      for (let end = 0; end < 2; end++) {
        // The corner at this end of the cell, and the way the wall leaves it by.
        tupleStep(m, 0, dir, (along + end) * SIDE, m, 4);
        if (!tupleWithin(m, 4, M_MOST)) continue;
        const vk0 = key0(0, m[4]!, m[5]!, m[6]!), vk1 = key1(m[7]!, lvl, 0, WALL, 0, 0), from = dirTurn(dir, end * 6);
        this.room();
        const slot = this.seek(vk0, ((vk1 & CELL) | (base << 26)) >>> 0, true);
        let at = this.tval[slot]!;
        if (at < 0) {
          at = this.tval[slot] = this.corner();
          this.ck0[at] = vk0;
          this.ck1[at] = vk1;
          this.cbase[at] = base;
          this.cfirst[at] = ref;
          this.creach[at] = reach;
          this.clike[at] = tier;
          this.ctier[at] = -1;
          this.cmask[at] = this.ctall[at] = 0;
          // Where the corner is in the chunk: by its side, the next chunk's walls may end at it too.
          worldOf(f.basis, f.ox, f.oz, m, 4, this.at, 0);
          const x = this.at[0]! / STRUCT_UNITS - x0, z = this.at[1]! / STRUCT_UNITS - z0;
          this.cflags[at] = x < CORNER_BORDER || z < CORNER_BORDER || x > CHUNK_SIZE - CORNER_BORDER || z > CHUNK_SIZE - CORNER_BORDER ? EDGE : 0;
        }
        this.meet(at, from, ref, reach, tier);
        if (this.ends === this.eslot.length) {
          this.eslot = grown(this.eslot, this.ends * 2);
          this.ecorner = grown(this.ecorner, this.ends * 2);
          this.ebits = grown(this.ebits, this.ends * 2);
        }
        // Only the ends of the whole piece give way: bit 0 its own -X end, bit 1 its +X.
        const outer = end === 0 ? along === first : along === last;
        this.eslot[this.ends] = ref & 0xffff;
        this.ecorner[this.ends] = at;
        this.ebits[this.ends++] = from | ((fitted && outer ? ((own === dir) === (end === 0) ? 1 : 2) : 0) << 4);
      }
    }
  }

  /** A new corner's place in the columns. */
  private corner(): number {
    if (this.corners === this.ck0.length) {
      const n = this.corners * 2;
      this.ck0 = grown(this.ck0, n);
      this.ck1 = grown(this.ck1, n);
      this.cfirst = grown(this.cfirst, n);
      this.cbase = grown(this.cbase, n);
      this.ctall = grown(this.ctall, n);
      this.creach = grown(this.creach, n);
      this.cflags = grown(this.cflags, n);
      this.cmask = grown(this.cmask, n);
      this.ctier = grown(this.ctier, n);
      this.clike = grown(this.clike, n);
      this.cjoint = grown(this.cjoint, n);
    }
    return this.corners++;
  }

  /** Counts the wall `ref`, of `tier` and `reach` storeys' quarters, among those that leave corner `at` by the way `from`. */
  private meet(at: number, from: number, ref: number, reach: number, tier: number): void {
    this.cmask[at]! |= 1 << from;
    if (this.cfirst[at] !== ref) this.cflags[at]! |= SEVERAL;
    if (reach !== this.creach[at] || tier !== this.clike[at] || !this.tiers[tier]!.runsOn) this.cflags[at]! |= UNALIKE;
    if (reach > this.ctall[at]!) this.ctall[at] = reach;
    if (this.ctier[at]! < 0 || this.tiers[tier]!.rank > this.tiers[this.ctier[at]!]!.rank) this.ctier[at] = tier;
  }

  /**
   * The joint at corner `at`, or 0 for none: its mesh in the low 16 bits, then four bits each its direction, the way
   * of the wall that draws it, and the quarter storeys it is cut to.
   */
  private decide(store: StructureStore, at: number): number {
    const f = this.bases[this.cbase[at]!]!, vk0 = this.ck0[at]!, vk1 = this.ck1[at]!, lvl = keyLvl(vk1);
    // A pillar there is the corner's joint already.
    if (store.occupied.covering(f.gid, vk0, key1(keyM3(vk1), lvl, 0, POST, 0, 0)) >= 0) return 0;
    if ((this.cflags[at]! & EDGE) !== 0) this.ask(store, f, at, lvl);
    else {
      // A wall that begins under this level and reaches it has its joint from there, which this one would stand in.
      for (let under = 1; under < STOREY_LEVELS; under++) {
        const slot = this.seek(vk0, ((key1(keyM3(vk1), lvl - under, 0, WALL, 0, 0) & CELL) | (this.cbase[at]! << 26)) >>> 0, false);
        if (slot >= 0 && this.tval[slot]! >= 0 && this.ctall[this.tval[slot]!]! > under) return 0;
      }
    }
    const mask = this.cmask[at]!, flags = this.cflags[at]!, tier = this.ctier[at]!;
    // One piece through its own middle is no corner.
    if ((flags & UNDER) !== 0 || mask === 0 || tier < 0 || ((flags & SEVERAL) === 0 && (mask & (mask - 1)) !== 0)) return 0;
    const made = this.tiers[tier]!;
    if (made.sq < 0) return 0;
    const lowest = 31 - Math.clz32(mask & -mask);
    if ((mask & (mask - 1)) !== 0 && mask === ((1 << lowest) | (1 << (lowest + 6))) && (flags & UNALIKE) === 0) return 0;
    const cut = this.ctall[at]! < STOREY_LEVELS ? this.ctall[at]! : 0;
    // Every wall along one of the square's four ways: a free end, a corner, a tee, a cross, a straight run.
    const fold = (mask | (mask >> 3) | (mask >> 6) | (mask >> 9)) & 7;
    if ((fold & (fold - 1)) === 0) return made.sq | ((fold >> 1) << 16) | (lowest << 20) | (cut << 24);
    // The least turn between two neighbours, in twelfths: at 60 degrees or under, the wider joint.
    let gap = DIRECTIONS;
    for (let d = lowest + 1, before = lowest; d <= lowest + DIRECTIONS; d++) {
      if ((mask & (1 << (d % DIRECTIONS))) === 0) continue;
      gap = Math.min(gap, d - before);
      before = d;
    }
    const mesh = gap >= 3 && made.r15 >= 0 ? made.r15 : made.r21;
    return mesh < 0 ? 0 : mesh | (lowest << 20) | (cut << 24);
  }

  /** Sets what corner `at` knows of its walls from the base's cells, where the walls of every chunk are. */
  private ask(store: StructureStore, f: Frame, at: number, lvl: number): void {
    const forms = this.forms!, occ = store.occupied, round = this.round;
    vertexEdges(this.ck0[at]!, this.ck1[at]!, lvl, WALL, round);
    this.cmask[at] = this.ctall[at] = 0;
    this.ctier[at] = -1;
    this.cflags[at] = EDGE;
    for (let d = 0, met = false; d < DIRECTIONS; d++) {
      if (round.k0[d] === 0) continue;
      const ref = occ.covering(f.gid, round.k0[d]!, round.k1[d]!);
      if (ref < 0) continue;
      const t = store.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!, tier = this.tierOf[kind]!;
      // The storey of the piece that reaches this level, and how far up it the piece goes on.
      const up = lvl - keyLvl(t.k1![s]!), storey = Math.floor(up / STOREY_LEVELS) * STOREY_LEVELS;
      if (up !== storey || tier < 0) {
        this.cflags[at]! |= UNDER;
        return;
      }
      const reach = Math.min(STOREY_LEVELS, Math.max(1, forms.span[kind]!) - storey);
      if (!met) {
        this.cfirst[at] = ref;
        this.creach[at] = reach;
        this.clike[at] = tier;
        met = true;
      }
      this.meet(at, d, ref, reach, tier);
    }
  }

  /**
   * A slab's sides: a ceiling's yields where a wall under it comes up to it, and a foundation's with no foundation
   * beyond it has a skirt. `base` is its base's place among the chunk's where the walls under it are all the chunk's
   * own, and -1 where the next chunk's may be.
   */
  private slab(store: StructureStore, f: Frame, base: number, chunk: number, s: number, kind: number, k0: number, k1: number): void {
    const forms = this.forms!, def = forms.def[kind]!, occ = store.occupied, cells = this.cells, round = this.round, m = this.m;
    const cls = keyCls(k0);
    if ((cls !== CLS_SQUARE && cls !== CLS_TRIANGLE) || forms.size[kind] !== SIDE || def.corner !== undefined) return;
    const tier = this.tiers[this.tierOf[kind]!]!, lvl = keyLvl(k1), dir = keyDir(k1), own = ownDir(forms, kind, k1);
    const step = CLS_STEP[cls]!, sides = cls === CLS_SQUARE ? 4 : 3;
    if (this.looks.yields[kind] === 1 && tier.sq >= 0) {
      faceEdges(k0, k1, base >= 0 ? lvl : lvl - 1, WALL, cells);
      for (let j = 0; j < sides; j++) {
        if (cells.k0[j] === 0) continue;
        if (base >= 0) {
          if (this.seek(cells.k0[j]!, ((cells.k1[j]! & CELL) | (base << 26)) >>> 0, false) < 0) continue;
        } else {
          const ref = occ.covering(f.gid, cells.k0[j]!, cells.k1[j]!);
          if (ref < 0) continue;
          const t = store.chunks[Math.floor(ref / 65536)]!, under = t.kind[ref & 0xffff]!, top = forms.def[under]!.edges?.[0];
          // The wall owns its top where it is level and comes up to the slab.
          if (keyLvl(t.k1![ref & 0xffff]!) + forms.span[under]! < lvl || (top !== undefined && top.profile !== "flat")) continue;
        }
        if (cls === CLS_SQUARE) {
          // Which way out of the piece the side lies: its own +X is east, and north is a quarter turn on.
          const out = dirTurn(dir + step * j - 3, -own) / 3;
          this.out.yields[s]! |= out === 0 ? 2 : out === 1 ? 1 : out === 2 ? 8 : 4;
        } else {
          // The sides from the piece's own first corner: along its first axis, then up to its far corner, then back.
          const from = (((j - dirTurn(own, -dir) / step) % 3) + 3) % 3;
          this.out.yields[s]! |= from === 0 ? 4 : from === 1 ? 2 : 1;
        }
      }
    }
    if (tier.skirt < 0 || def.root === undefined || def.span !== 0) return;
    const me = chunk * 65536 + s;
    faceEdges(k0, k1, lvl, SLAB, cells);
    keyAnchor(k0, k1, m, 0);
    elementCorners(cls, m, 0, dir, m, 0);
    for (let j = 0; j < sides; j++) {
      if (cells.k0[j] === 0) continue;
      edgeFaces(cells.k0[j]!, cells.k1[j]!, lvl, SLAB, round);
      let open = true;
      for (let n = 0; n < round.n && open; n++) {
        const ref = round.k0[n] === 0 ? -1 : occ.at(f.gid, round.k0[n]!, round.k1[n]!);
        if (ref < 0 || ref === me) continue;
        const beyond = forms.def[store.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!];
        if (beyond && beyond.root !== undefined && beyond.span === 0) open = false;
      }
      if (!open) continue;
      // The middle of the side, the skirt's +X back along it so that its +Z is the way out.
      const along = dirTurn(dir, step * j);
      tupleStep(m, 4 * j, along, SIDE / 2, m, 16);
      this.push(tier.skirt, s, f, m, 16, lvl, dirTurn(along, 6), 0);
    }
  }
}

/** A column twice as long, or `n` long, holding what it held. */
function grown<T extends Uint8Array | Int8Array | Uint16Array | Uint32Array | Int32Array | Float32Array>(a: T, n: number): T {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a);
  return b;
}
