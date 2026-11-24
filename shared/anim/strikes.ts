// Blows written as key poses: a punch with either hand, a hatchet's chop, a pick's blow, and how a tool is carried.
// A key says where the wrists are and how the tool lies at one tick. Between keys the wrists run on a smooth curve and
// every frame is solved from them, so each pose between two keys is a pose of its own and not a mix of two.
// Model space: +Z ahead, +X the body's left, +Y up, the ground at 0. Only exactly rounded arithmetic.

import { detAtan2 } from "../math/scalar.ts";
import { quatMulConj, quatNlerp, quatRotate } from "../math/quat.ts";
import { SWING_TICKS } from "../sim/weapon.ts";
import { clip, type PoseBuilder } from "./authored.ts";
import type { Clip } from "./clip.ts";
import { fist, reach, type Side } from "./emote-clips.ts";
import {
  B_CHEST, B_HAND_L, B_HAND_R, B_HEAD, B_LOWER_ARM_L, B_LOWER_ARM_R, B_NECK, B_PROP_L, B_PROP_R, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R,
  B_UPPER_CHEST, HUMAN,
} from "./human.ts";

type V = readonly [number, number, number];

/** One arm at a key. What a key leaves out it takes from the key before. */
export interface ArmKey {
  /** The wrist. */
  at?: V;
  /** Where the elbow bends toward. */
  pole?: V;
  /** A hand on a tool: the way its haft runs from the grip to the head, and the way its striking side faces. */
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
/** The share of a gripping hand's turn about the forearm that the forearm takes. */
const FOREARM_SHARE = 0.65;

const ARM_REST: Readonly<Record<Side, ArmKey>> = {
  [-1]: { at: [-0.27, 0.95, 0.03], pole: [-0.5, -0.3, -1], haft: [0, 0, 1], edge: [0, -1, 0], roll: 20, curl: 0.3 },
  [1]: { at: [0.27, 0.95, 0.03], pole: [0.5, -0.3, -1], haft: [0, 0, 1], edge: [0, -1, 0], roll: 20, curl: 0.3 },
};

function compile(id: string, grip: number, keys: readonly Key[]): Move {
  const n = keys.length;
  const times = new Float64Array(n);
  const rows = new Float64Array(n * SAMPLE);
  const slopes = new Float64Array(n * SAMPLE);
  let r: ArmKey = ARM_REST[-1], l: ArmKey = ARM_REST[1];
  let twist = 0, lean = 0, tip = 0, join = 0;
  keys.forEach((k, i) => {
    r = { ...r, ...k.r, eye: k.r?.eye };
    l = { ...l, ...k.l, eye: k.l?.eye };
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

function arm(b: PoseBuilder, m: Move, s: Float64Array, side: Side): void {
  const o = side < 0 ? S_RIGHT : S_LEFT;
  const upper = side < 0 ? B_UPPER_ARM_R : B_UPPER_ARM_L, lower = side < 0 ? B_LOWER_ARM_R : B_LOWER_ARM_L;
  const hand = side < 0 ? B_HAND_R : B_HAND_L, prop = side < 0 ? B_PROP_R : B_PROP_L;
  // The left hand of a two-handed move goes to the haft the right hand holds, as far as `join` says.
  const held = side < 0 ? (m.grip !== GRIP_NONE ? 1 : 0) : m.grip === GRIP_BOTH ? Math.min(1, Math.max(0, s[S_JOIN]!)) : 0;
  let x = s[o + S_AT]!, y = s[o + S_AT + 1]!, z = s[o + S_AT + 2]!;
  if (held > 0) {
    const h = S_RIGHT + S_HAFT, e = S_RIGHT + S_EDGE;
    gripRotation(side, s[h]!, s[h + 1]!, s[h + 2]!, s[e]!, s[e + 1]!, s[e + 2]!, grip);
    if (side > 0) {
      const p = b.joint(B_PROP_R);
      const hl = Math.sqrt(s[h]! * s[h]! + s[h + 1]! * s[h + 1]! + s[h + 2]! * s[h + 2]!);
      // The wrist stands off the haft by the palm's own offset from it, as the hand is turned.
      const r = HUMAN.rest;
      quatRotate(grip, 0, r[B_PROP_L * 3]! - r[B_HAND_L * 3]!, r[B_PROP_L * 3 + 1]! - r[B_HAND_L * 3 + 1]!, r[B_PROP_L * 3 + 2]! - r[B_HAND_L * 3 + 2]!, off, 0);
      x += (p[0] + (s[h]! / hl) * LEFT_UP - off[0]! - x) * held;
      y += (p[1] + (s[h + 1]! / hl) * LEFT_UP - off[1]! - y) * held;
      z += (p[2] + (s[h + 2]! / hl) * LEFT_UP - off[2]! - z) * held;
    }
  }
  reach(b, upper, lower, UPPER_ARM, FOREARM, [x, y, z], [s[o + S_POLE]!, s[o + S_POLE + 1]!, s[o + S_POLE + 2]!], s[o + S_ROLL]! * side * (1 - held));
  if (held > 0) {
    // The forearm takes its share of the hand's turn about its length, and the wrist the rest.
    b.rotation(lower, fore, 0);
    quatMulConj(rel, 0, fore, 0, grip, 0);
    const turn = 2 * detAtan2(rel[3]! < 0 ? -rel[0]! : rel[0]!, Math.abs(rel[3]!));
    b.local(lower, (turn * FOREARM_SHARE * held * 360) / 6.283185307179586, 0, 0);
    b.rotation(hand, fore, 0);
    quatNlerp(grip, 0, fore, 0, grip, 0, held);
    b.rotate(hand, grip, 0);
  }
  // Tighter than an emote's fist, which is seen from further off.
  fist(b, side, s[o + S_CURL]! * 1.3, s[o + S_CURL]!);
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
  arm(b, m, sample, -1);
  arm(b, m, sample, 1);
}

// --- The moves -------------------------------------------------------------------------------------------------------

/** A tool carried: the forearm ahead, the head of the tool up. Every tool move starts and ends on it. */
const CARRY: ArmKey = { at: [-0.25, 1.06, 0.2], pole: [-0.5, -0.4, -1], haft: [0.08, 0.8, 0.6], edge: [0, -0.6, 0.8], curl: 1 };
/** The free arm beside a one-handed blow, a little forward of hanging. */
const FREE_L: ArmKey = { at: [0.26, 0.97, 0.06], pole: [0.5, -0.3, -1], roll: 30, curl: 0.5 };

const MOVES_: readonly Move[] = [
  compile("human/tool_carry", GRIP_RIGHT, [{ t: 0, r: CARRY }]),
  // The lead hand, straight out and back. The other pulls to the ribs, so that hand by hand they do not flap.
  compile("human/jab", GRIP_NONE, [
    { t: 0, l: { curl: 0.6 }, r: { curl: 0.6 } },
    { t: 1.6, l: { at: [0.2, 1.16, 0.08], pole: [0.6, -0.8, -0.6], roll: 20, curl: 1 }, r: { at: [-0.24, 1.02, 0.04], curl: 1 }, twist: 6, lean: 1 },
    { t: 3.4, l: { at: [0.13, 1.32, 0.3], pole: [0.7, -0.7, -0.3], roll: 8 }, r: { at: [-0.22, 1.1, 0.0], pole: [-0.6, -0.4, -1] }, twist: -6, lean: 3 },
    { t: 5, l: { at: [0.05, 1.41, 0.52], pole: [0.8, -0.6, 0], roll: 0 }, r: { at: [-0.2, 1.14, -0.04] }, twist: -16, lean: 5 },
    { t: 6.2, l: { at: [0.05, 1.4, 0.5] }, twist: -15, lean: 5 },
    { t: 8.5, l: { at: [0.14, 1.3, 0.26], pole: [0.7, -0.7, -0.3], roll: 12 }, r: { at: [-0.22, 1.1, 0.0] }, twist: -6, lean: 3 },
    { t: 11.5, l: { at: [0.22, 1.1, 0.1], pole: [0.6, -0.6, -0.8], roll: 20, curl: 0.8 }, r: { at: [-0.25, 1.0, 0.03], curl: 0.8 }, twist: 0, lean: 1 },
    { t: 15, l: { ...ARM_REST[1], curl: 0.6 }, r: { ...ARM_REST[-1], curl: 0.6 }, lean: 0 },
  ]),
  // The rear hand, with the chest behind it.
  compile("human/cross", GRIP_NONE, [
    { t: 0, l: { curl: 0.6 }, r: { curl: 0.6 } },
    { t: 1.6, r: { at: [-0.22, 1.14, 0.02], pole: [-0.6, -0.8, -0.7], roll: 25, curl: 1 }, l: { at: [0.24, 1.04, 0.06], curl: 1 }, twist: -10, lean: 1 },
    { t: 3.4, r: { at: [-0.14, 1.3, 0.24], pole: [-0.7, -0.7, -0.3], roll: 10 }, l: { at: [0.22, 1.12, 0.02], pole: [0.6, -0.4, -1] }, twist: 8, lean: 4 },
    { t: 5, r: { at: [-0.02, 1.42, 0.54], pole: [-0.8, -0.5, 0], roll: 0 }, l: { at: [0.2, 1.16, -0.04] }, twist: 26, lean: 7 },
    { t: 6.2, r: { at: [-0.02, 1.41, 0.52] }, twist: 25, lean: 7 },
    { t: 8.5, r: { at: [-0.13, 1.3, 0.26], pole: [-0.7, -0.7, -0.3], roll: 12 }, l: { at: [0.22, 1.12, 0.02] }, twist: 10, lean: 4 },
    { t: 11.5, r: { at: [-0.22, 1.1, 0.1], pole: [-0.6, -0.6, -0.8], roll: 20, curl: 0.8 }, l: { at: [0.25, 1.0, 0.03], curl: 0.8 }, twist: 2, lean: 1 },
    { t: 15, r: { ...ARM_REST[-1], curl: 0.6 }, l: { ...ARM_REST[1], curl: 0.6 }, twist: 0, lean: 0 },
  ]),
  // A steep chop from over the shoulder: lifted, cocked, driven down, a bite, a short way on, and drawn back.
  compile("human/chop_a", GRIP_RIGHT, [
    { t: 0, r: CARRY, l: FREE_L },
    { t: 1.8, r: { at: [-0.28, 1.36, 0.08], pole: [-0.8, -0.5, -0.4], haft: [-0.1, 0.95, -0.25], edge: [0, 0.25, 0.95] }, twist: -8, lean: -2 },
    { t: 3.5, r: { at: [-0.25, 1.64, -0.06], pole: [-0.9, -0.2, 0.2], haft: [-0.12, 0.6, -0.8], edge: [0, 0.8, 0.6] }, l: { at: [0.24, 1.02, 0.12] }, twist: -18, lean: -4 },
    { t: 4.3, r: { at: [-0.18, 1.6, 0.22], pole: [-0.9, -0.3, 0.1], haft: [-0.05, 0.92, 0.38], edge: [0, -0.38, 0.92] }, twist: -6, lean: 2 },
    { t: 5, r: { at: [-0.07, 1.3, 0.35], pole: [-0.8, -0.6, 0], haft: [0.1, 0.12, 0.98], edge: [0, -0.98, 0.12] }, l: { at: [0.26, 1.0, -0.02] }, twist: 14, lean: 10 },
    { t: 5.9, r: { at: [-0.04, 1.22, 0.36], haft: [0.14, -0.14, 0.98], edge: [0, -0.98, -0.14] }, twist: 17, lean: 13 },
    { t: 8.2, r: { at: [-0.12, 1.2, 0.34], pole: [-0.7, -0.6, -0.4], haft: [0.1, 0.35, 0.93], edge: [0, -0.93, 0.35] }, twist: 9, lean: 6 },
    { t: 11.5, r: { at: [-0.22, 1.1, 0.26], pole: [-0.5, -0.4, -1], haft: [0.08, 0.68, 0.72], edge: [0, -0.72, 0.68] }, l: FREE_L, twist: 2, lean: 2 },
    { t: 15, r: CARRY, twist: 0, lean: 0 },
  ]),
  // A flatter chop from out at the side, across the body.
  compile("human/chop_b", GRIP_RIGHT, [
    { t: 0, r: CARRY, l: FREE_L },
    { t: 1.8, r: { at: [-0.36, 1.28, 0.04], pole: [-0.8, -0.6, -0.4], haft: [-0.45, 0.85, -0.25], edge: [0.3, 0.3, 0.9] }, twist: -10, lean: -1 },
    { t: 3.5, r: { at: [-0.44, 1.5, -0.1], pole: [-0.7, -0.5, -0.5], haft: [-0.6, 0.45, -0.66], edge: [0.5, 0.7, 0.5] }, l: { at: [0.24, 1.02, 0.12] }, twist: -24, lean: -2 },
    { t: 4.3, r: { at: [-0.34, 1.46, 0.2], pole: [-0.8, -0.6, -0.1], haft: [-0.5, 0.6, 0.62], edge: [0.6, -0.3, 0.74] }, twist: -8, lean: 2 },
    { t: 5, r: { at: [-0.1, 1.3, 0.35], pole: [-0.7, -0.7, 0], haft: [0.34, 0.14, 0.93], edge: [0.6, -0.7, -0.1] }, l: { at: [0.26, 1.0, -0.02] }, twist: 16, lean: 7 },
    { t: 5.9, r: { at: [-0.03, 1.24, 0.35], haft: [0.5, -0.06, 0.86], edge: [0.5, -0.8, -0.34] }, twist: 20, lean: 8 },
    { t: 8.2, r: { at: [-0.1, 1.2, 0.34], pole: [-0.7, -0.6, -0.4], haft: [0.3, 0.3, 0.9], edge: [0.2, -0.9, 0.3] }, twist: 10, lean: 5 },
    { t: 11.5, r: { at: [-0.22, 1.1, 0.26], pole: [-0.5, -0.4, -1], haft: [0.1, 0.68, 0.72], edge: [0, -0.72, 0.68] }, l: FREE_L, twist: 2, lean: 2 },
    { t: 15, r: CARRY, twist: 0, lean: 0 },
  ]),
  // Both hands on the haft, up over the head and straight down.
  compile("human/pick_a", GRIP_BOTH, [
    { t: 0, r: CARRY, l: FREE_L, join: 0 },
    { t: 1.8, r: { at: [-0.16, 1.4, 0.16], pole: [-0.9, -0.4, -0.2], haft: [0.05, 0.98, -0.15], edge: [0, 0.15, 0.98] }, join: 1, lean: -3 },
    { t: 3.5, r: { at: [-0.1, 1.74, -0.02], pole: [-1, -0.1, 0.3], haft: [0.05, 0.62, -0.78], edge: [0, 0.78, 0.62] }, lean: -8 },
    { t: 4.3, r: { at: [-0.08, 1.68, 0.24], pole: [-1, -0.2, 0.2], haft: [0.03, 0.9, 0.42], edge: [0, -0.42, 0.9] }, lean: 0 },
    { t: 5, r: { at: [-0.05, 1.26, 0.35], pole: [-0.9, -0.5, 0], haft: [0.04, -0.08, 1], edge: [0, -1, -0.08] }, lean: 16 },
    { t: 5.9, r: { at: [-0.05, 1.17, 0.36], haft: [0.04, -0.26, 0.97], edge: [0, -0.97, -0.26] }, lean: 19 },
    { t: 8.2, r: { at: [-0.1, 1.2, 0.34], pole: [-0.8, -0.6, -0.3], haft: [0.05, 0.3, 0.95], edge: [0, -0.95, 0.3] }, lean: 9 },
    { t: 11.5, r: { at: [-0.2, 1.1, 0.26], pole: [-0.5, -0.4, -1], haft: [0.08, 0.66, 0.74], edge: [0, -0.74, 0.66] }, join: 1, lean: 3 },
    { t: 15, r: CARRY, l: FREE_L, join: 0, lean: 0 },
  ]),
  // The same from over the right shoulder, the chest turning into it.
  compile("human/pick_b", GRIP_BOTH, [
    { t: 0, r: CARRY, l: FREE_L, join: 0 },
    { t: 1.8, r: { at: [-0.24, 1.38, 0.12], pole: [-0.9, -0.4, -0.2], haft: [-0.2, 0.95, -0.2], edge: [0.1, 0.2, 0.97] }, join: 1, twist: -8, lean: -2 },
    { t: 3.5, r: { at: [-0.26, 1.68, -0.04], pole: [-1, -0.1, 0.2], haft: [-0.3, 0.6, -0.74], edge: [0.1, 0.78, 0.6] }, twist: -20, lean: -6 },
    { t: 4.3, r: { at: [-0.2, 1.64, 0.22], pole: [-1, -0.2, 0.1], haft: [-0.12, 0.9, 0.4], edge: [0.1, -0.42, 0.9] }, twist: -8, lean: 0 },
    { t: 5, r: { at: [-0.05, 1.27, 0.35], pole: [-0.9, -0.5, 0], haft: [0.12, -0.07, 0.99], edge: [0, -1, -0.07] }, twist: 12, lean: 15 },
    { t: 5.9, r: { at: [-0.03, 1.18, 0.36], haft: [0.14, -0.24, 0.96], edge: [0, -0.97, -0.24] }, twist: 15, lean: 18 },
    { t: 8.2, r: { at: [-0.1, 1.2, 0.34], pole: [-0.8, -0.6, -0.3], haft: [0.08, 0.3, 0.95], edge: [0, -0.95, 0.3] }, twist: 8, lean: 8 },
    { t: 11.5, r: { at: [-0.2, 1.1, 0.26], pole: [-0.5, -0.4, -1], haft: [0.08, 0.66, 0.74], edge: [0, -0.74, 0.66] }, join: 1, twist: 2, lean: 3 },
    { t: 15, r: CARRY, l: FREE_L, join: 0, twist: 0, lean: 0 },
  ]),
];

export const MOVES: ReadonlyMap<string, Move> = new Map(MOVES_.map((m) => [m.id, m]));

/** Frames of a baked swing for each tick of it. */
const FRAMES_A_TICK = 2;

let clips: readonly Clip[] | null = null;

/** The moves as clips: a swing over SWING_TICKS at FRAMES_A_TICK, the carry as one frame. */
export function strikeClips(): readonly Clip[] {
  return (clips ??= MOVES_.map((m) => (m.times.length === 1 ? clip(m.id, 1, true, (b) => poseMove(b, m, 0)) : clip(m.id, SWING_TICKS * FRAMES_A_TICK + 1, false, (b, phase) => poseMove(b, m, phase * SWING_TICKS)))));
}
