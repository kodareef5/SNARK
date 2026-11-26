// Sources of the drop book (planning/workstreams/loot.md): where loot lies besides drops, and how one is rolled.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { starterBook } from "../../content/supply/starter.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Rng } from "../../shared/rng.ts";
import { bookFaults, type SourceDoc, type SupplyBook } from "../../shared/supply/book.ts";
import { catalogOf, withFuture } from "../../shared/supply/catalog.ts";
import { compileBook, matches, rollSource, sourceTarget, sourceWorth, tierOf } from "../../shared/supply/compile.ts";
import { reachOf } from "../../shared/supply/reach.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const catalog = catalogOf(reg);
const book = starterBook();
const compiled = compileBook(book, catalog);
const source = (key: string): SourceDoc => book.sources!.find((s) => s.key === key)!;
const withSource = (change: Partial<SourceDoc>): SupplyBook => ({ ...book, sources: [{ ...source("body/apex"), ...change }] });
const paths = (b: SupplyBook): string[] => bookFaults(b).map((f) => f.path);

test("the starter book's sources have no faults, and a book without the section has none either", () => {
  expect(bookFaults(book)).toEqual([]);
  const { sources: _, ...old } = book;
  expect(bookFaults(old)).toEqual([]);
});

test("a source is refused for a table the book has not, a tier mark with no tier, and a ladder that does not rise", () => {
  expect(paths(withSource({ tables: [{ table: "body/nothing" }] }))).toEqual(["sources.0.tables.0.table"]);
  expect(paths(withSource({ tier: undefined, ladder: undefined, share: undefined }))).toContain("sources.0.tables.0.table");
  expect(paths(withSource({ ladder: [{ level: 30, tier: "green" }, { level: 30, tier: "blue" }] }))).toEqual(["sources.0.ladder.1.level"]);
  expect(paths(withSource({ ladder: [{ level: 30, tier: "puce" }] }))).toEqual(["sources.0.ladder.0.tier"]);
  expect(paths(withSource({ when: { size: ["huge"] } }))).toEqual(["sources.0.when.size"]);
  expect(paths({ ...book, sources: [source("body/any"), source("body/any")] })).toEqual(["sources.1.key"]);
});

test("a source is the loot of the bodies its filter lets by", () => {
  const apex = source("body/apex");
  expect(matches(apex, { kind: "body", species: "core:rex", size: "apex", level: 40 })).toBe(true);
  expect(matches(apex, { kind: "body", species: "core:dodo", size: "small", level: 40 })).toBe(false);
  expect(matches(source("body/any"), { kind: "body", species: "core:dodo", size: "small", level: 1 })).toBe(true);
  const narrow: SourceDoc = { ...apex, when: { species: ["core:rex"], level: [100, 150] } };
  expect(matches(narrow, { kind: "body", species: "core:rex", size: "apex", level: 120 })).toBe(true);
  expect(matches(narrow, { kind: "body", species: "core:rex", size: "apex", level: 99 })).toBe(false);
  expect(matches(narrow, { kind: "body", species: "core:spino", size: "apex", level: 120 })).toBe(false);
});

test("a body's level picks the tier a source rolls at: the last step of the ladder it has reached", () => {
  const apex = source("body/apex");
  expect([1, 29, 30, 89, 90, 150].map((level) => tierOf(apex, level))).toEqual(["white", "white", "green", "blue", "purple", "red"]);
  expect(tierOf(source("body/any"), 150)).toBe("");
});

test("the same seed rolls the same loot, and another seed something else", () => {
  const sure = { ...source("body/apex"), chance: 1 };
  const roll = (seed: number) => rollSource(compiled, sure, "purple", new Rng(seed));
  expect(roll(7)).toEqual(roll(7));
  expect(roll(7).length).toBeGreaterThan(0);
  const seen = new Set(Array.from({ length: 40 }, (_, k) => JSON.stringify(roll(k))));
  expect(seen.size).toBeGreaterThan(10);
});

test("a source gives by its chance, and a server's chance multiplies it", () => {
  const apex = source("body/apex");
  const gave = (chance: number): number => Array.from({ length: 400 }, (_, k) => rollSource(compiled, apex, "blue", new Rng(k + 1), chance).length > 0).filter(Boolean).length;
  expect(gave(1)).toBeGreaterThan(150);
  expect(gave(1)).toBeLessThan(250);
  expect(gave(0)).toBe(0);
  expect(gave(2)).toBe(400);
});

test("a source that names a table's prize slot gives only what that prize holds", () => {
  const only: SourceDoc = { ...source("body/apex"), chance: 1, tables: [{ table: "{tier}/arms", slots: ["prize"] }] };
  const prize = new Set(book.sets["prize.arms.blue"]!.entries.flatMap((e) => e.items));
  for (let seed = 1; seed <= 60; seed++) for (const d of rollSource(compiled, only, "blue", new Rng(seed))) expect(prize.has(reg.ids[d.item]!)).toBe(true);
});

test("each starter source gives about what it is balanced to, at every tier it rolls", () => {
  const designed = compileBook(book, withFuture(catalog, book));
  for (const s of book.sources!) {
    const tiers = s.tier !== undefined ? [s.tier, ...(s.ladder ?? []).map((step) => step.tier)] : [""];
    const ratios = tiers.map((tier) => sourceWorth(designed, s, tier) / sourceTarget(book, s, tier)!);
    for (const r of ratios) expect(Math.abs(r - 1), `${s.key}: ${ratios.map((v) => v.toFixed(2)).join(" ")}`).toBeLessThan(0.35);
    expect(Math.abs(ratios.reduce((a, b) => a + b, 0) / ratios.length - 1), s.key).toBeLessThan(0.15);
  }
});

test("what a source gives counts as a way an item is come by, while it is switched on", () => {
  const way = (b: SupplyBook) => reachOf(CORE_CONTENT, b).ways.get("core:keratin")!.filter((w) => w.how === "found").map((w) => w.from);
  expect(way(book)).toEqual(["body/any", "body/medium", "body/large"]);
  expect(way({ ...book, sources: book.sources!.map((s) => ({ ...s, on: false })) })).toEqual([]);
});
