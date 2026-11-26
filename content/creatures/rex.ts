import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";
import { eggs, region } from "../creature-traits.ts";

// Each region's first colour is the palette's nearest brown to the model's own, measured by
// assets/source/core/creatures/rex/ref/paint.py, so a wild Rex looks as the model was painted. Where the nearest is olive
// (the face and limbs) the brown beside it comes first and the olive second.
const regions = [
  region("Flanks", 0x54412e, 0x4f4e32, 0x5e3c28),
  region("Throat and belly", 0x9a7f5b, 0x7f7970, 0x8b9166),
  region("Dorsal bars", 0x3a261c, 0x2e2420, 0x442c20),
  region("Face and nasal ridges", 0x655038, 0x5e5e3e, 0x75524c),
  region("Limbs and tail bands", 0x54412e, 0x4f4e32, 0x624440),
  region("Claws and brow scutes", 0x3a261c, 0x442c20, 0x312d2a),
];
const color = regions[0]!.colors[0][0];

export const REX: readonly Def[] = [
  {
    type: "species", class: "creature", id: "core:rex", tag: "rex", aliases: ["Rex_Character_BP_C"],
    mesh: "core:rex", skeleton: "rex", color, regions,
    // It stands 5.76 m to the top of its head. The bite reaches its snout, 6.0 m ahead of its hips.
    radius: 1.7, height: 5.6, eyeHeight: 4.9, mass: 8300, drag: 550,
    footprint: { back: -2.4, front: 3.0, radius: 1.45, head: { ahead: 5.4, up: 4.5, radius: 0.8 } },
    walkSpeed: 2.8, sprintMul: 3, swimSpeed: 3, turn: 49, strafe: false, jumpSpeed: 0,
    fists: 62, bite: { harvest: "carrion", reach: 6.2, ticks: 23, lands: 10, stamina: 12 },
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
    size: "apex",
    drops: [{ item: "core:meat", min: 1, max: 3, weight: 6, favoured: "stone" }, { item: "core:hide", min: 1, max: 2, weight: 4, favoured: "wood" }, { item: "core:meat_prime", min: 1, max: 1, weight: 1, favoured: "stone" }],
    stats: { health: [1100, .2, .054], stamina: [420, .1, .1], oxygen: [150, .1, .1], food: [3000, .1, .1], weight: [500, .02, .04], melee: [1, .05, .017], speed: [1, 0, .01], torpidity: [1550, .06, 0] },
  },
  ...eggs("rex", "xl", color, .18, .48, 15, 80),
  // The seat and the rider's hands, feet and knees are the asset's sockets (assets/source/core/creatures/rex/ref/rider.json);
  // the anchor is where the seat is at rest.
  { type: "item", class: "saddle", id: "core:saddle_rex", label: "Rex saddle", color: 3, stack: 1, weight: 20,
    saddle: { fits: "core:rex", armor: 25, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 5.025, 1.0], entry: [2.6, 0, 1.0],
      rider: { hands: ["grip_l", "grip_r"], feet: ["rest_l", "rest_r"], knees: ["knee_l", "knee_r"],
        soles: { sockets: ["sole_l", "sole_r"], half: [.15, .13] }, grips: { radius: .027, span: [-.12, .13], forearmAlignment: 75 } } }] } },
  ...crafting("core:saddle_rex", { needs: [{ item: "core:hide", count: 380 }, { item: "core:fiber", count: 200 }, { item: "core:ingot", count: 50 }], seconds: 12, xp: 86, at: "core:smithy" }),
  { type: "engram", id: "core:engram-saddle_rex", label: "Rex saddle", level: 74, cost: 40, item: "core:saddle_rex" },
];
