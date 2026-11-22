// Definitions are plain data keyed by a stable string id ("namespace:name").
// Systems read numbers from the compiled registry and never branch on an id.
// `type` is a definition's family. A family with several classes also says which: shared/content/classes.ts has what
// each class must and may declare.

import type { Named } from "./kind.ts";
import type { MaterialDef } from "./kinds/materials.ts";
import type { ShapeDef } from "./kinds/shapes.ts";
import type { LootDef } from "./kinds/loot.ts";
import type { SpawnsDef } from "./kinds/spawns.ts";
import type { MapDef } from "./kinds/maps.ts";
import type { GameDef } from "./kinds/game.ts";
import type { RenameDef } from "./kinds/renames.ts";
import type { LevelsDef } from "./kinds/levels.ts";
import type { EngramDef } from "./kinds/engrams.ts";
import type { NodeDef } from "./kinds/nodes.ts";
import type { PropDef } from "./kinds/props.ts";
import type { StructureDef } from "./kinds/structures.ts";
import type { SpeciesDef } from "./kinds/species.ts";
import type { BuffDef } from "./kinds/buffs.ts";
import type { DamageDef, DamageType } from "./kinds/damage.ts";
import type { Seat } from "../sim/seats.ts";
import type { StatName } from "../sim/genome.ts";

export type { MaterialDef } from "./kinds/materials.ts";
export type { PieceRole, ShapeBox, ShapeDef, ShapeLook } from "./kinds/shapes.ts";
export { PIECE_ROLES, shapeHalf } from "./kinds/shapes.ts";
export type { LootCount, LootDef, LootEntry, LootSet } from "./kinds/loot.ts";
export type { SpawnsDef } from "./kinds/spawns.ts";
export type { MapDef, MapZone } from "./kinds/maps.ts";
export type { GameDef } from "./kinds/game.ts";
export type { RenameDef } from "./kinds/renames.ts";
export type { LevelsDef } from "./kinds/levels.ts";
export type { EngramDef } from "./kinds/engrams.ts";
export type { NodeDef, NodeShape, NodeVariant } from "./kinds/nodes.ts";
export type { PropDef } from "./kinds/props.ts";
export type { MotionFacet, PartPlacement, StructureDef } from "./kinds/structures.ts";
export type { CreatureAttackDef, CreatureChargeDef, CreatureCombatFacet, CreatureHarvestFacet, CreatureModeDef, FlyFacet, SpeciesDef } from "./kinds/species.ts";
export type { BuffDef } from "./kinds/buffs.ts";
export type { DamageDef, DamageType } from "./kinds/damage.ts";

export interface ItemDef extends Named {
  readonly type: "item";
  readonly class: "resource" | "consumable" | "weapon" | "ammo" | "attachment" | "armor" | "saddle" | "structure" | "vehicle" | "egg" | "feces" | "shield" | "costume" | "skin" | "dye" | "artifact" | "glider" | "ball" | "instrument";
  readonly id: string;
  /** Largest stack. 1 for things that carry their own quality and durability. */
  readonly stack: number;
  /** Kilograms each. Defaults to 0.1. */
  readonly weight?: number;
  /** In-game hours one lasts before it spoils. Omitted for things that keep. */
  readonly spoilHours?: number;
  /** In-game hours one lies on the ground before it is gone (the reference's "decomposes in"). Omitted, as long as any dropped stack. */
  readonly decomposeHours?: number;
  /** A young body gives this in place of the item named, as a young creature gives prime meat in place of meat. */
  readonly youngFor?: string;
  /** What eating one restores, in points. */
  readonly eat?: { readonly food?: number; readonly water?: number; readonly health?: number };
  /** Seconds one of it keeps a fire going. */
  readonly fuel?: number;
  /** When one piece of it has burnt out in a fire, the fire gets one of this, as wood leaves charcoal (M4); with no room it is lost. */
  readonly burnsInto?: string;
  /**
   * The species it fits, the armor it gives the creature that wears it (the reference's rating), and the seats it puts on
   * that creature (shared/sim/seats.ts): the rider's, who steers, and any passengers'. Each names the socket of the
   * creature's rig it moves with, and its anchor is that socket at rest.
   */
  readonly saddle?: { readonly fits: string; readonly armor: number; readonly seats: readonly Seat[] };
  /** Fed to an unconscious creature, it adds this much torpor over this many seconds. */
  readonly dose?: { readonly torpor: number; readonly seconds: number };
  /** Over a fire it becomes `into` after `seconds`. */
  readonly cooks?: { readonly into: string; readonly seconds: number };
  /** Name shown in the interface. Defaults to the id without its namespace. */
  readonly label?: string;
  /** Palette index of its swatch in the interface. */
  readonly color?: number;
  /** What it works on ("wood", "stone"), how many times stronger than bare hands it is, and how many uses it lasts. */
  readonly tool?: { readonly on: string; readonly power: number; readonly uses: number };
  readonly weapon?: WeaponFacet;
  readonly ammo?: AmmoFacet;
  readonly wear?: WearFacet;
  /**
   * A weapon lists the attachment items it takes in `fits`. What each does (planning/reference/weapons-plan.md, M10): a
   * scope zooms about 3 times with a reticle and sways the weapons that sway; a holo-scope zooms about 1.25 times with a
   * night tint and a crosshair coloured by what it is on (its view is built; no item is one until the fabricator's wave);
   * a silencer hides the shot's flash and, from a survivor it hits, its side; a light and a laser are switched on and off
   * (FLAG_ON), the laser drawing a dot where the weapon points and the light waiting for local lights (D436).
   */
  readonly attachment?: "scope" | "silencer" | "light" | "laser" | "holo";
  /** A sight, glass or visor looked through: how many times it magnifies the view (OpticFacet, D1076). */
  readonly optic?: OpticFacet;
  /** The structures it may be set down as. The first is the usual form. The rest are other forms (a wall as a doorframe), chosen as it is placed. */
  readonly places?: readonly string[];
  /** A completed vehicle assembly. Deployment consumes one only after the named vehicle fits on a supporting surface. */
  readonly deploys?: string;
  /** How it is made. An item without this cannot be crafted. */
  readonly craft?: CraftFacet;
  // Stubs, read by nothing yet.
  readonly description?: string;
  /** Where it sits in the inventory and crafting lists: "Structures/Wood". */
  readonly folder?: string;
  /** The item a spoiled one becomes, one for one, as ARK's meat becomes spoiled meat (server/items.ts). Omitted, it is gone. */
  readonly spoilsInto?: string;
  /**
   * Whether it may be a blueprint: a slot flagged FLAG_BLUEPRINT (shared/sim/items.ts) that crafts it at the blueprint's
   * quality, from the blueprint's own ingredients, with no engram and at any level, as often as wanted, and is never used up
   * (ark.wiki.gg Blueprint, 2026-11-15: unlimited uses, except ARK's fishing rod and Tek blueprints, 3 each). Omitted, an
   * item that is crafted may be one; false keeps it from ever being one; only an item with `craft` may be.
   */
  readonly blueprint?: boolean;
  /** What using one does beyond what eating gives (planning/reference/items-plan.md, task C). */
  readonly use?: UseFacet;
  /** A glider, flown from anywhere in the bag (planning/workstreams/glider.md). */
  readonly glide?: GlideFacet;
  /**
   * A soul ball (planning/workstreams/soul-ball.md): on the empty one, `full` names the item it becomes when a tame is
   * kept in it; on the full one, `empty` names the item it is again once the tame is loosed or lost. A full one stands
   * for its tame's record (Inventory.ref) and stacks to 1.
   */
  readonly ball?: { readonly full?: string; readonly empty?: string };
  /**
   * Its spoil clock is a charge: where it lies does not stretch it (a structure's `keeps`), a structure that `charges`
   * holds it full, and taken out of one it runs down from full. Only an item that spoils and stacks to 1 has one.
   */
  readonly charge?: boolean;
  /**
   * False for a thing that may not leave its server, as ARK's Element, tributes and boss trophies may not: a survivor carrying
   * one is refused travel until it puts it down (ark.wiki.gg CrossARK Transfers, 2026-11-15). Omitted, it travels.
   */
  readonly travels?: boolean;
}

/**
 * What using an item does to the body that uses it, as ARK's UseItemAddCharacterStatusValues and the buffs a consumable gives
 * (server/use.ts). Using one burns it, after what eating it gives, unless it is a vessel, which is kept.
 */
export interface UseFacet {
  /**
   * A stat changed by `amount`: at once (health, stamina, oxygen, food, water, torpidity), or spread over `seconds`
   * (health and torpidity only, and only adding, carried by a buff as a meal's health and a dose's torpor are).
   */
  readonly adds?: readonly { readonly stat: StatName; readonly amount: number; readonly seconds?: number }[];
  /** Buffs given on use. */
  readonly buffs?: readonly string[];
  /**
   * A vessel that holds water: `water` points when full, `each` drunk a use, filled again by a use while standing in water
   * and not swimming. It stacks to 1 and holds its water as the slot's durability. Made, it is empty.
   */
  readonly holds?: { readonly water: number; readonly each: number };
}

/**
 * A glider (planning/workstreams/glider.md), which stands where ARK's Parachute does and flies as no parachute does. The
 * best serviceable one a survivor carries, anywhere in its inventory, is the one it flies: opened in the air with Crouch, or
 * with Jump out of the cuirass, and flown by the numbers of its grade (shared/sim/character.ts). It wears as it is flown
 * and is charged as it folds, never in the air: one use for each `seconds` it was open, and at least one a flight.
 */
export interface GlideFacet {
  /** 1 to 3. Only 1, the frond glider's, has numbers today. */
  readonly grade: number;
  readonly uses: number;
  readonly seconds: number;
}

/**
 * What looking through an item does to the view (client/core/optics.ts): the view narrows on the tangent of its half,
 * `min` times at first, as far as `max` for one that zooms. A fixed sight gives `min` alone. `steps`, inside the two in
 * order, are the magnifications one that clicks stops at; one with none zooms smoothly.
 */
export interface OpticFacet {
  readonly min: number;
  readonly max?: number;
  readonly steps?: readonly number[];
  /**
   * The share of the screen's height its window spans at its least zoom and at its most, tightening between them; the
   * rest is masked and not drawn (D1077). A whole height, [1, 1], where it gives none.
   */
  readonly window?: readonly [number, number];
  /** One round lens, two merged side by side, or a visor's wide window. Round where it gives none. */
  readonly shape?: "round" | "twin" | "visor";
  /** A scope's reticle: the German post (the default), or lines marked in milliradians that grow with the zoom (D1083). */
  readonly reticle?: "post" | "mil";
}

/** How an item is made. ARK keeps this on the item too. */
export interface CraftFacet {
  /** What one crafting uses up. */
  readonly needs: readonly { readonly item: string; readonly count: number }[];
  /** Seconds to make one. */
  readonly seconds: number;
  readonly xp: number;
  /** How many one crafting makes. One, where not given. */
  readonly count?: number;
  /**
   * The station it is made at: only there, from what lies in the station, and the product lands there. Omitted, it is made
   * in the hands from the survivor's own inventory.
   */
  readonly at?: string;
  /** The level below which it cannot be made, engram or no. */
  readonly level?: number;
  /**
   * Made by the fire it is `at` while that burns and its ingredients lie in it, with no job, engram or experience
   * (planning/reference/stations-plan.md, M3). Only at a station that `lights`.
   */
  readonly fired?: boolean;
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

export interface WearFacet {
  /** A closed helmet includes its own neck seal and conceals the face and beard while its mesh is loaded. */
  readonly sealed?: boolean;
  /** Optional artwork deployed by an airborne torso piece, under the same fitted model directory. */
  readonly vents?: string;
  readonly slot: "head" | "torso" | "hands" | "legs" | "feet";
  /** Armor rating at primitive quality. Damage is multiplied by 100 / (100 + armor). */
  readonly armor: number;
  /** Durability at primitive quality. */
  readonly uses: number;
  /** Mesh set drawn in place of the body's slot. Its meshes are "<body>/armor/<set>/<slot>". */
  readonly set: string;
  /** Palette colours of its three colour regions: main, second, trim. */
  readonly colors: readonly [number, number, number];
}

/** Everything but a rename, which is not content. */
export type Content = Exclude<Def, RenameDef>;

export type Def = SpeciesDef | StructureDef | ItemDef | PropDef | NodeDef | EngramDef | LevelsDef | BuffDef | MaterialDef | ShapeDef | DamageDef | LootDef | SpawnsDef | MapDef | GameDef | RenameDef;
