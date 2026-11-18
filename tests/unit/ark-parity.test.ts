// Numbers brought to ARK's by the item program's parity fixes, as the ARK wiki (ark.wiki.gg) gave them on 2026-11-15, read
// from each page's wikitext and its infobox. Each test names the pages it was read from.

import { expect, test } from "bun:test";
import { Items } from "../../server/items.ts";
import { Records } from "../../server/records.ts";
import type { ServerWorld } from "../../server/world.ts";
import type { BuffDef, ItemDef, SpeciesDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { DAMAGE_TYPES } from "../../shared/sim/damage.ts";
import { Genome, STAT_NAMES, spendPoint, statValue } from "../../shared/sim/genome.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
/** Seconds a piece keeps in a survivor's inventory. */
const keeps = (name: string): number => reg.spoilTicks[at(name)]! / TICK_RATE;

test("every creature takes 70% from guns, and a survivor all of it (Longneck Rifle)", () => {
  const bullet = DAMAGE_TYPES.indexOf("bullet");
  const creatures = reg.defs.filter((d) => d?.type === "species" && d.class === "creature").map((d) => d!.id.slice(5));
  expect(creatures.sort()).toEqual(["dodo", "grazer", "parasaur", "pteranodon", "raptor", "spino", "stego", "trike"]);
  for (const name of creatures) expect([name, reg.takes[at(name)]![bullet]]).toEqual([name, Math.fround(0.7)]);
  expect(reg.takes[at("survivor")]![bullet]).toBe(1);
});

test("raw and cooked prime meat spoil into spoiled meat, in 280 s and 46 minutes (Raw Prime Meat, Cooked Prime Meat, Spoilage)", () => {
  expect([keeps("meat_prime"), keeps("meat_prime_cooked")]).toEqual([280, 2760]);
  expect([reg.spoilsInto[at("meat_prime")], reg.spoilsInto[at("meat_prime_cooked")]]).toEqual([at("spoiled_meat"), at("spoiled_meat")]);
  // Every meat spoils into it (Spoilage: "All forms of Meat spoil and become Spoiled Meat").
  expect([reg.spoilsInto[at("meat")], reg.spoilsInto[at("meat_cooked")]]).toEqual([at("spoiled_meat"), at("spoiled_meat")]);
});

test("what a survivor gets of eating each food is its infobox's (Raw Meat, Cooked Meat, Raw Prime Meat, Cooked Prime Meat, Spoiled Meat, Mejoberry, Amarberry, Azulberry, Tintoberry, Narcoberry, Narcotic)", () => {
  /** Food, water and health eaten (health given over time), and health taken at once. */
  const eaten = (name: string): [number, number, number, number] => {
    const d = reg.defs[at(name)] as ItemDef;
    const now = d.use?.adds?.find((a) => a.stat === "health" && a.seconds === undefined)?.amount ?? 0;
    return [d.eat?.food ?? 0, d.eat?.water ?? 0, d.eat?.health ?? 0, now];
  };
  expect(eaten("meat")).toEqual([10, 0, 0, -5]);
  expect(eaten("meat_cooked")).toEqual([20, 0, 8, 0]);
  expect(eaten("meat_prime")).toEqual([20, 0, 0, -5]);
  expect(eaten("meat_prime_cooked")).toEqual([35, 0, 25, 0]);
  // The infobox's 2.5 and 12 (its text says 3.5 and 12.5).
  expect(eaten("spoiled_meat")).toEqual([2.5, 0, 0, -12]);
  // One berry for the four that feed alike.
  expect(eaten("berry")).toEqual([1.5, 0.2, 0, 0]);
  expect([eaten("narcoberry"), reg.doseTorpor[at("narcoberry")], reg.doseSeconds[at("narcoberry")]]).toEqual([[4, 0, 0, 0], 7.5, 3]);
  expect([eaten("narcotic"), reg.doseTorpor[at("narcotic")], reg.doseSeconds[at("narcotic")]]).toEqual([[0, 0, 8, 0], 40, 8]);
});

test("a campfire has 100 health and decays in 2 days, lit or not; the mortar in 16 days (Campfire, Mortar and Pestle)", () => {
  expect([reg.maxHp[at("campfire")], reg.decayDays[at("campfire")], reg.maxHp[at("campfire_lit")], reg.decayDays[at("campfire_lit")]]).toEqual([100, 2, 100, 2]);
  expect([reg.maxHp[at("mortar")], reg.decayDays[at("mortar")]]).toEqual([1000, 16]);
});

test("sparkpowder burns 60 s as fuel, beside thatch's 7.5 and wood's 30 (Sparkpowder, Campfire)", () => {
  expect([reg.fuelTicks[at("sparkpowder")], reg.fuelTicks[at("thatch")], reg.fuelTicks[at("wood")]].map((t) => t! / TICK_RATE)).toEqual([60, 7.5, 30]);
});

test("a survivor's Crafting Skill is 100% and a point adds 10%, so 204 points give a blueprint up to 107% more (Human, Crafting Skill)", () => {
  const survivor = reg.defs[at("survivor")] as SpeciesDef;
  const crafting = STAT_NAMES.indexOf("crafting");
  expect(survivor.stats!.crafting).toEqual([1, 0, 0.1]);
  const g = new Genome();
  expect(statValue(survivor.stats!.crafting!, g, crafting)).toBe(1);
  for (let n = 0; n < 10; n++) spendPoint(g, crafting);
  expect(statValue(survivor.stats!.crafting!, g, crafting)).toBeCloseTo(2, 9);
  // The page's "highest possible bonus at max level with all 204 points in Crafting Skill is 107%": skill / 20.
  for (let n = 10; n < 204; n++) spendPoint(g, crafting);
  expect(statValue(survivor.stats!.crafting!, g, crafting) / 20).toBeCloseTo(1.07, 9);
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
