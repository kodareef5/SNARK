import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

// Things used for what they do to a body, beyond the foods creatures are tamed and kept on (content/foods.ts) and what
// knocks a body out (content/knockout.ts). Task C of planning/reference/items-plan.md builds what using one does. The
// numbers are the wiki's (ark.wiki.gg) except where a line says chosen.

export const CONSUMABLES: readonly Def[] = [
  { type: "item", class: "consumable", id: "core:waterskin", stack: 1, weight: 1, eat: { water: 60 }, label: "water skin", color: 14 },
  crafting("core:waterskin", { needs: [{ item: "core:fiber", count: 20 }, { item: "core:thatch", count: 5 }], seconds: 4, xp: 3 }),
  { type: "engram", id: "core:engram-waterskin", label: "Water skin", level: 3, cost: 6, item: "core:waterskin" },
];
