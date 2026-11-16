import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_CONTENT, CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { cruiseLayoutFaults, type CruiseLayout, type CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { placeStatics } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { flatMap } from "../fixtures/map.ts";

test("cruise prototypes are registered once and every transformed instance retains a native ref", () => {
  const result = compileContent(CORE_CONTENT);
  expect(result.errors).toEqual([]);
  const reg = result.registry!;
  expect(CRUISE_CONTENT.length).toBe(CRUISE_LAYOUT.prototypes.length * 2);
  expect(cruiseLayoutFaults(CRUISE_LAYOUT)).toEqual([]);
  for (const p of CRUISE_LAYOUT.prototypes) {
    expect(reg.index.has(p.id)).toBe(true);
    expect(reg.index.has(`${p.id}_shape`)).toBe(true);
  }
  for (const yaw of [0, 16384, 27183]) {
    const statics = cruiseStatics(128, 7, 128, yaw), map = { ...flatMap(4), statics };
    const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    placeStatics(map, structs, reg);
    const refs = assertCruisePlaced(map, structs, reg);
    expect(refs.length).toBe(CRUISE_LAYOUT.instances.filter(i => i.placed).length);
    expect(new Set(refs).size).toBe(refs.length);
    const first = CRUISE_LAYOUT.instances.find(i => i.placed)!;
    const expected = cruisePoint(128, 7, 128, yaw, first.at).map(v => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
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
  expect(check({ routes: [{ ...route, from: "missing" }] })).toContain("unknown graph node");
  expect(check({ routes: [{ ...route, anchors: [[0, 0, 0], ...route.anchors.slice(1)] }] })).toContain("first anchor");
  expect(check({ prototypes: [{ ...p, boxes: [{ at: [0, 0, 0], half: [17, 1, 1] }] }] })).toContain("native ±16 m");
  expect(check({ prototypes: [{ ...p, boxes: Array.from({ length: 17 }, () => ({ at: [0, 0, 0], half: [1, 1, 1] })) }] })).toContain("1 to 16 parts");
  expect(check({ prototypes: [{ ...p, visualBounds: { min: [-15, -.24, -6], max: [15, 0, 6] } }] })).toContain("visual bounds exceed");
});

test("repeated native door prototypes require independently named placed closed leaves", () => {
  const closed: CruisePrototype = { id: "core:cruise_test_closed", mesh: "test:door", category: "door", color: 1,
    boxes: [{ at: [.8, 1.3, 0], half: [.8, 1.3, .05] }], visualBounds: { min: [0, 0, -.05], max: [1.6, 2.6, .05] }, opens: "core:cruise_test_open" };
  const open: CruisePrototype = { ...closed, id: "core:cruise_test_open", opens: closed.id };
  const instances = [0, 1].map(i => ({ id: `test_door_${i}`, prototype: closed.id, at: [i * 4, 14, -20], yaw: 0, deck: "5", section: "test", placed: true }));
  const doors = instances.map(i => ({ id: i.id, instanceId: i.id, closedPrototype: closed.id, openPrototype: open.id, hinge: i.at, clearWidth: 1.6, clearHeight: 2.6 }));
  const layout: CruiseLayout = { ...CRUISE_LAYOUT, prototypes: [...CRUISE_LAYOUT.prototypes, closed, open], instances: [...CRUISE_LAYOUT.instances, ...instances], doors };
  expect(cruiseLayoutFaults(layout)).toEqual([]);
  expect(cruiseLayoutFaults({ ...layout, doors: doors.slice(0, 1) }).join("\n")).toContain("lacks independent door record");
  expect(cruiseLayoutFaults({ ...layout, doors: [doors[0]!, { ...doors[1]!, instanceId: doors[0]!.instanceId }] }).join("\n")).toContain("appears more than once");
  expect(cruiseLayoutFaults({ ...layout, instances: layout.instances.map(i => i.id === instances[0]!.id ? { ...i, prototype: open.id } : i) }).join("\n")).toContain("placed closed leaf");
});
