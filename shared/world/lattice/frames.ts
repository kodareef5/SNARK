// The bases of a world. A frame is one base: where its lattice's origin is, on the 1/512 m lattice, and how it is turned.
// A piece's key says where it is in its frame and holds nothing of the world, so poseOf is the one place a pose is made
// from one: a frame that moves later changes its own four numbers and no row.
//
// What a key's turn and flip mean, here and in blueprint.ts. A piece's own +X is direction dir − rot·(12 / turns), turns
// being its form's: as formPose adds a turn to yaw. A square, an edge and a vertex turn where they stand. A triangle's
// turn names the same cell from the corner its own +X leaves, and that corner is then its reference point. A flipped
// piece is mirrored in its own X about the middle of its slot, so it fills the same cells: its origin is mirrored here,
// and its solid is its collider's to mirror. A form of one turn may be turned too, by its class's turns (CLS_ROTS): it
// is the same solid, and so a ceiling set off a side wall keeps the yaw it has today.

import { YAW_UNITS } from "../../coords.ts";
import { basisOf, dirVector, levelY, twOf, yawOf } from "./basis.ts";
import type { FormTable } from "./forms.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, DIRECTIONS, DIRS, LVL_MOST, M_MOST, SIDE, canon, canonical, dirTurn, key0, key1, keyCls, keyDir, keyFlip, keyLayer, keyLvl, keyM0, keyM1, keyM2, keyM3, keyRot, keyValid, tupleStep, tupleWithin } from "./module.ts";

/** A piece's address: its frame's gid and the two words of its key. */
export interface LatticeKey {
  fr: number;
  k0: number;
  k1: number;
}

/** Where a key puts a piece's collider origin, in lattice units, its yaw, and its direction mod 3. */
export interface LatticePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tw: number;
}

/** What a frame is made from: what a row or a save says of it. */
export interface FrameDef {
  gid: number;
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  team: number;
}

export class Frame {
  /** Never 0 and never given to another frame. */
  readonly gid: number;
  /** The lattice's origin in lattice units, `oy` the plane of level 0, and its turn. */
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  /** The owner of its rows. */
  team: number;
  /** Rows it has, and how many of them have a form that may hold a base up (`root`), grounded or not. */
  live = 0;
  roots = 0;
  /** A box in lattice units that holds every row's origin. It is the least such box unless `loose` (StructureStore.tighten). */
  minX = 0;
  minZ = 0;
  maxX = 0;
  maxZ = 0;
  loose = false;
  /** The chunks it has rows in, in the order it came to them, and its rows in each. */
  readonly chunks: number[] = [];
  readonly rows: number[] = [];
  /** Its four vectors, as basisOf writes them. */
  readonly basis = new Int32Array(8);

  constructor(gid: number, ox: number, oy: number, oz: number, yaw: number, team: number) {
    this.gid = gid;
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.yaw = yaw;
    this.team = team;
    basisOf(yaw, this.basis);
  }
}

const NO_FRAMES: readonly Frame[] = [];

export class Frames {
  private readonly byGid = new Map<number, Frame>();
  /** Per chunk, the frames with rows in it, in the order they came. */
  private readonly dir: (Frame[] | null)[];
  /** The gid the next frame made here takes. */
  next = 1;
  /** Bumped each time a frame comes to a chunk it had no row in. */
  listings = 0;

  constructor(chunks: number) {
    this.dir = new Array<Frame[] | null>(chunks).fill(null);
  }

  get count(): number {
    return this.byGid.size;
  }

  /** A new frame with no rows. `gid` is given where another store made the frame; it must be free. */
  make(ox: number, oy: number, oz: number, yaw: number, team: number, gid = 0): Frame {
    if (gid === 0) gid = this.next;
    else if (this.byGid.has(gid)) throw new Error(`frame ${gid} is already made`);
    if (gid >= this.next) this.next = gid + 1;
    const f = new Frame(gid, ox, oy, oz, yaw & (YAW_UNITS - 1), team);
    this.byGid.set(gid, f);
    return f;
  }

  get(gid: number): Frame | undefined {
    return this.byGid.get(gid);
  }

  /** Every frame, in the order they were made. */
  all(): IterableIterator<Frame> {
    return this.byGid.values();
  }

  /** The frames with rows in `chunk`. */
  listed(chunk: number): readonly Frame[] {
    return this.dir[chunk] ?? NO_FRAMES;
  }

  /** Forgets a frame that has no rows. False if it has some, or is not made. */
  drop(gid: number): boolean {
    const f = this.byGid.get(gid);
    return f !== undefined && f.live === 0 && this.byGid.delete(gid);
  }

  /** Counts a row at (x, z) lattice units in `chunk` into `f`. */
  enter(f: Frame, chunk: number, x: number, z: number, root: boolean): void {
    let i = f.chunks.indexOf(chunk);
    if (i < 0) {
      i = f.chunks.push(chunk) - 1;
      f.rows.push(0);
      (this.dir[chunk] ??= []).push(f);
      this.listings++;
    }
    f.rows[i]!++;
    if (root) f.roots++;
    if (f.live++ === 0) {
      f.minX = f.maxX = x;
      f.minZ = f.maxZ = z;
      f.loose = false;
      return;
    }
    if (x < f.minX) f.minX = x;
    else if (x > f.maxX) f.maxX = x;
    if (z < f.minZ) f.minZ = z;
    else if (z > f.maxZ) f.maxZ = z;
  }

  /** Counts that row out again. The frame is forgotten with its last row. */
  leave(f: Frame, chunk: number, x: number, z: number, root: boolean): void {
    const i = f.chunks.indexOf(chunk);
    if (--f.rows[i]! === 0) {
      f.chunks.splice(i, 1);
      f.rows.splice(i, 1);
      const list = this.dir[chunk]!;
      list.splice(list.indexOf(f), 1);
    }
    if (root) f.roots--;
    if (x === f.minX || x === f.maxX || z === f.minZ || z === f.maxZ) f.loose = true;
    if (--f.live === 0) this.byGid.delete(f.gid);
  }
}

/** The turns of a slot of each class: quarter turns of a vertex or a square, half turns of an edge, a triangle's three corners. */
export const CLS_ROTS: readonly number[] = [4, 2, 4, 3];

/** How many turns a key of a piece of `kind` may have: its form's, or its class's for a form of one turn. */
export function rotsOf(forms: FormTable, kind: number): number {
  const turns = forms.turns[kind]!;
  return turns === 1 ? CLS_ROTS[forms.cls[kind]!]! : turns;
}

/** The direction of a keyed piece's own +X: dir − rot·(12 / turns). */
export function ownDir(forms: FormTable, kind: number, k1: number): number {
  const d = keyDir(k1);
  // Unturned, the direction is the key's own: no division.
  if (keyRot(k1) === 0) return d < DIRECTIONS ? d : d - DIRECTIONS;
  return dirTurn(d, (-keyRot(k1) * DIRECTIONS) / rotsOf(forms, kind));
}

/** The direction mod 3 of a keyed piece's own +X: what its row's `tw` holds. */
export function twOfKey(forms: FormTable, kind: number, k1: number): number {
  return twOf(ownDir(forms, kind, k1));
}

/** Whether a key names a slot a piece of `kind` may fill: a sound key of its form's class and layer, with a turn it may have. */
export function keyFits(forms: FormTable, kind: number, k0: number, k1: number): boolean {
  return keyValid(k0, k1) && keyCls(k0) === forms.cls[kind] && keyLayer(k1) === forms.layer[kind] && keyRot(k1) < rotsOf(forms, kind);
}

/**
 * The levels a roof of `kind` with this key rises at each corner of its face, three bits a corner, the face's corners in
 * the order elementCorners gives them; 0 for a piece that is no roof. A form's square outline starts at its -X, +Z
 * corner and goes round against the face's; a triangle's starts at its reference corner.
 */
export function riseAt(forms: FormTable, kind: number, k0: number, k1: number): number {
  const corners = forms.rise[kind]!;
  if (corners === 0) return 0;
  const turned = dirTurn(ownDir(forms, kind, k1), -keyDir(k1));
  const flip = keyFlip(k1);
  let rise = 0;
  if (keyCls(k0) === CLS_SQUARE) {
    for (let k = 0; k < 4; k++) {
      const j = (3 + turned / 3 - k) & 3;
      rise |= ((corners >> (3 * (flip ? j ^ 1 : j))) & 7) << (3 * k);
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const j = [0, 2, 1][(k - turned / 4 + 3) % 3]!;
      rise |= ((corners >> (3 * (flip ? 2 - j : j))) & 7) << (3 * k);
    }
  }
  return rise;
}

const m = new Int32Array(4);
const v = new Int32Array(4);
const basis = new Int32Array(8);

/**
 * The pose of a piece of `kind` whose key is (k0, k1) in frame `f`, to `out`, by the rule at the head of this file. The
 * form's `at` runs along the slot's axes whatever the turn: for a triangle, along the side its own +X is.
 */
export function poseOf(f: Frame, k0: number, k1: number, forms: FormTable, kind: number, out: LatticePose): void {
  const cls = keyCls(k0);
  const side = forms.size[kind]!;
  const dir = keyDir(k1);
  const own = ownDir(forms, kind, k1);
  const small = cls === CLS_SQUARE && side !== SIDE;
  let slot = dir;
  // The key's anchor, then the slot's reference point, as tuples in locals.
  let m0 = keyM0(k0);
  let m1 = keyM1(k0);
  let m2 = keyM2(k0);
  let m3 = keyM3(k1);
  let e = -1;
  let n = 0;
  if (cls === CLS_TRIANGLE) {
    // Its sides run along dir, dir + 4 and dir + 8 from its first, second and third corners.
    const corner = dirTurn(own, -dir) / 4;
    if (corner !== 0) {
      e = dirTurn(dir, corner === 1 ? 0 : 2) * 4;
      n = side;
    }
    slot = own;
  } else if (cls === CLS_EDGE || (cls === CLS_SQUARE && !small)) {
    e = dir * 4;
    n = SIDE / 2;
  }
  // `| 0` as the Int32Array scratch stored them: a direction past the twelve steps by nothing.
  if (e >= 0) {
    m0 = (m0 + n * DIRS[e]!) | 0;
    m1 = (m1 + n * DIRS[e + 1]!) | 0;
    m2 = (m2 + n * DIRS[e + 2]!) | 0;
    m3 = (m3 + n * DIRS[e + 3]!) | 0;
  }
  if (cls === CLS_SQUARE && !small) {
    const q = dirTurn(dir, 3) * 4;
    m0 = (m0 + (SIDE / 2) * DIRS[q]!) | 0;
    m1 = (m1 + (SIDE / 2) * DIRS[q + 1]!) | 0;
    m2 = (m2 + (SIDE / 2) * DIRS[q + 2]!) | 0;
    m3 = (m3 + (SIDE / 2) * DIRS[q + 3]!) | 0;
  }
  let i = forms.atI[kind]!;
  let j = forms.atJ[kind]!;
  if (keyFlip(k1) === 1) {
    // Along the slot's +X or +Z, whichever its own X lies on: `at` taken from twice the middle's place past the reference point.
    let wide = 1;
    for (const c of forms.def[kind]!.cells ?? []) wide = Math.max(wide, c[0] + 1);
    if (((dirTurn(slot, -own) / 3) & 1) === 1) j = (small ? 1 : 0) - j;
    else i = (cls === CLS_EDGE ? (wide - 1) * SIDE : cls === CLS_TRIANGLE ? side : small ? 1 : 0) - i;
  }
  const b = f.basis;
  // worldOf and dirVector, whose Int32Array scratch held 32-bit results.
  const wx = (f.ox + m0 * b[0]! + m1 * b[2]! + m2 * b[4]! + m3 * b[6]!) | 0;
  const wz = (f.oz + m0 * b[1]! + m1 * b[3]! + m2 * b[5]! + m3 * b[7]!) | 0;
  dirVector(b, slot, v, 2);
  const vx = v[2]!;
  const vz = v[3]!;
  // The slot's +Z is its +X a quarter turn on.
  out.x = wx + i * vx - j * vz;
  out.z = wz + i * vz + j * vx;
  // A level is a plane, so a pillar under a foundation ends at the foundation's top, not its underside.
  out.y = levelY(f.oy, keyLvl(k1)) + forms.atY[kind]!;
  out.yaw = yawOf(f.yaw, own);
  out.tw = twOf(own);
}

/**
 * The key of a piece of `kind` at level `lvl` whose slot has its reference point at the tuple `p[pi]` and whose own +X
 * is direction `own`, to `out`, whose frame is left as it is: poseOf the other way, in the lattice's own numbers. A
 * vertex's reference point is itself, an edge's its middle, a whole square's its centre, a triangle's and a quarter
 * square's the corner its own +X leaves. False where its form has no slot so turned, or the slot is off the lattice.
 */
export function keyAt(forms: FormTable, kind: number, p: Int32Array, pi: number, lvl: number, own: number, out: LatticeKey): boolean {
  const cls = forms.cls[kind]!;
  const side = forms.size[kind]!;
  if (cls < 0 || Math.abs(lvl) > LVL_MOST) return false;
  m[0] = p[pi]!;
  m[1] = p[pi + 1]!;
  m[2] = p[pi + 2]!;
  m[3] = p[pi + 3]!;
  const small = cls === CLS_SQUARE && side !== SIDE;
  // Back from the reference point to the corner the element is named from along its own +X.
  if (cls === CLS_EDGE || (cls === CLS_SQUARE && !small)) tupleStep(m, 0, own, -SIDE / 2, m, 0);
  if (cls === CLS_SQUARE && !small) tupleStep(m, 0, dirTurn(own, 3), -SIDE / 2, m, 0);
  // A quarter square is named from the one corner however it is turned.
  if (small) canon.dir = own % 3;
  else canonical(cls, m, 0, own, m, 0, side);
  const rots = rotsOf(forms, kind);
  // A triangle named from its corner `turn` has its own +X 4·turn on from its cell's direction.
  const rot = cls === CLS_TRIANGLE ? (3 - canon.turn) % 3 : (dirTurn(canon.dir, -own) * rots) / DIRECTIONS;
  if (!Number.isInteger(rot) || rot >= rots || !tupleWithin(m, 0, M_MOST)) return false;
  out.k0 = key0(cls, m[0]!, m[1]!, m[2]!);
  out.k1 = key1(m[3]!, lvl, canon.dir, forms.layer[kind]!, rot, 0);
  return true;
}
/**
 * The origin of a new base whose first piece is of `kind` with its collider origin at (x, y, z) lattice units, turned
 * `yaw`: where the piece's key is the corner (0, 0, 0, 0) along direction 0 at level 0, unturned. A foundation's top is
 * the plane of level 0, and its corner at the origin is the one toward -X and -Z.
 */
export function baseOrigin(forms: FormTable, kind: number, x: number, y: number, z: number, yaw: number, out: { ox: number; oy: number; oz: number }): void {
  basisOf(yaw, basis);
  const cls = forms.cls[kind]!;
  // Half-sides from the corner to the slot's reference point, along +X and +Z.
  const i = forms.atI[kind]! + (cls === CLS_EDGE || (cls === CLS_SQUARE && forms.size[kind] === SIDE) ? SIDE / 2 : 0);
  const j = forms.atJ[kind]! + (cls === CLS_SQUARE && forms.size[kind] === SIDE ? SIDE / 2 : 0);
  out.ox = x - i * basis[0]! - j * basis[6]!;
  out.oz = z - i * basis[1]! - j * basis[7]!;
  out.oy = y - forms.atY[kind]!;
}
