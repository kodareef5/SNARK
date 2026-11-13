// What a body's stats do to it. The server derives every number here and
// writes it into the body's columns; clients receive the result with their own
// body and never compute it, so prediction steps with the server's numbers.

import type { SpeciesDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MF_NO_SPRINT, MF_ROOTED, MF_WINDED, STAMINA_UNITS } from "../shared/sim/character.ts";
import type { EntityStore } from "../shared/sim/entities.ts";
import { STAT_NAMES, statValue, type Genome, type StatName } from "../shared/sim/genome.ts";
import { MICRO, ratePerTick } from "../shared/sim/lazy.ts";
import { DeadlineHeap } from "../shared/sim/schedule.ts";
import { V_COUNT, V_FOOD, V_HEALTH, V_OXYGEN, V_WATER, Vitals } from "../shared/sim/vitals.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export const STAT_HEALTH = STAT_NAMES.indexOf("health");
export const STAT_FOOD = STAT_NAMES.indexOf("food");
export const STAT_WATER = STAT_NAMES.indexOf("water");
export const STAT_WEIGHT = STAT_NAMES.indexOf("weight");
export const STAT_STAMINA = STAT_NAMES.indexOf("stamina");
export const STAT_OXYGEN = STAT_NAMES.indexOf("oxygen");
export const STAT_SPEED = STAT_NAMES.indexOf("speed");

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

/** Carrying this share of the weight stat stops sprinting and slows the body; carrying all of it roots it. */
const HEAVY = 0.85;
const HEAVY_SPEED = 0.6;

/**
 * Recompute the movement modifiers of entity `e` from its stat points and what
 * it carries: speed on land, speed in water (from oxygen, as in the reference
 * game), the stamina cap, and the limits of a heavy load. Call after anything
 * that changes the points or the load.
 */
export function refreshMods(reg: Registry, ents: EntityStore, e: number, g: Genome | null, carriedKg = 0): void {
  const def = reg.defs[ents.kind[e]!] as SpeciesDef;
  const load = carriedKg / statOf(def, g, STAT_WEIGHT, Infinity);
  let flags = 0;
  let speed = ratioQ(def, g, STAT_SPEED);
  if (load >= 1) flags = MF_ROOTED | MF_NO_SPRINT;
  else if (load >= HEAVY) {
    flags = MF_NO_SPRINT;
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
export const CAUSE_NAMES = ["", "starved", "died of thirst", "drowned", "fell", "was killed"];

const perSecond = (points: number): number => Math.round((points * MICRO) / TICK_RATE);
/** Points per second. */
const HEALTH_REGEN = perSecond(0.2);
const STARVE = perSecond(0.5);
const THIRST = perSecond(0.5);
const DROWN = perSecond(8);
const OXYGEN_DRAIN = perSecond(3);
const OXYGEN_REFILL = perSecond(20);
/** A landing slower than this does no harm; each metre per second above it costs this much health. */
const SAFE_LANDING = 12;
const LANDING_DAMAGE = 7;

/**
 * Vitals for every body that has them. Nothing is stepped: a change of
 * circumstance sets new rates and one deadline for the next moment something
 * runs out, which fires whether or not anyone is near.
 */
export class Survival {
  readonly deadlines = new DeadlineHeap();
  /** Records whose food has run out. */
  readonly starving = new Set<number>();
  /** Called when a body's health reaches zero. */
  onDeath: ((rec: EntityRecord, cause: number) => void) | null = null;
  /** Records that take no harm. */
  readonly gods = new Set<number>();

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly submerged = new Set<number>();
  private readonly suspended = new Set<number>();
  private pendingCause = 0;

  constructor(world: ServerWorld, records: Records) {
    this.world = world;
    this.records = records;
  }

  /** Give a record vitals if its species has any, full; or refresh their maxima after its stats changed. */
  init(rec: EntityRecord): void {
    const def = this.world.reg.defs[rec.kind];
    if (def?.type !== "species") return;
    const g = rec.genome;
    const max = [statOf(def, g, STAT_HEALTH, 0), statOf(def, g, STAT_FOOD, def.food?.max ?? 0), def.waterPerHour ? statOf(def, g, STAT_WATER, 100) : 0, statOf(def, g, STAT_OXYGEN, 0)];
    if (max.every((m) => m <= 0)) return;
    const fresh = !rec.vitals;
    const v = (rec.vitals ??= new Vitals());
    if (!fresh) v.rebase(this.world.tick);
    else v.tick = this.world.tick;
    for (let i = 0; i < V_COUNT; i++) {
      v.max[i] = Math.round(max[i]! * MICRO);
      if (fresh || v.value[i]! > v.max[i]!) v.value[i] = v.max[i]!;
    }
    this.update(rec);
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
  }

  /** Run the deadlines that are due. */
  step(tick: number): void {
    this.deadlines.run(tick, (kind, pid, stamp) => {
      if (kind !== DEADLINE_VITALS) return;
      const rec = this.records.byPid.get(pid);
      // Stale if the record is gone or its vitals have changed since this was scheduled.
      if (rec?.vitals && rec.vitals.version === stamp) this.update(rec);
    });
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

    if (v.max[V_HEALTH]! > 0 && v.value[V_HEALTH]! <= 0) {
      v.rate.fill(0);
      this.onDeath?.(rec, airless ? CAUSE_DROWNED : starved ? CAUSE_STARVED : parched ? CAUSE_THIRST : this.pendingCause || CAUSE_KILLED);
      return;
    }
    if (paused) {
      v.rate.fill(0);
      return;
    }
    v.rate[V_FOOD] = eats ? -ratePerTick(def.food!.perHour) : 0;
    v.rate[V_WATER] = drinks ? -ratePerTick(def.waterPerHour!) : 0;
    v.rate[V_OXYGEN] = breathes ? (under ? -OXYGEN_DRAIN : OXYGEN_REFILL) : 0;
    const harm = this.gods.has(rec.pid) ? 0 : (starved ? STARVE : 0) + (parched ? THIRST : 0) + (airless ? DROWN : 0);
    v.rate[V_HEALTH] = harm > 0 ? -harm : HEALTH_REGEN;

    let next = Infinity;
    for (let i = 0; i < V_COUNT; i++) {
      if (v.rate[i]! < 0 && v.value[i]! > 0) next = Math.min(next, v.zeroTick(i));
    }
    if (next !== Infinity) this.deadlines.push(next, DEADLINE_VITALS, rec.pid, v.version);
  }
}
