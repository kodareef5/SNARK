import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

// The materials the stations make and burn (planning/reference/stations-plan.md, S0): each a plain resource with its page's
// weight and stack (ark.wiki.gg, each page's infobox, read 2026-11-15), and no recipe yet. Charcoal and gasoline
// get what makes and burns them from the forge (S1), polymer and electronics their recipes at the fabricator (S2). Oil,
// crystal, obsidian and silica pearls are gathered from the nodes of content/items/nodes.ts. The colours are chosen.

export const RESOURCES: readonly Def[] = [
  { type: "item", class: "resource", id: "core:keratin", stack: 100, weight: 0.01, label: "keratin", color: 15 },
  // Cementing paste, moved here from content/building.ts (S0) and to the mortar and pestle by S6 (ark.wiki.gg, Cementing
  // Paste, infobox, 2026-11-15): 4 chitin (keratin and shell fragments are alternative ingredients in ARK; chitin alone is a whole
  // recipe) and 8 stone at the mortar and pestle, one a grind in 1 s, craftingxp 1.2 (our 4.8, D465's four times); level
  // 13, 3 engram points. The chemistry bench's recipe waits for the bench.
  { type: "item", class: "resource", id: "core:paste", stack: 100, weight: 0.01, label: "cementing paste", color: 15 },
  ...crafting("core:paste", { needs: [{ item: "core:chitin", count: 4 }, { item: "core:stone", count: 8 }], seconds: 1, xp: 4.8, at: "core:mortar" }),
  { type: "engram", id: "core:engram-paste", label: "Cementing paste", level: 13, cost: 3, item: "core:paste" },

  // Charcoal: "one Charcoal every time the burning of the current fuel piece has ended" for wood in any fire; no engram.
  // Wood leaves it (`burnsInto`, content/core.ts), so every fire that burns wood makes it (S1).
  { type: "item", class: "resource", id: "core:charcoal", stack: 100, weight: 0.25, label: "charcoal", color: 11 },
  // Gasoline: 5 from 6 oil and 5 hide at the refining forge, made by the forge itself while it burns (fired, S1), in 10 s:
  // the forge's refining table, whose two rows agree (6 oil and 5 hide in 10 s; 240 oil and 200 hide in 6 m 40 s). The
  // Gasoline page's 30 s is unverified (Decided 5, D519). No engram, no experience. Burns 900 s in the fabricator.
  {
    type: "item",
    class: "resource",
    id: "core:gasoline",
    stack: 100,
    weight: 0.1,
    label: "gasoline",
    color: 6,
    craft: { needs: [{ item: "core:oil", count: 6 }, { item: "core:hide", count: 5 }], seconds: 10, xp: 0, count: 5, at: "core:forge", fired: true },
  },
  // Oil: oil rocks in the ocean and on the snowy coast, and underwater caves.
  { type: "item", class: "resource", id: "core:oil", stack: 100, weight: 0.2, label: "oil", color: 4 },
  // Crystal: crystal formations in mountains and caves.
  { type: "item", class: "resource", id: "core:crystal", stack: 100, weight: 1, label: "crystal", color: 13 },
  // Obsidian: black rocks at mountain tops, and mountain metal rocks at a reduced rate.
  { type: "item", class: "resource", id: "core:obsidian", stack: 100, weight: 1, label: "obsidian", color: 11 },
  // Silica Pearls: seabed clams.
  { type: "item", class: "resource", id: "core:silica_pearls", stack: 100, weight: 0.02, label: "silica pearls", color: 10 },
  // Polymer: 2 obsidian and 2 cementing paste at the fabricator, one a craft in 2 s, craftingxp 0.56 (our 2.24, D465's
  // four times); level 48, 6 engram points (Polymer, S2).
  { type: "item", class: "resource", id: "core:polymer", stack: 100, weight: 0.25, label: "polymer", color: 5 },
  ...crafting("core:polymer", { needs: [{ item: "core:obsidian", count: 2 }, { item: "core:paste", count: 2 }], seconds: 2, xp: 2.24, at: "core:fabricator" }),
  { type: "engram", id: "core:engram-polymer", label: "Polymer", level: 48, cost: 6, item: "core:polymer" },
  // Electronics: 3 silica pearls and 1 metal ingot at the fabricator, one a craft in 2 s, craftingxp 0.76 (our 3.04);
  // level 48, 6 engram points (Electronics, S2).
  { type: "item", class: "resource", id: "core:electronics", stack: 100, weight: 0.01, label: "electronics", color: 9 },
  ...crafting("core:electronics", { needs: [{ item: "core:silica_pearls", count: 3 }, { item: "core:ingot", count: 1 }], seconds: 2, xp: 3.04, at: "core:fabricator" }),
  { type: "engram", id: "core:engram-electronics", label: "Electronics", level: 48, cost: 6, item: "core:electronics" },
];
