// Creatures: spawning, dormancy, and a placeholder wander behaviour.
//
// The cost model, which later AI must keep:
//   - A chunk is awake while a player is within `wakeRadius` chunks of it.
//     Creatures in sleeping chunks are rows: not stepped, not iterated.
//   - Awake creatures are held in one dense list, so a tick touches exactly the
//     creatures that can matter to someone.
//   - A creature standing still on the ground is skipped without a collision query.
//   - Hunger and every other slow quantity is lazy and belongs to
//     server/survival.ts. The moment food runs out is a deadline, which fires on
//     time whether or not the creature is awake.

import { TICK_DT, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { Body, MODE_SWIM, stepBody } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { rollWild } from "../shared/sim/genome.ts";
import { Rng } from "../shared/rng.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { EntityRecord, Records } from "./records.ts";
import { refreshMods, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

/** How long a creature that was hurt runs for. */
const FLEE_TICKS = 150;
/** Palette indices wild creatures may roll for a colour region. */
const WILD_COLORS = [3, 5, 6, 7, 9, 12, 15];

export class Creatures {
  /** Chunks around a player that stay awake. */
  readonly wakeRadius: number;
  awakeCount = 0;
  /** Creatures run through collision in the last step, for measurement. */
  stepped = 0;

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly survival: Survival;
  private readonly rng: Rng;
  /** Entity slots of the awake creatures; the first `awakeCount` entries. */
  readonly awake: Int32Array;
  private readonly awakeSlot: Int32Array;
  /** Players keeping each chunk awake. */
  private readonly chunkRefs: Uint16Array;
  private readonly aiNext: Uint32Array;
  private readonly aiMove: Int8Array;
  /** 1 for kinds that stand where they are put. */
  private readonly still: Uint8Array;
  private readonly body = new Body();

  constructor(world: ServerWorld, records: Records, survival: Survival, seed: number, wakeRadius = 3) {
    this.world = world;
    this.records = records;
    this.survival = survival;
    this.rng = new Rng(seed);
    this.wakeRadius = wakeRadius;
    const cap = world.ents.cap;
    this.awake = new Int32Array(cap);
    this.awakeSlot = new Int32Array(cap).fill(-1);
    this.chunkRefs = new Uint16Array(chunkCount(world.dims));
    this.aiNext = new Uint32Array(cap);
    this.aiMove = new Int8Array(cap);
    this.still = Uint8Array.from(world.reg.defs, (d) => (d?.type === "species" && d.still ? 1 : 0));
  }

  /**
   * Something at (x, z) hurt creature `e`. For now every creature does the
   * same: it runs the other way for a few seconds. Behaviour proper replaces this.
   */
  provoke(e: number, x: number, z: number): void {
    const ents = this.world.ents;
    if (this.awakeSlot[e]! < 0 || this.still[ents.kind[e]!]) return;
    ents.yaw[e] = Math.round((Math.atan2(ents.x[e]! - x, ents.z[e]! - z) / (Math.PI * 2)) * 65536) & 0xffff;
    this.aiMove[e] = 127;
    this.aiNext[e] = this.world.tick + FLEE_TICKS;
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
    return this.adopt(rec);
  }

  /** Put a creature that already has a record (new or loaded) into the simulation. */
  adopt(rec: EntityRecord): number {
    const ents = this.world.ents;
    // It is put down standing: on the ground until the simulation says otherwise.
    const e = ents.create(rec.kind, rec.x, rec.y, rec.z, F_GROUNDED);
    if (e < 0) return -1;
    ents.yaw[e] = rec.yaw;
    ents.pid[e] = rec.pid;
    refreshMods(this.world.reg, ents, e, rec.genome);
    ents.setLook(e, rec.genome ? rec.genome.level : 1, rec.genome ? rec.genome.colors : null, rec.name);
    this.records.entOf.set(rec.pid, e);
    this.aiNext[e] = 0;
    this.aiMove[e] = 0;
    // New bodies start full; loaded ones keep their numbers and get their deadline back.
    if (rec.vitals) this.survival.restore(rec, true);
    else this.survival.init(rec);
    if (this.chunkRefs[ents.chunk[e]!]! > 0) this.wake(e);
    return e;
  }

  /** Take a creature out of the simulation for good. Its record is the caller's to delete. */
  remove(e: number): void {
    this.sleep(e);
    this.records.entOf.delete(this.world.ents.pid[e]!);
    this.world.ents.destroy(e);
  }

  /** Whether a player is keeping this chunk simulated. */
  isChunkAwake(chunk: number): boolean {
    return this.chunkRefs[chunk]! > 0;
  }

  /** A player entered the world or changed chunk. `from` is -1 on entry; `to` is -1 on exit. */
  playerMoved(from: number, to: number): void {
    // Add the new neighbourhood before removing the old, so shared chunks never dip to zero.
    if (to >= 0) this.adjust(to, 1);
    if (from >= 0) this.adjust(from, -1);
  }

  /** Step every awake creature once. */
  step(tick: number): void {
    const world = this.world;
    const ents = world.ents;
    const b = this.body;
    const rng = this.rng;
    let stepped = 0;
    for (let n = this.awakeCount - 1; n >= 0; n--) {
      const e = this.awake[n]!;
      // A session's inputs are driving it: it is stepped with that session's body, not here.
      if (ents.driven[e] !== 0) continue;
      if (this.still[ents.kind[e]!]) {
        // It stands; it only falls, if it was put down in the air.
        if ((ents.flags[e]! & F_GROUNDED) !== 0) continue;
      } else if (tick >= this.aiNext[e]!) {
        // Wander: pick a heading and walk, or stand, for a few seconds.
        this.aiMove[e] = rng.int(3) === 0 ? 0 : 90;
        ents.yaw[e] = rng.int(65536);
        this.aiNext[e] = tick + 30 + rng.int(150);
      }
      const flags = ents.flags[e]!;
      const move = this.aiMove[e]!;
      // At rest on the ground or afloat: nothing would change, so nothing is computed.
      if (move === 0 && ents.vx[e] === 0 && ents.vz[e] === 0 && ((flags & F_GROUNDED) !== 0 || (ents.mode[e] === MODE_SWIM && ents.vy[e] === 0))) continue;
      ents.loadBody(e, b);
      stepBody(world, b, 0, move, ents.yaw[e]!, 0, 0, world.reg.move[ents.kind[e]!]!, TICK_DT);
      stepped++;
      // Walking into a sleeping chunk puts the creature to sleep there.
      const crossed = ents.storeBody(e, b);
      ents.pose(e);
      if (crossed && this.chunkRefs[ents.chunk[e]!] === 0) this.sleep(e);
    }
    this.stepped = stepped;
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
    if ((flags & F_ALIVE) === 0 || (flags & (F_PLAYER | F_PROP)) !== 0 || this.awakeSlot[e]! >= 0) return;
    this.awakeSlot[e] = this.awakeCount;
    this.awake[this.awakeCount++] = e;
    ents.flags[e] = flags | F_AWAKE;
    this.world.history.track(e);
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
    ents.pose(e);
    this.world.history.untrack(e);
  }
}
