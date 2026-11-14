// Bodies that die. The server takes a dead creature out of the world at once and says nothing else of it to anyone but
// its killer, so a client learns of a death by a creature leaving its view while it was well within it. The body then
// plays its death clip where it was last drawn, goes limp as a ragdoll (shared/anim/ragdoll.ts) at the frame its asset
// gives, and lies where it settles. Nothing of it is sent anywhere: two clients may see it lie differently.

import { Pose, blendPose, sampleClip } from "../../shared/anim/clip.ts";
import { creaturePose } from "../../shared/anim/creature.ts";
import type { Gait } from "../../shared/anim/gait.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import type { Rig } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { RemoteSample } from "./session.ts";

/**
 * Metres from the viewer within which a creature that leaves the view has died. A server shows bodies three chunks
 * (192 m) and more around the viewer's chunk, so nearer than this a body leaves only by dying.
 */
const NEAR = 128;
/** Ticks over which the last pose alive blends into the death clip. */
const BLEND = 4;
/** A corpse lies as long as the cache a dead creature leaves (D201): fifteen minutes. */
const LIES = 15 * 60 * TICK_RATE;
/** The most corpses kept. The oldest goes first. */
const MOST = 128;
/** A corpse farther than this from the viewer is forgotten. */
const FORGET = 320;
/** A viewer that moves farther than this in a frame was moved, as on a respawn, and its view changed with it. */
const MOVED = 30;

/** What a kind of creature needs to die: its rig, and where its run starts. Null for a kind that is simply gone. */
export interface Mortal {
  readonly rig: Rig;
  readonly runAt: number;
}

export interface Corpse {
  readonly kind: number;
  readonly id: number;
  /** Where it stood when it died, its yaw in radians and its size, and the six colours of its regions. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: number;
  readonly colors: Uint8Array;
  /** The tick the death clip starts at. */
  readonly born: number;
  /** Its last pose alive, its ragdoll once limp, and the pose to draw, solved, about (x, y, z). */
  readonly alive: Pose;
  ragdoll: Ragdoll | null;
  readonly solved: Solved;
}

/** A copy twice as long. */
function wider<T extends Uint32Array | Uint16Array | Float64Array | Float32Array | Uint8Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

/** The creatures of one frame, sorted by id as the remote entities are. */
class Seen {
  count = 0;
  id = new Uint32Array(64);
  kind = new Uint16Array(64);
  at = new Float64Array(64 * 4);
  anim = new Uint32Array(64);
  size = new Float32Array(64);
  colors = new Uint8Array(64 * 6);

  push(r: RemoteSample, i: number, size: number): void {
    if (this.count === this.id.length) {
      this.id = wider(this.id);
      this.kind = wider(this.kind);
      this.at = wider(this.at);
      this.anim = wider(this.anim);
      this.size = wider(this.size);
      this.colors = wider(this.colors);
    }
    const n = this.count++;
    this.id[n] = r.id[i]!;
    this.kind[n] = r.kind[i]!;
    this.at[n * 4] = r.x[i]!;
    this.at[n * 4 + 1] = r.y[i]!;
    this.at[n * 4 + 2] = r.z[i]!;
    this.at[n * 4 + 3] = r.yaw[i]!;
    this.anim[n] = r.anim[i]!;
    this.size[n] = size;
    this.colors.set(r.colors.subarray(i * 6, i * 6 + 6), n * 6);
  }
}

export class Corpses {
  readonly list: Corpse[] = [];
  private readonly mortal: readonly (Mortal | null)[];
  private readonly birthScale: Float32Array;
  private was = new Seen();
  private now = new Seen();
  private tick = Number.NaN;
  private cx = Number.NaN;
  private cz = Number.NaN;
  private readonly st = new AnimState();
  private readonly a: Pose[] = [];
  private readonly before = new Map<number, Solved>();

  /** `mortal` is indexed by content kind. `birthScale` is the registry's, for the size of a young one. */
  constructor(mortal: readonly (Mortal | null)[], birthScale: Float32Array) {
    this.mortal = mortal;
    this.birthScale = birthScale;
  }

  /**
   * Finds the creatures that died since the last call, among the remote entities as sampled now, and moves every corpse
   * on to `remote.tick`. (cx, cz) is where the viewer is. `gaits` holds the gait of each body drawn, by id.
   */
  update(remote: RemoteSample, world: CollisionWorld, cx: number, cz: number, gaits: ReadonlyMap<number, Gait>): void {
    const tick = remote.tick;
    const step = tick - this.tick;
    const now = this.now;
    now.count = 0;
    for (let i = 0; i < remote.count; i++) {
      if (!this.mortal[remote.kind[i]!]) continue;
      const kind = remote.kind[i]!;
      now.push(remote, i, remote.grown[i] !== 0 ? youngScale(this.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, tick) : 1);
    }
    // A viewer that jumped took its view with it.
    const jumped = !(Math.abs(cx - this.cx) < MOVED && Math.abs(cz - this.cz) < MOVED);
    this.cx = cx;
    this.cz = cz;
    if (step > 0 && !jumped) this.deaths(now, cx, cz, gaits);
    // The view this frame is the one the next frame is held against.
    this.now = this.was;
    this.was = now;
    if (!(step > 0)) {
      if (Number.isNaN(this.tick)) this.tick = tick;
      return;
    }
    this.tick = tick;
    const seconds = Math.min(step / TICK_RATE, 0.1);
    for (let k = this.list.length - 1; k >= 0; k--) {
      const c = this.list[k]!;
      const dx = c.x - cx;
      const dz = c.z - cz;
      if (tick - c.born > LIES || dx * dx + dz * dz > FORGET * FORGET) {
        this.list.splice(k, 1);
        continue;
      }
      this.move(c, world, tick, seconds);
    }
  }

  /** The creatures in `was` and not in `now`, near enough to have died and not all leaving at once. */
  private deaths(now: Seen, cx: number, cz: number, gaits: ReadonlyMap<number, Gait>): void {
    const was = this.was;
    let gone = 0;
    for (let i = 0, j = 0; i < was.count; i++) {
      while (j < now.count && now.id[j]! < was.id[i]!) j++;
      if (j < now.count && now.id[j] === was.id[i] && now.kind[j] === was.kind[i]) continue;
      gone++;
    }
    // A view that loses half its creatures at once was moved or lost, as on a respawn or a reconnection.
    if (gone === 0 || (gone > 4 && gone * 2 > was.count)) return;
    for (let i = 0, j = 0; i < was.count; i++) {
      while (j < now.count && now.id[j]! < was.id[i]!) j++;
      if (j < now.count && now.id[j] === was.id[i] && now.kind[j] === was.kind[i]) continue;
      const dx = was.at[i * 4]! - cx;
      const dz = was.at[i * 4 + 2]! - cz;
      if (dx * dx + dz * dz < NEAR * NEAR) this.die(was, i, gaits);
    }
  }

  private die(was: Seen, i: number, gaits: ReadonlyMap<number, Gait>): void {
    const kind = was.kind[i]!;
    const m = this.mortal[kind]!;
    const rig = m.rig;
    if (!rig.death && !rig.ragdoll) return;
    if (this.list.length >= MOST) this.list.shift();
    const st = this.st;
    st.unpack(was.anim[i]!);
    st.seed = bodySeed(was.id[i]!);
    const alive = new Pose(rig.bones);
    creaturePose(rig, st, this.tick, m.runAt, alive, gaits.get(was.id[i]!) ?? null);
    const c: Corpse = {
      kind,
      id: was.id[i]!,
      x: was.at[i * 4]!,
      y: was.at[i * 4 + 1]!,
      z: was.at[i * 4 + 2]!,
      yaw: was.at[i * 4 + 3]!,
      size: was.size[i]!,
      colors: was.colors.slice(i * 6, i * 6 + 6),
      born: this.tick,
      alive,
      ragdoll: null,
      solved: new Solved(rig.bones),
    };
    this.list.push(c);
    this.dying(c, 0, this.posed(rig.bones));
    solve(rig, this.posed(rig.bones), c.solved);
  }

  /** A scratch pose for a rig of `bones`. */
  private posed(bones: number): Pose {
    return (this.a[bones] ??= new Pose(bones));
  }

  /** The pose `frame` ticks into dying: the death clip, blended in from the last pose alive. Without a clip, that pose. */
  private dying(c: Corpse, frame: number, out: Pose): void {
    const rig = this.mortal[c.kind]!.rig;
    const clip = rig.death;
    if (!clip) {
      blendPose(out, c.alive, c.alive, 0);
      return;
    }
    sampleClip(clip, frame, out);
    blendPose(out, c.alive, out, frame / BLEND);
  }

  private move(c: Corpse, world: CollisionWorld, tick: number, seconds: number): void {
    const rig = this.mortal[c.kind]!.rig;
    const def = rig.ragdoll;
    const frame = tick - c.born;
    if (c.ragdoll) {
      if (c.ragdoll.step(world, seconds)) c.ragdoll.pose(c.solved);
      return;
    }
    const pose = this.posed(rig.bones);
    if (!def || frame < def.limp) {
      this.dying(c, frame, pose);
      solve(rig, pose, c.solved);
      return;
    }
    // Limp from the pose at the frame the asset gives, moving as the clip moved over the tick before it, so the first
    // frame of the ragdoll is that pose.
    const limp = def.limp;
    const before = (this.before.get(rig.bones) ?? this.before.set(rig.bones, new Solved(rig.bones)).get(rig.bones))!;
    this.dying(c, limp > 0 ? limp - 1 : 0, pose);
    solve(rig, pose, before);
    this.dying(c, limp, pose);
    solve(rig, pose, c.solved);
    c.ragdoll = new Ragdoll(rig, def);
    c.ragdoll.start(c.solved, before, c.x, c.y, c.z, c.yaw, c.size);
    const late = (frame - limp) / TICK_RATE;
    if (late > 0 && c.ragdoll.step(world, late)) c.ragdoll.pose(c.solved);
  }
}
