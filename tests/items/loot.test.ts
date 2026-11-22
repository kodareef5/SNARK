// The loot roll, the quality tiers' numbers, and how blueprints lie in an inventory: alone, never spent, never held.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, LootDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { SLOT_BLUEPRINT } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BLUEPRINT_KG, FLAG_BLUEPRINT, Inventory, QUALITY_MUL, QUALITY_NAMES, blueprintCost, craftedQuality, moveSlot, qualityOfRating } from "../../shared/sim/items.ts";
import { POWER_MOST, lootFaults, powSixteenths, rollLoot } from "../../shared/sim/loot.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const index = (name: string): number => reg.index.get(name) ?? 0;

const CRATE: LootDef = {
  type: "loot",
  id: "t:crate",
  sets: { min: 1, max: 2 },
  from: [
    { weight: 3, min: 1, max: 2, entries: [{ items: ["core:stone", "core:flint"], weights: [3, 1], min: 5, max: 20 }, { items: ["core:fiber"], min: 10, max: 10, weight: 2 }] },
    { weight: 1, min: 1, max: 1, entries: [{ items: ["core:hatchet", "core:pick"], min: 1, max: 1, quality: [1, 12], blueprint: 0.5 }] },
  ],
};

test("a loot roll is the same for a seed, differs between seeds, and stays in its ranges", () => {
  const roll = (seed: number) => rollLoot(CRATE, new Rng(seed), index, reg.blueprints);
  expect(roll(7)).toEqual(roll(7));
  const seen = new Set<string>();
  const tiers = new Set<number>();
  let blueprints = 0;
  let tools = 0;
  for (let seed = 0; seed < 400; seed++) {
    const drops = roll(seed);
    seen.add(JSON.stringify(drops));
    // At most two sets, of at most two entries each, and never one entry twice in a roll.
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(drops.length).toBeLessThanOrEqual(3);
    for (const d of drops) {
      if (d.item === id("stone") || d.item === id("flint")) expect([d.count >= 5 && d.count <= 20, d.quality, d.blueprint]).toEqual([true, 0, false]);
      else if (d.item === id("fiber")) expect(d.count).toBe(10);
      else {
        expect([id("hatchet"), id("pick")]).toContain(d.item);
        expect(d.count).toBe(1);
        tools++;
        tiers.add(d.quality);
        if (d.blueprint) blueprints++;
      }
    }
  }
  expect(seen.size).toBeGreaterThan(150);
  // A rating drawn from 1 to 12 reaches every tier; about half the tools come as blueprints.
  expect([...tiers].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  expect(blueprints / tools).toBeGreaterThan(0.4);
  expect(blueprints / tools).toBeLessThan(0.6);
  // An item that may not be a blueprint comes as itself, however sure the chance.
  const sure: LootDef = { type: "loot", id: "t:stone", from: [{ min: 1, max: 1, entries: [{ items: ["core:stone"], min: 3, max: 3, blueprint: 1 }] }] };
  expect(rollLoot(sure, new Rng(1), index, reg.blueprints)).toEqual([{ item: id("stone"), count: 3, quality: 0, blueprint: false, rating: 0 }]);
});

test("a definition written before powers, chances and forced blueprints rolls, seed for seed, what it always rolled", () => {
  // 3987126563 is what main's roll gave for these 401 seeds before shared/sim/loot.ts learned them (taken from main at
  // 67d0b9d8 with this same hash): the id, count, tier and blueprint mark of every drop, in order.
  let h = 2166136261 >>> 0;
  for (let seed = 0; seed <= 400; seed++) {
    for (const d of rollLoot(CRATE, new Rng(seed), index, reg.blueprints)) {
      for (const v of [reg.ids[d.item], d.count, d.quality, d.blueprint ? 1 : 0]) for (const ch of `${v},`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      // The rating it now carries is the one its tier came from.
      expect(qualityOfRating(d.rating)).toBe(d.quality);
    }
  }
  expect(h).toBe(3987126563);
  // A power of 1 and a chance of 1 change nothing either, though the chance is drawn for.
  const same: LootDef = { ...CRATE, sets: { ...CRATE.sets!, power: 1 }, from: CRATE.from.map((set) => ({ ...set, power: 1 })) };
  for (let seed = 0; seed < 50; seed++) expect(rollLoot(same, new Rng(seed), index, reg.blueprints)).toEqual(rollLoot(CRATE, new Rng(seed), index, reg.blueprints));
});

test("a count's power leans it to its least or its most, by roots and products alone; replace draws one again", () => {
  // Sixteenths of a power, against the exact values where they are exact.
  expect([powSixteenths(0.25, 0.5), powSixteenths(0.5, 2), powSixteenths(0.0625, 0.25), powSixteenths(0.5, 3), powSixteenths(0.25, 1.5), powSixteenths(0.7, 1)]).toEqual([0.5, 0.25, 0.5, 0.125, 0.125, 0.7]);
  for (const p of [1 / 16, 0.3125, 0.75, 1.0625, 2.5, 7.9375, POWER_MOST]) {
    for (const u of [0.001, 0.2, 0.5, 0.83, 0.999]) expect(Math.abs(powSixteenths(u, p) - Math.pow(u, p))).toBeLessThan(1e-12);
    expect([powSixteenths(0, p), powSixteenths(1, p)]).toEqual([0, 1]);
  }
  const many = (power: number | undefined): number => {
    const def: LootDef = { type: "loot", id: "t:many", from: [{ min: 1, max: 6, ...(power === undefined ? {} : { power }), entries: [1, 2, 3, 4, 5, 6].map(() => ({ items: ["core:stone"], min: 1, max: 1 })) }] };
    let n = 0;
    for (let seed = 0; seed < 3000; seed++) n += rollLoot(def, new Rng(seed), index, reg.blueprints).length;
    return n / 3000;
  };
  // Evenly from 1 to 6 is 3.5 a roll. A power of 3 leans to the least, a power of a quarter to the most.
  const [even, low, high] = [many(undefined), many(3), many(0.25)];
  expect(Math.abs(even - 3.5)).toBeLessThan(0.1);
  expect(low).toBeLessThan(2.3);
  expect(high).toBeGreaterThan(4.9);
  // With replace, more entries are drawn than the set has, and one comes more than once.
  const twice: LootDef = { type: "loot", id: "t:twice", from: [{ min: 5, max: 5, replace: true, entries: [{ items: ["core:stone"], min: 1, max: 1 }, { items: ["core:flint"], min: 1, max: 1 }] }] };
  for (let seed = 0; seed < 20; seed++) expect(rollLoot(twice, new Rng(seed), index, reg.blueprints).length).toBe(5);
  const sets: LootDef = { type: "loot", id: "t:sets", sets: { min: 3, max: 3, replace: true }, from: [{ min: 1, max: 1, entries: [{ items: ["core:stone"], min: 2, max: 2 }] }] };
  expect(rollLoot(sets, new Rng(1), index, reg.blueprints).map((d) => d.count)).toEqual([2, 2, 2]);
});

test("an entry's chance leaves it out that often, and a forced blueprint is one wherever the item may be", () => {
  const def = (chance: number): LootDef => ({ type: "loot", id: "t:chance", from: [{ min: 2, max: 2, entries: [{ items: ["core:stone"], min: 3, max: 3, chance }, { items: ["core:hatchet"], min: 4, max: 4, forceBlueprint: true, quality: [2.5, 2.5] }] }] });
  let stones = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const drops = rollLoot(def(0.25), new Rng(seed), index, reg.blueprints);
    if (drops.some((d) => d.item === id("stone"))) stones++;
    // The hatchet is always there, always a blueprint, one of it, at the tier its rating reaches.
    expect(drops.filter((d) => d.item === id("hatchet")).map((d) => [d.count, d.blueprint, d.quality, d.rating])).toEqual([[1, true, 2, 2.5]]);
  }
  expect(Math.abs(stones / 2000 - 0.25)).toBeLessThan(0.03);
  expect(rollLoot(def(0), new Rng(3), index, reg.blueprints).length).toBe(1);
  expect(rollLoot(def(1), new Rng(3), index, reg.blueprints).length).toBe(2);
  // An item that may not be a blueprint comes as itself, in its count (a fired thing has no blueprint: Registry.blueprints).
  expect(reg.blueprints[id("ingot")]).toBe(0);
  const fired: LootDef = { type: "loot", id: "t:fired", from: [{ min: 1, max: 1, entries: [{ items: ["core:ingot"], min: 7, max: 7, forceBlueprint: true }] }] };
  expect(rollLoot(fired, new Rng(5), index, reg.blueprints).map((d) => [d.count, d.blueprint])).toEqual([[7, false]]);
  // Bad numbers are named.
  const bad: LootDef = { type: "loot", id: "t:bad", sets: { min: 1, max: 1, power: 0.3 }, from: [{ min: 1, max: 1, power: 17, entries: [{ items: ["core:stone"], min: 1, max: 1, chance: 1.5 }] }] };
  expect(lootFaults(bad)).toEqual([
    "t:bad: the sets' power is a whole number of sixteenths from 1/16 to 16",
    "t:bad: a set's power is a whole number of sixteenths from 1/16 to 16",
    "t:bad: an entry's chance is from 0 to 1",
  ]);
});

test("ARK's tiers: a rating's tier, what a blueprint costs, and what crafting skill adds to what one makes", () => {
  expect([0, 1, 1.24, 1.25, 2.5, 4.49, 4.5, 7, 9.99, 10, 50].map(qualityOfRating)).toEqual([0, 0, 0, 1, 2, 2, 3, 4, 4, 5, 5]);
  // BC + BC * IR * RS * CM * 0.3, IR the tier's threshold and RS 1: one ingredient's cost by tier, and ten's.
  expect([0, 1, 2, 3, 4, 5].map((q) => blueprintCost(1, q))).toEqual([1, 2, 3, 4, 7, 12]);
  expect([0, 1, 2, 3, 4, 5].map((q) => blueprintCost(10, q))).toEqual([10, 15, 23, 37, 63, 115]);
  // From the engram nothing is above primitive. At 100% skill the bonus reaches 5% of what the blueprint adds, which moves no tier.
  expect(craftedQuality(0, 25, 0.99)).toBe(0);
  for (let q = 1; q < QUALITY_NAMES.length; q++) expect(craftedQuality(q, 1, 0.999)).toBe(q);
  // At 255 points (2650%) the bonus reaches 132.5%: a mastercraft blueprint's 110% over base becomes up to 255.75%, an ascendant's 160%.
  expect(craftedQuality(4, 26.5, 0)).toBe(4);
  expect(craftedQuality(4, 26.5, 0.99)).toBe(5);
  expect(1 + (QUALITY_MUL[4]! - 1) * (1 + 0.99 * 1.325)).toBeGreaterThan(QUALITY_MUL[5]!);
  // A ramshackle blueprint adds 20%. At ARK's most, 204 points and a 107% bonus, that is no apprentice; at 255 points it can be.
  expect([craftedQuality(1, 21.4, 0.999), craftedQuality(1, 26.5, 0.999)]).toEqual([1, 2]);
  expect(craftedQuality(4, 26.5, 0.99, 0)).toBe(4);
});

test("a loot definition with bad numbers is refused when content compiles", () => {
  const bad: LootDef = { type: "loot", id: "t:bad", sets: { min: 2, max: 1 }, from: [{ min: 0, max: 1, entries: [{ items: ["core:stone", "core:flint"], weights: [1], min: 1, max: 2, quality: [3, 1], blueprint: 2 }] }] };
  expect(lootFaults(bad)).toEqual([
    "t:bad: sets is a whole range from 0 to 10000, its least first",
    "t:bad: an entry's weights are one for each of its items, none negative",
    "t:bad: an entry's quality is [least, most] item rating, from 0",
    "t:bad: an entry's blueprint chance is from 0 to 1",
  ]);
  expect(lootFaults(CRATE)).toEqual([]);
  const { errors } = compileContent([...CORE_CONTENT, CRATE, bad] as Def[]);
  expect(errors.filter((e) => e.startsWith("t:"))).toHaveLength(4);
  // Only a crafted item may be a blueprint, and one may be kept from being one.
  const stone = CORE_CONTENT.find((d) => d.id === "core:stone" && d.type === "item")!;
  const pick = CORE_CONTENT.find((d) => d.id === "core:pick" && d.type === "item")!;
  const made = compileContent(CORE_CONTENT.map((d) => (d === stone ? { ...d, blueprint: true } : d === pick ? { ...d, blueprint: false } : d)) as Def[]);
  expect(made.errors).toEqual(["core:stone: only an item that is crafted may be a blueprint"]);
  expect([reg.blueprints[id("pick")], reg.blueprints[id("hatchet")], reg.blueprints[id("stone")]]).toEqual([1, 1, 0]);
  expect(compileContent(CORE_CONTENT.map((d) => (d === pick ? { ...d, blueprint: false } : d)) as Def[]).registry!.blueprints[id("pick")]).toBe(0);
});

test("a blueprint lies alone at its quality, is never spent or held, weighs a tenth of a kilogram, and moves with its flags", () => {
  expect(FLAG_BLUEPRINT).toBe(SLOT_BLUEPRINT);
  const inv = new Inventory(40 + 15, 40);
  const pick = id("pick");
  const stone = id("stone");
  // Stone stacks only with stone of its own quality and flags.
  expect(inv.add(stone, 50, 0, 0, 0, reg)).toBe(0);
  expect(inv.add(stone, 50, 2, 0, 0, reg)).toBe(0);
  expect([inv.used(), inv.count[0], inv.quality[1]]).toEqual([2, 50, 2]);
  expect(inv.add(stone, 10, 0, 0, 0, reg)).toBe(0);
  expect([inv.used(), inv.count[0]]).toEqual([2, 60]);
  // Blueprints take a slot each, and are not what is counted or taken as the item.
  expect(inv.add(pick, 3, 3, 0, 0, reg, 0, FLAG_BLUEPRINT)).toBe(0);
  expect(inv.add(pick, 1, 0, 60, 0, reg)).toBe(0);
  expect([inv.used(), inv.total(pick), inv.blueprint(pick, 3), inv.blueprint(pick, 2)]).toEqual([6, 1, 2, -1]);
  expect(inv.room(pick, 3, reg, FLAG_BLUEPRINT)).toBe(40 - 6);
  expect(inv.take(pick, 2)).toBe(false);
  expect(inv.take(pick, 1)).toBe(true);
  expect([inv.used(), inv.total(pick)]).toEqual([5, 0]);
  expect(inv.weight(reg)).toBeCloseTo(110 * reg.weight[stone]! + 3 * BLUEPRINT_KG, 9);
  // Moved, a blueprint keeps its flags and quality, onto an empty slot or swapped; it never joins another.
  expect(moveSlot(inv, 2, inv, 20, 0, reg)).toBe(1);
  expect([inv.item[20], inv.flags[20], inv.quality[20], inv.item[2]]).toEqual([pick, FLAG_BLUEPRINT, 3, 0]);
  expect(moveSlot(inv, 3, inv, 20, 0, reg)).toBe(1);
  expect([inv.flags[20], inv.flags[3], inv.count[20], inv.count[3]]).toEqual([FLAG_BLUEPRINT, FLAG_BLUEPRINT, 1, 1]);
  // It lies only in the bag: not in a hotbar or worn, nor swapped there.
  expect(moveSlot(inv, 20, inv, inv.hotbar, 0, reg)).toBe(0);
  inv.set(inv.hotbar, pick, 1, 0, 60, 0);
  expect(moveSlot(inv, inv.hotbar, inv, 20, 0, reg)).toBe(0);
  expect([inv.flags[inv.hotbar], inv.flags[20]]).toEqual([0, FLAG_BLUEPRINT]);
  // A pick put down on a blueprint of a pick at its quality swaps with it: the two are never one stack.
  const other = new Inventory(4);
  other.set(0, pick, 1, 4, 0, 0, FLAG_BLUEPRINT);
  other.set(1, pick, 1, 4, 60, 0);
  expect(moveSlot(other, 1, other, 0, 0, reg)).toBe(1);
  expect([other.flags[0], other.flags[1], other.dur[0], other.dur[1]]).toEqual([0, FLAG_BLUEPRINT, 60, 0]);
});

test("a fuzz of adds and moves never joins a blueprint to anything, never puts one outside the bag, and loses nothing", () => {
  const rng = new Rng(5);
  const a = new Inventory(20 + 15, 20);
  const b = new Inventory(12);
  const kinds = [id("stone"), id("pick"), id("hatchet"), id("fiber")];
  let added = 0;
  const count = (): number => [a, b].reduce((n, inv) => n + inv.count.reduce((m, c) => m + c, 0), 0);
  for (let round = 0; round < 3000; round++) {
    const inv = rng.int(2) === 0 ? a : b;
    if (rng.int(3) === 0) {
      const item = kinds[rng.int(kinds.length)]!;
      const flags = reg.blueprints[item] !== 0 && rng.int(2) === 0 ? FLAG_BLUEPRINT : 0;
      const n = 1 + rng.int(flags ? 2 : 40);
      added += n - inv.add(item, n, rng.int(3), 0, 0, reg, 0, flags);
    } else {
      const to = rng.int(2) === 0 ? a : b;
      moveSlot(inv, rng.int(inv.cap), to, rng.int(to.cap), rng.int(3) === 0 ? 0 : rng.int(30), reg);
    }
    for (const inv of [a, b]) {
      for (let s = 0; s < inv.cap; s++) {
        if (inv.flags[s] === 0) continue;
        expect([inv.count[s], s < inv.bag, inv.spoilAt[s]]).toEqual([1, true, 0]);
      }
    }
  }
  expect(count()).toBe(added);
});
