// Builds model-space poses and bakes them into deterministic human clips.

import { quatAxis, quatCopy, quatMul, quatMulConj, quatNormalize, quatRotate } from "../math/quat.ts";
import { TAU } from "../math/scalar.ts";
import { Pose, type Clip } from "./clip.ts";
import {
  B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_PROP_L,
  B_PROP_R, B_SHOULDER_L, B_SHOULDER_R, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN,
  HUMAN_BONES,
} from "./human.ts";

const DEG = TAU / 360;

/** A limb bone's rest axis runs from its joint to the joint of the bone it maps to. */
const TOWARD: Readonly<Record<number, number>> = {
  [B_SHOULDER_L]: B_UPPER_ARM_L, [B_SHOULDER_R]: B_UPPER_ARM_R,
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
  rest = HUMAN.rest;
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
  from(pose: Pose, rest = HUMAN.rest): this {
    this.rest = rest;
    this.pose.rot.set(pose.rot);
    this.pose.root.set(pose.root);
    this.worldReady = 0;
    return this;
  }

  /** In model space. */
  hips(x: number, y: number, z: number): this {
    this.pose.root[0] = x - this.rest[0]!;
    this.pose.root[1] = y - this.rest[1]!;
    this.pose.root[2] = z - this.rest[2]!;
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
    let ax = this.rest[to * 3]! - this.rest[bone * 3]!;
    let ay = this.rest[to * 3 + 1]! - this.rest[bone * 3 + 1]!;
    let az = this.rest[to * 3 + 2]! - this.rest[bone * 3 + 2]!;
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
    const rest = this.rest;
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

  /** The model-space place of a point given from `bone`'s joint in its rest frame, for the pose so far. */
  point(bone: number, x: number, y: number, z: number): [number, number, number] {
    const at = this.joint(bone);
    this.refresh(bone + 1);
    quatRotate(this.world, bone * 4, x, y, z, this.v, 0);
    return [at[0] + this.v[0]!, at[1] + this.v[1]!, at[2] + this.v[2]!];
  }

  /**
   * Bends the arm from `upper` so that its wrist is at (x, y, z) in model space, its elbow out toward (px, py, pz). A wrist
   * out of reach is reached for as far as the arm goes. Set the back and shoulders first.
   */
  reach(upper: number, x: number, y: number, z: number, px: number, py: number, pz: number): this {
    const lower = TOWARD[upper]!, hand = TOWARD[lower]!;
    const rest = HUMAN.rest;
    const span = (from: number, to: number): number => {
      const sx = rest[to * 3]! - rest[from * 3]!, sy = rest[to * 3 + 1]! - rest[from * 3 + 1]!, sz = rest[to * 3 + 2]! - rest[from * 3 + 2]!;
      return Math.sqrt(sx * sx + sy * sy + sz * sz);
    };
    const l1 = span(upper, lower), l2 = span(lower, hand);
    const from = this.joint(upper);
    let ux = x - from[0], uy = y - from[1], uz = z - from[2];
    const far = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= far;
    uy /= far;
    uz /= far;
    const d = Math.min((l1 + l2) * 0.998, Math.max(Math.abs(l1 - l2) + 0.01, far));
    const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sin = Math.sqrt(1 - cos * cos);
    // The elbow's way, square to the reach.
    const along = px * ux + py * uy + pz * uz;
    let ex = px - along * ux, ey = py - along * uy, ez = pz - along * uz;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    ex /= el;
    ey /= el;
    ez /= el;
    const ax = ux * cos + ex * sin, ay = uy * cos + ey * sin, az = uz * cos + ez * sin;
    this.aim(upper, ax, ay, az);
    return this.aim(lower, ux * d - ax * l1, uy * d - ay * l1, uz * d - az * l1);
  }

  /**
   * Puts the right hand's grip at (x, y, z) in model space with what it holds pointing ahead, tipped `tip` degrees down
   * and turned `swing` degrees to the body's left, the elbow out toward (px, py, pz).
   */
  grip(x: number, y: number, z: number, tip: number, swing: number, px: number, py: number, pz: number): this {
    this.level(B_HAND_R).turn(B_HAND_R, tip, swing);
    // The grip lies the same way from the wrist wherever the arm puts the wrist.
    const w = this.joint(B_HAND_R), g = this.joint(B_PROP_R);
    this.reach(B_UPPER_ARM_R, x - (g[0] - w[0]), y - (g[1] - w[1]), z - (g[2] - w[2]), px, py, pz);
    return this.level(B_HAND_R).turn(B_HAND_R, tip, swing);
  }

  /**
   * Puts the left hand's grip at (x, y, z) in model space, the hand turned from level as `turned` turns it, the elbow out
   * toward (px, py, pz). What it holds lies along its +Z.
   */
  palm(x: number, y: number, z: number, turned: (b: PoseBuilder) => void, px: number, py: number, pz: number): this {
    turned(this.level(B_HAND_L));
    const w = this.joint(B_HAND_L), g = this.joint(B_PROP_L);
    this.reach(B_UPPER_ARM_L, x - (g[0] - w[0]), y - (g[1] - w[1]), z - (g[2] - w[2]), px, py, pz);
    turned(this.level(B_HAND_L));
    return this;
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
