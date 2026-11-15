import type { Def } from "../../shared/content/defs.ts";
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
  // umber-charcoal, sooty, chestnut, peat brown, slate, ash; white. The sooty is given as the palette's next nearest
  // to it (0x2c2a28), since the umber-charcoal takes the nearest.
  { name: "Head", colors: [...even(0x433324, 0x24282a, 0x6b3b25, 0x5a4636, 0x4e555b, 0x8e8b85), rare(0xe9e6dd)] },
  // cream, pale buff, ash white, rust, pale olive, pale blue-grey, sooty
  { name: "Wings and Patterning", colors: even(0xe6dcc4, 0xd9c49a, 0xd3d3cc, 0xa8573a, 0xb9b68a, 0xa9b6c2, 0x2f2d2b) },
];

/** The default bird, region by region. Its asset draws the review sheet in these. */
export const DODO_DYES: readonly number[] = REGIONS.map((r) => r.colors[0]![0]);

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
    // 65 units a second walking, 136.5 running wild, 300 swimming.
    walkSpeed: 0.65,
    sprintMul: 2.1,
    swimSpeed: 3,
    // It never jumps in ARK. Nothing makes a creature jump here and a dodo cannot be ridden, so this is never used.
    jumpSpeed: 3,
    // Chosen: ARK's turning rate is not published.
    turn: 180,
    strafe: false,
    // Running costs 4 a second. Recovery and jumping are the engine's defaults.
    stamina: { sprint: 4, regen: 8, jump: 6 },
    // The peck: 5, once every half second, landing at tick 6 of its 15 as its clip does. Its reach is the beak's: at that
    // frame the beak's tip is 0.40 m ahead of the middle of the body and 0.31 m below the eye, 0.50 m from it. ARK's
    // attack range is 1.1 m, measured from a point the wiki does not give.
    fists: 5,
    bite: { reach: 0.5, ticks: 15, lands: 6 },
    temper: "flees",
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
    // Chosen: the wiki names hide and raw meat and no amounts. It calls the meat a paltry sum and the dodo a good early
    // source of hide.
    drops: [{ item: "core:hide", min: 3, max: 6 }, { item: "core:meat", min: 1, max: 3 }],
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
  // Drawn with the egg every species has, as large as theirs. ARK's is an extra small egg, off-white.
  { type: "prop", class: "egg", id: "core:egg_dodo", mesh: "core:egg", color: tone(0xe6e3dc), radius: 0.3, height: 0.7 },
];
