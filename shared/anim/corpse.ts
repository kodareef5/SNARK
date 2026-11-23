// A dead creature's body comes to rest the same wherever it is worked out: on the server, which judges the blows that
// harvest it, and on each client, which draws it, whether that client saw it fall or came later. It goes limp as its death
// clip has it at the frame its asset gives, or as it lay if it died knocked out, at the place and facing its entity is sent
// with, and its ragdoll is stepped a whole tick at a time. Only the world it lies on can make two of them differ.
//
// One that died off the ground, in the air or in the water, first falls or sinks to where it comes to rest. Only the
// server works that out (server/corpses.ts); its entity is sent where it is with the FALLING pose word, and the ragdoll is
// laid where it landed, which every client is then sent. One that died in its own flight carries CUE_FELL in its cue
// word for as long as it lies, and goes limp from its death in the air.

import { TICK_RATE, WORLD_MIN_Y } from "../coords.ts";
import { TAU } from "../math/scalar.ts";
import { POS_UNITS } from "../net/view.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { sampleClip, type Clip } from "./clip.ts";
import { creaturePose, type CreatureAnim } from "./creature.ts";
import { AnimState, CUE_FELL } from "./pose.ts";
import { Ragdoll, type CarrierFrame } from "./ragdoll.ts";
import { Solved, solve } from "./skeleton.ts";

/** The live fall a body keeps as it dies. */
export interface FallenState {
  readonly size: number;
  readonly state: Float64Array;
  readonly awake: boolean;
  readonly ticks: number;
  readonly carrier?: CarrierFrame;
}

/** The already-decided root motion of a lethal physical impact. Never add its impulse twice. */
export interface CorpseImpact {
  readonly victimHandle: number;
  readonly victimPid: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Angular velocity in world coordinates, radians per second. */
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
}

/** A corpse's size is sent as its entity's span, in these parts of a grown one's. 0 is grown. */
export const SIZE_UNITS = 65536;
/** The most consecutive supported ticks spent settling. Freefall and sinking do not consume this budget. */
export const SETTLE_TICKS = 10 * TICK_RATE;
/** Steps of a turn in the yaw a view sends. */
const YAW_STEPS = 1024;

const st = new AnimState();
const before = new Map<number, Solved>();

/** The pose word of a body's entity while it falls or sinks: off the ground and nothing else. One that lies has 0. */
export const FALLING = (() => {
  const s = new AnimState();
  s.grounded = false;
  return s.pack();
})();

/** Whether a body's pose word says it still falls. */
export function bodyFalls(anim: number): boolean {
  st.unpack(anim, 0);
  return !st.grounded;
}

export function corpseSize(span: number): number {
  return span === 0 ? 1 : span / SIZE_UNITS;
}

/** The span that says `size`. */
export function sizeSpan(size: number): number {
  return size >= 1 ? 0 : Math.max(1, Math.min(SIZE_UNITS - 1, Math.round(size * SIZE_UNITS)));
}

/** A coordinate as a view carries it: x and z on POS_UNITS, y the same above WORLD_MIN_Y. */
export function wireX(x: number): number {
  return Math.round(x * POS_UNITS) / POS_UNITS;
}

export function wireY(y: number): number {
  return Math.round((y - WORLD_MIN_Y) * POS_UNITS) / POS_UNITS + WORLD_MIN_Y;
}

/** A yaw in radians as a view carries it, and in the 65536ths of a turn an entity keeps. */
export function wireYaw(radians: number): number {
  const steps = Math.round((radians / TAU) * YAW_STEPS) & (YAW_STEPS - 1);
  return (steps * TAU) / YAW_STEPS;
}

export function yawOf16(yaw: number): number {
  return ((yaw >>> 6) * TAU) / YAW_STEPS;
}

/** The bits of a body's cue word that say it died in its own flight (CUE_FELL). */
export const FELL = CUE_FELL << 1;

/** Whether the body whose cue word is `cue` died in its own flight. */
export function diedAloft(cue: number): boolean {
  return (cue & (7 << 1)) === FELL;
}

/** The clip a body dies by: its death in the air where it died in its own flight and its kind has one, else its death. */
export function deathOf(anim: CreatureAnim, air: boolean): Clip | null {
  return (air ? anim.deathAir : null) ?? anim.death;
}

/**
 * The pose a body goes limp in, solved as the model's, and the pose a tick before it, which says how it moves: its death
 * clip (`air`, its death in the air) at its asset's frame, or, for one that died knocked out or has no clip, how it lay,
 * still.
 */
export function limpPose(anim: CreatureAnim, out: boolean, air: boolean, now: Solved, was: Solved): void {
  const rig = anim.rig;
  const clip = deathOf(anim, air);
  if (out || !clip) {
    st.unpack(0, 0);
    st.out = out;
    creaturePose(anim, st, 0, rig.a, null);
    solve(rig, rig.a, now);
    was.rot.set(now.rot);
    was.pos.set(now.pos);
    return;
  }
  const limp = rig.ragdoll?.limp ?? 0;
  sampleClip(clip, limp > 0 ? limp - 1 : 0, rig.a);
  solve(rig, rig.a, was);
  sampleClip(clip, limp, rig.a);
  solve(rig, rig.a, now);
}

/**
 * The ragdoll of a body that went limp at (x, y, z) facing `yaw` radians, `size` times as large as it was made, or null for
 * a rig without one. `now` is filled with its first pose. Every argument must be as the wire has it.
 */
export function layCorpse(anim: CreatureAnim, out: boolean, air: boolean, x: number, y: number, z: number, yaw: number, size: number, now: Solved, standing = false): Ragdoll | null {
  const rig = anim.rig;
  if (!rig.ragdoll) return null;
  let was = before.get(rig.bones);
  if (!was) before.set(rig.bones, (was = new Solved(rig.bones)));
  if (standing) {
    // An impact starts upright, before the death clip has already laid the body on the floor.
    rig.a.rest(); solve(rig, rig.a, now); was.pos.set(now.pos); was.rot.set(now.rot);
  } else limpPose(anim, out, air, now, was);
  const r = new Ragdoll(rig, rig.ragdoll);
  r.start(now, was, x, y, z, yaw, size);
  return r;
}

/**
 * A body's fall, a tick at a time, until its ragdoll sleeps. SETTLE_TICKS limits supported settling, not time aloft.
 * Asleep, including after the settling limit, it wakes when something is built or taken where it lies.
 */
export class Fall {
  readonly ragdoll: Ragdoll;
  /** Consecutive ticks with solid support, bounded by SETTLE_TICKS for checkpoint persistence. */
  ticks = 0;
  /** What a living body does with its limbs each tick as it falls, from its state alone; none for the dead. */
  reflex: ((r: Ragdoll) => void) | null = null;

  constructor(ragdoll: Ragdoll) {
    this.ragdoll = ragdoll;
  }

  /** Whether a tick would do nothing unless the world changed under it. */
  get still(): boolean {
    return !this.ragdoll.awake;
  }

  /** One tick. Returns whether it moved. */
  tick(world: CollisionWorld): boolean {
    const r = this.ragdoll;
    const wasAwake = r.awake;
    if (wasAwake) this.reflex?.(r);
    if (!r.step(world, 1 / TICK_RATE) && !wasAwake) return false;
    const c = r.carrier;
    const movingSupport = c && (c.vx * c.vx + c.vy * c.vy + c.vz * c.vz + c.wx * c.wx + c.wy * c.wy + c.wz * c.wz > .0001);
    this.ticks = r.supported && !movingSupport ? Math.min(SETTLE_TICKS, (wasAwake ? this.ticks : 0) + 1) : 0;
    if (this.ticks === SETTLE_TICKS) r.settle(world);
    return true;
  }
}
