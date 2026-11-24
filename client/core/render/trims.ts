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
import { CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, DIRECTIONS, M_MOST, SIDE, dirTurn, elementCorners, key0, key1, keyAnchor, keyCls, keyDir, keyLvl, tupleStep, tupleWithin } from "../../../shared/world/lattice/module.ts";
import { Cells, edgeFaces, faceEdges, formCells, vertexEdges } from "../../../shared/world/lattice/occupancy.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import { DRAW_PIECE } from "./packet.ts";
import type { PieceLooks } from "./piece-state.ts";

/** Each tier's rank, the highest at a corner giving its joint, and whether its walls run on through a straight run with no joint. */
const TIER_RULES: Readonly<Record<string, readonly [rank: number, runsOn: boolean]>> = { thatch: [0, false], wood: [1, false], stone: [2, true], metal: [3, true] };
/** Metres from a chunk's side within which a piece's trims may turn on what stands in the next chunk: a side and a half, and a wall's thickness. */
const BORDER = 4.7;

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
  /** Corners found for the chunk being laid, by frame and then by corner and level: the joint there as `corner` packs it. */
  private readonly corners = new Map<number, Map<number, number>>();
  private readonly cells = new Cells();
  private readonly round = new Cells();
  private readonly m = new Int32Array(24);
  private readonly at = new Int32Array(2);

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

  /** The trims of chunk `chunk`, whose corner is at (x0, z0) metres, and what its pieces yield; null where it can have none. */
  lay(store: StructureStore, chunk: number, t: ChunkTable, x0: number, z0: number): TrimLayout | null {
    const forms = this.forms;
    if (!this.any || !forms || !t.fr) return null;
    const out = this.out;
    out.count = 0;
    out.borders = 0;
    if (out.yields.length < t.high) out.yields = new Uint8Array(Math.max(t.high, out.yields.length * 2));
    else out.yields.fill(0, 0, t.high);
    this.corners.clear();
    const fr = t.fr, k0 = t.k0!, k1 = t.k1!;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || fr[s] === 0 || this.tierOf[kind]! < 0) continue;
      const layer = forms.layer[kind]!;
      if (layer !== WALL && layer !== SLAB) continue;
      const f = store.frames.get(fr[s]!);
      if (!f) continue;
      // What stands within a side of the chunk's edge may meet a piece of the next chunk.
      const lx = t.x[s]! - x0, lz = t.z[s]! - z0;
      const dx = lx < BORDER ? -1 : lx > CHUNK_SIZE - BORDER ? 1 : 0, dz = lz < BORDER ? -1 : lz > CHUNK_SIZE - BORDER ? 1 : 0;
      if (dx !== 0) out.borders |= borderBit(dx, 0);
      if (dz !== 0) out.borders |= borderBit(0, dz);
      if (dx !== 0 && dz !== 0) out.borders |= borderBit(dx, dz);
      if (layer === WALL) this.wall(store, f, s, kind, k0[s]!, k1[s]!);
      else this.slab(store, f, chunk, s, kind, k0[s]!, k1[s]!);
    }
    return out;
  }

  private push(mesh: number, owner: number, f: Frame, m: Int32Array, mi: number, lvl: number, dir: number, cut: number): void {
    const out = this.out;
    if (out.count === out.mesh.length) {
      const n = out.count * 2;
      const grown = <T extends Uint16Array | Float32Array | Uint8Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(n);
        b.set(a);
        return b;
      };
      [out.mesh, out.owner, out.yaw] = [grown(out.mesh), grown(out.owner), grown(out.yaw)];
      [out.x, out.y, out.z] = [grown(out.x), grown(out.y), grown(out.z)];
      [out.tw, out.cut] = [grown(out.tw), grown(out.cut)];
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

  /** A wall's ends: each yields where a joint stands at it, and the wall that runs from a corner along its lowest direction draws the joint. */
  private wall(store: StructureStore, f: Frame, s: number, kind: number, k0: number, k1: number): void {
    const forms = this.forms!, cells = this.cells, m = this.m;
    if (!formCells(forms, kind, k0, k1, cells)) return;
    const dir = keyDir(k1), own = ownDir(forms, kind, k1);
    const fitted = this.looks.yields[kind] === 1 && this.tiers[this.tierOf[kind]!]!.sq >= 0;
    let first = Infinity, last = -Infinity;
    keyAnchor(k0, k1, m, 0);
    const wide = forms.def[kind]!.cells;
    for (const c of wide ?? []) {
      first = Math.min(first, c[0]);
      last = Math.max(last, c[0]);
    }
    for (let c = 0; c < cells.n; c++) {
      const along = wide ? wide[c]![0] : 0, lvl = keyLvl(cells.k1[c]!);
      for (let end = 0; end < 2; end++) {
        // The corner at this end of the cell, and the direction the wall leaves it by.
        tupleStep(m, 0, dir, (along + end) * SIDE, m, 4);
        const joint = this.corner(store, f, m, 4, lvl);
        if (joint === 0) continue;
        const from = dirTurn(dir, end * 6);
        if (((joint >> 20) & 15) === from) this.push(joint & 0xffff, s, f, m, 4, lvl, (joint >> 16) & 15, (joint >> 24) & 15);
        // Only the ends of the whole piece give way: bit 0 its own -X end, bit 1 its +X.
        const outer = wide ? (end === 0 ? along === first : along === last) : true;
        if (fitted && outer) this.out.yields[s]! |= (own === dir) === (end === 0) ? 1 : 2;
      }
    }
  }

  /**
   * The joint at the corner `m[mi]` of frame `f` at level `lvl`, or 0 for none: its mesh in the low 16 bits, then four
   * bits each its direction, the direction of the wall that draws it, and the quarter storeys it is cut to.
   */
  private corner(store: StructureStore, f: Frame, m: Int32Array, mi: number, lvl: number): number {
    if (!tupleWithin(m, mi, M_MOST)) return 0;
    const vk0 = key0(0, m[mi]!, m[mi + 1]!, m[mi + 2]!), vk1 = key1(m[mi + 3]!, lvl, 0, WALL, 0, 0);
    let found = this.corners.get(f.gid);
    if (!found) this.corners.set(f.gid, (found = new Map()));
    const key = vk0 * 524288 + (vk1 & 524287);
    const had = found.get(key);
    if (had !== undefined) return had;
    const joint = this.choose(store, f, vk0, vk1, lvl);
    found.set(key, joint);
    return joint;
  }

  private choose(store: StructureStore, f: Frame, vk0: number, vk1: number, lvl: number): number {
    const forms = this.forms!, occ = store.occupied, round = this.round;
    // A pillar there is the corner's joint already.
    if (occ.covering(f.gid, vk0, key1((vk1 & 1023) - 512, lvl, 0, POST, 0, 0)) >= 0) return 0;
    vertexEdges(vk0, vk1, lvl, WALL, round);
    let mask = 0, lowest = -1, tall = 0, rank = -1, tier = -1, one = -1, same = true, runsOn = true, reach0 = -1, tier0 = -1;
    for (let d = 0; d < DIRECTIONS; d++) {
      if (round.k0[d] === 0) continue;
      const ref = occ.covering(f.gid, round.k0[d]!, round.k1[d]!);
      if (ref < 0) continue;
      const t = store.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!;
      // The storey of the piece that reaches this level, and how far up it the piece goes on.
      const up = lvl - keyLvl(t.k1![s]!), storey = Math.floor(up / STOREY_LEVELS) * STOREY_LEVELS;
      // A piece that begins under this level has its joint from there, which this one would stand in.
      if (up !== storey) return 0;
      const reach = Math.min(STOREY_LEVELS, Math.max(1, forms.span[kind]!) - storey);
      const of = this.tierOf[kind]!;
      mask |= 1 << d;
      if (lowest < 0) lowest = d;
      if (one < 0) one = ref;
      else if (one !== ref) same = false;
      if (reach0 < 0) [reach0, tier0] = [reach, of];
      else if (reach !== reach0 || of !== tier0) runsOn = false;
      tall = Math.max(tall, reach);
      if (of >= 0 && this.tiers[of]!.rank > rank) [rank, tier] = [this.tiers[of]!.rank, of];
      if (of < 0 || !this.tiers[of]!.runsOn) runsOn = false;
    }
    // One piece through its own middle is no corner.
    if (mask === 0 || tier < 0 || (same && (mask & (mask - 1)) !== 0)) return 0;
    const made = this.tiers[tier]!;
    if (made.sq < 0) return 0;
    const straight = (mask & (mask - 1)) !== 0 && mask === ((1 << lowest) | (1 << (lowest + 6)));
    if (straight && runsOn) return 0;
    const cut = tall < STOREY_LEVELS ? tall : 0;
    // Every wall along one of the square's four ways: a free end, a corner, a tee, a cross, a straight run.
    const fold = (mask | (mask >> 3) | (mask >> 6) | (mask >> 9)) & 7;
    if ((fold & (fold - 1)) === 0) return made.sq | ((fold >> 1) << 16) | (lowest << 20) | (cut << 24);
    // The least turn between two neighbours, in twelfths: at 60 degrees or under, the wider joint.
    let gap = DIRECTIONS;
    for (let d = 0, before = -1, firstAt = -1; d <= DIRECTIONS + 11; d++) {
      if ((mask & (1 << (d % DIRECTIONS))) === 0) continue;
      if (firstAt < 0) firstAt = d;
      else if (d > firstAt + DIRECTIONS) break;
      if (before >= 0) gap = Math.min(gap, d - before);
      before = d;
    }
    const mesh = gap >= 3 && made.r15 >= 0 ? made.r15 : made.r21;
    return mesh < 0 ? 0 : mesh | (lowest << 20) | (cut << 24);
  }

  /** A slab's sides: a ceiling's yields where a wall under it comes up to it, and a foundation's with no foundation beyond it has a skirt. */
  private slab(store: StructureStore, f: Frame, chunk: number, s: number, kind: number, k0: number, k1: number): void {
    const forms = this.forms!, def = forms.def[kind]!, occ = store.occupied, cells = this.cells, round = this.round, m = this.m;
    const cls = keyCls(k0);
    if ((cls !== CLS_SQUARE && cls !== CLS_TRIANGLE) || forms.size[kind] !== SIDE || def.corner !== undefined) return;
    const tier = this.tiers[this.tierOf[kind]!]!, lvl = keyLvl(k1), dir = keyDir(k1), own = ownDir(forms, kind, k1);
    const step = CLS_STEP[cls]!, sides = cls === CLS_SQUARE ? 4 : 3;
    if (this.looks.yields[kind] === 1 && tier.sq >= 0) {
      faceEdges(k0, k1, lvl - 1, WALL, cells);
      for (let j = 0; j < sides; j++) {
        if (cells.k0[j] === 0) continue;
        const ref = occ.covering(f.gid, cells.k0[j]!, cells.k1[j]!);
        if (ref < 0) continue;
        const t = store.chunks[Math.floor(ref / 65536)]!, under = t.kind[ref & 0xffff]!, top = forms.def[under]!.edges?.[0];
        // The wall owns its top where it is level and comes up to the slab.
        if (keyLvl(t.k1![ref & 0xffff]!) + forms.span[under]! < lvl || (top !== undefined && top.profile !== "flat")) continue;
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
