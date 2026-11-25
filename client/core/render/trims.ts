// Trims: what is drawn where built pieces meet and is no piece. A joint stands at a corner where walls end, and a skirt
// hangs under a foundation's open side. The client finds them from what stands round each corner of a base's lattice
// (shared/world/lattice/occupancy.ts), so a trim has no row, no collider and nothing on the wire. A wall's end gives way
// to the joint at it, and a ceiling's side to the wall under it: those are bits of the piece's own instance (piece-fit.ts).
//
// A tier's trims are meshes of its pack, by name: <ns>:joint_sq_<tier> a square joint, <ns>:joint_r15_<tier> and
// <ns>:joint_r21_<tier> twelve-sided ones of 0.15 m and 0.21 m, <ns>:skirt_<tier>, <ns>:eave_<tier> and
// <ns>:ridge_<tier>, <ns>:hip_<tier> and <ns>:saddle_<tier>. <ns> and <tier> are its pieces' material's, core:mat_<tier>.
// A joint's mesh stands on its corner from the level up a storey. A skirt's hangs from the middle of a foundation's side,
// its +X along the side and its +Z outward, and an eave's lies so on a ceiling's side. A ridge's lies along the side two
// roofs' high sides share, at the height their tops meet. A hip's lies along a sloped side two roofs share where neither
// face rises from it and they are not in one plane, from the side's middle at its top's height, +X up the slope. A
// saddle's stands on the high corner a hip ends at. A tier with no square joint has no trims, and its pieces yield nothing.
//
// A skirt or an eave meets the next one round a corner on the plane that halves the corner: each end's turn is in its
// instance (piece-fit.ts), so a mesh that ends flat closes an outside corner and clears an inside one at any angle.
// A ridge's end is laid square where the next ridge runs on in line, so its mesh may stand proud of the roofs' ends.
//
// A chunk's corners are kept between layings (Laid). The next laying takes out and puts in only the pieces that changed,
// decides again the corners and slabs those turn on, and lists the trims from what is kept.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../../shared/coords.ts";
import { levelY, worldOf, yawOf } from "../../../shared/world/lattice/basis.ts";
import { FORM_LAYERS, LEVEL_M, STOREY_LEVELS, type FormTable } from "../../../shared/world/lattice/forms.ts";
import { ownDir, riseAt, type Frame } from "../../../shared/world/lattice/frames.ts";
import { CLS_CORNERS, CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, CLS_VERTEX, DIRECTIONS, LVL_MOST, M_MOST, SIDE, dirTurn, elementCorners, key0, key1, keyAnchor, keyCls, keyDir, keyFlip, keyLvl, keyM3, tupleStep, tupleWithin } from "../../../shared/world/lattice/module.ts";
import { Cells, cellAt, edgeFaces, elementVertices, faceEdges, formCells, vertexEdges, vertexFaces } from "../../../shared/world/lattice/occupancy.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import { DRAW_PIECE } from "./packet.ts";
import { FIT_ENDS, PIECE_END_IN, PIECE_END_RUN, PIECE_END_SHIFT } from "./piece-fit.ts";
import type { PieceLooks } from "./piece-state.ts";

/** Each tier's rank, the highest at a corner giving its joint, and whether its walls run on through a straight run with no joint. */
const TIER_RULES: Readonly<Record<string, readonly [rank: number, runsOn: boolean]>> = { thatch: [0, false], wood: [1, false], stone: [2, true], metal: [3, true] };
/**
 * Metres from a chunk's side within which a piece's trims may turn on what stands in the next chunk: two pieces that
 * share a corner, each a side from it. A wall over two edges has its origin a side from its end, and a triangle its
 * first corner a side from its others.
 */
const BORDER = 6.2;
/** Metres from a chunk's side within which a wall at a corner may be the next chunk's: a side, which a wall over two edges is from its end, and the most a base's vectors stretch it. */
const CORNER_BORDER = 3.1;
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

/** What a wall's kind is to a corner: it ends in joints; its top falls from its own -X end, or from its +X. */
const W_JOINTED = 1, W_HIGH_MINUS = 2, W_HIGH_PLUS = 4;

/** What a slab's kind takes on its sides: a foundation skirts, a ceiling eaves, a roof ridges. */
const SIDES_SKIRT = 1, SIDES_EAVE = 2, SIDES_RIDGE = 3;
/** In a slab's word: its yields, the sides with a skirt, an eave or a ridge, the sides with a hip it draws, and the corners with a saddle it draws, four bits each. */
const SLAB_HIPS = 8, SLAB_SADDLES = 12;

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
  readonly eave: number;
  readonly ridge: number;
  readonly hip: number;
  readonly saddle: number;
}

/** What a chunk's trims are, as `lay` leaves them until it is next called. */
export interface TrimLayout {
  count: number;
  /**
   * Per trim: its mesh, the slot of the piece that owns it, where it stands in metres, its yaw and turn class as a row
   * has them, its fit byte (the quarter storeys a joint is cut to, 0 for none; FIT_ENDS and its -X end's turn for a
   * skirt or an eave whose ends are turned), and its +X end's turn as bits of its state byte.
   */
  mesh: Uint16Array;
  owner: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Uint16Array;
  tw: Uint8Array;
  cut: Uint8Array;
  ends: Uint8Array;
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
   * quarter storeys its tallest stands there; its highest tier; the first wall met, what it is like and its tier; its flags; its joint, as
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
  /** Its walls' ends, each: the wall's slot, its corner, the way it leaves it by in the low four bits under what of it yields there, how high it stands at that corner, what it is like (`likeOf`), its tier, and the next end at its corner. `dead` of them are of walls gone. */
  ends = 0;
  dead = 0;
  eslot = new Uint16Array(256);
  ecorner = new Uint32Array(256);
  ebits = new Uint8Array(256);
  ereach = new Uint8Array(256);
  elike = new Uint8Array(256);
  etier = new Int8Array(256);
  enext = new Int32Array(256);
  /**
   * Per slot: the kind, frame and key it was told with, 0 for none; what it is (S_); its base among `bases`; its side
   * (INSIDE); its ends, the first and how many; a slab's word (SLAB_); and for each side with a skirt, an eave or a
   * ridge a byte, the turn at its trim's -X end under the turn at its +X end.
   */
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
  sSlab = new Uint16Array(0);
  sTurn = new Uint32Array(0);

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
    this.sTurn = grown(this.sTurn, n);
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
  /** Per kind of wall, what it is to a corner (W_). A rail or a beam, which carries nothing and closes nothing, ends in no joint. */
  private readonly wallOf: Uint8Array;
  /** Per kind of slab a whole side wide, what its sides take (SIDES_), and for a roof the metres its high corners' tops stand over its level. */
  private readonly sidesOf: Uint8Array;
  private readonly ridgeUp: Float32Array;
  /** Per kind of roof, metres its slab is through: its top is that over its underside's rise at each corner. */
  private readonly thick: Float32Array;
  /** Whether any tier has an eave: then a wall set down or taken up asks the ceilings beside it again. */
  private readonly eaves: boolean;
  /** Whether any tier has a ridge, a hip or a saddle: then a roof set down or taken up asks the roofs at its corners again, whose ridges may run on and whose saddles may move. */
  private readonly ridged: boolean;
  /** Whether any tier has a hip. */
  private readonly hipped: boolean;
  private readonly out: TrimLayout = { count: 0, mesh: new Uint16Array(64), owner: new Uint16Array(64), x: new Float32Array(64), y: new Float32Array(64), z: new Float32Array(64), yaw: new Uint16Array(64), tw: new Uint8Array(64), cut: new Uint8Array(64), ends: new Uint8Array(64), yields: new Uint8Array(0), borders: 0 };
  private readonly cells = new Cells();
  private readonly round = new Cells();
  private readonly faces = new Cells();
  private readonly spokes = new Cells();
  /** Scratch for the hips: a roof's sides, the faces by one, the sides of the roof beyond, a roof's corners and the faces round a corner. */
  private readonly hipSides = new Cells();
  private readonly hipBy = new Cells();
  private readonly hipThem = new Cells();
  private readonly hipAt = new Cells();
  private readonly hipRound = new Cells();
  /** The corners' keys of the roof `hipsOf` reads, and of the roof whose saddles are being found. */
  private readonly hipKeys = new Uint32Array(8);
  private readonly ownKeys = new Uint32Array(8);
  /** Per slot of the chunk being laid, what `hipsOf` found of it in this laying, and the laying it was found in: a saddle asks it of every roof round a corner. */
  private hipMemo = new Int32Array(0);
  private hipSeen = new Uint32Array(0);
  private laying = 0;
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
    this.wallOf = new Uint8Array(reg.defs.length);
    this.sidesOf = new Uint8Array(reg.defs.length);
    this.ridgeUp = new Float32Array(reg.defs.length);
    this.thick = new Float32Array(reg.defs.length);
    const named = new Map<string, number>();
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k]!, form = this.forms?.def[k];
      if (!form || d.type !== "structure") continue;
      if (form.layer === "wall") {
        const top = form.edges?.[0]?.profile;
        this.wallOf[k] = (form.carries === true || (form.closes !== undefined && form.closes !== "none") ? W_JOINTED : 0) | (top === "slopeL" ? W_HIGH_MINUS : top === "slopeR" ? W_HIGH_PLUS : 0);
      }
      if (form.layer === "slab" && (form.size ?? SIDE) === SIDE && form.span === 0) {
        const roof = this.forms!.rise[k] !== 0;
        this.sidesOf[k] = roof ? SIDES_RIDGE : form.corner !== undefined ? 0 : form.root !== undefined ? SIDES_SKIRT : SIDES_EAVE;
        if (roof) {
          this.ridgeUp[k] = Math.max(...form.corner!);
          this.thick[k] = form.thick;
        }
      }
      const made = /^([^:]+):mat_(.+)$/.exec(d.material ?? "");
      if (!made) continue;
      const id = `${made[1]}:${made[2]}`;
      if (!named.has(id)) {
        const mesh = (name: string): number => find(`${made[1]}:${name}_${made[2]}`);
        const rule = TIER_RULES[made[2]!] ?? [0, false];
        const sq = mesh("joint_sq");
        named.set(id, this.tiers.length);
        // Without the square joint the tier's meshes are not made to give way, so it has none of the rest either.
        this.tiers.push({ rank: rule[0], runsOn: rule[1], sq, r15: sq < 0 ? -1 : mesh("joint_r15"), r21: sq < 0 ? -1 : mesh("joint_r21"), skirt: sq < 0 ? -1 : mesh("skirt"), eave: sq < 0 ? -1 : mesh("eave"), ridge: sq < 0 ? -1 : mesh("ridge"), hip: sq < 0 ? -1 : mesh("hip"), saddle: sq < 0 ? -1 : mesh("saddle") });
      }
      this.tierOf[k] = named.get(id)!;
    }
    this.any = this.tiers.some((t) => t.sq >= 0);
    // A trim is laid out as a piece is, so its mesh is drawn as one.
    for (const t of this.tiers) for (const mesh of [t.sq, t.r15, t.r21, t.skirt, t.eave, t.ridge, t.hip, t.saddle]) if (mesh >= 0) looks.flag[mesh] = DRAW_PIECE;
    this.eaves = this.tiers.some((t) => t.eave >= 0);
    this.hipped = this.tiers.some((t) => t.hip >= 0);
    this.ridged = this.hipped || this.tiers.some((t) => t.ridge >= 0);
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
    this.laying = (this.laying + 1) >>> 0 || 1;
    if (this.hipMemo.length < t.high) {
      this.hipMemo = new Int32Array(Math.max(t.high, this.hipMemo.length * 2));
      this.hipSeen = new Uint32Array(this.hipMemo.length);
    }
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
      // An end of a piece gives way only where a joint stands at every storey of it: it is one instance, with one bit an end.
      let may = 3;
      for (let e = sEnd[s]!, end = e + sEnds[s]!; e < end; e++) {
        const c = ecorner[e]!, joint = cjoint[c]!;
        const bits = ebits[e]!;
        if (joint === 0) {
          may &= ~(bits >> 4);
          continue;
        }
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
          out.ends[i] = 0;
        }
        yields[s]! |= bits >> 4;
      }
      yields[s]! &= may;
    }
    for (const s of slabs) {
      const v = w.sSlab[s]!;
      yields[s]! |= v & 15;
      if (v >> 4 !== 0) this.sides(s, v >> 4);
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
      out.ends = grown(out.ends, n);
    }
    return out.count++;
  }

  /**
   * The trims of the slab in slot `s` that `sides` names, a bit each, from its word less its yields: on its sides a
   * skirt or an eave at the middle of its side, +X back along it so that +Z is the way out, its ends turned as `slab`
   * found; a ridge along its side, at the height the roof's top has there; then the hips on its sides, +X up the slope;
   * then the saddles at its corners.
   */
  private sides(s: number, sides: number): void {
    const t = this.t, m = this.m, out = this.out, kind = t.kind[s]!, k0 = t.k0![s]!, k1 = t.k1![s]!;
    const f = this.frame(t.fr![s]!);
    if (!f) return;
    const cls = keyCls(k0), dir = keyDir(k1), step = CLS_STEP[cls]!, tier = this.tiers[this.tierOf[kind]!]!, what = this.sidesOf[kind]!;
    const mesh = what === SIDES_SKIRT ? tier.skirt : what === SIDES_EAVE ? tier.eave : tier.ridge, turns = this.w.sTurn[s]!;
    const y = levelY(f.oy, keyLvl(k1)) / STRUCT_UNITS + this.ridgeUp[kind]!;
    keyAnchor(k0, k1, m, 0);
    elementCorners(cls, m, 0, dir, m, 0);
    for (let j = 0; j < 4; j++) {
      if ((sides & (1 << j)) === 0) continue;
      const along = dirTurn(dir, step * j), way = what === SIDES_RIDGE ? along : dirTurn(along, 6), turn = (turns >>> (8 * j)) & 255;
      tupleStep(m, 4 * j, along, SIDE / 2, m, 16);
      worldOf(f.basis, f.ox, f.oz, m, 16, this.at, 0);
      const i = this.room();
      out.mesh[i] = mesh;
      out.owner[i] = s;
      out.x[i] = this.at[0]! / STRUCT_UNITS;
      out.y[i] = y;
      out.z[i] = this.at[1]! / STRUCT_UNITS;
      out.yaw[i] = yawOf(f.yaw, way);
      out.tw[i] = way % 3;
      out.cut[i] = turn === 0 ? 0 : FIT_ENDS | (turn & 15);
      out.ends[i] = (turn >> 4) << PIECE_END_SHIFT;
    }
    if (sides >> (SLAB_HIPS - 4) === 0) return;
    const rise = riseAt(this.forms!, kind, k0, k1), n = CLS_CORNERS[cls]!, under = levelY(f.oy, keyLvl(k1)) / STRUCT_UNITS + this.thick[kind]!;
    const up = (k: number): number => ((rise >> (3 * (k % n))) & 7) * LEVEL_M;
    for (let j = 0; j < n; j++) {
      const hip = (sides & (1 << (SLAB_HIPS - 4 + j))) !== 0, saddle = (sides & (1 << (SLAB_SADDLES - 4 + j))) !== 0;
      if (hip) {
        const along = dirTurn(dir, step * j), way = up(j) < up(j + 1) ? along : dirTurn(along, 6);
        tupleStep(m, 4 * j, along, SIDE / 2, m, 16);
        worldOf(f.basis, f.ox, f.oz, m, 16, this.at, 0);
        this.put(tier.hip, s, under + (up(j) + up(j + 1)) / 2, way);
      }
      if (saddle) {
        worldOf(f.basis, f.ox, f.oz, m, 4 * j, this.at, 0);
        this.put(tier.saddle, s, under + up(j), 0);
      }
    }
  }

  /** Lays a trim of `mesh` owned by slot `s` at `this.at` and height `y`, its +X along `way` of its base, its ends as made. */
  private put(mesh: number, s: number, y: number, way: number): void {
    const out = this.out, f = this.frame(this.t.fr![s]!)!, i = this.room();
    out.mesh[i] = mesh;
    out.owner[i] = s;
    out.x[i] = this.at[0]! / STRUCT_UNITS;
    out.y[i] = y;
    out.z[i] = this.at[1]! / STRUCT_UNITS;
    out.yaw[i] = yawOf(f.yaw, way);
    out.tw[i] = way % 3;
    out.cut[i] = 0;
    out.ends[i] = 0;
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
        this.beside(gid, k0, k1, kind);
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
    if (mark && this.eaves) this.under(gid, kind, k0, k1);
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
      this.beside(gid, k0, k1, kind);
      return true;
    }
    if (this.eaves) this.under(gid, kind, k0, k1);
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

  /**
   * Notes the slabs a slab of `kind` set down or taken up at this key turns: those beyond each side of its face, whose
   * skirt or ridge is by the one beyond, and those that share a corner with it, whose trim's end is turned to it.
   */
  private beside(gid: number, k0: number, k1: number, kind: number): void {
    const cls = keyCls(k0);
    if (cls !== CLS_SQUARE && cls !== CLS_TRIANGLE) return;
    const cells = this.cells, round = this.round, lvl = keyLvl(k1);
    faceEdges(k0, k1, lvl, SLAB, cells);
    for (let j = 0; j < cells.n; j++) {
      if (cells.k0[j] === 0) continue;
      edgeFaces(cells.k0[j]!, cells.k1[j]!, lvl, SLAB, round);
      this.askAll(gid, round);
    }
    // A corner's slabs at each level its cell reaches: an eave stops at a roof that comes up through its level.
    const what = this.sidesOf[kind]!;
    if (what !== SIDES_SKIRT && !this.eaves && !(what === SIDES_RIDGE && this.ridged)) return;
    elementVertices(k0, k1, lvl, SLAB, cells);
    for (let j = 0, n = CLS_CORNERS[cls]!; j < n; j++) {
      if (cells.k0[j] === 0) continue;
      for (let up = 0, reach = this.eaves ? this.forms!.reach[kind]! : 1; up < reach && lvl + up <= LVL_MOST; up++) {
        vertexFaces(cells.k0[j]!, cells.k1[j]!, lvl + up, SLAB, round);
        this.askAll(gid, round);
      }
    }
  }

  /** Notes the chunk's slabs in `cells` to be asked again. */
  private askAll(gid: number, cells: Cells): void {
    const occ = this.store.occupied;
    for (let n = 0; n < cells.n; n++) {
      const ref = cells.k0[n] === 0 ? -1 : occ.at(gid, cells.k0[n]!, cells.k1[n]!);
      if (ref >= 0 && Math.floor(ref / 65536) === this.chunk) this.ask(ref & 0xffff);
    }
  }

  /** Notes the slabs a wall set down or taken up at this key stands on the side of, or at a corner of, at each level it stands through: a ceiling has no eave where a wall goes on up. */
  private under(gid: number, kind: number, k0: number, k1: number): void {
    const cells = this.cells, round = this.round, faces = this.faces;
    if (!this.wallCells(kind, k0, k1)) return;
    for (let c = 0; c < cells.n; c++) {
      const lvl = keyLvl(cells.k1[c]!);
      for (let up = 0; up < cells.reach[c]! && lvl + up <= LVL_MOST; up++) {
        edgeFaces(cells.k0[c]!, cells.k1[c]!, lvl + up, SLAB, round);
        this.askAll(gid, round);
        elementVertices(cells.k0[c]!, cells.k1[c]!, lvl + up, SLAB, round);
        for (let end = 0; end < 2; end++) {
          if (round.k0[end] === 0) continue;
          vertexFaces(round.k0[end]!, round.k1[end]!, lvl + up, SLAB, faces);
          this.askAll(gid, faces);
        }
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
        w.creach[c] = w.elike[e]!;
        w.clike[c] = w.etier[e]!;
      }
      this.meet(c, w.ebits[e]! & 15, ref, w.ereach[e]!, w.elike[e]!, w.etier[e]!);
    }
  }

  /** Notes the wall in slot `s` at the corners its cells end at, and its level top over each edge it stands on. With `mark` its corners are gathered and decided after. */
  private wall(f: Frame, base: number, s: number, kind: number, k0: number, k1: number, mark: boolean): void {
    const w = this.w, forms = this.forms!, cells = this.cells, m = this.m, def = forms.def[kind]!, what = this.wallOf[kind]!;
    w.sEnd[s] = w.ends;
    this.tops(f.gid, base, kind, k0, k1, true, mark);
    if ((what & W_JOINTED) === 0 || !this.wallCells(kind, k0, k1)) return;
    const wide = def.cells, ref = this.chunk * 65536 + s, foot = keyLvl(k1), span = forms.span[kind]!;
    const dir = keyDir(k1), own = ownDir(forms, kind, k1), tier = this.tierOf[kind]!;
    // The way its high end leaves its corner by, for a wall whose top slopes: its own +X from its -X end.
    const high = (what & (W_HIGH_MINUS | W_HIGH_PLUS)) === 0 ? -1 : ((what & W_HIGH_MINUS) !== 0) !== (keyFlip(k1) === 1) ? own : dirTurn(own, 6);
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
        // A piece over two edges ends at its two ends alone, and a sloped top at its high end: its low one stands no height.
        const outer = end === 0 ? along === first : along === last, from = dirTurn(dir, end * 6);
        if (!outer || (high >= 0 && from !== high)) continue;
        // The corner at this end of the cell.
        tupleStep(m, 0, dir, (along + end) * SIDE, m, 4);
        if (!tupleWithin(m, 4, M_MOST)) continue;
        const vk0 = key0(0, m[4]!, m[5]!, m[6]!), vk1 = key1(m[7]!, lvl, 0, WALL, 0, 0), like = likeOf(span, lvl - foot);
        const slot = this.seek(vk0, ((vk1 & CELL) | (base << 26)) >>> 0, true);
        let at = w.tval[slot]!;
        const made = at < 0;
        if (made) {
          at = w.tval[slot] = this.corner();
          w.ck0[at] = vk0;
          w.ck1[at] = vk1;
          w.cbase[at] = base;
          w.cfirst[at] = ref;
          w.creach[at] = like;
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
        else this.meet(at, from, ref, reach, like, tier);
        if (w.ends === w.eslot.length) {
          const n = w.ends * 2;
          w.eslot = grown(w.eslot, n);
          w.ecorner = grown(w.ecorner, n);
          w.ebits = grown(w.ebits, n);
          w.ereach = grown(w.ereach, n);
          w.elike = grown(w.elike, n);
          w.etier = grown(w.etier, n);
          w.enext = grown(w.enext, n);
        }
        // An end gives way: bit 0 its own -X end, bit 1 its +X.
        const e = w.ends++;
        w.eslot[e] = s;
        w.ecorner[e] = at;
        w.ebits[e] = from | ((fitted ? (from === own ? 1 : 2) : 0) << 4);
        w.ereach[e] = reach;
        w.elike[e] = like;
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

  /** Counts the wall `ref`, of `tier`, `reach` quarter storeys high at the corner and like `like`, among those that leave corner `at` by the way `from`. */
  private meet(at: number, from: number, ref: number, reach: number, like: number, tier: number): void {
    const w = this.w;
    w.cmask[at]! |= 1 << from;
    if (w.cfirst[at] !== ref) w.cflags[at]! |= SEVERAL;
    if (like !== w.creach[at] || tier !== w.clike[at] || !this.tiers[tier]!.runsOn) w.cflags[at]! |= UNALIKE;
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
      const t = store.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!, tier = this.tierOf[kind]!, what = this.wallOf[kind]!, k1 = t.k1![s]!;
      // As `wall` tells them: no rail or beam, no piece through its own middle, and a sloped top at its high end alone.
      if (tier >= 0 && ((what & W_JOINTED) === 0 || (forms.wide[kind]! > 1 && this.amid(at, t.k0![s]!, k1, forms.wide[kind]!)))) continue;
      if (tier >= 0 && (what & (W_HIGH_MINUS | W_HIGH_PLUS)) !== 0 && (d === ownDir(forms, kind, k1)) !== (((what & W_HIGH_MINUS) !== 0) !== (keyFlip(k1) === 1))) continue;
      // The storey of the piece that reaches this level, and how far up it the piece goes on.
      const up = lvl - keyLvl(k1), storey = Math.floor(up / STOREY_LEVELS) * STOREY_LEVELS;
      if (up !== storey || tier < 0) {
        w.cflags[at]! |= UNDER;
        return;
      }
      const reach = Math.min(STOREY_LEVELS, Math.max(1, forms.span[kind]!) - storey), like = likeOf(forms.span[kind]!, storey);
      if (!met) {
        w.cfirst[at] = ref;
        w.creach[at] = like;
        w.clike[at] = tier;
        met = true;
      }
      this.meet(at, d, ref, reach, like, tier);
    }
  }

  /** Whether corner `at` is a corner between the edges of the piece `wide` edges long whose key this is, and neither of its ends. */
  private amid(at: number, k0: number, k1: number, wide: number): boolean {
    const w = this.w, m = this.m, dir = keyDir(k1);
    keyAnchor(k0, k1, m, 0);
    for (let i = 1; i < wide; i++) {
      tupleStep(m, 0, dir, i * SIDE, m, 4);
      if (key0(0, m[4]!, m[5]!, m[6]!) === w.ck0[at] && m[7] === keyM3(w.ck1[at]!)) return true;
    }
    return false;
  }

  /**
   * The sides of the slab in slot `s`: in the low four bits a ceiling's yields where a wall under it comes up to it,
   * and over them a bit for each side with a trim: a foundation's with no foundation beyond it, a ceiling's that is
   * open (`eaved`), a roof's high side that meets another's. Each trim's ends' turns are left in `sTurn`. A roof yields
   * nowhere: it stands on its level, so a wall or a gable under any side meets its underside and shares none of it.
   * A slab well inside the chunk, of a base with walls here, knows the walls under it from the chunk's own.
   */
  private slab(s: number): number {
    const w = this.w, t = this.t, store = this.store, forms = this.forms!, occ = store.occupied, cells = this.cells;
    const kind = t.kind[s]!, k0 = t.k0![s]!, k1 = t.k1![s]!, def = forms.def[kind]!, what = this.sidesOf[kind]!;
    w.sTurn[s] = 0;
    const f = this.frame(t.fr![s]!);
    if (!f) {
      w.partial = true;
      return 0;
    }
    const cls = keyCls(k0);
    if ((cls !== CLS_SQUARE && cls !== CLS_TRIANGLE) || forms.size[kind] !== SIDE || (def.corner !== undefined && what !== SIDES_RIDGE)) return 0;
    const tier = this.tiers[this.tierOf[kind]!]!, lvl = keyLvl(k1), dir = keyDir(k1), me = this.chunk * 65536 + s;
    const step = CLS_STEP[cls]!, sides = cls === CLS_SQUARE ? 4 : 3;
    if (what === SIDES_RIDGE) {
      const ridged = tier.ridge < 0 ? 0 : this.ridges(f.gid, me, kind, k0, k1);
      const hips = this.hipped ? this.hipsOf(f.gid, me, kind, k0, k1) : 0;
      const saddles = hips >> 8 !== 0 && tier.saddle >= 0 ? this.saddles(f.gid, me, k0, k1, hips >> 8) : 0;
      const word = ((hips >> 4) & 15) << SLAB_HIPS | saddles << SLAB_SADDLES;
      if (ridged === 0) return word;
      // A ridge's end is laid square where the next ridge runs on in line, and an open end is left as its mesh has it.
      const m = this.m;
      keyAnchor(k0, k1, m, 0);
      elementCorners(cls, m, 0, dir, m, 0);
      let turns = 0;
      for (let j = 0; j < sides; j++) {
        if ((ridged & (1 << j)) === 0) continue;
        const along = dirTurn(dir, step * j);
        if (this.runsOn(f.gid, 4 * j, dirTurn(along, 6), lvl)) turns |= PIECE_END_RUN << (8 * j);
        if (this.runsOn(f.gid, 4 * ((j + 1) % sides), along, lvl)) turns |= PIECE_END_RUN << (8 * j + 4);
      }
      w.sTurn[s] = turns >>> 0;
      return (ridged << 4) | word;
    }
    const lx = t.x[s]! - this.x0, lz = t.z[s]! - this.z0;
    const inside = lx > SLAB_BORDER && lz > SLAB_BORDER && lx < CHUNK_SIZE - SLAB_BORDER && lz < CHUNK_SIZE - SLAB_BORDER;
    const base = inside ? w.bases.indexOf(f) : -1;
    const own = ownDir(forms, kind, k1);
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
          // The wall owns its top where it is level and a storey of it ends at the slab, as `tops` counts them.
          const foot = keyLvl(u.k1![ref & 0xffff]!), storey = Math.floor((lvl - 1 - foot) / STOREY_LEVELS) * STOREY_LEVELS;
          if (this.tierOf[under]! < 0 || foot + Math.min(Math.max(1, forms.span[under]!), storey + STOREY_LEVELS) !== lvl || (top !== undefined && top.profile !== "flat")) continue;
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
    const skirt = what === SIDES_SKIRT;
    if (skirt ? tier.skirt < 0 : what !== SIDES_EAVE || tier.eave < 0) return bits;
    let open = 0;
    faceEdges(k0, k1, lvl, skirt ? SLAB : WALL, cells);
    for (let j = 0; j < sides; j++) if (cells.k0[j] !== 0 && (skirt ? this.skirted(f.gid, cells.k0[j]!, cells.k1[j]!, lvl, me) : this.eaved(f.gid, cells.k0[j]!, cells.k1[j]!, lvl, me))) open |= 1 << j;
    if (open === 0) return bits;
    // Each trim's two ends: its +X at the side's first corner, where the way out lies back round from the side, and its -X at the next.
    const m = this.m, spokes = this.spokes;
    keyAnchor(k0, k1, m, 0);
    elementCorners(cls, m, 0, dir, m, 0);
    let turns = 0;
    for (let j = 0; j < sides; j++) {
      const before = (j + sides - 1) % sides;
      if ((open & ((1 << j) | (1 << before))) === 0 || !tupleWithin(m, 4 * j, M_MOST)) continue;
      const vk0 = key0(0, m[4 * j]!, m[4 * j + 1]!, m[4 * j + 2]!), vk1 = key1(m[4 * j + 3]!, lvl, 0, SLAB, 0, 0);
      vertexFaces(vk0, vk1, lvl, SLAB, this.faces);
      if (!skirt) vertexEdges(vk0, vk1, lvl, WALL, spokes);
      if ((open & (1 << j)) !== 0) turns |= this.turn(f.gid, dirTurn(dir, step * j), -1, skirt) << (8 * j + 4);
      if ((open & (1 << before)) !== 0) turns |= this.turn(f.gid, dirTurn(dir, step * before + 6), 1, skirt) << (8 * before);
    }
    w.sTurn[s] = turns >>> 0;
    return bits | (open << 4);
  }

  /** Whether a foundation's side on this edge has a skirt: no foundation lies beyond it. `me` is the foundation's ref. */
  private skirted(gid: number, ek0: number, ek1: number, lvl: number, me: number): boolean {
    const store = this.store, occ = store.occupied, round = this.round;
    edgeFaces(ek0, ek1, lvl, SLAB, round);
    for (let n = 0; n < round.n; n++) {
      const ref = round.k0[n] === 0 ? -1 : occ.at(gid, round.k0[n]!, round.k1[n]!);
      if (ref < 0 || ref === me) continue;
      if (this.sidesOf[store.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!] === SIDES_SKIRT) return false;
    }
    return true;
  }

  /**
   * Whether a ceiling's side on this edge, a wall's cell at the ceiling's level, has an eave: no slab lies beyond it or
   * comes up through its level there, and no wall stands on the edge or through it. `me` is the ceiling's ref.
   */
  private eaved(gid: number, ek0: number, ek1: number, lvl: number, me: number): boolean {
    const occ = this.store.occupied, round = this.round;
    if (occ.covering(gid, ek0, ek1) >= 0) return false;
    edgeFaces(ek0, ek1, lvl, SLAB, round);
    for (let n = 0; n < round.n; n++) {
      const ref = round.k0[n] === 0 ? -1 : occ.covering(gid, round.k0[n]!, round.k1[n]!);
      if (ref >= 0 && ref !== me) return false;
    }
    return true;
  }

  /**
   * The turn at the end of a skirt or an eave whose side leaves its corner by the way `from`, the open ground lying
   * round from it toward `sense` (1 toward +Z): how many twelfths of a turn the ground is wide, as piece-fit.ts reads
   * it, or 0 where the slab beyond it has no such trim to meet. The corner's faces are in `faces`, and for an eave its
   * edges in `spokes`.
   */
  private turn(gid: number, from: number, sense: number, skirt: boolean): number {
    const store = this.store, occ = store.occupied, faces = this.faces, spokes = this.spokes;
    for (let n = 1; n < DIRECTIONS; n++) {
      // The face that begins where the open ground ends: a square a quarter turn wide, or a triangle a sixth.
      const b = dirTurn(from, sense * n);
      for (let shape = 0; shape < 2; shape++) {
        const at = shape * DIRECTIONS + (sense > 0 ? b : dirTurn(b, shape === 0 ? -3 : -2));
        if (faces.k0[at] === 0) continue;
        const ref = skirt ? occ.at(gid, faces.k0[at]!, faces.k1[at]!) : occ.covering(gid, faces.k0[at]!, faces.k1[at]!);
        if (ref < 0) continue;
        const kind = store.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!, what = this.sidesOf[kind]!, tier = this.tierOf[kind]!;
        if (skirt && what !== SIDES_SKIRT) continue;
        if (tier < 0) return 0;
        if (skirt ? this.tiers[tier]!.skirt < 0 : what !== SIDES_EAVE || this.tiers[tier]!.eave < 0 || spokes.k0[b] === 0 || !this.eaved(gid, spokes.k0[b]!, spokes.k1[b]!, keyLvl(spokes.k1[b]!), ref)) return 0;
        return n === DIRECTIONS / 2 ? PIECE_END_RUN : n > DIRECTIONS / 2 ? n - DIRECTIONS / 2 : PIECE_END_IN | (DIRECTIONS / 2 - n);
      }
    }
    return 0;
  }

  /**
   * The sides of the roof `me` that take a ridge, a bit each: a side both of whose corners are its highest, where the
   * roof beyond it at its level has its highest too, drawn by the one of the two whose key is the lower.
   */
  private ridges(gid: number, me: number, kind: number, k0: number, k1: number): number {
    const occ = this.store.occupied, cells = this.cells, round = this.round;
    const lvl = keyLvl(k1), sides = CLS_CORNERS[keyCls(k0)]!;
    let bits = 0;
    faceEdges(k0, k1, lvl, SLAB, cells);
    for (let j = 0; j < sides; j++) {
      if (cells.k0[j] === 0 || !this.topSide(me, cells.k0[j]!, cells.k1[j]!, lvl)) continue;
      edgeFaces(cells.k0[j]!, cells.k1[j]!, lvl, SLAB, round);
      for (let n = 0; n < round.n; n++) {
        const ref = round.k0[n] === 0 ? -1 : occ.at(gid, round.k0[n]!, round.k1[n]!);
        if (ref < 0 || ref === me) continue;
        const u = this.store.chunks[Math.floor(ref / 65536)]!, ok0 = u.k0![ref & 0xffff]!, ok1 = u.k1![ref & 0xffff]!;
        if (ok0 < k0 || (ok0 === k0 && ok1 < k1)) continue;
        if (this.topSide(ref, cells.k0[j]!, cells.k1[j]!, lvl)) bits |= 1 << j;
      }
    }
    return bits;
  }

  /** Whether the piece `ref` is a roof at `lvl` with the edge (ek0, ek1) for a side both of whose corners are its highest. */
  private topSide(ref: number, ek0: number, ek1: number, lvl: number): boolean {
    const u = this.store.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = u.kind[s]!, k0 = u.k0![s]!, k1 = u.k1![s]!, faces = this.faces;
    if (this.sidesOf[kind] !== SIDES_RIDGE || keyLvl(k1) !== lvl) return false;
    const rise = riseAt(this.forms!, kind, k0, k1), n = CLS_CORNERS[keyCls(k0)]!, most = highest(rise, n);
    faceEdges(k0, k1, lvl, SLAB, faces);
    for (let i = 0; i < n; i++) if (faces.k0[i] === ek0 && faces.k1[i] === ek1) return ((rise >> (3 * i)) & 7) === most && ((rise >> (3 * ((i + 1) % n))) & 7) === most;
    return false;
  }

  /**
   * The hips on the sides of the roof `ref`: sloped sides it shares with a roof at its level whose corners there rise as
   * its own, where neither face rises from the side and the two are not in one plane, and a tier of the two has a hip.
   * In the low four bits those sides, a bit each; over them those it draws, being the lower key of the two or the one
   * whose tier has a hip; over those the corners that are such a side's high end.
   */
  private hipsOf(gid: number, ref: number, kind: number, k0: number, k1: number): number {
    const own = Math.floor(ref / 65536) === this.chunk, slot = ref & 0xffff;
    if (own && this.hipSeen[slot] === this.laying) return this.hipMemo[slot]!;
    const forms = this.forms!, occ = this.store.occupied, sides = this.hipSides, by = this.hipBy, them = this.hipThem, at = this.hipAt, keys = this.hipKeys;
    const lvl = keyLvl(k1), n = CLS_CORNERS[keyCls(k0)]!, rise = riseAt(forms, kind, k0, k1), tier = this.tierOf[kind]!;
    const mine = tier >= 0 && this.tiers[tier]!.hip >= 0;
    faceEdges(k0, k1, lvl, SLAB, sides);
    elementVertices(k0, k1, lvl, SLAB, at);
    for (let c = 0; c < n; c++) {
      keys[2 * c] = at.k0[c]!;
      keys[2 * c + 1] = at.k1[c]!;
    }
    let laid = 0, drawn = 0, ends = 0;
    for (let j = 0; j < n; j++) {
      const a = (rise >> (3 * j)) & 7, b = (rise >> (3 * ((j + 1) % n))) & 7, fall = fallFrom(rise, n, j);
      if (a === b || fall > 0 || sides.k0[j] === 0) continue;
      const ek0 = sides.k0[j]!, ek1 = sides.k1[j]!;
      edgeFaces(ek0, ek1, lvl, SLAB, by);
      for (let c = 0; c < by.n; c++) {
        const o = by.k0[c] === 0 ? -1 : occ.at(gid, by.k0[c]!, by.k1[c]!);
        if (o < 0 || o === ref) continue;
        const u = this.store.chunks[Math.floor(o / 65536)]!, os = o & 0xffff, ok = u.kind[os]!, ok0 = u.k0![os]!, ok1 = u.k1![os]!;
        if (this.sidesOf[ok] !== SIDES_RIDGE || keyLvl(ok1) !== lvl) continue;
        const on = CLS_CORNERS[keyCls(ok0)]!, orise = riseAt(forms, ok, ok0, ok1);
        faceEdges(ok0, ok1, lvl, SLAB, them);
        let i = 0;
        while (i < on && (them.k0[i] !== ek0 || them.k1[i] !== ek1)) i++;
        if (i === on) continue;
        // Which of its side's two corners is this side's first.
        elementVertices(ok0, ok1, lvl, SLAB, at);
        const same = at.k0[i] === keys[2 * j] && at.k1[i] === keys[2 * j + 1];
        const oa = (orise >> (3 * (same ? i : (i + 1) % on))) & 7, ob = (orise >> (3 * (same ? (i + 1) % on : i))) & 7, ofall = fallFrom(orise, on, i);
        const ot = this.tierOf[ok]!, theirs = ot >= 0 && this.tiers[ot]!.hip >= 0;
        if (oa === a && ob === b && ofall <= 0 && fall + ofall !== 0 && (mine || theirs)) {
          laid |= 1 << j;
          ends |= 1 << (a > b ? j : (j + 1) % n);
          if (mine && (!theirs || ok0 > k0 || (ok0 === k0 && ok1 > k1))) drawn |= 1 << j;
        }
        break;
      }
    }
    const found = laid | (drawn << 4) | (ends << 8);
    if (own) {
      this.hipSeen[slot] = this.laying;
      this.hipMemo[slot] = found;
    }
    return found;
  }

  /**
   * The corners of the roof `me` that `ends` names, each a hip's high end, at which it draws a saddle: no roof at its
   * level with a lower key has a hip ending there and a tier with a saddle. Its tier has one.
   */
  private saddles(gid: number, me: number, k0: number, k1: number, ends: number): number {
    const occ = this.store.occupied, round = this.hipRound, own = this.ownKeys, at = this.hipAt, lvl = keyLvl(k1);
    elementVertices(k0, k1, lvl, SLAB, at);
    for (let c = 0; c < CLS_CORNERS[keyCls(k0)]!; c++) {
      own[2 * c] = at.k0[c]!;
      own[2 * c + 1] = at.k1[c]!;
    }
    let out = 0;
    for (let c = 0; c < CLS_CORNERS[keyCls(k0)]!; c++) {
      if ((ends & (1 << c)) === 0) continue;
      const vk0 = own[2 * c]!, vk1 = own[2 * c + 1]!;
      vertexFaces(vk0, vk1, lvl, SLAB, round);
      let mine = true;
      // The squares and triangles with a corner there, not those it is the middle of.
      for (let n = 0; n < 2 * DIRECTIONS && mine; n++) {
        const q = round.k0[n] === 0 ? -1 : occ.at(gid, round.k0[n]!, round.k1[n]!);
        if (q < 0 || q === me) continue;
        const u = this.store.chunks[Math.floor(q / 65536)]!, qs = q & 0xffff, qk = u.kind[qs]!, qk0 = u.k0![qs]!, qk1 = u.k1![qs]!, qt = this.tierOf[qk]!;
        if (this.sidesOf[qk] !== SIDES_RIDGE || keyLvl(qk1) !== lvl || !(qk0 < k0 || (qk0 === k0 && qk1 < k1)) || qt < 0 || this.tiers[qt]!.saddle < 0) continue;
        const theirs = this.hipsOf(gid, q, qk, qk0, qk1) >> 8;
        if (theirs === 0) continue;
        elementVertices(qk0, qk1, lvl, SLAB, at);
        for (let i = 0; i < CLS_CORNERS[keyCls(qk0)]!; i++) if ((theirs & (1 << i)) !== 0 && at.k0[i] === vk0 && at.k1[i] === vk1) mine = false;
      }
      if (mine) out |= 1 << c;
    }
    return out;
  }

  /** Whether a ridge lies on the edge that leaves the corner at `m[at]` by the way `way`: two roofs' highest sides meet on it. */
  private runsOn(gid: number, at: number, way: number, lvl: number): boolean {
    const m = this.m, spokes = this.spokes, round = this.round, occ = this.store.occupied;
    if (!tupleWithin(m, at, M_MOST)) return false;
    vertexEdges(key0(0, m[at]!, m[at + 1]!, m[at + 2]!), key1(m[at + 3]!, lvl, 0, SLAB, 0, 0), lvl, SLAB, spokes);
    const ek0 = spokes.k0[way]!, ek1 = spokes.k1[way]!;
    if (ek0 === 0) return false;
    edgeFaces(ek0, ek1, lvl, SLAB, round);
    let roofs = 0;
    for (let n = 0; n < round.n; n++) {
      const ref = round.k0[n] === 0 ? -1 : occ.at(gid, round.k0[n]!, round.k1[n]!);
      if (ref >= 0 && this.topSide(ref, ek0, ek1, lvl) && ++roofs === 2) return true;
    }
    return false;
  }
}

/**
 * Which way a roof's face goes from its side `i` into it, `rise` its `n` corners' rises three bits each: under 0 where
 * it falls away, 0 where it is level across, over 0 where it rises. Only the sign is to be read.
 */
function fallFrom(rise: number, n: number, i: number): number {
  const r = (k: number): number => (rise >> (3 * ((i + k) % n))) & 7;
  // A triangle's far corner against the side's middle.
  if (n === 3) return 2 * r(2) - r(0) - r(1);
  // A square is folded on the diagonal through the corner no other is level with: the face by this side holds that diagonal's far end.
  let odd = -1;
  for (let k = 0; k < 4; k++) if (r(k + 1) === r(k + 2) && r(k + 2) === r(k + 3) && r(k) !== r(k + 1)) odd = k;
  return odd === 0 || odd === 2 ? r(2) - r(1) : r(3) - r(0);
}

/** The most a roof rises at any of its `n` corners, three bits each in `rise`. */
function highest(rise: number, n: number): number {
  let top = 0;
  for (let k = 0; k < n; k++) top = Math.max(top, (rise >> (3 * k)) & 7);
  return top;
}

/** What two walls must share to be alike in a run: the piece's span and how far up it this storey begins, in quarter storeys. */
function likeOf(span: number, up: number): number {
  return Math.min(31, span) | (((up >> 2) & 7) << 5);
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
