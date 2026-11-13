// Core content: the survivor body and the graybox pieces of the proving ground.
// Colours are palette indices; see shared/pack/palette.ts.

import type { Def } from "../shared/content/defs.ts";
import type { ContentPack } from "../shared/content/packs.ts";

export const CORE_CONTENT: readonly Def[] = [
  {
    type: "species",
    id: "core:survivor",
    mesh: "box",
    color: 8,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    walkSpeed: 4.5,
    sprintMul: 1.6,
    jumpSpeed: 7,
    food: { max: 100, perHour: 6 },
    stats: { health: [100, 0, 0.1], stamina: [100, 0, 0.1], oxygen: [100, 0, 0.2], food: [100, 0, 0.1], water: [100, 0, 0.1], weight: [100, 0, 0.1], melee: [1, 0, 0.05], speed: [1, 0, 0.015] },
  },
  {
    type: "species",
    id: "core:grazer",
    mesh: "box",
    color: 9,
    radius: 0.7,
    height: 1.6,
    eyeHeight: 1.3,
    walkSpeed: 2.5,
    sprintMul: 2.2,
    jumpSpeed: 5,
    food: { max: 400, perHour: 12 },
    stats: { health: [220, 0.2, 0.054], stamina: [180, 0.1, 0.1], oxygen: [150, 0.1, 0.1], food: [400, 0.1, 0.1], weight: [200, 0.02, 0.04], melee: [1, 0.05, 0.1], speed: [1, 0, 0.01] },
  },
  { type: "structure", id: "core:block", mesh: "box", color: 2, half: [1, 1, 1], hp: 1000 },
  { type: "structure", id: "core:crate", mesh: "box", color: 3, half: [0.5, 0.5, 0.5], hp: 200 },
  { type: "structure", id: "core:foundation", mesh: "box", color: 4, half: [1.5, 0.15, 1.5], hp: 2000 },
  { type: "structure", id: "core:wall", mesh: "box", color: 5, half: [1.5, 1.5, 0.1], hp: 1500 },
  { type: "structure", id: "core:ceiling", mesh: "box", color: 4, half: [1.5, 0.1, 1.5], hp: 1500 },
  { type: "structure", id: "core:pillar", mesh: "box", color: 6, half: [0.25, 3, 0.25], hp: 800 },
  { type: "structure", id: "core:step", mesh: "box", color: 7, half: [1, 0.15, 0.5], hp: 400 },
  { type: "structure", id: "core:slab", mesh: "box", color: 2, half: [4, 0.25, 4], hp: 4000 },
  { type: "item", id: "core:fiber", stack: 200 },
  { type: "item", id: "core:stone", stack: 100 },
];

/** The same definitions as a pack, for stacking other packs on top. */
export const CORE_PACK: ContentPack = { name: "core", defs: CORE_CONTENT as readonly Def[] as unknown as ContentPack["defs"] };
