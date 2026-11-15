import { expect, test } from "bun:test";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import { compilePacks, resolvePacks, type ContentPack } from "../../shared/content/packs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Genome, statValue } from "../../shared/sim/genome.ts";

const island: ContentPack = {
  name: "island",
  requires: ["core"],
  defs: [
    // An abstract template built on a core species. Nothing can spawn it.
    { id: "island:herbivore", extends: "core:grazer", abstract: true, color: 7, food: { max: 900 } },
    { id: "island:strider", extends: "island:herbivore", walkSpeed: 6, stats: { speed: [1.4, 0, 0.02] } },
    { id: "island:titan", extends: "island:herbivore", radius: 3, height: 9, eyeHeight: 8, mesh: "island:titan" },
    { id: "island:gate", extends: "core:wall", half: [4, 4, 0.3], hp: 9000 },
    // An override of another pack's definition states only what changes.
    { id: "core:wall", override: true, hp: 2500 },
  ],
};

test("packs stack: definitions extend, templates stay out of the world, overrides patch", () => {
  const { registry, errors } = compilePacks([CORE_PACK, island]);
  expect(errors).toEqual([]);
  const reg = registry!;
  const def = (id: string) => reg.defs[reg.index.get(id)!]! as unknown as Record<string, any>;

  expect(reg.index.has("island:herbivore")).toBe(false);
  const strider = def("island:strider");
  expect(strider.type).toBe("species");
  expect(strider.walkSpeed).toBe(6);
  expect(strider.color).toBe(7); // from the template
  expect(strider.radius).toBe(0.7); // from core:grazer, two levels up
  expect(strider.food).toEqual({ max: 900, perHour: 12 }); // nested objects merge field by field
  expect(strider.stats.speed).toEqual([1.4, 0, 0.02]);
  expect(strider.stats.health).toEqual([220, 0.2, 0.054]);
  expect("extends" in strider || "abstract" in strider).toBe(false);
  expect(def("island:titan").mesh).toBe("island:titan");
  expect(def("island:gate").half).toEqual([4, 4, 0.3]);
  expect(def("core:wall").hp).toBe(2500);
  expect(def("core:wall").half).toEqual([1.5, 1.5, 0.1]);

  // Compiled tables are flat, with no extends chain to follow.
  expect(reg.move[reg.index.get("island:strider")!]!.walkSpeed).toBe(6);
  expect(reg.halfX[reg.index.get("island:gate")!]).toBe(4);
  const g = new Genome();
  g.wild[0] = 10;
  expect(statValue(strider.stats.health, g, 0)).toBeCloseTo(220 * 3, 9);

  expect(reg.hash).not.toBe(compilePacks([CORE_PACK]).registry!.hash);
  expect(compilePacks([CORE_PACK]).registry!.hash).toBe(compileContent(CORE_CONTENT).registry!.hash);
});

test("stacking mistakes are reported, each with the definition at fault", () => {
  const bad = (defs: ContentPack["defs"], requires?: string[]): string[] => resolvePacks([CORE_PACK, { name: "mod", requires, defs }]).errors;
  expect(bad([{ id: "mod:a", extends: "mod:nowhere" }])[0]).toMatch(/mod:a: extends "mod:nowhere"/);
  expect(bad([{ id: "mod:a", extends: "mod:b" }, { id: "mod:b", extends: "mod:a" }]).join()).toMatch(/cycle/);
  expect(bad([{ id: "core:sneaky", type: "item", class: "resource", stack: 1 }])[0]).toMatch(/may only define ids starting with "mod:"/);
  expect(bad([{ id: "core:nothing", override: true, hp: 1 }])[0]).toMatch(/overrides a definition that does not exist/);
  expect(bad([{ id: "mod:a", type: "item", class: "resource", stack: 1 }], ["missing"])[0]).toMatch(/requires "missing"/);
  expect(bad([{ id: "mod:half", type: "structure", class: "static", mesh: "box" }])[0]).toMatch(/mod:half: class structure\/static must declare "color"/);
  expect(bad([{ id: "mod:a", type: "item", class: "resource", stack: 1 }, { id: "mod:a", type: "item", class: "resource", stack: 2 }])[0]).toMatch(/defined twice/);
  // A resolved definition still has to pass the ordinary range checks.
  expect(compilePacks([CORE_PACK, { name: "mod", defs: [{ id: "mod:fast", extends: "core:grazer", walkSpeed: 900 }] }]).errors[0]).toMatch(/walkSpeed/);
  expect(compilePacks([CORE_PACK, { name: "mod", defs: [{ id: "mod:odd", extends: "core:grazer", stats: { luck: [1, 0, 0] } }] }]).errors[0]).toMatch(/unknown stat "luck"/);
});

test("a fuel that burns for most of an hour and a thing that cooks as long are held whole; one that burns for no time is a mistake", () => {
  const long = CORE_CONTENT.map((d) => (d.id === "core:wood" ? { ...d, fuel: 3000 } : d.id === "core:meat" && d.type === "item" ? { ...d, cooks: { ...d.cooks!, seconds: 2400 } } : d));
  const { registry, errors } = compileContent(long);
  expect(errors).toEqual([]);
  expect([registry!.fuelTicks[registry!.index.get("core:wood")!], registry!.cookTicks[registry!.index.get("core:meat")!]]).toEqual([90000, 72000]);
  const none = CORE_CONTENT.map((d) => (d.id === "core:wood" ? { ...d, fuel: 0 } : d.id === "core:meat" && d.type === "item" ? { ...d, cooks: { ...d.cooks!, seconds: -1 } } : d));
  const bad = compileContent(none).errors;
  expect(bad.some((e) => /core:wood.*fuel/.test(e))).toBe(true);
  expect(bad.some((e) => /core:meat.*cook/.test(e))).toBe(true);
});

const food = (id: string) => ({ id, type: "item", class: "consumable", stack: 50, eat: { food: 5 } }) as const;
const orchard: ContentPack = {
  name: "orchard",
  requires: ["core"],
  defs: [food("orchard:plum"), { id: "orchard:bow_long", extends: "core:bow" }],
  adds: [
    { to: "core:parasaur", field: "eats", items: [{ item: "orchard:plum", food: 30, affinity: 30 }] },
    { to: "core:bow", field: "weapon.ammo", items: ["core:dart_tranq"] },
  ],
};
const marsh: ContentPack = {
  name: "marsh",
  requires: ["core"],
  defs: [food("marsh:reed"), food("marsh:berry"), { id: "marsh:parasaur_bog", extends: "core:parasaur", variant: "bog" }],
  adds: [{ to: "core:parasaur", field: "eats", items: [{ item: "marsh:reed", food: 10, affinity: 10 }] }],
  remaps: [
    { from: "core:berry", to: "marsh:berry" },
    { from: "core:fiber", to: null },
  ],
};

test("two packs add to one list without knowing of each other, and a remap changes what is named and not what exists", () => {
  const { registry, errors } = compilePacks([CORE_PACK, orchard, marsh]);
  expect(errors).toEqual([]);
  const reg = registry!;
  const def = (id: string) => reg.defs[reg.index.get(id)!]! as unknown as Record<string, any>;
  const foods = (id: string): string[] => def(id).eats.map((e: { item: string }) => e.item);

  // The core's own food first, remapped, then each pack's in pack order. A copy starts with what its parent was given.
  expect(foods("core:parasaur")).toEqual(["marsh:berry", "orchard:plum", "marsh:reed"]);
  expect(foods("marsh:parasaur_bog")).toEqual(["marsh:berry", "orchard:plum", "marsh:reed"]);
  expect(def("core:bow").weapon.ammo).toEqual(["core:arrow_stone", "core:arrow_tranq", "core:arrow_flame", "core:dart_tranq"]);
  expect(def("orchard:bow_long").weapon.ammo).toEqual(def("core:bow").weapon.ammo);
  // A bush gives the new berry and no fiber. Both are still defined, so what a save holds of them loads.
  expect(def("core:bush").yields).toEqual([{ item: "marsh:berry", min: 3, max: 6 }, { item: "core:narcoberry", min: 0, max: 2 }]);
  expect([reg.index.has("core:berry"), reg.index.has("core:fiber")]).toEqual([true, true]);
  // What is made of fiber is still made of fiber: a remap reaches the open lists and nothing else.
  expect(def("core:spear").craft.needs.map((n: { item: string }) => n.item)).toContain("core:fiber");

  // A to B and B to C is A to C.
  const chain = compilePacks([CORE_PACK, orchard, { ...marsh, remaps: [{ from: "core:berry", to: "marsh:berry" }, { from: "marsh:berry", to: "orchard:plum" }] }]);
  expect(chain.errors).toEqual([]);
  expect((chain.registry!.defs[chain.registry!.index.get("core:bush")!] as unknown as Record<string, any>).yields[0].item).toBe("orchard:plum");
});

test("adding and remapping mistakes are reported with the pack at fault", () => {
  const bad = (more: Partial<ContentPack>): string[] => compilePacks([CORE_PACK, { name: "t", requires: ["core"], defs: [food("t:plum")], ...more }]).errors;
  expect(bad({ adds: [{ to: "core:wyvern", field: "eats", items: [] }] })).toEqual(['pack "t": adds to "core:wyvern", which is not defined']);
  expect(bad({ adds: [{ to: "core:grazer", field: "stats", items: [] }] })).toEqual(['pack "t": "stats" of core:grazer is not a list that packs may add to']);
  expect(bad({ adds: [{ to: "core:bow", field: "weapon.reload", items: [] }] })).toEqual(['pack "t": "weapon.reload" of core:bow is not a list that packs may add to']);
  expect(bad({ adds: [{ to: "core:berry", field: "weapon.ammo", items: ["core:arrow_stone"] }] })).toEqual(['pack "t": "weapon.ammo" of core:berry is not a list that packs may add to']);
  expect(bad({ adds: [{ to: "core:grazer", field: "eats", items: [{ item: "core:wall", food: 1, affinity: 1 }] }] })).toEqual(['core:grazer: "core:wall" is not an item']);
  expect(bad({ remaps: [{ from: "core:berry", to: "t:pear" }] })).toEqual(['pack "t": remaps "core:berry" to "t:pear", and "t:pear" is not defined']);
  expect(bad({ remaps: [{ from: "core:berry", to: "core:grazer" }] })).toEqual(['pack "t": remaps "core:berry" to "core:grazer", which is not of type item']);
  expect(bad({ remaps: [{ from: "core:berry", to: "t:plum" }, { from: "t:plum", to: "core:berry" }] })).toEqual(['pack "t": "core:berry" is remapped in a circle', 'pack "t": "t:plum" is remapped in a circle']);
});
