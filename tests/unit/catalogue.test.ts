// The class table: sound in itself, and true of the content that exists.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { CLASSES, FIELDS, classFaults, classOf, defFaults } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { FEATURES } from "../../shared/features.ts";
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
    if (r.abstract || !(r.type in FIELDS)) continue;
    expect([r.id, used.has(r.id)]).toEqual([r.id, r.status !== "stub"]);
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

test("every feature that something waits for is waited for: by a setting or by a class", () => {
  const waited = new Set<string>([...CATALOG.filter((r) => r.status === "planned").map((r) => r.waits), ...CLASSES.map((r) => r.waits)]);
  expect(Object.keys(FEATURES).filter((f) => !waited.has(f))).toEqual([]);
});

test("the reference page is what the table generates", () => {
  expect(readFileSync(CATALOGUE_PAGE, "utf8")).toBe(cataloguePage());
});
