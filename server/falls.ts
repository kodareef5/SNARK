// Survivors knocked off their feet (shared/anim/human-fall.ts). Each lies as its ragdoll, stepped here a whole tick at a
// time in the physics lane, with its entity carried at the ragdoll's hips so that it is sent, hit and found where it lies;
// its session's own step leaves it be (server/players.ts). It gets up where it comes to rest once it has lain DOWN_LEAST,
// or after DOWN_MOST however it lies. Its state goes to every client that sees it as a corpse's does (server/corpse-motion.ts).
//
// Admission is at the fall: past FALLS_MOST at once a knock is refused, and the caller stuns the body standing instead.

import { TICK_RATE } from "../shared/coords.ts";
import { Fall, wireX, wireY, yawOf16 } from "../shared/anim/corpse.ts";
import { layHuman } from "../shared/anim/human-fall.ts";
import { HUMAN } from "../shared/anim/human.ts";
import { CUE_DOWN } from "../shared/anim/pose.ts";
import { Solved } from "../shared/anim/skeleton.ts";
import { encodeCorpseCheckpoint, type CorpseMotion } from "../shared/net/corpse.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { MF_DOWN, MODE_WALK } from "../shared/sim/character.ts";
import type { ServerWorld } from "./world.ts";

/** The most survivors lying at once. */
export const FALLS_MOST = 48;
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
}

const root = new Float64Array(3);

export class Falls {
  private readonly world: ServerWorld;
  private readonly down = new Map<number, Down>();
  /** Raised as a body gets up, standing at the ragdoll's hips. */
  onUp: (e: number) => void = () => {};
  readonly stats = { fell: 0, refused: 0, rose: 0 };
  /** What every fall's revisions are drawn from, so a body's next fall is newer than its last to a client. */
  private serial = 0;

  constructor(world: ServerWorld) {
    this.world = world;
  }

  get count(): number {
    return this.down.size;
  }

  /** Whether entity `e` lies knocked down. */
  isDown(e: number): boolean {
    return this.down.has(e);
  }

  /**
   * Knocks survivor `e` off its feet, moving at (vx, vy, vz) and turning at (wx, wy, wz) radians a second. False where it
   * cannot fall here (seated, swimming, already down) or FALLS_MOST already lie: the caller stuns it standing instead.
   */
  knock(e: number, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number): boolean {
    const ents = this.world.ents;
    if (this.down.has(e)) return true;
    if ((ents.flags[e]! & F_ALIVE) === 0 || ents.seat[e] !== 0 || ents.mode[e] !== MODE_WALK) return false;
    if (this.down.size >= FALLS_MOST) {
      this.stats.refused++;
      return false;
    }
    const yaw = yawOf16(ents.yaw[e]!);
    const r = layHuman(wireX(ents.x[e]!), wireY(ents.y[e]!), wireX(ents.z[e]!), yaw);
    r.launch(vx, vy, vz, wx, wy, wz);
    const d: Down = { e, gen: ents.gen[e]!, fall: new Fall(r), yaw, ticks: 0, revision: ++this.serial, world: 0, motion: null, pose: new Solved(HUMAN.bones) };
    this.down.set(e, d);
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

  /** The pose of a body lying down, about its entity's place and in the frame of `yawOf`; null for one standing. */
  poseOf(e: number): Solved | null {
    return this.down.get(e)?.pose ?? null;
  }

  /** The facing in radians a lying body's pose is in. */
  yawOf(e: number): number {
    return this.down.get(e)?.yaw ?? 0;
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
    for (const d of this.down.values()) {
      if ((ents.flags[d.e]! & F_ALIVE) === 0 || ents.gen[d.e] !== d.gen) {
        this.down.delete(d.e);
        continue;
      }
      const was = d.fall.still;
      d.fall.tick(this.world);
      d.ticks++;
      if ((d.fall.still && d.ticks >= DOWN_LEAST) || d.ticks >= DOWN_MOST) {
        this.rise(d);
        continue;
      }
      if (was !== d.fall.still) d.revision = ++this.serial;
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
    const world = r.worldRevision(this.world);
    if (d.motion && world !== d.world) d.revision = ++this.serial;
    d.world = world;
    if (d.motion && d.motion.revision === d.revision) return;
    const data = encodeCorpseCheckpoint({ x, y, z, yaw: d.yaw, size: 1, out: false, air: false, awake: r.awake, standing: true, ticks: d.fall.ticks, state: r.checkpoint() });
    // The state after the last tick it was stepped: at the fall, the one before.
    d.motion = { revision: d.revision, tick: d.ticks === 0 ? this.world.tick - 1 : this.world.tick, data };
  }

  /** Stands the body up where its hips lie. */
  private rise(d: Down): void {
    const ents = this.world.ents;
    d.fall.ragdoll.rootPosition(root);
    this.down.delete(d.e);
    ents.setPosition(d.e, root[0]!, root[1]! - HIPS_UP, root[2]!);
    ents.vx[d.e] = ents.vy[d.e] = ents.vz[d.e] = 0;
    ents.cue[d.e] = (ents.cue[d.e]! & ~CUE_DOWN) >>> 0;
    ents.mflags[d.e]! &= ~MF_DOWN;
    this.world.history.cued(d.e);
    this.stats.rose++;
    this.onUp(d.e);
  }
}
