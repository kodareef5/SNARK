// Blows written as key poses: a punch with either hand, a hatchet's chop, a pick's blow, and how a tool is carried.
// A key says where the wrists are and how the tool lies at one tick. Between keys the wrists run on a smooth curve and
// every frame is solved from them, so each pose between two keys is a pose of its own and not a mix of two.
// Model space: +Z ahead, +X the body's left, +Y up, the ground at 0. Only exactly rounded arithmetic.

import { detAtan2 } from "../math/scalar.ts";
import { quatMulConj, quatNlerp, quatRotate } from "../math/quat.ts";
import { HOLD_HANDS, HOLD_TOOL, SWING_TICKS } from "../sim/weapon.ts";
import { clip, type PoseBuilder } from "./authored.ts";
import type { Clip } from "./clip.ts";
import { reach, type Side } from "./emote-clips.ts";
import {
  B_CHEST, B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_THUMB_L, B_THUMB_R, B_HAND_L, B_HAND_R, B_HEAD, B_LOWER_ARM_L, B_LOWER_ARM_R, B_NECK, B_PROP_L, B_PROP_R, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R,
  B_UPPER_CHEST, HUMAN,
} from "./human.ts";

type V = readonly [number, number, number];

/** One arm at a key. What a key leaves out it takes from the key before. */
export interface ArmKey {
  /** The wrist. */
  at?: V;
  /** Where the elbow bends toward. */
  pole?: V;
  /**
   * A hand on a tool: the way its haft runs from the grip to the head. Its striking side leads the knuckles, so it faces
   * the way the forearm points, as near as the haft lets it; `edge` is added to that way, to lean it.
   */
  haft?: V;
  edge?: V;
  /** A free hand: degrees the forearm is rolled from palm down, the thumb turning up. */
  roll?: number;
  /** 0 an open hand, 1 a fist. */
  curl?: number;
  /** The wrist as the body's own eye sees it: metres to the eye's left, above it and ahead of it along its look. */
  eye?: V;
}

export interface Key {
  /** The tick of the swing, 0 to SWING_TICKS. */
  t: number;
  r?: ArmKey;
  l?: ArmKey;
  /** Degrees the chest turns to the left, leans ahead and tips to the left. The head stays on the look. */
  twist?: number;
  lean?: number;
  tip?: number;
  /** How far the left hand has gone to the haft, 0 to 1, in a move that puts both on it. */
  join?: number;
}

// A sampled key is a row of numbers. Each arm has ARM of them, the right arm first.
export const S_AT = 0;
export const S_POLE = 3;
export const S_HAFT = 6;
export const S_EDGE = 9;
export const S_ROLL = 12;
export const S_CURL = 13;
export const S_EYE = 14;
const ARM = 17;
export const S_RIGHT = 0;
export const S_LEFT = ARM;
export const S_TWIST = 2 * ARM;
export const S_LEAN = S_TWIST + 1;
export const S_TIP = S_TWIST + 2;
export const S_JOIN = S_TWIST + 3;
export const SAMPLE = S_TWIST + 4;

/** Hands a move puts on the haft: none, the right, or both. */
export const GRIP_NONE = 0;
export const GRIP_RIGHT = 1;
export const GRIP_BOTH = 2;

export interface Move {
  readonly id: string;
  readonly grip: number;
  readonly times: Float64Array;
  /** A row of SAMPLE numbers a key, and each number's slope at that key. */
  readonly rows: Float64Array;
  readonly slopes: Float64Array;
}

/** The standing eye's height, from which a key's `eye` is measured where it gives none. */
const EYE_HEIGHT = 1.62;
/** Metres up the haft from the right hand's grip to the left's. */
const LEFT_UP = 0.15;
/** Degrees a tool is turned in the palm, so its striking side leads the knuckles. */
const GRIP_ROLL = 90;
/** Degrees the fingers fold at the knuckles and again at their tips, and the thumb across them, in a fist. */
const FINGER_FOLD = 105;
const THUMB_FOLD = 45;
/** The share of a gripping hand's turn about the forearm that the forearm takes. */
const FOREARM_SHARE = 0.65;

const ARM_REST: Readonly<Record<Side, ArmKey>> = {
  [-1]: { at: [-0.27, 0.95, 0.03], pole: [-0.5, -0.3, -1], haft: [0, 0.6, 0.8], edge: [0, -0.1, 0.1], roll: 20, curl: 0.3 },
  [1]: { at: [0.27, 0.95, 0.03], pole: [0.5, -0.3, -1], haft: [0, 0.6, 0.8], edge: [0, -0.1, 0.1], roll: 20, curl: 0.3 },
};

function compile(id: string, grip: number, keys: readonly Key[]): Move {
  const n = keys.length;
  const times = new Float64Array(n);
  const rows = new Float64Array(n * SAMPLE);
  const slopes = new Float64Array(n * SAMPLE);
  let r: ArmKey = ARM_REST[-1], l: ArmKey = ARM_REST[1];
  let twist = 0, lean = 0, tip = 0, join = 0;
  keys.forEach((k, i) => {
    // A key that moves a wrist and gives no `eye` for it is seen where the body has it.
    r = { ...r, ...k.r, eye: k.r?.eye ?? (k.r?.at ? undefined : r.eye) };
    l = { ...l, ...k.l, eye: k.l?.eye ?? (k.l?.at ? undefined : l.eye) };
    twist = k.twist ?? twist;
    lean = k.lean ?? lean;
    tip = k.tip ?? tip;
    join = k.join ?? join;
    times[i] = k.t;
    const o = i * SAMPLE;
    for (const [arm, at] of [[r, S_RIGHT], [l, S_LEFT]] as const) {
      rows.set(arm.at!, o + at + S_AT);
      rows.set(arm.pole!, o + at + S_POLE);
      rows.set(arm.haft!, o + at + S_HAFT);
      rows.set(arm.edge!, o + at + S_EDGE);
      rows[o + at + S_ROLL] = arm.roll!;
      rows[o + at + S_CURL] = arm.curl!;
      rows.set(arm.eye ?? [arm.at![0], arm.at![1] - EYE_HEIGHT, arm.at![2]], o + at + S_EYE);
    }
    rows[o + S_TWIST] = twist;
    rows[o + S_LEAN] = lean;
    rows[o + S_TIP] = tip;
    rows[o + S_JOIN] = join;
  });
  // A key's slope is the line through its neighbours, and level at each end, so a move leaves and meets rest gently.
  for (let i = 1; i < n - 1; i++) {
    const span = times[i + 1]! - times[i - 1]!;
    for (let c = 0; c < SAMPLE; c++) slopes[i * SAMPLE + c] = (rows[(i + 1) * SAMPLE + c]! - rows[(i - 1) * SAMPLE + c]!) / span;
  }
  return { id, grip, times, rows, slopes };
}

/** The move at `tick` into `out`, SAMPLE numbers. Before its first key and after its last it holds them. */
export function sampleMove(m: Move, tick: number, out: Float64Array): void {
  const times = m.times, n = times.length;
  let i = 0;
  while (i < n - 2 && tick >= times[i + 1]!) i++;
  const a = i * SAMPLE, b = n > 1 ? a + SAMPLE : a;
  const span = n > 1 ? times[i + 1]! - times[i]! : 1;
  let u = (tick - times[i]!) / span;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
  const rows = m.rows, slopes = m.slopes;
  for (let c = 0; c < SAMPLE; c++) out[c] = h00 * rows[a + c]! + h10 * span * slopes[a + c]! + h01 * rows[b + c]! + h11 * span * slopes[b + c]!;
}

const between = (a: number, b: number): number => {
  const r = HUMAN.rest;
  const x = r[a * 3]! - r[b * 3]!, y = r[a * 3 + 1]! - r[b * 3 + 1]!, z = r[a * 3 + 2]! - r[b * 3 + 2]!;
  return Math.sqrt(x * x + y * y + z * z);
};
const UPPER_ARM = between(B_UPPER_ARM_L, B_LOWER_ARM_L), FOREARM = between(B_LOWER_ARM_L, B_HAND_L);

const LEFT_HAND = [B_FINGERS_L, B_THUMB_L, B_PROP_L, B_FINGERTIPS_L] as const;
const RIGHT_HAND = [B_FINGERS_R, B_THUMB_R, B_PROP_R, B_FINGERTIPS_R] as const;

const grip = new Float64Array(4);
const fore = new Float64Array(4);
const rel = new Float64Array(4);
const off = new Float64Array(3);

/**
 * The rotation of a hand whose tool's haft runs along (zx, zy, zz) with its striking side toward (ex, ey, ez), into
 * `out`. The hand's own Z is the haft, and its X the striking side on the left hand and away from it on the right.
 */
export function gripRotation(side: Side, zx: number, zy: number, zz: number, ex: number, ey: number, ez: number, out: Float64Array): void {
  const zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
  zx /= zl; zy /= zl; zz /= zl;
  const d = ex * zx + ey * zy + ez * zz;
  let xx = (ex - d * zx) * side, xy = (ey - d * zy) * side, xz = (ez - d * zz) * side;
  const xl = Math.sqrt(xx * xx + xy * xy + xz * xz);
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  // The rotation whose columns are x, y and z.
  const trace = xx + yy + zz;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    out[0] = (yz - zy) / s; out[1] = (zx - xz) / s; out[2] = (xy - yx) / s; out[3] = s / 4;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    out[0] = s / 4; out[1] = (yx + xy) / s; out[2] = (zx + xz) / s; out[3] = (yz - zy) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    out[0] = (yx + xy) / s; out[1] = s / 4; out[2] = (zy + yz) / s; out[3] = (zx - xz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    out[0] = (zx + xz) / s; out[1] = (zy + yz) / s; out[2] = s / 4; out[3] = (xy - yx) / s;
  }
}

/**
 * The body's own eye, for arms placed as it sees them: its height over the body's origin and how far ahead of it, the
 * sine and cosine of its pitch, and metres its hands ride to its left and up with the stride.
 */
export interface EyeFrame {
  y: number;
  ahead: number;
  sin: number;
  cos: number;
  left: number;
  up: number;
}

const dir = new Float64Array(9);

/** A direction of the move at `s[i]` into `dir` at `d`: as it is, or pitched with the eye's look. */
function turned(s: Float64Array, i: number, eye: EyeFrame | null, d: number): void {
  const y = s[i + 1]!, z = s[i + 2]!;
  dir[d] = s[i]!;
  dir[d + 1] = eye ? y * eye.cos + z * eye.sin : y;
  dir[d + 2] = eye ? z * eye.cos - y * eye.sin : z;
}

/**
 * Turns `grip` to a hand closed on the haft along `dir` at 3, its knuckles leading the way its forearm points, as a
 * wrist holds a tool; `dir` at 6 is added to that way, to lean them.
 */
function forearmGrip(b: PoseBuilder, side: Side, lower: number, hand: number): void {
  const e = b.joint(lower), w = b.joint(hand);
  let fx = w[0] - e[0], fy = w[1] - e[1], fz = w[2] - e[2];
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx = fx / fl + dir[6]!;
  fy = fy / fl + dir[7]!;
  fz = fz / fl + dir[8]!;
  gripRotation(side, dir[3]!, dir[4]!, dir[5]!, fx, fy, fz, grip);
}

/**
 * One arm of `m` as sampled in `s`, onto the pose `b` holds: its wrist reached for, its hand turned and closed. With
 * `eye`, the wrist is where the key's `eye` puts it before that eye, and the tool lies as the look is pitched.
 */
export function poseArm(b: PoseBuilder, m: Move, s: Float64Array, side: Side, eye: EyeFrame | null = null): void {
  const o = side < 0 ? S_RIGHT : S_LEFT;
  const upper = side < 0 ? B_UPPER_ARM_R : B_UPPER_ARM_L, lower = side < 0 ? B_LOWER_ARM_R : B_LOWER_ARM_L;
  const hand = side < 0 ? B_HAND_R : B_HAND_L, prop = side < 0 ? B_PROP_R : B_PROP_L;
  // The left hand of a two-handed move goes to the haft the right hand holds, as far as `join` says.
  const held = side < 0 ? (m.grip !== GRIP_NONE ? 1 : 0) : m.grip === GRIP_BOTH ? Math.min(1, Math.max(0, s[S_JOIN]!)) : 0;
  let x = s[o + S_AT]!, y = s[o + S_AT + 1]!, z = s[o + S_AT + 2]!;
  if (eye) {
    const l = s[o + S_EYE]! + eye.left, u = s[o + S_EYE + 1]! + eye.up, f = s[o + S_EYE + 2]!;
    x = l;
    y = eye.y + u * eye.cos + f * eye.sin;
    z = eye.ahead + f * eye.cos - u * eye.sin;
  }
  turned(s, o + S_POLE, eye, 0);
  const pole: [number, number, number] = [dir[0]!, dir[1]!, dir[2]!];
  const roll = s[o + S_ROLL]! * side * (1 - held);
  reach(b, upper, lower, UPPER_ARM, FOREARM, [x, y, z], pole, roll);
  if (held > 0) {
    turned(s, S_RIGHT + S_HAFT, eye, 3);
    turned(s, o + S_EDGE, eye, 6);
    // The left hand goes to the haft above the right, and is solved twice: where its wrist is depends on how it is turned.
    for (let pass = side > 0 ? 0 : 1; pass < 2; pass++) {
      forearmGrip(b, side, lower, hand);
      if (pass === 1) break;
      const p = b.joint(B_PROP_R);
      const hl = Math.sqrt(dir[3]! * dir[3]! + dir[4]! * dir[4]! + dir[5]! * dir[5]!);
      // The wrist stands off the haft by the palm's own offset from it, as the hand is turned.
      const r = HUMAN.rest;
      quatRotate(grip, 0, r[B_PROP_L * 3]! - r[B_HAND_L * 3]!, r[B_PROP_L * 3 + 1]! - r[B_HAND_L * 3 + 1]!, r[B_PROP_L * 3 + 2]! - r[B_HAND_L * 3 + 2]!, off, 0);
      const tx = x + (p[0] + (dir[3]! / hl) * LEFT_UP - off[0]! - x) * held;
      const ty = y + (p[1] + (dir[4]! / hl) * LEFT_UP - off[1]! - y) * held;
      const tz = z + (p[2] + (dir[5]! / hl) * LEFT_UP - off[2]! - z) * held;
      reach(b, upper, lower, UPPER_ARM, FOREARM, [tx, ty, tz], pole, roll);
    }
    // The forearm takes its share of the hand's turn about its length, and the wrist the rest.
    b.rotation(lower, fore, 0);
    quatMulConj(rel, 0, fore, 0, grip, 0);
    const turn = 2 * detAtan2(rel[3]! < 0 ? -rel[0]! : rel[0]!, Math.abs(rel[3]!));
    b.local(lower, (turn * FOREARM_SHARE * held * 360) / 6.283185307179586, 0, 0);
    b.rotation(hand, fore, 0);
    quatNlerp(grip, 0, fore, 0, grip, 0, held);
    b.rotate(hand, grip, 0);
  }
  // The fingers and the tool start as they rest, whatever the pose had them at.
  const bones = side < 0 ? RIGHT_HAND : LEFT_HAND;
  for (const bone of bones) b.straighten(bone);
  // A fist seen from its own eye: the fingers folded right under the palm, the thumb across them.
  const curl = s[o + S_CURL]!;
  b.local(bones[0], 0, 0, -side * FINGER_FOLD * curl).local(bones[3], 0, 0, -side * FINGER_FOLD * curl).local(bones[1], 0, -side * THUMB_FOLD * curl, 0);
  if (side < 0 && m.grip !== GRIP_NONE) b.local(prop, 0, 0, -side * GRIP_ROLL);
}

const sample = new Float64Array(SAMPLE);

/** Poses the upper body as `m` has it at `tick`. */
export function poseMove(b: PoseBuilder, m: Move, tick: number): void {
  sampleMove(m, tick, sample);
  const twist = sample[S_TWIST]!, lean = sample[S_LEAN]!, tip = sample[S_TIP]!;
  for (const bone of [B_SPINE, B_CHEST, B_UPPER_CHEST]) b.turn(bone, lean / 3, twist / 3, tip / 3);
  // The neck and head turn most of the way back, so the face stays on the look.
  b.turn(B_NECK, -lean * 0.4, -twist * 0.4, -tip * 0.4).turn(B_HEAD, -lean * 0.45, -twist * 0.5, -tip * 0.5);
  poseArm(b, m, sample, -1);
  poseArm(b, m, sample, 1);
}

// --- The moves -------------------------------------------------------------------------------------------------------

/** A tool carried: the forearm ahead, the head of the tool up. Every tool move starts and ends on it. */
const CARRY: ArmKey = { at: [-0.25, 1.08, 0.2], eye: [-0.28, -0.3, 0.22], pole: [-0.5, -0.4, -1], haft: [0.1, 0.6, 0.8], curl: 1 };
/** The free arm beside a one-handed blow, a little forward of hanging. */
const FREE_L: ArmKey = { at: [0.26, 0.97, 0.06], pole: [0.5, -0.3, -1], roll: 30, curl: 0.5 };
const TUCK: V = [-0.5, -0.4, -1], OUT: V = [-0.9, -0.3, 0.1], DOWN: V = [-0.8, -0.6, 0];

const MOVES_: readonly Move[] = [
  compile("human/tool_carry", GRIP_RIGHT, [{ t: 0, r: CARRY }]),
  // The lead hand, straight out and back. The other pulls to the ribs, so that hand by hand they do not flap.
  compile("human/jab", GRIP_NONE, [
    { t: 0, l: { curl: 0.6 }, r: { curl: 0.6 } },
    { t: 1.6, l: { at: [0.2, 1.16, 0.08], eye: [0.2, -0.4, 0.1], pole: [0.6, -0.8, -0.6], roll: 20, curl: 1 }, r: { at: [-0.24, 1.02, 0.04], curl: 1 }, twist: 6, lean: 1 },
    { t: 3.4, l: { at: [0.13, 1.32, 0.3], eye: [0.13, -0.2, 0.24], pole: [0.7, -0.7, -0.3], roll: 8 }, r: { at: [-0.22, 1.1, 0.0], pole: [-0.6, -0.4, -1] }, twist: -6, lean: 3 },
    { t: 5, l: { at: [0.05, 1.41, 0.52], eye: [0.05, -0.07, 0.34], pole: [0.8, -0.6, 0], roll: 0 }, r: { at: [-0.2, 1.14, -0.04] }, twist: -16, lean: 5 },
    { t: 6.2, l: { at: [0.05, 1.4, 0.5], eye: [0.05, -0.08, 0.33] }, twist: -15, lean: 5 },
    { t: 8.5, l: { at: [0.14, 1.3, 0.26], eye: [0.14, -0.22, 0.2], pole: [0.7, -0.7, -0.3], roll: 12 }, r: { at: [-0.22, 1.1, 0.0] }, twist: -6, lean: 3 },
    { t: 11.5, l: { at: [0.22, 1.1, 0.1], eye: [0.22, -0.45, 0.1], pole: [0.6, -0.6, -0.8], roll: 20, curl: 0.8 }, r: { at: [-0.25, 1.0, 0.03], curl: 0.8 }, twist: 0, lean: 1 },
    { t: 15, l: { ...ARM_REST[1], curl: 0.6 }, r: { ...ARM_REST[-1], curl: 0.6 }, lean: 0 },
  ]),
  // The rear hand, with the chest behind it.
  compile("human/cross", GRIP_NONE, [
    { t: 0, l: { curl: 0.6 }, r: { curl: 0.6 } },
    { t: 1.6, r: { at: [-0.22, 1.14, 0.02], eye: [-0.22, -0.42, 0.08], pole: [-0.6, -0.8, -0.7], roll: 25, curl: 1 }, l: { at: [0.24, 1.04, 0.06], curl: 1 }, twist: -10, lean: 1 },
    { t: 3.4, r: { at: [-0.14, 1.3, 0.24], eye: [-0.14, -0.22, 0.22], pole: [-0.7, -0.7, -0.3], roll: 10 }, l: { at: [0.22, 1.12, 0.02], pole: [0.6, -0.4, -1] }, twist: 8, lean: 4 },
    { t: 5, r: { at: [-0.02, 1.42, 0.54], eye: [-0.03, -0.06, 0.35], pole: [-0.8, -0.5, 0], roll: 0 }, l: { at: [0.2, 1.16, -0.04] }, twist: 26, lean: 7 },
    { t: 6.2, r: { at: [-0.02, 1.41, 0.52], eye: [-0.03, -0.07, 0.34] }, twist: 25, lean: 7 },
    { t: 8.5, r: { at: [-0.13, 1.3, 0.26], eye: [-0.13, -0.22, 0.2], pole: [-0.7, -0.7, -0.3], roll: 12 }, l: { at: [0.22, 1.12, 0.02] }, twist: 10, lean: 4 },
    { t: 11.5, r: { at: [-0.22, 1.1, 0.1], eye: [-0.22, -0.45, 0.1], pole: [-0.6, -0.6, -0.8], roll: 20, curl: 0.8 }, l: { at: [0.25, 1.0, 0.03], curl: 0.8 }, twist: 2, lean: 1 },
    { t: 15, r: { ...ARM_REST[-1], curl: 0.6 }, l: { ...ARM_REST[1], curl: 0.6 }, twist: 0, lean: 0 },
  ]),
  // A steep chop from over the shoulder: lifted, cocked, driven down, a bite, a short way on, and drawn back.
  compile("human/chop_a", GRIP_RIGHT, [
    { t: 0, r: CARRY, l: FREE_L },
    { t: 1.3, r: { at: [-0.3, 1.38, 0.12], eye: [-0.32, -0.1, 0.2], pole: [-0.8, -0.5, -0.4], haft: [-0.1, 0.85, -0.5] }, twist: -8, lean: -2 },
    { t: 2.6, r: { at: [-0.27, 1.62, -0.02], eye: [-0.3, 0.1, 0.1], pole: OUT, haft: [-0.15, 0.35, -0.92] }, l: { at: [0.24, 1.02, 0.12] }, twist: -18, lean: -4 },
    { t: 3.9, r: { at: [-0.2, 1.58, 0.2], eye: [-0.24, 0.04, 0.24], pole: OUT, haft: [-0.05, 0.95, 0.3] }, twist: -6, lean: 2 },
    { t: 5, r: { at: [-0.1, 1.34, 0.34], eye: [-0.15, -0.2, 0.27], pole: DOWN, haft: [0.12, 0.62, 0.77] }, l: { at: [0.26, 1.0, -0.02] }, twist: 14, lean: 10 },
    { t: 5.9, r: { at: [-0.07, 1.26, 0.35], eye: [-0.13, -0.25, 0.28], haft: [0.18, 0.4, 0.9] }, twist: 17, lean: 13 },
    { t: 8.2, r: { at: [-0.14, 1.22, 0.33], eye: [-0.2, -0.27, 0.26], pole: [-0.7, -0.6, -0.4], haft: [0.14, 0.5, 0.85] }, twist: 9, lean: 6 },
    { t: 11.5, r: { at: [-0.22, 1.12, 0.26], eye: [-0.26, -0.29, 0.23], pole: TUCK, haft: [0.1, 0.58, 0.81] }, l: FREE_L, twist: 2, lean: 2 },
    { t: 15, r: CARRY, twist: 0, lean: 0 },
  ]),
  // A flatter chop from out at the side, across the body.
  compile("human/chop_b", GRIP_RIGHT, [
    { t: 0, r: CARRY, l: FREE_L },
    { t: 1.3, r: { at: [-0.38, 1.3, 0.06], eye: [-0.38, -0.14, 0.18], pole: [-0.8, -0.6, -0.4], haft: [-0.5, 0.8, -0.3] }, twist: -10, lean: -1 },
    { t: 2.6, r: { at: [-0.45, 1.45, -0.08], eye: [-0.42, 0, 0.1], pole: [-0.7, -0.5, -0.5], haft: [-0.8, 0.3, -0.5] }, l: { at: [0.24, 1.02, 0.12] }, twist: -24, lean: -2 },
    { t: 3.9, r: { at: [-0.34, 1.4, 0.18], eye: [-0.32, -0.1, 0.24], pole: [-0.8, -0.6, -0.1], haft: [-0.75, 0.3, 0.55] }, twist: -8, lean: 2 },
    { t: 5, r: { at: [-0.04, 1.32, 0.36], eye: [-0.03, -0.2, 0.28], pole: [-0.7, -0.7, 0], haft: [-0.25, 0.2, 0.95] }, l: { at: [0.26, 1.0, -0.02] }, twist: 16, lean: 7 },
    { t: 5.9, r: { at: [0.04, 1.28, 0.34], eye: [0.05, -0.23, 0.27], haft: [0.05, 0.15, 0.98] }, twist: 20, lean: 8 },
    { t: 8.2, r: { at: [-0.1, 1.22, 0.33], eye: [-0.15, -0.27, 0.26], pole: [-0.7, -0.6, -0.4], haft: [0.05, 0.4, 0.9] }, twist: 10, lean: 5 },
    { t: 11.5, r: { at: [-0.22, 1.12, 0.26], eye: [-0.26, -0.29, 0.23], pole: TUCK, haft: [0.1, 0.58, 0.81] }, l: FREE_L, twist: 2, lean: 2 },
    { t: 15, r: CARRY, twist: 0, lean: 0 },
  ]),
  // Both hands on the haft, up over the head and straight down.
  compile("human/pick_a", GRIP_BOTH, [
    { t: 0, r: CARRY, l: FREE_L, join: 0 },
    { t: 1.3, r: { at: [-0.14, 1.42, 0.18], eye: [-0.14, -0.1, 0.24], pole: [-0.9, -0.4, -0.2], haft: [0.05, 0.9, -0.4] }, l: { curl: 1 }, join: 1, lean: -3 },
    { t: 2.6, r: { at: [-0.1, 1.72, 0], eye: [-0.1, 0.14, 0.14], pole: [-1, -0.1, 0.3], haft: [0.05, 0.4, -0.9] }, lean: -8 },
    { t: 3.9, r: { at: [-0.08, 1.66, 0.22], eye: [-0.09, 0.06, 0.26], pole: [-1, -0.2, 0.2], haft: [0.03, 0.95, 0.3] }, lean: 0 },
    { t: 5, r: { at: [-0.06, 1.3, 0.34], eye: [-0.07, -0.22, 0.28], pole: [-0.9, -0.5, 0], haft: [0.04, 0.5, 0.86] }, lean: 16 },
    { t: 5.9, r: { at: [-0.06, 1.22, 0.35], eye: [-0.07, -0.27, 0.29], haft: [0.04, 0.3, 0.95] }, lean: 19 },
    { t: 8.2, r: { at: [-0.1, 1.22, 0.33], eye: [-0.12, -0.28, 0.27], pole: [-0.8, -0.6, -0.3], haft: [0.06, 0.45, 0.89] }, lean: 9 },
    { t: 11.5, r: { at: [-0.2, 1.12, 0.26], eye: [-0.24, -0.29, 0.23], pole: TUCK, haft: [0.1, 0.56, 0.82] }, join: 1, lean: 3 },
    { t: 15, r: CARRY, l: FREE_L, join: 0, lean: 0 },
  ]),
  // The same from over the right shoulder, the chest turning into it.
  compile("human/pick_b", GRIP_BOTH, [
    { t: 0, r: CARRY, l: FREE_L, join: 0 },
    { t: 1.3, r: { at: [-0.24, 1.4, 0.14], eye: [-0.24, -0.1, 0.22], pole: [-0.9, -0.4, -0.2], haft: [-0.2, 0.85, -0.45] }, l: { curl: 1 }, join: 1, twist: -8, lean: -2 },
    { t: 2.6, r: { at: [-0.26, 1.68, -0.02], eye: [-0.26, 0.12, 0.12], pole: [-1, -0.1, 0.2], haft: [-0.3, 0.4, -0.85] }, twist: -20, lean: -6 },
    { t: 3.9, r: { at: [-0.2, 1.62, 0.2], eye: [-0.2, 0.04, 0.25], pole: [-1, -0.2, 0.1], haft: [-0.15, 0.93, 0.3] }, twist: -8, lean: 0 },
    { t: 5, r: { at: [-0.06, 1.3, 0.34], eye: [-0.07, -0.22, 0.28], pole: [-0.9, -0.5, 0], haft: [0.12, 0.5, 0.85] }, twist: 12, lean: 15 },
    { t: 5.9, r: { at: [-0.04, 1.22, 0.35], eye: [-0.05, -0.27, 0.29], haft: [0.16, 0.3, 0.94] }, twist: 15, lean: 18 },
    { t: 8.2, r: { at: [-0.1, 1.22, 0.33], eye: [-0.12, -0.28, 0.27], pole: [-0.8, -0.6, -0.3], haft: [0.1, 0.45, 0.89] }, twist: 8, lean: 8 },
    { t: 11.5, r: { at: [-0.2, 1.12, 0.26], eye: [-0.24, -0.29, 0.23], pole: TUCK, haft: [0.1, 0.56, 0.82] }, join: 1, twist: 2, lean: 3 },
    { t: 15, r: CARRY, l: FREE_L, join: 0, twist: 0, lean: 0 },
  ]),
];

export const MOVES: ReadonlyMap<string, Move> = new Map(MOVES_.map((m) => [m.id, m]));

export const CARRY_MOVE: Move = MOVES.get("human/tool_carry")!;

/** The move a swing of `hold` is: a pick's or a chop for a tool, and the one of its two that an `odd` first tick takes. Null for any other hold. */
export function strikeMove(hold: number, pick: boolean, odd: boolean): Move | null {
  const id = hold === HOLD_HANDS ? (odd ? "cross" : "jab") : hold === HOLD_TOOL ? (pick ? "pick" : "chop") + (odd ? "_b" : "_a") : "";
  return MOVES.get(`human/${id}`) ?? null;
}

/** Frames of a baked swing for each tick of it. */
const FRAMES_A_TICK = 4;

let clips: readonly Clip[] | null = null;

/** The moves as clips: a swing over SWING_TICKS at FRAMES_A_TICK, the carry as one frame. */
export function strikeClips(): readonly Clip[] {
  return (clips ??= MOVES_.map((m) => (m.times.length === 1 ? clip(m.id, 1, true, (b) => poseMove(b, m, 0)) : clip(m.id, SWING_TICKS * FRAMES_A_TICK + 1, false, (b, phase) => poseMove(b, m, phase * SWING_TICKS)))));
}
