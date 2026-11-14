import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

export const RAPTOR: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:raptor",
    tag: "raptor",
    mesh: "core:raptor",
    skeleton: "dino",
    color: 5,
    radius: 0.6,
    height: 1.5,
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
    drops: [{ item: "core:hide", min: 5, max: 10 }, { item: "core:meat", min: 4, max: 8 }],
    zones: { head: 3 },
    killXp: 8,
    torporDrain: 0.3,
    stats: { health: [200, 0.2, 0.054], stamina: [150, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [1200, 0.1, 0.1], weight: [140, 0.02, 0.04], melee: [1, 0.05, 0.017], speed: [1, 0, 0.01], torpidity: [180, 0.06, 0] },
  },
  { type: "prop", class: "egg", id: "core:egg_raptor", mesh: "core:egg", color: 5, radius: 0.3, height: 0.7 },
  { type: "item", class: "saddle", id: "core:saddle_raptor", stack: 1, weight: 10, label: "raptor saddle", color: 3, saddle: { fits: "core:raptor", armor: 25 } },
  crafting("core:saddle_raptor", { needs: [{ item: "core:hide", count: 110 }, { item: "core:fiber", count: 65 }, { item: "core:wood", count: 20 }], seconds: 10, xp: 8 }),
  { type: "engram", id: "core:engram-saddle_raptor", label: "Raptor saddle", level: 18, cost: 9, item: "core:saddle_raptor" },
];
