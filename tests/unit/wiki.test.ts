// The wiki (tools/wiki.ts) from the content and fixtures: no build of the game is read here.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { findRows, mapTransform, type SearchRow } from "../../client/core/wiki/filter.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { buildCatalogue, namesOf, time } from "../../tools/wiki/catalogue.ts";
import { checkLinks } from "../../tools/wiki/links.ts";
import { indexedPng } from "../../tools/wiki/quantize.ts";
import { commands, consoleLine, publicSettings } from "../../tools/wiki/reference.ts";
import { renderWiki, type Site } from "../../tools/wiki/render.ts";

const entries = buildCatalogue({ console: consoleLine(commands()) });
const byId = (id: string) => entries.find((e) => e.id === id)!;

test("the wiki is of what a player meets: no scenery, no target, no creature without art, and a made thing is one entry", () => {
  const ids = new Set(entries.map((e) => e.id));
  for (const d of CORE_CONTENT) {
    if (d.type === "item") expect(ids.has(d.id)).toBe(true);
    if (d.type === "structure" || d.type === "engram") expect(ids.has(d.id)).toBe(false);
  }
  expect([...ids].filter((id) => !CORE_CONTENT.some((d) => d.id === id && d.type === "item")).sort()).toEqual([
    "core:boat", "core:boat_police", "core:boat_rescue", "core:civilian", "core:compact", "core:dodo", "core:helicopter",
    "core:helicopter_police", "core:helicopter_rescue", "core:parasaur", "core:pteranodon", "core:raptor", "core:survivor",
  ]);
  const foundation = byId("core:piece_foundation_wood");
  expect([foundation.label, foundation.group, foundation.console]).toEqual(["Wooden foundation", "Building", "give core:piece_foundation_wood 1"]);
  expect(foundation.facts.map((f) => [f.label, f.value.join("")])).toContainEqual(["Engram", "Level 11, 6 points"]);
  expect(foundation.facts.map((f) => [f.label, f.value.join("")])).toContainEqual(["Health", "15,000"]);
  expect(foundation.tables[0]!.rows).toEqual([[{ id: "core:wood" }, "80"], [{ id: "core:thatch" }, "20"], [{ id: "core:fiber" }, "15"]]);
});

test("a creature's page has its stats by level, the wiki's taming table, its drops and the line that spawns one", () => {
  const dodo = byId("core:dodo");
  // tests/unit/dodo.test.ts holds the same numbers to ARK's wiki.
  expect(dodo.tables.find((t) => t.title === "Taming")!.rows).toEqual([
    ["1", "30", "1 min 40 s", "6 in 48 s", "0", "0"],
    ["30", "82", "2 min 45 s", "15 in 2 min", "0", "0"],
    ["60", "136", "3 min 29 s", "23 in 3 min 4 s", "0", "0"],
    ["90", "190", "4 min 2 s", "31 in 4 min 8 s", "1", "1"],
    ["120", "244", "4 min 27 s", "40 in 5 min 20 s", "5", "2"],
    ["150", "298", "4 min 48 s", "48 in 6 min 24 s", "10", "3"],
  ]);
  const raptor = byId("core:raptor");
  expect(raptor.tables.find((t) => t.title === "Stats")!.rows[0]).toEqual(["Health", "200", "+40 (20%)", "+5.4%"]);
  expect(raptor.tables.find((t) => t.title === "Harvesting")!.rows).toEqual([
    [{ id: "core:hide" }, "1", "55.6%", { id: "core:hatchet" }],
    [{ id: "core:meat" }, "1", "44.4%", { id: "core:pick" }],
  ]);
  expect(raptor.facts.find((f) => f.label === "Maturation")!.value).toEqual(["1 d 13 h"]);
  expect(raptor.console).toBe("spawn core:raptor");
  expect([time(7199), time(59), time(3600)]).toEqual(["1 h 59 min", "59 s", "1 h"]);
});

test("a vehicle's facts are its vehicle's, and a renamed command fails the wiki rather than printing a dead line", () => {
  const car = byId("core:compact");
  expect(car.facts.map((f) => f.label)).toEqual(["Top speed", "Reverse", "Seats", "Doors", "Fuel tank", "Health", "Inventory", "Carries", "Mass"]);
  expect(car.facts[0]!.value).toEqual(["122 km/h"]);
  expect(() => buildCatalogue({ console: consoleLine(commands().filter((c) => c.name !== "spawn")) })).toThrow('the wiki gives "spawn" lines');
});

test("an item and its engram added to the content get their entry, and the links run both ways", () => {
  const added: Def[] = [
    { type: "item", class: "resource", id: "wiki:alloy", label: "test alloy", stack: 25, weight: 2, craft: { needs: [{ item: "core:wood", count: 3 }], seconds: 4, xp: 1 } },
    { type: "engram", id: "wiki:learn_alloy", label: "Test alloy", item: "wiki:alloy", cost: 3, level: 2 },
  ];
  const list = buildCatalogue({ defs: [...CORE_CONTENT, ...added] });
  const alloy = list.find((e) => e.id === "wiki:alloy")!;
  expect(alloy.facts.map((f) => [f.label, f.value.join("")])).toContainEqual(["Engram", "Level 2, 3 points"]);
  expect(list.find((e) => e.id === "core:wood")!.related.find((r) => r.relation === "Used to craft")!.refs).toContainEqual({ id: "wiki:alloy" });
});

test("the settings the wiki lists are the rows marked public, and every command family is registered", () => {
  expect(publicSettings().map((s) => s.name)).toContain("TamingSpeedMultiplier");
  expect(publicSettings().length).toBe(22);
  expect(commands().filter((c) => c.examples.length > 0).length).toBeGreaterThan(10);
});

test("every page is whole HTML, names only what it has, and writes what the content says as text", () => {
  const dist = mkdtempSync(join(tmpdir(), "snark-wiki-"));
  try {
    const card = { file: "/wiki/media/raptor.card.png", width: 240, height: 180 };
    const site: Site = {
      assets: { css: "/wiki/a.css", js: "/wiki/a.js", search: "/wiki/s.json", font: "/assets/f.ttf", revision: "abc" },
      entries: entries.map((e) => (e.id === "core:raptor" ? { ...e, label: '<img src=x onerror="bad()">' } : e)),
      pictures: new Map([["core:raptor", { views: [card], card }]]),
      credits: new Map([["core:raptor", "Model and motion: Quaternius, CC0 1.0."]]),
      atlases: [],
      sounds: [{ id: "core:raptor/sound/call", owner: "core:raptor", name: "Call", file: "core.snsd", at: 8, rate: 32000, takes: [[100, 20]], game: true }],
      heard: new Map([["core:raptor", ["core:raptor/sound/call"]]]),
      music: [],
      commands: commands(),
      settings: publicSettings(),
      engrams: [],
      names: namesOf(entries),
    };
    const pages = renderWiki(site);
    for (const f of ["wiki/a.css", "wiki/a.js", "wiki/s.json", "assets/f.ttf", "wiki/media/raptor.card.png", "assets/core.snsd"]) {
      const file = join(dist, f);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "");
    }
    expect(() => checkLinks(pages, dist)).not.toThrow();
    const raptor = pages.get("creatures/raptor/")!;
    expect(raptor).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(raptor).not.toContain("<img src=x");
    expect(raptor).toContain('data-file="/assets/core.snsd" data-at="8" data-rate="32000" data-takes="100:20"');
    for (const html of pages.values()) expect(html).toStartWith("<!doctype html>");
    expect(() => checkLinks(new Map([["a/", '<a href="/wiki/b/">b</a>']]), dist)).toThrow("names /wiki/b/");
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("search ranks a label that begins with the query first; the map stays over its view", () => {
  const rows: SearchRow[] = [["Raptor saddle", "/a/", "Saddle", ""], ["Raptor", "/b/", "Creature", ""], ["Pistol", "/c/", "Weapon", ""]];
  expect(findRows(rows, "rap", 10).map((r) => r[0])).toEqual(["Raptor", "Raptor saddle"]);
  expect(findRows(rows, "saddle rap", 10).map((r) => r[0])).toEqual(["Raptor saddle"]);
  expect(findRows(rows, " ", 10)).toEqual([]);
  expect(mapTransform(2, 900, -900, 400, 400)).toEqual({ zoom: 2, x: 200, y: -200 });
  expect(mapTransform(20, 0, 0, 400, 400).zoom).toBe(8);
});

test("a picture in 256 colours keeps its clear pixels clear and its colours near", () => {
  const [w, h] = [16, 8];
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) if (p % w < 12) rgba.set([p * 2, 255 - p, 40, p % w === 11 ? 128 : 255], p * 4);
  const png = indexedPng(w, h, rgba);
  const chunk = (tag: string): Uint8Array => {
    for (let at = 8; at < png.length; ) {
      const n = new DataView(png.buffer, png.byteOffset + at).getUint32(0);
      if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === tag) return png.subarray(at + 8, at + 8 + n);
      at += 12 + n;
    }
    throw new Error(tag);
  };
  const [palette, alpha, rows] = [chunk("PLTE"), chunk("tRNS"), new Uint8Array(inflateSync(chunk("IDAT")))];
  for (let p = 0; p < w * h; p++) {
    const k = rows[Math.floor(p / w) * (w + 1) + 1 + (p % w)]!;
    if (rgba[p * 4 + 3] === 0) expect(alpha[k]).toBe(0);
    else for (let c = 0; c < 3; c++) expect(Math.abs(palette[k * 3 + c]! - rgba[p * 4 + c]!)).toBeLessThanOrEqual(8);
  }
});
