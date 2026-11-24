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
//
// A chunk's corners are kept between layings (Laid). The next laying takes out and puts in only the pieces that changed,
// decides again the corners and slabs those turn on, and lists the trims from what is kept.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../../shared/coords.ts";
import { levelY, worldOf, yawOf } from "../../../shared/world/lattice/basis.ts";
import { FORM_LAYERS, STOREY_LEVELS, type FormTable } from "../../../shared/world/lattice/forms.ts";
import { ownDir, type Frame } from "../../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, CLS_VERTEX, DIRECTIONS, LVL_MOST, M_MOST, SIDE, dirTurn, elementCorners, key0, key1, keyAnchor, keyCls, keyDir, keyLvl, keyM3, tupleStep, tupleWithin } from "../../../shared/world/lattice/module.ts";
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
/** A corner's flags: walls of more than one piece end at it; they are not alike, or their tier does not run on; one begins under its level; the next chunk's walls may end at it; it is to be decided again. */
const SEVERAL = 1, UNALIKE = 2, UNDER = 4, EDGE = 8, AGAIN = 16;
/** In the table: a slot never used; a cell no corner or top is at now; an edge whose wall has a level top at the key's level, and one less for each wall more. */
const FREE = -0x80000000;
const NONE = -1;
const TOP = -2;
/** What a slot is to a laying: a wall its corners are kept of, a slab, a pillar, a wall or slab of no tier, and a slab to be asked again. */
const S_WALL = 1, S_SLAB = 2, S_POST = 4, S_ODD = 8, S_AGAIN = 16;
/** A slot's or a corner's place by the chunk's sides, (dz + 1) * 3 + dx + 1: this one is by none. */
const INSIDE = 4;
/** Per such place, the chunks round the chunk that what stands there may turn on, a bit each by the same number. */
const TURNS_ON = Array.from({ length: 9 }, (_, n) => {
  const dx = (n % 3) - 1, dz = Math.floor(n / 3) - 1;
  return (dx !== 0 ? 1 << (4 + dx) : 0) | (dz !== 0 ? 1 << (4 + 3 * dz) : 0) | (dx !== 0 && dz !== 0 ? 1 << n : 0);
});

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

/** What is kept of a chunk's laying: its walls by the corners they end at, and what each slot gave. */
class Laid {
  store: StructureStore | null = null;
  t: ChunkTable | null = null;
  /** A piece was left out for want of its frame or of room among the bases: the next laying is whole. */
  partial = false;
  /** The bases its walls stand in, and how many walls of each it holds. */
  readonly bases: Frame[] = [];
  readonly walls: number[] = [];
  /** How many pillars it holds; how many walls and slabs stand by each of its sides (INSIDE); and the tables of the chunks round it, each with its `shape` when last laid. */
  posts = 0;
  readonly near = new Int32Array(9);
  readonly tables: (ChunkTable | null)[] = [null, null, null, null, null, null, null, null, null];
  readonly shapes = new Int32Array(9);
  /** An open table from a base and a cell to a number: a corner's place in the columns below, NONE, or TOP and under for an edge. */
  cap = 0;
  tk0 = new Uint32Array(0);
  tk1 = new Uint32Array(0);
  tval = new Int32Array(0);
  held = 0;
  /**
   * The corners its walls end at, each: its key and base; where it stands, and by which sides (INSIDE); the ways walls leave it by, a bit each; the
   * storeys its tallest reaches; its highest tier; the first wall met, its reach and tier; its flags; its joint, as
   * `decide` packs it; and the first of its walls' ends.
   */
  corners = 0;
  ck0 = new Uint32Array(256);
  ck1 = new Uint32Array(256);
  cbase = new Uint8Array(256);
  cx = new Float32Array(256);
  cz = new Float32Array(256);
  cnear = new Uint8Array(256);
  cmask = new Uint16Array(256);
  ctall = new Uint8Array(256);
  ctier = new Int8Array(256);
  cfirst = new Uint32Array(256);
  creach = new Uint8Array(256);
  clike = new Int8Array(256);
  cflags = new Uint8Array(256);
  cjoint = new Int32Array(256);
  chead = new Int32Array(256);
  /** Its walls' ends, each: the wall's slot, its corner, the way it leaves it by in the low four bits under what of it yields there, its reach and tier, and the next end at its corner. `dead` of them are of walls gone. */
  ends = 0;
  dead = 0;
  eslot = new Uint16Array(256);
  ecorner = new Uint32Array(256);
  ebits = new Uint8Array(256);
  ereach = new Uint8Array(256);
  etier = new Int8Array(256);
  enext = new Int32Array(256);
  /** Per slot: the kind, frame and key it was told with, 0 for none; what it is (S_); its base among `bases`; its side (INSIDE); its ends, the first and how many; and a slab's yield in the low four bits under the sides it has a skirt on. */
  high = 0;
  sKind = new Uint16Array(0);
  sFr = new Uint32Array(0);
  sK0 = new Uint32Array(0);
  sK1 = new Uint32Array(0);
  sRole = new Uint8Array(0);
  sBase = new Int8Array(0);
  sNear = new Uint8Array(0);
  sEnd = new Int32Array(0);
  sEnds = new Uint8Array(0);
  sSlab = new Uint8Array(0);

  /** Forgets everything, with room for `high` slots and a table for about `keys` cells. */
  clear(high: number, keys: number): void {
    this.partial = false;
    this.bases.length = this.walls.length = 0;
    this.posts = 0;
    this.near.fill(0);
    let cap = 256;
    while (cap < keys * 2) cap *= 2;
    if (cap !== this.cap) {
      this.cap = cap;
      this.tk0 = new Uint32Array(cap);
      this.tk1 = new Uint32Array(cap);
      this.tval = new Int32Array(cap);
    }
    this.tval.fill(FREE);
    this.held = this.corners = this.ends = this.dead = 0;
    this.high = 0;
    this.slots(high);
    this.sKind.fill(0);
    this.sRole.fill(0);
    this.sSlab.fill(0);
    this.sEnds.fill(0);
    this.high = high;
  }

  /** Room for `high` slots, those past the ones it had told of nothing. */
  slots(high: number): void {
    if (this.sKind.length >= high) return;
    const n = Math.max(high, this.sKind.length * 2);
    this.sKind = grown(this.sKind, n);
    this.sFr = grown(this.sFr, n);
    this.sK0 = grown(this.sK0, n);
    this.sK1 = grown(this.sK1, n);
    this.sRole = grown(this.sRole, n);
    this.sBase = grown(this.sBase, n);
    this.sNear = grown(this.sNear, n);
    this.sEnd = grown(this.sEnd, n);
    this.sEnds = grown(this.sEnds, n);
    this.sSlab = grown(this.sSlab, n);
  }
}

export class Trims {
  /** Whether any tier has trims. With none, nothing is laid and no piece yields. */
  readonly any: boolean;
  /** Whether a laying keeps what the one before found of its chunk. False lays every chunk whole each time, for a before and after. */
  incremental = true;
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
  /** What is kept of each chunk laid, and the chunk being laid: its store, table and corner. */
  private readonly kept = new Map<number, Laid>();
  private w = new Laid();
  private store!: StructureStore;
  private t!: ChunkTable;
  private chunk = 0;
  private x0 = 0;
  private z0 = 0;
  /** The frame last asked of the store in this laying, by its gid. */
  private lastGid = 0;
  private last: Frame | undefined = undefined;
  /** Scratch for a laying: the slots that changed, the corners and slabs to be decided again, and each base's walls before. */
  private changed = new Int32Array(64);
  private readonly again: number[] = [];
  private readonly slabs: number[] = [];
  private readonly had: number[] = [];

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

  /** Lets go of what is kept of `chunk`. */
  forget(chunk: number): void {
    this.kept.delete(chunk);
  }

  /**
   * The trims of chunk `chunk`, whose corner is at (x0, z0) metres, and what its pieces yield; null where it can have
   * none. A corner well inside the chunk is known from the chunk's own walls; one by its side is asked of the base's
   * cells, where the next chunk's walls are too. Where the chunk was laid before and the chunks round it stand as they
   * did, only the pieces changed since are taken out and put in.
   */
  lay(store: StructureStore, chunk: number, t: ChunkTable, x0: number, z0: number): TrimLayout | null {
    if (!this.any || !this.forms || !t.fr) {
      this.kept.delete(chunk);
      return null;
    }
    let w = this.kept.get(chunk);
    if (!w) this.kept.set(chunk, (w = new Laid()));
    this.w = w;
    this.store = store;
    this.t = t;
    this.chunk = chunk;
    this.x0 = x0;
    this.z0 = z0;
    this.lastGid = 0;
    const round = this.around();
    if (!(this.incremental && w.store === store && w.t === t && !w.partial && this.update(round))) this.whole();
    return this.list();
  }

  /** Notes the tables of the chunks round the one being laid and their `shape`. Returns those that changed since it was last laid, a bit each by (dz + 1) * 3 + dx + 1. */
  private around(): number {
    const w = this.w, dims = this.store.dims, cx = chunkCx(dims, this.chunk), cz = chunkCz(dims, this.chunk);
    let changed = 0;
    for (let n = 0; n < 9; n++) {
      const x = cx + (n % 3) - 1, z = cz + Math.floor(n / 3) - 1;
      const t = n === INSIDE || x < 0 || z < 0 || x >= dims.chunksX || z >= dims.chunksZ ? null : (this.store.chunks[z * dims.chunksX + x] ?? null);
      const shape = t ? t.shape : 0;
      if (t !== w.tables[n] || shape !== w.shapes[n]) changed |= 1 << n;
      w.tables[n] = t;
      w.shapes[n] = shape;
    }
    return changed;
  }

  /** The store's frame `gid`, or undefined. */
  private frame(gid: number): Frame | undefined {
    if (gid !== this.lastGid) {
      this.lastGid = gid;
      this.last = this.store.frames.get(gid);
    }
    return this.last;
  }

  /** Lays the chunk afresh: every piece put in, then every corner and slab decided. */
  private whole(): void {
    const w = this.w, t = this.t, fr = t.fr!;
    w.clear(t.high, t.live);
    w.store = this.store;
    w.t = t;
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && fr[s] !== 0) this.enter(s, false);
    for (let c = 0; c < w.corners; c++) w.cjoint[c] = this.decide(c);
    for (let s = 0; s < t.high; s++) if ((w.sRole[s]! & S_SLAB) !== 0) w.sSlab[s] = this.slab(s);
  }

  /**
   * Brings what is kept up to date with the slots changed since, where those are few and none asks for a whole laying;
   * and where a chunk round it that `round` names changed, asks again the corners and slabs by that side. Whether it could.
   */
  private update(round: number): boolean {
    const w = this.w, t = this.t, fr = t.fr!, k0 = t.k0!, k1 = t.k1!, high = t.high;
    if (w.dead > Math.max(1024, w.ends - w.dead)) return false;
    for (const f of w.bases) if (this.frame(f.gid) !== f) return false;
    w.slots(high);
    const most = Math.max(64, high >> 4), to = Math.max(high, w.high);
    if (this.changed.length < most) this.changed = new Int32Array(most);
    let n = 0;
    for (let s = 0; s < to; s++) {
      const kind = s < high && fr[s] !== 0 ? t.kind[s]! : 0;
      if (kind === w.sKind[s] && (kind === 0 || (fr[s] === w.sFr[s] && k0[s] === w.sK0[s] && k1[s] === w.sK1[s]))) continue;
      if (n === most) return false;
      this.changed[n++] = s;
    }
    w.high = high;
    if (n === 0 && round === 0) return true;
    const had = this.had, again = this.again, slabs = this.slabs;
    had.length = again.length = slabs.length = 0;
    if (round !== 0) {
      for (let c = 0; c < w.corners; c++) if ((w.cflags[c]! & EDGE) !== 0 && (TURNS_ON[w.cnear[c]!]! & round) !== 0) this.redo(c);
      for (let s = 0; s < high; s++) if ((w.sRole[s]! & S_SLAB) !== 0 && (TURNS_ON[w.sNear[s]!]! & round) !== 0) this.ask(s);
    }
    for (let b = 0; b < w.walls.length; b++) had.push(w.walls[b]!);
    for (let i = 0; i < n; i++) {
      const s = this.changed[i]!;
      if (w.sKind[s] !== 0 && !this.leave(s)) return false;
      if (s < high && fr[s] !== 0 && t.kind[s] !== 0 && !this.enter(s, true)) return false;
    }
    // A base whose last wall here went has its slabs ask the base's cells, as one with no wall here does.
    for (let b = 0; b < had.length; b++) if (had[b]! > 0 && w.walls[b] === 0) return false;
    for (const c of again) this.gather(c);
    for (const c of again) w.cjoint[c] = this.decide(c);
    for (const s of slabs) {
      if ((w.sRole[s]! & S_AGAIN) === 0) continue;
      w.sRole[s]! &= ~S_AGAIN;
      if ((w.sRole[s]! & S_SLAB) !== 0) w.sSlab[s] = this.slab(s);
    }
    return !w.partial;
  }

  /** Lists the trims and what yields from what is kept: each joint by the wall that leaves its corner by its lowest way, in the walls' order, then each slab's skirts. */
  private list(): TrimLayout {
    const w = this.w, out = this.out, high = this.t.high, slabs = this.slabs;
    out.count = 0;
    out.borders = 0;
    for (let n = 0; n < 9; n++) {
      if (n === INSIDE || w.near[n] === 0) continue;
      const dx = (n % 3) - 1, dz = Math.floor(n / 3) - 1;
      if (dx !== 0) out.borders |= borderBit(dx, 0);
      if (dz !== 0) out.borders |= borderBit(0, dz);
      if (dx !== 0 && dz !== 0) out.borders |= borderBit(dx, dz);
    }
    if (out.yields.length < high) out.yields = new Uint8Array(Math.max(high, out.yields.length * 2));
    else out.yields.fill(0, 0, high);
    const yields = out.yields, sEnd = w.sEnd, sEnds = w.sEnds, sRole = w.sRole, ecorner = w.ecorner, ebits = w.ebits, cjoint = w.cjoint;
    slabs.length = 0;
    for (let s = 0; s < high; s++) {
      const role = sRole[s]!;
      if (role === 0) continue;
      if ((role & S_SLAB) !== 0) {
        if (w.sSlab[s] !== 0) slabs.push(s);
        continue;
      }
      for (let e = sEnd[s]!, end = e + sEnds[s]!; e < end; e++) {
        const c = ecorner[e]!, joint = cjoint[c]!;
        if (joint === 0) continue;
        const bits = ebits[e]!;
        if ((bits & 15) === ((joint >> 20) & 15)) {
          const f = w.bases[w.cbase[c]!]!, dir = (joint >> 16) & 15;
          const i = this.room();
          out.mesh[i] = joint & 0xffff;
          out.owner[i] = s;
          out.x[i] = w.cx[c]!;
          out.y[i] = levelY(f.oy, keyLvl(w.ck1[c]!)) / STRUCT_UNITS;
          out.z[i] = w.cz[c]!;
          out.yaw[i] = yawOf(f.yaw, dir);
          out.tw[i] = dir % 3;
          out.cut[i] = (joint >> 24) & 15;
        }
        yields[s]! |= bits >> 4;
      }
    }
    for (const s of slabs) {
      const v = w.sSlab[s]!;
      yields[s]! |= v & 15;
      if (v >> 4 !== 0) this.skirts(s, v >> 4);
    }
    slabs.length = 0;
    return out;
  }

  /** Room for one more trim in the layout: its place. */
  private room(): number {
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
    return out.count++;
  }

  /** The skirts of the foundation in slot `s`, on the sides `sides` names a bit each: at the middle of the side, +X back along it so that +Z is the way out. */
  private skirts(s: number, sides: number): void {
    const t = this.t, m = this.m, out = this.out, kind = t.kind[s]!, k0 = t.k0![s]!, k1 = t.k1![s]!;
    const f = this.frame(t.fr![s]!);
    if (!f) return;
    const cls = keyCls(k0), dir = keyDir(k1), step = CLS_STEP[cls]!, mesh = this.tiers[this.tierOf[kind]!]!.skirt;
    keyAnchor(k0, k1, m, 0);
    elementCorners(cls, m, 0, dir, m, 0);
    for (let j = 0; j < 4; j++) {
      if ((sides & (1 << j)) === 0) continue;
      const along = dirTurn(dir, step * j), way = dirTurn(along, 6);
      tupleStep(m, 4 * j, along, SIDE / 2, m, 16);
      worldOf(f.basis, f.ox, f.oz, m, 16, this.at, 0);
      const i = this.room();
      out.mesh[i] = mesh;
      out.owner[i] = s;
      out.x[i] = this.at[0]! / STRUCT_UNITS;
      out.y[i] = levelY(f.oy, keyLvl(k1)) / STRUCT_UNITS;
      out.z[i] = this.at[1]! / STRUCT_UNITS;
      out.yaw[i] = yawOf(f.yaw, way);
      out.tw[i] = way % 3;
      out.cut[i] = 0;
    }
  }

  /** The table's slot of a base's cell, or -1; with `add`, a slot made for it, holding NONE until it is given a number. */
  private seek(k0: number, k1x: number, add: boolean): number {
    const w = this.w, mask = w.cap - 1, tk0 = w.tk0, tk1 = w.tk1, tval = w.tval;
    let h = Math.imul(k0, 0x9e3779b1) ^ Math.imul(k1x, 0x85ebca6b);
    h ^= h >>> 15;
    for (let i = h & mask; ; i = (i + 1) & mask) {
      if (tval[i] === FREE) {
        if (!add) return -1;
        if (w.held * 2 >= w.cap) {
          this.widen();
          return this.seek(k0, k1x, true);
        }
        tk0[i] = k0;
        tk1[i] = k1x;
        tval[i] = NONE;
        w.held++;
        return i;
      }
      if (tk0[i] === k0 && tk1[i] === k1x) return i;
    }
  }

  /** Doubles the table once it is half full, so a search is short. */
  private widen(): void {
    const w = this.w, k0 = w.tk0, k1 = w.tk1, vals = w.tval;
    w.cap *= 2;
    w.tk0 = new Uint32Array(w.cap);
    w.tk1 = new Uint32Array(w.cap);
    w.tval = new Int32Array(w.cap).fill(FREE);
    w.held = 0;
    for (let i = 0; i < vals.length; i++) if (vals[i] !== FREE) w.tval[this.seek(k0[i]!, k1[i]!, true)] = vals[i]!;
  }

  /** The key a corner of base `base` is in the table by: its vertex's cell at `lvl`. */
  private cornerKey(k1: number, lvl: number, base: number): number {
    return ((key1(keyM3(k1), lvl, 0, WALL, 0, 0) & CELL) | (base << 26)) >>> 0;
  }

  /**
   * Tells what is kept of the piece now in slot `s`. With `mark`, the corners and slabs it turns are noted to be decided
   * again; false where only a whole laying can take it in.
   */
  private enter(s: number, mark: boolean): boolean {
    const w = this.w, t = this.t, forms = this.forms!, kind = t.kind[s]!, gid = t.fr![s]!, k0 = t.k0![s]!, k1 = t.k1![s]!;
    w.sKind[s] = kind;
    w.sFr[s] = gid;
    w.sK0[s] = k0;
    w.sK1[s] = k1;
    w.sRole[s] = 0;
    w.sEnds[s] = 0;
    w.sSlab[s] = 0;
    const layer = forms.layer[kind]!;
    if (layer === POST) {
      if (keyCls(k0) !== CLS_VERTEX) return true;
      w.sRole[s] = S_POST;
      w.posts++;
      if (mark) this.pillar(gid, k0, k1, forms.span[kind]!);
      return true;
    }
    if (layer !== WALL && layer !== SLAB) return true;
    // A wall or slab of no tier has no trims, but a corner or a slab by the chunk's side that meets it reads it of the base's cells.
    if (this.tierOf[kind]! < 0) {
      w.sRole[s] = S_ODD;
      return !mark;
    }
    // What stands within a side of the chunk's edge may meet a piece of the next chunk.
    const near = sideOf(t.x[s]! - this.x0, t.z[s]! - this.z0);
    w.sNear[s] = near;
    w.near[near]!++;
    if (layer === SLAB) {
      w.sRole[s] = S_SLAB;
      if (mark) {
        this.ask(s);
        this.beside(gid, k0, k1);
      }
      return true;
    }
    w.sRole[s] = S_WALL;
    w.sBase[s] = -1;
    const f = this.frame(gid);
    let base = f ? w.bases.indexOf(f) : -1;
    // A base's first wall here turns its slabs from the base's cells to the chunk's own walls.
    if (base < 0 && mark) return false;
    if (base < 0 && f && w.bases.length < BASES_MOST) {
      base = w.bases.push(f) - 1;
      w.walls.push(0);
    }
    if (base < 0) {
      w.partial = true;
      return true;
    }
    w.sBase[s] = base;
    w.walls[base]!++;
    this.wall(f!, base, s, kind, k0, k1, mark);
    return true;
  }

  /** Takes out of what is kept the piece slot `s` was told with, noting what it turned to be decided again. False where only a whole laying can. */
  private leave(s: number): boolean {
    const w = this.w, forms = this.forms!, role = w.sRole[s]!, kind = w.sKind[s]!, gid = w.sFr[s]!, k0 = w.sK0[s]!, k1 = w.sK1[s]!;
    w.sKind[s] = 0;
    w.sRole[s] = 0;
    if ((role & S_ODD) !== 0) return false;
    if ((role & S_POST) !== 0) {
      w.posts--;
      this.pillar(gid, k0, k1, forms.span[kind]!);
      return true;
    }
    if ((role & (S_WALL | S_SLAB)) === 0) return true;
    w.near[w.sNear[s]!]!--;
    if ((role & S_SLAB) !== 0) {
      w.sSlab[s] = 0;
      this.beside(gid, k0, k1);
      return true;
    }
    const base = w.sBase[s]!;
    if (base < 0) return true;
    w.walls[base]!--;
    for (let e = w.sEnd[s]!, end = e + w.sEnds[s]!; e < end; e++) {
      const c = w.ecorner[e]!;
      let before = -1, at = w.chead[c]!;
      while (at !== e) {
        before = at;
        at = w.enext[at]!;
      }
      if (before < 0) w.chead[c] = w.enext[e]!;
      else w.enext[before] = w.enext[e]!;
      this.over(c);
    }
    w.dead += w.sEnds[s]!;
    w.sEnds[s] = 0;
    this.tops(gid, base, kind, k0, k1, false, true);
    return true;
  }

  /** The cells of a wall of `kind` at this key, to `cells`: its own where it is of one edge and one storey. False if one is off the lattice. */
  private wallCells(kind: number, k0: number, k1: number): boolean {
    const forms = this.forms!, cells = this.cells, span = Math.max(1, forms.span[kind]!);
    if (forms.def[kind]!.cells || span > STOREY_LEVELS) return formCells(forms, kind, k0, k1, cells);
    cells.n = 1;
    cells.k0[0] = k0;
    cells.k1[0] = k1 & CELL;
    cells.reach[0] = span;
    return true;
  }

  /** Counts in, or out, a wall's level top over each edge it stands on, and with `mark` notes the slabs that may rest on it to be asked again. */
  private tops(gid: number, base: number, kind: number, k0: number, k1: number, comes: boolean, mark: boolean): void {
    const w = this.w, cells = this.cells, def = this.forms!.def[kind]!;
    if (!this.wallCells(kind, k0, k1)) return;
    const level = def.edges?.[0] === undefined || def.edges[0].profile === "flat";
    const occ = this.store.occupied, round = this.round;
    for (let c = 0; c < cells.n; c++) {
      const lvl = keyLvl(cells.k1[c]!), reach = cells.reach[c]!;
      if (level) {
        const slot = this.seek(cells.k0[c]!, ((cellAt(cells.k1[c]!, lvl + reach, WALL) & CELL) | (base << 26)) >>> 0, true), v = w.tval[slot]!;
        w.tval[slot] = comes ? (v === NONE ? TOP : v - 1) : v === TOP ? NONE : v + 1;
      }
      // A slab whose side this edge is yields to the wall where it stands one level or more under the slab.
      for (let up = 1; mark && up <= reach && lvl + up <= LVL_MOST; up++) {
        edgeFaces(cells.k0[c]!, cells.k1[c]!, lvl + up, SLAB, round);
        for (let n = 0; n < round.n; n++) {
          const ref = round.k0[n] === 0 ? -1 : occ.at(gid, round.k0[n]!, round.k1[n]!);
          if (ref >= 0 && Math.floor(ref / 65536) === this.chunk) this.ask(ref & 0xffff);
        }
      }
    }
  }

  /** Notes the slab in slot `s` to be asked again. */
  private ask(s: number): void {
    const w = this.w;
    if (s >= w.sRole.length || (w.sRole[s]! & S_AGAIN) !== 0) return;
    w.sRole[s]! |= S_AGAIN;
    this.slabs.push(s);
  }

  /** Notes the slabs beyond each side of the face a key names to be asked again: a foundation's skirt turns on the one beyond. */
  private beside(gid: number, k0: number, k1: number): void {
    const cls = keyCls(k0);
    if (cls !== CLS_SQUARE && cls !== CLS_TRIANGLE) return;
    const occ = this.store.occupied, cells = this.cells, round = this.round, lvl = keyLvl(k1);
    faceEdges(k0, k1, lvl, SLAB, cells);
    for (let j = 0; j < cells.n; j++) {
      if (cells.k0[j] === 0) continue;
      edgeFaces(cells.k0[j]!, cells.k1[j]!, lvl, SLAB, round);
      for (let n = 0; n < round.n; n++) {
        const ref = round.k0[n] === 0 ? -1 : occ.at(gid, round.k0[n]!, round.k1[n]!);
        if (ref >= 0 && Math.floor(ref / 65536) === this.chunk) this.ask(ref & 0xffff);
      }
    }
  }

  /** Notes the corners a pillar at this key stands in, or stood in, to be decided again. */
  private pillar(gid: number, k0: number, k1: number, span: number): void {
    const w = this.w;
    let base = w.bases.length - 1;
    while (base >= 0 && w.bases[base]!.gid !== gid) base--;
    if (base < 0) return;
    const lvl = keyLvl(k1), deep = Math.max(STOREY_LEVELS, this.store.occupied.deep[POST]! + 1);
    for (let at = lvl; at < lvl + Math.max(1, span) + deep && at <= LVL_MOST; at++) {
      const slot = this.seek(k0, this.cornerKey(k1, at, base), false);
      if (slot >= 0 && w.tval[slot]! >= 0) this.redo(w.tval[slot]!);
    }
  }

  /** Notes corner `c` to be decided again. */
  private redo(c: number): void {
    const w = this.w;
    if ((w.cflags[c]! & AGAIN) !== 0) return;
    w.cflags[c]! |= AGAIN;
    this.again.push(c);
  }

  /** Notes corner `c`, and each corner up to a storey over it that a wall from its level reaches, to be decided again. */
  private over(c: number): void {
    const w = this.w, lvl = keyLvl(w.ck1[c]!);
    this.redo(c);
    for (let up = 1; up < STOREY_LEVELS && lvl + up <= LVL_MOST; up++) {
      const slot = this.seek(w.ck0[c]!, this.cornerKey(w.ck1[c]!, lvl + up, w.cbase[c]!), false);
      if (slot >= 0 && w.tval[slot]! >= 0) this.redo(w.tval[slot]!);
    }
  }

  /** Sets what corner `c` knows of the walls that end at it from their ends, as meeting them one by one does. */
  private gather(c: number): void {
    const w = this.w, chunk = this.chunk * 65536;
    w.cmask[c] = w.ctall[c] = 0;
    w.ctier[c] = -1;
    w.cflags[c]! &= EDGE;
    for (let e = w.chead[c]!, first = true; e >= 0; e = w.enext[e]!, first = false) {
      const ref = chunk + w.eslot[e]!;
      if (first) {
        w.cfirst[c] = ref;
        w.creach[c] = w.ereach[e]!;
        w.clike[c] = w.etier[e]!;
      }
      this.meet(c, w.ebits[e]! & 15, ref, w.ereach[e]!, w.etier[e]!);
    }
  }

  /** Notes the wall in slot `s` at the corners its cells end at, and its level top over each edge it stands on. With `mark` its corners are gathered and decided after. */
  private wall(f: Frame, base: number, s: number, kind: number, k0: number, k1: number, mark: boolean): void {
    const w = this.w, forms = this.forms!, cells = this.cells, m = this.m, def = forms.def[kind]!;
    w.sEnd[s] = w.ends;
    this.tops(f.gid, base, kind, k0, k1, true, mark);
    if (!this.wallCells(kind, k0, k1)) return;
    const wide = def.cells, ref = this.chunk * 65536 + s;
    const dir = keyDir(k1), own = ownDir(forms, kind, k1), tier = this.tierOf[kind]!;
    const fitted = this.looks.yields[kind] === 1 && this.tiers[tier]!.sq >= 0;
    let first = 0, last = 0;
    for (const c of wide ?? []) {
      first = Math.min(first, c[0]);
      last = Math.max(last, c[0]);
    }
    keyAnchor(k0, k1, m, 0);
    for (let c = 0; c < cells.n; c++) {
      const along = wide ? wide[c]![0] : 0, lvl = keyLvl(cells.k1[c]!), reach = cells.reach[c]!;
      for (let end = 0; end < 2; end++) {
        // The corner at this end of the cell, and the way the wall leaves it by.
        tupleStep(m, 0, dir, (along + end) * SIDE, m, 4);
        if (!tupleWithin(m, 4, M_MOST)) continue;
        const vk0 = key0(0, m[4]!, m[5]!, m[6]!), vk1 = key1(m[7]!, lvl, 0, WALL, 0, 0), from = dirTurn(dir, end * 6);
        const slot = this.seek(vk0, ((vk1 & CELL) | (base << 26)) >>> 0, true);
        let at = w.tval[slot]!;
        const made = at < 0;
        if (made) {
          at = w.tval[slot] = this.corner();
          w.ck0[at] = vk0;
          w.ck1[at] = vk1;
          w.cbase[at] = base;
          w.cfirst[at] = ref;
          w.creach[at] = reach;
          w.clike[at] = tier;
          w.ctier[at] = -1;
          w.cmask[at] = w.ctall[at] = 0;
          w.cjoint[at] = 0;
          w.chead[at] = -1;
          // Where the corner is in the chunk: by its side, the next chunk's walls may end at it too.
          worldOf(f.basis, f.ox, f.oz, m, 4, this.at, 0);
          const x = (w.cx[at] = this.at[0]! / STRUCT_UNITS) - this.x0, z = (w.cz[at] = this.at[1]! / STRUCT_UNITS) - this.z0;
          w.cflags[at] = x < CORNER_BORDER || z < CORNER_BORDER || x > CHUNK_SIZE - CORNER_BORDER || z > CHUNK_SIZE - CORNER_BORDER ? EDGE : 0;
          w.cnear[at] = sideOf(x, z);
        }
        if (mark) this.over(at);
        else this.meet(at, from, ref, reach, tier);
        if (w.ends === w.eslot.length) {
          const n = w.ends * 2;
          w.eslot = grown(w.eslot, n);
          w.ecorner = grown(w.ecorner, n);
          w.ebits = grown(w.ebits, n);
          w.ereach = grown(w.ereach, n);
          w.etier = grown(w.etier, n);
          w.enext = grown(w.enext, n);
        }
        // Only the ends of the whole piece give way: bit 0 its own -X end, bit 1 its +X.
        const outer = end === 0 ? along === first : along === last, e = w.ends++;
        w.eslot[e] = s;
        w.ecorner[e] = at;
        w.ebits[e] = from | ((fitted && outer ? ((own === dir) === (end === 0) ? 1 : 2) : 0) << 4);
        w.ereach[e] = reach;
        w.etier[e] = tier;
        w.enext[e] = w.chead[at]!;
        w.chead[at] = e;
        w.sEnds[s]!++;
      }
    }
  }

  /** A new corner's place in the columns. */
  private corner(): number {
    const w = this.w;
    if (w.corners === w.ck0.length) {
      const n = w.corners * 2;
      w.ck0 = grown(w.ck0, n);
      w.ck1 = grown(w.ck1, n);
      w.cx = grown(w.cx, n);
      w.cz = grown(w.cz, n);
      w.cnear = grown(w.cnear, n);
      w.cfirst = grown(w.cfirst, n);
      w.cbase = grown(w.cbase, n);
      w.ctall = grown(w.ctall, n);
      w.creach = grown(w.creach, n);
      w.cflags = grown(w.cflags, n);
      w.cmask = grown(w.cmask, n);
      w.ctier = grown(w.ctier, n);
      w.clike = grown(w.clike, n);
      w.cjoint = grown(w.cjoint, n);
      w.chead = grown(w.chead, n);
    }
    return w.corners++;
  }

  /** Counts the wall `ref`, of `tier` and `reach` storeys' quarters, among those that leave corner `at` by the way `from`. */
  private meet(at: number, from: number, ref: number, reach: number, tier: number): void {
    const w = this.w;
    w.cmask[at]! |= 1 << from;
    if (w.cfirst[at] !== ref) w.cflags[at]! |= SEVERAL;
    if (reach !== w.creach[at] || tier !== w.clike[at] || !this.tiers[tier]!.runsOn) w.cflags[at]! |= UNALIKE;
    if (reach > w.ctall[at]!) w.ctall[at] = reach;
    if (w.ctier[at]! < 0 || this.tiers[tier]!.rank > this.tiers[w.ctier[at]!]!.rank) w.ctier[at] = tier;
  }

  /**
   * The joint at corner `at`, or 0 for none: its mesh in the low 16 bits, then four bits each its direction, the way
   * of the wall that draws it, and the quarter storeys it is cut to.
   */
  private decide(at: number): number {
    const w = this.w, store = this.store;
    const f = w.bases[w.cbase[at]!]!, vk0 = w.ck0[at]!, vk1 = w.ck1[at]!, lvl = keyLvl(vk1), edge = (w.cflags[at]! & EDGE) !== 0;
    // A pillar there is the corner's joint already. One at a corner well inside the chunk is a row of the chunk's own.
    if ((edge || w.posts > 0) && store.occupied.covering(f.gid, vk0, key1(keyM3(vk1), lvl, 0, POST, 0, 0)) >= 0) return 0;
    if (edge) this.asked(f, at, lvl);
    else {
      // A wall that begins under this level and reaches it has its joint from there, which this one would stand in.
      for (let under = 1; under < STOREY_LEVELS; under++) {
        const slot = this.seek(vk0, this.cornerKey(vk1, lvl - under, w.cbase[at]!), false);
        if (slot >= 0 && w.tval[slot]! >= 0 && w.ctall[w.tval[slot]!]! > under) return 0;
      }
    }
    const mask = w.cmask[at]!, flags = w.cflags[at]!, tier = w.ctier[at]!;
    // One piece through its own middle is no corner.
    if ((flags & UNDER) !== 0 || mask === 0 || tier < 0 || ((flags & SEVERAL) === 0 && (mask & (mask - 1)) !== 0)) return 0;
    const made = this.tiers[tier]!;
    if (made.sq < 0) return 0;
    const lowest = 31 - Math.clz32(mask & -mask);
    if ((mask & (mask - 1)) !== 0 && mask === ((1 << lowest) | (1 << (lowest + 6))) && (flags & UNALIKE) === 0) return 0;
    const cut = w.ctall[at]! < STOREY_LEVELS ? w.ctall[at]! : 0;
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
  private asked(f: Frame, at: number, lvl: number): void {
    const w = this.w, store = this.store, forms = this.forms!, occ = store.occupied, round = this.round;
    vertexEdges(w.ck0[at]!, w.ck1[at]!, lvl, WALL, round);
    w.cmask[at] = w.ctall[at] = 0;
    w.ctier[at] = -1;
    w.cflags[at] = EDGE;
    for (let d = 0, met = false; d < DIRECTIONS; d++) {
      if (round.k0[d] === 0) continue;
      const ref = occ.covering(f.gid, round.k0[d]!, round.k1[d]!);
      if (ref < 0) continue;
      const t = store.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!, tier = this.tierOf[kind]!;
      // The storey of the piece that reaches this level, and how far up it the piece goes on.
      const up = lvl - keyLvl(t.k1![s]!), storey = Math.floor(up / STOREY_LEVELS) * STOREY_LEVELS;
      if (up !== storey || tier < 0) {
        w.cflags[at]! |= UNDER;
        return;
      }
      const reach = Math.min(STOREY_LEVELS, Math.max(1, forms.span[kind]!) - storey);
      if (!met) {
        w.cfirst[at] = ref;
        w.creach[at] = reach;
        w.clike[at] = tier;
        met = true;
      }
      this.meet(at, d, ref, reach, tier);
    }
  }

  /**
   * The sides of the slab in slot `s`: in the low four bits a ceiling's yields where a wall under it comes up to it,
   * and over them a bit for each side of a foundation with no foundation beyond it, which has a skirt. A slab well
   * inside the chunk, of a base with walls here, knows the walls under it from the chunk's own.
   */
  private slab(s: number): number {
    const w = this.w, t = this.t, store = this.store, forms = this.forms!, occ = store.occupied, cells = this.cells, round = this.round;
    const kind = t.kind[s]!, k0 = t.k0![s]!, k1 = t.k1![s]!, def = forms.def[kind]!;
    const f = this.frame(t.fr![s]!);
    if (!f) {
      w.partial = true;
      return 0;
    }
    const cls = keyCls(k0);
    if ((cls !== CLS_SQUARE && cls !== CLS_TRIANGLE) || forms.size[kind] !== SIDE || def.corner !== undefined) return 0;
    const lx = t.x[s]! - this.x0, lz = t.z[s]! - this.z0;
    const inside = lx > SLAB_BORDER && lz > SLAB_BORDER && lx < CHUNK_SIZE - SLAB_BORDER && lz < CHUNK_SIZE - SLAB_BORDER;
    const base = inside ? w.bases.indexOf(f) : -1;
    const tier = this.tiers[this.tierOf[kind]!]!, lvl = keyLvl(k1), dir = keyDir(k1), own = ownDir(forms, kind, k1);
    const step = CLS_STEP[cls]!, sides = cls === CLS_SQUARE ? 4 : 3;
    let bits = 0;
    if (this.looks.yields[kind] === 1 && tier.sq >= 0) {
      faceEdges(k0, k1, base >= 0 ? lvl : lvl - 1, WALL, cells);
      for (let j = 0; j < sides; j++) {
        if (cells.k0[j] === 0) continue;
        if (base >= 0) {
          const slot = this.seek(cells.k0[j]!, ((cells.k1[j]! & CELL) | (base << 26)) >>> 0, false);
          if (slot < 0 || w.tval[slot]! > TOP) continue;
        } else {
          const ref = occ.covering(f.gid, cells.k0[j]!, cells.k1[j]!);
          if (ref < 0) continue;
          const u = store.chunks[Math.floor(ref / 65536)]!, under = u.kind[ref & 0xffff]!, top = forms.def[under]!.edges?.[0];
          // The wall owns its top where it is level and comes up to the slab.
          if (keyLvl(u.k1![ref & 0xffff]!) + forms.span[under]! < lvl || (top !== undefined && top.profile !== "flat")) continue;
        }
        if (cls === CLS_SQUARE) {
          // Which way out of the piece the side lies: its own +X is east, and north is a quarter turn on.
          const out = dirTurn(dir + step * j - 3, -own) / 3;
          bits |= out === 0 ? 2 : out === 1 ? 1 : out === 2 ? 8 : 4;
        } else {
          // The sides from the piece's own first corner: along its first axis, then up to its far corner, then back.
          const from = (((j - dirTurn(own, -dir) / step) % 3) + 3) % 3;
          bits |= from === 0 ? 4 : from === 1 ? 2 : 1;
        }
      }
    }
    if (tier.skirt < 0 || def.root === undefined || def.span !== 0) return bits;
    const me = this.chunk * 65536 + s;
    faceEdges(k0, k1, lvl, SLAB, cells);
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
      if (open) bits |= 16 << j;
    }
    return bits;
  }
}

/** By which sides of its chunk a place (x, z) metres from the chunk's corner stands, within BORDER: (dz + 1) * 3 + dx + 1. */
function sideOf(x: number, z: number): number {
  const dx = x < BORDER ? -1 : x > CHUNK_SIZE - BORDER ? 1 : 0, dz = z < BORDER ? -1 : z > CHUNK_SIZE - BORDER ? 1 : 0;
  return (dz + 1) * 3 + dx + 1;
}

/** A column twice as long, or `n` long, holding what it held. */
function grown<T extends Uint8Array | Int8Array | Uint16Array | Uint32Array | Int32Array | Float32Array>(a: T, n: number): T {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a);
  return b;
}
