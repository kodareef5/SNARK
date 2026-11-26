// What the drop book's admin page shows (client/core/drops/view.ts): the matrix, a table opened, what the book waits
// for and a simulation, from a book and the catalogue as the server sends it.

import { expect, test } from "bun:test";
import { OFF_TARGET, catalogOfWire, css, load, matrix, nameOf, num, pct, setsOf, simulation, sourceRows, tableDetail, waitingRows, type CatalogWire } from "../../client/core/drops/view.ts";
import { starterBook } from "../../content/supply/starter.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { compileBook } from "../../shared/supply/compile.ts";
import { simulate } from "../../shared/supply/simulate.ts";
import { coreRegistry } from "../fixtures/world.ts";

const game = catalogOf(coreRegistry());
/** The catalogue through JSON, as catalog.json carries it. */
const wire = JSON.parse(JSON.stringify({ items: game.byIndex.filter((i) => i !== undefined), renamed: [...game.renamed] })) as CatalogWire;
const catalog = catalogOfWire(wire);
const book = starterBook();
const l = load(book, catalog);

test("the catalogue the page rebuilds from the wire is the server's: a book compiles to the same tables against either", () => {
  expect([catalog.byId.size, catalog.byIndex.length]).toEqual([game.byId.size, game.byIndex.length]);
  const [a, b] = [compileBook(book, game), compileBook(book, catalog)];
  expect([...b.tables].map(([k, t]) => [k, Math.round(t.worth), t.dormant])).toEqual([...a.tables].map(([k, t]) => [k, Math.round(t.worth), t.dormant]));
  expect(b.report).toEqual(a.report);
  expect([nameOf(l, "core:pike"), nameOf(l, "core:raft_assembly"), nameOf(l, "mod:strange_thing")]).toEqual(["pike", "Wooden Raft", "strange thing"]);
});

test("the matrix is a row a tier and a cell a class, each against its target, with what it waits for", () => {
  const m = matrix(l);
  expect([m.length, m.every((row) => row.length === 7 && row.every((c) => c !== null))]).toEqual([7, true]);
  const cells = m.flat().map((c) => c!);
  expect(cells.map((c) => c.key).slice(0, 8)).toEqual(["white/shelter", "white/arms", "white/armour", "white/stable", "white/works", "white/provisions", "white/voyage", "green/shelter"]);
  // The starter book holds every table to its target, so none is lean, rich or dormant; a few rolls measure each.
  for (const c of cells) expect([c.key, c.health, Math.abs(c.designed / c.target - 1) <= OFF_TARGET, c.least > 0, c.ringed > 1, c.stacks > 0]).toEqual([c.key, "ok", true, true, true, true]);
  // The raft is all it waits for, and the Voyage tables that name it say so.
  expect(cells.filter((c) => c.waiting > 0).map((c) => [c.key, c.waiting])).toEqual([["green/voyage", 1], ["blue/voyage", 1], ["purple/voyage", 1]]);
  expect(cells.filter((c) => c.jackpot > 0).map((c) => c.key)).toEqual(["yellow/voyage", "red/voyage", "meridian/voyage"]);
  // A table made thin goes dormant, one made fat is rich, and a pair with no table is no cell.
  const thin = structuredClone(book);
  thin.tables["white/arms"]!.slots = thin.tables["white/arms"]!.slots.slice(-1);
  for (const e of thin.sets["staple.white"]!.entries) [e.min, e.max] = [1, 1];
  for (const e of thin.sets["kit.arms.red"]!.entries) [e.min, e.max] = [e.min * 30, e.max * 30];
  delete thin.tables["green/arms"];
  const t = matrix(load(thin, catalog));
  expect([t[0]![1]!.health, t[5]![1]!.health, t[1]![1], t[1]![0]!.health]).toEqual(["dormant", "rich", null, "ok"]);
});

test("a table opens to its slots, their sets and each set's entries, with what has left it marked", () => {
  const slots = tableDetail(l, "blue/voyage");
  expect(slots.map((s) => [s.name, s.chance, s.ringed, s.sets.map((x) => x.key)])).toEqual([
    ["kit", 1, 1, ["kit.voyage.blue"]],
    ["prize", 1, 1, ["prize.voyage.blue"]],
    ["echo", 0.35, 1, ["prize.voyage.green"]],
    // A ringed drop's second prize: no chance in a plain one.
    ["second prize", 0, 1, ["prize.voyage.blue"]],
    ["staples", 1, 1, ["staple.blue"]],
  ]);
  const [kit, prize] = [slots[0]!.sets[0]!, slots[1]!.sets[0]!];
  expect([kit.gives, kit.share, kit.entries.every((e) => e.share === 1), kit.entries.filter((e) => e.ballast).length]).toEqual(["every line", 1, true, 1]);
  // The prize is one of its lines by weight: the shares come to 1, and the raft's line is marked gone.
  expect([prize.gives.startsWith("1 of "), Math.round(prize.entries.reduce((n, e) => n + e.share, 0) * 1000) / 1000]).toEqual([true, 1]);
  const raft = prize.entries.find((e) => e.items[0]!.id === "core:raft_assembly")!;
  expect([raft.gone, raft.items[0]!.name, raft.items[0]!.has, raft.each, prize.entries.filter((e) => e.gone).length]).toEqual([true, "Wooden Raft", false, 600, 1]);
  // What a line says of quality and blueprints, in words.
  const arms = tableDetail(l, "yellow/arms")[1]!.sets[0]!.entries;
  expect([arms.find((e) => e.items[0]!.id === "core:pistol")!.quality, arms.find((e) => e.items[0]!.id === "core:pistol")!.blueprint, arms.find((e) => e.items[0]!.id === "core:pistol_fabricated")!.blueprint]).toEqual(["the tier's quality", "a blueprint 20 in 100", "always a blueprint"]);
  expect([tableDetail(l, "no/table"), setsOf(book, "white/arms")]).toEqual([[], ["kit.arms.white", "prize.arms.white", "staple.white"]]);
});

test("what the book waits for is listed with where it would drop and how often", () => {
  const rows = waitingRows(l);
  expect(rows.map((r) => [r.id, r.name, r.why, r.level, r.page, r.cells])).toEqual([["core:raft_assembly", "Wooden Raft", "future", 16, "https://ark.wiki.gg/wiki/Wooden_Raft", ["green/voyage", "blue/voyage", "purple/voyage"]]]);
  // As designed it would come oftenest in blue Voyage, in a few drops of a hundred.
  expect([rows[0]!.most!.key, rows[0]!.most!.share > 0.02, rows[0]!.most!.share < 0.25]).toEqual(["blue/voyage", true, true]);
  // A book that names something nothing knows lists it as unknown, with no level and nowhere to read of it.
  const odd = structuredClone(book);
  odd.sets["kit.arms.white"]!.entries.push({ items: ["mod:laser_sword"], min: 1, max: 1 });
  const unknown = waitingRows(load(odd, catalog)).find((r) => r.id === "mod:laser_sword")!;
  expect([unknown.why, unknown.name, unknown.level, unknown.page, unknown.cells, unknown.most]).toEqual(["unknown", "laser sword", 0, "", ["white/arms"], null]);
});

test("a simulation's figures: the rolls' worth against the target, each thing's share, the quality mix and the bars", () => {
  const sim = simulation(l, "purple/arms", false, 3000, 7)!;
  expect([sim.target, Math.abs(sim.mean - 1) < 0.15, sim.least > 0.4, sim.most > sim.mean, sim.stats.n]).toEqual([1600, true, true, true, 3000]);
  // Every roll has its kit: the first things are in all of them. Shares fall from there, and each is a share of rolls.
  expect([sim.items[0]!.share, sim.items.every((i, k) => k === 0 || i.share <= sim.items[k - 1]!.share), sim.items.every((i) => i.share > 0 && i.share <= 1 && i.each >= 1 && i.name.length > 0)]).toEqual([1, true, true]);
  expect([sim.bars.length, Math.max(...sim.bars), sim.from === sim.stats.min, sim.to === sim.stats.max]).toEqual([20, 1, true, true]);
  const mix = sim.quality.reduce((n, q) => n + q.share, 0);
  expect([Math.abs(mix - 1) < 1e-9, sim.quality.every((q) => q.name.length > 0)]).toEqual([true, true]);
  // The same seed gives the same rolls; ringed is richer; as designed, blue Voyage has the raft.
  expect(simulation(l, "purple/arms", false, 3000, 7)!.stats.mean).toBe(sim.stats.mean);
  expect(simulation(l, "purple/arms", true, 3000, 7)!.stats.mean).toBeGreaterThan(sim.stats.mean * 1.3);
  const has = (designed: boolean): boolean => simulation(l, "blue/voyage", false, 4000, 3, designed)!.items.some((i) => i.id === "core:raft_assembly");
  expect([has(false), has(true), simulation(l, "no/table", false, 10, 1)]).toEqual([false, true, null]);
  expect([num(12800), num(999.6), num(1234567), pct(0.424), pct(0.004), pct(0), css(0x3a8cff), css(0xff)]).toEqual(["12,800", "1,000", "1,234,567", "42%", "under 1%", "0%", "#3a8cff", "#0000ff"]);
});

test("the simulator rolls a table as this world's server does: at its SupplyCrateLootQualityMultiplier, which the matrix leaves out", () => {
  const twice = load(book, catalog, 50, 2);
  // What the server compiles and rolls (server/supply.ts compiled), by the same seed.
  const server = compileBook(book, catalog, { quality: 2 });
  const rolled = simulate(server, server.tables.get("red/arms")!, false, 5000, 11);
  const page = simulation(twice, "red/arms", false, 5000, 11)!;
  expect([page.stats.mean, page.stats.quality]).toEqual([rolled.mean, rolled.quality]);
  // It is richer than the book alone, which the page still shows where asked and holds its tables to their targets by.
  const plain = simulation(twice, "red/arms", false, 5000, 11, false, false, false)!;
  expect([plain.stats.mean, page.stats.mean > plain.stats.mean * 1.1, twice.quality]).toEqual([simulation(l, "red/arms", false, 5000, 11)!.stats.mean, true, 2]);
  const held = (of: ReturnType<typeof load>): (number | undefined)[] => matrix(of).flat().map((c) => c?.designed);
  expect([held(twice), twice.today === twice.world.today, l.world.today === l.today, l.quality]).toEqual([held(load(book, catalog, 50)), false, true, 1]);
});


test("world loot's sources are listed with what each is the loot of, what it rolls and its worth at every tier", () => {
  const rows = sourceRows(l);
  expect(rows.map((r) => [r.key, r.on, r.what, r.tables])).toEqual([
    ["body/any", true, "any body", "body/scraps"],
    ["body/medium", true, "a medium body", "provisions prize, stable prize"],
    ["body/large", true, "a large body", "provisions prize, works prize, stable prize"],
    ["body/apex", true, "an apex body", "arms prize, armour prize, stable prize, works prize"],
  ]);
  const apex = rows[3]!;
  expect(apex.tiers.map((t) => t.name)).toEqual(["White", "Green", "Blue", "Purple", "Yellow", "Red"]);
  // A tier's worth doubles, and so does what an apex body gives.
  for (const t of apex.tiers) expect([t.health, t.worth > t.target! * 0.65, t.worth < t.target! * 1.35]).toEqual(["ok", true, true]);
  expect(rows[0]!.tiers.map((t) => [t.name, t.target])).toEqual([["", 4.3]]);
  // A narrower source says its species and levels, and one whose worth is far from its target says so.
  const narrow = { ...book, sources: [{ ...book.sources![3]!, when: { species: ["core:rex"], level: [100, 150] as [number, number] }, share: 0.9 }] };
  const [row] = sourceRows(load(narrow, catalog, 10));
  expect([row!.what, row!.tiers[0]!.health]).toEqual(["the body of a rex, level 100 to 150", "lean"]);
});
