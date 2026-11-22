// Taming state. The arithmetic is ARK's (shared/sim/taming.ts). Nothing steps. Each bite is a deadline computed
// from the creature's hunger, so a tame finishes on the same tick watched or not (D77).

import { TICK_RATE } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { CUE_DEAD } from "../shared/anim/pose.ts";
import { EVENT_TAMED, MAX_NAME_BYTES, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_LAND, ORDER_LEVEL, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, ORDER_UNSADDLE, ORDER_WANDER, ORDER_YOURS, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_STALE, S_EVENT, WHISTLE_RANGE } from "../shared/net/protocol.ts";
import { STANCE_YOURS } from "./behavior.ts";
import type { Creatures } from "./creatures.ts";
import type { Progression } from "./progression.ts";
import { Rng } from "../shared/rng.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { POINT_CAP, WILD_STATS } from "../shared/sim/genome.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { bonusLevels, effectiveness, harmCost, pieceCost, pieceWorth, tameNeeded } from "../shared/sim/taming.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../shared/sim/vitals.ts";
import type { Buffs } from "./buffs.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import { saved } from "./saved.ts";
import type { Rules } from "./settings/rules.ts";
import type { Lists } from "./settings/lists.ts";
import type { Survival } from "./survival.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";
import { event } from "./events/bus.ts";
import { HIT_NONE, castWorld } from "../shared/world/ray.ts";

const TAME_ALLOW = event("tame.allow");
const TAME_DONE = event("tame.done");
const CREATURE_ORDER = event("creature.order");
const NAME_SET = event("name.set");
/** Metres. The furthest a survivor may set her creatures on what she looks at. Chosen: ARK's whistle reach is not published. */
const ATTACK_REACH = 100;
/** Why a starter mount's saddle stays on (server/mount.ts). */
export const ISSUED_SADDLE = "Its saddle was issued with it, and stays on.";

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
  openOf(c: Client): EntityRecord | null;
  /** Recomputes what derives from a record: its body's level, name, team and limits. */
  refresh(rec: EntityRecord): void;
  onTamed?(rec: EntityRecord): void;
  readonly lists: Lists;
  onNotice?(pid: number, text: string): void;
}

/** What a session sees of a creature it has open. */
export interface Subject {
  taming: boolean;
  owned: boolean;
  level: number;
  /** `progress` is its share of the affinity it needs. `te` is effectiveness so far. Both are 0 to 1. */
  progress: number;
  te: number;
  /** Shares of their maxima, 0 to 1. */
  torpor: number;
  food: number;
  saddled: boolean;
  /** `id` is an entity index, or -1. `points` is the levels it has to spend. */
  id: number;
  points: number;
  stance: number;
  following: boolean;
  /** Ordered to wander (ORDER_WANDER), until told to stay or follow. */
  wandering: boolean;
  /**
   * `breeds` is whether its kind breeds. `stage` is a stage of shared/sim/breeding.ts and `maturity` how far grown, 0 to 1.
   * `mate` is how far its pair has got, 0 to 1. `wait` is the seconds until a female may mate again.
   */
  breeds: boolean;
  mating: boolean;
  female: boolean;
  stage: number;
  maturity: number;
  mate: number;
  wait: number;
}

/** Used when no `bred` hook is set. It shows a grown creature. */
const NO_BREEDING = { mating: false, female: false, stage: 3, maturity: 1, mate: 0, wait: 0 };

export class Taming {
  /** Counters. `lost` is tames lost to waking. `bites` are pieces eaten during a tame, `meals` pieces an owned creature ate. */
  tamed = 0;
  bites = 0;
  lost = 0;
  doses = 0;
  orders = 0;
  meals = 0;
  /** Breeding hooks. `onMate` gets ORDER_MATE or ORDER_UNMATE and returns a RESULT code. `bred` fills a Subject's breeding fields. */
  onMate: ((rec: EntityRecord, what: number) => number) | null = null;
  bred: ((rec: EntityRecord) => typeof NO_BREEDING) | null = null;
  /** Whether anyone sits on creature `e` or is getting on or off it, steering or not (server/riding.ts). */
  ridden: ((e: number) => boolean) | null = null;
  private readonly ctx: TamingContext;
  private readonly rng: Rng;
  /** Pids of creatures being tamed. Few at any time. */
  private readonly lying = new Set<number>();
  /** Those of them that a tame limit turned away, whose taker has been told. Each is offered again once it has been shut. */
  private readonly held = new Set<number>();
  /** What each session had open at the last step, by its place in the server's list. */
  private readonly shown: number[] = [];
  private readonly drugged: number;
  /** Its kind in the deadline heap. */
  private readonly deadline: number;

  constructor(ctx: TamingContext, seed: number) {
    this.ctx = ctx;
    this.deadline = ctx.deadlines.kind("tame", (a, stamp) => this.due(a, stamp));
    this.rng = new Rng(seed);
    this.drugged = ctx.world.reg.index.get("core:drugged") ?? 0;
  }

  /** Call after a load. It restores the set of creatures being tamed and schedules owned creatures' meals. */
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

  /** Sets the tick an owned creature next eats from what it carries. Call it when its inventory may have changed, and after each meal. */
  meal(rec: EntityRecord): void {
    const { world, survival, deadlines } = this.ctx;
    if (rec.team === 0 || rec.tame || rec.dead || !rec.vitals || rec.stored !== 0) return;
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
    deadlines.push(due, this.deadline, rec.pid, due);
  }

  private wild(rec: EntityRecord): boolean {
    // A young creature is claimed, not tamed.
    if (this.ctx.rules.on("bDisableDinoTaming") || this.ctx.lists.kinds("PreventDinoTameClassNames").has(rec.kind)) return false;
    return rec.team === 0 && rec.keyHash === null && rec.grown === 0 && this.ctx.world.reg.taming[rec.kind] !== null && this.ctx.world.reg.taming[rec.kind] !== undefined;
  }

  /** A body went unconscious, or came round. */
  out(rec: EntityRecord, out: boolean): void {
    if (out) {
      if (!this.wild(rec) || rec.tame) return;
      rec.tame = { affinity: 0, sum: 0, by: 0, seen: -1, due: 0 };
      this.lying.add(rec.pid);
      this.ctx.records.dirty.add(rec.pid);
      return;
    }
    // It woke before the tame finished, so everything it was given is lost.
    if (rec.tame) {
      rec.tame = null;
      this.lost++;
      this.ctx.records.dirty.add(rec.pid);
    }
    this.lying.delete(rec.pid);
    this.held.delete(rec.pid);
  }

  step(): void {
    const { records, game } = this.ctx;
    // A creature somebody was looking into, and no longer is, may eat of what it was left, however it came to be shut.
    for (let i = 0; i < game.clients.length; i++) {
      const c = game.clients[i];
      const open = c?.active ? c.open : 0;
      const was = this.shown[i] ?? 0;
      if (open === was) continue;
      this.shown[i] = open;
      const rec = records.byPid.get(was);
      if (rec) this.meal(rec);
    }
    if (this.lying.size === 0) return;
    for (const pid of this.lying) {
      const rec = records.byPid.get(pid);
      if (!rec || !rec.tame || !rec.out) {
        this.lying.delete(pid);
        this.held.delete(pid);
        continue;
      }
      // The tame goes to the session that has it open, or the last one that did.
      let open = false;
      for (const c of game.clients) {
        if (!c?.active || c.open !== pid) continue;
        open = true;
        if (!this.held.has(pid) && rec.tame.by !== c.pid) rec.tame.by = c.pid;
      }
      if (!open) this.held.delete(pid);
      // A creature that already has the affinity it needs finishes once someone opens it.
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

  /** Index into its species' `eats` list of the best food it holds, or -1. */
  private best(rec: EntityRecord): number {
    const eats = this.ctx.world.reg.eats[rec.kind];
    if (!eats || !rec.inv) return -1;
    const inv = this.ctx.items.inv(rec);
    for (let k = 0; k + 2 < eats.length; k += 3) if (inv.total(eats[k]!) > 0) return k;
    return -1;
  }

  /** Sets the tick a creature being tamed next eats. */
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
    // It is hungry enough when it is a piece's worth short of full. The tick is computed from the vital's stored
    // integers and base tick, so the answer is the same before a restart and after.
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
    deadlines.push(due, this.deadline, rec.pid, due);
  }

  /** A deadline of its kind came due, for an owned creature's meal or a bite of a tame. */
  due(pid: number, stamp: number): void {
    const { world, records, items, survival, rules } = this.ctx;
    const rec = records.byPid.get(pid);
    if (rec && !rec.tame && rec.team !== 0 && rec.stored === 0 && rec.mealDue === stamp) {
      // An owned creature's meal.
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
      const e = records.entOf.get(pid);
      if (e !== undefined) this.ctx.creatures.ate(e);
      survival.add(rec, V_FOOD, food);
      const speed = rules.num("TamingSpeedMultiplier");
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

  /** Harm to a creature being tamed costs effectiveness, by the share of its health taken. */
  harmed(rec: EntityRecord, points: number): void {
    const tame = rec.tame;
    if (!tame || !rec.out || !(points > 0) || !rec.vitals) return;
    const most = rec.vitals.max[V_HEALTH]! / 1e6;
    if (most > 0) tame.sum += harmCost(this.ctx.world.reg.taming[rec.kind]!, tame.sum, points / most);
  }

  /** It joins the team of the survivor who last opened it, and gains bonus levels for effectiveness. */
  private finish(rec: EntityRecord): void {
    const { world, records } = this.ctx;
    const tame = rec.tame!;
    const owner = records.byPid.get(tame.by);
    // With no owner it waits, keeping its affinity, until someone opens it.
    if (!owner || owner.team === 0) {
      tame.due = 0;
      tame.seen = -1;
      return;
    }
    // The tribe or the server is at its tame limit, so it waits the same way until someone opens it again.
    const full = this.full(owner.team);
    if (full !== "") {
      tame.by = 0;
      tame.due = 0;
      tame.seen = -1;
      this.held.add(rec.pid);
      this.ctx.onNotice?.(owner.pid, full);
      return;
    }
    const p = world.reg.taming[rec.kind]!;
    const te = effectiveness(p, tame.sum);
    const g = rec.genome;
    if (g) {
      // Bonus levels go into the stats a wild creature's levels go into.
      for (let n = bonusLevels(g.level, te); n > 0; n--) {
        const s = WILD_STATS[this.rng.int(WILD_STATS.length)]!;
        if (g.wild[s]! < POINT_CAP) g.wild[s]!++;
      }
    }
    this.give(rec, owner, te);
  }

  count(team: number): { all: number; ours: number } {
    const reg = this.ctx.world.reg;
    let all = 0;
    let ours = 0;
    for (const r of this.ctx.records.byPid.values()) {
      // One kept in a soul ball is not counted until it is loosed, as ARK counts none in a cryopod (server/balls.ts), and a
      // starter mount is not counted at all: it is issued, one to a survivor, not tamed (server/mount.ts).
      if (r.team === 0 || r.keyHash !== null || r.egg !== null || r.dead || r.stored !== 0 || r.issuedTo !== 0 || reg.defs[r.kind]?.type !== "species" || !r.vitals) continue;
      all++;
      if (r.team === team) ours++;
    }
    return { all, ours };
  }

  /** Returns why `team` may have no more tamed creatures, or "" if it may. */
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
   * `rec` joins `owner`'s team with effectiveness `te` (0 to 1), and wakes. Its levels are left alone, so the caller adds
   * any it earned. `how` is "fed" for a tame that was earned and "forced" for an admin's. False if a module refused it:
   * the taming is then lost, and the owner is told why.
   */
  give(rec: EntityRecord, owner: EntityRecord, te: number, how = "fed"): boolean {
    const { world, records, survival, game } = this.ctx;
    const g = rec.genome;
    const told = { pid: rec.pid, kind: world.reg.ids[rec.kind]!, level: g ? g.level : 1, byPid: owner.pid, team: owner.team, how };
    const refused = game.bus.before(TAME_ALLOW, { ...told });
    if (refused !== "") {
      rec.tame = null;
      records.dirty.add(rec.pid);
      this.ctx.onNotice?.(owner.pid, refused);
      return false;
    }
    rec.tame = null;
    rec.te = te;
    rec.team = owner.team;
    this.lying.delete(rec.pid);
    this.held.delete(rec.pid);
    this.tamed++;
    records.dirty.add(rec.pid);
    // It wakes. The drugged buff and all its torpor go.
    this.ctx.buffs.take(rec, this.drugged);
    survival.add(rec, V_TORPOR, -survival.value(rec, V_TORPOR) - 1);
    this.ctx.refresh(rec);
    this.ctx.onTamed?.(rec);
    this.meal(rec);
    // The owner's client gets EVENT_TAMED, so it can ask for a name.
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
    game.bus.after(TAME_DONE, { ...told, te });
    return true;
  }

  /**
   * Uses an item in the open creature's own inventory on that creature. A saddle is put on, and a narcotic doses an
   * unconscious creature. The command carries the slot and the item the client expects there.
   */
  feed(c: Client, r: BitReader): number {
    const slot = r.varint();
    const expect = r.u16();
    if (r.overflow) return RESULT_INVALID;
    const { world, items } = this.ctx;
    const box = this.ctx.openOf(c);
    if (!box || world.reg.defs[box.kind]?.type !== "species" || box.keyHash !== null) return RESULT_DENIED;
    const inv = items.inv(box);
    if (slot >= inv.cap) return RESULT_INVALID;
    const item = inv.item[slot]!;
    if (item !== expect || item === 0) return RESULT_STALE;
    // A saddle that fits leaves the inventory and is worn.
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
    if (!(world.reg.doseTorpor[item]! > 0) || this.drugged === 0) return RESULT_INVALID;
    if (!items.burn(box, slot, 1)) return RESULT_STALE;
    this.dose(box, item, c.pid);
    this.doses++;
    return RESULT_OK;
  }

  /**
   * Gives `rec` the torpor of one `item`, eaten or fed, from `by` (a pid, or 0). Doses queue: what is left of the one
   * acting and this one are given over their two times together.
   */
  dose(rec: EntityRecord, item: number, by: number): void {
    const { world, buffs } = this.ctx;
    const torpor = world.reg.doseTorpor[item]!;
    const seconds = world.reg.doseSeconds[item]!;
    if (!(torpor > 0) || !(seconds > 0) || this.drugged === 0) return;
    const on = rec.buffs.find((b) => b.buff === this.drugged);
    const left = on && on.until > world.tick ? (on.until - world.tick) / TICK_RATE : 0;
    buffs.give(rec, this.drugged, by, left + seconds, ((left > 0 ? on!.torpor * left : 0) + torpor) / (left + seconds));
  }

  /** The command carries an entity index. The creature must be near, or the one the session rides. */
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
    if (c.open !== rec.pid && !this.ctx.game.mayOpen(c, rec.pid)) return RESULT_DENIED;
    c.open = c.open === rec.pid ? 0 : rec.pid;
    return RESULT_OK;
  }

  /**
   * Orders one creature of the session's tribe, or with ORDER_ALL every one within WHISTLE_RANGE. ORDER_ATTACK carries the
   * entity to go for, which must be alive, of no tribe of hers, within ATTACK_REACH and in her sight.
   */
  order(c: Client, r: BitReader): number {
    const which = r.u32();
    const what = r.u8();
    const target = what === ORDER_ATTACK ? r.u32() : 0;
    if (r.overflow) return RESULT_INVALID;
    const { world, records, tribes, creatures, progression } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.ent < 0 || me.dead) return RESULT_DENIED;
    const stance = what === ORDER_YOURS ? STANCE_YOURS : what - ORDER_STANCE;
    const mate = what === ORDER_MATE || what === ORDER_UNMATE;
    if (what !== ORDER_STAY && what !== ORDER_FOLLOW && what !== ORDER_UNSADDLE && what !== ORDER_WANDER && what !== ORDER_ATTACK && what !== ORDER_LAND && !mate && !(what >= ORDER_STANCE && stance >= 0 && stance <= STANCE_YOURS) && what < ORDER_LEVEL) return RESULT_INVALID;
    if (what === ORDER_ATTACK) {
      const seen = this.mayAttack(c, me, target);
      if (seen !== RESULT_OK) return seen;
    }
    const obey = (e: number, rec: EntityRecord): number => {
      const order = what === ORDER_STAY ? "stay" : what === ORDER_FOLLOW ? "follow" : what === ORDER_WANDER ? "wander" : what === ORDER_ATTACK ? "attack" : what === ORDER_LAND ? "land" : what === ORDER_UNSADDLE ? "unsaddle" : what === ORDER_MATE ? "mate" : what === ORDER_UNMATE ? "unmate" : what >= ORDER_LEVEL ? "level" : "stance";
      const refused = this.ctx.game.bus.before(CREATURE_ORDER, { pid: rec.pid, byPid: me.pid, order });
      if (refused !== "") {
        this.ctx.onNotice?.(me.pid, refused);
        return RESULT_DENIED;
      }
      if (what === ORDER_UNSADDLE) {
        // The saddle comes off into its inventory, but for a starter mount's, which was issued with it (server/mount.ts).
        if (rec.saddle === 0) return RESULT_INVALID;
        if (rec.issuedTo !== 0) {
          this.ctx.onNotice?.(me.pid, ISSUED_SADDLE);
          return RESULT_DENIED;
        }
        if (ents.driven[e] !== 0 || this.ridden?.(e)) return RESULT_BUSY;
        if (this.ctx.items.mint(rec, rec.saddle, 1) === 0) return RESULT_FULL;
        rec.saddle = 0;
        this.ctx.refresh(rec);
      } else if (mate) {
        const done = this.onMate ? this.onMate(rec, what) : RESULT_INVALID;
        if (done !== RESULT_OK) return done;
      } else if (what === ORDER_STAY || what === ORDER_FOLLOW) {
        rec.follow = what === ORDER_FOLLOW ? c.pid : 0;
        rec.wander = false;
        creatures.mind.follow(e, what === ORDER_FOLLOW ? c.ent : -1);
      } else if (what === ORDER_WANDER) {
        rec.follow = 0;
        rec.wander = true;
        creatures.mind.wander(e);
      } else if (what === ORDER_LAND) {
        // A flyer comes down where it is (ARK's whistle, ASE 288.113). A ridden one lands as its rider takes it.
        if (!world.reg.flies[rec.kind]) return RESULT_INVALID;
        if (ents.driven[e] !== 0) return RESULT_BUSY;
        creatures.mind.land(e);
      } else if (what === ORDER_ATTACK) {
        // A ridden creature goes where its rider takes it, and none goes for one of its own tribe or for itself.
        if (ents.driven[e] !== 0) return RESULT_BUSY;
        if (target === e || ents.team[target] === rec.team) return RESULT_INVALID;
        creatures.mind.attack(e, target);
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
      // A whistle cannot give levels, take saddles off, order mating or wandering (the reference has no whistle for it). Each
      // that hears obeys as it can.
      if (what >= ORDER_LEVEL || what === ORDER_UNSADDLE || what === ORDER_WANDER || mate) return RESULT_INVALID;
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

  /** Whether `me` may set her creatures on entity `target`: a live body of no tribe of hers, near enough and in her sight. */
  private mayAttack(c: Client, me: EntityRecord, target: number): number {
    const { world, tribes } = this.ctx;
    const ents = world.ents;
    if (target >= ents.cap || (ents.flags[target]! & (F_ALIVE | F_PROP)) !== F_ALIVE || (ents.cue[target]! & CUE_DEAD) !== 0 || target === c.ent) return RESULT_INVALID;
    if (ents.team[target] !== 0 && tribes.may(me, ents.team[target]!)) return RESULT_INVALID;
    const eye = ents.y[c.ent]! + stanceEye(world.reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
    const dx = ents.x[target]! - ents.x[c.ent]!;
    const dy = ents.y[target]! + world.reg.bodyHeight[ents.kind[target]!]! * 0.55 - eye;
    const dz = ents.z[target]! - ents.z[c.ent]!;
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (far > ATTACK_REACH) return RESULT_FAR;
    // Nothing built, grown or ground may stand between her eye and its middle: she cannot point at what she cannot see.
    if (far > 0.5 && castWorld(world, ents.x[c.ent]!, eye, ents.z[c.ent]!, dx / far, dy / far, dz / far, far) !== HIT_NONE) return RESULT_DENIED;
    return RESULT_OK;
  }

  /** The command carries an entity handle and the name. */
  rename(c: Client, r: BitReader): number {
    const handle = r.u32();
    const name = r.string(MAX_NAME_BYTES);
    if (r.overflow) return RESULT_INVALID;
    const { world, records, tribes } = this.ctx;
    const e = world.ents.resolve(handle);
    const rec = e >= 0 ? records.byPid.get(world.ents.pid[e]!) : undefined;
    if (!rec || world.reg.defs[rec.kind]?.type !== "species" || rec.keyHash !== null) return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(records.byPid.get(c.pid), rec.team)) return RESULT_NOT_YOURS;
    // Letters, digits, spaces and a few marks.
    // A module may refuse the name or reword it.
    const asked = { what: "creature", text: name.replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, MAX_NAME_BYTES) };
    if (this.ctx.game.bus.before(NAME_SET, asked) !== "") return RESULT_DENIED;
    const clean = String(asked.text).replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, MAX_NAME_BYTES);
    rec.name = clean;
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    return RESULT_OK;
  }

  /** Null if `rec` is not a creature. */
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
      // A starter mount never mates, so its panel offers it no mating (server/mount.ts).
      breeds: world.reg.breedEgg[rec.kind] !== 0xffff && rec.issuedTo === 0,
      saddled: rec.saddle !== 0,
      id: e ?? -1,
      points: rec.team !== 0 ? Math.min(255, this.ctx.progression.statPoints(rec)) : 0,
      stance: rec.stance,
      following: rec.follow !== 0,
      wandering: rec.wander,
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

/** How well a tamed creature was tamed and, for one being tamed, what it has been given so far and for whom; then its orders and its saddle. */
saved({
  name: "tame",
  has: (rec) => rec.tame !== null || rec.te > 0 || rec.follow !== 0 || rec.stance !== 1 || rec.saddle !== 0 || rec.wander,
  write(rec, w, to) {
    w.f32(rec.te);
    w.bool(rec.tame !== null);
    if (rec.tame) {
      w.f64(rec.tame.affinity);
      w.f64(rec.tame.sum);
      w.uint53(rec.tame.by);
    }
    w.u8(rec.stance);
    w.uint53(rec.follow);
    w.varint(rec.saddle === 0 ? 0 : to.toSaved[rec.saddle]!);
    w.bool(rec.wander);
  },
  read(rec, r, from) {
    rec.te = r.f32();
    if (r.bool()) rec.tame = { affinity: r.f64(), sum: r.f64(), by: r.uint53(), seen: -1, due: 0 };
    rec.stance = r.u8();
    rec.follow = r.uint53();
    const saddle = r.varint();
    rec.saddle = saddle === 0 ? 0 : (from.toRuntime[saddle] ?? 0);
    rec.wander = r.bool();
  },
  rebase: (rec) => void (rec.mealDue = 0),
});
