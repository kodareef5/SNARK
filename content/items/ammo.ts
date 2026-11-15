import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's ammunition and attachments (planning/reference/weapons-plan.md), with how each is made. The
// slingshot's stone is a resource of content/core.ts. Moved here from content/core.ts unchanged by W0; the arrows' and
// darts' damage and torpor multiples are ARK's (the plan's "Each weapon against ARK", below its table).

const id = (name: string): string => `core:${name}`;

export const AMMO: readonly Def[] = [
  // ark.wiki.gg, Stone Arrow, Tranq Arrow and Flame Arrow, infoboxes, 2026-11-15: each weighs 0.2 and stacks to 100; from a
  // bow the stone and flame arrows do 55 and the tranquilizer arrow 20 (Bow, rangeddamage1 to 3), which adds twice its
  // damage in torpor at once and 2.5 times over 5 s (Tranq Arrow, Notes).
  { type: "item", class: "ammo", id: id("arrow_stone"), stack: 100, weight: 0.2, label: "stone arrow", color: 15, ammo: { damage: 55, type: "pierce", speed: 70, gravity: 9.81, recover: 0.5, mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("arrow_tranq"), stack: 100, weight: 0.2, label: "tranquilizer arrow", color: 9, ammo: { damage: 20, type: "pierce", speed: 70, gravity: 9.81, torpor: { instant: 2, over: 2.5, seconds: 5 }, mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("arrow_flame"), stack: 100, weight: 0.2, label: "flame arrow", color: 3, ammo: { damage: 55, type: "fire", speed: 70, gravity: 9.81, buff: id("burning"), mesh: id("arrow") } },
  // ark.wiki.gg, Simple Rifle Ammo, Simple Bullet, Tranquilizer Dart and Shocking Tranquilizer Dart, infoboxes and Utility,
  // 2026-11-15: rounds weigh 0.1 and darts 0.2, each stacking to 100; the rifle's round does 280 and the pistol's 100
  // (Longneck Rifle, Simple Pistol); a dart does 26, the tranquilizer dart adding six times that in torpor at once and 2.5
  // times over 5 s, the shocking one twelve times and five times (Tranquilizer Comparison Table, Utility).
  { type: "item", class: "ammo", id: id("round_rifle"), stack: 100, weight: 0.1, label: "rifle round", color: 6, ammo: { damage: 280, type: "bullet" } },
  { type: "item", class: "ammo", id: id("round_pistol"), stack: 100, weight: 0.1, label: "pistol round", color: 6, ammo: { damage: 100, type: "bullet" } },
  { type: "item", class: "ammo", id: id("dart_tranq"), stack: 100, weight: 0.2, label: "tranquilizer dart", color: 9, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 6, over: 2.5, seconds: 5 }, mesh: id("dart") } },
  { type: "item", class: "ammo", id: id("dart_shock"), stack: 100, weight: 0.2, label: "shock dart", color: 6, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 12, over: 5, seconds: 5 }, buff: id("stunned"), mesh: id("dart") } },

  // ark.wiki.gg, Scope Attachment, Silencer Attachment, Flashlight Attachment and Laser Attachment, infoboxes, 2026-11-15:
  // each weighs 0.1.
  { type: "item", class: "attachment", id: id("scope"), stack: 1, weight: 0.1, color: 11, attachment: "scope" },
  { type: "item", class: "attachment", id: id("silencer"), stack: 1, weight: 0.1, color: 11, attachment: "silencer" },
  { type: "item", class: "attachment", id: id("flashlight"), stack: 1, weight: 0.1, color: 6, attachment: "light" },
  { type: "item", class: "attachment", id: id("laser"), stack: 1, weight: 0.1, color: 8, attachment: "laser" },

  // Levels are the reference game's.
  // How each arrow is made, from the same infoboxes on 2026-11-15: requiredlevel, engrampoints, one arrow a crafting from the
  // ingredients, craftingtime, and the Crafting XP the page shows (its craftingxp times the global 4 of patches 253.0 and
  // 313.5). The flame arrow is Scorched Earth's and is made with propellant, which we do not have: gunpowder stands in for it,
  // one for one (DEV132).
  ...making("arrow_stone", "Stone arrow", 10, 2, 1, 0.5, [["thatch", 2], ["fiber", 2], ["flint", 1]], 0.096),
  ...making("arrow_tranq", "Tranquilizer arrow", 21, 8, 1, 1, [["arrow_stone", 1], ["narcotic", 1]], 0.1),
  ...making("arrow_flame", "Flame arrow", 26, 15, 1, 1, [["arrow_stone", 1], ["gunpowder", 1]], 0.2),

  // Rounds and darts, from their infoboxes on 2026-11-15: requiredlevel, engrampoints, ingredients, craftingNr (two rounds a
  // crafting), craftingtime where given and the Crafting XP shown. ARK makes the rounds and the tranquilizer dart at the
  // smithy and the shocking dart at the fabricator, neither built: they are made in the hand until they are (DEV130). The
  // rifle round's page gives no craftingtime (DEV129). The shocking dart's 3 bio toxin, 2 ingots and a tranquilizer dart
  // wait for bio toxin, which comes from a creature: its recipe is still ours (DEV133).
  ...making("round_pistol", "Pistol round", 34, 6, 2, 1, [["ingot", 1], ["gunpowder", 6]], 1.6),
  ...making("round_rifle", "Rifle round", 35, 6, 2, 2, [["ingot", 2], ["gunpowder", 12]], 3.2),
  ...making("dart_tranq", "Tranquilizer dart", 62, 30, 1, 1, [["narcotic", 3], ["ingot", 2], ["round_rifle", 1]], 0.2),
  ...making("dart_shock", "Shock dart", 96, 30, 1, 1, [["narcotic", 6], ["ingot", 4], ["gunpowder", 4]], 0.2),

  // Attachments, from their infoboxes on 2026-11-15: requiredlevel, engrampoints, ingredients, craftingtime where given (the
  // scope's 10 s; the others' pages give none, DEV129) and the Crafting XP shown. The flashlight's and laser's level 52 and 59
  // are Evolved's: the pages' revisions of 2018, five years before Ascended, give the same. ARK makes the scope and silencer
  // at the smithy and the flashlight and laser at the fabricator, neither built (DEV130). Crystal, oil and electronics do not
  // exist yet: the scope's 20 crystal and 5 stone are 20 stone, the silencer goes without its 5 oil, and the flashlight's and
  // laser's crystal and electronics are ingots and stone as before (DEV134).
  ...making("scope", "Scope attachment", 35, 13, 1, 10, [["ingot", 40], ["stone", 20]], 196),
  ...making("silencer", "Silencer attachment", 41, 13, 1, 6, [["ingot", 50], ["chitin", 20], ["hide", 10]], 196),
  ...making("flashlight", "Flashlight attachment", 52, 18, 1, 6, [["ingot", 20], ["stone", 10]], 304),
  ...making("laser", "Laser attachment", 59, 24, 1, 6, [["ingot", 50], ["stone", 40]], 544),
];
