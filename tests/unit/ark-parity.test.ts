// Numbers brought to ARK's by the item program's parity fixes, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, read
// from each page's wikitext and its infobox. Each test names the pages it was read from.

import { expect, test } from "bun:test";
import { Items } from "../../server/items.ts";
import { Records } from "../../server/records.ts";
import type { ServerWorld } from "../../server/world.ts";
import type { BuffDef } from "../../shared/content/defs.ts";
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

test("a flame arrow burns for 22 a second for 8 seconds, as fire (Flame Arrow)", () => {
  expect(reg.defs[at("burning")]).toMatchObject({ seconds: 8, health: -22, damage: "fire" });
  expect(reg.ammoBuff[at("arrow_flame")]).toBe(at("burning"));
});

test("a shock dart stuns a survivor for 2 seconds and no creature (Shocking Tranquilizer Dart, patch 265.0)", () => {
  expect(reg.defs[at("stunned")]).toMatchObject({ seconds: 2, root: true, only: ["core:survivor"] });
  expect((reg.defs[at("stunned")] as BuffDef).survivorSeconds).toBeUndefined();
  expect(reg.ammoBuff[at("dart_shock")]).toBe(at("stunned"));
});

test("a shock dart keeps 4 hours and then is a tranquilizer dart, one at a time, through the ledger (Shocking Tranquilizer Dart)", () => {
  expect([keeps("dart_shock"), reg.spoilsInto[at("dart_shock")], keeps("dart_tranq")]).toEqual([14400, at("dart_tranq"), 0]);
  const world = { reg, tick: 1 } as unknown as ServerWorld;
  const records = new Records(1);
  const items = new Items(world, records);
  const rec = records.create(at("survivor"));
  items.mint(rec, at("dart_shock"), 2);
  world.tick = 1 + 14400 * TICK_RATE - 1;
  expect([items.inv(rec).total(at("dart_shock")), items.inv(rec).total(at("dart_tranq"))]).toEqual([2, 0]);
  world.tick = 1 + 14400 * TICK_RATE;
  expect([items.inv(rec).total(at("dart_shock")), items.inv(rec).total(at("dart_tranq"))]).toEqual([1, 1]);
  world.tick = 1 + 2 * 14400 * TICK_RATE;
  expect([items.inv(rec).total(at("dart_shock")), items.inv(rec).total(at("dart_tranq"))]).toEqual([0, 2]);
  expect([items.minted[at("dart_tranq")], items.burned[at("dart_shock")], items.audit()]).toEqual([2, 2, []]);
});
