// Where a piece goes when it is built.
//
// One set of functions, used by the client to show where a piece would go and
// by the server to decide where it does go, so that the two cannot disagree.
// A client never sends a position for a piece that joins another: it names
// the piece it joins, which of that piece's places, and how the new piece is
// turned, and the server works the position out again from its own rows.
//
// Everything here is in whole numbers of the lattice structures are kept on
// (1/512 m), so nothing drifts. A piece that joins another takes its frame:
// its place is the other's place plus whole half-sides along that frame's two
// axes, and those two axes are a pair of whole-number vectors worked out from
// the frame's turn alone. Going round any loop of pieces adds and takes away
// the same vectors and so ends exactly where it began.

import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { PartTable, StructureStore } from "./structures.ts";

/** Roles, as indices into PIECE_ROLES of shared/content/defs.ts. */
export const ROLE_FOUNDATION = 0;
export const ROLE_WALL = 1;
export const ROLE_CEILING = 2;
export const ROLE_PILLAR = 3;
export const ROLE_DOOR = 4;
export const ROLE_STAIRS = 5;

/** Half a side of a piece, in lattice units: a metre and a half. */
export const HALF_SIDE = (STRUCT_UNITS * 3) / 2;
const QUARTER = YAW_UNITS / 4;
/** The most places one piece offers another. */
export const MAX_SOCKETS = 8;

/** Lattice units for a length in metres that is a whole number of them. */
export function units(metres: number): number {
  return Math.round(metres * STRUCT_UNITS);
}

/**
 * The two axes of a frame turned `yaw`, each as a whole-number vector half a
 * side long: where the frame's own +X and +Z point in the world. Written to
 * `out` as [xX, xZ, zX, zZ]. Frames a quarter turn apart share their vectors
 * exactly, swapped and signed.
 */
export function frameAxes(yaw: number, out: Int32Array): void {
  const quarters = (yaw >>> 14) & 3;
  const within = yaw & (QUARTER - 1);
  // Everything joined to one first piece shares this part of its facing: the last one asked about is kept.
  if (within !== lastWithin) {
    const a = within * (TAU / YAW_UNITS);
    lastCos = Math.round(detCos(a) * HALF_SIDE);
    lastSin = Math.round(detSin(a) * HALF_SIDE);
    lastWithin = within;
  }
  let c = lastCos;
  let s = lastSin;
  // A quarter turn takes (c, s) to (-s, c).
  for (let k = 0; k < quarters; k++) {
    const t = c;
    c = -s;
    s = t;
  }
  out[0] = c;
  out[1] = -s;
  out[2] = s;
  out[3] = c;
}

let lastWithin = -1;
let lastCos = 0;
let lastSin = 0;

/** The places one piece offers another: for each, how many half-sides along the target's X and Z, how far up in lattice units, and how many quarter turns from the target's facing. */
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

// Half-sides along X and Z to the middle of each edge, in the order north, east, south, west; a wall on edge `e`
// faces outward when it is turned `e` quarters from the piece it stands on.
const EDGE_I: readonly number[] = [0, 1, 0, -1];
const EDGE_J: readonly number[] = [1, 0, -1, 0];

/**
 * Fill `out` with the places a piece of role `piece` may join a piece of role
 * `target`. `th` and `ph` are the half heights of the two, in lattice units;
 * `doorway` says the target is a wall with a doorway. The order is fixed: a
 * place is named by its number in it.
 *
 * The rules are the reference's. A foundation joins a foundation edge to edge,
 * level. A wall stands on an edge of a foundation or a ceiling, or on a wall.
 * A ceiling joins a ceiling or a foundation edge to edge with its top level
 * with theirs; set on a wall or a pillar, its top is level with theirs too,
 * so that a storey is exactly a wall high whatever holds it up. A pillar
 * stands on the middle of a foundation, a ceiling or a pillar, or holds one up
 * from below. Stairs stand on a foundation or a ceiling. A door goes in a
 * doorway.
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
    // From below: under a foundation or a pillar, or with its top level with a ceiling's, as a wall's would be.
    put(out, 0, 0, target === ROLE_CEILING ? th - ph : -(th + ph), 0);
  } else if (floor && piece === ROLE_STAIRS) {
    put(out, 0, 0, th + ph, 0);
  } else if (target === ROLE_WALL && piece === ROLE_WALL) {
    put(out, 0, 0, th + ph, 0);
  } else if (target === ROLE_WALL && piece === ROLE_CEILING) {
    // An edge along the wall, its top level with the wall's, the rest to one side of it or the other.
    put(out, 0, 1, th - ph, 0);
    put(out, 0, -1, th - ph, 0);
  } else if (target === ROLE_WALL && piece === ROLE_DOOR && doorway) {
    // Standing on the doorway's sill.
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

/** How many ways a piece of a role may be turned in one place: stairs four, a wall or a door two (which side is which), the rest one. */
export function turnsOf(role: number): number {
  return role === ROLE_STAIRS ? 4 : role === ROLE_WALL || role === ROLE_DOOR ? 2 : 1;
}

/** Where a piece is: lattice units and a facing. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const axes = new Int32Array(4);

/**
 * The pose of a piece in place `k` of `sockets`, on a target at (tx, ty, tz)
 * lattice units facing `tyaw`, turned `turn` steps of its own.
 */
export function socketPose(sockets: Sockets, k: number, tx: number, ty: number, tz: number, tyaw: number, role: number, turn: number, out: Pose): void {
  frameAxes(tyaw, axes);
  const i = sockets.i[k]!;
  const j = sockets.j[k]!;
  out.x = tx + i * axes[0]! + j * axes[2]!;
  out.z = tz + i * axes[1]! + j * axes[3]!;
  out.y = ty + sockets.dy[k]!;
  // A wall or a door turns half way round; stairs a quarter at a time.
  const step = turnsOf(role) === 2 ? 2 : 1;
  out.yaw = (tyaw + (sockets.dq[k]! + (turn % turnsOf(role)) * step) * QUARTER) & (YAW_UNITS - 1);
}

/**
 * How far a piece's boxes are drawn in before they are tested against others,
 * and how far the others' are: neighbours touch, corners of walls cross a
 * little, and a ceiling's edge lies along the middle of the wall under it.
 */
const SHRINK = 0.15;
const SHRINK_Y = 0.05;
const THIN = 0.02;
const SHRINK_OTHER = 0.05;
const YAW_TO_RAD = TAU / YAW_UNITS;
const near = new Uint32Array(256);

/**
 * Whether a piece of `kind` at this pose (metres, and a facing) would stand
 * in the same space as something already built. Pieces that only touch, as
 * neighbours do, are not in each other's way.
 */
export function obstructed(structs: StructureStore, parts: PartTable, kind: number, x: number, y: number, z: number, yaw: number): boolean {
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const box = parts.box;
  // Everything whose footprint is near: the piece is no wider than a side and a half.
  const reach = 3;
  const n = structs.query(x - reach, z - reach, x + reach, z + reach, near);
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    // This box of the new piece, drawn in, in the world: its centre and its two half-axes.
    const hx = Math.max(THIN, box[p + 3]! - SHRINK);
    const hy = Math.max(THIN, box[p + 4]! - SHRINK_Y);
    const hz = Math.max(THIN, box[p + 5]! - SHRINK);
    const cx = x + c * box[p]! + s * box[p + 2]!;
    const cy = y + box[p + 1]!;
    const cz = z - s * box[p]! + c * box[p + 2]!;
    for (let k = 0; k < n; k++) {
      const ref = near[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const other = t.kind[slot]!;
      const oa = t.yaw[slot]! * YAW_TO_RAD;
      const os = detSin(oa);
      const oc = detCos(oa);
      for (let q = parts.start[other]! * 6, qend = parts.start[other + 1]! * 6; q < qend; q += 6) {
        const qy = t.y[slot]! + box[q + 1]!;
        if (cy - hy >= qy + box[q + 4]! || cy + hy <= qy - box[q + 4]!) continue;
        const qx = t.x[slot]! + oc * box[q]! + os * box[q + 2]!;
        const qz = t.z[slot]! - os * box[q]! + oc * box[q + 2]!;
        if (rectsCross(cx, cz, c, s, hx, hz, qx, qz, oc, os, Math.max(THIN, box[q + 3]! - SHRINK_OTHER), Math.max(THIN, box[q + 5]! - SHRINK_OTHER))) return true;
      }
    }
  }
  return false;
}

/**
 * Whether two rectangles on the ground cross. Each is a centre, the cosine
 * and sine of its turn (its own +X is (c, -s) in the world, its +Z is (s, c)),
 * and half extents along its own X and Z. They are apart exactly when one of
 * their four edge directions separates them.
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

/** How far from the eye a piece may be set down, and how far from where the look ends a piece to join is looked for: metres. */
export const BUILD_REACH = 9;
export const SNAP_SEARCH = 4;
/** A foundation may stand this far clear of the lowest ground under it, and no further: metres. */
export const MAX_ABOVE_GROUND = 2;
/** Set down on open ground, a foundation's top is this far above the highest ground under it, and a pillar's foot this far into it: lattice units. */
const FREE_TOP = STRUCT_UNITS / 8;
const PILLAR_SINK = STRUCT_UNITS / 8;
/** One step of raising or lowering a foundation set down on open ground, and how many steps either way. */
export const LIFT_STEP = STRUCT_UNITS / 8;
export const LIFT_MIN = -4;
export const LIFT_MAX = 8;

/** What a look chooses: the piece to join (a structure ref, or -1 for open ground), that piece's places nearest first, and where the look ended. */
export interface Aim {
  target: number;
  /** Numbers of the target's places, nearest to where the look ended first. */
  readonly order: Uint8Array;
  count: number;
  /** Where the look ended, metres; and whether that was on the ground. */
  px: number;
  py: number;
  pz: number;
  ground: boolean;
}

export function makeAim(): Aim {
  return { target: -1, order: new Uint8Array(MAX_SOCKETS), count: 0, px: 0, py: 0, pz: 0, ground: false };
}

/** What `pickSnap` and the checks need to know of content: per kind, its role (-1 if it is not a building piece), half height in metres, and whether it is a wall with a doorway. */
export interface PieceTables {
  readonly role: Int8Array;
  readonly halfY: Float32Array;
  readonly doorway: Uint8Array;
  readonly parts: PartTable;
}

const scratch = makeSockets();
const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const found = new Uint32Array(256);
const dist = new Float64Array(MAX_SOCKETS);

/** The places `target` offers a piece of `kind`, into `out`. Returns how many. */
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

/** The pose a piece of `kind` takes in place `k` of `target`, turned `turn`. False if there is no such place. */
export function poseAt(structs: StructureStore, tables: PieceTables, target: number, kind: number, k: number, turn: number, out: Pose): boolean {
  if (k < 0 || k >= socketsOf(structs, tables, target, kind, scratch)) return false;
  const t = structs.chunks[Math.floor(target / 65536)]!;
  const slot = target & 0xffff;
  socketPose(scratch, k, units(t.x[slot]!), units(t.y[slot]!), units(t.z[slot]!), t.yaw[slot]!, tables.role[kind]!, turn, out);
  return true;
}

/**
 * What a look from (ox, oy, oz) along the unit direction (dx, dy, dz) chooses
 * for a piece of `kind`: the piece the look lands on, if that piece has a
 * place for it; otherwise whichever piece near where the look ends has the
 * nearest place. Fills `out`. `cast` is the ray already cast for that look:
 * what it hit (HIT_* of ray.ts), the structure if it hit one, and how far.
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
    // Its places, nearest first; equal ones in their own order.
    for (let k = 0; k < n; k++) out.order[k] = k;
    for (let a = 1; a < n; a++) {
      const k = out.order[a]!;
      let b = a - 1;
      for (; b >= 0 && dist[out.order[b]!]! > dist[k]!; b--) out.order[b + 1] = out.order[b]!;
      out.order[b + 1] = k;
    }
  };
  // The piece looked at, if it will do.
  if (hitStructure >= 0) consider(hitStructure, false);
  if (out.target >= 0) return;
  // Else the one with the nearest place to where the look ended. Refs in ascending order, so that equals fall the same way everywhere.
  const n = structs.query(out.px - SNAP_SEARCH - 3, out.pz - SNAP_SEARCH - 3, out.px + SNAP_SEARCH + 3, out.pz + SNAP_SEARCH + 3, found);
  const refs = found.subarray(0, n).sort();
  for (let i = 0; i < n; i++) consider(refs[i]!, true);
}

/**
 * The pose of a foundation or a pillar set down on open ground at (px, pz)
 * metres, facing `yaw`, raised `lift` steps. A foundation's top stands a
 * little above the highest ground under it; a pillar's foot goes a little
 * into the ground. False for any other piece: it must join something.
 */
export function freePose(heightAt: (x: number, z: number) => number, tables: PieceTables, kind: number, px: number, pz: number, yaw: number, lift: number, out: Pose): boolean {
  const role = tables.role[kind]!;
  if (role !== ROLE_FOUNDATION && role !== ROLE_PILLAR) return false;
  out.x = Math.round(px * STRUCT_UNITS);
  out.z = Math.round(pz * STRUCT_UNITS);
  out.yaw = yaw & (YAW_UNITS - 1);
  const half = units(tables.halfY[kind]!);
  if (role === ROLE_PILLAR) {
    out.y = Math.floor(heightAt(out.x / STRUCT_UNITS, out.z / STRUCT_UNITS) * STRUCT_UNITS) - PILLAR_SINK + half;
    return true;
  }
  const steps = lift < LIFT_MIN ? LIFT_MIN : lift > LIFT_MAX ? LIFT_MAX : Math.trunc(lift);
  out.y = Math.ceil(groundUnder(heightAt, out, true) * STRUCT_UNITS) + FREE_TOP + steps * LIFT_STEP - half;
  return true;
}

/** The highest (or lowest) ground under a piece a side square at `p`: at its middle and its four corners, metres. */
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

/** Whether a foundation at this pose stands further clear of the lowest ground under it than a foundation may. */
export function tooHigh(heightAt: (x: number, z: number) => number, tables: PieceTables, kind: number, p: Pose): boolean {
  if (tables.role[kind] !== ROLE_FOUNDATION) return false;
  return (p.y - units(tables.halfY[kind]!)) / STRUCT_UNITS - groundUnder(heightAt, p, false) > MAX_ABOVE_GROUND;
}
