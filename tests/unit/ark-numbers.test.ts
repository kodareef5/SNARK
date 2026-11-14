// Content numbers as the ARK wiki (ark.wiki.gg) gave them on 2026-11-14. Each test names the page it was read from.

import { expect, test } from "bun:test";
import type { LevelsDef, SpeciesDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { Inventory, moveSlot, type ItemTable } from "../../shared/sim/items.ts";
import { piecesNeeded, proneHunger } from "../../shared/sim/taming.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
const keeps = (name: string): number => reg.spoilTicks[at(name)]! / TICK_RATE;

test("raw meat stacks to 40 and a piece keeps ten minutes; cooked meat keeps twenty (Raw Meat, Cooked Meat, Spoilage)", () => {
  expect([reg.stack[at("meat")], keeps("meat"), keeps("meat_cooked")]).toEqual([40, 600, 1200]);
});

test("arrows, rounds and darts stack to 100, fiber and metal ore to 300 (Stone Arrow, Tranq Arrow, Flame Arrow, Simple Rifle Ammo, Simple Bullet, Tranquilizer Dart, Shocking Tranquilizer Dart, Fiber, Metal)", () => {
  const stack = (name: string): number => reg.stack[at(name)]!;
  expect(["arrow_stone", "arrow_tranq", "arrow_flame", "round_rifle", "round_pistol", "dart_tranq", "dart_shock"].map(stack)).toEqual([100, 100, 100, 100, 100, 100, 100]);
  expect([stack("fiber"), stack("ore")]).toEqual([300, 300]);
});

test("every other stack is ARK's too: metal ingots 300, cooked meat 50, and the rest as they were; a berry keeps ten minutes (Metal Ingot, Cooked Meat, Amarberry, and each item's own page)", () => {
  const stack = (name: string): number => reg.stack[at(name)]!;
  expect([stack("ingot"), stack("meat_cooked"), keeps("berry")]).toEqual([300, 50, 600]);
  expect(["hide", "chitin", "gunpowder", "narcotic", "stone", "wood", "thatch", "flint", "berry", "grenade", "waterskin"].map(stack)).toEqual([200, 100, 100, 100, 100, 100, 200, 100, 100, 10, 1]);
});

test("a stack saved above the size its item now has stays whole: it takes no more, moves as it is, and joins another only up to the size", () => {
  // 300 fiber in one slot, under a table that allows 200.
  const fiber = at("fiber");
  const small: ItemTable = { stack: reg.stack.map((n) => Math.min(n, 200)), weight: reg.weight, spoilTicks: reg.spoilTicks, wearSlot: reg.wearSlot };
  const a = new Inventory(4);
  a.set(0, fiber, 300, 0, 0, 0);
  expect([a.room(fiber, 0, small), a.add(fiber, 50, 0, 0, 0, small), a.count[0], a.count[1]]).toEqual([600, 0, 300, 50]);
  const b = new Inventory(4);
  expect([moveSlot(a, 0, b, 0, 0, small), a.count[0], b.count[0]]).toEqual([300, 0, 300]);
  expect([moveSlot(b, 0, a, 1, 0, small), a.count[1], b.count[0]]).toEqual([150, 200, 150]);
  expect([a.take(fiber, 10), a.total(fiber) + b.total(fiber)]).toEqual([true, 340]);
});

test("a survivor has ARK's 105 levels, the experience each takes, and its engram points for each (Leveling)", () => {
  const levels = reg.defs.find((d) => d?.type === "levels") as LevelsDef;
  expect([levels.xp.length, levels.engramPoints.length, levels.most, levels.tame]).toEqual([105, 105, undefined, undefined]);
  // The page's "XP total" for these levels. Levels 66 to 72 and 93 to 95 are not whole numbers there either.
  const xp = (level: number): number => levels.xp[level - 1]!;
  expect([1, 2, 3, 7, 10, 20, 60, 61, 62, 66, 73, 95, 100, 105].map(xp)).toEqual([0, 5, 20, 190, 450, 1900, 17700, 18850, 21078, 27498.96, 73000, 971538.1, 1798538, 4098538]);
  // "EP gained" at the first level of each step, and "EP total" at four levels.
  expect([1, 2, 9, 10, 20, 30, 40, 50, 60, 73, 87, 99, 105].map((level) => levels.engramPoints[level - 1])).toEqual([0, 8, 8, 12, 16, 20, 24, 28, 40, 50, 60, 70, 70]);
  const total = (level: number): number => levels.engramPoints.slice(0, level).reduce((a, b) => a + b, 0);
  expect([total(10), total(60), total(100), total(105)]).toEqual([76, 1104, 3144, 3494]);
});

test("food keeps four times as long in a creature, so a level 150 raptor is tamed on 52 pieces of raw meat (Spoilage, Raw Prime Meat, Taming)", () => {
  const raptor = reg.defs[at("raptor")] as SpeciesDef;
  const meat = at("meat");
  expect([reg.keeps[at("raptor")], reg.keeps[at("parasaur")], reg.keeps[at("survivor")], reg.keeps[at("storage_box")]]).toEqual([4, 4, 1, 1]);
  // A stack in a creature loses a piece every forty minutes, worked out in one call.
  const kept = new Inventory(4);
  kept.keep = 4;
  kept.add(meat, 3, 0, 0, 1000, reg);
  expect(kept.spoilAt[0]).toBe(1000 + 2400 * TICK_RATE);
  kept.settle(1000 + 4800 * TICK_RATE, reg, () => {});
  expect([kept.count[0], kept.spoilAt[0]]).toEqual([1, 1000 + 7200 * TICK_RATE]);

  // It needs 51 pieces, and eats one of what is in it each time it is a piece's worth hungry: every fifty seconds.
  const eats = raptor.eats!.find((f) => f.item === "core:meat")!;
  const pieces = piecesNeeded(raptor.taming!, 150, eats.affinity, 1);
  const every = Math.round((eats.food / proneHunger(raptor.taming!)) * TICK_RATE);
  expect([pieces, every]).toEqual([51, 50 * TICK_RATE]);
  const eaten = (given: number): number => {
    const inv = new Inventory(raptor.slots!);
    inv.keep = reg.keeps[at("raptor")]!;
    inv.add(meat, given, 0, 0, 0, reg);
    let n = 0;
    for (let t = every; n < pieces; t += every) {
      inv.settle(t, reg, () => {});
      if (!inv.take(meat, 1)) break;
      n++;
    }
    return n;
  };
  // One piece of the full stack spoils at forty minutes, two and a half minutes before the last is eaten.
  expect([eaten(51), eaten(52)]).toEqual([50, 51]);
});
