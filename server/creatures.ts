// Spawns creatures, wakes and sleeps them, and steps the awake ones. A chunk is awake while a player is within wakeRadius chunks of it.
// Creatures in sleeping chunks are not stepped or iterated. Slow quantities such as hunger are lazy and belong to server/survival.ts.

import { TICK_DT, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { Body, MODE_SWIM, stepBody } from "../shared/sim/character.ts";
import { ACT_NONE, actionOut, stepAction } from "../shared/sim/weapon.ts";
import { Behavior } from "./behavior.ts";
import type { GameServer } from "./game.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_PLAYER, F_PROP, wider } from "../shared/sim/entities.ts";
import { rollWild } from "../shared/sim/genome.ts";
import { Rng } from "../shared/rng.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import type { EntityRecord, Records } from "./records.ts";
import { refreshMods, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";

const CREATURE_SPAWN = event("creature.spawn");

export class Creatures {
  bus: Bus = NO_BUS;
  /** In chunks. */
  readonly wakeRadius: number;
  awakeCount = 0;
  /** Creatures run through collision in the last step, for measurement. */
  stepped = 0;
  /** The OxygenSwimSpeedStatMultiplier rule. The host sets it. */
  swimGain = 1;

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly survival: Survival;
  private readonly rng: Rng;
  /** Entity indices of the awake creatures, in the first `awakeCount` entries. Both columns grow with the entity store. */
  awake: Int32Array;
  private awakeSlot: Int32Array;
  /** The slot being stepped, or -1 outside a step. Those above it have been stepped this tick and those below have not. */
  private cursor = -1;
  /** Players keeping each chunk awake. */
  private readonly chunkRefs: Uint16Array;
  readonly mind: Behavior;
  /** Called when a creature's bite strikes. The handler finds what it hit. */
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
    this.awake = new Int32Array(world.ents.cap);
    this.awakeSlot = new Int32Array(world.ents.cap).fill(-1);
    world.ents.onGrow.push((cap) => {
      this.awake = wider(this.awake, cap);
      this.awakeSlot = wider(this.awakeSlot, cap, -1);
    });
    this.chunkRefs = new Uint16Array(chunkCount(world.dims));
    this.mind = new Behavior(world, game, seed + 7);
    this.mind.herd = this;
    this.still = Uint8Array.from(world.reg.defs, (d) => (d?.type === "species" && d.still ? 1 : 0));
  }

  /** Something at (x, z) hurt `e`. `by` is the entity that did it, or -1. */
  provoke(e: number, x: number, z: number, by = -1): void {
    const ents = this.world.ents;
    // The victim may be a survivor. Its tribe's creatures near it may come to help.
    this.mind.alert(ents.team[e]!, e, by);
    if (this.awakeSlot[e]! < 0 || this.still[ents.kind[e]!] || ents.driven[e] !== 0) return;
    this.mind.provoke(e, x, z, by);
  }

  /**
   * Returns the entity index, or -1 if there is no room or a module refused it. `why` is "wild" for the world's own
   * and "admin" for one an admin asked for. A module may change its level, and its colours: up to six palette indices
   * by region, with commas between.
   */
  spawn(kind: number, x: number, z: number, level: number, why = "wild"): number {
    const world = this.world;
    const p = world.reg.move[kind];
    if (!p) return -1;
    const y = groundUnder(world.hf, x, z, p.radius);
    if (!capsuleFree(world, x, y, z, p.radius, p.height)) return -1;
    let colours = "";
    if (this.bus.n[CREATURE_SPAWN] !== 0) {
      const asked = { kind: world.reg.ids[kind]!, why, level, colours };
      if (this.bus.before(CREATURE_SPAWN, asked) !== "") return -1;
      if (Number(asked.level) >= 1) level = Math.floor(Number(asked.level));
      colours = String(asked.colours);
    }
    const rec = this.records.create(kind);
    rec.x = x;
    rec.y = y;
    rec.z = z;
    rec.yaw = this.rng.int(65536);
    rec.genome = rollWild(this.rng, level, world.reg.colorSet[kind]!);
    if (colours !== "") colours.split(",").forEach((c, i) => void (i < rec.genome!.colors.length && Number(c) >= 0 && Number(c) <= 255 && c.trim() !== "" && (rec.genome!.colors[i] = Number(c))));
    const e = this.adopt(rec);
    // With no body it keeps no record. A record left behind would be saved, and be a creature at the next start.
    if (e < 0) this.records.delete(rec.pid);
    return e;
  }

  /** Puts a creature that has a record, new or loaded, into the simulation. Returns -1, changing nothing, if the entity store has no place for it. */
  adopt(rec: EntityRecord): number {
    const ents = this.world.ents;
    // It starts grounded until a step says otherwise.
    const e = ents.create(rec.kind, rec.x, rec.y, rec.z, F_GROUNDED);
    if (e < 0) return -1;
    ents.yaw[e] = rec.yaw;
    ents.pid[e] = rec.pid;
    refreshMods(this.world.reg, ents, e, rec.genome, 0, 1, false, false, this.swimGain);
    ents.setLook(e, rec.genome ? rec.genome.level : 1, rec.genome ? rec.genome.colors : null, rec.name);
    this.records.entOf.set(rec.pid, e);
    this.mind.reset(e);
    this.mind.stance[e] = rec.stance;
    ents.setTeam(e, rec.team);
    if (rec.grown !== 0) ents.setYoung(e, rec.span, rec.grown);
    // A new body starts full. A loaded one keeps its vitals and gets its deadline back.
    if (rec.vitals) this.survival.restore(rec, true);
    else this.survival.init(rec);
    if (this.chunkRefs[ents.chunk[e]!]! > 0) this.wake(e);
    return e;
  }

  /** The caller deletes its record. */
  remove(e: number): void {
    this.sleep(e);
    this.records.entOf.delete(this.world.ents.pid[e]!);
    this.world.ents.destroy(e);
  }

  isChunkAwake(chunk: number): boolean {
    return this.chunkRefs[chunk]! > 0;
  }

  /** `from` is -1 on entry and `to` is -1 on exit. */
  playerMoved(from: number, to: number): void {
    // Add the new neighbourhood before removing the old, so shared chunks never dip to zero.
    if (to >= 0) this.adjust(to, 1);
    if (from >= 0) this.adjust(from, -1);
  }

  step(tick: number): void {
    const world = this.world;
    const ents = world.ents;
    const b = this.body;
    const mind = this.mind;
    let stepped = 0;
    for (this.cursor = this.awakeCount - 1; this.cursor >= 0; this.cursor--) {
      const e = this.awake[this.cursor]!;
      // A driven creature is stepped with its session's body, not here.
      if (ents.driven[e] !== 0) continue;
      const kind = ents.kind[e]!;
      // Once a second, an owned creature with no leader checks whether the entity its record says to follow is back in the world.
      if (ents.team[e] !== 0 && mind.leader[e]! < 0 && (tick + e) % 30 === 0) this.relink(e);
      if (this.still[kind]) {
        // A still kind only falls, if it was put down in the air.
        if ((ents.flags[e]! & F_GROUNDED) !== 0) continue;
      } else mind.steer(e, tick, ents.act[e]!);
      const flags = ents.flags[e]!;
      const move = mind.move[e]!;
      const pressed = mind.pressed[e]!;
      // At rest on the ground or afloat with no input, nothing would change, so the step is skipped.
      if (move === 0 && pressed === 0 && ents.act[e] === ACT_NONE && ents.vx[e] === 0 && ents.vz[e] === 0 && ents.yaw[e] === mind.look[e] && ((flags & F_GROUNDED) !== 0 || (ents.mode[e] === MODE_SWIM && ents.vy[e] === 0))) continue;
      ents.loadBody(e, b);
      const buttons = mind.buttons[e]! | pressed;
      stepBody(world, b, 0, move, this.still[kind] ? ents.yaw[e]! : mind.look[e]!, mind.pitch[e]!, buttons, world.reg.move[kind]!, TICK_DT);
      // A bite goes through the same action step as any blow.
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

  /** Call after a creature's team changes, so Behavior's owned set stays current. */
  claimed(e: number): void {
    if (this.awakeSlot[e]! >= 0 && this.world.ents.team[e] !== 0) this.mind.owned.add(e);
    else this.mind.owned.delete(e);
  }

  /** Follows the entity its record names, if that entity is in the world. */
  private relink(e: number): void {
    const rec = this.records.byPid.get(this.world.ents.pid[e]!);
    if (!rec || rec.follow === 0) return;
    const whom = this.records.entOf.get(rec.follow);
    if (whom !== undefined) this.mind.follow(e, whom);
  }

  private seat(slot: number, e: number): void {
    this.awake[slot] = e;
    this.awakeSlot[e] = slot;
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
    let slot = this.awakeSlot[e]!;
    if (slot < 0) return;
    this.mind.owned.delete(e);
    const ents = this.world.ents;
    // Asleep it is no longer saved a slice at a time, so where it stopped is saved now.
    const rec = this.records.byPid.get(ents.pid[e]!);
    if (rec && (rec.x !== ents.x[e] || rec.y !== ents.y[e] || rec.z !== ents.z[e])) this.records.dirty.add(rec.pid);
    // One that goes while its turn is still to come gives its slot to the next in turn, and the one being stepped moves
    // down beside it. The last of the list, which has been stepped, then fills the slot above them and is not stepped again.
    if (slot < this.cursor) {
      const c = this.cursor--;
      this.seat(slot, this.awake[c - 1]!);
      slot = c - 1;
      if (c < this.awakeCount) {
        this.seat(slot, this.awake[c]!);
        slot = c;
      }
    }
    this.awakeCount--;
    if (slot < this.awakeCount) this.seat(slot, this.awake[this.awakeCount]!);
    this.awakeSlot[e] = -1;
    ents.flags[e] = ents.flags[e]! & ~F_AWAKE;
    ents.vx[e] = 0;
    ents.vy[e] = 0;
    ents.vz[e] = 0;
    ents.pose(e);
    this.world.history.untrack(e);
  }
}
