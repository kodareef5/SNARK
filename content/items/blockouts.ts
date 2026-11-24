import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";
import { ARROWS, ATTACHMENTS, BLOW, BOW_AIM, PISTOL_AIM, RIFLE_AIM, SHOTGUN_AIM } from "./weapons.ts";

// Things blocked out (planning/workstreams/supply.md, "Blocked out"; the owner on 2026-11-21: "block out, name, claim
// the slot and render as squares ... the modelers can come behind and do art and polish"). Each is a real item under
// ARK's name with ARK's weight, stack, recipe, station, level and engram cost, so that loot tables, recipes and the
// economy can be built and balanced on it now. None has art of its own: its icon is its swatch, in the hand it is a
// plain box, what is worn is drawn as hide is, and what is set down is a box. Each works as far as the game already
// can make it work and is inert past that, and each line says where it stops.
//
// Every number is ark.wiki.gg's, read on 2026-11-21 from the page of the thing's name, except where a line says chosen.
// Where a page gives no making time it is 5 s, as DEV135 chooses for a station's. Where a page gives no stack, the
// thing is worn or held and stacks to 1. A use count is the page's durability over what one use costs it.
//
// What these are made of that nothing in the game gives yet is blocked out too (pelt, organic polymer, AnglerGel), and so
// is what the blocked-out weapons fire. The supply drops' starter book (content/supply/starter.ts) names most of them.

const id = (name: string): string => `core:${name}`;
/** The plain box every blocked-out thing is in the hand (tools/pack/blockout.ts). */
const BOX = id("blockout");
const engram = (name: string): string => id(`engram-${name}`);
/** ARK's minutes, as in-game hours (content/core.ts). */
const minutes = (n: number): number => (n * 60) / 140;
type Needs = readonly (readonly [item: string, count: number])[];
/** `making`, with the engrams it comes after: only those the game has are named. */
const made = (name: string, label: string, level: number, cost: number, count: number, seconds: number, needs: Needs, at: string | undefined, after: readonly string[] = []): Def[] =>
  making(name, label, level, cost, count, seconds, needs, undefined, at).map((d) => (d.type === "engram" && after.length > 0 ? { ...d, requires: after.map(engram) } : d));

// ---- What they are made of and fire.

const MATTER: Def[] = [
  // Pelt: weight 0.5, stacks to 200, does not spoil. From mammoths, direwolves, dire bears and their kind, none of which
  // the game has: nothing gives it yet.
  { type: "item", class: "resource", id: id("pelt"), stack: 200, weight: 0.5, color: 228 },
  // Organic Polymer: weight 0.25, stacks to 20, spoils in 30 minutes. From Kairuku, Hesperornis, Mantis and Karkinos:
  // nothing gives it yet. ARK lets it stand in for polymer anywhere; here only the ghillie pieces, which take no other,
  // name it.
  { type: "item", class: "resource", id: id("organic_polymer"), label: "organic polymer", stack: 20, weight: 0.25, spoilHours: minutes(30), color: 14 },
  // AnglerGel: weight 0.01, stacks to 100; a piece burns 240 s in a campfire, cooking pot, forge or fireplace. From the
  // anglerfish: nothing gives it yet.
  { type: "item", class: "resource", id: id("angler_gel"), label: "AnglerGel", stack: 100, weight: 0.01, fuel: 240, color: 41 },
  // Stimberry: weight 0.1, stacks to 100, spoils in 10 minutes; one gives 1.5 food and 5 stamina and takes 10 water and
  // 10 torpor. The bush gives it (content/core.ts), as ARK's bushes give every berry.
  {
    type: "item", class: "consumable", id: id("stimberry"), stack: 100, weight: 0.1, spoilHours: minutes(10), color: 7,
    eat: { food: 1.5 }, use: { adds: [{ stat: "water", amount: -10 }, { stat: "torpidity", amount: -10 }, { stat: "stamina", amount: 5 }] },
  },

  // Advanced Bullet, the fabricated pistol's: weight 0.1, stacks to 100; 1 metal ingot and 3 gunpowder make 3 at the
  // fabricator in 1 s; level 55, 8 points, after the simple bullet. Its page gives no damage: the pistol's 50 a shot.
  { type: "item", class: "ammo", id: id("round_advanced"), label: "advanced bullet", stack: 100, weight: 0.1, color: 6, ammo: { damage: 50, type: "bullet" } },
  ...made("round_advanced", "Advanced bullet", 55, 8, 3, 1, [["ingot", 1], ["gunpowder", 3]], "fabricator", ["round_pistol"]),
  // Advanced Rifle Bullet, the assault rifle's: 1 ingot and 9 gunpowder make 2; level 58, 8 points, after the simple
  // rifle ammo. The rifle's 47 a shot.
  { type: "item", class: "ammo", id: id("round_advanced_rifle"), label: "advanced rifle bullet", stack: 100, weight: 0.1, color: 6, ammo: { damage: 47, type: "bullet" } },
  ...made("round_advanced_rifle", "Advanced rifle bullet", 58, 8, 2, 1, [["ingot", 1], ["gunpowder", 9]], "fabricator", ["round_rifle"]),
  // Advanced Sniper Bullet: weight 0.2; 2 ingots and 12 gunpowder make 2; level 83, 16 points. The sniper rifle's 165.
  // It flies, at a sniper round's 850 m/s, and drops (D1083); ARK's page gives no speed.
  { type: "item", class: "ammo", id: id("round_advanced_sniper"), label: "advanced sniper bullet", stack: 100, weight: 0.2, color: 6, ammo: { damage: 165, type: "bullet", speed: 850, gravity: 9.81 } },
  ...made("round_advanced_sniper", "Advanced sniper bullet", 83, 16, 2, 1, [["ingot", 2], ["gunpowder", 12]], "fabricator", ["round_rifle"]),
  // Metal Arrow, the compound bow's alone: weight 0.4, damage 130 (175.5 from the compound bow, which is 1.35 times an
  // arrow); 3 thatch, 3 fiber, 3 ingots, 1 cementing paste and 1 polymer at the fabricator; level 79, 35 points, after the
  // compound bow. Its stack of 100 is in the page's source and not shown, and no page gives what one making yields: 1.
  // That it passes most of a target's armour is not built.
  { type: "item", class: "ammo", id: id("arrow_metal"), label: "metal arrow", stack: 100, weight: 0.4, color: 2, ammo: { damage: 130, type: "pierce", speed: 70, gravity: 9.81, recover: 0.5, mesh: id("arrow") } },
  ...made("arrow_metal", "Metal arrow", 79, 35, 1, 5, [["thatch", 3], ["fiber", 3], ["ingot", 3], ["paste", 1], ["polymer", 1]], "fabricator", ["bow_compound"]),
  // Rocket Propelled Grenade: weight 0.1, stacks to 100; "250 (7.5 meter radius)" as its own page has it, where the
  // launcher's page says 1,800 a rocket and the text 1,400 to a creature with no saddle: the infobox's is taken, as the
  // grenade's was. 40 gunpowder, 10 crystal, 20 paste, 10 polymer and 12 ingots at the fabricator in 1 s; level 87, 8
  // points, after the grenade. It drops as it flies; how fast it flies is chosen.
  { type: "item", class: "ammo", id: id("rocket"), label: "rocket propelled grenade", stack: 100, weight: 0.1, color: 7, ammo: { damage: 250, type: "explosive", speed: 60, gravity: 9.81, blast: 7.5 } },
  ...made("rocket", "Rocket propelled grenade", 87, 8, 1, 1, [["gunpowder", 40], ["crystal", 10], ["paste", 20], ["polymer", 10], ["ingot", 12]], "fabricator", ["grenade"]),
  // Grappling Hook, a crossbow's bolt in ARK: weight 1, stacks to 10; 3 stone arrows, 1 paste, 9 ingots, 2 thatch and 35
  // fiber at the smithy in 1 s; level 47, 40 points, after the stone arrow and the crossbow. Inert: no weapon takes it,
  // and the line it would pull a survivor up is not built.
  { type: "item", class: "ammo", id: id("grappling_hook"), label: "grappling hook", stack: 10, weight: 1, color: 2, ammo: { damage: 0, type: "pierce" } },
  ...made("grappling_hook", "Grappling hook", 47, 40, 1, 1, [["arrow_stone", 3], ["paste", 1], ["ingot", 9], ["thatch", 2], ["fiber", 35]], "smithy", ["arrow_stone", "crossbow"]),
  // C4 Charge, in ARK the ammunition of the C4 Remote Detonator: weight 0.1, stacks to 100; "6899 (2 meter radius)"; 60
  // gunpowder, 10 crystal, 5 paste, 50 fiber, 5 hide, 5 polymer and 5 electronics at the fabricator in 5 s; level 65, 12
  // points. Inert: the detonator that sets and fires it is not blocked out, so nothing takes it.
  { type: "item", class: "ammo", id: id("c4"), label: "C4 charge", stack: 100, weight: 0.1, color: 17, ammo: { damage: 6899, type: "explosive", blast: 2 } },
  ...made("c4", "C4 charge", 65, 12, 1, 5, [["gunpowder", 60], ["crystal", 10], ["paste", 5], ["fiber", 50], ["hide", 5], ["polymer", 5], ["electronics", 5]], "fabricator"),
];

// ---- Arms and tools. Each strikes or fires as its kind already does here; what is its own is said.

const ARMS: Def[] = [
  // Torch: weight 1, melee 10, durability 40; 1 flint, 1 wood and 1 stone in the hand; level 1 and no points. It strikes.
  // Its light, its warmth and the fire it sets are not built.
  { type: "item", class: "weapon", id: id("torch"), stack: 1, weight: 1, color: 3, weapon: { kind: "melee", damage: 10, type: "melee", uses: 40, mesh: BOX, hold: "tool" } },
  ...making("torch", "Torch", 1, 0, 1, 5, [["flint", 1], ["wood", 1], ["stone", 1]], 1.2),
  // Pike: weight 10, melee 50; durability 40 at 0.15 a use, 267 uses; 10 ingots, 10 wood and 20 hide at the smithy; level
  // 25, 10 points, after the spear. It is not thrown. Its reach, half a metre past the spear's, is chosen.
  { type: "item", class: "weapon", id: id("pike"), stack: 1, weight: 10, color: 2, weapon: { kind: "melee", damage: 50, type: "pierce", reach: 3.5, uses: 267, mesh: BOX, hold: "spear" } },
  ...made("pike", "Pike", 25, 10, 1, 5, [["ingot", 10], ["wood", 10], ["hide", 20]], "smithy", ["spear"]),
  // Sword: weight 5, melee 90; durability 70 at 0.3 a use, 233 uses; 50 ingots, 1 wood and 15 hide at the smithy; level
  // 30, 11 points, after the wooden club.
  { type: "item", class: "weapon", id: id("sword"), stack: 1, weight: 5, color: 2, weapon: { kind: "melee", damage: 90, type: "melee", uses: 233, mesh: BOX, hold: "tool" } },
  ...made("sword", "Sword", 30, 11, 1, 5, [["ingot", 50], ["wood", 1], ["hide", 15]], "smithy", ["club"]),
  // Metal Pick and Metal Hatchet: weight 2, melee 32 and 40; durability 40 at 0.075 a use, 533 uses; 1 ingot (the
  // hatchet 8), 1 wood and 10 hide at the smithy; level 20, 6 points, the hatchet after the stone one. ARK gives no
  // number for how much more they gather than stone ones: 5 times bare hands, where a stone tool is 3, is chosen.
  { type: "item", class: "weapon", id: id("pick_metal"), label: "metal pick", stack: 1, weight: 2, color: 2, tool: { on: "stone", power: 5, uses: 533 }, weapon: { kind: "melee", damage: 32, type: "melee", torpor: 0.5, uses: 533, mesh: BOX, hold: "tool" } },
  ...made("pick_metal", "Metal pick", 20, 6, 1, 5, [["ingot", 1], ["wood", 1], ["hide", 10]], "smithy"),
  { type: "item", class: "weapon", id: id("hatchet_metal"), label: "metal hatchet", stack: 1, weight: 2, color: 2, tool: { on: "wood", power: 5, uses: 533 }, weapon: { kind: "melee", damage: 40, type: "melee", uses: 533, mesh: BOX, hold: "tool" } },
  ...made("hatchet_metal", "Metal hatchet", 20, 6, 1, 5, [["ingot", 8], ["wood", 1], ["hide", 10]], "smithy", ["hatchet"]),
  // Metal Sickle: weight 2, melee 50, durability 40 (what a use costs is not given: the metal tools' 533 uses); 18 ingots,
  // 4 wood and 16 hide at the smithy; level 30, 12 points, after the metal hatchet and pick. It strikes. That it reaps
  // fibre from plants is not built.
  { type: "item", class: "weapon", id: id("sickle"), label: "metal sickle", stack: 1, weight: 2, color: 2, weapon: { kind: "melee", damage: 50, type: "melee", uses: 533, mesh: BOX, hold: "tool" } },
  ...made("sickle", "Metal sickle", 30, 12, 1, 5, [["ingot", 18], ["wood", 4], ["hide", 16]], "smithy", ["hatchet_metal", "pick_metal"]),
  // Electric Prod: weight 6, melee 1 and 400 torpor a strike, and it is spent by one; 120 polymer, 130 ingots, 120
  // electronics, 70 paste, 120 crystal and 15 AnglerGel at the fabricator in 5 s; level 95, 60 points. Charging it again
  // with AnglerGel is not built: it is mended as any thing is.
  { type: "item", class: "weapon", id: id("prod"), label: "electric prod", stack: 1, weight: 6, color: 11, weapon: { kind: "melee", damage: 1, type: "melee", torpor: 400, uses: 1, wet: true, mesh: BOX, hold: "tool" } },
  ...made("prod", "Electric prod", 95, 60, 1, 5, [["polymer", 120], ["ingot", 130], ["electronics", 120], ["paste", 70], ["crystal", 120], ["angler_gel", 15]], "fabricator"),

  // Compound Bow: weight 12; a stone arrow does 75 from it and a metal one 175.5, 1.35 times the arrow; durability 55 at
  // 0.1 a use, 550 uses; 95 polymer, 85 ingots and 75 paste at the fabricator; level 79, 40 points, after the bow and the
  // fabricator. It alone looses metal arrows. Its draw and its aim are the bow's.
  { type: "item", class: "weapon", id: id("bow_compound"), label: "compound bow", stack: 1, weight: 12, color: 11, weapon: { kind: "bow", ammo: [...ARROWS, id("arrow_metal")], power: 1.35, reload: 0.66, draw: 1.2, uses: 550, melee: BLOW, mesh: BOX, hold: "bow", ...BOW_AIM } },
  ...made("bow_compound", "Compound bow", 79, 40, 1, 5, [["polymer", 95], ["ingot", 85], ["paste", 75]], "fabricator", ["bow", "piece_fabricator"]),
  // Fabricated Pistol: weight 2.5; 50 a shot, 5 shots a second, 13 in the magazine, 1.45 s to reload; durability 210 at
  // 0.1 a shot, 2,100 shots; 35 polymer, 20 ingots and 30 paste at the fabricator; level 55, 18 points, after the simple
  // pistol. Its aim is the simple pistol's.
  { type: "item", class: "weapon", id: id("pistol_fabricated"), label: "fabricated pistol", stack: 1, weight: 2.5, color: 11, weapon: { kind: "gun", ammo: [id("round_advanced")], power: 1, clip: 13, reload: 1.45, interval: 1 / 5, uses: 2100, fits: ATTACHMENTS, melee: BLOW, mesh: BOX, hold: "pistol", ...PISTOL_AIM } },
  ...made("pistol_fabricated", "Fabricated pistol", 55, 18, 1, 5, [["polymer", 35], ["ingot", 20], ["paste", 30]], "fabricator", ["pistol"]),
  // Pump-Action Shotgun: weight 15; "46*14", 46 a pellet and 14 pellets of the simple shotgun's shell, which does 64 a
  // pellet from the double barrel; 0.91 shots a second, 6 in the magazine, 4.3 s to reload; durability 300 (what a shot
  // costs is not given: 300 shots); 30 ingots, 55 polymer and 45 paste at the fabricator in 15 s; level 55, 18 points,
  // after the shotgun. Its changelog says 12 pellets where its infobox says 14: the infobox's. Its spread is the double
  // barrel's aimed, which is the pump-action's own 7.5 degrees (weapons.ts).
  { type: "item", class: "weapon", id: id("shotgun_pump"), label: "pump-action shotgun", stack: 1, weight: 15, color: 11, weapon: { kind: "gun", ammo: [id("round_shotgun")], power: 46 / 64, pellets: 14, clip: 6, reload: 4.3, interval: 1 / 0.91, uses: 300, fits: [id("flashlight"), id("laser")], melee: BLOW, mesh: BOX, hold: "rifle", spread: { hip: 3.75, aim: 3.75, move: 3 }, recoil: SHOTGUN_AIM.recoil } },
  ...made("shotgun_pump", "Pump-action shotgun", 55, 18, 1, 15, [["ingot", 30], ["polymer", 55], ["paste", 45]], "fabricator", ["shotgun"]),
  // Assault Rifle: weight 10; 47 a shot, 10 shots a second held down, 40 in the magazine, 2.18 s to reload; durability
  // 40 at 0.05 a shot, 800 shots; it takes no scope; 60 polymer, 35 ingots and 50 paste at the fabricator; level 58, 24
  // points, after the longneck. ARK publishes no spread: the pistol's bloom on the long rifle's hold is chosen.
  { type: "item", class: "weapon", id: id("rifle_assault"), label: "assault rifle", stack: 1, weight: 10, color: 11, weapon: { kind: "gun", ammo: [id("round_advanced_rifle")], power: 1, clip: 40, reload: 2.18, interval: 1 / 10, auto: true, uses: 800, fits: [id("silencer"), id("flashlight"), id("laser")], melee: BLOW, mesh: BOX, hold: "rifle", spread: { hip: 2.5, aim: 0.3, move: 3, bloom: 0.4, recover: 3 }, recoil: { kick: 1, recover: 8 } } },
  ...made("rifle_assault", "Assault rifle", 58, 24, 1, 5, [["polymer", 60], ["ingot", 35], ["paste", 50]], "fabricator", ["rifle"]),
  // Fabricated Sniper Rifle: weight 25; 165 a shot, 3.3 shots a second, 8 in the magazine, 4.24 s to reload; durability
  // 70 at 1 a shot, 70 shots; 115 polymer, 80 ingots and 110 paste at the fabricator in 15 s; level 83, 36 points, after
  // the longneck. Its aim is the longneck's. "A built-in scope" (Fabricated Sniper Rifle): ours zooms 4 to 40 times on the
  // wheel, its window tightening, with a reticle in milliradians and a zero dialled with Alt and the wheel (D1083, DEV205);
  // it takes the silencer, flashlight and laser, as ARK's does, and no scope.
  { type: "item", class: "weapon", id: id("rifle_sniper"), label: "fabricated sniper rifle", stack: 1, weight: 25, color: 11, optic: { min: 4, max: 40, window: [0.96, 0.5], reticle: "mil" }, weapon: { kind: "gun", ammo: [id("round_advanced_sniper")], power: 1, clip: 8, reload: 4.24, interval: 1 / 3.3, uses: 70, fits: [id("silencer"), id("flashlight"), id("laser")], melee: BLOW, mesh: BOX, hold: "rifle", ...RIFLE_AIM } },
  ...made("rifle_sniper", "Fabricated sniper rifle", 83, 36, 1, 15, [["polymer", 115], ["ingot", 80], ["paste", 110]], "fabricator", ["rifle"]),
  // Rocket Launcher: weight 20; a rocket every 4 s, and it "fires up to 20 rockets before breaking"; 80 polymer, 50
  // ingots and 60 paste at the fabricator in 15 s; level 87, 32 points, after the longneck. Against what is built a
  // rocket does 7,350 to wood where it does 250 to a body by its infobox. The homing missile is not blocked out.
  { type: "item", class: "weapon", id: id("rocket_launcher"), label: "rocket launcher", stack: 1, weight: 20, color: 11, weapon: { kind: "gun", ammo: [id("rocket")], power: 1, clip: 1, reload: 4, structures: 7350 / 250, uses: 20, melee: BLOW, mesh: BOX, hold: "rifle", ...RIFLE_AIM } },
  ...made("rocket_launcher", "Rocket launcher", 87, 32, 1, 15, [["polymer", 80], ["ingot", 50], ["paste", 60]], "fabricator", ["rifle"]),
];

// ---- Instruments: held to look through or to read. A class of their own, a stub: carried, made and dropped, and
// nothing in the hand yet (shared/content/classes.ts, item/instrument).

const INSTRUMENTS: Def[] = [
  // Spyglass: weight 0.5; 5 wood, 10 hide, 10 fiber and 2 crystal in the hand in 5 s; level 7, 2 points.
  // Raised with the secondary button, a pair of glasses (D1082, DEV212): steps of 2 to 30 times on the wheel, two merged
  // lenses, what it is on told as the floating HUD of ARK's is ("Using spyglass now shows Floating HUD of Dinos", 181.0),
  // ranged with the primary and marked for the tribe with N.
  { type: "item", class: "instrument", id: id("spyglass"), stack: 1, weight: 0.5, color: 3, optic: { min: 2, max: 30, steps: [2, 4, 8, 16, 30], window: [0.82, 0.52], shape: "twin" } },
  ...made("spyglass", "Spyglass", 7, 2, 1, 5, [["wood", 5], ["hide", 10], ["fiber", 10], ["crystal", 2]], undefined),
  // Compass: weight 0.5; 5 metal as it is mined, 5 flint and 30 fiber in the hand; level 8, 5 points.
  { type: "item", class: "instrument", id: id("compass"), stack: 1, weight: 0.5, color: 2 },
  ...made("compass", "Compass", 8, 5, 1, 5, [["ore", 5], ["flint", 5], ["fiber", 30]], undefined),
  // Magnifying Glass: 15 wood, 20 hide, 20 fiber, 30 crystal, 15 obsidian and 8 ingots in the hand in 5 s; level 25, 16
  // points. Its page gives no weight: the spyglass's 0.5.
  { type: "item", class: "instrument", id: id("magnifying_glass"), label: "magnifying glass", stack: 1, weight: 0.5, color: 3 },
  ...made("magnifying_glass", "Magnifying glass", 25, 16, 1, 5, [["wood", 15], ["hide", 20], ["fiber", 20], ["crystal", 30], ["obsidian", 15], ["ingot", 8]], undefined),
  // Radio: weight 0.5; 40 ingots, 40 crystal and 40 sparkpowder at the smithy; level 51, 8 points.
  { type: "item", class: "instrument", id: id("radio"), stack: 1, weight: 0.5, color: 11 },
  ...made("radio", "Radio", 51, 8, 1, 5, [["ingot", 40], ["crystal", 40], ["sparkpowder", 40]], "smithy"),
  // GPS: weight 0.5; 5 polymer and 20 electronics at the fabricator; level 52, 21 points, after the compass.
  { type: "item", class: "instrument", id: id("gps"), label: "GPS", stack: 1, weight: 0.5, color: 11 },
  ...made("gps", "GPS", 52, 21, 1, 5, [["polymer", 5], ["electronics", 20]], "fabricator", ["compass"]),
];

// ---- Armour. Worn as hide is drawn, in its own colours. What a set does beyond its armour is not built: fur's and
// SCUBA's warmth, ghillie's hiding, riot's hold against torpor, the tank's air and the flippers' speed.

interface Piece {
  /** The id's last word, the slot, ARK's name for the piece, its weight, its engram's points, and what it is made of. */
  name: string;
  slot: "head" | "torso" | "hands" | "legs" | "feet";
  label: string;
  weight: number;
  cost: number;
  needs: Needs;
  /** Where it is its own: SCUBA's pieces. */
  armor?: number;
  uses?: number;
  after?: readonly string[];
}
interface Suit {
  set: string;
  armor: number;
  uses: number;
  level: number;
  seconds: number;
  at?: string;
  colors: readonly [number, number, number];
  /** The set whose piece of the same slot an engram comes after. */
  after: string;
  pieces: readonly Piece[];
}
const SLOT_NAMES = { head: "hat", torso: "shirt", hands: "gloves", legs: "pants", feet: "boots" } as const;
const SUITS: readonly Suit[] = [
  // Fur: armour 40, durability 120, at the smithy; level 23; each after hide's. The infobox's weights (its prose says
  // 6, 14, 4, 18 and 6).
  {
    set: "fur", armor: 40, uses: 120, level: 23, seconds: 5, at: "smithy", colors: [228, 227, 1], after: "hide",
    pieces: [
      { name: "hat", slot: "head", label: "fur cap", weight: 4, cost: 14, needs: [["pelt", 56], ["ingot", 10], ["hide", 7], ["fiber", 3]] },
      { name: "shirt", slot: "torso", label: "fur chestpiece", weight: 12, cost: 16, needs: [["pelt", 80], ["ingot", 13], ["hide", 10], ["fiber", 4]] },
      { name: "gloves", slot: "hands", label: "fur gauntlets", weight: 2, cost: 12, needs: [["pelt", 40], ["ingot", 6], ["hide", 5], ["fiber", 2]] },
      { name: "pants", slot: "legs", label: "fur leggings", weight: 12, cost: 16, needs: [["pelt", 96], ["ingot", 16], ["hide", 12], ["fiber", 5]] },
      { name: "boots", slot: "feet", label: "fur boots", weight: 4, cost: 12, needs: [["pelt", 48], ["ingot", 8], ["hide", 6], ["fiber", 4]] },
    ],
  },
  // Ghillie: armour 32, durability 45 by the infobox (its notes say 70), in the hand, of organic polymer and no other;
  // level 33; each after hide's.
  {
    set: "ghillie", armor: 32, uses: 45, level: 33, seconds: 5, colors: [46, 17, 227], after: "hide",
    pieces: [
      { name: "hat", slot: "head", label: "ghillie mask", weight: 4, cost: 13, needs: [["organic_polymer", 5], ["hide", 7], ["fiber", 3]] },
      { name: "shirt", slot: "torso", label: "ghillie chestpiece", weight: 8, cost: 11, needs: [["organic_polymer", 6], ["hide", 10], ["fiber", 4]] },
      { name: "gloves", slot: "hands", label: "ghillie gauntlets", weight: 2, cost: 11, needs: [["organic_polymer", 3], ["hide", 5], ["fiber", 2]] },
      { name: "pants", slot: "legs", label: "ghillie leggings", weight: 8, cost: 11, needs: [["organic_polymer", 8], ["hide", 12], ["fiber", 5]] },
      { name: "boots", slot: "feet", label: "ghillie boots", weight: 2, cost: 11, needs: [["organic_polymer", 4], ["hide", 6], ["fiber", 4]] },
    ],
  },
  // Riot: armour 115, durability 120, at the fabricator in 5 s; level 98, 40 points a piece; each after ghillie's.
  {
    set: "riot", armor: 115, uses: 120, level: 98, seconds: 5, at: "fabricator", colors: [11, 2, 6], after: "ghillie",
    pieces: [
      { name: "hat", slot: "head", label: "riot helmet", weight: 6, cost: 40, needs: [["polymer", 50], ["silica_pearls", 25], ["hide", 7], ["fiber", 3], ["crystal", 35]] },
      { name: "shirt", slot: "torso", label: "riot chestpiece", weight: 14, cost: 40, needs: [["polymer", 70], ["silica_pearls", 40], ["hide", 10], ["fiber", 4]] },
      { name: "gloves", slot: "hands", label: "riot gauntlets", weight: 3, cost: 40, needs: [["polymer", 25], ["silica_pearls", 15], ["hide", 5], ["fiber", 2]] },
      { name: "pants", slot: "legs", label: "riot leggings", weight: 14, cost: 40, needs: [["polymer", 70], ["silica_pearls", 40], ["hide", 12], ["fiber", 5]] },
      { name: "boots", slot: "feet", label: "riot boots", weight: 5, cost: 40, needs: [["polymer", 30], ["silica_pearls", 18], ["hide", 6], ["fiber", 4]] },
    ],
  },
  // SCUBA: four pieces and no gloves, at the fabricator in 5 s; level 81; each after hide's and the fabricator, the mask
  // after the scope as well. The leggings alone have armour, 5, and 50 durability where the rest have 45.
  {
    set: "scuba", armor: 0, uses: 45, level: 81, seconds: 5, at: "fabricator", colors: [41, 11, 2], after: "hide",
    pieces: [
      { name: "mask", slot: "head", label: "SCUBA mask", weight: 0.5, cost: 25, needs: [["hide", 15], ["fiber", 6], ["crystal", 10], ["silica_pearls", 3]], after: ["scope", "piece_fabricator"] },
      { name: "tank", slot: "torso", label: "SCUBA tank", weight: 20, cost: 35, needs: [["hide", 20], ["fiber", 8], ["ingot", 14], ["polymer", 3]], after: ["piece_fabricator"] },
      { name: "leggings", slot: "legs", label: "SCUBA leggings", weight: 2, cost: 35, armor: 5, uses: 50, needs: [["hide", 40], ["fiber", 4], ["ingot", 2], ["polymer", 40]], after: ["piece_fabricator"] },
      { name: "flippers", slot: "feet", label: "SCUBA flippers", weight: 0.5, cost: 20, needs: [["hide", 12], ["fiber", 5], ["chitin", 12], ["paste", 6], ["silica_pearls", 4]], after: ["piece_fabricator"] },
    ],
  },
];
const ARMOUR: Def[] = SUITS.flatMap((s) =>
  s.pieces.flatMap((p): Def[] => [
    // Every set is drawn as hide's pieces are, in its colours, until it has pieces of its own.
    { type: "item", class: "armor", id: id(`${s.set}_${p.name}`), stack: 1, weight: p.weight, label: p.label, color: s.colors[0], wear: { slot: p.slot, armor: p.armor ?? s.armor, uses: p.uses ?? s.uses, set: "hide", colors: s.colors } },
    ...made(`${s.set}_${p.name}`, `${p.label[0]!.toUpperCase()}${p.label.slice(1)}`, s.level, p.cost, 1, s.seconds, p.needs, s.at, [`${s.after}_${SLOT_NAMES[p.slot]}`, ...(p.after ?? [])]),
  ]),
);

// ---- What is set down. Each is a box of a chosen size that stands, is struck and decays as ARK's does, and holds what
// ARK's holds. None does its work: nothing is made at one, none is lit or fuelled, and nothing is powered.

interface Thing {
  name: string;
  label: string;
  /** A station where ARK's makes things, a container where it only holds them. */
  kind: "station" | "container";
  half: readonly [number, number, number];
  hp: number;
  material: "wood" | "stone" | "metal";
  decayDays: number;
  slots?: number;
  weight: number;
  stack: number;
  level: number;
  cost: number;
  seconds: number;
  at?: string;
  needs: Needs;
  after?: readonly string[];
  color: number;
}
const THINGS: readonly Thing[] = [
  // Standing Torch: 500 health, 8 slots for what it burns, decays in 4 days; weight 4, stacks to 3; in the hand; level 7,
  // 6 points. Its light and its warmth are not built.
  { name: "standing_torch", label: "standing torch", kind: "container", half: [0.15, 0.9, 0.15], hp: 500, material: "wood", decayDays: 4, slots: 8, weight: 4, stack: 3, level: 7, cost: 6, seconds: 5, needs: [["thatch", 8], ["flint", 1], ["stone", 1], ["wood", 3]], color: 3 },
  // Cooking Pot: 500 health, 12 slots, decays in 16 days; weight 4, stacks to 100; in the hand in 10 s; level 8, 9
  // points, after the campfire. No recipe is cooked in it yet.
  { name: "cooking_pot", label: "cooking pot", kind: "station", half: [0.4, 0.35, 0.4], hp: 500, material: "stone", decayDays: 16, slots: 12, weight: 4, stack: 100, level: 8, cost: 9, seconds: 10, needs: [["stone", 75], ["thatch", 15], ["wood", 10], ["flint", 5]], after: ["piece_campfire"], color: 4 },
  // Stone Fireplace: 100 health, 3 slots, decays in 48 days; weight 4, stacks to 3; in the hand in 5 s; level 28, 15
  // points, after the campfire and the stone wall. Its warmth is not built.
  { name: "fireplace", label: "stone fireplace", kind: "container", half: [0.9, 1.2, 0.5], hp: 100, material: "stone", decayDays: 48, slots: 3, weight: 4, stack: 3, level: 28, cost: 15, seconds: 5, needs: [["stone", 450], ["wood", 120], ["thatch", 80], ["flint", 20]], after: ["piece_campfire", "piece_wall_stone"], color: 4 },
  // Electrical Generator: 1,000 health, 8 slots for its gasoline, decays in 16 days; weight 5, stacks to 100; at the
  // fabricator; level 49, 24 points. Nothing is powered yet, so it runs nothing.
  { name: "generator", label: "electrical generator", kind: "container", half: [0.6, 0.5, 0.4], hp: 1000, material: "metal", decayDays: 16, slots: 8, weight: 5, stack: 100, level: 49, cost: 24, seconds: 5, at: "fabricator", needs: [["ingot", 25], ["electronics", 10]], color: 11 },
  // Refrigerator: 1,000 health, 80 slots, decays in 16 days; weight 4; at the fabricator; level 60, 20 points, after the
  // large storage box. ARK's keeps food a hundred times as long while it has power: with no power to give it, this one
  // keeps nothing longer, and is a box of 80 slots.
  { name: "refrigerator", label: "refrigerator", kind: "container", half: [0.5, 1, 0.45], hp: 1000, material: "metal", decayDays: 16, slots: 80, weight: 4, stack: 1, level: 60, cost: 20, seconds: 5, at: "fabricator", needs: [["ingot", 120], ["polymer", 15], ["crystal", 25], ["electronics", 10]], after: ["piece_storage_large"], color: 1 },
  // Air Conditioner: 1,000 health, no slots, decays in 8 days; weight 4; at the fabricator; level 61, 21 points, after
  // the refrigerator. Warmth and cold are not built.
  { name: "air_conditioner", label: "air conditioner", kind: "station", half: [0.5, 0.5, 0.3], hp: 1000, material: "metal", decayDays: 8, weight: 4, stack: 1, level: 61, cost: 21, seconds: 5, at: "fabricator", needs: [["ingot", 80], ["electronics", 15], ["polymer", 5], ["crystal", 15]], after: ["piece_refrigerator"], color: 1 },
  // Industrial Grinder: 2,500 health, 120 slots, decays in 16 days; weight 4; at the fabricator in 5 s; level 64, 45
  // points, after the fabricator. It grinds nothing yet.
  { name: "grinder", label: "industrial grinder", kind: "station", half: [1.2, 1, 0.9], hp: 2500, material: "metal", decayDays: 16, slots: 120, weight: 4, stack: 1, level: 64, cost: 45, seconds: 5, at: "fabricator", needs: [["ingot", 3200], ["crystal", 2000], ["paste", 800], ["oil", 600], ["polymer", 600]], after: ["piece_fabricator"], color: 11 },
  // Industrial Forge: 27,000 health, 100 slots, decays in 18 days; weight 50; at the fabricator in 5 s; level 80, 90
  // points, after the refining forge and the fabricator. It refines nothing yet.
  { name: "forge_industrial", label: "industrial forge", kind: "station", half: [1.5, 2, 1.5], hp: 27000, material: "metal", decayDays: 18, slots: 100, weight: 50, stack: 1, level: 80, cost: 90, seconds: 5, at: "fabricator", needs: [["ingot", 2500], ["crystal", 250], ["paste", 600], ["oil", 400], ["polymer", 400]], after: ["piece_forge", "piece_fabricator"], color: 11 },
  // Chemistry Bench: 2,500 health, 100 slots, decays in 16 days; weight 4; at the fabricator in 5 s; level 82, 65 points,
  // after the fabricator and the mortar and pestle (and ARK's beer barrel, which the game has not). The mortar's recipes
  // in bulk wait for it.
  { name: "chemistry_bench", label: "chemistry bench", kind: "station", half: [1, 0.9, 0.5], hp: 2500, material: "metal", decayDays: 16, slots: 100, weight: 4, stack: 1, level: 82, cost: 65, seconds: 5, at: "fabricator", needs: [["ingot", 250], ["paste", 250], ["sparkpowder", 100], ["crystal", 250], ["polymer", 250], ["electronics", 250]], after: ["piece_fabricator", "piece_mortar"], color: 11 },
  // Industrial Cooker: 13,000 health, 80 slots, decays in 48 days; weight 4; at the fabricator in 15 s; level 89, 60
  // points, after the cooking pot. It cooks nothing yet.
  { name: "cooker_industrial", label: "industrial cooker", kind: "station", half: [1, 1.1, 0.8], hp: 13000, material: "metal", decayDays: 48, slots: 80, weight: 4, stack: 1, level: 89, cost: 60, seconds: 15, at: "fabricator", needs: [["polymer", 300], ["ingot", 1800], ["paste", 450], ["oil", 300]], after: ["piece_cooking_pot"], color: 11 },
];
const SET_DOWN: Def[] = THINGS.flatMap((t): Def[] => [
  { type: "shape", id: id(`shape_${t.name}`), role: "thing", boxes: [{ at: [0, 0, 0], half: [...t.half] }] },
  { type: "structure", class: t.kind, id: id(t.name), mesh: "shape", shape: id(`shape_${t.name}`), half: [...t.half], color: t.color, hp: t.hp, material: id(`mat_${t.material}`), decayDays: t.decayDays, ...(t.slots !== undefined ? { slots: t.slots } : {}) },
  { type: "item", class: "structure", id: id(`piece_${t.name}`), stack: t.stack, weight: t.weight, label: t.label, color: t.color, places: [id(t.name)] },
  ...made(`piece_${t.name}`, `${t.label[0]!.toUpperCase()}${t.label.slice(1)}`, t.level, t.cost, 1, t.seconds, t.needs, t.at, t.after),
]);

// ---- What is eaten and drunk. These work whole.

const PROVISIONS: Def[] = [
  // Stimulant: weight 0.1, stacks to 100; one takes 40 torpor and 15 water; 5 stimberries and 2 sparkpowder at the mortar
  // and pestle in 1 s; level 11, 6 points. Dropped, it is gone in two minutes.
  { type: "item", class: "consumable", id: id("stimulant"), stack: 100, weight: 0.1, decomposeHours: minutes(2), color: 7, use: { adds: [{ stat: "torpidity", amount: -40 }, { stat: "water", amount: -15 }] } },
  ...made("stimulant", "Stimulant", 11, 6, 1, 1, [["stimberry", 5], ["sparkpowder", 2]], "mortar"),
  // Water Jar: weight 5; it holds 200 water, two drinks; 7 paste, 5 hide and 2 crystal in the hand; level 26, 12 points,
  // after the waterskin. That it does not leak, where a waterskin does, has nothing to differ from: no vessel leaks here.
  { type: "item", class: "consumable", id: id("water_jar"), label: "water jar", stack: 1, weight: 5, color: 14, use: { holds: { water: 200, each: 100 } } },
  ...made("water_jar", "Water jar", 26, 12, 1, 5, [["paste", 7], ["hide", 5], ["crystal", 2]], undefined, ["waterskin"]),
  // Canteen: weight 2; it holds 300 water, three drinks; 10 polymer, 2 hide, 4 paste and 1 ingot at the fabricator in
  // 5 s; level 54, 24 points, after the water jar and the fabricator.
  { type: "item", class: "consumable", id: id("canteen"), stack: 1, weight: 2, color: 11, use: { holds: { water: 300, each: 100 } } },
  ...made("canteen", "Canteen", 54, 24, 1, 5, [["polymer", 10], ["hide", 2], ["paste", 4], ["ingot", 1]], "fabricator", ["water_jar", "piece_fabricator"]),
];

/** Every block-out. `BLOCKED_OUT` names the items, for the tools and tests that list what art is owed. */
export const BLOCKOUTS: readonly Def[] = [...MATTER, ...ARMS, ...INSTRUMENTS, ...ARMOUR, ...SET_DOWN, ...PROVISIONS];
export const BLOCKED_OUT: readonly string[] = BLOCKOUTS.filter((d) => d.type === "item").map((d) => d.id);
