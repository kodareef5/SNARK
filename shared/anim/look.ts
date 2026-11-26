// A look is the 72 bytes the character creator makes. It picks meshes, colours and bone stretches only. Hit zones,
// collision and eyes keep the common skeleton in every pose, so no look is harder to hit than another. The stretches
// that move the head are bounded instead: a drawn head stays within about 2 cm of the head shots are judged on as it
// stands, a seat puts it right on it (shared/anim/seat-fit.ts), and it never grows past HEAD_GROW. The other stretches
// are bounded too, so a limb's flesh stays within LIMB_SLACK of its capsule's radius (holdLimbs).

import { REGION_BASE, EYE_BASE, EYE_COLORS, HAIR_BASE, HAIR_COLORS, SKIN_BASE, SKIN_TONES } from "../pack/palette.ts";
import type { Pose } from "./clip.ts";
import type { Solved } from "./skeleton.ts";
import type { Rng } from "../rng.ts";
import {
  B_CHEST, B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R,
  B_NECK, B_PROP_L, B_PROP_R, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_THUMB_L, B_THUMB_R, B_TOE_L, B_TOE_R, B_UPPER_ARM_L, B_UPPER_ARM_R,
  B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES,
} from "./human.ts";

export const LOOK_BYTES = 72;
/** The bytes that shape the body: sex and the regions. A change past them never changes a bone. */
export const LOOK_BODY_BYTES = 23;
export const LOOK_SEX = 0;
export const LOOK_REGIONS = 1;
export const REGION_COUNT = 22;
export const LOOK_SKIN = 23;
export const LOOK_HAIR_COLOR = 24;
export const LOOK_EYE_COLOR = 25;
export const LOOK_HAIR = 26;
export const LOOK_BEARD = 27;
/** Reserved and zero, as are bytes 37 to 39. */
export const LOOK_SPARE = 28;
export const LOOK_BROW = 29;
/** Hair and beard length when the hair clock starts: 0 is the style as modelled, more is grown out. */
export const LOOK_HAIR_LENGTH = 30;
export const LOOK_BEARD_LENGTH = 31;
/** Age, weight and muscle, each -127..127 with 0 neutral. Saved and sent, not yet drawn. */
export const LOOK_AGE = 32;
export const LOOK_WEIGHT = 33;
export const LOOK_MUSCLE = 34;
export const LOOK_COMPLEXION = 35;
/** 0 for none, else a hair colour plus one. */
export const LOOK_HAIR_COLOR_2 = 36;
/** Bytes 37 to 39 are reserved and zero. */
export const LOOK_RESERVED = 37;
export const LOOK_FACE = 40;
/** Face modifiers, each -127..127 with 0 neutral. They move no bone. */
export const FACE_COUNT = 32;
/** Brow styles and complexion sets a look may name; the art for them comes later. */
export const BROW_STYLES = 8;
export const COMPLEXIONS = 8;

/** Mesh ids are "core:human_<sex id>/...". */
export const SEX_IDS: readonly string[] = ["m", "f"];
export const SEX_LABELS: readonly string[] = ["Male", "Female"];

/** Scales each sex's source model so that its eyes are at the survivor's eye height and it stands as tall as the skeleton. */
export const BODY_SCALES: readonly number[] = [0.953, 0.978];

/** Colour regions of a body mesh, stored as vertex colours and resolved per body from its look. */
export const REGION_SKIN = REGION_BASE;
export const REGION_CLOTH = REGION_BASE + 1;
export const REGION_EYE = REGION_BASE + 2;
export const REGION_HAIR = REGION_BASE + 3;
/** Colour regions of a worn piece's mesh. The main colour replaces the bare body's cloth. The piece's definition gives all three. */
export const REGION_MAIN = REGION_CLOTH;
export const REGION_SECOND = REGION_BASE + 4;
export const REGION_TRIM = REGION_BASE + 5;
/** Palette index of a bare body's cloth. */
const CLOTH_COLOR = 4;

export interface Style {
  readonly id: string;
  readonly label: string;
  /** False for none: nothing is made or drawn. */
  readonly drawn: boolean;
}

/**
 * In the order of their look byte, which a saved look keeps: a new style goes on the end. Each is made on the body's own
 * head by assets/source/core/humans/hair/styles.ts.
 */
export const HAIR_STYLES: readonly Style[] = [
  { id: "none", label: "Bald", drawn: false },
  { id: "buzzed", label: "Buzzed", drawn: true },
  { id: "parted", label: "Parted", drawn: true },
  { id: "long", label: "Long", drawn: true },
  { id: "buns", label: "Buns", drawn: true },
  { id: "fade", label: "Fade", drawn: true },
  { id: "coils", label: "Coils", drawn: true },
  { id: "tied", label: "Tied", drawn: true },
];
export const BEARD_STYLES: readonly Style[] = [
  { id: "none", label: "None", drawn: false },
  { id: "full", label: "Full", drawn: true },
  { id: "stubble", label: "Stubble", drawn: true },
  { id: "short", label: "Short", drawn: true },
];

const X = 1;
const Y = 2;
const Z = 4;
/** For each bone a region stretches: which axes, and by how much at full slider. */
interface Region {
  readonly label: string;
  readonly bones: readonly (readonly [bone: number, axes: number, amount: number])[];
}

const pair = (l: number, r: number, axes: number, amount: number): readonly (readonly [number, number, number])[] => [[l, axes, amount], [r, axes, amount]];

/** In the order their bytes are stored, each -127..127 for -1..1. Arms lie along X, legs and the spine along Y. */
export const REGIONS: readonly Region[] = [
  { label: "Head size", bones: [[B_HEAD, X | Y | Z, 0.12]] },
  { label: "Head width", bones: [[B_HEAD, X, 0.1]] },
  { label: "Head height", bones: [[B_HEAD, Y, 0.1]] },
  { label: "Head depth", bones: [[B_HEAD, Z, 0.1]] },
  { label: "Neck size", bones: [[B_NECK, X | Z, 0.2]] },
  { label: "Neck length", bones: [[B_NECK, Y, 0.25]] },
  { label: "Chest", bones: [[B_UPPER_CHEST, X | Z, 0.14]] },
  { label: "Shoulders", bones: pair(B_SHOULDER_L, B_SHOULDER_R, X, 0.2) },
  { label: "Arm length", bones: [...pair(B_UPPER_ARM_L, B_UPPER_ARM_R, X, 0.1), ...pair(B_LOWER_ARM_L, B_LOWER_ARM_R, X, 0.1)] },
  { label: "Upper arm", bones: pair(B_UPPER_ARM_L, B_UPPER_ARM_R, Y | Z, 0.2) },
  { label: "Lower arm", bones: pair(B_LOWER_ARM_L, B_LOWER_ARM_R, Y | Z, 0.2) },
  {
    label: "Hands",
    bones: [...pair(B_HAND_L, B_HAND_R, X | Y | Z, 0.15), ...pair(B_FINGERS_L, B_FINGERS_R, X | Y | Z, 0.15), ...pair(B_FINGERTIPS_L, B_FINGERTIPS_R, X | Y | Z, 0.15), ...pair(B_THUMB_L, B_THUMB_R, X | Y | Z, 0.15), ...pair(B_PROP_L, B_PROP_R, X | Y | Z, 0.15)],
  },
  { label: "Leg length", bones: [...pair(B_UPPER_LEG_L, B_UPPER_LEG_R, Y, 0.08), ...pair(B_LOWER_LEG_L, B_LOWER_LEG_R, Y, 0.08)] },
  { label: "Upper leg", bones: pair(B_UPPER_LEG_L, B_UPPER_LEG_R, X | Z, 0.18) },
  { label: "Lower leg", bones: pair(B_LOWER_LEG_L, B_LOWER_LEG_R, X | Z, 0.18) },
  { label: "Feet", bones: [...pair(B_FOOT_L, B_FOOT_R, X | Y | Z, 0.15), ...pair(B_TOE_L, B_TOE_R, X | Y | Z, 0.15)] },
  { label: "Hips", bones: [[B_HIPS, X | Z, 0.14]] },
  { label: "Torso width", bones: [[B_SPINE, X, 0.12], [B_CHEST, X, 0.12], [B_UPPER_CHEST, X, 0.12]] },
  { label: "Torso depth", bones: [[B_SPINE, Z, 0.14], [B_CHEST, Z, 0.14], [B_UPPER_CHEST, Z, 0.14]] },
  { label: "Torso height", bones: [[B_SPINE, Y, 0.1], [B_CHEST, Y, 0.1], [B_UPPER_CHEST, Y, 0.1]] },
  { label: "Waist", bones: [[B_SPINE, X | Z, 0.14], [B_CHEST, X | Z, 0.08]] },
  {
    label: "Build",
    bones: [
      [B_HIPS, X | Z, 0.07], [B_SPINE, X | Z, 0.07], [B_CHEST, X | Z, 0.07], [B_UPPER_CHEST, X | Z, 0.07], [B_NECK, X | Z, 0.07],
      ...pair(B_UPPER_ARM_L, B_UPPER_ARM_R, Y | Z, 0.1), ...pair(B_LOWER_ARM_L, B_LOWER_ARM_R, Y | Z, 0.1),
      ...pair(B_UPPER_LEG_L, B_UPPER_LEG_R, X | Z, 0.1), ...pair(B_LOWER_LEG_L, B_LOWER_LEG_R, X | Z, 0.1),
    ],
  },
];

export function defaultLook(out: Uint8Array = new Uint8Array(LOOK_BYTES)): Uint8Array {
  out.fill(0, 0, LOOK_BYTES);
  out[LOOK_SKIN] = 3;
  out[LOOK_HAIR_COLOR] = 3;
  out[LOOK_HAIR] = 1;
  return out;
}

/** A client may send any bytes. */
export function validLook(b: Uint8Array): boolean {
  if (b.length !== LOOK_BYTES || b[LOOK_SEX]! >= SEX_IDS.length || b[LOOK_SPARE] !== 0) return false;
  // A signed byte of 128 would be -128, one step outside the slider.
  for (let r = 0; r < REGION_COUNT; r++) if (b[LOOK_REGIONS + r] === 128) return false;
  for (let f = 0; f < FACE_COUNT; f++) if (b[LOOK_FACE + f] === 128) return false;
  if (b[LOOK_AGE] === 128 || b[LOOK_WEIGHT] === 128 || b[LOOK_MUSCLE] === 128) return false;
  for (let i = LOOK_RESERVED; i < LOOK_FACE; i++) if (b[i] !== 0) return false;
  return b[LOOK_SKIN]! < SKIN_TONES && b[LOOK_HAIR_COLOR]! < HAIR_COLORS && b[LOOK_EYE_COLOR]! < EYE_COLORS && b[LOOK_HAIR]! < HAIR_STYLES.length && b[LOOK_BEARD]! < BEARD_STYLES.length &&
    b[LOOK_BROW]! < BROW_STYLES && b[LOOK_COMPLEXION]! < COMPLEXIONS && b[LOOK_HAIR_COLOR_2]! <= HAIR_COLORS;
}

/** A signed byte in -1..1. */
function signed(v: number): number {
  return (v > 127 ? v - 256 : v) / 127;
}

function setSigned(look: Uint8Array, at: number, value: number): void {
  look[at] = Math.floor((value < -1 ? -1 : value > 1 ? 1 : value) * 127 + 0.5) & 255;
}

/** Face modifier `f`, in -1..1. */
export function faceOf(look: Uint8Array, f: number): number {
  return signed(look[LOOK_FACE + f]!);
}

export function setFace(look: Uint8Array, f: number, value: number): void {
  setSigned(look, LOOK_FACE + f, value);
}

/** In -1..1. */
export function regionOf(look: Uint8Array, r: number): number {
  return signed(look[LOOK_REGIONS + r]!);
}

export function setRegion(look: Uint8Array, r: number, value: number): void {
  setSigned(look, LOOK_REGIONS + r, value);
}

export function randomLook(rng: Rng, out: Uint8Array = new Uint8Array(LOOK_BYTES)): Uint8Array {
  out[LOOK_SEX] = rng.int(SEX_IDS.length);
  // The mean of two throws, so extremes are possible but uncommon.
  for (let r = 0; r < REGION_COUNT; r++) setRegion(out, r, (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5);
  out[LOOK_SKIN] = rng.int(SKIN_TONES);
  out[LOOK_HAIR_COLOR] = rng.int(HAIR_COLORS);
  out[LOOK_EYE_COLOR] = rng.int(EYE_COLORS);
  out[LOOK_HAIR] = rng.int(HAIR_STYLES.length);
  out[LOOK_BEARD] = rng.int(2) === 0 ? 1 + rng.int(BEARD_STYLES.length - 1) : 0;
  out[LOOK_BROW] = rng.int(BROW_STYLES);
  // A little growth past the style, often none.
  out[LOOK_HAIR_LENGTH] = Math.max(0, rng.int(96) - 32);
  out[LOOK_BEARD_LENGTH] = Math.max(0, rng.int(96) - 32);
  for (const at of [LOOK_AGE, LOOK_WEIGHT, LOOK_MUSCLE]) setSigned(out, at, (rng.range(-1, 1) + rng.range(-1, 1)) * 0.25);
  out[LOOK_COMPLEXION] = rng.int(COMPLEXIONS);
  out[LOOK_HAIR_COLOR_2] = rng.int(4) === 0 ? 1 + rng.int(HAIR_COLORS) : 0;
  out.fill(0, LOOK_RESERVED, LOOK_FACE);
  for (let f = 0; f < FACE_COUNT; f++) setFace(out, f, (rng.range(-1, 1) + rng.range(-1, 1)) * 0.2);
  return out;
}

/** Writes six palette indices, one per colour region. */
export function lookColors(look: Uint8Array, out: Uint8Array, at = 0): void {
  out[at] = SKIN_BASE + look[LOOK_SKIN]!;
  out[at + 1] = CLOTH_COLOR;
  out[at + 2] = EYE_BASE + look[LOOK_EYE_COLOR]!;
  out[at + 3] = HAIR_BASE + look[LOOK_HAIR_COLOR]!;
  out[at + 4] = 0;
  out[at + 5] = 0;
}

/** How far a drawn head's middle may sit from the hit head's, in any pose on foot, in metres. */
export const HEAD_SLACK = 0.02;
/** The most a look stretches a head along any axis. Past it a shot through the drawn head's edge would miss its zone. */
export const HEAD_GROW = 1.04;
/** The bones whose joints carry the head over the hips, hips first. */
const OVER_HIPS = [B_HIPS, B_SPINE, B_CHEST, B_UPPER_CHEST, B_NECK, B_HEAD];
const LEG_BONES = [B_UPPER_LEG_L, B_UPPER_LEG_R, B_LOWER_LEG_L, B_LOWER_LEG_R];
const HEAD_MIDDLE = [0, 1, 2].map((a) => (HUMAN.capA[B_HEAD * 3 + a]! + HUMAN.capB[B_HEAD * 3 + a]!) / 2);

/**
 * Writes `HUMAN_BONES * 3` stretch factors around 1, one per bone axis. Regions that touch the same bone multiply, and
 * each limb's are eased until its flesh stays near its capsules (holdLimbs). The body is `rest`'s rig, drawn with
 * lookJoints. Its head's middle is then off the hit body's, in any pose, by no more than its hips' joint is, plus what
 * the legs lift the hips, plus what each length over the hips and the head's middle stretch: the stretches that move
 * the head are eased back together until that is within HEAD_SLACK.
 */
export function lookScales(look: Uint8Array, out: Float32Array, rest: ArrayLike<number> = HUMAN.rest): void {
  out.fill(1, 0, HUMAN_BONES * 3);
  for (let r = 0; r < REGION_COUNT; r++) {
    const v = regionOf(look, r);
    if (v === 0) continue;
    for (const [bone, axes, amount] of REGIONS[r]!.bones) {
      const k = 1 + v * amount;
      if ((axes & X) !== 0) out[bone * 3]! *= k;
      if ((axes & Y) !== 0) out[bone * 3 + 1]! *= k;
      if ((axes & Z) !== 0) out[bone * 3 + 2]! *= k;
    }
  }
  holdLimbs(out);
  for (let a = 0; a < 3; a++) out[B_HEAD * 3 + a] = Math.min(out[B_HEAD * 3 + a]!, HEAD_GROW);
  const hips = length([0, 1, 2].map((a) => rest[B_HIPS * 3 + a]! - HUMAN.rest[B_HIPS * 3 + a]!));
  // Each term is the stretch less 1 times a length, so all ease together in proportion.
  let reach = Math.abs(lookLift(out, rest)) + length([0, 1, 2].map((a) => HEAD_MIDDLE[a]! * (out[B_HEAD * 3 + a]! - 1)));
  for (let k = 1; k < OVER_HIPS.length; k++) {
    const b = OVER_HIPS[k]!, p = OVER_HIPS[k - 1]!;
    reach += Math.abs((HUMAN.rest[b * 3 + 1]! - HUMAN.rest[p * 3 + 1]!) * (out[p * 3 + 1]! - 1));
  }
  // A rig whose own hips are already off by the slack keeps no such stretch.
  const room = HEAD_SLACK - hips, share = reach <= room ? 1 : room <= 0 ? 0 : room / reach;
  if (share === 1) return;
  for (const b of [...OVER_HIPS, ...LEG_BONES]) out[b * 3 + 1] = 1 + (out[b * 3 + 1]! - 1) * share;
  for (const a of [0, 2]) out[B_HEAD * 3 + a] = 1 + (out[B_HEAD * 3 + a]! - 1) * share;
}

/** How far a limb's flesh may move off its hit capsule, as a share of the capsule's radius, from what the look widens and how far it moves the joints. */
export const LIMB_SLACK = 0.18;
/** A joint slid along its own length moves its flesh along its capsule, so the slide counts for this much. */
const SLIDE = 0.3;
/** Each bone's hit capsule: its own, or its nearest ancestor's. */
const CAPSULE_OF = Int8Array.from({ length: HUMAN_BONES }, (_, b) => {
  let c = b;
  while (c >= 0 && HUMAN.capR[c] === 0) c = HUMAN.parent[c]!;
  return c;
});
/** The axis each bone runs along to its first child, or its parent's for a bone with none. A stretch along it moves the child and widens nothing. */
const ALONG = new Int8Array(HUMAN_BONES).fill(-1);
for (let b = 1; b < HUMAN_BONES; b++) {
  const p = HUMAN.parent[b]!;
  if (ALONG[p] !== -1) continue;
  const d = [0, 1, 2].map((a) => Math.abs(HUMAN.rest[b * 3 + a]! - HUMAN.rest[p * 3 + a]!));
  ALONG[p] = d.indexOf(Math.max(...d));
}
for (let b = 0; b < HUMAN_BONES; b++) if (ALONG[b] === -1) ALONG[b] = ALONG[HUMAN.parent[b]!]!;
/** How far each capsule reaches from its joint along each axis: the flesh a stretch on that axis widens. */
const EXTENT = Float32Array.from({ length: HUMAN_BONES * 3 }, (_, i) => Math.max(Math.abs(HUMAN.capA[i]!), Math.abs(HUMAN.capB[i]!)) + HUMAN.capR[(i / 3) | 0]!);
/** Bones eased together, the trunk first, since a limb's joints ride on it. The head is bounded by HEAD_GROW and HEAD_SLACK. */
const LIMBS: readonly (readonly number[])[] = [
  [B_HIPS, B_SPINE, B_CHEST, B_UPPER_CHEST, B_NECK],
  [B_SHOULDER_L, B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L, B_FINGERS_L, B_THUMB_L, B_PROP_L, B_FINGERTIPS_L],
  [B_SHOULDER_R, B_UPPER_ARM_R, B_LOWER_ARM_R, B_HAND_R, B_FINGERS_R, B_THUMB_R, B_PROP_R, B_FINGERTIPS_R],
  [B_UPPER_LEG_L, B_LOWER_LEG_L, B_FOOT_L, B_TOE_L],
  [B_UPPER_LEG_R, B_LOWER_LEG_R, B_FOOT_R, B_TOE_R],
];
const LIMB_OF = new Int8Array(HUMAN_BONES).fill(-1);
LIMBS.forEach((g, i) => g.forEach((b) => (LIMB_OF[b] = i)));
const PINNED = new Uint8Array(HUMAN_BONES);
for (const b of OVER_HIPS) PINNED[b] = 1;
/** Joints that carry on along their parent's length. */
const ALIGNED = new Uint8Array(HUMAN_BONES);
for (const b of [B_LOWER_ARM_L, B_HAND_L, B_FINGERS_L, B_FINGERTIPS_L, B_LOWER_ARM_R, B_HAND_R, B_FINGERS_R, B_FINGERTIPS_R, B_LOWER_LEG_L, B_FOOT_L, B_TOE_L, B_LOWER_LEG_R, B_FOOT_R, B_TOE_R]) ALIGNED[b] = 1;
const held = new Float32Array(HUMAN_BONES * 3), moved = new Float64Array(HUMAN_BONES * 3), slid = new Float64Array(HUMAN_BONES * 3), wide = new Float64Array(HUMAN_BONES);

/**
 * Whether each bone of limb `g`, its stretches eased to `share`, keeps its flesh within LIMB_SLACK of its capsule: how
 * far the look moves the bone's joint and the next one, at the hit body's rest and summed along the chain (so in any
 * pose and on either rig alike), plus how far it widens the flesh.
 */
function limbHolds(scales: Float32Array, g: number, share: number): boolean {
  for (let i = 0; i < HUMAN_BONES * 3; i++) held[i] = LIMB_OF[(i / 3) | 0] === g ? 1 + (scales[i]! - 1) * share : scales[i]!;
  moved.fill(0, 0, 3);
  slid.fill(0, 0, 3);
  for (let b = 0; b < HUMAN_BONES; b++) {
    const c = CAPSULE_OF[b]!;
    let w = 0;
    for (let a = 0; a < 3; a++) if (a !== ALONG[b]) w = Math.max(w, (held[b * 3 + a]! - 1) * EXTENT[c * 3 + a]!);
    wide[b] = w;
    if (b === 0) continue;
    const p = HUMAN.parent[b]!;
    for (let a = 0; a < 3; a++) {
      // lookJoints keeps the trunk's joints on the hit body's but for their lengths.
      const d = (PINNED[b] && a !== 1 ? 0 : HUMAN.rest[b * 3 + a]! - HUMAN.rest[p * 3 + a]!) * (held[p * 3 + a]! - 1);
      const along = ALIGNED[b] === 1 && a === ALONG[p];
      moved[b * 3 + a] = moved[p * 3 + a]! + (along ? 0 : d);
      slid[b * 3 + a] = slid[p * 3 + a]! + (along ? d : 0);
    }
  }
  for (let b = 0; b < HUMAN_BONES; b++) {
    const p = HUMAN.parent[b]!, off = norm(moved, b) + SLIDE * norm(slid, b);
    if (LIMB_OF[b] === g && off + wide[b]! > LIMB_SLACK * HUMAN.capR[CAPSULE_OF[b]!]!) return false;
    // The joint is also the end of its parent's flesh.
    if (p >= 0 && LIMB_OF[p] === g && off + wide[p]! > LIMB_SLACK * HUMAN.capR[CAPSULE_OF[p]!]!) return false;
  }
  return true;
}

/** Eases each limb's stretches together, the trunk's first, as far as limbHolds needs. */
function holdLimbs(scales: Float32Array): void {
  for (let g = 0; g < LIMBS.length; g++) {
    if (limbHolds(scales, g, 1)) continue;
    let lo = 0, hi = 1;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (limbHolds(scales, g, mid)) lo = mid;
      else hi = mid;
    }
    for (const b of LIMBS[g]!) for (let a = 0; a < 3; a++) scales[b * 3 + a] = 1 + (scales[b * 3 + a]! - 1) * lo;
  }
}

function norm(v: Float64Array, b: number): number {
  return Math.sqrt(v[b * 3]! * v[b * 3]! + v[b * 3 + 1]! * v[b * 3 + 1]! + v[b * 3 + 2]! * v[b * 3 + 2]!);
}

/** The length of a vector of three. */
function length(v: readonly number[]): number {
  return Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!);
}

/**
 * Writes to `out` the joint offsets (solve's `jointOffsets`) a body of `rest`'s rig stretched by `scales` is drawn with
 * on foot: its joints over the hips go where the hit body's are (HUMAN), stretched along their lengths only, so its
 * head stays with the hit body's however it bends; widths widen its flesh and move no joint.
 */
export function lookJoints(rest: ArrayLike<number>, scales: Float32Array | null, out: Float32Array): void {
  out.fill(0, 0, HUMAN_BONES * 3);
  for (let k = 1; k < OVER_HIPS.length; k++) {
    const b = OVER_HIPS[k]!, p = OVER_HIPS[k - 1]!;
    for (const a of [0, 1, 2]) {
      const hit = HUMAN.rest[b * 3 + a]! - HUMAN.rest[p * 3 + a]!, own = rest[b * 3 + a]! - rest[p * 3 + a]!;
      // solve stretches the offset by the parent's stretch on each axis: along the length only, here.
      out[b * 3 + a] = (a === 1 || !scales ? hit : hit / scales[p * 3 + a]!) - own;
    }
  }
}

/** Returns what the stretch adds to a straight leg, so that raising the hips by it keeps the feet on the ground. `rest` holds the rest joints. */
export function lookLift(scales: Float32Array, rest: ArrayLike<number>): number {
  const upper = rest[B_UPPER_LEG_L * 3 + 1]! - rest[B_LOWER_LEG_L * 3 + 1]!;
  const lower = rest[B_LOWER_LEG_L * 3 + 1]! - rest[B_FOOT_L * 3 + 1]!;
  return upper * (scales[B_UPPER_LEG_L * 3 + 1]! - 1) + lower * (scales[B_LOWER_LEG_L * 3 + 1]! - 1);
}

/** The lower ankle stays at the height its bent leg would reach without its length slider. */
export function plantLookFeet(pose: Pose, solved: Solved, scales: Float32Array, rest: Float32Array): void {
  const left = solved.pos[B_FOOT_L * 3 + 1]! <= solved.pos[B_FOOT_R * 3 + 1]!;
  const upper = left ? B_UPPER_LEG_L : B_UPPER_LEG_R, lower = left ? B_LOWER_LEG_L : B_LOWER_LEG_R;
  const foot = left ? B_FOOT_L : B_FOOT_R;
  let lift = 0;
  for (let i = 0; i < 2; i++) {
    const bone = i === 0 ? upper : lower, end = i === 0 ? lower : foot;
    const x = solved.rot[bone * 4]!, z = solved.rot[bone * 4 + 2]!;
    const extra = (rest[bone * 3 + 1]! - rest[end * 3 + 1]!) * (scales[bone * 3 + 1]! - 1);
    lift += extra * (1 - 2 * (x * x + z * z));
  }
  if (!lift) return;
  pose.root[1]! += lift;
  for (let i = 1; i < solved.pos.length; i += 3) solved.pos[i]! += lift;
}
