// What a body's stats do to it. The server derives every number here and
// writes it into the body's columns; clients receive the result with their own
// body and never compute it, so prediction steps with the server's numbers.

import { GROWN, growthStep, youngHunger, youngShare } from "../shared/sim/breeding.ts";
import { proneHunger } from "../shared/sim/taming.ts";
import type { SpeciesDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MF_NO_SPRINT, MF_OUT, MF_ROOTED, MF_WINDED, STAMINA_UNITS } from "../shared/sim/character.ts";
import type { EntityStore } from "../shared/sim/entities.ts";
import { STAT_NAMES, statValue, type Genome, type StatName } from "../shared/sim/genome.ts";
import { GAME_HOUR_TICKS, MICRO, ratePerTick } from "../shared/sim/lazy.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { V_COUNT, V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER, Vitals } from "../shared/sim/vitals.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export const STAT_HEALTH = STAT_NAMES.indexOf("health");
export const STAT_FOOD = STAT_NAMES.indexOf("food");
export const STAT_WATER = STAT_NAMES.indexOf("water");
export const STAT_WEIGHT = STAT_NAMES.indexOf("weight");
export const STAT_STAMINA = STAT_NAMES.indexOf("stamina");
export const STAT_OXYGEN = STAT_NAMES.indexOf("oxygen");
export const STAT_SPEED = STAT_NAMES.indexOf("speed");
export const STAT_MELEE = STAT_NAMES.indexOf("melee");

/** A stat's current value for a body of this species, or `fallback` if the species has no curve for it. */
export function statOf(def: SpeciesDef, g: Genome | null, stat: number, fallback: number): number {
  const curve = def.stats?.[STAT_NAMES[stat] as StatName];
  if (!curve) return fallback;
  return g ? statValue(curve, g, stat) : curve[0];
}

/** A stat relative to the species' base, in thousandths, within what the wire carries. */
function ratioQ(def: SpeciesDef, g: Genome | null, stat: number): number {
  const curve = def.stats?.[STAT_NAMES[stat] as StatName];
  if (!curve || !g) return 1000;
  const q = Math.round((statValue(curve, g, stat) / curve[0]) * 1000);
  return q < 1 ? 1 : q > 4095 ? 4095 : q;
}

/** The levels a body was born or tamed with: every point it holds that was not spent by an owner. */
export function wildLevels(g: Genome | null): number {
  if (!g) return 0;
  let n = 0;
  for (let s = 0; s < STAT_NAMES.length; s++) n += g.wild[s]! + g.mutated[s]!;
  return n;
}

/**
 * The most torpor a body can hold before it goes under. Unlike the other
 * stats it takes no points of its own: it grows by its curve's second number
 * (0.06 in the reference) for every wild level the body has, whatever stat that
 * level went into. 0 for a species that cannot be knocked out.
 */
export function torporMax(def: SpeciesDef, g: Genome | null): number {
  const curve = def.stats?.torpidity;
  return curve ? curve[0] * (1 + curve[1] * wildLevels(g)) : 0;
}

/**
 * Torpor a body shakes off each second: its species' rate at level 1, more for
 * every wild level above that, by the reference's curve.
 */
export function torporDrain(def: SpeciesDef, g: Genome | null): number {
  const base = def.torporDrain ?? 1;
  const levels = wildLevels(g);
  return levels > 0 && base > 0 ? base + Math.pow(levels, 0.800403041) / (22.39671632 / base) : base;
}

/** Carrying this share of the weight stat stops sprinting and slows the body; carrying all of it roots it. */
const HEAVY = 0.85;
const HEAVY_SPEED = 0.6;

/**
 * Recompute the movement modifiers of entity `e` from its stat points and what
 * it carries: speed on land, speed in water (from oxygen, as in the reference
 * game), the stamina cap, and the limits of a heavy load. Call after anything
 * that changes the points or the load.
 */
export function refreshMods(reg: Registry, ents: EntityStore, e: number, g: Genome | null, carriedKg = 0, speedMul = 1, rooted = false, out = false): void {
  const def = reg.defs[ents.kind[e]!] as SpeciesDef;
  const load = carriedKg / statOf(def, g, STAT_WEIGHT, Infinity);
  let flags = (rooted ? MF_ROOTED | MF_NO_SPRINT : 0) | (out ? MF_OUT : 0);
  // What is acting on it (an injury, a stun) slows it as its stats quicken it.
  let speed = Math.max(1, Math.min(4095, Math.round(ratioQ(def, g, STAT_SPEED) * speedMul)));
  if (load >= 1) flags |= MF_ROOTED | MF_NO_SPRINT;
  else if (load >= HEAVY) {
    flags |= MF_NO_SPRINT;
    speed = Math.max(1, Math.round(speed * HEAVY_SPEED));
  }
  ents.speedQ[e] = speed;
  ents.swimQ[e] = ratioQ(def, g, STAT_OXYGEN);
  const max = Math.round(statOf(def, g, STAT_STAMINA, 100));
  ents.staminaMax[e] = max < 1 ? 1 : max > 65535 ? 65535 : max;
  if (ents.stamina[e]! > ents.staminaMax[e]! * STAMINA_UNITS) ents.stamina[e] = ents.staminaMax[e]! * STAMINA_UNITS;
  // Restrictions the server sets are recomputed here; being winded belongs to the step.
  ents.mflags[e] = (ents.mflags[e]! & MF_WINDED) | flags;
}

export const DEADLINE_VITALS = 1;

export const CAUSE_STARVED = 1;
export const CAUSE_THIRST = 2;
export const CAUSE_DROWNED = 3;
export const CAUSE_FALL = 4;
export const CAUSE_KILLED = 5;
/** Each completes "You ...". */
export const CAUSE_NAMES = ["", "starved", "died of thirst", "drowned", "fell to your death", "were killed"];

const perSecond = (points: number): number => Math.round((points * MICRO) / TICK_RATE);
const ratePerSecond = perSecond;
/** Points per second. */
const HEALTH_REGEN = perSecond(0.2);
const STARVE = perSecond(0.5);
const THIRST = perSecond(0.5);
const DROWN = perSecond(8);
const OXYGEN_DRAIN = perSecond(3);
const OXYGEN_REFILL = perSecond(20);
/** Below this much health a body is injured, and the worse for it. */
const INJURED = 30 * MICRO;
/** A landing slower than this does no harm; each metre per second above it costs this much health. */
const SAFE_LANDING = 12;
const LANDING_DAMAGE = 7;

/**
 * Vitals for every body that has them. Nothing is stepped: a change of
 * circumstance sets new rates and one deadline for the next moment something
 * runs out, which fires whether or not anyone is near.
 */
export class Survival {
  readonly deadlines: DeadlineHeap;
  /** Records whose food has run out. */
  readonly starving = new Set<number>();
  /** Called when a body's health reaches zero. `by` is the persistent id of whoever did it, or 0. */
  onDeath: ((rec: EntityRecord, cause: number, by: number) => void) | null = null;
  /** Records that take no harm. */
  readonly gods = new Set<number>();
  /** Called when a body goes unconscious (its torpor reached its most) or comes round (it ran out). */
  onOut: ((rec: EntityRecord, out: boolean) => void) | null = null;
  /** Called when a body's health falls below the mark of an injury, or mends past it. */
  onInjured: ((rec: EntityRecord, injured: boolean) => void) | null = null;
  /** Rates that something acting on a body adds to its own, millionths of a point per tick, and who is to blame if the harm kills. */
  private readonly extra = new Map<number, { health: number; torpor: number; by: number }>();
  private readonly injured = new Set<number>();

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly submerged = new Set<number>();
  private readonly suspended = new Set<number>();
  private pendingCause = 0;
  private pendingBy = 0;

  /** `deadlines` is the world's one heap; whoever runs it passes DEADLINE_VITALS entries to `due`. */
  constructor(world: ServerWorld, records: Records, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.deadlines = deadlines;
  }

  /** Set every vital to its maximum (a respawn). */
  refill(rec: EntityRecord): void {
    const v = rec.vitals;
    if (!v) return;
    v.rebase(this.world.tick);
    for (let i = 0; i < V_COUNT; i++) v.value[i] = i === V_TORPOR ? 0 : v.max[i]!;
    rec.out = false;
    this.records.dirty.add(rec.pid);
  }

  /**
   * The most of each vital this body has, by its species and its points; 0
   * for one it does not have. A young one has a share of a grown one's health
   * and food, by how far grown it is.
   */
  private maxima(def: SpeciesDef, rec: EntityRecord): number[] {
    const g = rec.genome;
    const share = youngShare(growthStep(rec.born, rec.grown, this.world.tick));
    return [statOf(def, g, STAT_HEALTH, 0) * share, statOf(def, g, STAT_FOOD, def.food?.max ?? 0) * share, def.waterPerHour ? statOf(def, g, STAT_WATER, 100) : 0, statOf(def, g, STAT_OXYGEN, 0), torporMax(def, g)];
  }

  /**
   * Rates that something acting on a body adds to its own: health and torpor
   * per second (negative health harms), and who is to blame if that kills it.
   */
  setExtra(rec: EntityRecord, health: number, torpor: number, by: number): void {
    if (health === 0 && torpor === 0) this.extra.delete(rec.pid);
    else this.extra.set(rec.pid, { health: Math.round((health * MICRO) / TICK_RATE), torpor: Math.round((torpor * MICRO) / TICK_RATE), by });
    if (rec.vitals) this.update(rec);
  }

  /** Give a record vitals if its species has any, full; or refresh their maxima after its stats changed. */
  init(rec: EntityRecord): void {
    const def = this.world.reg.defs[rec.kind];
    if (def?.type !== "species") return;
    const max = this.maxima(def, rec);
    if (max.every((m) => m <= 0)) return;
    const fresh = !rec.vitals;
    const v = (rec.vitals ??= new Vitals());
    if (!fresh) v.rebase(this.world.tick);
    else v.tick = this.world.tick;
    for (let i = 0; i < V_COUNT; i++) {
      v.max[i] = Math.round(max[i]! * MICRO);
      // A new body is full of everything but torpor, of which it has none.
      if (fresh) v.value[i] = i === V_TORPOR ? 0 : v.max[i]!;
      else if (v.value[i]! > v.max[i]!) v.value[i] = v.max[i]!;
    }
    this.update(rec);
  }

  /**
   * Take in a record loaded from a save: give its vitals their maxima and put
   * its deadline back. Nothing about it changed, so it is not written again.
   * A survivor is not in the world after a restart, so its clock is stopped.
   */
  restore(rec: EntityRecord, inWorld: boolean): void {
    const v = rec.vitals;
    const def = this.world.reg.defs[rec.kind];
    if (!v || def?.type !== "species") return;
    const max = this.maxima(def, rec);
    for (let i = 0; i < V_COUNT; i++) v.max[i] = Math.round(max[i]! * MICRO);
    if (!inWorld) {
      // Saved with its clock running (the server stopped while it was in the world): stop it, and save that.
      this.suspended.add(rec.pid);
      if (v.rate.some((r) => r !== 0)) {
        v.rebase(this.world.tick);
        v.rate.fill(0);
        this.records.dirty.add(rec.pid);
      }
      return;
    }
    if (v.max[V_FOOD]! > 0 && v.at(V_FOOD, this.world.tick) <= 0) this.starving.add(rec.pid);
    let next = Infinity;
    for (let i = 0; i < V_COUNT; i++) if (v.rate[i]! < 0 && v.value[i]! > 0) next = Math.min(next, v.zeroTick(i));
    if (next !== Infinity) this.deadlines.push(next, DEADLINE_VITALS, rec.pid, v.version);
  }

  /** A vital now, in points. */
  value(rec: EntityRecord, i: number): number {
    return rec.vitals ? rec.vitals.at(i, this.world.tick) / MICRO : 0;
  }

  /** Add points to a vital (negative to take). Harm to health is refused for gods. `cause` names what did it if it kills. */
  add(rec: EntityRecord, i: number, points: number, cause = CAUSE_KILLED): void {
    const v = rec.vitals;
    if (!v || (points < 0 && i === V_HEALTH && this.gods.has(rec.pid))) return;
    v.rebase(this.world.tick);
    const next = v.value[i]! + Math.round(points * MICRO);
    v.value[i] = next < 0 ? 0 : next > v.max[i]! ? v.max[i]! : next;
    this.pendingCause = cause;
    this.update(rec);
    this.pendingCause = 0;
  }

  /**
   * Harm done by someone: take `points` of health, and if that kills, `by`
   * (a persistent id, or 0 for nobody) is who did it. Returns the points taken,
   * which is less than asked when it had less left, and none for a god.
   */
  hurt(rec: EntityRecord, points: number, by: number, cause = CAUSE_KILLED): number {
    if (!rec.vitals || !(points > 0) || this.gods.has(rec.pid)) return 0;
    const before = this.value(rec, V_HEALTH);
    this.pendingBy = by;
    this.add(rec, V_HEALTH, -points, cause);
    this.pendingBy = 0;
    return points < before ? points : before;
  }

  /** The body's head went under water or came up. */
  setSubmerged(rec: EntityRecord, under: boolean): void {
    if (under === this.submerged.has(rec.pid)) return;
    if (under) this.submerged.add(rec.pid);
    else this.submerged.delete(rec.pid);
    if (rec.vitals) this.update(rec);
  }

  isSubmerged(rec: EntityRecord): boolean {
    return this.submerged.has(rec.pid);
  }

  /** Stop the clock on a survivor who is not in the world; start it again when they return. */
  suspend(rec: EntityRecord, off: boolean): void {
    if (off === this.suspended.has(rec.pid)) return;
    if (off) {
      this.suspended.add(rec.pid);
      this.submerged.delete(rec.pid);
    } else this.suspended.delete(rec.pid);
    if (rec.vitals) this.update(rec);
  }

  /** A body landed at `speed` metres per second. */
  landed(rec: EntityRecord, speed: number): void {
    if (speed > SAFE_LANDING) this.add(rec, V_HEALTH, -(speed - SAFE_LANDING) * LANDING_DAMAGE, CAUSE_FALL);
  }

  /** Forget a record that is being deleted. */
  forget(pid: number): void {
    this.starving.delete(pid);
    this.submerged.delete(pid);
    this.suspended.delete(pid);
    this.gods.delete(pid);
    this.extra.delete(pid);
    this.injured.delete(pid);
  }

  /** A DEADLINE_VITALS entry came due. Stale if the record is gone or its vitals have changed since it was scheduled. */
  due(pid: number, stamp: number): void {
    const rec = this.records.byPid.get(pid);
    if (rec?.vitals && rec.vitals.version === stamp) this.update(rec);
  }

  /** Set every rate from the body's circumstances, then schedule the next moment something runs out. */
  private update(rec: EntityRecord): void {
    const v = rec.vitals!;
    const tick = this.world.tick;
    v.rebase(tick);
    this.records.dirty.add(rec.pid);
    const def = this.world.reg.defs[rec.kind] as SpeciesDef;
    const paused = this.suspended.has(rec.pid);
    const under = this.submerged.has(rec.pid);
    const eats = v.max[V_FOOD]! > 0 && def.food !== undefined;
    const drinks = v.max[V_WATER]! > 0;
    const breathes = v.max[V_OXYGEN]! > 0;
    const starved = eats && v.value[V_FOOD]! <= 0;
    const parched = drinks && v.value[V_WATER]! <= 0;
    const airless = breathes && under && v.value[V_OXYGEN]! <= 0;
    if (starved) this.starving.add(rec.pid);
    else this.starving.delete(rec.pid);

    const ex = this.extra.get(rec.pid);
    if (v.max[V_HEALTH]! > 0 && v.value[V_HEALTH]! <= 0) {
      v.rate.fill(0);
      rec.out = false;
      // Harm from someone is what killed it, whatever else was wrong with it: a blow, or something they left acting on it.
      const by = this.pendingBy !== 0 ? this.pendingBy : ex && ex.health < 0 ? ex.by : 0;
      this.onDeath?.(rec, by !== 0 ? this.pendingCause : airless ? CAUSE_DROWNED : starved ? CAUSE_STARVED : parched ? CAUSE_THIRST : this.pendingCause || CAUSE_KILLED, by);
      return;
    }
    if (paused) {
      v.rate.fill(0);
      return;
    }
    // Lying unconscious, a creature that can be tamed hungers at the reference's rate for that, which is fast.
    // A young one hungers many times as fast as a grown one, less so the more grown it is.
    const step = growthStep(rec.born, rec.grown, tick);
    v.rate[V_FOOD] = eats ? -(step < GROWN ? Math.round((def.food!.perHour * MICRO * youngHunger(step)) / GAME_HOUR_TICKS) : rec.out && def.taming ? ratePerSecond(proneHunger(def.taming)) : ratePerTick(def.food!.perHour)) : 0;
    v.rate[V_WATER] = drinks ? -ratePerTick(def.waterPerHour!) : 0;
    v.rate[V_OXYGEN] = breathes ? (under ? -OXYGEN_DRAIN : OXYGEN_REFILL) : 0;
    const god = this.gods.has(rec.pid);
    const harm = god ? 0 : (starved ? STARVE : 0) + (parched ? THIRST : 0) + (airless ? DROWN : 0);
    // What is acting on it adds to that; a god takes the good of it and none of the harm.
    const acting = ex ? (god && ex.health < 0 ? 0 : ex.health) : 0;
    v.rate[V_HEALTH] = (harm > 0 ? -harm : HEALTH_REGEN) + acting;

    // Torpor: whatever is dosing it, less what it shakes off each tick. At its most the body is out, and stays out until it is all gone.
    let wentOut = false;
    let cameRound = false;
    if (v.max[V_TORPOR]! > 0) {
      if (!rec.out && v.value[V_TORPOR]! >= v.max[V_TORPOR]!) rec.out = wentOut = true;
      else if (rec.out && v.value[V_TORPOR]! <= 0) {
        rec.out = false;
        cameRound = true;
      }
      // While something is dosing it, it shakes nothing off: the dose is the whole rate.
      const dose = ex ? ex.torpor : 0;
      const net = dose > 0 ? dose : -ratePerSecond(torporDrain(def, rec.genome));
      v.rate[V_TORPOR] = net < 0 && v.value[V_TORPOR]! <= 0 ? 0 : net;
    } else v.rate[V_TORPOR] = 0;
    const injured = v.max[V_HEALTH]! > INJURED && v.value[V_HEALTH]! < INJURED;
    const wasInjured = this.injured.has(rec.pid);
    if (injured) this.injured.add(rec.pid);
    else this.injured.delete(rec.pid);

    let next = Infinity;
    for (let i = 0; i < V_COUNT; i++) {
      if (v.rate[i]! < 0 && v.value[i]! > 0) next = Math.min(next, v.zeroTick(i));
    }
    // The other moments at which something changes: torpor reaching its most, health crossing the mark of an injury either way.
    if (v.rate[V_TORPOR]! > 0 && !rec.out) next = Math.min(next, v.fullTick(V_TORPOR));
    if (injured && v.rate[V_HEALTH]! > 0) next = Math.min(next, v.riseTick(V_HEALTH, INJURED));
    else if (!injured && v.rate[V_HEALTH]! < 0 && v.max[V_HEALTH]! > INJURED) next = Math.min(next, v.tick + Math.floor((v.value[V_HEALTH]! - INJURED) / -v.rate[V_HEALTH]!) + 1);
    if (next !== Infinity) this.deadlines.push(next, DEADLINE_VITALS, rec.pid, v.version);
    // Whoever is told may look at this record's vitals again: everything above is settled first.
    if (wentOut || cameRound) this.onOut?.(rec, rec.out);
    if (injured !== wasInjured) this.onInjured?.(rec, injured);
  }
}
