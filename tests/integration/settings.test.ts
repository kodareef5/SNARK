// A server configured as ARK's is: its two files, the command line, the live
// file and the console, and what is said of everything that was read.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OP_ADMIN } from "../../server/console.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { applyLive, emptyReport, formatReport, loadConfig, loadConfigFolder } from "../../server/settings/config.ts";
import { timersOf } from "../../server/settings/rules.ts";
import { Harness } from "../fixtures/net.ts";

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

/** The number of the first line of `text` that begins with `start`, as a place in `file`. */
const at = (file: string, text: string, start: string, nth = 0): string => `${file}:${text.split("\n").flatMap((l, i) => (l.startsWith(start) ? [i + 1] : []))[nth]}`;
const gusAt = (start: string, nth = 0): string => at("GameUserSettings.ini", GUS, start, nth);
const gameAt = (start: string, nth = 0): string => at("Game.ini", GAME, start, nth);

test("the two files are read as ARK's are: each key in its own section of its own file, and everything said of: applied, not yet, no use, unknown, refused", () => {
  const { rules, report } = loadConfig({ gus: GUS, game: GAME });
  // What takes effect has the values the files gave, whatever the case of the key.
  expect([rules.num("TamingSpeedMultiplier"), rules.on("ProximityChat"), rules.num("EggHatchSpeedMultiplier"), rules.num("MatingIntervalMultiplier")]).toEqual([3, false, 25, 0.1]);
  expect(report.applied.map((a) => [a.row.name, a.where])).toEqual([
    ["TamingSpeedMultiplier", gusAt("TamingSpeedMultiplier=3")],
    ["XPMultiplier", gusAt("xpmultiplier")],
    ["serverPVE", gusAt("serverPVE")],
    ["ServerAdminPassword", gusAt("ServerAdminPassword")],
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
  // What is not effective yet, or waits for a feature, is read and checked all the same, and holds its value for when it is.
  expect([rules.num("XPMultiplier"), rules.on("serverPVE"), rules.text("ServerAdminPassword"), rules.num("DinoCountMultiplier"), rules.num("MaxTamedDinos"), rules.text("SessionName"), rules.num("Port"), rules.text("Message"), rules.num("Duration"), rules.num("MaxPlayers"), rules.num("BabyCuddleIntervalMultiplier")]).toEqual([2.5, true, "hunter2", 2, 5000, "The Proving Ground", 9000, "Welcome\\nBe kind", 30, 40, 0.1]);
  expect(report.waiting.map((w) => w.row.name)).toEqual(["DinoCountMultiplier", "BabyCuddleIntervalMultiplier"]);
  expect(report.nothing.map((x) => x.row.name)).toEqual(["ActiveMods"]);
  // An indexed setting changes at its index and nowhere else; a list is its lines in order.
  expect(rules.indexed("PerLevelStatsMultiplier_DinoTamed")).toEqual([0.4, 1, 1, 1, 1, 1, 1, 1, 0.17, 1, 1, 1]);
  expect([rules.numbers("OverridePlayerLevelEngramPoints"), rules.list("PreventDinoTameClassNames"), rules.list("OverrideNamedEngramEntries").length]).toEqual([[8, 12], ["core:raptor", "core:parasaur"], 1]);
  // A key the catalogue does not know; a section that is not ARK's, said once; ARK's client settings, not said at all.
  expect(report.unknown).toEqual([{ key: "Gravity", where: gusAt("Gravity") }, { key: "[SomeMod]", where: gusAt("Knob") }]);
  // What will not do, with where it was written and why. A key in the wrong file is one of them: ARK would ignore it without a word.
  expect(report.refused.map((r) => [r.key, r.where, r.why])).toEqual([
    ["TamingSpeedMultiplier", gusAt("TamingSpeedMultiplier=fast"), 'wants a number, got "fast"'],
    ["EggHatchSpeedMultiplier", gusAt("EggHatch"), "belongs in Game.ini [/script/shootergame.shootergamemode]"],
    ["", gameAt("this line"), "not a Key=Value line"],
    ["PerLevelStatsMultiplier_DinoTamed", gameAt("PerLevelStatsMultiplier_DinoTamed[99]"), "has no index 99"],
    ["PerLevelStatsMultiplier_Player", gameAt("PerLevelStatsMultiplier_Player"), "wants an index: Key[n]=value"],
    ["BabyMatureSpeedMultiplier", gameAt("BabyMature"), "wants a number from 0.001 to 100000, got 0"],
    ["TamingSpeedMultiplier", gameAt("TamingSpeed"), "belongs in GameUserSettings.ini [ServerSettings]"],
  ]);
  // The report, as whoever starts the server reads it. A password is never shown.
  const lines = formatReport(report, rules);
  expect(lines[0]).toBe("settings: 16 applied, 2 not yet effective, 1 of no meaning here, 2 unknown, 7 refused");
  expect(lines).toContain(`  applied   ServerAdminPassword=****  (${gusAt("ServerAdminPassword")})`);
  expect(lines).toContain(`  applied   TamingSpeedMultiplier=3  (${gusAt("TamingSpeedMultiplier=3")})`);
  expect(lines).toContain(`  not yet   DinoCountMultiplier  (${gusAt("DinoCount")}): waits for: wild creatures that spawn and respawn by region`);
  expect(lines).toContain(`  no use    ActiveMods  (${gusAt("ActiveMods")}): ARK's mods`);
  expect(lines).toContain(`  unknown   Gravity  (${gusAt("Gravity")})`);
  expect(lines).toContain(`  refused   a line  (${gameAt("this line")}): not a Key=Value line`);
  expect(lines.join("\n")).not.toContain("hunter2");
});

test("each source is stronger than the one before it: default, files, command line, live file, console", () => {
  const gus = "[ServerSettings]\nTamingSpeedMultiplier=3\nglobalVoiceChat=True\nPvEStructureDecayPeriodMultiplier=2\n";
  const game = "[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=4\nPreventDinoTameClassNames=\"core:raptor\"\n";
  // ARK's forms on the command line: `Map?Key=Value?Key=Value`, `-Flag`, `-Flag=value`. Ours, with two dashes, are handed back.
  const argv = ["--dev", "TheIsland?TamingSpeedMultiplier=5?StructureResistanceMultiplier=0.5?EggHatchSpeedMultiplier=9?Nonsense=1", "-UseDynamicConfig", "-port=9100", "-NoBattlEye", "-Bogus", "--port", "8800", "--db", "var/x.db"];
  const live = "TamingSpeedMultiplier=8\nEggHatchSpeedMultiplier=2.0\nServerPassword=nope\nPreventDinoTameClassNames=\"core:parasaur\"\n";
  const { rules, report, ours } = loadConfig({ gus, game, live }, argv);
  expect(ours).toEqual(["--dev", "--port", "8800", "--db", "var/x.db"]);
  // The live file beat the command line, which beat the file; what only the file gave is the file's.
  expect([rules.num("TamingSpeedMultiplier"), rules.num("StructureResistanceMultiplier"), rules.num("EggHatchSpeedMultiplier"), rules.on("globalVoiceChat"), rules.num("PvEStructureDecayPeriodMultiplier")]).toEqual([8, 0.5, 2, true, 2]);
  expect(["TamingSpeedMultiplier", "StructureResistanceMultiplier", "EggHatchSpeedMultiplier", "globalVoiceChat", "XPMultiplier"].map((n) => rules.sourceOf(rowOf(n)!))).toEqual(["live file", "command line", "live file", "file", "default"]);
  expect([rules.flag("UseDynamicConfig"), rules.flag("port"), rules.flag("NoDinos"), rules.flag("NoBattlEye")]).toEqual([true, "9100", false, true]);
  // The command line cannot give a Game.ini setting; the live file cannot give one that is read at start, nor a list that is.
  const why = (key: string): string[] => report.refused.filter((r) => r.key === key).map((r) => `${r.where}: ${r.why}`);
  expect(why("EggHatchSpeedMultiplier")).toEqual(["command line: is a Game.ini setting, which the command line cannot give"]);
  expect(why("PreventDinoTameClassNames")).toEqual(["DynamicConfig.ini:4: is read at start only"]);
  expect(rules.list("PreventDinoTameClassNames")).toEqual(["core:raptor"]);
  expect(report.unknown.map((u) => u.key)).toEqual(["?Nonsense", "-Bogus"]);
  expect(why("ServerPassword")).toEqual(["DynamicConfig.ini:3: is read at start only"]);
  // Without the flag the live file is not read at all.
  expect(loadConfig({ gus, game, live }, []).rules.num("TamingSpeedMultiplier")).toBe(3);
  // The console is stronger than all of them, and a later read of the live file does not take it back.
  expect(rules.assign("TamingSpeedMultiplier", "20", "console")).toBe("");
  applyLive(rules, "TamingSpeedMultiplier=8\n", emptyReport());
  expect([rules.num("TamingSpeedMultiplier"), rules.sourceOf(rowOf("TamingSpeedMultiplier")!)]).toEqual([20, "console"]);
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
  // The console: every setting not at its default and where it came from; one setting, what it is and does; and a new value for one that may change.
  expect(h.say(ada, "settings")).toEqual(["TamingSpeedMultiplier=7  (command line)", "StructureResistanceMultiplier=2  (file)", "EggHatchSpeedMultiplier=40  (file)", "BabyMatureSpeedMultiplier=200  (file)"]);
  expect(h.say(ada, "setting eggHatchSpeedMultiplier")).toEqual(["EggHatchSpeedMultiplier=40  (file; may be changed while the server runs)", "How fast an egg hatches, or young are carried. Higher is faster."]);
  expect(h.say(ada, "setting EggHatchSpeedMultiplier 80")).toEqual(["EggHatchSpeedMultiplier=80  (until the server is started again)"]);
  expect(h.say(ada, "setting EggHatchSpeedMultiplier 0")[0]).toMatch(/wants a number from 0.001/);
  expect(h.say(ada, "setting DinoCountMultiplier 2")).toEqual(["DinoCountMultiplier does not take effect yet"]);
  expect(h.say(ada, "setting DinoCountMultiplier")[0]).toBe("DinoCountMultiplier=1  (default; waits for: wild creatures that spawn and respawn by region)");
  expect(h.say(ada, "setting Gravity 2")).toEqual(["there is no setting called Gravity"]);
  // A password is read when the server starts and cannot be set here; trying says so, and what was typed is not kept.
  expect(h.say(ada, "setting ServerAdminPassword hunter2")[0]).toMatch(/ServerAdminPassword does not take effect yet|read when the server starts/);
  expect(h.host.rules.num("EggHatchSpeedMultiplier")).toBe(80);
  // Only an admin may: Bob, who is not one, is refused.
  const bob = h.join("bob");
  h.run(500);
  expect(h.say(bob, "setting EggHatchSpeedMultiplier 1")[0]).toMatch(/cheats|admin/i);
  h.run(500);
  h.host.shutdown();
  // What admins did is in the journal, as they typed it, but for the password.
  const store = new WorldStore(dbPath, h.reg);
  const typed = store.journal().filter((j) => j.op === OP_ADMIN).map((j) => new TextDecoder().decode(j.data));
  store.close();
  expect(typed).toContain("ada\tsetting EggHatchSpeedMultiplier 80");
  expect(typed).toContain("ada\tsetting ServerAdminPassword ****");
  expect(typed.join("\n")).not.toContain("hunter2");

  // Started again on the folder alone: the folder's values, not the command line's and not the console's.
  const again = loadConfigFolder(folder);
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: again.rules });
  expect([h.host.rules.num("TamingSpeedMultiplier"), h.host.rules.num("EggHatchSpeedMultiplier")]).toEqual([6, 40]);
  // What the world remembers is what its timers were last worked out under, so that they can be re-timed: here, the console's 80.
  expect(h.host.loadedUnder).toMatchObject({ EggHatchSpeedMultiplier: 80, BabyMatureSpeedMultiplier: 200, MatingIntervalMultiplier: 1 });
  h.host.shutdown();
  // A save from before this was kept said the same of three of them under their old names.
  expect(timersOf(null, '{"hatchSpeed":50,"matureSpeed":300,"matingInterval":0.002,"playerDamage":1}')).toEqual({ EggHatchSpeedMultiplier: 50, BabyMatureSpeedMultiplier: 300, MatingIntervalMultiplier: 0.002 });
  expect([timersOf(null, null), timersOf("not json", null), timersOf('{"timers":{"EggHatchSpeedMultiplier":4,"Bad":"x"}}', '{"hatchSpeed":50}')]).toEqual([null, null, { EggHatchSpeedMultiplier: 4 }]);
});
