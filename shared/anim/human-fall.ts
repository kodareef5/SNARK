// A survivor knocked off its feet goes limp as a ragdoll (HUMAN_RAGDOLL) and gets up where it comes to rest. The server
// lays it and every client lays the same one: from one standing pose, built here without any clip so a server without
// art agrees, at the place and facing its entity is sent with. Its state is then sent as a corpse's is (S_CORPSE), so a
// client steps it whole ticks from there exactly as the server does.

import { detCos, detSin } from "../math/scalar.ts";
import { quatRotate } from "../math/quat.ts";
import { PoseBuilder } from "./authored.ts";
import { Pose } from "./clip.ts";
import { B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_RAGDOLL } from "./human.ts";
import { Ragdoll } from "./ragdoll.ts";
import { Solved, solve } from "./skeleton.ts";

/** Radians the arms hang below the T-pose as the body goes limp. */
const ARMS_DOWN = 1.3;
/** Metres the hips' joint lies above the ground in the lying pose: about the torso's radius. */
const LYING_HIPS = 0.13;

let standing: Solved | null = null;
let lying: Solved | null = null;

/** The arms at the sides: the left arm points along +X, and a turn about +Z by minus the angle lowers it. */
function armsDown(pose: Pose): void {
  const s = detSin(ARMS_DOWN / 2), c = detCos(ARMS_DOWN / 2);
  pose.rot.set([0, 0, -s, c], B_UPPER_ARM_L * 4);
  pose.rot.set([0, 0, s, c], B_UPPER_ARM_R * 4);
}

/** The pose a survivor goes limp from: standing, arms at its sides. */
export function standingPose(): Solved {
  if (standing) return standing;
  const pose = new Pose(HUMAN.bones);
  armsDown(pose);
  standing = new Solved(HUMAN.bones);
  solve(HUMAN, pose, standing);
  return standing;
}

/** The pose one lying prone or knocked out goes limp from: face down along its facing, arms at its sides. */
export function lyingPose(): Solved {
  if (lying) return lying;
  const pose = new Pose(HUMAN.bones);
  armsDown(pose);
  // A quarter turn about +X tips the head forward onto +Z, face down.
  const q = detSin(Math.PI / 4);
  pose.rot.set([q, 0, 0, q], B_HIPS * 4);
  pose.root[1] = LYING_HIPS - HUMAN.rest[B_HIPS * 3 + 1]!;
  lying = new Solved(HUMAN.bones);
  solve(HUMAN, pose, lying);
  return lying;
}

/** The ragdoll of a survivor going limp at (x, y, z) facing `yaw` radians, as the wire has them: standing, or `down` lying. */
export function layHuman(x: number, y: number, z: number, yaw: number, down = false): Ragdoll {
  const now = down ? lyingPose() : standingPose();
  const r = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  r.start(now, now, x, y, z, yaw, 1);
  return r;
}

/** A falling survivor's limbs spring toward bracing at this frequency, in radians a second, with this damping. */
const BRACE_OMEGA = 28;
const BRACE_ZETA = 0.8;
/** The chest's speed, metres a second, below which it does not brace at all and above which it braces fully. */
const BRACE_SLOW = 0.3;
const BRACE_FAST = 1.5;

let braces: { forward: Float64Array; back: Float64Array } | null = null;
const aims = new Float64Array(HUMAN_RAGDOLL.bone.length * 4);
const forward = new Float64Array(3);

/** Each body's turn against its parent body in `pose`, four numbers a body. */
function turns(pose: Pose, parent: Int16Array): Float64Array {
  const solved = new Solved(HUMAN.bones), out = new Float64Array(parent.length * 4);
  solve(HUMAN, pose, solved);
  const rot = solved.rot;
  for (let i = 0; i < parent.length; i++) {
    const p = parent[i]!, b = HUMAN_RAGDOLL.bone[i]! * 4;
    if (p < 0) { out[i * 4 + 3] = 1; continue; }
    const a = HUMAN_RAGDOLL.bone[p]! * 4;
    // conj(parent) * child
    const ax = -rot[a]!, ay = -rot[a + 1]!, az = -rot[a + 2]!, aw = rot[a + 3]!;
    const bx = rot[b]!, by = rot[b + 1]!, bz = rot[b + 2]!, bw = rot[b + 3]!;
    out[i * 4] = aw * bx + ax * bw + ay * bz - az * by;
    out[i * 4 + 1] = aw * by - ax * bz + ay * bw + az * bx;
    out[i * 4 + 2] = aw * bz + ax * by - ay * bx + az * bw;
    out[i * 4 + 3] = aw * bw - ax * bx - ay * by - az * bz;
  }
  return out;
}

/** Thrown forward: arms out ahead and down to catch the ground, head up, knees giving. Thrown back: arms behind, chin tucked, knees drawn up. */
function bracePoses(parent: Int16Array): { forward: Float64Array; back: Float64Array } {
  const ahead = new PoseBuilder()
    .aim(B_UPPER_ARM_L, 0.35, -0.45, 1).aim(B_LOWER_ARM_L, 0.15, -0.6, 1)
    .aim(B_UPPER_ARM_R, -0.35, -0.45, 1).aim(B_LOWER_ARM_R, -0.15, -0.6, 1)
    .turn(B_HEAD, -20)
    .aim(B_UPPER_LEG_L, 0.05, -1, 0.25).aim(B_LOWER_LEG_L, 0.05, -1, -0.2)
    .aim(B_UPPER_LEG_R, -0.05, -1, 0.25).aim(B_LOWER_LEG_R, -0.05, -1, -0.2);
  const behind = new PoseBuilder()
    .aim(B_UPPER_ARM_L, 0.5, -0.75, -0.55).aim(B_LOWER_ARM_L, 0.25, -0.9, -0.3)
    .aim(B_UPPER_ARM_R, -0.5, -0.75, -0.55).aim(B_LOWER_ARM_R, -0.25, -0.9, -0.3)
    .turn(B_HEAD, 30)
    .aim(B_UPPER_LEG_L, 0.05, -0.7, 0.7).aim(B_LOWER_LEG_L, 0.05, -1, -0.1)
    .aim(B_UPPER_LEG_R, -0.05, -0.7, 0.7).aim(B_LOWER_LEG_R, -0.05, -1, -0.1);
  return { forward: turns(ahead.pose, parent), back: turns(behind.pose, parent) };
}

/**
 * A living survivor thrown off its feet braces for the ground (Fall.reflex): its limbs spring toward catching itself the
 * way it is going, harder the faster its chest moves, and it goes limp as it comes to rest. Worked out from the ragdoll's
 * own state, so every client braces exactly as the server does.
 */
export function brace(r: Ragdoll): void {
  const { q } = r, chest = 1;
  r.relativeVelocity(chest, forward);
  const vx = forward[0]!, vy = forward[1]!, vz = forward[2]!;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const w = speed <= BRACE_SLOW ? 0 : speed >= BRACE_FAST ? 1 : (speed - BRACE_SLOW) / (BRACE_FAST - BRACE_SLOW);
  if (w === 0) {
    r.driveOmega.fill(0);
    return;
  }
  braces ??= bracePoses(r.parent);
  // How much of its flat motion is toward the way its chest faces: 1 thrown forward, 0 thrown back.
  quatRotate(q, chest * 4, 0, 0, 1, forward, 0);
  const flat = Math.sqrt(vx * vx + vz * vz);
  const ahead = flat > 1e-6 ? (vx * forward[0]! + vz * forward[2]!) / flat : 0;
  const t = (ahead + 1) / 2;
  const { forward: f, back: b } = braces;
  for (let i = 0; i < r.n; i++) {
    const o = i * 4;
    const sign = b[o]! * f[o]! + b[o + 1]! * f[o + 1]! + b[o + 2]! * f[o + 2]! + b[o + 3]! * f[o + 3]! < 0 ? -1 : 1;
    let l = 0;
    for (let k = 0; k < 4; k++) {
      aims[o + k] = b[o + k]! + (f[o + k]! * sign - b[o + k]!) * t;
      l += aims[o + k]! * aims[o + k]!;
    }
    l = 1 / Math.sqrt(l);
    for (let k = 0; k < 4; k++) aims[o + k]! *= l;
    r.driveOmega[i] = r.parent[i]! >= 0 ? BRACE_OMEGA * w : 0;
    r.driveZeta[i] = BRACE_ZETA;
  }
  r.driveTo(aims);
  r.lift = 0;
}
