import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's ranged weapons (planning/reference/weapons-plan.md): bows and guns, with how each is made. The
// club and the slingshot are the creature team's (content/knockout.ts); the spear, pick and hatchet stay in content/core.ts;
// thrown things are in explosives.ts and what is fired or fitted in ammo.ts. Moved here from content/core.ts unchanged by
// W0; each number is as it was, and where it differs from ARK's the plan's "Each weapon against ARK" says so.

const id = (name: string): string => `core:${name}`;
const ATTACHMENTS = [id("scope"), id("silencer"), id("flashlight"), id("laser")];
const ARROWS = [id("arrow_stone"), id("arrow_tranq"), id("arrow_flame")];
// The blow with the melee button: "Melee attack of any Ranged Weapon", 10 damage and 14 torpor (Base Damage). The pistol's
// and Longneck's infoboxes give 10; the bow's and crossbow's leave it blank, and the Bow page has a melee attack cancel a
// shot. Its reach and its half second are a swing's (DEV125).
const BLOW = { damage: 10, torpor: 1.4 };

// Where a shot goes (shared/sim/aim.ts): ARK publishes no spread, bloom or recoil, so each weapon's `spread` and `recoil`
// are ours (DEV128 to DEV130), chosen so that aimed and still each goes where it looks or nearly, from the hip each is good
// enough near and poor far, a sprint ruins any shot, and a gun's kick comes back before its next shot can leave. Half
// angles in degrees: 1 degree is 0.35 m of miss at 20 m.
// A bow: steady when drawn and aimed (0.2: 7 cm at 20 m), loose from the hip (1.2); a string does not kick.
const BOW_AIM = { spread: { hip: 1.2, aim: 0.2, move: 2.5 } };
// A crossbow rests on a stock: dead on aimed, a little better than a bow from the hip; a small kick, back in under half a second.
const CROSSBOW_AIM = { spread: { hip: 1, aim: 0, move: 2.5 }, recoil: { kick: 1.5, recover: 4 } };
// A long gun is held at the shoulder: dead on aimed and still, its only error then its scope's sway (Longneck Rifle), but
// wild from the hip (2.5: nearly a metre at 20 m). It fires one round, so it does not bloom. Its kick of 5 degrees is back
// in a second, inside its reload of 4.5.
const RIFLE_AIM = { spread: { hip: 2.5, aim: 0, move: 3, sway: 0.35 }, recoil: { kick: 5, recover: 5 } };
// ARK's simple pistol "trades accuracy for flexibility" (Simple Pistol): fair aimed (0.4: 14 cm at 20 m), loose from the hip,
// and it blooms: each shot opens the cone a degree, and 1.5 a second closes it, so shots as fast as it fires spread and
// shots a second apart do not. Its kick of 2 degrees is back in a third of a second, before the next shot can leave.
const PISTOL_AIM = { spread: { hip: 1.5, aim: 0.4, move: 2, bloom: 1, recover: 1.5 }, recoil: { kick: 2, recover: 6 } };

export const WEAPONS: readonly Def[] = [
  // A bow does half the arrow's damage undrawn and all of it after 1.2 s of draw (DRAW_MIN, shared/sim/damage.ts).
  { type: "item", class: "weapon", id: id("bow"), stack: 1, weight: 4, color: 3, weapon: { kind: "bow", ammo: ARROWS, power: 1, reload: 0.66, draw: 1.2, uses: 50, melee: BLOW, mesh: id("bow"), hold: "bow", ...BOW_AIM } },
  // A stone arrow from a crossbow does 95.
  { type: "item", class: "weapon", id: id("crossbow"), stack: 1, weight: 6, color: 4, weapon: { kind: "gun", ammo: ARROWS, power: 95 / 55, reload: 2.6, uses: 100, wet: true, melee: BLOW, mesh: id("crossbow"), hold: "rifle", ...CROSSBOW_AIM } },
  { type: "item", class: "weapon", id: id("rifle"), stack: 1, weight: 9, label: "long rifle", color: 228, weapon: { kind: "gun", ammo: [id("round_rifle"), id("dart_tranq"), id("dart_shock")], power: 1, reload: 4.5, uses: 70, fits: ATTACHMENTS, melee: BLOW, mesh: id("rifle"), hold: "rifle", ...RIFLE_AIM } },
  { type: "item", class: "weapon", id: id("pistol"), stack: 1, weight: 3, color: 2, weapon: { kind: "gun", ammo: [id("round_pistol")], power: 1, clip: 6, reload: 2.2, interval: 0.35, uses: 60, fits: ATTACHMENTS, melee: BLOW, mesh: id("pistol"), hold: "pistol", ...PISTOL_AIM } },

  // Levels are the reference game's.
  ...making("bow", "Bow", 10, 11, 1, 6, [["wood", 15], ["fiber", 50]]),
  ...making("crossbow", "Crossbow", 25, 12, 1, 10, [["ingot", 7], ["wood", 10], ["fiber", 35]]),
  ...making("pistol", "Pistol", 34, 15, 1, 12, [["ingot", 60], ["wood", 5], ["hide", 15]]),
  ...making("rifle", "Long rifle", 35, 18, 1, 15, [["ingot", 95], ["wood", 20], ["hide", 25]]),
];
