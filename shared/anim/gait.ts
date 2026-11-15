// A walking or running clip is played by the ground the body covers: one turn of the clip for each stride, so a planted
// foot stays planted at any speed and any size. Gaits are lined up by where their first foot is farthest forward and
// blended in step, each playing alone at its own speed, its stride over its length.
//
// The server poses a body from its state and the tick alone (D53), so its phase is the tick times the turns a tick at the
// state's speed. A client keeps a Gait per body, which starts at that phase and from then on moves by the ground covered.

import { TICK_RATE } from "../coords.ts";
import { PI, TAU } from "../math/scalar.ts";
import { blendPose, sampleClip, type Clip, type Pose } from "./clip.ts";
import { solve, type Skeleton, type Solved } from "./skeleton.ts";

export interface GaitClip {
  readonly clip: Clip;
  /** Metres the body travels in one turn of the clip. */
  readonly stride: number;
  /** Where in the turn its first foot is farthest forward, 0 to 1. */
  readonly start: number;
  /** Metres a second at which it plays at its own rate. */
  readonly speed: number;
}

export function gaitClip(clip: Clip, stride: number, start: number): GaitClip {
  return { clip, stride, start, speed: (stride * TICK_RATE) / clip.frames };
}

/**
 * Fills `w` with the share of each gait at `speed`, slowest first, and returns the stride of the blend. Between two gaits
 * both have a share. Past the fastest it plays alone and faster. Below the slowest, with `idle`, the rest is the idle's,
 * and without it the slowest plays alone and slower. 0 means standing.
 */
export function gaitShares(gaits: readonly GaitClip[], speed: number, idle: boolean, w: Float64Array): number {
  const n = gaits.length;
  for (let i = 0; i < n; i++) w[i] = 0;
  if (n === 0 || !(speed > 0)) return 0;
  if (speed <= gaits[0]!.speed) w[0] = idle ? speed / gaits[0]!.speed : 1;
  else if (speed >= gaits[n - 1]!.speed) w[n - 1] = 1;
  else {
    let k = 0;
    while (speed >= gaits[k + 1]!.speed) k++;
    const t = (speed - gaits[k]!.speed) / (gaits[k + 1]!.speed - gaits[k]!.speed);
    w[k] = 1 - t;
    w[k + 1] = t;
  }
  let stride = 0;
  for (let i = 0; i < n; i++) stride += w[i]! * gaits[i]!.stride;
  return stride;
}

/** The phase a body is at with nothing remembered: `t` ticks at `speed` metres a second over `stride`. */
export function tickPhase(t: number, speed: number, stride: number): number {
  if (!(stride > 0)) return 0;
  const turns = (t * speed) / (TICK_RATE * stride);
  return turns - Math.floor(turns);
}

/**
 * Blends the gaits with shares `w` at `phase` over what `out` holds (the idle, or the rest pose). Backward plays them in
 * reverse. `a` and `b` are scratch. Returns the share the gaits took in all.
 */
export function playGaits(gaits: readonly GaitClip[], w: Float64Array, phase: number, backward: boolean, out: Pose, a: Pose, b: Pose): number {
  const p = backward ? -phase : phase;
  let first = -1;
  let total = 0;
  for (let i = 0; i < gaits.length; i++) {
    const share = w[i]!;
    if (share <= 0) continue;
    const g = gaits[i]!;
    let f = g.start + p;
    f -= Math.floor(f);
    if (first < 0) {
      sampleClip(g.clip, f * g.clip.frames, a);
      first = i;
      total = share;
      continue;
    }
    sampleClip(g.clip, f * g.clip.frames, b);
    blendPose(a, a, b, share / (total + share));
    total += share;
  }
  if (first >= 0) blendPose(out, out, a, total);
  return total;
}

/** Ticks a body may go undrawn and keep its phase: an eighth of a second. Seen again later, it starts afresh. */
const GAP = 4;
/** Seconds the legs take to come most of the way to a new speed. */
const EASE = 0.12;
/** Metres a frame beyond which the body jumped and did not walk there. */
const JUMP = 3;
/** Radians a second under which a turn on the spot has all but stopped, so the next begins anew. */
const SPIN_ANEW = 0.2;

/** What a client keeps of a body between frames to play its gait by the ground it covers. */
export class Gait {
  /** Turns of the gait, 0 to 1. */
  phase = 0;
  /**
   * The speed its gaits are blended at, in metres a second at the size it was made: the state's eased, or the arc its
   * feet take as it turns on the spot. A young one half the size strides as a grown one does at half the speed.
   */
  speed = 0;
  x = 0;
  z = 0;
  /** Radians. */
  yaw = 0;
  /** The tick it was last moved to. NaN before it is first seen. */
  tick = Number.NaN;
  /**
   * Turning where it stands: radians a second, eased, + to its left, and radians turned since it began, for a clip that
   * turns on the spot. A turn begins again from 0 once the last has all but stopped, or the other way.
   */
  spin = 0;
  turned = 0;
  /**
   * A flyer's shares of its hover and of its fast flapping, and its roll into a turn (shared/anim/creature.ts), eased so a
   * step of the speed or bank it is sent is not a jump in how it is drawn. NaN while it does not fly.
   */
  hover = Number.NaN;
  fast = Number.NaN;
  roll = Number.NaN;

  /**
   * Moves to the body's place at `tick` and returns the metres its feet covered, at the size it was made, or -1 when it
   * starts afresh: seen for the first time or after a gap. Then its speed is the state's and its phase is the caller's
   * to set. `radius` is how far its feet stand from where it turns, as made, so turning on the spot steps. It is drawn
   * `size` times as large as it was made.
   */
  track(x: number, z: number, yaw: number, tick: number, speed: number, radius: number, size: number): number {
    const dt = tick - this.tick;
    const dx = x - this.x;
    const dz = z - this.z;
    let turn = yaw - this.yaw;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    if (dt === 0) return 0;
    this.tick = tick;
    if (!(dt > 0 && dt <= GAP)) {
      this.speed = speed / size;
      this.spin = this.turned = 0;
      return -1;
    }
    turn -= Math.floor((turn + PI) / TAU) * TAU;
    const arc = (turn < 0 ? -turn : turn) * radius;
    const moved = Math.sqrt(dx * dx + dz * dz) / size;
    const seconds = dt / TICK_RATE;
    const spin = speed > 0 ? 0 : turn / seconds;
    if (spin !== 0) {
      if (this.spin * spin <= 0 || Math.abs(this.spin) < SPIN_ANEW) this.turned = 0;
      this.turned += turn;
    }
    this.spin += ((spin - this.spin) * seconds) / (EASE + seconds);
    speed /= size;
    const want = speed > arc / seconds ? speed : arc / seconds;
    this.speed += ((want - this.speed) * seconds) / (EASE + seconds);
    if (moved * size > JUMP) return 0;
    return moved > arc ? moved : arc;
  }

  /** Moves the phase on by `metres` over `stride`. */
  step(metres: number, stride: number): void {
    if (!(stride > 0) || !(metres > 0)) return;
    const p = this.phase + metres / stride;
    this.phase = p - Math.floor(p);
  }
}

/** Where in `clip` the joint `foot` is farthest forward of the body, 0 to 1. `pose` is scratch. */
export function footStart(skel: Skeleton, clip: Clip, foot: number, pose: Pose, solved: Solved): number {
  let best = -Infinity;
  let at = 0;
  for (let f = 0; f < clip.frames; f++) {
    sampleClip(clip, f, pose);
    solve(skel, pose, solved);
    const z = solved.pos[foot * 3 + 2]! - solved.pos[2]!;
    if (z > best) {
      best = z;
      at = f;
    }
  }
  return at / clip.frames;
}

/** How far the feet stand from the body's upright axis at rest, on average. */
export function footRadius(skel: Skeleton, feet: readonly number[]): number {
  let sum = 0;
  for (const f of feet) sum += Math.sqrt(skel.rest[f * 3]! * skel.rest[f * 3]! + skel.rest[f * 3 + 2]! * skel.rest[f * 3 + 2]!);
  return feet.length > 0 ? sum / feet.length : 0;
}
