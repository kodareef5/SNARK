// Temporary, authoritative creature traits. Inventories keep their actual items; nearby threats and slows change
// derived numbers only. The host combines these with buffs and owns Survival's ratio-preserving maximum-health hook.
import { CUE_RIVALRY } from "../shared/anim/pose.ts";
import type { Registry } from "../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { F_ALIVE, F_AWAKE, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { type ItemTable, FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** A species' reduction applies only to ordinary loose stacks, never to a blueprint, loaded round or attachment. */
export function inventoryEffectiveWeight(reg: Registry, rec: EntityRecord, table: ItemTable = reg): number {
  const inv = rec.inv;
  if (!inv) return 0;
  let weight = inv.weight(table);
  const reductions = reg.combat[rec.kind]?.weight;
  if (!reductions?.length) return weight;
  for (let slot = 0; slot < inv.cap; slot++) {
    const item = inv.item[slot]!;
    if (item === 0 || reg.stack[item]! <= 1 || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) continue;
    const reduction = reductions.find((r) => r.item === reg.ids[item]);
    if (reduction) weight -= table.weight[item]! * inv.count[slot]! * (1 - reduction.mult);
  }
  return Math.max(0, weight);
}

export interface CreatureTraitsContext {
  readonly world: ServerWorld;
  readonly records: Records;
  /** Recompute derived movement and visible state. Called only when an effective trait changes. */
  readonly refresh: (rec: EntityRecord) => void;
  /** Rivalry already has its new state when called. Survival must preserve the health fraction, not refill. */
  readonly healthChanged?: (rec: EntityRecord, previous: number, next: number) => void;
  /** Same nonzero team is always friendly. This can add alliances when the host supports them. */
  readonly allied?: (team: number, other: number) => boolean;
}

interface BodyRef { readonly rec: EntityRecord; readonly entity: number; readonly generation: number }
interface Rivalry extends BodyRef { next: number; active: boolean }
interface Slow { multiplier: number; until: number }
interface Slowed extends BodyRef { readonly effects: Slow[]; applied: number }

/** As with ordinary buffs, one body cannot accumulate an unbounded number of effect strengths. Keep the strongest. */
const MAX_SLOW_TIERS = 16;

export class CreatureTraits {
  private readonly ctx: CreatureTraitsContext;
  private readonly rivals = new Map<number, Rivalry>();
  private readonly slows = new Map<number, Slowed>();
  /** Diagnostic count of actual proximity queries, not of the cheap active-list checks. */
  checks = 0;

  constructor(ctx: CreatureTraitsContext) { this.ctx = ctx; }

  /** A currently simulated, live body. A sleeping creature sheds temporary traits; a player need not be F_AWAKE. */
  private entity(rec: EntityRecord): number {
    const { world, records } = this.ctx, e = records.entOf.get(rec.pid);
    if (rec.dead || records.byPid.get(rec.pid) !== rec || e === undefined || world.ents.pid[e] !== rec.pid) return -1;
    const flags = world.ents.flags[e]!;
    return (flags & F_ALIVE) !== 0 && (flags & (F_AWAKE | F_PLAYER)) !== 0 ? e : -1;
  }

  private current(ref: BodyRef): boolean {
    return this.entity(ref.rec) === ref.entity && this.ctx.world.ents.gen[ref.entity] === ref.generation;
  }

  private refresh(rec: EntityRecord): void {
    if (!rec.dead && this.ctx.records.byPid.get(rec.pid) === rec) this.ctx.refresh(rec);
  }

  private changed(state: Rivalry, active: boolean): void {
    if (state.active === active) return;
    const health = this.ctx.world.reg.combat[state.rec.kind]?.rivalry?.health ?? 1;
    const previous = state.active ? health : 1, next = active ? health : 1;
    state.active = active;
    const { world } = this.ctx, ents = world.ents, e = state.entity;
    // Clear it on sleep too, while keeping a recycled slot or the replacement corpse untouched.
    if (ents.pid[e] === state.rec.pid && ents.gen[e] === state.generation) {
      const cue = ents.cue[e]!;
      ents.cue[e] = active ? cue | CUE_RIVALRY : cue & ~CUE_RIVALRY;
      world.history.cued(e);
    }
    if (!state.rec.dead && this.ctx.records.byPid.get(state.rec.pid) === state.rec && previous !== next) this.ctx.healthChanged?.(state.rec, previous, next);
    this.refresh(state.rec);
  }

  /** Root calls once a tick with Creatures.awake and awakeCount. No scan over the entity store's unused capacity. */
  step(active: ArrayLike<number>, count: number): void {
    const { world, records } = this.ctx, tick = world.tick, ents = world.ents;
    for (const [pid, state] of this.rivals) {
      if (this.current(state) && !state.rec.out && world.reg.combat[state.rec.kind]?.rivalry) continue;
      this.changed(state, false);
      this.rivals.delete(pid);
    }
    for (const [pid, state] of this.slows) {
      if (!this.current(state)) {
        this.slows.delete(pid);
        if (state.applied !== 1) this.refresh(state.rec);
        continue;
      }
      for (let i = state.effects.length - 1; i >= 0; i--) if (state.effects[i]!.until <= tick) state.effects.splice(i, 1);
      const multiplier = this.slowValue(state);
      if (!state.effects.length) this.slows.delete(pid);
      if (multiplier !== state.applied) { state.applied = multiplier; this.refresh(state.rec); }
    }
    for (let i = 0; i < count; i++) {
      const e = active[i]!;
      if (!world.reg.combat[ents.kind[e]!] ?.rivalry) continue;
      const rec = records.byPid.get(ents.pid[e]!);
      if (!rec || rec.out || this.entity(rec) !== e || !world.reg.combat[rec.kind]?.rivalry) continue;
      let state = this.rivals.get(rec.pid);
      if (!state) {
        state = { rec, entity: e, generation: ents.gen[e]!, active: false, next: tick };
        this.rivals.set(rec.pid, state);
      }
      if (tick < state.next) continue;
      // First contact is immediate; later checks spread by pid across the second instead of polling a herd together.
      state.next = tick + TICK_RATE - ((tick - rec.pid % TICK_RATE) % TICK_RATE + TICK_RATE) % TICK_RATE;
      this.checks++;
      this.changed(state, this.threatened(rec, e));
    }
  }

  private threatened(rec: EntityRecord, e: number): boolean {
    const { world, records, allied } = this.ctx, { reg, ents, dims } = world;
    const rival = reg.combat[rec.kind]!.rivalry!;
    const x = ents.x[e]!, y = ents.y[e]!, z = ents.z[e]!, radius = rival.distance;
    const minX = Math.max(0, Math.floor((x - radius) / CHUNK_SIZE)), maxX = Math.min(dims.chunksX - 1, Math.floor((x + radius) / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor((z - radius) / CHUNK_SIZE)), maxZ = Math.min(dims.chunksZ - 1, Math.floor((z + radius) / CHUNK_SIZE));
    for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
      for (let other = ents.chunkHead[cz * dims.chunksX + cx]!; other >= 0; other = ents.next[other]!) {
        // Corpses keep their species on the wire so clients can draw its native ragdoll.
        if (other === e || (ents.flags[other]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
        const kind = ents.kind[other]!, def = reg.defs[kind];
        if (def?.type !== "species" || def.class !== "creature" || def.temper !== "hunts" || reg.drag[kind]! < rival.minThreatDrag) continue;
        const target = records.byPid.get(ents.pid[other]!);
        if (!target || target.dead || target.out) continue;
        if (rec.team !== 0 && target.team !== 0 && (rec.team === target.team || allied?.(rec.team, target.team))) continue;
        const dx = ents.x[other]! - x, dy = ents.y[other]! - y, dz = ents.z[other]! - z;
        if (dx * dx + dy * dy + dz * dz <= radius * radius) return true;
      }
    }
    return false;
  }

  /** Independent strengths retain their own expiry; a weak long hit cannot prolong a strong short slow. */
  applySlow(rec: EntityRecord, multiplier: number, seconds: number): boolean {
    const e = this.entity(rec), { world } = this.ctx;
    if (e < 0 || !(multiplier >= .05 && multiplier < 1) || !(seconds >= .1 && seconds <= 60)) return false;
    let state = this.slows.get(rec.pid);
    if (state && !this.current(state)) { this.slows.delete(rec.pid); state = undefined; }
    if (!state) {
      state = { rec, entity: e, generation: world.ents.gen[e]!, effects: [], applied: 1 };
      this.slows.set(rec.pid, state);
    }
    for (let i = state.effects.length - 1; i >= 0; i--) if (state.effects[i]!.until <= world.tick) state.effects.splice(i, 1);
    const until = world.tick + Math.max(1, Math.ceil(seconds * TICK_RATE));
    const prior = state.effects.find((effect) => effect.multiplier === multiplier);
    if (prior) prior.until = Math.max(prior.until, until);
    else {
      state.effects.push({ multiplier, until });
      if (state.effects.length > MAX_SLOW_TIERS) {
        let weakest = 0;
        for (let i = 1; i < state.effects.length; i++) if (state.effects[i]!.multiplier > state.effects[weakest]!.multiplier) weakest = i;
        state.effects.splice(weakest, 1);
      }
    }
    const speed = this.slowValue(state);
    if (speed !== state.applied) { state.applied = speed; this.refresh(rec); }
    return true;
  }

  private slowValue(state: Slowed): number {
    let multiplier = 1;
    for (const effect of state.effects) if (effect.until > this.ctx.world.tick) multiplier = Math.min(multiplier, effect.multiplier);
    return multiplier;
  }

  speedOf(rec: EntityRecord): number {
    const state = this.slows.get(rec.pid);
    return state && state.rec === rec && this.current(state) ? this.slowValue(state) : 1;
  }

  private rivalry(rec: EntityRecord) {
    const state = this.rivals.get(rec.pid);
    return state && state.rec === rec && state.active && !rec.out && this.current(state) ? this.ctx.world.reg.combat[rec.kind]?.rivalry : undefined;
  }

  damageOf(rec: EntityRecord): number { return this.rivalry(rec)?.damage ?? 1; }
  takenOf(rec: EntityRecord): number { return this.rivalry(rec)?.resistance ?? 1; }
  healthOf(rec: EntityRecord): number { return this.rivalry(rec)?.health ?? 1; }

  /** Optional eager lifecycle cleanup; step also removes stale generations and records without a callback. */
  remove(rec: EntityRecord): void {
    const rival = this.rivals.get(rec.pid);
    if (rival?.rec === rec) { this.changed(rival, false); this.rivals.delete(rec.pid); }
    const slow = this.slows.get(rec.pid);
    if (slow?.rec === rec) { this.slows.delete(rec.pid); if (slow.applied !== 1) this.refresh(rec); }
  }
}
