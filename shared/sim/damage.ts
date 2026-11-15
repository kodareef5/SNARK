// Every hit goes through resolveDamage. A rule that changes damage is another factor here, never a branch at a call site.

import type { DamageType } from "../content/defs.ts";

export const DAMAGE_TYPES: readonly DamageType[] = ["melee", "pierce", "bullet", "fire", "explosive"];
export const DMG_MELEE = 0;
export const DMG_PIERCE = 1;
export const DMG_BULLET = 2;
export const DMG_FIRE = 3;
export const DMG_EXPLOSIVE = 4;
export const DMG_COUNT = 5;

/** A piece covers a fifth of the body, so a hit on its part meets five times its rating. A full set of one kind stops the same either way. */
export const PIECE_SCALE = 5;
/** Armor loses one use for every this many points of damage it stops. */
export const WEAR_PER_USE = 16;
/**
 * An arrow from an undrawn bow does this share of its damage, rising evenly to all of it at a full draw. ARK's patch 190.0
 * "Raised minimum wooden bow damage for shortest-pulled arrows to 50%, up from 25%" (Bow), the 25% being Base Damage's
 * share at no draw. So the shortest pull that looses, a quarter of the draw (0.3 s of 1.2 s), does 62.5%. The slingshot
 * shares it (DEV124).
 */
export const DRAW_MIN = 0.5;

/**
 * The share of its damage a round keeps `metres` from where it left: all of it out to `full`, falling evenly to none at
 * `none`, and none beyond. A round whose `none` is 0 does not fall off. ARK's shotgun "lacks any sort of long-range
 * capabilities" (Shotgun); its numbers are ours (DEV132).
 */
export function falloff(metres: number, full: number, none: number): number {
  if (!(none > 0) || metres <= full) return 1;
  if (metres >= none) return 0;
  return (none - metres) / (none - full);
}

/** The input. Set every field. `resetHit` puts each at no effect. */
export const hit = {
  /** At primitive quality. */
  base: 0,
  /** DMG_*. */
  type: DMG_MELEE,
  quality: 1,
  /** How far a bow was drawn, 0 to 1. 1 for anything else. */
  draw: 1,
  /** The attacker's melee stat for a blow, and its buffs. */
  attack: 1,
  /** The share of its damage a round keeps at the distance it hit from, 0 to 1 (`falloff`). 1 for anything that does not fall off. */
  far: 1,
  /** The victim species' multiplier for this type. */
  takes: 1,
  /** The multiplier of the zone hit. */
  zone: 1,
  /** The rating, already scaled (see PIECE_SCALE). */
  armor: 0,
  /** The victim's buffs, and the server's rule for this pairing. */
  resist: 1,
  rule: 1,
  /** Multiples of the damage done, at once and over time. */
  torporInstant: 0,
  torporOver: 0,
};

export const harm = {
  health: 0,
  /** Damage the armor stopped, and the uses that costs it. */
  blocked: 0,
  wear: 0,
  /** torporOver is spread over the ammunition's seconds. */
  torpor: 0,
  torporOver: 0,
};

export function resetHit(): void {
  hit.base = 0;
  hit.type = DMG_MELEE;
  hit.quality = hit.draw = hit.attack = hit.far = hit.takes = hit.zone = hit.resist = hit.rule = 1;
  hit.armor = 0;
  hit.torporInstant = hit.torporOver = 0;
}

export function resolveDamage(): void {
  const draw = hit.draw >= 1 ? 1 : DRAW_MIN + (1 - DRAW_MIN) * (hit.draw > 0 ? hit.draw : 0);
  const raw = hit.base * hit.quality * draw * hit.attack * hit.far * hit.takes * hit.zone * hit.resist * hit.rule;
  const armor = hit.armor > 0 ? hit.armor : 0;
  const through = raw > 0 ? (raw * 100) / (100 + armor) : 0;
  harm.health = through;
  harm.blocked = raw > 0 ? raw - through : 0;
  harm.wear = harm.blocked > 0 ? Math.ceil(harm.blocked / WEAR_PER_USE) : 0;
  harm.torpor = through * hit.torporInstant;
  harm.torporOver = through * hit.torporOver;
}
