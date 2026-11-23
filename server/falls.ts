// Survivors knocked off their feet (shared/anim/human-fall.ts). Each lies as its ragdoll, stepped here a whole tick at a
// time in the physics lane, with its entity carried at the ragdoll's hips so that it is sent, hit and found where it lies;
// its session's own step leaves it be (server/players.ts). It gets up where it comes to rest once it has lain DOWN_LEAST,
// or after DOWN_MOST however it lies. Its state goes to every client that sees it as a corpse's does (server/corpse-motion.ts).
//
// Admission is at the fall: past FALLS_MOST at once, or past FALL_UNITS_MOST of cost, a knock is refused and the caller
// topples the body by its reaction instead (server/reactions.ts). A fall among structures costs more units than one in
// the open, as its ragdoll meets more of them each substep.

import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { Fall, corpseSize, layCorpse, sizeSpan, wireX, wireY, yawOf16, type FallenState } from "../shared/anim/corpse.ts";
import { brace, layHuman, RISE_BLEND, type FallenPose } from "../shared/anim/human-fall.ts";
import { B_HEAD, B_HIPS, HUMAN } from "../shared/anim/human.ts";
import { facingOf, REACT_CREATURE_DOWN, LIE_FACINGS, LIE_WAYS } from "../shared/anim/reactions.ts";
import { quatRotate } from "../shared/math/quat.ts";
import { detAtan2, detCos, detSin, TAU } from "../shared/math/scalar.ts";
import { CUE_DOWN } from "../shared/anim/pose.ts";
import { Solved } from "../shared/anim/skeleton.ts";
import { Found } from "../shared/world/structures.ts";
import { RagdollMovers } from "./ragdoll-movers.ts";
import { encodeCorpseCheckpoint, packCorpseCheckpoint, type CorpseMotion } from "../shared/net/corpse.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { F_ALIVE, F_HELD } from "../shared/sim/entities.ts";
import { MF_DOWN, MF_OUT, MODE_WALK } from "../shared/sim/character.ts";
import { HISTORY_TICKS } from "./history.ts";
import type { ServerWorld } from "./world.ts";

/** The most survivors lying at once, and the most their falls may cost together, in units (fallCost). */
export const FALLS_MOST = 48;
export const FALL_UNITS_MOST = 64;
/** Metres a second a thrown body must fly to strike a survivor standing in its way. */
const THROWN_STRIKE = 3;
/** Ticks between the checkpoints of a fall a vehicle is pushing. */
const DISTURBED_TICKS = 6;
/** Metres round a body, and up from its feet, within which structures count toward its fall's cost. */
const COST_REACH = 2.5;
const COST_HEIGHT = 2.2;
/** Ticks a fallen body lies at least, and at most. */
const DOWN_LEAST = Math.round(1.2 * TICK_RATE);
const DOWN_MOST = 4 * TICK_RATE;
/** Metres from the hips' joint down to where the body stands up: the hips' radius, about. */
const HIPS_UP = 0.12;

interface Down {
  readonly e: number;
  readonly gen: number;
  readonly fall: Fall;
  readonly creature: boolean;
  readonly size: number;
  /** The facing it fell with, as the wire has it: hits are judged in that frame. */
  readonly yaw: number;
  ticks: number;
  revision: number;
  /** The revision it went down at: what a client was sent before it is of an earlier fall. */
  readonly begun: number;
  world: number;
  motion: CorpseMotion | null;
  firstView?: CorpseMotion;
  readonly pose: Solved;
  /** Its pose at each of the last HISTORY_TICKS ticks, and the tick each is of, for a shot judged in the past. */
  readonly poses: Solved[];
  readonly poseTick: Int32Array;
  /** Once risen, the tick it rose; its past poses are kept until no shot can reach back to them. */
  rose: number;
  from?: FallenPose;
  /** What its fall costs, in units. */
  readonly units: number;
  /** The tick its last checkpoint was written, and whether a vehicle touched it last tick. */
  sent: number;
  touched: boolean;
  carrier?: number;
  /** The bodies it has struck as it flew, each once a fall, and who knocked it down: the blame for what it strikes. */
  readonly struck: Set<number>;
  readonly by: number;
}

const root = new Float64Array(3);

export class Falls {
  private readonly world: ServerWorld;
  private readonly down = new Map<number, Down>();
  /**
   * Raised as a body gets up, standing at the ragdoll's hips: it lay face `up` or down, its head `way` (LIE_WAYS to a
   * turn) from `facing` (LIE_FACINGS to a turn), its facing as it gets up (shared/anim/reactions.ts REACT_RISE), which
   * every machine poses it rising from.
   */
  onUp: (e: number, up: boolean, way: number, facing: number) => void = () => {};
  /**
   * Raised as a thrown body strikes survivor `e` standing in its way: a change of speed of `dv` m/s along the unit (dx,
   * dz), `up` metres above its feet. `by` (a pid, 0 for none) knocked the first body down, and is to blame.
   */
  onStrike: (e: number, dv: number, dx: number, dz: number, up: number, by: number) => void = () => {};
  readonly stats = { fell: 0, refused: 0, rose: 0 };
  /** The units the falls under way cost together. */
  units = 0;
  private readonly near = new Found(32);
  private readonly cars: RagdollMovers;
  /** The tick the falls were last stepped at: set as the step ends, so a fall knocked during it is stepped with it. */
  private stepped = -1;
  /** What every fall's revisions are drawn from, so a body's next fall is newer than its last to a client. */
  private serial = 0;

  constructor(world: ServerWorld) {
    this.world = world;
    this.cars = new RagdollMovers(world);
  }

  get count(): number {
    return this.down.size;
  }

  /** How many of the bodies down are moving; the others lie at rest until they rise. */
  get moving(): number {
    let n = 0;
    for (const d of this.down.values()) if (!d.fall.still) n++;
    return n;
  }

  /** Dodos can fall while conscious and moving on their own. */
  creatureMayFall(e: number): boolean {
    const { ents, reg, anims } = this.world;
    const kind = ents.kind[e]!;
    return reg.ids[kind] === "core:dodo" && !!anims[kind]?.rig.ragdoll &&
      (ents.flags[e]! & (F_ALIVE | F_HELD)) === F_ALIVE && (ents.mflags[e]! & (MF_DOWN | MF_OUT)) === 0 &&
      ents.driven[e] === 0 && ents.seat[e] === 0 && ents.mode[e] === MODE_WALK;
  }

  /** Whether entity `e` lies knocked down. */
  isDown(e: number): boolean {
    return this.down.has(e);
  }

  /**
   * Knocks survivor `e` off its feet, moving at (vx, vy, vz) and turning at (wx, wy, wz) radians a second. False where it
   * cannot fall here (seated, swimming, already down), FALLS_MOST already lie, or its fall would cost more units than are
   * left: the caller topples it instead.
   */
  knock(e: number, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number, by = 0): boolean {
    const ents = this.world.ents;
    if (this.down.has(e)) return true;
    if ((ents.flags[e]! & F_ALIVE) === 0 || ents.seat[e] !== 0 || ents.mode[e] !== MODE_WALK) return false;
    const kind = ents.kind[e]!, creature = this.world.reg.ids[kind] !== "core:survivor";
    if (creature && !this.creatureMayFall(e)) return false;
    const units = this.cost(ents.x[e]!, ents.y[e]!, ents.z[e]!);
    if (this.down.size >= FALLS_MOST || this.units + units > FALL_UNITS_MOST) {
      this.stats.refused++;
      return false;
    }
    const yaw = yawOf16(ents.yaw[e]!);
    const anim = creature ? this.world.anims[kind]! : null;
    const size = creature && ents.grown[e] ? corpseSize(sizeSpan(youngScale(this.world.reg.birthScale[kind]!, ents.span[e]!, ents.grown[e]!, this.world.tick))) : 1;
    const pose = new Solved(anim?.rig.bones ?? HUMAN.bones);
    const x = wireX(ents.x[e]!), y = wireY(ents.y[e]!), z = wireX(ents.z[e]!);
    const r = anim ? layCorpse(anim, false, false, x, y, z, yaw, size, pose, true) : layHuman(x, y, z, yaw);
    if (!r) return false;
    r.launch(vx, vy, vz, wx, wy, wz);
    const fall = new Fall(r);
    if (!creature) fall.reflex = brace;
    const revision = ++this.serial;
    const d: Down = { e, gen: ents.gen[e]!, fall, yaw, ticks: 0, revision, begun: revision, world: 0, motion: null, pose, creature, size,
      poses: Array.from({ length: HISTORY_TICKS }, () => new Solved(anim?.rig.bones ?? HUMAN.bones)), poseTick: new Int32Array(HISTORY_TICKS).fill(-1), rose: -1, units, sent: this.world.tick, touched: false, struck: new Set(), by };
    this.down.set(e, d);
    this.units += units;
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    // Its facing as it fell, as sent, which its pose is in.
    ents.yaw[e] = ((ents.yaw[e]! >>> 6) << 6) & 0xffff;
    if (creature) {
      ents.react[e] = REACT_CREATURE_DOWN;
      this.world.history.reacted(e);
    } else ents.cue[e] = (ents.cue[e]! | CUE_DOWN) >>> 0;
    // Its own client is told by its body's flags, as its snapshot carries no cue of its own.
    ents.mflags[e]! |= MF_DOWN;
    this.world.history.cued(e);
    this.place(d);
    this.stats.fell++;
    return true;
  }

  /**
   * What a fall at (x, y, z) costs, in units: one in the open, and one more for every four structures or nodes it may meet,
   * up to six. Measured where it stands as it falls, never again.
   */
  cost(x: number, y: number, z: number): number {
    let count = 0;
    for (const store of [this.world.structs, this.world.nodes]) {
      if (!store) continue;
      count += store.query(x - COST_REACH, z - COST_REACH, x + COST_REACH, z + COST_REACH, this.near, y - 0.5, y + COST_HEIGHT);
    }
    return Math.min(6, 1 + Math.floor(count / 4));
  }

  /**
   * A body flying fast enough strikes the survivors standing where its capsules pass, once each: half its speed goes
   * into them, as two bodies of a weight meet.
   */
  private strikeStanding(d: Down): void {
    const r = d.fall.ragdoll, { ents, reg, dims } = this.world;
    // The whole body's velocity, by each part's share of its mass.
    let vx = 0, vz = 0, mass = 0;
    for (let i = 0; i < r.n; i++) {
      const m = r.def.mass[i]!;
      vx += r.v[i * 3]! * m; vz += r.v[i * 3 + 2]! * m; mass += m;
    }
    vx /= mass; vz /= mass;
    const speed = Math.sqrt(vx * vx + vz * vz);
    if (speed < THROWN_STRIKE) return;
    r.rootPosition(root);
    const x = root[0]!, z = root[2]!, cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const kx = cx + ox, kz = cz + oz;
      if (kx < 0 || kz < 0 || kx >= dims.chunksX || kz >= dims.chunksZ) continue;
      for (let e = ents.chunkHead[kz * dims.chunksX + kx]!; e >= 0; e = ents.next[e]!) {
        if (e === d.e || d.struck.has(e) || this.down.has(e) || (ents.flags[e]! & F_ALIVE) === 0 || reg.vehicle[ents.kind[e]!]) continue;
        const ex = ents.x[e]!, ey = ents.y[e]!, ez = ents.z[e]!, radius = reg.bodyRadius[ents.kind[e]!]!, height = reg.bodyHeight[ents.kind[e]!]!;
        if ((ex - x) * (ex - x) + (ez - z) * (ez - z) > 9) continue;
        for (let i = 0; i < r.n; i++) {
          const px = r.x[i * 3]! - ex, py = r.x[i * 3 + 1]! - ey, pz = r.x[i * 3 + 2]! - ez;
          if (py < 0 || py > height || px * px + pz * pz > (radius + 0.15) * (radius + 0.15)) continue;
          d.struck.add(e);
          this.onStrike(e, speed / 2, vx / speed, vz / speed, py, d.by);
          break;
        }
      }
    }
  }

  /** Lets go of a fall's cost as it ends. */
  private ended(d: Down): void {
    this.down.delete(d.e);
    this.units -= d.units;
  }

  /** The pose of a body lying down, about its entity's place and in the frame of `yawOf`; null for one standing. */
  poseOf(e: number): Solved | null {
    return this.down.get(e)?.pose ?? null;
  }

  /**
   * The pose body `e` lay in at `tick`, which its history says it lay down in (CUE_DOWN), for a shot judged then: from
   * whichever of its falls kept lay then, for a body knocked down again keeps the fall before. The nearest kept where no
   * fall kept that tick's.
   */
  poseAt(e: number, tick: number): Solved | null {
    const d = this.fallAt(e, tick), k = tick & (HISTORY_TICKS - 1);
    return d && d.poseTick[k] === tick ? d.poses[k]! : d?.pose ?? null;
  }

  sizeAt(e: number, tick: number): number {
    return this.fallAt(e, tick)?.size ?? 1;
  }

  private fallAt(e: number, tick: number): Down | undefined {
    const k = tick & (HISTORY_TICKS - 1), now = this.down.get(e), before = this.risen.get(e);
    if (now?.poseTick[k] === tick) return now;
    if (before) for (let i = before.length - 1; i >= 0; i--) if (before[i]!.poseTick[k] === tick) return before[i];
    return now ?? before?.[before.length - 1];
  }
  /** Falls that rose within HISTORY_TICKS, by entity, the last to rise last. */
  private readonly risen = new Map<number, Down[]>();

  /** The physical pose that started this rise, including a rise preceding a second knockdown. */
  riseFrom(e: number, tick: number): FallenPose | null {
    const falls = this.risen.get(e);
    if (falls) for (let i = falls.length - 1; i >= 0; i--) {
      const d = falls[i]!;
      if (d.gen === this.world.ents.gen[e] && tick >= d.rose && tick < d.rose + RISE_BLEND) return d.from ?? null;
    }
    return null;
  }

  /** The facing in radians a lying body's pose is in. */
  yawOf(e: number): number {
    return this.down.get(e)?.yaw ?? 0;
  }

  /**
   * Takes body `e`'s fall away as it dies lying, for its corpse to lie on as it was (server/corpses.ts): its ragdoll's
   * state, laid standing; null for one not down.
   */
  take(e: number): FallenState | null {
    const d = this.down.get(e);
    if (!d) return null;
    this.ended(d);
    return { size: d.size, state: d.fall.ragdoll.checkpoint(), awake: d.fall.ragdoll.awake, ticks: d.fall.ticks, carrier: d.fall.ragdoll.carrier };
  }

  /** For CorpseReplication: what changed last, and the checkpoint to send. */
  motionRevision(e: number): number {
    return this.down.get(e)?.revision ?? 0;
  }

  motionBegun(e: number): number {
    return this.down.get(e)?.begun ?? 0;
  }

  motion(e: number, delivery?: "first" | "correction"): CorpseMotion | null {
    const d = this.down.get(e), motion = d?.motion;
    if (!d || !motion) return null;
    const tick = this.world.tick;
    if (delivery !== "first" || tick - motion.tick < DISTURBED_TICKS) return motion;
    if (d.firstView?.tick === tick) return d.firstView;
    const r = d.fall.ragdoll, ents = this.world.ents;
    // A late viewer has no vehicle history for the launch. Share the exact current state with everyone arriving this tick.
    const data = d.fall.still && !r.carrier ? motion.data : encodeCorpseCheckpoint({
      x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: d.yaw, size: d.size, out: false, air: false,
      awake: r.awake, standing: true, carrier: r.carrier, ticks: d.fall.ticks, state: r.checkpoint(),
    });
    return d.firstView = { revision: d.revision, tick, data };
  }

  step(): void {
    const ents = this.world.ents;
    for (const [e, falls] of this.risen) {
      while (falls.length > 0 && this.world.tick - falls[0]!.rose > HISTORY_TICKS + RISE_BLEND) falls.shift();
      if (falls.length === 0) this.risen.delete(e);
    }
    for (const d of this.down.values()) {
      if ((ents.flags[d.e]! & F_ALIVE) === 0 || ents.gen[d.e] !== d.gen) {
        this.ended(d);
        continue;
      }
      const was = d.fall.still, r = d.fall.ragdoll;
      r.movers = this.cars.near(r);
      d.fall.tick(this.world);
      d.ticks++;
      if ((d.fall.still && d.ticks >= DOWN_LEAST) || d.ticks >= DOWN_MOST) {
        this.rise(d);
        continue;
      }
      if (was !== d.fall.still) d.revision = ++this.serial;
      if (!d.creature && !d.fall.still) this.strikeStanding(d);
      // A vehicle pushing it is outside what a client can step alike: it is told again while that lasts, and as it ends.
      if (r.carrier?.handle !== d.carrier || (r.touched && this.world.tick - d.sent >= DISTURBED_TICKS) || (d.touched && !r.touched)) d.revision = ++this.serial;
      d.carrier = r.carrier?.handle;
      d.touched = r.touched;
      this.place(d);
    }
    this.stepped = this.world.tick;
  }

  /** Carries the entity to the ragdoll's hips, poses it there, and writes the checkpoint a client lays it from. */
  private place(d: Down): void {
    const r = d.fall.ragdoll, ents = this.world.ents;
    r.rootPosition(root);
    const x = wireX(root[0]!), y = wireY(root[1]!), z = wireX(root[2]!);
    r.rebase(x, y, z);
    ents.setPosition(d.e, x, y, z);
    const world = r.worldRevision(this.world);
    if (d.motion && world !== d.world) d.revision = ++this.serial;
    d.world = world;
    if (d.motion?.revision !== d.revision) {
      d.sent = this.world.tick;
      const state = r.checkpoint();
      const data = packCorpseCheckpoint({ x, y, z, yaw: d.yaw, size: d.size, out: false, air: false,
        awake: r.awake, standing: true, carrier: r.carrier, ticks: d.fall.ticks, state });
      r.restore(state, r.awake);
      // A fall created before this tick's step still holds the previous tick's state.
      const tick = d.ticks === 0 && this.stepped !== this.world.tick ? this.world.tick - 1 : this.world.tick;
      d.motion = { revision: d.revision, tick, data };
    }
    r.pose(d.pose);
    const k = this.world.tick & (HISTORY_TICKS - 1);
    d.poses[k]!.rot.set(d.pose.rot);
    d.poses[k]!.pos.set(d.pose.pos);
    d.poseTick[k] = this.world.tick;
  }

  /** Stands the body up where its hips lie. */
  private rise(d: Down): void {
    const ents = this.world.ents;
    d.fall.ragdoll.rootPosition(root);
    this.ended(d);
    d.rose = this.world.tick;
    if (!d.creature) d.from = { solved: d.pose, x: ents.x[d.e]!, y: ents.y[d.e]!, z: ents.z[d.e]!, yaw: d.yaw };
    const kept = this.risen.get(d.e);
    if (kept) kept.push(d);
    else this.risen.set(d.e, [d]);
    const r = d.fall.ragdoll;
    const feet = d.creature ? Math.max(this.world.hf.heightAt(root[0]!, root[2]!), root[1]! - r.skel.capR[r.def.bone[0]!]! * d.size) : root[1]! - HIPS_UP;
    ents.setPosition(d.e, root[0]!, feet, root[2]!);
    ents.vx[d.e] = ents.vy[d.e] = ents.vz[d.e] = 0;
    if (d.creature) {
      ents.react[d.e] = 0;
      this.world.history.reacted(d.e);
    } else ents.cue[d.e] = (ents.cue[d.e]! & ~CUE_DOWN) >>> 0;
    ents.mflags[d.e]! &= ~MF_DOWN;
    this.world.history.cued(d.e);
    this.stats.rose++;
    if (d.creature) {
      if ((ents.mflags[d.e]! & MF_OUT) === 0) this.onUp(d.e, false, 0, 0);
      return;
    }
    lyingOf(d.pose, d.yaw, ents.yaw[d.e]!);
    this.onUp(d.e, lies.up, lies.way, lies.facing);
  }
}

/** How the last pose lay: face up, and the way its head lay from its hips, LIE_WAYS to a turn from `facing`. */
const lies = { up: false, way: 0, facing: 0 };
const ahead = new Float64Array(3);

/** Writes to `lies` how pose `s` lies, about its place facing `yaw` radians, for a body whose yaw is now `bodyYaw`. */
function lyingOf(s: Solved, yaw: number, bodyYaw: number): void {
  quatRotate(s.rot, B_HIPS * 4, 0, 0, 1, ahead, 0);
  const mx = s.pos[B_HEAD * 3]! - s.pos[B_HIPS * 3]!, mz = s.pos[B_HEAD * 3 + 2]! - s.pos[B_HIPS * 3 + 2]!;
  const c = detCos(yaw), sn = detSin(yaw), wx = c * mx + sn * mz, wz = c * mz - sn * mx;
  lies.facing = facingOf(bodyYaw);
  const turn = detAtan2(wx, wz) / TAU - lies.facing / LIE_FACINGS;
  lies.up = ahead[1]! > 0;
  lies.way = ((Math.round(turn * LIE_WAYS) % LIE_WAYS) + LIE_WAYS) % LIE_WAYS;
}
