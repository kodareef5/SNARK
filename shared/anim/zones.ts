// What a ray hits on a body standing in the world.
//
// The one place where a pose becomes a hit: the body is posed for the moment
// asked about, the ray is carried into the body's own space, and the skeleton's
// boxes are tested. The server calls this for the few bodies a shot passes
// near; nothing is posed for a body nobody shoots at.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { Pose } from "./clip.ts";
import { HUMAN, HUMAN_BONES } from "./human.ts";
import { humanPose, type AnimState, type HumanAnim } from "./pose.ts";
import { Solved, rayZones, solve, zoneHit } from "./skeleton.ts";

const pose = new Pose(HUMAN_BONES);
const solved = new Solved(HUMAN_BONES);

/** Height above a body's feet of the sphere that holds every pose it can take, and that sphere's radius. */
export const BODY_REACH_Y = 0.9;
export const BODY_REACH = 1.75;

/**
 * The zone a ray hits on a humanoid body, or 0. The body stands at (bx, by, bz)
 * facing `yaw` (1/65536 turns) in the state `st` at `tick`. The ray starts at
 * (ox, oy, oz) and runs along the unit direction (dx, dy, dz) no farther than
 * `maxT`. `zoneHit` holds the bone and the distance.
 */
export function rayBody(anim: HumanAnim, st: AnimState, tick: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  // Cheap rejection first: most rays pass nowhere near.
  const cx = bx - ox;
  const cy = by + BODY_REACH_Y - oy;
  const cz = bz - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const off2 = cx * cx + cy * cy + cz * cz - along * along;
  if (off2 > BODY_REACH * BODY_REACH || along < -BODY_REACH || along > maxT + BODY_REACH) {
    zoneHit.zone = 0;
    zoneHit.bone = -1;
    zoneHit.t = maxT;
    return 0;
  }
  humanPose(anim, st, tick, pose);
  solve(HUMAN, pose, solved);
  // Into the body's space: undo its place, then its yaw (x' = c x + s z, z' = c z - s x).
  const a = (yaw * TAU) / 65536;
  const s = detSin(a);
  const c = detCos(a);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(HUMAN, solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT);
}

/** The zone of the hit box a bone's geometry is covered by: its own, or the nearest ancestor's that has one. */
export function zoneOfBone(bone: number): number {
  let b = bone;
  while (b >= 0 && HUMAN.zone[b] === 0) b = HUMAN.parent[b]!;
  return b < 0 ? 0 : HUMAN.zone[b]!;
}
