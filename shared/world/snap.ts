// Client and server place pieces with these functions. A piece that joins another is sent as target, socket and turn, never a position.
// All positions are whole lattice units (1/512 m) and frame axes are whole-number vectors, so any loop of pieces closes exactly.

import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { Solid, boxSolid, hullFace, partSolid, rayHull, solidsCross } from "./convex.ts";
import { frame, frameAxes, frameOf } from "./frame.ts";
import { Found, type PartTable, type StructureStore } from "./structures.ts";

export { HALF_SIDE, frameAxes } from "./frame.ts";

/** Indices into PIECE_ROLES of shared/content/defs.ts. */
export const ROLE_FOUNDATION = 0;
export const ROLE_WALL = 1;
export const ROLE_CEILING = 2;
export const ROLE_PILLAR = 3;
export const ROLE_DOOR = 4;
export const ROLE_STAIRS = 5;
/** Set down on the ground or on a floor and joined to nothing (a box, a vault). */
export const ROLE_THING = 6;
/** In a build request, this socket number means "on top of the target, at the point that follows". */
export const ON_TOP = 255;

const QUARTER = YAW_UNITS / 4;
/** The most sockets one piece offers another. */
export const MAX_SOCKETS = 8;

/** `metres` must be a whole number of lattice units. */
export function units(metres: number): number {
  return Math.round(metres * STRUCT_UNITS);
}

/**
 * The sockets one piece offers another. Each is half-sides along the target's X and Z (i, j), lattice units up (dy), and quarter
 * turns from the target's facing (dq).
 */
export interface Sockets {
  n: number;
  readonly i: Int8Array;
  readonly j: Int8Array;
  readonly dy: Int32Array;
  readonly dq: Int8Array;
}

export function makeSockets(): Sockets {
  return { n: 0, i: new Int8Array(MAX_SOCKETS), j: new Int8Array(MAX_SOCKETS), dy: new Int32Array(MAX_SOCKETS), dq: new Int8Array(MAX_SOCKETS) };
}

// Half-sides along X and Z to the middle of each edge, in the order north, east, south, west. A wall on edge `e`
// faces outward when it is turned `e` quarters from the piece it stands on.
const EDGE_I: readonly number[] = [0, 1, 0, -1];
const EDGE_J: readonly number[] = [1, 0, -1, 0];

/**
 * Fills `out` with the sockets a piece of role `piece` may take on a piece of role `target`. `th` and `ph` are their half heights in
 * lattice units. The order is fixed, because a socket is named by its index. The rules are the reference's. A ceiling set on a wall
 * or a pillar has its top level with theirs, so a storey is exactly a wall high.
 */
export function socketsFor(target: number, piece: number, th: number, ph: number, doorway: boolean, out: Sockets): void {
  out.n = 0;
  const floor = target === ROLE_FOUNDATION || target === ROLE_CEILING;
  if (floor && (piece === ROLE_CEILING || (piece === ROLE_FOUNDATION && target === ROLE_FOUNDATION))) {
    // Edge to edge, tops level.
    for (let e = 0; e < 4; e++) put(out, EDGE_I[e]! * 2, EDGE_J[e]! * 2, th - ph, 0);
  } else if (floor && piece === ROLE_WALL) {
    for (let e = 0; e < 4; e++) put(out, EDGE_I[e]!, EDGE_J[e]!, th + ph, e);
  } else if ((floor || target === ROLE_PILLAR) && piece === ROLE_PILLAR) {
    put(out, 0, 0, th + ph, 0);
    // The pillar from below. It goes under a foundation or a pillar, or has its top level with a ceiling's, as a wall's is.
    put(out, 0, 0, target === ROLE_CEILING ? th - ph : -(th + ph), 0);
  } else if (floor && piece === ROLE_STAIRS) {
    put(out, 0, 0, th + ph, 0);
  } else if (target === ROLE_WALL && piece === ROLE_WALL) {
    put(out, 0, 0, th + ph, 0);
  } else if (target === ROLE_WALL && piece === ROLE_CEILING) {
    // One edge lies along the wall with its top level with the wall's. The ceiling extends to one side or the other.
    put(out, 0, 1, th - ph, 0);
    put(out, 0, -1, th - ph, 0);
  } else if (target === ROLE_WALL && piece === ROLE_DOOR && doorway) {
    // The door stands on the doorway's sill.
    put(out, 0, 0, ph - th, 0);
  } else if (target === ROLE_PILLAR && piece === ROLE_CEILING) {
    put(out, 0, 0, th - ph, 0);
  }
}

function put(out: Sockets, i: number, j: number, dy: number, dq: number): void {
  const n = out.n++;
  out.i[n] = i;
  out.j[n] = j;
  out.dy[n] = dy;
  out.dq[n] = dq;
}

/** Turns a piece of this role may take in one socket: four for stairs, two for a wall or a door (either side out), one for the rest. */
export function turnsOf(role: number): number {
  return role === ROLE_STAIRS ? 4 : role === ROLE_WALL || role === ROLE_DOOR ? 2 : 1;
}

/** Lattice units and a facing. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const axes = new Int32Array(4);

/** The pose of a piece in socket `k` on a target at (tx, ty, tz) lattice units facing `tyaw`, turned `turn` steps. */
export function socketPose(sockets: Sockets, k: number, tx: number, ty: number, tz: number, tyaw: number, role: number, turn: number, out: Pose): void {
  frameAxes(tyaw, axes);
  const i = sockets.i[k]!;
  const j = sockets.j[k]!;
  out.x = tx + i * axes[0]! + j * axes[2]!;
  out.z = tz + i * axes[1]! + j * axes[3]!;
  out.y = ty + sockets.dy[k]!;
  // A wall or a door turns by half turns, stairs by quarter turns.
  const step = turnsOf(role) === 2 ? 2 : 1;
  out.yaw = (tyaw + (sockets.dq[k]! + (turn % turnsOf(role)) * step) * QUARTER) & (YAW_UNITS - 1);
}

/**
 * Metres a new piece's boxes shrink before the overlap test, and SHRINK_OTHER for built pieces. Neighbours touch, wall corners
 * cross a little, and a ceiling's edge lies along the middle of the wall under it.
 */
const SHRINK = 0.15;
const SHRINK_Y = 0.05;
const THIN = 0.02;
const SHRINK_OTHER = 0.05;
const YAW_TO_RAD = TAU / YAW_UNITS;
const near = new Found();
/** The new piece's parts and one of a built piece's, as solids. */
const mine: Solid[] = [];
const theirs = new Solid();

/** Metres to the piece `enemyGap` last found, and the metres its role needs. */
export const enemyGapFound = { metres: 0, needs: 0 };

/**
 * The nearest foundation or pillar of a team other than `team` that stands too near (x, z) for a piece to be built
 * there: within `foundation` metres of a foundation, or `pillar` of a pillar. Fills `enemyGapFound`; false for none.
 */
export function enemyGap(structs: StructureStore, role: ArrayLike<number>, team: number, x: number, z: number, foundation: number, pillar: number): boolean {
  const dims = structs.dims;
  let best = Infinity;
  for (let cz = Math.max(0, Math.floor((z - foundation) / 64)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + foundation) / 64)); cz++) {
    for (let cx = Math.max(0, Math.floor((x - foundation) / 64)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + foundation) / 64)); cx++) {
      const t = structs.chunks[cz * dims.chunksX + cx];
      if (!t) continue;
      for (let s = 0; s < t.high; s++) {
        const owner = t.owner[s]!, r = role[t.kind[s]!]!;
        if (owner === 0 || owner === team || (r !== ROLE_FOUNDATION && r !== ROLE_PILLAR)) continue;
        const reach = r === ROLE_FOUNDATION ? foundation : pillar;
        const dx = t.x[s]! - x, dz = t.z[s]! - z, far = dx * dx + dz * dz;
        if (far < reach * reach && far < best) [best, enemyGapFound.needs] = [far, reach];
      }
    }
  }
  enemyGapFound.metres = Math.sqrt(best);
  return best !== Infinity;
}

/** The structure `obstructed` last found in the way, or -1. */
export const obstruction = { ref: -1 };

/**
 * Whether a piece of `kind` at this pose (metres) overlaps a built structure. Pieces that only touch, as neighbours do, do not
 * count. Boxes meet boxes by their shrunk rectangles; a convex part meets a box or a part as solids that give way as much.
 */
export function obstructed(structs: StructureStore, parts: PartTable, kind: number, x: number, y: number, z: number, yaw: number, restoringMapPiece = false): boolean {
  obstruction.ref = -1;
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const box = parts.box;
  // Query every structure whose footprint reaches as far as the piece does from its middle.
  const reach = structs.spread[kind]!;
  let n = structs.query(x - reach, z - reach, x + reach, z + reach, near);
  const refs = near.refs;
  if (restoringMapPiece) {
    // The original map pieces already stood together.
    let built = 0;
    for (let i = 0; i < n; i++) {
      const ref = refs[i]!;
      if ((ref & 0xffff) >= structs.chunks[Math.floor(ref / 65536)]!.mapped) refs[built++] = ref;
    }
    n = built;
  }
  if (n === 0) return false;
  // The player-built piece keeps its placement tolerance when the map piece returns.
  const side = restoringMapPiece ? SHRINK_OTHER : SHRINK, otherSide = restoringMapPiece ? SHRINK : SHRINK_OTHER;
  const vertical = restoringMapPiece ? 0 : SHRINK_Y, otherVertical = restoringMapPiece ? SHRINK_Y : 0;
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    // This box of the new piece, shrunk, in world space.
    const hx = Math.max(THIN, box[p + 3]! - side);
    const hy = restoringMapPiece ? box[p + 4]! : Math.max(THIN, box[p + 4]! - vertical);
    const hz = Math.max(THIN, box[p + 5]! - side);
    const cx = x + c * box[p]! + s * box[p + 2]!;
    const cy = y + box[p + 1]!;
    const cz = z - s * box[p]! + c * box[p + 2]!;
    for (let k = 0; k < n; k++) {
      const ref = refs[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const other = t.kind[slot]!;
      const oa = t.yaw[slot]! * YAW_TO_RAD;
      const os = detSin(oa);
      const oc = detCos(oa);
      for (let q = parts.start[other]! * 6, qend = parts.start[other + 1]! * 6; q < qend; q += 6) {
        const qy = t.y[slot]! + box[q + 1]!;
        const qh = restoringMapPiece ? Math.max(THIN, box[q + 4]! - otherVertical) : box[q + 4]!;
        if (cy - hy >= qy + qh || cy + hy <= qy - qh) continue;
        const qx = t.x[slot]! + oc * box[q]! + os * box[q + 2]!;
        const qz = t.z[slot]! - os * box[q]! + oc * box[q + 2]!;
        if (rectsCross(cx, cz, c, s, hx, hz, qx, qz, oc, os, Math.max(THIN, box[q + 3]! - otherSide), Math.max(THIN, box[q + 5]! - otherSide))) return (obstruction.ref = ref) >= 0;
      }
    }
  }
  const hulls = parts.hulls;
  if (!hulls) return false;
  const boxes = parts.start[kind + 1]! - parts.start[kind]!;
  const count = boxes + hulls.start[kind + 1]! - hulls.start[kind]!;
  let made = false;
  for (let k = 0; k < n; k++) {
    const ref = refs[k]!;
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    const other = t.kind[slot]!;
    const otherHulls = hulls.start[other + 1]! - hulls.start[other]!;
    if (count === boxes && otherHulls === 0) continue;
    // Every part of the new piece as a solid, its convex parts after its boxes, once some part is to be asked.
    if (!made) {
      made = true;
      while (mine.length < count) mine.push(new Solid());
      for (let i = 0; i < count; i++) {
        if (i < boxes) {
          const p = (parts.start[kind]! + i) * 6;
          boxSolid(x + c * box[p]! + s * box[p + 2]!, y + box[p + 1]!, z - s * box[p]! + c * box[p + 2]!, c, s, box[p + 3]!, box[p + 4]!, box[p + 5]!, mine[i]!);
        } else partSolid(hulls, hulls.start[kind]! + i - boxes, yaw, 0, x, y, z, mine[i]!);
      }
    }
    const oa = t.yaw[slot]! * YAW_TO_RAD;
    const os = detSin(oa);
    const oc = detCos(oa);
    // Their boxes against my convex parts; then their convex parts against all of mine. Box against box was asked above.
    for (let q = parts.start[other]! * 6, qend = parts.start[other + 1]! * 6; q < qend && count > boxes; q += 6) {
      boxSolid(t.x[slot]! + oc * box[q]! + os * box[q + 2]!, t.y[slot]! + box[q + 1]!, t.z[slot]! - os * box[q]! + oc * box[q + 2]!, oc, os, box[q + 3]!, box[q + 4]!, box[q + 5]!, theirs);
      for (let i = boxes; i < count; i++) if (solidsCross(mine[i]!, side, vertical, theirs, otherSide, otherVertical, THIN)) return (obstruction.ref = ref) >= 0;
    }
    for (let h = hulls.start[other]!, hend = hulls.start[other + 1]!; h < hend; h++) {
      partSolid(hulls, h, t.yaw[slot]!, t.twAt(slot), t.x[slot]!, t.y[slot]!, t.z[slot]!, theirs);
      for (let i = 0; i < count; i++) if (solidsCross(mine[i]!, side, vertical, theirs, otherSide, otherVertical, THIN)) return (obstruction.ref = ref) >= 0;
    }
  }
  return false;
}

/**
 * Each rectangle is a centre, the cosine and sine of its turn (its +X is (c, -s) in the world, its +Z is (s, c)) and half extents
 * along its X and Z. They are apart exactly when one of their four edge directions separates them.
 */
function rectsCross(ax: number, az: number, ac: number, as: number, ahx: number, ahz: number, bx: number, bz: number, bc: number, bs: number, bhx: number, bhz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  // How much of each of B's axes lies along each of A's.
  const xx = Math.abs(ac * bc + as * bs);
  const xz = Math.abs(ac * bs - as * bc);
  // Along A's X and Z.
  if (Math.abs(dx * ac - dz * as) >= ahx + bhx * xx + bhz * xz) return false;
  if (Math.abs(dx * as + dz * ac) >= ahz + bhx * xz + bhz * xx) return false;
  // Along B's X and Z.
  if (Math.abs(dx * bc - dz * bs) >= bhx + ahx * xx + ahz * xz) return false;
  if (Math.abs(dx * bs + dz * bc) >= bhz + ahx * xz + ahz * xx) return false;
  return true;
}

// ---------------------------------------------------------------- choosing a place

/** Metres. BUILD_REACH is from the eye to the piece. SNAP_SEARCH is from the look's end point to a piece to join. */
export const BUILD_REACH = 9;
export const SNAP_SEARCH = 4;
/** Metres a foundation's underside may stand above the lowest ground under it. */
export const MAX_ABOVE_GROUND = 2;
/** Lattice units. On open ground a foundation's top sits FREE_TOP above the highest ground under it. A pillar's foot sinks PILLAR_SINK in. */
const FREE_TOP = STRUCT_UNITS / 8;
const PILLAR_SINK = STRUCT_UNITS / 8;
/** One step of raising or lowering a foundation on open ground, in lattice units, and the range of steps. */
export const LIFT_STEP = STRUCT_UNITS / 8;
export const LIFT_MIN = -4;
export const LIFT_MAX = 8;

/** What a look chooses: the target (a structure ref, or -1 for open ground), its sockets nearest first, and where the look ended. */
export interface Aim {
  target: number;
  readonly order: Uint8Array;
  count: number;
  /** Metres. `ground` is true when the look ended on the ground. */
  px: number;
  py: number;
  pz: number;
  ground: boolean;
}

export function makeAim(): Aim {
  return { target: -1, order: new Uint8Array(MAX_SOCKETS), count: 0, px: 0, py: 0, pz: 0, ground: false };
}

/** Per kind: its role (-1 if it is not a building piece), its half height in metres, and whether it is a wall with a doorway. */
export interface PieceTables {
  readonly role: Int8Array;
  readonly halfY: Float32Array;
  readonly doorway: Uint8Array;
  readonly parts: PartTable;
}

const scratch = makeSockets();
const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const found = new Found();
const dist = new Float64Array(MAX_SOCKETS);

/** Fills `out` with the sockets `target` offers a piece of `kind`. Returns how many. */
export function socketsOf(structs: StructureStore, tables: PieceTables, target: number, kind: number, out: Sockets): number {
  const t = structs.chunks[Math.floor(target / 65536)];
  const slot = target & 0xffff;
  out.n = 0;
  if (!t || slot >= t.high || t.kind[slot] === 0) return 0;
  const tk = t.kind[slot]!;
  const tr = tables.role[tk]!;
  const pr = tables.role[kind]!;
  if (tr < 0 || pr < 0) return 0;
  socketsFor(tr, pr, units(tables.halfY[tk]!), units(tables.halfY[kind]!), tables.doorway[tk] === 1, out);
  return out.n;
}

/** The pose a piece of `kind` takes in socket `k` of `target`, turned `turn`. False if there is no such socket. */
export function poseAt(structs: StructureStore, tables: PieceTables, target: number, kind: number, k: number, turn: number, out: Pose): boolean {
  if (k < 0 || k >= socketsOf(structs, tables, target, kind, scratch)) return false;
  const t = structs.chunks[Math.floor(target / 65536)]!;
  const slot = target & 0xffff;
  socketPose(scratch, k, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!), t.yaw[slot]!, tables.role[kind]!, turn, out);
  return true;
}

/**
 * Chooses the target for a piece of `kind` from a look along the unit direction (dx, dy, dz). The piece the look lands on wins if it
 * has a socket for the kind. Otherwise the piece near the look's end with the nearest socket wins. The hit arguments come from the
 * ray already cast for the look. Fills `out`.
 */
export function pickSnap(structs: StructureStore, tables: PieceTables, kind: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hitStructure: number, hitT: number, hitGround: boolean, out: Aim): void {
  out.px = ox + dx * hitT;
  out.py = oy + dy * hitT;
  out.pz = oz + dz * hitT;
  out.ground = hitGround;
  out.target = -1;
  out.count = 0;
  let best = SNAP_SEARCH * STRUCT_UNITS;
  const consider = (ref: number, mustBeat: boolean): void => {
    const n = socketsOf(structs, tables, ref, kind, scratch);
    if (n === 0) return;
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    let nearest = Infinity;
    for (let k = 0; k < n; k++) {
      socketPose(scratch, k, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!), t.yaw[slot]!, tables.role[kind]!, 0, pose);
      const ex = pose.x - out.px * STRUCT_UNITS;
      const ey = pose.y - out.py * STRUCT_UNITS;
      const ez = pose.z - out.pz * STRUCT_UNITS;
      dist[k] = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (dist[k]! < nearest) nearest = dist[k]!;
    }
    if (mustBeat && nearest >= best) return;
    best = nearest;
    out.target = ref;
    out.count = n;
    // Sockets nearest first, ties in socket order.
    for (let k = 0; k < n; k++) out.order[k] = k;
    for (let a = 1; a < n; a++) {
      const k = out.order[a]!;
      let b = a - 1;
      for (; b >= 0 && dist[out.order[b]!]! > dist[k]!; b--) out.order[b + 1] = out.order[b]!;
      out.order[b + 1] = k;
    }
  };
  if (hitStructure >= 0) consider(hitStructure, false);
  if (out.target >= 0) return;
  // Refs are tried in ascending order, so ties resolve the same way on server and client.
  const n = structs.query(out.px - SNAP_SEARCH - 3, out.pz - SNAP_SEARCH - 3, out.px + SNAP_SEARCH + 3, out.pz + SNAP_SEARCH + 3, found);
  const refs = found.refs.subarray(0, n).sort();
  for (let i = 0; i < n; i++) consider(refs[i]!, true);
}

/**
 * The pose of a foundation, a pillar or a thing set down on open ground at (px, pz) metres. `lift` steps raise or lower a
 * foundation. False for any other role, which must join a piece.
 */
export function freePose(heightAt: (x: number, z: number) => number, tables: PieceTables, kind: number, px: number, pz: number, yaw: number, lift: number, out: Pose): boolean {
  const role = tables.role[kind]!;
  if (role !== ROLE_FOUNDATION && role !== ROLE_PILLAR && role !== ROLE_THING) return false;
  out.x = Math.round(px * STRUCT_UNITS);
  out.z = Math.round(pz * STRUCT_UNITS);
  out.yaw = yaw & (YAW_UNITS - 1);
  const half = units(tables.halfY[kind]!);
  if (role === ROLE_THING) {
    // A thing stands on the ground under its middle.
    out.y = Math.ceil(heightAt(out.x / STRUCT_UNITS, out.z / STRUCT_UNITS) * STRUCT_UNITS) + half;
    return true;
  }
  if (role === ROLE_PILLAR) {
    out.y = Math.floor(heightAt(out.x / STRUCT_UNITS, out.z / STRUCT_UNITS) * STRUCT_UNITS) - PILLAR_SINK + half;
    return true;
  }
  const steps = lift < LIFT_MIN ? LIFT_MIN : lift > LIFT_MAX ? LIFT_MAX : Math.trunc(lift);
  out.y = Math.ceil(groundUnder(heightAt, out, true) * STRUCT_UNITS) + FREE_TOP + steps * LIFT_STEP - half;
  return true;
}

/** Whether the point (x, z) is over a foundation or a ceiling centred at (ox, oz) and facing `oyaw`. Lattice units. */
export function overPiece(ox: number, oz: number, oyaw: number, x: number, z: number): boolean {
  frameAxes(oyaw, axes);
  const dx = x - ox;
  const dz = z - oz;
  // Within half a side along each of the piece's two axes.
  const a = dx * axes[0]! + dz * axes[1]!;
  const b = dx * axes[2]! + dz * axes[3]!;
  return Math.abs(a) <= axes[0]! * axes[0]! + axes[1]! * axes[1]! && Math.abs(b) <= axes[2]! * axes[2]! + axes[3]! * axes[3]!;
}

/** Set by floorTop: whether the top it found is level. */
export const floorFace = { level: false };
/** The least upward share of a face's normal for it to count as level. */
const LEVEL = 0.9999;

/**
 * Where a thing set on or falling onto the foundation or ceiling at `ref`, its middle over (x, z) lattice units, rests: the
 * lattice height of the floor's top there, or NaN if it is not a floor or the point is not over it. A floor of boxes is met by
 * the top of the box that holds it, a side square about its middle. One with convex parts is met by the first of its parts
 * straight down, whose face there may slope; `floorFace` says whether it is level.
 */
export function floorTop(structs: StructureStore, tables: PieceTables, ref: number, x: number, z: number): number {
  const t = structs.chunks[Math.floor(ref / 65536)];
  const slot = ref & 0xffff;
  if (!t || slot >= t.high || t.kind[slot] === 0) return NaN;
  const kind = t.kind[slot]!;
  if (tables.role[kind] !== ROLE_FOUNDATION && tables.role[kind] !== ROLE_CEILING) return NaN;
  const parts = tables.parts;
  const hulls = parts.hulls;
  floorFace.level = true;
  if (!hulls || hulls.start[kind + 1] === hulls.start[kind]) return overPiece(units(t.x[slot]!), units(t.z[slot]!), t.yaw[slot]!, x, z) ? units(t.y[slot]!) + units(tables.halfY[kind]!) : NaN;
  // Down from over the holding box's top, measured from the piece's middle.
  const dx = x / STRUCT_UNITS - t.x[slot]!;
  const dz = z / STRUCT_UNITS - t.z[slot]!;
  const from = tables.halfY[kind]! + 1;
  let down = Infinity;
  for (let p = hulls.start[kind]!, end = hulls.start[kind + 1]!; p < end; p++) {
    const d = rayHull(hulls, p, t.yaw[slot]!, t.twAt(slot), dx, from, dz, 0, -1, 0, 0);
    if (d >= down) continue;
    down = d;
    floorFace.level = hullFace.ny >= LEVEL;
  }
  frameOf(t.yaw[slot]!, t.twAt(slot));
  const fx = frame.cos * dx - frame.sin * dz;
  const fz = frame.sin * dx + frame.cos * dz;
  const box = parts.box;
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    const d = from - box[p + 1]! - box[p + 4]!;
    if (d >= down || Math.abs(fx - box[p]! * frame.stretch) > box[p + 3]! * frame.stretch || Math.abs(fz - box[p + 2]! * frame.stretch) > box[p + 5]! * frame.stretch) continue;
    down = d;
    floorFace.level = true;
  }
  return down < Infinity ? units(t.y[slot]!) + Math.ceil((from - down) * STRUCT_UNITS - 1e-6) : NaN;
}

/**
 * The pose of a thing set on top of the piece at `target`, centred over (px, pz) metres. False if `kind` is not a thing, the
 * target is not a foundation or a ceiling, or the point is not over a level top of it: as in ARK, nothing is set on a slope.
 */
export function restPose(structs: StructureStore, tables: PieceTables, target: number, kind: number, px: number, pz: number, yaw: number, out: Pose): boolean {
  if (tables.role[kind] !== ROLE_THING) return false;
  out.x = Math.round(px * STRUCT_UNITS);
  out.z = Math.round(pz * STRUCT_UNITS);
  out.yaw = yaw & (YAW_UNITS - 1);
  const top = floorTop(structs, tables, target, out.x, out.z);
  if (Number.isNaN(top) || !floorFace.level) return false;
  out.y = top + units(tables.halfY[kind]!);
  return true;
}

/** The highest (or lowest) ground under a piece one side square at `p`, sampled at its middle and four corners. Metres. */
function groundUnder(heightAt: (x: number, z: number) => number, p: Pose, highest: boolean): number {
  frameAxes(p.yaw, axes);
  let h = heightAt(p.x / STRUCT_UNITS, p.z / STRUCT_UNITS);
  for (let k = 0; k < 4; k++) {
    const i = k & 1 ? 1 : -1;
    const j = k & 2 ? 1 : -1;
    const g = heightAt((p.x + i * axes[0]! + j * axes[2]!) / STRUCT_UNITS, (p.z + i * axes[1]! + j * axes[3]!) / STRUCT_UNITS);
    if (highest ? g > h : g < h) h = g;
  }
  return h;
}

/** True when a foundation at this pose breaks MAX_ABOVE_GROUND. False for any other role. */
export function tooHigh(heightAt: (x: number, z: number) => number, tables: PieceTables, kind: number, p: Pose): boolean {
  if (tables.role[kind] !== ROLE_FOUNDATION) return false;
  return (p.y - units(tables.halfY[kind]!)) / STRUCT_UNITS - groundUnder(heightAt, p, false) > MAX_ABOVE_GROUND;
}
