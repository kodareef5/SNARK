// What both character creators offer for a look's 32 face bytes (shared/anim/look.ts): a label per modifier in byte
// order, the groups they are paged in, named presets and a random face. The modifiers themselves are cooked by
// tools/makehuman/faces.ts, whose names these labels follow.

import { FACE_COUNT, LOOK_FACE, setFace } from "../anim/look.ts";
import type { Rng } from "../rng.ts";

/** In byte order: label i is look byte LOOK_FACE + i. */
export const FACE_LABELS: readonly string[] = [
  "Head age", "Head fullness", "Oval to round", "Heart to square",
  "Forehead slope", "Forehead height", "Brow ridge", "Brow height",
  "Eye size", "Eye spacing", "Eye height", "Eye slant", "Eye fold",
  "Nose length", "Nose width", "Nose projection", "Nose bridge", "Nose tip", "Nostrils",
  "Cheekbones", "Cheek fullness", "Mouth width", "Upper lip", "Lower lip", "Mouth corners",
  "Chin prominence", "Chin width", "Chin height", "Jaw width", "Jaw angle",
  "Ear size", "Ear angle",
];

export interface FaceGroup {
  readonly label: string;
  /** For a picker button. */
  readonly short: string;
  /** Face modifier indices, in byte order. */
  readonly faces: readonly number[];
}

const span = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

/** Every modifier is in one group, the groups in byte order. */
export const FACE_GROUPS: readonly FaceGroup[] = [
  { label: "Head", short: "Head", faces: span(0, 4) },
  { label: "Brow and forehead", short: "Brow", faces: span(4, 8) },
  { label: "Eyes", short: "Eyes", faces: span(8, 13) },
  { label: "Nose", short: "Nose", faces: span(13, 19) },
  { label: "Cheeks and mouth", short: "Mouth", faces: span(19, 25) },
  { label: "Chin and jaw", short: "Jaw", faces: span(25, 30) },
  { label: "Ears", short: "Ears", faces: span(30, 32) },
];

export interface FacePreset {
  readonly label: string;
  /** One value a modifier in -1..1, in byte order. */
  readonly values: readonly number[];
}

/** Whole faces, each a starting point to edit. */
export const FACE_PRESETS: readonly FacePreset[] = [
  {
    label: "Youthful",
    values: [-0.6, 0.2, 0.3, -0.2, 0.1, 0.2, -0.3, 0.1, 0.4, 0.1, 0, 0.1, 0, -0.3, -0.1, -0.2, -0.3, 0.3, -0.1, 0, 0.4, -0.1, 0.2, 0.3, 0.2, -0.2, -0.1, -0.1, -0.2, -0.1, -0.1, 0],
  },
  {
    label: "Weathered",
    values: [0.7, -0.3, -0.2, 0.2, -0.2, 0.3, 0.4, -0.2, -0.2, 0, -0.1, -0.3, 0.1, 0.4, 0.2, 0.3, 0.3, -0.3, 0.2, 0.3, -0.5, 0.1, -0.4, -0.3, -0.4, 0.2, 0.1, 0.2, 0.2, 0.1, 0.4, 0.1],
  },
  {
    label: "Angular",
    values: [0, -0.4, -0.5, 0.6, -0.1, 0, 0.5, -0.2, -0.1, 0, 0, 0.2, 0, 0.2, -0.2, 0.4, 0.4, -0.1, -0.2, 0.7, -0.5, 0, -0.2, -0.1, 0, 0.5, 0.3, 0.2, 0.6, 0.3, 0, -0.1],
  },
  {
    label: "Soft",
    values: [-0.1, 0.6, 0.6, -0.1, 0.2, -0.1, -0.4, 0.2, 0.2, 0, 0, 0, 0.1, -0.2, 0.3, -0.3, -0.4, 0.1, 0.2, -0.3, 0.6, 0, 0.3, 0.4, 0.1, -0.4, 0.2, -0.3, -0.1, -0.3, 0.1, 0],
  },
  {
    label: "Narrow",
    values: [0, -0.3, -0.4, -0.4, 0, 0.4, 0.1, 0.2, 0, -0.4, 0.1, 0, 0, 0.5, -0.5, 0.2, 0.2, 0, -0.4, 0.2, -0.3, -0.4, -0.1, 0, 0, 0.2, -0.5, 0.4, -0.5, 0.2, 0.1, -0.2],
  },
  {
    label: "Broad",
    values: [0, 0.3, 0.3, 0.5, -0.1, -0.3, 0.3, -0.3, -0.1, 0.4, -0.1, -0.1, 0, -0.2, 0.6, -0.1, -0.1, 0, 0.5, 0.4, 0.2, 0.5, 0.3, 0.3, -0.1, 0, 0.5, -0.2, 0.6, -0.2, 0.2, 0.2],
  },
  {
    label: "Delicate",
    values: [-0.3, -0.1, 0.1, -0.5, 0.3, 0.1, -0.5, 0.3, 0.5, 0.1, 0.1, 0.3, 0, -0.3, -0.4, -0.2, -0.3, 0.4, -0.3, 0.3, 0, -0.2, 0.4, 0.3, 0.3, -0.1, -0.4, -0.2, -0.5, -0.2, -0.3, -0.2],
  },
  {
    label: "Rugged",
    values: [0.3, 0.1, -0.2, 0.7, -0.4, -0.2, 0.7, -0.4, -0.3, 0.1, -0.2, -0.2, 0.1, 0.3, 0.4, 0.3, 0.5, -0.2, 0.3, 0.3, -0.2, 0.2, -0.3, -0.1, -0.2, 0.6, 0.5, 0.3, 0.7, 0.4, 0.2, 0.1],
  },
];

/** The most a random face strays from neutral, as a population's `face` share means it. */
export const FACE_SPREAD = 0.6;

/** Writes `values` into the look's face bytes. */
export function setFaces(look: Uint8Array, values: readonly number[]): Uint8Array {
  for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, values[f] ?? 0);
  return look;
}

/** Sets every face byte to neutral. */
export function resetFace(look: Uint8Array): Uint8Array {
  look.fill(0, LOOK_FACE, LOOK_FACE + FACE_COUNT);
  return look;
}

/** Writes a random face into the look and leaves its other bytes. The mean of two throws, so extremes are uncommon. */
export function randomFace(rng: Rng, look: Uint8Array, spread = FACE_SPREAD): Uint8Array {
  for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5 * spread);
  return look;
}

/** Applies a creator's face button, by its action name, to the look. False for an action that is not one. */
export function faceAction(look: Uint8Array, action: string, index: number, rng: () => Rng): boolean {
  if (action === "face-preset") {
    const p = FACE_PRESETS[index];
    if (p) setFaces(look, p.values);
  } else if (action === "face-random") randomFace(rng(), look);
  else if (action === "face-reset") resetFace(look);
  else return false;
  return true;
}
