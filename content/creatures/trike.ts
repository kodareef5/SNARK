import type { Def } from "../../shared/content/defs.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { crafting } from "../craft.ts";

// Reference evidence, edition differences and deliberately chosen parameters:
// assets/source/core/creatures/trike/ref/DESIGN.md and planning/workstreams/trike.md.
const palette = defaultPalette();
const tone = (rgb: number): number => nearestColour(palette, rgb >> 16, (rgb >> 8) & 255, rgb & 255);
const colors = (...rgb: number[]): (readonly [number, number])[] => rgb.map(c => [tone(c), 3] as const);
const REGIONS = [
  { name: "Flank", colors: colors(0x677460, 0x797565, 0x5c6869, 0x746451, 0x8a795e) },
  { name: "Throat and belly", colors: colors(0xa19775, 0xaaa28d, 0x8b8069, 0xb6a581) },
  { name: "Back markings", colors: colors(0x425246, 0x4e514c, 0x5a4939, 0x343e40) },
  { name: "Frill", colors: colors(0x9f6042, 0x907649, 0x66736a, 0x855850, 0xa3895d) },
  { name: "Limbs", colors: colors(0x677460, 0x797565, 0x5c6869, 0x746451) },
  { name: "Keratin", colors: colors(0xc4b58f, 0xb4a080, 0x857057, 0x9e8258) },
];
export const TRIKE_DYES: readonly number[] = REGIONS.map(r => r.colors[0]![0]);

export const TRIKE: readonly Def[] = [
  {
    type: "species", class: "creature", id: "core:trike", tag: "trike", mesh: "core:trike", skeleton: "trike", color: TRIKE_DYES[0]!,
    // Original adult: 7.98m horn-to-tail, 2.47m shield width, 3.17m shield top.
    // Capsule encloses the weight-bearing body; articulated zones cover head,
    // horns, shield and tail. A two-metre doorway is too narrow for this animal.
    radius: 1.25, height: 3.17, eyeHeight: 1.97,
    footprint: { back: -2.0, front: 2.6, radius: 1.15, head: { ahead: 2.9, up: 2.0, radius: 0.75 } },
    // ASE community table: 1.5m/s walk, 6.075 wild sprint, 3m/s swim.
    // Owned sprint is deliberately 6m/s; edition/multiplier reports conflict.
    walkSpeed: 1.5, sprintMul: 4.05, tamedSprintMul: 4, swimSpeed: 3,
    // Paired lower nostril openings reach at least1.68035m in both water loops.
    swimDepth: 1.48, swimEyeHeight: 1.68, jumpSpeed: 0, turn: 72, strafe: false,
    stamina: { sprint: 14, regen: 12, jump: 10, walk: .025 },
    fists: 32, bite: { reach: 4.7, ticks: 21, lands: 5 },
    temper: "defends", alarm: 22, drag: 300, mass: 6000,
    slots: 300, keeps: 4,
    // Base Trike in ARK Smart Breeding f03495ce values/values.json. The ASA
    // values entry does not override these inherited taming constants.
    taming: { a0: 3000, a1: 150, foodBase: .003156, proneMult: 352.0631, k: .2 },
    eats: [{ item: "core:berry", food: 20, affinity: 20 }],
    food: { max: 3000, perHour: .44184 },
    breeds: { egg: "core:egg_trike", incubate: 8999, mature: 166666 },
    feces: "core:feces_medium",
    corpse: { health: 230, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 1, weight: 12, favoured: "wood" }, { item: "core:meat", min: 1, max: 1, weight: 10, favoured: "stone" }],
    takes: { fire: .375, explosive: .6, bullet: .7 },
    // A chosen conservative implementation of the protective frill/head;
    // community sources disagree between .15 and rounded .2.
    zones: { head: .2 }, killXp: 4, torporDrain: .3,
    stats: { health: [375, .2, .054], stamina: [150, .1, .1], oxygen: [150, .1, .1], food: [3000, .1, .1],
      weight: [365, .02, .04], melee: [1, .05, .017], speed: [1, 0, .015], torpidity: [250, .06, 0] },
    regions: REGIONS,
    camera: { height: 4.9, distance: 9, forward: 1.0, avoidBody: true },
    combat: {
      ai: { primary: { bearing: 0, distance: 3.35, arc: 30 }, charge: { minDistance: 7, maxDistance: 16 } },
      primary: { name: "Horn sweep", clip: "attack", bones: ["neck", "skull", "jaw"], socket: "horn_contact", radius: .55, reach: 5.8,
        damage: 32, type: "melee", ticks: 21, lands: 4, through: 10, stamina: 4, knockback: 3,
        harvest: { materials: ["plant", "wood"], power: 2, damage: 32,
          yields: [{ item: "core:berry", mult: 4 }, { item: "core:thatch", mult: 4 }, { item: "core:wood", mult: .5 }] } },
      charge: { minWindup: 10, windup: 60, duration: 120, recovery: 25, cooldown: 75, speed: 10, turn: 38, stamina: 12, staminaPerSecond: 16,
        attack: { name: "Ram", clip: "charge", socket: "horn_contact", radius: .60, reach: 5.5,
          damage: 48, type: "melee", ticks: 120, lands: 1, through: 119, stamina: 0, knockback: 7,
          slow: { multiplier: .55, seconds: 5 } } },
      // Official TLC verifies +10% health and slight damage/resistance;
      // range, threat threshold and the two remaining multipliers are ours.
      rivalry: { distance: 18, minThreatDrag: 400, damage: 1.10, resistance: .90, health: 1.10, signalRegion: 3 },
    },
  },
  // The existing small egg mesh is a deliberate shared-art reuse. No new egg
  // texture or breed-specific model is claimed by this delivery.
  { type: "prop", class: "egg", id: "core:egg_trike", mesh: "core:egg_s", color: tone(0xc7bc9d), radius: .06, height: .16, item: "core:trike_egg", fertile: "core:trike_egg_fertile" },
  { type: "item", class: "egg", id: "core:trike_egg", label: "trike egg", color: tone(0xc7bc9d), stack: 100, weight: 7, eat: { food: 35, health: 35 }, spoilHours: (8 * 3600) / 140, decomposeHours: (30 * 60) / 140 },
  { type: "item", class: "egg", id: "core:trike_egg_fertile", label: "fertilised trike egg", color: tone(0xc7bc9d), stack: 1, weight: 7, eat: { food: 35, health: 35 }, spoilHours: (8 * 3600) / 140 },
  { type: "item", class: "saddle", id: "core:saddle_trike", stack: 1, weight: 20, label: "trike saddle", color: tone(0x6d472b),
    saddle: { fits: "core:trike", armor: 20, seats: [{ id: "rider", driver: true, socket: "seat", anchor: [0, 3.575, -.25], entry: [1.75, 0, -.25],
      rider: { hands: ["grip_l", "grip_r"], feet: ["rest_l", "rest_r"], knees: ["knee_l", "knee_r"],
        soles: { sockets: ["sole_l", "sole_r"], half: [.15, .13] }, grips: { radius: .017, span: [-.12, .13], forearmAlignment: 75 } } }] } },
  ...crafting("core:saddle_trike", { needs: [{ item: "core:hide", count: 140 }, { item: "core:fiber", count: 80 }, { item: "core:wood", count: 25 }], seconds: 10, xp: 22.2 }),
  { type: "engram", id: "core:engram-saddle_trike", label: "Trike saddle", level: 16, cost: 12, item: "core:saddle_trike" },
];
