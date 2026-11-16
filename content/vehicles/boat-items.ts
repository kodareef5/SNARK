import type { Def } from "../../shared/content/defs.ts";

/** A substantial fabricator project; ordinary fuel and repair materials keep a found hull useful. */
export const BOAT_ITEMS: readonly Def[] = [
  {
    type: "item", class: "vehicle", id: "core:boat_assembly", aliases: ["boat_assembly", "boat_kit"],
    label: "Utility motorboat assembly", stack: 1, weight: 60, color: 41, deploys: "core:boat",
    blueprint: false,
    craft: { at: "core:fabricator", seconds: 120, xp: 750, level: 54, needs: [
      { item: "core:ingot", count: 900 }, { item: "core:polymer", count: 220 },
      { item: "core:electronics", count: 120 }, { item: "core:crystal", count: 80 }, { item: "core:paste", count: 180 },
    ] },
  },
  { type: "engram", id: "core:engram-boat_assembly", label: "Utility motorboat", level: 54, cost: 35, item: "core:boat_assembly" },
];
