// Shared seat motions for the current HUMAN topology. Action ownership, attachment and commit ticks live in simulation.
// Replacing a clip changes presentation, never the duration of entering, exiting or taking a seat.

import { quatNormalize, quatRotate, type Numbers } from "../math/quat.ts";
import { clamp } from "../math/scalar.ts";
import { PoseBuilder } from "./authored.ts";
import { Pose, blendPose, sampleClip, type Clip } from "./clip.ts";
import {
  B_CHEST, B_FINGERS_L, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R,
  B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R,
  B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES,
} from "./human.ts";
import type { Solved } from "./skeleton.ts";

/** `ride` sits astride a saddle (shared/anim/seat.ts): its rider's hands on the grips, a passenger's upper body its own. */
export const MOUNT_MOTION_ROLES = ["drive", "passenger", "enter", "exit", "carjack", "displaced", "ride", "pilot", "cabin", "pwc"] as const;
export type MountMotionRole = typeof MOUNT_MOTION_ROLES[number];

export interface MountMotionProfile {
  /** Validated, privately copied replacements. All are sampled as non-looping semantic phases. */
  readonly clips: Readonly<Partial<Record<MountMotionRole, Clip>>>;
  /** Rejected replacements use the procedural fallback. Report these once at asset load, not every frame. */
  readonly rejected: readonly MountMotionRole[];
}

export interface MountPoseInput {
  readonly role: MountMotionRole;
  readonly tick: number;
  readonly startTick: number;
  readonly durationTicks: number;
  /** Door side: +1 is the body's left (+X), -1 mirrors the transition. Ignored while seated. */
  readonly side?: 1 | -1;
  /** -1..1; bends the procedural driver's arms around the wheel. An authored drive clip owns its arms. */
  readonly steering?: number;
  /** Existing look/weapon pose for a passenger. Upper body and hand props survive; hips and legs do not. May equal out. */
  readonly upper?: Pose;
}

/** Load-time validation, with no dependence on an asset loader. Clips must already target HUMAN's named topology. */
export function createMountMotion(clips: Partial<Record<MountMotionRole, Clip>> = {}): MountMotionProfile {
  const accepted: Partial<Record<MountMotionRole, Clip>> = {};
  const rejected: MountMotionRole[] = [];
  for (const role of MOUNT_MOTION_ROLES) {
    const c = clips[role];
    if (!c) continue;
    if (!validClip(c)) {
      rejected.push(role);
      continue;
    }
    const rot = c.rot.slice();
    for (let i = 0; i < rot.length; i += 4) quatNormalize(rot, i);
    accepted[role] = { id: c.id, bones: HUMAN_BONES, frames: c.frames, loop: false, rot, root: c.root.slice() };
  }
  return { clips: accepted, rejected };
}

function validClip(c: Clip): boolean {
  if (c.bones !== HUMAN_BONES || !Number.isSafeInteger(c.frames) || c.frames < 1) return false;
  if (!(c.rot instanceof Float32Array) || !(c.root instanceof Float32Array)) return false;
  if (c.rot.length !== c.frames * HUMAN_BONES * 4 || c.root.length !== c.frames * 3) return false;
  for (const n of c.root) if (!Number.isFinite(n)) return false;
  for (let i = 0; i < c.rot.length; i += 4) {
    const x = c.rot[i]!, y = c.rot[i + 1]!, z = c.rot[i + 2]!, w = c.rot[i + 3]!;
    const norm = x * x + y * y + z * z + w * w;
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.02) return false;
  }
  return true;
}

function phase(input: MountPoseInput): number {
  const { tick, startTick, durationTicks } = input;
  if (!Number.isFinite(tick) || !Number.isFinite(startTick) || !Number.isFinite(durationTicks)) return 0;
  if (durationTicks <= 0) return tick < startTick ? 0 : 1;
  return clamp((tick - startTick) / durationTicks, 0, 1);
}

const sampled = new Pose(HUMAN_BONES);
const mirrors = HUMAN.names.map((name, bone) => {
  const other = name.endsWith(".L") ? name.slice(0, -2) + ".R" : name.endsWith(".R") ? name.slice(0, -2) + ".L" : name;
  const mirrored = HUMAN.names.indexOf(other);
  return mirrored < 0 ? bone : mirrored;
});

/** Samples without allocation. The supplied phase clock is the only clock; clip frames do not trigger gameplay. */
export function mountPose(profile: MountMotionProfile, input: MountPoseInput, out: Pose): void {
  const replacement = profile.clips[input.role];
  const fallback = fallbacks();
  const clip = replacement ?? fallback.clips[input.role];
  sampleClip(clip, phase(input) * (clip.frames - 1), sampled);
  if (!replacement && input.role === "drive") {
    const steering = Number.isFinite(input.steering) ? clamp(input.steering!, -1, 1) : 0;
    blendPose(sampled, sampled, steering < 0 ? fallback.left : fallback.right, Math.abs(steering));
  }
  // Copy the passenger's local upper pose after seating; the procedural seated hips have identity rotation.
  // Do this before writing out, so callers can pass an existing humanPose as both upper and output.
  if ((input.role === "passenger" || input.role === "ride") && input.upper) {
    for (let i = B_SPINE * 4; i < B_UPPER_LEG_L * 4; i++) sampled.rot[i] = input.upper.rot[i]!;
    for (let i = B_FINGERS_L * 4; i < HUMAN_BONES * 4; i++) sampled.rot[i] = input.upper.rot[i]!;
  }
  // Riders using fixed controls keep their arms and torso braced while their head and neck follow a look.
  if ((input.role === "pilot" || input.role === "cabin" || input.role === "pwc") && input.upper) {
    for (const bone of [B_NECK, B_HEAD]) for (let k = 0; k < 4; k++) sampled.rot[bone * 4 + k] = input.upper.rot[bone * 4 + k]!;
  }
  const mirror = input.side === -1 && (input.role === "enter" || input.role === "exit" || input.role === "carjack" || input.role === "displaced");
  for (let b = 0; b < HUMAN_BONES; b++) {
    const src = (mirror ? mirrors[b]! : b) * 4;
    out.rot[b * 4] = sampled.rot[src]!;
    out.rot[b * 4 + 1] = sampled.rot[src + 1]! * (mirror ? -1 : 1);
    out.rot[b * 4 + 2] = sampled.rot[src + 2]! * (mirror ? -1 : 1);
    out.rot[b * 4 + 3] = sampled.rot[src + 3]!;
  }
  out.root[0] = sampled.root[0]! * (mirror ? -1 : 1);
  out.root[1] = sampled.root[1]!;
  out.root[2] = sampled.root[2]!;
}

/**
 * Actor origin that pins the solved pelvis to a seat's world position. Solve with the actual body's rest/scale first.
 * actorRotation is the unit quaternion from actor/model space to world (including vehicle pitch/roll and seat facing).
 * Use while attached; approach/exit movement and choosing when attachment changes remain the simulation's job.
 * Both renderer and hit capsules must use this same origin and rotation. out may alias seatPosition.
 */
export function mountOrigin(solved: Solved, seatPosition: Numbers, actorRotation: Numbers, out: Numbers): void {
  const x = seatPosition[0]!, y = seatPosition[1]!, z = seatPosition[2]!;
  quatRotate(actorRotation, 0, solved.pos[B_HIPS * 3]!, solved.pos[B_HIPS * 3 + 1]!, solved.pos[B_HIPS * 3 + 2]!, out, 0);
  out[0] = x - out[0]!;
  out[1] = y - out[1]!;
  out[2] = z - out[2]!;
}

/** Small keyframe sets, authored once with the existing builder rather than rebuilt for every pedestrian each tick. */
function keyframes(id: string, poses: readonly Pose[]): Clip {
  const rot = new Float32Array(poses.length * HUMAN_BONES * 4);
  const root = new Float32Array(poses.length * 3);
  for (let f = 0; f < poses.length; f++) {
    rot.set(poses[f]!.rot, f * HUMAN_BONES * 4);
    root.set(poses[f]!.root, f * 3);
  }
  return { id: "human/mount/" + id, bones: HUMAN_BONES, frames: poses.length, loop: false, rot, root };
}

function seated(driver: boolean, steering = 0): Pose {
  const b = new PoseBuilder().hips(0, 0.62, 0);
  for (const side of [1, -1] as const) {
    const left = side === 1;
    b.aim(left ? B_UPPER_LEG_L : B_UPPER_LEG_R, side * 0.08, -0.15, 1);
    // Shins reach into the footwell. Near-vertical shins put the foot capsules through a low compact's floor.
    b.aim(left ? B_LOWER_LEG_L : B_LOWER_LEG_R, 0, -0.6, 0.8);
    b.level(left ? B_FOOT_L : B_FOOT_R).turn(left ? B_FOOT_L : B_FOOT_R, -10);
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, side * 0.1, driver ? -0.58 - steering * side * 0.18 : -0.95, driver ? 0.85 : 0.2);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -side * (driver ? 0.35 : 0.1), driver ? -steering * side * 0.6 : -0.3, 1);
    b.level(left ? B_HAND_L : B_HAND_R);
  }
  return b.pose;
}

/** Compact enclosed-cabin pose. Elbows stay beside the torso, hands on the lap or helicopter controls. */
function cabinSeat(pilot: boolean): Pose {
  const b = new PoseBuilder();
  b.pose.rot.set(seated(false).rot); b.pose.root.set(seated(false).root);
  for (const side of [1, -1] as const) {
    const left = side === 1;
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, side * 0.04, -0.9, pilot ? 0.3 : 0.14);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -side * (pilot ? 0.15 : 0.42), pilot ? -0.05 : -0.25, 0.85);
    b.level(left ? B_HAND_L : B_HAND_R);
  }
  return b.pose;
}

/**
 * Astride a saddle, in the seat's frame with the origin SEAT_DROP (0.55) below the seat: the hips 0.10 over it, leaning 6
 * degrees forward, thighs forward and down either side, shins hanging, hands forward on the grips. These are the joints
 * the pteranodon's rig was fitted to (RIDER in assets/source/core/creatures/pteranodon/rig.py).
 */
function astride(watercraft = false): Pose {
  const b = new PoseBuilder().hips(0, 0.65, 0).turn(B_SPINE, 6);
  for (const side of [1, -1] as const) {
    const left = side === 1;
    // The PWC's trays are beside the saddle. Its riders brace on level feet, knees ahead of their ankles.
    if (watercraft) {
      b.aim(left ? B_UPPER_LEG_L : B_UPPER_LEG_R, side * .18, .103, .30);
      b.aim(left ? B_LOWER_LEG_L : B_LOWER_LEG_R, side * .012, -.4, -.16);
      b.level(left ? B_FOOT_L : B_FOOT_R);
    } else {
      b.aim(left ? B_UPPER_LEG_L : B_UPPER_LEG_R, side * .155, -.2, .34);
      b.aim(left ? B_LOWER_LEG_L : B_LOWER_LEG_R, side * .01, -.42, .1);
      b.level(left ? B_FOOT_L : B_FOOT_R).turn(left ? B_FOOT_L : B_FOOT_R, 25);
    }
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, side * 0.05, -0.228, 0.09);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -side * 0.08, -0.19, 0.22);
    b.level(left ? B_HAND_L : B_HAND_R);
  }
  return b.pose;
}

function standing(): PoseBuilder {
  return new PoseBuilder()
    .aim(B_UPPER_ARM_L, 0.1, -1, 0.06).aim(B_LOWER_ARM_L, 0, -1, 0.12)
    .aim(B_UPPER_ARM_R, -0.1, -1, 0.06).aim(B_LOWER_ARM_R, 0, -1, 0.12);
}

function reach(bend: number, grab: boolean): Pose {
  const b = standing().hips(0, HUMAN.rest[1]! - bend * 0.24, bend * 0.04);
  b.turn(B_SPINE, bend * 16, -12).turn(B_CHEST, bend * 12, -8).turn(B_NECK, -bend * 10, 10).turn(B_HEAD, -bend * 8, 10);
  b.aim(B_UPPER_ARM_L, 0.6, -0.2, 0.8).aim(B_LOWER_ARM_L, 0.55, -0.1, 1).level(B_HAND_L);
  if (grab) b.aim(B_UPPER_ARM_R, 0.15, -0.3, 1).aim(B_LOWER_ARM_R, 0.5, 0, 1).level(B_HAND_R);
  b.aim(B_UPPER_LEG_L, 0.18, -1, bend * 0.8).aim(B_LOWER_LEG_L, 0, -1, -bend * 0.45).level(B_FOOT_L);
  b.aim(B_UPPER_LEG_R, -0.12, -1, bend * 0.5).aim(B_LOWER_LEG_R, 0, -1, -bend * 0.3).level(B_FOOT_R);
  // Keep the lower foot at its rest contact height during the crouch. Final terrain/door IK can replace this shim.
  const footY = Math.min(b.joint(B_FOOT_L)[1], b.joint(B_FOOT_R)[1]);
  b.hips(0, b.joint(B_HIPS)[1] + HUMAN.rest[B_FOOT_L * 3 + 1]! - footY, bend * 0.04);
  return b.pose;
}

interface Fallbacks { clips: Readonly<Record<MountMotionRole, Clip>>; left: Pose; right: Pose }
let fallbackCache: Fallbacks | undefined;

function fallbacks(): Fallbacks {
  if (fallbackCache) return fallbackCache;
  const stand = standing().pose, sit = seated(false), drive = seated(true);
  const touch = reach(0.15, false), duck = reach(0.85, false), grab = reach(0.8, true);
  const recoil = new PoseBuilder().hips(0.18, 0.68, -0.05)
    .turn(B_HIPS, -12, 0, -14).turn(B_SPINE, -10).turn(B_CHEST, 0, 18)
    .aim(B_UPPER_LEG_L, 0.25, -0.15, 1).aim(B_LOWER_LEG_L, 0.2, -1, 0.3).level(B_FOOT_L)
    .aim(B_UPPER_LEG_R, -0.2, -0.3, 1).aim(B_LOWER_LEG_R, -0.1, -1, 0.2).level(B_FOOT_R)
    .aim(B_UPPER_ARM_L, 0.7, -0.15, 0.8).aim(B_LOWER_ARM_L, 0.2, 0.4, 1)
    .aim(B_UPPER_ARM_R, -0.8, -0.1, 0.6).aim(B_LOWER_ARM_R, -0.2, 0.5, 1).pose;
  fallbackCache = {
    clips: {
      drive: keyframes("drive", [drive]), passenger: keyframes("passenger", [sit]),
      enter: keyframes("enter", [stand, touch, duck, sit]), exit: keyframes("exit", [sit, duck, touch, stand]),
      carjack: keyframes("carjack", [stand, touch, grab, grab]),
      displaced: keyframes("displaced", [sit, recoil, duck, stand]),
      ride: keyframes("ride", [astride()]), pwc: keyframes("pwc", [astride(true)]),
      pilot: keyframes("pilot", [cabinSeat(true)]), cabin: keyframes("cabin", [cabinSeat(false)]),
    },
    left: seated(true, -1), right: seated(true, 1),
  };
  return fallbackCache;
}
