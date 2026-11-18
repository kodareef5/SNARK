import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";
import { naturalRegion } from "./colours.ts";

// Region positions are the six dye bytes carried by saved genomes.
const REGIONS = [
  naturalRegion("back", 0x7b664c, 0x6d7170, 0x865437, 0x687047, 0xa99272),
  naturalRegion("belly", 0xd1bb96, 0xe9ddc0, 0xb5b5a8, 0xc5ac7e),
  naturalRegion("claws", 0x393430, 0x564c3f, 0x6c6350),
  naturalRegion("wing and tail bars", 0x41484b, 0x50402e, 0x6a6d6b),
  naturalRegion("face", 0x9b5e3f, 0xae8146, 0xb37c74, 0x877c6e),
  naturalRegion("feather tips", 0xdbc69b, 0xebe2cc, 0xb6a572, 0xb08c5a),
];

export const RAPTOR_DYES: readonly number[] = REGIONS.map((r) => r.colors[0]![0]);

export const RAPTOR: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:raptor",
    tag: "raptor",
    mesh: "core:raptor",
    skeleton: "raptor",
    color: RAPTOR_DYES[0]!,
    regions: REGIONS,
    radius: 0.6,
    height: 1.5,
    // Chosen physical kilograms, close to the former capsule-derived 150 kg fallback.
    mass: 150,
    eyeHeight: 1.3,
    walkSpeed: 3.2,
    sprintMul: 2.6,
    jumpSpeed: 6,
    turn: 240,
    strafe: false,
    fists: 15,
    temper: "hunts",
    sight: 22,
    leash: 60,
    bite: { reach: 2.6 },
    slots: 20,
    keeps: 4,
    // The reference game's taming numbers.
    taming: { a0: 1200, a1: 60, foodBase: 0.001543, proneMult: 648.09, k: 3.125 },
    eats: [{ item: "core:meat", food: 50, affinity: 50 }, { item: "core:meat_cooked", food: 25, affinity: 25 }],
    // The reference game's rate, 0.001543 a second.
    food: { max: 1200, perHour: 0.216 },
    breeds: { egg: "core:egg_raptor", incubate: 7199, mature: 133333 },
    feces: "core:feces_small",
    // Chosen, near what it gave before bodies were harvested: 7.5 hide and 6 meat in all on average.
    corpse: { health: 135, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 1, weight: 7.5, favoured: "wood" }, { item: "core:meat", min: 1, max: 1, weight: 6, favoured: "stone" }],
    // Every creature takes 70% from guns ("all creatures aside from Humans", ark.wiki.gg, Longneck Rifle, 2026-11-15).
    takes: { bullet: 0.7 },
    zones: { head: 3 },
    killXp: 8,
    torporDrain: 0.3,
    stats: { health: [200, 0.2, 0.054], stamina: [150, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [1200, 0.1, 0.1], weight: [140, 0.02, 0.04], melee: [1, 0.05, 0.017], speed: [1, 0, 0.01], torpidity: [180, 0.06, 0] },
  },
  // ARK's Raptor Egg, as the wiki gives it: a small egg of 7, eaten as 35 food and 35 health, that spoils in 8 hours.
  { type: "prop", class: "egg", id: "core:egg_raptor", mesh: "core:egg_s", color: 5, radius: 0.06, height: 0.16, item: "core:raptor_egg", fertile: "core:raptor_egg_fertile" },
  { type: "item", class: "egg", id: "core:raptor_egg", label: "raptor egg", color: 5, stack: 100, weight: 7, eat: { food: 35, health: 35 }, spoilHours: (8 * 3600) / 140, decomposeHours: (30 * 60) / 140 },
  { type: "item", class: "egg", id: "core:raptor_egg_fertile", label: "fertilised raptor egg", color: 5, stack: 1, weight: 7, eat: { food: 35, health: 35 }, spoilHours: (8 * 3600) / 140 },
  // One seat, ARK's: the rider's, on the rig's `seat` socket, got onto and off from its left.
  { type: "item", class: "saddle", id: "core:saddle_raptor", stack: 1, weight: 10, label: "raptor saddle", color: 3, saddle: { fits: "core:raptor", armor: 25, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 1.374, 0.02], entry: [1.2, 0, 0.02] }] } },
  ...crafting("core:saddle_raptor", { needs: [{ item: "core:hide", count: 110 }, { item: "core:fiber", count: 65 }, { item: "core:wood", count: 20 }], seconds: 10, xp: 8 }),
  { type: "engram", id: "core:engram-saddle_raptor", label: "Raptor saddle", level: 18, cost: 9, item: "core:saddle_raptor" },
];
