import type { Def } from "../../shared/content/defs.ts";
import { CONSUMABLES } from "./consumables.ts";
import { STATIONS } from "./stations.ts";

// The item program's content (planning/reference/items-plan.md): one file per category, each owned by one task. A new
// category adds its file here and nothing else, so tasks built side by side meet only on this list.

export const ITEMS: readonly Def[] = [...CONSUMABLES, ...STATIONS];
