import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

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

  // The refining forge (planning/reference/stations-plan.md, S1). ark.wiki.gg/wiki/Refining_Forge: 2,500 health, 24 slots,
  // decays in 16 days, damaged as wood; the item weighs 4 and stacks to 100; 125 stone, 5 flint, 65 hide, 20 wood and 40
  // fiber for 74.4 xp (its seconds are not given: 5, as DEV135 chooses for a station); level 20, 21 engram points, after
  // the campfire. It burns the campfire's fuels at their own times (thatch 7.5 s, wood 30, sparkpowder 60), so it names
  // none of its own; it is lit and put out as a campfire is, and cooks nothing. "Gasoline and Metal Ingots can smelt at
  // the same time, with both timers running simultaneously": each is fired at it, in a lane of its own (the ingot in
  // content/core.ts, gasoline in content/items/resources.ts). It "cannot be sitting on a foundation submerged in water".
  // Its size is the box its art was modelled to (Decided 7, D520).
  { type: "shape", id: "core:shape_forge", role: "thing", boxes: [{ at: [0, 0, 0], half: [0.6, 0.85, 0.6] }] },
  { type: "structure", class: "station", id: "core:forge", mesh: "shape", shape: "core:shape_forge", half: [0.6, 0.85, 0.6], color: 5, hp: 2500, material: "core:mat_wood", decayDays: 16, slots: 24, lights: "core:forge_lit", cooks: false, dry: true },
  { type: "structure", class: "station", id: "core:forge_lit", mesh: "shape", shape: "core:shape_forge", half: [0.6, 0.85, 0.6], color: 8, hp: 2500, material: "core:mat_wood", decayDays: 16, slots: 24, lights: "core:forge", lit: true, cooks: false, dry: true },
  {
    type: "item",
    class: "structure",
    id: "core:piece_forge",
    stack: 100,
    weight: 4,
    label: "refining forge",
    color: 5,
    places: ["core:forge"],
    craft: {
      needs: [
        { item: "core:stone", count: 125 },
        { item: "core:flint", count: 5 },
        { item: "core:hide", count: 65 },
        { item: "core:wood", count: 20 },
        { item: "core:fiber", count: 40 },
      ],
      seconds: 5,
      xp: 74.4,
    },
  },
  { type: "engram", id: "core:engram-piece_forge", label: "Refining forge", level: 20, cost: 21, item: "core:piece_forge", requires: ["core:engram-piece_campfire"] },

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

  // The tek workstation: a steel desk with a laptop and a console on it (assets/source/core/props/screens), whose screen
  // shows the laptops' channel. The plasma guns are made at it (content/items/plasma.ts), as ARK makes them at its Tek
  // Replicator. Its numbers are ours, as the replicator's want element, which the game has not: 3,500 health, harmed as
  // metal; 60 slots; it burns nothing, as the smithy does not, and decays in 16 days as the fabricator does. It is made
  // at the fabricator, at level 90 for 40 points, after the fabricator. Its face is its model's (faces.json there).
  { type: "shape", id: "core:shape_workstation", role: "thing", boxes: [{ at: [0, 0, 0], half: [1, 0.5428, 0.4736] }] },
  {
    type: "structure", class: "station", id: "core:workstation", mesh: "shape", shape: "core:shape_workstation", half: [1, 0.5428, 0.4736], color: 84,
    hp: 3500, material: "core:mat_metal", decayDays: 16, slots: 60,
    screen: { type: "laptop", face: [-0.4217, -0.1781, 0.3267, 0.5253, -0.0552] },
  },
  { type: "item", class: "structure", id: "core:piece_workstation", stack: 1, weight: 10, label: "tek workstation", color: 84, places: ["core:workstation"] },
  ...making("piece_workstation", "Tek workstation", 90, 40, 1, 10, [["ingot", 150], ["polymer", 80], ["electronics", 60], ["crystal", 60], ["silica_pearls", 30], ["paste", 40]], undefined, "fabricator")
    .map((d) => (d.type === "engram" ? { ...d, requires: ["core:engram-piece_fabricator"] } : d)),

  // The preserving bin (planning/reference/stations-plan.md, S3). ark.wiki.gg/wiki/Preserving_Bin: 48 item slots (303.1),
  // 600 health, decays in 16 days (decaytime 1382400); the item weighs 4 and stacks to 100; 30 stone, 30 wood, 10 thatch
  // and 20 fiber in the hand for 6.9 xp, our 27.6 (D465); level 18, 9 engram points, after the storage box. It is "fueled
  // by Sparkpowder", which it alone burns, and "a single Sparkpowder in the bin will keep it running for 30 minutes";
  // while it runs "any eligible perishables will have their spoil timer increased by a multiplier of 10" (also Spoilage's
  // table, 10x), so only its lit kind keeps 10 times as long, and it cooks nothing. Its crafting seconds are chosen (the
  // page gives no craftingtime), 5 as the other pieces'; its material is chosen as wood; its box is the art's (D520).
  { type: "shape", id: "core:shape_preserving_bin", role: "thing", boxes: [{ at: [0, 0, 0], half: [0.4, 0.6, 0.35] }] },
  ...binPair(),
  {
    type: "item",
    class: "structure",
    id: "core:piece_preserving_bin",
    stack: 100,
    weight: 4,
    label: "preserving bin",
    color: 3,
    places: ["core:preserving_bin"],
    craft: { needs: [{ item: "core:stone", count: 30 }, { item: "core:wood", count: 30 }, { item: "core:thatch", count: 10 }, { item: "core:fiber", count: 20 }], seconds: 5, xp: 27.6 },
  },
  { type: "engram", id: "core:engram-piece_preserving_bin", label: "Preserving bin", level: 18, cost: 9, item: "core:piece_preserving_bin", requires: ["core:engram-piece_storage_box"] },
];

/** The preserving bin out and lit: one station (D515), alike but for the colour and the lit kind's keeping. */
function binPair(): Def[] {
  const both = { type: "structure", class: "station", mesh: "shape", shape: "core:shape_preserving_bin", half: [0.4, 0.6, 0.35], hp: 600, material: "core:mat_wood", decayDays: 16, slots: 48, burns: [{ item: "core:sparkpowder", seconds: 1800 }], cooks: false } as const;
  return [
    { ...both, id: "core:preserving_bin", color: 3, lights: "core:preserving_bin_lit" },
    { ...both, id: "core:preserving_bin_lit", color: 8, lights: "core:preserving_bin", lit: true, keeps: 10 },
  ];
}
