// How a standing survivor reels from a shove: a reaction word, sent with the body, says what struck it, from where and
// when, and every machine lays the same curve over whatever the body is doing. Each curve is the ragdoll solver's own
// answer, baked ahead of time (shared/anim/reaction-bake.ts) and packed into shared/anim/reaction-curves.ts. Every
// machine decodes the same numbers from that file, so a shot is judged against the pose that is drawn, and no solver
// runs while a frame is drawn or a tick judged.

import { detAtan2, detCos, detSin } from "../math/scalar.ts";
import { REACT_FRAMES, reactClass } from "../sim/react.ts";
import type { Pose } from "./clip.ts";
import { B_HEAD, B_HIPS, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_RAGDOLL } from "./human.ts";

// The word, REACT_BITS long (shared/anim/pose.ts): its class, the low byte of its first tick, the way the body is pushed,
// the height struck and how hard. A body toppled (REACT_FALL) or getting up from a ragdoll's fall (REACT_RISE) keeps
// instead how it lies (packLie): the sixteenth its head lies nearest in the way, whether it lies face up in the height's
// low bit, how far its head lies from that sixteenth in the height's high bit and the strength, the facing it had as it
// went down or began to get up in the next byte, and in the top four bits the quarter turns it has turned since, which
// the server keeps up to date (withTurn) so a turn through the way opposite never flips which way round it goes.
export const REACT_NONE = 0;
/** Knocked off balance: a shove and a short loss of control. */
export const REACT_STAGGER = 1;
/** Knocked badly off balance: a bigger shove and a longer loss of control. */
export const REACT_HEAVY = 2;
/** Knocked down where no ragdoll may fall: it topples, lies a while and gets up, posed from the word alone. */
export const REACT_FALL = 3;
/** Getting up from a fall it lay in as a ragdoll: from lying as its ragdoll lay to standing, posed from the word alone. */
export const REACT_RISE = 4;
/** A living creature follows its physical checkpoint until its species' get-up cue begins. */
export const REACT_CREATURE_DOWN = 5;
const START_SHIFT = 3;
const DIR_SHIFT = 11;
const HEIGHT_SHIFT = 15;
const STRENGTH_SHIFT = 17;
const FACING_SHIFT = 19;
const TURN_SHIFT = 27;
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
  return ((kind & 7) | ((start & 255) << START_SHIFT) | ((dir & 15) << DIR_SHIFT) | ((height & 3) << HEIGHT_SHIFT) | ((strength & 3) << STRENGTH_SHIFT)) >>> 0;
}

/** The ways a body may lie, its head that many to a turn: eight to each of REACT_DIRS. */
export const LIE_WAYS = REACT_DIRS * 8;
/** A facing a body lies against, that many to a turn. */
export const LIE_FACINGS = 256;

/**
 * The word of a body laid down from tick `start` by a topple or a rise (`kind`), face `up` or down, its head `way`
 * (LIE_WAYS to a turn) from `facing` (LIE_FACINGS to a turn), the facing it had then.
 */
export function packLie(kind: number, start: number, up: boolean, way: number, facing: number): number {
  const w = ((way % LIE_WAYS) + LIE_WAYS) % LIE_WAYS, dir = Math.round(w / 8) % REACT_DIRS;
  let off = w - dir * 8;
  if (off > LIE_WAYS / 2) off -= LIE_WAYS;
  return (packReact(kind, start, dir, (up ? 1 : 0) | (((off + 4) & 1) << 1), (off + 4) >> 1) | ((facing & 255) << FACING_SHIFT)) >>> 0;
}

/** The facing, LIE_FACINGS to a turn, of a body whose yaw is `yaw` (65536 to a turn). */
export const facingOf = (yaw: number): number => Math.round(yaw / 256) & (LIE_FACINGS - 1);

/** The way, LIE_WAYS to a turn, the unit (dx, dz) lies from `facing` (LIE_FACINGS to a turn). */
export function wayFrom(facing: number, dx: number, dz: number): number {
  const turn = detAtan2(dx, dz) / (2 * Math.PI) - facing / LIE_FACINGS;
  return ((Math.round(turn * LIE_WAYS) % LIE_WAYS) + LIE_WAYS) % LIE_WAYS;
}

/** The way a body laid down by `word` lies (packLie), its head LIE_WAYS to a turn from the facing it lies against. */
export function lieWay(word: number): number {
  const off = ((reactHeight(word) >> 1) | (reactStrength(word) << 1)) - 4;
  return (reactDir(word) * 8 + off + LIE_WAYS) % LIE_WAYS;
}

/** Whether a body laid down by `word` lies face up. */
export const lieUp = (word: number): boolean => (reactHeight(word) & 1) === 1;

/**
 * Radians a body laid down by `word`, facing `facing` (a share of a turn) now, lies turned from the sixteenth its head
 * lies nearest: the rest of its way, and the facing it lies against from its own. 0 for any other reaction, and NaN
 * `facing` leaves out the facing.
 */
export function lyingOff(word: number, facing: number): number {
  const kind = reactKind(word);
  if (kind !== REACT_FALL && kind !== REACT_RISE) return 0;
  const off = ((reactHeight(word) >> 1) | (reactStrength(word) << 1)) - 4;
  return (off / LIE_WAYS) * 2 * Math.PI + (facing === facing ? turnFrom(word, facing) : 0);
}

/** Quarter turns a body laid down by `word` has turned since, -8 to 7, as the server last kept them (withTurn). */
const lieTurns = (word: number): number => (((word >>> TURN_SHIFT) & 15) << 28) >> 28;

/**
 * Radians from facing `facing` (a share of a turn) to the facing a body laid down by `word` lies against: the way round
 * nearest the quarter turns the word keeps, so it goes on round the way it has been going.
 */
function turnFrom(word: number, facing: number): number {
  const d = ((word >>> FACING_SHIFT) & (LIE_FACINGS - 1)) / LIE_FACINGS - facing, near = -lieTurns(word) / 4;
  return (d - Math.round(d - near)) * 2 * Math.PI;
}

/**
 * Word `word` with the quarter turns a body laid down by it has turned since kept up to date for its facing now,
 * `facing` (a share of a turn): the same word for any other reaction, or while they have not changed.
 */
export function withTurn(word: number, facing: number): number {
  const kind = reactKind(word);
  if (kind !== REACT_FALL && kind !== REACT_RISE) return word;
  const turns = Math.max(-8, Math.min(7, Math.round((-turnFrom(word, facing) / (2 * Math.PI)) * 4)));
  return ((word & ~(15 << TURN_SHIFT)) | ((turns & 15) << TURN_SHIFT)) >>> 0;
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

/**
 * Ticks since the reaction began, from the low byte of its start; at or past its frames when it is over. A tick a moment
 * before its start, which a watcher may draw a word at, counts as its start: no reaction lasts long enough to be mistaken.
 */
export function reactAge(word: number, tick: number): number {
  const whole = Math.floor(tick), age = ((whole - reactStart(word)) & 255) + (tick - whole);
  return age > EARLY ? 0 : age;
}
/** Ages past which a tick is taken to come before a reaction's start. */
const EARLY = 250;

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
  if (kind !== REACT_STAGGER && kind !== REACT_HEAVY || !kept) return null;
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
 * `twist` is how far the body's hips turn toward where it travels when it stands, radians (shared/anim/pose.ts humanPose),
 * and `facing` the share of a turn it faces now, or NaN.
 */
export function react(pose: Pose, word: number, tick: number, twist = 0, facing = Number.NaN): void {
  if (word === 0) return;
  const age = reactAge(word, tick), frames = reactFrames(word);
  if (!(age >= 0) || age >= frames) return;
  const kind = reactKind(word);
  if (kind === REACT_FALL || kind === REACT_RISE) {
    const k = kind === REACT_FALL ? toppleShare(age) : riseShare(age);
    if (k <= 0) return;
    lieTurn(lieUp(word), lieWay(word) / LIE_WAYS, reactDir(word) / REACT_DIRS);
    lie(pose, k, twist);
    // It lies against the facing it had as it went down or began to get up, so turning then does not turn it on the
    // ground, and it turns to its facing as it stands.
    if (facing === facing) turnAbout(pose, k * turnFrom(word, facing));
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

// A body knocked down where no ragdoll may fall (REACT_FALL) tips over the way it was pushed, its head that way, lies
// there, and gets up again. One getting up from a ragdoll's fall (REACT_RISE) starts lying as the ragdoll lay, face up or
// down with its head its way, and stands as it is posed over REACT_FRAMES[REACT_RISE] ticks.

/** Ticks a cheap fall takes to go down, and the tick it starts to get up. */
const TOPPLE = 10;
const RISE = 60;
const lying = new Float64Array(HUMAN.bones * 4);
const tilt = new Float64Array(4);
/** The hips' turn lying the nearest sixteenth `tilt`'s way, which decides which way round the hips go. */
const toward = new Float64Array(4);

/** How far down a topple has a body `age` ticks in: 0 standing, 1 lying. */
function toppleShare(age: number): number {
  return age < TOPPLE ? smooth(age / TOPPLE) : age < RISE ? 1 : 1 - smooth((age - RISE) / (REACT_FRAMES[REACT_FALL]! - RISE));
}

/** How far down a body getting up from a ragdoll's fall still is `age` ticks in: 1 lying, 0 standing. */
function riseShare(age: number): number {
  return 1 - smooth(age / REACT_FRAMES[REACT_RISE]!);
}

/** An age at which a topple lies all the way down. */
export const TOPPLED = (TOPPLE + RISE) / 2;

/** How far down reaction `word` lays a body at `tick`: 1 lying, 0 standing, and 0 for any other reaction. */
export function lyingShare(word: number, tick: number): number {
  const kind = reactKind(word);
  if (kind !== REACT_FALL && kind !== REACT_RISE) return 0;
  const age = reactAge(word, tick);
  if (!(age >= 0) || !(age < reactFrames(word))) return 0;
  return kind === REACT_FALL ? toppleShare(age) : riseShare(age);
}

/**
 * Whether a body toppled the way `d` (sixteenths of a turn from its facing) lands face up: pushed more back than forward,
 * so its hips turn the least to lie. Straight to a side it lands face down.
 */
export function toppleUp(d: number): boolean {
  return d >= 5 && d <= 11;
}

/**
 * How a body down by reaction `word` lies at `tick`, as the one-bone pose it may be drawn in (shared by every body that
 * lies so): face up (1) or down (0), times REACT_DIRS, plus the way its head lies, times LIE_STEPS + 1, plus how far
 * down it is in LIE_STEPS steps. -1 for a body standing, or near enough.
 */
export function lyingStep(word: number, tick: number): number {
  const kind = reactKind(word);
  if (kind !== REACT_FALL && kind !== REACT_RISE) return -1;
  const age = reactAge(word, tick), k = kind === REACT_FALL ? toppleShare(age) : riseShare(age), step = Math.round(k * LIE_STEPS);
  if (!(age < reactFrames(word)) || step <= 0) return -1;
  return ((lieUp(word) ? 1 : 0) * REACT_DIRS + reactDir(word)) * (LIE_STEPS + 1) + step;
}
/** Steps between standing and lying that bodies drawn on one bone are shown in. */
export const LIE_STEPS = 12;

/** How far down `step` (lyingStep) lays a body: 1 lying, 0 standing. */
export function stepShare(step: number): number {
  return (step % (LIE_STEPS + 1)) / LIE_STEPS;
}

/** Lays standing pose `pose`, whose hips turn `twist` toward its travel standing, toward lying as `lyingStep` says. */
export function lieStep(pose: Pose, step: number, twist = 0): void {
  const at = Math.floor(step / (LIE_STEPS + 1));
  lieTurn(at >= REACT_DIRS, (at % REACT_DIRS) / REACT_DIRS);
  lie(pose, stepShare(step), twist);
}

/**
 * The hips' turn of a body lying `up` (face up) or down with its head the way `way` (a share of a turn from its facing),
 * into `tilt`, and lying the way `near` into `toward`.
 */
function lieTurn(up: boolean, way: number, near = way): void {
  hipsLying(up, way, tilt);
  hipsLying(up, near, toward);
}

/** The hips' turn of a body lying `up` or down its head the way `way`: a quarter turn about its side, then about up. */
function hipsLying(up: boolean, way: number, out: Float64Array): void {
  const head = way * 2 * Math.PI, face = up ? head + Math.PI : head, pitch = up ? -Math.PI / 4 : Math.PI / 4;
  const sp = detSin(pitch), cp = detCos(pitch), sy = detSin(face / 2), cy = detCos(face / 2);
  // turn about +Y by `face`, times turn about +X by twice `pitch`
  out[0] = cy * sp; out[1] = sy * cp; out[2] = -sy * sp; out[3] = cy * cp;
}

/**
 * Lays `pose` toward lying as `tilt` turns the hips, `k` of the way: arms at its sides, hips sunk to the ground. Its hips,
 * which standing turn `twist` toward its travel, go the shorter way round from there to `toward`: the way they go is
 * decided by the reaction's nearest sixteenth and the body's state, never by a gait's sway or the finer way, and every
 * machine and every shared pose lays a body over the same way.
 */
function lie(pose: Pose, k: number, twist: number): void {
  lying.fill(0);
  for (let b = 0; b < HUMAN.bones; b++) lying[b * 4 + 3] = 1;
  lying.set(tilt, B_HIPS * 4);
  const arm = detSin(0.65), armW = detCos(0.65);
  lying[B_UPPER_ARM_L * 4 + 2] = -arm; lying[B_UPPER_ARM_L * 4 + 3] = armW;
  lying[B_UPPER_ARM_R * 4 + 2] = arm; lying[B_UPPER_ARM_R * 4 + 3] = armW;
  const rot = pose.rot, ry = detSin(twist / 2), rw = detCos(twist / 2);
  for (let b = 0; b < HUMAN.bones; b++) {
    const o = b * 4;
    let s0 = 1, s = 1;
    if (b === B_HIPS) {
      // The hips are near the turn about up by `twist`; which way round they go is that turn's.
      s0 = rot[o + 1]! * ry + rot[o + 3]! * rw < 0 ? -1 : 1;
      s = (toward[1]! * ry + toward[3]! * rw < 0 ? -1 : 1) * (toward[0]! * lying[o]! + toward[1]! * lying[o + 1]! + toward[2]! * lying[o + 2]! + toward[3]! * lying[o + 3]! < 0 ? -1 : 1);
    } else s = rot[o]! * lying[o]! + rot[o + 1]! * lying[o + 1]! + rot[o + 2]! * lying[o + 2]! + rot[o + 3]! * lying[o + 3]! < 0 ? -1 : 1;
    let l = 0;
    for (let c = 0; c < 4; c++) {
      const from = rot[o + c]! * s0, v = from + (lying[o + c]! * s - from) * k;
      turn[c] = v;
      l += v * v;
    }
    l = 1 / Math.sqrt(l);
    for (let c = 0; c < 4; c++) rot[o + c] = turn[c]! * l;
  }
  // Lying, its hips are on its place: where a fall's ragdoll had them, for one getting up (server/falls.ts rise).
  const root = pose.root, rest = HUMAN.rest, down = LYING_HIPS - rest[B_HIPS * 3 + 1]!;
  root[0] = root[0]! + (-rest[B_HIPS * 3]! - root[0]!) * k;
  root[1] = root[1]! + (down - root[1]!) * k;
  root[2] = root[2]! + (-rest[B_HIPS * 3 + 2]! - root[2]!) * k;
}

/** Turns `pose` about up through its place by `angle` radians: its hips, and where they are. */
function turnAbout(pose: Pose, angle: number): void {
  if (angle === 0) return;
  const s = detSin(angle / 2), c = detCos(angle / 2), rot = pose.rot, o = B_HIPS * 4;
  const x = rot[o]!, y = rot[o + 1]!, z = rot[o + 2]!, w = rot[o + 3]!;
  rot[o] = c * x + s * z; rot[o + 1] = c * y + s * w; rot[o + 2] = c * z - s * x; rot[o + 3] = c * w - s * y;
  const rest = HUMAN.rest, root = pose.root, sa = detSin(angle), ca = detCos(angle);
  const hx = rest[B_HIPS * 3]! + root[0]!, hz = rest[B_HIPS * 3 + 2]! + root[2]!;
  root[0] = ca * hx + sa * hz - rest[B_HIPS * 3]!;
  root[2] = ca * hz - sa * hx - rest[B_HIPS * 3 + 2]!;
}

/** Metres the hips' joint lies above the ground, as a laid body's does (shared/anim/human-fall.ts). */
const LYING_HIPS = 0.13;

function smooth(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}
