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
    waterPerHour: 9,
    slots: 40,
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
  // What a survivor leaves where it dies: everything it carried.
  { type: "prop", id: "core:cache", mesh: "box", color: 6, radius: 0.35, height: 0.5, slots: 60 },
  { type: "item", id: "core:fiber", stack: 200, weight: 0.01, color: 7 },
  { type: "item", id: "core:stone", stack: 100, weight: 0.5, color: 15 },
  { type: "item", id: "core:berry", stack: 100, weight: 0.1, spoilHours: 4, eat: { food: 4, water: 2 }, color: 8 },
  { type: "item", id: "core:meat", stack: 20, weight: 0.1, spoilHours: 1, eat: { food: 25, health: 5 }, color: 3 },
  { type: "item", id: "core:waterskin", stack: 1, weight: 1, eat: { water: 60 }, label: "water skin", color: 14 },
  { type: "item", id: "core:wood", stack: 100, weight: 0.5, color: 3 },
  { type: "item", id: "core:thatch", stack: 200, weight: 0.02, color: 18 },
  { type: "item", id: "core:flint", stack: 100, weight: 0.05, color: 4 },
  { type: "item", id: "core:pick", stack: 1, weight: 1, color: 2, tool: { on: "stone", power: 3, uses: 60 } },
  { type: "item", id: "core:hatchet", stack: 1, weight: 1, color: 5, tool: { on: "wood", power: 3, uses: 60 } },

  // Resource nodes. By hand a tree gives thatch and a little wood, a rock a little stone;
  // the right tool gives three times as much, and flint from rocks.
  {
    type: "node",
    id: "core:tree",
    mesh: "box",
    color: 3,
    half: [0.3, 2, 0.3],
    top: { half: [1.4, 1.6, 1.4], color: 7 },
    hits: 12,
    respawnHours: 2,
    material: "wood",
    yields: [{ item: "core:thatch", min: 2, max: 4 }, { item: "core:wood", min: 0, max: 1 }, { item: "core:wood", min: 1, max: 2, tool: true }],
    xp: 1,
  },
  {
    type: "node",
    id: "core:rock",
    mesh: "box",
    color: 15,
    half: [0.9, 0.6, 0.8],
    hits: 10,
    respawnHours: 2,
    material: "stone",
    yields: [{ item: "core:stone", min: 1, max: 2 }, { item: "core:flint", min: 1, max: 2, tool: true }],
    xp: 1,
  },
  {
    type: "node",
    id: "core:bush",
    mesh: "box",
    color: 16,
    half: [0.5, 0.4, 0.5],
    soft: true,
    hits: 4,
    respawnHours: 1,
    yields: [{ item: "core:berry", min: 3, max: 6 }, { item: "core:fiber", min: 2, max: 5 }],
    xp: 0.5,
  },

  { type: "recipe", id: "core:make-pick", makes: "core:pick", count: 1, needs: [{ item: "core:stone", count: 1 }, { item: "core:wood", count: 1 }, { item: "core:thatch", count: 10 }], seconds: 2, xp: 2 },
  { type: "recipe", id: "core:make-hatchet", makes: "core:hatchet", count: 1, needs: [{ item: "core:flint", count: 1 }, { item: "core:wood", count: 1 }, { item: "core:thatch", count: 10 }], seconds: 2, xp: 2 },
  { type: "recipe", id: "core:make-waterskin", makes: "core:waterskin", count: 1, needs: [{ item: "core:fiber", count: 20 }, { item: "core:thatch", count: 5 }], seconds: 4, xp: 3 },
  { type: "engram", id: "core:engram-pick", label: "Stone pick", level: 1, cost: 0, unlocks: ["core:make-pick"] },
  { type: "engram", id: "core:engram-hatchet", label: "Stone hatchet", level: 2, cost: 3, unlocks: ["core:make-hatchet"] },
  { type: "engram", id: "core:engram-waterskin", label: "Water skin", level: 3, cost: 6, unlocks: ["core:make-waterskin"] },
  // Experience to reach each level, and engram points gained on reaching it. Level 1 is free.
  { type: "levels", id: "core:levels", xp: [0, 5, 20, 40, 70, 120, 180, 260, 360, 480, 620, 780, 960, 1160, 1380, 1620, 1880, 2160, 2460, 2780], engramPoints: [0, 8, 8, 8, 8, 8, 12, 12, 12, 12, 12, 16, 16, 16, 16, 16, 20, 20, 20, 20] },
];

/** The same definitions as a pack, for stacking other packs on top. */
export const CORE_PACK: ContentPack = { name: "core", defs: CORE_CONTENT as readonly Def[] as unknown as ContentPack["defs"] };
