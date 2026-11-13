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

export type Def = SpeciesDef | StructureDef | ItemDef | PropDef;
