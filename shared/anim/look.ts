// A survivor's look: what the character creator makes.
//
// Twenty-eight bytes: sex, twenty-two body regions, three colours, hair and
// beard. It decides which meshes are drawn, in which colours, and how each bone
// is stretched. It changes nothing else: hit zones, collision and the eye are
// those of the skeleton, the same for every survivor, so no look is an
// advantage.
//
//   0       sex: 0 or 1
//   1..22   body regions, each -127..127 for -1..1
//   23      skin tone, 24 hair colour, 25 eye colour (indices into the palette's lists)
//   26      hair style, 27 beard style
//
// A region stretches named bones along their own axes. Because every bone
// rests aligned with the model's axes, that is a stretch along or across the
// limb and never a shear.

import { REGION_BASE, EYE_BASE, EYE_COLORS, HAIR_BASE, HAIR_COLORS, SKIN_BASE, SKIN_TONES } from "../pack/palette.ts";
import type { Rng } from "../rng.ts";
import {
  B_CHEST, B_FINGERS_L, B_FINGERS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R,
  B_NECK, B_PROP_L, B_PROP_R, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_THUMB_L, B_THUMB_R, B_TOE_L, B_TOE_R, B_UPPER_ARM_L, B_UPPER_ARM_R,
  B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN_BONES,
} from "./human.ts";

export const LOOK_BYTES = 28;
export const LOOK_SEX = 0;
export const LOOK_REGIONS = 1;
export const REGION_COUNT = 22;
export const LOOK_SKIN = 23;
export const LOOK_HAIR_COLOR = 24;
export const LOOK_EYE_COLOR = 25;
export const LOOK_HAIR = 26;
export const LOOK_BEARD = 27;

/** Mesh ids are "core:human_<sex id>/...". */
export const SEX_IDS: readonly string[] = ["m", "f"];
export const SEX_LABELS: readonly string[] = ["Male", "Female"];

/**
 * The source model of each sex is scaled by this, so that both have their eyes
 * at the survivor's eye height and stand as tall as the skeleton does.
 */
export const BODY_SCALES: readonly number[] = [0.953, 0.978];

/** Colour regions of a body mesh, as vertex colours: resolved per body from its look. */
export const REGION_SKIN = REGION_BASE;
export const REGION_CLOTH = REGION_BASE + 1;
export const REGION_EYE = REGION_BASE + 2;
export const REGION_HAIR = REGION_BASE + 3;
/**
 * Colour regions of a worn piece's mesh: its main colour takes the place of
 * what a bare body wears, and two more follow. A piece says what they are.
 */
export const REGION_MAIN = REGION_CLOTH;
export const REGION_SECOND = REGION_BASE + 4;
export const REGION_TRIM = REGION_BASE + 5;
/** Palette colour of what a body wears under everything else. */
const CLOTH_COLOR = 4;

export interface Style {
  readonly id: string;
  readonly label: string;
  /** Source model in assets/raw, or null for none; `female` is used on the female head when given. */
  readonly source: string | null;
  readonly female?: string;
}

export const HAIR_STYLES: readonly Style[] = [
  { id: "none", label: "Bald", source: null },
  { id: "buzzed", label: "Buzzed", source: "Hair_Buzzed", female: "Hair_BuzzedFemale" },
  { id: "parted", label: "Parted", source: "Hair_SimpleParted" },
  { id: "long", label: "Long", source: "Hair_Long" },
  { id: "buns", label: "Buns", source: "Hair_Buns" },
];
export const BEARD_STYLES: readonly Style[] = [
  { id: "none", label: "None", source: null },
  { id: "full", label: "Full", source: "Hair_Beard" },
];

const X = 1;
const Y = 2;
const Z = 4;
/** A region: its name, and for each bone it stretches, which axes and by how much at full slider. */
interface Region {
  readonly label: string;
  readonly bones: readonly (readonly [bone: number, axes: number, amount: number])[];
}

const pair = (l: number, r: number, axes: number, amount: number): readonly (readonly [number, number, number])[] => [[l, axes, amount], [r, axes, amount]];

/** The twenty-two regions, in the order their bytes are stored. Arms lie along X, legs and the spine along Y. */
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
    bones: [...pair(B_HAND_L, B_HAND_R, X | Y | Z, 0.15), ...pair(B_FINGERS_L, B_FINGERS_R, X | Y | Z, 0.15), ...pair(B_THUMB_L, B_THUMB_R, X | Y | Z, 0.15), ...pair(B_PROP_L, B_PROP_R, X | Y | Z, 0.15)],
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

/** A look with every slider in the middle. */
export function defaultLook(out: Uint8Array = new Uint8Array(LOOK_BYTES)): Uint8Array {
  out.fill(0, 0, LOOK_BYTES);
  out[LOOK_SKIN] = 3;
  out[LOOK_HAIR_COLOR] = 3;
  out[LOOK_HAIR] = 1;
  return out;
}

/** Whether these bytes are a look, as a client may send anything. */
export function validLook(b: Uint8Array): boolean {
  if (b.length !== LOOK_BYTES || b[LOOK_SEX]! >= SEX_IDS.length) return false;
  // A region byte of 128 would be -128, one step outside the slider.
  for (let r = 0; r < REGION_COUNT; r++) if (b[LOOK_REGIONS + r] === 128) return false;
  return b[LOOK_SKIN]! < SKIN_TONES && b[LOOK_HAIR_COLOR]! < HAIR_COLORS && b[LOOK_EYE_COLOR]! < EYE_COLORS && b[LOOK_HAIR]! < HAIR_STYLES.length && b[LOOK_BEARD]! < BEARD_STYLES.length;
}

/** The value of region `r` as -1..1. */
export function regionOf(look: Uint8Array, r: number): number {
  const v = look[LOOK_REGIONS + r]!;
  return (v > 127 ? v - 256 : v) / 127;
}

export function setRegion(look: Uint8Array, r: number, value: number): void {
  const v = Math.floor((value < -1 ? -1 : value > 1 ? 1 : value) * 127 + 0.5);
  look[LOOK_REGIONS + r] = v & 255;
}

/** A look made at random: every choice even, sliders mostly near the middle. */
export function randomLook(rng: Rng, out: Uint8Array = new Uint8Array(LOOK_BYTES)): Uint8Array {
  out[LOOK_SEX] = rng.int(SEX_IDS.length);
  // The mean of two throws: extremes are possible and uncommon.
  for (let r = 0; r < REGION_COUNT; r++) setRegion(out, r, (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5);
  out[LOOK_SKIN] = rng.int(SKIN_TONES);
  out[LOOK_HAIR_COLOR] = rng.int(HAIR_COLORS);
  out[LOOK_EYE_COLOR] = rng.int(EYE_COLORS);
  out[LOOK_HAIR] = rng.int(HAIR_STYLES.length);
  out[LOOK_BEARD] = out[LOOK_SEX] === 0 && rng.int(2) === 0 ? 1 + rng.int(BEARD_STYLES.length - 1) : 0;
  return out;
}

/** The six colour regions a body with this look is drawn with, as palette indices. */
export function lookColors(look: Uint8Array, out: Uint8Array, at = 0): void {
  out[at] = SKIN_BASE + look[LOOK_SKIN]!;
  out[at + 1] = CLOTH_COLOR;
  out[at + 2] = EYE_BASE + look[LOOK_EYE_COLOR]!;
  out[at + 3] = HAIR_BASE + look[LOOK_HAIR_COLOR]!;
  out[at + 4] = 0;
  out[at + 5] = 0;
}

/**
 * How far each bone is stretched along its own x, y and z: `HUMAN_BONES * 3`
 * numbers around 1. Regions that touch the same bone multiply.
 */
export function lookScales(look: Uint8Array, out: Float32Array): void {
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
}

/**
 * How much higher the hips must ride for the feet of a body with these scales
 * to stay on the ground: what the stretch adds to the length of a straight leg.
 * `rest` is where the body's joints rest.
 */
export function lookLift(scales: Float32Array, rest: ArrayLike<number>): number {
  const upper = rest[B_UPPER_LEG_L * 3 + 1]! - rest[B_LOWER_LEG_L * 3 + 1]!;
  const lower = rest[B_LOWER_LEG_L * 3 + 1]! - rest[B_FOOT_L * 3 + 1]!;
  return upper * (scales[B_UPPER_LEG_L * 3 + 1]! - 1) + lower * (scales[B_LOWER_LEG_L * 3 + 1]! - 1);
}
