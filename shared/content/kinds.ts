// Every kind of content, in the order compileContent walks them (registry.ts) and the class table lists their classes
// (classes.ts). A new kind is a file under kinds/ and a line here.

import { buffs } from "./kinds/buffs.ts";
import { damage } from "./kinds/damage.ts";
import { engrams } from "./kinds/engrams.ts";
import { game } from "./kinds/game.ts";
import { levels } from "./kinds/levels.ts";
import { loot } from "./kinds/loot.ts";
import { maps } from "./kinds/maps.ts";
import { materials } from "./kinds/materials.ts";
import { renames } from "./kinds/renames.ts";
import { shapes } from "./kinds/shapes.ts";
import { spawns } from "./kinds/spawns.ts";

export const KINDS = [engrams, levels, shapes, materials, buffs, damage, loot, spawns, maps, game, renames] as const;
