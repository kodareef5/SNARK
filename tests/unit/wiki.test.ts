// The wiki (tools/wiki.ts) from the content and fixtures: no build of the game is read here.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { CONTROL_GROUPS } from "../../client/core/ui/controls-guide.ts";
import { findRows, mapTransform, type SearchRow } from "../../client/core/wiki/filter.ts";
import { RATE_DEFAULTS, changed, rated, tamingLevels, tamingRows } from "../../client/core/wiki/rates.ts";
import { takeRange, takeSamples } from "../../client/core/wiki/sound.ts";
import { liveMaps, worldPath, type LiveWorld, type ServerSaid } from "../../client/core/wiki/world.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { LANDMARKS } from "../../content/landmarks/index.ts";
import type { Host } from "../../server/host.ts";
import { worldSettings } from "../../server/main.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { Rules, publicValues } from "../../server/settings/rules.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { Landmark } from "../../shared/world/landmark.ts";
import { buildCatalogue, namesOf, time } from "../../tools/wiki/catalogue.ts";
import { controlGroups } from "../../tools/wiki/controls.ts";
import { coverage, leftOut, unruled } from "../../tools/wiki/coverage.ts";
import { checkLinks } from "../../tools/wiki/links.ts";
import { indexedPng } from "../../tools/wiki/quantize.ts";
import { commands, consoleLine, publicSettings } from "../../tools/wiki/reference.ts";
import { renderWiki, type Site } from "../../tools/wiki/render.ts";

const entries = buildCatalogue({ console: consoleLine(commands()) });
const byId = (id: string) => entries.find((e) => e.id === id)!;

test("the wiki is of what a player meets: no scenery, no target, no creature without art, and a made thing is one entry", () => {
  const ids = new Set(entries.map((e) => e.id));
  for (const d of CORE_CONTENT) {
    if (d.type === "item" || d.type === "node" || d.type === "buff") expect(ids.has(d.id)).toBe(true);
    if (d.type === "structure" || d.type === "engram") expect(ids.has(d.id)).toBe(false);
  }
  expect(entries.filter((e) => ["creatures", "vehicles", "characters"].includes(e.kind)).map((e) => e.id).sort()).toEqual([
    "core:belvedere", "core:berlinetta", "core:boat", "core:boat_police", "core:boat_rescue", "core:caravan", "core:civilian", "core:compact", "core:dodo", "core:fastback", "core:helicopter",
    "core:helicopter_police", "core:helicopter_rescue", "core:jon_boat", "core:lagoon", "core:manta", "core:meridian", "core:needle",
    "core:panel_van", "core:parasaur", "core:pteranodon", "core:raptor", "core:riptide", "core:solstice", "core:sovereign", "core:survivor", "core:thunderbolt", "core:veloce",
  ]);
  expect(entries.filter((e) => e.kind === "landmarks").map((e) => e.id).sort()).toEqual(LANDMARKS.map((l) => l.name).sort());
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
    [{ id: "core:hide" }, { rate: "body", v: "1 1", text: "1" }, "55.6%", { id: "core:hatchet" }],
    [{ id: "core:meat" }, { rate: "body", v: "1 1", text: "1" }, "44.4%", { id: "core:pick" }],
  ]);
  expect(raptor.facts.find((f) => f.label === "Maturation")!.value).toEqual([{ rate: "mature", v: "133333", text: "1 d 13 h" }]);
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

test("a node, a status and a landmark added get their entries, and the links run both ways", () => {
  const added: Def[] = [
    { type: "node", id: "wiki:cactus", mesh: "box", color: 3, half: [0.5, 1, 0.5], hits: 6, respawnHours: 2, material: "wood", yields: [{ item: "core:fiber", min: 1, max: 2 }, { item: "core:wood", min: 1, max: 1, tool: true }], xp: 2 },
    { type: "buff", id: "wiki:prickled", label: "Prickled", color: 3, seconds: 4, health: -2 },
    { type: "item", class: "consumable", id: "wiki:needle", stack: 10, eat: { food: 1 }, use: { buffs: ["wiki:prickled"] } },
  ];
  const piece = LANDMARKS[0]!.defs.find((d) => d.type === "structure" && d.mesh !== "none")!;
  const hut: Landmark = { name: "hut", defs: LANDMARKS[0]!.defs, pieces: [{ kind: piece.id, at: [0, 0, 0], yaw: 0 }], vehicles: [{ kind: "core:compact", id: "hut/car", at: [4, 0, 0], yaw: 0 }], ground: [] };
  const list = buildCatalogue({ defs: [...CORE_CONTENT, ...added], landmarks: [...LANDMARKS, hut] });
  const of = (id: string) => list.find((e) => e.id === id)!;
  expect(of("wiki:cactus").tables[0]!.rows.map((r) => r.map((c) => (typeof c === "string" ? c : "rate" in c ? c.text : c.id)))).toEqual([["core:fiber", "1 to 2", "3 to 6"], ["core:wood", "", "3"]]);
  expect(of("core:hatchet").related.find((r) => r.relation === "Works")!.refs).toContainEqual({ id: "wiki:cactus" });
  expect(of("core:fiber").related.find((r) => r.relation === "Gathered from")!.refs).toContainEqual({ id: "wiki:cactus" });
  expect(of("wiki:prickled").related).toContainEqual({ relation: "Given by", refs: [{ id: "wiki:needle" }] });
  expect(of("wiki:needle").facts.find((f) => f.label === "Gives")!.value).toEqual([{ id: "wiki:prickled" }]);
  expect([of("hut").kind, of("hut").picture!.places]).toEqual(["landmarks", [[0, 0, 0, 0, 0]]]);
  expect(of("core:compact").related.find((r) => r.relation === "Moored at")!.refs).toEqual([{ id: "hut" }]);
});

test("every class of definition is ruled on: each has its entry, is shown within a page, or is left out for a reason given once", () => {
  expect(unruled()).toEqual([]);
  const ids = new Set(entries.map((e) => e.id));
  const pages = new Set(["items/", "levels/", "maps/", "maps/miami/", "maps/las-vegas/"]);
  const rulings = coverage({ defs: CORE_CONTENT, landmarks: LANDMARKS, has: (m) => m !== "box" && m !== "shape" && m !== "none", maps: new Set(["core:miami", "core:las-vegas"]) });
  for (const { def, ruling } of rulings) {
    if ("entry" in ruling) expect([def.id, ids.has(ruling.entry)]).toEqual([def.id, true]);
    else if ("within" in ruling) expect([def.id, ids.has(ruling.within) || pages.has(ruling.within)]).toEqual([def.id, true]);
  }
  for (const l of LANDMARKS) expect(ids.has(l.name)).toBe(true);
  expect(leftOut(rulings).map((l) => l.why)).toEqual(["scenery", "form", "standIn", "target", "unmade", "remains", "flight", "noFile"]);
  expect(leftOut(rulings).find((l) => l.why === "noFile")!.names).toEqual(["Tampa", "San Francisco", "Los Angeles"]);
  expect(() => coverage({ defs: [{ type: "prop", class: "seat", id: "wiki:chair" } as unknown as Def], landmarks: [], has: () => true, maps: new Set() })).toThrow("no ruling on prop/seat");
});

test("a world's settings change the figures they rule, worked out on the page as the build works them at the defaults", () => {
  const fifty: ServerSaid = { name: "A 50x server", map: "core:miami", settings: { TamingSpeedMultiplier: 50, HarvestAmountMultiplier: 50, ResourcesRespawnPeriodMultiplier: 0.2, XPMultiplier: 50, ItemStackSizeMultiplier: 10, OverrideOfficialDifficulty: 5 } };
  const taming = byId("core:pteranodon").tables.find((t) => t.title === "Taming")!;
  expect(tamingRows(taming.taming!)).toEqual(taming.rows as string[][]);
  expect(tamingRows(taming.taming!, fifty).at(-1)!.slice(0, 4)).toEqual(["150", "1,193", "19 min 12 s", "1 in 2 min 30 s"]);
  expect(tamingLevels({ ...fifty, settings: { OverrideOfficialDifficulty: 1 } })).toEqual([1, 6, 12, 18, 24, 30]);
  const banyan = byId("core:banyan");
  const cells = banyan.tables[0]!.rows.flat().filter((c): c is { rate: string; v: string; text: string } => typeof c === "object" && "rate" in c);
  for (const c of cells) expect(rated(c.rate, c.v)).toBe(c.text);
  expect(cells.map((c) => rated(c.rate, c.v, fifty))).toEqual(["100 to 200", "300 to 600", "0 to 50", "150 to 450"]);
  const fact = (e: string, label: string) => byId(e).facts.find((f) => f.label === label)!.value.find((c) => typeof c === "object" && "rate" in c) as { rate: string; v: string };
  expect(rated(fact("core:banyan", "Grows back").rate, fact("core:banyan", "Grows back").v, fifty)).toBe("12 min");
  expect(rated(fact("core:wood", "Stack").rate, fact("core:wood", "Stack").v, fifty)).toBe("1,000");
  expect(changed(["node", "taming", "spoil"], fifty)).toEqual([["HarvestAmountMultiplier", 50, 1], ["TamingSpeedMultiplier", 50, 1], ["OverrideOfficialDifficulty", 5, 0]]);
  // Each setting a figure reads is a public row that takes effect, at the default the page assumes of it.
  for (const [name, def] of Object.entries(RATE_DEFAULTS)) expect([name, publicSettings().find((s) => s.name === name)?.def]).toEqual([name, String(def)]);
});

test("a world tells the wiki its public settings and nothing else, and the page asks the world it was opened from", () => {
  const rules = new Rules();
  for (const [name, value] of [["ServerAdminPassword", "hunter2"], ["ServerPassword", "letmein"], ["PlayerDamageMultiplier", "3"], ["TamingSpeedMultiplier", "50"], ["SessionName", "Isle"], ["serverPVE", "True"]]) expect(rules.assign(name!, value!, "file")).toBe("");
  expect(publicValues(rules)).toEqual({ TamingSpeedMultiplier: 50, serverPVE: true });
  const host = { rules, world: { mapId: "core:miami", reg: compileContent(CORE_CONTENT).registry! } } as unknown as Host;
  const said: ServerSaid = worldSettings(host);
  expect(said).toEqual({ name: "Isle", map: "core:miami", settings: { TamingSpeedMultiplier: 50, serverPVE: true } });
  expect(JSON.stringify(said)).not.toMatch(/hunter2|letmein/);
  // A row that holds a password or a key is never one a player may know.
  for (const r of CATALOG) if (/password|key|token|secret/i.test(r.name)) expect([r.name, r.public]).toEqual([r.name, false]);
  expect(worldPath("?world=/miami", "", "https://play.example", null)).toBe("/miami");
  expect(worldPath("", "https://play.example/miami/", "https://play.example", null)).toBe("/miami");
  expect(worldPath("", "https://play.example/wiki/items/", "https://play.example", "/miami")).toBe("/miami");
  expect(worldPath("", "https://elsewhere.example/vegas/", "https://play.example", null)).toBe("");
  expect(worldPath("?world=../x", "", "https://play.example", null)).toBe("");
});

test("the controls page is the controls screen's own tables, and says how to get out of a seat", () => {
  const world = controlGroups().find((g) => g.name === "World")!;
  expect(world.keys.find((c) => c.keys.includes("E"))!.detail).toContain("get in or out of a seat");
  expect(world.pad.find((c) => c.title === "Use / ride")!.keys).toEqual(["Y / △"]);
  expect(controlGroups().map((g) => g.name)).toEqual([...CONTROL_GROUPS]);
});

test("the settings the wiki lists are the rows marked public, and every command family is registered", () => {
  expect(publicSettings().map((s) => s.name)).toContain("TamingSpeedMultiplier");
  expect(publicSettings().length).toBe(24);
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
      credits: new Map([["core:raptor", "Model and motion: from a CC0 1.0 pack."]]),
      atlases: [
        { id: "core:miami", slug: "miami", label: "Miami", metres: [8128, 8128], ground: card, card, resources: [], creatures: [], vehicles: [], regions: [], spawns: [], obelisks: [], landmarks: [{ of: "koru", name: "koru", x: 400, y: 500 }], districts: [], sources: [] },
        { id: "core:reno", slug: "reno", label: "Reno", metres: [12032, 8000], ground: card, card, resources: [], creatures: [], vehicles: [], regions: [], spawns: [], obelisks: [], landmarks: [], districts: [], sources: [] },
      ],
      sounds: [{ id: "core:raptor/sound/call", owner: "core:raptor", name: "Call", file: "core.snsd", at: 8, rate: 32000, takes: [[16000, 20], [24000, 30]], game: true }],
      heard: new Map([["core:raptor", ["core:raptor/sound/call"]]]),
      music: [],
      commands: commands(),
      settings: publicSettings(),
      engrams: [],
      levels: { xp: [0, 5, 20], points: [0, 8, 8] },
      controls: controlGroups(),
      left: [{ why: "noFile", count: 1, names: ["Tampa"] }],
      names: namesOf(entries),
    };
    const pages = renderWiki(site);
    for (const f of ["wiki/a.css", "wiki/a.js", "wiki/s.json", "assets/f.ttf", "wiki/media/raptor.card.png", "assets/core.snsd", "assets/hud-font-license.txt"]) {
      const file = join(dist, f);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "");
    }
    expect(() => checkLinks(pages, dist)).not.toThrow();
    // A landmark's home is its map: its dot, its row of the layers and its card under the map lead to its page, which leads back.
    const miami = pages.get("maps/miami/")!;
    expect(miami).toContain('<a href="/wiki/landmarks/koru/"><g class="landmark" transform="translate(400 500)"><circle r="5"/><text y="-9">Koru</text></g></a>');
    expect(miami).toContain('<a href="/wiki/landmarks/koru/">Koru</a>');
    expect(miami).toContain('<section><h2>Landmarks</h2><div class="cards"><a class="card" href="/wiki/landmarks/koru/">');
    expect(miami).toContain("<small>Sail control · 3 doors · a boat</small>");
    expect(pages.get("maps/")).toContain("<small>8.1 km across · Koru</small>");
    // A map that is not square is drawn in its own proportions: its box as deep as its width makes it, and its marks in that box.
    expect(miami).toContain('style="aspect-ratio:8128 / 8128"');
    expect(miami).toContain('<svg class="marks" viewBox="0 0 1000 1000"');
    expect(pages.get("maps/reno/")).toContain('style="aspect-ratio:12032 / 8000"');
    expect(pages.get("maps/reno/")).toContain('<svg class="marks" viewBox="0 0 1000 664.9"');
    expect(pages.get("maps/")).toContain("<small>12 by 8 km</small>");
    expect(pages.get("landmarks/koru/")).toContain('<h2>Where it stands</h2><ul class="places"><li><a href="/wiki/maps/miami/?show=landmarks">Miami</a>');
    const raptor = pages.get("creatures/raptor/")!;
    expect(raptor).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(raptor).not.toContain("<img src=x");
    expect(raptor).toContain('data-file="/assets/core.snsd" data-at="8" data-rate="32000" data-takes="16000:20 24000:30"');
    // A sound's takes are play buttons of one group, each saying what it plays and how long, filling over that time.
    expect(raptor).toContain('<span class="takes" role="group" aria-label="Raptor call, 2 takes">');
    expect(raptor).toContain('<button type="button" class="take" data-k="1" aria-pressed="false" aria-label="Play raptor call, take 2 of 2, 0.75 s" style="--d:0.750s"><b>2</b><small>0.75 s</small></button>');
    for (const html of pages.values()) expect(html).toStartWith("<!doctype html>");
    expect(pages.get("creatures/pteranodon/")).toContain('<span data-figure="hatch" data-v="');
    expect(pages.get("creatures/pteranodon/")).toContain("<table data-taming=");
    expect(pages.get("settings/")).toContain('<td data-setting="TamingSpeedMultiplier">1</td>');
    expect(pages.get("")).toContain("Not in the wiki: maps still being made: Tampa.");
    expect(pages.get("controls/")).toContain("get in or out of a seat");
    expect(() => checkLinks(new Map([["a/", '<a href="/wiki/b/">b</a>']]), dist)).toThrow("names /wiki/b/");
    // The site's own pages are answered by the server; any other page outside the wiki is not there.
    expect(pages.get("")).toContain('<a href="/source/">');
    expect(() => checkLinks(new Map([["a/", '<a href="/sauce/">b</a>']]), dist)).toThrow("names /sauce/");
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("the front page and the maps page list every map, and read from a server say which its cluster runs, those first", () => {
  const card = { file: "/wiki/media/m.card.png", width: 240, height: 240 };
  const atlases = [["miami", "Miami"], ["tampa", "Tampa"], ["san-francisco", "San Francisco"], ["los-angeles", "Los Angeles"], ["las-vegas", "Las Vegas"], ["reno", "Reno"]].map(([slug, label]) => ({
    id: `core:${slug}`, slug: slug!, label: label!, metres: [8128, 8128] as [number, number], ground: card, card, resources: [], creatures: [], vehicles: [], regions: [], spawns: [], obelisks: [], landmarks: [], districts: [], sources: [],
  }));
  const pages = renderWiki({
    assets: { css: "/wiki/a.css", js: "/wiki/a.js", search: "/wiki/s.json", font: "/assets/f.ttf", revision: "abc" },
    entries: [], pictures: new Map(), credits: new Map(), atlases, sounds: [], heard: new Map(), music: [], commands: [], settings: [], engrams: [], levels: null, controls: [], left: [], names: new Map(),
  });
  const cardsOf = (html: string) => [...html.matchAll(/<div class="card map" data-map="([^"]+)">.*?<\/a><\/div>/g)].map((m) => [m[1]!, m[0]] as const);
  for (const path of ["", "maps/"]) expect([path, cardsOf(pages.get(path)!).map(([id]) => id)]).toEqual([path, atlases.map((a) => a.id)]);
  // The creatures and vehicles on the front page are a selection, and it says so.
  expect(pages.get("")).toContain('<h2>The creatures and vehicles met most</h2><div class="cards"></div><p class="note"><a href="/wiki/creatures/">Every creature</a> · <a href="/wiki/vehicles/">Every vehicle</a></p>');
  // A cluster of two worlds on Las Vegas, and one on a map this build has no page for.
  const worlds: LiveWorld[] = [
    { name: "Vegas <Night>", map: "Las Vegas", mapId: "core:las-vegas", address: "/vegas/", players: 3, max: 70 },
    { name: "Atlantis", map: "Atlantis", mapId: "core:atlantis", address: "//play.example:8799/", players: 70, max: 70 },
    { name: "Vegas Day", map: "Las Vegas", mapId: "core:las-vegas", address: "javascript:alert(1)", players: 0, max: 10 },
  ];
  const live = liveMaps(cardsOf(pages.get("")!), worlds, true);
  expect([...live.matchAll(/ data-map="([^"]+)"/g)].map((m) => m[1])).toEqual(["core:las-vegas", "core:atlantis", "core:miami", "core:tampa", "core:san-francisco", "core:los-angeles", "core:reno"]);
  expect(live).toContain('<b>Las Vegas</b><small>8.1 km across</small></a><span class="live">Running: <a href="/vegas/">Vegas &#60;Night&#62;</a>, 3 of 70 online</span><span class="live">Running: Vegas Day, 0 of 10 online</span></div>');
  expect(live).toContain('<div class="card map" data-map="core:atlantis"><span class="blank">A</span><b>Atlantis</b><small>Its page is not built here</small><span class="live">Running: <a href="//play.example:8799/">Atlantis</a>, full, 70 of 70</span></div>');
  expect(live.match(/<span class="live">Not running here<\/span><\/div>/g)!.length).toBe(5);
  // A map's own page says it of itself alone.
  const own = (slug: string) => [...pages.get(`maps/${slug}/`)!.matchAll(/<div class="note" data-map="([^"]+)"><\/div>/g)].map((m) => [m[1]!, m[0]] as const);
  expect(liveMaps(own("las-vegas"), worlds.slice(0, 2), false)).toBe('<div class="note" data-map="core:las-vegas"><span class="live">Running: <a href="/vegas/">Vegas &#60;Night&#62;</a>, 3 of 70 online</span></div>');
  expect(liveMaps(own("tampa"), worlds, false)).toBe('<div class="note" data-map="core:tampa"><span class="live">Not running here</span></div>');
});

test("a press asks for a sound's takes alone, by range of the game's file, and gets each take's samples", async () => {
  const row = { file: "/assets/core.snsd", at: "100", takes: "3:5 2:7" };
  expect(takeRange(row)).toEqual({ from: 100, to: 111, sizes: [{ samples: 3, bytes: 5 }, { samples: 2, bytes: 7 }] });
  const asked: string[] = [];
  const get = async (url: string, init: { headers: Record<string, string> }) => (asked.push(`${url} ${init.headers.range}`), { status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
  await expect(takeSamples(row, get)).rejects.toThrow("the server sent 200 for a range of /assets/core.snsd");
  expect(asked).toEqual(["/assets/core.snsd bytes=100-111"]);
});

test("search ranks a label that begins with the query first; the map stays over its view", () => {
  const rows: SearchRow[] = [["Raptor saddle", "/a/", "Saddle", ""], ["Raptor", "/b/", "Creature", ""], ["Pistol", "/c/", "Weapon", ""]];
  expect(findRows(rows, "rap").map((r) => r[0])).toEqual(["Raptor", "Raptor saddle"]);
  expect(findRows(rows, "saddle rap").map((r) => r[0])).toEqual(["Raptor saddle"]);
  expect(findRows(rows, " ")).toEqual([]);
  // Every match is listed, however many.
  expect(findRows(Array.from({ length: 500 }, (_, k): SearchRow => [`Rock ${k}`, `/r/${k}/`, "Resource", ""]), "rock").length).toBe(500);
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
