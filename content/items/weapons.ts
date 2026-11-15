import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's ranged weapons (planning/reference/weapons-plan.md): bows and guns, with how each is made. The
// club and the slingshot are the creature team's (content/knockout.ts); the spear, pick and hatchet stay in content/core.ts;
// thrown things are in explosives.ts and what is fired or fitted in ammo.ts. Moved here from content/core.ts unchanged by
// W0. W8 (weapons/parity) brought each number to ARK's at 1x, cited beside it; what stays ours is a deviation in
// planning/quality/deviations.md.

const id = (name: string): string => `core:${name}`;
const ATTACHMENTS = [id("scope"), id("silencer"), id("flashlight"), id("laser")];
const ARROWS = [id("arrow_stone"), id("arrow_tranq"), id("arrow_flame")];
// The blow with the melee button: "Melee attack of any Ranged Weapon", 10 damage and 14 torpor (Base Damage). The pistol's
// and Longneck's infoboxes give 10; the bow's and crossbow's leave it blank, and the Bow page has a melee attack cancel a
// shot. Its reach and its half second are a swing's (DEV125).
const BLOW = { damage: 10, torpor: 1.4 };

export const WEAPONS: readonly Def[] = [
  // A bow does half the arrow's damage undrawn and all of it after 1.2 s of draw (DRAW_MIN, shared/sim/damage.ts).
  // ark.wiki.gg, Bow, infobox, 2026-11-15: weight 8; durability 50 at 1 a use, so 50 uses. Its reloadtime of 4.3 is not
  // taken: our 0.66 s stands (DEV128).
  { type: "item", class: "weapon", id: id("bow"), stack: 1, weight: 8, color: 3, weapon: { kind: "bow", ammo: ARROWS, power: 1, reload: 0.66, draw: 1.2, uses: 50, melee: BLOW, mesh: id("bow"), hold: "bow" } },
  // A stone arrow from a crossbow does 95, a tranquilizer arrow 34.5 (ARK 35, DEV131).
  // ark.wiki.gg, Crossbow, infobox, 2026-11-15: weight 8; reloadtime 2.61 (its rateoffire 0.383 is one over it); durability
  // 100 at 1 a use, so 100 uses.
  { type: "item", class: "weapon", id: id("crossbow"), stack: 1, weight: 8, color: 4, weapon: { kind: "gun", ammo: ARROWS, power: 95 / 55, reload: 2.61, uses: 100, wet: true, melee: BLOW, mesh: id("crossbow"), hold: "rifle" } },
  // ark.wiki.gg, Longneck Rifle, infobox, 2026-11-15: weight 15; 280 a round, magazinesize 1, reloadtime 4.5; durability 70
  // at 1 a use, so 70 uses.
  { type: "item", class: "weapon", id: id("rifle"), stack: 1, weight: 15, label: "long rifle", color: 228, weapon: { kind: "gun", ammo: [id("round_rifle"), id("dart_tranq"), id("dart_shock")], power: 1, reload: 4.5, uses: 70, fits: ATTACHMENTS, melee: BLOW, mesh: id("rifle"), hold: "rifle" } },
  // ark.wiki.gg, Simple Pistol, infobox and text, 2026-11-15: weight 5; 100 a round, magazinesize 6, reloadtime 3.33,
  // rateoffire 2.1 a second (14 ticks between shots, 0.467 s); durability 60 at 0.2 a use, "a total of 300 uses".
  { type: "item", class: "weapon", id: id("pistol"), stack: 1, weight: 5, color: 2, weapon: { kind: "gun", ammo: [id("round_pistol")], power: 1, clip: 6, reload: 3.33, interval: 1 / 2.1, uses: 300, fits: ATTACHMENTS, melee: BLOW, mesh: id("pistol"), hold: "pistol" } },

  // How each is made, from the same infoboxes on 2026-11-15: requiredlevel, engrampoints, the ingredients, craftingtime where
  // the page gives one, and the Crafting XP the page shows (its craftingxp times the global 4 of patches 253.0 and 313.5, as
  // the mortar's 28.8 is). ARK makes the crossbow, pistol and long rifle at the smithy, which is not built: they are made in
  // the hand until it is (DEV130). Their pages give no craftingtime, so those seconds are ours (DEV129).
  ...making("bow", "Bow", 10, 11, 1, 10, [["wood", 15], ["fiber", 50]], 20),
  ...making("crossbow", "Crossbow", 25, 12, 1, 10, [["ingot", 7], ["wood", 10], ["fiber", 35]], 36),
  ...making("pistol", "Pistol", 34, 15, 1, 12, [["ingot", 60], ["wood", 5], ["hide", 15]], 100.8),
  ...making("rifle", "Long rifle", 35, 18, 1, 15, [["ingot", 95], ["wood", 20], ["hide", 25]], 330),
];
