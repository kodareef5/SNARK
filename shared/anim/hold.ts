// A survivor holding a small creature in both arms (server/carry.ts): the arms reach from wherever the clip has put the
// shoulders to wrists held at a place in front of the body, the same standing still, walking or looking about, so the
// creature in them goes steadily along. Crouched, they hold it lower and farther out, in front of the knees. Only
// exactly rounded arithmetic is used, so the server and every client pose the same arms.

import { quatAxis, quatMul, quatMulConj, quatRotate } from "../math/quat.ts";
import type { Pose } from "./clip.ts";
import { B_CHEST, B_FINGERS_L, B_FINGERS_R, B_HAND_L, B_HAND_R, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_THUMB_L, B_THUMB_R, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, HUMAN } from "./human.ts";
import { boneToModel, type Solved } from "./skeleton.ts";

/** Radians each shoulder rolls forward from where the clip has it, so the hands reach round the creature. */
const PROTRACT = 0.3;
/** The left wrist in the body's model space, standing and crouched (metres; the right is its mirror). Chosen by eye. */
const WRIST: readonly (readonly [number, number, number])[] = [[0.1, 1.06, 0.25], [0.11, 0.45, 0.39]];
/** Which way the left elbow points: out, down and back. */
const POLE = [1, -0.55, -0.45] as const;
/** The left hand points forward and in under the creature, its back turned out and down so the palm cups it. */
const HAND = [-0.75, 0.1, 1] as const;
const BACK = [0.75, -1, 0.1] as const;
/** The middle of the left palm in the hand's rest frame: along the hand, and below it, where a palm faces at rest. */
const PALM = [0.07, -0.035, 0.01] as const;
/** Radians the fingers and the thumb close toward the palm. */
const CURL = 0.55;
const THUMB = 0.25;

type V = [number, number, number];

function dot(a: V, b: V): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: V, b: V): V {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: V): V {
  const l = Math.sqrt(dot(a, a));
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** `up` with its part along unit `along` taken out, made unit. */
function square(up: V, along: V): V {
  const k = dot(up, along);
  return unit([up[0] - along[0] * k, up[1] - along[1] * k, up[2] - along[2] * k]);
}

/** Writes to `q` at `qi` the turn that takes unit `fromAlong` to unit `along`, and `fromUp` as near `up` as it can go. */
function frame(q: Float64Array, qi: number, fromAlong: V, fromUp: V, along: V, up: V): void {
  const u0 = square(fromUp, fromAlong);
  const s0 = cross(fromAlong, u0);
  const u1 = square(up, along);
  const s1 = cross(along, u1);
  // M = B1 B0^T, with the columns of each basis the along, up and side axes.
  const m = (r: number, c: number): number => along[r]! * fromAlong[c]! + u1[r]! * u0[c]! + s1[r]! * s0[c]!;
  const t = m(0, 0) + m(1, 1) + m(2, 2);
  let x: number, y: number, z: number, w: number;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    [x, y, z, w] = [(m(2, 1) - m(1, 2)) / s, (m(0, 2) - m(2, 0)) / s, (m(1, 0) - m(0, 1)) / s, s / 4];
  } else if (m(0, 0) > m(1, 1) && m(0, 0) > m(2, 2)) {
    const s = Math.sqrt(1 + m(0, 0) - m(1, 1) - m(2, 2)) * 2;
    [x, y, z, w] = [s / 4, (m(0, 1) + m(1, 0)) / s, (m(0, 2) + m(2, 0)) / s, (m(2, 1) - m(1, 2)) / s];
  } else if (m(1, 1) > m(2, 2)) {
    const s = Math.sqrt(1 + m(1, 1) - m(0, 0) - m(2, 2)) * 2;
    [x, y, z, w] = [(m(0, 1) + m(1, 0)) / s, s / 4, (m(1, 2) + m(2, 1)) / s, (m(0, 2) - m(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + m(2, 2) - m(0, 0) - m(1, 1)) * 2;
    [x, y, z, w] = [(m(0, 2) + m(2, 0)) / s, (m(1, 2) + m(2, 1)) / s, s / 4, (m(1, 0) - m(0, 1)) / s];
  }
  q[qi] = x;
  q[qi + 1] = y;
  q[qi + 2] = z;
  q[qi + 3] = w;
}

const REST = HUMAN.rest;
const UP: V = [0, 1, 0];

function restSpan(from: number, to: number): V {
  return [REST[to * 3]! - REST[from * 3]!, REST[to * 3 + 1]! - REST[from * 3 + 1]!, REST[to * 3 + 2]! - REST[from * 3 + 2]!];
}

/** Each side's bones, shoulder to thumb. */
const SIDES = [
  [B_SHOULDER_L, B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L, B_FINGERS_L, B_THUMB_L],
  [B_SHOULDER_R, B_UPPER_ARM_R, B_LOWER_ARM_R, B_HAND_R, B_FINGERS_R, B_THUMB_R],
] as const;
const UPPER = [unit(restSpan(B_UPPER_ARM_L, B_LOWER_ARM_L)), unit(restSpan(B_UPPER_ARM_R, B_LOWER_ARM_R))];
const LOWER = [unit(restSpan(B_LOWER_ARM_L, B_HAND_L)), unit(restSpan(B_LOWER_ARM_R, B_HAND_R))];
const PALMS = [unit(restSpan(B_HAND_L, B_FINGERS_L)), unit(restSpan(B_HAND_R, B_FINGERS_R))];
const L1 = Math.sqrt(dot(restSpan(B_UPPER_ARM_L, B_LOWER_ARM_L), restSpan(B_UPPER_ARM_L, B_LOWER_ARM_L)));
const L2 = Math.sqrt(dot(restSpan(B_LOWER_ARM_L, B_HAND_L), restSpan(B_LOWER_ARM_L, B_HAND_L)));
/** The roll forward of each shoulder, and the fingers and thumb closed, each in its parent's frame. */
const ROLL = new Float64Array(8);
const CLOSED = new Float64Array(16);
quatAxis(ROLL, 0, 0, 1, 0, -PROTRACT);
quatAxis(ROLL, 4, 0, 1, 0, PROTRACT);
// Fingers lie along the arm with the palm below them at rest, so closing them turns them about +Z one way on the left
// and the other on the right.
quatAxis(CLOSED, 0, 0, 0, 1, -CURL);
quatAxis(CLOSED, 4, 0, 0, 1, -THUMB);
quatAxis(CLOSED, 8, 0, 0, 1, CURL);
quatAxis(CLOSED, 12, 0, 0, 1, THUMB);

/** The back from the hips to the upper chest, each bone with the span from its parent at rest. */
const BACK_BONES = [B_SPINE, B_CHEST, B_UPPER_CHEST] as const;
const BACK_SPANS = [restSpan(B_HIPS, B_SPINE), restSpan(B_SPINE, B_CHEST), restSpan(B_CHEST, B_UPPER_CHEST)];

const rot = new Float64Array(8);
const at = new Float64Array(3);
const v = new Float64Array(3);
const turn = new Float64Array(12);

/**
 * Puts the arms of a survivor's pose into the cradle for its stance (shared/sim/character.ts STANCE_), after everything
 * else has posed its back and shoulders.
 */
export function cradle(out: Pose, stance: number): void {
  // The upper chest in model space: the chain from the hips, as `solve` would find it at the skeleton's own proportions.
  for (let k = 0; k < 4; k++) rot[k] = out.rot[B_HIPS * 4 + k]!;
  for (let k = 0; k < 3; k++) at[k] = REST[B_HIPS * 3 + k]! + out.root[k]!;
  for (let k = 0; k < BACK_BONES.length; k++) {
    const [ox, oy, oz] = BACK_SPANS[k]!;
    quatRotate(rot, 0, ox, oy, oz, v, 0);
    for (let a = 0; a < 3; a++) at[a]! += v[a]!;
    quatMul(rot, 0, rot, 0, out.rot, BACK_BONES[k]! * 4);
  }
  const wrist = WRIST[stance === 1 ? 1 : 0]!;
  for (let side = 0; side < 2; side++) {
    const bones = SIDES[side]!;
    const m = side === 0 ? 1 : -1;
    // The shoulder joint, then the shoulder rolled forward, and the joint of the upper arm it carries.
    const [sx, sy, sz] = restSpan(B_UPPER_CHEST, bones[0]);
    quatRotate(rot, 0, sx, sy, sz, v, 0);
    const s: V = [at[0]! + v[0]!, at[1]! + v[1]!, at[2]! + v[2]!];
    quatMul(rot, 4, rot, 0, ROLL, side * 4);
    const [ux, uy, uz] = restSpan(bones[0], bones[1]);
    quatRotate(rot, 4, ux, uy, uz, v, 0);
    const p1: V = [s[0] + v[0]!, s[1] + v[1]!, s[2] + v[2]!];
    // Two bones reaching for the wrist, the elbow bent toward the pole. A wrist out of reach is reached for as far as it goes.
    const toWrist: V = [wrist[0] * m - p1[0], wrist[1] - p1[1], wrist[2] - p1[2]];
    let d = Math.sqrt(dot(toWrist, toWrist));
    const u = unit(toWrist);
    if (d > (L1 + L2) * 0.995) d = (L1 + L2) * 0.995;
    if (d < Math.abs(L1 - L2) + 0.01) d = Math.abs(L1 - L2) + 0.01;
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const pole = square([POLE[0] * m, POLE[1], POLE[2]], u);
    const a1: V = [u[0] * cosA + pole[0] * sinA, u[1] * cosA + pole[1] * sinA, u[2] * cosA + pole[2] * sinA];
    const elbow: V = [p1[0] + a1[0] * L1, p1[1] + a1[1] * L1, p1[2] + a1[2] * L1];
    const f1 = unit([p1[0] + u[0] * d - elbow[0], p1[1] + u[1] * d - elbow[1], p1[2] + u[2] * d - elbow[2]]);
    // The elbow bends about the upper arm's own up axis at rest, so that axis is kept square to both bones.
    const hinge = unit(side === 0 ? cross(f1, a1) : cross(a1, f1));
    const hand = unit([HAND[0] * m, HAND[1], HAND[2]]);
    const back = square([BACK[0] * m, BACK[1], BACK[2]], hand);
    frame(turn, 0, UPPER[side]!, UP, a1, hinge);
    // The forearm takes half the turn of the wrist, as a forearm turns its palm up.
    frame(turn, 4, LOWER[side]!, UP, f1, square([hinge[0] + back[0], hinge[1] + back[1], hinge[2] + back[2]], f1));
    frame(turn, 8, PALMS[side]!, UP, hand, back);
    const r = out.rot;
    for (let k = 0; k < 4; k++) r[bones[0] * 4 + k] = ROLL[side * 4 + k]!;
    quatMulConj(r, bones[1] * 4, rot, 4, turn, 0);
    quatMulConj(r, bones[2] * 4, turn, 0, turn, 4);
    quatMulConj(r, bones[3] * 4, turn, 4, turn, 8);
    for (let k = 0; k < 4; k++) {
      r[bones[4] * 4 + k] = CLOSED[side * 8 + k]!;
      r[bones[5] * 4 + k] = CLOSED[side * 8 + 4 + k]!;
    }
  }
}

const left = [0, 0, 0];
const right = [0, 0, 0];

/** Writes to `out` the point between the palms of a solved survivor, in its model space: where a held creature's hold_point goes. */
export function handsAt(solved: Solved, out: number[] | Float64Array): void {
  boneToModel(solved, B_HAND_L, PALM[0], PALM[1], PALM[2], left);
  boneToModel(solved, B_HAND_R, -PALM[0], PALM[1], PALM[2], right);
  out[0] = (left[0]! + right[0]!) / 2;
  out[1] = (left[1]! + right[1]!) / 2;
  out[2] = (left[2]! + right[2]!) / 2;
}
