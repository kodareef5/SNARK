import type { Def } from "../../shared/content/defs.ts";

/**
 * The trilobite, blocked out (planning/workstreams/supply.md, "Blocked out"): a box on the shores, and the game's first
 * source of chitin, which paste, metal pieces, the fabricator, polymer and both vehicles all come back to. It has no
 * model: a grey box 60 cm across and as tall, as the grazer is a box (a body no taller than the half metre every
 * body steps up does not ride a steep slab: tests/unit/slopes.test.ts).
 *
 * ark.wiki.gg, Trilobite and Spawn entries, 2026-11-21: 160 health, 100 stamina, 450 food, 150 weight and 50 torpidity
 * at level 1, each wild level a fifth, a tenth, a tenth, a fiftieth and 6% more as the dodo's are; no attack ("cannot
 * do damage and do not fight back"), and it flees when struck; slow on land (70 where a dodo walks 65, and three times
 * that fleeing); 4 xp for the kill; a drag weight of 30. It gives chitin (more to a hatchet), raw meat (more to a pick)
 * and, "in much smaller quantities", silica pearls (a pick) and oil (a hatchet). No page gives how much of each: the
 * weights below are chosen, a little chitin every body and pearls or oil from one in a few. ARK tames it only with a
 * fish basket, which the game has not: it is not tamed, and it lays no egg.
 *
 * ARK's Island keeps it in the sea (its page: "in shallow water in small groups and occasionally on beaches"; its
 * spawn groups are five together in the ocean's containers). Nothing lives in the water here yet, so it is on the
 * beach table, five together (content/spawns.ts).
 */
export const TRILOBITE: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:trilobite",
    tag: "trilobite",
    mesh: "box",
    color: 9,
    radius: 0.3,
    height: 0.62,
    eyeHeight: 0.4,
    walkSpeed: 0.7,
    sprintMul: 3,
    swimSpeed: 2,
    jumpSpeed: 2,
    turn: 180,
    temper: "flees",
    alarm: 12,
    carriable: true,
    drag: 30,
    mass: 30,
    food: { max: 450, perHour: 0.12152 },
    keeps: 4,
    corpse: { health: 60, roll: 8 },
    drops: [
      { item: "core:chitin", min: 1, max: 1, weight: 6, favoured: "wood" },
      { item: "core:meat", min: 1, max: 1, weight: 3, favoured: "stone" },
      { item: "core:silica_pearls", min: 1, max: 1, weight: 0.5, favoured: "stone" },
      { item: "core:oil", min: 1, max: 1, weight: 0.5, favoured: "wood" },
    ],
    takes: { bullet: 0.7 },
    killXp: 4,
    torporDrain: 0.3,
    stats: { health: [160, 0.2, 0.054], stamina: [100, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [450, 0.1, 0.1], weight: [150, 0.02, 0.04], melee: [1, 0.05, 0.017], speed: [1, 0, 0.01], torpidity: [50, 0.06, 0] },
  },
];
