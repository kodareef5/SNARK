// What a level is worth, and how many levels the wild are found with: ARK's
// per-level stat multipliers, in its order of stats, and its difficulty.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { ARK_STATS, MAP_DIFFICULTY, difficultyOf, wildLevel } from "../../server/settings/tune.ts";
import { STAT_HEALTH, STAT_MELEE, STAT_OXYGEN, STAT_STAMINA, STAT_WEIGHT, statOf } from "../../server/survival.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { STAT_NAMES, TAMED_GAIN } from "../../shared/sim/genome.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

function rulesOf(server: string[] = [], mode: string[] = []) {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") });
  expect([made.report.refused, made.report.unknown, made.report.waiting]).toEqual([[], [], []]);
  return made.rules;
}

/** A server on those settings with ada in it; a wild parasaur and a parasaur of hers, each with ten levels in every stat it can have them in. */
function served(mode: string[] = []) {
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf([], mode) });
  const ada = h.join("ada");
  h.run(500);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const of = (e: number): EntityRecord => h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  const g = flatGround(h, 30, 30);
  const wild = of(h.host.spawnCreature("core:parasaur", g.x + 8, g.z + 15, 1));
  const tame = of(h.host.spawnCreature("core:parasaur", g.x + 22, g.z + 15, 1));
  h.host.taming.give(tame, me, 1);
  for (const s of [STAT_HEALTH, STAT_STAMINA, STAT_OXYGEN, STAT_WEIGHT, STAT_MELEE]) {
    wild.genome!.wild[s] = 10;
    tame.genome!.tamed[s] = 10;
    me.genome!.tamed[s] = 10;
  }
  for (const r of [wild, tame, me]) h.host.refreshBody(r);
  /** A stat of a record as the server has it. */
  const stat = (r: EntityRecord, s: number): number => statOf(h.world.reg.defs[r.kind] as SpeciesDef, r.genome, s, 0);
  return { h, ada, me, wild, tame, stat };
}

test("ARK's order of stats is not this engine's: its indexed settings are matched to ours by name", () => {
  // 0 health, 1 stamina, 2 torpidity, 3 oxygen, 4 food, 5 water, 6 temperature, 7 weight, 8 melee, 9 speed, 10 fortitude, 11 crafting.
  expect(ARK_STATS.map((name) => STAT_NAMES.indexOf(name))).toEqual([0, 1, 8, 2, 3, 4, 11, 5, 6, 7, 9, 10]);
  expect([...ARK_STATS].sort()).toEqual([...STAT_NAMES].sort());
  expect(TAMED_GAIN).toEqual({ health: 0.2, melee: 0.17 });
});

test("what a level is worth is the server's: a wild creature's, a tamed one's and a survivor's, each stat by its own number; and where a survivor's stats begin", () => {
  const plain = served();
  // At ARK's defaults content is as it was written. A parasaur's health begins at 200: ten wild levels add 20% each, ten
  // levels an owner gives 5.4% each (27% times ARK's 0.2); its melee 5% and 1.7% (10% times ARK's 0.17). A survivor's
  // health begins at 100 and gains 10% a level; her weight likewise.
  expect(plain.h.world.reg === plain.h.reg).toBe(true);
  const near = (v: number): number => Math.round(v * 1000) / 1000;
  expect([plain.stat(plain.wild, STAT_HEALTH), plain.stat(plain.tame, STAT_HEALTH), plain.stat(plain.wild, STAT_MELEE), plain.stat(plain.tame, STAT_MELEE), plain.stat(plain.me, STAT_HEALTH), plain.stat(plain.me, STAT_WEIGHT)].map(near)).toEqual([600, 308, 1.5, 1.17, 200, 200]);

  const tuned = served([
    // Twice what an owner's level gives in health (index 0); three times in melee (index 8), which is not this engine's eighth stat.
    "PerLevelStatsMultiplier_DinoTamed[0]=0.4",
    "PerLevelStatsMultiplier_DinoTamed[8]=0.51",
    // Wild levels: half in health, twice in oxygen (index 3).
    "PerLevelStatsMultiplier_DinoWild[0]=0.5",
    "PerLevelStatsMultiplier_DinoWild[3]=2",
    // A survivor's: three times in health, twice in weight (index 7), and stamina (index 1) left to a 0, which ARK reads as 1.
    "PerLevelStatsMultiplier_Player[0]=3",
    "PerLevelStatsMultiplier_Player[7]=2",
    "PerLevelStatsMultiplier_Player[1]=0",
    // Where a survivor's begin: twice the health, half the weight. Melee (index 8) begins at 100% whatever is said: ARK's own default for it is 0.
    "PlayerBaseStatMultipliers[0]=2",
    "PlayerBaseStatMultipliers[7]=0.5",
    "PlayerBaseStatMultipliers[8]=5",
  ]);
  const { stat } = tuned;
  // The plan's own example: `PerLevelStatsMultiplier_DinoTamed[0]=0.4` doubles what a tame's health gains from a level.
  expect(near(stat(tuned.tame, STAT_HEALTH))).toBe(near(200 * (1 + 10 * 0.108)));
  expect(near((stat(tuned.tame, STAT_HEALTH) / 200 - 1) / (plain.stat(plain.tame, STAT_HEALTH) / 200 - 1))).toBe(2);
  expect(near(stat(tuned.tame, STAT_MELEE))).toBe(1.51);
  // A tame's wild levels are not its owner's levels: stamina, which nothing was said of, is as it was.
  expect(stat(tuned.tame, STAT_STAMINA)).toBe(plain.stat(plain.tame, STAT_STAMINA));
  // The wild: health gains half, oxygen twice, melee as it was.
  expect([stat(tuned.wild, STAT_HEALTH), stat(tuned.wild, STAT_OXYGEN) / plain.stat(plain.wild, STAT_OXYGEN), stat(tuned.wild, STAT_MELEE)].map(near)).toEqual([400, near((1 + 10 * 0.2) / (1 + 10 * 0.1)), 1.5]);
  // A survivor: health from 200, 30% a level; weight from 50, 20% a level; stamina as it was; melee as it was. Nothing said of creatures reaches her.
  expect([stat(tuned.me, STAT_HEALTH), stat(tuned.me, STAT_WEIGHT), stat(tuned.me, STAT_STAMINA), stat(tuned.me, STAT_MELEE)].map(near)).toEqual([800, 150, plain.stat(plain.me, STAT_STAMINA), near(plain.stat(plain.me, STAT_MELEE))]);
  // Her body has it: its health is what the stat says.
  expect(near(tuned.me.vitals!.max[V_HEALTH]! / 1e6)).toBe(800);
  // And her client has the same curves, for the sheet it shows them on.
  const hers = (tuned.ada.registry.defs[id("survivor")] as SpeciesDef).stats!;
  const theirs = (tuned.h.world.reg.defs[id("survivor")] as SpeciesDef).stats!;
  expect([hers.health, hers.weight, tuned.ada.registry.hash]).toEqual([theirs.health, theirs.weight, tuned.h.world.reg.hash]);
  expect(hers.health!.map(near)).toEqual([200, 0, 0.3]);

  // A 0 among the per-level multipliers is read as 1, as ARK reads it: for a tame's health that is five times ARK's own 0.2.
  const zero = served(["PerLevelStatsMultiplier_DinoTamed[0]=0"]);
  expect(near(zero.stat(zero.tame, STAT_HEALTH))).toBe(near(200 * (1 + 10 * 0.27)));
  // Said of creatures only, a survivor is as she was.
  expect(zero.stat(zero.me, STAT_HEALTH)).toBe(plain.stat(plain.me, STAT_HEALTH));
});

test("difficulty: what the server says outright, or its offset on the map's own; and the wild are found at one of thirty levels that size", () => {
  // ARK's formula, on a map as hard as its later ones.
  expect(MAP_DIFFICULTY).toBe(5);
  expect([difficultyOf(rulesOf()), difficultyOf(rulesOf(["DifficultyOffset=0.2"])), difficultyOf(rulesOf(["DifficultyOffset=0"])), difficultyOf(rulesOf(["OverrideOfficialDifficulty=3", "DifficultyOffset=0.2"])), difficultyOf(rulesOf(["OverrideOfficialDifficulty=1"]))].map((d) => Math.round(d * 100) / 100)).toEqual([5, 1.4, 0.5, 3, 1]);
  expect([wildLevel(1, 5), wildLevel(30, 5), wildLevel(7, 1.4), wildLevel(1, 0.5), wildLevel(30, 1)]).toEqual([5, 150, 9, 1, 30]);
  /** The levels of sixty creatures a new world begins with. */
  const herd = (server: string[]): number[] => {
    const h = new Harness({}, 1, 60, { config: rulesOf(server), startingCreatures: 60 });
    const out: number[] = [];
    for (const r of h.host.records.byPid.values()) if (r.genome) out.push(r.genome.level);
    return out.sort((a, b) => a - b);
  };
  // With nothing said: fives, from 5 to 150.
  const wild = herd([]);
  expect([wild.length, wild.every((l) => l % 5 === 0 && l >= 5 && l <= 150), wild[59]! > 100, new Set(wild).size > 15]).toEqual([60, true, true, true]);
  // A difficulty of 1: 1 to 30, as it was before difficulty was a setting.
  const easy = herd(["OverrideOfficialDifficulty=1"]);
  expect([easy.every((l) => l >= 1 && l <= 30), easy[59]! > 24, new Set(easy).size > 15]).toEqual([true, true, true]);
  // The same draws, five times the size.
  expect(wild).toEqual(easy.map((l) => l * 5));

  // What is already in the world keeps the level it was found with: a server started again harder finds its creatures as they were.
  const dir = mkdtempSync(join(tmpdir(), "snark-difficulty-"));
  const dbPath = join(dir, "world.db");
  let h = new Harness({}, 1, 60, { dbPath, config: rulesOf(["OverrideOfficialDifficulty=1"]), startingCreatures: 20 });
  const levels = (): number[] => [...h.host.records.byPid.values()].filter((r) => r.genome).map((r) => r.genome!.level).sort((a, b) => a - b);
  const was = levels();
  h.run(500);
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dbPath, config: rulesOf(["OverrideOfficialDifficulty=5"]), startingCreatures: 20 });
  expect([levels(), was.length]).toEqual([was, 20]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
