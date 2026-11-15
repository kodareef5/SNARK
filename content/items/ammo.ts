import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's ammunition and attachments (planning/reference/weapons-plan.md), with how each is made. The
// slingshot's stone is a resource of content/core.ts. Moved here from content/core.ts unchanged by W0; the arrows' and
// darts' damage and torpor multiples are ARK's (the plan's "Each weapon against ARK", below its table).

const id = (name: string): string => `core:${name}`;

export const AMMO: readonly Def[] = [
  { type: "item", class: "ammo", id: id("arrow_stone"), stack: 100, weight: 0.2, label: "stone arrow", color: 15, ammo: { damage: 55, type: "pierce", speed: 70, gravity: 9.81, recover: 0.5, mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("arrow_tranq"), stack: 100, weight: 0.2, label: "tranquilizer arrow", color: 9, ammo: { damage: 20, type: "pierce", speed: 70, gravity: 9.81, torpor: { instant: 2, over: 2.5, seconds: 5 }, mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("arrow_flame"), stack: 100, weight: 0.2, label: "flame arrow", color: 3, ammo: { damage: 55, type: "fire", speed: 70, gravity: 9.81, buff: id("burning"), mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("round_rifle"), stack: 100, weight: 0.1, label: "rifle round", color: 6, ammo: { damage: 280, type: "bullet" } },
  { type: "item", class: "ammo", id: id("round_pistol"), stack: 100, weight: 0.05, label: "pistol round", color: 6, ammo: { damage: 100, type: "bullet" } },
  // ARK's Simple Shotgun Ammo: a shell of 10 pellets of 64 from the double-barrel (Shotgun), weight 0.1, stack 100 (Simple
  // Shotgun Ammo). Its damage falls off with range ("lacks any sort of long-range capabilities", Shotgun): whole to 10 m,
  // none at 40 m. No page gives a number; ours are DEV132.
  { type: "item", class: "ammo", id: id("round_shotgun"), stack: 100, weight: 0.1, label: "shotgun shell", color: 4, ammo: { damage: 64, type: "bullet", pellets: 10, falloff: { full: 10, none: 40 } } },
  { type: "item", class: "ammo", id: id("dart_tranq"), stack: 100, weight: 0.2, label: "tranquilizer dart", color: 9, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 6, over: 2.5, seconds: 5 }, mesh: id("dart") } },
  { type: "item", class: "ammo", id: id("dart_shock"), stack: 100, weight: 0.2, label: "shock dart", color: 6, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 12, over: 5, seconds: 5 }, buff: id("stunned"), mesh: id("dart") } },

  { type: "item", class: "attachment", id: id("scope"), stack: 1, weight: 0.5, color: 11, attachment: "scope" },
  { type: "item", class: "attachment", id: id("silencer"), stack: 1, weight: 0.5, color: 11, attachment: "silencer" },
  { type: "item", class: "attachment", id: id("flashlight"), stack: 1, weight: 0.5, color: 6, attachment: "light" },
  { type: "item", class: "attachment", id: id("laser"), stack: 1, weight: 0.5, color: 8, attachment: "laser" },

  // Levels are the reference game's.
  ...making("arrow_stone", "Stone arrow", 10, 0, 2, 2, [["thatch", 2], ["fiber", 2], ["flint", 1]]),
  ...making("arrow_tranq", "Tranquilizer arrow", 21, 8, 1, 3, [["arrow_stone", 1], ["narcotic", 1]]),
  ...making("flashlight", "Flashlight attachment", 25, 13, 1, 6, [["ingot", 20], ["stone", 10]]),
  ...making("scope", "Scope attachment", 30, 13, 1, 6, [["ingot", 40], ["stone", 20]]),
  ...making("arrow_flame", "Flame arrow", 31, 15, 2, 3, [["arrow_stone", 2], ["thatch", 4], ["fiber", 3], ["gunpowder", 1]]),
  ...making("round_pistol", "Pistol round", 34, 6, 1, 2, [["ingot", 1], ["gunpowder", 6]]),
  ...making("round_rifle", "Rifle round", 35, 6, 1, 2, [["ingot", 2], ["gunpowder", 12]]),
  ...making("silencer", "Silencer attachment", 36, 13, 1, 6, [["ingot", 50], ["chitin", 20]]),
  // Level 39 and 6 points, 3 simple bullets (our pistol round), an ingot and 3 gunpowder (Simple Shotgun Ammo), at the smithy
  // in ARK: made in the hand here. The page's "(x - what you have) * 3 / 2" bullets to make x shells is two shells a craft.
  // No crafting time is given; ours is the other rounds'.
  ...making("round_shotgun", "Shotgun shell", 39, 6, 2, 2, [["round_pistol", 3], ["ingot", 1], ["gunpowder", 3]]),
  ...making("laser", "Laser attachment", 50, 24, 1, 6, [["ingot", 50], ["stone", 40]]),
  ...making("dart_tranq", "Tranquilizer dart", 62, 30, 1, 4, [["narcotic", 3], ["ingot", 2]]),
  ...making("dart_shock", "Shock dart", 96, 60, 1, 4, [["narcotic", 6], ["ingot", 4], ["gunpowder", 4]]),
];
