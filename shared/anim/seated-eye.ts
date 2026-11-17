import { Pose } from "./clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES } from "./human.ts";
import { createMountMotion, mountPose } from "./mount.ts";
import { humanPose, type AnimState, type HumanAnim } from "./pose.ts";
import { boneToModel, Solved, solve } from "./skeleton.ts";

const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), point = new Float64Array(3);
const motion = createMountMotion();

/** Current saddle pose, matching raySeated: oxygen follows the head, including a banked seat and passenger look. */
export function seatedEye(anim: HumanAnim, st: AnimState, tick: number, frame: Float64Array, driver: boolean, out: Float64Array): void {
  if (!driver) humanPose(anim, st, tick, pose);
  mountPose(motion, driver ? { role: "ride", tick: 0, startTick: 0, durationTicks: 1 } : { role: "ride", tick: 0, startTick: 0, durationTicks: 1, upper: pose }, pose);
  solve(HUMAN, pose, solved);
  // Centre of HUMAN's head capsule, at eye height. Do not use the crouching capsule's eye offset.
  boneToModel(solved, B_HEAD, 0, .095, .017, point);
  for (let axis = 0; axis < 3; axis++) {
    const row = 3 + axis * 3;
    out[axis] = frame[axis]! + frame[row]! * point[0]! + frame[row + 1]! * point[1]! + frame[row + 2]! * point[2]!;
  }
}
