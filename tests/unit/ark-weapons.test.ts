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
  // DEV124: the infobox's reloadtime of 4.3 is not taken.
  expect(item("bow").weapon!.reload).toBe(0.66);
  // A stone arrow from the crossbow does 95; a tranquilizer arrow 34.5 against ARK's 35 (DEV127).
  expect([Math.round(reg.power[at("crossbow")]! * 55 * 100) / 100, Math.round(reg.power[at("crossbow")]! * 20 * 100) / 100]).toEqual([95, 34.55]);
});

test("the bow takes 10 s and gives 20 experience; the crossbow 36, both from the same wood and fiber at their levels (Bow, Crossbow)", () => {
  expect([made("bow"), engram("bow")]).toEqual([{ needs: "15 wood, 50 fiber", seconds: 10, xp: 20, count: 1, at: "hand" }, [10, 11]]);
  // ARK makes it at the smithy, which is not built (DEV126); the page gives no crafting time (DEV125).
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
