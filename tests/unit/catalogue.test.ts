// The class table: sound in itself, and true of the content that exists.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { CLASSES, FIELDS, classFaults, defFaults, eggIds, inferClass } from "../../shared/content/classes.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { FEATURES } from "../../shared/features.ts";

const eggs = eggIds(CORE_CONTENT);
const classes = CORE_CONTENT.map((d) => inferClass(d, eggs));

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
  expect(CORE_CONTENT.flatMap((d, i) => defFaults(d, classes[i]!))).toEqual([]);
  expect(compileContent(CORE_CONTENT).errors).toEqual([]);
});

test("a class that is built has content, a stub has none, and each kind of fault is named", () => {
  const used = new Set(classes);
  for (const r of CLASSES) {
    if (r.abstract || !(r.type in FIELDS)) continue;
    expect([r.id, used.has(r.id)]).toEqual([r.id, r.status !== "stub"]);
  }
  const spear = CORE_CONTENT.find((d) => d.id === "core:spear")!;
  expect(defFaults({ ...spear, eat: { food: 1 } } as typeof spear, "item/weapon")).toEqual(['core:spear: a item/weapon may not declare "eat"']);
  expect(defFaults({ ...spear, weapon: undefined } as typeof spear, "item/weapon")).toEqual(['core:spear: a item/weapon must declare "weapon"']);
  expect(defFaults(spear, "item/consumable")).toEqual(['core:spear: a item/consumable must declare one of "eat", "dose"', 'core:spear: a item/consumable may not declare "weapon"']);
  expect(defFaults(spear, "structure/piece")[0]).toContain("is of family structure");
  expect(defFaults(spear, "item")[0]).toContain("is no class a definition can be of");
});

test("every feature that something waits for is waited for: by a setting or by a class", () => {
  const waited = new Set<string>([...CATALOG.filter((r) => r.status === "planned").map((r) => r.waits), ...CLASSES.map((r) => r.waits)]);
  expect(Object.keys(FEATURES).filter((f) => !waited.has(f))).toEqual([]);
});
