// A humanoid pose becomes a hit here. The server poses only the few bodies a shot passes near.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { Pose } from "./clip.ts";
import { HUMAN, HUMAN_BONES } from "./human.ts";
import { createMountMotion, mountPose } from "./mount.ts";
import { humanPose, type AnimState, type HumanAnim } from "./pose.ts";
import { Solved, rayZones, solve, zoneHit } from "./skeleton.ts";

const pose = new Pose(HUMAN_BONES);
const solved = new Solved(HUMAN_BONES);
const motion = createMountMotion();

/** The sphere that holds every pose a body can take: its height above the feet, and its radius. */
export const BODY_REACH_Y = 0.9;
export const BODY_REACH = 1.75;

/**
 * Returns the zone a ray hits, or 0. The body stands at (bx, by, bz) facing `yaw` (1/65536 turns). The ray starts at
 * (ox, oy, oz) and runs along the unit direction (dx, dy, dz) no farther than `maxT`. `zoneHit` holds the bone and the distance.
 */
export function rayBody(anim: HumanAnim, st: AnimState, tick: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, padding = 0, impaled = false, lying: Solved | null = null): number {
  // Most rays miss the bounding sphere, so test that first.
  const cx = bx - ox;
  const cy = by + BODY_REACH_Y - oy;
  const cz = bz - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const off2 = cx * cx + cy * cy + cz * cz - along * along;
  if (off2 > (BODY_REACH + padding) * (BODY_REACH + padding) || along < -BODY_REACH - padding || along > maxT + BODY_REACH + padding) {
    zoneHit.zone = 0;
    zoneHit.bone = -1;
    zoneHit.t = maxT;
    return 0;
  }
  // A body knocked down is hit as its ragdoll lies (server/falls.ts).
  if (lying) {
    solved.rot.set(lying.rot);
    solved.pos.set(lying.pos);
  } else {
    if (impaled) mountPose(motion, { role: "impaled", tick: 0, startTick: 0, durationTicks: 1 }, pose);
    else humanPose(anim, st, tick, pose);
    solve(HUMAN, pose, solved);
  }
  // Move the ray into the body's space by undoing its position, then its yaw. Yaw is x' = c x + s z, z' = c z - s x.
  const a = (yaw * TAU) / 65536;
  const s = detSin(a);
  const c = detCos(a);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(HUMAN, solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT, padding);
}

/** A bone without a capsule takes the zone of its nearest ancestor that has one. */
export function zoneOfBone(bone: number): number {
  let b = bone;
  while (b >= 0 && HUMAN.zone[b] === 0) b = HUMAN.parent[b]!;
  return b < 0 ? 0 : HUMAN.zone[b]!;
}
