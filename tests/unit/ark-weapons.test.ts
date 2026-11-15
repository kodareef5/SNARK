// The ranged weapons', ammunition's and attachments' numbers as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, read
// from each page's wikitext and its rendered infobox. Each test names the pages it was read from. A Crafting XP is the one
// the page shows: its craftingxp times the global 4 of patches 253.0 and 313.5.

import { expect, test } from "bun:test";
import type { EngramDef, ItemDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
const item = (name: string): ItemDef => reg.defs[at(name)] as ItemDef;

/** What a thing weighs and how many go in a stack. */
const carried = (name: string): [number, number] => [Math.round(reg.weight[at(name)]! * 1000) / 1000, reg.stack[at(name)]!];

/** How it is made: its ingredients, seconds, experience, how many one crafting makes, and where. */
function made(name: string): { needs: string; seconds: number; xp: number; count: number; at: string } {
  const c = item(name).craft!;
  return { needs: c.needs.map((n) => `${n.count} ${n.item.slice(5)}`).join(", "), seconds: c.seconds, xp: c.xp, count: c.count ?? 1, at: c.at ?? "hand" };
}

/** The engram that unlocks it: its level and points. */
function engram(name: string): [number, number] {
  const e = reg.defs.find((d) => d?.type === "engram" && d.item === `core:${name}`) as EngramDef;
  return [e.level, e.cost];
}

test("the bow and crossbow weigh 8, and the crossbow reloads in 2.61 s; the bow's 0.66 s stays ours (Bow, Crossbow)", () => {
  expect([carried("bow"), carried("crossbow")]).toEqual([[8, 1], [8, 1]]);
  expect([reg.uses[at("bow")], reg.uses[at("crossbow")]]).toEqual([50, 100]);
  expect(item("crossbow").weapon!.reload).toBe(2.61);
  expect(reg.weapon[at("crossbow")]!.reloadTicks).toBe(Math.round(2.61 * TICK_RATE));
  // DEV134: the infobox's reloadtime of 4.3 is not taken.
  expect(item("bow").weapon!.reload).toBe(0.66);
  // A stone arrow from the crossbow does 95; a tranquilizer arrow 34.5 against ARK's 35 (DEV137).
  expect([Math.round(reg.power[at("crossbow")]! * 55 * 100) / 100, Math.round(reg.power[at("crossbow")]! * 20 * 100) / 100]).toEqual([95, 34.55]);
});

test("the bow takes 10 s and gives 20 experience; the crossbow 36, both from the same wood and fiber at their levels (Bow, Crossbow)", () => {
  expect([made("bow"), engram("bow")]).toEqual([{ needs: "15 wood, 50 fiber", seconds: 10, xp: 20, count: 1, at: "hand" }, [10, 11]]);
  // ARK makes it at the smithy, which is not built (DEV136); the page gives no crafting time (DEV135).
  expect([made("crossbow"), engram("crossbow")]).toEqual([{ needs: "7 ingot, 10 wood, 35 fiber", seconds: 10, xp: 36, count: 1, at: "hand" }, [25, 12]]);
});

test("the pistol weighs 5, fires 2.1 a second, reloads in 3.33 s and lasts 300 shots; the long rifle weighs 15 (Simple Pistol, Longneck Rifle)", () => {
  const pistol = reg.weapon[at("pistol")]!;
  expect([carried("pistol"), pistol.clip, pistol.reloadTicks, pistol.swingTicks, reg.uses[at("pistol")], reg.damage[at("round_pistol")]]).toEqual([[5, 1], 6, 100, 14, 300, 100]);
  const rifle = reg.weapon[at("rifle")]!;
  expect([carried("rifle"), rifle.clip, rifle.reloadTicks, reg.uses[at("rifle")], reg.damage[at("round_rifle")]]).toEqual([[15, 1], 1, 135, 70, 280]);
});

test("the pistol gives 100.8 experience and the long rifle 330, at levels 34 and 35 (Simple Pistol, Longneck Rifle)", () => {
  expect([made("pistol"), engram("pistol")]).toEqual([{ needs: "60 ingot, 5 wood, 15 hide", seconds: 12, xp: 100.8, count: 1, at: "hand" }, [34, 15]]);
  expect([made("rifle"), engram("rifle")]).toEqual([{ needs: "95 ingot, 20 wood, 25 hide", seconds: 15, xp: 330, count: 1, at: "hand" }, [35, 18]]);
});

test("a stone arrow is one a crafting in half a second for 2 points; a tranquilizer arrow takes 1 s; each weighs 0.2 (Stone Arrow, Tranq Arrow, Flame Arrow, Bow)", () => {
  expect([carried("arrow_stone"), carried("arrow_tranq"), carried("arrow_flame")]).toEqual([[0.2, 100], [0.2, 100], [0.2, 100]]);
  expect([reg.damage[at("arrow_stone")], reg.damage[at("arrow_tranq")], reg.damage[at("arrow_flame")]]).toEqual([55, 20, 55]);
  expect([made("arrow_stone"), engram("arrow_stone")]).toEqual([{ needs: "2 thatch, 2 fiber, 1 flint", seconds: 0.5, xp: 0.096, count: 1, at: "hand" }, [10, 2]]);
  expect([made("arrow_tranq"), engram("arrow_tranq")]).toEqual([{ needs: "1 arrow_stone, 1 narcotic", seconds: 1, xp: 0.1, count: 1, at: "hand" }, [21, 8]]);
});

test("a flame arrow is a stone arrow and one more thing, at level 26, in 1 s; gunpowder stands for propellant (Flame Arrow)", () => {
  // DEV138: ARK's is 1 stone arrow and 1 propellant, Scorched Earth's.
  expect([made("arrow_flame"), engram("arrow_flame")]).toEqual([{ needs: "1 arrow_stone, 1 gunpowder", seconds: 1, xp: 0.2, count: 1, at: "hand" }, [26, 15]]);
});

test("rounds weigh 0.1 and come two a crafting: the pistol's in 1 s for 1.6 experience, the rifle's for 3.2 (Simple Bullet, Simple Rifle Ammo)", () => {
  expect([carried("round_pistol"), carried("round_rifle")]).toEqual([[0.1, 100], [0.1, 100]]);
  expect([made("round_pistol"), engram("round_pistol")]).toEqual([{ needs: "1 ingot, 6 gunpowder", seconds: 1, xp: 1.6, count: 2, at: "hand" }, [34, 6]]);
  // The page gives no crafting time (DEV135).
  expect([made("round_rifle"), engram("round_rifle")]).toEqual([{ needs: "2 ingot, 12 gunpowder", seconds: 2, xp: 3.2, count: 2, at: "hand" }, [35, 6]]);
});

test("a tranquilizer dart takes a rifle round; both darts take 1 s, give 0.2 experience and cost 30 points (Tranquilizer Dart, Shocking Tranquilizer Dart)", () => {
  expect([carried("dart_tranq"), carried("dart_shock"), reg.damage[at("dart_tranq")], reg.damage[at("dart_shock")]]).toEqual([[0.2, 100], [0.2, 100], 26, 26]);
  expect([reg.ammoTorpor[at("dart_tranq")], reg.ammoTorporOver[at("dart_tranq")], reg.ammoTorpor[at("dart_shock")], reg.ammoTorporOver[at("dart_shock")]]).toEqual([6, 2.5, 12, 5]);
  expect([made("dart_tranq"), engram("dart_tranq")]).toEqual([{ needs: "3 narcotic, 2 ingot, 1 round_rifle", seconds: 1, xp: 0.2, count: 1, at: "hand" }, [62, 30]]);
  // DEV139: ARK's is 3 bio toxin, 2 ingots and a tranquilizer dart, at the fabricator.
  expect([made("dart_shock"), engram("dart_shock")]).toEqual([{ needs: "6 narcotic, 4 ingot, 4 gunpowder", seconds: 1, xp: 0.2, count: 1, at: "hand" }, [96, 30]]);
});

test("attachments weigh 0.1, at ARK's levels and experience; the flashlight's 52 and the laser's 59 are Evolved's (Scope, Silencer, Flashlight and Laser Attachment)", () => {
  expect(["scope", "silencer", "flashlight", "laser"].map(carried)).toEqual([[0.1, 1], [0.1, 1], [0.1, 1], [0.1, 1]]);
  expect(["scope", "silencer", "flashlight", "laser"].map(engram)).toEqual([[35, 13], [41, 13], [52, 18], [59, 24]]);
  // The scope's page gives 10 s; the others' give none (DEV135). What is missing stands in or waits (DEV140).
  expect(["scope", "silencer", "flashlight", "laser"].map(made)).toEqual([
    { needs: "40 ingot, 20 stone", seconds: 10, xp: 196, count: 1, at: "hand" },
    { needs: "50 ingot, 20 chitin, 10 hide", seconds: 6, xp: 196, count: 1, at: "hand" },
    { needs: "20 ingot, 10 stone", seconds: 6, xp: 304, count: 1, at: "hand" },
    { needs: "50 ingot, 40 stone", seconds: 6, xp: 544, count: 1, at: "hand" },
  ]);
});

test("a grenade weighs 0.5, stacks to 10, goes off 5 s after the pin and is learned at level 38 for 45.6 experience (Grenade)", () => {
  expect([carried("grenade"), reg.fuseTicks[at("grenade")]]).toEqual([[0.5, 10], 5 * TICK_RATE]);
  // Its 4 oil wait for oil (DEV140); its page gives no crafting time (DEV135).
  expect([made("grenade"), engram("grenade")]).toEqual([{ needs: "15 fiber, 20 stone, 30 gunpowder, 5 hide, 2 ingot", seconds: 8, xp: 45.6, count: 1, at: "hand" }, [38, 20]]);
  // Its damage is W6's: 788 within 5 m until it does ARK's 175 within 6 m with a structure factor of 4.5 (D435, DEV31).
  expect([reg.damage[at("grenade")], reg.blast[at("grenade")]]).toEqual([788, 5]);
});
