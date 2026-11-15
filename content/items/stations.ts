import type { Def } from "../../shared/content/defs.ts";

// Crafting stations and what is made at them (task D of planning/reference/items-plan.md). The campfire, which only cooks
// and burns, stays with the building pieces in content/building.ts.
//
// A station is a structure/station with slots. An item whose craft names it in `at` is made only there, from what lies in
// it, and lands in it (server/progression.ts). Numbers are the wiki's (ark.wiki.gg, looked at 2026-11-15) except where a
// line says chosen.

export const STATIONS: readonly Def[] = [
  // ark.wiki.gg/wiki/Mortar_and_Pestle: 1,000 health, 24 slots, "treated as thatch" (anything but a non-explosive ranged
  // hit harms it); the item weighs 4 and stacks to 100; 65 stone and 15 hide, 5 s, 28.8 xp; level 6, 6 engram points.
  // Its size is chosen: a graybox, drawn from its one box, a little under knee high. It decays in 16 days (decaytime
  // 1382400), not as thatch does.
  { type: "shape", id: "core:shape_mortar", role: "thing", boxes: [{ at: [0, 0, 0], half: [0.3, 0.25, 0.3] }] },
  { type: "structure", class: "station", id: "core:mortar", mesh: "shape", shape: "core:shape_mortar", half: [0.3, 0.25, 0.3], color: 4, hp: 1000, material: "core:mat_thatch", decayDays: 16, slots: 24 },
  {
    type: "item",
    class: "structure",
    id: "core:piece_mortar",
    stack: 100,
    weight: 4,
    label: "mortar and pestle",
    color: 4,
    places: ["core:mortar"],
    craft: { needs: [{ item: "core:stone", count: 65 }, { item: "core:hide", count: 15 }], seconds: 5, xp: 28.8 },
  },
  { type: "engram", id: "core:engram-piece_mortar", label: "Mortar and pestle", level: 6, cost: 6, item: "core:piece_mortar" },

  // ark.wiki.gg/wiki/Sparkpowder: at the mortar and pestle 2 flint and 1 stone make 2 ("each grind will yield 2"), in 1 s
  // for 0.24 xp; stacks to 100, weighs 0.1; level 6, 3 engram points. The chemistry bench's 8 and 4 for 12 waits for it.
  // A piece burns 60 s in a campfire, cooking pot, forge or fireplace (Sparkpowder, Burn Times; Campfire, fuel).
  {
    type: "item",
    class: "resource",
    id: "core:sparkpowder",
    stack: 100,
    weight: 0.1,
    fuel: 60,
    label: "sparkpowder",
    color: 7,
    craft: { needs: [{ item: "core:flint", count: 2 }, { item: "core:stone", count: 1 }], seconds: 1, xp: 0.24, count: 2, at: "core:mortar" },
  },
  { type: "engram", id: "core:engram-sparkpowder", label: "Sparkpowder", level: 6, cost: 3, item: "core:sparkpowder" },
];
