// The settings a server once read only at its start, changed while it runs: a body's rates, the clock's pace, the
// server's options and sizes, and the spawn regions. What is already made is left as it is.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { createHost, type Host } from "../../server/host.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { REJECT_FULL, REJECT_PASSWORD } from "../../shared/net/protocol.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { V_FOOD, V_WATER } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
/** `gus` is GameUserSettings.ini whole, its section headers too. */
const rulesOf = (gus = "", argv: string[] = []) => {
  const made = loadConfig({ gus }, argv);
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
};

function served(names: string[] = ["ada"], gus = "") {
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf(gus) });
  const sessions = names.map((name) => h.join(name));
  h.run(500);
  const set = (name: string, words: string): string => {
    const why = h.host.setSetting(name, words);
    h.run(300);
    return why;
  };
  return { h, sessions, set };
}

test("a body already in the world hungers and thirsts at its setting's new rate at once", () => {
  const { h, sessions, set } = served();
  const me = h.host.records.byPid.get(h.client(sessions[0]!)!.pid)!;
  const [food, water] = [me.vitals!.rate[V_FOOD]!, me.vitals!.rate[V_WATER]!];
  expect(food).toBeLessThan(0);
  expect(set("PlayerCharacterFoodDrainMultiplier", "3")).toBe("");
  // A rate is kept as a whole number of millionths a tick, so a multiple of one is off by the rounding at most.
  const about = (is: number, want: number): boolean => Math.abs(is - want) <= 2;
  expect([about(me.vitals!.rate[V_FOOD]!, 3 * food), me.vitals!.rate[V_WATER]]).toEqual([true, water]);
  expect(set("PlayerCharacterWaterDrainMultiplier", "0.5")).toBe("");
  expect([about(me.vitals!.rate[V_FOOD]!, 3 * food), about(me.vitals!.rate[V_WATER]!, water / 2)]).toEqual([true, true]);
  for (const name of ["PlayerCharacterHealthRecoveryMultiplier", "DinoCharacterFoodDrainMultiplier", "DinoCharacterHealthRecoveryMultiplier", "WildDinoCharacterFoodDrainMultiplier", "TamedDinoCharacterFoodDrainMultiplier", "WildDinoTorporDrainMultiplier", "TamedDinoTorporDrainMultiplier", "OxygenSwimSpeedStatMultiplier", "ResourcesRespawnPeriodMultiplier"]) expect([name, set(name, "2")]).toEqual([name, ""]);
  expect(h.host.creatures.swimGain).toBe(2);
  h.host.shutdown();
});

test("the clock's pace changes while the server runs and the hour of day is kept, on the server and on every page", () => {
  const { h, sessions, set } = served();
  const ada = sessions[0]!;
  const hour = (): number => hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock);
  const theirs = (): number => hourOfDay(h.world.tick, ada.dayOffset, ada.clock);
  const before = hour();
  expect(set("DayCycleSpeedScale", "8")).toBe("");
  // Ten seconds have passed since, at eight times the pace: under a quarter of an hour of the day.
  expect(hour() - before).toBeGreaterThan(0);
  expect(hour() - before).toBeLessThan(0.3);
  expect([h.world.clock.cycle, ada.clock.cycle, theirs()]).toEqual([8, 8, hour()]);
  expect(set("NightTimeSpeedScale", "3")).toBe("");
  expect(set("DayTimeSpeedScale", "0.5")).toBe("");
  expect([ada.clock.day, ada.clock.night, Math.abs(theirs() - hour()) < 1e-9]).toEqual([0.5, 3, true]);
  h.host.shutdown();
});

test("the server's password, seats and sizes follow their settings while it runs, and fewer seats put nobody out", () => {
  const { h, sessions, set } = served(["ada", "bob"], "[/Script/Engine.GameSession]\nMaxPlayers=2\n");
  const joined = (name: string, password?: string): ClientSession => {
    const s = h.join(name, {}, password === undefined ? {} : { password });
    h.run(800);
    return s;
  };
  expect(h.host.game.clients.length).toBe(2);
  // Full: a third is turned away. With a seat more it is let in, and the map's marks have room for it.
  expect([joined("cy").state, joined("cy2").closeReason]).toEqual(["closed", REJECT_FULL]);
  expect(set("MaxPlayers", "3")).toBe("");
  const cy = joined("cy3");
  expect([cy.state, h.host.game.clients.length, h.world.ents.reserve]).toEqual(["active", 3, 3]);
  h.run(3000);
  // Fewer seats: the three stay, and nobody new comes in.
  expect(set("MaxPlayers", "1")).toBe("");
  expect([sessions[0]!.state, sessions[1]!.state, cy.state, h.host.game.playerCount]).toEqual(["active", "active", "active", 3]);
  expect(joined("dee").closeReason).toBe(REJECT_FULL);
  expect(set("MaxPlayers", "4")).toBe("");

  // A password set now is asked of whoever joins next.
  expect(set("ServerPassword", "opensesame")).toBe("");
  expect(joined("eve").closeReason).toBe(REJECT_PASSWORD);
  expect(joined("eve2", "opensesame").state).toBe("active");

  for (const [name, words] of [["Duration", "45"], ["ViewCap", "128"], ["SnapshotBytesMax", "900"], ["PendingPerAddress", "3"], ["AutoSavePeriodMinutes", "5"], ["SessionName", "Tuned"], ["Message", "Hello"], ["DifficultyOffset", "0.5"], ["OverrideOfficialDifficulty", "3"], ["CastModelKey", "none"]] as const) expect([name, set(name, words)]).toEqual([name, ""]);
  const o = h.host.game.opts;
  expect([o.motdSeconds, o.viewCap, o.snapshotBytesMax, o.pendingPerAddress]).toEqual([45, 128, 900, 3]);

  // The world holds no more bodies than MaxEntities, once it is lowered to what it holds; raised, it takes them again.
  const here = h.world.spawn;
  expect(set("MaxEntities", "4096")).toBe("");
  expect(h.world.ents.max).toBe(4096);
  // The setting's least is far above this little world, so the store is told the rest of the way down.
  h.world.ents.setMax(h.world.ents.count + h.world.ents.reserve);
  const refused = h.world.ents.refused;
  expect(h.host.spawnCreature("core:dodo", here.x + 6, here.z + 6, 1, "admin")).toBeLessThan(0);
  expect(h.world.ents.refused).toBe(refused + 1);
  expect(set("MaxEntities", "524288")).toBe("");
  expect(h.world.ents.max).toBe(524288);
  expect(h.host.spawnCreature("core:dodo", here.x + 6, here.z + 6, 1, "admin")).toBeGreaterThanOrEqual(0);
  for (const s of [sessions[0]!, sessions[1]!, cy]) expect(s.state).toBe("active");
  h.host.shutdown();
});

test("the spawn regions take their count and their tables again, and a -NoDinos flag set while the server runs keeps the wild out", () => {
  const ticks = (host: Host, n: number): void => {
    for (let i = 0; i < n; i++) host.game.tick();
  };
  const wild = (host: Host): number => [...host.records.byPid.values()].filter((r) => r.team === 0 && host.world.reg.defs[r.kind]?.type === "species" && r.at < 0 && r.egg === null).length;
  const host = createHost(reg, { wild: true, config: rulesOf() });
  ticks(host, 120);
  const spawner = host.spawner!;
  const desired = spawner.regions.map((r) => r.desired);
  const filled = wild(host);
  expect(filled).toBeGreaterThan(8);

  // Twice the count: each region wants twice as many, and fills to it at its checks.
  expect(host.setSetting("DinoCountMultiplier", "2")).toBe("");
  ticks(host, 60 * TICK_RATE);
  expect(spawner.regions.map((r) => r.desired)).toEqual(desired.map((n) => 2 * n));
  expect(wild(host)).toBeGreaterThan(filled);
  // Fewer: those alive are left, and no more are made.
  const many = wild(host);
  expect(host.setSetting("DinoCountMultiplier", "0.25")).toBe("");
  ticks(host, 60 * TICK_RATE);
  expect(wild(host)).toBe(many);

  // A species replaced by none is made no more; those alive stay counted in their regions.
  expect(host.pageSetting("NPCReplacements", '(FromClassName="core:dodo",ToClassName="")').why).toBe("");
  ticks(host, 5);
  const dodo = host.world.reg.index.get("core:dodo")!;
  expect(spawner.regions.some((r) => r.makes.has(dodo))).toBe(false);
  expect(host.pageSetting("NPCReplacements", null).why).toBe("");
  expect(host.setSetting("DinoCountMultiplier", "1")).toBe("");
  ticks(host, 5);
  expect([spawner.regions.some((r) => r.makes.has(dodo)), spawner.regions.map((r) => r.desired)]).toEqual([true, desired]);

  // The flag keeps the wild out from now on: destroyed, they do not come back until it is taken away.
  expect(host.pageSetting("-NoDinos", "True").why).toBe("");
  ticks(host, 5);
  expect(spawner.quiet).toBe(true);
  spawner.wipe();
  ticks(host, 120 * TICK_RATE);
  expect(wild(host)).toBe(0);
  expect(host.pageSetting("-NoDinos", null).why).toBe("");
  ticks(host, 120 * TICK_RATE);
  expect([spawner.quiet, wild(host) > 8]).toEqual([false, true]);
  for (const flag of ["-NoDinosExceptForcedSpawn", "-NoDinosExceptStreamingSpawn", "-NoDinosExceptManualSpawn", "-NoDinosExceptWaterSpawn", "-EnableIdlePlayerKick", "-AutoDestroyStructures", "-UseDynamicConfig"]) expect([flag, host.pageSetting(flag, "True").why]).toEqual([flag, ""]);
  ticks(host, 5);
  expect(spawner.quiet).toBe(true);
  for (const list of ["DinoSpawnWeightMultipliers", "ConfigAddNPCSpawnEntriesContainer", "ConfigSubtractNPCSpawnEntriesContainer", "ConfigOverrideNPCSpawnEntriesContainer", "ConfigOverrideSupplyCrateItems", "PreventDinoTameClassNames", "PreventBreedingForClassNames"]) expect([list, host.pageSetting(list, "").why]).toEqual([list, ""]);
  for (const name of ["PreventUploadSurvivors", "PreventDownloadSurvivors", "PreventUploadItems", "PreventDownloadItems", "noTributeDownloads"]) expect([name, host.setSetting(name, "True")]).toEqual([name, ""]);
  ticks(host, 5);
  host.shutdown();
});
