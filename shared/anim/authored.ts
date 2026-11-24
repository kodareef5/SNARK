// Clips written as code, for motions the animation libraries lack. A pose says where each bone points in model space.
// The builder uses only exactly rounded arithmetic, so the clips are the same bits on every engine.

import { quatAxis, quatCopy, quatMul, quatMulConj, quatNormalize, quatRotate } from "../math/quat.ts";
import { TAU, detSin } from "../math/scalar.ts";
import { Pose, type Clip } from "./clip.ts";
import { emoteClips } from "./emote-clips.ts";
import { glideClips } from "./glide-clips.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK,
  B_PROP_L, B_PROP_R, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES,
} from "./human.ts";

const DEG = TAU / 360;

/** A limb bone's rest axis runs from its joint to the joint of the bone it maps to. */
const TOWARD: Readonly<Record<number, number>> = {
  [B_UPPER_ARM_L]: B_LOWER_ARM_L, [B_LOWER_ARM_L]: B_HAND_L, [B_UPPER_ARM_R]: B_LOWER_ARM_R, [B_LOWER_ARM_R]: B_HAND_R,
  [B_UPPER_LEG_L]: B_LOWER_LEG_L, [B_LOWER_LEG_L]: B_FOOT_L, [B_UPPER_LEG_R]: B_LOWER_LEG_R, [B_LOWER_LEG_R]: B_FOOT_R,
};

/** Builds one pose. Set bones from the hips outward, because turning a parent carries its children with it. */
export class PoseBuilder {
  readonly pose = new Pose(HUMAN_BONES);
  /** Model-space rotation of each bone. */
  private readonly world = new Float64Array(HUMAN_BONES * 4);
  private readonly q = new Float64Array(4);
  private readonly v = new Float64Array(3);

  constructor() {
    this.refresh(0);
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

  /** The joint's position in model space, for the pose so far. */
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

  /** The model-space place of a point given from `bone`'s joint in its rest frame, for the pose so far. */
  point(bone: number, x: number, y: number, z: number): [number, number, number] {
    const at = this.joint(bone);
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

  private refresh(from: number): void {
    for (let b = from; b < HUMAN_BONES; b++) {
      const p = HUMAN.parent[b]!;
      if (p < 0) quatCopy(this.world, b * 4, this.pose.rot, b * 4);
      else quatMul(this.world, b * 4, this.world, p * 4, this.pose.rot, b * 4);
    }
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

// A launcher is a tube a metre long whose axis is 9 cm over its grip, from 52 cm behind it to 50 cm ahead, with a fore grip
// 22 cm ahead and a pad for the shoulder 25 cm behind (content: core:rocket_launcher). Its round goes in at the muzzle.
const TUBE_UP = 0.09;
const FORE_GRIP = 0.22;
/**
 * Where along the tube from the grip the off hand holds a round whose tail is at the muzzle, and one pushed home: the hand
 * has it ROUND_HELD from its tail, and home its tail is 30 cm ahead of the grip (the launcher's `round`).
 */
export const ROUND_HELD = 0.28;
export const ROUND_SLIDE = 0.2;
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
  ]);
}
