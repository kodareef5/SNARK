// Content definitions: immutable data describing what can exist.
//
// Definitions are plain data keyed by a stable string id ("namespace:name").
// Systems read numbers from the compiled registry; no system branches on an id.

import type { StatCurve, StatName } from "../sim/genome.ts";

export interface SpeciesDef {
  readonly type: "species";
  readonly id: string;
  /** Mesh id in an asset pack, or "box" for a generated graybox. */
  readonly mesh: string;
  /**
   * The skeleton its body hangs on ("human"). The body is then drawn from the
   * meshes "<mesh>/head", "/torso", "/hands", "/legs" and "/feet", posed by
   * shared/anim, and hit by zone. Omitted for a body that is one rigid mesh.
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
   * Crouching and lying prone: capsule height, eye height, and share of the walk
   * speed. Default to two thirds and (as low as the radius allows) of the height,
   * with half and a fifth of the speed.
   */
  readonly crouch?: { readonly height: number; readonly eye: number; readonly speed: number };
  readonly prone?: { readonly height: number; readonly eye: number; readonly speed: number };
  /** Metres per second in water. Defaults to 60% of the walk speed. */
  readonly swimSpeed?: number;
  /** Stamina points: per second of sprinting, per second of rest, per jump. Defaults to 5, 8 and 6. */
  readonly stamina?: { readonly sprint: number; readonly regen: number; readonly jump: number };
  /** Food capacity and loss per in-game hour. Omitted for species that do not eat. */
  readonly food?: { readonly max: number; readonly perHour: number };
  /** Water lost per in-game hour. Omitted for species that do not drink. */
  readonly waterPerHour?: number;
  /** Inventory slots. Defaults to none. */
  readonly slots?: number;
  /** It carries equipment: after its bag come ten hotbar slots and five armor slots. */
  readonly equips?: boolean;
  /** Damage of a bare-handed strike. Defaults to 8. */
  readonly fists?: number;
  /** What a kill of one yields, each an item and a range. */
  readonly drops?: readonly { readonly item: string; readonly min: number; readonly max: number }[];
  /** How points become values, per stat: [base, gain per wild point, gain per tamed point]. */
  readonly stats?: { readonly [S in StatName]?: StatCurve };
  /** What it takes of each kind of damage: 1 where not given. */
  readonly takes?: { readonly [T in DamageType]?: number };
  /** What a hit on each part of its body is multiplied by: 1 where not given. Arms, hands, legs and feet are both of them. */
  readonly zones?: { readonly head?: number; readonly torso?: number; readonly arms?: number; readonly hands?: number; readonly legs?: number; readonly feet?: number };
  /** Experience for killing one at level 1; each level above that adds a tenth. Defaults to none. */
  readonly killXp?: number;
  /** It stands where it is put and does nothing: a target to practise on. */
  readonly still?: boolean;
}

export interface StructureDef {
  readonly type: "structure";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  /** Collider half extents in metres; the structure's position is the box centre. */
  readonly half: readonly [number, number, number];
  readonly hp: number;
}

export interface ItemDef {
  readonly type: "item";
  readonly id: string;
  /** Largest stack. 1 for things that carry their own quality and durability. */
  readonly stack: number;
  /** Kilograms each. Defaults to 0.1. */
  readonly weight?: number;
  /** In-game hours one lasts before it spoils. Omitted for things that keep. */
  readonly spoilHours?: number;
  /** What eating one restores, in points. */
  readonly eat?: { readonly food?: number; readonly water?: number; readonly health?: number };
  /** Name shown in the interface. Defaults to the id without its namespace. */
  readonly label?: string;
  /** Palette index of its swatch in the interface. */
  readonly color?: number;
  /** A tool: what it works on ("wood", "stone"), how many times stronger than bare hands, and how many uses it lasts. */
  readonly tool?: { readonly on: string; readonly power: number; readonly uses: number };
  /** Something held and attacked with. */
  readonly weapon?: WeaponFacet;
  /** Something a weapon is loaded with. */
  readonly ammo?: AmmoFacet;
  /** Something worn in an armor slot. */
  readonly wear?: WearFacet;
  /** Something fitted to a weapon: what kind of thing it is. A weapon lists the attachment items it takes. */
  readonly attachment?: "scope" | "silencer" | "light" | "laser";
}

/** How a kind of damage is named. Armor, species and structure materials each say what they make of a type. */
export type DamageType = "melee" | "pierce" | "bullet" | "fire" | "explosive";

export interface WeaponFacet {
  /**
   * "melee" strikes what is in reach. "bow" is drawn and loosed: the longer the
   * draw, the faster and harder the shot. "gun" fires what is loaded as it is
   * (a crossbow is one). "thrown" is thrown itself.
   */
  readonly kind: "melee" | "bow" | "gun" | "thrown";
  /** Melee and thrown: damage of one hit at primitive quality, and its type. */
  readonly damage?: number;
  readonly type?: DamageType;
  /** Melee: how far it reaches from the eye, metres. Defaults to 2.6. */
  readonly reach?: number;
  /** Bow and gun: the ammunition items it takes, and what it multiplies their damage by. */
  readonly ammo?: readonly string[];
  readonly power?: number;
  /** Rounds it holds. Defaults to 1. */
  readonly clip?: number;
  /** Seconds to reload (for a bow, to nock the next arrow), to draw a bow fully, and between two shots or swings. */
  readonly reload?: number;
  readonly draw?: number;
  readonly interval?: number;
  /** Thrown: metres per second it leaves the hand at, and seconds until it goes off (0 for on impact). */
  readonly speed?: number;
  readonly fuse?: number;
  /** Uses before it breaks, at primitive quality. */
  readonly uses: number;
  /** Works under water. */
  readonly wet?: boolean;
  /** Attachment items that fit it. */
  readonly fits?: readonly string[];
  /** Mesh held in the hand, and how the body holds it. */
  readonly mesh?: string;
  readonly hold: "tool" | "bow" | "rifle" | "pistol" | "spear";
}

export interface AmmoFacet {
  readonly damage: number;
  readonly type: DamageType;
  /** Metres per second at full power, and its fall in metres per second squared. Omitted: it arrives the tick it is fired. */
  readonly speed?: number;
  readonly gravity?: number;
  /** Torpor, as multiples of the damage done: at once, and then spread over some seconds. */
  readonly torpor?: { readonly instant: number; readonly over: number; readonly seconds: number };
  /** A buff the target is given. */
  readonly buff?: string;
  /** Chance, 0 to 1, that a spent one can be picked up again. */
  readonly recover?: number;
  readonly mesh?: string;
}

export interface WearFacet {
  readonly slot: "head" | "torso" | "hands" | "legs" | "feet";
  /** Armor rating at primitive quality: damage is multiplied by 100 / (100 + armor). */
  readonly armor: number;
  /** Durability at primitive quality. */
  readonly uses: number;
  /** Mesh set drawn in place of the body's slot: "<set>" names meshes "<body>/armor/<set>/<slot>". */
  readonly set: string;
  /** Palette colours of its three colour regions: main, second, trim. */
  readonly colors: readonly [number, number, number];
}

/**
 * A resource node: a tree, a rock, a bush. Nodes are map data. Where they
 * stand comes from the map, is the same on every client, and is never saved;
 * only the ones that have been touched are.
 */
export interface NodeDef {
  readonly type: "node";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  /** Collider and graybox half extents; the node stands on its base. */
  readonly half: readonly [number, number, number];
  /** A second box on top of the first, for a crown. Drawn, not collided with. */
  readonly top?: { readonly half: readonly [number, number, number]; readonly color: number };
  /** Bodies walk through it (a bush). It can still be looked at and used. */
  readonly soft?: boolean;
  /** Hits (or picks) before it is used up. */
  readonly hits: number;
  /** In-game hours until it grows back. */
  readonly respawnHours: number;
  /** What kind of tool works on it: matched against a tool's `on`. Omitted for things picked by hand with the use key. */
  readonly material?: string;
  /** What each hit gives: an item and a range. `tool` true means only with the right tool. */
  readonly yields: readonly { readonly item: string; readonly min: number; readonly max: number; readonly tool?: boolean }[];
  /** Experience per hit. */
  readonly xp: number;
}

export interface RecipeDef {
  readonly type: "recipe";
  readonly id: string;
  readonly makes: string;
  readonly count: number;
  readonly needs: readonly { readonly item: string; readonly count: number }[];
  /** Seconds to make one. */
  readonly seconds: number;
  readonly xp: number;
}

export interface EngramDef {
  readonly type: "engram";
  readonly id: string;
  readonly label: string;
  /** Level needed to learn it, and what it costs in engram points. */
  readonly level: number;
  readonly cost: number;
  /** Recipes it unlocks. */
  readonly unlocks: readonly string[];
}

/** The level table: experience needed to reach each level (index 0 is level 1), and engram points gained on reaching it. */
export interface LevelsDef {
  readonly type: "levels";
  readonly id: string;
  readonly xp: readonly number[];
  readonly engramPoints: readonly number[];
}

/**
 * A thing that stands in the world as an entity but does not move or live: an
 * item cache, later a dropped bag or a corpse. It has a body to look at and
 * click on, and its record can hold an inventory.
 */
export interface PropDef {
  readonly type: "prop";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  readonly radius: number;
  readonly height: number;
  /** Inventory slots of its record. */
  readonly slots?: number;
  /** It is drawn tilted to its pitch as well as turned to its facing, its mesh's +Z leading: an arrow stuck where it landed. */
  readonly pitched?: boolean;
}

export type Def = SpeciesDef | StructureDef | ItemDef | PropDef | NodeDef | RecipeDef | EngramDef | LevelsDef;
