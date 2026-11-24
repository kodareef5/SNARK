// The viewer's own arms in first person. Its body is the body everyone sees, pushed back from the eye, so a blow posed
// for the body would land where the push-back and the stance happen to leave it. Here the wrists of a blow or a carried
// tool go where the move says they are seen (a key's `eye` in shared/anim/strikes.ts), whatever the pitch or stance.
// Only what this client draws of itself: the server and every other client keep the shared pose.

import { PoseBuilder } from "../../../shared/anim/authored.ts";
import { blendPose, type Pose } from "../../../shared/anim/clip.ts";
import { B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_PROP_L, B_PROP_R, B_SHOULDER_L, B_SHOULDER_R, B_UPPER_LEG_L } from "../../../shared/anim/human.ts";
import { actElapsed, smooth, swingShare, type AnimState } from "../../../shared/anim/pose.ts";
import { CARRY_MOVE, SAMPLE, poseArm, sampleMove, strikeMove, type EyeFrame } from "../../../shared/anim/strikes.ts";
import { JET_FIST, MODE_WALK } from "../../../shared/sim/character.ts";
import { ACT_EQUIP, ACT_SWING, EQUIP_TICKS, HOLD_HANDS, HOLD_TOOL } from "../../../shared/sim/weapon.ts";

/** Metres a carried hand rides up and down, and side to side, with a full stride; and the speed it rides that far at. */
const RIDE_UP = 0.012;
const RIDE_SIDE = 0.007;
const RIDE_SPEED = 4;

const builder = new PoseBuilder();
const sample = new Float64Array(SAMPLE);
const eye: EyeFrame = { y: 0, ahead: 0, sin: 0, cos: 1, left: 0, up: 0 };

/**
 * Puts the arms of `pose` where its own eye sees them, for a blow or a carried tool, and says whether it changed
 * any. The eye is `eyeY` over the body's origin and `ahead` of it, pitched `pitch` radians up; `phase` and `speed` are
 * its gait's.
 */
export function ownArms(pose: Pose, st: AnimState, tick: number, eyeY: number, ahead: number, pitch: number, phase: number, speed: number): boolean {
  const act = st.action & 7, hold = st.action >>> 3;
  if (st.mode !== MODE_WALK || st.emote !== 0 || (st.glide && !st.grounded)) return false;
  if (hold !== HOLD_HANDS && hold !== HOLD_TOOL) return false;
  // A jet's fist has its own reach (jetPunch).
  if (st.jet && st.jetMode === JET_FIST && hold === HOLD_HANDS) return false;
  const e = actElapsed(st, tick);
  const swing = act === ACT_SWING ? strikeMove(hold, st.pick, (st.actionStart & 1) !== 0) : null;
  const k = swing ? swingShare(e) : 0;
  // A tool's hand is placed whenever it is carried; the other hand, and both of bare hands, only through a blow.
  const right = hold === HOLD_TOOL ? (act === ACT_EQUIP ? smooth(e / EQUIP_TICKS) : 1) : k;
  const left = k;
  if (right <= 0 && left <= 0) return false;
  const move = swing ?? CARRY_MOVE;
  sampleMove(move, swing ? e : 0, sample);
  const ride = Math.min(1, speed / RIDE_SPEED) * (st.grounded ? 1 : 0);
  eye.y = eyeY;
  eye.ahead = ahead;
  eye.sin = Math.sin(pitch);
  eye.cos = Math.cos(pitch);
  eye.up = Math.sin(phase * 4 * Math.PI) * RIDE_UP * ride;
  eye.left = Math.sin(phase * 2 * Math.PI) * RIDE_SIDE * ride;
  const b = builder.from(pose);
  poseArm(b, move, sample, -1, eye);
  poseArm(b, move, sample, 1, eye);
  arm(pose, b.pose, right, B_SHOULDER_R, B_UPPER_LEG_L, B_FINGERS_R, B_PROP_R, B_FINGERTIPS_R);
  arm(pose, b.pose, left, B_SHOULDER_L, B_SHOULDER_R, B_FINGERS_L, B_PROP_L, B_FINGERTIPS_L);
  return true;
}

/** Takes one arm of `from` into `pose` by `share`: its bones up to `to`, its fingers and thumb, its prop and its fingertips. */
function arm(pose: Pose, from: Pose, share: number, first: number, to: number, fingers: number, prop: number, tips: number): void {
  if (share <= 0) return;
  blendPose(pose, pose, from, share, first, to);
  blendPose(pose, pose, from, share, fingers, fingers + 2);
  blendPose(pose, pose, from, share, prop, prop + 1);
  blendPose(pose, pose, from, share, tips, tips + 1);
}
