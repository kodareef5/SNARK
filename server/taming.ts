// Taming: a creature knocked out and fed comes to belong to whoever fed it.
//
// The arithmetic is the reference's (shared/sim/taming.ts). This keeps the
// state, and nothing here steps. A creature that goes under and can be tamed
// has a `tame` on its record. Lying there it hungers fast (the survival
// system's rate for that); when it is hungry enough for a piece of the food
// it likes best of what has been put in it, it eats one, and that moment is a
// deadline worked out from how hungry it is and how fast it hungers. So a
// tame finishes on the same tick watched or not (D77).
//
// Each piece adds affinity and costs a little effectiveness; harm done to it
// while it lies there costs effectiveness in proportion. When it has been
// given what its level needs it is tamed: it joins the team of whoever last
// looked into it, gains levels for how well it was done, and wakes. If it
// wakes by itself first, everything it was given is lost.
//
// A narcotic fed to it deepens its sleep; one after another, each begins
// when the last has done.

import { TICK_RATE } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { EVENT_TAMED, MAX_NAME_BYTES, RESULT_DENIED, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_STALE, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { POINT_CAP, WILD_STATS } from "../shared/sim/genome.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { bonusLevels, effectiveness, harmCost, pieceCost, pieceWorth, tameNeeded } from "../shared/sim/taming.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../shared/sim/vitals.ts";
import type { Buffs } from "./buffs.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./rules.ts";
import type { Survival } from "./survival.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_TAME = 7;

export interface TamingContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly buffs: Buffs;
  readonly rules: Rules;
  readonly tribes: Tribes;
  readonly deadlines: DeadlineHeap;
  /** The record of the container a session has open, or null. */
  openOf(c: Client): EntityRecord | null;
  /** Recompute what follows from a record: its body's level, name, team and limits. */
  refresh(rec: EntityRecord): void;
  /** A creature has been tamed: it is somebody's now. */
  onTamed?(rec: EntityRecord): void;
}

/** What a session looking into a creature is shown of it. */
export interface Subject {
  /** It is being tamed; it is somebody's. */
  taming: boolean;
  owned: boolean;
  level: number;
  /** Share of the affinity it needs that it has, 0 to 1; effectiveness so far, 0 to 1. */
  progress: number;
  te: number;
  /** Its torpor and its food as shares of the most it holds. */
  torpor: number;
  food: number;
}

export class Taming {
  /** Creatures tamed, pieces eaten, tames lost to waking, and narcotics fed. */
  tamed = 0;
  bites = 0;
  lost = 0;
  doses = 0;
  private readonly ctx: TamingContext;
  private readonly rng: Rng;
  /** The creatures lying there being tamed: few at any time. */
  private readonly lying = new Set<number>();
  private readonly drugged: number;

  constructor(ctx: TamingContext, seed: number) {
    this.ctx = ctx;
    this.rng = new Rng(seed);
    this.drugged = ctx.world.reg.index.get("core:drugged") ?? 0;
  }

  /** After a load: those that were lying there being tamed are again. */
  resume(): void {
    for (const rec of this.ctx.records.byPid.values()) {
      if (!rec.tame) continue;
      if (rec.out) this.lying.add(rec.pid);
      else rec.tame = null;
    }
  }

  private wild(rec: EntityRecord): boolean {
    return rec.team === 0 && rec.keyHash === null && this.ctx.world.reg.taming[rec.kind] !== null && this.ctx.world.reg.taming[rec.kind] !== undefined;
  }

  /** A body went under, or came round. */
  out(rec: EntityRecord, out: boolean): void {
    if (out) {
      // A wild creature that can be tamed: it can be, from now, by whoever feeds it.
      if (!this.wild(rec) || rec.tame) return;
      rec.tame = { affinity: 0, sum: 0, by: 0, seen: -1, due: 0 };
      this.lying.add(rec.pid);
      this.ctx.records.dirty.add(rec.pid);
      return;
    }
    // Awake by itself before it was won: everything it was given is lost.
    if (rec.tame) {
      rec.tame = null;
      this.lost++;
      this.ctx.records.dirty.add(rec.pid);
    }
    this.lying.delete(rec.pid);
  }

  /** Once a tick, for the few lying there: who is looking into each, and whether what it holds has changed. */
  step(): void {
    if (this.lying.size === 0) return;
    const { records, game } = this.ctx;
    for (const pid of this.lying) {
      const rec = records.byPid.get(pid);
      if (!rec || !rec.tame || !rec.out) {
        this.lying.delete(pid);
        continue;
      }
      // Whoever has it open is who it is being tamed for: the last of them, if they come and go.
      for (const c of game.clients) if (c?.active && c.open === pid && rec.tame.by !== c.pid) rec.tame.by = c.pid;
      // Already given all it needs, and now somebody's to be: it is theirs.
      if (rec.tame.by !== 0 && rec.tame.affinity >= tameNeeded(this.ctx.world.reg.taming[rec.kind]!, rec.genome ? rec.genome.level : 1) - 1e-6) {
        this.finish(rec);
        continue;
      }
      const version = rec.inv ? rec.inv.version : 0;
      if (version !== rec.tame.seen) {
        rec.tame.seen = version;
        this.schedule(rec);
      }
    }
  }

  /** The food it likes best of what it holds, as an index into its species' list, or -1. */
  private best(rec: EntityRecord): number {
    const eats = this.ctx.world.reg.eats[rec.kind];
    if (!eats || !rec.inv) return -1;
    const inv = this.ctx.items.inv(rec);
    for (let k = 0; k + 2 < eats.length; k += 3) if (inv.total(eats[k]!) > 0) return k;
    return -1;
  }

  /** Set the tick it will next eat at: when it is hungry enough for a piece of the best it holds. Nothing to eat, no tick. */
  private schedule(rec: EntityRecord): void {
    const { world, survival, deadlines } = this.ctx;
    const tame = rec.tame!;
    const k = this.best(rec);
    if (k < 0) {
      tame.due = 0;
      return;
    }
    const reg = world.reg;
    const food = reg.eats[rec.kind]![k + 1]!;
    // Hungry enough when it is short of full by a piece's worth. When that will be is worked out in the whole
    // numbers its food is kept in, from where and when that was last written down: so that whenever this is
    // asked, before a restart or after, the answer is the same tick.
    survival.value(rec, V_FOOD);
    const v = rec.vitals!;
    const level = v.max[V_FOOD]! - Math.round(food * 1e6);
    const rate = v.rate[V_FOOD]!;
    const over = v.value[V_FOOD]! - level;
    if (over > 0 && !(rate < 0)) {
      tame.due = 0;
      return;
    }
    const at = over <= 0 ? world.tick : v.tick + Math.ceil(over / -rate);
    const due = at > world.tick ? at : world.tick + 1;
    if (due === tame.due) return;
    tame.due = due;
    deadlines.push(due, DEADLINE_TAME, rec.pid, due);
  }

  /** A DEADLINE_TAME entry came due: it eats, if it still can and is still hungry enough. */
  due(pid: number, stamp: number): void {
    const { world, records, items, survival, rules } = this.ctx;
    const rec = records.byPid.get(pid);
    if (!rec?.tame || rec.tame.due !== stamp || !rec.out) return;
    const tame = rec.tame;
    tame.due = 0;
    const k = this.best(rec);
    if (k < 0) return;
    const reg = world.reg;
    const eats = reg.eats[rec.kind]!;
    const [item, food, affinity] = [eats[k]!, eats[k + 1]!, eats[k + 2]!];
    survival.value(rec, V_FOOD);
    const v = rec.vitals!;
    const hungry = v.at(V_FOOD, world.tick) <= v.max[V_FOOD]! - Math.round(food * 1e6);
    if (hungry && items.burnItem(rec, item, 1)) {
      survival.add(rec, V_FOOD, food);
      const speed = rules.values.tamingSpeed;
      tame.affinity += pieceWorth(affinity, speed);
      tame.sum += pieceCost(affinity, speed);
      this.bites++;
      records.dirty.add(pid);
      if (tame.affinity >= tameNeeded(reg.taming[rec.kind]!, rec.genome ? rec.genome.level : 1) - 1e-6) {
        this.finish(rec);
        return;
      }
    }
    tame.seen = rec.inv ? rec.inv.version : 0;
    this.schedule(rec);
  }

  /** Harm to a creature lying there costs effectiveness, by the share of its health it took. */
  harmed(rec: EntityRecord, points: number): void {
    const tame = rec.tame;
    if (!tame || !rec.out || !(points > 0) || !rec.vitals) return;
    const most = rec.vitals.max[V_HEALTH]! / 1e6;
    if (most > 0) tame.sum += harmCost(this.ctx.world.reg.taming[rec.kind]!, tame.sum, points / most);
  }

  /** It has been given what it needs: it is whoever's last looked into it, better for how well it was done, and awake. */
  private finish(rec: EntityRecord): void {
    const { world, records, survival, game } = this.ctx;
    const tame = rec.tame!;
    const owner = records.byPid.get(tame.by);
    // Nobody to belong to (fed by no hand): it waits, full of what it was given, for someone to look into it.
    if (!owner || owner.team === 0) {
      tame.due = 0;
      tame.seen = -1;
      return;
    }
    const p = world.reg.taming[rec.kind]!;
    const te = effectiveness(p, tame.sum);
    const g = rec.genome;
    if (g) {
      // Levels for doing it well, where a wild creature's levels go.
      for (let n = bonusLevels(g.level, te); n > 0; n--) {
        const s = WILD_STATS[this.rng.int(WILD_STATS.length)]!;
        if (g.wild[s]! < POINT_CAP) g.wild[s]!++;
      }
    }
    rec.tame = null;
    rec.te = te;
    rec.team = owner.team;
    this.lying.delete(rec.pid);
    this.tamed++;
    records.dirty.add(rec.pid);
    // It wakes: what was keeping it under is gone, and so is its torpor.
    this.ctx.buffs.take(rec, this.drugged);
    survival.add(rec, V_TORPOR, -survival.value(rec, V_TORPOR) - 1);
    this.ctx.refresh(rec);
    this.ctx.onTamed?.(rec);
    // Whoever it is told, so that they can say what it is to be called.
    const e = records.entOf.get(rec.pid);
    const to = game.clients.find((c) => c?.active && !c.closed && c.pid === owner.pid) ?? null;
    if (to && e !== undefined) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_TAMED);
      w.u32(world.ents.handleOf(e));
      w.u16(rec.kind);
      w.u16(g ? g.level : 1);
      w.u8(Math.round(te * 100));
      game.endOwn(to);
    }
  }

  /**
   * A session feeds something to the creature it has open, out of that
   * creature's own inventory: which slot, and what it believes is there. Only
   * a dose (a narcotic) can be fed so, and only to something unconscious.
   */
  feed(c: Client, r: BitReader): number {
    const slot = r.varint();
    const expect = r.u16();
    if (r.overflow) return RESULT_INVALID;
    const { world, items, buffs } = this.ctx;
    const box = this.ctx.openOf(c);
    if (!box || !box.out || world.reg.defs[box.kind]?.type !== "species") return RESULT_DENIED;
    const inv = items.inv(box);
    if (slot >= inv.cap) return RESULT_INVALID;
    const item = inv.item[slot]!;
    if (item !== expect || item === 0) return RESULT_STALE;
    const torpor = world.reg.doseTorpor[item]!;
    const seconds = world.reg.doseSeconds[item]!;
    if (!(torpor > 0) || !(seconds > 0) || this.drugged === 0) return RESULT_INVALID;
    if (!items.burn(box, slot, 1)) return RESULT_STALE;
    // One after another: this one begins when what is already acting has done.
    const on = box.buffs.find((b) => b.buff === this.drugged);
    const left = on && on.until > world.tick ? (on.until - world.tick) / TICK_RATE : 0;
    buffs.give(box, this.drugged, c.pid, left + seconds, torpor / seconds);
    this.doses++;
    return RESULT_OK;
  }

  /** A session names a creature of its tribe: which (an entity handle) and what. */
  rename(c: Client, r: BitReader): number {
    const handle = r.u32();
    const name = r.string(MAX_NAME_BYTES);
    if (r.overflow) return RESULT_INVALID;
    const { world, records, tribes } = this.ctx;
    const e = world.ents.resolve(handle);
    const rec = e >= 0 ? records.byPid.get(world.ents.pid[e]!) : undefined;
    if (!rec || world.reg.defs[rec.kind]?.type !== "species" || rec.keyHash !== null) return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(records.byPid.get(c.pid), rec.team)) return RESULT_NOT_YOURS;
    // Letters, digits, spaces and a few marks; no more than a name's length.
    const clean = name.replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, MAX_NAME_BYTES);
    rec.name = clean;
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    return RESULT_OK;
  }

  /** What a session looking into `rec` is shown of it, or null if it is no creature. */
  subject(rec: EntityRecord): Subject | null {
    const { world, survival } = this.ctx;
    if (world.reg.defs[rec.kind]?.type !== "species" || rec.keyHash !== null || !rec.vitals) return null;
    const share = (i: number): number => {
      const most = rec.vitals!.max[i]! / 1e6;
      return most > 0 ? Math.max(0, Math.min(1, survival.value(rec, i) / most)) : 0;
    };
    const p = world.reg.taming[rec.kind];
    const level = rec.genome ? rec.genome.level : 1;
    return {
      taming: rec.tame !== null,
      owned: rec.team !== 0,
      level,
      progress: rec.tame && p ? Math.min(1, rec.tame.affinity / tameNeeded(p, level)) : 0,
      te: rec.tame && p ? effectiveness(p, rec.tame.sum) : rec.te,
      torpor: share(V_TORPOR),
      food: share(V_FOOD),
    };
  }
}
