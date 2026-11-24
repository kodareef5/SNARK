// The bases of a world. A frame is one base: where its lattice's origin is, on the 1/512 m lattice, and how it is turned.
// A piece's key says where it is in its frame and holds nothing of the world, so poseOf is the one place a pose is made
// from one: a frame that moves later changes its own four numbers and no row.

import { YAW_UNITS } from "../../coords.ts";
import { QUARTER_YAW, basisOf, dirVector, levelY, twOf, worldOf, yawOf } from "./basis.ts";
import type { FormTable } from "./forms.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, SIDE, dirTurn, keyAnchor, keyCls, keyDir, keyFlip, keyLayer, keyLvl, keyRot, keyValid, tupleStep } from "./module.ts";

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

/** How many turns a piece may be given in a slot of each class: quarter turns of a vertex or a square, half turns of an edge, a triangle's three corners. */
export const CLS_ROTS: readonly number[] = [4, 2, 4, 3];

/**
 * Whether a key names a slot a piece of `kind` may fill: a sound key of its form's class and layer, turned no more than
 * its class turns. A key's flip must be 0 until some form is mirrored.
 */
export function keyFits(forms: FormTable, kind: number, k0: number, k1: number): boolean {
  const cls = keyCls(k0);
  return keyValid(k0, k1) && cls === forms.cls[kind] && keyLayer(k1) === forms.layer[kind] && keyFlip(k1) === 0 && keyRot(k1) < CLS_ROTS[cls]!;
}

/** The direction mod 3 of a keyed piece's +X: what its row's `tw` holds. */
export function twOfKey(k0: number, k1: number): number {
  return twOf(keyCls(k0) === CLS_TRIANGLE ? keyDir(k1) + 4 * keyRot(k1) : keyDir(k1));
}

const m = new Int32Array(4);
const v = new Int32Array(4);
const basis = new Int32Array(8);

/**
 * The pose of a piece of `kind` whose key is (k0, k1) in frame `f`, to `out`. The slot's reference point and facing come
 * from the cell: a square, an edge and a vertex face along the key's direction, and the key's turn turns the piece where
 * it stands, by quarters for a square or a vertex and by halves for an edge. A triangle's turn names it from its next
 * corner instead. The form's `at` runs along the slot's axes whatever the turn.
 */
export function poseOf(f: Frame, k0: number, k1: number, forms: FormTable, kind: number, out: LatticePose): void {
  const cls = keyCls(k0);
  const rot = keyRot(k1);
  const side = forms.size[kind]!;
  let dir = keyDir(k1);
  let turned = 0;
  keyAnchor(k0, k1, m, 0);
  if (cls === CLS_TRIANGLE) {
    if (rot !== 0) tupleStep(m, 0, dirTurn(dir, rot === 1 ? 0 : 2), side, m, 0);
    dir = dirTurn(dir, 4 * rot);
  } else if (cls === CLS_EDGE) {
    tupleStep(m, 0, dir, SIDE / 2, m, 0);
    turned = rot * 2 * QUARTER_YAW;
  } else {
    if (cls === CLS_SQUARE && side === SIDE) {
      tupleStep(m, 0, dir, SIDE / 2, m, 0);
      tupleStep(m, 0, dirTurn(dir, 3), SIDE / 2, m, 0);
    }
    turned = rot * QUARTER_YAW;
  }
  worldOf(f.basis, f.ox, f.oz, m, 0, v, 0);
  dirVector(f.basis, dir, v, 2);
  const i = forms.atI[kind]!;
  const j = forms.atJ[kind]!;
  // The slot's +Z is its +X a quarter turn on.
  out.x = v[0]! + i * v[2]! - j * v[3]!;
  out.z = v[1]! + i * v[3]! + j * v[2]!;
  // By this a pillar under a foundation ends at its top plane; one hung from its underside today is on no level (structures.ts adopt).
  out.y = levelY(f.oy, keyLvl(k1)) + forms.atY[kind]!;
  out.yaw = (yawOf(f.yaw, dir) + turned) & (YAW_UNITS - 1);
  out.tw = twOf(dir);
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
