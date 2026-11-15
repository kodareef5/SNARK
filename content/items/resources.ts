import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

// The materials the stations make and burn (planning/reference/stations-plan.md, S0): each a plain resource with its page's
// weight and stack (ark.wiki.gg, each page's infobox, read 2026-11-15), and no recipe yet. Charcoal and gasoline
// get what makes and burns them from the forge (S1), polymer and electronics their recipes at the fabricator (S2). Oil,
// crystal, obsidian and silica pearls are gathered from the nodes of content/items/nodes.ts. The colours are chosen.

export const RESOURCES: readonly Def[] = [
  // Cementing paste, moved here unchanged from content/building.ts (S0): made in the hand from 4 chitin and 8 stone, as
  // DEV51 says, until it moves to the mortar and pestle with ARK's numbers (S6).
  { type: "item", class: "resource", id: "core:paste", stack: 100, weight: 0.01, label: "cementing paste", color: 15 },
  crafting("core:paste", { needs: [{ item: "core:chitin", count: 4 }, { item: "core:stone", count: 8 }], seconds: 2, xp: 2 }),
  { type: "engram", id: "core:engram-paste", label: "Cementing paste", level: 15, cost: 3, item: "core:paste" },

  // Charcoal: "one Charcoal every time the burning of the current fuel piece has ended" for wood in any fire; no engram.
  { type: "item", class: "resource", id: "core:charcoal", stack: 100, weight: 0.25, label: "charcoal", color: 11 },
  // Gasoline: 5 from 6 oil and 5 hide at the refining forge; burns 900 s in the fabricator.
  { type: "item", class: "resource", id: "core:gasoline", stack: 100, weight: 0.1, label: "gasoline", color: 6 },
  // Oil: oil rocks in the ocean and on the snowy coast, and underwater caves.
  { type: "item", class: "resource", id: "core:oil", stack: 100, weight: 0.2, label: "oil", color: 4 },
  // Crystal: crystal formations in mountains and caves.
  { type: "item", class: "resource", id: "core:crystal", stack: 100, weight: 1, label: "crystal", color: 13 },
  // Obsidian: black rocks at mountain tops, and mountain metal rocks at a reduced rate.
  { type: "item", class: "resource", id: "core:obsidian", stack: 100, weight: 1, label: "obsidian", color: 11 },
  // Silica Pearls: seabed clams.
  { type: "item", class: "resource", id: "core:silica_pearls", stack: 100, weight: 0.02, label: "silica pearls", color: 10 },
  // Polymer: 2 obsidian and 2 cementing paste at the fabricator.
  { type: "item", class: "resource", id: "core:polymer", stack: 100, weight: 0.25, label: "polymer", color: 5 },
  // Electronics: 3 silica pearls and 1 metal ingot at the fabricator.
  { type: "item", class: "resource", id: "core:electronics", stack: 100, weight: 0.01, label: "electronics", color: 9 },
];
