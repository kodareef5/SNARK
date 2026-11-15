// Numbers brought to ARK's by the item program's parity fixes, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, read
// from each page's wikitext and its infobox. Each test names the pages it was read from.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { DAMAGE_TYPES } from "../../shared/sim/damage.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
/** Seconds a piece keeps in a survivor's inventory. */
const keeps = (name: string): number => reg.spoilTicks[at(name)]! / TICK_RATE;

test("every creature takes 70% from guns, and a survivor all of it (Longneck Rifle)", () => {
  const bullet = DAMAGE_TYPES.indexOf("bullet");
  const creatures = reg.defs.filter((d) => d?.type === "species" && d.class === "creature").map((d) => d!.id.slice(5));
  expect(creatures.sort()).toEqual(["dodo", "grazer", "parasaur", "pteranodon", "raptor"]);
  for (const name of creatures) expect([name, reg.takes[at(name)]![bullet]]).toEqual([name, Math.fround(0.7)]);
  expect(reg.takes[at("survivor")]![bullet]).toBe(1);
});

test("raw and cooked prime meat spoil into spoiled meat, in 280 s and 46 minutes (Raw Prime Meat, Cooked Prime Meat, Spoilage)", () => {
  expect([keeps("meat_prime"), keeps("meat_prime_cooked")]).toEqual([280, 2760]);
  expect([reg.spoilsInto[at("meat_prime")], reg.spoilsInto[at("meat_prime_cooked")]]).toEqual([at("spoiled_meat"), at("spoiled_meat")]);
  // Every meat spoils into it (Spoilage: "All forms of Meat spoil and become Spoiled Meat").
  expect([reg.spoilsInto[at("meat")], reg.spoilsInto[at("meat_cooked")]]).toEqual([at("spoiled_meat"), at("spoiled_meat")]);
});
