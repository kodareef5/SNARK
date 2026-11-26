// The viewer's own arms in first person. Its body is the body everyone sees, pushed back from the eye, so a blow posed
// for the body would land where the push-back and the stance happen to leave it. Here the wrists of a blow or a carried
// tool go where the move says they are seen (a key's `eye` in shared/anim/strikes.ts), whatever the pitch or stance.
// Only what this client draws of itself: the server and every other client keep the shared pose.

import { PoseBuilder } from "../../../shared/anim/pose-builder.ts";
import { blendPose, type Pose } from "../../../shared/anim/clip.ts";
import { B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_PROP_L, B_PROP_R, B_SHOULDER_L, B_SHOULDER_R, B_UPPER_LEG_L, HUMAN } from "../../../shared/anim/human.ts";
import { actElapsed, smooth, swingShare, type AnimState } from "../../../shared/anim/pose.ts";
import { CARRY_MOVE, SAMPLE, poseArm, sampleMove, strikeMove, type EyeFrame } from "../../../shared/anim/strikes.ts";
import { JET_FIST, MODE_WALK } from "../../../shared/sim/character.ts";
import { ACT_EQUIP, ACT_SWING, EQUIP_TICKS, HOLD_HANDS, HOLD_TOOL, SWING_TICKS } from "../../../shared/sim/weapon.ts";

/** Metres a carried hand rides up and down, and side to side, with a full stride; and the speed it rides that far at. */
const RIDE_UP = 0.012;
const RIDE_SIDE = 0.007;
const RIDE_SPEED = 4;

const builder = new PoseBuilder();
const sample = new Float64Array(SAMPLE);
const eye: EyeFrame = { y: 0, ahead: 0, sin: 0, cos: 1, left: 0, up: 0, width: 1, height: 1 };

/** Fists stay raised between blows and lower over eight ticks after the last. */
export class PunchGuard {
  private last = -Infinity;
  private lift = 0;

  step(tick: number, punching: boolean, elapsed: number): number {
    const dt = tick - this.last;
    if (dt < 0 || dt > SWING_TICKS) this.lift = 0;
    this.last = tick;
    if (punching) this.lift = Math.min(1, this.lift + Math.min(Math.max(0, dt), elapsed) / 1.5);
    else this.lift = Math.max(0, this.lift - Math.max(0, dt) / 8);
    return smooth(this.lift);
  }

  lower(): void {
    this.lift = 0;
    this.last = -Infinity;
  }
}

/**
 * Puts the arms of `pose` where its own eye sees them, for a blow or a carried tool, and says whether it changed
 * any. The eye is `eyeY` over the body's origin and `ahead` of it, pitched `pitch` radians up; `phase` and `speed` are
 * its gait's.
 */
export function ownArms(pose: Pose, st: AnimState, tick: number, eyeY: number, ahead: number, pitch: number, phase: number, speed: number, guard?: PunchGuard, rest = HUMAN.rest, halfFov = 35 * Math.PI / 180, aspect = 16 / 9): boolean {
  const act = st.action & 7, hold = st.action >>> 3;
  const bare = hold === HOLD_HANDS;
  const fist = bare && !(st.jet && st.jetMode === JET_FIST);
  const canPose = st.mode === MODE_WALK && !st.emote && !(st.glide && !st.grounded);
  if (!canPose || !fist) guard?.lower();
  if (!canPose || (!fist && hold !== HOLD_TOOL)) return false;
  const e = actElapsed(st, tick);
  const swing = act === ACT_SWING ? strikeMove(hold, st.pick, (st.actionStart & 1) !== 0) : null;
  const k = swing ? swingShare(e) : 0;
  const left = fist ? (guard?.step(tick, !!swing, e) ?? k) : k;
  const right = bare ? left : act === ACT_EQUIP ? smooth(e / EQUIP_TICKS) : 1;
  if (right <= 0 && left <= 0) return false;
  const move = swing ?? (fist ? strikeMove(HOLD_HANDS, false, false)! : CARRY_MOVE);
  sampleMove(move, swing ? e : 0, sample);
  const ride = Math.min(1, speed / RIDE_SPEED) * (st.grounded ? 1 : 0);
  const aperture = Math.tan(halfFov) / Math.tan(35 * Math.PI / 180);
  eye.width = Math.min(1, aperture * aspect / (16 / 9));
  eye.height = Math.min(1, aperture);
  eye.y = eyeY;
  eye.ahead = ahead;
  eye.sin = Math.sin(pitch);
  eye.cos = Math.cos(pitch);
  eye.up = Math.sin(phase * 4 * Math.PI) * RIDE_UP * ride;
  eye.left = Math.sin(phase * 2 * Math.PI) * RIDE_SIDE * ride;
  const b = builder.from(pose, rest);
  poseArm(b, move, sample, -1, eye);
  if (left > 0) poseArm(b, move, sample, 1, eye);
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
