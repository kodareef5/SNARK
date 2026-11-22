// Where a map's drops land when nobody has said (shared/supply/sites.ts, content/supply/sites.ts), the five cities'
// starter sites, and ARK's own override of what a crate holds (server/supply/ark.ts).

import { expect, test } from "bun:test";
import { CITY_SITES } from "../../content/supply/city-sites.ts";
import { BANDS, OPEN, withSites } from "../../content/supply/sites.ts";
import { starterBook } from "../../content/supply/starter.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Lists } from "../../server/settings/lists.ts";
import { SETTING, arkCrates, crateTier } from "../../server/supply/ark.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { rollLoot } from "../../shared/sim/loot.ts";
import { bookFaults } from "../../shared/supply/book.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { SITE_SPACING, bandsOf, findSites } from "../../shared/supply/sites.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const CITIES = ["core:miami", "core:tampa", "core:san-francisco", "core:los-angeles", "core:las-vegas"];
const SIDE = 255 * CHUNK_SIZE;

test("the site rule finds one place to a square, never two near each other, the same for the same seed, and says why it turned places down", () => {
  // A map of 4.2 km with its west third under water and a forest across its north.
  const probe = { sizeX: 4200, sizeZ: 4200, spawns: [{ x: 2000, z: 100 }, { x: 4100, z: 2000 }], fault: (x: number, z: number): string => (x < 1400 ? "water" : z > 3600 ? "growth" : "") };
  const { sites, faults } = findSites(probe, 7);
  // Ten squares a side: those wholly under water or forest have none, those the shore or the trees' edge cross have one where a try fell dry.
  expect([sites.length > 50, sites.length <= 70, faults.water! > 300, faults.growth! > 50, Object.keys(faults).sort()]).toEqual([true, true, true, true, ["growth", "water"]]);
  for (const s of sites) expect([Number.isInteger(s.x), Number.isInteger(s.z), s.x >= 1400, s.z <= 3600, s.far === Math.min(Math.hypot(2000 - s.x, 100 - s.z), Math.hypot(4100 - s.x, 2000 - s.z))]).toEqual([true, true, true, true, true]);
  let nearest = Infinity;
  for (const a of sites) for (const b of sites) if (a !== b) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.z - b.z));
  expect(nearest).toBeGreaterThanOrEqual(0.4 * SITE_SPACING - 2);
  expect([findSites(probe, 7).sites, findSites(probe, 8).sites.length > 50]).toEqual([sites, true]);
  expect(findSites(probe, 8).sites).not.toEqual(sites);
  // In bands, nearest the spawns first, by the shares given; the last takes what is left.
  const bands = bandsOf(sites, [0.4, 0.35, 0.25]);
  expect([bands.map((b) => b.length).reduce((a, b) => a + b, 0), bands[0]!.length, bands[1]!.length]).toEqual([sites.length, Math.round(sites.length * 0.4), Math.round(sites.length * 0.35)]);
  expect([Math.max(...bands[0]!.map((s) => s.far)) <= Math.min(...bands[1]!.map((s) => s.far)), Math.max(...bands[1]!.map((s) => s.far)) <= Math.min(...bands[2]!.map((s) => s.far))]).toEqual([true, true]);
  expect(findSites({ ...probe, fault: () => "edge" }, 7)).toEqual({ sites: [], faults: { edge: 1000 } });
});

test("the starter bands: the nearer ground gets the lower tiers and gets them oftener, and between them they keep the book's limit", () => {
  const book = starterBook();
  const order = book.tiers.map((t) => t.key);
  expect([BANDS.map((b) => b.key), BANDS.reduce((n, b) => n + b.share, 0), BANDS.reduce((n, b) => n + b.maxLive, 0)]).toEqual([["shore", "inland", "deep"], 1, book.rules.maxLive]);
  // Each band's lowest and highest tier are no lower than the band before's, and it waits no less between drops.
  const span = BANDS.map((b) => Object.keys(b.tierWeights).map((k) => order.indexOf(k)).sort((x, y) => x - y));
  for (const s of span) expect(s.every((k) => k >= 0)).toBe(true);
  for (let k = 1; k < BANDS.length; k++) {
    expect([span[k]![0]! >= span[k - 1]![0]!, span[k]![span[k]!.length - 1]! >= span[k - 1]![span[k - 1]!.length - 1]!, BANDS[k]!.interval[0] >= BANDS[k - 1]!.interval[0]]).toEqual([true, true, true]);
  }
  expect([span[0]![0], span[2]![span[2]!.length - 1], Object.keys(OPEN.tierWeights)]).toEqual([0, order.length - 1, order]);
});

test("each of the five cities has its starter sites, in three bands, on its map and apart, and the book with them is sound; a map with none has the open circuit", () => {
  expect(Object.keys(CITY_SITES).sort()).toEqual([...CITIES].sort());
  for (const city of CITIES) {
    const book = withSites(starterBook(), city);
    expect([city, bookFaults(book).filter((f) => !f.warn)]).toEqual([city, []]);
    expect([book.circuits.map((c) => c.key), book.sites.length >= 800, book.sites.length <= 1500]).toEqual([["shore", "inland", "deep"], true, true]);
    // Every site is some circuit's, and only one's.
    const named = book.circuits.flatMap((c) => c.sites);
    expect([named.length, new Set(named).size, new Set(book.sites.map((s) => s.key)).size]).toEqual([book.sites.length, book.sites.length, book.sites.length]);
    expect(book.circuits.map((c) => Math.round((c.sites.length / book.sites.length) * 100))).toEqual([40, 35, 25]);
    // On the map, to the whole metre, and never two in one square's reach of each other.
    const cells = new Map<string, { x: number; z: number }[]>();
    for (const s of book.sites) {
      expect([Number.isInteger(s.x) && Number.isInteger(s.z), s.x > 16 && s.z > 16 && s.x < SIDE - 16 && s.z < SIDE - 16]).toEqual([true, true]);
      const key = `${Math.floor(s.x / SITE_SPACING)},${Math.floor(s.z / SITE_SPACING)}`;
      cells.set(key, [...(cells.get(key) ?? []), s]);
    }
    expect([...cells.values()].every((list) => list.length === 1)).toBe(true);
  }
  const elsewhere = withSites(starterBook(), "test:flat");
  expect([elsewhere.sites, elsewhere.circuits, bookFaults(elsewhere).filter((f) => !f.warn)]).toEqual([[], [OPEN], []]);
  // Each caller's copy is its own.
  elsewhere.circuits[0]!.maxLive = 1;
  expect(OPEN.maxLive).toBe(8);
});

test("a crate of ARK's is the tier whose level its own reaches, and its _Double the ringed drops; a crate that is no supply drop is none", () => {
  const tiers = starterBook().tiers;
  const of = (name: string) => {
    const c = crateTier(name, tiers);
    return c ? `${c.tier.key}${c.ringed ? " ringed" : ""}` : null;
  };
  expect(["SupplyCrate_Level03_C", "SupplyCrate_Level03_Double_C", "SupplyCrate_Level15_C", "SupplyCrate_Level25_C", "SupplyCrate_Level35_Double_C", "SupplyCrate_Level45_C", "SupplyCrate_Level60_C", "supplycrate_level60_double_c"].map(of)).toEqual([
    "white", "white ringed", "green", "blue", "purple ringed", "yellow", "red", "red ringed",
  ]);
  // Scorched Earth's and Aberration's levels fall to the tier under them; one under every tier is the lowest.
  expect(["SupplyCrate_Level30_ScorchedEarth_C", "SupplyCrate_Level55_Double_ScorchedEarth_C", "SupplyCrate_Level70_ScorchedEarth_C", "SupplyCrate_Level80_Aberrant_C", "SupplyCrate_Level10_Aberrant_Double_C", "SupplyCrate_Level01_C"].map(of)).toEqual([
    "blue", "yellow ringed", "red", "meridian", "white ringed", "white",
  ]);
  expect(["SupplyCrate_Cave_QualityTier1_C", "SupplyCrate_OceanInstant_C", "ArtifactCrate_1_C", "", "SupplyCrate_Level_C"].map(of)).toEqual([null, null, null, null, null]);
});

test("ARK's override is read into a table to a tier as ARK rolls one, and what it names that is not here is told and left out", () => {
  const { rules, report } = loadConfig({
    game: [
      "[/script/shootergame.shootergamemode]",
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level03_C",MinItemSets=1,MaxItemSets=2,NumItemSetsPower=2.0,bSetsRandomWithoutReplacement=true,ItemSets=((MinNumItems=2,MaxNumItems=2,NumItemsPower=1.0,SetWeight=3.0,bItemsRandomWithoutReplacement=true,ItemEntries=((EntryWeight=1.0,ItemClassStrings=("core:bow","core:crossbow"),ItemsWeights=(3.0,1.0),MinQuantity=1.0,MaxQuantity=1.0,MinQuality=2.5,MaxQuality=4.0,bForceBlueprint=false,ChanceToBeBlueprintOverride=0.25),(EntryWeight=2.0,ItemClassStrings=("core:arrow_stone"),ItemsWeights=(1.0),MinQuantity=20.0,MaxQuantity=40.0,MinQuality=0.0,MaxQuality=0.0,bForceBlueprint=false))),(MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:pistol"),MinQuantity=1,MaxQuantity=1,bForceBlueprint=true),(ItemClassStrings=("PrimalItem_WeaponNoSuchThing_C"),MinQuantity=1,MaxQuantity=1)))))',
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level25_Double_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:stone"),MinQuantity=50,MaxQuantity=50)))))',
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Cave_QualityTier1_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:stone"),MinQuantity=1,MaxQuantity=1)))))',
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level60_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("PrimalItem_Nothing_C"),MinQuantity=1,MaxQuantity=1)))))',
    ].join("\n"),
  });
  expect([report.refused, report.unknown]).toEqual([[], []]);
  const lists = new Lists(rules, reg);
  const loot = catalogOf(reg);
  const made = arkCrates(rules.list(SETTING), starterBook().tiers, (name) => lists.ids(SETTING, name, "item"), (id) => loot.byId.get(id)?.never !== true);
  expect([...made.tables.keys()]).toEqual(["white", "blue"]);
  const white = made.tables.get("white")!;
  expect([white.ringed, made.tables.get("blue")!.plain]).toEqual([undefined, undefined]);
  expect(white.plain).toEqual({
    type: "loot",
    id: "ark:white",
    sets: { min: 1, max: 2, power: 2 },
    from: [
      {
        min: 2,
        max: 2,
        weight: 3,
        entries: [
          { items: ["core:bow", "core:crossbow"], weights: [3, 1], min: 1, max: 1, quality: [2.5, 4], blueprint: 0.25 },
          { items: ["core:arrow_stone"], weight: 2, min: 20, max: 40, quality: [0, 0] },
        ],
      },
      // ARK draws with replacement where it is not told otherwise. The thing this build lacks is left out of its set.
      { min: 1, max: 1, replace: true, entries: [{ items: ["core:pistol"], min: 1, max: 1, forceBlueprint: true }] },
    ],
  });
  expect(made.passed).toEqual([
    `${SETTING}: 1 of the things "SupplyCrate_Level03_C" names are not in this build, and are left out of the white drops`,
    `${SETTING}: "SupplyCrate_Cave_QualityTier1_C" is no supply drop's crate here (a tier's is SupplyCrate_Level<its level>_C, and _Double for a ringed one)`,
    `${SETTING}: 1 of the things "SupplyCrate_Level60_C" names are not in this build, and are left out of the red drops`,
    `${SETTING}: "SupplyCrate_Level60_C" names nothing this build has, so the red drops are the drop book's`,
  ]);
  expect(lists.missing.map((m) => m.name)).toEqual(["PrimalItem_WeaponNoSuchThing_C", "PrimalItem_Nothing_C"]);
  // It rolls: one or two sets, the first of them a bow or a crossbow of quality and arrows.
  const index = (id: string): number => loot.byId.get(id)?.index ?? 0;
  const seen = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const drops = rollLoot(white.plain!, new Rng(seed), index, loot.blueprints);
    expect(drops.length >= 1 && drops.length <= 3).toBe(true);
    for (const d of drops) seen.add(`${reg.ids[d.item]!.slice(5)}${d.blueprint ? " blueprint" : ""}`);
  }
  expect([...seen].sort()).toEqual(["arrow_stone", "bow", "bow blueprint", "crossbow", "crossbow blueprint", "pistol blueprint"]);
});
