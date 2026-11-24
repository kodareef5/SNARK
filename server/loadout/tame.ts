// A tame handed over in a soul ball: a creature record made at its level, its owner's tribe's, kept with no body yet, and
// a full ball that names it. From then on it is a kept tame as any other (server/balls.ts): nothing marks where it came from.

import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Rng } from "../../shared/rng.ts";
import { rollWild } from "../../shared/sim/genome.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../shared/sim/items.ts";
import type { Items } from "../items.ts";
import type { EntityRecord, Records } from "../records.ts";
import type { ServerWorld } from "../world.ts";

export interface TameContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  /** Draws each tame's wild points, colours and sex. */
  readonly rng: Rng;
}

/** Why no tame was given. */
export const NOT_A_CREATURE = "not a creature";
export const NO_BALL = "the game has no soul ball";
export const NO_ROOM = "no room for its ball";
export const REFUSED = "its ball was refused";

/** The first full soul ball content has, or 0. */
function fullBall(reg: Registry): number {
  for (let k = 1; k < reg.defs.length; k++) if (reg.ballEmpty[k] !== 0) return k;
  return 0;
}

/** The first empty hotbar slot where `hotbar` asks, else the first empty bag slot, or -1. */
function slotFor(inv: Inventory, hotbar: boolean): number {
  if (hotbar && inv.hotbar >= 0) for (let s = inv.hotbar; s < inv.hotbar + HOTBAR_SLOTS; s++) if (inv.item[s] === 0) return s;
  return inv.free();
}

/**
 * A new creature of species `kind` at exactly `level`, tamed as a forced tame is, of `owner`'s tribe, and kept where
 * `owner` stands. It has no body and no vitals until it is first loosed. The caller names it in a ball, or deletes it.
 */
export function keptTame(ctx: TameContext, owner: EntityRecord, kind: number, level: number, saddled: boolean): EntityRecord {
  const { world, records } = ctx;
  const reg = world.reg;
  const p = records.create(kind);
  p.genome = rollWild(ctx.rng, level, reg.colorSet[kind]!);
  p.team = owner.team;
  p.te = 0;
  // Worn as a saddle put on through its inventory is: out of the ledger until it is taken off.
  p.saddle = saddled ? Math.max(0, reg.saddleFits.indexOf(kind)) : 0;
  // Where a load sets it, should no ball name it then (Balls.resume).
  const e = records.entOf.get(owner.pid);
  const ents = world.ents;
  p.x = e !== undefined ? ents.x[e]! : owner.x;
  p.y = e !== undefined ? ents.y[e]! : owner.y;
  p.z = e !== undefined ? ents.z[e]! : owner.z;
  p.stored = Math.max(1, world.tick);
  records.dirty.add(p.pid);
  return p;
}

/**
 * Gives `owner` a full soul ball that names a new kept tame, on its hotbar or in its bag as `place` says, and in the bag
 * where the hotbar is full. A module is asked about the ball with the reason `why`. Returns the tame, or why none was
 * made: nothing is changed then.
 */
export function giveTame(ctx: TameContext, owner: EntityRecord, kind: number, level: number, saddled: boolean, place: "hotbar" | "bag", why = "loadout"): EntityRecord | string {
  const { world, records, items } = ctx;
  const reg = world.reg;
  const def = reg.defs[kind];
  if (def?.type !== "species" || (def as SpeciesDef).class !== "creature" || reg.vehicle[kind]) return NOT_A_CREATURE;
  const full = fullBall(reg);
  if (full === 0) return NO_BALL;
  const slot = slotFor(items.inv(owner), place === "hotbar");
  if (slot < 0) return NO_ROOM;
  const tame = keptTame(ctx, owner, kind, level, saddled);
  if (items.mintRef(owner, full, tame.pid, slot, why) < 0) {
    records.delete(tame.pid);
    return REFUSED;
  }
  return tame;
}
