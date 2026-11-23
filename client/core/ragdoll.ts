// Bodies that died. A dead creature's body is an entity of its own, sent with CUE_DEAD (shared/anim/pose.ts), and lies
// where it fell until it is used up or decays (server/corpses.ts). A client that saw the creature die plays its death clip
// where the body lies, and the body goes limp as a ragdoll (shared/anim/ragdoll.ts) at the frame its asset gives; one that
// died knocked out goes limp as it lay. A client that comes upon a body later lays it to rest in bounded slices. Either way its
// ragdoll starts from the same pose and is stepped a whole tick at a time (shared/anim/corpse.ts), so every client, and
// the server that judges the blows on it, have it lie the same.
//
// A body that died in the air or in the water is sent falling (FALLING) where the server has it as it falls or sinks.
// It is drawn there limp, as it goes limp or as it lay, and goes limp as a ragdoll only once it is sent lying still, at
// the place the wire then carries. One that died in its own flight plays its death in the air (CUE_FELL).
//
// A survivor knocked down (CUE_DOWN) lies as the server's ragdoll (shared/anim/human-fall.ts), sent and stepped as a
// moving corpse's is (HumanFalls), and is drawn rising from it once it gets up.

import { Pose, blendPose, sampleClip } from "../../shared/anim/clip.ts";
import { Fall, SETTLE_TICKS, bodyFalls, corpseSize, deathOf, diedAloft, layCorpse, limpPose, wireX, wireY, wireYaw } from "../../shared/anim/corpse.ts";
import { layHuman } from "../../shared/anim/human-fall.ts";
import { HUMAN } from "../../shared/anim/human.ts";
import { poseCreatureOn, type CreatureAnim } from "../../shared/anim/creature.ts";
import type { Gait } from "../../shared/anim/gait.ts";
import { AnimState, CUE_DEAD, CUE_DECAY_SHIFT, CUE_DOWN, CUE_OUT, FLY_SPEED_STEP, SPEED_STEP, bodySeed } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { handleIndex, makeHandle } from "../../shared/ids.ts";
import { decodeCorpseCheckpoint, type CorpseMotion } from "../../shared/net/corpse.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { RemoteSample } from "./session.ts";

/** Ticks over which the last pose alive blends into the death clip. */
const BLEND = 4;
/** Ticks between the snapshot that said a creature died and the frame it was last drawn, either way, for it to have died there. */
const TOLD = 8;
/** Ticks after that within which its body may come, in a later snapshot when the one that said it died was full. */
const LATE = 30;
/**
 * Metres between where a creature was last drawn and where its body comes, for the two to be one, and more by how far it
 * went in TOLD ticks at the speed it was drawn going: a flyer at 19 m/s goes 5 m.
 */
const NEAR = 2;
/** Shared fast-forward ticks per frame for first-seen bodies, starting nearest and then rotating fairly. */
const BUDGET = 60;
/** Ticks one watched body is stepped in one frame when frames come slowly. Those left are stepped in the frames after. */
const CATCH_UP = 6;
/** A newly visible moving body asks for current authority rather than replaying an old world for minutes. */
const CHECKPOINT_AGE = TICK_RATE;
/** Ticks a survivor's fall is stepped in one frame. Its ragdoll lies four seconds at most, so a late one soon catches up. */
const FALL_CATCH_UP = 30;
/** Ticks a survivor takes to rise from where it lay into what it does now. */
export const GET_UP = 30;
const impactRoot = new Float64Array(3);

export interface Corpse {
  readonly kind: number;
  readonly id: number;
  /** Slot and generation, for sparse physical checkpoints and reuse invalidation. */
  readonly handle: number;
  /**
   * Where it went limp, as the wire has it, or while it falls where it was last sampled; its yaw in radians and its size,
   * and the six colours of its regions.
   */
  x: number;
  y: number;
  z: number;
  readonly yaw: number;
  /** Vehicle salvage with full attitude is rigid and retains its replicated full attitude, including inversion. */
  readonly rigid: boolean;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  readonly size: number;
  readonly colors: Uint8Array;
  /** The whole tick its death clip starts at. */
  readonly born: number;
  /** This client saw it die, and plays its death clip. */
  readonly watched: boolean;
  /** It died knocked out, and goes limp as it lay. */
  readonly lying: boolean;
  /** It died in its own flight, and plays its death in the air. */
  readonly air: boolean;
  /** Ordinary descent or sinking, as replicated. Landed is the first observed support tick, including a launched ragdoll. */
  falling: boolean;
  landed: number;
  /** The supporting face of a watched, launched ragdoll. Its first coordinate is NaN until contact. */
  impact?: Float64Array;
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
  /** Total fast-forward work for an ordinary first-seen body; any remainder advances at the render clock. */
  settledTicks: number;
  /** The pose to draw, solved, about (x, y, z). */
  readonly solved: Solved;
  /** The update that last saw its entity. */
  seen: number;
  motionRevision: number;
  motionTick: number;
}

/** The render tick for an authored death impact. A launched ragdoll bypasses the collapse clip. */
export function corpseDownAt(c: Corpse, clipSeconds: number): number {
  if (c.falling) return Infinity;
  if (c.motionRevision) return c.landed || Infinity;
  return Math.max(c.landed, c.born + clipSeconds * TICK_RATE);
}

/** A creature the server said died, as it was last drawn, waiting for its body. */
interface Fallen {
  id: number;
  kind: number;
  x: number;
  z: number;
  /** How far from (x, z) its body may come, in metres. */
  near: number;
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

/** A survivor knocked down (CUE_DOWN), lying as its ragdoll, and for GET_UP ticks after it gets up; or a survivor's body (CUE_DEAD). */
export interface HumanFall {
  handle: number;
  /** Null until its checkpoint comes, and once it has risen. */
  fall: Fall | null;
  /** The whole tick the fall has been stepped to. */
  clock: number;
  motionRevision: number;
  motionTick: number;
  /** Checkpoints up to this tick are of an earlier fall. */
  spent: number;
  /** Where its pose is about, as the wire has it, and its facing in radians. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Its pose, solved on HUMAN's rest, about (x, y, z) facing `yaw`. */
  readonly solved: Solved;
  /** Lying. Once up, the render tick it got up at, and how far it has risen, 0 to 1. */
  down: boolean;
  upAt: number;
  risen: number;
  seen: number;
}

const fallRoot = new Float64Array(3);

/** Survivors knocked down among the remote entities and the viewer's own body, each lying as the server's ragdoll. */
export class HumanFalls {
  private readonly byId = new Map<number, HumanFall>();
  private readonly survivor: (kind: number) => boolean;
  private updates = 0;

  constructor(survivor: (kind: number) => boolean) {
    this.survivor = survivor;
  }

  /** The fall to draw entity `id` by, lying or getting up, or undefined to draw it as it moves. */
  of(id: number): HumanFall | undefined {
    const h = this.byId.get(id);
    return h && (h.down || h.upAt >= 0) && h.fall ? h : undefined;
  }

  /** `own` is the handle of the viewer's own body (0 for none), which is not in `remote`, and `ownDown` whether it lies knocked down. */
  update(remote: RemoteSample, world: CollisionWorld, motions: ReadonlyMap<number, CorpseMotion> | undefined, own: number, ownDown: boolean): void {
    const tick = remote.tick, seen = ++this.updates;
    for (let i = 0; i < remote.count; i++) {
      // A survivor's body (CUE_DEAD) lies as its ragdoll for good.
      if (!this.survivor(remote.kind[i]!)) continue;
      this.track(makeHandle(remote.id[i]!, remote.gen[i]!), remote.id[i]!, (remote.cue[i]! & (CUE_DOWN | CUE_DEAD)) !== 0, tick, seen, world, motions);
    }
    if (own !== 0) this.track(own, handleIndex(own), ownDown, tick, seen, world, motions);
    for (const [id, h] of this.byId) if (h.seen !== seen) this.byId.delete(id);
  }

  private track(handle: number, id: number, down: boolean, tick: number, seen: number, world: CollisionWorld, motions: ReadonlyMap<number, CorpseMotion> | undefined): void {
    let h = this.byId.get(id);
    if (h && h.handle !== handle) h = undefined;
    if (!h) {
      if (!down) return;
      h = { handle, fall: null, clock: 0, motionRevision: 0, motionTick: -1, spent: -1, x: 0, y: 0, z: 0, yaw: 0, solved: new Solved(HUMAN.bones), down: true, upAt: -1, risen: 0, seen };
      this.byId.set(id, h);
    }
    h.seen = seen;
    if (!down) {
      if (h.down) { h.down = false; h.upAt = tick; h.spent = Math.max(h.spent, h.motionTick); }
      if (h.upAt < 0) return;
      h.risen = Math.min(1, (tick - h.upAt) / GET_UP);
      if (h.risen >= 1) { h.upAt = -1; h.fall = null; }
      return;
    }
    if (!h.down) {
      // Knocked down again: what was sent of the last fall is spent.
      h.down = true; h.upAt = -1; h.fall = null; h.spent = Math.max(h.spent, h.motionTick);
      h.motionRevision = 0; h.motionTick = -1;
    }
    const motion = motions?.get(handle), to = Math.floor(tick);
    if (motion && motion.tick > h.spent && motion.tick <= to && (motion.revision > h.motionRevision || (motion.revision === h.motionRevision && motion.tick > h.motionTick))) this.lay(h, motion);
    const fall = h.fall;
    if (!fall) return;
    let moved = false;
    for (let n = 0; h.clock < to && n < FALL_CATCH_UP; n++) {
      h.clock++;
      moved = fall.tick(world) || moved;
    }
    if (moved) this.place(h);
  }

  /** Lays the ragdoll from its checkpoint, as the server laid it. */
  private lay(h: HumanFall, motion: CorpseMotion): void {
    const cp = decodeCorpseCheckpoint(motion.data);
    if (!cp) return;
    const r = layHuman(cp.x, cp.y, cp.z, cp.yaw, cp.out);
    if (!r.restore(cp.state, cp.awake)) return;
    h.fall = new Fall(r);
    h.fall.ticks = cp.ticks;
    h.x = cp.x; h.y = cp.y; h.z = cp.z; h.yaw = cp.yaw;
    h.clock = motion.tick; h.motionTick = motion.tick; h.motionRevision = motion.revision;
    r.pose(h.solved);
  }

  /** Carries its place to the ragdoll's hips, as the server carries its entity, and poses it there. */
  private place(h: HumanFall): void {
    const r = h.fall!.ragdoll;
    r.rootPosition(fallRoot);
    h.x = wireX(fallRoot[0]!); h.y = wireY(fallRoot[1]!); h.z = wireX(fallRoot[2]!);
    r.rebase(h.x, h.y, h.z);
    r.pose(h.solved);
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
  private readonly solvedScratch: Solved[] = [];
  private readonly waiting: Corpse[] = [];
  private settleCursor = 0;
  private readonly fallen: Fallen[] = [];
  /** Qualified IDs whose moving checkpoint is too old; the session can request a fresh visible-body checkpoint. */
  readonly needsCheckpoint = new Set<number>();

  /**
   * `mortal` is what each kind plays, indexed by content kind, null for a kind whose body is not drawn here. A body carries
   * its own size, so the registry's `birthScale` is not needed.
   */
  /** Survivors knocked down, lying as their ragdolls. */
  readonly humans: HumanFalls;

  constructor(mortal: readonly (CreatureAnim | null)[], birthScale?: Float32Array, survivor: (kind: number) => boolean = () => false) {
    this.mortal = mortal;
    this.humans = new HumanFalls(survivor);
    void birthScale;
  }

  /**
   * Takes up the bodies among the remote entities as sampled now, forgets those no longer sent, and moves every body on to
   * `remote.tick`. (cx, cz) is where the viewer is: bodies come upon nearer it are laid to rest first. `gaits` holds the
   * gait of each body drawn, by id. `own` is the viewer's own handle (0 for none), and `ownDown` whether it lies knocked down.
   */
  update(remote: RemoteSample, world: CollisionWorld, cx: number, cz: number, gaits: ReadonlyMap<number, Gait>, motions?: ReadonlyMap<number, CorpseMotion>, own = 0, ownDown = false): void {
    this.humans.update(remote, world, motions, own, ownDown);
    const tick = remote.tick;
    const seen = ++this.updates;
    const now = this.now;
    now.count = 0;
    for (let i = 0; i < remote.count; i++) if (this.mortal[remote.kind[i]!] && (remote.cue[i]! & CUE_DEAD) === 0) now.push(remote, i);
    // The living gone since the last frame whom the server said died, each to be met with its body when that comes.
    const was = this.was;
    const fallen = this.fallen;
    const st = this.st;
    for (let k = 0; k < was.count; k++) {
      const told = remote.died.get(was.id[k]!);
      if (told === undefined || Math.abs(told - tick) > TOLD || now.has(was.id[k]!)) continue;
      st.unpack(was.anim[k]!, 0);
      const speed = st.speed * (st.mode === MODE_FLYER ? FLY_SPEED_STEP : SPEED_STEP);
      fallen.push({ id: was.id[k]!, kind: was.kind[k]!, x: was.at[k * 3]!, z: was.at[k * 3 + 2]!, near: NEAR + (speed * TOLD) / TICK_RATE, anim: was.anim[k]!, cue: was.cue[k]!, tick });
    }
    let kept = 0;
    for (const f of fallen) if (tick - f.tick <= LATE) fallen[kept++] = f;
    fallen.length = kept;
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (!this.mortal[kind] || (remote.cue[i]! & CUE_DEAD) === 0) continue;
      let c = this.byId.get(remote.id[i]!);
      const handle = makeHandle(remote.id[i]!, remote.gen[i]!);
      const motion = motions?.get(handle);
      // A body whose entity's place another has taken is a new one. A body that lies never moves, so one elsewhere is another.
      if (c && (c.handle !== handle || c.kind !== kind || (!c.falling && !c.motionRevision && !motion && (c.x !== wireX(remote.x[i]!) || c.z !== wireX(remote.z[i]!))))) {
        this.forget(c);
        c = undefined;
      }
      // First visibility can precede the checkpoint's render tick. Wait those few frames instead of laying
      // a different local body on the ground and then snapping it to the authoritative airborne pose.
      if (!c && motion && motion.tick > Math.floor(tick)) continue;
      c ??= this.meet(remote, i, tick, gaits, world);
      if (motion && motion.tick <= Math.floor(tick) && (motion.revision > c.motionRevision || (motion.revision === c.motionRevision && motion.tick > c.motionTick))) this.applyMotion(c, motion, tick);
      if (c.falling) this.follow(c, remote, i, tick);
      if (c.rigid) {
        c.qx = remote.vehicleQx[i]!; c.qy = remote.vehicleQy[i]!; c.qz = remote.vehicleQz[i]!; c.qw = remote.vehicleQw[i]!;
      }
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
    // Start nearest first, then rotate fairly: one difficult corpse cannot consume a neighbour's entire budget.
    const far = (c: Corpse): number => (c.x - cx) * (c.x - cx) + (c.z - cz) * (c.z - cz);
    waiting.sort((p, q) => far(p) - far(q));
    let budget = BUDGET;
    const first = waiting.length ? this.settleCursor % waiting.length : 0;
    let visited = 0;
    for (; visited < waiting.length && budget > 0; visited++) {
      const share = Math.ceil(budget / (waiting.length - visited)), c = waiting[(first + visited) % waiting.length]!;
      budget -= share - this.settle(c, world, tick, share);
    }
    this.settleCursor = waiting.length ? (first + visited) % waiting.length : 0;
  }

  private forget(c: Corpse): void {
    this.byId.delete(c.id);
    this.needsCheckpoint.delete(c.handle);
    const k = this.list.indexOf(c);
    if (k >= 0) this.list.splice(k, 1);
  }

  /** A body first seen. It is a creature this client saw die if one like it, near it, was said to have died just now. */
  private meet(r: RemoteSample, i: number, tick: number, gaits: ReadonlyMap<number, Gait>, world: CollisionWorld): Corpse {
    const kind = r.kind[i]!;
    const m = this.mortal[kind]!;
    const rig = m.rig;
    // One still falling is where the sample has it, and lies where it lands.
    const falling = bodyFalls(r.anim[i]!);
    const x = falling ? r.x[i]! : wireX(r.x[i]!);
    const y = falling ? r.y[i]! : wireY(r.y[i]!);
    const z = falling ? r.z[i]! : wireX(r.z[i]!);
    const fallen = this.fallen;
    let from = -1;
    let nearest = Infinity;
    for (let k = 0; k < fallen.length; k++) {
      const f = fallen[k]!;
      const far = (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z);
      if (f.kind !== kind || far >= f.near * f.near || far >= nearest) continue;
      nearest = far;
      from = k;
    }
    let alive: Pose | null = null;
    const rigid = r.vehicleRotorcraft[i] !== 0 || r.vehicleBoat[i] !== 0;
    if (from >= 0 && !rigid) {
      const f = fallen[from]!;
      fallen.splice(from, 1);
      const st = this.st;
      st.unpack(f.anim, f.cue);
      st.seed = bodySeed(f.id);
      alive = new Pose(rig.bones);
      poseCreatureOn(m, st, tick, world, x, y, z, wireYaw(r.yaw[i]!), corpseSize(r.span[i]!), gaits.get(f.id) ?? null);
      alive.root.set(rig.a.root);
      alive.rot.set(rig.a.rot);
    }
    const c: Corpse = {
      kind,
      id: r.id[i]!,
      handle: makeHandle(r.id[i]!, r.gen[i]!),
      x,
      y,
      z,
      yaw: wireYaw(r.yaw[i]!),
      rigid, qx: r.vehicleQx[i]!, qy: r.vehicleQy[i]!, qz: r.vehicleQz[i]!, qw: r.vehicleQw[i]!,
      size: corpseSize(r.span[i]!),
      colors: r.colors.slice(i * 6, i * 6 + 6),
      born: Math.floor(tick),
      watched: alive !== null,
      lying: (r.cue[i]! & CUE_OUT) !== 0,
      air: diedAloft(r.cue[i]!),
      falling,
      landed: 0,
      decay: 0,
      alive,
      limp: false,
      fall: null,
      clock: 0,
      settling: false,
      settledTicks: 0,
      solved: new Solved(rig.bones),
      seen: 0,
      motionRevision: 0,
      motionTick: -1,
    };
    this.byId.set(c.id, c);
    this.list.push(c);
    if (c.watched) {
      const pose = this.posed(rig.bones);
      this.dying(c, 0, pose);
      solve(rig, pose, c.solved);
    } else if (falling) this.held(c);
    else this.goLimp(c, c.born);
    return c;
  }

  private applyMotion(c: Corpse, motion: CorpseMotion, tick: number): void {
    const checkpoint = decodeCorpseCheckpoint(motion.data), anim = this.mortal[c.kind]!;
    if (!checkpoint || checkpoint.size !== c.size || checkpoint.out !== c.lying || checkpoint.air !== c.air || checkpoint.yaw !== c.yaw) return;
    if (checkpoint.awake && tick - motion.tick > CHECKPOINT_AGE) { this.needsCheckpoint.add(c.handle); return; }
    const r = layCorpse(anim, c.lying, c.air, checkpoint.x, checkpoint.y, checkpoint.z, c.yaw, c.size, c.solved, checkpoint.standing);
    if (!r || !r.restore(checkpoint.state, checkpoint.awake)) return;
    if (c.watched && checkpoint.awake && !c.landed) {
      c.impact ??= new Float64Array([NaN, NaN, NaN]);
      r.firstSupport = c.impact;
    }
    c.x = checkpoint.x; c.y = checkpoint.y; c.z = checkpoint.z;
    c.fall = new Fall(r); c.fall.ticks = checkpoint.ticks;
    c.limp = true; c.falling = false; c.settling = false;
    if (!c.landed && !checkpoint.awake) c.landed = motion.tick;
    c.clock = motion.tick; c.motionTick = motion.tick; c.motionRevision = motion.revision;
    this.needsCheckpoint.delete(c.handle);
    r.pose(c.solved);
  }

  /**
   * Moves a falling body to where it is sampled now. Sent lying, it lands once its sample is the same as the last one and a
   * place the wire can carry, which only a body no longer moving between the two snapshots drawn has.
   */
  private follow(c: Corpse, r: RemoteSample, i: number, tick: number): void {
    const x = r.x[i]!, y = r.y[i]!, z = r.z[i]!;
    if (!bodyFalls(r.anim[i]!) && x === c.x && y === c.y && z === c.z && wireX(x) === x && wireY(y) === y && wireX(z) === z) {
      c.falling = false;
      c.landed = Math.floor(tick);
      // One watched goes limp once its clip is done as well (move).
      if (!c.watched) this.goLimp(c, c.landed);
      return;
    }
    c.x = x;
    c.y = y;
    c.z = z;
  }

  /** The pose a body not watched is drawn in while it falls: the one its ragdoll will start from, or the one it lies in without. */
  private held(c: Corpse): void {
    const m = this.mortal[c.kind]!;
    if (c.rigid) { this.lie(c); return; }
    if (m.rig.ragdoll) limpPose(m, c.lying, c.air, c.solved, this.scratch(m.rig.bones));
    else this.lie(c);
  }

  /** A rig without a ragdoll lies as its clip ends, or as it lay. */
  private lie(c: Corpse): void {
    const m = this.mortal[c.kind]!;
    const rig = m.rig;
    if (c.rigid) { const pose = this.posed(rig.bones); pose.rest(); solve(rig, pose, c.solved); return; }
    const clip = deathOf(m, c.air);
    if (clip && !c.lying) {
      const pose = this.posed(rig.bones);
      sampleClip(clip, clip.frames - 1, pose);
      solve(rig, pose, c.solved);
    } else limpPose(m, c.lying, c.air, c.solved, this.scratch(rig.bones));
  }

  /** A scratch solved pose for a rig of `bones`. */
  private scratch(bones: number): Solved {
    return (this.solvedScratch[bones] ??= new Solved(bones));
  }

  /** A scratch pose for a rig of `bones`. */
  private posed(bones: number): Pose {
    return (this.a[bones] ??= new Pose(bones));
  }

  /** The pose `frame` ticks into dying: the death clip, blended in from the last pose alive. Lying, or without a clip, that pose. */
  private dying(c: Corpse, frame: number, out: Pose): void {
    const clip = deathOf(this.mortal[c.kind]!, c.air);
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
    if (c.rigid) { this.lie(c); return; }
    const r = layCorpse(m, c.lying, c.air, c.x, c.y, c.z, c.yaw, c.size, c.solved);
    if (r) {
      c.fall = new Fall(r);
      c.settling = !c.watched;
      return;
    }
    this.lie(c);
  }

  /** Lays a body come upon to rest, as far as `budget` ticks allow. Returns the budget left. */
  private settle(c: Corpse, world: CollisionWorld, tick: number, budget: number): number {
    const fall = c.fall!;
    let n = 0;
    for (; !fall.still && n < budget && c.settledTicks < SETTLE_TICKS; n++, c.settledTicks++) fall.tick(world);
    if (n > 0) fall.ragdoll.pose(c.solved);
    if (fall.still || c.settledTicks === SETTLE_TICKS) {
      c.settling = false;
      c.clock = Math.floor(tick);
    }
    return budget - n;
  }

  private move(c: Corpse, world: CollisionWorld, tick: number): void {
    const m = this.mortal[c.kind]!;
    const rig = m.rig;
    if (!c.limp) {
      // Not watched, it is held as it goes limp until it lands, and is then laid to rest.
      if (!c.watched) return;
      // Watched, it plays its clip until it goes limp, or to the clip's end for a rig with no ragdoll, and holds that
      // frame while it still falls.
      const clip = deathOf(m, c.air);
      const end = c.lying || !clip ? 0 : rig.ragdoll ? rig.ragdoll.limp : clip.frames - 1;
      const frame = tick - c.born;
      if (frame < end || c.falling) {
        const pose = this.posed(rig.bones);
        this.dying(c, frame < end ? frame : end, pose);
        solve(rig, pose, c.solved);
        return;
      }
      this.goLimp(c, Math.max(c.born + end, c.landed));
    }
    const fall = c.fall;
    if (!fall) return;
    const to = Math.floor(tick);
    if (c.motionRevision && !fall.still && to - c.clock > CHECKPOINT_AGE) { this.needsCheckpoint.add(c.handle); return; }
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
      if (c.motionRevision && !c.landed && fall.ragdoll.supported) c.landed = c.clock;
      moved = true;
    }
    if (moved) {
      if (c.motionRevision) {
        fall.ragdoll.rootPosition(impactRoot);
        c.x = wireX(impactRoot[0]!); c.y = wireY(impactRoot[1]!); c.z = wireX(impactRoot[2]!);
        fall.ragdoll.rebase(c.x, c.y, c.z);
      }
      fall.ragdoll.pose(c.solved);
    }
  }
}
