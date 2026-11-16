import type { Def } from "../shared/content/defs.ts";

// What a body that lies where it fell gives up to a tool, and what only the young give.

/** Real minutes, as the hours of 140 seconds that spoiling is written in. */
const minutes = (n: number): number => (n * 60) / 140;

export const CORPSES: readonly Def[] = [
  // The record of a creature's body, which holds what it carried and its saddle. Its entity is of the creature's own kind,
  // so this is never drawn; it names the cache's box rather than bring one of its own.
  { type: "prop", class: "container", id: "core:corpse", mesh: "core:cache", color: 6, radius: 0.35, height: 0.5, slots: 1 },
  // ARK's Raw Prime Meat (ark.wiki.gg, 2026-11-15): stacks of one, 0.1 each, spoils in 4 minutes 40 into spoiled meat
  // (spoilsin 280, spoilsto Spoiled Meat) and lies 2 minutes.
  // Eaten, 20 food, and it takes 5 health at once as raw meat does.
  { type: "item", class: "consumable", id: "core:meat_prime", stack: 1, weight: 0.1, spoilHours: minutes(14 / 3), decomposeHours: minutes(2), eat: { food: 20 }, use: { adds: [{ stat: "health", amount: -5 }] }, color: 2, label: "raw prime meat", youngFor: "core:meat", cooks: { into: "core:meat_prime_cooked", seconds: 20 }, spoilsInto: "core:spoiled_meat" },
  // ARK's Cooked Prime Meat: stacks of 30, keeps 46 minutes and spoils into spoiled meat (spoilsin 2760, spoilsto Spoiled
  // Meat), 20 seconds on a fire, eaten for 35 food and 25 health.
  { type: "item", class: "consumable", id: "core:meat_prime_cooked", stack: 30, weight: 0.1, spoilHours: minutes(46), decomposeHours: minutes(2), eat: { food: 35, health: 25 }, color: 2, label: "cooked prime meat", spoilsInto: "core:spoiled_meat" },
];
