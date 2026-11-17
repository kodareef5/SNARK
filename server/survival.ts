// The server derives every number here and writes it into the body's columns. Clients receive the result with
// their own body and never compute it, so prediction steps with the server's numbers.

import { GROWN, growthStep, youngHunger, youngShare } from "../shared/sim/breeding.ts";
import { proneHunger } from "../shared/sim/taming.ts";
import type { SpeciesDef } from "../shared/content/defs.ts";
import { drainAt, torporAt } from "../shared/content/wild.ts";
import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MF_NO_JUMP, MF_NO_SPRINT, MF_OUT, MF_ROOTED, MF_WINDED, STAMINA_UNITS } from "../shared/sim/character.ts";
import type { EntityStore } from "../shared/sim/entities.ts";
import { STAT_NAMES, statValue, type Genome, type StatName } from "../shared/sim/genome.ts";
import { GAME_HOUR_TICKS, MICRO } from "../shared/sim/lazy.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { V_COUNT, V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER, Vitals } from "../shared/sim/vitals.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";

export const STAT_HEALTH = STAT_NAMES.indexOf("health");
export const STAT_FOOD = STAT_NAMES.indexOf("food");
export const STAT_WATER = STAT_NAMES.indexOf("water");
export const STAT_WEIGHT = STAT_NAMES.indexOf("weight");
export const STAT_STAMINA = STAT_NAMES.indexOf("stamina");
export const STAT_OXYGEN = STAT_NAMES.indexOf("oxygen");
export const STAT_SPEED = STAT_NAMES.indexOf("speed");
export const STAT_MELEE = STAT_NAMES.indexOf("melee");

/** Returns `fallback` if the species has no curve for the stat. */
export function statOf(def: SpeciesDef, g: Genome | null, stat: number, fallback: number): number {
  const curve = def.stats?.[STAT_NAMES[stat] as StatName];
  if (!curve) return fallback;
  return g ? statValue(curve, g, stat) : curve[0];
}

/** A stat in thousandths of the species' base, clamped to what the wire carries. */
function ratioQ(def: SpeciesDef, g: Genome | null, stat: number): number {
  const curve = def.stats?.[STAT_NAMES[stat] as StatName];
  if (!curve || !g) return 1000;
  const q = Math.round((statValue(curve, g, stat) / curve[0]) * 1000);
  return q < 1 ? 1 : q > 4095 ? 4095 : q;
}

/** The levels a body was born or tamed with. Points an owner spent are not counted. */
export function wildLevels(g: Genome | null): number {
  if (!g) return 0;
  let n = 0;
  for (let s = 0; s < STAT_NAMES.length; s++) n += g.wild[s]! + g.mutated[s]!;
  return n;
}

/**
 * No stat points go into torpor. Its maximum grows by the curve's second number (0.06 in ARK) for every wild
 * level in any stat. 0 for a species that cannot be knocked out.
 */
export function torporMax(def: SpeciesDef, g: Genome | null): number {
  const curve = def.stats?.torpidity;
  return curve ? torporAt(curve[0], curve[1], wildLevels(g)) : 0;
}

/** Torpor lost per second (shared/content/wild.ts). */
export function torporDrain(def: SpeciesDef, g: Genome | null): number {
  return drainAt(def.torporDrain ?? 1, wildLevels(g));
}

/** Carrying this share of the weight stat stops sprinting and slows the body. Carrying all of it roots the body. */
const HEAVY = 0.85;
const HEAVY_SPEED = 0.6;

/**
 * Recomputes entity `e`'s movement modifiers from its stat points and load. Swim speed comes from oxygen, as in ARK.
 * Call it after anything that changes the points or the load. `swimGain` scales the swim speed each oxygen level gives.
 */
export function refreshMods(reg: Registry, ents: EntityStore, e: number, g: Genome | null, carriedKg = 0, speedMul = 1, rooted = false, out = false, swimGain = 1): void {
  const def = reg.defs[ents.kind[e]!] as SpeciesDef;
  const load = carriedKg / statOf(def, g, STAT_WEIGHT, Infinity);
  let flags = (rooted ? MF_ROOTED | MF_NO_SPRINT : 0) | (out ? MF_OUT : 0);
  // Buffs (an injury, a stun) slow it through speedMul.
  let speed = Math.max(1, Math.min(4095, Math.round(ratioQ(def, g, STAT_SPEED) * speedMul)));
  // Too heavy to move, a flyer cannot take off either, and in the air is put down as one out of stamina is, not felled as a
  // bola fells it (shared/sim/character.ts). Encumbered, it cannot sprint or roll.
  if (load >= 1) flags |= MF_ROOTED | MF_NO_SPRINT | (reg.flies[ents.kind[e]!] ? MF_NO_JUMP : 0);
  else if (load >= HEAVY) {
    flags |= MF_NO_SPRINT;
    speed = Math.max(1, Math.round(speed * HEAVY_SPEED));
  }
  ents.speedQ[e] = speed;
  const swim = Math.round(1000 + (ratioQ(def, g, STAT_OXYGEN) - 1000) * swimGain);
  ents.swimQ[e] = swim < 1 ? 1 : swim > 4095 ? 4095 : swim;
  const max = Math.round(statOf(def, g, STAT_STAMINA, 100));
  ents.staminaMax[e] = max < 1 ? 1 : max > 65535 ? 65535 : max;
  if (ents.stamina[e]! > ents.staminaMax[e]! * STAMINA_UNITS) ents.stamina[e] = ents.staminaMax[e]! * STAMINA_UNITS;
  // The server's flags are recomputed here. MF_WINDED belongs to the step and is kept.
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
/**
 * Scales a rate (millionths of a point per tick) by a server rule. The result is whole and never rounds to 0,
 * which would turn "a hundredth as fast" into "never".
 */
const scaled = (rate: number, by: number): number => {
  const whole = Math.round(rate * by);
  return whole === 0 && rate > 0 && by > 0 ? 1 : whole;
};
/** Points per second. */
const HEALTH_REGEN = perSecond(0.2);
const STARVE = perSecond(0.5);
const THIRST = perSecond(0.5);
const DROWN = perSecond(8);
const OXYGEN_DRAIN = perSecond(3);
const OXYGEN_REFILL = perSecond(20);
/** Below this much health a body is injured. */
const INJURED = 30 * MICRO;
/** Metres per second a landing may have without harm, and the health each metre per second above that costs. */
const SAFE_LANDING = 12;
const LANDING_DAMAGE = 7;
/** A creature's: a third more speed before it is hurt, and a third less harm (ARK patch 176.0, against its survivors'). */
const CREATURE_SAFE_LANDING = SAFE_LANDING * (4 / 3);
const CREATURE_LANDING_DAMAGE = LANDING_DAMAGE * (2 / 3);

/** Nothing is stepped. A change of circumstance sets new rates and one deadline for the next tick a vital runs out. */
const DAMAGE = event("damage");
/** A cause of death as a module is told it. */
export const CAUSE_WORDS: readonly string[] = ["", "starved", "thirst", "drowned", "fall", "killed"];

export class Survival {
  readonly deadlines: DeadlineHeap;
  rules: Rules | null = null;
  bus: Bus = NO_BUS;
  readonly starving = new Set<number>();
  /** Called when health reaches zero. `by` is the killer's record id, or 0. */
  onDeath: ((rec: EntityRecord, cause: number, by: number) => void) | null = null;
  /** Records that take no harm. */
  readonly gods = new Set<number>();
  /** Called when a body goes unconscious or comes round. */
  onOut: ((rec: EntityRecord, out: boolean) => void) | null = null;
  /** Called when health crosses INJURED in either direction. */
  onInjured: ((rec: EntityRecord, injured: boolean) => void) | null = null;
  /** Extra rates on a body, in millionths of a point per tick, and the record id to blame if the harm kills. */
  private readonly extra = new Map<number, { health: number; torpor: number; by: number }>();
  private readonly injured = new Set<number>();

  /** Set while loading a save whose bodies were rated under other settings. Each body is rated again as it is restored. */
  rerate = false;
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly survivor: number;
  private readonly submerged = new Set<number>();
  private readonly suspended = new Set<number>();
  private pendingCause = 0;
  private pendingBy = 0;

  /** `deadlines` is the world's one heap. Its runner must pass DEADLINE_VITALS entries to `due`. */
  constructor(world: ServerWorld, records: Records, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.deadlines = deadlines;
    this.survivor = world.reg.index.get("core:survivor") ?? 0;
  }

  /** Recomputes a body's rates, for when a rule they depend on has changed. */
  touch(rec: EntityRecord): void {
    if (rec.vitals) this.update(rec);
  }

  /** For a respawn. Every vital goes to its maximum, and torpor to 0. */
  refill(rec: EntityRecord): void {
    const v = rec.vitals;
    if (!v) return;
    v.rebase(this.world.tick);
    for (let i = 0; i < V_COUNT; i++) v.value[i] = i === V_TORPOR ? 0 : v.max[i]!;
    rec.out = false;
    this.records.dirty.add(rec.pid);
  }

  /** The maximum of each vital, or 0 for one the body does not have. A young body has a share of a grown one's health and food. */
  private maxima(def: SpeciesDef, rec: EntityRecord): number[] {
    const g = rec.genome;
    const share = youngShare(growthStep(rec.span, rec.grown, this.world.tick));
    return [statOf(def, g, STAT_HEALTH, 0) * share, statOf(def, g, STAT_FOOD, def.food?.max ?? 0) * share, def.waterPerHour ? statOf(def, g, STAT_WATER, 100) : 0, statOf(def, g, STAT_OXYGEN, 0), torporMax(def, g)];
  }

  /** `health` and `torpor` are points per second added to the body's rates (negative health harms). `by` is blamed if that kills it. */
  setExtra(rec: EntityRecord, health: number, torpor: number, by: number): void {
    if (health === 0 && torpor === 0) this.extra.delete(rec.pid);
    else this.extra.set(rec.pid, { health: Math.round((health * MICRO) / TICK_RATE), torpor: Math.round((torpor * MICRO) / TICK_RATE), by });
    if (rec.vitals) this.update(rec);
  }

  /** Gives a record full vitals if its species has any, or refreshes their maxima after its stats changed. */
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
      if (fresh) v.value[i] = i === V_TORPOR ? 0 : v.max[i]!;
      else if (v.value[i]! > v.max[i]!) v.value[i] = v.max[i]!;
    }
    this.update(rec);
  }

  /** For a record loaded from a save. A survivor is not in the world after a restart, so its clock is stopped. */
  restore(rec: EntityRecord, inWorld: boolean): void {
    const v = rec.vitals;
    const def = this.world.reg.defs[rec.kind];
    if (!v || def?.type !== "species") return;
    const max = this.maxima(def, rec);
    for (let i = 0; i < V_COUNT; i++) v.max[i] = Math.round(max[i]! * MICRO);
    if (!inWorld) {
      // The server stopped while it was in the world, so its clock was saved running. Stop it and save that.
      this.suspended.add(rec.pid);
      if (v.rate.some((r) => r !== 0)) {
        v.rebase(this.world.tick);
        v.rate.fill(0);
        this.records.dirty.add(rec.pid);
      }
      return;
    }
    if (this.rerate) {
      this.update(rec);
      return;
    }
    if (v.max[V_FOOD]! > 0 && v.at(V_FOOD, this.world.tick) <= 0) this.starving.add(rec.pid);
    let next = Infinity;
    for (let i = 0; i < V_COUNT; i++) if (v.rate[i]! < 0 && v.value[i]! > 0) next = Math.min(next, v.zeroTick(i));
    this.schedule(rec, next);
  }

  /**
   * Sets the record's one vitals deadline to tick `at`, or to none with Infinity. A body is rated far more often than its
   * deadline moves (its food runs out on the same tick however it is hurt or mended), and an entry stays in the heap until
   * its tick, so only a change is scheduled. The entry it replaces is passed over when it comes due.
   */
  private schedule(rec: EntityRecord, at: number): void {
    const due = at === Infinity ? 0 : at;
    if (due === rec.vitalsDue) return;
    rec.vitalsDue = due;
    if (due !== 0) this.deadlines.push(due, DEADLINE_VITALS, rec.pid, due);
  }

  /** In points. */
  value(rec: EntityRecord, i: number): number {
    return rec.vitals ? rec.vitals.at(i, this.world.tick) / MICRO : 0;
  }

  /** Negative `points` take. Gods take no harm to health. `cause` is the CAUSE_ reported if it kills. */
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
   * Takes `points` of health. `by` is the record id blamed if that kills, or 0 for nobody.
   * Returns the points taken, which is less than asked when less was left, and 0 for a god.
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

  /** Stops the clock on a survivor who is not in the world, and starts it when they return. */
  suspend(rec: EntityRecord, off: boolean): void {
    if (off === this.suspended.has(rec.pid)) return;
    if (off) {
      this.suspended.add(rec.pid);
      this.submerged.delete(rec.pid);
    } else this.suspended.delete(rec.pid);
    if (rec.vitals) this.update(rec);
  }

  /** `speed` is in metres per second. */
  landed(rec: EntityRecord, speed: number): void {
    const person = rec.kind === this.survivor;
    const safe = (person ? SAFE_LANDING : CREATURE_SAFE_LANDING) * (this.rules ? this.rules.num("MaxFallSpeedMultiplier") : 1);
    if (!(speed > safe)) return;
    // A fall is a blow with nobody behind it, and a module is asked of it as of any other.
    const asked = { target: "body", victim: rec.pid, kind: this.world.reg.ids[rec.kind]!, team: rec.team, byPid: 0, byTeam: 0, item: "", type: "fall", zone: 0, scale: 1 };
    if (this.bus.n[DAMAGE] !== 0 && this.bus.before(DAMAGE, asked) !== "") return;
    const scale = Number(asked.scale);
    this.add(rec, V_HEALTH, -(speed - safe) * (person ? LANDING_DAMAGE : CREATURE_LANDING_DAMAGE) * (scale >= 0 ? scale : 1), CAUSE_FALL);
  }

  /** Call when a record is deleted. */
  /** Ends what buffs were adding to a body's rates, without settling its vitals. */
  dropExtra(pid: number): void {
    this.extra.delete(pid);
  }

  forget(pid: number): void {
    this.starving.delete(pid);
    this.submerged.delete(pid);
    this.suspended.delete(pid);
    this.gods.delete(pid);
    this.extra.delete(pid);
    this.injured.delete(pid);
  }

  /** A DEADLINE_VITALS entry came due. It is stale if the record is gone or its deadline has moved since it was scheduled. */
  due(pid: number, stamp: number): void {
    const rec = this.records.byPid.get(pid);
    if (!rec?.vitals || rec.vitalsDue !== stamp) return;
    rec.vitalsDue = 0;
    this.update(rec);
  }

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
      this.schedule(rec, Infinity);
      rec.out = false;
      // Harm from someone takes the blame over starving or drowning, whether it was a blow or a buff they left on it.
      const by = this.pendingBy !== 0 ? this.pendingBy : ex && ex.health < 0 ? ex.by : 0;
      // What struck the last blow is the cause. Only a death no blow caused is drowning, starving or thirst.
      this.onDeath?.(rec, this.pendingCause !== 0 ? this.pendingCause : by !== 0 ? CAUSE_KILLED : airless ? CAUSE_DROWNED : starved ? CAUSE_STARVED : parched ? CAUSE_THIRST : CAUSE_KILLED, by);
      return;
    }
    if (paused) {
      v.rate.fill(0);
      this.schedule(rec, Infinity);
      return;
    }
    // Each rule multiplies a rate that content sets.
    const rules = this.rules;
    const person = rec.kind === this.survivor;
    const tamed = rec.team !== 0;
    const hunger = !rules ? 1 : person ? rules.num("PlayerCharacterFoodDrainMultiplier") : rules.num("DinoCharacterFoodDrainMultiplier") * rules.num(tamed ? "TamedDinoCharacterFoodDrainMultiplier" : "WildDinoCharacterFoodDrainMultiplier");
    const thirst = rules && person ? rules.num("PlayerCharacterWaterDrainMultiplier") : 1;
    const mending = !rules ? 1 : rules.num(person ? "PlayerCharacterHealthRecoveryMultiplier" : "DinoCharacterHealthRecoveryMultiplier");
    const waking = !rules || person ? 1 : rules.num(tamed ? "TamedDinoTorporDrainMultiplier" : "WildDinoTorporDrainMultiplier");
    // An unconscious creature that can be tamed hungers at ARK's rate for that, which is fast.
    // A young one hungers many times as fast as a grown one, less so the more grown it is.
    const step = growthStep(rec.span, rec.grown, tick);
    const eaten = !eats ? 0 : step < GROWN ? ((def.food!.perHour * MICRO * youngHunger(step)) / GAME_HOUR_TICKS) * (rules ? rules.num("BabyFoodConsumptionSpeedMultiplier") : 1) : rec.out && def.taming ? (proneHunger(def.taming) * MICRO) / TICK_RATE : (def.food!.perHour * MICRO) / GAME_HOUR_TICKS;
    v.rate[V_FOOD] = eats ? -scaled(eaten, hunger) : 0;
    v.rate[V_WATER] = drinks ? -scaled((def.waterPerHour! * MICRO) / GAME_HOUR_TICKS, thirst) : 0;
    v.rate[V_OXYGEN] = breathes ? (under ? -OXYGEN_DRAIN : OXYGEN_REFILL) : 0;
    const god = this.gods.has(rec.pid);
    const harm = god ? 0 : (starved ? STARVE : 0) + (parched ? THIRST : 0) + (airless ? DROWN : 0);
    // Extra rates add to that. A god takes the good of them and none of the harm.
    const acting = ex ? (god && ex.health < 0 ? 0 : ex.health) : 0;
    v.rate[V_HEALTH] = (harm > 0 ? -harm : scaled(HEALTH_REGEN, mending)) + acting;

    // At maximum torpor the body goes out, and stays out until torpor reaches 0.
    let wentOut = false;
    let cameRound = false;
    if (v.max[V_TORPOR]! > 0) {
      if (!rec.out && v.value[V_TORPOR]! >= v.max[V_TORPOR]!) rec.out = wentOut = true;
      else if (rec.out && v.value[V_TORPOR]! <= 0) {
        rec.out = false;
        cameRound = true;
      }
      // While a dose is active it is the whole rate, and the body shakes nothing off.
      const dose = ex ? ex.torpor : 0;
      const net = dose > 0 ? dose : -scaled((torporDrain(def, rec.genome) * MICRO) / TICK_RATE, waking);
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
    // Other deadlines: torpor reaching its maximum, and health crossing INJURED either way.
    if (v.rate[V_TORPOR]! > 0 && !rec.out) next = Math.min(next, v.fullTick(V_TORPOR));
    if (injured && v.rate[V_HEALTH]! > 0) next = Math.min(next, v.riseTick(V_HEALTH, INJURED));
    else if (!injured && v.rate[V_HEALTH]! < 0 && v.max[V_HEALTH]! > INJURED) next = Math.min(next, v.tick + Math.floor((v.value[V_HEALTH]! - INJURED) / -v.rate[V_HEALTH]!) + 1);
    this.schedule(rec, next);
    // The hooks may read this record's vitals, so they run after everything above is settled.
    if (wentOut || cameRound) this.onOut?.(rec, rec.out);
    if (injured !== wasInjured) this.onInjured?.(rec, injured);
  }
}
