import { expect, test } from "bun:test";
import { compileContent } from "../../shared/content/registry.ts";
import { shapeHalf, type Def, type ShapeDef } from "../../shared/content/defs.ts";
import { MapStatics, placeStatics, type MapStatic } from "../../shared/world/mapfile.ts";
import { MAX_SLOTS_PER_CHUNK, StructureStore } from "../../shared/world/structures.ts";
import { ROUTE_MARGIN } from "../../shared/world/path.ts";
import { assertCruiseMap, assertCruisePlaced, cruiseMapPreflight } from "../../tools/cruise/preflight.ts";
import { flatMap } from "../fixtures/map.ts";

const definitions: readonly Def[] = [
  { id: "test:closed", type: "structure", class: "static", mesh: "box", half: [.1, 1, .8], color: 1, hp: 10000, opens: "test:open" },
  { id: "test:open", type: "structure", class: "static", mesh: "box", half: [.8, 1, .1], color: 1, hp: 10000, opens: "test:closed" },
];
const compiled = compileContent(definitions);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry;
const piece = (x: number, y = 2, z = 5): MapStatic => ({ kind: "test:closed", x, y, z, yaw: 12345 });

test("cruise preflight counts the complete map on the native lattice and verifies every placed ref", () => {
  const map = { ...flatMap(2), statics: [piece(63.9995), piece(4), piece(4, 70), piece(70, 2, 70)] };
  const report = assertCruiseMap(map, reg);
  expect(report).toEqual({ statics: 4, kinds: 1, occupiedChunks: 3, mostInChunk: 2, faults: [] });
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  expect([...assertCruisePlaced(map, structs, reg)]).toEqual([65536, 0, 1, 196608]);
  const columns = { ...map, statics: MapStatics.of(map.dims, map.statics) };
  expect(assertCruiseMap(columns, reg)).toEqual(report);
  expect(assertCruisePlaced(columns, structs, reg)).toEqual(assertCruisePlaced(map, structs, reg));
  structs.remove(1);
  expect(() => assertCruisePlaced(map, structs, reg)).toThrow("placed 3 of 4");
});

test("cruise preflight rejects invalid transforms, unknown kinds and overlapping saved door states", () => {
  const base = flatMap(2), check = (statics: readonly MapStatic[]) => cruiseMapPreflight({ ...base, statics }, reg).faults.join("\n");
  expect(check([piece(128 - .0001)])).toContain("out-of-map origin after lattice rounding");
  expect(check([piece(NaN)])).toContain("non-finite");
  expect(check([{ ...piece(4), yaw: 65536 }])).toContain("native unsigned turn");
  expect(check([{ ...piece(4), kind: "test:missing" }])).toContain("not a registered structure");
  expect(check([piece(4), piece(4.0001)])).toContain("duplicates placement");
  expect(check([piece(4), { ...piece(4), kind: "test:open" }])).toContain("door state");
  expect(check([piece(4), { ...piece(8), kind: "test:open" }])).toBe("");
});

test("cruise preflight catches a full vertical chunk before native add can silently refuse rows", () => {
  const statics = Array.from({ length: MAX_SLOTS_PER_CHUNK + 1 }, (_, i) => piece(5 + (i % 512) / 512, Math.floor(i / 512) / 512));
  const map = { ...flatMap(1), statics };
  const report = cruiseMapPreflight(map, reg);
  expect(report.mostInChunk).toBe(65536);
  expect(report.faults).toEqual(["chunk 0: exceeds 65535 native structure slots"]);
  expect(() => assertCruiseMap(map, reg)).toThrow("65535 native structure slots");
});

test("cruise preflight enforces exact native collision spread with lattice stretch and the largest body", () => {
  const make = (halfX: number, radius = 1, visual = false) => {
    const shape: ShapeDef = { id: "core:cruise_margin_shape", type: "shape", role: "thing",
      boxes: [{ at: [0, 0, 0], half: [halfX, 1, .1] }], ...(visual ? { look: { boxes: [{ at: [0, 0, 0], half: [15, 1, 1] as const }] } } : {}) };
    const made = compileContent([shape,
      { id: "core:cruise_margin", type: "structure", class: "static", mesh: "shape", shape: shape.id, half: shapeHalf(shape.boxes, shape.hulls, shape.look), hp: 10000, color: 1 },
      { id: "test:walker", type: "species", class: "creature", mesh: "box", color: 1, radius, height: 3, eyeHeight: 2.7, walkSpeed: 3, sprintMul: 1.6, jumpSpeed: 5, stats: { health: [100, 0, 0] } },
    ]);
    expect(made.errors).toEqual([]); return made.registry!;
  };
  const map = { ...flatMap(1), statics: [] }; // Even an unplaced state must not invalidate the global native route assumption.
  const edge = make(14.99), native = new StructureStore(map.dims, edge.halfX, edge.halfY, edge.halfZ, null, edge.parts);
  expect(Math.hypot(14.99, .1) + 1).toBeLessThan(ROUTE_MARGIN);
  expect(native.spread[edge.index.get("core:cruise_margin")!]! + 1).toBeGreaterThan(ROUTE_MARGIN);
  const report = cruiseMapPreflight(map, edge);
  expect(report.faults).toHaveLength(1);
  expect(report.faults[0]).toContain("native collision spread");
  expect(report.faults[0]).toContain("route invalidation margin 16 m");
  expect(cruiseMapPreflight(map, edge)).toEqual(report); // Cached registry validation preserves the same refusal.
  expect(cruiseMapPreflight(map, make(14.96)).faults).toEqual([]);
  expect(cruiseMapPreflight(map, make(14.96, 1.05)).faults).toHaveLength(1);
  // A distant visual proxy does not enlarge actual collision or require a larger route invalidation region.
  expect(cruiseMapPreflight(map, make(.2, 1, true)).faults).toEqual([]);
});
