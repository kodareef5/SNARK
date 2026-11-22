// Creatures defecate every 100 to 300 seconds, as ARK's dodo does, leaving their species' feces item where their rig's
// `vent` is (SpeciesDef.feces). A grown female whose species lays in place of feces (SpeciesDef.eggChance, the dodo's
// 13%) now and then lays an unfertilised egg there instead, wild or tamed, unless EGG_LIMIT of them lie near. Only a
// creature that is awake goes: one in stasis, with nobody near, does not, as in ARK.
//
// A creature is given its first time within a second of waking, on the tick a turn that goes round the entity store once a
// second comes to its slot. The turn is a number and the creatures that woke are a list, so no slot is looked at for it.

import { poseCreatureOn } from "../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { boneToModel } from "../shared/anim/skeleton.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { TAU } from "../shared/math/scalar.ts";
import { fecesWait, youngScale } from "../shared/sim/breeding.ts";
import { MODE_SWIM } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_HELD, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { Inventory } from "../shared/sim/items.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { Rng } from "../shared/rng.ts";
import { BAG_TICKS } from "./death.ts";
import type { Eggs } from "./eggs.ts";
import type { Signal } from "./signal.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** Places in the entity store that feces may not take. The same as a dropped bag (server/death.ts). */
const STORE_RESERVE = 256;

export interface FecesContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly deadlines: DeadlineHeap;
  readonly rules: Rules;
  readonly eggs: Eggs;
  /** Creatures' signal that a body woke (Creatures.onWake). */
  readonly woke: Signal<[e: number]>;
  /** Puts a prop's body in the world at its record's position, and starts its time (Death.place). */
  place(rec: EntityRecord): void;
}

const ascending = (a: number, b: number): number => a - b;

export class Feces {
  /** Counters: feces left, and eggs laid in place of feces. */
  dropped = 0;
  laid = 0;
  readonly ctx: FecesContext;
  private readonly rng: Rng;
  /** Per pid of a creature that is awake, the tick it next goes. A creature not here is given a time when its turn comes after it wakes. */
  private readonly next = new Map<number, number>();
  /** The entity slot the turn stands at: it passes a thirtieth of the store each tick. */
  private cursor = 0;
  /** Slots of creatures that woke and whose turn has not come since, in no order. */
  private readonly woken: number[] = [];
  /** How far past the cursor each slot whose turn comes this tick is. */
  private readonly turn: number[] = [];
  /** Per species, whether it defecates or lays in place of it. */
  private readonly goes: Uint8Array;
  private readonly heap: number;
  private readonly st = new AnimState();
  private readonly vent = [0, 0, 0];
  /** Its kind in the deadline heap. */
  private readonly deadline: number;

  constructor(ctx: FecesContext, seed: number) {
    this.ctx = ctx;
    this.deadline = ctx.deadlines.kind("feces", (a, stamp) => this.due(a, stamp));
    this.rng = new Rng(seed);
    const reg = ctx.world.reg;
    this.goes = Uint8Array.from(reg.defs, (d, i) => (d?.type === "species" && (reg.feces[i] !== 0 || reg.eggChance[i]! > 0) ? 1 : 0));
    this.heap = reg.index.get("core:feces") ?? 0;
    // Whatever is awake already waits its turn as if it had just woken.
    const ents = ctx.world.ents;
    for (let e = 0; e < ents.cap; e++) if ((ents.flags[e]! & F_AWAKE) !== 0) this.woke(e);
    ctx.woke.on((e) => this.woke(e));
  }

  /** Body `e` woke: if its species goes, it is given a time when the turn next comes to its slot. */
  private woke(e: number): void {
    if (this.goes[this.ctx.world.ents.kind[e]!] !== 0) this.woken.push(e);
  }

  /** A deadline of its kind came due. A stale one, or one for a creature that has since gone to sleep, does nothing. */
  due(pid: number, stamp: number): void {
    if (this.next.get(pid) !== stamp) return;
    this.next.delete(pid);
    const { world, records } = this.ctx;
    const e = records.entOf.get(pid);
    const rec = records.byPid.get(pid);
    if (!rec || e === undefined || (world.ents.flags[e]! & F_AWAKE) === 0) return;
    // Chosen: nothing is left while it is out cold, held, or swimming, where it would sink out of reach.
    if (!rec.dead && !rec.out && (world.ents.flags[e]! & F_HELD) === 0 && world.ents.mode[e] !== MODE_SWIM) this.go(rec, e);
    this.time(pid);
  }

  /**
   * Each tick, after breeding's: the turn passes a thirtieth of the entity store, and each creature that woke since the
   * turn last passed its slot is given a time as it does, in the order of their slots from where the turn stood.
   */
  step(_tick: number): void {
    const ents = this.ctx.world.ents;
    const cap = ents.cap;
    const n = Math.ceil(cap / TICK_RATE);
    const from = this.cursor;
    this.cursor = (from + n) % cap;
    const woken = this.woken;
    if (woken.length === 0) return;
    const turn = this.turn;
    turn.length = 0;
    for (let k = woken.length - 1; k >= 0; k--) {
      const e = woken[k]!;
      const past = e >= from ? e - from : e - from + cap;
      if (past >= n) continue;
      turn.push(past);
      woken[k] = woken[woken.length - 1]!;
      woken.length--;
    }
    turn.sort(ascending);
    for (let k = 0; k < turn.length; k++) {
      const e = (from + turn[k]!) % cap;
      if ((ents.flags[e]! & (F_ALIVE | F_AWAKE | F_PROP | F_PLAYER)) !== (F_ALIVE | F_AWAKE) || this.goes[ents.kind[e]!] === 0) continue;
      const pid = ents.pid[e]!;
      if (pid !== 0 && !this.next.has(pid)) this.time(pid);
    }
  }

  /** It goes now: an egg if she lays one, else its feces. Returns the record left, or null. */
  go(rec: EntityRecord, e: number, allowEgg = true): EntityRecord | null {
    const { world, eggs } = this.ctx;
    const reg = world.reg;
    const kind = rec.kind;
    this.where(e);
    // It falls from the vent to the ground under it, or no lower than the feet, or lies where it stands if that place is shut in.
    const ents = world.ents;
    const [x, , z] = this.vent as [number, number, number];
    const chance = reg.eggChance[kind]!;
    if (allowEgg && chance > 0 && rec.genome?.female && rec.grown === 0 && this.rng.float() < chance) {
      const egg = eggs.lay(kind, rec.team, x, ents.y[e]!, z, this.rng.int(65536), ents.x[e]!, ents.z[e]!);
      if (egg) {
        this.laid++;
        return egg;
      }
    }
    return this.drop(reg.feces[kind]!, x, z, e);
  }

  private drop(item: number, x: number, z: number, e: number): EntityRecord | null {
    const { world, records, items, rules, eggs } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    if (item === 0 || this.heap === 0 || ents.room < STORE_RESERVE) return null;
    const heap = records.create(this.heap, (reg.defs[item] as { label?: string } | null)?.label ?? "feces");
    [heap.x, heap.y, heap.z] = eggs.ground(this.heap, x, z, ents.x[e]!, ents.y[e]!, ents.z[e]!);
    heap.yaw = this.rng.int(65536);
    heap.inv = new Inventory(1);
    if (items.mint(heap, item, 1, 0, 0, -1, "feces") !== 1) {
      records.delete(heap.pid);
      return null;
    }
    heap.expiresAt = world.tick + Math.max(1, Math.round((reg.decomposeTicks[item] || BAG_TICKS) * rules.num("GlobalItemDecompositionTimeMultiplier")));
    this.ctx.place(heap);
    this.dropped++;
    return heap;
  }

  /** Sets `vent` to where the body's vent is in the world: its rig's socket as the body is posed, or low behind it. */
  private where(e: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const kind = ents.kind[e]!;
    const anim = world.anims[kind];
    const rig = anim?.rig;
    const socket = rig?.sockets.get("vent");
    const v = this.vent;
    const size = ents.grown[e] !== 0 ? youngScale(world.reg.birthScale[kind]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
    const a = (ents.yaw[e]! / 65536) * TAU;
    if (anim && rig && socket) {
      const st = this.st;
      st.unpack(ents.anim[e]!, ents.cue[e]!);
      st.seed = bodySeed(e);
      poseCreatureOn(anim, st, world.tick, world, ents.x[e]!, ents.y[e]!, ents.z[e]!, a, size);
      boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, v);
    } else {
      v[0] = 0;
      v[1] = world.reg.bodyHeight[kind]! * 0.3;
      v[2] = -world.reg.bodyRadius[kind]!;
    }
    // A young one is drawn smaller, and so is its rig.
    const s = Math.sin(a);
    const co = Math.cos(a);
    const mx = v[0]! * size;
    const my = v[1]! * size;
    const mz = v[2]! * size;
    v[0] = ents.x[e]! + co * mx + s * mz;
    v[1] = ents.y[e]! + my;
    v[2] = ents.z[e]! + co * mz - s * mx;
  }

  private time(pid: number): void {
    const at = this.ctx.world.tick + Math.max(1, Math.round(fecesWait(this.rng.float()) * TICK_RATE));
    this.next.set(pid, at);
    this.ctx.deadlines.push(at, this.deadline, pid, at);
  }
}
