import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";
import { BLOW } from "./weapons.ts";

// The plasma guns (planning/workstreams/plasma.md): a rifle after ARK's Tek Rifle and a pistol after its Tek Phase Pistol,
// each firing bolts of light that fly straight, fast and not far. What is ARK's is cited; the rest is ours, and the note
// says why: a bolt does its harm to what it meets and has no blast, a cell is reloaded where ARK's rifle overheats, and
// there is no element, so cells are made of what the game has.

const id = (name: string): string => `core:${name}`;
const engram = (name: string): string => id(`engram-${name}`);
type Needs = readonly (readonly [item: string, count: number])[];
/** `making` at a station, the fabricator where not given, with the engrams it comes after. */
const made = (name: string, label: string, level: number, cost: number, count: number, seconds: number, needs: Needs, after: readonly string[], at = "fabricator"): Def[] =>
  making(name, label, level, cost, count, seconds, needs, undefined, at).map((d) => (d.type === "engram" ? { ...d, requires: after.map(engram) } : d));

/** A bolt's look: the flash where it leaves, the burst where it ends, and its size beside the rifle's. */
const bolt = (size: number) => ({ flash: id("plasma_flash"), burst: id("plasma_burst"), size });

export const PLASMA: readonly Def[] = [
  // ark.wiki.gg, Tek Rifle, infobox and text, 2026-11-23: weight 10; 150 a shot; magazinesize 50, "each unit [of Element]
  // supplying the gun with 50 shots"; rateoffire 4, held down; durability 80, "loses 1 Durability every 20 shots", so 1,600
  // shots; "a built-in scope"; projectiles with "no bullet drop" that end "once a max range is reached". Its 4 s is the
  // first of the page's two reload times. Ours: the scope's 2 to 6 times, its spread and kick, and that it takes no
  // attachment.
  {
    type: "item", class: "weapon", id: id("rifle_plasma"), label: "plasma rifle", stack: 1, weight: 10, color: 11,
    optic: { min: 2, max: 6, window: [0.96, 0.6] },
    weapon: { kind: "gun", ammo: [id("plasma_cell")], power: 1, clip: 50, reload: 4, interval: 1 / 4, auto: true, uses: 1600, melee: BLOW, mesh: id("rifle_plasma"), hold: "rifle", spread: { hip: 2, aim: 0.15, move: 3, bloom: 0.3, recover: 3 }, recoil: { kick: 0.8, recover: 6 } },
  },
  // ark.wiki.gg, Tek Phase Pistol, infobox, 2026-11-23: weight 2.5; 40 a shot; rateoffire 6.4; 55 engram points; made in
  // 10 s. ARK's is a beam with three modes and no magazine. Ours fires a bolt a press, 20 to a magazine, reloaded in 1.5 s,
  // for 1,000 shots.
  {
    type: "item", class: "weapon", id: id("pistol_plasma"), label: "plasma pistol", stack: 1, weight: 2.5, color: 11,
    weapon: { kind: "gun", ammo: [id("plasma_charge")], power: 1, clip: 20, reload: 1.5, interval: 1 / 6.4, uses: 1000, melee: BLOW, mesh: id("pistol_plasma"), hold: "pistol", spread: { hip: 1.2, aim: 0.3, move: 2, bloom: 0.6, recover: 2.5 }, recoil: { kick: 1, recover: 8 } },
  },
  // What they fire. A bolt's speed and reach are ours: fast enough to come when its harm does, and gone in 1.25 s and
  // 0.75 s, so that a fight keeps few in the air.
  { type: "item", class: "ammo", id: id("plasma_cell"), label: "plasma cell", stack: 100, weight: 0.1, color: 14, ammo: { damage: 150, type: "energy", speed: 240, gravity: 0, reach: 300, mesh: id("plasma_bolt"), bolt: bolt(1) } },
  { type: "item", class: "ammo", id: id("plasma_charge"), label: "plasma charge", stack: 100, weight: 0.05, color: 14, ammo: { damage: 40, type: "energy", speed: 200, gravity: 0, reach: 150, mesh: id("plasma_bolt"), bolt: bolt(0.6) } },

  // How each is made. ARK makes both at the Tek Replicator, of element and black pearls beside these: the tek
  // workstation (content/screens.ts), electronics and silica pearls stand for them. What they fire is made at the
  // fabricator. The rifle's 120 polymer, 450 ingots and 120 crystal and the pistol's 70,
  // 300 and 70 are their infoboxes'. ARK's rifle is a boss's Tekgram and its pistol needs level 118: the levels and the
  // rifle's points are ours, under the 105 levels a survivor has.
  ...made("rifle_plasma", "Plasma rifle", 100, 60, 1, 15, [["polymer", 120], ["ingot", 450], ["crystal", 120], ["electronics", 20], ["silica_pearls", 55]], ["rifle_assault", "piece_workstation"], "workstation"),
  ...made("pistol_plasma", "Plasma pistol", 95, 55, 1, 10, [["polymer", 70], ["ingot", 300], ["crystal", 70], ["electronics", 15], ["silica_pearls", 35]], ["pistol_fabricated", "piece_workstation"], "workstation"),
  // A making fills a magazine, as a unit of element does the Tek Rifle's. What it is made of is ours.
  ...made("plasma_cell", "Plasma cell", 100, 8, 50, 2, [["crystal", 10], ["electronics", 5], ["oil", 5]], ["rifle_plasma"]),
  ...made("plasma_charge", "Plasma charge", 95, 8, 20, 2, [["crystal", 3], ["electronics", 2], ["oil", 1]], ["pistol_plasma"]),
];
