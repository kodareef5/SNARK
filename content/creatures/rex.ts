import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";
import { eggs, region } from "../creature-traits.ts";

const regions = [
  region("Flanks", 0x777348, 0x6d6354, 0x697863),
  region("Throat and belly", 0xc0a477, 0xa99b80, 0xbeae88),
  region("Dorsal bars", 0x49483b, 0x53463d, 0x38413c),
  region("Face and nasal ridges", 0x99664a, 0x826c4d, 0x91645d),
  region("Limbs and tail bands", 0x62644c, 0x635e54, 0x5a665a),
  region("Claws and brow scutes", 0x92774f, 0x897b64, 0x796a58),
];
const color = regions[0]!.colors[0][0];

export const REX: readonly Def[] = [
  {
    type: "species", class: "creature", id: "core:rex", tag: "rex", aliases: ["Rex_Character_BP_C"],
    mesh: "core:rex", skeleton: "rex", color, regions,
    radius: 1.42, height: 4.48, eyeHeight: 3.62, mass: 8300, drag: 550,
    walkSpeed: 2.8, sprintMul: 3, swimSpeed: 3, turn: 49, strafe: false, jumpSpeed: 0,
    fists: 62, bite: { harvest: "carrion", reach: 5.1, ticks: 23, lands: 10, stamina: 12 },
    roar: { range: 12, maxDrag: 200, cooldown: 8, immunity: 12, interrupt: 1 },
    temper: "hunts", sight: 32, leash: 75, takes: { bullet: .7 },
    slots: 200, keeps: 4, torporDrain: .725, killXp: 120,
    taming: { a0: 3450, a1: 150, foodBase: .002314, proneMult: 180.0634, k: 1.25 },
    eats: [
      { item: "core:meat_prime", food: 50, affinity: 150 }, { item: "core:meat_prime_cooked", food: 50, affinity: 75 },
      { item: "core:meat", food: 50, affinity: 50 }, { item: "core:meat_cooked", food: 25, affinity: 25 },
    ],
    food: { max: 3000, perHour: .002314 * 140 }, breeds: { egg: "core:egg_rex", incubate: 17998.5601, mature: 333333.333, scale: .2 },
    feces: "core:feces_large", corpse: { health: 750, roll: 10 },
    drops: [{ item: "core:meat", min: 1, max: 3, weight: 6, favoured: "stone" }, { item: "core:hide", min: 1, max: 2, weight: 4, favoured: "wood" }, { item: "core:meat_prime", min: 1, max: 1, weight: 1, favoured: "stone" }],
    stats: { health: [1100, .2, .054], stamina: [420, .1, .1], oxygen: [150, .1, .1], food: [3000, .1, .1], weight: [500, .02, .04], melee: [1, .05, .017], speed: [1, 0, .01], torpidity: [1550, .06, 0] },
  },
  ...eggs("rex", "xl", color, .18, .48, 15, 80),
  { type: "item", class: "saddle", id: "core:saddle_rex", label: "Rex saddle", color: 3, stack: 1, weight: 20,
    saddle: { fits: "core:rex", armor: 25, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 4.12, .49], entry: [2.1, 0, .49] }] } },
  ...crafting("core:saddle_rex", { needs: [{ item: "core:hide", count: 380 }, { item: "core:fiber", count: 200 }, { item: "core:ingot", count: 50 }], seconds: 12, xp: 86, at: "core:smithy" }),
  { type: "engram", id: "core:engram-saddle_rex", label: "Rex saddle", level: 74, cost: 40, item: "core:saddle_rex" },
];
