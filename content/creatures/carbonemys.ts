import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";
import { eggs, region } from "../creature-traits.ts";

const regions = [
  region("Body", 0x586345, 0x6d684e, 0x485f53),
  region("Hide markings", 0x8e713e, 0x86815a, 0x6f6144),
  region("Shell base", 0x6f482e, 0x564639, 0x795943),
  region("Shell growth", 0xa28c51, 0x887c55, 0x71846b),
  region("Shell margins", 0x453a31, 0x524b42, 0x544838),
  region("Underside", 0xbcaa7b, 0xb2a285, 0x938a72),
];
const color = regions[0]!.colors[0][0];

export const CARBONEMYS: readonly Def[] = [
  {
    type: "species", class: "creature", id: "core:carbonemys", tag: "carbonemys", aliases: ["Turtle_Character_BP_C"],
    mesh: "core:carbonemys", skeleton: "carbonemys", color, regions,
    radius: .88, height: 1.78, eyeHeight: 1.19, mass: 800, drag: 250,
    walkSpeed: 1.05, sprintMul: 2, swimSpeed: 3.2, turn: 62, strafe: false, jumpSpeed: 0,
    fists: 13, bite: { harvest: "berries", reach: 2.7, ticks: 24, lands: 12, stamina: 6 },
    temper: "defends", alarm: 12, leash: 30, defendsEgg: true,
    // A turtle: cold-blooded, barely there in a visor's heat view (D1034).
    blood: "cold",
    zones: { torso: .2, tail: .5 }, takes: { bullet: .7 },
    slots: 100, keeps: 4, torporDrain: .3, killXp: 12,
    taming: { a0: 3000, a1: 150, foodBase: .003156, proneMult: 352.0631, k: .2 },
    eats: [{ item: "core:berry", food: 20, affinity: 20 }], food: { max: 3000, perHour: .003156 * 140 },
    breeds: { egg: "core:egg_carbonemys", incubate: 4499.64003, mature: 83333.3333, scale: .22 },
    feces: "core:feces_medium", corpse: { health: 300, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 2, weight: 5, favoured: "wood" }, { item: "core:meat", min: 1, max: 2, weight: 4, favoured: "stone" }, { item: "core:keratin", min: 1, max: 1, weight: 2, favoured: "wood" }],
    stats: { health: [700, .2, .054], stamina: [200, .1, .1], food: [3000, .1, .1], weight: [270, .02, .04], melee: [1, .05, .017], speed: [1, 0, .01], torpidity: [275, .06, 0] },
  },
  ...eggs("carbonemys", "m", color, .09, .24, 12, 55),
  { type: "item", class: "saddle", id: "core:saddle_carbonemys", label: "Carbonemys saddle", color: 3, stack: 1, weight: 20,
    saddle: { fits: "core:carbonemys", armor: 25, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 2.036, .73], entry: [1.65, 0, .73] }] } },
  ...crafting("core:saddle_carbonemys", { needs: [{ item: "core:hide", count: 170 }, { item: "core:fiber", count: 95 }, { item: "core:paste", count: 10 }], seconds: 10, xp: 48 }),
  { type: "engram", id: "core:engram-saddle_carbonemys", label: "Carbonemys saddle", level: 10, cost: 12, item: "core:saddle_carbonemys" },
];
