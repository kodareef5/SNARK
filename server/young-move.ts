import { youngScale } from "../shared/sim/breeding.ts";
import type { MoveParams } from "../shared/sim/character.ts";
import { copyMoveSize, type SizedMove } from "../shared/sim/move-size.ts";
import type { EntityStore } from "../shared/sim/entities.ts";
import type { ServerWorld } from "./world.ts";

interface Variant { tick: number; span: number; grown: number; move: SizedMove; }
interface Entry { gen: number; variants: Map<MoveParams, Variant>; }
const cached = new WeakMap<EntityStore, Map<number, Entry>>();

/** The same continuous scale used by native drawing and posed creature contact geometry. */
export function creatureSize(world: ServerWorld, e: number): number {
  const ents = world.ents;
  return ents.grown[e] ? youngScale(world.reg.birthScale[ents.kind[e]!]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
}

/** Young cannot be ridden. Their authoritative movement, path clearance and breathing use the same size as drawing. */
export function youngMove(world: ServerWorld, e: number, base: MoveParams): MoveParams {
  const ents = world.ents, grown = ents.grown[e]!;
  let bodies = cached.get(ents);
  if (grown === 0 || grown <= world.tick) { bodies?.delete(e); return base; }
  if (!bodies) { bodies = new Map(); cached.set(ents, bodies); }
  let entry = bodies.get(e);
  if (!entry || entry.gen !== ents.gen[e]) { entry = { gen: ents.gen[e]!, variants: new Map() }; bodies.set(e, entry); }
  let variant = entry.variants.get(base);
  if (!variant) {
    // At most wild/tamed and their unmounted flight variants; new tuning definitions replace obsolete copies.
    if (entry.variants.size >= 4) entry.variants.clear();
    variant = { tick: -1, span: 0, grown: 0, move: { ...base } }; entry.variants.set(base, variant);
  }
  const span = ents.span[e]!;
  if (variant.tick !== world.tick || variant.span !== span || variant.grown !== grown) {
    copyMoveSize(variant.move, base, creatureSize(world, e));
    variant.tick = world.tick; variant.span = span; variant.grown = grown;
  }
  return variant.move;
}

/** Destruction/recycling drops all variants immediately; a sleeping live young can reuse its bounded copies. */
export function forgetYoungMove(world: ServerWorld, e: number): void { cached.get(world.ents)?.delete(e); }
