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
export function rayBody(anim: HumanAnim, st: AnimState, tick: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  // Most rays miss the bounding sphere, so test that first.
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
  // Move the ray into the body's space by undoing its position, then its yaw. Yaw is x' = c x + s z, z' = c z - s x.
  const a = (yaw * TAU) / 65536;
  const s = detSin(a);
  const c = detCos(a);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(HUMAN, solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT);
}

/**
 * As rayBody, for a body astride a saddle in the seat frame `frame` (seatFrame's numbers): its rider with its hands on the
 * grips, a passenger (`driver` false) with its upper body as `st` poses it, as every client draws them.
 */
export function raySeated(anim: HumanAnim, st: AnimState, tick: number, frame: Float64Array, driver: boolean, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const cx = frame[0]! + frame[4]! * BODY_REACH_Y - ox;
  const cy = frame[1]! + frame[7]! * BODY_REACH_Y - oy;
  const cz = frame[2]! + frame[10]! * BODY_REACH_Y - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const off2 = cx * cx + cy * cy + cz * cz - along * along;
  if (off2 > BODY_REACH * BODY_REACH || along < -BODY_REACH || along > maxT + BODY_REACH) {
    zoneHit.zone = 0;
    zoneHit.bone = -1;
    zoneHit.t = maxT;
    return 0;
  }
  if (!driver) humanPose(anim, st, tick, pose);
  mountPose(motion, driver ? { role: "ride", tick: 0, startTick: 0, durationTicks: 1 } : { role: "ride", tick: 0, startTick: 0, durationTicks: 1, upper: pose }, pose);
  solve(HUMAN, pose, solved);
  // Into the seat's frame: the frame's turn undone, which is its transpose.
  const rx = ox - frame[0]!;
  const ry = oy - frame[1]!;
  const rz = oz - frame[2]!;
  const f = frame;
  return rayZones(HUMAN, solved,
    f[3]! * rx + f[6]! * ry + f[9]! * rz, f[4]! * rx + f[7]! * ry + f[10]! * rz, f[5]! * rx + f[8]! * ry + f[11]! * rz,
    f[3]! * dx + f[6]! * dy + f[9]! * dz, f[4]! * dx + f[7]! * dy + f[10]! * dz, f[5]! * dx + f[8]! * dy + f[11]! * dz, maxT);
}

/** A bone without a capsule takes the zone of its nearest ancestor that has one. */
export function zoneOfBone(bone: number): number {
  let b = bone;
  while (b >= 0 && HUMAN.zone[b] === 0) b = HUMAN.parent[b]!;
  return b < 0 ? 0 : HUMAN.zone[b]!;
}
