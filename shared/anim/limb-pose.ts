// Poses a limb from its end point, with an elbow or knee pointing toward a pole.

import type { PoseBuilder } from "./pose-builder.ts";
import {
  B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R,
  B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_SHOULDER_L, B_SHOULDER_R, B_THUMB_L, B_THUMB_R,
  B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN,
} from "./human.ts";

type V = [number, number, number];
/** 1 the body's left (+X), -1 its right. */
export type Side = 1 | -1;

export const rest = (bone: number): V => [HUMAN.rest[bone * 3]!, HUMAN.rest[bone * 3 + 1]!, HUMAN.rest[bone * 3 + 2]!];
const between = (a: number, b: number): number => {
  const [p, q] = [rest(a), rest(b)];
  return Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]));
};
const UPPER_ARM = between(B_UPPER_ARM_L, B_LOWER_ARM_L), FOREARM = between(B_LOWER_ARM_L, B_HAND_L);
const THIGH = between(B_UPPER_LEG_L, B_LOWER_LEG_L), SHIN = between(B_LOWER_LEG_L, B_FOOT_L);

export const arm = (s: Side) => (s === 1 ? { upper: B_UPPER_ARM_L, lower: B_LOWER_ARM_L, hand: B_HAND_L, fingers: B_FINGERS_L, tips: B_FINGERTIPS_L, thumb: B_THUMB_L, shoulder: B_SHOULDER_L } : { upper: B_UPPER_ARM_R, lower: B_LOWER_ARM_R, hand: B_HAND_R, fingers: B_FINGERS_R, tips: B_FINGERTIPS_R, thumb: B_THUMB_R, shoulder: B_SHOULDER_R });
export const leg = (s: Side) => (s === 1 ? { upper: B_UPPER_LEG_L, lower: B_LOWER_LEG_L, foot: B_FOOT_L } : { upper: B_UPPER_LEG_R, lower: B_LOWER_LEG_R, foot: B_FOOT_R });

/** Puts the end of a two-bone limb (upper, lower) at `target`, the middle joint bending toward `pole`. */
export function reach(b: PoseBuilder, upper: number, lower: number, a: number, c: number, target: V, pole: V, roll = 0): void {
  const r = b.joint(upper);
  let dx = target[0] - r[0], dy = target[1] - r[1], dz = target[2] - r[2];
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) (dx = 0), (dy = -1), (dz = 0), (d = 1e-6);
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const most = (a + c) * 0.999, least = Math.abs(a - c) + 0.01;
  d = d > most ? most : d < least ? least : d;
  const along = (a * a - c * c + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, a * a - along * along));
  // The pole, less its part along the reach.
  const k = pole[0] * ux + pole[1] * uy + pole[2] * uz;
  let px = pole[0] - k * ux, py = pole[1] - k * uy, pz = pole[2] - k * uz;
  const pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl < 1e-6) (px = 0), (py = 0), (pz = 1);
  else (px /= pl), (py /= pl), (pz /= pl);
  const mid: V = [r[0] + ux * along + px * off, r[1] + uy * along + py * off, r[2] + uz * along + pz * off];
  const end: V = [r[0] + ux * d, r[1] + uy * d, r[2] + uz * d];
  b.aim(upper, mid[0] - r[0], mid[1] - r[1], mid[2] - r[2]);
  b.aim(lower, end[0] - mid[0], end[1] - mid[1], end[2] - mid[2], roll);
}

/** The wrist at `at` (x outward from the body's middle on that side), the elbow toward `pole` (x outward too). */
export function hand(b: PoseBuilder, s: Side, at: V, pole: V = [0.6, -0.5, -0.4], roll = 0): void {
  const m = arm(s);
  reach(b, m.upper, m.lower, UPPER_ARM, FOREARM, [at[0] * s, at[1], at[2]], [pole[0] * s, pole[1], pole[2]], roll * s);
}

/** Curls a hand's fingers (0 open to 1 a fist), and its thumb by `thumb`. */
export function fist(b: PoseBuilder, s: Side, k = 1, thumb = k): void {
  const m = arm(s);
  b.local(m.fingers, 0, 0, -s * 70 * k).local(m.tips, 0, 0, -s * 80 * k).local(m.thumb, 0, -s * 45 * thumb, 0);
}

/** The foot's ankle at `at` (x outward), flat, the knee toward `knee` (x outward). */
export function foot(b: PoseBuilder, s: Side, at: V, knee: V = [0.12, 0, 1], flat = true): void {
  const m = leg(s);
  reach(b, m.upper, m.lower, THIGH, SHIN, [at[0] * s, at[1], at[2]], [knee[0] * s, knee[1], knee[2]]);
  if (flat) b.level(m.foot);
}
