// The drop book (shared/supply): its checks, the forgiving compile, the roll of a table, worth and the simulator, and
// the file a world keeps it in (server/supply/store.ts).

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookStore } from "../../server/supply/store.ts";
import { Rng } from "../../shared/rng.ts";
import { BOOK_FORMAT, bookFaults, tableKey, type SupplyBook } from "../../shared/supply/book.ts";
import { catalogOf, withFuture } from "../../shared/supply/catalog.ts";
import { cellsOf, compileBook, rollTable } from "../../shared/supply/compile.ts";
import { simulate, stacksOf } from "../../shared/supply/simulate.ts";
import { tierMix } from "../../shared/supply/worth.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const catalog = catalogOf(reg);
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const dir = mkdtempSync(join(tmpdir(), "snark-supply-book-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A small book: two tiers, two classes, and a table for each pair of the same slots. What it waits for are things of
 * ARK's the game has not and has not blocked out: a fishing rod, a harpoon launcher, a lance, a whip, and the raft.
 */
function book(): SupplyBook {
  const b: SupplyBook = {
    format: BOOK_FORMAT,
    map: "",
    revision: 0,
    rules: { noticeSeconds: 240, flightSeconds: 30, brakeSeconds: 7, lifeSeconds: 1200, baseExclusion: 60, maxLive: 12, minPlayers: 1, announce: "none", ringedChance: 0.05, ringedQuality: 1.5, floorShare: 0.4, loot: "shared" },
    worth: { raw: { "core:thatch": 1, "core:wood": 1, "core:stone": 1, "core:flint": 1, "core:fiber": 1, "core:hide": 2, "core:ore": 3 }, items: {} },
    tiers: [
      { key: "white", name: "White", rgb: 0xffffff, level: 3, target: 200, quality: [1, 1.4], staple: "staple.white", floor: "staple.white" },
      { key: "green", name: "Green", rgb: 0x30c060, level: 15, target: 400, quality: [1, 2], staple: "staple.green", floor: "staple.green" },
    ],
    classes: [
      { key: "arms", name: "Arms", mark: 1, fill: "fill.arms" },
      { key: "voyage", name: "Voyage", mark: 6, fill: "fill.voyage", weights: { white: 0.5 } },
    ],
    sets: {
      "staple.white": { all: true, entries: [{ items: ["core:thatch"], min: 8, max: 16 }, { items: ["core:wood"], min: 4, max: 8 }] },
      "staple.green": { all: true, entries: [{ items: ["core:wood"], min: 10, max: 20 }, { items: ["core:stone"], min: 10, max: 20 }] },
      "fill.arms": { all: true, entries: [{ items: ["core:flint"], min: 5, max: 5 }] },
      "fill.voyage": { all: true, entries: [{ items: ["core:fiber"], min: 5, max: 5 }] },
      "kit.arms.white": { all: true, entries: [{ items: ["core:spear"], min: 1, max: 2 }, { items: ["core:slingshot"], min: 1, max: 1 }, { items: ["core:stone"], min: 10, max: 20 }] },
      "prize.arms.white": { min: 1, max: 1, entries: [{ items: ["core:bow"], min: 1, max: 1, quality: "tier", blueprint: 0.2 }, { items: ["core:bola"], min: 2, max: 4 }, { items: ["core:lance"], min: 1, max: 1, quality: "tier" }] },
      "kit.arms.green": { all: true, entries: [{ items: ["core:bow"], min: 1, max: 1 }, { items: ["core:arrow_stone"], min: 15, max: 25 }] },
      "prize.arms.green": { min: 1, max: 1, entries: [{ items: ["core:crossbow"], min: 1, max: 1, quality: "tier", blueprint: 0.2 }, { items: ["core:whip"], min: 1, max: 1, quality: "tier", weight: 0.5 }] },
      "kit.voyage.white": { all: true, entries: [{ items: ["core:fishing_rod"], min: 1, max: 1 }, { items: ["core:harpoon_launcher"], min: 1, max: 1 }] },
      "prize.voyage.white": { min: 1, max: 1, entries: [{ items: ["core:raft_assembly"], min: 1, max: 1 }] },
      "kit.voyage.green": { all: true, entries: [{ items: ["core:frond_glider"], min: 1, max: 1, quality: "tier" }, { items: ["core:flare_gun"], min: 1, max: 2 }] },
      "prize.voyage.green": { min: 1, max: 1, entries: [{ items: ["core:boat_assembly"], min: 1, max: 1, jackpot: true, weight: 0.05 }, { items: ["core:flare_gun"], min: 2, max: 3 }] },
    },
    tables: {},
    future: {
      "core:lance": { ark: "Lance", level: 25, worth: 110, quality: true },
      "core:whip": { ark: "Whip", level: 30, worth: 330, quality: true },
      "core:fishing_rod": { ark: "Fishing Rod", level: 8, worth: 40 },
      "core:harpoon_launcher": { ark: "Harpoon Launcher", level: 7, worth: 45 },
      "core:raft_assembly": { ark: "Wooden Raft", level: 16, like: "core:bow", scale: 9, blueprint: false },
    },
    circuits: [{ key: "shore", on: true, sites: ["a"], maxLive: 2, firstDelay: [60, 120], interval: [300, 600], tierWeights: { white: 3, green: 1 } }],
    sites: [{ key: "a", x: 100, z: 100 }],
  };
  for (const tier of ["white", "green"]) {
    for (const cls of ["arms", "voyage"]) {
      b.tables[tableKey(tier, cls)] = {
        tier,
        cls,
        slots: [
          { name: "kit", from: [{ set: `kit.${cls}.${tier}` }] },
          { name: "prize", from: [{ set: `prize.${cls}.${tier}` }] },
          ...(tier === "green" ? [{ name: "echo", chance: 0.35, ringed: 1, from: [{ set: `prize.${cls}.white` }] }] : []),
          { name: "second prize", chance: 0, ringed: 1, from: [{ set: `prize.${cls}.${tier}` }] },
          { name: "staple", from: [{ set: `staple.${tier}` }] },
        ],
      };
    }
  }
  return b;
}

test("a sound book has no faults, and what is wrong with one is said at its path, whatever it is handed", () => {
  expect(bookFaults(book())).toEqual([]);
  // Anything at all may be handed in, and nothing throws.
  for (const junk of [null, 7, "book", [], {}, { format: 1, tiers: "no", sets: 5, tables: [], rules: null }]) expect(bookFaults(junk).length).toBeGreaterThan(0);
  const paths = (change: (b: SupplyBook) => void): string[] => {
    const b = book();
    change(b);
    return bookFaults(b).map((f) => f.path);
  };
  expect(paths((b) => void (b.tiers[1]!.key = "white"))).toContain("tiers.1.key");
  expect(paths((b) => void (b.tiers[0]!.staple = "nothing"))).toEqual(["tiers.0.staple"]);
  expect(paths((b) => void (b.tiers[0]!.quality = [2, 1]))).toEqual(["tiers.0.quality"]);
  expect(paths((b) => void (b.sets["kit.arms.white"]!.entries[0]!.max = 0))).toEqual(["sets.kit.arms.white.entries.0"]);
  expect(paths((b) => void (b.sets["prize.arms.white"]!.entries[0]!.blueprint = 2))).toEqual(["sets.prize.arms.white.entries.0.blueprint"]);
  expect(paths((b) => void (b.sets["prize.arms.white"]!.power = 0.3))).toEqual(["sets.prize.arms.white.power"]);
  expect(paths((b) => void b.tables["white/arms"]!.slots[0]!.from.push({ set: "missing" }))).toEqual(["tables.white/arms.slots.0.from.1.set"]);
  expect(paths((b) => void (b.tables["white/arms"]!.cls = "voyage"))).toEqual(["tables.white/arms"]);
  expect(paths((b) => void (b.rules.flightSeconds = 300))).toEqual(["rules.flightSeconds", "rules.noticeSeconds"]);
  expect(paths((b) => void (b.circuits[0]!.sites = ["b"]))).toEqual(["circuits.0.sites.0"]);
  expect(paths((b) => void (b.circuits[0]!.tierWeights = { red: 1 }))).toEqual(["circuits.0.tierWeights.red"]);
  expect(paths((b) => void (b.future["core:lance"] = { ark: "Lance", level: 25 }))).toEqual(["future.core:lance"]);
  expect(paths((b) => void ((b as { format: number }).format = 2))).toEqual(["format"]);
  // An item the game does not have is never a fault of the book.
  expect(paths((b) => void b.sets["kit.arms.white"]!.entries.push({ items: ["core:no_such_thing", "mod:other"], min: 1, max: 1 }))).toEqual([]);
});

test("a book is forgiving: what the game lacks waits, an entry, a set and a slot with nothing leave, and a roll is never empty", () => {
  const c = compileBook(book(), catalog);
  // The five future items wait, each with the sets that name it, and nothing else does.
  expect(c.report.waiting.map((w) => [w.id, w.why, w.sets])).toEqual([
    ["core:fishing_rod", "future", ["kit.voyage.white"]],
    ["core:harpoon_launcher", "future", ["kit.voyage.white"]],
    ["core:lance", "future", ["prize.arms.white"]],
    ["core:raft_assembly", "future", ["prize.voyage.white"]],
    ["core:whip", "future", ["prize.arms.green"]],
  ]);
  // White voyage has nothing of its own: both its sets are empty, its two slots of them leave, and it is dormant.
  expect(c.report.emptySets).toEqual(["kit.voyage.white", "prize.voyage.white"]);
  // So does green voyage's echo of the white prize.
  expect(c.report.emptySlots).toEqual(["tables.white/voyage.slots.0", "tables.white/voyage.slots.1", "tables.green/voyage.slots.2"]);
  expect(c.report.dormant).toEqual(["white/voyage"]);
  const voyage = c.tables.get("white/voyage")!;
  expect([voyage.plain.map((s) => s.name), voyage.dormant, voyage.fill !== null]).toEqual([["staple"], true, true]);
  // The lance left the white prize, which draws from the bow and the bola alone; the whip left the green one.
  const arms = c.tables.get("white/arms")!;
  expect(arms.plain[1]!.def.from[0]!.entries.map((e) => e.items)).toEqual([["core:bow"], ["core:bola"]]);
  expect(c.tables.get("green/arms")!.plain[1]!.def.from[0]!.entries.map((e) => e.items)).toEqual([["core:crossbow"]]);
  for (const table of c.tables.values()) {
    for (const ringed of [false, true]) {
      for (let seed = 0; seed < 300; seed++) {
        const drops = rollTable(table, ringed, new Rng(seed), catalog);
        expect(drops.length).toBeGreaterThan(0);
        // Only things the game has, and never a quality on what quality does nothing for.
        for (const d of drops) expect([reg.defs[d.item]?.type, d.quality === 0 || catalog.byIndex[d.item]!.quality]).toEqual(["item", true]);
      }
    }
  }
  // A dormant table opened anyway by an admin is topped up from its class's own materials to the floor share.
  const filled = simulate(c, voyage, false, 200, 1, true);
  expect(filled.items.map((i) => i.id)).toContain("core:fiber");
  expect(filled.min).toBeGreaterThanOrEqual(200 * 0.4);
  expect(simulate(c, voyage, false, 200, 1).mean).toBeLessThan(200 * 0.4);

  // A book that names nothing the game has still gives each tier's floor, if that holds anything.
  const strange = book();
  for (const [key, set] of Object.entries(strange.sets)) if (!key.startsWith("staple.")) for (const e of set.entries) e.items = e.items.map((i) => `${i}_of_tomorrow`);
  const s = compileBook(strange, catalog);
  expect(s.report.waiting.every((w) => w.why === "unknown")).toBe(true);
  for (const table of s.tables.values()) expect(rollTable(table, false, new Rng(4), catalog).map((d) => reg.ids[d.item]).sort()).toEqual(table.tier === 0 ? ["core:thatch", "core:wood"] : ["core:stone", "core:wood"]);
  // And one whose floor is of tomorrow too gives nothing, and says which tables are left with nothing to stand on.
  for (const set of Object.values(strange.sets)) for (const e of set.entries) e.items = ["core:of_tomorrow"];
  const none = compileBook(strange, catalog);
  expect([...none.tables.values()].every((t) => t.floor === null && rollTable(t, false, new Rng(1), catalog).length === 0)).toBe(true);
});

test("what loot may never mint is left out, a renamed id is followed, and quality is left off what it does nothing for", () => {
  const b = book();
  b.sets["kit.arms.white"]!.entries.push({ items: ["core:dodo_egg_fertile", "core:soul_ball_full", "core:feces_small"], min: 1, max: 1 });
  b.sets["kit.arms.white"]!.entries.push({ items: ["core:stone", "core:hatchet"], min: 1, max: 1, quality: [4.5, 4.5] });
  b.sets["kit.arms.white"]!.entries.push({ items: ["core:old_spear"], min: 1, max: 1 });
  const renamed = { ...catalog, renamed: new Map([["core:old_spear", ["core:spear"]]]) };
  const c = compileBook(b, renamed);
  expect(c.report.waiting.filter((w) => w.why === "never").map((w) => w.id)).toEqual(["core:dodo_egg_fertile", "core:feces_small", "core:soul_ball_full"]);
  expect(c.report.waiting.find((w) => w.id === "core:old_spear")).toEqual({ id: "core:old_spear", why: "renamed", to: ["core:spear"], sets: ["kit.arms.white"] });
  expect(c.report.lints.map((l) => [l.path, l.warn])).toContainEqual(["sets.kit.arms.white.entries.4", true]);
  let stones = 0;
  let hatchets = 0;
  for (let seed = 0; seed < 200; seed++) {
    for (const d of rollTable(c.tables.get("white/arms")!, false, new Rng(seed), renamed)) {
      expect([id("dodo_egg_fertile"), id("soul_ball_full"), id("feces_small")]).not.toContain(d.item);
      if (d.item === id("stone") && d.count === 1) expect([d.quality, ++stones > 0]).toEqual([0, true]);
      if (d.item === id("hatchet")) expect([d.quality, ++hatchets > 0]).toEqual([3, true]);
    }
  }
  expect(stones > 20 && hatchets > 20).toBe(true);
});

test("worth: a recipe in weighted raw resources, quality at what it costs to craft, a blueprint a share of its item", () => {
  const b = book();
  const c = compileBook(b, withFuture(catalog, b));
  const w = c.worth;
  // spear: 12 fiber, 8 wood, 2 flint. bow: 50 fiber, 15 wood. ingot: 2 ore at 3, fired.
  expect([w.of("core:spear"), w.of("core:bow"), w.of("core:ingot"), w.of("core:no_such")]).toEqual([22, 65, 6, 0]);
  // A future item is worth its guess, or what it is like; an override is the worth outright.
  expect([w.of("core:lance"), w.of("core:raft_assembly")]).toEqual([110, 585]);
  const said = book();
  said.worth.items["core:bow"] = 70;
  expect(compileBook(said, catalog).worth.of("core:bow")).toBe(70);
  // Ramshackle costs each ingredient 1 + 1.25 * 1.33 * 0.3 of itself, rounded up to a whole one.
  expect(w.at("core:bow", 1)).toBe(75 + 23);
  expect(w.at("core:stone", 3)).toBe(1);
  // A bow's engram is level 10: past a gate of 3 its blueprint is half a bow, behind a gate of 15 a tenth; with quality, two.
  expect([w.blueprint("core:bow", 0, 3), w.blueprint("core:bow", 0, 15), w.blueprint("core:bow", 1, 3)]).toEqual([32.5, 6.5, 196]);
  // The share of each tier a band gives: 1 to 1.4 is 62.5% primitive; 2.5 to 7.5 is 40% apprentice, 50% journeyman, 10% mastercraft.
  expect(tierMix(1, 1.4).map((v) => Math.round(v * 1000))).toEqual([625, 375, 0, 0, 0, 0]);
  expect(tierMix(2.5, 7.5).map((v) => Math.round(v * 1000))).toEqual([0, 0, 400, 500, 100, 0]);
  expect(tierMix(4.5, 4.5)).toEqual([0, 0, 0, 1, 0, 0]);
});

test("the simulator's figures are the rolls', the estimate is near them, ringed is richer, and a jackpot is kept apart", () => {
  const b = book();
  const c = compileBook(b, catalog);
  const arms = c.tables.get("white/arms")!;
  const stats = simulate(c, arms, false, 4000, 11);
  expect(simulate(c, arms, false, 4000, 11)).toEqual(stats);
  expect([stats.n, stats.empty, stats.histogram.reduce((a, v) => a + v, 0)]).toEqual([4000, 0, 4000]);
  expect(stats.min <= stats.p5 && stats.p5 <= stats.median && stats.median <= stats.p95 && stats.p95 <= stats.max).toBe(true);
  // The compile's estimate of a table's worth is within a twentieth of what the rolls come to.
  expect(Math.abs(arms.worth - stats.mean) / stats.mean).toBeLessThan(0.05);
  // Every roll has its kit and its staple; half its prizes are the bow, a fifth of those a blueprint.
  const of = (name: string) => stats.items.find((i) => i.id === `core:${name}`)!;
  expect([of("spear").rolls, of("slingshot").rolls, of("thatch").rolls]).toEqual([4000, 4000, 4000]);
  expect(Math.abs(of("bow").rolls / 4000 - 0.5)).toBeLessThan(0.03);
  expect(Math.abs(of("bow").blueprints / of("bow").rolls - 0.2)).toBeLessThan(0.04);
  // Of the bows, about three in eight are ramshackle at white's band.
  expect(Math.abs(stats.quality[1]! - 0.375)).toBeLessThan(0.05);
  // A ringed roll has a second prize and its band half as high again.
  const ringed = simulate(c, arms, true, 4000, 11);
  expect(ringed.mean).toBeGreaterThan(stats.mean * 1.3);
  expect(ringed.quality[1]!).toBeGreaterThan(stats.quality[1]! + 0.3);
  // Green voyage's boat is a jackpot: about one roll in 21 holds it, and it is no part of the mean.
  const voyage = c.tables.get("green/voyage")!;
  const v = simulate(c, voyage, false, 6000, 3);
  expect(voyage.jackpots).toEqual([id("boat_assembly")]);
  expect(Math.abs(v.jackpotShare - 0.05 / 1.05)).toBeLessThan(0.012);
  expect(v.max).toBeLessThan(c.worth.of("core:boat_assembly"));
  expect(v.jackpotMean).toBeGreaterThan(0);
  expect(stacksOf([{ item: id("wood"), count: 250, quality: 0, blueprint: false, rating: 0 }, { item: id("bow"), count: 1, quality: 0, blueprint: true, rating: 0 }], c)).toBe(4);
  // What a circuit may call: its tier weights times the classes', with the dormant table left out.
  expect(cellsOf(c, b.circuits[0]!).map((x) => [x.table.key, x.weight])).toEqual([["white/arms", 3], ["green/arms", 1], ["green/voyage", 1]]);
});

test("a world's book is a file beside its save: saved by revision, refused on a conflict or a fault, and passed over if it is another map's", () => {
  const path = join(dir, "world.db.supply.json");
  const said: string[] = [];
  let clock = 1000;
  const open = (map = "miami") => new BookStore(path, map, book, (l) => said.push(l), () => clock++);
  const store = open();
  expect([store.starter, store.book.revision, store.kept, existsSync(path)]).toEqual([true, 0, true, false]);
  const next = book();
  next.tiers[0]!.target = 250;
  expect(store.save(next, 0, "ada", "white is worth more")).toEqual({ ok: true, revision: 1 });
  expect([store.starter, store.book.revision, store.book.map, store.book.tiers[0]!.target]).toEqual([false, 1, "miami", 250]);
  // What was handed in is not the book in force.
  next.tiers[0]!.target = 1;
  expect(store.book.tiers[0]!.target).toBe(250);
  // Another editor's save came first: nothing changes, and the revision in force is told.
  expect(store.save(next, 0, "bob", "")).toEqual({ ok: false, conflict: 1 });
  // A fault is told at its path and nothing is saved.
  next.tiers[0]!.staple = "none";
  expect(store.save(next, 1, "bob", "")).toEqual({ ok: false, faults: [{ path: "tiers.0.staple", message: "names a set of the book" }] });
  expect(store.book.revision).toBe(1);
  // It is there for the next start, with its history.
  const again = open();
  expect([again.starter, again.book.revision, again.book.tiers[0]!.target, again.revisions().map((r) => [r.revision, r.by, r.note, r.at])]).toEqual([false, 1, 250, [[1, "ada", "white is worth more", 1000]]]);
  expect(again.reset("ada")).toEqual({ ok: true, revision: 2 });
  expect([again.book.tiers[0]!.target, again.revisions().length]).toEqual([200, 2]);
  // A world on another map passes the file over, and so does one whose file is cut short; the file is left as it is.
  expect([open("tampa").starter, said.at(-1)]).toEqual([true, `drop book: ${path} was written for the map miami and this world runs tampa, so the starter book is in force`]);
  const whole = readFileSync(path, "utf8");
  writeFileSync(path, whole.slice(0, whole.length / 2));
  expect([open().starter, said.at(-1)]).toEqual([true, `drop book: ${path} is not whole JSON, so the starter book is in force and the file is left as it is`]);
  // With no save there is no file, and edits last while the world runs.
  const loose = new BookStore(null, "miami", book);
  expect([loose.kept, loose.save(book(), 0, "ada", ""), loose.book.revision]).toEqual([false, { ok: true, revision: 1 }, 1]);
});
