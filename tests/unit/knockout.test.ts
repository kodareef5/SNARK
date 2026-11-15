// The knock-out kit against the wiki's numbers (ark.wiki.gg: Torpidity, Wooden Club, Slingshot, Narcoberry and Dodo,
// 2026-11-15).

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ItemDef, SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { W_BOW } from "../../shared/sim/weapon.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (name: string): number => reg.index.get(`core:${name}`)!;
const item = (name: string): ItemDef => reg.defs[at(name)] as ItemDef;

test("a blow's torpor is the wiki's multiple of what it does: fists 1.75, a wooden club 3.75, a pick 0.5, a slingshot's stone 1.35", () => {
  expect(["survivor", "club", "pick", "hatchet", "spear"].map((k) => reg.meleeTorpor[at(k)])).toEqual([1.75, 3.75, 0.5, 0, 0]);
  expect([reg.damage[at("survivor")], reg.damage[at("club")], reg.damage[at("stone")]]).toEqual([8, 5, 14]);
  // 18.75 a club's blow, which the club's page gives as 18.8; 18.9 a stone, as the slingshot's page has it.
  expect(reg.damage[at("club")]! * reg.meleeTorpor[at("club")]!).toBe(18.75);
  expect(reg.damage[at("stone")]! * reg.ammoTorpor[at("stone")]!).toBeCloseTo(18.9, 5);
  expect([reg.ammoTorporOver[at("stone")], reg.ammoTorporSeconds[at("stone")]]).toEqual([0, 0]);
});

test("the blows that knock out a dodo, from level 1 to 150", () => {
  const [t1, gain] = (reg.defs[at("dodo")] as SpeciesDef).stats!.torpidity!;
  const most = (level: number): number => t1 * (1 + gain * (level - 1));
  const blows = (by: string, level: number, torpor: number): number => Math.ceil(most(level) / (reg.damage[at(by)]! * torpor) - 1e-9);
  const levels = [1, 30, 60, 90, 120, 150];
  // Bare-handed, three punches at level 1.
  expect(levels.map((l) => blows("survivor", l, reg.meleeTorpor[at("survivor")]!))).toEqual([3, 6, 10, 14, 18, 22]);
  // Two stones at level 1, as the Dodo page counts. Its later counts take 24.5 a stone, from before patch 260 cut a stone's
  // torpor by a quarter; at 18.9 they are these.
  expect(levels.map((l) => blows("stone", l, reg.ammoTorpor[at("stone")]!))).toEqual([2, 5, 8, 11, 13, 16]);
  expect(levels.map((l) => blows("stone", l, 24.5 / 14))).toEqual([2, 4, 6, 8, 10, 13]);
  // Two clubs at level 1. The Dodo page counts 3, 9, 14, 20, 25 and 30, at the 10 a blow its table takes.
  expect(levels.map((l) => blows("club", l, reg.meleeTorpor[at("club")]!))).toEqual([2, 5, 8, 11, 14, 16]);
  expect(levels.map((l) => blows("club", l, 2))).toEqual([3, 9, 14, 20, 25, 30]);
});

test("the wooden club and the slingshot: their engrams, what they cost and how they are made", () => {
  const engram = (name: string) => CORE_CONTENT.find((d) => d.type === "engram" && d.item === `core:${name}`) as Extract<Def, { type: "engram" }>;
  expect([engram("club").level, engram("club").cost, engram("slingshot").level, engram("slingshot").cost]).toEqual([8, 4, 5, 6]);
  expect(item("club").craft).toEqual({ needs: [{ item: "core:wood", count: 4 }, { item: "core:fiber", count: 15 }], seconds: 5, xp: 2.8 });
  expect(item("slingshot").craft).toEqual({ needs: [{ item: "core:hide", count: 1 }, { item: "core:wood", count: 5 }, { item: "core:fiber", count: 20 }], seconds: 5, xp: 3.8 });
  expect([reg.weight[at("club")], reg.uses[at("club")], reg.weight[at("slingshot")], reg.uses[at("slingshot")]]).toEqual([2, 40, 3, 40]);
  // The slingshot fires the stone a survivor gathers, drawn as a bow is.
  expect(reg.weapon[at("slingshot")]!.kind).toBe(W_BOW);
  expect(item("slingshot").weapon!.ammo).toEqual(["core:stone"]);
  // A narcotic is five narcoberries and a piece of meat.
  expect(item("narcotic").craft!.needs).toEqual([{ item: "core:narcoberry", count: 5 }, { item: "core:meat", count: 1 }]);
});

test("a narcoberry: 4 food and 7.5 torpor over 3 seconds, stacks of 100 at 0.1 each, spoils in 10 minutes, and bushes bear it", () => {
  const berry = at("narcoberry");
  expect(item("narcoberry").eat).toEqual({ food: 4 });
  expect([reg.doseTorpor[berry], reg.doseSeconds[berry], reg.stack[berry], reg.weight[berry]]).toEqual([7.5, 3, 100, Math.fround(0.1)]);
  expect(Math.round((reg.spoilTicks[berry]! / GAME_HOUR_TICKS) * 140)).toBe(600);
  const bears = CORE_CONTENT.flatMap((d) => (d.type === "node" && d.yields.some((y) => y.item === "core:narcoberry") ? [d.id] : []));
  expect(bears).toEqual(["core:bush", "core:palmetto", "core:seagrape"]);
});

test("what a weapon fires must be able to be fired, and a resource may be", () => {
  const sling = CORE_CONTENT.find((d) => d.id === "core:slingshot") as ItemDef;
  const swap = (to: ItemDef): Def[] => CORE_CONTENT.map((d) => (d === sling ? to : d));
  expect(compileContent(swap({ ...sling, weapon: { ...sling.weapon!, ammo: ["core:flint"] } })).errors).toEqual(['core:slingshot: "core:flint" has no ammo facet, so it cannot be fired']);
  expect(compileContent(swap({ ...sling, weapon: { ...sling.weapon!, ammo: ["core:arrow_stone", "core:stone"] } })).errors).toEqual([]);
});
