// Clips written as code, for motions the animation libraries lack. A pose says where each bone points in model space.
// The builder uses only exactly rounded arithmetic, so the clips are the same bits on every engine.

import { TAU, detSin } from "../math/scalar.ts";
import type { Clip } from "./clip.ts";
import { emoteClips } from "./emote-clips.ts";
import { glideClips } from "./glide-clips.ts";
import { strikeClips } from "./strikes.ts";
import { ROUND_HELD, ROUND_SLIDE } from "./launcher-pose.ts";
import { clip, type PoseBuilder } from "./pose-builder.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L,
  B_LOWER_LEG_R, B_NECK, B_PROP_R, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L,
  B_UPPER_LEG_R,
} from "./human.ts";

export { PoseBuilder } from "./pose-builder.ts";
export { ROUND_HELD, ROUND_SLIDE } from "./launcher-pose.ts";

/** Lying prone on the elbows, looking ahead. `reach` (-1 to 1) is the crawl phase. Positive puts the left arm and right knee forward. */
function prone(b: PoseBuilder, reach: number): void {
  // The body lies centred on its capsule, as much ahead of its position as behind.
  b.hips(0, 0.2, 0.05).turn(B_HIPS, 84, 0, reach * 4);
  // The back arches up to the shoulders, and the neck and head bring the face level.
  b.turn(B_SPINE, -9).turn(B_CHEST, -9).turn(B_UPPER_CHEST, -8, 0, -reach * 5).turn(B_NECK, -22).turn(B_HEAD, -34);
  for (const side of [1, -1] as const) {
    const left = side === 1;
    const r = reach * side;
    // The elbows are under and ahead of the shoulders, with the forearms along the ground toward each other.
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, 0.42 * side, -0.72, 0.42 + r * 0.45);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -0.3 * side, -0.02 + (r > 0 ? r * 0.25 : 0), 1);
    // The legs lie behind, a little apart. The knee on the side whose arm is back comes up and out.
    const knee = r < 0 ? -r : 0;
    b.aim(left ? B_UPPER_LEG_L : B_UPPER_LEG_R, (0.14 + knee * 0.55) * side, 0, -1 + knee * 0.5);
    b.aim(left ? B_LOWER_LEG_L : B_LOWER_LEG_R, (0.05 - knee * 0.2) * side, 0.02, -1);
    b.turn(left ? B_FOOT_L : B_FOOT_R, 55);
  }
}

// Hold poses. Each is one frame, and only its upper body is used. +Z is ahead and +X is the body's left.
// A pose looks level, and the pose function adds the look's pitch. An item in the right hand points along the
// hand's +Z, so a level hand aims it. A bow is in the left hand and shoots the way that arm points.

/** The bow is low and ahead in the left hand, and the right hand is loose. */
function bowReady(b: PoseBuilder): void {
  b.aim(B_UPPER_ARM_L, 0.3, -0.85, 0.35).aim(B_LOWER_ARM_L, 0.05, -0.45, 0.9);
  b.aim(B_UPPER_ARM_R, -0.25, -0.95, 0.1).aim(B_LOWER_ARM_R, -0.1, -0.8, 0.55);
}

/** The body is half turned, the left arm points straight at the target, and the right hand is back at the jaw. */
function bowDrawn(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -14).turn(B_CHEST, 0, -14).turn(B_UPPER_CHEST, 0, -12).turn(B_NECK, 0, 20).turn(B_HEAD, 0, 20);
  b.aim(B_UPPER_ARM_L, 0.12, -0.04, 1).aim(B_LOWER_ARM_L, 0.05, -0.02, 1);
  b.aim(B_UPPER_ARM_R, -0.75, 0.02, -0.5).aim(B_LOWER_ARM_R, 0.82, 0.06, 0.62);
}

/** A long gun at the shoulder. The right hand is at the grip under the eye and the left is under the barrel. */
function gunAimed(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -8).turn(B_CHEST, 0, -8).turn(B_NECK, 0, 8).turn(B_HEAD, 0, 8);
  b.aim(B_UPPER_ARM_R, -0.38, -0.82, 0.28).aim(B_LOWER_ARM_R, 0.42, 0.42, 0.8).level(B_HAND_R);
  b.aim(B_UPPER_ARM_L, 0.05, -0.55, 0.85).aim(B_LOWER_ARM_L, -0.62, 0.3, 0.75);
}

/** A long gun lowered for loading: across the body, muzzle low, the left hand at the breech. */
function gunLowered(b: PoseBuilder): void {
  b.aim(B_UPPER_ARM_R, -0.3, -0.92, 0.1).aim(B_LOWER_ARM_R, 0.3, -0.25, 0.9).level(B_HAND_R).turn(B_HAND_R, 28, 22);
  b.aim(B_UPPER_ARM_L, 0.15, -0.85, 0.4).aim(B_LOWER_ARM_L, -0.7, 0.05, 0.7);
  b.turn(B_NECK, 14).turn(B_HEAD, 12);
}

/** A pistol held out in the right hand, the left steadying it. */
function pistolAimed(b: PoseBuilder): void {
  b.aim(B_UPPER_ARM_R, -0.12, -0.28, 1).aim(B_LOWER_ARM_R, 0.2, 0.12, 1).level(B_HAND_R);
  b.aim(B_UPPER_ARM_L, 0.2, -0.42, 0.9).aim(B_LOWER_ARM_L, -0.55, 0.22, 0.8);
}

/** A pistol brought in for loading: muzzle up by the shoulder, the left hand at it. */
function pistolLowered(b: PoseBuilder): void {
  b.aim(B_UPPER_ARM_R, -0.3, -0.9, 0.25).aim(B_LOWER_ARM_R, 0.25, 0.55, 0.8).level(B_HAND_R).turn(B_HAND_R, -40);
  b.aim(B_UPPER_ARM_L, 0.2, -0.8, 0.45).aim(B_LOWER_ARM_L, -0.6, 0.45, 0.65);
  b.turn(B_NECK, 10).turn(B_HEAD, 10);
}

// A launcher is a tube a metre long whose axis is 9 cm over its grip, from 52 cm behind it to 50 cm ahead, with a fore grip
// 22 cm ahead and a pad for the shoulder 25 cm behind (content: core:rocket_launcher). Its round goes in at the muzzle.
const TUBE_UP = 0.09;
const FORE_GRIP = 0.22;
const ROUND_HOME = 0.3 + ROUND_HELD;
const ROUND_AT_MUZZLE = ROUND_HOME + ROUND_SLIDE;

/** The left hand closed on the fore grip from the body's left: fingers ahead, palm to the right. */
const onForeGrip = (tip: number, swing: number) => (b: PoseBuilder): void => void b.turn(B_HAND_L, 0, -90, -90).turn(B_HAND_L, tip, swing);
/** The left hand under a round that lies along a tube tipped and swung so, palm up. */
const underRound = (tip: number, swing: number) => (b: PoseBuilder): void => void b.turn(B_HAND_L, tip, swing).local(B_HAND_L, 0, 0, 180);

/** The tube on the right shoulder: the right hand on its grip ahead of the shoulder, the left on the fore grip, the head down to the sight. */
function launcherAimed(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -12).turn(B_CHEST, 0, -12).turn(B_UPPER_CHEST, 0, -6).turn(B_NECK, 0, 14, 6).turn(B_HEAD, 4, 14, 8);
  b.grip(-0.16, 1.44, 0.2, 0, 0, -0.5, -1, -0.1);
  const fore = b.point(B_PROP_R, 0, -0.02, FORE_GRIP);
  b.palm(fore[0], fore[1], fore[2], onForeGrip(0, 0), 0.6, -1, 0);
}

/** The tube off the shoulder and across the body, muzzle up and to the left, both hands still on it. */
function launcherLowered(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -6).turn(B_CHEST, 0, -6).turn(B_NECK, 10).turn(B_HEAD, 8);
  b.grip(-0.19, 1.04, 0.04, -22, 22, -0.6, -0.5, -0.6);
  const fore = b.point(B_PROP_R, 0, -0.02, FORE_GRIP);
  b.palm(fore[0], fore[1], fore[2], onForeGrip(-22, 22), 0.6, -1, 0);
}

/** The tube held in the right hand alone, and the left at the pouch on the left hip. */
function launcherFetch(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -4).turn(B_CHEST, 0, -4).turn(B_NECK, 16, -18).turn(B_HEAD, 12, -14);
  b.grip(-0.24, 1.02, 0, -18, 16, -0.6, -0.5, -0.6);
  b.palm(0.24, 0.98, 0.02, underRound(-60, 10), 0.8, 0.1, -0.6);
}

/** The left hand has a round along the tube at its muzzle. `along` is how far up the tube from the grip it holds. */
function launcherLoading(b: PoseBuilder, along: number): void {
  b.turn(B_SPINE, 6, -18).turn(B_CHEST, 6, -14).turn(B_UPPER_CHEST, 0, -8).turn(B_NECK, 8, 18).turn(B_HEAD, 6, 14);
  b.grip(-0.26, 1.0, -0.06, -16, 16, -0.6, -0.5, -0.6);
  const at = b.point(B_PROP_R, 0, TUBE_UP, along);
  b.palm(at[0], at[1], at[2], underRound(-16, 16), 0.7, -0.7, -0.2);
}

let authored: readonly Clip[] | null = null;

export function authoredClips(): readonly Clip[] {
  return (authored ??= [
    clip("human/prone_idle", 1, true, (b) => prone(b, 0)),
    clip("human/prone_crawl", 40, true, (b, phase) => prone(b, detSin(phase * TAU))),
    clip("human/bow_ready", 1, true, bowReady),
    clip("human/bow_drawn", 1, true, bowDrawn),
    clip("human/gun_aimed", 1, true, gunAimed),
    clip("human/gun_lowered", 1, true, gunLowered),
    clip("human/pistol_aimed", 1, true, pistolAimed),
    clip("human/pistol_lowered", 1, true, pistolLowered),
    clip("human/launcher_aimed", 1, true, launcherAimed),
    clip("human/launcher_lowered", 1, true, launcherLowered),
    clip("human/launcher_fetch", 1, true, launcherFetch),
    clip("human/launcher_load", 1, true, (b) => launcherLoading(b, ROUND_AT_MUZZLE)),
    clip("human/launcher_push", 1, true, (b) => launcherLoading(b, ROUND_HOME)),
    ...emoteClips(),
    ...glideClips(),
    ...strikeClips(),
  ]);
}
