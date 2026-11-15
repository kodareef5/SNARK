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
// ARK's double-barrel "fires 10 pellets per shot in a wide angle" (Shotgun), and no page gives the angle. The pump-action's
// "initial spread" went from 10 to 7.5 in patch 265.0 (Pump-Action Shotgun), and its spread is "tighter" than the
// double-barrel's: so the double-barrel keeps the pump-action's old 10, read as the cone's whole angle, a half angle of 5
// from the hip, and aiming down its barrels closes it to the pump-action's 7.5 now (3.75). At 2 m all ten pellets land in
// 17 cm of the aim; at 20 m they are spread across 3 m. It holds two shells, so it does not bloom; each barrel kicks 6
// degrees, back in three quarters of a second, so a second barrel fired at once leaves higher (DEV141).
const SHOTGUN_AIM = { spread: { hip: 5, aim: 3.75, move: 3 }, recoil: { kick: 6, recover: 8 } };

export const WEAPONS: readonly Def[] = [
  // A bow does half the arrow's damage undrawn and all of it after 1.2 s of draw (DRAW_MIN, shared/sim/damage.ts).
  // ark.wiki.gg, Bow, infobox, 2026-11-15: weight 8; durability 50 at 1 a use, so 50 uses. Its reloadtime of 4.3 is not
  // taken: our 0.66 s stands (DEV134).
  { type: "item", class: "weapon", id: id("bow"), stack: 1, weight: 8, color: 3, weapon: { kind: "bow", ammo: ARROWS, power: 1, reload: 0.66, draw: 1.2, uses: 50, melee: BLOW, mesh: id("bow"), hold: "bow", ...BOW_AIM } },
  // A stone arrow from a crossbow does 95, a tranquilizer arrow 34.5 (ARK 35, DEV137).
  // ark.wiki.gg, Crossbow, infobox, 2026-11-15: weight 8; reloadtime 2.61 (its rateoffire 0.383 is one over it); durability
  // 100 at 1 a use, so 100 uses.
  { type: "item", class: "weapon", id: id("crossbow"), stack: 1, weight: 8, color: 4, weapon: { kind: "gun", ammo: ARROWS, power: 95 / 55, reload: 2.61, uses: 100, wet: true, melee: BLOW, mesh: id("crossbow"), hold: "rifle", ...CROSSBOW_AIM } },
  // ark.wiki.gg, Longneck Rifle, infobox, 2026-11-15: weight 15; 280 a round, magazinesize 1, reloadtime 4.5; durability 70
  // at 1 a use, so 70 uses.
  { type: "item", class: "weapon", id: id("rifle"), stack: 1, weight: 15, label: "long rifle", color: 228, weapon: { kind: "gun", ammo: [id("round_rifle"), id("dart_tranq"), id("dart_shock")], power: 1, reload: 4.5, uses: 70, fits: ATTACHMENTS, melee: BLOW, mesh: id("rifle"), hold: "rifle", ...RIFLE_AIM } },
  // ark.wiki.gg, Simple Pistol, infobox and text, 2026-11-15: weight 5; 100 a round, magazinesize 6, reloadtime 3.33,
  // rateoffire 2.1 a second (14 ticks between shots, 0.467 s); durability 60 at 0.2 a use, "a total of 300 uses".
  { type: "item", class: "weapon", id: id("pistol"), stack: 1, weight: 5, color: 2, weapon: { kind: "gun", ammo: [id("round_pistol")], power: 1, clip: 6, reload: 3.33, interval: 1 / 2.1, uses: 300, fits: ATTACHMENTS, melee: BLOW, mesh: id("pistol"), hold: "pistol", ...PISTOL_AIM } },
  // ark.wiki.gg, Shotgun, infobox and notes, 2026-11-15 (W3): the double-barrel; rangeddamage "64*10" (10 pellets of 64,
  // each its own collision check), magazinesize 2, reloadtime 3.33, rateoffire 2.85, weight 10, durability 300 at 1 a use,
  // attachments none. Its piece is W9's, in the firearms asset.
  { type: "item", class: "weapon", id: id("shotgun"), stack: 1, weight: 10, color: 4, weapon: { kind: "gun", ammo: [id("round_shotgun")], power: 1, clip: 2, reload: 3.33, interval: 1 / 2.85, uses: 300, melee: BLOW, mesh: id("shotgun"), hold: "rifle", ...SHOTGUN_AIM } },

  // The flare gun (W6; ark.wiki.gg Flare Gun, read 2026-11-15): "only good for one use, breaking after firing a single
  // flare", which lights "until it hit[s] the ground", best "fired directly above you"; weight 0.5; no harm (its melee is
  // "akin to punching with your Fists", patch 180.4, so ours strikes with bare hands); made in the inventory in 5 s at level
  // 15 for 6 points, of 4 wood, 2 fiber, 10 sparkpowder and 2 gunpowder, craftingxp 0.24. It is spent as it fires, as a
  // thrown weapon is, and its flare is its own round (D447), which carries a light and so flies as a prop (core:flare_live,
  // server/projectiles.ts) that rises, sinks slowly and goes out where it lands. Its speed, the light's reach and colour,
  // the stack of 1 and its throw's pose in place of a pistol's are ours (DEV149, DEV150). Until rendering has local lights
  // the flare is a bright mesh (D436): the blast's yellow cube, a metre across, until the art gives it its own.
  {
    type: "item", class: "weapon", id: id("flare_gun"), label: "flare gun", stack: 1, weight: 0.5, color: 3,
    weapon: { kind: "thrown", uses: 1, mesh: id("flare_gun"), hold: "pistol" },
    ammo: { damage: 0, type: "fire", speed: 40, gravity: 9.81, light: { reach: 40, color: 10 }, mesh: id("blast") },
  },
  { type: "prop", class: "projectile", id: id("flare_live"), mesh: id("blast"), color: 10, radius: 0.5, height: 1 },

  // How each is made, from the same infoboxes on 2026-11-15: requiredlevel, engrampoints, the ingredients, craftingtime where
  // the page gives one, and the Crafting XP the page shows (its craftingxp times the global 4 of patches 253.0 and 313.5, as
  // the mortar's 28.8 is). ARK makes the crossbow, pistol and long rifle at the smithy, which is not built: they are made in
  // the hand until it is (DEV136). Their pages give no craftingtime, so those seconds are ours (DEV135).
  ...making("bow", "Bow", 10, 11, 1, 10, [["wood", 15], ["fiber", 50]], 20),
  ...making("crossbow", "Crossbow", 25, 12, 1, 10, [["ingot", 7], ["wood", 10], ["fiber", 35]], 36),
  ...making("pistol", "Pistol", 34, 15, 1, 12, [["ingot", 60], ["wood", 5], ["hide", 15]], 100.8),
  ...making("rifle", "Long rifle", 35, 18, 1, 15, [["ingot", 95], ["wood", 20], ["hide", 25]], 330),
  // The shotgun (W3): level 39, 18 points, 80 ingots, 20 wood and 25 hide, craftingxp 105.8, at the smithy (Shotgun); made
  // in the hand (DEV136) and its 15 s ours, the long rifle's (DEV135).
  ...making("shotgun", "Shotgun", 39, 18, 1, 15, [["ingot", 80], ["wood", 20], ["hide", 25]], 423.2),
  // The flare gun, from its infobox above: made in the inventory, its craftingxp 0.24 times the global 4.
  ...making("flare_gun", "Flare gun", 15, 6, 1, 5, [["wood", 4], ["fiber", 2], ["sparkpowder", 10], ["gunpowder", 2]], 0.96),
];
