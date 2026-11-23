// How a standing survivor reels from a shove: a reaction word, sent with the body, says what struck it, from where and
// when, and every machine lays the same curve over whatever the body is doing. Each curve is the ragdoll solver's own
// answer (shared/anim/ragdoll.ts): a body standing still with its hips and legs anchored and the rest driven back toward
// standing, struck once. It is worked out the first time it is needed, the same on the server and every client, so a
// shot is judged against the pose that is drawn.

import { detCos, detSin } from "../math/scalar.ts";
import { REACT_FRAMES, reactClass } from "../sim/react.ts";
import type { Pose } from "./clip.ts";
import { B_HEAD, B_HIPS, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_RAGDOLL } from "./human.ts";
import { standingPose } from "./human-fall.ts";
import { Ragdoll } from "./ragdoll.ts";
import { Heightfield } from "../world/heightfield.ts";
import { StructureStore } from "../world/structures.ts";
import type { CollisionWorld } from "../world/collide.ts";

// The word, REACT_BITS long (shared/anim/pose.ts): its class, the low byte of its first tick, the way the body is pushed,
// the height struck and how hard.
export const REACT_NONE = 0;
/** Knocked off balance: a shove and a short loss of control. */
export const REACT_STAGGER = 1;
/** Knocked badly off balance: a bigger shove and a longer loss of control. */
export const REACT_HEAVY = 2;
/** Knocked down where no ragdoll may fall: it topples, lies a while and gets up, posed from the word alone. */
export const REACT_FALL = 3;
const START_SHIFT = 2;
const DIR_SHIFT = 10;
const HEIGHT_SHIFT = 14;
const STRENGTH_SHIFT = 16;
/** Sixteenths of a turn, as a body's travel direction is counted: 0 straight ahead, 4 toward its left. */
export const REACT_DIRS = 16;
/** Where it was struck: about the legs, the hips, the chest, the head. */
export const REACT_LOW = 0;
export const REACT_HIPS = 1;
export const REACT_CHEST = 2;
export const REACT_HEAD = 3;

/** The whole body's change of speed, in metres a second, for each strength. */
const STRENGTHS = [0.6, 1, 1.5, 2.2];
/** Each class's drives: how fast the body springs back, and how little it overshoots. */
const OMEGA = [0, 12, 9];
const ZETA = [0, 0.6, 0.5];
/** The share of a curve's last frames over which it fades out, so it ends on nothing. */
const FADE = 4;

export function packReact(kind: number, start: number, dir: number, height: number, strength: number): number {
  if (kind === REACT_NONE) return 0;
  return ((kind & 3) | ((start & 255) << START_SHIFT) | ((dir & 15) << DIR_SHIFT) | ((height & 3) << HEIGHT_SHIFT) | ((strength & 3) << STRENGTH_SHIFT)) >>> 0;
}

export const reactKind = reactClass;
export const reactStart = (word: number): number => (word >>> START_SHIFT) & 255;
export const reactDir = (word: number): number => (word >>> DIR_SHIFT) & 15;
export const reactHeight = (word: number): number => (word >>> HEIGHT_SHIFT) & 3;
export const reactStrength = (word: number): number => (word >>> STRENGTH_SHIFT) & 3;

/** How many ticks a reaction of this word lasts. */
export function reactFrames(word: number): number {
  return REACT_FRAMES[reactKind(word)] ?? 0;
}

/** Ticks since the reaction began, from the low byte of its start; at or past its frames when it is over. */
export function reactAge(word: number, tick: number): number {
  const whole = Math.floor(tick);
  return ((whole - reactStart(word)) & 255) + (tick - whole);
}

/** The bodies a curve turns: the chest, the head and the arms. Each turns against its parent body in the ragdoll. */
const TURNED = [1, 2, 3, 4, 5, 6];
const curves = new Map<number, Float64Array>();
let still: CollisionWorld | null = null;

/** Ground far below, so a curve's body meets nothing. */
function nowhere(): CollisionWorld {
  if (still) return still;
  const dims = { chunksX: 1, chunksZ: 1 };
  const hf = new Heightfield(dims, 64, -1000, 1);
  still = { hf, structs: new StructureStore(dims, new Float32Array(0), new Float32Array(0), new Float32Array(0)) };
  return still;
}

/**
 * The curve for `word`, frames by turned bodies by a quaternion each: every turned body's turn against its parent, as a
 * turn from where the standing pose has it. Worked out once a word, without its start.
 */
export function reactCurve(word: number): Float64Array | null {
  const kind = reactKind(word);
  if (kind === REACT_NONE || kind === REACT_FALL || kind >= REACT_FRAMES.length) return null;
  const key = word & ~(255 << START_SHIFT);
  const known = curves.get(key);
  if (known) return known;
  const frames = REACT_FRAMES[kind]!, stand = standingPose(), world = nowhere();
  const r = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  r.start(stand, stand, 32, 0, 32, 0, 1);
  for (const i of [0, 7, 8, 9, 10]) r.anchor(i, true);
  for (const i of TURNED) { r.driveOmega[i] = OMEGA[kind]!; r.driveZeta[i] = ZETA[kind]!; }
  r.lift = 1;
  // Pushed toward `dir`: a blow high on the body throws what it hits that way, one low on it moves the hips and leaves
  // the chest behind.
  const angle = (reactDir(word) / REACT_DIRS) * 2 * Math.PI, dv = STRENGTHS[reactStrength(word)]!;
  const height = reactHeight(word), toward = height >= REACT_CHEST ? 1 : -0.7;
  const dx = detSin(angle) * dv * toward, dz = detCos(angle) * dv * toward;
  r.strike(height === REACT_HEAD ? 2 : 1, dx, height === REACT_HEAD ? 0 : -0.15 * dv, dz);
  const curve = new Float64Array(frames * TURNED.length * 4);
  for (let f = 0; f < frames; f++) {
    r.follow(stand, 32, 0, 32, 0);
    r.step(world, 1 / 30);
    for (let k = 0; k < TURNED.length; k++) r.offset(TURNED[k]!, curve, (f * TURNED.length + k) * 4);
  }
  curves.set(key, curve);
  return curve;
}

const turn = new Float64Array(4);

/**
 * Lays the reaction `word` over `pose` at `tick`: each turned body's bone turned further by the curve, between its frames
 * where the tick falls between them, and faded out over its last frames. Nothing where there is no reaction or it is over.
 */
export function react(pose: Pose, word: number, tick: number): void {
  if (word === 0) return;
  const age = reactAge(word, tick), frames = reactFrames(word);
  if (!(age >= 0) || age >= frames) return;
  if (reactKind(word) === REACT_FALL) {
    topple(pose, word, age);
    return;
  }
  const curve = reactCurve(word);
  if (!curve) return;
  // Frame 0 is the body one tick after the blow; before it the body turns in from standing.
  const at = age - 1, f0 = at < 0 ? -1 : Math.floor(at), share = at < 0 ? age : at - f0;
  const fade = frames - age < FADE ? (frames - age) / FADE : 1;
  const n = TURNED.length;
  for (let k = 0; k < n; k++) {
    const b = HUMAN_RAGDOLL.bone[TURNED[k]!]!;
    const a = (f0 < 0 ? -1 : (f0 * n + k) * 4), c = ((f0 + 1 < frames ? f0 + 1 : frames - 1) * n + k) * 4;
    // Blend from the earlier frame (or none) to the later one, then toward none by the fade.
    let x = 0, y = 0, z = 0, w = 1;
    if (a >= 0) { x = curve[a]!; y = curve[a + 1]!; z = curve[a + 2]!; w = curve[a + 3]!; }
    const dot = x * curve[c]! + y * curve[c + 1]! + z * curve[c + 2]! + w * curve[c + 3]!, s = dot < 0 ? -1 : 1;
    x += (curve[c]! * s - x) * share; y += (curve[c + 1]! * s - y) * share;
    z += (curve[c + 2]! * s - z) * share; w += (curve[c + 3]! * s - w) * share;
    x *= fade; y *= fade; z *= fade; w = w * fade + (1 - fade);
    const l = Math.sqrt(x * x + y * y + z * z + w * w);
    turn[0] = x / l; turn[1] = y / l; turn[2] = z / l; turn[3] = w / l;
    // A body's turn against its parent changes by the curve's turn on its own side: the bone's own turn times it.
    const o = b * 4, rot = pose.rot;
    const ax = rot[o]!, ay = rot[o + 1]!, az = rot[o + 2]!, aw = rot[o + 3]!;
    const bx = turn[0]!, by = turn[1]!, bz = turn[2]!, bw = turn[3]!;
    rot[o] = aw * bx + ax * bw + ay * bz - az * by;
    rot[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
    rot[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
    rot[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
  }
}

/** The height band a point `up` metres above a standing survivor's feet falls in. */
export function reactBand(up: number): number {
  const head = HUMAN.rest[B_HEAD * 3 + 1]!;
  return up >= head ? REACT_HEAD : up >= head * 0.72 ? REACT_CHEST : up >= head * 0.5 ? REACT_HIPS : REACT_LOW;
}

/** Ticks a cheap fall takes to go down, and the tick it starts to get up. */
const TOPPLE = 10;
const RISE = 60;
const lying = new Float64Array(HUMAN.bones * 4);
const tilt = new Float64Array(4);

/**
 * A body knocked down where no ragdoll may fall (REACT_FALL): it tips over the way it was pushed, face down when pushed
 * forward or to a side and face up when pushed back, arms at its sides, lies there, and gets up again.
 */
function topple(pose: Pose, word: number, age: number): void {
  const k = age < TOPPLE ? smooth(age / TOPPLE) : age < RISE ? 1 : 1 - smooth((age - RISE) / (REACT_FRAMES[REACT_FALL]! - RISE));
  if (k <= 0) return;
  const d = reactDir(word), back = d >= 6 && d <= 10;
  // Lying is a quarter turn of the hips about the body's side, forward or back, then turned to the way it fell.
  const face = ((back ? d - 8 : d) / REACT_DIRS) * 2 * Math.PI, pitch = back ? -Math.PI / 4 : Math.PI / 4;
  const sp = detSin(pitch), cp = detCos(pitch), sy = detSin(face / 2), cy = detCos(face / 2);
  // turn about +Y by `face`, times turn about +X by `pitch`
  tilt[0] = cy * sp; tilt[1] = sy * cp; tilt[2] = -sy * sp; tilt[3] = cy * cp;
  lying.fill(0);
  for (let b = 0; b < HUMAN.bones; b++) lying[b * 4 + 3] = 1;
  lying.set(tilt, B_HIPS * 4);
  const arm = detSin(0.65), armW = detCos(0.65);
  lying[B_UPPER_ARM_L * 4 + 2] = -arm; lying[B_UPPER_ARM_L * 4 + 3] = armW;
  lying[B_UPPER_ARM_R * 4 + 2] = arm; lying[B_UPPER_ARM_R * 4 + 3] = armW;
  const rot = pose.rot;
  for (let b = 0; b < HUMAN.bones; b++) {
    const o = b * 4;
    const dot = rot[o]! * lying[o]! + rot[o + 1]! * lying[o + 1]! + rot[o + 2]! * lying[o + 2]! + rot[o + 3]! * lying[o + 3]!, s = dot < 0 ? -1 : 1;
    let l = 0;
    for (let c = 0; c < 4; c++) {
      const v = rot[o + c]! + (lying[o + c]! * s - rot[o + c]!) * k;
      turn[c] = v;
      l += v * v;
    }
    l = 1 / Math.sqrt(l);
    for (let c = 0; c < 4; c++) rot[o + c] = turn[c]! * l;
  }
  // Its hips sink to lie on the ground.
  const down = LYING_HIPS - HUMAN.rest[B_HIPS * 3 + 1]!;
  pose.root[1] = pose.root[1]! + (down - pose.root[1]!) * k;
}

/** Metres the hips' joint lies above the ground, as a laid body's does (shared/anim/human-fall.ts). */
const LYING_HIPS = 0.13;

function smooth(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}
