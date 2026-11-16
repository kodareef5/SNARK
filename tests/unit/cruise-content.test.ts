import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE, CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { cruiseLayoutFaults, cruiseRoomEntryFaults, type CruiseLayout, type CruisePrototype, type CruiseRoute } from "../../content/landmarks/cruise-layout.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { parseMap, placeStatics, writeMap } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { flatMap } from "../fixtures/map.ts";

test("cruise prototypes belong to their map once and every transformed instance retains a native ref", () => {
  const result = compileContent(CORE_CONTENT);
  expect(result.errors).toEqual([]);
  const core = result.registry!, reg = withContent(core, CRUISE.defs);
  expect(core.defs.some(d => d?.id.startsWith("cruise:"))).toBe(false);
  expect(reg.defs.slice(0, core.defs.length)).toEqual([...core.defs]);
  expect(CRUISE.defs.length).toBe(CRUISE_LAYOUT.prototypes.length * 2);
  expect(cruiseLayoutFaults(CRUISE_LAYOUT)).toEqual([]);
  for (const p of CRUISE_LAYOUT.prototypes) {
    expect(reg.index.has(p.id)).toBe(true);
    expect(reg.index.has(`${p.id}_shape`)).toBe(true);
  }
  for (const yaw of [0, 16384, 27183]) {
    const statics = cruiseStatics(512, 7, 512, yaw), map = { ...flatMap(16), statics, content: { landmarks: [CRUISE.name], defs: CRUISE.defs } };
    const ground = parseMap(writeMap(map), false);
    expect(ground.content?.landmarks).toEqual(["cruise"]);
    expect(withContent(core, ground.content!.defs).hash).toBe(reg.hash);
    const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    placeStatics(map, structs, reg);
    const refs = assertCruisePlaced(map, structs, reg);
    expect(refs.length).toBe(CRUISE_LAYOUT.instances.filter(i => i.placed).length);
    expect(new Set(refs).size).toBe(refs.length);
    const first = CRUISE_LAYOUT.instances.find(i => i.placed)!;
    const expected = cruisePoint(512, 7, 512, yaw, first.at).map(v => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
    expect([statics[0]!.x, statics[0]!.y, statics[0]!.z]).toEqual(expected);
  }
  expect(cruisePoint(10, 20, 30, 16384, [2, 3, 4])).toEqual([14, 23, 28]);
  expect(() => cruiseStatics(NaN, 0, 0)).toThrow("finite coordinates");
});

test("cruise layout rejects lost identities, disconnected routes and native geometry violations", () => {
  const base = CRUISE_LAYOUT, p = base.prototypes[0]!, instance = base.instances[0]!, route = base.routes[0]!;
  const check = (patch: Partial<CruiseLayout>) => cruiseLayoutFaults({ ...base, ...patch }).join("\n");
  expect(check({ instances: [...base.instances, { ...instance }] })).toContain("duplicate id");
  expect(check({ instances: [{ ...instance, prototype: "core:missing" }] })).toContain("unknown prototype");
  expect(check({ instances: [{ ...instance, yaw: Infinity }] })).toContain("finite degree yaw");
  expect(check({ routes: [] })).toContain("unreachable from the quay");
  expect(check({ rooms: [{ ...base.rooms[0]!, node: "missing" }] })).toContain("reachable graph node");
  expect(check({ rooms: [{ ...base.rooms[0]!, routeTarget: [1, 14, 1] }] })).toContain("reachable graph node");
  expect(check({ decks: base.decks.slice(1) })).toContain("complete published");
  expect(check({ routes: [{ ...route, from: "missing" }] })).toContain("unknown graph node");
  expect(check({ routes: [{ ...route, anchors: [[0, 0, 0], ...route.anchors.slice(1)] }] })).toContain("first anchor");
  expect(check({ prototypes: [{ ...p, boxes: [{ at: [0, 0, 0], half: [17, 1, 1] }] }] })).toContain("native ±16 m");
  expect(check({ prototypes: [{ ...p, boxes: Array.from({ length: 17 }, () => ({ at: [0, 0, 0], half: [1, 1, 1] })) }] })).toContain("1 to 16 parts");
  expect(check({ prototypes: [{ ...p, visualBounds: { min: [-15, -.24, -6], max: [15, 0, 6] } }] })).toContain("visual bounds exceed");
});

test("repeated native door prototypes require independently named placed closed leaves", () => {
  const closed: CruisePrototype = { id: "cruise:test_closed", mesh: "test:door", category: "door", color: 1,
    boxes: [{ at: [.8, 1.3, 0], half: [.8, 1.3, .05] }], visualBounds: { min: [0, 0, -.05], max: [1.6, 2.6, .05] }, opens: "cruise:test_open" };
  const open: CruisePrototype = { ...closed, id: "cruise:test_open", opens: closed.id };
  const instances = [0, 1].map(i => ({ id: `test_door_${i}`, prototype: closed.id, at: [i * 4, 14, -20], yaw: 0, deck: "5", section: "test", placed: true }));
  const doors = instances.map(i => ({ id: i.id, instanceId: i.id, closedPrototype: closed.id, openPrototype: open.id, hinge: i.at, clearWidth: 1.6, clearHeight: 2.6 }));
  const layout: CruiseLayout = { ...CRUISE_LAYOUT, prototypes: [...CRUISE_LAYOUT.prototypes, closed, open], instances: [...CRUISE_LAYOUT.instances, ...instances], doors: [...CRUISE_LAYOUT.doors, ...doors] };
  expect(cruiseLayoutFaults(layout)).toEqual([]);
  expect(cruiseLayoutFaults({ ...layout, doors: doors.slice(0, 1) }).join("\n")).toContain("lacks independent door record");
  expect(cruiseLayoutFaults({ ...layout, doors: [doors[0]!, { ...doors[1]!, instanceId: doors[0]!.instanceId }] }).join("\n")).toContain("appears more than once");
  expect(cruiseLayoutFaults({ ...layout, instances: layout.instances.map(i => i.id === instances[0]!.id ? { ...i, prototype: open.id } : i) }).join("\n")).toContain("placed closed leaf");
});

test("advertised room footprints retain real occupied area and their reachable entry and target", () => {
  const room = CRUISE_LAYOUT.rooms.find(r => r.id === "cabin_9_0")!, a = room.bounds.min, b = room.bounds.max;
  const polygon = [[a[0], a[2]], [b[0], a[2]], [b[0], b[2]], [a[0], b[2]]];
  const footprint = { polygons: [polygon], holes: [] };
  const check = (value: typeof footprint) => cruiseLayoutFaults({ ...CRUISE_LAYOUT, rooms: [{ ...room, footprint: value }] }).join("\n");
  expect(check(footprint)).toBe("");
  expect(check({ polygons: [], holes: [] })).toContain("at least one polygon");
  expect(check({ polygons: [[[NaN, 0], [1, 0], [1, 1]]], holes: [] })).toContain("finite polygons");
  expect(check({ polygons: [[[0, 0], [1, 0], [2, 0]]], holes: [] })).toContain("no area");
  expect(check({ polygons: [[[a[0] - 1, a[2]], ...polygon.slice(1)]], holes: [] })).toContain("exceeds its room bounds");
  const p = room.routeTarget;
  expect(cruiseLayoutFaults({ ...CRUISE_LAYOUT, rooms: [{ ...room, footprint: { ...footprint,
    holes: [[[p[0] - .1, p[2] - .1], [p[0] + .1, p[2] - .1], [p[0] + .1, p[2] + .1], [p[0] - .1, p[2] + .1]]] } }] }).join("\n")).toContain("target is outside");
});

test("room entry associations reject arbitrary bound edges while accepting real path crossings and shared entry nodes", () => {
  const route: CruiseRoute = { id: "approach", kind: "room", from: "outside", to: "physical", anchors: [[0, 14, 0], [0, 14, 10]], clearWidth: 2, clearHeight: 2.6 };
  const alias: CruiseRoute = { ...route, id: "alias", from: "physical", to: "named", anchors: [[0, 14, 10], [0, 14, 10]] };
  const room = { ...CRUISE_LAYOUT.rooms[0]!, id: "test entry", node: "named", entry: [0, 14, 5] };
  expect(cruiseRoomEntryFaults([room], [route, alias])).toEqual([]);
  expect(cruiseRoomEntryFaults([{ ...room, entry: [3, 14, 5] }], [route, alias])).toEqual(["test entry: entry must meet its authored access path (nearest 3.000 m)"]);
  expect(cruiseRoomEntryFaults([{ ...room, node: "missing" }], [route, alias])[0]).toContain("authored access path");
  // A tempting unrelated corridor cannot validate an entry belonging to this room's own approach.
  const other: CruiseRoute = { ...route, id: "unrelated", from: "other", to: "elsewhere", anchors: [[3, 14, 0], [3, 14, 10]] };
  expect(cruiseRoomEntryFaults([{ ...room, entry: [3, 14, 5] }], [route, alias, other])).toHaveLength(1);
});

test("render cells use one physical anchor without baking interactive leaves or duplicating full-cell draws", () => {
  const original: CruiseLayout = CRUISE_LAYOUT;
  const instance = original.instances.find(i => i.placed && i.yaw === 0 && !i.sourcePrototype && !original.prototypes.find(p => p.id === i.prototype)!.opens)!;
  const prototype = original.prototypes.find(p => p.id === instance.prototype)!;
  const id = "cruise:cell_999999", anchor = { ...prototype, id: "cruise:anchor_test", sourcePrototype: prototype.id, mesh: id };
  const cell = { id, grid: [900, 900, 900], bounds: { min: [14400, 14400, 14400], max: [14416, 14416, 14416] },
    anchor: instance.id, origin: instance.at, yaw: 0, members: [{ instance: instance.id, prototype: prototype.id, category: prototype.category }] };
  const layout: CruiseLayout = { ...original, prototypes: [...original.prototypes, anchor],
    instances: original.instances.map(i => i.id === instance.id ? { ...i, prototype: anchor.id, sourcePrototype: prototype.id, yaw: 0 } : i),
    cells: [...(original.cells ?? []), cell] };
  expect(cruiseLayoutFaults(layout)).toEqual([]);
  const check = (patch: Partial<CruiseLayout>) => cruiseLayoutFaults({ ...layout, ...patch }).join("\n");
  const moved = { ...anchor, boxes: [{ at: [0, 0, 0], half: [.1, .1, .1] }] };
  expect(check({ prototypes: layout.prototypes.map(p => p.id === anchor.id ? moved : p) })).toContain("preserve its original collision");
  expect(check({ instances: [...layout.instances, { ...layout.instances.find(i => i.id === instance.id)!, id: "repeated-cell", at: [1, 2, 3] }] })).toContain("exactly one placed anchor");
  const door = original.doors[0]!, leaf = original.instances.find(i => i.id === door.instanceId)!;
  expect(check({ cells: [...(original.cells ?? []), { ...cell, members: [{ instance: leaf.id, prototype: leaf.prototype, category: "door" }] }] })).toContain("moving door leaves cannot be baked");
  expect(check({ cells: [...(original.cells ?? []), { ...cell, bounds: { ...cell.bounds, max: [14417, 14416, 14416] } }] })).toContain("16 m render cube");
});
