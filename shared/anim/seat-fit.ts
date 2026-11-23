// A seated body fitted inside its seat's room (shared/sim/seats.ts SeatRoom). The hips sink a few centimetres into the
// cushion, the back reclines where that is not enough, the hips sink on toward the floor, and last the head tips back
// with the back; the legs set the feet back on the footwell floor. Joints stay within the ragdoll's limits
// (HUMAN_RAGDOLL). Sinking comes first because it lowers the head as much as it sinks, where a small recline swings the
// head far back for the little it lowers it: a fit by recline would carry the eye about with each small change of pose.
//
// The fit is worked out on each frame's own pose, since a passenger's back is its look's and its idle's. A recline turns
// every bone above the hips about one model axis, so the head's place at any recline is found from the solved joints
// without solving again. The seat's own legs are fitted once for a seat, a body and a drop. The hands stay where the
// pose put them. Only exactly rounded arithmetic is used, so the server and every client fit a body the same.

import { quatAxis, quatCopy, quatMul, quatMulConj, quatRotate, quatUnrotate } from "../math/quat.ts";
import { detAtan2, detCos } from "../math/scalar.ts";
import type { Seat, SeatRoom } from "../sim/seats.ts";
import type { Pose } from "./clip.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R,
  B_NECK, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES, HUMAN_RAGDOLL,
} from "./human.ts";
import { aimBone, twoBone } from "./ik.ts";
import { Solved, solve } from "./skeleton.ts";

const seatBindings = new WeakMap<Float32Array, WeakMap<Float32Array, Float32Array>>();

/** The hit rig supplies the spine and shoulder heights. The drawn rig supplies shoulder width and limb lengths. */
export function passengerRest(rest: Float32Array, standard: Float32Array): Float32Array {
  if (rest === standard) return rest;
  let rigs = seatBindings.get(standard);
  if (!rigs) seatBindings.set(standard, rigs = new WeakMap());
  const cached = rigs.get(rest);
  if (cached) return cached;
  const fit = rest.slice();
  for (let b = 1; b < HUMAN_BONES; b++) {
    const p = HUMAN.parent[b]!;
    const spine = b === B_SPINE || b === B_CHEST || b === B_UPPER_CHEST || b === B_NECK || b === B_HEAD;
    const shoulder = b === B_SHOULDER_L || b === B_SHOULDER_R || b === B_UPPER_ARM_L || b === B_UPPER_ARM_R;
    for (let k = 0; k < 3; k++) {
      const source = spine || (shoulder && k !== 0) ? standard : rest;
      fit[b * 3 + k] = fit[p * 3 + k]! + (source[b * 3 + k]! - source[p * 3 + k]!);
    }
  }
  rigs.set(rest, fit);
  return fit;
}

/** The head's top stays this far under the roof. */
export const HEAD_MARGIN = .02;
/** How far the hips sink into the cushion before the back reclines. */
export const HIPS_DROP = .06;
/** The feet stay this far over the floor. */
export const FOOT_MARGIN = .005;
/** How the spine chain shares a recline, and how the neck and head share the turn that keeps the eyes level. */
const RECLINE = [[B_SPINE, .4], [B_CHEST, .35], [B_UPPER_CHEST, .25]] as const;
const LEVEL = [[B_NECK, .4], [B_HEAD, .6]] as const;
type Chain = readonly [number, number, number];
const LEGS: readonly Chain[] = [[B_UPPER_LEG_L, B_LOWER_LEG_L, B_FOOT_L], [B_UPPER_LEG_R, B_LOWER_LEG_R, B_FOOT_R]];
const ARMS: readonly Chain[] = [[B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L], [B_UPPER_ARM_R, B_LOWER_ARM_R, B_HAND_R]];

const swingOf = (bone: number): number => HUMAN_RAGDOLL.swing[HUMAN_RAGDOLL.bone.indexOf(bone)]!;
// The ragdoll's chest body takes the spine's and chest's turns; its head body the upper chest's, neck's and head's.
const HEAD_SWING = swingOf(B_HEAD);
/** The most an upright back reclines, in radians: the chest body's swing against the hips. */
export const RECLINE_MOST = swingOf(B_CHEST) / (RECLINE[0][1] + RECLINE[1][1]);
const THIGH_COS = detCos(swingOf(B_UPPER_LEG_L)), KNEE_COS = detCos(swingOf(B_LOWER_LEG_L)), ELBOW_COS = detCos(swingOf(B_LOWER_ARM_L));
const UNIT = new Float32Array(HUMAN_BONES * 3).fill(1);

/**
 * What the last fitSeated did: radians the spine chain turned back and the neck and head forward against it, metres the
 * hips sank below the anchor, and the residuals, metres the head's top came within its margin under the roof (or past
 * it) and the lowest foot lay below the floor; 0 where the body fits.
 */
export const seatFit = { recline: 0, level: 0, drop: 0, head: 0, feet: 0, side: 0, ahead: 0 };

const turn = new Float64Array(4), axis = new Float64Array(3), point = new Float64Array(3);
/** The body hits are judged on, fitted to find how far another body of the same pose leans. */
const standardSolved = new Solved(HUMAN_BONES);
/** The standard body's head middle from its hips, then the drawn body's. */
const pin = new Float64Array(6);
const elbows = new Float64Array(6), targets = new Float64Array(6), ends = new Float64Array(8), reached = new Float64Array(12), hands = new Float64Array(14);
/** The spine, chest, upper chest, neck and head joints, then the head capsule's two ends: as solved, and turned. */
const chain = new Float64Array(21), moved = new Float64Array(21);

/** The forward turn that keeps the eyes level, as far as the head's swing against the chest allows. */
function levelFor(recline: number): number {
  return Math.min(recline, HEAD_SWING + RECLINE[2][1] * recline);
}

/** Turns the spine chain back by `recline` and the neck and head forward by `level`, about the hips' side axis. */
function lean(pose: Pose, solved: Solved, recline: number, level: number): void {
  // Every bone turns about the one model axis, so the axis in each parent's frame reads the same before or after.
  quatRotate(solved.rot, B_HIPS * 4, 1, 0, 0, axis, 0);
  for (let k = 0; k < RECLINE.length + LEVEL.length; k++) {
    const [bone, share] = k < RECLINE.length ? RECLINE[k]! : LEVEL[k - RECLINE.length]!, angle = k < RECLINE.length ? -share * recline : share * level;
    quatUnrotate(solved.rot, HUMAN.parent[bone]! * 4, axis[0]!, axis[1]!, axis[2]!, point, 0);
    quatAxis(turn, 0, point[0]!, point[1]!, point[2]!, angle);
    quatMul(pose.rot, bone * 4, turn, 0, pose.rot, bone * 4);
  }
}

/** The clearance of a ball at (x, y, z), radius r, from the plane y = h + sx x + sz z: `side` 1 keeps it under, -1 over. */
function ball(x: number, y: number, z: number, r: number, h: number, sx: number, sz: number, side: number): number {
  return (h + sx * x + sz * z - y) * side / Math.sqrt(1 + sx * sx + sz * sz) - r;
}

/** The capsule radius of a bone, grown with its stretch. */
function radius(scale: Float32Array, bone: number): number {
  const at = bone * 3;
  return HUMAN.capR[bone]! * Math.max(scale[at]!, scale[at + 1]!, scale[at + 2]!);
}

/** Writes to `out` at `o` the model point of a bone's capsule end, `end` capA or capB, stretched with the bone. */
function capEnd(solved: Solved, scale: Float32Array, bone: number, end: Float32Array, out: Float64Array, o: number): void {
  const at = bone * 3;
  quatRotate(solved.rot, bone * 4, end[at]! * scale[at]!, end[at + 1]! * scale[at + 1]!, end[at + 2]! * scale[at + 2]!, point, 0);
  for (let k = 0; k < 3; k++) out[o + k] = solved.pos[at + k]! + point[k]!;
}

/**
 * The least clearance of a bone's capsule from a plane over the anchor. The hips' joint is `drop` under the anchor and
 * `aside` and `ahead` off it along the body's side and forward axes.
 */
function clearance(solved: Solved, scale: Float32Array, bone: number, drop: number, h: number, sx: number, sz: number, side: number, aside = 0, ahead = 0): number {
  const r = radius(scale, bone);
  let least = Infinity;
  for (const end of [HUMAN.capA, HUMAN.capB]) {
    capEnd(solved, scale, bone, end, moved, 0);
    least = Math.min(least, ball(moved[0]! - solved.pos[0]! + aside, moved[1]! - solved.pos[1]! - drop, moved[2]! - solved.pos[2]! + ahead, r, h, sx, sz, side));
  }
  return least;
}

/** How far a body's head clears its seat's roof, solved in `solved`, its hips `drop` below the anchor and shifted so. */
export function headClearance(solved: Solved, scale: Float32Array | null, room: SeatRoom, drop: number, aside = 0, ahead = 0): number {
  return clearance(solved, scale ?? UNIT, B_HEAD, drop, room.roof[0], room.roof[1], room.roof[2], 1, aside, ahead);
}

/** How far a foot clears its seat's floor. */
export function footClearance(solved: Solved, scale: Float32Array | null, foot: number, room: SeatRoom, drop: number, aside = 0, ahead = 0): number {
  return clearance(solved, scale ?? UNIT, foot, drop, room.floor[0], 0, room.floor[1], -1, aside, ahead);
}

/** Writes to `out` at `o` where the middle of a body's head is from its hips' joint. */
function headMiddle(solved: Solved, scale: Float32Array, out: Float64Array, o: number): void {
  capEnd(solved, scale, B_HEAD, HUMAN.capA, moved, 0); capEnd(solved, scale, B_HEAD, HUMAN.capB, moved, 3);
  for (let k = 0; k < 3; k++) out[o + k] = (moved[k]! + moved[3 + k]!) / 2 - solved.pos[k]!;
}

/** Turns the points of `moved` from index `from` about the side axis through point `about` by `angle`. */
function swing(from: number, about: number, angle: number): void {
  quatAxis(turn, 0, axis[0]!, axis[1]!, axis[2]!, angle);
  const cx = moved[about * 3]!, cy = moved[about * 3 + 1]!, cz = moved[about * 3 + 2]!;
  for (let k = from; k < 7; k++) {
    quatRotate(turn, 0, moved[k * 3]! - cx, moved[k * 3 + 1]! - cy, moved[k * 3 + 2]! - cz, point, 0);
    moved[k * 3] = cx + point[0]!; moved[k * 3 + 1] = cy + point[1]!; moved[k * 3 + 2] = cz + point[2]!;
  }
}

/** The head's clearance under the roof with the back reclined, the eyes kept level by `level` of the way, and no drop. */
function headAt(solved: Solved, r: number, room: SeatRoom, recline: number, level: number): number {
  moved.set(chain);
  const forward = levelFor(recline) * level;
  // Each joint turns what is above it: the spine about its joint, then the chest about its own, and so on up.
  swing(1, 0, -RECLINE[0][1] * recline); swing(2, 1, -RECLINE[1][1] * recline); swing(3, 2, -RECLINE[2][1] * recline);
  swing(4, 3, LEVEL[0][1] * forward); swing(5, 4, LEVEL[1][1] * forward);
  const hx = solved.pos[0]!, hy = solved.pos[1]!, hz = solved.pos[2]!;
  return Math.min(ball(moved[15]! - hx, moved[16]! - hy, moved[17]! - hz, r, room.roof[0], room.roof[1], room.roof[2], 1),
    ball(moved[18]! - hx, moved[19]! - hy, moved[20]! - hz, r, room.roof[0], room.roof[1], room.roof[2], 1));
}

/** Works out how far the hips sink, the back reclines and the head stays level for the head to clear the roof, into `seatFit`. */
function headFit(solved: Solved, scale: Float32Array, room: SeatRoom): void {
  quatRotate(solved.rot, B_HIPS * 4, 1, 0, 0, axis, 0);
  [B_SPINE, B_CHEST, B_UPPER_CHEST, B_NECK, B_HEAD].forEach((bone, k) => { for (let a = 0; a < 3; a++) chain[k * 3 + a] = solved.pos[bone * 3 + a]!; });
  capEnd(solved, scale, B_HEAD, HUMAN.capA, chain, 15); capEnd(solved, scale, B_HEAD, HUMAN.capB, chain, 18);
  const r = radius(scale, B_HEAD), norm = Math.sqrt(1 + room.roof[1] * room.roof[1] + room.roof[2] * room.roof[2]);
  // Sinking the hips lowers the head as much, which clears a sloping roof by that over its slope.
  const clears = (recline: number, level: number, drop: number): boolean => headAt(solved, r, room, recline, level) + drop / norm >= HEAD_MARGIN;
  /**
   * The least recline between `lo` and `hi` that clears the roof with the hips sunk `drop`, found by halving. A back the
   * look leans forward rises through upright first, so the head clears only past some recline, never before it.
   */
  const least = (lo: number, hi: number, drop: number): number => {
    if (clears(lo, 1, drop)) return lo;
    if (!clears(hi, 1, drop)) return hi;
    for (let step = 0; step < 24; step++) {
      const mid = (lo + hi) / 2;
      if (clears(mid, 1, drop)) hi = mid; else lo = mid;
    }
    return hi;
  };
  // A back the look leans forward may go back through upright, as far as an upright one may: the limit is on where it ends.
  quatRotate(solved.rot, B_CHEST * 4, 0, 1, 0, point, 0);
  const ux = point[0]!, uy = point[1]!, uz = point[2]!;
  quatRotate(solved.rot, B_HIPS * 4, 0, 1, 0, point, 0);
  const up = ux * point[0]! + uy * point[1]! + uz * point[2]!;
  quatRotate(solved.rot, B_HIPS * 4, 0, 0, 1, point, 0);
  const most = Math.max(0, RECLINE_MOST + detAtan2(ux * point[0]! + uy * point[1]! + uz * point[2]!, up) / (RECLINE[0][1] + RECLINE[1][1]));
  // The hips never sink so far that their own capsule meets the floor carried back under the seat.
  const deepest = Math.max(0, clearance(solved, scale, B_HIPS, 0, room.floor[0], 0, room.floor[1], -1) - FOOT_MARGIN);
  let recline = 0, drop = 0, level = 1, head = headAt(solved, r, room, 0, 1);
  if (head < HEAD_MARGIN) {
    // Whole tenths of a millimetre, rounded up, so that a seat's legs are fitted once for each.
    const sink = (need: number): number => -Math.floor(-Math.min(deepest, need) * 1e4) / 1e4;
    drop = sink(Math.min(HIPS_DROP, (HEAD_MARGIN - head) * norm));
    if (head + drop / norm < HEAD_MARGIN) {
      recline = least(0, most, drop);
      head = headAt(solved, r, room, recline, 1);
      if (head + drop / norm < HEAD_MARGIN) drop = Math.max(drop, sink((HEAD_MARGIN - head) * norm));
    }
  }
  if (head + drop / norm < HEAD_MARGIN) {
    // The head tips back with the back, as little as clears the roof: it comes down as it goes over.
    let lo = 0, hi = 1;
    if (clears(recline, 0, drop)) for (let step = 0; step < 20; step++) {
      const mid = (lo + hi) / 2;
      if (clears(recline, mid, drop)) lo = mid; else hi = mid;
    }
    level = lo;
    head = headAt(solved, r, room, recline, level);
  }
  seatFit.recline = recline; seatFit.level = levelFor(recline) * level; seatFit.drop = drop;
  seatFit.head = Math.max(0, HEAD_MARGIN - head - drop / norm);
}


/**
 * Sets each foot that is through the floor back on it, and returns the legs' turns, or null where neither was. The leg
 * turns up about the hip keeping its knee's fold, and straightens as little as keeps the thigh within its swing.
 */
function placeFeet(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, room: SeatRoom, drop: number, aside: number, ahead: number): Float32Array | null {
  let any = false;
  for (let side = 0; side < 2; side++) {
    const [upper, lower, foot] = LEGS[side]!, at = side * 3;
    quatCopy(ends, side * 4, solved.rot, foot * 4);
    targets[at] = NaN;
    const least = footClearance(solved, scale, foot, room, drop, aside, ahead);
    if (least >= FOOT_MARGIN) continue;
    const hx = solved.pos[upper * 3]!, hy = solved.pos[upper * 3 + 1]!, hz = solved.pos[upper * 3 + 2]!;
    const kx = solved.pos[lower * 3]! - hx, ky = solved.pos[lower * 3 + 1]! - hy, kz = solved.pos[lower * 3 + 2]! - hz;
    const fx = solved.pos[foot * 3]! - hx, fy = solved.pos[foot * 3 + 1]! - hy, fz = solved.pos[foot * 3 + 2]! - hz;
    const a = Math.sqrt(kx * kx + ky * ky + kz * kz), b = Math.sqrt((fx - kx) * (fx - kx) + (fy - ky) * (fy - ky) + (fz - kz) * (fz - kz));
    // The ankle keeps to the upright plane through the hip and itself: u along the ground from the hip, v up. Its foot
    // keeps its turn, so its clearance follows the ankle: the ankle must keep on or over the line v = c + m u.
    const u0 = Math.sqrt(fx * fx + fz * fz);
    if (!(u0 > 1e-6)) continue;
    const ux = fx / u0, uz = fz / u0, m = room.floor[1] * uz;
    const c = fy - m * u0 + (FOOT_MARGIN - least) * Math.sqrt(1 + room.floor[1] * room.floor[1]);
    /** Puts the target where the line meets the circle of radius d about the hip, ahead, and says whether the thigh then keeps within its swing. */
    const within = (d: number): boolean => {
      const qa = 1 + m * m, disc = d * d * qa - c * c;
      if (disc < 0) return false;
      const u = (Math.sqrt(disc) - c * m) / qa;
      targets[at] = hx + ux * u; targets[at + 1] = hy + c + m * u; targets[at + 2] = hz + uz * u;
      if (twoBone(reached, 0, hx, hy, hz, targets[at]!, targets[at + 1]!, targets[at + 2]!, a, b, kx, ky, kz, .002, 1, KNEE_COS) < 0) return false;
      quatRotate(solved.rot, B_HIPS * 4, 0, -1, 0, point, 0);
      const tx = reached[3]! - hx, ty = reached[4]! - hy, tz = reached[5]! - hz;
      return (tx * point[0]! + ty * point[1]! + tz * point[2]!) / Math.sqrt(tx * tx + ty * ty + tz * tz) >= THIGH_COS;
    };
    const fold = Math.sqrt(fx * fx + fy * fy + fz * fz), straight = a + b - .002;
    if (!within(Math.min(fold, straight))) {
      let lo = Math.min(fold, straight), hi = straight;
      for (let step = 0; step < 20; step++) {
        const mid = (lo + hi) / 2;
        if (within(mid)) hi = mid; else lo = mid;
      }
      if (!within(hi)) { targets[at] = NaN; continue; }
    }
    any = true;
  }
  if (!any) return null;
  reachChains(pose, solved, rest, scale, LEGS, KNEE_COS);
  const legs = new Float32Array(24);
  for (let side = 0; side < 2; side++) for (let k = 0; k < 3; k++) quatCopy(legs, side * 12 + k * 4, pose.rot, LEGS[side]![k]! * 4);
  return legs;
}

/**
 * Reaches each chain of a pair for its target in `targets` (NaN for none): its middle joint bends the way it does now,
 * and its end keeps the model turn in `ends`. Bones keep their lengths.
 */
function reachChains(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, chains: readonly Chain[], foldCos: number, poles?: Float64Array): void {
  for (let side = 0; side < 2; side++) {
    if (Number.isNaN(targets[side * 3]!)) continue;
    const [upper, lower, end] = chains[side]!, at = side * 6;
    const hx = solved.pos[upper * 3]!, hy = solved.pos[upper * 3 + 1]!, hz = solved.pos[upper * 3 + 2]!;
    const kx = solved.pos[lower * 3]! - hx, ky = solved.pos[lower * 3 + 1]! - hy, kz = solved.pos[lower * 3 + 2]! - hz;
    const ex = solved.pos[end * 3]! - hx - kx, ey = solved.pos[end * 3 + 1]! - hy - ky, ez = solved.pos[end * 3 + 2]! - hz - kz;
    const a = Math.sqrt(kx * kx + ky * ky + kz * kz), b = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const p = side * 3;
    const px = poles ? poles[p]! - hx : kx, py = poles ? poles[p + 1]! - hy : ky, pz = poles ? poles[p + 2]! - hz : kz;
    if (twoBone(reached, at, hx, hy, hz, targets[side * 3]!, targets[side * 3 + 1]!, targets[side * 3 + 2]!, a, b, px, py, pz, .002, 1, foldCos) < 0) { targets[side * 3] = NaN; continue; }
    aimBone(HUMAN, pose, solved, upper, kx, ky, kz, reached[at + 3]! - hx, reached[at + 4]! - hy, reached[at + 5]! - hz);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let side = 0; side < 2; side++) {
    if (Number.isNaN(targets[side * 3]!)) continue;
    const [, lower, end] = chains[side]!, at = side * 6;
    const kx = solved.pos[lower * 3]!, ky = solved.pos[lower * 3 + 1]!, kz = solved.pos[lower * 3 + 2]!;
    aimBone(HUMAN, pose, solved, lower, solved.pos[end * 3]! - kx, solved.pos[end * 3 + 1]! - ky, solved.pos[end * 3 + 2]! - kz,
      reached[at]! - kx, reached[at + 1]! - ky, reached[at + 2]! - kz);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let side = 0; side < 2; side++) {
    if (Number.isNaN(targets[side * 3]!)) continue;
    const [, lower, end] = chains[side]!;
    quatMulConj(pose.rot, end * 4, solved.rot, lower * 4, ends, side * 4);
  }
  solve(HUMAN, pose, solved, rest, scale);
}

const legCache = new WeakMap<Seat, Map<string, Float32Array | null>>(), ids = new WeakMap<Float32Array, number>();
let idCount = 0;

/** The key a body's fitted legs are kept under in a seat: its rest joints, its stretch and where its hips went. */
function legKey(rest: Float32Array, scale: Float32Array | null, drop: number, aside: number, ahead: number): string {
  let id = ids.get(rest);
  if (id === undefined) ids.set(rest, id = idCount++);
  return `${id}:${drop}:${aside}:${ahead}${scale ? ":" + new Uint32Array(scale.buffer, scale.byteOffset, HUMAN_BONES * 3).join(",") : ""}`;
}

/**
 * Fits a seated pose, already solved on `rest` and `scale`, inside its seat's room, writes what it did to `seatFit`, and
 * returns the metres its hips sink below the seat's anchor. A seat without a room, or a body that fits it as posed, is
 * left untouched. A driver's hands stay where the pose put them in the seat; a passenger's where they were by its hips.
 * The fit is the one found for the `standard` body shots are judged on. A body drawn with other proportions leans the
 * same way and its hips shift, `seatFit.side` and `ahead` along its side and forward axes, so the middle of its head is
 * where the standard body's is: a shot through the drawn head is a head shot. Looks keep that shift to a few
 * centimetres (shared/anim/look.ts HEAD_SLACK).
 */
export function fitSeated(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, seat: Seat, standard: Float32Array = rest): number {
  seatFit.recline = seatFit.level = seatFit.drop = seatFit.head = seatFit.feet = seatFit.side = seatFit.ahead = 0;
  const room = seat.room;
  if (!room) return 0;
  const own = standard === rest && !scale;
  if (own) headFit(solved, UNIT, room);
  else {
    solve(HUMAN, pose, standardSolved, standard, null);
    headFit(standardSolved, UNIT, room);
  }
  const { recline, level, drop: standardDrop } = seatFit;
  const matchHands = !own && !seat.driver;
  // A body drawn with other proportions always moves, to put its head on the standard one's.
  const turned = recline !== 0 || seatFit.drop !== 0 || !own;
  if (turned) {
    // The hands as the pose put them, before the lean moves them.
    const from = matchHands ? standardSolved : solved;
    for (let side = 0; side < 2; side++) {
      const hand = ARMS[side]![2];
      for (let k = 0; k < 3; k++) hands[side * 3 + k] = from.pos[hand * 3 + k]! + (solved.pos[k]! - from.pos[k]!);
      quatCopy(hands, 6 + side * 4, solved.rot, hand * 4);
    }
    lean(pose, solved, recline, level);
  }
  if (!own) {
    // Each head's middle from its own hips, once leaned.
    solve(HUMAN, pose, standardSolved, standard, null);
    solve(HUMAN, pose, solved, rest, scale);
    headMiddle(standardSolved, UNIT, pin, 0); headMiddle(solved, scale ?? UNIT, pin, 3);
    seatFit.side = pin[0]! - pin[3]!; seatFit.ahead = pin[2]! - pin[5]!; seatFit.drop -= pin[1]! - pin[4]!;
  }
  const { drop, side: aside, ahead } = seatFit;
  let bodies = legCache.get(seat);
  if (!bodies) legCache.set(seat, bodies = new Map());
  const key = legKey(rest, scale, drop, aside, ahead);
  let legs = bodies.get(key);
  if (!turned && legs === null) return 0;
  // The seat's own legs, the same every frame, are fitted once for each body and where its hips went.
  if (legs === undefined) {
    if (turned && own) solve(HUMAN, pose, solved, rest, scale);
    legs = placeFeet(pose, solved, rest, scale, room, drop, aside, ahead);
    if (bodies.size >= 64) bodies.clear();
    bodies.set(key, legs);
  } else if (legs) for (let side = 0; side < 2; side++) for (let k = 0; k < 3; k++) quatCopy(pose.rot, LEGS[side]![k]! * 4, legs, side * 12 + k * 4);
  solve(HUMAN, pose, solved, rest, scale);
  if (turned) {
    // A passenger's wrist and elbow reach for the hit rig's pose relative to the face.
    for (let side = 0; side < 2; side++) {
      const at = side * 3;
      if (seat.driver || matchHands) {
        hands[at] -= aside;
        hands[at + 1] += matchHands ? drop - standardDrop : drop;
        hands[at + 2] -= ahead;
      }
      if (matchHands) {
        const b = ARMS[side]![1];
        for (let k = 0; k < 3; k++) elbows[at + k] = standardSolved.pos[b * 3 + k]! - standardSolved.pos[k]! + solved.pos[k]!;
        elbows[at] -= aside;
        elbows[at + 1] += drop - standardDrop;
        elbows[at + 2] -= ahead;
      }
    }
    targets.set(hands.subarray(0, 6)); ends.set(hands.subarray(6));
    reachChains(pose, solved, rest, scale, ARMS, ELBOW_COS, matchHands ? elbows : undefined);
  }
  if (!own) seatFit.head = Math.max(0, HEAD_MARGIN - headClearance(solved, scale, room, drop, aside, ahead));
  for (const [, , foot] of LEGS) seatFit.feet = Math.max(seatFit.feet, -footClearance(solved, scale, foot, room, drop, aside, ahead));
  return drop;
}


