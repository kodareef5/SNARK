import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";
import { naturalRegion } from "./colours.ts";

// Region positions are the six dye bytes carried by saved genomes.
const REGIONS = [
  naturalRegion("back", 0x365653, 0x3c503c, 0x405d69, 0x574333),
  naturalRegion("sides", 0x839266, 0x968159, 0x79887d, 0xa4a07b),
  naturalRegion("belly", 0xc6b58a, 0xd8c9a6, 0xb5b99a, 0xd9bb91),
  naturalRegion("crest", 0xbc6747, 0xbf944d, 0x9f493e, 0xd98868),
];

export const PARASAUR_DYES: readonly number[] = REGIONS.map((r) => r.colors[0]![0]);

export const PARASAUR: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:parasaur",
    tag: "parasaur",
    mesh: "core:parasaur",
    skeleton: "parasaur",
    color: PARASAUR_DYES[0]!,
    regions: [...REGIONS, null, null],
    radius: 1.1,
    height: 2.6,
    // Chosen physical kilograms for contact response, independent of inventory capacity.
    mass: 900,
    eyeHeight: 2.4,
    walkSpeed: 2.6,
    sprintMul: 2.4,
    jumpSpeed: 4,
    turn: 110,
    strafe: false,
    fists: 12,
    bite: { reach: 4.6 },
    slots: 30,
    keeps: 4,
    // The reference game's taming numbers.
    taming: { a0: 1500, a1: 75, foodBase: 0.001929, proneMult: 864.01, k: 0.4 },
    eats: [{ item: "core:berry", food: 20, affinity: 20 }],
    // The reference game's rate, 0.001929 a second. Its young start at 510 times that.
    food: { max: 1500, perHour: 0.27 },
    // The reference game's times, in seconds.
    breeds: { egg: "core:egg_parasaur", incubate: 5142, mature: 95238 },
    feces: "core:feces_medium",
    // Chosen, near what it gave before bodies were harvested: 12 hide and 11 meat in all on average.
    corpse: { health: 230, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 1, weight: 12, favoured: "wood" }, { item: "core:meat", min: 1, max: 1, weight: 11, favoured: "stone" }],
    // Every creature takes 70% from guns ("all creatures aside from Humans", ark.wiki.gg, Longneck Rifle, 2026-11-15).
    takes: { bullet: 0.7 },
    zones: { head: 1.5 },
    killXp: 6,
    torporDrain: 0.3,
    stats: { health: [200, 0.2, 0.054], stamina: [200, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [1500, 0.1, 0.1], weight: [255, 0.02, 0.04], melee: [1, 0.05, 0.017], speed: [1, 0, 0.01], torpidity: [150, 0.06, 0] },
  },
  // ARK's Parasaur Egg, as the wiki gives it: an extra small egg of 5, eaten as 25 food and 25 health, that spoils in 8 hours.
  { type: "prop", class: "egg", id: "core:egg_parasaur", mesh: "core:egg_xs", color: 9, radius: 0.04, height: 0.11, item: "core:parasaur_egg", fertile: "core:parasaur_egg_fertile" },
  { type: "item", class: "egg", id: "core:parasaur_egg", label: "parasaur egg", color: 9, stack: 100, weight: 5, eat: { food: 25, health: 25 }, spoilHours: (8 * 3600) / 140, decomposeHours: (30 * 60) / 140 },
  { type: "item", class: "egg", id: "core:parasaur_egg_fertile", label: "fertilised parasaur egg", color: 9, stack: 1, weight: 5, eat: { food: 25, health: 25 }, spoilHours: (8 * 3600) / 140 },
  // One seat, ARK's: the rider's, on the rig's `seat` socket, got onto and off from its left.
  { type: "item", class: "saddle", id: "core:saddle_parasaur", stack: 1, weight: 10, label: "parasaur saddle", color: 3, saddle: { fits: "core:parasaur", armor: 25, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 2.57, 0.7], entry: [1.7, 0, 0.7] }] } },
  ...crafting("core:saddle_parasaur", { needs: [{ item: "core:hide", count: 80 }, { item: "core:fiber", count: 50 }, { item: "core:wood", count: 15 }], seconds: 10, xp: 6 }),
  { type: "engram", id: "core:engram-saddle_parasaur", label: "Parasaur saddle", level: 9, cost: 9, item: "core:saddle_parasaur" },
];
