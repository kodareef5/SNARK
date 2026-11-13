// Clips written as code, for motions the animation libraries do not have:
// lying prone and crawling, and how a bow and a gun are held, drawn and aimed.
//
// A pose is built by walking down the skeleton and saying where each part
// points in model space ("the left forearm points forward and a little in"),
// which is how one thinks about a pose, rather than as rotations relative to
// parents. The builder turns that into the rotations a clip stores. Everything
// is exactly rounded arithmetic, so the clips are the same bits on every
// engine. The pack build adds them to the converted clips.

import { quatAxis, quatCopy, quatMul, quatMulConj, quatNormalize, quatRotate } from "../math/quat.ts";
import { TAU, detSin } from "../math/scalar.ts";
import { Pose, type Clip } from "./clip.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK,
  B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES,
} from "./human.ts";

const DEG = TAU / 360;

/** The bone each bone points at when at rest: its axis runs from its joint to that one's. */
const TOWARD: Readonly<Record<number, number>> = {
  [B_UPPER_ARM_L]: B_LOWER_ARM_L, [B_LOWER_ARM_L]: B_HAND_L, [B_UPPER_ARM_R]: B_LOWER_ARM_R, [B_LOWER_ARM_R]: B_HAND_R,
  [B_UPPER_LEG_L]: B_LOWER_LEG_L, [B_LOWER_LEG_L]: B_FOOT_L, [B_UPPER_LEG_R]: B_LOWER_LEG_R, [B_LOWER_LEG_R]: B_FOOT_R,
};

/** Builds one pose, bone by bone from the hips outward. */
export class PoseBuilder {
  readonly pose = new Pose(HUMAN_BONES);
  /** Model-space rotation of each bone, kept current as bones are set. */
  private readonly world = new Float64Array(HUMAN_BONES * 4);
  private readonly q = new Float64Array(4);
  private readonly v = new Float64Array(3);

  constructor() {
    this.refresh(0);
  }

  /** Put the hips at this place in model space. */
  hips(x: number, y: number, z: number): this {
    this.pose.root[0] = x - HUMAN.rest[0]!;
    this.pose.root[1] = y - HUMAN.rest[1]!;
    this.pose.root[2] = z - HUMAN.rest[2]!;
    return this;
  }

  /** Turn a bone, on top of how it already stands, by degrees about the model's X, then Y, then Z axis. */
  turn(bone: number, x: number, y = 0, z = 0): this {
    const q = this.q;
    for (const [angle, ax, ay, az] of [[x, 1, 0, 0], [y, 0, 1, 0], [z, 0, 0, 1]] as const) {
      if (angle === 0) continue;
      quatAxis(q, 0, ax, ay, az, angle * DEG);
      quatMul(this.world, bone * 4, q, 0, this.world, bone * 4);
    }
    return this.store(bone);
  }

  /**
   * Point a limb bone along (dx, dy, dz) in model space, by the shortest turn
   * from where it rests, then roll it about its own length by `roll` degrees.
   */
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
    // The shortest turn from a to d: axis a x d, and the half-angle form (1 + a.d, a x d).
    const w = this.world;
    const dot = ax * dx + ay * dy + az * dz;
    if (dot < -0.999999) {
      // Opposite: half a turn about any axis square to a.
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

  /** Stand a bone as it rests in model space, whatever its parents are doing: a hand so set holds a thing pointing forward and upright. */
  level(bone: number): this {
    const w = this.world;
    w[bone * 4] = w[bone * 4 + 1] = w[bone * 4 + 2] = 0;
    w[bone * 4 + 3] = 1;
    return this.store(bone);
  }

  /** Where a bone's joint is in model space, as the pose stands. */
  joint(bone: number): [number, number, number] {
    const chain: number[] = [];
    for (let b = bone; b >= 0; b = HUMAN.parent[b]!) chain.push(b);
    const rest = HUMAN.rest;
    const at: [number, number, number] = [rest[0]! + this.pose.root[0]!, rest[1]! + this.pose.root[1]!, rest[2]! + this.pose.root[2]!];
    for (let i = chain.length - 2; i >= 0; i--) {
      const b = chain[i]!;
      const p = chain[i + 1]!;
      quatRotate(this.world, p * 4, rest[b * 3]! - rest[p * 3]!, rest[b * 3 + 1]! - rest[p * 3 + 1]!, rest[b * 3 + 2]! - rest[p * 3 + 2]!, this.v, 0);
      at[0] += this.v[0]!;
      at[1] += this.v[1]!;
      at[2] += this.v[2]!;
    }
    return at;
  }

  /** The model-space rotation of `bone` was set: store it relative to its parent, and carry its children with it. */
  private store(bone: number): this {
    const p = HUMAN.parent[bone]!;
    if (p < 0) quatCopy(this.pose.rot, bone * 4, this.world, bone * 4);
    else {
      quatMulConj(this.q, 0, this.world, p * 4, this.world, bone * 4);
      quatNormalize(this.q, 0);
      quatCopy(this.pose.rot, bone * 4, this.q, 0);
    }
    this.refresh(bone + 1);
    return this;
  }

  /** Recompute model-space rotations of bones from `from` on, from the stored pose. */
  private refresh(from: number): void {
    for (let b = from; b < HUMAN_BONES; b++) {
      const p = HUMAN.parent[b]!;
      if (p < 0) quatCopy(this.world, b * 4, this.pose.rot, b * 4);
      else quatMul(this.world, b * 4, this.world, p * 4, this.pose.rot, b * 4);
    }
  }
}

/** A clip of `frames` frames; `at(builder, phase)` poses each, with phase running 0 to 1. */
function clip(id: string, frames: number, loop: boolean, at: (b: PoseBuilder, phase: number) => void): Clip {
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

/**
 * Lying on its front, propped on its elbows, looking ahead. `reach` (-1 to 1)
 * is where it is in a crawl: positive has the left arm and right knee forward.
 */
function prone(b: PoseBuilder, reach: number): void {
  // Lying across the middle of its capsule: as much of it ahead of where it stands as behind.
  b.hips(0, 0.2, 0.05).turn(B_HIPS, 84, 0, reach * 4);
  // The back arches up from the ground to the shoulders; the neck and head bring the face level.
  b.turn(B_SPINE, -9).turn(B_CHEST, -9).turn(B_UPPER_CHEST, -8, 0, -reach * 5).turn(B_NECK, -22).turn(B_HEAD, -34);
  for (const side of [1, -1] as const) {
    const left = side === 1;
    const r = reach * side;
    // Elbows under and ahead of the shoulders, forearms along the ground toward each other.
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, 0.42 * side, -0.72, 0.42 + r * 0.45);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -0.3 * side, -0.02 + (r > 0 ? r * 0.25 : 0), 1);
    // Legs out behind, a little apart; the knee on the side whose arm is back comes up and out.
    const knee = r < 0 ? -r : 0;
    b.aim(left ? B_UPPER_LEG_L : B_UPPER_LEG_R, (0.14 + knee * 0.55) * side, 0, -1 + knee * 0.5);
    b.aim(left ? B_LOWER_LEG_L : B_LOWER_LEG_R, (0.05 - knee * 0.2) * side, 0.02, -1);
    b.turn(left ? B_FOOT_L : B_FOOT_R, 55);
  }
}

// How things are held. Each is one frame, and only the upper body of it is used: the legs go on with
// whatever they were doing. +Z is ahead, +X the body's left, and a pose looks level: the look's pitch is
// added by the pose function. A thing in the right hand points where the hand's own +Z does, so a hand
// set level holds it aimed; a bow is in the left hand and shoots the way that arm points.

/** A bow carried: low and ahead in the left hand, the right hand loose. */
function bowReady(b: PoseBuilder): void {
  b.aim(B_UPPER_ARM_L, 0.3, -0.85, 0.35).aim(B_LOWER_ARM_L, 0.05, -0.45, 0.9);
  b.aim(B_UPPER_ARM_R, -0.25, -0.95, 0.1).aim(B_LOWER_ARM_R, -0.1, -0.8, 0.55);
}

/** A bow drawn: the body half turned, the left arm straight out at the mark, the right hand back at the jaw. */
function bowDrawn(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -14).turn(B_CHEST, 0, -14).turn(B_UPPER_CHEST, 0, -12).turn(B_NECK, 0, 20).turn(B_HEAD, 0, 20);
  b.aim(B_UPPER_ARM_L, 0.12, -0.04, 1).aim(B_LOWER_ARM_L, 0.05, -0.02, 1);
  b.aim(B_UPPER_ARM_R, -0.75, 0.02, -0.5).aim(B_LOWER_ARM_R, 0.82, 0.06, 0.62);
}

/** A long gun at the shoulder: the right hand at the grip under the eye, the left under the barrel. */
function gunAimed(b: PoseBuilder): void {
  b.turn(B_SPINE, 0, -8).turn(B_CHEST, 0, -8).turn(B_NECK, 0, 8).turn(B_HEAD, 0, 8);
  b.aim(B_UPPER_ARM_R, -0.38, -0.82, 0.28).aim(B_LOWER_ARM_R, 0.42, 0.42, 0.8).level(B_HAND_R);
  b.aim(B_UPPER_ARM_L, 0.05, -0.55, 0.85).aim(B_LOWER_ARM_L, -0.62, 0.3, 0.75);
}

/** A long gun brought down to be loaded: across the body, muzzle low, the left hand at the breech. */
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

/** A pistol brought in to be loaded: muzzle up by the shoulder, the left hand at it. */
function pistolLowered(b: PoseBuilder): void {
  b.aim(B_UPPER_ARM_R, -0.3, -0.9, 0.25).aim(B_LOWER_ARM_R, 0.25, 0.55, 0.8).level(B_HAND_R).turn(B_HAND_R, -40);
  b.aim(B_UPPER_ARM_L, 0.2, -0.8, 0.45).aim(B_LOWER_ARM_L, -0.6, 0.45, 0.65);
  b.turn(B_NECK, 10).turn(B_HEAD, 10);
}

let authored: readonly Clip[] | null = null;

/** Every clip written as code. Built once. */
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
  ]);
}
