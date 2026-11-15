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

  // ark.wiki.gg/wiki/Smithy (read 2026-11-15): 1,500 health (232.0), 75 slots, decaytime 1382400 (16 days), damaged as
  // wood (CanDamageWood); the item weighs 4 and stacks to 100; 5 ingots, 50 stone, 30 wood and 20 hide in 5 s, craftingxp
  // 6.25 (our 25, D465's four times); level 20, 18 engram points. It burns nothing: what is made at it is made whenever its
  // ingredients lie in it. Its size is the box its art was modelled to (D520).
  { type: "shape", id: "core:shape_smithy", role: "thing", boxes: [{ at: [0, 0, 0], half: [0.8, 0.55, 0.4] }] },
  { type: "structure", class: "station", id: "core:smithy", mesh: "shape", shape: "core:shape_smithy", half: [0.8, 0.55, 0.4], color: 7, hp: 1500, material: "core:mat_wood", decayDays: 16, slots: 75 },
  {
    type: "item",
    class: "structure",
    id: "core:piece_smithy",
    stack: 100,
    weight: 4,
    label: "smithy",
    color: 7,
    places: ["core:smithy"],
    craft: { needs: [{ item: "core:ingot", count: 5 }, { item: "core:stone", count: 50 }, { item: "core:wood", count: 30 }, { item: "core:hide", count: 20 }], seconds: 5, xp: 25 },
  },
  { type: "engram", id: "core:engram-piece_smithy", label: "Smithy", level: 20, cost: 18, item: "core:piece_smithy" },

  // ark.wiki.gg/wiki/Fabricator (read 2026-11-15): 2,500 health, 70 slots, decaytime 1382400 (16 days), "not treated as a
  // metal structure", damaged as wood; the item weighs 4 and stacks to 1 (250.2); made at the smithy of 35 ingots, 20
  // cementing paste, 50 sparkpowder, 15 crystal and 10 oil, craftingxp 33 (our 132); level 48, 24 engram points, after the
  // smithy's. It runs on gasoline alone, "15:00" a piece (900 s; consumption halved in 303.1), burning whether it crafts or
  // not, and "does not work underwater"; turned off, it "uses up the gasoline it was running on" (Stations.toggle loses the
  // piece burning). Its jobs run only while it is on (`powered`, server/power.ts): a unit under way when it runs out waits
  // with its ticks left and goes on when it is lit again, which the page does not say (chosen, stations-plan.md, Decided 3).
  // It cooks nothing. The page gives no crafting time: 5 s, chosen as the smithy's (as DEV135 chooses). Its size is its
  // art's box (D520); lit, it is the same box in the lamps' colour.
  { type: "shape", id: "core:shape_fabricator", role: "thing", boxes: [{ at: [0, 0, 0], half: [0.85, 0.65, 0.45] }] },
  ...(["core:fabricator", "core:fabricator_lit"] as const).map(
    (kind, lit): Def => ({
      type: "structure",
      class: "station",
      id: kind,
      mesh: "shape",
      shape: "core:shape_fabricator",
      half: [0.85, 0.65, 0.45],
      color: lit ? 8 : 9,
      hp: 2500,
      material: "core:mat_wood",
      decayDays: 16,
      slots: 70,
      lights: lit ? "core:fabricator" : "core:fabricator_lit",
      ...(lit ? { lit: true } : {}),
      burns: [{ item: "core:gasoline", seconds: 900 }],
      powered: true,
      dry: true,
      cooks: false,
    }),
  ),
  {
    type: "item",
    class: "structure",
    id: "core:piece_fabricator",
    stack: 1,
    weight: 4,
    label: "fabricator",
    color: 9,
    places: ["core:fabricator"],
    craft: { needs: [{ item: "core:ingot", count: 35 }, { item: "core:paste", count: 20 }, { item: "core:sparkpowder", count: 50 }, { item: "core:crystal", count: 15 }, { item: "core:oil", count: 10 }], seconds: 5, xp: 132, at: "core:smithy" },
  },
  { type: "engram", id: "core:engram-piece_fabricator", label: "Fabricator", level: 48, cost: 24, item: "core:piece_fabricator", requires: ["core:engram-piece_smithy"] },
];
