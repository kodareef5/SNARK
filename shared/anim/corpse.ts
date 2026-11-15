// A dead creature's body comes to rest the same wherever it is worked out: on the server, which judges the blows that
// harvest it, and on each client, which draws it, whether that client saw it fall or came later. It goes limp as its death
// clip has it at the frame its asset gives, or as it lay if it died knocked out, at the place and facing its entity is sent
// with, and its ragdoll is stepped a whole tick at a time. Only the world it lies on can make two of them differ.

import { TICK_RATE, WORLD_MIN_Y } from "../coords.ts";
import { TAU } from "../math/scalar.ts";
import { POS_UNITS } from "../net/view.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { sampleClip } from "./clip.ts";
import { creaturePose, type CreatureAnim } from "./creature.ts";
import { AnimState } from "./pose.ts";
import { Ragdoll } from "./ragdoll.ts";
import { Solved, solve } from "./skeleton.ts";

/** A corpse's size is sent as its entity's span, in these parts of a grown one's. 0 is grown. */
export const SIZE_UNITS = 65536;
/** The most ticks a body is stepped from going limp, or from waking, before it is left as it is, still or not. */
export const SETTLE_TICKS = 10 * TICK_RATE;
/** Steps of a turn in the yaw a view sends. */
const YAW_STEPS = 1024;

const st = new AnimState();
const before = new Map<number, Solved>();

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

/**
 * The pose a body goes limp in, solved as the model's, and the pose a tick before it, which says how it moves: its death
 * clip at its asset's frame, or, for one that died knocked out or has no clip, how it lay, still.
 */
export function limpPose(anim: CreatureAnim, out: boolean, now: Solved, was: Solved): void {
  const rig = anim.rig;
  const clip = anim.death;
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
export function layCorpse(anim: CreatureAnim, out: boolean, x: number, y: number, z: number, yaw: number, size: number, now: Solved): Ragdoll | null {
  const rig = anim.rig;
  if (!rig.ragdoll) return null;
  let was = before.get(rig.bones);
  if (!was) before.set(rig.bones, (was = new Solved(rig.bones)));
  limpPose(anim, out, now, was);
  const r = new Ragdoll(rig, rig.ragdoll);
  r.start(now, was, x, y, z, yaw, size);
  return r;
}

/**
 * A body's fall, a tick at a time, until its ragdoll sleeps or SETTLE_TICKS have passed since it went limp or last woke.
 * Asleep, it wakes when something is built or taken where it lies. Stopped by the count, it stays as it is.
 */
export class Fall {
  readonly ragdoll: Ragdoll;
  /** Ticks stepped since it went limp or last woke. */
  ticks = 0;

  constructor(ragdoll: Ragdoll) {
    this.ragdoll = ragdoll;
  }

  /** Whether a tick would do nothing unless the world changed under it. */
  get still(): boolean {
    return !this.ragdoll.awake || this.ticks >= SETTLE_TICKS;
  }

  /** One tick. Returns whether it moved. */
  tick(world: CollisionWorld): boolean {
    const r = this.ragdoll;
    if (!r.awake) {
      if (!r.step(world, 1 / TICK_RATE)) return false;
      this.ticks = 0;
      return true;
    }
    if (this.ticks >= SETTLE_TICKS) return false;
    this.ticks++;
    r.step(world, 1 / TICK_RATE);
    return true;
  }
}
