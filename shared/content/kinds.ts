// Every kind of content. compileContent walks this list (registry.ts), the class table lists the classes in its order
// (classes.ts), and the types `Def` and `Registry` are made from it. A new kind is a file under kinds/ and a line here.
//
// Where the order matters:
// - Two kinds may be over one type, the family's own first: items then weapons, structures then stations. For each
//   definition the second's hook runs after the first's.
// - `survey` and `finish` run in this order. Structures' finish gives an open door and a burning fire the item that
//   places their pair, which items linked. Stations' finish comes after it: it reads which of a lit pair burns
//   (structures) and moves what is made at a lit station to its unlit kind (craftAt, which items linked).
// - The class table is in this order, and the catalogue page with it.
// Nothing else depends on it: every `fill` comes before any `link`, and every `link` before any `finish`, so a kind may
// name any other's definition by its index, and items may write the structures they place.

import { buffs } from "./kinds/buffs.ts";
import { damage } from "./kinds/damage.ts";
import { engrams } from "./kinds/engrams.ts";
import { game } from "./kinds/game.ts";
import { items } from "./kinds/items.ts";
import { levels } from "./kinds/levels.ts";
import { loot } from "./kinds/loot.ts";
import { maps } from "./kinds/maps.ts";
import { materials } from "./kinds/materials.ts";
import { nodes } from "./kinds/nodes.ts";
import { props } from "./kinds/props.ts";
import { renames } from "./kinds/renames.ts";
import { shapes } from "./kinds/shapes.ts";
import { spawns } from "./kinds/spawns.ts";
import { species } from "./kinds/species.ts";
import { stations } from "./kinds/stations.ts";
import { structures } from "./kinds/structures.ts";
import { weapons } from "./kinds/weapons.ts";

export const KINDS = [
  items,
  weapons,
  engrams,
  levels,
  species,
  structures,
  stations,
  shapes,
  materials,
  nodes,
  props,
  buffs,
  damage,
  loot,
  spawns,
  maps,
  game,
  renames,
] as const;
