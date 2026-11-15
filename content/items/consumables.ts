import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

// Things used for what they do to a body, beyond the foods creatures are tamed and kept on (content/foods.ts) and what
// knocks a body out (content/knockout.ts). What using one does is server/use.ts. The numbers are the wiki's (ark.wiki.gg,
// read 2026-11-15) except where a line says chosen.

/** Real minutes, as the hours of 140 seconds that spoiling is written in (content/core.ts has the same). */
const minutes = (n: number): number => (n * 60) / 140;

export const CONSUMABLES: readonly Def[] = [
  // Waterskin: holds 100 water, drunk once before it must be filled again ("only once before it must be refilled"; the
  // Water Jar's 191.0 note gives a sip as 100), filled by using it standing in shallow water, weighs 0.3, made empty
  // (its craftable class is "Waterskin (Empty)") of 4 hide and 12 fiber for 2 experience, engram at level 3 for 6 points.
  // The crafting time is chosen. It does not leak as ARK's does (deviations.md).
  { type: "item", class: "consumable", id: "core:waterskin", stack: 1, weight: 0.3, use: { holds: { water: 100, each: 100 } }, label: "water skin", color: 14 },
  crafting("core:waterskin", { needs: [{ item: "core:hide", count: 4 }, { item: "core:fiber", count: 12 }], seconds: 4, xp: 2 }),
  { type: "engram", id: "core:engram-waterskin", label: "Water skin", level: 3, cost: 6, item: "core:waterskin" },

  // Spoiled Meat: what every meat becomes when it spoils (Spoilage: "All forms of Meat spoil and become Spoiled Meat").
  // Stacks to 100, weighs 0.1, keeps an hour in a survivor's inventory (its spoil table; the infobox's 15 minutes disagrees)
  // and then is gone. Eaten it gives 2.5 food and takes 12 health, the infobox's numbers (its text says 3.5 and 12.5). The
  // harm is taken at once, which is chosen. Its colour is chosen.
  { type: "item", class: "consumable", id: "core:spoiled_meat", stack: 100, weight: 0.1, spoilHours: minutes(60), eat: { food: 2.5 }, use: { adds: [{ stat: "health", amount: -12 }] }, label: "spoiled meat", color: 4 },

  // What a used item mends over time, as a meal's health is core:fed. Each use's health is carried on its one instance
  // and runs after what it still had to give (server/use.ts). Chosen: ARK shows no buff for this.
  { type: "buff", id: "core:mending", label: "Mending", color: 12, good: true },
];
