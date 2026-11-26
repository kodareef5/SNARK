// Where items come from (planning/workstreams/loot.md): every item has a way into the world or is listed as having none.

import { expect, test } from "bun:test";
import { FOUND_NOT_MADE, NEVER_FOUND, WAITING } from "../../content/loot/waiting.ts";
import type { Def } from "../../shared/content/defs.ts";
import { lacks, reachOf } from "../../shared/supply/reach.ts";
import { coreReach, gaps } from "../../tools/supply/reach.ts";

const item = (id: string, more: object = {}): Def => ({ type: "item", class: "resource", id, stack: 100, ...more }) as unknown as Def;
const made = (needs: string[], at?: string): object => ({ craft: { needs: needs.map((n) => ({ item: n, count: 1 })), seconds: 1, ...(at ? { at } : {}) } });

test("every item can be come by, or is listed as never found or as waiting", () => {
  const { none } = gaps(coreReach());
  expect(none.sort()).toEqual([...Object.keys(NEVER_FOUND), ...Object.keys(WAITING)].sort());
});

test("an item found in drops whose recipe cannot be followed is listed with what it lacks", () => {
  const { notMade } = gaps(coreReach());
  expect(Object.fromEntries(notMade.map(([id, lack]) => [id, lack.join(" ")]))).toEqual({ ...FOUND_NOT_MADE });
});

test("a recipe is a way only when each thing it needs has one", () => {
  const defs = [
    item("t:ore"),
    item("t:bar", made(["t:ore"])),
    item("t:gel"),
    item("t:prod", made(["t:bar", "t:gel"])),
    { type: "node", id: "t:rock", yields: [{ item: "t:ore", min: 1, max: 1 }] } as unknown as Def,
  ];
  const reach = reachOf(defs);
  expect([...reach.reached].sort()).toEqual(["t:bar", "t:ore"]);
  expect(lacks(reach, reach.ways.get("t:prod")![0]!)).toEqual(["t:gel"]);
  expect(reach.ways.get("t:gel")).toEqual([]);
});

test("a thing made at a station needs the item that sets the station down", () => {
  const bench = { type: "structure", class: "station", id: "t:bench" } as unknown as Def;
  const defs = [item("t:wood"), item("t:plank", made(["t:wood"], "t:bench")), bench, { type: "node", id: "t:tree", yields: [{ item: "t:wood", min: 1, max: 1 }] } as unknown as Def];
  expect(reachOf(defs).reached.has("t:plank")).toBe(false);
  expect(reachOf([...defs, item("t:bench_item", { ...made(["t:wood"]), places: ["t:bench"] })]).reached.has("t:plank")).toBe(true);
});

test("cooking, spoiling and burning each give what they turn a thing into", () => {
  const defs = [
    item("t:meat", { cooks: { into: "t:cooked", seconds: 1 }, spoilsInto: "t:spoiled", spoilHours: 1 }),
    item("t:cooked"),
    item("t:spoiled"),
    item("t:wood", { burnsInto: "t:charcoal" }),
    item("t:charcoal"),
    { type: "species", id: "t:dodo", drops: [{ item: "t:meat", min: 1, max: 1 }] } as unknown as Def,
  ];
  // Wood has no source here, so neither has charcoal.
  expect([...reachOf(defs).reached].sort()).toEqual(["t:cooked", "t:meat", "t:spoiled"]);
});

test("a drop table gives what its sets hold, but for what loot may not give", () => {
  const book = {
    tiers: [{ key: "white", staple: "staple", floor: "staple" }],
    classes: [{ key: "arms", fill: "fill" }],
    sets: { kit: { entries: [{ items: ["t:bow", "t:egg"], min: 1, max: 1 }] }, staple: { entries: [{ items: ["t:rope"], min: 1, max: 1 }] }, fill: { entries: [] }, loose: { entries: [{ items: ["t:gem"], min: 1, max: 1 }] } },
    tables: { "white/arms": { tier: "white", cls: "arms", slots: [{ from: [{ set: "kit" }] }] } },
  } as unknown as Parameters<typeof reachOf>[1];
  const reach = reachOf([item("t:bow"), item("t:egg"), item("t:rope"), item("t:gem")], book, (id) => id !== "t:egg");
  // A set no table draws gives nothing.
  expect([...reach.reached].sort()).toEqual(["t:bow", "t:rope"]);
  expect(reach.ways.get("t:bow")).toEqual([{ how: "dropped", from: "white/arms", needs: [] }]);
});
