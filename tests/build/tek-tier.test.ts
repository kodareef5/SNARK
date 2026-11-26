import { expect, test } from "bun:test";
import { BUILDING_CONTENT, TIER_FORMS } from "../../content/building.ts";
import { Enclosure, SENSE_SIGHT, enclose } from "../../shared/world/lattice/rooms.ts";
import { EAST, NORTH, SOUTH, WEST, join, start } from "../fixtures/slots.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

test("Tek follows Metal's wheel, supports, durability class and door sockets", () => {
  const reg = coreRegistry();
  expect([...TIER_FORMS.tek!].sort()).toEqual([...TIER_FORMS.metal!].sort());
  for (const name of TIER_FORMS.metal!) {
    const mk = reg.index.get(`core:${name}_metal`)!, tk = reg.index.get(`core:${name}_tek`)!;
    const metal = reg.defs[mk], tek = reg.defs[tk];
    if (metal?.type !== "structure" || tek?.type !== "structure") throw new Error(name);
    expect(tek).toMatchObject({ shape: metal.shape, material: metal.material, half: metal.half, hp: Math.round(metal.hp! * 1.25), trimTier: "tek" });
    expect(reg.stabilityCap[tk]).toBe(reg.stabilityCap[mk]);
    expect(tek.opens).toBe(metal.opens?.replace(/_metal$/, "_tek"));
  }
  for (const metal of BUILDING_CONTENT) {
    if (metal.type !== "item" || !metal.places || !metal.id.endsWith("_metal")) continue;
    const item = metal.id.replace(/_metal$/, "_tek");
    const tek = reg.defs[reg.index.get(item)!];
    if (tek?.type !== "item") throw new Error(item);
    expect(tek.places).toEqual(metal.places.map(kind => kind.replace(/_metal$/, "_tek")));
    expect(tek.craft?.needs.map(n => n.item)).toEqual(["core:ingot", "core:polymer", "core:crystal", "core:electronics"]);
    expect(tek.craft?.at).toBe("core:fabricator");
    expect(reg.defs[reg.index.get(item.replace(":piece_", ":engram-piece_"))!]).toMatchObject({
      level: 90, requires: ["core:engram-piece_fabricator", metal.id.replace(":piece_", ":engram-piece_")],
    });
  }
});

test("the four first Tek recipes build a room which closes around its door", () => {
  const w = flatWorld(8), cost = new Map<string, number>();
  const kind = (name: string) => w.reg.index.get(`core:${name}_tek`)!;
  for (const [name, count] of [["foundation", 1], ["ceiling", 1], ["wall", 4], ["door", 1]] as const) {
    const item = w.reg.defs[kind("piece_" + name)];
    if (item?.type !== "item" || !item.craft) throw new Error(name);
    for (const need of item.craft.needs) cost.set(need.item, (cost.get(need.item) ?? 0) + count * need.count);
  }
  expect(Object.fromEntries(cost)).toEqual({ "core:ingot": 315, "core:polymer": 162, "core:crystal": 110, "core:electronics": 22 });
  const base = start(w, kind("foundation"), 42, 1, 40, 3760, 1);
  const door = join(w, base, kind("doorframe"), SOUTH);
  for (const side of [NORTH, EAST, WEST]) expect(join(w, base, kind("wall"), side)).toBeGreaterThanOrEqual(0);
  expect(join(w, door, kind("ceiling"), 1)).toBeGreaterThanOrEqual(0);
  const check = () => {
    const rooms = new Enclosure(w.reg.forms, SENSE_SIGHT);
    enclose(w.structs, w.structs.frameAt(base), rooms);
    rooms.flood();
    return rooms.found.inside;
  };
  expect(check()).toBe(0);
  expect(join(w, door, kind("door"), 0)).toBeGreaterThanOrEqual(0);
  expect(check()).toBe(1);
});
