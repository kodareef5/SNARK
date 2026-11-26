// What stands at a place is seeded by stable ids and lattice places (tools/mapworld), never by a row of the data, a
// running count or how far the map runs: a building by its id, its roof by its id, a street's pieces by its id.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { S } from "../../tools/mapworld/ground.ts";
import { makeHeaps, readBuildings } from "../../tools/mapworld/heaps.ts";
import { placeRoofPlant, type Roofs } from "../../tools/mapworld/roof-plant.ts";
import type { Site, StaticPiece } from "../../tools/mapworld/statics.ts";
import { parkCars, roadIndex, SECTOR, type Cars } from "../../tools/mapworld/street-cars.ts";

const RULES = JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { roofs: Roofs; street: { cars: Cars } };
const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

type Feature = { properties: { id: number }; geometry: { type: string; coordinates: number[][][] } };
const rect = (id: number, e: number, n: number, w: number, d: number): Feature => ({ properties: { id }, geometry: { type: "Polygon", coordinates: [[[e - w / 2, n - d / 2], [e + w / 2, n - d / 2], [e + w / 2, n + d / 2], [e - w / 2, n + d / 2], [e - w / 2, n - d / 2]]] } });
const grid = gridAt([-100, -100, 100, 100]);
const toLattice = (e: number, n: number): [number, number] => [grid.east + grid.x0 - e, n - grid.south + grid.z0];
const heapsOf = (features: Feature[]) => {
  const n = grid.nx * grid.nz;
  return makeHeaps({ grid, buildings: readBuildings({ features }, toLattice), districtOf: () => ({ index: 1, tall: 0.6, industrial: false }), ground: new Float32Array(n), road: new Uint8Array(n), water: new Uint8Array(n) });
};

test("a heap is the same when the data's rows are renumbered and reordered", () => {
  const [a, b] = [rect(1, -40, 10, 30, 24), rect(2, 45, -20, 26, 40)];
  const was = heapsOf([a, b]);
  const now = heapsOf([{ ...b, properties: { id: 900000001 } }, { ...a, properties: { id: 77 } }]);
  expect(now.lift).toEqual(was.lift);
  expect(now.part).toEqual(was.part);
  expect(now.ruins.map((r) => r.building.id)).toEqual(was.ruins.map((r) => r.building.id));
});

test("a footprint taken away leaves the other's heap as it was", () => {
  const [a, b] = [rect(1, -40, 10, 30, 24), rect(2, 45, -20, 26, 40)];
  const both = heapsOf([a, b]), alone = heapsOf([a]);
  const mine = (h: typeof both, k: number): boolean => h.owner[k]! >= 0 && h.ruins[h.owner[k]!]!.building.row === 1;
  let samples = 0;
  for (let k = 0; k < both.lift.length; k++) if (mine(both, k)) { samples++; expect([k, alone.lift[k]]).toEqual([k, both.lift[k]]); }
  expect(samples).toBeGreaterThan(100);
});

test("a roof's plant is its building's, wherever its pieces fall in the city's list", () => {
  const site = { ground: { grid: gridAt([-512, -512, 512, 512]) }, growthRoutes: [] } as unknown as Site;
  const block: StaticPiece[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) block.push({ kind: "core:zruin_floor8_concrete", x: 500 + i * 8, y: 3.4, z: 500 + j * 8, yaw: 0 });
  const elsewhere: StaticPiece[] = Array.from({ length: 37 }, (_, k) => ({ kind: "core:zruin_floor8_concrete", x: 100 + k * 8, y: 3.4, z: 100, yaw: 0 }));
  const first = placeRoofPlant(site, block, [{ id: 123456789012, firstPiece: 0, blocks: block.length, height: 12, yaw: 0 }], RULES.roofs, 2000).pieces;
  const later = placeRoofPlant(site, [...elsewhere, ...block], [{ id: 123456789012, firstPiece: elsewhere.length, blocks: block.length, height: 12, yaw: 0 }], RULES.roofs, 2000).pieces;
  expect(first.length).toBeGreaterThan(0);
  expect(later).toEqual(first);
  const other = placeRoofPlant(site, block, [{ id: 123456789013, firstPiece: 0, blocks: block.length, height: 12, yaw: 0 }], RULES.roofs, 2000).pieces;
  expect(other).not.toEqual(first);
});

// A flat square of two sectors west to east on 2 m samples, the ground 1 m up, one district; roads in engine metres.
const WIDE = 2 * SECTOR, N = WIDE / 2 + 1, GROUND = 1;
interface Road { id: string; from: [number, number]; to: [number, number] }
function streetSite(roads: readonly Road[]): Site {
  const source = mkdtempSync(join(tmpdir(), "snark-local-seeds-")); folders.push(source); mkdirSync(join(source, "base"));
  writeFileSync(join(source, "base/roads.geojson"), JSON.stringify({ type: "FeatureCollection", features: roads.map((r) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [r.from, r.to] }, properties: { id: r.id, mtfcc: "S1400", width_m: 8 } })) }));
  const across = N, deep = SECTOR / 2 + 1;
  const surface = new Uint8Array(across * deep).fill(S.OPEN), district = new Uint8Array(across * deep).fill(1);
  for (let row = 0; row < deep; row++) for (let col = 0; col < across; col++) {
    const x = WIDE - col * 2, z = SECTOR - row * 2;
    for (const r of roads) {
      const [ax, az] = r.from, [bx, bz] = r.to, ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) <= 5.5) surface[row * across + col] = S.STREET;
    }
  }
  return { source, world: { districts: [{ name: "Homes", style: "residential", tall: 0, ring: [] }] },
    ground: { grid: gridAt([-WIDE / 2, -SECTOR / 2, WIDE / 2, SECTOR / 2]), surface, district }, growthRoutes: [], vehicles: [], toLattice: (e: number, n: number) => [e, n], groundAt: () => GROUND, waterAt: () => 0 } as unknown as Site;
}
const FLEET = ROAD_FLEET.map((s) => ({ id: s.id, def: s.vehicle as WheelVehicleDefinition }));
const streetsIn = (x0: number, tag: string): Road[] => [200, 400, 600, 800].map((z) => ({ id: `${tag}${z}`, from: [x0 + 30, z], to: [x0 + 990, z] }));

test("a sector parks the same cars whether or not the map holds streets past it", () => {
  const cars = { ...RULES.street.cars, parked: { ...RULES.street.cars.parked, most: 3 } };
  const west = streetsIn(0, "osm:w"), east = streetsIn(SECTOR, "osm:e");
  const park = (roads: Road[]) => { const site = streetSite(roads); return parkCars(site, [], roadIndex(site), cars, 7, FLEET); };
  const alone = park(west), both = park([...east, ...west]);
  expect(alone.length).toBeGreaterThan(0);
  expect(both.filter((p) => p.x < SECTOR)).toEqual(alone);
  expect(both.some((p) => p.x >= SECTOR)).toBe(true);
});

test("a street's pieces are in the order of its id and its metres, whatever the rows", () => {
  const roads: Road[] = [{ id: "osm:9:0", from: [100, 100], to: [300, 120] }, { id: "osm:3:1", from: [500, 600], to: [520, 900] }, { id: "osm:3:0", from: [900, 300], to: [700, 310] }];
  const read = (rows: Road[]) => roadIndex(streetSite(rows)).segments.map(({ line: _, ...s }) => s);
  const was = read(roads);
  expect(was.map((s) => s.id)).toEqual(["osm:3:0", "osm:3:1", "osm:9:0"]);
  expect(read([roads[2]!, roads[0]!, roads[1]!])).toEqual(was);
  expect(new Set(was.map((s) => s.seed)).size).toBe(3);
});
