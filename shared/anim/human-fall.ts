// A survivor knocked off its feet goes limp as a ragdoll (HUMAN_RAGDOLL) and gets up where it comes to rest. The server
// lays it and every client lays the same one: from one standing pose, built here without any clip so a server without
// art agrees, at the place and facing its entity is sent with. Its state is then sent as a corpse's is (S_CORPSE), so a
// client steps it whole ticks from there exactly as the server does.

import { detCos, detSin } from "../math/scalar.ts";
import { Pose } from "./clip.ts";
import { B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_RAGDOLL } from "./human.ts";
import { Ragdoll } from "./ragdoll.ts";
import { Solved, solve } from "./skeleton.ts";

/** Radians the arms hang below the T-pose as the body goes limp. */
const ARMS_DOWN = 1.3;

let standing: Solved | null = null;

/** The pose a survivor goes limp from: standing, arms at its sides. */
export function standingPose(): Solved {
  if (standing) return standing;
  const pose = new Pose(HUMAN.bones);
  const s = detSin(ARMS_DOWN / 2), c = detCos(ARMS_DOWN / 2);
  // The left arm points along +X: a turn about +Z by minus the angle lowers it, and the right's mirror raises it the other way.
  pose.rot.set([0, 0, -s, c], B_UPPER_ARM_L * 4);
  pose.rot.set([0, 0, s, c], B_UPPER_ARM_R * 4);
  standing = new Solved(HUMAN.bones);
  solve(HUMAN, pose, standing);
  return standing;
}

/** The ragdoll of a survivor going limp standing at (x, y, z) facing `yaw` radians, as the wire has them. */
export function layHuman(x: number, y: number, z: number, yaw: number): Ragdoll {
  const now = standingPose();
  const r = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  r.start(now, now, x, y, z, yaw, 1);
  return r;
}
