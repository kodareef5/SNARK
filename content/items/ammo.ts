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
  // ark.wiki.gg, Simple Shotgun Ammo, infobox, 2026-11-15 (W3): weight 0.1, stack 100; a shell is the double-barrel's 10
  // pellets of 64 (Shotgun). Its damage falls off with range ("lacks any sort of long-range capabilities", Shotgun): whole
  // to 10 m, none at 40 m. No page gives a number; ours are DEV142.
  { type: "item", class: "ammo", id: id("round_shotgun"), stack: 100, weight: 0.1, label: "shotgun shell", color: 4, ammo: { damage: 64, type: "bullet", pellets: 10, falloff: { full: 10, none: 40 } } },
  // A dart is fired bare (W7): loaded with one, the Longneck "cannot use any attachments" (Longneck Rifle), so loading it
  // puts the attachment in the bag (server/items.ts load).
  { type: "item", class: "ammo", id: id("dart_tranq"), stack: 100, weight: 0.2, label: "tranquilizer dart", color: 9, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 6, over: 2.5, seconds: 5 }, mesh: id("dart"), bare: true } },
  // The shocking dart spoils in 4 hours into a tranquilizer dart (Shocking Tranquilizer Dart, 2026-11-15: spoilsin 14400,
  // spoilsto Tranquilizer Dart), in hours of 140 seconds.
  { type: "item", class: "ammo", id: id("dart_shock"), stack: 100, weight: 0.2, spoilHours: 14400 / 140, spoilsInto: id("dart_tranq"), label: "shock dart", color: 6, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 12, over: 5, seconds: 5 }, buff: id("stunned"), mesh: id("dart"), bare: true } },

  // ark.wiki.gg, Scope Attachment, Silencer Attachment, Flashlight Attachment and Laser Attachment, infoboxes, 2026-11-15:
  // each weighs 0.1. What each does is W7's (planning/reference/weapons-plan.md, M10; ItemDef.attachment): the scope zooms
  // "about 3x"; the flashlight and laser are switched with N, and the flashlight spends its weapon's durability, a use a
  // minute (DEV145).
  { type: "item", class: "attachment", id: id("scope"), stack: 1, weight: 0.1, color: 11, attachment: "scope", optic: { min: 3 } },
  { type: "item", class: "attachment", id: id("silencer"), stack: 1, weight: 0.1, color: 11, attachment: "silencer" },
  { type: "item", class: "attachment", id: id("flashlight"), stack: 1, weight: 0.1, color: 6, attachment: "light" },
  { type: "item", class: "attachment", id: id("laser"), stack: 1, weight: 0.1, color: 8, attachment: "laser" },

  // Levels are the reference game's.
  // How each arrow is made, from the same infoboxes on 2026-11-15: requiredlevel, engrampoints, one arrow a crafting from the
  // ingredients, craftingtime, and the Crafting XP the page shows (its craftingxp times the global 4 of patches 253.0 and
  // 313.5). The flame arrow is Scorched Earth's and is made with propellant, which we do not have: gunpowder stands in for it,
  // one for one (DEV138).
  ...making("arrow_stone", "Stone arrow", 10, 2, 1, 0.5, [["thatch", 2], ["fiber", 2], ["flint", 1]], 0.096),
  ...making("arrow_tranq", "Tranquilizer arrow", 21, 8, 1, 1, [["arrow_stone", 1], ["narcotic", 1]], 0.1),
  ...making("arrow_flame", "Flame arrow", 26, 15, 1, 1, [["arrow_stone", 1], ["gunpowder", 1]], 0.2),

  // Rounds and darts, from their infoboxes on 2026-11-15: requiredlevel, engrampoints, ingredients, craftingNr (two rounds a
  // crafting), craftingtime where given and the Crafting XP shown. The rounds and the tranquilizer dart are made at the
  // smithy and the shocking dart at the fabricator, as ARK makes them (each infobox's craftedin; moved from the hand by
  // stations S6). The rifle round's page gives no craftingtime (DEV135). The shocking dart's 3 bio toxin, 2 ingots and a
  // tranquilizer dart wait for bio toxin, which comes from a creature: its recipe is still ours (DEV139).
  ...making("round_pistol", "Pistol round", 34, 6, 2, 1, [["ingot", 1], ["gunpowder", 6]], 1.6, "smithy"),
  ...making("round_rifle", "Rifle round", 35, 6, 2, 2, [["ingot", 2], ["gunpowder", 12]], 3.2, "smithy"),
  // The shotgun shell (W3): level 39, 6 points, 3 simple bullets (our pistol round), an ingot and 3 gunpowder, craftingxp 0.3
  // (Simple Shotgun Ammo), at the smithy. The page's "(x - what you have) * 3 / 2" bullets to make x shells is two shells a
  // crafting. It gives no craftingtime: ours is the rifle round's (DEV135).
  ...making("round_shotgun", "Shotgun shell", 39, 6, 2, 2, [["round_pistol", 3], ["ingot", 1], ["gunpowder", 3]], 1.2, "smithy"),
  ...making("dart_tranq", "Tranquilizer dart", 62, 30, 1, 1, [["narcotic", 3], ["ingot", 2], ["round_rifle", 1]], 0.2, "smithy"),
  ...making("dart_shock", "Shock dart", 96, 30, 1, 1, [["narcotic", 6], ["ingot", 4], ["gunpowder", 4]], 0.2, "fabricator"),

  // Attachments, from their infoboxes on 2026-11-15: requiredlevel, engrampoints, ingredients, craftingtime where given (the
  // scope's 10 s; the others' pages give none, DEV135) and the Crafting XP shown. The flashlight's and laser's level 52 and 59
  // are Evolved's: the pages' revisions of 2018, five years before Ascended, give the same. The scope and silencer are made
  // at the smithy and the flashlight and laser at the fabricator, as ARK makes them (stations S6), of ARK's ingredients now
  // that crystal, oil and electronics exist (DEV140 removed): the scope 40 ingots, 20 crystal and 5 stone; the silencer 50
  // ingots, 5 oil, 20 chitin (or keratin or shell fragments, not ours) and 10 hide; the flashlight 40 ingots, 40 crystal and
  // 10 electronics; the laser 50 ingots, 60 crystal and 40 electronics.
  ...making("scope", "Scope attachment", 35, 13, 1, 10, [["ingot", 40], ["crystal", 20], ["stone", 5]], 196, "smithy"),
  ...making("silencer", "Silencer attachment", 41, 13, 1, 6, [["ingot", 50], ["oil", 5], ["chitin", 20], ["hide", 10]], 196, "smithy"),
  ...making("flashlight", "Flashlight attachment", 52, 18, 1, 6, [["ingot", 40], ["crystal", 40], ["electronics", 10]], 304, "fabricator"),
  ...making("laser", "Laser attachment", 59, 24, 1, 6, [["ingot", 50], ["crystal", 60], ["electronics", 40]], 544, "fabricator"),
];
