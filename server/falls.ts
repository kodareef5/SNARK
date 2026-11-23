// Survivors knocked off their feet (shared/anim/human-fall.ts). Each lies as its ragdoll, stepped here a whole tick at a
// time in the physics lane, with its entity carried at the ragdoll's hips so that it is sent, hit and found where it lies;
// its session's own step leaves it be (server/players.ts). It gets up where it comes to rest once it has lain DOWN_LEAST,
// or after DOWN_MOST however it lies. Its state goes to every client that sees it as a corpse's does (server/corpse-motion.ts).
//
// Admission is at the fall: past FALLS_MOST at once, or past FALL_UNITS_MOST of cost, a knock is refused and the caller
// topples the body by its reaction instead (server/reactions.ts). A fall among structures costs more units than one in
// the open, as its ragdoll meets more of them each substep.

import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { Fall, wireX, wireY, yawOf16 } from "../shared/anim/corpse.ts";
import { brace, layHuman } from "../shared/anim/human-fall.ts";
import { HUMAN } from "../shared/anim/human.ts";
import { CUE_DOWN } from "../shared/anim/pose.ts";
import { Solved } from "../shared/anim/skeleton.ts";
import { Found } from "../shared/world/structures.ts";
import { RagdollMovers } from "./ragdoll-movers.ts";
import { encodeCorpseCheckpoint, type CorpseMotion } from "../shared/net/corpse.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { MF_DOWN, MODE_WALK } from "../shared/sim/character.ts";
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
  /** The facing it fell with, as the wire has it: hits are judged in that frame. */
  readonly yaw: number;
  ticks: number;
  revision: number;
  world: number;
  motion: CorpseMotion | null;
  readonly pose: Solved;
  /** Its pose at each of the last HISTORY_TICKS ticks, and the tick each is of, for a shot judged in the past. */
  readonly poses: Solved[];
  readonly poseTick: Int32Array;
  /** Once risen, the tick it rose; its past poses are kept until no shot can reach back to them. */
  rose: number;
  /** What its fall costs, in units. */
  readonly units: number;
  /** The tick its last checkpoint was written, and whether a vehicle touched it last tick. */
  sent: number;
  touched: boolean;
  /** The bodies it has struck as it flew, each once a fall. */
  readonly struck: Set<number>;
}

const root = new Float64Array(3);

export class Falls {
  private readonly world: ServerWorld;
  private readonly down = new Map<number, Down>();
  /** Raised as a body gets up, standing at the ragdoll's hips. */
  onUp: (e: number) => void = () => {};
  /**
   * Raised as a thrown body strikes survivor `e` standing in its way: a change of speed of `dv` m/s along the unit (dx,
   * dz), `up` metres above its feet. Whoever threw the first body is to blame.
   */
  onStrike: (e: number, dv: number, dx: number, dz: number, up: number) => void = () => {};
  readonly stats = { fell: 0, refused: 0, rose: 0 };
  /** The units the falls under way cost together. */
  units = 0;
  private readonly near = new Found(32);
  private readonly cars: RagdollMovers;
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

  /** Whether entity `e` lies knocked down. */
  isDown(e: number): boolean {
    return this.down.has(e);
  }

  /**
   * Knocks survivor `e` off its feet, moving at (vx, vy, vz) and turning at (wx, wy, wz) radians a second. False where it
   * cannot fall here (seated, swimming, already down), FALLS_MOST already lie, or its fall would cost more units than are
   * left: the caller topples it instead.
   */
  knock(e: number, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number): boolean {
    const ents = this.world.ents;
    if (this.down.has(e)) return true;
    if ((ents.flags[e]! & F_ALIVE) === 0 || ents.seat[e] !== 0 || ents.mode[e] !== MODE_WALK) return false;
    const units = this.cost(ents.x[e]!, ents.y[e]!, ents.z[e]!);
    if (this.down.size >= FALLS_MOST || this.units + units > FALL_UNITS_MOST) {
      this.stats.refused++;
      return false;
    }
    const yaw = yawOf16(ents.yaw[e]!);
    const r = layHuman(wireX(ents.x[e]!), wireY(ents.y[e]!), wireX(ents.z[e]!), yaw);
    r.launch(vx, vy, vz, wx, wy, wz);
    const fall = new Fall(r);
    fall.reflex = brace;
    const d: Down = { e, gen: ents.gen[e]!, fall, yaw, ticks: 0, revision: ++this.serial, world: 0, motion: null, pose: new Solved(HUMAN.bones),
      poses: Array.from({ length: HISTORY_TICKS }, () => new Solved(HUMAN.bones)), poseTick: new Int32Array(HISTORY_TICKS).fill(-1), rose: -1, units, sent: this.world.tick, touched: false, struck: new Set() };
    this.down.set(e, d);
    this.units += units;
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    // Its facing as it fell, as sent, which its pose is in.
    ents.yaw[e] = ((ents.yaw[e]! >>> 6) << 6) & 0xffff;
    ents.cue[e] = (ents.cue[e]! | CUE_DOWN) >>> 0;
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
          this.onStrike(e, speed / 2, vx / speed, vz / speed, py);
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
   * The pose body `e` lay in at `tick`, which its history says it lay down in (CUE_DOWN), for a shot judged then; the
   * nearest kept where that tick's is not.
   */
  poseAt(e: number, tick: number): Solved | null {
    const d = this.down.get(e) ?? this.risen.get(e);
    if (!d) return null;
    const k = tick & (HISTORY_TICKS - 1);
    return d.poseTick[k] === tick ? d.poses[k]! : d.pose;
  }
  /** Bodies that rose within HISTORY_TICKS, by entity. */
  private readonly risen = new Map<number, Down>();

  /** The facing in radians a lying body's pose is in. */
  yawOf(e: number): number {
    return this.down.get(e)?.yaw ?? 0;
  }

  /**
   * Takes body `e`'s fall away as it dies lying, for its corpse to lie on as it was (server/corpses.ts): its ragdoll's
   * state, laid standing; null for one not down.
   */
  take(e: number): { readonly state: Float64Array; readonly awake: boolean; readonly ticks: number } | null {
    const d = this.down.get(e);
    if (!d) return null;
    this.ended(d);
    return { state: d.fall.ragdoll.checkpoint(), awake: d.fall.ragdoll.awake, ticks: d.fall.ticks };
  }

  /** For CorpseReplication: what changed last, and the checkpoint to send. */
  motionRevision(e: number): number {
    return this.down.get(e)?.revision ?? 0;
  }

  motion(e: number): CorpseMotion | null {
    return this.down.get(e)?.motion ?? null;
  }

  step(): void {
    const ents = this.world.ents;
    for (const d of this.risen.values()) if (this.world.tick - d.rose > HISTORY_TICKS) this.risen.delete(d.e);
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
      if (!d.fall.still) this.strikeStanding(d);
      // A vehicle pushing it is outside what a client can step alike: it is told again while that lasts, and as it ends.
      if ((r.touched && this.world.tick - d.sent >= DISTURBED_TICKS) || (d.touched && !r.touched)) d.revision = ++this.serial;
      d.touched = r.touched;
      this.place(d);
    }
  }

  /** Carries the entity to the ragdoll's hips, poses it there, and writes the checkpoint a client lays it from. */
  private place(d: Down): void {
    const r = d.fall.ragdoll, ents = this.world.ents;
    r.rootPosition(root);
    const x = wireX(root[0]!), y = wireY(root[1]!), z = wireX(root[2]!);
    r.rebase(x, y, z);
    ents.setPosition(d.e, x, y, z);
    r.pose(d.pose);
    const k = this.world.tick & (HISTORY_TICKS - 1);
    d.poses[k]!.rot.set(d.pose.rot);
    d.poses[k]!.pos.set(d.pose.pos);
    d.poseTick[k] = this.world.tick;
    const world = r.worldRevision(this.world);
    if (d.motion && world !== d.world) d.revision = ++this.serial;
    d.world = world;
    if (d.motion && d.motion.revision === d.revision) return;
    d.sent = this.world.tick;
    const data = encodeCorpseCheckpoint({ x, y, z, yaw: d.yaw, size: 1, out: false, air: false, awake: r.awake, standing: true, ticks: d.fall.ticks, state: r.checkpoint() });
    // The state after the last tick it was stepped: at the fall, the one before.
    d.motion = { revision: d.revision, tick: d.ticks === 0 ? this.world.tick - 1 : this.world.tick, data };
  }

  /** Stands the body up where its hips lie. */
  private rise(d: Down): void {
    const ents = this.world.ents;
    d.fall.ragdoll.rootPosition(root);
    this.ended(d);
    d.rose = this.world.tick;
    this.risen.set(d.e, d);
    ents.setPosition(d.e, root[0]!, root[1]! - HIPS_UP, root[2]!);
    ents.vx[d.e] = ents.vy[d.e] = ents.vz[d.e] = 0;
    ents.cue[d.e] = (ents.cue[d.e]! & ~CUE_DOWN) >>> 0;
    ents.mflags[d.e]! &= ~MF_DOWN;
    this.world.history.cued(d.e);
    this.stats.rose++;
    this.onUp(d.e);
  }
}
