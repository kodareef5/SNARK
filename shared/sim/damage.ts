// What a hit does: one function, and nothing else decides.
//
// Every hit, whatever made it, goes through `resolveDamage`: a punch, an
// arrow, a rifle round, later a creature's bite and a grenade's blast. The
// caller gathers the numbers (it knows the weapon, the victim, the armor on the
// part hit); the function multiplies them in one fixed order and says what the
// victim loses, what the armor is worn by, and how much torpor follows. A rule
// that changes damage is another factor here, never a branch at a call site.
//
// The order:
//   1. the weapon: base damage, times its quality, times how far a bow was
//      drawn, times the attacker's own multiplier (its melee stat, its buffs)
//   2. the kind of damage: what the victim's species makes of it
//   3. where it landed: the zone's multiplier (a head counts for more)
//   4. armor: 100 / (100 + rating), the rating being that of the piece over the
//      part hit, times five, for anything aimed, and of everything worn for
//      harm that is not
//   5. the victim's own multiplier (its buffs), and the server's rules
//
// Armor is worn by what it stops: one use for every `WEAR_PER_USE` points.

import type { DamageType } from "../content/defs.ts";

export const DAMAGE_TYPES: readonly DamageType[] = ["melee", "pierce", "bullet", "fire", "explosive"];
export const DMG_MELEE = 0;
export const DMG_PIERCE = 1;
export const DMG_BULLET = 2;
export const DMG_FIRE = 3;
export const DMG_EXPLOSIVE = 4;
export const DMG_COUNT = 5;

/** A piece of armor covers a fifth of the body, and a hit on its part is met by five times its rating: a full set of one kind stops the same either way. */
export const PIECE_SCALE = 5;
/** Points of damage stopped per use of the armor that stopped them. */
export const WEAR_PER_USE = 16;
/** A bow let go undrawn gives its arrow this share of its damage; fully drawn, all of it. */
export const DRAW_MIN = 0.25;

/** What goes in. Set every field; `resetHit` puts them at "no effect". */
export const hit = {
  /** Damage of the weapon or the round at primitive quality. */
  base: 0,
  /** DMG_*. */
  type: DMG_MELEE,
  /** The weapon's quality multiplier. */
  quality: 1,
  /** How far a bow was drawn, 0 to 1. Anything else: 1. */
  draw: 1,
  /** The attacker's multiplier: its melee stat for a blow, its buffs. */
  attack: 1,
  /** What the victim's species takes of this type. */
  takes: 1,
  /** The multiplier of the zone hit. */
  zone: 1,
  /** The armor rating that meets it, already scaled (see PIECE_SCALE). */
  armor: 0,
  /** The victim's multiplier (its buffs) and the server's rule for this pairing. */
  resist: 1,
  rule: 1,
  /** Torpor as multiples of the damage done: at once, and over time. */
  torporInstant: 0,
  torporOver: 0,
};

/** What comes out. */
export const harm = {
  /** Health the victim loses. */
  health: 0,
  /** Damage the armor stopped, and the uses that costs it. */
  blocked: 0,
  wear: 0,
  /** Torpor at once, and torpor to spread over the ammunition's seconds. */
  torpor: 0,
  torporOver: 0,
};

export function resetHit(): void {
  hit.base = 0;
  hit.type = DMG_MELEE;
  hit.quality = hit.draw = hit.attack = hit.takes = hit.zone = hit.resist = hit.rule = 1;
  hit.armor = 0;
  hit.torporInstant = hit.torporOver = 0;
}

/** Work out `harm` from `hit`. */
export function resolveDamage(): void {
  const draw = hit.draw >= 1 ? 1 : DRAW_MIN + (1 - DRAW_MIN) * (hit.draw > 0 ? hit.draw : 0);
  const raw = hit.base * hit.quality * draw * hit.attack * hit.takes * hit.zone * hit.resist * hit.rule;
  const armor = hit.armor > 0 ? hit.armor : 0;
  const through = raw > 0 ? (raw * 100) / (100 + armor) : 0;
  harm.health = through;
  harm.blocked = raw > 0 ? raw - through : 0;
  harm.wear = harm.blocked > 0 ? Math.ceil(harm.blocked / WEAR_PER_USE) : 0;
  harm.torpor = through * hit.torporInstant;
  harm.torporOver = through * hit.torporOver;
}
