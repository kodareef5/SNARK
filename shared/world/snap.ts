// What placing asks that is not the lattice's to answer: where a piece goes on open ground or a thing on a floor, whether the
// ground allows a foundation, and whether a piece's solid meets one built. A piece that joins a base is placed by its slot
// (lattice/place.ts). All positions are whole lattice units (1/512 m).

import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { Solid, boxSolid, hullFace, partSolid, rayHull, solidsCross } from "./convex.ts";
import { classAxis, frame, frameAxes, frameOf } from "./frame.ts";
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

/** `metres` must be a whole number of lattice units. */
export function units(metres: number): number {
  return Math.round(metres * STRUCT_UNITS);
}

/** Lattice units and a facing. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const axes = new Int32Array(4);

/**
 * Metres a thing gives way by before `obstructed` asks whether it overlaps what is built, sideways and up, and what is
 * built gives way by sideways. A thing has no slot: it is set where a look ends, against a wall or on a floor, and its
 * solid there touches theirs. A lattice piece gives way by none of them: its neighbours are told by their slots.
 */
const THING_GIVE = 0.15;
const THING_GIVE_UP = 0.05;
const BUILT_GIVE = 0.05;
const THIN = 0.02;
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
 * Whether a piece of `kind` at this pose (metres) overlaps a built structure. Pieces that only touch do not count. Boxes
 * meet boxes as rectangles that have given way; a convex part meets a box or a part as solids that give way as much.
 * This is for a thing and for a map piece that returns: a lattice piece is asked by its slot (lattice/place.ts).
 */
export function obstructed(structs: StructureStore, parts: PartTable, kind: number, x: number, y: number, z: number, yaw: number, restoringMapPiece = false): boolean {
  obstruction.ref = -1;
  // Query every structure whose footprint reaches as far as the piece does from its middle.
  const reach = structs.spread[kind]!;
  const n = structs.query(x - reach, z - reach, x + reach, z + reach, near);
  const refs = near.refs;
  // What a player set down keeps its tolerance when the map piece returns.
  const side = restoringMapPiece ? BUILT_GIVE : THING_GIVE, otherSide = restoringMapPiece ? THING_GIVE : BUILT_GIVE;
  const vertical = restoringMapPiece ? 0 : THING_GIVE_UP, otherVertical = restoringMapPiece ? THING_GIVE_UP : 0;
  made = false;
  for (let k = 0; k < n; k++) {
    const ref = refs[k]!;
    // The original map pieces already stood together.
    if (restoringMapPiece && (ref & 0xffff) < structs.chunks[Math.floor(ref / 65536)]!.mapped) continue;
    if (meets(structs, parts, kind, x, y, z, yaw, 0, ref, side, vertical, otherSide, otherVertical)) return (obstruction.ref = ref) >= 0;
  }
  return false;
}

/**
 * Whether a piece of `kind` at this pose (metres), of turn class `tw`, overlaps the built row `ref`. Each gives way by its
 * metres, sideways and up, before they are asked. Both are measured in their own frames (frameOf), as colliders are.
 */
export function crosses(structs: StructureStore, parts: PartTable, kind: number, x: number, y: number, z: number, yaw: number, tw: number, ref: number, side: number, vertical: number, otherSide: number, otherVertical: number): boolean {
  made = false;
  return meets(structs, parts, kind, x, y, z, yaw, tw, ref, side, vertical, otherSide, otherVertical);
}

/** Whether `mine` holds the new piece's solids for the question being asked. */
let made = false;

/** Box against box by rectangles, and anything against a convex part as solids. */
function meets(structs: StructureStore, parts: PartTable, kind: number, x: number, y: number, z: number, yaw: number, tw: number, ref: number, side: number, vertical: number, otherSide: number, otherVertical: number): boolean {
  const box = parts.box;
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  const slot = ref & 0xffff;
  const other = t.kind[slot]!;
  frameOf(t.yaw[slot]!, t.twAt(slot));
  const os = frame.sin;
  const oc = frame.cos;
  const ok = frame.stretch;
  frameOf(yaw, tw);
  const s = frame.sin;
  const c = frame.cos;
  const k = frame.stretch;
  const tx = t.x[slot]!;
  const ty = t.y[slot]!;
  const tz = t.z[slot]!;
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    // This box of the new piece, as it has given way, in world space.
    const hx = Math.max(THIN, box[p + 3]! * k - side);
    const hy = vertical > 0 ? Math.max(THIN, box[p + 4]! - vertical) : box[p + 4]!;
    const hz = Math.max(THIN, box[p + 5]! * k - side);
    const cx = x + (c * box[p]! + s * box[p + 2]!) * k;
    const cy = y + box[p + 1]!;
    const cz = z + (c * box[p + 2]! - s * box[p]!) * k;
    for (let q = parts.start[other]! * 6, qend = parts.start[other + 1]! * 6; q < qend; q += 6) {
      const qy = ty + box[q + 1]!;
      const qh = otherVertical > 0 ? Math.max(THIN, box[q + 4]! - otherVertical) : box[q + 4]!;
      if (cy - hy >= qy + qh || cy + hy <= qy - qh) continue;
      const qx = tx + (oc * box[q]! + os * box[q + 2]!) * ok;
      const qz = tz + (oc * box[q + 2]! - os * box[q]!) * ok;
      if (rectsCross(cx, cz, c, s, hx, hz, qx, qz, oc, os, Math.max(THIN, box[q + 3]! * ok - otherSide), Math.max(THIN, box[q + 5]! * ok - otherSide))) return true;
    }
  }
  const hulls = parts.hulls;
  if (!hulls) return false;
  const boxes = parts.start[kind + 1]! - parts.start[kind]!;
  const count = boxes + hulls.start[kind + 1]! - hulls.start[kind]!;
  const otherHulls = hulls.start[other + 1]! - hulls.start[other]!;
  if (count === boxes && otherHulls === 0) return false;
  // Every part of the new piece as a solid, its convex parts after its boxes, once some part is to be asked.
  if (!made) {
    made = true;
    while (mine.length < count) mine.push(new Solid());
    for (let i = 0; i < count; i++) {
      if (i < boxes) {
        const p = (parts.start[kind]! + i) * 6;
        boxSolid(x + (c * box[p]! + s * box[p + 2]!) * k, y + box[p + 1]!, z + (c * box[p + 2]! - s * box[p]!) * k, c, s, box[p + 3]! * k, box[p + 4]!, box[p + 5]! * k, mine[i]!);
      } else partSolid(hulls, hulls.start[kind]! + i - boxes, yaw, tw, x, y, z, mine[i]!);
    }
  }
  // Their boxes against my convex parts; then their convex parts against all of mine. Box against box was asked above.
  for (let q = parts.start[other]! * 6, qend = parts.start[other + 1]! * 6; q < qend && count > boxes; q += 6) {
    boxSolid(tx + (oc * box[q]! + os * box[q + 2]!) * ok, ty + box[q + 1]!, tz + (oc * box[q + 2]! - os * box[q]!) * ok, oc, os, box[q + 3]! * ok, box[q + 4]!, box[q + 5]! * ok, theirs);
    for (let i = boxes; i < count; i++) if (solidsCross(mine[i]!, side, vertical, theirs, otherSide, otherVertical, THIN)) return true;
  }
  for (let h = hulls.start[other]!, hend = hulls.start[other + 1]!; h < hend; h++) {
    partSolid(hulls, h, t.yaw[slot]!, t.twAt(slot), tx, ty, tz, theirs);
    for (let i = 0; i < count; i++) if (solidsCross(mine[i]!, side, vertical, theirs, otherSide, otherVertical, THIN)) return true;
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

/** Metres. BUILD_REACH is from the eye to the piece. SNAP_SEARCH is from the look's end point to the middle of a slot. */
export const BUILD_REACH = 9;
export const SNAP_SEARCH = 4;
/** Metres a foundation's underside may stand above the lowest ground under it. */
export const MAX_ABOVE_GROUND = 2;
/** Metres a foundation's top may lie under the highest ground it covers. A guess. */
export const MAX_BURIED = 1;
/** Lattice units. On open ground a foundation's top sits FREE_TOP above the highest ground under it. A pillar's foot sinks PILLAR_SINK in. */
const FREE_TOP = STRUCT_UNITS / 8;
const PILLAR_SINK = STRUCT_UNITS / 8;
/** One step of raising or lowering a foundation on open ground, in lattice units, and the range of steps. */
export const LIFT_STEP = STRUCT_UNITS / 8;
export const LIFT_MIN = -4;
export const LIFT_MAX = 8;

/** Per kind: its role (-1 if it is not a building piece), its half height in metres, and whether it is a wall with a doorway. */
export interface PieceTables {
  readonly role: Int8Array;
  readonly halfY: Float32Array;
  readonly doorway: Uint8Array;
  readonly parts: PartTable;
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

/** Whether the point (x, z) is over a foundation or a ceiling centred at (ox, oz), facing `oyaw` and of turn class `tw`. Lattice units. */
export function overPiece(ox: number, oz: number, oyaw: number, x: number, z: number, tw = 0): boolean {
  squareAxes(oyaw, tw);
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
  if (!hulls || hulls.start[kind + 1] === hulls.start[kind]) return overPiece(units(t.x[slot]!), units(t.z[slot]!), t.yaw[slot]!, x, z, t.twAt(slot)) ? units(t.y[slot]!) + units(tables.halfY[kind]!) : NaN;
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

/** The +X and +Z axes of a square of this yaw and turn class, half a side long, to `axes`. */
function squareAxes(yaw: number, tw: number): void {
  if (tw === 0) return frameAxes(yaw, axes);
  classAxis(yaw, tw, axes, 0);
  axes[2] = -axes[1]!;
  axes[3] = axes[0]!;
}

/** The highest (or lowest) ground under a piece one side square at `p`, of turn class `tw`, sampled at its middle and four corners. Metres. */
function groundUnder(heightAt: (x: number, z: number) => number, p: Pose, highest: boolean, tw = 0): number {
  squareAxes(p.yaw, tw);
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
export function tooHigh(heightAt: (x: number, z: number) => number, tables: PieceTables, kind: number, p: Pose, tw = 0): boolean {
  if (tables.role[kind] !== ROLE_FOUNDATION) return false;
  return (p.y - units(tables.halfY[kind]!)) / STRUCT_UNITS - groundUnder(heightAt, p, false, tw) > MAX_ABOVE_GROUND;
}

/** True when a foundation at this pose breaks MAX_BURIED: the ground is in its way. False for any other role. */
export function buried(heightAt: (x: number, z: number) => number, tables: PieceTables, kind: number, p: Pose, tw = 0): boolean {
  if (tables.role[kind] !== ROLE_FOUNDATION) return false;
  return groundUnder(heightAt, p, true, tw) - (p.y + units(tables.halfY[kind]!)) / STRUCT_UNITS > MAX_BURIED;
}
