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
import { EVENT_TAMED, MAX_NAME_BYTES, ORDER_ALL, ORDER_FOLLOW, ORDER_LEVEL, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, ORDER_UNSADDLE, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_STALE, S_EVENT, WHISTLE_RANGE } from "../shared/net/protocol.ts";
import type { Creatures } from "./creatures.ts";
import type { Progression } from "./progression.ts";
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
import type { Lists } from "./settings/lists.ts";
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
  readonly creatures: Creatures;
  readonly progression: Progression;
  /** The record of the container a session has open, or null. */
  openOf(c: Client): EntityRecord | null;
  /** Recompute what follows from a record: its body's level, name, team and limits. */
  refresh(rec: EntityRecord): void;
  /** A creature has been tamed: it is somebody's now. */
  onTamed?(rec: EntityRecord): void;
  /** The server's lists that name classes. */
  readonly lists: Lists;
  /** Tell a survivor something, if they are here. */
  onNotice?(pid: number, text: string): void;
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
  /** Whether it wears a saddle. */
  saddled: boolean;
  /** Which it is (an entity index, or -1), the levels it has to spend, its stance, and whether it follows someone. */
  id: number;
  points: number;
  stance: number;
  following: boolean;
  /**
   * Its breeding: whether its kind breeds, whether it may mate, whether it is
   * female; how grown it is (a stage of shared/sim/breeding.ts) and how far,
   * 0 to 1; how far the pair it is one of has got, 0 to 1; and the seconds
   * until a female may mate again.
   */
  breeds: boolean;
  mating: boolean;
  female: boolean;
  stage: number;
  maturity: number;
  mate: number;
  wait: number;
}

/** What is shown of the breeding of a creature nobody has said anything about: grown, and no more. */
const NO_BREEDING = { mating: false, female: false, stage: 3, maturity: 1, mate: 0, wait: 0 };

export class Taming {
  /** Creatures tamed, pieces eaten, tames lost to waking, and narcotics fed; orders obeyed, and meals a creature that is somebody's ate of what it carries. */
  tamed = 0;
  bites = 0;
  lost = 0;
  doses = 0;
  orders = 0;
  meals = 0;
  /**
   * Breeding, given by whoever knows of it. `onMate`: a creature of the
   * tribe of whoever asks is told it may mate, or may not (an ORDER_); the
   * answer is a result code. `bred`: what to show of a creature's breeding.
   */
  onMate: ((rec: EntityRecord, what: number) => number) | null = null;
  bred: ((rec: EntityRecord) => typeof NO_BREEDING) | null = null;
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

  /** After a load: those that were lying there being tamed are again, and those that are somebody's know when they next eat. */
  resume(): void {
    for (const rec of this.ctx.records.byPid.values()) {
      if (rec.tame) {
        if (rec.out) this.lying.add(rec.pid);
        else rec.tame = null;
      } else if (rec.team !== 0 && rec.keyHash === null && this.ctx.world.reg.eats[rec.kind]) {
        rec.mealDue = 0;
        this.meal(rec);
      }
    }
  }

  /**
   * A creature that is somebody's eats of what it carries when it is hungry
   * enough for a piece: set the tick of its next meal. Called when what it
   * carries may have changed (someone has shut it), and after each meal.
   */
  meal(rec: EntityRecord): void {
    const { world, survival, deadlines } = this.ctx;
    if (rec.team === 0 || rec.tame || rec.dead || !rec.vitals) return;
    const k = this.best(rec);
    if (k < 0) {
      rec.mealDue = 0;
      return;
    }
    survival.value(rec, V_FOOD);
    const v = rec.vitals;
    const level = v.max[V_FOOD]! - Math.round(world.reg.eats[rec.kind]![k + 1]! * 1e6);
    const rate = v.rate[V_FOOD]!;
    const over = v.value[V_FOOD]! - level;
    if (over > 0 && !(rate < 0)) {
      rec.mealDue = 0;
      return;
    }
    const at = over <= 0 ? world.tick : v.tick + Math.ceil(over / -rate);
    const due = at > world.tick ? at : world.tick + 1;
    if (due === rec.mealDue) return;
    rec.mealDue = due;
    deadlines.push(due, DEADLINE_TAME, rec.pid, due);
  }

  private wild(rec: EntityRecord): boolean {
    // Not one that is young: that is taken, not tamed. And not if the server says nothing is to be, or not its kind.
    if (this.ctx.rules.on("bDisableDinoTaming") || this.ctx.lists.kinds("PreventDinoTameClassNames").has(rec.kind)) return false;
    return rec.team === 0 && rec.keyHash === null && rec.grown === 0 && this.ctx.world.reg.taming[rec.kind] !== null && this.ctx.world.reg.taming[rec.kind] !== undefined;
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
    if (rec && !rec.tame && rec.team !== 0 && rec.mealDue === stamp) {
      // Somebody's, and its mealtime: a piece of the best it carries, if it is still hungry enough for one.
      rec.mealDue = 0;
      const k = this.best(rec);
      if (k >= 0 && rec.vitals) {
        const eats = world.reg.eats[rec.kind]!;
        survival.value(rec, V_FOOD);
        if (rec.vitals.at(V_FOOD, world.tick) <= rec.vitals.max[V_FOOD]! - Math.round(eats[k + 1]! * 1e6) && items.burnItem(rec, eats[k]!, 1)) {
          survival.add(rec, V_FOOD, eats[k + 1]!);
          this.meals++;
        }
        this.meal(rec);
      }
      return;
    }
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
    const { world, records } = this.ctx;
    const tame = rec.tame!;
    const owner = records.byPid.get(tame.by);
    // Nobody to belong to (fed by no hand): it waits, full of what it was given, for someone to look into it.
    if (!owner || owner.team === 0) {
      tame.due = 0;
      tame.seen = -1;
      return;
    }
    // The tribe, or the server, has as many as it may: it waits, as one fed by no hand does, until someone looks into it again.
    const full = this.full(owner.team);
    if (full !== "") {
      tame.by = 0;
      tame.due = 0;
      tame.seen = -1;
      this.ctx.onNotice?.(owner.pid, full);
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
    this.give(rec, owner, te);
  }

  /** How many tamed creatures there are: in all, and of one team. */
  count(team: number): { all: number; ours: number } {
    const reg = this.ctx.world.reg;
    let all = 0;
    let ours = 0;
    for (const r of this.ctx.records.byPid.values()) {
      if (r.team === 0 || r.keyHash !== null || r.egg !== null || r.dead || reg.defs[r.kind]?.type !== "species" || !r.vitals) continue;
      all++;
      if (r.team === team) ours++;
    }
    return { all, ours };
  }

  /** Why `team` may have no more tamed creatures, by the server's rules; "" if it may. */
  full(team: number): string {
    const rules = this.ctx.rules;
    const most = rules.num("MaxTamedDinos");
    const each = rules.num("MaxPersonalTamedDinos");
    const n = this.count(team);
    if (n.all >= most) return `This server has as many tamed creatures as it may (${most}).`;
    if (each > 0 && n.ours >= each) return `Your tribe has as many tamed creatures as it may (${each}).`;
    return "";
  }

  /**
   * Creature `rec` is the tribe of `owner`'s from now, tamed this well (0 to
   * 1), and awake. If it was being tamed, that is over. Its levels are as
   * they are: whoever calls has given it what it earned.
   */
  give(rec: EntityRecord, owner: EntityRecord, te: number): void {
    const { world, records, survival, game } = this.ctx;
    const g = rec.genome;
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
    this.meal(rec);
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
    if (!box || world.reg.defs[box.kind]?.type !== "species" || box.keyHash !== null) return RESULT_DENIED;
    const inv = items.inv(box);
    if (slot >= inv.cap) return RESULT_INVALID;
    const item = inv.item[slot]!;
    if (item !== expect || item === 0) return RESULT_STALE;
    // A saddle that fits it, on a creature of one's tribe that has none: it is put on, and is no longer among what it carries.
    if (world.reg.saddleFits[item] !== 0) {
      if (world.reg.saddleFits[item] !== box.kind || box.saddle !== 0) return RESULT_INVALID;
      // Nothing young is saddled.
      if (box.grown !== 0) return RESULT_DENIED;
      if (box.team === 0 || !this.ctx.tribes.may(this.ctx.records.byPid.get(c.pid), box.team)) return RESULT_NOT_YOURS;
      if (!items.burn(box, slot, 1)) return RESULT_STALE;
      box.saddle = item;
      this.ctx.records.dirty.add(box.pid);
      this.ctx.refresh(box);
      return RESULT_OK;
    }
    if (!box.out) return RESULT_DENIED;
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

  /** A session asks to look into a creature of its tribe, by its entity index: one near it, or the one it rides. */
  open(c: Client, r: BitReader): number {
    const which = r.u32();
    if (r.overflow) return RESULT_INVALID;
    const { world, records, tribes } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.ent < 0 || me.dead || me.out) return RESULT_DENIED;
    const e = which < ents.cap ? which : -1;
    const rec = e >= 0 && (ents.flags[e]! & 1) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!rec || world.reg.defs[rec.kind]?.type !== "species" || rec.keyHash !== null) return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(me, rec.team)) return RESULT_NOT_YOURS;
    const dx = ents.x[e]! - ents.x[c.ent]!;
    const dz = ents.z[e]! - ents.z[c.ent]!;
    const reach = 3.5 + world.reg.bodyRadius[rec.kind]!;
    if (c.drive !== e && dx * dx + dz * dz > reach * reach) return RESULT_FAR;
    c.open = c.open === rec.pid ? 0 : rec.pid;
    return RESULT_OK;
  }

  /**
   * A session tells a creature of its tribe what to do, or every one of them
   * within a whistle's reach: stay, follow, a stance, or a level into a stat.
   */
  order(c: Client, r: BitReader): number {
    const which = r.u32();
    const what = r.u8();
    if (r.overflow) return RESULT_INVALID;
    const { world, records, tribes, creatures, progression } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.ent < 0 || me.dead) return RESULT_DENIED;
    const stance = what - ORDER_STANCE;
    const mate = what === ORDER_MATE || what === ORDER_UNMATE;
    if (what !== ORDER_STAY && what !== ORDER_FOLLOW && what !== ORDER_UNSADDLE && !mate && !(stance >= 0 && stance < 3) && what < ORDER_LEVEL) return RESULT_INVALID;
    const obey = (e: number, rec: EntityRecord): number => {
      if (what === ORDER_UNSADDLE) {
        // Its saddle comes off into what it carries: not while someone sits on it, and not if there is no room.
        if (rec.saddle === 0) return RESULT_INVALID;
        if (ents.driven[e] !== 0) return RESULT_BUSY;
        if (this.ctx.items.mint(rec, rec.saddle, 1) === 0) return RESULT_FULL;
        rec.saddle = 0;
        this.ctx.refresh(rec);
      } else if (mate) {
        const done = this.onMate ? this.onMate(rec, what) : RESULT_INVALID;
        if (done !== RESULT_OK) return done;
      } else if (what === ORDER_STAY || what === ORDER_FOLLOW) {
        rec.follow = what === ORDER_FOLLOW ? c.pid : 0;
        creatures.mind.follow(e, what === ORDER_FOLLOW ? c.ent : -1);
      } else if (what >= ORDER_LEVEL) {
        const done = progression.spend(rec, what - ORDER_LEVEL);
        if (done !== RESULT_OK) return done;
        this.ctx.refresh(rec);
      } else {
        rec.stance = stance;
        creatures.mind.order(e, stance);
      }
      records.dirty.add(rec.pid);
      this.orders++;
      return RESULT_OK;
    };
    if (which === ORDER_ALL) {
      // A whistle: every one of the tribe's that hears it. Levels are not given by whistling, nor saddles taken off, nor anything told to mate.
      if (what >= ORDER_LEVEL || what === ORDER_UNSADDLE || mate) return RESULT_INVALID;
      for (const e of creatures.mind.owned) {
        const rec = records.byPid.get(ents.pid[e]!);
        if (!rec || !tribes.may(me, rec.team)) continue;
        const dx = ents.x[e]! - ents.x[c.ent]!;
        const dz = ents.z[e]! - ents.z[c.ent]!;
        if (dx * dx + dz * dz <= WHISTLE_RANGE * WHISTLE_RANGE) obey(e, rec);
      }
      return RESULT_OK;
    }
    const e = which < ents.cap ? which : -1;
    const rec = e >= 0 && (ents.flags[e]! & 1) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!rec || world.reg.defs[rec.kind]?.type !== "species" || rec.keyHash !== null) return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(me, rec.team)) return RESULT_NOT_YOURS;
    const dx = ents.x[e]! - ents.x[c.ent]!;
    const dz = ents.z[e]! - ents.z[c.ent]!;
    if (dx * dx + dz * dz > WHISTLE_RANGE * WHISTLE_RANGE) return RESULT_FAR;
    return obey(e, rec);
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
    const e = this.ctx.records.entOf.get(rec.pid);
    return {
      ...(this.bred ? this.bred(rec) : NO_BREEDING),
      breeds: world.reg.breedEgg[rec.kind] !== 0xffff,
      saddled: rec.saddle !== 0,
      id: e ?? -1,
      points: rec.team !== 0 ? Math.min(255, this.ctx.progression.statPoints(rec)) : 0,
      stance: rec.stance,
      following: rec.follow !== 0,
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
