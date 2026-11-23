// A survivor knocked off its feet goes limp as a ragdoll (HUMAN_RAGDOLL) and gets up where it comes to rest. The server
// lays it and every client lays the same one: from one standing pose, built here without any clip so a server without
// art agrees, at the place and facing its entity is sent with. Its state is then sent as a corpse's is (S_CORPSE), so a
// client steps it whole ticks from there exactly as the server does.

import { detCos, detSin } from "../math/scalar.ts";
import { Pose } from "./clip.ts";
import { B_HIPS, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_RAGDOLL } from "./human.ts";
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
