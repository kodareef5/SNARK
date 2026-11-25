// ARK-style configuration: the two files, the command line, the live file and the console, and the report on everything read.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../../server/persist/store.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { applyLive, emptyReport, formatReport, loadConfig, loadConfigFolder } from "../../server/settings/config.ts";
import { timersOf } from "../../server/settings/rules.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { Harness } from "../fixtures/net.ts";
import { adminLines } from "../fixtures/acts.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-settings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const GUS = `; what an operator of ARK might write
[ServerSettings]
TamingSpeedMultiplier=3
xpmultiplier=2.5
serverPVE=True
ServerAdminPassword=hunter2
DinoCountMultiplier=2
ActiveMods=12345,67890
Gravity=0.5
TamingSpeedMultiplier=fast
EggHatchSpeedMultiplier=10
MaxTamedDinos=5000.0

[SessionSettings]
SessionName=The Proving Ground
Port=9000

[MessageOfTheDay]
Message=Welcome\\nBe kind
Duration=30

[/Script/Engine.GameSession]
MaxPlayers=40

[/Script/ShooterGame.ShooterGameUserSettings]
MasterAudioVolume=1.0

[SomeMod]
Knob=3
Dial=4
`;

const GAME = `[/script/shootergame.shootergamemode]
EggHatchSpeedMultiplier=25
MatingIntervalMultiplier=0.1
BabyCuddleIntervalMultiplier=0.1
PerLevelStatsMultiplier_DinoTamed[0]=0.4
PerLevelStatsMultiplier_DinoTamed[99]=1
PerLevelStatsMultiplier_Player=2
OverridePlayerLevelEngramPoints=8
OverridePlayerLevelEngramPoints=12
PreventDinoTameClassNames="core:raptor"
PreventDinoTameClassNames="core:parasaur"
OverrideNamedEngramEntries=(EngramClassName="core:engram-hatchet",EngramPointsCost=3)
BabyMatureSpeedMultiplier=0
TamingSpeedMultiplier=9
this line is nonsense
`;

/** "file:line" of the nth line of `text` that starts with `start`. */
const at = (file: string, text: string, start: string, nth = 0): string => `${file}:${text.split("\n").flatMap((l, i) => (l.startsWith(start) ? [i + 1] : []))[nth]}`;
const gusAt = (start: string, nth = 0): string => at("GameUserSettings.ini", GUS, start, nth);
const gameAt = (start: string, nth = 0): string => at("Game.ini", GAME, start, nth);

test("the two files are read as ARK's are: each key in its own section of its own file, and everything said of: applied, not yet, no use, unknown, refused", () => {
  const { rules, report } = loadConfig({ gus: GUS, game: GAME });
  // Keys match in any letter case.
  expect([rules.num("TamingSpeedMultiplier"), rules.on("ProximityChat"), rules.num("EggHatchSpeedMultiplier"), rules.num("MatingIntervalMultiplier")]).toEqual([3, false, 25, 0.1]);
  expect(report.applied.map((a) => [a.row.name, a.where])).toEqual([
    ["TamingSpeedMultiplier", gusAt("TamingSpeedMultiplier=3")],
    ["XPMultiplier", gusAt("xpmultiplier")],
    ["serverPVE", gusAt("serverPVE")],
    ["ServerAdminPassword", gusAt("ServerAdminPassword")],
    ["DinoCountMultiplier", gusAt("DinoCountMultiplier")],
    ["MaxTamedDinos", gusAt("MaxTamedDinos")],
    ["SessionName", gusAt("SessionName")],
    ["Port", gusAt("Port")],
    ["Message", gusAt("Message")],
    ["Duration", gusAt("Duration")],
    ["MaxPlayers", gusAt("MaxPlayers")],
    ["EggHatchSpeedMultiplier", gameAt("EggHatch")],
    ["MatingIntervalMultiplier", gameAt("MatingInterval")],
    ["PerLevelStatsMultiplier_DinoTamed", gameAt("PerLevelStatsMultiplier_DinoTamed[0]")],
    ["OverridePlayerLevelEngramPoints", gameAt("OverridePlayerLevelEngramPoints")],
    ["PreventDinoTameClassNames", gameAt("PreventDinoTame")],
    ["OverrideNamedEngramEntries", gameAt("OverrideNamedEngramEntries")],
  ]);
  // A setting that waits for a feature is still read, checked and held.
  expect([rules.num("XPMultiplier"), rules.on("serverPVE"), rules.text("ServerAdminPassword"), rules.num("DinoCountMultiplier"), rules.num("MaxTamedDinos"), rules.text("SessionName"), rules.num("Port"), rules.text("Message"), rules.num("Duration"), rules.num("MaxPlayers"), rules.num("BabyCuddleIntervalMultiplier")]).toEqual([2.5, true, "hunter2", 2, 5000, "The Proving Ground", 9000, "Welcome\\nBe kind", 30, 40, 0.1]);
  expect(report.waiting.map((w) => w.row.name)).toEqual(["BabyCuddleIntervalMultiplier"]);
  expect(report.nothing.map((x) => x.row.name)).toEqual(["ActiveMods"]);
  // An indexed setting changes only at its index. The 0.17 at index 8 is ARK's default.
  expect(rules.indexed("PerLevelStatsMultiplier_DinoTamed")).toEqual([0.4, 1, 1, 1, 1, 1, 1, 1, 0.17, 1, 1, 1]);
  expect([rules.numbers("OverridePlayerLevelEngramPoints"), rules.list("PreventDinoTameClassNames"), rules.list("OverrideNamedEngramEntries").length]).toEqual([[8, 12], ["core:raptor", "core:parasaur"], 1]);
  // An unknown section is reported once. ARK's client settings section is not reported at all.
  expect(report.unknown).toEqual([{ key: "Gravity", where: gusAt("Gravity") }, { key: "[SomeMod]", where: gusAt("Knob") }]);
  // A key in the wrong file is refused. ARK would ignore it silently.
  expect(report.refused.map((r) => [r.key, r.where, r.why])).toEqual([
    ["TamingSpeedMultiplier", gusAt("TamingSpeedMultiplier=fast"), 'wants a number, got "fast"'],
    ["EggHatchSpeedMultiplier", gusAt("EggHatch"), "belongs in Game.ini [/script/shootergame.shootergamemode]"],
    ["", gameAt("this line"), "not a Key=Value line"],
    ["PerLevelStatsMultiplier_DinoTamed", gameAt("PerLevelStatsMultiplier_DinoTamed[99]"), "has no index 99"],
    ["PerLevelStatsMultiplier_Player", gameAt("PerLevelStatsMultiplier_Player"), "wants an index: Key[n]=value"],
    ["BabyMatureSpeedMultiplier", gameAt("BabyMature"), "wants a number from 0.001 to 100000, got 0"],
    ["TamingSpeedMultiplier", gameAt("TamingSpeed"), "belongs in GameUserSettings.ini [ServerSettings]"],
  ]);
  const lines = formatReport(report, rules);
  expect(lines[0]).toBe("settings: 17 applied, 1 not yet effective, 1 of no meaning here, 2 unknown, 7 refused");
  expect(lines).toContain(`  applied   ServerAdminPassword=****  (${gusAt("ServerAdminPassword")})`);
  expect(lines).toContain(`  applied   TamingSpeedMultiplier=3  (${gusAt("TamingSpeedMultiplier=3")})`);
  expect(lines).toContain(`  not yet   BabyCuddleIntervalMultiplier  (${gameAt("BabyCuddle")}): waits for: imprinting and baby care`);
  expect(lines).toContain(`  no use    ActiveMods  (${gusAt("ActiveMods")}): ARK's mods`);
  expect(lines).toContain(`  unknown   Gravity  (${gusAt("Gravity")})`);
  expect(lines).toContain(`  refused   a line  (${gameAt("this line")}): not a Key=Value line`);
  expect(lines.join("\n")).not.toContain("hunter2");
});

test("each source is stronger than the one before it: default, files, command line, live file, console", () => {
  const gus = "[ServerSettings]\nTamingSpeedMultiplier=3\nglobalVoiceChat=True\nPvEStructureDecayPeriodMultiplier=2\n";
  const game = "[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=4\nPreventDinoTameClassNames=\"core:raptor\"\n";
  // ARK's command-line forms are `Map?Key=Value?Key=Value`, `-Flag` and `-Flag=value`. SNARK's own two-dash arguments are handed back in `ours`.
  const argv = ["--dev", "TheIsland?TamingSpeedMultiplier=5?StructureResistanceMultiplier=0.5?EggHatchSpeedMultiplier=9?Nonsense=1", "-UseDynamicConfig", "-port=9100", "-NoBattlEye", "-Bogus", "--port", "8800", "--db", "var/x.db"];
  const live = "TamingSpeedMultiplier=8\nEggHatchSpeedMultiplier=2.0\nServerAdminPassword=nope\nPreventDinoTameClassNames=\"core:parasaur\"\n";
  const { rules, report, ours } = loadConfig({ gus, game, live }, argv);
  expect(ours).toEqual(["--dev", "--port", "8800", "--db", "var/x.db"]);
  expect([rules.num("TamingSpeedMultiplier"), rules.num("StructureResistanceMultiplier"), rules.num("EggHatchSpeedMultiplier"), rules.on("globalVoiceChat"), rules.num("PvEStructureDecayPeriodMultiplier")]).toEqual([8, 0.5, 2, true, 2]);
  expect(["TamingSpeedMultiplier", "StructureResistanceMultiplier", "EggHatchSpeedMultiplier", "globalVoiceChat", "XPMultiplier"].map((n) => rules.sourceOf(rowOf(n)!))).toEqual(["live file", "command line", "live file", "file", "default"]);
  expect([rules.flag("UseDynamicConfig"), rules.flag("port"), rules.flag("NoDinos"), rules.flag("NoBattlEye")]).toEqual([true, "9100", false, true]);
  const why = (key: string): string[] => report.refused.filter((r) => r.key === key).map((r) => `${r.where}: ${r.why}`);
  expect(why("EggHatchSpeedMultiplier")).toEqual(["command line: is a Game.ini setting, which the command line cannot give"]);
  // A list the live file gives replaces the files', as any stronger source's does.
  expect(why("PreventDinoTameClassNames")).toEqual([]);
  expect(rules.list("PreventDinoTameClassNames")).toEqual(["core:parasaur"]);
  expect(report.unknown.map((u) => u.key)).toEqual(["?Nonsense", "-Bogus"]);
  expect(why("ServerAdminPassword")).toEqual(["DynamicConfig.ini:3: is read at start only"]);
  // Without -UseDynamicConfig the live file is not read.
  expect(loadConfig({ gus, game, live }, []).rules.num("TamingSpeedMultiplier")).toBe(3);
  // A later read of the live file does not override the console.
  expect(rules.assign("TamingSpeedMultiplier", "20", "console")).toBe("");
  applyLive(rules, "TamingSpeedMultiplier=8\n", emptyReport());
  expect([rules.num("TamingSpeedMultiplier"), rules.sourceOf(rowOf("TamingSpeedMultiplier")!)]).toEqual([20, "console"]);
});

test("a live file read again with nothing changed is not a change, lists and all; a value or an entry that differs is one", () => {
  const live = (taming: number, wood: number): string => `TamingSpeedMultiplier=${taming}\nShowFloatingDamageText=True\nHarvestResourceItemAmountClassMultipliers=(ClassName="core:wood",Multiplier=${wood})\nHarvestResourceItemAmountClassMultipliers=(ClassName="core:stone",Multiplier=3)\n`;
  const { rules, report } = loadConfig({ gus: "[ServerSettings]\nXPMultiplier=2\n", live: live(8, 2) }, ["-UseDynamicConfig"]);
  expect([report.refused, report.unknown]).toEqual([[], []]);
  let at = rules.version;
  const read = (text: string): boolean => {
    applyLive(rules, text, emptyReport());
    const changed = rules.version !== at;
    at = rules.version;
    return changed;
  };
  expect([read(live(8, 2)), read(live(8, 2))]).toEqual([false, false]);
  expect([read(live(9, 2)), rules.num("TamingSpeedMultiplier")]).toEqual([true, 9]);
  expect([read(live(9, 4)), rules.list("HarvestResourceItemAmountClassMultipliers").length, read(live(9, 4))]).toEqual([true, 2, false]);
  // The value a setting already has, given by a stronger source, is no change, and the setting is that source's from then on.
  expect([rules.assign("XPMultiplier", "2", "console"), rules.version === at, rules.sourceOf(rowOf("XPMultiplier")!)]).toEqual(["", true, "console"]);
  expect([rules.assign("XPMultiplier", "3", "console"), rules.version === at]).toEqual(["", false]);
});

test("a folder is read from disk, any of its files missing; a server started on it has its rules, the console changes only what may change while it runs, and nothing of them is kept with the world but what its timers were worked out under", () => {
  const folder = join(dir, "config");
  const dbPath = join(dir, "world.db");
  expect(loadConfigFolder(join(dir, "no-such-folder")).report).toEqual(emptyReport());
  Bun.spawnSync(["mkdir", "-p", folder]);
  writeFileSync(join(folder, "GameUserSettings.ini"), "[ServerSettings]\nTamingSpeedMultiplier=6\nStructureResistanceMultiplier=2\n");
  writeFileSync(join(folder, "Game.ini"), "[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=40\nBabyMatureSpeedMultiplier=200\n");
  const first = loadConfigFolder(folder, ["?TamingSpeedMultiplier=7"]);
  expect([first.report.applied.length, first.report.refused, first.report.unknown]).toEqual([4, [], []]);
  let h = new Harness({}, 1, 60, { dev: true, dbPath, config: first.rules });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  expect([h.host.rules.num("TamingSpeedMultiplier"), h.host.rules.num("EggHatchSpeedMultiplier"), h.host.loadedUnder]).toEqual([7, 40, null]);
  expect(h.say(ada, "settings")).toEqual(["TamingSpeedMultiplier=7  (command line)", "StructureResistanceMultiplier=2  (file)", "EggHatchSpeedMultiplier=40  (file)", "BabyMatureSpeedMultiplier=200  (file)"]);
  expect(h.say(ada, "setting eggHatchSpeedMultiplier")).toEqual(["EggHatchSpeedMultiplier=40  (file; may be changed while the server runs)", "How fast an egg hatches, or young are carried. Higher is faster."]);
  expect(h.say(ada, "setting EggHatchSpeedMultiplier 80")).toEqual(["EggHatchSpeedMultiplier=80  (until the server is started again)"]);
  expect(h.say(ada, "setting EggHatchSpeedMultiplier 0")[0]).toMatch(/wants a number from 0.001/);
  expect(h.say(ada, "setting CropGrowthSpeedMultiplier 2")).toEqual(["CropGrowthSpeedMultiplier does not take effect yet"]);
  expect(h.say(ada, "setting Port 9000")).toEqual(["Port is read when the server starts: set it in its file and start again"]);
  expect(h.say(ada, "setting Port")[0]).toBe("Port=8787  (default; read when the server starts)");
  expect(h.say(ada, "setting CropGrowthSpeedMultiplier")[0]).toBe("CropGrowthSpeedMultiplier=1  (default; waits for: farming, irrigation, and upkeep of the body)");
  expect(h.say(ada, "setting Gravity 2")).toEqual(["there is no setting called Gravity"]);
  expect(h.say(ada, "setting ServerAdminPassword hunter2")[0]).toMatch(/ServerAdminPassword does not take effect yet|read when the server starts/);
  expect(h.host.rules.num("EggHatchSpeedMultiplier")).toBe(80);
  const bob = h.join("bob");
  h.run(500);
  expect(h.say(bob, "setting EggHatchSpeedMultiplier 1")[0]).toMatch(/cheats|admin/i);
  h.run(500);
  h.host.shutdown();
  const store = new WorldStore(dbPath, h.reg);
  const typed = adminLines(store);
  store.close();
  expect(typed).toContain("ada\tsetting EggHatchSpeedMultiplier 80");
  expect(typed).toContain("ada\tsetting ServerAdminPassword ****");
  expect(typed.join("\n")).not.toContain("hunter2");

  // Started on the folder alone, neither the command line's 7 nor the console's 80 remains.
  const again = loadConfigFolder(folder);
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: again.rules });
  expect([h.host.rules.num("TamingSpeedMultiplier"), h.host.rules.num("EggHatchSpeedMultiplier")]).toEqual([6, 40]);
  // The save keeps the rules its timers were last computed under, so they can be retimed. Here that is the console's 80.
  expect(h.host.loadedUnder).toMatchObject({ EggHatchSpeedMultiplier: 80, BabyMatureSpeedMultiplier: 200, MatingIntervalMultiplier: 1 });
  h.host.shutdown();
  expect([timersOf(null), timersOf("not json"), timersOf('{"timers":{"EggHatchSpeedMultiplier":4,"Bad":"x"}}')]).toEqual([null, null, { EggHatchSpeedMultiplier: 4 }]);
});

test("ARK's single-player settings are its own fixed factors on top of what the files and the command line give; what is set afterwards is set outright", () => {
  const made = loadConfig({ gus: "[ServerSettings]\nTamingSpeedMultiplier=2\n", game: "[/script/shootergame.shootergamemode]\nbUseSingleplayerSettings=True\nMatingIntervalMultiplier=0.5\nPerLevelStatsMultiplier_DinoTamed[1]=3\n" }, ["?TamingSpeedMultiplier=4"]);
  const r = made.rules;
  const near = (v: number): number => Math.round(v * 1e4) / 1e4;
  // Taming is 2.5 times the command line's 4. Hatching is 9 and growing up 35 times ARK's 1. The mating wait is 0.15 times the file's 0.5.
  expect([r.num("TamingSpeedMultiplier"), r.num("EggHatchSpeedMultiplier"), r.num("BabyMatureSpeedMultiplier"), near(r.num("MatingIntervalMultiplier"))]).toEqual([10, 9, 35, 0.075]);
  // A tame's health per level is 2.125 times ARK's 0.2 and its melee 2.3529 times ARK's 0.17. The stat the file set stays as set.
  expect(r.indexed("PerLevelStatsMultiplier_DinoTamed").map(near)).toEqual([0.425, 3, 1, 1, 1, 1, 1, 1, 0.4, 1, 1, 1]);
  // Corpses last six times as long. Factors that wait for a feature are held too.
  expect([r.num("UseCorpseLifeSpanMultiplier"), r.num("BabyCuddleIntervalMultiplier"), r.num("CropGrowthSpeedMultiplier"), near(r.indexed("PerLevelStatsMultiplier_DinoTamed_Add")[0]!)]).toEqual([6, 0.17, 4, 0.5]);
  // The factors do not change where a value is reported to come from.
  const lines = formatReport(made.report, r);
  expect(lines.filter((l) => l.startsWith("  note      bUseSingleplayerSettings: ARK's single-player factors are on top of what was read")).length).toBe(1);
  expect([r.sourceOf(rowOf("TamingSpeedMultiplier")!), r.sourceOf(rowOf("EggHatchSpeedMultiplier")!)]).toEqual(["command line", "default"]);
  // The server's content is tuned to match. A parasaur gains 2.125 times the health from a level its owner gives it.
  const h = new Harness({}, 1, 60, { dev: true, config: r });
  const curve = (reg: typeof h.reg) => (reg.defs[reg.index.get("core:parasaur")!] as SpeciesDef).stats!.health!;
  expect(near(curve(h.world.reg)[2] / curve(h.reg)[2])).toBe(2.125);
  // A value set at the console afterwards does not get the factor again.
  expect([h.host.setSetting("TamingSpeedMultiplier", "3"), h.host.rules.num("TamingSpeedMultiplier")]).toEqual(["", 3]);
  expect(loadConfig({ gus: "[ServerSettings]\nTamingSpeedMultiplier=2\n" }).rules.num("TamingSpeedMultiplier")).toBe(2);
});

test("the single-player factors are not on top of the live file: what it gives is that value at the start and at every reading after", () => {
  const game = "[/script/shootergame.shootergamemode]\nbUseSingleplayerSettings=True\nEggHatchSpeedMultiplier=2\nBabyMatureSpeedMultiplier=2\n";
  const live = "EggHatchSpeedMultiplier=8\n";
  const { rules } = loadConfig({ game, live }, ["-UseDynamicConfig"]);
  // Growing up is 35 times the file's 2. Hatching is the live file's 8, not 9 times it.
  expect([rules.num("BabyMatureSpeedMultiplier"), rules.num("EggHatchSpeedMultiplier")]).toEqual([70, 8]);
  applyLive(rules, live, emptyReport());
  expect([rules.num("BabyMatureSpeedMultiplier"), rules.num("EggHatchSpeedMultiplier")]).toEqual([70, 8]);
  // Without the live file the factor is on the file's value.
  expect(loadConfig({ game, live }).rules.num("EggHatchSpeedMultiplier")).toBe(18);
});
