import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";

// The dodo. Its numbers are ARK's at 1x, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-14 on the Dodo page and in
// its data module, in metres and seconds. A number with no source says so. Its design is in
// assets/source/core/creatures/dodo/ref/DESIGN.md, and what it does in ARK is in ref/FUNCTIONS.md beside it.

const PALETTE = defaultPalette();
/** A palette colour named by its tone, so that a change to the palette takes it to the nearest colour there then is. */
const tone = (rgb: number): number => nearestColour(PALETTE, rgb >> 16, (rgb >> 8) & 255, rgb & 255);
/** The colours of a region are drawn evenly and one marked rare a third as often (chosen). */
const even = (...rgb: number[]): (readonly [number, number])[] => rgb.map((c) => [tone(c), 3] as const);
const rare = (rgb: number): readonly [number, number] => [tone(rgb), 1];

// ARK's six regions under its names, in its order. The colours are ours (DESIGN.md), each the tone the concept meant,
// and the first of each region is the default bird.
const REGIONS = [
  // slate, dark slate, ash, peat brown, dun, russet, olive drab, sooty, sand; cream
  { name: "Body", colors: [...even(0x6b737a, 0x5d6266, 0x8e8b85, 0x5a4636, 0x9c8a6e, 0x8a4e32, 0x6b6a45, 0x3c3a38, 0xb7a688), rare(0xd8cdb4)] },
  // rose buff, flesh pink, pale straw, ivory, pale olive; dusky taupe
  { name: "Face", colors: [...even(0xdda58e, 0xe3b0a3, 0xe0c07e, 0xede3cb, 0xc8c28f), rare(0xa88f8e)] },
  // olive horn, pale horn, slate, charcoal, umber, moss; oxblood
  { name: "Beak", colors: [...even(0x8f8a5e, 0xb3a47a, 0x5d6266, 0x38393a, 0x5c4330, 0x5e6b3a), rare(0x6e2e2a)] },
  // ochre, amber (the survivor colour), mustard, dull orange, olive, slate, dull pink
  { name: "Forehead, Neck and Feet", colors: even(0xc4983c, 0xaa7c30, 0xb5a03e, 0xc47a3e, 0x7d7a44, 0x666c70, 0xb98576) },
  // warm umber, sooty, chestnut, peat brown, slate, ash; white. The sooty is the palette's second nearest to 0x2c2a28,
  // chosen when this region's first colour was an umber-charcoal that took the nearest.
  { name: "Head", colors: [...even(0x433324, 0x24282a, 0x6b3b25, 0x5a4636, 0x4e555b, 0x8e8b85), rare(0xe9e6dd)] },
  // cream, pale buff, ash white, rust, pale olive, pale blue-grey, sooty
  { name: "Wings and Patterning", colors: even(0xe6dcc4, 0xd9c49a, 0xd3d3cc, 0xa8573a, 0xb9b68a, 0xa9b6c2, 0x2f2d2b) },
];

/** The default bird, region by region. Its asset draws the review sheet in these. */
export const DODO_DYES: readonly number[] = REGIONS.map((r) => r.colors[0]![0]);

/**
 * The egg in the hand, as the wiki's Dodo Egg item gives it: spoils in 8 days, decomposes on the ground in 30 minutes,
 * and eaten gives 20 food and 20 health (its 25 stamina has no field).
 */
export const DODO_EGG: ItemDef = {
  type: "item", class: "egg",
  id: "core:dodo_egg",
  label: "dodo egg",
  color: tone(0xe6e3dc),
  stack: 100,
  weight: 3,
  eat: { food: 20, health: 20 },
  spoilHours: (8 * 24 * 3600) / 140,
  decomposeHours: (30 * 60) / 140,
};

/**
 * Fertilised, it is one of a kind and keeps its young. The wiki says only that such eggs spoil "incredibly slowly" in an
 * inventory; an Ascended data site gives 192 hours, the same 8 days, which is taken. It eats as the other does (ARK warns
 * first). It does not decompose: it lies until it hatches.
 */
const { decomposeHours: _, ...kept } = DODO_EGG;
export const DODO_EGG_FERTILE: ItemDef = { ...kept, id: "core:dodo_egg_fertile", label: "fertilised dodo egg", stack: 1 };

export const DODO: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:dodo",
    tag: "dodo",
    mesh: "core:dodo",
    skeleton: "dodo",
    color: DODO_DYES[0]!,
    // The design's bird: 0.65 m to the top of the head, the eye at 0.58 m, and a capsule as wide as the body is long. ARK's
    // capsule is not published.
    radius: 0.22,
    height: 0.65,
    eyeHeight: 0.58,
    // 65 units a second walking, 136.5 running wild and 95.55 tamed, 300 swimming.
    walkSpeed: 0.65,
    sprintMul: 2.1,
    tamedSprintMul: 1.47,
    swimSpeed: 3,
    // It never jumps in ARK. Nothing makes a creature jump here and a dodo cannot be ridden, so this is never used.
    jumpSpeed: 3,
    // Chosen: ARK's turning rate is not published.
    turn: 180,
    strafe: false,
    // Running costs 4 a second and walking 0.025, a unit a tick, which is 0.03. Recovery and jumping are the engine's defaults.
    stamina: { sprint: 4, regen: 8, jump: 6, walk: 0.025 },
    // The peck: 5, once every half second, landing at tick 6 of its 15 as its clip does. Its reach is the beak's: at that
    // frame the beak's tip is 0.40 m ahead of the middle of the body and 0.31 m below the eye, 0.50 m from it. ARK's
    // attack range is 1.1 m, measured from a point the wiki does not give.
    fists: 5,
    bite: { reach: 0.5, ticks: 15, lands: 6 },
    temper: "flees",
    // Dodos near one that is hurt run with it. Chosen: ARK gives no distance.
    alarm: 15,
    // A survivor picks it up in both arms and throws it (ARK patch 241.0). A carrier weighs it as 25; its mass is 50.
    carriable: true,
    drag: 25,
    mass: 50,
    // ARK's rule for the dodo alone: an egg in place of a female's feces 13 times in 100. ARK's dodo leaves small feces.
    eggChance: 0.13,
    feces: "core:feces_small",
    // ARK has no slot limit for a creature but its weight, and holds 300 stacks at most in any inventory (patches 176.0
    // and 184.0).
    slots: 300,
    keeps: 4,
    taming: { a0: 450, a1: 22.5, foodBase: 0.000868, proneMult: 2880.184326, k: 1.333333 },
    // Of ARK's foods for it (basic kibble, crops, mejoberries, berries, and stimberries against it), only berries exist here.
    eats: [{ item: "core:berry", food: 20, affinity: 20 }],
    // 0.000868 a second, in hours of 140 seconds. Its young start at 510 times that.
    food: { max: 450, perHour: 0.12152 },
    breeds: { egg: "core:egg_dodo", incubate: 2999.76, mature: 55555.56 },
    // Harvested, it gives what wikily.gg's Dodo page (2026-11-15) has ASA's give: a stone hatchet 3 hide and 2 raw meat,
    // a stone pick 2 and 2, each in two blows. That page's harvest health of 50 is against ASA's tools; against ours, a
    // hatchet of 20 and a pick of 16, it is 32, a roll every 8 of it (both chosen to give those yields and blows). A
    // hatchet favours hide and a pick meat (ark.wiki.gg, Weapons), each picking its drop 60 rolls in 100.
    corpse: { health: 32, roll: 8 },
    drops: [{ item: "core:hide", min: 1, max: 1, favoured: "wood" }, { item: "core:meat", min: 1, max: 1, favoured: "stone" }],
    // ARK's herbivores take three eighths of fire and three fifths of explosions. Its head and the top of its neck take three times.
    takes: { fire: 0.375, explosive: 0.6 },
    zones: { head: 3 },
    // The experience the wiki's Experience page gives for a kill at level 1. Its data module's base is 0.5.
    killXp: 2,
    torporDrain: 0.3,
    regions: REGIONS,
    // Gains for a tame are the raw gain times ARK's default (index.ts). Speed is 1% a level as ARK Smart Breeding and
    // Ascended have it; the Dodo page says 3% and its data module 2.5%.
    stats: { health: [40, 0.2, 0.054], stamina: [100, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [450, 0.1, 0.1], weight: [50, 0.02, 0.04], melee: [1, 0.05, 0.017], speed: [1, 0, 0.01], torpidity: [30, 0.06, 0] },
  },
  // ARK's is an extra small egg, off-white, and no measure is given: the extra small mesh, 11 cm tall.
  { type: "prop", class: "egg", id: "core:egg_dodo", mesh: "core:egg_xs", color: tone(0xe6e3dc), radius: 0.04, height: 0.11, item: "core:dodo_egg", fertile: "core:dodo_egg_fertile" },
  DODO_EGG,
  DODO_EGG_FERTILE,
];
