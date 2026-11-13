// The pose of a humanoid body, as a pure function.
//
// `humanPose(anim, state, tick, out)` depends on nothing else: no pose is
// carried from one tick to the next. The server evaluates it only when a shot
// passes near a body; every client evaluates it to draw. Because the state is
// the small set of whole numbers the server replicates, both get the same
// answer, and what is hit is what is seen.
//
// A body is a lower half that follows where it is going and an upper half that
// follows where it is looking. Gaits are loops stretched to a whole number of
// ticks; the position in a loop comes from the tick, offset per body so a crowd
// is not in step. Moving sideways or backward turns the hips toward the
// direction of travel (playing the gait in reverse when that is behind) and
// turns the spine back.

import { PI, TAU, clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";
import { quatAxis, quatMul, quatRotate } from "../math/quat.ts";
import { Pose, blendPose, sampleClip, type Clip, type ClipSet } from "./clip.ts";
import { B_CHEST, B_HEAD, B_HIPS, B_NECK, B_SPINE, B_UPPER_CHEST, HUMAN, HUMAN_BONES } from "./human.ts";

/** Body modes, as shared/sim/character.ts numbers them. */
const MODE_SWIM = 2;

export const STANCE_STAND = 0;
export const STANCE_CROUCH = 1;
export const STANCE_PRONE = 2;

/** Metres per second per unit of `AnimState.speed`. */
export const SPEED_STEP = 0.6;
export const SPEED_MAX = 15;
/** Steps in a full turn of `AnimState.dir`. */
export const DIR_STEPS = 16;
/** Steps of `AnimState.pitch` from level to straight up. */
export const PITCH_STEPS = 31;

/** Everything a pose depends on besides the tick. All whole numbers, as replicated. */
export class AnimState {
  mode = 1;
  grounded = true;
  /** Speed over the ground, 0..SPEED_MAX. */
  speed = 0;
  /** Direction of travel relative to facing, in sixteenths of a turn toward the body's left. */
  dir = 0;
  /** Where it looks: -PITCH_STEPS (down) to PITCH_STEPS (up). */
  pitch = 0;
  stance = STANCE_STAND;
  /** Ticks added to the clock, so that bodies are out of step with each other. */
  seed = 0;

  /** Set speed, direction and pitch from a velocity, a facing (radians) and a look pitch (radians). */
  setMotion(vx: number, vz: number, yaw: number, pitch: number): void {
    const s = detSin(yaw);
    const c = detCos(yaw);
    const forward = vx * s + vz * c;
    const left = vx * c - vz * s;
    const speed = Math.floor(Math.sqrt(vx * vx + vz * vz) / SPEED_STEP + 0.5);
    this.speed = speed > SPEED_MAX ? SPEED_MAX : speed;
    const turn = detAtan2(left, forward) / TAU;
    this.dir = this.speed === 0 ? 0 : (Math.floor(turn * DIR_STEPS + 0.5) + DIR_STEPS) % DIR_STEPS;
    this.pitch = clamp(Math.floor((pitch / (PI / 2)) * PITCH_STEPS + 0.5), -PITCH_STEPS, PITCH_STEPS);
  }
}

/** The clips a humanoid uses, found once by id. A missing clip leaves that part of the body at rest. */
export class HumanAnim {
  readonly set: ClipSet;
  readonly idle: Clip | null;
  readonly walk: Clip | null;
  readonly jog: Clip | null;
  readonly sprint: Clip | null;
  readonly fall: Clip | null;
  readonly swimIdle: Clip | null;
  readonly swim: Clip | null;
  readonly crouchIdle: Clip | null;
  readonly crouchWalk: Clip | null;

  constructor(set: ClipSet) {
    this.set = set;
    const find = (id: string): Clip | null => {
      const i = set.index.get(id);
      const clip = i === undefined ? null : set.clips[i]!;
      return clip && clip.bones === HUMAN_BONES ? clip : null;
    };
    this.idle = find("human/idle");
    this.walk = find("human/walk");
    this.jog = find("human/jog");
    this.sprint = find("human/sprint");
    this.fall = find("human/fall");
    this.swimIdle = find("human/swim_idle");
    this.swim = find("human/swim");
    this.crouchIdle = find("human/crouch_idle");
    this.crouchWalk = find("human/crouch_walk");
  }
}

/** Speeds at which each gait is played pure, metres per second, and the ticks one cycle of it takes. */
const WALK_SPEED = 1.8;
const JOG_SPEED = 4.2;
const SPRINT_SPEED = 7.2;
const WALK_TICKS = 32;
const JOG_TICKS = 22;
const SPRINT_TICKS = 18;
const CROUCH_SPEED = 1.5;
const CROUCH_TICKS = 34;
const SWIM_SPEED = 2.4;
/** The body pitches about this height when it swims up or down. */
const SWIM_PIVOT = 0.9;
/** Share of the look pitch taken by each of the three spine bones, the neck, and the head. */
const PITCH_SPINE = 0.14;
const PITCH_NECK = 0.2;
const PITCH_HEAD = 0.3;

const a = new Pose(HUMAN_BONES);
const b = new Pose(HUMAN_BONES);
const q = new Float64Array(4);
const v = new Float64Array(3);

/** A stretched loop: `cycle` ticks from start to start, backward when `reverse`. */
function gait(clip: Clip | null, cycle: number, tick: number, reverse: boolean, out: Pose): void {
  if (!clip) {
    out.rest();
    return;
  }
  let phase = tick / cycle;
  phase -= Math.floor(phase);
  sampleClip(clip, (reverse ? 1 - phase : phase) * clip.frames, out);
}

/** A loop at the rate it was made. */
function loop(clip: Clip | null, tick: number, out: Pose): void {
  if (!clip) out.rest();
  else sampleClip(clip, tick, out);
}

/** Turn bone `bone` by `angle` about the axis (ax, ay, az) of its parent's space. */
function turn(pose: Pose, bone: number, ax: number, ay: number, az: number, angle: number): void {
  if (angle === 0) return;
  quatAxis(q, 0, ax, ay, az, angle);
  quatMul(pose.rot, bone * 4, q, 0, pose.rot, bone * 4);
}

/** The pose at `tick` (which may fall between ticks, for drawing) into `out`. */
export function humanPose(anim: HumanAnim, st: AnimState, tick: number, out: Pose): void {
  const t = tick + st.seed;
  const speed = st.speed * SPEED_STEP;
  // Travelling backward plays the gait in reverse with the hips turned the other way.
  let twist = st.dir <= DIR_STEPS / 2 ? st.dir : st.dir - DIR_STEPS;
  const reverse = twist > DIR_STEPS / 4 || twist < -DIR_STEPS / 4;
  if (reverse) twist = twist > 0 ? twist - DIR_STEPS / 2 : twist + DIR_STEPS / 2;
  let twistAngle = (twist / DIR_STEPS) * TAU;
  const pitch = (st.pitch / PITCH_STEPS) * (PI / 2);
  let bodyPitch = 0;

  if (st.mode === MODE_SWIM) {
    loop(anim.swimIdle, t, a);
    loop(anim.swim, t, b);
    const k = clamp(speed / SWIM_SPEED, 0, 1);
    blendPose(out, a, b, k);
    // Swimming where it looks: the whole body tips, more the faster it goes.
    bodyPitch = pitch * k;
    twistAngle = 0;
  } else if (!st.grounded) {
    loop(anim.fall, t, out);
    twistAngle = 0;
  } else if (st.stance === STANCE_CROUCH) {
    loop(anim.crouchIdle, t, a);
    gait(anim.crouchWalk, CROUCH_TICKS, t, reverse, b);
    blendPose(out, a, b, clamp(speed / CROUCH_SPEED, 0, 1));
  } else if (speed <= 0) {
    loop(anim.idle, t, out);
    twistAngle = 0;
  } else if (speed < WALK_SPEED) {
    loop(anim.idle, t, a);
    gait(anim.walk, WALK_TICKS, t, reverse, b);
    blendPose(out, a, b, speed / WALK_SPEED);
  } else if (speed < JOG_SPEED) {
    gait(anim.walk, WALK_TICKS, t, reverse, a);
    gait(anim.jog, JOG_TICKS, t, reverse, b);
    blendPose(out, a, b, (speed - WALK_SPEED) / (JOG_SPEED - WALK_SPEED));
  } else {
    gait(anim.jog, JOG_TICKS, t, reverse, a);
    gait(anim.sprint, SPRINT_TICKS, t, reverse, b);
    blendPose(out, a, b, clamp((speed - JOG_SPEED) / (SPRINT_SPEED - JOG_SPEED), 0, 1));
  }

  if (twistAngle !== 0) {
    // Hips toward the direction of travel, the spine back to where the body faces.
    turnRoot(out, 0, 1, 0, twistAngle, 0);
    turn(out, B_SPINE, 0, 1, 0, -twistAngle / 3);
    turn(out, B_CHEST, 0, 1, 0, -twistAngle / 3);
    turn(out, B_UPPER_CHEST, 0, 1, 0, -twistAngle / 3);
  }
  if (bodyPitch !== 0) turnRoot(out, 1, 0, 0, -bodyPitch, SWIM_PIVOT);
  const look = pitch - bodyPitch;
  if (look !== 0) {
    // Looking up is a turn toward -X's right-hand sense: +Z rises toward +Y.
    turn(out, B_SPINE, 1, 0, 0, -look * PITCH_SPINE);
    turn(out, B_CHEST, 1, 0, 0, -look * PITCH_SPINE);
    turn(out, B_UPPER_CHEST, 1, 0, 0, -look * PITCH_SPINE);
    turn(out, B_NECK, 1, 0, 0, -look * PITCH_NECK);
    turn(out, B_HEAD, 1, 0, 0, -look * PITCH_HEAD);
  }
}

/** Turn the whole body about an axis through (0, pivotY, 0) of the model. */
function turnRoot(pose: Pose, ax: number, ay: number, az: number, angle: number, pivotY: number): void {
  quatAxis(q, 0, ax, ay, az, angle);
  quatMul(pose.rot, B_HIPS * 4, q, 0, pose.rot, B_HIPS * 4);
  const rest = HUMAN.rest;
  const x = rest[0]! + pose.root[0]!;
  const y = rest[1]! + pose.root[1]! - pivotY;
  const z = rest[2]! + pose.root[2]!;
  quatRotate(q, 0, x, y, z, v, 0);
  pose.root[0] = v[0]! - rest[0]!;
  pose.root[1] = v[1]! + pivotY - rest[1]!;
  pose.root[2] = v[2]! - rest[2]!;
}
