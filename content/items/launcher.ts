import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";
import { BLOW, RIFLE_AIM } from "./weapons.ts";

// The rocket launcher and its rocket (planning/workstreams/rocket.md), after ARK's Rocket Launcher and Rocket Propelled
// Grenade. Every number is ark.wiki.gg's, read on 2026-11-21 from the page of the thing's name, except where a line says
// chosen. They were blocked out (content/items/blockouts.ts) until they had a model, poses and a blast of their own.

const id = (name: string): string => `core:${name}`;
const engram = (name: string): string => id(`engram-${name}`);
type Needs = readonly (readonly [item: string, count: number])[];
/** `making` at the fabricator, with the engrams it comes after. */
const made = (name: string, label: string, level: number, cost: number, count: number, seconds: number, needs: Needs, after: readonly string[]): Def[] =>
  making(name, label, level, cost, count, seconds, needs, undefined, "fabricator").map((d) => (d.type === "engram" ? { ...d, requires: after.map(engram) } : d));

export const LAUNCHER: readonly Def[] = [
  // Rocket Launcher: weight 20; a rocket every 4 s, and it "fires up to 20 rockets before breaking"; 80 polymer, 50
  // ingots and 60 paste at the fabricator in 15 s; level 87, 32 points, after the longneck. Against what is built a
  // rocket does 7,350 to wood where it does 250 to a body by its infobox. The homing missile is not made.
  { type: "item", class: "weapon", id: id("rocket_launcher"), label: "rocket launcher", stack: 1, weight: 20, color: 11, weapon: { kind: "gun", ammo: [id("rocket")], power: 1, clip: 1, reload: 4, structures: 7350 / 250, uses: 20, melee: BLOW, mesh: id("rocket_launcher"), hold: "rifle", pose: "launcher", kick: { degrees: 9, seconds: 0.3 }, muzzle: [0, 0.09, 0.5], vent: [0, 0.09, -0.52], round: [0, 0.09, 0.3], ...RIFLE_AIM } },
  ...made("rocket_launcher", "Rocket launcher", 87, 32, 1, 15, [["polymer", 80], ["ingot", 50], ["paste", 60]], ["rifle"]),
  // Rocket Propelled Grenade: weight 0.1, stacks to 100; "250 (7.5 meter radius)" as its own page has it, where the
  // launcher's page says 1,800 a rocket and the text 1,400 to a creature with no saddle: the infobox's is taken, as the
  // grenade's was. 40 gunpowder, 10 crystal, 20 paste, 10 polymer and 12 ingots at the fabricator in 1 s; level 87, 8
  // points, after the grenade. How fast it flies is chosen, and that its motor holds it nearly level for 300 m, where it bursts.
  { type: "item", class: "ammo", id: id("rocket"), label: "rocket propelled grenade", stack: 100, weight: 0.1, color: 7, ammo: { damage: 250, type: "explosive", speed: 60, gravity: 2, blast: 7.5, reach: 300, mesh: id("rocket_round"), motor: { flame: 0.9 }, burst: "rocket" } },
  ...made("rocket", "Rocket propelled grenade", 87, 8, 1, 1, [["gunpowder", 40], ["crystal", 10], ["paste", 20], ["polymer", 10], ["ingot", 12]], ["grenade"]),
];
