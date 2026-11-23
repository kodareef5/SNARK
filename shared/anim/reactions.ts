// How a standing survivor reels from a shove: a reaction word, sent with the body, says what struck it, from where and
// when, and every machine lays the same curve over whatever the body is doing. Each curve is the ragdoll solver's own
// answer, baked ahead of time (shared/anim/reaction-bake.ts) and packed into shared/anim/reaction-curves.ts. Every
// machine decodes the same numbers from that file, so a shot is judged against the pose that is drawn, and no solver
// runs while a frame is drawn or a tick judged.

import { detCos, detSin } from "../math/scalar.ts";
import { REACT_FRAMES, reactClass } from "../sim/react.ts";
import type { Pose } from "./clip.ts";
import { B_HEAD, B_HIPS, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_RAGDOLL } from "./human.ts";

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

/** The ragdoll bodies a curve turns: the chest, the head, the left arm's two and the right arm's two. */
export const TURNED: readonly number[] = [1, 2, 3, 4, 5, 6];
/** Ways 0 to 8 are packed. A way past 8 is the mirror of 16 less it: the arms trade sides and every turn is mirrored. */
const KEPT_DIRS = REACT_DIRS / 2 + 1;
/** The packed body a mirrored curve takes each of its bodies from. */
const MIRROR = [0, 1, 4, 5, 2, 3];
/** A packed number is a quaternion's x, y or z times this, rounded. */
export const CURVE_SCALE = 32767;
/** The packed text's digits, as URL-safe base64 has them. */
export const CURVE_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DIGIT = new Uint8Array(128);
for (let i = 0; i < 64; i++) DIGIT[CURVE_DIGITS.charCodeAt(i)] = i;

/** The words whose curves are packed, at start 0, in the packed text's order: by class, way, height and strength. */
export function keptCurves(): number[] {
  const out: number[] = [];
  for (const kind of [REACT_STAGGER, REACT_HEAVY]) for (let dir = 0; dir < KEPT_DIRS; dir++) for (let height = 0; height < 4; height++) for (let strength = 0; strength < 4; strength++) out.push(packReact(kind, 0, dir, height, strength));
  return out;
}

/** The packed numbers once held, a frame's turned bodies' x, y and z at a time, and where each kept curve starts. */
let kept: Int16Array | null = null;
const starts = new Map<number, number>();
const curves = new Map<number, Float64Array>();

/**
 * Decodes and holds the packed curves (shared/anim/reaction-curves.ts). Each kept word's curve follows the one before.
 * A curve is its turned bodies' x, y and z in turn, each a run over its frames. The text holds each number less twice
 * the one before it plus the one before that (0 before the first), zigzagged to be positive, in five-bit digits; a
 * sixth bit marks every digit of a number but its last.
 */
export function holdReactCurves(packed: string): void {
  const words = keptCurves(), n = TURNED.length * 3;
  let total = 0;
  for (const word of words) total += reactFrames(word) * n;
  const out = new Int16Array(total);
  starts.clear();
  curves.clear();
  let at = 0, o = 0;
  for (const word of words) {
    starts.set(word, o);
    const frames = reactFrames(word);
    for (let run = 0; run < n; run++) {
      let a = 0, b = 0;
      for (let f = 0; f < frames; f++) {
        let z = 0, shift = 0, digit = 0;
        do {
          digit = DIGIT[packed.charCodeAt(at++)]!;
          z |= (digit & 31) << shift;
          shift += 5;
        } while (digit & 32);
        const v = ((z >>> 1) ^ -(z & 1)) + 2 * a - b;
        out[o + f * n + run] = v;
        b = a;
        a = v;
      }
    }
    o += frames * n;
  }
  if (at !== packed.length) throw new Error(`the packed reaction curves are ${packed.length} characters, but their curves end at ${at}`);
  kept = out;
}

/**
 * The curve for `word`, frames by turned bodies by a quaternion each: every turned body's turn against its parent, as a
 * turn from where the standing pose has it. Decoded once a word, without its start. None until the curves are held.
 */
export function reactCurve(word: number): Float64Array | null {
  const kind = reactKind(word);
  if (kind === REACT_NONE || kind === REACT_FALL || kind >= REACT_FRAMES.length || !kept) return null;
  const key = word & ~(255 << START_SHIFT);
  const known = curves.get(key);
  if (known) return known;
  const dir = reactDir(word), mirrored = dir >= KEPT_DIRS;
  const from = starts.get(mirrored ? (key & ~(15 << DIR_SHIFT)) | ((REACT_DIRS - dir) << DIR_SHIFT) : key)!;
  const frames = REACT_FRAMES[kind]!, n = TURNED.length, curve = new Float64Array(frames * n * 4);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < n; k++) {
      const i = from + (f * n + (mirrored ? MIRROR[k]! : k)) * 3, o = (f * n + k) * 4;
      const x = kept[i]! / CURVE_SCALE, y = kept[i + 1]! / CURVE_SCALE, z = kept[i + 2]! / CURVE_SCALE;
      // Mirrored across the body's middle, where x is its left: x stays, y and z change sign.
      curve[o] = x;
      curve[o + 1] = mirrored ? -y : y;
      curve[o + 2] = mirrored ? -z : z;
      curve[o + 3] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    }
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
/** How far down a topple has a body `age` ticks in: 0 standing, 1 lying. */
function toppleShare(age: number): number {
  return age < TOPPLE ? smooth(age / TOPPLE) : age < RISE ? 1 : 1 - smooth((age - RISE) / (REACT_FRAMES[REACT_FALL]! - RISE));
}

/** An age at which a topple lies all the way down. */
export const TOPPLED = (TOPPLE + RISE) / 2;

/** The way, 0 to 15, a body toppling by reaction `word` lies at `tick` while it is more than half down; -1 otherwise. */
export function lyingWay(word: number, tick: number): number {
  if (reactKind(word) !== REACT_FALL) return -1;
  return toppleShare(reactAge(word, tick)) >= 0.5 ? reactDir(word) : -1;
}

function topple(pose: Pose, word: number, age: number): void {
  const k = toppleShare(age);
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
