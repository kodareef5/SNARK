// Definitions are plain data keyed by a stable string id ("namespace:name").
// Systems read numbers from the compiled registry and never branch on an id.
// `type` is a definition's family. A family with several classes also says which: shared/content/classes.ts has what
// each class must and may declare.

import type { StatCurve, StatName } from "../sim/genome.ts";
import { hullPoint, type HullDef } from "../world/convex.ts";

/** Other names a definition answers to at the console and in a settings file. No two definitions share one, and none is inherited. */
interface Named {
  readonly aliases?: readonly string[];
}

export interface SpeciesDef extends Named {
  readonly type: "species";
  readonly class: "survivor" | "creature" | "target";
  readonly id: string;
  /** Mesh id in an asset pack, or "box" for a generated graybox. */
  readonly mesh: string;
  /**
   * The skeleton of its body ("human"). The body is then drawn from the meshes "<mesh>/head", "/torso", "/hands", "/legs"
   * and "/feet", posed by shared/anim, and hit by zone. Omitted for a body that is one rigid mesh.
   */
  readonly skeleton?: string;
  /** Palette index used by graybox meshes. */
  readonly color: number;
  readonly radius: number;
  readonly height: number;
  readonly eyeHeight: number;
  readonly walkSpeed: number;
  readonly sprintMul: number;
  readonly jumpSpeed: number;
  /**
   * Capsule height, eye height and share of the walk speed. Crouch defaults to two thirds of the height at half speed.
   * Prone defaults to the lowest height the radius allows at a fifth of the speed.
   */
  readonly crouch?: { readonly height: number; readonly eye: number; readonly speed: number };
  readonly prone?: { readonly height: number; readonly eye: number; readonly speed: number };
  /** Degrees per second its body turns toward its look. Omitted, it faces there at once, as a survivor does. */
  readonly turn?: number;
  /** False for a body that cannot move sideways. */
  readonly strafe?: boolean;
  /** Metres per second in water. Defaults to 60% of the walk speed. */
  readonly swimSpeed?: number;
  /** Stamina points: per second of sprinting, per second of rest, per jump, and per second of walking. Defaults to 5, 8, 6 and none. */
  readonly stamina?: { readonly sprint: number; readonly regen: number; readonly jump: number; readonly walk?: number };
  /** Food capacity and loss per in-game hour. Omitted for species that do not eat. */
  readonly food?: { readonly max: number; readonly perHour: number };
  /** Water lost per in-game hour. Omitted for species that do not drink. */
  readonly waterPerHour?: number;
  /** Inventory slots. Defaults to none. */
  readonly slots?: number;
  /** How many times as long things keep in its inventory before they spoil. Defaults to 1. */
  readonly keeps?: number;
  /** It carries equipment. Ten hotbar slots and five armor slots follow its bag. */
  readonly equips?: boolean;
  /** Damage of a bare-handed strike. Defaults to 8. */
  readonly fists?: number;
  /** Torpor a bare-handed strike gives, as a multiple of the damage it does. Defaults to none. */
  readonly fistsTorpor?: number;
  /**
   * What its body gives to the blows that harvest it (server/corpses.ts). Each roll gives `min` to `max` of one drop,
   * picked by `weight` (1 where not given). A tool whose `tool.on` is a drop's `favoured` picks that drop half as often again.
   */
  readonly drops?: readonly { readonly item: string; readonly min: number; readonly max: number; readonly weight?: number; readonly favoured?: string }[];
  /** The harvest damage its grown body takes before it is used up, and the harvest damage of each roll. */
  readonly corpse?: { readonly health: number; readonly roll: number };
  /** Per stat: [base, gain per wild point, gain per tamed point]. */
  readonly stats?: { readonly [S in StatName]?: StatCurve };
  /** Multiplier on each type of damage it takes. 1 where not given. */
  readonly takes?: { readonly [T in DamageType]?: number };
  /** Multiplier on a hit to each part of its body. 1 where not given. Arms, hands, legs and feet each cover both sides. */
  readonly zones?: { readonly head?: number; readonly torso?: number; readonly arms?: number; readonly hands?: number; readonly legs?: number; readonly feet?: number };
  /** Experience for killing one at level 1. Each level above that adds a tenth. Defaults to none. */
  readonly killXp?: number;
  /** It stands where it is put and does nothing, as a practice target. */
  readonly still?: boolean;
  /** "flees" (the default) runs from what hurts it, "defends" attacks what hurts it, and "hunts" attacks any survivor it sees. */
  readonly temper?: "flees" | "defends" | "hunts";
  /** How far off it notices what it hunts, in metres. Defaults to 20. */
  readonly sight?: number;
  /** How far from where a hunt began it follows before it gives up, in metres. Defaults to 60. */
  readonly leash?: number;
  /**
   * Its bite, which does its `fists` damage. `reach` is how far from its eye it reaches, past its own length. `ticks` is
   * how long one bite takes and `lands` is the tick it lands on. They default to 27 and 11.
   */
  readonly bite?: { readonly reach: number; readonly ticks?: number; readonly lands?: number };
  /** It can be tamed by knocking it out and feeding it. These are the reference's five numbers for its species (shared/sim/taming.ts). */
  readonly taming?: { readonly a0: number; readonly a1: number; readonly foodBase: number; readonly proneMult: number; readonly k: number };
  /** What it eats, best liked first. Each entry is an item, the food one piece is worth to it, and its affinity. */
  readonly eats?: readonly { readonly item: string; readonly food: number; readonly affinity: number }[];
  /** Torpor lost per second. Defaults to 1. The maximum is its torpidity stat, and a species without that stat cannot be knocked out. */
  readonly torporDrain?: number;
  /**
   * It breeds (shared/sim/breeding.ts). `egg` is the prop a female lays, which hatches after `incubate` seconds. Without
   * one she carries her young for that long and bears them where she stands. A young one is grown `mature` seconds after
   * birth and is drawn at `scale` of full size at birth (a quarter where not given).
   */
  readonly breeds?: { readonly egg?: string; readonly incubate: number; readonly mature: number; readonly scale?: number };
  /** A name shared by every variant of a creature, for settings that speak of all of them at once. */
  readonly tag?: string;
  /**
   * Its colour set: for each of the six colour regions in order, a name and the palette colours a wild one may take, each
   * with a weight, or null for a region that takes no colour. Omitted, every region draws evenly from WILD_COLORS
   * (shared/content/registry.ts).
   */
  readonly regions?: readonly ({ readonly name: string; readonly colors: readonly (readonly [palette: number, weight: number])[] } | null)[];
  /** The palette colours a mutation may give one of its regions. Defaults to MUTATION_COLORS. */
  readonly mutations?: readonly number[];
  /** When it is hurt, others of its species within this many metres take fright with it. Omitted, none do. */
  readonly alarm?: number;
  /** Its sprintMul once tamed. Defaults to its sprintMul. */
  readonly tamedSprintMul?: number;
  /** What it weighs to a creature that carries or drags it (the reference's drag weight), and its mass. */
  readonly drag?: number;
  readonly mass?: number;
  /** A survivor may pick it up in both arms, hold it and throw it. */
  readonly carriable?: boolean;
  /** The item it leaves when it defecates. Omitted, it does not. */
  readonly feces?: string;
  /** The chance, 0 to 1, that a female lays an unfertilised egg in place of her feces: the item her egg prop names. */
  readonly eggChance?: number;
  // The rest are stubs: declared, checked and read by nothing yet. The catalogue says what each waits for.
  /** What kind of variant of its base it is: "alpha", "event". */
  readonly variant?: string;
  /** Its attacks, to replace `bite` and `fists`. */
  readonly attacks?: readonly { readonly name: string; readonly damage: number; readonly type: DamageType; readonly reach: number; readonly ticks: number; readonly lands: number }[];
  /** The loot definition its body leaves, beside `drops`. */
  readonly loot?: string;
  /** The saddle item it wears. Today the saddle names the species. */
  readonly saddle?: string;
  /** Buffs it always has. */
  readonly buffs?: readonly string[];
  readonly boss?: boolean;
}

/** `at` is the centre, measured from the piece's origin. `half` is the half extents. Both are in metres. */
export interface ShapeBox {
  readonly at: readonly [number, number, number];
  readonly half: readonly [number, number, number];
}

/** The role decides what a piece may join and what may join it. */
export type PieceRole = "foundation" | "wall" | "ceiling" | "pillar" | "door" | "stairs" | "thing";
/** A "thing" joins nothing. It is set down on the ground or a floor and stands on what is under it. */
export const PIECE_ROLES: readonly PieceRole[] = ["foundation", "wall", "ceiling", "pillar", "door", "stairs", "thing"];

/** The form of a built piece, shared by every material. Bodies walk on its boxes and convex parts, and rays stop at them. */
export interface ShapeDef extends Named {
  readonly type: "shape";
  readonly id: string;
  readonly role: PieceRole;
  readonly boxes: readonly ShapeBox[];
  /**
   * Convex parts besides the boxes, for a ramp, a sloped roof or a triangle: each the hull of its corners, in metres from the
   * piece's origin along its first axis, up and along its second. A shape with parts may have no boxes.
   */
  readonly hulls?: readonly HullDef[];
  /** A door may be set in it. */
  readonly doorway?: boolean;
}

export interface StructureDef extends Named {
  readonly type: "structure";
  readonly class: "piece" | "container" | "station" | "bed" | "static" | "defence";
  readonly id: string;
  /** "box" for one made from its half extents, "shape" for one made from its shape's boxes, or a mesh of the pack. */
  readonly mesh: string;
  readonly color: number;
  /** Half extents in metres of the box that holds all of it, centred on the structure's position. Without a shape, this box is its collider. */
  readonly half: readonly [number, number, number];
  /** A shape id, if it is more than one box. `half` must equal the box that holds the shape. */
  readonly shape?: string;
  readonly hp: number;
  /** A material id. The material says what each type of damage does to it. Omitted, nothing harms it. */
  readonly material?: string;
  /** Stacks it holds. */
  readonly slots?: number;
  /** Using it turns it into this other structure in the same place. A door and its open form name each other. */
  readonly opens?: string;
  /** Only its tribe may use it until the tribe unlocks it. Omitted, anyone may. */
  readonly locked?: boolean;
  /** When it loses its support it drops whole onto the ground under it instead of breaking. */
  readonly falls?: boolean;
  /** Days it lasts unvisited, in place of its material's. */
  readonly decayDays?: number;
  /** A fire. Lighting it turns it into this other structure in the same place, and putting that one out turns it back. */
  readonly lights?: string;
  /** The burning one of such a pair. */
  readonly lit?: boolean;
  /** Its tribe may respawn at it. */
  readonly bed?: boolean;
}

/** Multiplier on each type of damage a structure of this material takes. A type not given does no damage. */
export interface MaterialDef extends Named {
  readonly type: "material";
  readonly id: string;
  readonly takes: { readonly [T in DamageType]?: number };
  /** Days a structure of it may go unvisited by its owners before anyone may demolish it. Omitted, never. */
  readonly decayDays?: number;
}

export interface ItemDef extends Named {
  readonly type: "item";
  readonly class: "resource" | "consumable" | "weapon" | "ammo" | "attachment" | "armor" | "saddle" | "structure" | "egg" | "feces" | "shield" | "costume" | "skin" | "dye" | "artifact";
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
  /** The species it fits and the armor it gives the creature that wears it (the reference's rating). */
  readonly saddle?: { readonly fits: string; readonly armor: number };
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
   * A weapon lists the attachment items it takes in `fits`. "holo" is the holo-scope, a stub: no item is one until W7 of
   * planning/reference/weapons-plan.md builds its view.
   */
  readonly attachment?: "scope" | "silencer" | "light" | "laser" | "holo";
  /** The structures it may be set down as. The first is the usual form. The rest are other forms (a wall as a doorframe), chosen as it is placed. */
  readonly places?: readonly string[];
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
}

/** Species and structure materials each give a multiplier per type. */
export type DamageType = "melee" | "pierce" | "bullet" | "fire" | "explosive";

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
  // Stubs of the same plan: declared, checked and compiled, and read by nothing until the project named builds them
  // (classes.ts lists them under the weapon facet's `stubs`). Omitted, a weapon does what all do today.
  /** W6: what its damage is multiplied by against a structure. 1 where not given. ARK's grenade is 4.5 (Table of explosives). */
  readonly structures?: number;
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
  // Stubs of planning/reference/weapons-plan.md, as the weapon facet's are. Omitted, a round does what all do today.
  /** W3: rays one round sends, each tested and landed alone, as a shotgun's pellets. 1 where not given. */
  readonly pellets?: number;
  /** W3: its damage falls from all of it at `full` metres to none at `none`. Omitted, it does not fall off. */
  readonly falloff?: { readonly full: number; readonly none: number };
  /** W6: where it ends it goes off as a grenade does, reaching this many metres. The blast is the whole of its damage. */
  readonly blast?: number;
  /** W6: the share of armor, 0 to 1, it goes through (the metal arrow's "-90% armor bypass" is 0.9). */
  readonly pierce?: number;
  /** A light it carries while it flies: reach in metres and a palette colour. Rendering's to build (M9); a flare's until then is a bright mesh. */
  readonly light?: { readonly reach: number; readonly color: number };
}

export interface WearFacet {
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

/**
 * A mesh a node is drawn as, and the boxes bodies and rays meet, in metres from its origin at its modelled size. Its origin
 * is where it meets the ground.
 */
export interface NodeShape {
  readonly mesh: string;
  readonly boxes?: readonly ShapeBox[];
}

/** One individual a node kind grows as. */
export interface NodeVariant extends NodeShape {
  /** How often it is chosen against the kind's other variants. 1 where not given. */
  readonly weight?: number;
  /** What is left of it once used up, in place of the kind's. */
  readonly depleted?: NodeShape;
}

/** A resource node: a tree, a rock, a bush. Node positions come from the map and are the same on every client. Only touched nodes are saved. */
export interface NodeDef extends Named {
  readonly type: "node";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  /** Graybox half extents, and the collider of a variant without boxes. The node stands on its base. */
  readonly half: readonly [number, number, number];
  /** A second box on top of the first, for a crown. Drawn, not collided with. */
  readonly top?: { readonly half: readonly [number, number, number]; readonly color: number };
  /** Bodies walk through it (a bush). It can still be looked at and used. */
  readonly soft?: boolean;
  /** Hits (or picks) before it is used up. */
  readonly hits: number;
  /** In-game hours until it grows back. */
  readonly respawnHours: number;
  /** Matched against a tool's `on`. Omitted for things picked by hand with the use key. */
  readonly material?: string;
  /** What each hit gives. `tool` true means only with the right tool. */
  readonly yields: readonly { readonly item: string; readonly min: number; readonly max: number; readonly tool?: boolean }[];
  /** Experience per hit. */
  readonly xp: number;
  /** The individuals it grows as. Each node is one of them, chosen by its place. Without them it is its own mesh and `half`. */
  readonly variants?: readonly NodeVariant[];
  /** The least and most it is drawn at, as multiples of its modelled size. Each node's is chosen by its place. 1 where not given. */
  readonly size?: readonly [number, number];
  /** What stands where a node was from when it is used up until it grows back. Without it, nothing does. */
  readonly depleted?: NodeShape;
  /**
   * How far its footing spreads from its origin, in metres at its largest size, and how far the ground may fall away
   * under it below the ground at the origin. A scattered slot whose ground falls further grows the kind `else` names in
   * its place, as it is, or nothing.
   */
  readonly footing?: { readonly reach: number; readonly fall: number; readonly else?: string };
}

export interface EngramDef extends Named {
  readonly type: "engram";
  readonly id: string;
  readonly label: string;
  /** Level needed to learn it, and what it costs in engram points. */
  readonly level: number;
  readonly cost: number;
  /** The item it unlocks the making of. One engram, one item, as in ARK. */
  readonly item: string;
  /** It is not offered, so nobody can learn it. A survivor that already knows it keeps it. */
  readonly hidden?: boolean;
  /** A survivor that reaches this level learns it automatically and for free. */
  readonly auto?: number;
  // Stubs, read by nothing yet.
  /** Engrams that must be known first. */
  readonly requires?: readonly string[];
  /** The set of maps that offer it. */
  readonly group?: string;
  /** The boss whose defeat gives it, in place of points. */
  readonly from?: string;
}

/** Experience needed to reach each level (index 0 is level 1), and the engram points gained on reaching it. */
export interface LevelsDef extends Named {
  readonly type: "levels";
  readonly id: string;
  readonly xp: readonly number[];
  readonly engramPoints: readonly number[];
  /** The most experience a survivor may have. Defaults to what the last level takes. */
  readonly most?: number;
  /** A separate table and cap for tamed creatures. Omitted, they use the survivors'. */
  readonly tame?: { readonly xp: readonly number[]; readonly most?: number };
}

/** An entity that stands in the world but does not move or live, such as an item cache. Its record can hold an inventory. */
export interface PropDef extends Named {
  readonly type: "prop";
  readonly class: "container" | "projectile" | "egg" | "crate" | "cloud";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  readonly radius: number;
  readonly height: number;
  /** Inventory slots of its record. */
  readonly slots?: number;
  /** It is drawn tilted to its pitch as well as turned to its facing, with its mesh's +Z leading, like an arrow stuck where it landed. */
  readonly pitched?: boolean;
  /** Drawn at this multiple of its mesh's modelled size. 1 where not given. */
  readonly size?: number;
  /** An egg: the item it is when picked up. */
  readonly item?: string;
  /** An egg: the item it is when picked up fertilised, which stacks to 1 and keeps the young it holds. */
  readonly fertile?: string;
}

/**
 * Something that acts on a body for a time, such as burning or a dose of narcotic. A body may have several at once.
 * A buff is never stepped. Its end tick is known when it begins, its effect on vitals is a change of rate, and its
 * multipliers are read when needed.
 */
export interface BuffDef extends Named {
  readonly type: "buff";
  readonly id: string;
  readonly label: string;
  /** Palette index of its mark in the interface. */
  readonly color: number;
  /** Seconds it lasts when its giver does not say. Omitted, it lasts until removed. */
  readonly seconds?: number;
  /** When given again while active, "refresh" (the default) restarts its time and "stack" adds another with its own end. */
  readonly again?: "refresh" | "stack";
  /** Health per second (negative harms) and torpor per second while it lasts. */
  readonly health?: number;
  readonly torpor?: number;
  /** The kind of damage its harm to health is, scaled by what the body takes of that kind. Omitted, none scales it. */
  readonly damage?: DamageType;
  /** Multipliers on the body's speed, the damage it deals and the damage it takes. */
  readonly speed?: number;
  readonly dealt?: number;
  readonly taken?: number;
  /** The body cannot move. */
  readonly root?: boolean;
  /** Nothing harms the body. */
  readonly immune?: boolean;
  /** A beneficial buff, shown apart from harmful ones. */
  readonly good?: boolean;
  // Stubs of planning/reference/weapons-plan.md (W4, the bola), read by nothing yet.
  /** The creatures it takes, by species; omitted, any. A survivor is always taken. ARK's bola names its list (Bola). */
  readonly only?: readonly string[];
  /** Seconds it lasts on a survivor, in place of `seconds` (the bola's 25 against a creature's 30). */
  readonly survivorSeconds?: number;
  /** A buff given as it ends, such as a time it cannot be given again (the bola's 10 s, patch 240.5). */
  readonly after?: string;
}

/** A type of harm. A stub: the five the engine knows are named in code (`DamageType`). */
export interface DamageDef extends Named {
  readonly type: "damage";
  readonly id: string;
  readonly label?: string;
  /** Torpor given, as a multiple of the damage done. */
  readonly torpor?: number;
  /** The share of the damage, 0 to 1, that armor does not reduce. */
  readonly trueShare?: number;
  readonly melee?: boolean;
}

export interface LootEntry {
  /** One of these is drawn, by `weights` if given. */
  readonly items: readonly string[];
  readonly weights?: readonly number[];
  readonly weight?: number;
  readonly min: number;
  readonly max: number;
  /**
   * Lowest and highest quality as ARK's item rating (MinQuality, MaxQuality): the tier is the highest whose threshold the
   * rating drawn reaches (QUALITY_RATING, shared/sim/items.ts). Omitted, primitive.
   */
  readonly quality?: readonly [number, number];
  /** Chance, 0 to 1, that it comes as a single blueprint, for an item that may be one (ChanceToBeBlueprintOverride). */
  readonly blueprint?: number;
}

/**
 * Sets of items to draw from: what a crate holds, what a body leaves (shared/sim/loot.ts rolls one, and the console's `loot`
 * mints a roll). Nothing in the world opens one yet: crates and fishing wait for map zones.
 */
export interface LootDef extends Named {
  readonly type: "loot";
  readonly id: string;
  /** How many of the sets are drawn. One, where not given. */
  readonly sets?: { readonly min: number; readonly max: number };
  readonly from: readonly { readonly weight?: number; readonly min: number; readonly max: number; readonly entries: readonly LootEntry[] }[];
}

/** Which creatures live in a place, in what share and in what groups. A spawn zone of a map names one. */
export interface SpawnsDef extends Named {
  readonly type: "spawns";
  readonly id: string;
  /**
   * What a region adds when it holds too few: one entry, drawn by weight, and its group of creatures. Each of the group comes
   * with its chance, 1 where not given, and stands at its offset from the place found, in metres along x and z.
   */
  readonly entries: readonly {
    readonly name?: string;
    readonly weight: number;
    readonly group: readonly string[];
    readonly chances?: readonly number[];
    readonly offsets?: readonly (readonly [number, number])[];
  }[];
  /** The most of a region's creatures that may be of one species, as a share from 0 to 1 of the number it holds. */
  readonly limits?: readonly { readonly species: string; readonly share: number }[];
}

/** A place on a map where something spawns or drops. */
export interface MapZone {
  readonly kind: "spawn" | "crate" | "biome";
  /** Centre x and z, in metres. */
  readonly at: readonly [number, number];
  /** A circle of this radius, in metres. */
  readonly radius?: number;
  /** In place of `radius`: a box of this half width and half depth. */
  readonly half?: readonly [number, number];
  /** For a spawn zone: the `spawns` it is stocked from, and how many creatures it holds at a DinoCountMultiplier of 1. */
  readonly spawns?: string;
  readonly count?: number;
  readonly crate?: string;
}

/**
 * A world. Its ground is the map file that carries its id (shared/world/mapfile.ts), and a server is started with that file.
 * A spawn zone that names spawns is kept stocked from them (server/spawner.ts).
 */
export interface MapDef extends Named {
  readonly type: "map";
  readonly id: string;
  readonly label?: string;
  /** Its size in chunks along x and along z, and its sea level. Each must be what its file holds. */
  readonly chunks: readonly [number, number];
  readonly seaLevel?: number;
  readonly game?: string;
  readonly zones?: readonly MapZone[];
}

/** What a game names once. A stub: these are found by id in code today. */
export interface GameDef extends Named {
  readonly type: "game";
  readonly id: string;
  readonly survivor: string;
  /** What the dead leave, and what a dropped stack lies in. */
  readonly cache: string;
  readonly bag: string;
  readonly levels?: string;
  /** Buffs every survivor always has. */
  readonly buffs?: readonly string[];
}

/**
 * An id that used to name something, and what it is called now. A save, a ledger or a settings file that still uses the old
 * id is read as if it used the new ones. It is not content: it has no index, and the registry keeps it apart as a redirect.
 */
export interface RenameDef {
  readonly type: "rename";
  /** The id that is no longer defined. */
  readonly id: string;
  /** What it is now. More than one where a thing was split, as an engram for a whole set into one for each piece. */
  readonly to: readonly string[];
}

export type Def = SpeciesDef | StructureDef | ItemDef | PropDef | NodeDef | EngramDef | LevelsDef | BuffDef | MaterialDef | ShapeDef | DamageDef | LootDef | SpawnsDef | MapDef | GameDef | RenameDef;

/** Half extents of the box, centred on a shape's origin, that holds all of its boxes and convex parts. */
export function shapeHalf(boxes: readonly ShapeBox[], hulls: readonly HullDef[] = []): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const b of boxes) for (let a = 0; a < 3; a++) out[a] = Math.max(out[a]!, Math.abs(b.at[a]!) + b.half[a]!);
  for (const h of hulls) {
    for (const c of h.corners) {
      const p = hullPoint(c, h.sixty === true);
      for (let a = 0; a < 3; a++) out[a] = Math.max(out[a]!, Math.abs(p[a]!));
    }
  }
  return out;
}
