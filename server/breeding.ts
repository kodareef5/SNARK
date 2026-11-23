// Breeding state. Almost none of it steps (D77). Eggs and young are records with deadlines, so they hatch and grow on the same
// tick watched or not, and across a restart. Mating follows ARK since its remake, where both creatures must have mating enabled.

import { TICK_RATE } from "../shared/coords.ts";
import { EVENT_TAMED, ORDER_MATE, RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { GROWN, MATE_TICKS, growthStep, leftAtPeriod, leftAtSpeed, litter, mateRange, mateWait, maturity, regrow, stageOf, stepTick } from "../shared/sim/breeding.ts";
import { MF_NO_SPRINT } from "../shared/sim/character.ts";
import { F_AWAKE } from "../shared/sim/entities.ts";
import { breed } from "../shared/sim/genome.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { groundUnder } from "../shared/world/collide.ts";
import type { Creatures } from "./creatures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Persistence } from "./persist/persistence.ts";
import { placeFree } from "./place.ts";
import { part, type EntityRecord, type Records } from "./records.ts";
import { moved, saved } from "./saved.ts";
import type { Rules } from "./settings/rules.ts";
import type { Lists } from "./settings/lists.ts";
import type { ServerWorld } from "./world.ts";
import { event } from "./events/bus.ts";

/** In ticks. Pairs are sought and rechecked this often. */
export const PAIR_TICKS = TICK_RATE;
/** In EVENT_TAMED, marks a creature claimed as young, not tamed. */
export const CLAIMED = 255;

const BREED_MATE = event("breed.mate");
const BREED_EGG = event("breed.egg");
const BREED_HATCH = event("breed.hatch");
const BREED_GROWN = event("breed.grown");

export interface BreedingContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly rules: Rules;
  readonly deadlines: DeadlineHeap;
  readonly creatures: Creatures;
  readonly persistence: Persistence | null;
  /** Puts a prop's body (an egg) in the world at its record's position. */
  place(rec: EntityRecord): void;
  /** Recomputes what follows from a record: its body's limits, level, name and team. */
  refresh(rec: EntityRecord): void;
  /** Recomputes when an owned creature next eats from what it carries. */
  meal(rec: EntityRecord): void;
  readonly lists: Lists;
  /** The reason a team may have no more tamed creatures, or "" if it may. */
  full(team: number): string;
  /** Does nothing if the survivor is not connected. */
  notice(pid: number, text: string): void;
}

/** A speed rule divides a time. A rule at or below 0.001 counts as 0.001, the slowest a rule can make it. */
const speed = (rule: number): number => (rule > 0.001 ? rule : 0.001);

/**
 * An egg holds its young until it hatches. One taken up is an item in an inventory that stands for its record
 * (server/eggs.ts): the record is then carried by itself, its `carrier` its own pid and its `hatchAt` the ticks it has
 * left, and it does not hatch. An unfertilised egg has no genome and never hatches.
 */
export const fertile = (rec: EntityRecord): boolean => rec.egg !== null && rec.genome !== null;
export const held = (rec: EntityRecord): boolean => rec.egg !== null && rec.egg.carrier === rec.pid;

/** Breeding's own state on a record: the tick from which a female may mate again, 0 for now. */
export const BREEDING = part(() => ({ mateReadyAt: 0 }));

export function mateReadyAt(rec: EntityRecord): number {
  return rec.part(BREEDING)?.mateReadyAt ?? 0;
}

export class Breeding {
  /** Counters. `laid` includes young carried, and `hatched` includes young born. */
  mated = 0;
  laid = 0;
  hatched = 0;
  claimed = 0;
  grownUp = 0;
  begun = 0;
  parted = 0;
  private readonly ctx: BreedingContext;
  private readonly rng: Rng;
  /** Pairs by the female's pid: the male's pid, the ticks the mating takes, and the tick it finishes. */
  readonly pairs = new Map<number, { male: number; span: number; due: number }>();
  private readonly grew: [number, number] = [0, 0];
  /** Scratch for one pass: the willing awake females and males as entity indices, and the pids of females whose pair stands. */
  private readonly females: number[] = [];
  private readonly males: number[] = [];
  private readonly seen = new Set<number>();
  /** Its kind in the deadline heap. */
  readonly deadline: number;

  constructor(ctx: BreedingContext, seed: number) {
    this.ctx = ctx;
    this.deadline = ctx.deadlines.kind("breed", (a, stamp) => this.due(a, stamp));
    this.rng = new Rng(seed);
  }

  /** Call after a load, once every body is back in the world. */
  resume(): void {
    const { world, records, deadlines } = this.ctx;
    for (const rec of records.byPid.values()) {
      if (rec.egg) {
        if (!fertile(rec) || held(rec)) continue;
        const e = records.entOf.get(rec.pid);
        if (e !== undefined) world.ents.setYoung(e, rec.egg.span, rec.egg.hatchAt);
        const at = rec.egg.hatchAt > world.tick ? rec.egg.hatchAt : world.tick + 1;
        rec.egg.hatchAt = at;
        deadlines.push(at, this.deadline, rec.pid, at);
      } else if (rec.grown !== 0 && rec.stored === 0) this.next(rec);
    }
  }

  /**
   * `rec` goes into a soul ball (server/balls.ts). Any mating it was in is over, and young it carried unborn are lost, as
   * ARK ends a pregnancy when a female is put in a cryopod (ark.wiki.gg, Cryopod, 2026-11-21).
   */
  kept(rec: EntityRecord): void {
    this.pairs.delete(rec.pid);
    for (const female of [...this.pairs.keys()]) if (this.pairs.get(female)!.male === rec.pid) this.pairs.delete(female);
    for (const young of [...this.ctx.records.byPid.values()]) if (young.egg !== null && young.egg.carrier === rec.pid && young.pid !== rec.pid) this.discard(young);
  }

  /** `rec` is back in the world from a soul ball: if it is growing, its next step is due again. */
  loosed(rec: EntityRecord): void {
    if (rec.grown !== 0 && rec.egg === null) this.next(rec);
  }

  /** Whether `rec`, with body `e`, would mate now given a partner. */
  private able(rec: EntityRecord, e: number): boolean {
    const { world } = this.ctx;
    const ents = world.ents;
    if (this.ctx.rules.on("bDisableDinoBreeding") || this.ctx.lists.kinds("PreventBreedingForClassNames").has(rec.kind)) return false;
    // It must be owned, enabled for mating, grown, conscious, not following, not ridden, and not heavy or rooted.
    return rec.mating && rec.team !== 0 && rec.grown === 0 && rec.egg === null && !rec.out && !rec.dead && rec.follow === 0 && rec.genome !== null && world.reg.breedEgg[rec.kind] !== 0xffff && ents.driven[e] === 0 && (ents.mflags[e]! & MF_NO_SPRINT) === 0;
  }

  private together(a: number, b: number): boolean {
    const ents = this.ctx.world.ents;
    const dx = ents.x[a]! - ents.x[b]!;
    const dz = ents.z[a]! - ents.z[b]!;
    const range = mateRange(this.ctx.world.reg.bodyRadius[ents.kind[a]!]!);
    return dx * dx + dz * dz <= range * range;
  }

  /**
   * Works once every PAIR_TICKS. Each willing female with no pair takes the nearest willing male of her kind and tribe
   * within her species' mating range. A pair is parted when either one has gone, moved out of range, or is no longer willing.
   */
  step(tick: number): void {
    if (tick % PAIR_TICKS !== 0) return;
    const { world, records, creatures, deadlines } = this.ctx;
    if (creatures.mind.owned.size === 0 && this.pairs.size === 0) return;
    const ents = world.ents;
    const females = this.females;
    const males = this.males;
    const seen = this.seen;
    females.length = males.length = 0;
    seen.clear();
    for (const e of creatures.mind.owned) {
      const rec = records.byPid.get(ents.pid[e]!);
      if (!rec || !rec.mating || !this.able(rec, e)) continue;
      if (!rec.genome!.female) males.push(e);
      else if (tick >= mateReadyAt(rec)) females.push(e);
    }
    for (const f of females) {
      const pid = ents.pid[f]!;
      const pair = this.pairs.get(pid);
      let best = -1;
      const range = mateRange(world.reg.bodyRadius[ents.kind[f]!]!);
      let near = range * range;
      let kept = false;
      for (const m of males) {
        if (ents.kind[m] !== ents.kind[f] || ents.team[m] !== ents.team[f]) continue;
        const dx = ents.x[m]! - ents.x[f]!;
        const dz = ents.z[m]! - ents.z[f]!;
        const d2 = dx * dx + dz * dz;
        if (d2 > range * range) continue;
        if (pair && ents.pid[m] === pair.male) kept = true;
        if (best < 0 || d2 < near) {
          near = d2;
          best = m;
        }
      }
      if (pair) {
        if (kept) {
          seen.add(pid);
          continue;
        }
        // The male has gone or is no longer willing, so the pair's progress is lost.
        this.pairs.delete(pid);
        this.parted++;
      }
      if (best < 0) continue;
      if (this.ctx.game.bus.before(BREED_MATE, { mother: pid, father: ents.pid[best]! }) !== "") continue;
      const span = Math.max(1, Math.ceil(MATE_TICKS / speed(this.ctx.rules.num("MatingSpeedMultiplier"))));
      const due = tick + span;
      this.pairs.set(pid, { male: ents.pid[best]!, span, due });
      deadlines.push(due, this.deadline, pid, due);
      seen.add(pid);
      this.begun++;
    }
    // A pair whose female is awake but was not seen in this pass is parted. A sleeping female cannot have changed.
    for (const pid of this.pairs.keys()) {
      if (seen.has(pid)) continue;
      const e = records.entOf.get(pid);
      if (e === undefined || (ents.flags[e]! & F_AWAKE) !== 0) {
        this.pairs.delete(pid);
        this.parted++;
      }
    }
  }

  /** A deadline of its kind came due: an egg hatches, a young creature grows one step, or a pair finishes. */
  due(pid: number, stamp: number): void {
    const { world, records } = this.ctx;
    const rec = records.byPid.get(pid);
    if (!rec) {
      this.pairs.delete(pid);
      return;
    }
    if (rec.egg) {
      if (rec.egg.hatchAt === stamp && fertile(rec) && !held(rec)) this.hatch(rec);
      return;
    }
    if (rec.grown !== 0) {
      if (rec.growDue === stamp) this.grow(rec);
      return;
    }
    const pair = this.pairs.get(pid);
    if (!pair || pair.due !== stamp) return;
    this.pairs.delete(pid);
    // Both must still be present, willing and together at this tick.
    const father = records.byPid.get(pair.male);
    const fe = records.entOf.get(pid);
    const me = father ? records.entOf.get(father.pid) : undefined;
    if (!father || fe === undefined || me === undefined || !this.able(rec, fe) || !this.able(father, me) || !this.together(fe, me) || world.tick < mateReadyAt(rec) || father.kind !== rec.kind || father.team !== rec.team) {
      this.parted++;
      return;
    }
    this.lay(rec, father, fe);
  }

  /** The female lays, or carries the young if her species has no egg, and her wait before the next mating starts. */
  private lay(mother: EntityRecord, father: EntityRecord, e: number): void {
    const { world, records, rules, deadlines } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const tick = world.tick;
    const n = litter(this.rng.float());
    const eggKind = reg.breedEgg[mother.kind]!;
    const span = Math.max(1, Math.ceil(reg.incubateTicks[mother.kind]! / speed(rules.num("EggHatchSpeedMultiplier"))));
    const hatchAt = tick + span;
    const id = reg.ids[mother.kind]!;
    const what = id.slice(id.indexOf(":") + 1);
    const facing = (ents.yaw[e]! / 65536) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const egg = records.create(eggKind !== 0 ? eggKind : mother.kind, `${what} egg`);
      egg.genome = breed(mother.genome!, father.genome!, mother.pid, father.pid, this.rng, reg.mutationColors[mother.kind]!);
      egg.egg = { species: mother.kind, span, hatchAt, carrier: eggKind !== 0 ? 0 : mother.pid };
      // Whose creature laid it. Anyone may take an egg, as in ARK; a tribe's never angers the wild.
      if (eggKind !== 0) egg.team = mother.team;
      this.ctx.game.bus.after(BREED_EGG, { mother: mother.pid, father: father.pid, pid: egg.pid });
      // The egg lies just behind her, and several fan out. If there is no room there, it lies under her.
      const a = facing + Math.PI + (k - (n - 1) / 2) * 0.7;
      const off = reg.bodyRadius[mother.kind]! + 0.45;
      egg.x = ents.x[e]! + Math.sin(a) * off;
      egg.z = ents.z[e]! + Math.cos(a) * off;
      const ground = eggKind !== 0 ? groundUnder(world.hf, egg.x, egg.z, reg.bodyRadius[eggKind]!) : world.hf.heightAt(egg.x, egg.z);
      egg.y = ground > ents.y[e]! ? ground : ents.y[e]!;
      if (eggKind !== 0 && !placeFree(world, egg.x, egg.y, egg.z, reg.bodyRadius[eggKind]!, reg.bodyHeight[eggKind]!)) {
        egg.x = ents.x[e]!;
        egg.y = ents.y[e]!;
        egg.z = ents.z[e]!;
      }
      egg.yaw = this.rng.int(65536);
      if (eggKind !== 0) this.put(egg);
      deadlines.push(hatchAt, this.deadline, egg.pid, hatchAt);
      this.laid++;
    }
    mother.own(BREEDING).mateReadyAt = tick + Math.round(mateWait(this.rng.float()) * TICK_RATE * rules.num("MatingIntervalMultiplier"));
    records.dirty.add(mother.pid);
    this.mated++;
  }

  /** Places the egg's body. setYoung carries its hatch time to clients. */
  private put(egg: EntityRecord): void {
    this.ctx.place(egg);
    const e = this.ctx.records.entOf.get(egg.pid);
    if (e !== undefined) this.ctx.world.ents.setYoung(e, egg.egg!.span, egg.egg!.hatchAt);
  }

  private discard(egg: EntityRecord): void {
    const { world, records } = this.ctx;
    const e = records.entOf.get(egg.pid);
    if (e !== undefined) world.ents.destroy(e);
    records.delete(egg.pid);
  }

  /** The egg was taken up into an inventory, and its body is gone. It keeps the time it has left. */
  takenUp(egg: EntityRecord): void {
    const info = egg.egg!;
    info.hatchAt = Math.max(1, info.hatchAt - this.ctx.world.tick);
    info.carrier = egg.pid;
    this.ctx.records.dirty.add(egg.pid);
  }

  /** The held egg was set down and has its body again. It hatches the time it had left from now. */
  setDown(egg: EntityRecord): void {
    const { world, records, deadlines } = this.ctx;
    const info = egg.egg!;
    info.hatchAt = world.tick + info.hatchAt;
    info.carrier = 0;
    records.dirty.add(egg.pid);
    const e = records.entOf.get(egg.pid);
    if (e !== undefined) world.ents.setYoung(e, info.span, info.hatchAt);
    deadlines.push(info.hatchAt, this.deadline, egg.pid, info.hatchAt);
  }

  /** The young creature enters the world unclaimed. */
  private hatch(egg: EntityRecord): void {
    const { world, records, creatures, rules, deadlines, persistence } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const tick = world.tick;
    const info = egg.egg!;
    let x = egg.x;
    let y = egg.y;
    let z = egg.z;
    if (info.carrier !== 0) {
      // A carried young is born where its mother now stands. If she is gone, so is the young.
      const mother = records.byPid.get(info.carrier);
      const me = mother ? records.entOf.get(mother.pid) : undefined;
      if (!mother || mother.dead || me === undefined) return this.discard(egg);
      x = ents.x[me]!;
      y = ents.y[me]!;
      z = ents.z[me]!;
    }
    if (!egg.genome || reg.defs[info.species]?.type !== "species" || reg.breedEgg[info.species] === 0xffff) return this.discard(egg);
    const rec = records.create(info.species);
    rec.genome = egg.genome;
    rec.x = x;
    rec.y = y;
    rec.z = z;
    rec.yaw = egg.yaw;
    // Never so fast that one growth step takes less than a tick.
    rec.span = Math.max(GROWN, Math.ceil(reg.matureTicks[info.species]! / speed(rules.num("BabyMatureSpeedMultiplier"))));
    rec.grown = tick + rec.span;
    const e = creatures.adopt(rec);
    if (e < 0) {
      // No room for another body, so the egg waits PAIR_TICKS and tries again.
      records.delete(rec.pid);
      info.hatchAt = tick + PAIR_TICKS;
      records.dirty.add(egg.pid);
      deadlines.push(info.hatchAt, this.deadline, egg.pid, info.hatchAt);
      return;
    }
    persistence?.attach(rec, e);
    this.discard(egg);
    this.hatched++;
    this.ctx.game.bus.after(BREED_HATCH, { pid: rec.pid, kind: reg.ids[info.species]! });
    this.next(rec);
  }

  /** Schedules the young creature's next growth step. */
  private next(rec: EntityRecord): void {
    const tick = this.ctx.world.tick;
    const at = stepTick(rec.span, rec.grown, growthStep(rec.span, rec.grown, tick) + 1);
    const due = at > tick ? at : tick + 1;
    rec.growDue = due;
    this.ctx.deadlines.push(due, this.deadline, rec.pid, due);
  }

  /** One of a hundred growth steps. It can hold and carry more, and hungers a little less. The last step makes it grown. */
  private grow(rec: EntityRecord): void {
    const { world, records } = this.ctx;
    if (world.tick >= rec.grown) {
      rec.span = rec.grown = rec.growDue = 0;
      const e = records.entOf.get(rec.pid);
      if (e !== undefined) world.ents.setYoung(e, 0, 0);
      this.grownUp++;
      this.ctx.game.bus.after(BREED_GROWN, { pid: rec.pid });
    }
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    this.ctx.meal(rec);
    if (rec.grown !== 0) this.next(rec);
  }

  /**
   * The timing rules changed from `was` to the server's current ones, so every egg, young creature, female's wait
   * and pair is timed again from this tick (D91). Each keeps its progress, and a female's wait scales with its rule.
   */
  retime(was: { hatch: number; mature: number; interval: number; mating: number }): void {
    const { world, records, rules, deadlines } = this.ctx;
    const tick = world.tick;
    const hatch = speed(rules.num("EggHatchSpeedMultiplier"));
    const mature = speed(rules.num("BabyMatureSpeedMultiplier"));
    const interval = rules.num("MatingIntervalMultiplier");
    const mating = speed(rules.num("MatingSpeedMultiplier"));
    const grew = this.grew;
    for (const rec of records.byPid.values()) {
      const egg = rec.egg;
      // A tame kept in a soul ball keeps the pace it was kept at: its clocks are as of then, not of this tick.
      if (rec.stored !== 0) continue;
      if (egg && held(rec)) {
        // A held egg's hatchAt is the time it has left.
        if (hatch === speed(was.hatch) || !fertile(rec)) continue;
        egg.span = Math.max(1, Math.round((egg.span * speed(was.hatch)) / hatch));
        egg.hatchAt = leftAtSpeed(egg.hatchAt, speed(was.hatch), hatch);
        records.dirty.add(rec.pid);
        continue;
      }
      if (egg) {
        if (hatch === speed(was.hatch) || egg.hatchAt <= tick || !fertile(rec)) continue;
        egg.span = Math.max(1, Math.round((egg.span * speed(was.hatch)) / hatch));
        egg.hatchAt = tick + leftAtSpeed(egg.hatchAt - tick, speed(was.hatch), hatch);
        deadlines.push(egg.hatchAt, this.deadline, rec.pid, egg.hatchAt);
        const e = records.entOf.get(rec.pid);
        if (e !== undefined) world.ents.setYoung(e, egg.span, egg.hatchAt);
        records.dirty.add(rec.pid);
        continue;
      }
      if (rec.grown > tick && mature !== speed(was.mature)) {
        const step = growthStep(rec.span, rec.grown, tick);
        regrow(rec.span, rec.grown, tick, speed(was.mature) / mature, grew);
        rec.span = grew[0];
        rec.grown = grew[1];
        const e = records.entOf.get(rec.pid);
        if (e !== undefined) world.ents.setYoung(e, rec.span, rec.grown);
        records.dirty.add(rec.pid);
        // At either end of regrow's span range the young may be one growth step further on, so its limits and meal are recomputed.
        if (growthStep(rec.span, rec.grown, tick) !== step) {
          this.ctx.refresh(rec);
          this.ctx.meal(rec);
        }
        this.next(rec);
      }
      const own = rec.part(BREEDING);
      if (own && own.mateReadyAt > tick && interval !== was.interval && was.interval > 0) {
        own.mateReadyAt = interval > 0 ? tick + leftAtPeriod(own.mateReadyAt - tick, was.interval, interval) : tick;
        records.dirty.add(rec.pid);
      }
    }
    if (mating !== speed(was.mating)) {
      for (const [pid, pair] of this.pairs) {
        if (pair.due <= tick) continue;
        pair.span = Math.max(1, Math.round((pair.span * speed(was.mating)) / mating));
        pair.due = tick + leftAtSpeed(pair.due - tick, speed(was.mating), mating);
        deadlines.push(pair.due, this.deadline, pid, pair.due);
      }
    }
  }

  /** A cheat. False if it is not an egg that hatches where it lies. */
  hatchNow(egg: EntityRecord): boolean {
    if (!egg.egg || !fertile(egg) || held(egg)) return false;
    egg.egg.hatchAt = this.ctx.world.tick;
    this.hatch(egg);
    return true;
  }

  /** A cheat. False if it is not young. */
  growNow(rec: EntityRecord): boolean {
    if (rec.grown === 0 || rec.egg) return false;
    rec.grown = this.ctx.world.tick;
    this.grow(rec);
    return true;
  }

  /** True for a young creature that has no team yet. */
  unclaimed(rec: EntityRecord): boolean {
    return rec.team === 0 && rec.grown !== 0 && rec.egg === null && rec.keyHash === null;
  }

  /** The claimed young joins the session's tribe and stays put until ordered. Returns a RESULT code. */
  claim(c: Client, rec: EntityRecord): number {
    const { world, records, creatures, game } = this.ctx;
    const me = records.byPid.get(c.pid);
    if (!me || me.team === 0 || me.dead || me.out) return RESULT_DENIED;
    if (!this.unclaimed(rec)) return RESULT_INVALID;
    const full = this.ctx.full(me.team);
    if (full !== "") {
      this.ctx.notice(c.pid, full);
      return RESULT_FULL;
    }
    rec.team = me.team;
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    const e = records.entOf.get(rec.pid);
    if (e !== undefined) {
      creatures.mind.stay(e, 0xffffffff);
      creatures.claimed(e);
    }
    this.ctx.meal(rec);
    this.claimed++;
    // The claimer gets the tamed event, so it can name the creature.
    if (e !== undefined) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_TAMED);
      w.u32(world.ents.handleOf(e));
      w.u16(rec.kind);
      w.u16(rec.genome ? rec.genome.level : 1);
      w.u8(CLAIMED);
      game.endOwn(c);
    }
    return RESULT_OK;
  }

  /** `what` is an ORDER_ value. The caller checks who may give the order. Invalid for the young and for species that do not breed. */
  order(rec: EntityRecord, what: number): number {
    const { world, records } = this.ctx;
    if (world.reg.breedEgg[rec.kind] === 0xffff || rec.grown !== 0 || rec.team === 0) return RESULT_INVALID;
    const on = what === ORDER_MATE;
    if (on && (this.ctx.rules.on("bDisableDinoBreeding") || this.ctx.lists.kinds("PreventBreedingForClassNames").has(rec.kind))) return RESULT_DENIED;
    if (rec.mating === on) return RESULT_OK;
    rec.mating = on;
    records.dirty.add(rec.pid);
    // Disabling parts its pairs now, not at the next pass.
    if (!on) {
      if (this.pairs.delete(rec.pid)) this.parted++;
      for (const [pid, pair] of this.pairs) {
        if (pair.male !== rec.pid) continue;
        this.pairs.delete(pid);
        this.parted++;
      }
    }
    return RESULT_OK;
  }

  /** Progress of this creature's pair, 0 to 1, or 0 if it has none. For a male, the furthest along of his pairs. */
  progress(rec: EntityRecord): number {
    const tick = this.ctx.world.tick;
    const share = (p: { span: number; due: number }): number => Math.max(0, Math.min(1, 1 - (p.due - tick) / p.span));
    const own = this.pairs.get(rec.pid);
    if (own) return share(own);
    let best = 0;
    for (const p of this.pairs.values()) if (p.male === rec.pid) best = Math.max(best, share(p));
    return best;
  }

  /** The breeding part of what a session sees of the creature it has open. */
  subject(rec: EntityRecord): { mating: boolean; female: boolean; stage: number; maturity: number; mate: number; wait: number } {
    const tick = this.ctx.world.tick;
    const step = growthStep(rec.span, rec.grown, tick);
    return {
      mating: rec.mating,
      female: rec.genome ? rec.genome.female : false,
      stage: stageOf(step),
      maturity: maturity(rec.span, rec.grown, tick),
      mate: rec.mating ? this.progress(rec) : 0,
      // In seconds.
      wait: mateReadyAt(rec) > tick ? Math.ceil((mateReadyAt(rec) - tick) / TICK_RATE) : 0,
    };
  }

  get pairCount(): number {
    return this.pairs.size;
  }
}

/**
 * Mating state, a young one's growing and an egg's hatching. Each timer is a span and an end tick, never a start,
 * because growing made slower part way through would put the start before the world began.
 */
saved({
  name: "breeding",
  has: (rec) => rec.mating || mateReadyAt(rec) !== 0 || rec.grown !== 0 || rec.egg !== null,
  write(rec, w, to) {
    w.bool(rec.mating);
    w.uint53(mateReadyAt(rec));
    w.uint53(rec.span);
    w.uint53(rec.grown);
    w.bool(rec.egg !== null);
    if (rec.egg) {
      w.varint(to.toSaved[rec.egg.species]!);
      w.uint53(rec.egg.span);
      w.uint53(rec.egg.hatchAt);
      w.uint53(rec.egg.carrier);
    }
  },
  read(rec, r, from) {
    rec.mating = r.bool();
    const ready = r.uint53();
    if (ready !== 0) rec.own(BREEDING).mateReadyAt = ready;
    rec.span = r.uint53();
    rec.grown = r.uint53();
    if (r.bool()) rec.egg = { species: from.toRuntime[r.varint()] ?? 0, span: r.uint53(), hatchAt: r.uint53(), carrier: r.uint53() };
  },
  rebase(rec, delta) {
    const own = rec.part(BREEDING);
    if (own) own.mateReadyAt = moved(own.mateReadyAt, delta);
    rec.grown = moved(rec.grown, delta);
    // A fertilised egg held as an item keeps the time it has left, not a tick.
    if (rec.egg && rec.egg.carrier !== rec.pid) rec.egg.hatchAt = moved(rec.egg.hatchAt, delta);
    rec.growDue = 0;
  },
});
