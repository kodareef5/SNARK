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

  // Cooked Meat Jerky and Prime Meat Jerky (ark.wiki.gg, both infoboxes, 2026-11-15; stations S6): made by a lit preserving
  // bin by itself (fired, D534), 2,160 s a piece, of 1 cooked meat (or cooked prime meat), 1 oil and 3 sparkpowder, both at
  // once in their own lanes; no engram and no experience (DEV171). Eaten, 20 food and 8 health, or 35 and 25; each weighs
  // 0.1, stacks to 50 or 30, keeps 2 days (spoilsin 172800) and spoils into spoiled meat, and lies 2 minutes dropped
  // (decomposesin 120). The lit bin keeps them ten times as long (20 days, D533). An ingredient that spoils while a unit is
  // under way stops its lane at the tick it spoils (D535). Wild carnivores eat them as meat in ARK; which creature eats what
  // is the creature team's. The colours are chosen.
  { type: "item", class: "consumable", id: "core:jerky", stack: 50, weight: 0.1, spoilHours: minutes(2880), decomposeHours: minutes(2), eat: { food: 20, health: 8 }, spoilsInto: "core:spoiled_meat", label: "cooked meat jerky", color: 4 },
  crafting("core:jerky", { needs: [{ item: "core:meat_cooked", count: 1 }, { item: "core:oil", count: 1 }, { item: "core:sparkpowder", count: 3 }], seconds: 2160, xp: 0, at: "core:preserving_bin", fired: true }),
  { type: "item", class: "consumable", id: "core:jerky_prime", stack: 30, weight: 0.1, spoilHours: minutes(2880), decomposeHours: minutes(2), eat: { food: 35, health: 25 }, spoilsInto: "core:spoiled_meat", label: "prime meat jerky", color: 2 },
  crafting("core:jerky_prime", { needs: [{ item: "core:meat_prime_cooked", count: 1 }, { item: "core:oil", count: 1 }, { item: "core:sparkpowder", count: 3 }], seconds: 2160, xp: 0, at: "core:preserving_bin", fired: true }),

  // What a used item mends over time, as a meal's health is core:fed. Each use's health is carried on its one instance
  // and runs after what it still had to give (server/use.ts). Chosen: ARK shows no buff for this.
  { type: "buff", id: "core:mending", label: "Mending", color: 12, good: true },
];
