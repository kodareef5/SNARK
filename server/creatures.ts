// Creatures: spawning, dormancy, and stepping. What each decides to do is
// server/behavior.ts; here it is done, by the movement and the action step
// everything is driven through.
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
import { ACT_NONE, actionOut, stepAction } from "../shared/sim/weapon.ts";
import { Behavior } from "./behavior.ts";
import type { GameServer } from "./game.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { rollWild } from "../shared/sim/genome.ts";
import { Rng } from "../shared/rng.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { EntityRecord, Records } from "./records.ts";
import { refreshMods, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

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
  /** What each creature has decided to do. */
  readonly mind: Behavior;
  /** Called when a creature's bite lands, with its entity: whoever resolves blows finds what it hit. */
  onStrike: ((e: number) => void) | null = null;
  /** 1 for kinds that stand where they are put. */
  private readonly still: Uint8Array;
  private readonly body = new Body();

  constructor(world: ServerWorld, game: GameServer, records: Records, survival: Survival, seed: number, wakeRadius = 3) {
    this.world = world;
    this.records = records;
    this.survival = survival;
    this.rng = new Rng(seed);
    this.wakeRadius = wakeRadius;
    const cap = world.ents.cap;
    this.awake = new Int32Array(cap);
    this.awakeSlot = new Int32Array(cap).fill(-1);
    this.chunkRefs = new Uint16Array(chunkCount(world.dims));
    this.mind = new Behavior(world, game, seed + 7);
    this.mind.herd = this;
    this.still = Uint8Array.from(world.reg.defs, (d) => (d?.type === "species" && d.still ? 1 : 0));
  }

  /** Something at (x, z) hurt creature `e`; `by` is the entity that did it, or -1. What it does about it is its temper's. */
  provoke(e: number, x: number, z: number, by = -1): void {
    const ents = this.world.ents;
    // Whoever was hurt, survivor or creature: those of its tribe near it may come to its help.
    this.mind.alert(ents.team[e]!, e, by);
    if (this.awakeSlot[e]! < 0 || this.still[ents.kind[e]!] || ents.driven[e] !== 0) return;
    this.mind.provoke(e, x, z, by);
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
    this.mind.reset(e);
    this.mind.stance[e] = rec.stance;
    // Whose it is, if it is anyone's, is on its body from the start; and so is how young it is.
    ents.setTeam(e, rec.team);
    if (rec.grown !== 0) ents.setYoung(e, rec.span, rec.grown);
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
    const mind = this.mind;
    let stepped = 0;
    for (let n = this.awakeCount - 1; n >= 0; n--) {
      const e = this.awake[n]!;
      // A session's inputs are driving it: it is stepped with that session's body, not here.
      if (ents.driven[e] !== 0) continue;
      const kind = ents.kind[e]!;
      // One that is somebody's and was told to follow: found again when whoever it follows comes back into the world.
      if (ents.team[e] !== 0 && mind.leader[e]! < 0 && (tick + e) % 30 === 0) this.relink(e);
      if (this.still[kind]) {
        // It stands; it only falls, if it was put down in the air.
        if ((ents.flags[e]! & F_GROUNDED) !== 0) continue;
      } else mind.steer(e, tick, ents.act[e]!);
      const flags = ents.flags[e]!;
      const move = mind.move[e]!;
      const pressed = mind.pressed[e]!;
      // At rest on the ground or afloat, doing nothing and asked for nothing: nothing would change, so nothing is computed.
      if (move === 0 && pressed === 0 && ents.act[e] === ACT_NONE && ents.vx[e] === 0 && ents.vz[e] === 0 && ents.yaw[e] === mind.look[e] && ((flags & F_GROUNDED) !== 0 || (ents.mode[e] === MODE_SWIM && ents.vy[e] === 0))) continue;
      ents.loadBody(e, b);
      const buttons = mind.buttons[e]! | pressed;
      stepBody(world, b, 0, move, this.still[kind] ? ents.yaw[e]! : mind.look[e]!, mind.pitch[e]!, buttons, world.reg.move[kind]!, TICK_DT);
      // Its jaws, if it has any, through the step every blow goes through.
      const jaws = world.reg.weapon[kind];
      let struck = false;
      if (jaws) {
        stepAction(b, buttons, pressed, jaws);
        struck = actionOut.strike;
      }
      stepped++;
      // Walking into a sleeping chunk puts the creature to sleep there.
      const crossed = ents.storeBody(e, b);
      ents.pitch[e] = mind.pitch[e]!;
      ents.pose(e, tick);
      if (struck) this.onStrike?.(e);
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

  /** A creature has become somebody's, or stopped being: whoever decides for creatures knows which are. */
  claimed(e: number): void {
    if (this.awakeSlot[e]! >= 0 && this.world.ents.team[e] !== 0) this.mind.owned.add(e);
    else this.mind.owned.delete(e);
  }

  /** If creature `e` was told to follow someone who is in the world, it follows them. */
  private relink(e: number): void {
    const rec = this.records.byPid.get(this.world.ents.pid[e]!);
    if (!rec || rec.follow === 0) return;
    const whom = this.records.entOf.get(rec.follow);
    if (whom !== undefined) this.mind.follow(e, whom);
  }

  private wake(e: number): void {
    const ents = this.world.ents;
    const flags = ents.flags[e]!;
    if ((flags & F_ALIVE) === 0 || (flags & (F_PLAYER | F_PROP)) !== 0 || this.awakeSlot[e]! >= 0) return;
    if (ents.team[e] !== 0) this.mind.owned.add(e);
    this.awakeSlot[e] = this.awakeCount;
    this.awake[this.awakeCount++] = e;
    ents.flags[e] = flags | F_AWAKE;
    this.world.history.track(e);
  }

  private sleep(e: number): void {
    const slot = this.awakeSlot[e]!;
    if (slot < 0) return;
    this.mind.owned.delete(e);
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
