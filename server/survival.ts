// What a body's stats do to it. The server derives every number here and
// writes it into the body's columns; clients receive the result with their own
// body and never compute it, so prediction steps with the server's numbers.

import type { SpeciesDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { MF_WINDED, STAMINA_UNITS } from "../shared/sim/character.ts";
import type { EntityStore } from "../shared/sim/entities.ts";
import { STAT_NAMES, statValue, type Genome, type StatName } from "../shared/sim/genome.ts";

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

/**
 * Recompute the movement modifiers of entity `e` from its stat points: speed
 * on land, speed in water (from oxygen, as in the reference game), and the
 * stamina cap. Call after anything that changes the points.
 */
export function refreshMods(reg: Registry, ents: EntityStore, e: number, g: Genome | null): void {
  const def = reg.defs[ents.kind[e]!] as SpeciesDef;
  ents.speedQ[e] = ratioQ(def, g, STAT_SPEED);
  ents.swimQ[e] = ratioQ(def, g, STAT_OXYGEN);
  const max = Math.round(statOf(def, g, STAT_STAMINA, 100));
  ents.staminaMax[e] = max < 1 ? 1 : max > 65535 ? 65535 : max;
  if (ents.stamina[e]! > ents.staminaMax[e]! * STAMINA_UNITS) ents.stamina[e] = ents.staminaMax[e]! * STAMINA_UNITS;
  // Restrictions the server sets are recomputed here; being winded belongs to the step.
  ents.mflags[e] = ents.mflags[e]! & MF_WINDED;
}
