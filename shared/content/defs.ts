// Definitions are plain data keyed by a stable string id ("namespace:name").
// Systems read numbers from the compiled registry and never branch on an id.
// `type` is a definition's family. A family with several classes also says which: shared/content/classes.ts has what
// each class must and may declare.
// The shape of a kind's definitions is in its file under kinds/. Other code takes the types from here.

import type { KINDS } from "./kinds.ts";
import type { RenameDef } from "./kinds/renames.ts";

export type { BuffDef } from "./kinds/buffs.ts";
export type { DamageDef, DamageType } from "./kinds/damage.ts";
export type { EngramDef } from "./kinds/engrams.ts";
export type { GameDef } from "./kinds/game.ts";
export type { CraftFacet, GlideFacet, ItemDef, OpticFacet, UseFacet, WearFacet } from "./kinds/items.ts";
export type { LevelsDef } from "./kinds/levels.ts";
export type { LootCount, LootDef, LootEntry, LootSet } from "./kinds/loot.ts";
export type { MapDef, MapZone } from "./kinds/maps.ts";
export type { MaterialDef } from "./kinds/materials.ts";
export type { NodeDef, NodeShape, NodeVariant } from "./kinds/nodes.ts";
export type { PropDef } from "./kinds/props.ts";
export type { RenameDef } from "./kinds/renames.ts";
export type { PieceRole, ShapeBox, ShapeDef, ShapeLook } from "./kinds/shapes.ts";
export { PIECE_ROLES, shapeHalf } from "./kinds/shapes.ts";
export type { SpawnsDef } from "./kinds/spawns.ts";
export type { CreatureAttackDef, CreatureChargeDef, CreatureCombatFacet, CreatureHarvestFacet, CreatureModeDef, FlyFacet, SpeciesDef } from "./kinds/species.ts";
export type { MotionFacet, PartPlacement, StructureDef } from "./kinds/structures.ts";
export type { AmmoFacet, WeaponFacet } from "./kinds/weapons.ts";

/** A definition of any kind in the list (kinds.ts): what the kinds' hooks are given. */
export type Def = Parameters<NonNullable<(typeof KINDS)[number]["check"]>>[0];

/** Everything but a rename, which is not content. */
export type Content = Exclude<Def, RenameDef>;
