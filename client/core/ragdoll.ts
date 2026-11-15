// Bodies that died. A dead creature's body is an entity of its own, sent with CUE_DEAD (shared/anim/pose.ts), and lies
// where it fell until it is used up or decays (server/corpses.ts). A client that saw the creature die plays its death clip
// where the body lies, and the body goes limp as a ragdoll (shared/anim/ragdoll.ts) at the frame its asset gives; one that
// died knocked out goes limp as it lay. A client that comes upon a body later lays it to rest at once. Either way its
// ragdoll starts from the same pose and is stepped a whole tick at a time (shared/anim/corpse.ts), so every client, and
// the server that judges the blows on it, have it lie the same.

import { Pose, blendPose, sampleClip } from "../../shared/anim/clip.ts";
import { Fall, corpseSize, layCorpse, limpPose, wireX, wireY, wireYaw } from "../../shared/anim/corpse.ts";
import { creaturePose, type CreatureAnim } from "../../shared/anim/creature.ts";
import type { Gait } from "../../shared/anim/gait.ts";
import { AnimState, CUE_DEAD, CUE_DECAY_SHIFT, CUE_OUT, bodySeed } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { RemoteSample } from "./session.ts";

/** Ticks over which the last pose alive blends into the death clip. */
const BLEND = 4;
/** Ticks between the snapshot that said a creature died and the frame it was last drawn, either way, for it to have died there. */
const TOLD = 8;
/** Ticks after that within which its body may come, in a later snapshot when the one that said it died was full. */
const LATE = 30;
/** Metres between where a creature was last drawn and where a body lies, for the two to be one. */
const NEAR = 2;
/** Ticks of falling stepped in one frame for the bodies a client comes upon, nearest first. The rest wait for the next frame. */
const BUDGET = 600;
/** Ticks one watched body is stepped in one frame when frames come slowly. Those left are stepped in the frames after. */
const CATCH_UP = 6;

export interface Corpse {
  readonly kind: number;
  readonly id: number;
  /** Where it went limp, as the wire has it, its yaw in radians and its size, and the six colours of its regions. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: number;
  readonly colors: Uint8Array;
  /** The whole tick its death clip starts at. */
  readonly born: number;
  /** This client saw it die, and plays its death clip. */
  readonly watched: boolean;
  /** It died knocked out, and goes limp as it lay. */
  readonly lying: boolean;
  /** Its decay stage as sent, 0 fresh to STAGE_WORST. */
  decay: number;
  /** Its last pose alive, for a death this client saw. */
  readonly alive: Pose | null;
  /** It has gone limp. Its fall, null for a rig without a ragdoll, and the whole tick the fall has been stepped to. */
  limp: boolean;
  fall: Fall | null;
  clock: number;
  /** Come upon and still being laid to rest. */
  settling: boolean;
  /** The pose to draw, solved, about (x, y, z). */
  readonly solved: Solved;
  /** The update that last saw its entity. */
  seen: number;
}

/** A creature the server said died, as it was last drawn, waiting for its body. */
interface Fallen {
  id: number;
  kind: number;
  x: number;
  z: number;
  anim: number;
  cue: number;
  tick: number;
}

/** A copy twice as long. */
function wider<T extends Uint32Array | Uint16Array | Float64Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

/** The living creatures of one frame, sorted by id as the remote entities are. */
class Seen {
  count = 0;
  id = new Uint32Array(64);
  kind = new Uint16Array(64);
  at = new Float64Array(64 * 3);
  anim = new Uint32Array(64);
  cue = new Uint32Array(64);

  push(r: RemoteSample, i: number): void {
    if (this.count === this.id.length) {
      this.id = wider(this.id);
      this.kind = wider(this.kind);
      this.at = wider(this.at);
      this.anim = wider(this.anim);
      this.cue = wider(this.cue);
    }
    const n = this.count++;
    this.id[n] = r.id[i]!;
    this.kind[n] = r.kind[i]!;
    this.at[n * 3] = r.x[i]!;
    this.at[n * 3 + 1] = r.y[i]!;
    this.at[n * 3 + 2] = r.z[i]!;
    this.anim[n] = r.anim[i]!;
    this.cue[n] = r.cue[i]!;
  }

  has(id: number): boolean {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.id[mid]! < id) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.count && this.id[lo] === id;
  }
}

export class Corpses {
  readonly list: Corpse[] = [];
  private readonly byId = new Map<number, Corpse>();
  private readonly mortal: readonly (CreatureAnim | null)[];
  private was = new Seen();
  private now = new Seen();
  private updates = 0;
  private readonly st = new AnimState();
  private readonly a: Pose[] = [];
  private readonly waiting: Corpse[] = [];
  private readonly fallen: Fallen[] = [];

  /**
   * `mortal` is what each kind plays, indexed by content kind, null for a kind whose body is not drawn here. A body carries
   * its own size, so the registry's `birthScale` is not needed.
   */
  constructor(mortal: readonly (CreatureAnim | null)[], birthScale?: Float32Array) {
    this.mortal = mortal;
    void birthScale;
  }

  /**
   * Takes up the bodies among the remote entities as sampled now, forgets those no longer sent, and moves every body on to
   * `remote.tick`. (cx, cz) is where the viewer is: bodies come upon nearer it are laid to rest first. `gaits` holds the
   * gait of each body drawn, by id.
   */
  update(remote: RemoteSample, world: CollisionWorld, cx: number, cz: number, gaits: ReadonlyMap<number, Gait>): void {
    const tick = remote.tick;
    const seen = ++this.updates;
    const now = this.now;
    now.count = 0;
    for (let i = 0; i < remote.count; i++) if (this.mortal[remote.kind[i]!] && (remote.cue[i]! & CUE_DEAD) === 0) now.push(remote, i);
    // The living gone since the last frame whom the server said died, each to be met with its body when that comes.
    const was = this.was;
    const fallen = this.fallen;
    for (let k = 0; k < was.count; k++) {
      const told = remote.died.get(was.id[k]!);
      if (told === undefined || Math.abs(told - tick) > TOLD || now.has(was.id[k]!)) continue;
      fallen.push({ id: was.id[k]!, kind: was.kind[k]!, x: was.at[k * 3]!, z: was.at[k * 3 + 2]!, anim: was.anim[k]!, cue: was.cue[k]!, tick });
    }
    let kept = 0;
    for (const f of fallen) if (tick - f.tick <= LATE) fallen[kept++] = f;
    fallen.length = kept;
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (!this.mortal[kind] || (remote.cue[i]! & CUE_DEAD) === 0) continue;
      let c = this.byId.get(remote.id[i]!);
      // A body whose entity's place another has taken is a new one. A body never moves, so one elsewhere is another.
      if (c && (c.kind !== kind || c.x !== wireX(remote.x[i]!) || c.z !== wireX(remote.z[i]!))) {
        this.forget(c);
        c = undefined;
      }
      c ??= this.meet(remote, i, tick, gaits);
      c.seen = seen;
      c.decay = (remote.cue[i]! >>> CUE_DECAY_SHIFT) & 3;
    }
    for (let k = this.list.length - 1; k >= 0; k--) if (this.list[k]!.seen !== seen) this.forget(this.list[k]!);
    this.now = this.was;
    this.was = now;
    const waiting = this.waiting;
    waiting.length = 0;
    for (const c of this.list) {
      if (c.settling) waiting.push(c);
      else this.move(c, world, tick);
    }
    // Bodies come upon are laid to rest nearest first, a budget of ticks a frame.
    const far = (c: Corpse): number => (c.x - cx) * (c.x - cx) + (c.z - cz) * (c.z - cz);
    waiting.sort((p, q) => far(p) - far(q));
    let budget = BUDGET;
    for (const c of waiting) budget = this.settle(c, world, tick, budget);
  }

  private forget(c: Corpse): void {
    this.byId.delete(c.id);
    const k = this.list.indexOf(c);
    if (k >= 0) this.list.splice(k, 1);
  }

  /** A body first seen. It is a creature this client saw die if one like it, near it, was said to have died just now. */
  private meet(r: RemoteSample, i: number, tick: number, gaits: ReadonlyMap<number, Gait>): Corpse {
    const kind = r.kind[i]!;
    const m = this.mortal[kind]!;
    const rig = m.rig;
    const x = wireX(r.x[i]!);
    const y = wireY(r.y[i]!);
    const z = wireX(r.z[i]!);
    const fallen = this.fallen;
    let from = -1;
    let near = NEAR * NEAR;
    for (let k = 0; k < fallen.length; k++) {
      const f = fallen[k]!;
      const far = (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z);
      if (f.kind !== kind || far >= near) continue;
      near = far;
      from = k;
    }
    let alive: Pose | null = null;
    if (from >= 0) {
      const f = fallen[from]!;
      fallen.splice(from, 1);
      const st = this.st;
      st.unpack(f.anim, f.cue);
      st.seed = bodySeed(f.id);
      alive = new Pose(rig.bones);
      creaturePose(m, st, tick, alive, gaits.get(f.id) ?? null);
    }
    const c: Corpse = {
      kind,
      id: r.id[i]!,
      x,
      y,
      z,
      yaw: wireYaw(r.yaw[i]!),
      size: corpseSize(r.span[i]!),
      colors: r.colors.slice(i * 6, i * 6 + 6),
      born: Math.floor(tick),
      watched: alive !== null,
      lying: (r.cue[i]! & CUE_OUT) !== 0,
      decay: 0,
      alive,
      limp: false,
      fall: null,
      clock: 0,
      settling: false,
      solved: new Solved(rig.bones),
      seen: 0,
    };
    this.byId.set(c.id, c);
    this.list.push(c);
    if (!c.watched) this.goLimp(c, c.born);
    else {
      const pose = this.posed(rig.bones);
      this.dying(c, 0, pose);
      solve(rig, pose, c.solved);
    }
    return c;
  }

  /** A scratch pose for a rig of `bones`. */
  private posed(bones: number): Pose {
    return (this.a[bones] ??= new Pose(bones));
  }

  /** The pose `frame` ticks into dying: the death clip, blended in from the last pose alive. Lying, or without a clip, that pose. */
  private dying(c: Corpse, frame: number, out: Pose): void {
    const clip = this.mortal[c.kind]!.death;
    if (!clip || c.lying) {
      blendPose(out, c.alive!, c.alive!, 0);
      return;
    }
    sampleClip(clip, frame, out);
    blendPose(out, c.alive!, out, frame / BLEND);
  }

  /** It goes limp at whole tick `at`. One this client did not see fall is laid to rest before it is drawn moving. */
  private goLimp(c: Corpse, at: number): void {
    const m = this.mortal[c.kind]!;
    c.limp = true;
    c.clock = at;
    const r = layCorpse(m, c.lying, c.x, c.y, c.z, c.yaw, c.size, c.solved);
    if (r) {
      c.fall = new Fall(r);
      c.settling = !c.watched;
      return;
    }
    // A rig without a ragdoll lies as its clip ends, or as it lay.
    const rig = m.rig;
    if (m.death && !c.lying) {
      const pose = this.posed(rig.bones);
      sampleClip(m.death, m.death.frames - 1, pose);
      solve(rig, pose, c.solved);
    } else limpPose(m, c.lying, c.solved, new Solved(rig.bones));
  }

  /** Lays a body come upon to rest, as far as `budget` ticks allow. Returns the budget left. */
  private settle(c: Corpse, world: CollisionWorld, tick: number, budget: number): number {
    const fall = c.fall!;
    let n = 0;
    for (; !fall.still && n < budget; n++) fall.tick(world);
    if (n > 0) fall.ragdoll.pose(c.solved);
    if (fall.still) {
      c.settling = false;
      c.clock = Math.floor(tick);
    }
    return budget - n;
  }

  private move(c: Corpse, world: CollisionWorld, tick: number): void {
    const m = this.mortal[c.kind]!;
    const rig = m.rig;
    if (!c.limp) {
      // Watched, it plays its clip until it goes limp, or to the clip's end for a rig with no ragdoll.
      const clip = m.death;
      const end = c.lying || !clip ? 0 : rig.ragdoll ? rig.ragdoll.limp : clip.frames - 1;
      const frame = tick - c.born;
      if (frame < end) {
        const pose = this.posed(rig.bones);
        this.dying(c, frame, pose);
        solve(rig, pose, c.solved);
        return;
      }
      this.goLimp(c, c.born + end);
    }
    const fall = c.fall;
    if (!fall) return;
    const to = Math.floor(tick);
    let moved = false;
    for (let n = 0; c.clock < to && n < CATCH_UP; n++) {
      if (fall.still) {
        // Nothing moves it now but the world changing under it, which a tick finds out.
        const woke = fall.tick(world);
        moved ||= woke;
        c.clock = woke ? c.clock + 1 : to;
        continue;
      }
      c.clock++;
      fall.tick(world);
      moved = true;
    }
    if (moved) fall.ragdoll.pose(c.solved);
  }
}
