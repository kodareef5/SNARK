// Survivors reeling from blows (shared/sim/react.ts sorts them, shared/anim/reactions.ts draws them). A stagger sets the
// body's reaction word, which every client and every rewound shot poses alike, shoves it, and takes most of its hold on
// its speed for a moment (Body.reactTicks), which its own client predicts once told. A second stagger while it still reels
// knocks it down. Once a reaction ends the body cannot be staggered again for a few seconds, so blows cannot chain it.

import { TICK_RATE } from "../shared/coords.ts";
import { packReact, reactAge, reactFrames, reactBand, reactKind, REACT_FALL, REACT_HEAVY, REACT_HIPS, REACT_STAGGER } from "../shared/anim/reactions.ts";
import { REACT_RULES, TIER_BUMP, TIER_FALL, TIER_NONE, TIER_STAGGER, dirOf, strengthOf, tierOf, type ReactRules } from "../shared/sim/react.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { MODE_WALK } from "../shared/sim/character.ts";
import type { ServerWorld } from "./world.ts";

/** The most a stagger adds to a body's speed, metres a second, so a late client's correction stays small. */
export const SHOVE_MOST = 1.5;
/** Seconds after a reaction ends that the body cannot be staggered again. */
const CALM_SECONDS = 3;
/** Points of damage worth one metre a second of a body's speed: a blow or bite, and a blast. A shot is worth none. */
const MELEE_DAMAGE_PER_DV = 16;
const BLAST_DAMAGE_PER_DV = 12;

export interface ReactionsContext {
  readonly world: ServerWorld;
  /** Whether body `e` may take a reaction now: a living survivor on its feet, not seated, carried or lying. */
  readonly standing: (e: number) => boolean;
  /** The thresholds, from settings. */
  readonly rules?: () => ReactRules;
}

export class Reactions {
  private readonly ctx: ReactionsContext;
  /** Bodies with a reaction word, and the tick each may be staggered again. */
  private readonly reeling = new Set<number>();
  private readonly calmUntil = new Map<number, number>();
  readonly stats = { staggers: 0, escalated: 0, calmed: 0, toppled: 0 };

  constructor(ctx: ReactionsContext) {
    this.ctx = ctx;
  }

  /**
   * Body `e` takes a change of speed of `dv` m/s along the unit (dx, dz), struck `up` metres above its feet, by someone to
   * blame or not. Returns the tier it took: a fall is the caller's to start (server/falls.ts).
   */
  shove(e: number, dv: number, dx: number, dz: number, up: number, attributed: boolean): number {
    const { world } = this.ctx;
    const ents = world.ents, tick = world.tick;
    if (!this.ctx.standing(e)) return TIER_NONE;
    const rules = this.ctx.rules?.() ?? REACT_RULES;
    let tier = tierOf(dv, attributed, rules);
    if (tier !== TIER_STAGGER) return tier;
    const word = ents.react[e]!;
    if (word !== 0 && reactAge(word, tick) < reactFrames(word)) {
      // Already down by its reaction, it stays down; still reeling, it goes down.
      if (reactKind(word) === REACT_FALL) return TIER_NONE;
      this.stats.escalated++;
      return TIER_FALL;
    }
    if (tick < (this.calmUntil.get(e) ?? 0)) {
      this.stats.calmed++;
      return TIER_BUMP;
    }
    const strength = strengthOf(dv, rules);
    const kind = strength >= 2 ? REACT_HEAVY : REACT_STAGGER;
    ents.react[e] = packReact(kind, tick, dirOf(ents.yaw[e]!, dx, dz), reactBand(up), strength);
    ents.reactTicks[e] = reactFrames(ents.react[e]!);
    const shove = Math.min(SHOVE_MOST, dv * 0.4);
    ents.vx[e] = ents.vx[e]! + dx * shove;
    ents.vz[e] = ents.vz[e]! + dz * shove;
    world.history.reacted(e);
    this.reeling.add(e);
    this.calmUntil.set(e, tick + reactFrames(ents.react[e]!) + CALM_SECONDS * TICK_RATE);
    this.stats.staggers++;
    tier = TIER_STAGGER;
    return tier;
  }

  /**
   * A hurting blow on body `e` (server/combat.ts impact): a melee blow or bite (`blast` false) or a blast, `taken` points,
   * going the unit way (dx, dz), landing `up` metres above its feet. Its change of speed grows with the damage.
   */
  blow(e: number, blast: boolean, taken: number, dx: number, dz: number, up: number): number {
    return this.shove(e, taken / (blast ? BLAST_DAMAGE_PER_DV : MELEE_DAMAGE_PER_DV), dx, dz, up, true);
  }

  /**
   * Knocks body `e` down where no ragdoll may fall for it (server/falls.ts refused): it topples the way it moves, lies a
   * while and gets up, posed from its reaction word alone (REACT_FALL). Returns the seconds it lasts.
   */
  topple(e: number): number {
    const { world } = this.ctx;
    const ents = world.ents, tick = world.tick;
    const vx = ents.vx[e]!, vz = ents.vz[e]!, flat = Math.sqrt(vx * vx + vz * vz);
    const dir = flat > 1e-6 ? dirOf(ents.yaw[e]!, vx / flat, vz / flat) : 0;
    ents.react[e] = packReact(REACT_FALL, tick, dir, REACT_HIPS, 0);
    ents.reactTicks[e] = reactFrames(ents.react[e]!);
    world.history.reacted(e);
    this.reeling.add(e);
    this.calmUntil.set(e, tick + reactFrames(ents.react[e]!) + CALM_SECONDS * TICK_RATE);
    this.stats.toppled++;
    return reactFrames(ents.react[e]!) / TICK_RATE;
  }

  /** Ends body `e`'s reaction now: it died, sat, swam or fell. */
  end(e: number): void {
    const ents = this.ctx.world.ents;
    if (ents.react[e] === 0 && ents.reactTicks[e] === 0) return;
    ents.react[e] = 0;
    ents.reactTicks[e] = 0;
    this.reeling.delete(e);
  }

  /** Once a tick: clears every reaction that is over or whose body can no longer reel. */
  step(): void {
    const { world } = this.ctx;
    const ents = world.ents, tick = world.tick;
    for (const e of this.reeling) {
      const word = ents.react[e]!;
      const gone = (ents.flags[e]! & F_ALIVE) === 0 || word === 0;
      if (gone || reactAge(word, tick) >= reactFrames(word) || !this.ctx.standing(e) || ents.mode[e] !== MODE_WALK) {
        if (!gone) ents.react[e] = 0;
        ents.reactTicks[e] = 0;
        this.reeling.delete(e);
      }
    }
    for (const [e, until] of this.calmUntil) if (tick >= until || (ents.flags[e]! & F_ALIVE) === 0) this.calmUntil.delete(e);
  }

  /** Whether body `e` may take a reaction now. */
  standing(e: number): boolean {
    return this.ctx.standing(e);
  }

  /** How many bodies reel now. */
  get count(): number {
    return this.reeling.size;
  }
}

export { TIER_BUMP, TIER_FALL, TIER_NONE, TIER_STAGGER };
