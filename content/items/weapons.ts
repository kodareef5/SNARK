import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's ranged weapons (planning/reference/weapons-plan.md): bows and guns, with how each is made. The
// club and the slingshot are the creature team's (content/knockout.ts); the spear, pick and hatchet stay in content/core.ts;
// thrown things are in explosives.ts and what is fired or fitted in ammo.ts. Moved here from content/core.ts unchanged by
// W0; each number is as it was, and where it differs from ARK's the plan's "Each weapon against ARK" says so.

const id = (name: string): string => `core:${name}`;
const ATTACHMENTS = [id("scope"), id("silencer"), id("flashlight"), id("laser")];
const ARROWS = [id("arrow_stone"), id("arrow_tranq"), id("arrow_flame")];

export const WEAPONS: readonly Def[] = [
  // A bow does a quarter of the arrow's damage undrawn and all of it after 1.2 s of draw.
  { type: "item", class: "weapon", id: id("bow"), stack: 1, weight: 4, color: 3, weapon: { kind: "bow", ammo: ARROWS, power: 1, reload: 0.66, draw: 1.2, uses: 50, mesh: id("bow"), hold: "bow" } },
  // A stone arrow from a crossbow does 95.
  { type: "item", class: "weapon", id: id("crossbow"), stack: 1, weight: 6, color: 4, weapon: { kind: "gun", ammo: ARROWS, power: 95 / 55, reload: 2.6, uses: 100, wet: true, mesh: id("crossbow"), hold: "rifle" } },
  { type: "item", class: "weapon", id: id("rifle"), stack: 1, weight: 9, label: "long rifle", color: 228, weapon: { kind: "gun", ammo: [id("round_rifle"), id("dart_tranq"), id("dart_shock")], power: 1, reload: 4.5, uses: 70, fits: ATTACHMENTS, mesh: id("rifle"), hold: "rifle" } },
  { type: "item", class: "weapon", id: id("pistol"), stack: 1, weight: 3, color: 2, weapon: { kind: "gun", ammo: [id("round_pistol")], power: 1, clip: 6, reload: 2.2, interval: 0.35, uses: 60, fits: ATTACHMENTS, mesh: id("pistol"), hold: "pistol" } },

  // Levels are the reference game's.
  ...making("bow", "Bow", 10, 11, 1, 6, [["wood", 15], ["fiber", 50]]),
  ...making("crossbow", "Crossbow", 25, 12, 1, 10, [["ingot", 7], ["wood", 10], ["fiber", 35]]),
  ...making("pistol", "Pistol", 34, 15, 1, 12, [["ingot", 60], ["wood", 5], ["hide", 15]]),
  ...making("rifle", "Long rifle", 35, 18, 1, 15, [["ingot", 95], ["wood", 20], ["hide", 25]]),
];
