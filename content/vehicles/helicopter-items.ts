import type { Def } from "../../shared/content/defs.ts";

/** SNARK's progression choice: a substantial fabricator project, with ordinary repair materials. */
export const HELICOPTER_ITEMS: readonly Def[] = [
  {
    type: "item", class: "vehicle", id: "core:helicopter_assembly", aliases: ["helicopter_assembly", "heli_kit"],
    label: "Utility helicopter assembly", stack: 1, weight: 75, color: 41, deploys: "core:helicopter",
    blueprint: false,
    craft: { at: "core:fabricator", seconds: 180, xp: 1200, level: 68, needs: [
      { item: "core:ingot", count: 1600 }, { item: "core:polymer", count: 300 },
      { item: "core:electronics", count: 250 }, { item: "core:crystal", count: 200 }, { item: "core:paste", count: 300 },
    ] },
  },
  { type: "engram", id: "core:engram-helicopter_assembly", label: "Utility helicopter", level: 68, cost: 45, item: "core:helicopter_assembly" },
];
