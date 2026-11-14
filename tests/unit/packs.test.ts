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
  expect(bad([{ id: "core:sneaky", type: "item", stack: 1 }])[0]).toMatch(/may only define ids starting with "mod:"/);
  expect(bad([{ id: "core:nothing", override: true, hp: 1 }])[0]).toMatch(/overrides a definition that does not exist/);
  expect(bad([{ id: "mod:a", type: "item", stack: 1 }], ["missing"])[0]).toMatch(/requires "missing"/);
  expect(bad([{ id: "mod:half", type: "structure", mesh: "box" }])[0]).toMatch(/mod:half: missing or malformed field "color"/);
  expect(bad([{ id: "mod:a", type: "item", stack: 1 }, { id: "mod:a", type: "item", stack: 2 }])[0]).toMatch(/defined twice/);
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
