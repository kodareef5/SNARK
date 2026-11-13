// Content definitions: immutable data describing what can exist.
//
// Definitions are plain data keyed by a stable string id ("namespace:name").
// Systems read numbers from the compiled registry; no system branches on an id.

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
  /** Food capacity and loss per in-game hour. Omitted for species that do not eat. */
  readonly food?: { readonly max: number; readonly perHour: number };
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
  readonly stack: number;
}

export type Def = SpeciesDef | StructureDef | ItemDef;
