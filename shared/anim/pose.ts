// humanPose is a pure function of the replicated AnimState and the tick, so the server's hit test and every client's
// drawing get the same pose. The lower body follows the direction of travel and the upper body follows the look.

import { PI, TAU, clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";
import { quatAxis, quatMul, quatRotate } from "../math/quat.ts";
import { Pose, blendPose, sampleClip, type Clip, type ClipSet } from "./clip.ts";
import { B_CHEST, B_FINGERS_L, B_HEAD, B_HIPS, B_NECK, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_UPPER_CHEST, B_UPPER_LEG_L, HUMAN, HUMAN_BONES } from "./human.ts";

import { MODE_SWIM, MODE_WALK, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND } from "../sim/character.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, EQUIP_TICKS, HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_THROW, SWING_TICKS } from "../sim/weapon.ts";

/** The three parts of a packed AnimState. Replication sends each part only when it changes. */
export const ANIM_MOTION_BITS = 12;
export const ANIM_LOOK_BITS = 6;
export const ANIM_ACTION_BITS = 14;
export const ANIM_MOTION_MASK = 0xfff;
export const ANIM_LOOK_SHIFT = 12;
export const ANIM_ACTION_SHIFT = 18;

/** Metres per second per unit of `AnimState.speed`. */
export const SPEED_STEP = 0.6;
export const SPEED_MAX = 15;
/** Steps in a full turn of `AnimState.dir`. */
export const DIR_STEPS = 16;
/** Steps of `AnimState.pitch` from level to straight up. */
export const PITCH_STEPS = 31;

/** Everything a pose depends on besides the tick, as whole numbers. */
export class AnimState {
  mode = MODE_WALK;
  grounded = true;
  /** Horizontal speed in SPEED_STEP units, 0..SPEED_MAX. */
  speed = 0;
  /** Direction of travel relative to facing, in sixteenths of a turn toward the body's left. */
  dir = 0;
  /** -PITCH_STEPS (down) to PITCH_STEPS (up). */
  pitch = 0;
  stance = STANCE_STAND;
  /** The act (shared/sim/weapon.ts) in the low three bits, then the hold (HOLD_*) in three. actionStart is the low byte of the act's first tick. */
  action = 0;
  actionStart = 0;
  /** Ticks added to the clock so that bodies are out of step. Not replicated. It comes from the entity's index (bodySeed). */
  seed = 0;

  /** Everything but the seed as one 32-bit number: motion in the low 12 bits, then the look, then the action. */
  pack(): number {
    const motion = this.speed | (this.dir << 4) | (this.stance << 8) | (this.mode === MODE_SWIM ? 1 << 10 : 0) | (this.grounded ? 0 : 1 << 11);
    return (motion | ((this.pitch & 63) << ANIM_LOOK_SHIFT) | (this.action << ANIM_ACTION_SHIFT) | ((this.actionStart & 255) << (ANIM_ACTION_SHIFT + 6))) >>> 0;
  }

  /** ACT_NONE stores a start of 0. */
  setAction(act: number, hold: number, start: number): void {
    this.action = (act & 7) | ((hold & 7) << 3);
    this.actionStart = act === ACT_NONE ? 0 : start & 255;
  }

  unpack(word: number): void {
    this.speed = word & 15;
    this.dir = (word >>> 4) & 15;
    this.stance = (word >>> 8) & 3;
    this.mode = (word & (1 << 10)) !== 0 ? MODE_SWIM : MODE_WALK;
    this.grounded = (word & (1 << 11)) === 0;
    const look = (word >>> ANIM_LOOK_SHIFT) & 63;
    this.pitch = look >= 32 ? look - 64 : look;
    this.action = (word >>> ANIM_ACTION_SHIFT) & 63;
    this.actionStart = (word >>> (ANIM_ACTION_SHIFT + 6)) & 255;
  }

  /** `yaw` and `pitch` are in radians. */
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

/** `id` is the entity index, so the server and every client get the same seed. */
export function bodySeed(id: number): number {
  return (id * 37) % 1024;
}

/** A missing gait clip leaves the body at rest. A missing hold or swing clip is skipped. */
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
  readonly proneIdle: Clip | null;
  readonly proneCrawl: Clip | null;
  readonly punch: Clip | null;
  readonly punchCross: Clip | null;
  readonly toolSwing: Clip | null;
  readonly throwing: Clip | null;
  readonly bowReady: Clip | null;
  readonly bowDrawn: Clip | null;
  readonly gunAimed: Clip | null;
  readonly gunLowered: Clip | null;
  readonly pistolAimed: Clip | null;
  readonly pistolLowered: Clip | null;

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
    this.proneIdle = find("human/prone_idle");
    this.proneCrawl = find("human/prone_crawl");
    this.punch = find("human/punch");
    this.punchCross = find("human/punch_cross");
    this.toolSwing = find("human/tool_swing");
    this.throwing = find("human/throw");
    this.bowReady = find("human/bow_ready");
    this.bowDrawn = find("human/bow_drawn");
    this.gunAimed = find("human/gun_aimed");
    this.gunLowered = find("human/gun_lowered");
    this.pistolAimed = find("human/pistol_aimed");
    this.pistolLowered = find("human/pistol_lowered");
  }
}

/** The speed at which each gait plays unblended, in metres per second, and the ticks one cycle takes. */
const WALK_SPEED = 1.8;
const JOG_SPEED = 4.2;
const SPRINT_SPEED = 7.2;
const WALK_TICKS = 32;
const JOG_TICKS = 22;
const SPRINT_TICKS = 18;
const CROUCH_SPEED = 1.5;
const CROUCH_TICKS = 34;
const PRONE_SPEED = 0.6;
const PRONE_TICKS = 40;
const SWIM_SPEED = 2.4;
/** Swim clips put the water's surface at the origin. It is SWIM_FLOAT of a 1.8 m body above a swimmer's feet. */
const SWIM_LIFT = 1.35;
/** A swimmer pitches about this height, where its body lies when level. */
const SWIM_PIVOT = 1.25;
/** Share of the look pitch taken by each of the three spine bones, the neck, and the head. */
const PITCH_SPINE = 0.14;
const PITCH_NECK = 0.2;
const PITCH_HEAD = 0.3;

/** A swing takes the upper body: the spine through the hands, then the fingers and props. The legs keep their gait. */
const UPPER_FROM = B_SPINE;
const UPPER_TO = B_UPPER_LEG_L;
const HANDS_FROM = B_FINGERS_L;
/** Ticks to blend a swing in and out. */
const SWING_IN = 2;
const SWING_OUT = 3;

/** Ticks for a bow to come up as the draw begins and go down after the shot, and for a gun to come down for loading. */
const BOW_RAISE = 9;
const BOW_LOWER = 6;
const GUN_LOWER = 5;
/** A gun kicks up by this many radians when it fires and settles over KICK_TICKS. */
const KICK = 0.09;
const KICK_TICKS = 5;

const a = new Pose(HUMAN_BONES);
const b = new Pose(HUMAN_BONES);
const q = new Float64Array(4);
const v = new Float64Array(3);

/** Plays the clip stretched to `cycle` ticks per loop, backward when `reverse`. */
function gait(clip: Clip | null, cycle: number, tick: number, reverse: boolean, out: Pose): void {
  if (!clip) {
    out.rest();
    return;
  }
  let phase = tick / cycle;
  phase -= Math.floor(phase);
  sampleClip(clip, (reverse ? 1 - phase : phase) * clip.frames, out);
}

/** Plays the clip at one frame per tick. */
function loop(clip: Clip | null, tick: number, out: Pose): void {
  if (!clip) out.rest();
  else sampleClip(clip, tick, out);
}

/** The axis (ax, ay, az) is in the parent's space. */
function turn(pose: Pose, bone: number, ax: number, ay: number, az: number, angle: number): void {
  if (angle === 0) return;
  quatAxis(q, 0, ax, ay, az, angle);
  quatMul(pose.rot, bone * 4, q, 0, pose.rot, bone * 4);
}

/** `tick` may fall between ticks, for drawing. */
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
  let spineShare = PITCH_SPINE;

  if (st.mode === MODE_SWIM) {
    loop(anim.swimIdle, t, a);
    loop(anim.swim, t, b);
    const k = clamp(speed / SWIM_SPEED, 0, 1);
    blendPose(out, a, b, k);
    out.root[1]! += SWIM_LIFT;
    // A swimmer's whole body tips toward its look, more the faster it goes.
    bodyPitch = pitch * k;
    twistAngle = 0;
  } else if (!st.grounded) {
    loop(anim.fall, t, out);
    twistAngle = 0;
  } else if (st.stance === STANCE_PRONE) {
    loop(anim.proneIdle, t, a);
    gait(anim.proneCrawl, PRONE_TICKS, t, reverse, b);
    blendPose(out, a, b, clamp(speed / PRONE_SPEED, 0, 1));
    // A prone body turns as one piece, and only the neck and head follow the look.
    twistAngle = 0;
    spineShare = 0;
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

  const act = st.action & 7;
  const hold = st.action >>> 3;
  // Ticks since the act began. A pose drawn a moment before the act's first tick wraps above 250, and that counts as 0.
  let e = act === ACT_NONE ? 0 : (tick - st.actionStart) % 256;
  if (e < 0) e += 256;
  if (e > 250) e = 0;
  /** How far the arms are up and aimed, 0 to 1. Raised arms follow the whole look pitch, not only the spine's share. */
  let raised = 0;
  let kick = 0;
  if (hold === HOLD_BOW) {
    // The bow is carried low, comes up as the draw begins, and goes down once the arrow is gone.
    raised = act === ACT_DRAW ? clamp(e / BOW_RAISE, 0, 1) : act === ACT_HOLD ? 1 : act === ACT_COOL ? clamp(1 - e / BOW_LOWER, 0, 1) : 0;
    if (anim.bowReady && anim.bowDrawn) {
      sampleClip(anim.bowReady, 0, a);
      sampleClip(anim.bowDrawn, 0, b);
      blendPose(a, a, b, raised, UPPER_FROM, UPPER_TO);
      blendPose(out, out, a, 1, UPPER_FROM, UPPER_TO);
    }
  } else if (hold === HOLD_RIFLE || hold === HOLD_PISTOL) {
    // A gun is at the shoulder except during a reload or an equip.
    const low = act === ACT_RELOAD ? clamp(e / GUN_LOWER, 0, 1) : act === ACT_EQUIP ? clamp(1 - e / EQUIP_TICKS, 0, 1) : 0;
    raised = 1 - low;
    if (act === ACT_COOL && e < KICK_TICKS) kick = KICK * (1 - e / KICK_TICKS);
    const up = hold === HOLD_RIFLE ? anim.gunAimed : anim.pistolAimed;
    const down = hold === HOLD_RIFLE ? anim.gunLowered : anim.pistolLowered;
    if (up && down) {
      sampleClip(up, 0, a);
      sampleClip(down, 0, b);
      blendPose(a, a, b, low, UPPER_FROM, UPPER_TO);
      blendPose(out, out, a, 1, UPPER_FROM, UPPER_TO);
    }
  }

  if (act === ACT_SWING) {
    const clip = hold === HOLD_HANDS ? ((st.actionStart & 1) !== 0 ? (anim.punchCross ?? anim.punch) : anim.punch) : hold === HOLD_THROW ? anim.throwing : anim.toolSwing;
    const k = e < SWING_IN ? e / SWING_IN : (SWING_TICKS - e) / SWING_OUT;
    if (clip && k > 0) {
      sampleClip(clip, (e / SWING_TICKS) * (clip.frames - 1), a);
      blendPose(out, out, a, k, UPPER_FROM, UPPER_TO);
      blendPose(out, out, a, k, HANDS_FROM, HUMAN_BONES);
    }
  }

  if (twistAngle !== 0) {
    // The hips turn toward the direction of travel and the spine turns back to where the body faces.
    turnRoot(out, 0, 1, 0, twistAngle, 0);
    turn(out, B_SPINE, 0, 1, 0, -twistAngle / 3);
    turn(out, B_CHEST, 0, 1, 0, -twistAngle / 3);
    turn(out, B_UPPER_CHEST, 0, 1, 0, -twistAngle / 3);
  }
  if (bodyPitch !== 0) turnRoot(out, 1, 0, 0, -bodyPitch, SWIM_PIVOT);
  const look = pitch - bodyPitch;
  if (look !== 0) {
    // Looking up is a negative turn about X, which raises +Z toward +Y.
    turn(out, B_SPINE, 1, 0, 0, -look * spineShare);
    turn(out, B_CHEST, 1, 0, 0, -look * spineShare);
    turn(out, B_UPPER_CHEST, 1, 0, 0, -look * spineShare);
    turn(out, B_NECK, 1, 0, 0, -look * PITCH_NECK);
    turn(out, B_HEAD, 1, 0, 0, -look * PITCH_HEAD);
  }
  // Raised arms take the pitch the spine did not, plus a gun's kick.
  const lift = (look * (1 - 3 * spineShare) + kick) * raised;
  if (lift !== 0) {
    turn(out, B_SHOULDER_L, 1, 0, 0, -lift);
    turn(out, B_SHOULDER_R, 1, 0, 0, -lift);
  }
}

/** Turns the whole body about an axis through (0, pivotY, 0) in model space. */
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
