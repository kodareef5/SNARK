// The class table: sound in itself, and true of the content that exists.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { EVENTS } from "../../server/events/catalog.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { CLASSES, FIELDS, classFaults, classOf, defFaults, type Field } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compilePacks, type ContentPack } from "../../shared/content/packs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { FEATURES } from "../../shared/features.ts";
import { CORE_PACK } from "../../content/core.ts";
import { CATALOGUE_PAGE, cataloguePage } from "../../tools/catalogue.ts";

const classes = CORE_CONTENT.map(classOf);

test("the class table is sound: parents exist, stubs name what they wait for, slots have fallbacks, references name classes", () => {
  expect(classFaults()).toEqual([]);
  // A definition type and the table's families agree.
  expect(Object.keys(FIELDS).filter((type) => !CLASSES.some((r) => r.type === type))).toEqual([]);
});

test("the core pack's 301 definitions fall into the classes, each passing its row", () => {
  const counts: Record<string, number> = {};
  for (const c of classes) counts[c] = (counts[c] ?? 0) + 1;
  expect(counts).toEqual({
    "item/resource": 11,
    "item/consumable": 5,
    "item/weapon": 8,
    "item/ammo": 7,
    "item/attachment": 4,
    "item/armor": 20,
    "item/saddle": 2,
    "item/structure": 27,
    recipe: 73,
    engram: 57,
    levels: 1,
    "species/survivor": 1,
    "species/creature": 3,
    "species/target": 1,
    "structure/piece": 33,
    "structure/container": 3,
    "structure/station": 2,
    "structure/bed": 1,
    "structure/static": 8,
    shape: 14,
    material: 4,
    node: 3,
    "prop/container": 2,
    "prop/projectile": 2,
    "prop/egg": 2,
    buff: 7,
  });
  expect(CORE_CONTENT.length).toBe(301);
  expect(CORE_CONTENT.flatMap(defFaults)).toEqual([]);
  expect(compileContent(CORE_CONTENT).errors).toEqual([]);
});

test("a class that is built has content, a stub has none, and each kind of fault is named", () => {
  const used = new Set(classes);
  for (const r of CLASSES) {
    if (r.abstract) continue;
    if (r.status === "built") expect([r.id, used.has(r.id)]).toEqual([r.id, true]);
    if (r.status === "stub") expect([r.id, used.has(r.id)]).toEqual([r.id, false]);
  }
});

test("a definition says its class, and its class says what it may be", () => {
  const spear = CORE_CONTENT.find((d) => d.id === "core:spear")!;
  const as = (more: Record<string, unknown>): string[] => defFaults({ ...spear, ...more } as Def);
  expect(as({ eat: { food: 1 } })).toEqual(['core:spear: class item/weapon may not declare "eat"']);
  expect(as({ weapon: undefined })).toEqual(['core:spear: class item/weapon must declare "weapon"']);
  expect(as({ class: "consumable" })).toEqual(['core:spear: class item/consumable must declare one of "eat", "dose"', 'core:spear: class item/consumable may not declare "weapon"']);
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

test("the reference page is what the table generates", () => {
  expect(readFileSync(CATALOGUE_PAGE, "utf8")).toBe(cataloguePage());
});

/** One of everything that has a row and no content yet. */
const STUBS: ContentPack = {
  name: "stub",
  requires: ["core"],
  defs: [
    { id: "stub:egg", type: "item", class: "egg", stack: 100, eat: { food: 10 }, spoilHours: 48, spoilsInto: "core:stone" },
    { id: "stub:shield", type: "item", class: "shield", stack: 1, description: "Blocks.", folder: "Armor/Shields", blueprint: true },
    { id: "stub:hat", type: "item", class: "costume", stack: 1 },
    { id: "stub:skin", type: "item", class: "skin", stack: 1 },
    { id: "stub:dye", type: "item", class: "dye", stack: 100, color: 3 },
    { id: "stub:relic", type: "item", class: "artifact", stack: 1 },
    { id: "stub:spikes", type: "structure", class: "defence", mesh: "box", color: 3, half: [0.5, 0.5, 0.5], hp: 300 },
    { id: "stub:crate", type: "prop", class: "crate", mesh: "box", color: 6, radius: 0.5, height: 1, slots: 20 },
    { id: "stub:poison", type: "damage", label: "poison", torpor: 2, trueShare: 1 },
    { id: "stub:drop", type: "loot", sets: { min: 1, max: 2 }, from: [{ min: 1, max: 3, entries: [{ items: ["core:stone", "stub:relic"], min: 1, max: 20, quality: [1, 3], blueprint: 0.25 }] }] },
    { id: "stub:beach", type: "spawns", entries: [{ species: "core:parasaur", weight: 3, levels: [1, 30] }, { species: "stub:alpha", weight: 0.1 }], limits: [{ species: "stub:alpha", share: 0.05 }] },
    { id: "stub:alpha", extends: "core:raptor", tag: "raptor", variant: "alpha", boss: true, loot: "stub:drop", buffs: ["core:fed"], saddle: "core:saddle_raptor", attacks: [{ name: "bite", damage: 60, type: "melee", reach: 2, ticks: 27, lands: 11 }] },
    { id: "stub:rules", type: "game", survivor: "core:survivor", cache: "core:cache", bag: "core:bag", levels: "core:levels", buffs: ["core:fed"] },
    { id: "stub:island", type: "map", label: "The island", chunks: [16, 16], seaLevel: 0, game: "stub:rules", zones: [{ kind: "spawn", at: [100, 100], radius: 80, spawns: "stub:beach" }, { kind: "crate", at: [300, 200], radius: 40, crate: "stub:crate" }] },
    { id: "stub:engram-relic", type: "engram", label: "Relic", level: 80, cost: 0, unlocks: [], requires: ["core:engram-spear"], group: "island", from: "stub:alpha" },
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
  expect(bad("stub:beach", { entries: [{ species: "core:stone", weight: 1 }] })).toEqual(['stub:beach: "core:stone" is not a species/creature']);
  expect(bad("stub:beach", { limits: [{ species: "core:survivor", share: 1 }] })).toEqual(['stub:beach: "core:survivor" is not a species/creature']);
  expect(bad("stub:island", { zones: [{ kind: "crate", at: [0, 0], radius: 1, crate: "core:cache" }] })).toEqual(['stub:island: "core:cache" is not a prop/crate']);
  expect(bad("stub:rules", { survivor: "core:raptor" })).toEqual(['stub:rules: "core:raptor" is not a species/survivor']);
  expect(bad("stub:drop", { from: [{ min: 1, max: 1, entries: [{ items: ["core:raptor"], min: 1, max: 1 }] }] })).toEqual(['stub:drop: "core:raptor" is not an item']);
  expect(bad("stub:engram-relic", { from: "core:stone" })).toEqual(['stub:engram-relic: "core:stone" is not a species/creature']);
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
