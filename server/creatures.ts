// Creatures: spawning, dormancy, and a placeholder wander behaviour.
//
// The cost model, which later AI must keep:
//   - A chunk is awake while a player is within `wakeRadius` chunks of it.
//     Creatures in sleeping chunks are rows: not stepped, not iterated.
//   - Awake creatures are held in one dense list, so a tick touches exactly the
//     creatures that can matter to someone.
//   - A creature standing still on the ground is skipped without a collision query.
//   - Hunger and every other slow quantity is lazy (shared/sim/lazy.ts). The
//     moment food runs out is a deadline, which fires on time whether or not
//     the creature is awake.

import { TICK_DT, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { Body, stepBody } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_PLAYER } from "../shared/sim/entities.ts";
import { rollWild } from "../shared/sim/genome.ts";
import { MICRO, lazyValue, lazyZeroTick, ratePerTick } from "../shared/sim/lazy.ts";
import { DeadlineHeap } from "../shared/sim/schedule.ts";
import { Rng } from "../shared/rng.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_STARVE = 1;
/** Palette indices wild creatures may roll for a colour region. */
const WILD_COLORS = [3, 5, 6, 7, 9, 12, 15];

export class Creatures {
  /** Chunks around a player that stay awake. */
  readonly wakeRadius: number;
  readonly deadlines = new DeadlineHeap();
  awakeCount = 0;
  /** Creatures run through collision in the last step, for measurement. */
  stepped = 0;
  /** Creatures whose food has run out. */
  readonly starving = new Set<number>();

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly rng: Rng;
  private readonly awake: Int32Array;
  private readonly awakeSlot: Int32Array;
  /** Players keeping each chunk awake. */
  private readonly chunkRefs: Uint16Array;
  private readonly aiNext: Uint32Array;
  private readonly aiMove: Int8Array;
  private readonly foodRate: Int32Array;
  private readonly foodMax: Float64Array;
  private readonly body = new Body();

  constructor(world: ServerWorld, records: Records, seed: number, wakeRadius = 3) {
    this.world = world;
    this.records = records;
    this.rng = new Rng(seed);
    this.wakeRadius = wakeRadius;
    const cap = world.ents.cap;
    this.awake = new Int32Array(cap);
    this.awakeSlot = new Int32Array(cap).fill(-1);
    this.chunkRefs = new Uint16Array(chunkCount(world.dims));
    this.aiNext = new Uint32Array(cap);
    this.aiMove = new Int8Array(cap);
    const kinds = world.reg.defs.length;
    this.foodRate = new Int32Array(kinds);
    this.foodMax = new Float64Array(kinds);
    for (let k = 1; k < kinds; k++) {
      const d = world.reg.defs[k]!;
      if (d.type !== "species" || !d.food) continue;
      this.foodRate[k] = -ratePerTick(d.food.perHour);
      this.foodMax[k] = d.food.max * MICRO;
    }
  }

  /** Create a wild creature with a rolled genome. Returns its entity index, or -1 if there is no room. */
  spawn(kind: number, x: number, z: number, level: number): number {
    const world = this.world;
    const p = world.reg.move[kind];
    if (!p) return -1;
    const y = world.hf.heightAt(x, z);
    if (!capsuleFree(world, x, y, z, p.radius, p.height)) return -1;
    const rec = this.records.create(kind);
    rec.x = x;
    rec.y = y;
    rec.z = z;
    rec.yaw = this.rng.int(65536);
    rec.genome = rollWild(this.rng, level, WILD_COLORS);
    if (this.foodMax[kind]! > 0) {
      rec.food0 = this.foodMax[kind]!;
      rec.foodTick = world.tick;
    }
    return this.adopt(rec);
  }

  /** Put a creature that already has a record (new or loaded) into the simulation. */
  adopt(rec: EntityRecord): number {
    const ents = this.world.ents;
    const e = ents.create(rec.kind, rec.x, rec.y, rec.z, 0);
    if (e < 0) return -1;
    ents.yaw[e] = rec.yaw;
    ents.pid[e] = rec.pid;
    this.records.entOf.set(rec.pid, e);
    this.aiNext[e] = 0;
    this.aiMove[e] = 0;
    if (rec.foodTick >= 0) this.scheduleStarve(rec);
    if (this.chunkRefs[ents.chunk[e]!]! > 0) this.wake(e);
    return e;
  }

  /** Food right now, in whole points. */
  foodOf(rec: EntityRecord): number {
    return lazyValue(rec.food0, rec.foodTick, this.foodRate[rec.kind]!, this.foodMax[rec.kind]!, this.world.tick) / MICRO;
  }

  /** Add food (negative to remove). Re-bases the lazy value and moves the starvation deadline. */
  feed(rec: EntityRecord, points: number): void {
    const kind = rec.kind;
    const now = lazyValue(rec.food0, rec.foodTick, this.foodRate[kind]!, this.foodMax[kind]!, this.world.tick);
    const next = now + Math.round(points * MICRO);
    rec.food0 = next < 0 ? 0 : next > this.foodMax[kind]! ? this.foodMax[kind]! : next;
    rec.foodTick = this.world.tick;
    this.records.dirty.add(rec.pid);
    if (rec.food0 > 0) this.starving.delete(rec.pid);
    this.scheduleStarve(rec);
  }

  /** A player entered the world or changed chunk. `from` is -1 on entry; `to` is -1 on exit. */
  playerMoved(from: number, to: number): void {
    // Add the new neighbourhood before removing the old, so shared chunks never dip to zero.
    if (to >= 0) this.adjust(to, 1);
    if (from >= 0) this.adjust(from, -1);
  }

  /** Run due deadlines and step every awake creature once. */
  step(tick: number): void {
    this.deadlines.run(tick, (kind, pid, at) => {
      if (kind !== DEADLINE_STARVE) return;
      const rec = this.records.byPid.get(pid);
      // Stale if the creature is gone or has eaten since this was scheduled.
      if (!rec || lazyZeroTick(rec.food0, rec.foodTick, this.foodRate[rec.kind]!) !== at) return;
      this.starving.add(pid);
    });

    const world = this.world;
    const ents = world.ents;
    const b = this.body;
    const rng = this.rng;
    let stepped = 0;
    for (let n = this.awakeCount - 1; n >= 0; n--) {
      const e = this.awake[n]!;
      if (tick >= this.aiNext[e]!) {
        // Wander: pick a heading and walk, or stand, for a few seconds.
        this.aiMove[e] = rng.int(3) === 0 ? 0 : 90;
        ents.yaw[e] = rng.int(65536);
        this.aiNext[e] = tick + 30 + rng.int(150);
      }
      const flags = ents.flags[e]!;
      const move = this.aiMove[e]!;
      if (move === 0 && (flags & F_GROUNDED) !== 0 && ents.vx[e] === 0 && ents.vz[e] === 0) continue;
      b.x = ents.x[e]!;
      b.y = ents.y[e]!;
      b.z = ents.z[e]!;
      b.vx = ents.vx[e]!;
      b.vy = ents.vy[e]!;
      b.vz = ents.vz[e]!;
      b.grounded = (flags & F_GROUNDED) !== 0;
      stepBody(world, b, 0, move, ents.yaw[e]!, 0, world.reg.move[ents.kind[e]!]!, TICK_DT);
      stepped++;
      ents.vx[e] = b.vx;
      ents.vy[e] = b.vy;
      ents.vz[e] = b.vz;
      ents.flags[e] = b.grounded ? flags | F_GROUNDED : flags & ~F_GROUNDED;
      // Walking into a sleeping chunk puts the creature to sleep there.
      if (ents.setPosition(e, b.x, b.y, b.z) && this.chunkRefs[ents.chunk[e]!] === 0) this.sleep(e);
    }
    this.stepped = stepped;
  }

  private scheduleStarve(rec: EntityRecord): void {
    const at = lazyZeroTick(rec.food0, rec.foodTick, this.foodRate[rec.kind]!);
    if (at !== Infinity) this.deadlines.push(at, DEADLINE_STARVE, rec.pid, at);
  }

  private adjust(center: number, delta: number): void {
    const dims = this.world.dims;
    const ents = this.world.ents;
    const cx = chunkCx(dims, center);
    const cz = chunkCz(dims, center);
    const r = this.wakeRadius;
    for (let z = Math.max(0, cz - r); z <= Math.min(dims.chunksZ - 1, cz + r); z++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(dims.chunksX - 1, cx + r); x++) {
        const chunk = z * dims.chunksX + x;
        const before = this.chunkRefs[chunk]!;
        this.chunkRefs[chunk] = before + delta;
        if (before === 0 && delta > 0) {
          for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) this.wake(e);
        } else if (before === 1 && delta < 0) {
          for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) this.sleep(e);
        }
      }
    }
  }

  private wake(e: number): void {
    const ents = this.world.ents;
    const flags = ents.flags[e]!;
    if ((flags & F_ALIVE) === 0 || (flags & F_PLAYER) !== 0 || this.awakeSlot[e]! >= 0) return;
    this.awakeSlot[e] = this.awakeCount;
    this.awake[this.awakeCount++] = e;
    ents.flags[e] = flags | F_AWAKE;
  }

  private sleep(e: number): void {
    const slot = this.awakeSlot[e]!;
    if (slot < 0) return;
    const ents = this.world.ents;
    const last = this.awake[--this.awakeCount]!;
    this.awake[slot] = last;
    this.awakeSlot[last] = slot;
    this.awakeSlot[e] = -1;
    ents.flags[e] = ents.flags[e]! & ~F_AWAKE;
    ents.vx[e] = 0;
    ents.vy[e] = 0;
    ents.vz[e] = 0;
  }
}
