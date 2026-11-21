// The emotes' clips written as code (shared/anim/emotes.ts lists them). A pose here says where the hands and feet go in
// model space (+Z ahead, +X the body's left, +Y up, the ground at 0) and two-bone reaches put the elbows and knees
// between: the feet stay planted as the hips bob, and a hand meets a chin, a hip or a partner's hand where the move
// wants it. Only exactly rounded arithmetic and detSin/detCos, so the clips are the same bits on every engine.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { clip, PoseBuilder } from "./authored.ts";
import type { Clip } from "./clip.ts";
import { EMOTES, emoteClipId } from "./emotes.ts";
import {
  B_CHEST, B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS,
  B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_THUMB_L, B_THUMB_R,
  B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN,
} from "./human.ts";

type V = [number, number, number];
/** 1 the body's left (+X), -1 its right. */
export type Side = 1 | -1;

const rest = (bone: number): V => [HUMAN.rest[bone * 3]!, HUMAN.rest[bone * 3 + 1]!, HUMAN.rest[bone * 3 + 2]!];
const between = (a: number, b: number): number => {
  const [p, q] = [rest(a), rest(b)];
  return Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]));
};
const UPPER_ARM = between(B_UPPER_ARM_L, B_LOWER_ARM_L), FOREARM = between(B_LOWER_ARM_L, B_HAND_L);
const THIGH = between(B_UPPER_LEG_L, B_LOWER_LEG_L), SHIN = between(B_LOWER_LEG_L, B_FOOT_L);
const HIPS: V = rest(B_HIPS);
/** The ankle's height when the foot is flat on the ground. */
const ANKLE = rest(B_FOOT_L)[1];

const arm = (s: Side) => (s === 1 ? { upper: B_UPPER_ARM_L, lower: B_LOWER_ARM_L, hand: B_HAND_L, fingers: B_FINGERS_L, tips: B_FINGERTIPS_L, thumb: B_THUMB_L, shoulder: B_SHOULDER_L } : { upper: B_UPPER_ARM_R, lower: B_LOWER_ARM_R, hand: B_HAND_R, fingers: B_FINGERS_R, tips: B_FINGERTIPS_R, thumb: B_THUMB_R, shoulder: B_SHOULDER_R });
const leg = (s: Side) => (s === 1 ? { upper: B_UPPER_LEG_L, lower: B_LOWER_LEG_L, foot: B_FOOT_L } : { upper: B_UPPER_LEG_R, lower: B_LOWER_LEG_R, foot: B_FOOT_R });

// --- Timing ------------------------------------------------------------------------------------------------------

const wave = (p: number, cycles: number, shift = 0): number => detSin((p * cycles + shift) * TAU);
const cwave = (p: number, cycles: number, shift = 0): number => detCos((p * cycles + shift) * TAU);
/** 0 to 1 eased. */
const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Up over the first `rise` of a one-shot and down over its last `fall`: a move's envelope. */
const env = (p: number, rise: number, fall: number): number => Math.min(ease(p / rise), ease((1 - p) / fall));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixV = (a: V, b: V, t: number): V => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
/** A beat that snaps, for stiff moves: `steps` held positions a cycle. */
const snap = (p: number, steps: number): number => Math.floor(p * steps) / steps;
/** A bounce on each beat: 0 at the beat, 1 between. */
const bounce = (p: number, beats: number): number => (1 - cwave(p, beats)) / 2;

// --- Reaching ----------------------------------------------------------------------------------------------------

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

/** Points the upper arm and forearm along directions (x outward), rolling the forearm by `roll` degrees. */
function point(b: PoseBuilder, s: Side, upper: V, lower: V, roll = 0): void {
  const m = arm(s);
  b.aim(m.upper, upper[0] * s, upper[1], upper[2]);
  b.aim(m.lower, lower[0] * s, lower[1], lower[2], roll * s);
}

/** An arm hanging loose at the side, swung forward by `swing` (-1 to 1). */
function relax(b: PoseBuilder, s: Side, swing = 0, out = 0): void {
  point(b, s, [0.13 + out, -1, swing * 0.35], [0.06 + out, -1, 0.14 + swing * 0.45]);
}

/** Curls a hand's fingers (0 open to 1 a fist), and its thumb by `thumb`. */
export function fist(b: PoseBuilder, s: Side, k = 1, thumb = k): void {
  const m = arm(s);
  b.local(m.fingers, 0, 0, -s * 70 * k).local(m.tips, 0, 0, -s * 80 * k).local(m.thumb, 0, -s * 45 * thumb, 0);
}

/** The foot's ankle at `at` (x outward), flat, the knee toward `knee` (x outward). */
function foot(b: PoseBuilder, s: Side, at: V, knee: V = [0.12, 0, 1], flat = true): void {
  const m = leg(s);
  reach(b, m.upper, m.lower, THIGH, SHIN, [at[0] * s, at[1], at[2]], [knee[0] * s, knee[1], knee[2]]);
  if (flat) b.level(m.foot);
}

interface Stance {
  /** How far the hips sink (bending the knees), metres. */
  down?: number;
  /** The hips moved to the body's left (+) and ahead (+). */
  sway?: number;
  ahead?: number;
  /** Degrees: the hips turned toward the left, tipped to the left, pitched forward. */
  twist?: number;
  tilt?: number;
  pitch?: number;
  /** Half the feet's spread, and each foot's own step ahead and lift. */
  wide?: number;
  stepL?: number;
  stepR?: number;
  liftL?: number;
  liftR?: number;
}

/** Hips and legs: the feet planted (or lifted) where the stance says, the knees bending as the hips sink. */
function stand(b: PoseBuilder, o: Stance = {}): void {
  b.hips((o.sway ?? 0), HIPS[1] - (o.down ?? 0), HIPS[2] + (o.ahead ?? 0));
  if (o.twist || o.tilt || o.pitch) b.turn(B_HIPS, o.pitch ?? 0, o.twist ?? 0, o.tilt ?? 0);
  const wide = o.wide ?? 0.11;
  for (const s of [1, -1] as const) {
    const step = s === 1 ? (o.stepL ?? 0) : (o.stepR ?? 0);
    const lift = s === 1 ? (o.liftL ?? 0) : (o.liftR ?? 0);
    foot(b, s, [wide, ANKLE + lift, -0.06 + step], [0.15, 0, 1]);
  }
}

/** The back bent forward (+) or back, turned to the left, bent to the left, degrees in all, spread up the spine. */
function torso(b: PoseBuilder, pitch: number, yaw = 0, roll = 0): void {
  for (const bone of [B_SPINE, B_CHEST, B_UPPER_CHEST]) b.turn(bone, pitch / 3, yaw / 3, roll / 3);
}

/** The head: down (+) or up, turned to the left, tipped to the left, shared with the neck. */
function head(b: PoseBuilder, down: number, turn = 0, tip = 0): void {
  b.turn(B_NECK, down * 0.4, turn * 0.4, tip * 0.4).turn(B_HEAD, down * 0.6, turn * 0.6, tip * 0.6);
}

/** Shoulders up (a shrug), degrees. */
function shoulders(b: PoseBuilder, up: number): void {
  b.turn(B_SHOULDER_L, 0, 0, up).turn(B_SHOULDER_R, 0, 0, -up);
}

/** Standing at ease: the weight on the feet, the arms loose, a breath. */
function ease_(b: PoseBuilder, p = 0): void {
  stand(b, { down: 0.01 + 0.004 * wave(p, 1) });
  torso(b, 1 + wave(p, 1));
}

// --- Gestures (the upper body; the legs are what the body was doing) -----------------------------------------------

function waveSmall(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.18, 0.18);
  head(b, -2, -8 * k, 4 * k);
  relax(b, 1);
  // The right forearm up, palm forward, swinging from the elbow.
  const swing = wave(p, 3.5) * k;
  point(b, -1, mixV([0.13, -1, 0], [0.75, 0.35, 0.2], k), mixV([0.06, -1, 0.14], [0.1 + 0.32 * swing, 1, 0.12], k), -85 * k);
}

function waveBig(b: PoseBuilder, p: number): void {
  const k = env(p, 0.12, 0.15);
  ease_(b);
  torso(b, -2, 0, 6 * wave(p, 3) * k);
  head(b, -6 * k, 0, 5 * wave(p, 3) * k);
  for (const s of [1, -1] as const) {
    const swing = wave(p, 3, s === 1 ? 0 : 0.5) * k;
    point(b, s, mixV([0.13, -1, 0], [0.45 + 0.25 * swing, 1, 0.1], k), mixV([0.06, -1, 0.14], [0.15 + 0.45 * swing, 1, 0.05], k), -85 * k);
  }
}

function beckon(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.15);
  head(b, 0, 0, -5 * k);
  relax(b, 1);
  // The right hand out, palm up, the fingers curling in twice.
  const curl = (1 - cwave(p, 3)) / 2;
  hand(b, -1, mixV([0.24, 0.9, 0], [0.2, 1.18 + 0.06 * curl, 0.38 - 0.08 * curl], k), [0.5, -0.8, -0.3], 170 * k);
  fist(b, -1, curl * k * 0.9, 0);
}

function pointAhead(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.2);
  torso(b, 0, -6 * k);
  relax(b, 1);
  point(b, -1, mixV([0.13, -1, 0], [0.08, 0.08, 1], k), mixV([0.06, -1, 0.14], [0.03, 0.06, 1], k));
  fist(b, -1, 0.6 * k, 0.6 * k);
}

function pointUp(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.2);
  head(b, -18 * k);
  relax(b, 1);
  point(b, -1, mixV([0.13, -1, 0], [0.2, 1, 0.15], k), mixV([0.06, -1, 0.14], [0.05, 1, 0.25], k));
  fist(b, -1, 0.6 * k, 0.6 * k);
}

function salute(b: PoseBuilder, p: number): void {
  stand(b, { down: 0, wide: 0.08 });
  const k = env(p, 0.2, 0.2);
  torso(b, -3 * k);
  head(b, -3 * k);
  relax(b, 1, 0, -0.06);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.1, 1.62, 0.1], k), [1, 0.1, 0]);
}

function nod(b: PoseBuilder, p: number): void {
  ease_(b);
  relax(b, 1);
  relax(b, -1);
  head(b, 16 * Math.max(0, wave(p, 2)) * env(p, 0.1, 0.1));
}

function headShake(b: PoseBuilder, p: number): void {
  ease_(b);
  relax(b, 1);
  relax(b, -1);
  head(b, 4, 28 * wave(p, 3) * env(p, 0.1, 0.15));
}

function stop(b: PoseBuilder, p: number): void {
  stand(b, { down: 0.02, stepL: 0.08 });
  const k = env(p, 0.12, 0.25);
  torso(b, -4 * k);
  relax(b, 1);
  // The right arm out ahead, the palm square to whoever is in front.
  point(b, -1, mixV([0.13, -1, 0], [0.1, 0.12, 1], k), mixV([0.06, -1, 0.14], [0.02, 0.25, 1], k), -90 * k);
  b.local(B_HAND_R, 0, 0, -75 * k);
}

function thumbsUp(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.2);
  head(b, 0, 0, -6 * k);
  relax(b, 1);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.2, 1.2, 0.36], k), [0.6, -0.7, -0.2], -90 * k);
  fist(b, -1, k, 0);
  b.local(B_THUMB_R, 0, 0, 60 * k);
}

function thumbsDown(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.2);
  head(b, 4 * k, 0, 6 * k);
  relax(b, 1);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.18, 1.15, 0.42], k), [0.6, -0.7, -0.2], 90 * k);
  fist(b, -1, k, 0);
  b.local(B_THUMB_R, 0, 0, 60 * k);
}

/** Hands meet in front of the chest `claps` times. */
function clapping(b: PoseBuilder, p: number, claps: number, tilt = 0): void {
  ease_(b);
  const k = env(p, 0.12, 0.15);
  head(b, 0, 0, tilt * k);
  const apart = (1 - cwave(p, claps)) / 2;
  for (const s of [1, -1] as const) hand(b, s, mixV([0.24, 0.9, 0], [0.04 + 0.2 * apart, 1.22, 0.3], k), [0.7, -0.6, -0.2], -80 * k);
}

function cheer(b: PoseBuilder, p: number): void {
  const k = env(p, 0.12, 0.2);
  const hop = bounce(p, 3) * k;
  stand(b, { down: 0.04 * hop });
  torso(b, -6 * k);
  head(b, -12 * k);
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0], [0.4, 1, 0.08 + 0.1 * hop], k), mixV([0.06, -1, 0.14], [0.2, 1, 0.12], k));
    fist(b, s, k);
  }
}

function fistPump(b: PoseBuilder, p: number): void {
  const k = env(p, 0.12, 0.2);
  stand(b, { down: 0.04 * k });
  torso(b, 6 * k);
  relax(b, 1);
  const pump = (1 - cwave(p, 2.5)) / 2;
  hand(b, -1, mixV([0.24, 0.9, 0], [0.24, 1.28 + 0.4 * pump, 0.22 - 0.06 * pump], k), [0.7, -0.6, -0.3]);
  fist(b, -1, k);
}

function shrug(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.25, 0.3);
  shoulders(b, 14 * k);
  head(b, -3 * k, 0, 10 * k);
  for (const s of [1, -1] as const) hand(b, s, mixV([0.24, 0.9, 0], [0.42, 1.0, 0.26], k), [0.3, -1, -0.2], 160 * k);
}

function facepalm(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.2, 0.25);
  torso(b, 8 * k);
  head(b, 22 * k);
  relax(b, 1);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.05, 1.52, 0.2], k), [0.4, -1, 0.2], -60 * k);
}

function think(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.2, 0.2);
  head(b, -6 * k, 0, 8 * k);
  // The left arm across the waist holding the right elbow; the right hand at the chin.
  hand(b, 1, mixV([0.24, 0.9, 0], [-0.1, 1.08, 0.2], k), [0.5, -1, 0]);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.04, 1.46, 0.18], k), [0.2, -1, 0.2], -40 * k);
  fist(b, -1, 0.5 * k);
}

function shush(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.2, 0.25);
  head(b, 4 * k);
  torso(b, 4 * k);
  relax(b, 1);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.02, 1.44, 0.2], k), [0.6, -1, 0], -90 * k);
  fist(b, -1, 0.7 * k, 0.9 * k);
}

function watchingYou(b: PoseBuilder, p: number): void {
  ease_(b);
  relax(b, 1);
  // Two fingers to the eyes, then out at whoever it is, twice.
  const k = env(p, 0.1, 0.12);
  const out = (1 - cwave(p, 2)) / 2;
  head(b, -2, 0, -6 * k);
  hand(b, -1, mixV([0.24, 0.9, 0], mixV([0.04, 1.56, 0.17], [0.12, 1.4, 0.55], out), k), [0.8, -0.4, -0.2], -90 * k);
  fist(b, -1, 0.5 * k, 0.8 * k);
}

function throatSlash(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.2);
  head(b, 6 * k);
  relax(b, 1);
  const across = ease((p - 0.35) / 0.3);
  hand(b, -1, mixV([0.24, 0.9, 0], [mix(0.16, -0.14, across), 1.38, 0.17], k), [0.8, -0.4, -0.2], -90 * k);
  fist(b, -1, 0.6 * k, 0.8 * k);
}

function laugh(b: PoseBuilder, p: number): void {
  const k = env(p, 0.1, 0.2);
  const shake = wave(p, 6);
  stand(b, { down: 0.02 + 0.015 * shake * k });
  torso(b, (-6 + 14 * ease((p - 0.4) / 0.4)) * k + 2 * shake * k);
  head(b, (-14 + 20 * ease((p - 0.4) / 0.4)) * k);
  for (const s of [1, -1] as const) hand(b, s, mixV([0.24, 0.9, 0], [0.1, 1.04, 0.18], k), [0.8, -0.5, 0]);
}

function checkWrist(b: PoseBuilder, p: number): void {
  ease_(b);
  const k = env(p, 0.15, 0.2);
  head(b, 22 * k, 18 * k);
  relax(b, -1);
  // The left forearm up in front; the right forefinger taps the wrist.
  hand(b, 1, mixV([0.24, 0.9, 0], [0.02, 1.22, 0.35], k), [0.6, -0.8, -0.2], 90 * k);
  const tap = (1 - cwave(p, 3)) / 2;
  hand(b, -1, mixV([0.24, 0.9, 0], [-0.04, 1.24 + 0.04 * tap, 0.3], k * ease((p - 0.2) / 0.2) * ease((0.85 - p) / 0.15)), [0.6, -0.8, -0.2]);
}

function yawn(b: PoseBuilder, p: number): void {
  const k = env(p, 0.3, 0.3);
  stand(b, { down: 0.01 });
  torso(b, -10 * k);
  head(b, -22 * k);
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0], [0.35, 1, -0.1], k), mixV([0.06, -1, 0.14], [-0.5, 0.8, -0.1], k));
    fist(b, s, 0.6 * k);
  }
}

function crossArms(b: PoseBuilder, p: number): void {
  stand(b, { down: 0.01, wide: 0.13, sway: 0.03 * wave(p, 1) });
  torso(b, -2 + wave(p, 1));
  head(b, -2, 0, 3 * wave(p, 0.5));
  hand(b, 1, [-0.13, 1.16, 0.16], [0.6, -0.6, 0.1]);
  hand(b, -1, [-0.15, 1.2, 0.2], [0.6, -0.6, 0.1]);
  fist(b, 1, 0.5);
  fist(b, -1, 0.5);
}

function handsOnHips(b: PoseBuilder, p: number): void {
  stand(b, { down: 0.01, wide: 0.14, sway: 0.02 * wave(p, 1) });
  torso(b, -3 + wave(p, 1), 0, 2 * wave(p, 1));
  head(b, -3, 6 * wave(p, 0.5));
  for (const s of [1, -1] as const) {
    hand(b, s, [0.2, 1.0, 0.02], [1, 0, -0.7], 90);
    fist(b, s, 0.4);
  }
}

function stare(b: PoseBuilder, p: number): void {
  stand(b, { down: 0.02, wide: 0.12 });
  torso(b, 6);
  // The head tips slowly to one side and back, never leaving whoever is watched.
  head(b, 6 + 2 * wave(p, 1), 0, 22 * (0.5 - 0.5 * cwave(p, 1)));
  relax(b, 1, 0, 0.02);
  relax(b, -1, 0, 0.02);
  fist(b, 1, 0.8);
  fist(b, -1, 0.8);
}

// --- Whole-body one-shots ----------------------------------------------------------------------------------------

function bow(b: PoseBuilder, p: number): void {
  const k = env(p, 0.3, 0.35);
  stand(b, { down: 0.01, ahead: -0.04 * k, wide: 0.08 });
  torso(b, 52 * k);
  head(b, 10 * k);
  // The right hand to the chest, the left behind the back.
  hand(b, -1, mixV([0.24, 0.9, 0], [0.04, 1.2, 0.18], k), [0.8, -0.5, 0], -70 * k);
  hand(b, 1, mixV([0.24, 0.9, 0], [-0.02, 0.98, -0.28], k), [0.7, -0.5, -0.5]);
}

function flex(b: PoseBuilder, p: number): void {
  const k = env(p, 0.15, 0.2);
  const pump = 0.5 + 0.5 * wave(p, 2.5);
  stand(b, { down: 0.12 * k, wide: mix(0.11, 0.24, k) });
  torso(b, -8 * k + 3 * pump * k);
  head(b, -8 * k, 20 * k * wave(p, 1.25));
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0], [1, 0.12 + 0.08 * pump, 0], k), mixV([0.06, -1, 0.14], [0.1, 1, -0.05 - 0.2 * pump], k), -80 * k);
    fist(b, s, k);
  }
}

function stretch(b: PoseBuilder, p: number): void {
  const up = env(p, 0.2, 0.15);
  const side = wave(p, 1) * ease((p - 0.25) / 0.15) * ease((0.85 - p) / 0.15);
  stand(b, { down: 0, wide: 0.15, sway: -0.04 * side });
  torso(b, -6 * up, 0, 26 * side);
  head(b, -10 * up, 0, 10 * side);
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0], [0.12, 1, 0], up), mixV([0.06, -1, 0.14], [-0.35, 1, 0], up));
    fist(b, s, 0.5 * up);
  }
}

function roar(b: PoseBuilder, p: number): void {
  const k = env(p, 0.2, 0.25);
  const shake = wave(p, 9) * ease((p - 0.25) / 0.1) * ease((0.75 - p) / 0.1);
  stand(b, { down: 0.18 * k, wide: mix(0.11, 0.26, k), ahead: 0.06 * k, stepL: 0.2 * k });
  torso(b, 18 * k + 2 * shake);
  head(b, -26 * k, 4 * shake);
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0], [0.9, 0.35, 0.35], k), mixV([0.06, -1, 0.14], [0.3, 0.6, 0.8], k), -40 * k);
    fist(b, s, 0.55 * k, 0.2 * k);
  }
}

function startle(b: PoseBuilder, p: number): void {
  // A jump back, the hands up in front, then settling.
  const jolt = ease(p / 0.08) * ease((0.7 - p) / 0.4);
  const air = p > 0.04 && p < 0.22 ? detSin(((p - 0.04) / 0.18) * (TAU / 2)) : 0;
  stand(b, { down: 0.14 * jolt - 0.1 * air, ahead: -0.25 * ease(p / 0.2), liftL: 0.08 * air, liftR: 0.08 * air });
  torso(b, -10 * jolt);
  head(b, -12 * jolt, 0, 0);
  for (const s of [1, -1] as const) hand(b, s, mixV([0.24, 0.9, 0], [0.18, 1.45, 0.32], jolt), [0.8, -0.6, -0.2], -70 * jolt);
}

function victoryJump(b: PoseBuilder, p: number): void {
  // Crouch, spring up with both fists high, land soft.
  const crouch = ease(p / 0.2) * ease((0.35 - p) / 0.1) + ease((p - 0.6) / 0.08) * ease((0.85 - p) / 0.15);
  const air = p > 0.3 && p < 0.62 ? detSin(((p - 0.3) / 0.32) * (TAU / 2)) : 0;
  const tuck = air * 0.12;
  stand(b, { down: 0.2 * crouch - 0.45 * air, liftL: 0.45 * air + tuck, liftR: 0.45 * air + tuck, stepL: 0.06 * air, stepR: 0.06 * air });
  torso(b, 14 * crouch - 6 * air);
  head(b, -16 * air);
  const up = ease((p - 0.25) / 0.1) * ease((0.92 - p) / 0.1);
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0.3 * crouch], [0.35, 1, 0.1], up), mixV([0.06, -1, 0.14], [0.15, 1, 0.1], up));
    fist(b, s, up);
  }
}

function claw(b: PoseBuilder, p: number): void {
  const k = env(p, 0.2, 0.25);
  const swipe = ease((p - 0.35) / 0.15);
  stand(b, { down: 0.15 * k, wide: 0.2, stepL: 0.25 * k, ahead: 0.12 * k * swipe, twist: 25 * k * (1 - 2 * swipe) });
  torso(b, 20 * k, 10 * k * (1 - 2 * swipe));
  head(b, -18 * k);
  hand(b, -1, mixV([0.24, 0.9, 0], mixV([0.55, 1.6, 0.2], [-0.25, 1.0, 0.55], swipe), k), [0.8, 0.2, -0.3], -40 * k);
  hand(b, 1, mixV([0.24, 0.9, 0], [0.3, 1.25, 0.35], k), [0.8, -0.3, -0.3]);
  fist(b, -1, 0.5 * k, 0.2 * k);
  fist(b, 1, 0.5 * k, 0.2 * k);
}

// --- Dances (loops; 120 beats a minute, a beat every 15 ticks) --------------------------------------------------------

function sway(b: PoseBuilder, p: number): void {
  const s = wave(p, 1);
  stand(b, { down: 0.04 + 0.03 * bounce(p, 2), sway: 0.06 * s, tilt: -4 * s, wide: 0.15 });
  torso(b, 2, 0, 6 * s);
  head(b, 2 * bounce(p, 2), 0, -8 * s);
  for (const side of [1, -1] as const) {
    hand(b, side, [0.3 + 0.08 * s * side, 1.15 + 0.08 * bounce(p, 2), 0.25], [0.6, -0.6, -0.2], -40);
    fist(b, side, 0.4);
  }
}

function robot(b: PoseBuilder, p: number): void {
  const q = snap(p, 8);
  const r = wave(q, 1);
  stand(b, { down: 0.05 + 0.03 * Math.abs(r), wide: 0.13, twist: 20 * snap(r, 2) });
  torso(b, 0, -10 * r);
  head(b, 0, 40 * wave(snap(p, 4), 1), 0);
  // Arms in right angles, one up and one down, swapping on the beat.
  const a = Math.round(q * 4) % 2 === 0 ? 1 : -1;
  for (const s of [1, -1] as const) {
    const up = a * s > 0;
    point(b, s, [0.85, -0.45, 0.25], up ? [0.1, 1, 0.1] : [0.1, -0.2, 1], up ? -90 : 0);
    b.local(s === 1 ? B_HAND_L : B_HAND_R, 0, 0, 0);
  }
}

function chicken(b: PoseBuilder, p: number): void {
  const flap = (1 - cwave(p, 4)) / 2;
  const peck = Math.max(0, wave(p, 2));
  stand(b, { down: 0.12 + 0.06 * bounce(p, 4), ahead: -0.04, pitch: 18, wide: 0.17 });
  torso(b, 8);
  head(b, -26 + 30 * peck, 0, 0);
  for (const s of [1, -1] as const) {
    // Hands in the armpits, the elbows flapping.
    hand(b, s, [0.1, 1.3, 0.08], [0.6 + 0.6 * flap, -0.3 + 0.8 * flap, -0.4]);
    fist(b, s, 1);
  }
}

function sideShuffle(b: PoseBuilder, p: number): void {
  // Step out to the left and close, then to the right, clapping on the close.
  const l = Math.max(0, wave(p, 1)), r = Math.max(0, -wave(p, 1));
  stand(b, { down: 0.06 + 0.04 * bounce(p, 4), sway: 0.12 * (l - r), wide: 0.11, liftL: 0.06 * Math.max(0, wave(p, 2)) * l, liftR: 0.06 * Math.max(0, wave(p, 2)) * r });
  b.hips(0.12 * (l - r), HIPS[1] - 0.06 - 0.04 * bounce(p, 4), HIPS[2]);
  torso(b, 4, 0, -6 * (l - r));
  head(b, 4 * bounce(p, 4), 0, 8 * (l - r));
  const apart = bounce(p, 4);
  for (const s of [1, -1] as const) hand(b, s, [0.05 + 0.25 * apart, 1.22 + 0.06 * apart, 0.3], [0.7, -0.6, -0.2], -80);
}

function runningMan(b: PoseBuilder, p: number): void {
  // One knee comes up as the other foot slides back; the arms pump.
  const a = wave(p, 1);
  const upL = Math.max(0, a), upR = Math.max(0, -a);
  stand(b, { down: 0.1 + 0.04 * bounce(p, 2), wide: 0.1, stepL: 0.25 * upL - 0.2 * upR, stepR: 0.25 * upR - 0.2 * upL, liftL: 0.32 * upL, liftR: 0.32 * upR });
  torso(b, 8);
  head(b, 4 * bounce(p, 2));
  for (const s of [1, -1] as const) {
    const fwd = s === 1 ? -a : a;
    hand(b, s, [0.22, 1.1, 0.12 + 0.22 * fwd], [0.4, -0.6, -0.6]);
    fist(b, s, 0.8);
  }
}

function sprinkler(b: PoseBuilder, p: number): void {
  // The left hand behind the head; the right arm out ahead, ticking across in steps and sweeping back.
  const ticking = p < 0.75 ? snap(p / 0.75, 6) : 1 - (p - 0.75) / 0.25;
  const across = mix(-0.6, 0.9, ticking);
  stand(b, { down: 0.08, wide: 0.14, liftL: 0.12, stepL: 0.08, twist: 18 * across });
  torso(b, 4, 6 * across);
  head(b, 0, 10 * across);
  hand(b, 1, [0.05, 1.62, -0.12], [1, 0.3, 0.2]);
  point(b, -1, [0.15, 0.1, 1], [0.1, 0.12, 1], -90);
  b.local(B_HAND_R, 0, 0, -40);
}

function raiseRoof(b: PoseBuilder, p: number): void {
  const push = bounce(p, 4);
  stand(b, { down: 0.08 + 0.06 * push, wide: 0.17 });
  torso(b, 4 - 4 * push);
  head(b, 8 - 14 * push, 0, 6 * wave(p, 1));
  for (const s of [1, -1] as const) {
    hand(b, s, [0.32, 1.52 + 0.22 * push, 0.1], [0.9, -0.3, -0.3], -170);
    b.local(s === 1 ? B_HAND_L : B_HAND_R, 0, 0, s * 70);
  }
}

function disco(b: PoseBuilder, p: number): void {
  // The right hand points up to the left of the head, then down across to the left hip; the hips swing with it.
  const up = (1 - cwave(p, 2)) / 2;
  const sw = wave(p, 2);
  stand(b, { down: 0.06 + 0.04 * bounce(p, 4), sway: 0.06 * sw, tilt: -5 * sw, wide: 0.16 });
  torso(b, 2, 0, 8 * sw);
  head(b, -10 * up + 6 * (1 - up), 0, -6 * sw);
  hand(b, 1, [0.2, 1.0, 0.1], [0.8, -0.4, -0.3]);
  fist(b, 1, 0.8);
  hand(b, -1, mixV([-0.15, 0.95, 0.25], [0.45, 1.9, 0.1], up), [0.6, -0.4, -0.4]);
  fist(b, -1, 0.6, 0.6);
}

function twist(b: PoseBuilder, p: number): void {
  const t = wave(p, 2);
  stand(b, { down: 0.14 + 0.03 * bounce(p, 4), twist: 28 * t, wide: 0.15 });
  torso(b, 6, -36 * t);
  head(b, 0, 10 * t);
  for (const s of [1, -1] as const) {
    hand(b, s, [0.26, 1.08, 0.2 + 0.15 * t * s], [0.7, -0.4, -0.5]);
    fist(b, s, 0.7);
  }
}

function headbang(b: PoseBuilder, p: number): void {
  const bang = bounce(p, 4);
  stand(b, { down: 0.1 + 0.05 * bang, wide: 0.2, stepL: 0.12 });
  torso(b, 10 + 14 * bang);
  head(b, -10 + 40 * bang);
  // Horns up on the right, the left hand on an air guitar's neck.
  point(b, -1, [0.35, 1, 0.2], [0.1, 1, 0.1], -90);
  fist(b, -1, 0.7, 0.7);
  hand(b, 1, [0.4, 1.15, 0.38], [0.7, -0.6, -0.2], 60);
  fist(b, 1, 0.6);
}

function jumpingJacks(b: PoseBuilder, p: number): void {
  // Two jacks a cycle: out with the arms up, in with them down.
  const out = (1 - cwave(p, 2)) / 2;
  const air = Math.abs(wave(p, 2)) * 0.06;
  stand(b, { down: 0.03 - air, wide: mix(0.09, 0.3, out), liftL: air, liftR: air });
  torso(b, 0);
  head(b, 0);
  for (const s of [1, -1] as const) point(b, s, mixV([0.15, -1, 0], [0.4, 1, 0], out), mixV([0.08, -1, 0.05], [0.1, 1, 0], out));
}

function pogo(b: PoseBuilder, p: number): void {
  const air = Math.abs(wave(p, 2));
  stand(b, { down: 0.08 * (1 - air) - 0.28 * air, liftL: 0.3 * air, liftR: 0.3 * air, wide: 0.08 });
  torso(b, 4 - 6 * air);
  head(b, -8 * air, 0, 6 * wave(p, 1));
  relax(b, 1, 0, -0.05);
  relax(b, -1, 0, -0.05);
  fist(b, 1, 1);
  fist(b, -1, 1);
}

function egyptian(b: PoseBuilder, p: number): void {
  // Walking in place, the arms in a zigzag, the head sliding side to side.
  const step = wave(p, 2);
  stand(b, { down: 0.06, wide: 0.1, liftL: 0.07 * Math.max(0, step), liftR: 0.07 * Math.max(0, -step), stepL: 0.06 * step, stepR: -0.06 * step });
  torso(b, 0, 12);
  head(b, 0, -40);
  const slide = wave(p, 4) * 0.5;
  b.turn(B_NECK, 0, 0, 10 * slide);
  point(b, 1, [0.9, 0.2, 0.3], [0.1, 1, 0.1], -90);
  b.local(B_HAND_L, 0, 0, -80);
  point(b, -1, [0.9, -0.3, -0.3], [0.05, -1, 0.3], 90);
  b.local(B_HAND_R, 0, 0, -80);
}

// --- Rest, life and scary (loops) -----------------------------------------------------------------------------------

function sit(b: PoseBuilder, p: number): void {
  // On the ground, knees up, the forearms on the knees.
  b.hips(0, 0.17, -0.25);
  torso(b, 18 + wave(p, 1));
  head(b, -12, 6 * wave(p, 0.5));
  for (const s of [1, -1] as const) foot(b, s, [0.16, ANKLE, 0.22], [0.15, 1, 0.4]);
  for (const s of [1, -1] as const) hand(b, s, [0.15, 0.48, 0.32], [0.6, 0, -0.3]);
}

function sitCross(b: PoseBuilder, p: number): void {
  b.hips(0, 0.16, -0.12);
  torso(b, 4 + 1.5 * wave(p, 1));
  head(b, -2, 8 * wave(p, 0.5));
  for (const s of [1, -1] as const) foot(b, s, [-0.14, 0.07, 0.22], [1, 0.25, 0.35], false);
  for (const s of [1, -1] as const) hand(b, s, [0.32, 0.36, 0.28], [0.6, 0, -0.4], 120);
}

function lieBack(b: PoseBuilder, p: number): void {
  // On the back, the hands behind the head, one knee up.
  b.hips(0, 0.13, -0.05).turn(B_HIPS, -86);
  torso(b, 2 * wave(p, 1));
  head(b, 12);
  foot(b, 1, [0.14, 0.12, 0.85], [0.1, 0, 1], false);
  foot(b, -1, [0.1, ANKLE, 0.45], [0.2, 1, 0.3]);
  for (const s of [1, -1] as const) hand(b, s, [0.1, 0.18, -0.72], [1, 0.2, 0]);
}

function meditate(b: PoseBuilder, p: number): void {
  const breath = wave(p, 1);
  b.hips(0, 0.16, -0.12);
  torso(b, 2 - 2 * breath);
  head(b, 10 - 2 * breath);
  shoulders(b, 3 * breath);
  for (const s of [1, -1] as const) foot(b, s, [-0.14, 0.07, 0.22], [1, 0.25, 0.35], false);
  for (const s of [1, -1] as const) {
    hand(b, s, [0.3, 0.36, 0.3], [0.6, 0, -0.4], 180);
    fist(b, s, 0.25, 0.5);
  }
}

function kneel(b: PoseBuilder, p: number): void {
  // On the right knee, the left foot planted ahead, a forearm on the left knee.
  b.hips(0, 0.56, -0.08);
  torso(b, 8 + wave(p, 1));
  head(b, 6);
  foot(b, 1, [0.12, ANKLE, 0.38], [0.1, 1, 1]);
  foot(b, -1, [0.12, 0.1, -0.45], [0, -1, 0.8]);
  hand(b, 1, [0.12, 0.6, 0.38], [0.8, 0, -0.3]);
  relax(b, -1, 0.1, 0.03);
}

function pushups(b: PoseBuilder, p: number): void {
  // Face down, straight as a plank, the arms bending and pushing.
  const down = (1 + cwave(p, 1)) / 2;
  b.hips(0, mix(0.42, 0.24, down), -0.15).turn(B_HIPS, 80 - 8 * down);
  torso(b, 2);
  head(b, -18);
  for (const s of [1, -1] as const) {
    const sh = b.joint(s === 1 ? B_UPPER_ARM_L : B_UPPER_ARM_R);
    // The hands under the shoulders, the elbows going back along the body as it lowers.
    hand(b, s, [Math.abs(sh[0]) + 0.04, ANKLE, sh[2] + 0.04], [0.35, 0.3, -1]);
    b.level(s === 1 ? B_HAND_L : B_HAND_R);
    const m = leg(s);
    b.aim(m.upper, 0.06 * s, -0.1, -1).aim(m.lower, 0.03 * s, -0.08, -1);
    b.turn(m.foot, 60);
  }
}

function playDead(b: PoseBuilder, p: number): void {
  // Sprawled on the back, limbs flung out; now and then a twitch.
  const twitch = p > 0.8 && p < 0.86 ? detSin(((p - 0.8) / 0.06) * TAU) : 0;
  b.hips(0, 0.12, 0).turn(B_HIPS, -88, 0, 6);
  torso(b, 0, 0, 4);
  head(b, 0, 40 + 6 * twitch, 10);
  for (const s of [1, -1] as const) {
    const m = leg(s);
    b.aim(m.upper, 0.35 * s, -0.08, 1).aim(m.lower, 0.25 * s, -0.08, 1);
    point(b, s, [1, 0.0, s === 1 ? 0.4 : -0.3], [0.8, -0.1, s === 1 ? 0.6 + 0.2 * twitch : -0.5]);
  }
}

function cower(b: PoseBuilder, p: number): void {
  const shake = wave(p, 8) * 0.5;
  stand(b, { down: 0.48, ahead: -0.12, wide: 0.13, pitch: 10 });
  torso(b, 32 + 2 * shake);
  head(b, 28);
  // Both arms over the head.
  for (const s of [1, -1] as const) hand(b, s, [0.08, 1.15 + 0.01 * shake, 0.32], [1, 0.4, 0]);
}

function stalk(b: PoseBuilder, p: number): void {
  // Low, leaning in, shifting weight foot to foot, the hands ready to grab.
  const w = wave(p, 1);
  stand(b, { down: 0.3, ahead: 0.04, wide: 0.2, sway: 0.08 * w, stepL: 0.18, stepR: -0.12, tilt: -4 * w });
  torso(b, 26, 0, 4 * w);
  head(b, -30, 8 * wave(p, 0.5));
  for (const s of [1, -1] as const) {
    hand(b, s, [0.32, 0.95 + 0.04 * w * s, 0.45], [0.8, 0, -0.4], -60);
    fist(b, s, 0.45, 0.2);
  }
}

function zombie(b: PoseBuilder, p: number): void {
  const w = wave(p, 1);
  stand(b, { down: 0.07, sway: 0.07 * w, tilt: -7 * w, wide: 0.14, liftL: 0.04 * Math.max(0, -w), liftR: 0.04 * Math.max(0, w) });
  torso(b, 12, 6 * w, 8 * w);
  head(b, 20, 10 * w, 26);
  for (const s of [1, -1] as const) {
    point(b, s, [0.12, 0.1 + 0.05 * w * s, 1], [0.05, -0.15, 1]);
    b.local(s === 1 ? B_HAND_L : B_HAND_R, 0, 0, -s * 35);
  }
}

function cry(b: PoseBuilder, p: number): void {
  const sob = Math.max(0, wave(p, 3));
  stand(b, { down: 0.06 + 0.015 * sob });
  torso(b, 18 + 4 * sob);
  head(b, 28 + 4 * sob);
  shoulders(b, 6 * sob);
  for (const s of [1, -1] as const) hand(b, s, [0.06, 1.48, 0.22], [0.8, -0.8, 0.2], -60);
}

// --- Played by two (each side alone: the partner stands `apart` ahead, face to face) -------------------------------

const apartOf = (id: string): number => EMOTES.find((e) => e.id === id)?.pair?.apart ?? 0.75;

function handshake(b: PoseBuilder, p: number): void {
  const mid = apartOf("handshake") / 2;
  const k = env(p, 0.22, 0.2);
  const pump = wave(p, 3) * ease((p - 0.25) / 0.08) * ease((0.75 - p) / 0.08);
  stand(b, { down: 0.01, ahead: 0.05 * k, stepR: 0.1 * k });
  torso(b, 10 * k, 8 * k);
  head(b, 4 * k);
  relax(b, 1);
  // Right hands meet on the line between the two.
  hand(b, -1, mixV([0.24, 0.9, 0], [0.0, 1.06 + 0.045 * pump, mid], k), [0.5, -1, -0.2], -80 * k);
  fist(b, -1, 0.55 * k, 0.3 * k);
}

function highFive(b: PoseBuilder, p: number): void {
  const mid = apartOf("high_five") / 2;
  const up = ease(p / 0.3), hit = ease((p - 0.38) / 0.06), back = ease((p - 0.6) / 0.35);
  const k = up * (1 - back);
  stand(b, { down: 0.05 * k + 0.03 * hit * (1 - back), ahead: 0.06 * k, stepR: 0.12 * k });
  torso(b, 2 * k, 8 * k);
  head(b, -14 * k);
  relax(b, 1);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.0, mix(1.6, 1.66, hit), mix(mid - 0.12, mid, hit)], k), [0.8, -0.4, -0.3], -90 * k);
}

function fistBump(b: PoseBuilder, p: number): void {
  const mid = apartOf("fist_bump") / 2;
  const k = env(p, 0.3, 0.3);
  const bump = ease((p - 0.35) / 0.08) * ease((0.6 - p) / 0.1);
  stand(b, { down: 0.02, ahead: 0.04 * k });
  torso(b, 8 * k, 6 * k);
  head(b, 6 * k);
  relax(b, 1);
  hand(b, -1, mixV([0.24, 0.9, 0], [0.0, 1.16, mix(mid - 0.12, mid - 0.03, bump)], k), [0.6, -0.8, -0.2], -90 * k);
  fist(b, -1, k);
}

function hug(b: PoseBuilder, p: number): void {
  const apart = apartOf("hug");
  const k = env(p, 0.25, 0.25);
  const pat = wave(p, 4) * ease((p - 0.35) / 0.1) * ease((0.75 - p) / 0.1);
  stand(b, { down: 0.02, ahead: 0.04 * k });
  torso(b, 10 * k, 0, 4 * k);
  head(b, 6 * k, 25 * k);
  // Arms round the other's back, one higher than the other, the right one patting.
  hand(b, 1, mixV([0.24, 0.9, 0], [-0.05, 1.2, apart + 0.12], k), [0.8, -0.3, -0.2]);
  hand(b, -1, mixV([0.24, 0.9, 0], [-0.08, 1.36 + 0.04 * pat, apart + 0.1], k), [0.8, -0.1, -0.2]);
}

function chestBump(b: PoseBuilder, p: number): void {
  const run = ease(p / 0.3);
  const air = p > 0.28 && p < 0.5 ? detSin(((p - 0.28) / 0.22) * (TAU / 2)) : 0;
  const back = ease((p - 0.55) / 0.35);
  stand(b, { down: 0.14 * run * (1 - air) * (1 - back) - 0.3 * air, ahead: 0.12 * (1 - back) * run, liftL: 0.3 * air, liftR: 0.3 * air });
  torso(b, (-16 * air + 8 * run) * (1 - back));
  head(b, -18 * air * (1 - back));
  for (const s of [1, -1] as const) {
    point(b, s, mixV([0.13, -1, 0], [0.5, 0.2, -0.8], run * (1 - back)), mixV([0.06, -1, 0.14], [0.2, 0.3, -0.9], run * (1 - back)));
    fist(b, s, run * (1 - back));
  }
}

function scare(b: PoseBuilder, p: number): void {
  // A lunge at the other with the hands up like claws, a boo, and a laugh.
  const lunge = ease((p - 0.1) / 0.12) * ease((0.7 - p) / 0.2);
  stand(b, { down: 0.2 * lunge, ahead: 0.15 * lunge, stepL: 0.3 * lunge, wide: 0.15 });
  torso(b, 18 * lunge - 8 * ease((p - 0.7) / 0.2));
  head(b, -16 * lunge);
  for (const s of [1, -1] as const) {
    hand(b, s, mixV([0.24, 0.9, 0], [0.3, 1.55, 0.45], lunge), [0.8, -0.2, -0.3], -60 * lunge);
    fist(b, s, 0.5 * lunge, 0.2 * lunge);
  }
}

function startled(b: PoseBuilder, p: number): void {
  startle(b, Math.max(0, (p - 0.1) / 0.9));
}

/** Each emote's clip: frames (30 a second), and how it poses at a phase from 0 to 1. */
const CLIPS: Record<string, [number, (b: PoseBuilder, p: number) => void]> = {
  wave: [66, waveSmall], wave_big: [72, waveBig], beckon: [60, beckon], point: [54, pointAhead], point_up: [54, pointUp],
  salute: [60, salute], nod: [36, nod], head_shake: [42, headShake], stop: [48, stop], thumbs_up: [48, thumbsUp],
  thumbs_down: [48, thumbsDown], clap: [60, (b, p) => clapping(b, p, 5)], slow_clap: [96, (b, p) => clapping(b, p, 4, 8)],
  cheer: [60, cheer], fist_pump: [54, fistPump], shrug: [48, shrug], facepalm: [66, facepalm], think: [84, think],
  shush: [54, shush], watching_you: [72, watchingYou], throat_slash: [54, throatSlash], laugh: [72, laugh],
  check_wrist: [72, checkWrist], yawn: [84, yawn], cross_arms: [120, crossArms], hands_on_hips: [120, handsOnHips],
  stare: [150, stare], bow: [72, bow], flex: [84, flex], stretch: [120, stretch], roar: [84, roar], startle: [48, startle],
  victory_jump: [54, victoryJump], claw: [48, claw], sway: [60, sway], robot: [120, robot], chicken: [60, chicken],
  side_shuffle: [60, sideShuffle], running_man: [30, runningMan], sprinkler: [90, sprinkler], raise_roof: [60, raiseRoof],
  disco: [60, disco], twist: [60, twist], headbang: [60, headbang], jumping_jacks: [60, jumpingJacks], pogo: [30, pogo],
  egyptian: [60, egyptian], sit: [150, sit], sit_cross: [150, sitCross], lie_back: [150, lieBack], meditate: [150, meditate],
  kneel: [120, kneel], pushups: [45, pushups], play_dead: [180, playDead], cower: [60, cower], stalk: [90, stalk],
  zombie: [60, zombie], cry: [60, cry], handshake: [84, handshake], high_five: [54, highFive], fist_bump: [54, fistBump],
  hug: [96, hug], chest_bump: [54, chestBump], scare: [60, scare], startled: [60, startled],
};

let made: readonly Clip[] | null = null;

/** Every emote written as code, as clips. */
export function emoteClips(): readonly Clip[] {
  return (made ??= EMOTES.flatMap((e) => {
    const c = CLIPS[e.id];
    return c ? [clip(emoteClipId(e.id), c[0], e.loop, c[1])] : [];
  }));
}

/** The emotes written here, for the tests: an emote missing from this has its clip from elsewhere. */
export const AUTHORED_EMOTES: readonly string[] = Object.keys(CLIPS);
