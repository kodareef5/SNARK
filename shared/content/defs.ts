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
  /** Palette index used by graybox meshes. */
  readonly color: number;
  readonly radius: number;
  readonly height: number;
  readonly eyeHeight: number;
  readonly walkSpeed: number;
  readonly sprintMul: number;
  readonly jumpSpeed: number;
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
  /** How points become values, per stat: [base, gain per wild point, gain per tamed point]. */
  readonly stats?: { readonly [S in StatName]?: StatCurve };
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
}

export type Def = SpeciesDef | StructureDef | ItemDef | PropDef | NodeDef | RecipeDef | EngramDef | LevelsDef;
