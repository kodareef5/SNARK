// Weapons and what they fire. A weapon is an item, so its definition is an ItemDef and its class a row of items.ts. What
// is here is the weapon and ammo facets: their shape, what is wrong with one, and the columns for them.

import { TICK_RATE } from "../../coords.ts";
import { DAMAGE_TYPES } from "../../sim/damage.ts";
import { HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_SPEAR, HOLD_THROW, HOLD_TOOL, SWING_TICKS, W_BOW, W_GUN, W_MELEE, W_THROWN, type WeaponParams } from "../../sim/weapon.ts";
import type { Content } from "../defs.ts";
import { f, f32, f64, paletteIndex, u16, u32, u8, type Checking, type Fields, type Kind } from "../kind.ts";
import type { Registry } from "../registry.ts";
import type { DamageType } from "./damage.ts";
import type { ItemDef } from "./items.ts";
import { MAX_BURN_SECONDS } from "./stations.ts";

/** Default reach of a melee weapon, in metres. */
const MELEE_REACH = 2.6;
/** The longest any weapon timing may be, in ticks, which is what a body's act counter holds. */
const MAX_ACT_TICKS = 250;

/** What an item that is a weapon or is fired has besides. */
export interface WeaponFields {
  readonly weapon?: WeaponFacet;
  readonly ammo?: AmmoFacet;
}

export interface WeaponFacet {
  /**
   * "melee" strikes what is in reach. "bow" is drawn and loosed, and a longer draw gives a faster, harder shot.
   * "gun" fires what is loaded as it is (a crossbow is one). "thrown" is itself thrown.
   */
  readonly kind: "melee" | "bow" | "gun" | "thrown";
  /** Melee and thrown: damage of one hit at primitive quality, and its type. */
  readonly damage?: number;
  readonly type?: DamageType;
  /** Melee: reach from the eye, in metres. Defaults to 2.6. */
  readonly reach?: number;
  /** Melee: torpor a hit gives, as a multiple of the damage it does. Defaults to none. */
  readonly torpor?: number;
  /** Bow and gun: the ammunition items it takes, and what it multiplies their damage by. */
  readonly ammo?: readonly string[];
  readonly power?: number;
  /** Rounds it holds. Defaults to 1. */
  readonly clip?: number;
  /**
   * Seconds to reload (for a bow, to nock the next arrow), to draw a bow fully, and between two shots or swings. A thrown
   * weapon with a draw is a charged throw: held as a bow is drawn, it leaves on release, its draw how long it was held.
   */
  readonly reload?: number;
  readonly draw?: number;
  readonly interval?: number;
  /** Thrown: metres per second off the hand, seconds until it goes off, and how far its blast reaches in metres. */
  readonly speed?: number;
  readonly fuse?: number;
  readonly blast?: number;
  /** Uses before it breaks, at primitive quality. */
  readonly uses: number;
  /** Works under water. Melee does by default. */
  readonly wet?: boolean;
  /** Attachment items that fit it. */
  readonly fits?: readonly string[];
  /** Mesh held in the hand, and how the body holds it. */
  readonly mesh?: string;
  readonly hold: "tool" | "bow" | "rifle" | "pistol" | "spear";
  // Fire modes and the blow (planning/reference/weapons-plan.md, M4, built by W2). Omitted, a weapon fires once a press,
  // reloads its whole clip in one go and strikes with bare hands.
  /** Holding the primary button fires again every `interval`, as ARK's fabricated pistol and assault rifle do. */
  readonly auto?: boolean;
  /**
   * A reload loads one round each `reload` seconds (at most 4) until full, and a press of the primary button ends it after
   * the round under way, firing then if the button is still down.
   */
  readonly reloadEach?: boolean;
  /**
   * A bow's or gun's blow with the melee button: damage at primitive quality, torpor as a multiple of it, reach in metres
   * (2.6 where not given), and the seconds a blow takes (a swing's where not given). ARK's is 10 and 14 torpor (Base Damage).
   */
  readonly melee?: { readonly damage: number; readonly torpor?: number; readonly reach?: number; readonly interval?: number };
  // Where a shot goes (planning/reference/weapons-plan.md, M1 and M2, built by W1). Omitted, a shot goes along the look.
  /**
   * The cone a shot leaves within (shared/sim/aim.ts), as half angles in degrees: from the hip and aimed at rest, what a
   * sprint adds, what each shot adds, and the degrees a second it narrows back; and the degrees the aim sways through a
   * scope, standing. Our own numbers, as ARK publishes none (DEV128, DEV130).
   */
  readonly spread?: { readonly hip: number; readonly aim: number; readonly move?: number; readonly bloom?: number; readonly recover?: number; readonly sway?: number };
  /** The degrees of pitch each shot kicks the aim up, and the degrees a second that comes back. The server holds the kick (DEV129). */
  readonly recoil?: { readonly kick: number; readonly recover: number };
  /**
   * What its damage is multiplied by against a structure (W6, M8; D435). 1 where not given. ARK gives each explosive its own
   * damage to what is built beside its damage to bodies (Table of explosives): the grenade's 175 is 788 to wood, about 4.5.
   */
  readonly structures?: number;
  /**
   * A gun's rays a shot, in place of its round's `ammo.pellets` (W3): ARK's pump-action fires the same shells as the
   * double-barrel, 14 pellets to its 10 (Pump-Action Shotgun). Omitted, a shot sends its round's.
   */
  readonly pellets?: number;
  /**
   * W5: thrown, it bursts into a cloud: the prop/cloud it makes, the seconds the cloud lasts, and the buff it gives the bodies
   * inside it (none for smoke). The cloud reaches as far as its prop's radius.
   */
  readonly cloud?: { readonly prop: string; readonly seconds: number; readonly buff?: string };
}

export interface AmmoFacet {
  readonly damage: number;
  readonly type: DamageType;
  /** Metres per second at full power, and its fall in metres per second squared. Without a speed it arrives the tick it is fired. */
  readonly speed?: number;
  readonly gravity?: number;
  /** Torpor as multiples of the damage done: `instant` at once, then `over` spread across `seconds`. */
  readonly torpor?: { readonly instant: number; readonly over: number; readonly seconds: number };
  /** A buff id given to the target. */
  readonly buff?: string;
  /** Chance, 0 to 1, that a spent one can be picked up again. */
  readonly recover?: number;
  readonly mesh?: string;
  /**
   * A weapon loaded with it takes no attachment: loading it puts the one fitted in the bag, and nothing is fitted while it
   * is loaded. ARK's darts: loaded with them the Longneck "cannot use any attachments" (Longneck Rifle).
   */
  readonly bare?: boolean;
  // Shot (planning/reference/weapons-plan.md, M3, built by W3). Omitted, a round is one ray and keeps its damage at any range.
  /**
   * Rays one round with no speed sends, each inside its gun's cone and tested and landed alone, as a shotgun's pellets
   * ("Each pellet fired from a Shotgun has an individual collision check", Shotgun). The round's damage is a pellet's.
   * 1 where not given; a gun's `weapon.pellets` takes its place.
   */
  readonly pellets?: number;
  /** Its damage falls evenly from all of it at `full` metres to none at `none` (shared/sim/damage.ts `falloff`). */
  readonly falloff?: { readonly full: number; readonly none: number };
  // Built by W6 (M8, M12, and the flare of M9).
  /**
   * Where it ends (a body, the world, something built, water) it goes off as a grenade does, reaching this many metres; the
   * blast is the whole of its damage, so a body hit straight on is not harmed twice. The weapon's `structures` still counts.
   */
  readonly blast?: number;
  /** The share of armor, 0 to 1, it goes through (the metal arrow's "-90% armor bypass" is 0.9). */
  readonly pierce?: number;
  /**
   * A light it carries: reach in metres and a palette colour. Such a round flies as a prop every client draws, rises and
   * then sinks slowly, harms nothing and goes out where it lands (the flare). The light itself is rendering's to build (M9,
   * D436); until then the flare is its bright mesh.
   */
  readonly light?: { readonly reach: number; readonly color: number };
}

// The stubs inside the weapon and ammo facets are planning/reference/weapons-plan.md's, each flipped by its project.
export const WEAPON_FIELDS = {
  weapon: f("facet", "WeaponTemplate", {
    refs: { "ammo[]": "item", "fits[]": "item/attachment", "cloud.prop": "prop/cloud", "cloud.buff": "buff" },
    open: true,
  }),
  ammo: f("facet", "", { refs: { buff: "buff" } }),
} satisfies Fields<WeaponFields>;

/** What is wrong with an item's weapon and ammo facets. */
export function weaponFaults(d: ItemDef, { errors, positive }: Checking): void {
  const w = d.weapon;
  if (w) {
    positive(d, "weapon.uses", w.uses, 60000);
    // A thrown weapon with an ammo facet of its own flies and hits with that facet's damage, which may be none (the bola);
    // one that bursts into a cloud may do no harm of its own (smoke, poison: W5).
    // A soul ball is thrown, and harms nothing (ItemDef.ball).
    if ((w.kind === "melee" || (w.kind === "thrown" && !d.ammo && !w.cloud && !d.ball)) && !(w.damage! > 0 && w.type)) errors.push(`${d.id}: a ${w.kind} weapon needs damage and a type`);
    if (d.ammo && !(w.kind === "thrown" && d.ammo.speed !== undefined)) errors.push(`${d.id}: a weapon with an ammo facet of its own is thrown, and flies at its ammo.speed`);
    if (d.ammo && w.fuse !== undefined) errors.push(`${d.id}: a thrown weapon that flies and hits has no fuse`);
    if ((w.kind === "bow" || w.kind === "gun") && !(w.ammo && w.ammo.length > 0)) errors.push(`${d.id}: a ${w.kind} needs the ammunition it takes`);
    if (w.kind === "bow" && !(w.draw! > 0)) errors.push(`${d.id}: a bow needs a draw time`);
    if (w.clip !== undefined && !(Number.isInteger(w.clip) && w.clip >= 1 && w.clip <= 255)) errors.push(`${d.id}: weapon.clip must be a whole number from 1 to 255`);
    if (w.torpor !== undefined && !(w.kind === "melee" && w.torpor >= 0)) errors.push(`${d.id}: weapon.torpor is a melee weapon's, and not negative`);
    for (const [name, v] of [["reload", w.reload], ["draw", w.draw], ["interval", w.interval]] as const) {
      if (v !== undefined && !(v > 0 && v * TICK_RATE <= MAX_ACT_TICKS)) errors.push(`${d.id}: weapon.${name} must be above 0 and at most ${MAX_ACT_TICKS / TICK_RATE} seconds`);
    }
    // The stubs of planning/reference/weapons-plan.md are checked before anything reads them.
    if ((w.auto || w.reloadEach || w.spread || w.recoil || w.melee) && w.kind !== "bow" && w.kind !== "gun") errors.push(`${d.id}: weapon.auto, reloadEach, spread, recoil and melee are a bow's or gun's`);
    if (w.draw !== undefined && w.kind !== "bow" && w.kind !== "thrown") errors.push(`${d.id}: weapon.draw is a bow's, or a thrown weapon's that is charged`);
    // A round at a time counts the round under way past its reload once it is the last, within a byte (shared/sim/weapon.ts).
    if (w.reloadEach && !((w.reload ?? 0) * TICK_RATE <= MAX_ACT_TICKS / 2)) errors.push(`${d.id}: weapon.reload of a round at a time must be at most ${Math.floor((MAX_ACT_TICKS / 2 / TICK_RATE) * 10) / 10} seconds`);
    if (w.melee) {
      positive(d, "weapon.melee.damage", w.melee.damage, 60000);
      if (w.melee.torpor !== undefined && !(w.melee.torpor >= 0)) errors.push(`${d.id}: weapon.melee.torpor must not be negative`);
      if (w.melee.reach !== undefined) positive(d, "weapon.melee.reach", w.melee.reach, 100);
      if (w.melee.interval !== undefined && !(w.melee.interval > 0 && w.melee.interval * TICK_RATE <= MAX_ACT_TICKS)) errors.push(`${d.id}: weapon.melee.interval must be above 0 and at most ${MAX_ACT_TICKS / TICK_RATE} seconds`);
    }
    const sp = w.spread;
    if (sp && ![sp.hip, sp.aim, sp.move ?? 0, sp.bloom ?? 0, sp.recover ?? 0, sp.sway ?? 0].every((v) => v >= 0 && v <= 90)) errors.push(`${d.id}: weapon.spread is in degrees from 0 to 90`);
    if (sp && (sp.bloom ?? 0) > 0 && !((sp.recover ?? 0) > 0)) errors.push(`${d.id}: weapon.spread that blooms must recover`);
    if (w.recoil && !(w.recoil.kick >= 0 && w.recoil.kick <= 90 && w.recoil.recover >= 0)) errors.push(`${d.id}: weapon.recoil.kick is in degrees from 0 to 90, and its recovery not negative`);
    if (w.recoil && w.recoil.kick > 0 && !(w.recoil.recover > 0)) errors.push(`${d.id}: weapon.recoil that kicks must recover`);
    if (w.structures !== undefined && !(w.structures >= 0)) errors.push(`${d.id}: weapon.structures must not be negative`);
    if (w.pellets !== undefined && !(w.kind === "gun" && Number.isInteger(w.pellets) && w.pellets >= 1 && w.pellets <= 255)) errors.push(`${d.id}: weapon.pellets is a gun's, a whole number from 1 to 255`);
    if (w.cloud) {
      if (w.kind !== "thrown") errors.push(`${d.id}: only a thrown weapon bursts into a cloud`);
      positive(d, "weapon.cloud.seconds", w.cloud.seconds, MAX_BURN_SECONDS);
    }
  }
  if (d.ammo && !(d.ammo.damage >= 0)) errors.push(`${d.id}: ammo.damage must not be negative`);
  if (d.ammo?.speed !== undefined && !(d.ammo.speed > 0 && d.ammo.speed <= 1000)) errors.push(`${d.id}: ammo.speed must be above 0 and at most 1000`);
  if (d.ammo?.recover !== undefined && !(d.ammo.recover >= 0 && d.ammo.recover <= 1)) errors.push(`${d.id}: ammo.recover must be from 0 to 1`);
  const am = d.ammo;
  if (am?.pellets !== undefined && !(Number.isInteger(am.pellets) && am.pellets >= 1 && am.pellets <= 255)) errors.push(`${d.id}: ammo.pellets must be a whole number from 1 to 255`);
  if ((am?.pellets ?? 1) > 1 && am?.speed !== undefined) errors.push(`${d.id}: ammo.pellets above 1 is for a round with no speed`);
  if (am?.falloff && !(am.falloff.full >= 0 && am.falloff.none > am.falloff.full)) errors.push(`${d.id}: ammo.falloff is full from 0 metres or more, and none further than that`);
  if (am?.blast !== undefined) positive(d, "ammo.blast", am.blast, 100);
  if (am?.pierce !== undefined && !(am.pierce >= 0 && am.pierce <= 1)) errors.push(`${d.id}: ammo.pierce must be from 0 to 1`);
  if (am?.light) {
    // A light is carried by a round that flies, as a prop, until it lands (W6).
    if (am.speed === undefined) errors.push(`${d.id}: a round that carries a light flies, at its ammo.speed`);
    positive(d, "ammo.light.reach", am.light.reach, 1000);
    if (!paletteIndex(am.light.color)) errors.push(`${d.id}: ammo.light.color must be a palette index`);
  }
}

/** What is wrong with the ammunition a weapon names: each must have an ammo facet. */
export function ammoFaults(d: ItemDef, { errors, once }: Checking): void {
  const noAmmo = once(itemsWithoutAmmo);
  for (const a of d.weapon?.ammo ?? []) if (noAmmo.has(a)) errors.push(`${d.id}: "${a}" has no ammo facet, so it cannot be fired`);
}

const itemsWithoutAmmo = (input: readonly Content[]): Set<string> => new Set(input.flatMap((d) => (d.type === "item" && !d.ammo ? [d.id] : [])));

/**
 * The rays a shot of `ammo` from `weapon` sends, each tested and landed alone (W3): the gun's own count if it gives one, as
 * ARK's pump-action fires the double-barrel's shells as 14 pellets in place of 10, else its round's. A round that flies is
 * always one.
 */
export function shotRays(reg: Registry, weapon: number, ammo: number): number {
  if (reg.ammoSpeed[ammo]! > 0) return 1;
  return reg.weaponPellets[weapon] || reg.ammoPellets[ammo] || 1;
}

const HOLDS: Readonly<Record<WeaponFacet["hold"], number>> = { tool: HOLD_TOOL, spear: HOLD_SPEAR, bow: HOLD_BOW, rifle: HOLD_RIFLE, pistol: HOLD_PISTOL };

function weaponParams(w: WeaponFacet): WeaponParams {
  const ticks = (seconds: number | undefined, fallback: number): number => (seconds === undefined ? fallback : Math.max(1, Math.round(seconds * TICK_RATE)));
  const kind = w.kind === "melee" ? W_MELEE : w.kind === "bow" ? W_BOW : w.kind === "gun" ? W_GUN : W_THROWN;
  // A swing, or the pause after a shot. A bow or a single-round gun pauses briefly, because the reload that follows is the wait.
  const swingTicks = ticks(w.interval, kind === W_BOW ? 6 : kind === W_GUN && (w.clip ?? 1) === 1 ? 3 : SWING_TICKS);
  // A thrown weapon with a draw is a charged throw (W2), held as a bow is drawn.
  const drawTicks = kind === W_BOW || (kind === W_THROWN && w.draw !== undefined) ? ticks(w.draw, 1) : 0;
  return {
    kind,
    hold: kind === W_THROWN ? HOLD_THROW : (HOLDS[w.hold] ?? HOLD_HANDS),
    swingTicks,
    // A blow lands a third of the way through its swing. A throw leaves the hand a little later.
    strikeTick: Math.max(1, Math.min(swingTicks - 1, Math.round(swingTicks * (kind === W_THROWN ? 0.45 : 1 / 3)))),
    drawTicks,
    minDrawTicks: Math.round(drawTicks / 4),
    reloadTicks: kind === W_BOW || kind === W_GUN ? ticks(w.reload, 1) : 0,
    clip: kind === W_BOW || kind === W_GUN ? (w.clip ?? 1) : 0,
    wet: w.wet ?? (kind === W_MELEE),
    // Fire modes and the blow (planning/reference/weapons-plan.md, M4), only where the facet says.
    ...(w.auto ? { auto: true } : {}),
    ...(w.reloadEach ? { reloadEach: true } : {}),
    ...(w.melee ? blowParams(ticks(w.melee.interval, SWING_TICKS)) : {}),
    ...(w.spread ? { coneHip: w.spread.hip, coneAim: w.spread.aim, coneMove: w.spread.move ?? 0, coneBloom: w.spread.bloom ?? 0, coneRecover: (w.spread.recover ?? 0) / TICK_RATE, coneSway: w.spread.sway ?? 0 } : {}),
    ...(w.recoil ? { recoilKick: w.recoil.kick, recoilRecover: w.recoil.recover / TICK_RATE } : {}),
  };
}

/** A gun's blow (W2): a swing of `ticks` that lands a third of the way through, as a melee weapon's does. */
function blowParams(ticks: number): { meleeTicks: number; meleeStrikeTick: number } {
  return { meleeTicks: ticks, meleeStrikeTick: Math.max(1, Math.min(ticks - 1, Math.round(ticks / 3))) };
}

// The columns of planning/reference/weapons-plan.md. The blow's (W2), the structure factor, blast, pierce and light (W6)
// are read; the rest are compiled and read by nothing until the project named builds them.
const columns = (n: number) => ({
  /** Per item that harms: the DMG_ type of its `damage` (Registry.damage). */
  damageType: u8(n),
  /** What a bow or gun multiplies its ammunition's damage by. */
  power: f32(n),
  /** Ammunition: metres per second at full power (0 if it arrives the tick it is fired), its fall, and the chance a spent round can be picked up. */
  ammoSpeed: f32(n),
  ammoGravity: f32(n),
  ammoRecover: f32(n),
  /** Ammunition: torpor as multiples of the damage done, at once and then over `ammoTorporSeconds`, and the buff it gives (a content index, or 0). */
  ammoTorpor: f32(n),
  ammoTorporOver: f32(n),
  ammoTorporSeconds: f32(n),
  ammoBuff: u16(n),
  /** A thrown weapon: metres per second off the hand, ticks until it goes off, and how far its blast reaches. */
  throwSpeed: f32(n),
  fuseTicks: u16(n),
  blast: f32(n),
  /** A bow's or gun's blow (W2): its damage at primitive quality (0 for none), torpor as a multiple of it, and reach in metres. */
  blowDamage: f32(n),
  blowTorpor: f32(n),
  blowReach: f32(n),
  /**
   * W6, per weapon: what its damage is multiplied by against a structure (1 where the facet does not say). Kept in doubles,
   * so that the grenade's 788 / 175 gives back the Table of explosives' 788 exactly (D435).
   */
  structureMul: f64(n, 1),
  /** W5, per thrown weapon that bursts into a cloud: the prop/cloud (0 for none), the ticks it lasts, and its buff (0 for none). */
  cloudProp: u16(n),
  cloudTicks: u32(n),
  cloudBuff: u16(n),
  /**
   * W3, per ammunition: rays a round sends (1 for everything but shot), and the metres its damage falls off from and to (0
   * and 0 for none). `weaponPellets` is a gun's own count in place of its round's, 0 where it has none (shotRays).
   */
  ammoPellets: u8(n, 1),
  weaponPellets: u8(n),
  ammoFalloffFull: f32(n),
  ammoFalloffNone: f32(n),
  /** W6, per ammunition: the reach of the blast where it ends (0 for none), and the share of armor it goes through (both read). */
  ammoBlast: f32(n),
  ammoPierce: f32(n),
  /**
   * M9, per ammunition: the reach of the light it carries (0 for none) and its palette colour. A round with a light flies as
   * a prop that every client draws, until it lands (W6, server/projectiles.ts); the light itself is rendering's (D436).
   */
  ammoLight: f32(n),
  ammoLightColor: u8(n),
});

export const weapons: Kind<ItemDef, ReturnType<typeof columns>> = {
  type: "item",
  columns,
  fill(d, i, reg) {
    if (d.weapon) {
      reg.weapon[i] = weaponParams(d.weapon);
      reg.reach[i] = d.weapon.reach ?? MELEE_REACH;
      reg.power[i] = d.weapon.power ?? 1;
      reg.throwSpeed[i] = d.weapon.speed ?? 0;
      reg.fuseTicks[i] = Math.min(65535, Math.round((d.weapon.fuse ?? 0) * TICK_RATE));
      reg.blast[i] = d.weapon.blast ?? 0;
      reg.meleeTorpor[i] = d.weapon.torpor ?? 0;
      if (d.weapon.melee) {
        reg.blowDamage[i] = d.weapon.melee.damage;
        reg.blowTorpor[i] = d.weapon.melee.torpor ?? 0;
        reg.blowReach[i] = d.weapon.melee.reach ?? MELEE_REACH;
      }
      reg.structureMul[i] = d.weapon.structures ?? 1;
      reg.weaponPellets[i] = d.weapon.pellets ?? 0;
      if (d.weapon.cloud) reg.cloudTicks[i] = Math.max(1, Math.round(d.weapon.cloud.seconds * TICK_RATE));
    }
    if (d.ammo) {
      reg.ammoSpeed[i] = d.ammo.speed ?? 0;
      reg.ammoGravity[i] = d.ammo.gravity ?? 0;
      reg.ammoRecover[i] = d.ammo.recover ?? 0;
      reg.ammoTorpor[i] = d.ammo.torpor?.instant ?? 0;
      reg.ammoTorporOver[i] = d.ammo.torpor?.over ?? 0;
      reg.ammoTorporSeconds[i] = d.ammo.torpor?.seconds ?? 0;
      if (d.ammo.buff !== undefined) reg.ammoBuff[i] = reg.index.get(d.ammo.buff)!;
      reg.ammoPellets[i] = d.ammo.pellets ?? 1;
      reg.ammoFalloffFull[i] = d.ammo.falloff?.full ?? 0;
      reg.ammoFalloffNone[i] = d.ammo.falloff?.none ?? 0;
      reg.ammoBlast[i] = d.ammo.blast ?? 0;
      reg.ammoPierce[i] = d.ammo.pierce ?? 0;
      reg.ammoLight[i] = d.ammo.light?.reach ?? 0;
      reg.ammoLightColor[i] = d.ammo.light?.color ?? 0;
    }
    const hits = d.ammo ?? d.weapon;
    if (hits?.damage !== undefined) {
      reg.damage[i] = hits.damage;
      reg.damageType[i] = Math.max(0, DAMAGE_TYPES.indexOf(hits.type ?? "melee"));
    }
  },
  link(d, i, reg) {
    if (d.weapon?.cloud) {
      reg.cloudProp[i] = reg.index.get(d.weapon.cloud.prop)!;
      if (d.weapon.cloud.buff !== undefined) reg.cloudBuff[i] = reg.index.get(d.weapon.cloud.buff)!;
    }
  },
};
