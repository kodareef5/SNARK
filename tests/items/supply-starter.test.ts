// The starter drop book (content/supply/starter.ts) held to its design: every tier and class at its target, no roll
// under the floor, nothing loot may not give, and a list of what it waits for that shrinks as the game gains items.

import { expect, test } from "bun:test";
import { starterBook } from "../../content/supply/starter.ts";
import { Rng } from "../../shared/rng.ts";
import { CAPSULE_SLOTS, bookFaults } from "../../shared/supply/book.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { rollTable } from "../../shared/supply/compile.ts";
import { tierMix } from "../../shared/supply/worth.ts";
import { measure } from "../../tools/supply.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const catalog = catalogOf(reg);
const book = starterBook();
const { cells, today, designed } = measure(book, catalog, 3000);
const cell = (key: string) => cells.find((c) => c.key === key)!;

test("the starter book is sound, and what it waits for is a list that only shrinks", () => {
  expect(bookFaults(book)).toEqual([]);
  expect([today.report.lints, today.report.emptySets, today.report.emptySlots, today.report.dormant]).toEqual([[], [], [], []]);
  // A table for each tier and class; the tables of neither are world loot's (content/loot/starter.ts).
  expect([book.tiers.length, book.classes.length, Object.values(book.tables).filter((t) => t.tier !== undefined).length]).toEqual([7, 7, 49]);
  expect(book.tiers.map((t) => [t.key, t.level, t.target])).toEqual([["white", 3, 200], ["green", 15, 400], ["blue", 25, 800], ["purple", 35, 1600], ["yellow", 45, 3200], ["red", 60, 6400], ["meridian", 80, 12800]]);
  // Everything it names is in the game or said in its future list, with ARK's name and a worth; nothing waits unknown.
  expect(today.report.waiting.filter((w) => w.why !== "future")).toEqual([]);
  for (const [id, f] of Object.entries(book.future)) expect([id, f.ark.length > 0, f.worth! > 0, f.page!.startsWith("https://ark.wiki.gg/wiki/")]).toEqual([id, true, true, true]);
  // The backlog. When an item here is made, this list loses it: take it out of FUTURE too, or leave it and the game's wins.
  // Fifty-three of the fifty-four it once waited for are blocked out (content/items/blockouts.ts). The raft is left: a
  // vehicle that is built on.
  expect(today.report.waiting.map((w) => w.id.slice(5))).toEqual(["raft_assembly"]);
  // With those counted, nothing waits and nothing is left empty.
  expect([designed.report.waiting, designed.report.emptySets]).toEqual([[], []]);
});

test("every tier and class is worth its tier's target as designed, a tier's worth twice the last, and no roll falls under the floor", () => {
  for (const tier of book.tiers) {
    const row = cells.filter((c) => c.key.startsWith(`${tier.key}/`));
    expect(row.length).toBe(7);
    for (const c of row) {
      // As designed: within 15% of the target, and the poorest of 3,000 rolls at least 40% of it.
      expect([c.key, Math.abs(c.designed.mean - c.target) <= c.target * 0.15]).toEqual([c.key, true]);
      expect([c.key, c.designed.min >= c.target * 0.4]).toEqual([c.key, true]);
      // Today, with what the game has: no table is dormant, and none gives nothing.
      expect([c.key, c.today.mean >= c.target * 0.4, c.dormant, c.today.empty, c.designed.empty]).toEqual([c.key, true, false, 0, 0]);
      // It fits the capsule with room.
      expect(c.designed.stacksMost).toBeLessThanOrEqual(CAPSULE_SLOTS - 10);
    }
    const mean = row.reduce((a, c) => a + c.designed.mean, 0) / row.length;
    expect(Math.abs(mean - tier.target)).toBeLessThanOrEqual(tier.target * 0.05);
  }
  // Within a class, each tier is worth more than the last, today as designed. Today's steps are shorter where a tier
  // waits for its finest things (riot armour at the top).
  for (const cls of book.classes) {
    const column = book.tiers.map((t) => cell(`${t.key}/${cls.key}`));
    for (let k = 1; k < column.length; k++) expect([cls.key, k, column[k]!.designed.mean > column[k - 1]!.designed.mean * 1.5, column[k]!.today.mean > column[k - 1]!.today.mean * 1.2]).toEqual([cls.key, k, true, true]);
  }
});

test("quality follows each tier's band, a ringed drop is richer, and a jackpot is rare and Voyage's alone", () => {
  for (const tier of book.tiers) {
    const mix = tierMix(tier.quality[0], tier.quality[1]);
    // Arms has the most things of quality: its share at each grade is the band's, give or take the echo of the tier below.
    const arms = cell(`${tier.key}/arms`).today;
    const top = mix.findLastIndex((p) => p > 0);
    expect([tier.key, arms.quality.findLastIndex((p) => p > 0) <= top]).toEqual([tier.key, true]);
    // Ascendant comes only from red up.
    if (tier.level < 60) for (const cls of book.classes) expect([tier.key, cls.key, cell(`${tier.key}/${cls.key}`).designed.quality[5]]).toEqual([tier.key, cls.key, 0]);
  }
  expect(cell("white/arms").today.quality[0]!).toBeGreaterThan(0.5);
  expect(cell("meridian/arms").today.quality[5]!).toBeGreaterThan(0.2);
  let sum = 0;
  for (const c of cells) {
    const ratio = c.ringed.mean / c.designed.mean;
    sum += ratio;
    expect([c.key, ratio > 1.1 && ratio < 2.6]).toEqual([c.key, true]);
  }
  expect(sum / cells.length).toBeGreaterThan(1.4);
  expect(sum / cells.length).toBeLessThan(1.9);
  // Vehicles: only in Voyage from yellow up, in at most 6 rolls of a hundred, and no part of a table's mean.
  for (const c of cells) {
    const voyage = /^(yellow|red|meridian)\/voyage$/.test(c.key);
    expect([c.key, c.designed.jackpotShare > 0, c.designed.jackpotShare <= 0.06]).toEqual([c.key, voyage, true]);
    expect([c.key, c.designed.max < 3 * c.target || /armour|arms/.test(c.key)]).toEqual([c.key, true]);
  }
});

test("a drop never holds what loot may not give, and every roll of every table is of things the game has", () => {
  const never = new Set([...catalog.byId.values()].filter((i) => i.never).map((i) => i.index));
  expect(never.size).toBeGreaterThan(10);
  for (const table of today.tables.values()) {
    for (const ringed of [false, true]) {
      for (let seed = 0; seed < 150; seed++) {
        const drops = rollTable(table, ringed, new Rng(seed * 7919 + 1), catalog);
        expect(drops.length).toBeGreaterThan(0);
        for (const d of drops) {
          const item = catalog.byIndex[d.item]!;
          expect([table.key, item.id, never.has(d.item), d.count >= 1, d.quality === 0 || item.quality, !d.blueprint || item.blueprint]).toEqual([table.key, item.id, false, true, true, true]);
        }
      }
    }
  }
});
