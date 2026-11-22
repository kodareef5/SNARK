import type { Def } from "../../shared/content/defs.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { eggs } from "../creature-traits.ts";
import { crafting } from "../craft.ts";

const palette = defaultPalette();
const tone = (v: number) => nearestColour(palette, v >>> 16, (v >>> 8) & 255, v & 255);
const pigments = [
  ["River hide", [0x728a79, 0x88917a, 0x697f82]],
  ["Throat and belly", [0xbeb28e, 0xc8b999, 0xaeb9a8]],
  ["Sail", [0xb27950, 0xad8958, 0x9d6f60]],
  ["Flank bars", [0x46554b, 0x565648, 0x46565c]],
  ["Face", [0x81917a, 0x92866d, 0x849594]],
  ["Limbs and claws", [0x7c7964, 0x858068, 0x717967]],
] as const;
export const SPINO_REGIONS = pigments.map(([name, swatches]) => ({
  name,
  colors: swatches.map((v) => [tone(v), 1] as const),
}));
const egg = tone(0xb7ae8c);
export const SPINO: readonly Def[] = [
  {
    type: "species",
    class: "creature",
    id: "core:spino",
    tag: "spino",
    aliases: ["Spino_Character_BP_C"],
    mesh: "core:spino",
    skeleton: "spino",
    color: tone(0x728a79),
    regions: SPINO_REGIONS,
    radius: 1.3,
    footprint: { back: -2.5, front: 3.9, radius: 0.95 },
    height: 5.19,
    eyeHeight: 3.43,
    mass: 6200,
    drag: 550,
    walkSpeed: 2.12,
    sprintMul: 2.83,
    swimSpeed: 5,
    turn: 53,
    strafe: false,
    jumpSpeed: 0,
    camera: { height: 5.3, distance: 9, forward: 1.3, avoidBody: true },
    fists: 50,
    bite: { reach: 6.95, ticks: 24, lands: 12, stamina: 12 },
    combat: {
      primary: {
        name: "Bite",
        clip: "attack",
        bones: ["neck_1", "neck_2", "skull", "jaw"],
        socket: "bite",
        radius: 0.53,
        reach: 6.95,
        damage: 50,
        type: "melee",
        ticks: 24,
        lands: 12,
        through: 15,
        stamina: 12,
      },
    },
    temper: "hunts",
    sight: 29,
    leash: 65,
    slots: 180,
    keeps: 4,
    torporDrain: 1.1,
    killXp: 110,
    takes: { bullet: 0.7 },
    taming: { a0: 3100, a1: 145, foodBase: 0.0025, proneMult: 175, k: 1.25 },
    eats: [
      { item: "core:meat", food: 50, affinity: 50 },
      { item: "core:meat_cooked", food: 25, affinity: 25 },
    ],
    food: { max: 2600, perHour: 0.35 },
    breeds: { egg: "core:egg_spino", incubate: 13600, mature: 333333, scale: 0.2 },
    feces: "core:feces_large",
    corpse: { health: 680, roll: 9 },
    drops: [
      { item: "core:meat", min: 1, max: 3, weight: 6, favoured: "stone" },
      { item: "core:hide", min: 1, max: 2, weight: 4, favoured: "wood" },
    ],
    stats: {
      health: [700, 0.2, 0.054],
      stamina: [350, 0.1, 0.1],
      oxygen: [650, 0.1, 0.1],
      food: [2600, 0.1, 0.1],
      weight: [350, 0.02, 0.04],
      melee: [1, 0.05, 0.017],
      speed: [1, 0, 0.01],
      torpidity: [850, 0.06, 0],
    },
  },
  ...eggs("spino", "l", egg, 0.12, 0.33, 12, 80),
  {
    type: "item",
    class: "saddle",
    id: "core:saddle_spino",
    label: "Spino saddle",
    color: 3,
    stack: 1,
    weight: 20,
    saddle: {
      fits: "core:spino",
      armor: 25,
      seats: [
        {
          id: "rider",
          driver: true,
          socket: "seat",
          anchor: [0, 3.45, 3.47],
          entry: [1.8, 0, 3.35],
          rider: { hands: ["grip_l", "grip_r"], feet: ["rest_l", "rest_r"] },
        },
      ],
    },
  },
  ...crafting("core:saddle_spino", {
    needs: [
      { item: "core:hide", count: 380 },
      { item: "core:fiber", count: 200 },
      { item: "core:ingot", count: 45 },
    ],
    seconds: 12,
    xp: 80,
    at: "core:smithy",
  }),
  {
    type: "engram",
    id: "core:engram-saddle_spino",
    label: "Spino saddle",
    level: 71,
    cost: 40,
    item: "core:saddle_spino",
  },
];
