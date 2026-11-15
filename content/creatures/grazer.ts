import type { Def } from "../../shared/content/defs.ts";

/** A grey box that grazes. It has no model. */
export const GRAZER: readonly Def[] = [
  {
    type: "species", class: "creature",
    id: "core:grazer",
    tag: "grazer",
    mesh: "box",
    color: 9,
    radius: 0.7,
    height: 1.6,
    eyeHeight: 1.3,
    walkSpeed: 2.5,
    sprintMul: 2.2,
    jumpSpeed: 5,
    food: { max: 400, perHour: 12 },
    keeps: 4,
    // Chosen, near what it gave before bodies were harvested: 6.5 hide and 4.5 meat in all on average.
    corpse: { health: 110, roll: 10 },
    drops: [{ item: "core:hide", min: 1, max: 1, weight: 6.5, favoured: "wood" }, { item: "core:meat", min: 1, max: 1, weight: 4.5, favoured: "stone" }],
    // Every creature takes 70% from guns ("all creatures aside from Humans", ark.wiki.gg, Longneck Rifle, 2026-11-15).
    takes: { bullet: 0.7 },
    killXp: 4,
    // Once down it stays down for minutes.
    torporDrain: 0.6,
    stats: { health: [220, 0.2, 0.054], stamina: [180, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [400, 0.1, 0.1], weight: [200, 0.02, 0.04], melee: [1, 0.05, 0.017], speed: [1, 0, 0.01], torpidity: [150, 0.06, 0] },
  },
];
