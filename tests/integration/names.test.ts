// What a name means at the console and in a settings file: an id, an id it once had, an alias, or the id's own name
// where one thing alone answers to it. And the tag that a creature's variants share.
import { expect, test } from "bun:test";
import { CORE_PACK } from "../../content/core.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { find } from "../../shared/content/find.ts";
import { compilePacks, type DefPatch } from "../../shared/content/packs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { Harness } from "../fixtures/net.ts";

const packs = (t: DefPatch[], u: DefPatch[] = []) =>
  compilePacks([CORE_PACK, { name: "t", requires: ["core"], defs: t }, { name: "u", requires: ["core"], defs: u }]);
const item = (id: string, more: Record<string, unknown> = {}): DefPatch => ({ id, type: "item", class: "resource", stack: 100, ...more });

const made = packs(
  [
    item("t:lance", { aliases: ["PrimalItem_Lance_C", "pike"] }),
    // A copy starts with its parent's fields and not its parent's other names.
    { id: "t:lance_long", extends: "t:lance" },
    item("t:stone"),
    { id: "t:raptor_alpha", extends: "core:raptor", variant: "alpha" },
    { id: "t:javelin", type: "rename", to: ["core:spear"] },
    { id: "t:rations", type: "rename", to: ["core:berry", "core:meat"] },
  ],
  [item("u:pike")],
);
if (!made.registry) throw new Error(made.errors.join("\n"));
const REG: Registry = made.registry;
const ids = (name: string, type?: "item" | "species"): string[] => find(REG, name, type).kinds.map((k) => REG.ids[k]!);

test("a name is an id, an id it once had, an alias, or the id's own name, in any case", () => {
  expect(ids("core:spear")).toEqual(["core:spear"]);
  expect(ids("spear")).toEqual(["core:spear"]);
  expect(ids("Core:Spear")).toEqual(["core:spear"]);
  expect(ids("primalitem_lance_c")).toEqual(["t:lance"]);
  expect(ids("lance")).toEqual(["t:lance"]);
  expect(find(REG, "t:javelin")).toEqual({ kinds: [REG.index.get("core:spear")!], could: [], renamed: true });
  expect(ids("t:rations")).toEqual(["core:berry", "core:meat"]);
  expect(ids("javelin")).toEqual([]);
  expect(ids("")).toEqual([]);
  expect(ids("pear")).toEqual([]);
});

test("only the family asked for is meant, and a name that fits several things means none of them", () => {
  expect(ids("raptor")).toEqual(["core:raptor"]);
  expect(ids("raptor", "species")).toEqual(["core:raptor"]);
  expect(ids("raptor", "item")).toEqual([]);
  expect(ids("core:raptor", "item")).toEqual([]);
  expect(ids("t:rations", "species")).toEqual([]);
  // Two packs each have a stone. One pack's alias is another's name.
  expect(find(REG, "stone")).toEqual({ kinds: [], could: ["core:stone", "t:stone"], renamed: false });
  expect(find(REG, "pike")).toEqual({ kinds: [], could: ["t:lance", "u:pike"], renamed: false });
  expect(ids("u:pike")).toEqual(["u:pike"]);
});

test("a variant shares its base's tag, and an alias is one definition's alone", () => {
  expect(REG.tags.get("raptor")!.map((k) => REG.ids[k])).toEqual(["core:raptor", "t:raptor_alpha"]);
  expect([...REG.tags.keys()].sort()).toEqual(["brachio", "dodo", "grazer", "parasaur", "pteranodon", "raptor", "spino", "stego", "trike"]);
  expect([REG.ids[REG.aliases.get("pike")!], (REG.defs[REG.index.get("t:lance_long")!] as ItemDef).aliases]).toEqual(["t:lance", undefined]);

  const errors = (defs: DefPatch[]): string[] => packs(defs).errors;
  expect(errors([item("t:a", { aliases: ["Blade"] }), item("t:b", { aliases: ["blade"] })])).toEqual(['t:b: alias "blade" is t:a\'s']);
  expect(errors([item("t:a", { aliases: ["two words"] })])).toEqual(['t:a: alias "two words" must be one word of letters, digits, "_", "-" and "."']);
  expect(errors([item("t:a", { aliases: "blade" })])).toEqual(['t:a: "aliases" must be a list of names']);
  expect(errors([{ id: "t:a", type: "rename", to: ["core:spear"], aliases: ["blade"] }])).toEqual(['t:a: class rename may not declare "aliases"']);
  expect(errors([{ id: "t:a", extends: "core:raptor", tag: "Big Raptor" }])).toEqual(['t:a: tag "Big Raptor" must be one word of lower-case letters, digits and "_"']);
});

test("the console takes any of a thing's names, and says which things an unclear one could be", () => {
  const h = new Harness({}, 1, 60, { dev: true }, REG);
  const ada = h.join("ada");
  h.run(500);
  expect(h.say(ada, "enablecheats")).toEqual(["cheats enabled"]);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const has = (id: string): number => rec.inv!.total(REG.index.get(id)!);

  expect(h.say(ada, "give spear")).toEqual(["gave 1 core:spear"]);
  expect(h.say(ada, "give Pike 2")).toEqual(['"Pike" could be t:lance or u:pike; say which']);
  expect(h.say(ada, "give PrimalItem_Lance_C 2")).toEqual(["gave 2 t:lance"]);
  expect(h.say(ada, "give t:javelin")).toEqual(["gave 1 core:spear"]);
  expect(h.say(ada, "give t:rations")).toEqual(['"t:rations" is now core:berry, core:meat; say which']);
  expect(h.say(ada, "give stone")).toEqual(['"stone" could be core:stone or t:stone; say which']);
  expect(h.say(ada, "give raptor")).toEqual(['no item "raptor"']);
  expect(h.say(ada, "give")).toEqual(['no item ""']);
  expect([has("core:spear"), has("t:lance"), has("core:stone")]).toEqual([2, 2, 0]);

  expect(h.say(ada, "spawn raptor 5")[0]).toBe("spawned core:raptor level 5");
  expect(h.say(ada, "spawn raptor_alpha")[0]).toBe("spawned t:raptor_alpha level 1");
  expect(h.say(ada, "spawn spear")).toEqual(['no species "spear"']);
  expect(h.say(ada, "buff God")).toEqual(["core:god on"]);
  expect(h.say(ada, "place wall_wood")[0]).toContain("placed core:wall_wood");
  h.host.shutdown();
});

test("a settings file takes the same names, and a name that is unclear changes nothing and is reported", () => {
  const read = loadConfig({
    gus: "[ServerSettings]",
    game: [
      "[/script/shootergame.shootergamemode]",
      'PreventDinoTameClassNames="Raptor"',
      'PreventDinoTameClassNames="spear"',
      'HarvestResourceItemAmountClassMultipliers=(ClassName="lance",Multiplier=3.0)',
      'HarvestResourceItemAmountClassMultipliers=(ClassName="stone",Multiplier=2.0)',
      'HarvestResourceItemAmountClassMultipliers=(ClassName="t:rations",Multiplier=4.0)',
      'ConfigOverrideItemMaxQuantity=(ItemClassString="PrimalItem_Lance_C",Quantity=(MaxItemQuantity=7,bIgnoreMultiplier=true))',
      'ConfigOverrideItemMaxQuantity=(ItemClassString="t:rations",Quantity=(MaxItemQuantity=30,bIgnoreMultiplier=true))',
      'ConfigOverrideItemCraftingCosts=(ItemClassString="spear",BaseCraftingResourceRequirements=((ResourceItemTypeString="wood",BaseResourceRequirement=2.0)))',
    ].join("\n"),
  });
  expect([read.report.refused, read.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 1, 60, { config: read.rules }, REG);
  const { lists } = h.host;
  const reg = h.world.reg;
  const k = (id: string): number => reg.index.get(id)!;

  expect([...lists.kinds("PreventDinoTameClassNames")]).toEqual([k("core:raptor")]);
  expect([...lists.multipliers("HarvestResourceItemAmountClassMultipliers")]).toEqual([[k("t:lance"), 3], [k("core:berry"), 4], [k("core:meat"), 4]]);
  expect([reg.stack[k("t:lance")], reg.stack[k("core:berry")], reg.stack[k("core:meat")], reg.stack[k("t:lance_long")]]).toEqual([7, 30, 30, 100]);
  expect([...reg.recipeOf[k("core:spear")]!]).toEqual([k("core:wood"), 2]);

  expect(lists.missing).toEqual([{ setting: "PreventDinoTameClassNames", name: "spear" }]);
  expect(lists.unclear).toEqual([{ setting: "HarvestResourceItemAmountClassMultipliers", name: "stone", could: ["core:stone", "t:stone"] }]);
  expect(lists.renamed).toEqual([
    { setting: "ConfigOverrideItemMaxQuantity", name: "t:rations", to: ["core:berry", "core:meat"] },
    { setting: "HarvestResourceItemAmountClassMultipliers", name: "t:rations", to: ["core:berry", "core:meat"] },
  ]);
  h.host.shutdown();
});
