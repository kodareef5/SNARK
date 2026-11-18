// Wild levels by ARK's weights, and spawn tables as the server's settings change them.
import { expect, test } from "bun:test";
import { loadConfig } from "../../server/settings/config.ts";
import { Lists } from "../../server/settings/lists.ts";
import { spawnTables } from "../../server/settings/spawns.ts";
import { LEVEL_WEIGHTS, wildStep } from "../../server/spawner.ts";
import { Rng } from "../../shared/rng.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const k = (id: string): number => reg.index.get(id)!;

test("a wild level's step is drawn by ARK's weights: 1 to 5 about 54% of the time, 6 to 12 27%, 13 to 20 13.5%, 21 to 30 5.4%", () => {
  expect(LEVEL_WEIGHTS).toEqual([[1, 5, 1], [6, 12, 0.5], [13, 20, 0.25], [21, 30, 0.1]]);
  const rng = new Rng(9);
  const seen = new Array<number>(31).fill(0);
  const n = 200000;
  for (let i = 0; i < n; i++) seen[wildStep(rng)]!++;
  const share = (lo: number, hi: number): number => seen.slice(lo, hi + 1).reduce((a, b) => a + b, 0) / n;
  expect([seen[0], share(1, 30)]).toEqual([0, 1]);
  expect(share(1, 5)).toBeCloseTo(1 / 1.85, 2);
  expect(share(6, 12)).toBeCloseTo(0.5 / 1.85, 2);
  expect(share(13, 20)).toBeCloseTo(0.25 / 1.85, 2);
  expect(share(21, 30)).toBeCloseTo(0.1 / 1.85, 2);
  // Evenly within a range.
  for (let s = 21; s <= 30; s++) expect(seen[s]! / n).toBeCloseTo(0.1 / 1.85 / 10, 3);
});

function tables(mode: string[]) {
  const { rules, report } = loadConfig({ game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") });
  expect([report.refused, report.unknown]).toEqual([[], []]);
  const lists = new Lists(rules, reg);
  const made = spawnTables(reg, rules, lists);
  const beach = made.tables.get(k("core:spawns_beach"))!;
  return { beach, made, lists, plain: (t = beach) => t.entries.map((e) => [e.kinds.map((kind) => reg.ids[kind]), e.chances, e.weight]) };
}

test("the beach preserves the native species groups, chances, offsets and limits", () => {
  const { beach, plain, made } = tables([]);
  expect(plain()).toEqual([
    [Array(5).fill("core:dodo"), [1, 0.7, 0.6, 0.25, 0.2], 0.425],
    [["core:parasaur", "core:parasaur"], [1, 0.5], 0.125],
    [["core:pteranodon", "core:pteranodon"], [1, 0.5], 0.15],
    [["core:trike", "core:trike"], [1, 0.5], 0.1],
    [["core:carbonemys", "core:carbonemys"], [1, 0.45], 0.14],
  ]);
  const trike = k("core:trike"), jungle = made.tables.get(k("core:spawns_jungle"))!;
  expect(beach.entries.find(e => e.kinds[0] === trike)!.offsets).toEqual([[0, 6.8], [0, -6.8]]);
  expect(jungle.entries.find(e => e.kinds[0] === trike)).toEqual({ kinds: [trike, trike], chances: [1, 0.6], offsets: [[0, 0], [0, 6.8]], weight: 0.075 });
  expect(jungle.limits.get(trike)).toBe(0.15);
  expect(beach.entries[0]!.offsets).toEqual([[0, 6.8], [0, 0], [0, -6.8], [0, -3.4], [0, 3.4]]);
  expect([...beach.limits].map(([kind, share]) => [reg.ids[kind], share])).toEqual([["core:dodo", 0.6], ["core:parasaur", 0.2], ["core:pteranodon", 0.25], ["core:trike", 0.2], ["core:carbonemys", 0.2]]);
});

test("the spawn settings: override, then add, then subtract; one species for another or for none; a species' weight and limit by its tag", () => {
  const { beach, plain, made, lists } = tables([
    'ConfigOverrideNPCSpawnEntriesContainer=(NPCSpawnEntriesContainerClassString="core:spawns_proving_hunters",NPCSpawnEntries=((AnEntryName="Dodos",EntryWeight=1,NPCsToSpawnStrings=("dodo","dodo"),NPCsToSpawnPercentageChance=(1,0.25),NPCsSpawnOffsets=((X=0,Y=0,Z=0),(X=300,Y=-150,Z=0)))),NPCSpawnLimits=((NPCClassString="dodo",MaxPercentageOfDesiredNumToAllow=0.5)))',
    'ConfigAddNPCSpawnEntriesContainer=(NPCSpawnEntriesContainerClassString="spawns_beach",NPCSpawnEntries=((AnEntryName="Raptors",EntryWeight=0.1,NPCsToSpawnStrings=("core:raptor","core:raptor","Allo_Character_BP_C"))),NPCSpawnLimits=((NPCClassString="core:raptor",MaxPercentageOfDesiredNumToAllow=0.1)))',
    'ConfigSubtractNPCSpawnEntriesContainer=(NPCSpawnEntriesContainerClassString="core:spawns_beach",NPCSpawnEntries=((NPCsToSpawnStrings=("core:parasaur"))),NPCSpawnLimits=((NPCClassString="core:parasaur")))',
    'NPCReplacements=(FromClassName="core:raptor",ToClassName="core:grazer")',
    'NPCReplacements=(FromClassName="core:parasaur",ToClassName="")',
    "DinoSpawnWeightMultipliers=(DinoNameTag=Dodo,SpawnWeightMultiplier=2,OverrideSpawnLimitPercentage=True,SpawnLimitPercentage=0.3)",
    "DinoSpawnWeightMultipliers=(DinoNameTag=Allo,SpawnWeightMultiplier=9)",
  ]);
  // The parasaur's entry and limit went from the beach; the raptors came, as grazers, without the allosaur this build lacks.
  expect(plain()).toEqual([
    [Array(5).fill("core:dodo"), [1, 0.7, 0.6, 0.25, 0.2], 0.85],
    [["core:pteranodon", "core:pteranodon"], [1, 0.5], 0.15],
    [["core:trike", "core:trike"], [1, 0.5], 0.1],
    [["core:carbonemys", "core:carbonemys"], [1, 0.45], 0.14],
    [["core:grazer", "core:grazer"], [1, 1], 0.1],
  ]);
  expect([...beach.limits].map(([kind, share]) => [reg.ids[kind], share])).toEqual([["core:dodo", 0.3], ["core:pteranodon", 0.25], ["core:trike", 0.2], ["core:carbonemys", 0.2], ["core:grazer", 0.1]]);
  // The hunters' table is wholly the override's, offsets in metres.
  const hunters = made.tables.get(k("core:spawns_proving_hunters"))!;
  expect(plain(hunters)).toEqual([[["core:dodo", "core:dodo"], [1, 0.25], 2]]);
  expect(hunters.entries[0]!.offsets).toEqual([[0, 0], [3, -1.5]]);
  // The herd was all parasaurs, and none are spawned now.
  expect(made.tables.get(k("core:spawns_proving_herd"))!.entries).toEqual([]);
  expect(lists.missing.map((m) => m.name)).toEqual(["Allo_Character_BP_C"]);
  expect(made.passed).toEqual(['DinoSpawnWeightMultipliers: no creature here has the tag "allo"']);
});
