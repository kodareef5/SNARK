// The glider's poses, written as code (planning/workstreams/glider.md). A glider is two wings, one on the prop bone of each
// hand, that meet at a lashing over the head: a pose says how each wing lies about that lashing, and the hands are put where
// its handles then are, with the body hung beneath them. So the wings spread as it is thrown open, rock as it flies and
// tremble in a dive with nothing but the skeleton's own bones. Model space: +Z ahead, +X the body's left, +Y up, the feet
// at 0. Only exactly rounded arithmetic and detSin/detCos, so the clips are the same bits on every engine.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { clip, PoseBuilder } from "./pose-builder.ts";
import type { Clip } from "./clip.ts";
import { fist, reach, type Side } from "./limb-pose.ts";
import {
  B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK, B_PROP_L, B_PROP_R,
  B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN,
} from "./human.ts";

type V = [number, number, number];
const DEG = TAU / 360;

/**
 * Where the wings' lashing is held, over the head; and, in a wing's own space (its grip at the origin, its axes the
 * model's when it lies flat), where its root at the lashing is from the grip: ROOT_IN toward the body's middle and ROOT_UP
 * above. The art's wings (assets/source/core/items/frond-glider) and the stand-in's (tools/pack/glider.ts) are made to these.
 */
export const GLIDER_LASHING: Readonly<V> = [0, 1.99, 0.05];
export const GLIDER_ROOT_IN = 0.27;
export const GLIDER_ROOT_UP = 0.1;
/** The shoulders hang this far under the lashing and behind it, so the arms are all but straight. */
const SHOULDERS: Readonly<V> = [0, 1.44, 0];

const rest = (bone: number): V => [HUMAN.rest[bone * 3]!, HUMAN.rest[bone * 3 + 1]!, HUMAN.rest[bone * 3 + 2]!];
const length = (a: number, b: number): number => {
  const [p, q] = [rest(a), rest(b)];
  return Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]));
};
const UPPER_ARM = length(B_UPPER_ARM_L, B_LOWER_ARM_L), FOREARM = length(B_LOWER_ARM_L, B_HAND_L);
/** From the wrist to the grip in the palm, with the hand turned to hold a handle overhead: fingers up, the palm inward. */
const PALM: Readonly<V> = (() => {
  const [h, p] = [rest(B_HAND_L), rest(B_PROP_L)];
  // The left hand at rest points along +X with its palm down. A quarter turn about Z stands it up, and half a turn about
  // Y faces its palm to the body's middle.
  return [p[1] - h[1], p[0] - h[0], -(p[2] - h[2])] as V;
})();

/** `v` turned about the model's X, then Y, then Z axis, in degrees: what PoseBuilder.turn does to a bone. */
function turned(v: Readonly<V>, x: number, y: number, z: number): V {
  let [px, py, pz] = v;
  let s = detSin(x * DEG), c = detCos(x * DEG);
  [py, pz] = [py * c - pz * s, py * s + pz * c];
  s = detSin(y * DEG);
  c = detCos(y * DEG);
  [px, pz] = [px * c + pz * s, -px * s + pz * c];
  s = detSin(z * DEG);
  c = detCos(z * DEG);
  [px, py] = [px * c - py * s, px * s + py * c];
  return [px, py, pz];
}

/** How a wing lies, in degrees: its tip raised (`dihedral`), drawn back (`sweep`), and its leading edge lifted (`pitch`). */
interface Wing {
  dihedral: number;
  sweep: number;
  pitch: number;
}

/** A wing about the lashing, the hand of that side at its handle with the fingers round it, and the arm reaching to it. */
function wing(b: PoseBuilder, s: Side, w: Wing): void {
  const [x, y, z] = [-w.pitch, s * w.sweep, s * w.dihedral];
  // From the grip to the root in the wing's space, and from the wrist to the grip in the hand's.
  const root = turned([-s * GLIDER_ROOT_IN, GLIDER_ROOT_UP, 0], x, y, z);
  const palm = turned([s * PALM[0], PALM[1], PALM[2]], x, y, z);
  const wrist: V = [GLIDER_LASHING[0] - root[0] - palm[0], GLIDER_LASHING[1] - root[1] - palm[1], GLIDER_LASHING[2] - root[2] - palm[2]];
  const left = s === 1;
  reach(b, left ? B_UPPER_ARM_L : B_UPPER_ARM_R, left ? B_LOWER_ARM_L : B_LOWER_ARM_R, UPPER_ARM, FOREARM, wrist, [s, -0.25, -0.35]);
  const hand = left ? B_HAND_L : B_HAND_R;
  b.level(hand).turn(hand, 0, 0, s * 90).turn(hand, 0, 180).turn(hand, x, y, z);
  fist(b, s, 0.85, 0.6);
  const prop = left ? B_PROP_L : B_PROP_R;
  b.level(prop).turn(prop, x, y, z);
}

/** The body hung from the handles: the hips pitched forward by `lean` degrees and placed so the shoulders are under the lashing. */
function hang(b: PoseBuilder, lean: number, sway = 0): void {
  b.hips(HUMAN.rest[0]!, HUMAN.rest[1]!, HUMAN.rest[2]!).turn(B_HIPS, lean, 0, sway);
  const [l, r] = [b.joint(B_UPPER_ARM_L), b.joint(B_UPPER_ARM_R)];
  b.hips(HUMAN.rest[0]! + SHOULDERS[0] - (l[0] + r[0]) / 2, HUMAN.rest[1]! + SHOULDERS[1] - (l[1] + r[1]) / 2, HUMAN.rest[2]! + SHOULDERS[2] - (l[2] + r[2]) / 2);
}

/** A leg by where its thigh and shin point (x outward), and its foot's droop in degrees. */
function leg(b: PoseBuilder, s: Side, thigh: V, shin: V, droop: number): void {
  const left = s === 1;
  b.aim(left ? B_UPPER_LEG_L : B_UPPER_LEG_R, thigh[0] * s, thigh[1], thigh[2]);
  b.aim(left ? B_LOWER_LEG_L : B_LOWER_LEG_R, shin[0] * s, shin[1], shin[2]);
  b.turn(left ? B_FOOT_L : B_FOOT_R, droop);
}

/** The head brought level again by `up` degrees, after the hips have pitched. */
function face(b: PoseBuilder, up: number): void {
  b.turn(B_NECK, -up * 0.4).turn(B_HEAD, -up * 0.6);
}

/** At its trim: the wings a little raised and drawn back, rocking together, the body leaning into its way, the legs trailing loose. */
function trim(b: PoseBuilder, phase: number): void {
  const breath = detSin(phase * TAU), ripple = detSin((phase * 3 + 0.2) * TAU);
  hang(b, 9 + breath * 0.8);
  face(b, 12);
  leg(b, 1, [0.05, -1, -0.16 + breath * 0.02], [0.03, -1, -0.5], 32);
  leg(b, -1, [0.06, -1, -0.04 - breath * 0.02], [0.02, -1, -0.34], 26);
  for (const s of [1, -1] as const) wing(b, s, { dihedral: 7 + breath * 1.4 + s * ripple * 0.5, sweep: 6, pitch: 4 + ripple * 0.5 });
}

/** In a dive: the wings drawn well back and tipped down, shaking against each other, the body laid out behind the hands. */
function dive(b: PoseBuilder, phase: number): void {
  const shake = detSin(phase * 2 * TAU), buzz = detSin((phase * 5 + 0.3) * TAU);
  hang(b, 44);
  face(b, 34);
  leg(b, 1, [0.03, -0.72, -0.7], [0.02, -0.6, -0.8], 52);
  leg(b, -1, [0.03, -0.76, -0.65], [0.02, -0.64, -0.77], 50);
  for (const s of [1, -1] as const) wing(b, s, { dihedral: -3 + s * shake * 2.2 + buzz * 0.8, sweep: 25 + shake * 1.2, pitch: -17 + buzz * 1.1 });
}

/** Flared: the wings tipped up into the air and spread, the body upright under them and the legs swung forward to meet the ground. */
function flare(b: PoseBuilder): void {
  hang(b, -11);
  face(b, -6);
  leg(b, 1, [0.07, -0.86, 0.5], [0.04, -0.97, 0.22], 4);
  leg(b, -1, [0.07, -0.9, 0.42], [0.03, -0.98, 0.12], 6);
  for (const s of [1, -1] as const) wing(b, s, { dihedral: 11, sweep: -2, pitch: 25 });
}

/** As it is thrown open: the wings still together overhead like a shut book, drawn back, the body as it fell. */
function folded(b: PoseBuilder): void {
  hang(b, 4);
  leg(b, 1, [0.08, -1, 0.1], [0.04, -1, -0.3], 20);
  leg(b, -1, [0.08, -1, -0.02], [0.03, -1, -0.42], 24);
  for (const s of [1, -1] as const) wing(b, s, { dihedral: 68, sweep: 24, pitch: -6 });
}

/** Ids as HumanAnim finds them (shared/anim/pose.ts). */
export function glideClips(): Clip[] {
  return [
    clip("human/glide", 60, true, trim),
    clip("human/glide_dive", 20, true, dive),
    clip("human/glide_flare", 1, true, flare),
    clip("human/glide_folded", 1, true, folded),
  ];
}
