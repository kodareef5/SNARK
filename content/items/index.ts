import type { Def } from "../../shared/content/defs.ts";
import { AMMO } from "./ammo.ts";
import { BALLS } from "./balls.ts";
import { BLOCKOUTS } from "./blockouts.ts";
import { CONSUMABLES } from "./consumables.ts";
import { EXPLOSIVES } from "./explosives.ts";
import { GLIDERS } from "./gliders.ts";
import { RESOURCE_NODES } from "./nodes.ts";
import { RESOURCES } from "./resources.ts";
import { STATIONS } from "./stations.ts";
import { WEAPONS } from "./weapons.ts";

// The item program's content (planning/reference/items-plan.md), and the weapons program's (weapons-plan.md): one file per
// category, each owned by one task. A new category adds its file here and nothing else, so tasks built side by side meet
// only on this list.

export const ITEMS: readonly Def[] = [...CONSUMABLES, ...STATIONS, ...WEAPONS, ...AMMO, ...EXPLOSIVES, ...RESOURCES, ...RESOURCE_NODES, ...GLIDERS, ...BALLS, ...BLOCKOUTS];
