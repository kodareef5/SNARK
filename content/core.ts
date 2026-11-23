import { BOX_TRAILER } from "./vehicles/box-trailer.ts";
import { TANKER_WRECKS } from "./vehicles/tanker-wrecks.ts";
// Colours are palette indices. See shared/pack/palette.ts.

import type { Def, NodeDef, NodeVariant } from "../shared/content/defs.ts";
import { BUILDING_CONTENT } from "./building.ts";
import { CORPSES } from "./corpses.ts";
import { crafted, crafting, making } from "./craft.ts";
import { CREATURES } from "./creatures/index.ts";
import { EGGS } from "./eggs.ts";
import { FOODS } from "./foods.ts";
import { ITEMS } from "./items/index.ts";
import { KNOCKOUT } from "./knockout.ts";
import { MAPS } from "./maps.ts";
import { RUIN_BLOCKS } from "./miami-ruins.ts";
import { SLOPE_BLOCKS } from "./slopes.ts";
import { LETTER_BLOCKS } from "./lettering.ts";
import { TERMINALS } from "./terminals.ts";
import { SPAWNS } from "./spawns.ts";
import { STREET } from "./street.ts";
import { ROADS } from "./vehicles/roads.ts";
import { ROAD_FLEET } from "./vehicles/road-fleet.ts";
import { WRECKS } from "./vehicles/wrecks.ts";
import { MARINE_FLEET } from "./vehicles/marine-fleet.ts";
import { HARBOUR_WRECKS } from "./vehicles/harbour-wrecks.ts";
import { DOCKS } from "./docks.ts";
import { BOATS } from "./vehicles/boat.ts";
import { BOAT_ITEMS } from "./vehicles/boat-items.ts";
import { SKATEBOARDS } from "./vehicles/skateboard.ts";
import { HELICOPTERS } from "./vehicles/helicopter.ts";
import { HELICOPTER_ITEMS } from "./vehicles/helicopter-items.ts";
import { CIVILIAN } from "./civilians.ts";
import type { ContentPack } from "../shared/content/packs.ts";

const id = (name: string): string => `core:${name}`;
/** Real minutes, as the hours of 140 seconds that spoiling is written in. */
const minutes = (n: number): number => (n * 60) / 140;

// Every piece of an armor tier has the same rating and durability, so a full set rates five times one piece. `weight` is
// every piece's, or each piece's by its name.
type PerPiece = Readonly<Record<string, number>>;
const ARMOR_TIERS: readonly { tier: string; set: string; armor: number; uses: number; weight: number | PerPiece; colors: readonly [number, number, number] }[] = [
  { tier: "cloth", set: "cloth", armor: 10, uses: 25, weight: 0.4, colors: [1, 15, 225] },
  { tier: "hide", set: "hide", armor: 20, uses: 45, weight: 1.5, colors: [227, 228, 225] },
  // ark.wiki.gg, Chitin Helmet, Chitin Chestpiece, Chitin Gauntlets, Chitin Leggings and Chitin Boots, and the same of Flak,
  // infoboxes, 2026-11-15 (stations S6): each piece's weight.
  { tier: "chitin", set: "hide", armor: 50, uses: 50, weight: { hat: 4, shirt: 6, gloves: 3, pants: 6, boots: 3 }, colors: [9, 4, 1] },
  { tier: "flak", set: "hide", armor: 100, uses: 120, weight: { hat: 4, shirt: 10, gloves: 2, pants: 10, boots: 4 }, colors: [2, 11, 6] },
];
const ARMOR_PIECES: readonly { slot: "head" | "torso" | "hands" | "legs" | "feet"; name: string; label: string }[] = [
  { slot: "head", name: "hat", label: "hat" },
  { slot: "torso", name: "shirt", label: "shirt" },
  { slot: "hands", name: "gloves", label: "gloves" },
  { slot: "legs", name: "pants", label: "pants" },
  { slot: "feet", name: "boots", label: "boots" },
];
const ARMOR: Def[] = ARMOR_TIERS.flatMap((t) =>
  ARMOR_PIECES.map((p): Def => ({ type: "item", class: "armor", id: id(`${t.tier}_${p.name}`), stack: 1, weight: typeof t.weight === "number" ? t.weight : t.weight[p.name]!, label: `${t.tier} ${p.label}`, color: t.colors[0], wear: { slot: p.slot, armor: t.armor, uses: t.uses, set: t.set, colors: t.colors } })),
);

const GEAR: Def[] = [
  { type: "item", class: "resource", id: id("hide"), stack: 200, weight: 0.01, color: 227 },
  { type: "item", class: "resource", id: id("chitin"), stack: 100, weight: 0.05, color: 9 },
  { type: "item", class: "resource", id: id("ore"), stack: 300, weight: 1, label: "metal ore", color: 4 },
  // ark.wiki.gg Metal Ingot and Refining Forge: "2 pieces of Metal can be smelted to create a Metal Ingot", 20 s each at the
  // refining forge, which makes it by itself while it burns and ore lies in it (fired, planning/reference/stations-plan.md,
  // S1): no engram, no hand recipe, no experience (neither page gives any).
  { type: "item", class: "resource", id: id("ingot"), stack: 300, weight: 1, label: "metal ingot", color: 2, craft: { needs: [{ item: id("ore"), count: 2 }], seconds: 20, xp: 0, at: id("forge"), fired: true } },
  { type: "item", class: "resource", id: id("gunpowder"), stack: 100, weight: 0.1, color: 11 },
  // Eaten, 8 health and 40 torpor over 8 seconds ("Increases your health, but puts you to sleep", ark.wiki.gg, Narcotic,
  // 2026-11-15).
  { type: "item", class: "consumable", id: id("narcotic"), stack: 100, weight: 0.1, color: 9, eat: { health: 8 }, dose: { torpor: 40, seconds: 8 } },

  { type: "item", class: "weapon", id: id("spear"), stack: 1, weight: 2, color: 3, weapon: { kind: "melee", damage: 30, type: "pierce", reach: 3, uses: 20, mesh: id("spear"), hold: "spear" } },
  ...ARMOR,
  ...ARMOR_PIECES.flatMap((piece, i): Def[] => {
    const item = id(`meridian_${piece.name}`);
    const label = ["Meridian helmet", "Meridian flight cuirass", "Meridian gloves", "Meridian greaves", "Meridian boots"][i]!;
    // The tier above flak, at the figures of ARK's Tek pieces: armor 180 and durability 300 each, and weights of 4, 6, 3,
    // 6 and 3 for helmet, chestpiece, gauntlets, leggings and boots (ark.wiki.gg, Tek Armor, infobox, 2026-11-18). It
    // was first a refit of flak at flak's own 100 and 120.
    return [
      { type: "item", class: "armor", id: item, label, stack: 1, color: 93, weight: [4, 6, 3, 6, 3][i]!,
        wear: { slot: piece.slot, set: "meridian", armor: 180, uses: 300, colors: [93, 82, 41], jet: true, ...(piece.slot === "head" ? { sealed: true } : {}), ...(piece.slot === "torso" ? { vents: "vents" } : piece.slot === "feet" ? { vents: "boot_jets" } : {}) },
        // The helmet's visor (D1080): its glass to 25 times, and past it a picture made larger as far as 1,000, its window
        // a slit at the most. ARK's Tek helmet zooms and has night vision; the heat view is ours (DEV211).
        ...(piece.slot === "head" ? { optic: { min: 2, max: 1000, window: [0.86, 0.22], shape: "visor" } as const } : {}),
        craft: { at: id("fabricator"), seconds: 5, xp: 0, needs: [
          { item: id(`flak_${piece.name}`), count: 1 }, { item: id("crystal"), count: 2 }, { item: id("electronics"), count: 1 },
        ] } },
      { type: "engram", id: id(`engram-meridian_${piece.name}`), label, level: 56, cost: 0, item,
        requires: [id(`engram-flak_${piece.name}`)] },
    ];
  }),
];

type Needs = readonly (readonly [item: string, count: number])[];

/**
 * level and cost are the tier engram's level and points, `cost` every piece's or each piece's by its name; `xp` each
 * piece's Crafting XP where the pages give it (else a third of the level); `at` the station it is made at, else the hand.
 */
const ARMOR_MAKING: Readonly<Record<string, { level: number; cost: number | PerPiece; xp?: PerPiece; at?: string; needs: Readonly<Record<string, Needs>> }>> = {
  cloth: { level: 3, cost: 3, needs: { hat: [["fiber", 10]], shirt: [["fiber", 40]], gloves: [["fiber", 20]], pants: [["fiber", 50]], boots: [["fiber", 25], ["hide", 6]] } },
  hide: { level: 15, cost: 9, needs: { hat: [["hide", 15], ["fiber", 6]], shirt: [["hide", 20], ["fiber", 8]], gloves: [["hide", 10], ["fiber", 4]], pants: [["hide", 25], ["fiber", 10]], boots: [["hide", 12], ["fiber", 5]] } },
  // Chitin and flak are made at the smithy, as ARK makes them (stations S6), at each piece's page (the infoboxes named above
  // ARMOR_TIERS, 2026-11-15): level, engram points, ingredients and craftingxp, shown times the global 4 of patches 253.0
  // and 313.5 (D465). No page gives a crafting time: 5 s is ours (DEV135).
  chitin: { level: 37, cost: { hat: 18, shirt: 18, gloves: 15, pants: 15, boots: 15 }, xp: { hat: 7.6, shirt: 10.4, gloves: 5.2, pants: 12.8, boots: 6.4 }, at: "smithy", needs: { hat: [["chitin", 15], ["hide", 7], ["fiber", 3]], shirt: [["chitin", 20], ["hide", 10], ["fiber", 4]], gloves: [["chitin", 10], ["hide", 5], ["fiber", 2]], pants: [["chitin", 25], ["hide", 12], ["fiber", 5]], boots: [["chitin", 12], ["hide", 6], ["fiber", 4]] } },
  flak: { level: 56, cost: { hat: 20, shirt: 18, gloves: 16, pants: 15, boots: 16 }, xp: { hat: 17.64, shirt: 23.12, gloves: 10.76, pants: 28.4, boots: 14.32 }, at: "smithy", needs: { hat: [["ingot", 10], ["hide", 7], ["fiber", 3]], shirt: [["ingot", 13], ["hide", 10], ["fiber", 4]], gloves: [["ingot", 6], ["hide", 5], ["fiber", 2]], pants: [["ingot", 16], ["hide", 12], ["fiber", 5]], boots: [["ingot", 8], ["hide", 6], ["fiber", 4]] } },
};

// Trees, rocks and bushes. As in the reference game, every tree gives thatch and wood, the hatchet more wood; every rock gives
// stone and flint, the pick more flint; every bush is picked by hand for fibre and what it bears. A bigger kind gives more in
// all by taking more blows. Each grows at sizes through its range, turned every way. Until a kind names its variants it is
// drawn as the grey box of its `half`, with its `top` for a crown.
// A used-up node grows back an hour after, as the reference game's metal rocks do; its wiki gives no other figure, and says
// only that nodes are back after some hours where no survivor and nothing built is near.
const REGROW = minutes(60);
const TREE_YIELDS: NodeDef["yields"] = [{ item: "core:thatch", min: 2, max: 4 }, { item: "core:wood", min: 0, max: 1 }, { item: "core:wood", min: 1, max: 2, tool: true }];
const ROCK_YIELDS: NodeDef["yields"] = [{ item: "core:stone", min: 1, max: 2 }, { item: "core:flint", min: 1, max: 2, tool: true }];
const tree = (name: string, hits: number, half: NodeDef["half"], top: NonNullable<NodeDef["top"]>, size: NodeDef["size"], variants: NodeVariant[]): NodeDef => ({ type: "node", id: id(name), mesh: "box", color: 3, half, top, hits, respawnHours: REGROW, material: "wood", yields: TREE_YIELDS, xp: 1, size, variants });
const plant = (name: string, color: number, hits: number, half: NodeDef["half"], yields: NodeDef["yields"], size: NodeDef["size"], variants: NodeVariant[]): NodeDef => ({ type: "node", id: id(name), mesh: "box", color, half, soft: true, hits, respawnHours: REGROW, yields, xp: 0.5, size, variants });

// What each kind grows as, with what is left of it used up, as the art's makers print them: `python3
// assets/source/core/nodes/trees/content.py`, `bun assets/source/core/nodes/plants/facts.ts` and `python3
// assets/source/core/nodes/rocks/content.py`. A plant's first individual is the grown one, and grows twice as often as
// each of the others.
const PALMS: NodeVariant[] = [
  { mesh: "core:palm_1", weight: 3, boxes: [{ at: [0.01, 0.99, 0.01], half: [0.26, 1.21, 0.26] }, { at: [0.03, 3, 0.02], half: [0.24, 0.8, 0.24] }, { at: [0.05, 4.6, 0.03], half: [0.26, 0.8, 0.26] }, { at: [0.07, 6.2, 0.05], half: [0.26, 0.8, 0.26] }, { at: [0.09, 7.8, 0.08], half: [0.25, 0.8, 0.25] }, { at: [0.12, 9.4, 0.11], half: [0.23, 0.8, 0.23] }, { at: [0.15, 11, 0.14], half: [0.21, 0.8, 0.21] }, { at: [0.18, 12.6, 0.18], half: [0.19, 0.8, 0.2] }, { at: [0.21, 14.1, 0.22], half: [0.18, 0.7, 0.18] }],
    depleted: { mesh: "core:palm_1_depleted", boxes: [{ at: [0, 0.085, 0], half: [0.26, 0.305, 0.26] }] } },
  { mesh: "core:palm_2", weight: 2, boxes: [{ at: [-0.04, 0.96, 0.05], half: [0.28, 1.24, 0.29] }, { at: [-0.12, 2.99, 0.15], half: [0.26, 0.8, 0.27] }, { at: [-0.2, 4.59, 0.26], half: [0.27, 0.8, 0.29] }, { at: [-0.29, 6.18, 0.39], half: [0.28, 0.8, 0.3] }, { at: [-0.38, 7.77, 0.52], half: [0.25, 0.8, 0.27] }, { at: [-0.47, 9.36, 0.66], half: [0.22, 0.8, 0.25] }, { at: [-0.54, 10.96, 0.79], half: [0.2, 0.8, 0.23] }, { at: [-0.6, 12.2, 0.9], half: [0.16, 0.45, 0.18] }],
    depleted: { mesh: "core:palm_2_depleted", boxes: [{ at: [0, 0.095, 0], half: [0.24, 0.295, 0.24] }] } },
  { mesh: "core:palm_3", weight: 2, boxes: [{ at: [-0.01, 1.02, -0.02], half: [0.18, 1.18, 0.19] }, { at: [-0.03, 3, -0.07], half: [0.17, 0.8, 0.19] }, { at: [-0.04, 4.6, -0.12], half: [0.16, 0.8, 0.19] }, { at: [-0.04, 6.1, -0.19], half: [0.14, 0.7, 0.17] }],
    depleted: { mesh: "core:palm_3_depleted", boxes: [{ at: [0, 0.125, 0], half: [0.17, 0.265, 0.17] }] } },
  { mesh: "core:palm_4", weight: 3, boxes: [{ at: [0.09, 0.85, 0.14], half: [0.39, 1.31, 0.44] }, { at: [0.37, 2.9, 0.55], half: [0.33, 0.73, 0.42] }, { at: [0.77, 4.32, 1.15], half: [0.35, 0.7, 0.47] }, { at: [1.18, 5.72, 1.82], half: [0.35, 0.69, 0.48] }, { at: [1.58, 7.12, 2.47], half: [0.34, 0.71, 0.45] }, { at: [1.96, 8.57, 3.02], half: [0.31, 0.74, 0.37] }, { at: [2.28, 10.08, 3.43], half: [0.27, 0.77, 0.29] }, { at: [2.52, 11.44, 3.67], half: [0.21, 0.59, 0.2] }],
    depleted: { mesh: "core:palm_4_depleted", boxes: [{ at: [0, 0.065, 0], half: [0.3, 0.325, 0.3] }] } },
  { mesh: "core:palm_5", weight: 2, boxes: [{ at: [-0.16, 0.88, -0.01], half: [0.44, 1.28, 0.29] }, { at: [-0.56, 2.92, -0.06], half: [0.37, 0.75, 0.17] }, { at: [-0.86, 4.47, -0.14], half: [0.2, 0.8, 0.18] }, { at: [-0.98, 6.06, -0.23], half: [0.17, 0.8, 0.17] }, { at: [-1.06, 7.66, -0.31], half: [0.16, 0.8, 0.16] }, { at: [-1.13, 9.15, -0.37], half: [0.15, 0.7, 0.14] }],
    depleted: { mesh: "core:palm_5_depleted", boxes: [{ at: [0, 0.075, 0], half: [0.28, 0.315, 0.28] }] } },
  { mesh: "core:palm_6", weight: 2, boxes: [{ at: [0.03, 0.87, -0.15], half: [0.37, 1.31, 0.48] }, { at: [0.12, 2.93, -0.55], half: [0.21, 0.76, 0.41] }, { at: [0.23, 4.43, -1.1], half: [0.21, 0.74, 0.46] }, { at: [0.3, 5.94, -1.6], half: [0.16, 0.78, 0.34] }, { at: [0.26, 7.51, -1.79], half: [0.2, 0.79, 0.18] }, { at: [0.12, 9.09, -1.62], half: [0.22, 0.78, 0.28] }, { at: [-0.02, 10.66, -1.37], half: [0.19, 0.79, 0.25] }, { at: [-0.08, 12.25, -1.19], half: [0.14, 0.8, 0.19] }, { at: [-0.08, 13.35, -1.15], half: [0.14, 0.3, 0.13] }],
    depleted: { mesh: "core:palm_6_depleted", boxes: [{ at: [0, 0.055, 0], half: [0.33, 0.335, 0.33] }] } },
];
const YOUNG: NodeVariant[] = [
  { mesh: "core:tree_1", weight: 3, boxes: [{ at: [0.06, 1.47, 0.05], half: [0.25, 1.73, 0.24] }],
    depleted: { mesh: "core:tree_1_depleted", boxes: [{ at: [0, 0.115, 0], half: [0.2, 0.275, 0.2] }] } },
  { mesh: "core:tree_2", weight: 3, boxes: [{ at: [-0.06, 1.67, -0.02], half: [0.28, 1.93, 0.25] }],
    depleted: { mesh: "core:tree_2_depleted", boxes: [{ at: [0, 0.095, 0], half: [0.23, 0.295, 0.23] }] } },
  { mesh: "core:tree_3", weight: 2, boxes: [{ at: [0.05, 1.37, -0.09], half: [0.33, 1.73, 0.37] }],
    depleted: { mesh: "core:tree_3_depleted", boxes: [{ at: [0, 0.075, 0], half: [0.29, 0.315, 0.29] }] } },
  { mesh: "core:tree_4", weight: 2, boxes: [{ at: [-0.18, 1.4, 0.31], half: [0.39, 2, 0.53] }],
    depleted: { mesh: "core:tree_4_depleted", boxes: [{ at: [0, 0.105, 0], half: [0.22, 0.285, 0.22] }] } },
];
const PRINTED_OAKS: NodeVariant[] = [
  { mesh: "core:oak_1", weight: 3, boxes: [{ at: [0, 0.96, 0], half: [0.79, 1.64, 0.79] }, { at: [-0.83, 2.77, -0.51], half: [0.41, 0.51, 0.41] }, { at: [-1.61, 2.89, -0.97], half: [0.65, 0.49, 0.54] }, { at: [0.78, 2.61, 0.45], half: [0.61, 0.61, 0.5] }, { at: [1.79, 2.87, 0.67], half: [0.63, 0.47, 0.39] }, { at: [-0.44, 2.7, 0.73], half: [0.42, 0.54, 0.49] }, { at: [-0.85, 3.28, 1.57], half: [0.46, 0.6, 0.66] }, { at: [0.32, 2.63, -0.89], half: [0.36, 0.45, 0.36] }, { at: [0.54, 2.94, -1.52], half: [0.42, 0.53, 0.55] }],
    depleted: { mesh: "core:oak_1_depleted", boxes: [{ at: [0, -0.165, 0], half: [0.83, 0.535, 0.83] }] } },
  { mesh: "core:oak_2", weight: 2, boxes: [{ at: [0, 0.95, 0], half: [1.05, 1.85, 1.05] }, { at: [1.41, 3.12, 0.7], half: [0.82, 0.72, 0.67] }, { at: [-1.69, 3.06, 0.3], half: [0.85, 0.68, 0.56] }, { at: [0.03, 3.48, 0.88], half: [0.43, 0.53, 0.43] }, { at: [0.07, 4.16, 1.74], half: [0.43, 0.83, 0.84] }, { at: [-0.37, 3.14, -0.77], half: [0.45, 0.57, 0.45] }, { at: [-0.76, 3.53, -1.54], half: [0.57, 0.67, 0.69] }, { at: [0.52, 3.78, -0.77], half: [0.37, 0.46, 0.37] }, { at: [0.79, 4.46, -1.41], half: [0.49, 0.77, 0.68] }],
    depleted: { mesh: "core:oak_2_depleted", boxes: [{ at: [0, -0.285, 0], half: [1.1, 0.655, 1.1] }] } },
  { mesh: "core:oak_3", weight: 2, boxes: [{ at: [0, 0.92, 0], half: [0.89, 1.68, 0.89] }, { at: [1.15, 2.88, 1.17], half: [0.7, 0.61, 0.7] }, { at: [-0.73, 2.93, -0.88], half: [0.39, 0.49, 0.39] }, { at: [-1.21, 3.24, -1.47], half: [0.54, 0.57, 0.57] }, { at: [0.41, 2.82, -1.05], half: [0.38, 0.47, 0.38] }, { at: [0.64, 3.07, -1.76], half: [0.44, 0.53, 0.6] }, { at: [0.85, 3.42, -0.2], half: [0.47, 0.59, 0.37] }, { at: [1.56, 4.44, -0.61], half: [0.64, 0.88, 0.56] }],
    depleted: { mesh: "core:oak_3_depleted", boxes: [{ at: [0, -0.215, 0], half: [0.94, 0.585, 0.94] }] } },
];
// The maker's boxes up each great limb start 2 m up the model, 1.69 m at an elder's least size: they would hold a survivor,
// and a parasaur almost anywhere, short of the trunk. Until they clear the tallest mount, an elder is its trunk alone.
const OAKS = PRINTED_OAKS.map((v): NodeVariant => ({ ...v, boxes: v.boxes!.slice(0, 1) }));
const FIGS: NodeVariant[] = [
  { mesh: "core:fig_1", weight: 2, boxes: [{ at: [0, 1.48, 0], half: [0.76, 2.12, 0.76] }],
    depleted: { mesh: "core:fig_1_depleted", boxes: [{ at: [0, -0.14, 0], half: [0.76, 0.5, 0.76] }] } },
  { mesh: "core:fig_2", weight: 3, boxes: [{ at: [0, 1.62, 0], half: [0.9, 2.38, 0.9] }],
    depleted: { mesh: "core:fig_2_depleted", boxes: [{ at: [0, -0.2, 0], half: [0.9, 0.56, 0.9] }] } },
  { mesh: "core:fig_3", weight: 2, boxes: [{ at: [0, 1.42, 0], half: [0.66, 1.98, 0.66] }],
    depleted: { mesh: "core:fig_3_depleted", boxes: [{ at: [0, -0.1, 0], half: [0.66, 0.46, 0.66] }] } },
];
const BANYANS: NodeVariant[] = [
  { mesh: "core:banyan_1", weight: 3, boxes: [{ at: [0, 1.82, 0], half: [1.14, 2.78, 1.14] }, { at: [-9, 0.23, -0], half: [0.39, 5.87, 0.39] }, { at: [-3.68, 0.85, -3.68], half: [0.22, 4.15, 0.22] }, { at: [-6.47, 0.48, -2.68], half: [0.3, 4.92, 0.3] }, { at: [1.72, 0.97, -4.16], half: [0.19, 3.83, 0.19] }, { at: [4.81, 0.5, -4.81], half: [0.25, 4.8, 0.25] }, { at: [7.39, 0.32, -3.06], half: [0.33, 5.38, 0.33] }, { at: [8.78, 0.16, 3.64], half: [0.36, 6.14, 0.36] }, { at: [-2.49, 1.14, 6.01], half: [0.28, 5.26, 0.28] }, { at: [2.6, 1.17, 6.28], half: [0.23, 5.43, 0.23] }],
    depleted: { mesh: "core:banyan_1_depleted", boxes: [{ at: [0, -0.315, 0], half: [1.2, 0.705, 1.2] }, { at: [-9, -2.635, -0], half: [0.42, 3.025, 0.42] }, { at: [-3.68, -1.465, -3.68], half: [0.24, 1.855, 0.24] }, { at: [-6.47, -2.035, -2.68], half: [0.33, 2.425, 0.33] }, { at: [1.72, -1.235, -4.16], half: [0.21, 1.625, 0.21] }, { at: [4.81, -1.965, -4.81], half: [0.27, 2.355, 0.27] }, { at: [7.39, -2.345, -3.06], half: [0.36, 2.735, 0.36] }, { at: [8.78, -2.805, 3.64], half: [0.39, 3.195, 0.39] }, { at: [-2.49, -1.875, 6.01], half: [0.3, 2.265, 0.3] }, { at: [2.6, -1.945, 6.28], half: [0.25, 2.335, 0.25] }] } },
  { mesh: "core:banyan_2", weight: 2, boxes: [{ at: [0, 1.7, 0], half: [0.95, 2.5, 0.95] }, { at: [-2.96, 1.3, -1.22], half: [0.23, 3.4, 0.23] }, { at: [3.14, 1.36, -1.3], half: [0.19, 3.54, 0.19] }, { at: [3.7, 1.43, 1.53], half: [0.17, 3.97, 0.17] }],
    depleted: { mesh: "core:banyan_2_depleted", boxes: [{ at: [0, -0.225, 0], half: [1, 0.615, 1] }, { at: [-2.96, -0.865, -1.22], half: [0.25, 1.255, 0.25] }, { at: [3.14, -0.905, -1.3], half: [0.21, 1.295, 0.21] }, { at: [3.7, -1.075, 1.53], half: [0.18, 1.465, 0.18] }] } },
  { mesh: "core:banyan_3", weight: 1, boxes: [{ at: [0, 2, 0], half: [1.19, 3, 1.19] }, { at: [-7.85, 0.3, 3.25], half: [0.39, 5.7, 0.39] }, { at: [-3.39, 0.97, -3.39], half: [0.22, 4.03, 0.22] }, { at: [-6.47, 0.43, -2.68], half: [0.3, 4.87, 0.3] }, { at: [0, 1.77, 5.5], half: [0.25, 5.23, 0.25] }, { at: [4.8, 1.51, 0], half: [0.33, 4.59, 0.33] }, { at: [8, 0.89, 0], half: [0.36, 5.91, 0.36] }, { at: [10.16, 0.28, -4.21], half: [0.19, 7.02, 0.19] }],
    depleted: { mesh: "core:banyan_3_depleted", boxes: [{ at: [0, -0.335, 0], half: [1.25, 0.725, 1.25] }, { at: [-7.85, -2.515, 3.25], half: [0.42, 2.905, 0.42] }, { at: [-3.39, -1.345, -3.39], half: [0.24, 1.735, 0.24] }, { at: [-6.47, -2.035, -2.68], half: [0.33, 2.425, 0.33] }, { at: [0, -1.535, 5.5], half: [0.27, 1.925, 0.27] }, { at: [4.8, -1.355, 0], half: [0.36, 1.745, 0.36] }, { at: [8, -2.325, 0], half: [0.39, 2.715, 0.39] }, { at: [10.16, -3.185, -4.21], half: [0.21, 3.575, 0.21] }] } },
];
const MANGROVES: NodeVariant[] = [
  { mesh: "core:mangrove_1", weight: 2, boxes: [{ at: [0, 0.09, 0], half: [0.97, 0.91, 0.97] }, { at: [0.04, 1.52, 0.09], half: [0.23, 0.52, 0.22] }],
    depleted: { mesh: "core:mangrove_1_depleted", boxes: [{ at: [0, 0.09, 0], half: [0.97, 0.91, 0.97] }] } },
  { mesh: "core:mangrove_2", weight: 3, boxes: [{ at: [0, 0.01, 0], half: [1.15, 0.99, 1.15] }, { at: [-0.12, 1.66, -0], half: [0.32, 0.66, 0.3] }],
    depleted: { mesh: "core:mangrove_2_depleted", boxes: [{ at: [0, 0.01, 0], half: [1.15, 0.99, 1.15] }] } },
  { mesh: "core:mangrove_3", weight: 3, boxes: [{ at: [0, -0.03, 0], half: [1.24, 1.03, 1.24] }, { at: [-0.21, 1.71, -0.18], half: [0.45, 0.71, 0.41] }],
    depleted: { mesh: "core:mangrove_3_depleted", boxes: [{ at: [0, -0.03, 0], half: [1.24, 1.03, 1.24] }] } },
  { mesh: "core:mangrove_4", weight: 2, boxes: [{ at: [0, -0.06, 0], half: [1.33, 1.06, 1.33] }, { at: [0.19, 1.83, -0.06], half: [0.47, 0.83, 0.44] }],
    depleted: { mesh: "core:mangrove_4_depleted", boxes: [{ at: [0, -0.06, 0], half: [1.33, 1.06, 1.33] }] } },
];
const BUSHES: NodeVariant[] = [
  { mesh: "core:bush_1", weight: 2, boxes: [{ at: [0.02, 0.49, 0.02], half: [0.5, 0.49, 0.46] }], depleted: { mesh: "core:bush_1_depleted", boxes: [{ at: [0.01, 0.48, -0.02], half: [0.46, 0.48, 0.43] }] } },
  { mesh: "core:bush_2", boxes: [{ at: [0.03, 0.38, -0.02], half: [0.35, 0.38, 0.34] }], depleted: { mesh: "core:bush_2_depleted", boxes: [{ at: [0.01, 0.36, -0.02], half: [0.33, 0.36, 0.31] }] } },
  { mesh: "core:bush_3", boxes: [{ at: [0.08, 0.51, 0.05], half: [0.58, 0.51, 0.5] }], depleted: { mesh: "core:bush_3_depleted", boxes: [{ at: [0.11, 0.48, 0.07], half: [0.56, 0.48, 0.46] }] } },
  { mesh: "core:bush_4", boxes: [{ at: [0.02, 0.57, 0.01], half: [0.43, 0.57, 0.37] }], depleted: { mesh: "core:bush_4_depleted", boxes: [{ at: [0.01, 0.55, 0.01], half: [0.4, 0.55, 0.37] }] } },
];
const CREEPERS: NodeVariant[] = [
  { mesh: "core:creeper_1", weight: 2, boxes: [{ at: [0.05, 0.46, -0.01], half: [0.92, 0.46, 0.59] }], depleted: { mesh: "core:creeper_1_depleted", boxes: [{ at: [0.02, 0.36, -0.05], half: [0.67, 0.36, 0.51] }] } },
  { mesh: "core:creeper_2", boxes: [{ at: [0.09, 0.28, 0.06], half: [0.52, 0.28, 0.5] }], depleted: { mesh: "core:creeper_2_depleted", boxes: [{ at: [0.11, 0.22, 0.03], half: [0.31, 0.22, 0.37] }] } },
  { mesh: "core:creeper_3", boxes: [{ at: [0.01, 0.62, -0.03], half: [1.1, 0.62, 0.61] }], depleted: { mesh: "core:creeper_3_depleted", boxes: [{ at: [0.03, 0.5, -0.03], half: [0.77, 0.5, 0.47] }] } },
];
const FERNS: NodeVariant[] = [
  { mesh: "core:fern_1", weight: 2, boxes: [{ at: [0.07, 0.21, 0.08], half: [0.39, 0.21, 0.39] }], depleted: { mesh: "core:fern_1_depleted", boxes: [{ at: [0.04, 0.11, 0.1], half: [0.11, 0.11, 0.2] }] } },
  { mesh: "core:fern_2", boxes: [{ at: [0.01, 0.15, 0.02], half: [0.26, 0.15, 0.31] }], depleted: { mesh: "core:fern_2_depleted", boxes: [{ at: [-0.24, 0.11, 0.09], half: [0.3, 0.11, 0.16] }] } },
  { mesh: "core:fern_3", boxes: [{ at: [-0.03, 0.25, 0.01], half: [0.51, 0.25, 0.49] }], depleted: { mesh: "core:fern_3_depleted", boxes: [{ at: [-0.03, 0.16, 0.07], half: [0.28, 0.16, 0.3] }] } },
  { mesh: "core:fern_4", boxes: [{ at: [-0.02, 0.19, -0.03], half: [0.36, 0.19, 0.39] }], depleted: { mesh: "core:fern_4_depleted", boxes: [{ at: [-0.05, 0.1, -0.06], half: [0.26, 0.1, 0.11] }] } },
];
const PALMETTOS: NodeVariant[] = [
  { mesh: "core:palmetto_1", weight: 2, boxes: [{ at: [0.03, 0.41, 0.01], half: [0.42, 0.41, 0.39] }], depleted: { mesh: "core:palmetto_1_depleted", boxes: [{ at: [-0.34, 0.17, -0.13], half: [0.55, 0.17, 0.4] }] } },
  { mesh: "core:palmetto_2", boxes: [{ at: [0.13, 0.23, -0.09], half: [0.31, 0.23, 0.32] }], depleted: { mesh: "core:palmetto_2_depleted", boxes: [{ at: [-0.07, 0.14, -0.1], half: [0.38, 0.14, 0.39] }] } },
  { mesh: "core:palmetto_3", boxes: [{ at: [-0.11, 0.37, 0.07], half: [0.6, 0.37, 0.37] }], depleted: { mesh: "core:palmetto_3_depleted", boxes: [{ at: [0.23, 0.19, 0.21], half: [0.75, 0.19, 0.48] }] } },
];
const SEAGRAPES: NodeVariant[] = [
  { mesh: "core:seagrape_1", weight: 2, boxes: [{ at: [-0.21, 0.57, -0.22], half: [0.95, 0.57, 1.04] }], depleted: { mesh: "core:seagrape_1_depleted", boxes: [{ at: [-0.23, 0.56, -0.17], half: [0.84, 0.56, 0.9] }] } },
  { mesh: "core:seagrape_2", boxes: [{ at: [-0.23, 0.43, 0], half: [0.44, 0.43, 0.96] }], depleted: { mesh: "core:seagrape_2_depleted", boxes: [{ at: [-0.27, 0.35, -0.04], half: [0.3, 0.35, 0.81] }] } },
  { mesh: "core:seagrape_3", boxes: [{ at: [-0.13, 0.79, 0.13], half: [1.31, 0.79, 1.55] }], depleted: { mesh: "core:seagrape_3_depleted", boxes: [{ at: [-0.2, 0.64, 0.04], half: [1.1, 0.64, 1.19] }] } },
];
// The stones' lines are as assets/source/core/nodes/rocks/content.py prints them. A stone taller than a survivor's waist
// has no box rising less than 0.6 m from the ground at any size, so it is jumped onto, as in the reference game.
const ROCKS: NodeVariant[] = [
  { mesh: "core:rock_1", weight: 4, boxes: [{ at: [0.08, 0.3, -0.08], half: [1.0, 0.6, 0.8] }, { at: [0.03, 0.4, -0.03], half: [0.55, 0.7, 0.65] }, { at: [-0.07, 0.47, -0.03], half: [0.35, 0.78, 0.45] }, { at: [0.08, 0.25, -0.08], half: [1.1, 0.55, 0.5] }],
    depleted: { mesh: "core:rock_1_depleted", boxes: [{ at: [0.13, 0.03, -0.03], half: [1.15, 0.33, 0.85] }, { at: [0.28, -0.05, 0.07], half: [1.5, 0.25, 0.25] }, { at: [0.53, 0.05, 0.12], half: [0.55, 0.35, 0.5] }, { at: [-0.02, -0.05, -0.08], half: [1.1, 0.25, 0.9] }, { at: [-0.87, 0.0, -0.13], half: [0.15, 0.3, 1.05] }] } },
  { mesh: "core:rock_2", weight: 3, boxes: [{ at: [0.02, 0.5, -0.02], half: [1.0, 0.8, 0.75] }, { at: [-0.23, 0.62, -0.02], half: [0.45, 0.93, 0.65] }, { at: [-0.08, 0.3, -0.02], half: [0.6, 0.6, 0.85] }, { at: [0.92, 0.28, 0.13], half: [0.2, 0.57, 0.6] }],
    depleted: { mesh: "core:rock_2_depleted", boxes: [{ at: [-0.03, 0.0, -0.02], half: [0.95, 0.3, 0.75] }, { at: [-0.33, 0.05, -0.02], half: [0.35, 0.35, 0.85] }, { at: [-0.53, 0.1, 0.23], half: [0.45, 0.4, 0.3] }, { at: [0.02, -0.03, -0.02], half: [0.6, 0.28, 0.85] }, { at: [0.02, -0.03, -0.02], half: [1.0, 0.28, 0.55] }] } },
  { mesh: "core:rock_3", weight: 3, boxes: [{ at: [-0.05, 0.2, -0.05], half: [1.25, 0.5, 0.7] }, { at: [-0.45, 0.28, 0.05], half: [0.75, 0.57, 0.5] }, { at: [-0.05, 0.17, 0.15], half: [1.35, 0.47, 0.4] }, { at: [-0.75, 0.33, 0.05], half: [0.35, 0.62, 0.4] }],
    depleted: { mesh: "core:rock_3_depleted", boxes: [{ at: [-0.3, -0.03, -0.05], half: [1.1, 0.28, 0.8] }, { at: [-0.8, 0.03, 0.1], half: [0.6, 0.33, 0.65] }, { at: [-0.95, -0.03, -0.3], half: [0.25, 0.28, 1.15] }, { at: [-0.15, -0.05, 0.15], half: [1.45, 0.25, 0.3] }, { at: [0.15, -0.12, -0.15], half: [1.35, 0.17, 0.8] }] } },
  { mesh: "core:rock_4", weight: 2, boxes: [{ at: [-0.34, 0.0, 0.04], half: [1.25, 0.3, 0.95] }, { at: [-0.39, 0.07, -0.16], half: [0.8, 0.38, 0.45] }, { at: [-0.29, -0.07, -0.06], half: [1.7, 0.23, 0.55] }, { at: [-0.19, -0.07, -0.01], half: [0.9, 0.23, 1.1] }, { at: [-0.84, 0.03, 0.19], half: [0.85, 0.33, 0.5] }],
    depleted: { mesh: "core:rock_4_depleted", boxes: [{ at: [-0.24, -0.05, -0.01], half: [1.35, 0.25, 1.0] }, { at: [-0.74, -0.03, 0.04], half: [1.15, 0.28, 0.45] }, { at: [0.26, -0.1, -0.31], half: [1.15, 0.2, 0.8] }, { at: [0.26, 0.0, -0.46], half: [0.55, 0.3, 0.35] }, { at: [-0.34, -0.03, 0.09], half: [0.25, 0.28, 1.0] }] } },
  { mesh: "core:rock_5", weight: 3, boxes: [{ at: [0.11, 0.07, -0.06], half: [0.85, 0.38, 0.7] }, { at: [0.11, 0.0, -0.01], half: [1.15, 0.3, 0.35] }, { at: [0.01, -0.05, -0.11], half: [0.55, 0.25, 0.95] }, { at: [0.06, 0.12, 0.04], half: [0.6, 0.42, 0.5] }, { at: [-0.24, 0.0, 0.54], half: [0.7, 0.3, 0.2] }],
    depleted: { mesh: "core:rock_5_depleted", boxes: [{ at: [0.11, -0.07, -0.11], half: [1.05, 0.23, 0.65] }, { at: [0.11, -0.1, -0.36], half: [0.25, 0.2, 1.2] }, { at: [1.61, -0.03, 0.14], half: [0.15, 0.28, 0.3] }, { at: [-0.24, -0.1, 0.29], half: [1.0, 0.2, 0.45] }, { at: [0.66, -0.03, -0.31], half: [0.3, 0.28, 0.25] }] } },
  { mesh: "core:rock_6", weight: 1, boxes: [{ at: [0.08, 0.4, 0.07], half: [1.0, 0.7, 0.8] }, { at: [-0.07, 0.85, -0.03], half: [0.25, 1.15, 0.4] }, { at: [0.08, 0.25, 0.02], half: [1.2, 0.55, 0.55] }, { at: [0.03, 0.25, 0.02], half: [0.75, 0.55, 0.95] }, { at: [-0.02, 0.5, 0.02], half: [0.6, 0.8, 0.55] }],
    depleted: { mesh: "core:rock_6_depleted", boxes: [{ at: [0.03, 0.0, -0.08], half: [0.85, 0.3, 0.95] }, { at: [0.13, -0.03, -0.08], half: [1.15, 0.28, 0.45] }, { at: [0.03, 0.03, -0.33], half: [0.65, 0.33, 0.4] }, { at: [-0.67, -0.03, -1.18], half: [0.25, 0.28, 0.15] }, { at: [0.08, 0.05, 0.57], half: [0.3, 0.35, 0.2] }] } },
];
const RUBBLE: NodeVariant[] = [
  { mesh: "core:rubble_1", weight: 2, boxes: [{ at: [0.02, 0.3, -0.14], half: [1.05, 0.6, 0.75] }, { at: [-0.63, 0.42, -0.14], half: [0.4, 0.72, 0.65] }, { at: [-0.33, 0.35, -0.04], half: [0.4, 0.65, 0.75] }, { at: [-1.28, 0.33, 0.46], half: [0.25, 0.62, 0.15] }, { at: [-0.83, 0.45, -0.29], half: [0.3, 0.75, 0.2] }],
    depleted: { mesh: "core:rubble_1_depleted", boxes: [{ at: [0.04, -0.05, -0.02], half: [1.2, 0.25, 0.75] }, { at: [0.04, -0.1, -0.02], half: [0.8, 0.2, 0.95] }, { at: [-0.11, -0.03, -0.02], half: [0.85, 0.28, 0.35] }, { at: [0.04, -0.1, 0.03], half: [1.4, 0.2, 0.5] }, { at: [0.04, -0.12, -0.02], half: [0.6, 0.17, 1.05] }] } },
  { mesh: "core:rubble_2", weight: 2, boxes: [{ at: [0.09, 0.17, -0.19], half: [0.95, 0.47, 0.7] }, { at: [0.04, 0.3, -0.69], half: [0.9, 0.6, 0.2] }, { at: [0.64, 0.35, -0.84], half: [0.2, 0.65, 0.15] }, { at: [0.09, 0.17, -0.14], half: [1.15, 0.47, 0.15] }],
    depleted: { mesh: "core:rubble_2_depleted", boxes: [{ at: [0.01, -0.05, 0.0], half: [0.9, 0.25, 0.75] }, { at: [-0.04, -0.1, 0.0], half: [1.15, 0.2, 0.45] }, { at: [0.06, -0.1, -0.05], half: [0.45, 0.2, 1.0] }, { at: [-0.34, -0.03, -0.05], half: [0.35, 0.28, 0.3] }, { at: [0.06, -0.12, -0.05], half: [1.15, 0.17, 0.6] }] } },
  { mesh: "core:rubble_3", weight: 2, boxes: [{ at: [-0.11, 0.2, -0.14], half: [1.35, 0.5, 0.65] }, { at: [0.39, 0.33, -0.09], half: [0.95, 0.62, 0.3] }, { at: [-0.21, 0.17, -0.14], half: [0.45, 0.47, 0.95] }, { at: [-0.31, 0.28, -0.19], half: [0.95, 0.57, 0.3] }],
    depleted: { mesh: "core:rubble_3_depleted", boxes: [{ at: [-0.01, -0.05, -0.01], half: [1.15, 0.25, 0.85] }, { at: [0.04, -0.1, -0.01], half: [1.6, 0.2, 0.65] }, { at: [-0.01, -0.1, -0.01], half: [0.75, 0.2, 1.05] }, { at: [-0.01, -0.03, -0.01], half: [0.75, 0.28, 0.45] }, { at: [0.09, -0.07, 0.14], half: [1.35, 0.23, 0.5] }] } },
  { mesh: "core:rubble_4", weight: 2, boxes: [{ at: [-0.45, 0.05, -0.07], half: [1.3, 0.35, 0.55] }, { at: [0.15, -0.05, -0.02], half: [1.2, 0.25, 0.7] }, { at: [-1.25, 0.1, -0.07], half: [0.5, 0.4, 0.45] }, { at: [-0.1, -0.1, -0.02], half: [1.75, 0.2, 0.5] }, { at: [-0.75, 0.07, -0.02], half: [1.0, 0.38, 0.3] }],
    depleted: { mesh: "core:rubble_4_depleted", boxes: [{ at: [-0.0, -0.1, -0.05], half: [1.35, 0.2, 0.6] }, { at: [0.05, -0.07, -0.1], half: [0.9, 0.23, 0.45] }, { at: [0.1, -0.12, -0.05], half: [1.05, 0.17, 0.7] }, { at: [0.05, -0.12, -0.05], half: [1.7, 0.17, 0.4] }, { at: [-0.3, 0.0, -0.6], half: [0.15, 0.3, 0.15] }] } },
  { mesh: "core:rubble_5", weight: 2, boxes: [{ at: [0.09, 0.35, -0.04], half: [0.85, 0.65, 0.7] }, { at: [0.04, 0.23, 0.01], half: [0.5, 0.53, 0.85] }, { at: [-0.01, 0.48, 0.01], half: [0.35, 0.79, 0.45] }, { at: [-0.06, 0.23, 0.16], half: [1.0, 0.53, 0.3] }, { at: [-0.01, 0.68, 0.01], half: [0.15, 0.97, 0.25] }],
    depleted: { mesh: "core:rubble_5_depleted", boxes: [{ at: [0.09, -0.05, -0.03], half: [0.85, 0.25, 0.75] }, { at: [-0.06, -0.03, -0.03], half: [0.5, 0.28, 0.45] }, { at: [-0.06, -0.05, -0.53], half: [1.1, 0.25, 0.15] }, { at: [-0.01, -0.12, -0.03], half: [0.65, 0.17, 0.95] }, { at: [0.04, -0.12, 0.12], half: [1.1, 0.17, 0.5] }] } },
  { mesh: "core:rubble_6", weight: 2, boxes: [{ at: [0.03, -0.12, 0.02], half: [1.15, 0.17, 0.85] }, { at: [-0.37, 0.05, -0.28], half: [0.35, 0.35, 0.15] }, { at: [0.63, 0.05, 0.32], half: [0.25, 0.35, 0.15] }, { at: [0.03, -0.05, -0.28], half: [0.15, 0.25, 0.65] }, { at: [1.18, -0.03, -0.48], half: [0.2, 0.28, 0.15] }],
    depleted: { mesh: "core:rubble_6_depleted", boxes: [{ at: [0.06, -0.12, 0.01], half: [1.1, 0.17, 0.8] }, { at: [0.06, -0.1, -0.29], half: [0.3, 0.2, 0.6] }, { at: [1.21, -0.05, -0.44], half: [0.25, 0.25, 0.15] }, { at: [0.71, -0.05, 0.36], half: [0.25, 0.25, 0.15] }, { at: [0.06, -0.05, 0.16], half: [0.2, 0.25, 0.15] }] } },
  { mesh: "core:rubble_7", weight: 2, boxes: [{ at: [0.17, 0.28, 0.03], half: [1.0, 0.57, 0.9] }, { at: [-0.38, 0.35, -0.02], half: [0.35, 0.65, 0.65] }, { at: [-0.53, 0.38, -0.32], half: [0.5, 0.68, 0.15] }, { at: [0.87, 0.25, -0.02], half: [0.2, 0.55, 1.05] }, { at: [0.17, 0.25, 0.03], half: [1.1, 0.55, 0.4] }],
    depleted: { mesh: "core:rubble_7_depleted", boxes: [{ at: [0.07, -0.07, -0.05], half: [1.0, 0.23, 0.75] }, { at: [-0.03, -0.03, 0.0], half: [0.7, 0.28, 0.4] }, { at: [0.33, -0.1, -0.05], half: [0.75, 0.2, 0.85] }, { at: [0.97, -0.07, -0.75], half: [0.3, 0.23, 0.25] }, { at: [0.03, -0.12, -0.05], half: [1.15, 0.17, 0.45] }] } },
  { mesh: "core:rubble_8", weight: 2, boxes: [{ at: [-0.04, 0.17, -0.01], half: [0.55, 0.47, 0.35] }],
    depleted: { mesh: "core:rubble_8_depleted", boxes: [{ at: [0.06, -0.05, -0.01], half: [0.7, 0.25, 0.55] }, { at: [-0.14, -0.07, -0.46], half: [0.6, 0.23, 0.2] }, { at: [-0.09, -0.03, 0.04], half: [0.35, 0.28, 0.3] }, { at: [0.51, -0.05, 0.44], half: [0.35, 0.25, 0.2] }, { at: [0.01, -0.12, -0.11], half: [0.85, 0.17, 0.35] }] } },
];
const METAL_ROCKS: NodeVariant[] = [
  { mesh: "core:metal_rock_1", weight: 2, boxes: [{ at: [-0.11, 0.45, -0.14], half: [1.15, 0.75, 0.85] }, { at: [0.14, 0.26, 0.11], half: [1.1, 0.56, 0.7] }, { at: [-0.11, 0.55, -0.39], half: [0.75, 0.85, 0.5] }, { at: [-0.11, 0.32, -0.19], half: [1.25, 0.62, 0.4] }],
    depleted: { mesh: "core:metal_rock_1_depleted", boxes: [{ at: [-0.06, 0.03, -0.19], half: [1.2, 0.33, 0.9] }, { at: [0.14, -0.07, 0.11], half: [1.1, 0.23, 0.9] }, { at: [-0.81, 0.05, -0.09], half: [0.55, 0.35, 0.4] }, { at: [-0.41, 0.05, -0.74], half: [0.75, 0.35, 0.25] }, { at: [0.04, -0.03, -0.19], half: [1.4, 0.28, 0.3] }] } },
  { mesh: "core:metal_rock_2", weight: 2, boxes: [{ at: [-0.01, 0.45, -0.04], half: [1.05, 0.75, 0.8] }, { at: [-0.46, 0.68, -0.24], half: [0.5, 0.97, 0.5] }, { at: [0.09, 0.28, 0.21], half: [1.05, 0.57, 0.55] }, { at: [-0.26, 0.5, -0.09], half: [0.5, 0.8, 0.65] }],
    depleted: { mesh: "core:metal_rock_2_depleted", boxes: [{ at: [-0.21, 0.05, 0.01], half: [0.85, 0.35, 0.85] }, { at: [-0.01, -0.05, 0.06], half: [1.05, 0.25, 0.7] }, { at: [-0.81, 0.1, -0.09], half: [0.35, 0.4, 0.35] }, { at: [0.19, -0.05, -1.04], half: [0.25, 0.25, 0.2] }, { at: [-0.81, 0.12, 0.26], half: [0.25, 0.42, 0.4] }] } },
  { mesh: "core:metal_rock_3", weight: 2, boxes: [{ at: [0.06, 0.17, -0.06], half: [1.35, 0.47, 0.75] }, { at: [0.11, 0.3, -0.11], half: [1.0, 0.6, 0.3] }, { at: [-0.19, 0.23, -0.06], half: [0.9, 0.53, 0.45] }],
    depleted: { mesh: "core:metal_rock_3_depleted", boxes: [{ at: [-0.04, 0.0, 0.04], half: [1.35, 0.3, 0.85] }, { at: [-0.44, 0.03, 0.24], half: [1.05, 0.33, 0.45] }, { at: [0.21, -0.05, -0.31], half: [1.3, 0.25, 0.6] }, { at: [0.16, -0.03, -0.01], half: [1.65, 0.28, 0.2] }, { at: [0.66, -0.07, -1.21], half: [0.15, 0.23, 0.2] }] } },
];
const NODES: NodeDef[] = [
  // Hardwood hammock trees: the common harvest tree is a young hardwood, 9 to 16 m tall. The elder live oaks are their own
  // kind, a giant here and there among the figs and banyans.
  tree("tree", 12, [0.3, 2, 0.3], { half: [1.4, 1.6, 1.4], color: 7 }, [0.85, 1.15], YOUNG),
  tree("palm", 10, [0.2, 3.5, 0.2], { half: [1.6, 0.5, 1.6], color: 17 }, [0.85, 1.15], PALMS),
  // Strangler figs, banyans and the elder oaks are the big trees, and take the most blows.
  tree("fig", 20, [0.5, 2.5, 0.5], { half: [3.2, 2, 3.2], color: 16 }, [1, 1.25], FIGS),
  tree("oak", 20, [0.3, 2, 0.3], { half: [1.4, 1.6, 1.4], color: 7 }, [0.85, 1.2], OAKS),
  // A banyan's outer trunks stand as far as 12 m out, each buried six tenths of how far it stands. Where the ground falls
  // away under them further than that, a strangler fig grows in its place.
  { ...tree("banyan", 30, [1, 3, 1], { half: [5, 2.5, 5], color: 7 }, [0.9, 1.15], BANYANS), footing: { reach: 12, fall: 7.2, else: "core:fig" } },
  tree("mangrove", 8, [0.25, 1.4, 0.25], { half: [1.8, 1, 1.8], color: 12 }, [0.8, 1.2], MANGROVES),
  // Limestone boulders. Only these hold a little ore, as the rocks always have here.
  // A stone base reaches at most 3.15 m out (the widest limestone at its largest), so the ground under these three kinds is
  // judged 4 m out, two of its samples. It may fall away there by the least of a kind's burials for its reach: 1.2 m for
  // 2.52 m in the limestone, 1.05 m for 2.26 m in the rubble, 0.8 m for 1.62 m in the metal rocks. Where it falls further,
  // nothing grows. The five later heaps of rubble are each buried at least half as deep as they reach, so the rubble's
  // 1.85 m holds for them too (content.py would allow 2.0).
  { type: "node", id: id("rock"), mesh: "box", color: 15, half: [0.9, 0.6, 0.8], hits: 10, respawnHours: REGROW, material: "stone", yields: [...ROCK_YIELDS, { item: "core:ore", min: 0, max: 1, tool: true }], xp: 1, size: [0.8, 1.25], variants: ROCKS, footing: { reach: 4, fall: 1.9 } },
  // Heaps of rubble lie side by side in the ruins; two within 12 m of each other in a chunk, as one view holds them, are
  // never the same heap.
  { type: "node", id: id("rubble"), mesh: "box", color: 2, half: [1.3, 0.45, 1], hits: 8, respawnHours: REGROW, material: "stone", yields: ROCK_YIELDS, xp: 1, size: [0.85, 1.15], variants: RUBBLE, footing: { reach: 4, fall: 1.85 }, apart: 12 },
  // A metal rock, darker and veined, which a player learns to spot. It is harder than limestone, and a pick gets its ore.
  // It gives obsidian too, at a reduced rate: "Mountain-rocks which yield Metal now also yield Obsidian at a reduced rate"
  // (Obsidian, patch 171.8). Ours is the only metal rock, so every one does. The rate is unverified and chosen: none to one
  // a hit, times the pick's 3, a quarter of the ore it gives.
  { type: "node", id: id("metal_rock"), mesh: "box", color: 4, half: [1, 0.7, 0.9], hits: 15, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }, { item: "core:ore", min: 1, max: 3, tool: true }, { item: "core:obsidian", min: 0, max: 1, tool: true }], xp: 1, size: [0.75, 1.2], variants: METAL_ROCKS, footing: { reach: 4, fall: 1.95 } },
  // Berry bushes, their berries red. How many narcoberries each picking gives is chosen, as the wiki gives no figure.
  plant("bush", 46, 4, [0.5, 0.4, 0.5], [{ item: "core:berry", min: 3, max: 6 }, { item: "core:fiber", min: 2, max: 5 }, { item: "core:narcoberry", min: 0, max: 2 }, { item: "core:stimberry", min: 0, max: 2 }], [0.8, 1.2], BUSHES),
  // Saw palmetto bears a few berries. A fern bears none.
  plant("palmetto", 17, 4, [0.7, 0.5, 0.7], [{ item: "core:fiber", min: 3, max: 6 }, { item: "core:berry", min: 1, max: 3 }, { item: "core:narcoberry", min: 0, max: 1 }], [0.75, 1.25], PALMETTOS),
  plant("fern", 7, 3, [0.45, 0.35, 0.45], [{ item: "core:fiber", min: 3, max: 6 }], [0.75, 1.3], FERNS),
  // Sea grape is a berry bush of the shore. Creeper, a mass of vine, gives fibre and nothing else.
  plant("seagrape", 12, 4, [0.9, 0.8, 0.9], [{ item: "core:berry", min: 3, max: 6 }, { item: "core:fiber", min: 2, max: 4 }, { item: "core:narcoberry", min: 0, max: 2 }], [0.8, 1.2], SEAGRAPES),
  plant("creeper", 16, 3, [0.8, 0.6, 0.5], [{ item: "core:fiber", min: 4, max: 8 }], [0.8, 1.25], CREEPERS),
];

/** Levels are the reference game's. */
const MAKING: Def[] = [
  ...making("spear", "Spear", 2, 3, 1, 3, [["flint", 2], ["wood", 8], ["fiber", 12]]),
  // ark.wiki.gg, Narcotic, infobox, 2026-11-15: at the mortar and pestle, 5 narcoberries and 1 spoiled meat, in 5 s,
  // craftingxp 2 (our 8, D465's four times); level 6, 6 engram points (moved from the hand and raw meat by S6). The
  // chemistry bench's 20 and 4 for 6 waits for the bench.
  ...making("narcotic", "Narcotic", 6, 6, 1, 5, [["narcoberry", 5], ["spoiled_meat", 1]], 8, "mortar"),
  // The metal ingot has no engram and is not made in the hand, as in ARK, where the refining forge makes it (by the user,
  // 2026-11-15, on planning/reference/stations-plan.md's question 2); the forge refines it (S1, in GEAR above).
  // ark.wiki.gg, Gunpowder, infobox, 2026-11-15: at the mortar and pestle, 1 sparkpowder and 1 charcoal, in 1 s, craftingxp
  // 0.05 (our 0.2, D465's four times); level 15, 2 engram points (moved from the hand and its flint, stone and wood by S6,
  // once the forge's wood left charcoal, S1). The chemistry bench's recipe waits for the bench.
  ...making("gunpowder", "Gunpowder", 15, 2, 1, 1, [["sparkpowder", 1], ["charcoal", 1]], 0.2, "mortar"),
  // Each piece of an armor tier has its own engram, at the tier's level and the piece's cost.
  ...ARMOR_TIERS.flatMap((t): Def[] => {
    const m = ARMOR_MAKING[t.tier]!;
    return ARMOR_PIECES.flatMap((p): Def[] => [
      ...crafting(id(`${t.tier}_${p.name}`), { needs: m.needs[p.name]!.map(([item, n]) => ({ item: id(item), count: n })), seconds: 5, xp: m.xp?.[p.name] ?? Math.round(m.level / 3), ...(m.at ? { at: id(m.at) } : {}) }),
      { type: "engram", id: id(`engram-${t.tier}_${p.name}`), label: `${t.tier[0]!.toUpperCase()}${t.tier.slice(1)} ${p.label}`, level: m.level, cost: typeof m.cost === "number" ? m.cost : m.cost[p.name]!, item: id(`${t.tier}_${p.name}`) },
    ]);
  }),
];

/**
 * The reference game's survivor levels: the experience each of the 105 takes in all, fractions included, and the engram
 * points each gives. Levels past 105 are its ascensions, which are not built.
 */
const LEVELS: Def = (() => {
  const xp = [
    0, 5, 20, 40, 70, 120, 190, 270, 360, 450,
    550, 660, 780, 910, 1050, 1200, 1360, 1530, 1710, 1900,
    2100, 2310, 2530, 2760, 3000, 3250, 3510, 3780, 4060, 4350,
    4650, 4960, 5280, 5610, 5950, 6300, 6660, 7030, 7410, 7800,
    8200, 8610, 9030, 9460, 9900, 10350, 10810, 11280, 11760, 12250,
    12750, 13260, 13780, 14310, 14850, 15400, 15960, 16530, 17110, 17700,
    18850, 21078, 22448, 23908, 25462, 27498.96, 30248.86, 34786.19, 40004.11, 46804.82,
    54761.64, 63713.98, 73000, 85000, 98000, 112000, 127500, 144500, 163500, 184500,
    207500, 232570, 259896, 289681, 323189, 360886, 403318, 451484, 506186, 566358,
    632547, 705354, 785441.7, 873538.1, 971538.1, 1083538, 1213538, 1368538, 1558538, 1798538,
    2098538, 2468538, 2918538, 3458538, 4098538,
  ];
  // The first level that gives each number of points.
  const steps: readonly (readonly [level: number, points: number])[] = [[2, 8], [10, 12], [20, 16], [30, 20], [40, 24], [50, 28], [60, 40], [73, 50], [87, 60], [99, 70]];
  const engramPoints = xp.map((_, i) => steps.findLast(([level]) => i + 1 >= level)?.[1] ?? 0);
  return { type: "levels", id: id("levels"), xp, engramPoints };
})();

/**
 * The experience a tame needs in all for each of its 88 levels past the one it was tamed at, as the reference game's
 * Leveling page gives it for multiplayer, with 0 for that first level. Its cap is the last. Not yet LEVELS' `tame`.
 */
export const TAME_XP: readonly number[] = [
  0, 10, 30, 60, 100, 150, 210, 280, 360, 450,
  550, 660, 780, 910, 1050, 1200, 1360, 1530, 1710, 1900,
  2100, 2310, 2530, 2760, 3000, 3250, 3510, 3780, 4060, 4350,
  4650, 4960, 5280, 5610, 5950, 6545, 7199, 7919, 8711, 9582,
  10540, 11594, 12985, 14933, 17173, 19749, 23106, 27106, 31506, 36006,
  41000, 47000, 55000, 65000, 80000, 98000, 120000, 150000, 185000, 225000,
  275000, 340000, 415000, 500000, 600000, 730000, 900000, 1115000, 1380000, 1700000,
  2080000, 2525000, 3000000, 3550000, 4100000, 4700000, 5405000, 6080625, 6840703, 7695791,
  8657765, 9739986, 10957484, 12327170, 13868070, 15601570, 17551770, 19745740, 22213960,
];

// Stats are [base, gain per wild level, gain per level an owner gives]. The creatures are in content/creatures.
const ALL: readonly Def[] = [
  {
    type: "species", class: "survivor",
    id: "core:survivor",
    mesh: "core:human",
    skeleton: "human",
    color: 8,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    walkSpeed: 4.5,
    sprintMul: 1.6,
    jumpSpeed: 7,
    food: { max: 100, perHour: 6 },
    waterPerHour: 9,
    slots: 40,
    equips: true,
    fists: 8,
    // A punch's torpor is 1.75 times what it does.
    fistsTorpor: 1.75,
    zones: { head: 3 },
    killXp: 10,
    // Knocked out at 200 torpor, and out for most of a minute.
    torporDrain: 4,
    // Crafting Skill is 100% and a point adds 10% (ark.wiki.gg, Human, "Base Stats and Growth", and Crafting Skill,
    // 2026-11-15); a blueprint's bonus is up to a twentieth of it (D419).
    stats: { health: [100, 0, 0.1], stamina: [100, 0, 0.1], oxygen: [100, 0, 0.2], food: [100, 0, 0.1], water: [100, 0, 0.1], weight: [100, 0, 0.1], melee: [1, 0, 0.05], speed: [1, 0, 0.015], torpidity: [200, 0, 0], crafting: [1, 0, 0.1] },
  },
  // A practice target with a survivor's shape and zones.
  {
    type: "species", class: "target",
    id: "core:dummy",
    mesh: "core:mannequin",
    skeleton: "human",
    color: 3,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    walkSpeed: 1,
    sprintMul: 1,
    jumpSpeed: 1,
    slots: 5,
    equips: true,
    still: true,
    zones: { head: 3 },
    stats: { health: [100000, 0, 0], torpidity: [200, 0, 0] },
    torporDrain: 4,
  },
  // Damage multipliers by material, as in the reference game. The tiers differ in what can harm them, not in health.
  { type: "material", id: "core:mat_thatch", takes: { melee: 1, fire: 4, explosive: 1 }, decayDays: 4 },
  { type: "material", id: "core:mat_wood", takes: { fire: 3, explosive: 1 }, decayDays: 8 },
  { type: "material", id: "core:mat_stone", takes: { explosive: 2.3325 }, decayDays: 12 },
  { type: "material", id: "core:mat_metal", takes: { explosive: 0.3008 }, decayDays: 16 },
  { type: "structure", class: "static", id: "core:block", mesh: "box", color: 2, half: [1, 1, 1], hp: 1000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:crate", mesh: "box", color: 3, half: [0.5, 0.5, 0.5], hp: 200, material: "core:mat_wood" },
  { type: "structure", class: "static", id: "core:foundation", mesh: "box", color: 4, half: [1.5, 0.15, 1.5], hp: 15000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:wall", mesh: "box", color: 5, half: [1.5, 1.5, 0.1], hp: 10000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:ceiling", mesh: "box", color: 4, half: [1.5, 0.1, 1.5], hp: 10000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:pillar", mesh: "box", color: 6, half: [0.25, 3, 0.25], hp: 6250, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:step", mesh: "box", color: 7, half: [1, 0.15, 0.5], hp: 400, material: "core:mat_wood" },
  // The plaza floor has no material, so nothing harms it.
  { type: "structure", class: "static", id: "core:slab", mesh: "box", color: 2, half: [4, 0.25, 4], hp: 4000 },
  ...BUILDING_CONTENT,
  ...CREATURES,
  ...ROAD_FLEET,
  ...HELICOPTERS,
  ...SKATEBOARDS,
  ...BOATS,
  ...MARINE_FLEET,
  ...BOAT_ITEMS,
  ...HELICOPTER_ITEMS,
  ...ROADS,
  ...WRECKS,
  ...TANKER_WRECKS,
  ...BOX_TRAILER,
  ...HARBOUR_WRECKS,
  ...DOCKS,
  ...STREET,
  CIVILIAN,
  ...SPAWNS,
  ...KNOCKOUT,
  ...CORPSES,
  ...EGGS,
  ...FOODS,
  ...ITEMS,
  ...MAPS,
  { type: "prop", class: "projectile", id: "core:grenade_live", mesh: "core:grenade_thrown", color: 7, radius: 0.08, height: 0.12 },
  // Holds everything a survivor carried when it died.
  { type: "prop", class: "container", id: "core:cache", mesh: "box", color: 6, radius: 0.35, height: 0.5, slots: 60 },
  // Holds items dropped on the ground.
  { type: "prop", class: "container", id: "core:bag", mesh: "box", color: 3, radius: 0.22, height: 0.28, slots: 10 },
  // A supply drop's capsule where it landed (planning/workstreams/supply.md): what a survivor looks at and opens. The
  // client draws the capsule, its shaft and its landing from the list of drops it is sent, and passes this over. Its 60
  // slots are CAPSULE_SLOTS of shared/supply/book.ts, which the starter book's fullest roll fits with room.
  { type: "prop", class: "crate", id: "core:supply_capsule", mesh: "box", color: 10, radius: 0.7, height: 2.2, slots: 60 },
  // A flame arrow's burn: "approximately 22 damage per second to players" for 8 seconds (ark.wiki.gg, Flame Arrow,
  // 2026-11-15), as fire, so a body takes its own share of it. ARK's grows with the creature's size (DEV28).
  { type: "buff", id: "core:burning", label: "Burning", color: 3, seconds: 8, health: -22, damage: "fire" },
  { type: "buff", id: "core:tranquilized", label: "Tranquilized", color: 9, seconds: 5, again: "stack" },
  // A narcotic at work. Doses run one after another.
  { type: "buff", id: "core:drugged", label: "Drugged", color: 9, seconds: 8 },
  // A shock dart's stun holds a survivor where it stands for 2 seconds ("Decreased the stun on humans from shocking tranq
  // darts from 5 seconds to 2 seconds", patch 265.0, ark.wiki.gg, Shocking Tranquilizer Dart, 2026-11-15). A creature is
  // not stunned: "It can also stop the player from moving."
  { type: "buff", id: "core:stunned", label: "Stunned", color: 6, seconds: 2, root: true, only: ["core:survivor"] },
  { type: "buff", id: "core:injured", label: "Injured", color: 8, speed: 0.8 },
  // What a meal mends comes at this rate. A piece of cooked meat is 8 health over five seconds.
  { type: "buff", id: "core:fed", label: "Fed", color: 12, seconds: 5, health: 1.6, good: true },
  { type: "buff", id: "core:god", label: "God", color: 14, immune: true, good: true },
  // A missed arrow that did not break. It stays where it landed until someone walks over it.
  { type: "prop", class: "projectile", id: "core:arrow_stuck", mesh: "core:arrow", color: 15, radius: 0.1, height: 0.1, pitched: true },
  { type: "item", class: "resource", id: "core:fiber", stack: 300, weight: 0.01, color: 7 },
  // A slingshot's ammunition. Its speed is chosen.
  { type: "item", class: "resource", id: "core:stone", stack: 100, weight: 0.5, color: 15, ammo: { damage: 14, type: "melee", speed: 35, gravity: 9.81, torpor: { instant: 1.35, over: 0, seconds: 0 }, mesh: "core:stone_shot" } },
  // What a survivor gets of eating each is its infobox's (ark.wiki.gg, 2026-11-15). Our one berry stands for the four that
  // feed alike, each 1.5 food and 0.2 water (Mejoberry, Amarberry, Azulberry, Tintoberry). Raw meat is 10 food and takes
  // 5 health, at once as spoiled meat's harm is (Raw Meat); cooked meat 20 food and 8 health (Cooked Meat).
  { type: "item", class: "consumable", id: "core:berry", stack: 100, weight: 0.1, spoilHours: minutes(10), eat: { food: 1.5, water: 0.2 }, color: 8 },
  { type: "item", class: "consumable", id: "core:meat", stack: 40, weight: 0.1, spoilHours: minutes(10), eat: { food: 10 }, use: { adds: [{ stat: "health", amount: -5 }] }, color: 3, label: "raw meat", cooks: { into: "core:meat_cooked", seconds: 20 }, spoilsInto: "core:spoiled_meat" },
  { type: "item", class: "consumable", id: "core:meat_cooked", stack: 50, weight: 0.1, spoilHours: minutes(20), eat: { food: 20, health: 8 }, color: 3, label: "cooked meat", spoilsInto: "core:spoiled_meat" },
  // A piece burns 30 s in a campfire or forge and leaves one charcoal when it has burnt out (ark.wiki.gg Charcoal, Campfire).
  { type: "item", class: "resource", id: "core:wood", stack: 100, weight: 0.5, color: 3, fuel: 30, burnsInto: "core:charcoal" },
  { type: "item", class: "resource", id: "core:thatch", stack: 200, weight: 0.02, color: 18, fuel: 7.5 },
  { type: "item", class: "resource", id: "core:flint", stack: 100, weight: 0.05, color: 4 },
  { type: "item", class: "weapon", id: "core:pick", stack: 1, weight: 1, color: 2, tool: { on: "stone", power: 3, uses: 60 }, weapon: { kind: "melee", damage: 16, type: "melee", torpor: 0.5, uses: 60, mesh: "core:pick", hold: "tool" } },
  { type: "item", class: "weapon", id: "core:hatchet", stack: 1, weight: 1, color: 5, tool: { on: "wood", power: 3, uses: 60 }, weapon: { kind: "melee", damage: 20, type: "melee", uses: 60, mesh: "core:hatchet", hold: "tool" } },
  ...GEAR,

  ...NODES,

  ...crafting("core:pick", { needs: [{ item: "core:stone", count: 1 }, { item: "core:wood", count: 1 }, { item: "core:thatch", count: 10 }], seconds: 2, xp: 2 }),
  ...crafting("core:hatchet", { needs: [{ item: "core:flint", count: 1 }, { item: "core:wood", count: 1 }, { item: "core:thatch", count: 10 }], seconds: 2, xp: 2 }),
  { type: "engram", id: "core:engram-pick", label: "Stone pick", level: 1, cost: 0, item: "core:pick" },
  { type: "engram", id: "core:engram-hatchet", label: "Stone hatchet", level: 2, cost: 3, item: "core:hatchet" },
  ...MAKING,
  LEVELS,
];

export const CORE_CONTENT: readonly Def[] = crafted([...ALL, ...RUIN_BLOCKS, ...TERMINALS, ...SLOPE_BLOCKS, ...LETTER_BLOCKS]);

/** CORE_CONTENT as a pack, for stacking other packs on top. */
export const CORE_PACK: ContentPack = { name: "core", defs: CORE_CONTENT as readonly Def[] as unknown as ContentPack["defs"] };
