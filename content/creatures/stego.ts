import type { Def } from "../../shared/content/defs.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { crafting } from "../craft.ts";

// The ordinary Stego, not a mission/summoned variant. Exact stats, taming and
// breeding are from pinned ARK Smart Breeding data; reference mechanics and
// chosen contact/handling tuning are separated in ref/CONTENT.md beside the art.
const palette = defaultPalette();
const tone = (rgb: number): number => nearestColour(palette, rgb >> 16, rgb >> 8 & 255, rgb & 255);
const colors = (...rgb: number[]): (readonly [number, number])[] => rgb.map(c => [tone(c), 3] as const);
export const STEGO_REGIONS = [
  { name: "Dorsal pattern", colors: colors(0x233b2d, 0x484537, 0x364b49, 0x5b4939) },
  { name: "Hide", colors: colors(0x435b39, 0x8b8061, 0x697774, 0x88735e) },
  { name: "Countershade", colors: colors(0x9c9669, 0xb7aa85, 0x8e988a, 0xafa18c) },
  { name: "Plate body", colors: colors(0x86522e, 0x875430, 0x655c44, 0x5b4d50) },
  { name: "Plate edge", colors: colors(0x493024, 0x51452a, 0x42494a, 0x614236) },
  { name: "Horn", colors: colors(0x998a5c, 0xb0a17e, 0x7e806d, 0x6c6250) },
];
export const STEGO_DYES = STEGO_REGIONS.map(r => r.colors[0]![0]);
const actionBones = [...Array.from({ length: 7 }, (_, i) => `tail_${i + 1}`), "neck_1", "neck_2", "neck_3", "skull", "jaw"];
// tameBonus is still a shared stub. Fold only this verified movement addition
// into the effective tame bases, before domestic speed/oxygen level modifiers.
// When tameBonus becomes active these factors must move into that calculation.
const freshTameSpeed = 1 + .964;
const tamedWalkBase = .765, tamedRunBase = 2.104, tamedSwimBase = 1.35;
const gather = (wood: number, thatch: number, berries: number) => ({ materials: ["wood", "plant"], power: 1, damage: 2,
  yields: [{ item: "core:wood", mult: wood }, { item: "core:thatch", mult: thatch }, { item: "core:berry", mult: berries }] });

export const STEGO: readonly Def[] = [
  {
    type: "species", class: "creature", id: "core:stego", aliases: ["stegosaurus"], tag: "stego",
    mesh: "core:stego", skeleton: "stego", color: STEGO_DYES[1]!,
    radius: 1.26, height: 4.13, eyeHeight: 1.32, swimDepth: 1.75, swimEyeHeight: 1.95,
    footprint: { back: -2.6, front: 2.4, radius: 1.2, head: { ahead: 2.75, up: 1.25, radius: 0.4 } },
    // Keep wild, source tame bases and effective fresh-tame movement distinct.
    walkSpeed: 1.7, sprintMul: 6.077 / 1.7, swimSpeed: 3,
    tamedWalkSpeed: tamedWalkBase * freshTameSpeed, tamedSprintMul: tamedRunBase / tamedWalkBase,
    tamedSwimSpeed: tamedSwimBase * freshTameSpeed,
    jumpSpeed: 0, turn: 65, strafe: false,
    stamina: { sprint: 20, regen: 10, jump: 0 },
    camera: { height: 4.65, distance: 7.5, forward: .65, avoidBody: true },
    fists: 42, bite: { reach: 6.7, ticks: 35, lands: 17, stamina: 12 },
    combat: {
      ai: { primary: { bearing: 150, distance: 5.3, arc: 20 } },
      primary: { name: "Tail sweep", clip: "attack", alternateClip: "attack_right", bones: actionBones,
        socket: "tail_tip", radius: .8, reach: 7, damage: 42, type: "melee", ticks: 35, lands: 14, through: 21,
        stamina: 12, knockback: 3, harvest: gather(1, 1, 1) },
      secondary: { name: "Impale", clip: "impale_in", bones: actionBones, socket: "impale", radius: .45,
        reach: 7, damage: 22, type: "melee", ticks: 31, lands: 23, through: 29, stamina: 20, cooldown: 90,
        impale: { socket: "impale", maxDrag: 200, maxHealthFraction: .5, seconds: 6, staminaPerSecond: 15, damagePerSecond: 8 } },
      modes: [
        { name: "Hardened", clip: "plate_hardened", damageTaken: .5, harvest: gather(3, .5, .5) },
        { name: "Heavy", clip: "plate_heavy", damageTaken: 1, slow: { multiplier: .5, seconds: 10 }, harvest: gather(.5, 3, .5) },
        { name: "Sharpened", clip: "plate_sharpened", damageTaken: 1, pierce: 1, harvest: gather(.5, .5, 3) },
      ],
      switchTicks: 30, weight: [{ item: "core:berry", mult: .25 }], protectsRider: true,
    },
    temper: "defends", defendsEgg: true, alarm: 15, sight: 24, leash: 50,
    // Mass, sight, leash, inventory and corpse yield are explicit SNARK choices.
    drag: 250, mass: 5000, slots: 300, keeps: 4,
    taming: { a0: 6000, a1: 300, foodBase: .005341, proneMult: 208.0343, k: .1 },
    eats: [{ item: "core:berry", food: 20, affinity: 20 }],
    food: { max: 6000, perHour: .005341 * 140 },
    breeds: { egg: "core:egg_stego", incubate: 9999.20006, mature: 185185.185, scale: .2 },
    feces: "core:feces_large", corpse: { health: 700, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 2, favoured: "wood" }, { item: "core:meat", min: 1, max: 2, favoured: "stone" }],
    takes: { bullet: .7 }, zones: { head: 1.67, torso: .7 }, killXp: 15, torporDrain: .3, regions: STEGO_REGIONS,
    stats: { health: [650, .2, .054], stamina: [300, .1, .1], oxygen: [150, .1, .1], food: [6000, .1, .1],
      weight: [500, .02, .04], melee: [1, .05, .017], speed: [1, 0, .02], torpidity: [500, .06, 0] },
    tameBonus: { health: [.5, 0], melee: [.5, .4], speed: [.964, 0], torpidity: [.5, 0] }, tamedHealth: 1,
  },
  { type: "prop", class: "egg", id: "core:egg_stego", mesh: "core:egg_m", color: STEGO_DYES[1]!, radius: .09, height: .24, item: "core:stego_egg", fertile: "core:stego_egg_fertile" },
  { type: "item", class: "egg", id: "core:stego_egg", label: "stego egg", color: STEGO_DYES[1]!, stack: 100, weight: 12,
    eat: { food: 55, health: 55 }, spoilHours: 8 * 24 * 3600 / 140, decomposeHours: 30 * 60 / 140 },
  { type: "item", class: "egg", id: "core:stego_egg_fertile", label: "fertilised stego egg", color: STEGO_DYES[1]!, stack: 1, weight: 12,
    eat: { food: 55, health: 55 }, spoilHours: 8 * 24 * 3600 / 140 },
  { type: "item", class: "saddle", id: "core:saddle_stego", stack: 1, weight: 20, label: "stego saddle", color: 3,
    saddle: { fits: "core:stego", armor: 25, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 2.59, 1.17], entry: [1.7, 0, 1.17],
      rider: { grips: { radius: .018, span: [-.11, .11], forearmAlignment: 75 }, hands: ["grip_l", "grip_r"], feet: ["rest_l", "rest_r"], soles: { sockets: ["sole_l", "sole_r"], half: [.115, .10] } } }] } },
  ...crafting("core:saddle_stego", { needs: [{ item: "core:hide", count: 200 }, { item: "core:fiber", count: 110 }, { item: "core:wood", count: 35 }], seconds: 10, xp: 125.6 }),
  { type: "engram", id: "core:engram-saddle_stego", label: "Stego saddle", level: 26, cost: 15, item: "core:saddle_stego" },
];
