// The humanoid skeleton every survivor shares.
//
// Twenty-eight bones resting in a T-pose: standing on the origin, facing +Z,
// arms out along X (the body's left is +X), palms down. All rest rotations are
// identity. Proportions are those of the base male model scaled so its eyes are
// at the survivor's eye height; a body of other proportions is a rig with its
// own rest positions and the same bones.
//
// The first twenty bones carry hit boxes. The last eight (toes, fingers,
// thumbs, and a prop bone in each hand) only move geometry: what hangs on them
// is covered by the box of the hand or foot they belong to.

import type { Skeleton } from "./skeleton.ts";

export const B_HIPS = 0;
export const B_SPINE = 1;
export const B_CHEST = 2;
export const B_UPPER_CHEST = 3;
export const B_NECK = 4;
export const B_HEAD = 5;
export const B_SHOULDER_L = 6;
export const B_UPPER_ARM_L = 7;
export const B_LOWER_ARM_L = 8;
export const B_HAND_L = 9;
export const B_SHOULDER_R = 10;
export const B_UPPER_ARM_R = 11;
export const B_LOWER_ARM_R = 12;
export const B_HAND_R = 13;
export const B_UPPER_LEG_L = 14;
export const B_LOWER_LEG_L = 15;
export const B_FOOT_L = 16;
export const B_UPPER_LEG_R = 17;
export const B_LOWER_LEG_R = 18;
export const B_FOOT_R = 19;
export const B_TOE_L = 20;
export const B_TOE_R = 21;
export const B_FINGERS_L = 22;
export const B_THUMB_L = 23;
export const B_FINGERS_R = 24;
export const B_THUMB_R = 25;
/** What a hand holds hangs on its prop bone, so a clip can move the thing within the hand. */
export const B_PROP_L = 26;
export const B_PROP_R = 27;
export const HUMAN_BONES = 28;

export const ZONE_NONE = 0;
export const ZONE_HEAD = 1;
export const ZONE_TORSO = 2;
export const ZONE_ARM_L = 3;
export const ZONE_ARM_R = 4;
export const ZONE_HAND_L = 5;
export const ZONE_HAND_R = 6;
export const ZONE_LEG_L = 7;
export const ZONE_LEG_R = 8;
export const ZONE_FOOT_L = 9;
export const ZONE_FOOT_R = 10;
export const ZONE_COUNT = 11;
export const ZONE_NAMES: readonly string[] = ["none", "head", "torso", "left arm", "right arm", "left hand", "right hand", "left leg", "right leg", "left foot", "right foot"];

/** Body slots: the parts a body mesh is cut into, and the armor piece that covers each. */
export const SLOT_HEAD = 0;
export const SLOT_TORSO = 1;
export const SLOT_HANDS = 2;
export const SLOT_LEGS = 3;
export const SLOT_FEET = 4;
export const SLOT_COUNT = 5;
export const SLOT_NAMES: readonly string[] = ["head", "torso", "hands", "legs", "feet"];
/** The slot whose armor protects each zone. */
export const SLOT_OF_ZONE: readonly number[] = [SLOT_TORSO, SLOT_HEAD, SLOT_TORSO, SLOT_TORSO, SLOT_TORSO, SLOT_HANDS, SLOT_HANDS, SLOT_LEGS, SLOT_LEGS, SLOT_FEET, SLOT_FEET];

type Row = readonly [name: string, parent: number, x: number, y: number, z: number, zone: number, slot: number, box: readonly [cx: number, cy: number, cz: number, hx: number, hy: number, hz: number] | null];

// Left-side rows are mirrored for the right below. Box numbers are relative to the joint.
const CENTER: readonly Row[] = [
  ["hips", -1, 0, 0.904, -0.041, ZONE_TORSO, SLOT_LEGS, [0, 0.025, 0.035, 0.175, 0.105, 0.125]],
  ["spine", B_HIPS, 0, 1.022, -0.007, ZONE_TORSO, SLOT_TORSO, [0, 0.055, 0.005, 0.165, 0.07, 0.12]],
  ["chest", B_SPINE, 0, 1.123, 0.004, ZONE_TORSO, SLOT_TORSO, [0, 0.065, 0, 0.175, 0.08, 0.125]],
  ["upperChest", B_CHEST, 0, 1.249, 0.007, ZONE_TORSO, SLOT_TORSO, [0, 0.1, -0.015, 0.2, 0.115, 0.13]],
  ["neck", B_UPPER_CHEST, 0, 1.449, -0.039, ZONE_TORSO, SLOT_HEAD, [0, 0.035, 0.03, 0.06, 0.05, 0.065]],
  ["head", B_NECK, 0, 1.525, -0.016, ZONE_HEAD, SLOT_HEAD, [0, 0.095, 0.02, 0.09, 0.115, 0.115]],
];
const LEFT_ARM: readonly Row[] = [
  ["shoulder", B_UPPER_CHEST, 0.03, 1.425, 0.031, ZONE_TORSO, SLOT_TORSO, [0.09, -0.02, -0.06, 0.09, 0.065, 0.085]],
  ["upperArm", B_SHOULDER_L, 0.202, 1.387, -0.062, ZONE_ARM_L, SLOT_TORSO, [0.12, 0, 0, 0.13, 0.058, 0.058]],
  ["lowerArm", B_UPPER_ARM_L, 0.441, 1.387, -0.07, ZONE_ARM_L, SLOT_TORSO, [0.115, 0, 0, 0.125, 0.048, 0.048]],
  ["hand", B_LOWER_ARM_L, 0.673, 1.387, -0.062, ZONE_HAND_L, SLOT_HANDS, [0.105, -0.01, 0.012, 0.11, 0.04, 0.062]],
];
const LEFT_LEG: readonly Row[] = [
  ["upperLeg", B_HIPS, 0.109, 0.925, -0.034, ZONE_LEG_L, SLOT_LEGS, [0, -0.2, 0.01, 0.088, 0.225, 0.095]],
  ["lowerLeg", B_UPPER_LEG_L, 0.109, 0.517, -0.034, ZONE_LEG_L, SLOT_LEGS, [0, -0.21, 0, 0.062, 0.23, 0.072]],
  ["foot", B_LOWER_LEG_L, 0.109, 0.082, -0.084, ZONE_FOOT_L, SLOT_FEET, [0, -0.035, 0.08, 0.052, 0.058, 0.142]],
];
const LEFT_MINOR: readonly Row[] = [
  ["toe", B_FOOT_L, 0.109, 0.014, 0.052, ZONE_NONE, SLOT_FEET, null],
  ["fingers", B_HAND_L, 0.783, 1.383, -0.048, ZONE_NONE, SLOT_HANDS, null],
  ["thumb", B_HAND_L, 0.705, 1.361, -0.023, ZONE_NONE, SLOT_HANDS, null],
  ["prop", B_HAND_L, 0.752, 1.357, -0.052, ZONE_NONE, SLOT_HANDS, null],
];

/** How far each left-side bone index is from its right-side twin, by group. */
const ARM_SIDE = B_SHOULDER_R - B_SHOULDER_L;
const LEG_SIDE = B_UPPER_LEG_R - B_UPPER_LEG_L;

function build(): Skeleton & { readonly slot: Uint8Array } {
  const names: string[] = new Array<string>(HUMAN_BONES).fill("");
  const parent = new Int8Array(HUMAN_BONES);
  const rest = new Float32Array(HUMAN_BONES * 3);
  const zone = new Uint8Array(HUMAN_BONES);
  const slot = new Uint8Array(HUMAN_BONES);
  const boxCenter = new Float32Array(HUMAN_BONES * 3);
  const boxHalf = new Float32Array(HUMAN_BONES * 3);
  const put = (b: number, row: Row, name: string, par: number, side: number, zoneId: number): void => {
    names[b] = name;
    parent[b] = par;
    rest[b * 3] = row[2] * side;
    rest[b * 3 + 1] = row[3];
    rest[b * 3 + 2] = row[4];
    zone[b] = zoneId;
    slot[b] = row[6];
    const box = row[7];
    if (box) {
      boxCenter[b * 3] = box[0] * side;
      boxCenter[b * 3 + 1] = box[1];
      boxCenter[b * 3 + 2] = box[2];
      boxHalf.set(box.slice(3), b * 3);
    }
  };
  CENTER.forEach((row, i) => put(i, row, row[0], row[1], 1, row[5]));
  LEFT_ARM.forEach((row, i) => {
    const b = B_SHOULDER_L + i;
    put(b, row, row[0] + ".L", row[1], 1, row[5]);
    // The right side: mirrored in X, the next zone id along, its parent on its own side.
    const rightZone = row[5] === ZONE_TORSO ? ZONE_TORSO : row[5] + 1;
    put(b + ARM_SIDE, row, row[0] + ".R", row[1] === B_UPPER_CHEST ? row[1] : row[1] + ARM_SIDE, -1, rightZone);
  });
  LEFT_LEG.forEach((row, i) => {
    const b = B_UPPER_LEG_L + i;
    put(b, row, row[0] + ".L", row[1], 1, row[5]);
    put(b + LEG_SIDE, row, row[0] + ".R", row[1] === B_HIPS ? row[1] : row[1] + LEG_SIDE, -1, row[5] + 1);
  });
  const minor: readonly [left: number, right: number, parentRight: number][] = [
    [B_TOE_L, B_TOE_R, B_FOOT_R],
    [B_FINGERS_L, B_FINGERS_R, B_HAND_R],
    [B_THUMB_L, B_THUMB_R, B_HAND_R],
    [B_PROP_L, B_PROP_R, B_HAND_R],
  ];
  LEFT_MINOR.forEach((row, i) => {
    const [left, right, parentRight] = minor[i]!;
    put(left, row, row[0] + ".L", row[1], 1, ZONE_NONE);
    put(right, row, row[0] + ".R", parentRight, -1, ZONE_NONE);
  });
  return { id: "human", bones: HUMAN_BONES, names, parent, rest, zoneBones: B_FOOT_R + 1, zone, slot, boxCenter, boxHalf };
}

/** The skeleton, with the body slot each bone's geometry belongs to. */
export const HUMAN: Skeleton & { readonly slot: Uint8Array } = build();

/** Points on the body other things attach to or look from: a bone and a place in its space. */
export interface Socket {
  readonly bone: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const SOCKET_EYE: Socket = { bone: B_HEAD, x: 0, y: 0.095, z: 0.075 };
export const SOCKET_CROWN: Socket = { bone: B_HEAD, x: 0, y: 0.215, z: 0.01 };
export const SOCKET_BACK: Socket = { bone: B_UPPER_CHEST, x: 0, y: 0.08, z: -0.15 };
export const SOCKET_GRIP_L: Socket = { bone: B_PROP_L, x: 0, y: 0, z: 0 };
export const SOCKET_GRIP_R: Socket = { bone: B_PROP_R, x: 0, y: 0, z: 0 };
