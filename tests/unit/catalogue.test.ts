// The class table: sound in itself, and true of the content that exists.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { RUIN_BLOCKS } from "../../content/miami-ruins.ts";
import { SLOPE_BLOCKS, SLOPE_SHAPES } from "../../content/slopes.ts";
import { LETTER_BLOCKS } from "../../content/lettering.ts";
import { TERMINALS } from "../../content/terminals.ts";
import { MARINE_FLEET } from "../../content/vehicles/marine-fleet.ts";
import { HARBOUR_WRECKS } from "../../content/vehicles/harbour-wrecks.ts";
import { STREET } from "../../content/street.ts";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { WRECKS } from "../../content/vehicles/wrecks.ts";
import { EVENTS } from "../../server/events/catalog.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { CLASSES, FIELDS, classFaults, classOf, defFaults, type Field } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compilePacks, type ContentPack } from "../../shared/content/packs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { FEATURES } from "../../shared/features.ts";
import { CORE_PACK } from "../../content/core.ts";
import { CREATURES } from "../../content/creatures/index.ts";
import { CORPSES } from "../../content/corpses.ts";
import { EGGS } from "../../content/eggs.ts";
import { FOODS } from "../../content/foods.ts";
import { KNOCKOUT } from "../../content/knockout.ts";
import { ITEMS } from "../../content/items/index.ts";
import { CATALOGUE_PAGE, cataloguePage } from "../../tools/catalogue.ts";
import { artTest } from "../fixtures/needs-art.ts";

// What the creature files bring is counted apart, so a new creature moves no number here, and so is what the files of
// the creature features and of the item and weapons programs (content/items) bring, so that those built side by side do
// not each move the same numbers.
const FEATURES_CONTENT = [...KNOCKOUT, ...CORPSES, ...EGGS, ...FOODS, ...ITEMS];
const ofCreatures = new Set([...CREATURES, ...FEATURES_CONTENT].map((d) => `${d.type} ${d.id}`));
const rest = CORE_CONTENT.filter((d) => !ofCreatures.has(`${d.type} ${d.id}`));
const classes = CORE_CONTENT.map(classOf);

test("the class table is sound: parents exist, stubs name what they wait for, slots have fallbacks, references name classes", () => {
  expect(classFaults()).toEqual([]);
  // A definition type and the table's families agree.
  expect(Object.keys(FIELDS).filter((type) => !CLASSES.some((r) => r.type === type))).toEqual([]);
});

test("the core pack's definitions fall into the classes, each passing its row", () => {
  const counts: Record<string, number> = {};
  for (const d of rest) counts[classOf(d)] = (counts[classOf(d)] ?? 0) + 1;
  // The stations wave moved cementing paste and its engram to content/items/resources.ts, and took the ingot's engram out
  // (planning/reference/stations-plan.md, S0): a resource and two engrams fewer here.
  expect(counts).toEqual({
    "item/resource": 10,
    "item/consumable": 4,
    "item/weapon": 3,
    "item/armor": 25,
    "item/structure": 29,
    "item/vehicle": 2,
    engram: 60,
    levels: 1,
    "species/survivor": 1,
    "species/target": 1,
    // The car, and the civilian who may drive one (content/vehicles, content/civilians.ts).
    "species/vehicle": 12 + MARINE_FLEET.length,
    "species/civilian": 1,
    // And three road surfaces to drive on, on a paving shape of their own.
    "structure/piece": 36,
    "structure/container": 3,
    "structure/station": 2,
    "structure/bed": 3,
    // And the street wrecks, a shape each look and a static each of its kinds (content/vehicles/wrecks.ts), and the
    // harbours', a shape each vessel and a static each of its hulk and forms (content/vehicles/harbour-wrecks.ts), and
    // the street furniture, a shape and a static each piece (content/street.ts).
    "structure/static": 8 + RUIN_BLOCKS.filter((d) => d.type === "structure").length + TERMINALS.filter((d) => d.type === "structure").length + SLOPE_SHAPES.length + LETTER_BLOCKS.length / 2 + WRECKS.filter((d) => d.type === "structure").length + HARBOUR_WRECKS.filter((d) => d.type === "structure").length + STREET.filter((d) => d.type === "structure").length,
    shape: 17 + TERMINALS.filter((d) => d.type === "shape").length + RUIN_BLOCKS.filter((d) => d.type === "shape").length + SLOPE_SHAPES.length + LETTER_BLOCKS.length / 2 + WRECKS.filter((d) => d.type === "shape").length + HARBOUR_WRECKS.filter((d) => d.type === "shape").length + STREET.filter((d) => d.type === "shape").length,
    material: 4,
    node: 14,
    "prop/container": 2,
    "prop/projectile": 2,
    buff: 7,
    spawns: 4,
    map: 6,
  });
  expect(rest.length).toBe(251 + ROAD_FLEET.length + MARINE_FLEET.length + RUIN_BLOCKS.length + TERMINALS.length + SLOPE_BLOCKS.length + LETTER_BLOCKS.length + WRECKS.length + HARBOUR_WRECKS.length + STREET.length);
  // Each creature file has one species, and what else it has is the egg it lays, its saddle and how the saddle is made.
  expect(CORE_CONTENT.length).toBe(rest.length + CREATURES.length + FEATURES_CONTENT.length);
  const brought: Record<string, number> = {};
  for (const d of CREATURES) brought[classOf(d)] = (brought[classOf(d)] ?? 0) + 1;
  expect(Object.keys(brought).filter((c) => !["species/creature", "prop/egg", "item/egg", "item/saddle", "engram"].includes(c))).toEqual([]);
  const files = readdirSync(join(import.meta.dir, "../../content/creatures")).filter((f) => f !== "index.ts");
  expect(brought["species/creature"], "every file in content/creatures has one species and is listed in index.ts").toBe(files.length);
  expect(CORE_CONTENT.flatMap(defFaults)).toEqual([]);
  expect(compileContent(CORE_CONTENT).errors).toEqual([]);
});

test("a class that is built has content, a stub has none, and each kind of fault is named", () => {
  const used = new Set(classes);
  for (const r of CLASSES) {
    if (r.abstract) continue;
    // A rename is not content: the core pack has none.
    if (r.status === "built" && r.id !== "rename") expect([r.id, used.has(r.id)]).toEqual([r.id, true]);
    if (r.status === "stub") expect([r.id, used.has(r.id)]).toEqual([r.id, false]);
  }
});

test("a definition says its class, and its class says what it may be", () => {
  const spear = CORE_CONTENT.find((d) => d.id === "core:spear")!;
  const as = (more: Record<string, unknown>): string[] => defFaults({ ...spear, ...more } as Def);
  expect(as({ eat: { food: 1 } })).toEqual(['core:spear: class item/weapon may not declare "eat"']);
  expect(as({ weapon: undefined })).toEqual(['core:spear: class item/weapon must declare "weapon"']);
  expect(as({ class: "consumable" })).toEqual(['core:spear: class item/consumable must declare one of "eat", "dose", "use"', 'core:spear: class item/consumable may not declare "weapon"']);
  expect(as({ weight: "heavy", weapon: [] })).toEqual(['core:spear: "weight" must be a number', 'core:spear: "weapon" must be a group of fields']);
  expect(as({ class: "sword" })[0]).toContain('an item says its class: resource, consumable, weapon');
  expect(as({ class: undefined })[0]).toContain("an item says its class: resource");
  expect(as({ class: "equipment" })[0]).toContain("an item says its class");
  expect(as({ type: "thing" })).toEqual(['core:spear: unknown type "thing"']);
  expect(defFaults({ type: "node", class: "tree", id: "t:n" } as unknown as Def)).toEqual(['t:n: a node has no class, not "tree"']);
  // The same checks stop a pack and stop a compile.
  expect(compilePacks([{ name: "mod", defs: [{ id: "mod:odd", type: "item", class: "weapon", stack: 1, eat: { food: 1 } }] }]).errors).toEqual(['mod:odd: class item/weapon must declare "weapon"', 'mod:odd: class item/weapon may not declare "eat"']);
  expect(compileContent([{ ...spear, eat: { food: 1 } } as Def]).errors).toContain('core:spear: class item/weapon may not declare "eat"');
});

test("every feature that is not built is waited for: by a setting, a class of content or an event", () => {
  const waited = new Set<string>([...CATALOG.filter((r) => r.status === "planned").map((r) => r.waits), ...CLASSES.map((r) => r.waits), ...EVENTS.map((r) => r.waits)]);
  expect(Object.keys(FEATURES).filter((f) => !waited.has(f))).toEqual([]);
});

artTest("the reference page is what the table generates", () => {
  expect(readFileSync(CATALOGUE_PAGE, "utf8")).toBe(cataloguePage());
});

/** One of everything that has a row and no content yet. */
const STUBS: ContentPack = {
  name: "stub",
  requires: ["core"],
  defs: [
    { id: "stub:shield", type: "item", class: "shield", stack: 1, description: "Blocks.", folder: "Armor/Shields", blueprint: true, craft: { needs: [{ item: "core:wood", count: 20 }], seconds: 8, xp: 4, at: "core:campfire", level: 80 } },
    { id: "stub:hat", type: "item", class: "costume", stack: 1 },
    { id: "stub:skin", type: "item", class: "skin", stack: 1 },
    { id: "stub:dye", type: "item", class: "dye", stack: 100, color: 3 },
    { id: "stub:relic", type: "item", class: "artifact", stack: 1 },
    { id: "stub:spikes", type: "structure", class: "defence", mesh: "box", color: 3, half: [0.5, 0.5, 0.5], hp: 300 },
    { id: "stub:crate", type: "prop", class: "crate", mesh: "box", color: 6, radius: 0.5, height: 1, slots: 20 },
    { id: "stub:smoke", type: "prop", class: "cloud", mesh: "box", color: 2, radius: 4.5, height: 3 },
    { id: "stub:poison", type: "damage", label: "poison", torpor: 2, trueShare: 1 },
    { id: "stub:drop", type: "loot", sets: { min: 1, max: 2 }, from: [{ min: 1, max: 3, entries: [{ items: ["core:stone", "stub:relic"], min: 1, max: 20, quality: [1, 3], blueprint: 0.25 }] }] },
    { id: "stub:beach", type: "spawns", entries: [{ group: ["core:parasaur"], weight: 3 }, { name: "Alphas", group: ["stub:alpha", "core:raptor"], chances: [1, 0.5], offsets: [[0, 2], [0, -2]], weight: 0.1 }], limits: [{ species: "stub:alpha", share: 0.05 }] },
    { id: "stub:alpha", extends: "core:raptor", tag: "raptor", variant: "alpha", boss: true, loot: "stub:drop", buffs: ["core:fed"], saddle: "core:saddle_raptor", attacks: [{ name: "bite", damage: 60, type: "melee", reach: 2, ticks: 27, lands: 11 }] },
    { id: "stub:rules", type: "game", survivor: "core:survivor", cache: "core:cache", bag: "core:bag", levels: "core:levels", buffs: ["core:fed"] },
    { id: "stub:island", type: "map", label: "The island", seaLevel: 0, game: "stub:rules", zones: [{ kind: "spawn", at: [100, 100], radius: 80, spawns: "stub:beach", count: 12 }, { kind: "crate", at: [300, 200], radius: 40, crate: "stub:crate" }] },
    { id: "stub:engram-shield", type: "engram", label: "Shield", level: 80, cost: 0, item: "stub:shield", requires: ["core:engram-spear"], group: "island", from: "stub:alpha" },
  ],
};

test("one of every stub class and stub field compiles beside the core pack, and what it names is checked", () => {
  const made = compilePacks([CORE_PACK, STUBS]);
  expect(made.errors).toEqual([]);
  const reg = made.registry!;
  expect(STUBS.defs.filter((d) => !reg.index.has(d.id)).map((d) => d.id)).toEqual([]);
  // Every stub class of the table is in the pack, so a new one must be given a definition here.
  const used = new Set(reg.defs.flatMap((d) => (d ? [classOf(d)] : [])));
  expect(CLASSES.filter((r) => !r.abstract && r.status !== "built" && !used.has(r.id)).map((r) => r.id)).toEqual([]);

  const bad = (id: string, more: Record<string, unknown>): string[] => compilePacks([CORE_PACK, { ...STUBS, defs: STUBS.defs.map((d) => (d.id === id ? { ...d, ...more } : d)) }]).errors;
  expect(bad("stub:beach", { entries: [{ group: ["core:stone"], weight: 1 }] })).toEqual(['stub:beach: "core:stone" is not a species/creature']);
  expect(bad("stub:beach", { entries: [{ group: ["core:raptor"], chances: [2], weight: 1 }, { group: [], weight: 1 }] })).toEqual(["stub:beach: an entry's chances are one for each of its group, each from 0 to 1", "stub:beach: an entry needs a weight of at least 0 and a group of at least one"]);
  expect(bad("stub:island", { zones: [{ kind: "spawn", at: [0, 0], radius: 1, spawns: "stub:beach" }] })).toEqual(["stub:island: a zone that names spawns says how many it holds, and only such a zone does"]);
  expect(bad("stub:beach", { limits: [{ species: "core:survivor", share: 1 }] })).toEqual(['stub:beach: "core:survivor" is not a species/creature']);
  expect(bad("stub:island", { zones: [{ kind: "crate", at: [0, 0], radius: 1, crate: "core:cache" }] })).toEqual(['stub:island: "core:cache" is not a prop/crate']);
  expect(bad("stub:rules", { survivor: "core:raptor" })).toEqual(['stub:rules: "core:raptor" is not a species/survivor']);
  expect(bad("stub:drop", { from: [{ min: 1, max: 1, entries: [{ items: ["core:raptor"], min: 1, max: 1 }] }] })).toEqual(['stub:drop: "core:raptor" is not an item']);
  expect(bad("stub:engram-shield", { from: "core:stone" })).toEqual(['stub:engram-shield: "core:stone" is not a species/creature']);
  // An engram teaches one thing, that can be made, and that no other engram teaches.
  expect(bad("stub:engram-shield", { item: "stub:relic" })).toEqual(['stub:engram-shield: "stub:relic" cannot be made, so there is nothing to learn']);
  expect(bad("stub:engram-shield", { item: "core:spear" })).toEqual(['stub:engram-shield: core:engram-spear already unlocks "core:spear"']);
  expect(bad("stub:shield", { craft: { needs: [{ item: "core:wood", count: 1 }], seconds: 1, xp: 1, at: "core:wall_wood" } })).toEqual(['stub:shield: "core:wall_wood" is not a structure/station']);
  expect(bad("stub:alpha", { saddle: "core:hide_hat" })).toEqual(['stub:alpha: "core:hide_hat" is not an item/saddle']);
  expect(bad("stub:alpha", { loot: "nowhere:x" })).toEqual(['stub:alpha: "nowhere:x" is not a loot']);
  expect(bad("stub:poison", { trueShare: "all" })).toEqual(['stub:poison: "trueShare" must be a number']);
  expect(bad("stub:island", { weather: "rain" })).toEqual(['stub:island: class map may not declare "weather"']);
});

test("every field that is not a stub is read by some code", () => {
  const files: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts") && !path.endsWith("content/classes.ts") && !path.endsWith("content/defs.ts")) files.push(path);
    }
  };
  for (const folder of ["shared", "server", "client/core", "tools/pack"]) walk(join(import.meta.dir, "../..", folder));
  const code = files.map((path) => readFileSync(path, "utf8")).join("\n");
  const unread: string[] = [];
  for (const [type, fields] of Object.entries(FIELDS)) {
    for (const [name, field] of Object.entries(fields)) {
      // A field only stub classes allow waits with them.
      const built = CLASSES.some((r) => r.type === type && r.status !== "stub" && (r.must.includes(name) || r.may.includes(name)));
      if (built && (field as Field).waits === undefined && !new RegExp(`\\.${name}\\b`).test(code)) unread.push(`${type}.${name}`);
    }
  }
  expect(unread).toEqual([]);
});
