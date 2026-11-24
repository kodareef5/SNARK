// Clips written as code, for motions the animation libraries lack. A pose says where each bone points in model space.
// The builder uses only exactly rounded arithmetic, so the clips are the same bits on every engine.

import { quatAxis, quatCopy, quatMul, quatMulConj, quatNormalize, quatRotate } from "../math/quat.ts";
import { TAU, detSin } from "../math/scalar.ts";
import { Pose, type Clip } from "./clip.ts";
import { emoteClips } from "./emote-clips.ts";
import { glideClips } from "./glide-clips.ts";
import { strikeClips } from "./strikes.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK,
  B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES,
} from "./human.ts";

const DEG = TAU / 360;

/** A limb bone's rest axis runs from its joint to the joint of the bone it maps to. */
const TOWARD: Readonly<Record<number, number>> = {
  [B_UPPER_ARM_L]: B_LOWER_ARM_L, [B_LOWER_ARM_L]: B_HAND_L, [B_UPPER_ARM_R]: B_LOWER_ARM_R, [B_LOWER_ARM_R]: B_HAND_R,
  [B_UPPER_LEG_L]: B_LOWER_LEG_L, [B_LOWER_LEG_L]: B_FOOT_L, [B_UPPER_LEG_R]: B_LOWER_LEG_R, [B_LOWER_LEG_R]: B_FOOT_R,
};

const chains = Array.from(HUMAN.parent, (_, bone) => {
  const chain: number[] = [];
  for (let b = bone; b > 0; b = HUMAN.parent[b]!) chain.push(b);
  return chain.reverse();
});

/** Builds one pose. Set bones from the hips outward, because turning a parent carries its children with it. */
export class PoseBuilder {
  readonly pose = new Pose(HUMAN_BONES);
  /** Model-space rotation of each bone. */
  private readonly world = new Float64Array(HUMAN_BONES * 4);
  private readonly q = new Float64Array(4);
  private readonly v = new Float64Array(3);

  /** World rotations below this index already match the current pose. */
  private worldReady = 0;

  constructor() {
    this.refresh(HUMAN_BONES);
  }

  /** Starts from `pose` in place of rest, to turn some of its bones where it stands. */
  from(pose: Pose): this {
    this.pose.rot.set(pose.rot);
    this.pose.root.set(pose.root);
    this.worldReady = 0;
    return this;
  }

  /** In model space. */
  hips(x: number, y: number, z: number): this {
    this.pose.root[0] = x - HUMAN.rest[0]!;
    this.pose.root[1] = y - HUMAN.rest[1]!;
    this.pose.root[2] = z - HUMAN.rest[2]!;
    return this;
  }

  /** Degrees about the model's X, then Y, then Z axis, applied on top of the bone's current rotation. */
  turn(bone: number, x: number, y = 0, z = 0): this {
    this.refresh(bone + 1);
    const q = this.q;
    for (const [angle, ax, ay, az] of [[x, 1, 0, 0], [y, 0, 1, 0], [z, 0, 0, 1]] as const) {
      if (angle === 0) continue;
      quatAxis(q, 0, ax, ay, az, angle * DEG);
      quatMul(this.world, bone * 4, q, 0, this.world, bone * 4);
    }
    return this.store(bone);
  }

  /** Points a limb bone along (dx, dy, dz) in model space by the shortest turn from rest, then rolls it about its length by `roll` degrees. */
  aim(bone: number, dx: number, dy: number, dz: number, roll = 0): this {
    const to = TOWARD[bone];
    if (to === undefined) throw new Error(`bone ${HUMAN.names[bone]} has no axis to aim`);
    let ax = HUMAN.rest[to * 3]! - HUMAN.rest[bone * 3]!;
    let ay = HUMAN.rest[to * 3 + 1]! - HUMAN.rest[bone * 3 + 1]!;
    let az = HUMAN.rest[to * 3 + 2]! - HUMAN.rest[bone * 3 + 2]!;
    const al = Math.sqrt(ax * ax + ay * ay + az * az);
    ax /= al;
    ay /= al;
    az /= al;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= dl;
    dy /= dl;
    dz /= dl;
    // The shortest turn from a to d is the normalized quaternion (a x d, 1 + a.d).
    const w = this.world;
    const dot = ax * dx + ay * dy + az * dz;
    if (dot < -0.999999) {
      // Opposite directions take half a turn about any axis perpendicular to a.
      const sx = Math.abs(ax) < 0.9 ? 1 : 0;
      const cx = ay * 0 - az * (1 - sx);
      const cy = az * sx - ax * 0;
      const cz = ax * (1 - sx) - ay * sx;
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
      w[bone * 4] = cx / cl;
      w[bone * 4 + 1] = cy / cl;
      w[bone * 4 + 2] = cz / cl;
      w[bone * 4 + 3] = 0;
    } else {
      w[bone * 4] = ay * dz - az * dy;
      w[bone * 4 + 1] = az * dx - ax * dz;
      w[bone * 4 + 2] = ax * dy - ay * dx;
      w[bone * 4 + 3] = 1 + dot;
      quatNormalize(w, bone * 4);
    }
    if (roll !== 0) {
      quatAxis(this.q, 0, dx, dy, dz, roll * DEG);
      quatMul(w, bone * 4, this.q, 0, w, bone * 4);
    }
    return this.store(bone);
  }

  /** Degrees about the bone's own X, then Y, then Z axis (its rest frame as turned): a curl of the fingers whatever way the hand is turned. */
  local(bone: number, x: number, y = 0, z = 0): this {
    this.refresh(bone + 1);
    const q = this.q;
    for (const [angle, ax, ay, az] of [[x, 1, 0, 0], [y, 0, 1, 0], [z, 0, 0, 1]] as const) {
      if (angle === 0) continue;
      quatAxis(q, 0, ax, ay, az, angle * DEG);
      quatMul(this.world, bone * 4, this.world, bone * 4, q, 0);
    }
    return this.store(bone);
  }

  /** Gives a bone its rest orientation in model space, regardless of its parents. A hand set this way holds an item pointing forward and upright. */
  level(bone: number): this {
    const w = this.world;
    w[bone * 4] = w[bone * 4 + 1] = w[bone * 4 + 2] = 0;
    w[bone * 4 + 3] = 1;
    return this.store(bone);
  }

  /** Copies a bone's model-space rotation, for the pose so far, to `out` at `o`. */
  rotation(bone: number, out: Float64Array, o: number): void {
    this.refresh(bone + 1);
    quatCopy(out, o, this.world, bone * 4);
  }

  /** Straightens a bone on its parent, as it rests. */
  straighten(bone: number): this {
    this.refresh(bone);
    quatCopy(this.world, bone * 4, this.world, HUMAN.parent[bone]! * 4);
    return this.store(bone);
  }

  /** Gives a bone the model-space rotation in `q` at `o`, regardless of its parents. */
  rotate(bone: number, q: Float64Array, o: number): this {
    quatCopy(this.world, bone * 4, q, o);
    return this.store(bone);
  }

  /** The joint's position in model space, for the pose so far. */
  joint(bone: number): [number, number, number] {
    this.refresh(HUMAN.parent[bone]! + 1);
    const rest = HUMAN.rest;
    const at: [number, number, number] = [rest[0]! + this.pose.root[0]!, rest[1]! + this.pose.root[1]!, rest[2]! + this.pose.root[2]!];
    for (const b of chains[bone]!) {
      const p = HUMAN.parent[b]!;
      quatRotate(this.world, p * 4, rest[b * 3]! - rest[p * 3]!, rest[b * 3 + 1]! - rest[p * 3 + 1]!, rest[b * 3 + 2]! - rest[p * 3 + 2]!, this.v, 0);
      at[0] += this.v[0]!;
      at[1] += this.v[1]!;
      at[2] += this.v[2]!;
    }
    return at;
  }

  /** Stores the model-space rotation of `bone` relative to its parent and carries its children with it. */
  private store(bone: number): this {
    this.refresh(bone);
    const p = HUMAN.parent[bone]!;
    if (p < 0) quatCopy(this.pose.rot, bone * 4, this.world, bone * 4);
    else {
      quatMulConj(this.q, 0, this.world, p * 4, this.world, bone * 4);
      quatNormalize(this.q, 0);
      quatCopy(this.pose.rot, bone * 4, this.q, 0);
    }
    this.worldReady = bone + 1;
    return this;
  }

  private refresh(end: number): void {
    if (end <= this.worldReady) return;
    for (let b = this.worldReady; b < end; b++) {
      const p = HUMAN.parent[b]!;
      if (p < 0) quatCopy(this.world, b * 4, this.pose.rot, b * 4);
      else quatMul(this.world, b * 4, this.world, p * 4, this.pose.rot, b * 4);
    }
    this.worldReady = end;
  }
}

/** `at` poses each frame, with phase running from 0 to 1. */
export function clip(id: string, frames: number, loop: boolean, at: (b: PoseBuilder, phase: number) => void): Clip {
  const rot = new Float32Array(frames * HUMAN_BONES * 4);
  const root = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    const b = new PoseBuilder();
    at(b, frames === 1 ? 0 : loop ? f / frames : f / (frames - 1));
    rot.set(b.pose.rot, f * HUMAN_BONES * 4);
    root.set(b.pose.root, f * 3);
  }
  return { id, bones: HUMAN_BONES, frames, loop, rot, root };
}

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
    ...emoteClips(),
    ...glideClips(),
    ...strikeClips(),
  ]);
}
