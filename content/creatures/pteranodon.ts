import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

// The pteranodon, as a stand-in: a grey box with ARK's numbers at 1x, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15
// on the Pteranodon page and its items' pages, in metres and seconds. What it does in ARK, and where each number is from,
// is assets/source/core/creatures/pteranodon/ref/FUNCTIONS.md; a number with no source there says it was chosen. The art
// replaces its mesh under the same id, which is this definition's (PA5 of planning/reference/flyers-plan.md): nothing here
// depends on how it looks. Its flight, grab, egg rule, rider's weight and damage rules are read by nothing until the
// plan's packages build them.

/** The egg in the hand, ARK's Pteranodon Egg: a small egg of 7 that spoils in 8 hours and lies 30 minutes, eaten as 35 food and 35 health (its 35 stamina has no field). */
export const PTERANODON_EGG: ItemDef = {
  type: "item", class: "egg",
  id: "core:pteranodon_egg",
  label: "pteranodon egg",
  color: 6,
  stack: 100,
  weight: 7,
  eat: { food: 35, health: 35 },
  spoilHours: (8 * 3600) / 140,
  decomposeHours: (30 * 60) / 140,
};

/** Fertilised, one of a kind that keeps its young, as the raptor's is. It lies until it hatches. */
const { decomposeHours: _, ...kept } = PTERANODON_EGG;
export const PTERANODON_EGG_FERTILE: ItemDef = { ...kept, id: "core:pteranodon_egg_fertile", label: "fertilised pteranodon egg", stack: 1 };

export const PTERANODON: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:pteranodon",
    tag: "pteranodon",
    mesh: "box",
    color: 6,
    // Chosen from TRAITS.md until the model is measured: the head stands about a survivor's height, the eye at 1.8 m, and a
    // capsule 1.5 m wide, wider than a doorway's 1.4, so that it cannot pass one, as ARK made it (ASE 260.0). A box's rider
    // sits on its top.
    radius: 0.75,
    height: 1.9,
    eyeHeight: 1.8,
    // 260 units a second on all fours, with no run on the ground, and 300 swimming. It never jumps in ARK; jump will take it
    // off (FL1), and until then this is a hop no mind asks for.
    walkSpeed: 2.6,
    sprintMul: 1,
    swimSpeed: 3,
    jumpSpeed: 3,
    // Chosen: ARK's turning rate is not published.
    turn: 180,
    strafe: false,
    // Walking costs 0.025 a second. It has no sprint on the ground, so none is spent there; regeneration and the jump are the
    // engine's defaults, regeneration after 10 s on the ground once it has flown (fly.wait).
    stamina: { sprint: 0, regen: 8, jump: 6, walk: 0.025 },
    // 600 units a second flying, a sprint of 1,650 wild and 1,897.5 tamed. 0.325 stamina a second flying or hovering (the
    // page; hovering is given no rate), 6 sprinting, 90 a barrel roll and 40 a grab, and none back for 10 s after it flies.
    // A roll every 7 s. Chosen, as ARK publishes none: the acceleration, the turn in the air and the roll's burst.
    fly: { speed: 6, sprintMul: 2.75, tamedSprintMul: 3.1625, accel: 12, turn: 120, stamina: { fly: 0.325, sprint: 6, roll: 90, grab: 40 }, wait: 10, roll: { burst: 10, every: 7 } },
    // It lifts at most 50 of drag weight, within 500 units below it: of ours the dodo and a survivor.
    grab: { drag: 50, reach: 5 },
    // Its bite: 18, every 0.67 s, for 5 stamina. Chosen until the model measures it: a reach of 1.6 m past its body, landing
    // at tick 8 of its 20.
    fists: 18,
    bite: { reach: 1.6, ticks: 20, lands: 8, stamina: 5 },
    // Skittish: it flies from harm, and its kind turn on whoever takes their egg.
    temper: "flees",
    defendsEgg: true,
    // A rider's weight counts 0.85 on it. It takes half again from arrows, darts and stones, and does 0.4 to structures.
    riderWeight: 0.85,
    missiles: 1.5,
    structures: 0.4,
    // Carried by a Megalosaurus as 149 of drag weight; its mass is 190. No survivor picks it up.
    drag: 149,
    mass: 190,
    feces: "core:feces_small",
    // ARK has no slot limit for a creature but its weight, and holds 300 stacks at most in any inventory.
    slots: 300,
    keeps: 4,
    // Knock-out taming, ARK's five numbers.
    taming: { a0: 1200, a1: 60, foodBase: 0.001543, proneMult: 216.029373, k: 3.125 },
    // Of ARK's foods for it, best first, those that exist: Regular Kibble and raw mutton wait for their items, and until then
    // it is tamed on meats, as ARK allows.
    eats: [
      { item: "core:meat_prime", food: 50, affinity: 150 },
      { item: "core:meat_prime_cooked", food: 49.945, affinity: 75 },
      { item: "core:meat", food: 50, affinity: 50 },
      { item: "core:meat_cooked", food: 25, affinity: 25 },
    ],
    // 0.001543 food a second, in hours of 140 seconds.
    food: { max: 1200, perHour: 0.21602 },
    // A small egg that hatches in 5,999.52 s; the young grows up in 133,333.33.
    breeds: { egg: "core:egg_pteranodon", incubate: 5999.52, mature: 133333.33 },
    // Chosen from the yields an ASA data site gives (about 7 hide and 4 meat to a hatchet, 5 and 6 to a pick, unverified):
    // eleven rolls of 10 against our tools, a hatchet favouring hide and a pick meat, as the dodo's are.
    corpse: { health: 110, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 1, favoured: "wood" }, { item: "core:meat", min: 1, max: 1, favoured: "stone" }],
    // Its head takes three times; damage by type is the shared carnivore's, as the raptor's is.
    zones: { head: 3 },
    // The experience the infobox gives for a kill at level 1. Its data module's base is 3.
    killXp: 12,
    torporDrain: 0.3,
    // Gains for a tame are the raw gain times ARK's default (index.ts): health 0.15 x 0.2, melee 0.075 x 0.17. Flyers have no
    // speed levels (ASE 256.0).
    stats: { health: [210, 0.2, 0.03], stamina: [150, 0.05, 0.04], oxygen: [150, 0.1, 0.1], food: [1200, 0.1, 0.1], weight: [120, 0.02, 0.03], melee: [1, 0.05, 0.01275], speed: [1, 0, 0], torpidity: [120, 0.06, 0] },
    // ARK's taming bonuses (Ta, Tm) and a tame's base health of 0.9, read once taming bonuses are built.
    tameBonus: { health: [0.5, 0], food: [0, 0.15], melee: [0.65, 0.4], speed: [0.35, 0], torpidity: [0.5, 0] },
    tamedHealth: 0.9,
  },
  // ARK's is a small egg.
  { type: "prop", class: "egg", id: "core:egg_pteranodon", mesh: "core:egg_s", color: 6, radius: 0.06, height: 0.16, item: "core:pteranodon_egg", fertile: "core:pteranodon_egg_fertile" },
  PTERANODON_EGG,
  PTERANODON_EGG_FERTILE,
  // ARK's Pteranodon Saddle: armour 25, weight 20, learned at level 38 for 15 points, made in the hands in 10 s for 43
  // experience from 230 hide, 125 fiber and 75 chitin (or keratin, which this build lacks).
  { type: "item", class: "saddle", id: "core:saddle_pteranodon", stack: 1, weight: 20, label: "pteranodon saddle", color: 3, saddle: { fits: "core:pteranodon", armor: 25 } },
  crafting("core:saddle_pteranodon", { needs: [{ item: "core:hide", count: 230 }, { item: "core:fiber", count: 125 }, { item: "core:chitin", count: 75 }], seconds: 10, xp: 43 }),
  { type: "engram", id: "core:engram-saddle_pteranodon", label: "Pteranodon saddle", level: 38, cost: 15, item: "core:saddle_pteranodon" },
];
