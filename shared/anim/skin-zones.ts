// The parts of a body's skin that a worn thing can cover and so hide. A level of a body mesh keeps each part's triangles
// together (PackLod.zones), so a body can be drawn without the parts its clothes cover. They are finer than the five
// slots and have nothing to do with where a hit lands (ZONE_* in human.ts).

import {
  B_CHEST, B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R,
  B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK, B_PROP_L, B_PROP_R, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_THUMB_L, B_THUMB_R, B_TOE_L, B_TOE_R, B_UPPER_ARM_L,
  B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN_BONES, SLOT_FEET, SLOT_HANDS, SLOT_HEAD, SLOT_LEGS, SLOT_TORSO,
} from "./human.ts";

export const SKIN_HEAD = 0;
export const SKIN_NECK = 1;
export const SKIN_CHEST = 2;
export const SKIN_ABDOMEN = 3;
export const SKIN_UPPER_ARM_TOP_L = 4;
export const SKIN_UPPER_ARM_LOW_L = 5;
export const SKIN_FOREARM_L = 6;
export const SKIN_UPPER_ARM_TOP_R = 7;
export const SKIN_UPPER_ARM_LOW_R = 8;
export const SKIN_FOREARM_R = 9;
export const SKIN_HAND_L = 10;
export const SKIN_HAND_R = 11;
export const SKIN_PELVIS = 12;
export const SKIN_THIGH_TOP_L = 13;
export const SKIN_THIGH_LOW_L = 14;
export const SKIN_SHIN_L = 15;
export const SKIN_THIGH_TOP_R = 16;
export const SKIN_THIGH_LOW_R = 17;
export const SKIN_SHIN_R = 18;
export const SKIN_FOOT_L = 19;
export const SKIN_FOOT_R = 20;
// Bands where hems fall, carved from the end of the zone beside them, so a collar, a waistband, a cuff or a shoe's top
// can hide its own zone whole and leave the band drawn.
export const SKIN_COLLAR = 21;
export const SKIN_WAIST = 22;
export const SKIN_WRIST_L = 23;
export const SKIN_WRIST_R = 24;
export const SKIN_ANKLE_L = 25;
export const SKIN_ANKLE_R = 26;
export const SKIN_ZONE_COUNT = 27;

/**
 * Chest is the upper chest and upper back, abdomen the belly and lower back. An upper arm and a thigh are cut at half their
 * length. The collar is the chest's skin round the base of the neck, the waist the abdomen's lowest, a wrist the forearm's
 * last few centimetres and the base of the palm, an ankle the shin's lowest.
 */
export const SKIN_ZONE_NAMES: readonly string[] = [
  "head", "neck", "chest", "abdomen", "left upper arm, top", "left upper arm, low", "left forearm", "right upper arm, top", "right upper arm, low", "right forearm",
  "left hand", "right hand", "pelvis", "left thigh, top", "left thigh, low", "left shin", "right thigh, top", "right thigh, low", "right shin", "left foot", "right foot",
  "collar", "waist", "left wrist", "right wrist", "left ankle", "right ankle",
];

/** The body slot each zone's triangles are in, which is the slot of the bones it covers. */
export const SKIN_ZONE_SLOT: readonly number[] = [
  SLOT_HEAD, SLOT_HEAD, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO,
  SLOT_HANDS, SLOT_HANDS, SLOT_LEGS, SLOT_LEGS, SLOT_LEGS, SLOT_LEGS, SLOT_LEGS, SLOT_LEGS, SLOT_LEGS, SLOT_FEET, SLOT_FEET,
  SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_LEGS, SLOT_LEGS,
];

/** The zone of each bone's skin. An upper arm or thigh gives its top zone here; `skinZoneAt` finds the low half. */
export const SKIN_ZONE_OF_BONE: readonly number[] = (() => {
  const out = new Array<number>(HUMAN_BONES).fill(SKIN_CHEST);
  const set = (zone: number, ...bones: number[]): void => bones.forEach((b) => (out[b] = zone));
  set(SKIN_HEAD, B_HEAD);
  set(SKIN_NECK, B_NECK);
  set(SKIN_CHEST, B_CHEST, B_UPPER_CHEST, B_SHOULDER_L, B_SHOULDER_R);
  set(SKIN_ABDOMEN, B_SPINE);
  set(SKIN_PELVIS, B_HIPS);
  set(SKIN_UPPER_ARM_TOP_L, B_UPPER_ARM_L);
  set(SKIN_UPPER_ARM_TOP_R, B_UPPER_ARM_R);
  set(SKIN_FOREARM_L, B_LOWER_ARM_L);
  set(SKIN_FOREARM_R, B_LOWER_ARM_R);
  set(SKIN_HAND_L, B_HAND_L, B_FINGERS_L, B_FINGERTIPS_L, B_THUMB_L, B_PROP_L);
  set(SKIN_HAND_R, B_HAND_R, B_FINGERS_R, B_FINGERTIPS_R, B_THUMB_R, B_PROP_R);
  set(SKIN_THIGH_TOP_L, B_UPPER_LEG_L);
  set(SKIN_THIGH_TOP_R, B_UPPER_LEG_R);
  set(SKIN_SHIN_L, B_LOWER_LEG_L);
  set(SKIN_SHIN_R, B_LOWER_LEG_R);
  set(SKIN_FOOT_L, B_FOOT_L, B_TOE_L);
  set(SKIN_FOOT_R, B_FOOT_R, B_TOE_R);
  return out;
})();

/** The limbs cut in two along their length: bone, the joint its far end is, and the zone of that half. */
const HALVED: readonly (readonly [bone: number, end: number, low: number])[] = [
  [B_UPPER_ARM_L, B_LOWER_ARM_L, SKIN_UPPER_ARM_LOW_L],
  [B_UPPER_ARM_R, B_LOWER_ARM_R, SKIN_UPPER_ARM_LOW_R],
  [B_UPPER_LEG_L, B_LOWER_LEG_L, SKIN_THIGH_LOW_L],
  [B_UPPER_LEG_R, B_LOWER_LEG_R, SKIN_THIGH_LOW_R],
];

/** Metres below the neck's joint the collar reaches, and how far out from the neck's line, across. */
export const COLLAR_DROP = 0.03;
export const COLLAR_REACH = 0.11;
/** Metres above the spine's joint the waist reaches. */
export const WAIST_RISE = 0.015;
/** Metres back from the wrist and up from the ankle along the limb that the wrist and ankle bands reach. */
export const WRIST_BAND = 0.05;
export const ANKLE_BAND = 0.07;

/** The limbs whose far end is a band: bone, the joint at that end, the band's zone and its reach. */
const BANDED: readonly (readonly [bone: number, end: number, band: number, reach: number])[] = [
  [B_LOWER_ARM_L, B_HAND_L, SKIN_WRIST_L, WRIST_BAND],
  [B_LOWER_ARM_R, B_HAND_R, SKIN_WRIST_R, WRIST_BAND],
  [B_LOWER_LEG_L, B_FOOT_L, SKIN_ANKLE_L, ANKLE_BAND],
  [B_LOWER_LEG_R, B_FOOT_R, SKIN_ANKLE_R, ANKLE_BAND],
];

/** The zone of a point of skin at rest that follows `bone`, on a body whose joints rest at `rest`. */
export function skinZoneAt(bone: number, x: number, y: number, z: number, rest: ArrayLike<number>): number {
  for (const [b, end, low] of HALVED) {
    if (b !== bone) continue;
    const ax = rest[end * 3]! - rest[b * 3]!, ay = rest[end * 3 + 1]! - rest[b * 3 + 1]!, az = rest[end * 3 + 2]! - rest[b * 3 + 2]!;
    const t = ((x - rest[b * 3]!) * ax + (y - rest[b * 3 + 1]!) * ay + (z - rest[b * 3 + 2]!) * az) / (ax * ax + ay * ay + az * az);
    return t >= 0.5 ? low : SKIN_ZONE_OF_BONE[bone]!;
  }
  for (const [b, end, band, reach] of BANDED) {
    if (b !== bone) continue;
    const ax = rest[end * 3]! - rest[b * 3]!, ay = rest[end * 3 + 1]! - rest[b * 3 + 1]!, az = rest[end * 3 + 2]! - rest[b * 3 + 2]!;
    const l = Math.sqrt(ax * ax + ay * ay + az * az);
    // How far short of the far joint, along the limb.
    const short = ((rest[end * 3]! - x) * ax + (rest[end * 3 + 1]! - y) * ay + (rest[end * 3 + 2]! - z) * az) / l;
    return short < reach ? band : SKIN_ZONE_OF_BONE[bone]!;
  }
  const zone = SKIN_ZONE_OF_BONE[bone]!;
  const nx = x - rest[B_NECK * 3]!, nz = z - rest[B_NECK * 3 + 2]!;
  if (zone === SKIN_CHEST && y > rest[B_NECK * 3 + 1]! - COLLAR_DROP && nx * nx + nz * nz < COLLAR_REACH * COLLAR_REACH) return SKIN_COLLAR;
  if (zone === SKIN_ABDOMEN && y < rest[B_SPINE * 3 + 1]! + WAIST_RISE) return SKIN_WAIST;
  return zone;
}
