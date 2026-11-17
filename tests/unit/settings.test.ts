import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CATALOG, catalogCounts, catalogFaults, rowOf } from "../../server/settings/catalog.ts";
import { field, isList, parseIni, toNumber, toSwitch, unquote, writeNode, type IniList } from "../../server/settings/ini.ts";
import { EVENTS } from "../../server/events/catalog.ts";
import { CLASSES } from "../../shared/content/classes.ts";
import { FEATURES } from "../../server/settings/row.ts";
import { Rules, readValue } from "../../server/settings/rules.ts";
import { SETTINGS_PAGE, settingsPage } from "../../tools/settings.ts";
import { artTest } from "../fixtures/needs-art.ts";

const root = resolve(import.meta.dir, "../..");

test("every row of the catalogue is whole: one of each name, a meaning, a default in its range, and a reason for whatever it does not yet do", () => {
  expect(catalogFaults()).toEqual([]);
  const n = catalogCounts();
  expect(n.all).toBeGreaterThan(450);
  expect(n.live + n.todo + n.planned + n.none).toBe(n.all);
  // Every feature in FEATURES has something that waits for it: a planned setting, a class of content or an event.
  const waited = new Set<string>([...CATALOG.filter((r) => r.status === "planned").map((r) => r.waits), ...CLASSES.map((r) => r.waits), ...EVENTS.map((r) => r.waits)]);
  expect(Object.keys(FEATURES).filter((f) => !waited.has(f))).toEqual([]);
});

test("keys are found whatever their case, and a command-line flag is not the file key of the same letters", () => {
  expect(rowOf("tamingspeedmultiplier")!.name).toBe("TamingSpeedMultiplier");
  expect(rowOf("TAMINGSPEEDMULTIPLIER")!.at).toBe("server");
  expect([rowOf("Port")!.at, rowOf("port", true)!.at]).toEqual(["session", "cli"]);
  expect(rowOf("NoSuchSetting")).toBeUndefined();
  // ARK's defaults and retime directions, at a few places where they are easy to get wrong.
  expect(rowOf("PerLevelStatsMultiplier_DinoTamed")!.def).toEqual([0.2, 1, 1, 1, 1, 1, 1, 1, 0.17, 1, 1, 1]);
  expect(rowOf("PlayerBaseStatMultipliers")!.def).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0]);
  expect([rowOf("StructurePickupTimeAfterPlacement")!.def, rowOf("StructureDamageRepairCooldown")!.def, rowOf("FastDecayInterval")!.def, rowOf("DinoHarvestingDamageMultiplier")!.def]).toEqual([30, 180, 43200, 3.2]);
  expect([rowOf("EggHatchSpeedMultiplier")!.retime, rowOf("MatingIntervalMultiplier")!.retime, rowOf("ResourcesRespawnPeriodMultiplier")!.retime]).toEqual(["speed", "period", "period"]);
});

artTest("the reference page is what the catalogue would write; and every setting said to take effect is read somewhere", () => {
  // If this fails the page is stale. Run `bun run settings`.
  expect(readFileSync(SETTINGS_PAGE, "utf8")).toBe(settingsPage());
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "node_modules" && name !== "dist") walk(p);
      } else if (p.endsWith(".ts") && !/settings\/(rows-|catalog)/.test(p)) files.push(p);
    }
  };
  for (const zone of ["server", "shared", "client/core"]) walk(join(root, zone));
  const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const unread = CATALOG.filter((r) => r.status === "live" && !all.includes(`"${r.name}"`)).map((r) => r.name);
  expect(unread).toEqual([]);
});

test("an ini file is read as ARK writes one: sections, repeated and indexed keys, structs within structs, and what is wrong with a line that cannot be read", () => {
  const file = parseIni(
    [
      "; a comment",
      "[ServerSettings]",
      "TamingSpeedMultiplier=4.5",
      "serverPVE = True",
      "ServerPassword=two words",
      "",
      "[/script/shootergame.shootergamemode]",
      "PerLevelStatsMultiplier_DinoTamed[0]=0.4",
      "OverridePlayerLevelEngramPoints=8",
      "OverridePlayerLevelEngramPoints=12",
      'PreventDinoTameClassNames="core:raptor"',
      'OverrideNamedEngramEntries=(EngramClassName="core:engram-hatchet",EngramHidden=False,EngramPointsCost=3)',
      'ConfigOverrideItemMaxQuantity=(ItemClassString="core:arrow_stone",Quantity=(MaxItemQuantity=543,bIgnoreMultiplier=True))',
      'ConfigOverrideItemCraftingCosts=(ItemClassString="core:hatchet",BaseCraftingResourceRequirements=((ResourceItemTypeString="core:thatch",BaseResourceRequirement=1.0),(ResourceItemTypeString="core:flint, sharp",BaseResourceRequirement=2.0)))',
      "LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=5,ExperiencePointsForLevel[1]=20)",
      'NPCsToSpawnStrings=("a","b")',
    ].join("\r\n"),
  );
  expect(file.faults).toEqual([]);
  const e = file.entries;
  expect(e.map((x) => [x.section, x.key, x.index, x.line]).slice(0, 5)).toEqual([
    ["ServerSettings", "TamingSpeedMultiplier", -1, 3],
    ["ServerSettings", "serverPVE", -1, 4],
    ["ServerSettings", "ServerPassword", -1, 5],
    ["/script/shootergame.shootergamemode", "PerLevelStatsMultiplier_DinoTamed", 0, 8],
    ["/script/shootergame.shootergamemode", "OverridePlayerLevelEngramPoints", -1, 9],
  ]);
  expect([e[0]!.value, e[1]!.value, e[2]!.value, e[3]!.value, e[6]!.value]).toEqual(["4.5", "True", "two words", "0.4", '"core:raptor"']);
  // Field lookup ignores case.
  const engram = e[7]!.value as IniList;
  expect([isList(engram), unquote(field(engram, "engramclassname") as string), field(engram, "EngramHidden"), toNumber(field(engram, "EngramPointsCost") as string), field(engram, "Missing")]).toEqual([true, "core:engram-hatchet", "False", 3, undefined]);
  const quantity = field(e[8]!.value as IniList, "Quantity") as IniList;
  expect([field(quantity, "MaxItemQuantity"), toSwitch(field(quantity, "bIgnoreMultiplier") as string)]).toEqual(["543", true]);
  // A list of structs has unnamed items. A comma inside quotes ends nothing.
  const needs = field(e[9]!.value as IniList, "BaseCraftingResourceRequirements") as IniList;
  expect(needs.items.map((it) => [it.key, unquote(field(it.value as IniList, "ResourceItemTypeString") as string)])).toEqual([["", "core:thatch"], ["", "core:flint, sharp"]]);
  // An indexed field keeps the index in its name. Bare words in a list are items with no name.
  expect((e[10]!.value as IniList).items.map((it) => [it.key, it.value])).toEqual([["ExperiencePointsForLevel[0]", "5"], ["ExperiencePointsForLevel[1]", "20"]]);
  expect((e[11]!.value as IniList).items.map((it) => [it.key, it.value])).toEqual([["", '"a"'], ["", '"b"']]);
  // Written out again it is the line it was read from.
  for (const k of [7, 8, 9, 10, 11]) expect(`${e[k]!.key}=${writeNode(e[k]!.value)}`).toBe(file.entries[k]!.key + "=" + writeNode(parseIni(`${e[k]!.key}=${writeNode(e[k]!.value)}`).entries[0]!.value));
  expect(writeNode(e[8]!.value)).toBe('(ItemClassString="core:arrow_stone",Quantity=(MaxItemQuantity=543,bIgnoreMultiplier=True))');

  // An unreadable line is reported with its line number, and reading goes on.
  const bad = parseIni(["[Open", "no equals here", "Key[x]=1", "9lives=1", "A=(B=1", 'C=(D="unclosed)', "E=(F=1)G", "Good=1", "=5"].join("\n"));
  expect(bad.faults.map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
  expect(bad.faults[4]!.why).toMatch(/bracket is not closed/);
  expect(bad.faults[5]!.why).toMatch(/quote is not closed|bracket is not closed/);
  expect(bad.entries.map((x) => x.key)).toEqual(["Good"]);
  expect([toNumber("1.5"), toNumber("-2"), toNumber("1e3"), Number.isNaN(toNumber("1.5x")), Number.isNaN(toNumber("")), toSwitch("TRUE"), toSwitch("0"), toSwitch("yes")]).toEqual([1.5, -2, 1000, true, true, true, false, null]);
});

test("a value is checked against its row: its kind, its range, and whether it is whole", () => {
  const read = (name: string, words: string) => readValue(rowOf(name)!, words);
  expect(read("TamingSpeedMultiplier", "4.5")).toEqual({ value: 4.5 });
  expect(read("TamingSpeedMultiplier", "fast")).toMatch(/wants a number/);
  expect(read("TamingSpeedMultiplier", "-1")).toMatch(/from 0 to/);
  expect(read("EggHatchSpeedMultiplier", "0")).toMatch(/from 0.001 to/);
  expect(read("MaxTamedDinos", "5000.0")).toEqual({ value: 5000 });
  expect(read("MaxTamedDinos", "12.5")).toMatch(/whole number/);
  expect([read("serverPVE", "True"), read("serverPVE", "false"), read("serverPVE", "1")]).toEqual([{ value: true }, { value: false }, { value: true }]);
  expect(read("serverPVE", "maybe")).toMatch(/True or False/);
  expect(read("ServerPassword", "open sesame")).toEqual({ value: "open sesame" });
  expect(read("PreventDinoTameClassNames", '"core:raptor"')).toEqual({ value: "core:raptor" });
  expect(read("OverrideNamedEngramEntries", "3")).toMatch(/in brackets/);
  expect(read("TamingSpeedMultiplier", parseIni("X=(A=1)").entries[0]!.value as never)).toMatch(/single value/);
  expect([readValue(rowOf("NoDinos", true)!, ""), readValue(rowOf("port", true)!, "9000"), readValue(rowOf("port", true)!, "")]).toEqual([{ value: true }, { value: "9000" }, "wants a value"]);
});

test("rules begin as the catalogue's defaults, and are read and set by ARK's names", () => {
  const rules = new Rules();
  // ARK's defaults.
  expect([rules.num("TamingSpeedMultiplier"), rules.on("ShowFloatingDamageText"), rules.on("AlwaysAllowStructurePickup"), rules.num("StructurePickupTimeAfterPlacement"), rules.text("ServerPassword"), rules.flag("NoDinos"), rules.list("PreventDinoTameClassNames")]).toEqual([1, false, false, 30, "", false, []]);
  expect(rules.indexed("PerLevelStatsMultiplier_DinoTamed")[8]).toBe(0.17);
  expect(() => rules.num("NoSuchSetting")).toThrow(/no setting/);
  expect(() => rules.num("serverPVE")).toThrow(/not a number/);
  const before = new Rules();
  expect(before.version).toBe(0);

  // assign takes ARK's name in any case and the value as text. It returns "" or the reason for refusing.
  expect([rules.assign("tamingspeedmultiplier", "2.5", "console"), rules.num("TamingSpeedMultiplier"), rules.sourceOf(rowOf("TamingSpeedMultiplier")!)]).toEqual(["", 2.5, "console"]);
  expect(rules.assign("TamingSpeedMultiplier", "lots", "console")).toMatch(/TamingSpeedMultiplier wants a number/);
  expect(rules.assign("Gravity", "2", "console")).toMatch(/no setting called Gravity/);
  expect(rules.assign("PreventDinoTameClassNames", "core:raptor", "console")).toMatch(/is a list/);
  expect([rules.version > 0, before.num("TamingSpeedMultiplier")]).toEqual([true, 1]);
  // A weaker source does not replace a value a stronger one set.
  expect([rules.yields(rowOf("TamingSpeedMultiplier")!, "file"), rules.yields(rowOf("TamingSpeedMultiplier")!, "console"), rules.yields(rowOf("XPMultiplier")!, "file")]).toEqual([false, true, true]);
});
