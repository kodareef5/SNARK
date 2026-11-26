// The perched lakes a city's build makes (tools/mapworld/lakes.ts), on a small grid of its own.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base, Grid } from "../../tools/mapworld/base.ts";
import { lakeSquares, raiseRims, readLakes, settleRims, type Lakes } from "../../tools/mapworld/lakes.ts";

const folder = mkdtempSync(join(tmpdir(), "snark-lakes-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a lake at the map's east edge grows no water on the west edge of the next row", () => {
  // Ten samples a row, six rows, 2 m apart; columns grow eastward from the west edge at 0.
  const nx = 10, nz = 6, cell = 2;
  mkdirSync(join(folder, "base"), { recursive: true });
  // The lake's outline: the east three columns of rows 1 to 4, its surface 3 m over the sea.
  const ring = [[14.5, 10.5], [20, 10.5], [20, 1.5], [14.5, 1.5], [14.5, 10.5]];
  writeFileSync(join(folder, "base/perched_water.geojson"), JSON.stringify({ features: [{ geometry: { type: "Polygon", coordinates: [ring] }, properties: { id: "pond", name: "Edge Pond", above_sea_m: 3 } }] }));
  // Flat at its surface under the lake and down the far west columns; high ground between.
  const dem = Float32Array.from({ length: nx * nz }, (_, i) => (i % nx >= 7 || i % nx <= 1 ? 3 : 8));
  const base = { folder, grid: { nx, nz, cell, west: 0, north: 12 } } as unknown as Base;
  const lakes = readLakes(base, {}, 0, -32, 1 / 256, dem, () => false)!;
  const wet = [...lakes.body.keys()].filter((i) => lakes.body[i]! > 0);
  expect(wet.length).toBeGreaterThan(0);
  expect(wet.filter((i) => i % nx < 5)).toEqual([]);
});

/** One body of `kind`, its surface a metre up, on the middle sample of nine by nine, 2 m apart. */
function oneBody(kind: string): { lakes: Lakes; grid: Grid } {
  const body = new Uint16Array(81);
  body[4 * 9 + 4] = 1;
  return { lakes: { body, bodies: [{ name: "", surface: 1, kind }], made: [] }, grid: { nx: 9, nz: 9, cell: 2, sizeX: 16, sizeZ: 16 } as Grid };
}

test("a pool takes the squares at its own samples; a pond's reach a square past them", () => {
  const count = (kind: string): number => { const { lakes, grid } = oneBody(kind); return lakeSquares(lakes, grid, 2).filter((b) => b === 1).length; };
  expect([count("pool"), count("fountain"), count("pond")]).toEqual([4, 4, 16]);
});

test("the ground beside a pool rises to its surface, but for footprints and roads", () => {
  const { lakes, grid } = oneBody("pool");
  // Falling to the east, a footprint north of the pool and a road north-east of it.
  const height = Float32Array.from({ length: 81 }, (_, i) => 2.9 - (i % 9) * 0.5);
  const before = Array.from(height);
  const made = raiseRims(lakes, height, grid, (i) => i === 3 * 9 + 4 || i === 3 * 9 + 5);
  // Six samples beside the pool are no footprint or road; the three west of it stand over its surface already.
  expect([made.raised, made.rim.size]).toEqual([3, 6]);
  const changed = [...height.keys()].filter((i) => height[i] !== before[i]);
  expect(changed).toEqual([4 * 9 + 5, 5 * 9 + 4, 5 * 9 + 5]);
  expect(changed.map((i) => height[i])).toEqual([1, 1, 1]);
  const pond = oneBody("pond");
  expect(raiseRims(pond.lakes, Float32Array.from(before), pond.grid, () => false).rim.size).toBe(0);
});

test("a body keeps what the data calls its water", () => {
  const dir = join(folder, "kinds");
  mkdirSync(join(dir, "base"), { recursive: true });
  const square = (w: number): number[][] => [[w, 9], [w + 5, 9], [w + 5, 3], [w, 3], [w, 9]];
  const feature = (id: string, kind: string, w: number) => ({ geometry: { type: "Polygon", coordinates: [square(w)] }, properties: { id, kind, above_sea_m: 3 } });
  writeFileSync(join(dir, "base/perched_water.geojson"), JSON.stringify({ features: [feature("a", "pool", 1.5), feature("b", "pond", 11.5)] }));
  const base = { folder: dir, grid: { nx: 10, nz: 6, cell: 2, west: 0, north: 12 } } as unknown as Base;
  const lakes = readLakes(base, {}, 0, -32, 1 / 256, new Float32Array(60).fill(3), () => false)!;
  expect(lakes.bodies.map((b) => b.kind)).toEqual(["pool", "pond"]);
});

test("a pool over a lower floor is let down to it and keeps its depth; a filled one dries", () => {
  const set = (kind: string, bed: number, floor: number, crossed = false): { lakes: Lakes; height: Float32Array; made: ReturnType<typeof settleRims> } => {
    const { lakes, grid } = oneBody(kind);
    // The rim at the surface all round, but one sample, a floor.
    const height = new Float32Array(81).fill(1);
    [height[4 * 9 + 4], height[4 * 9 + 5]] = [bed, floor];
    return { lakes, height, made: settleRims(lakes, height, grid, -32, 1 / 16, (i) => crossed && i === 4 * 9 + 4) };
  };
  const low = set("pool", 0.5, 0.4);
  // A sixteenth's lattice: 0.1 m under the floor at 0.4 is 0.25.
  expect([low.made, low.lakes.bodies[0]!.surface, low.height[4 * 9 + 4], low.height[4 * 9 + 5]]).toEqual([{ lowered: 1, farthest: 0.75, dried: 0, crossed: 0 }, 0.25, -0.25, 0.4000000059604645]);
  // A pool of one sample that a way was graded across has none left: it dries, and the way's ground stays.
  const way = set("pool", 0.5, 0.4, true);
  expect([way.made, way.lakes.body[4 * 9 + 4], way.height[4 * 9 + 4]]).toEqual([{ lowered: 0, farthest: 0, dried: 1, crossed: 1 }, 0, 0.5]);
  // One of two samples gives up the sample the way took, at 0.6, and is let down under it; the way is where it was.
  const two = oneBody("pool");
  two.lakes.body[4 * 9 + 3] = 1;
  const ground = new Float32Array(81).fill(1);
  [ground[4 * 9 + 3], ground[4 * 9 + 4]] = [0.5, 0.6];
  const made = settleRims(two.lakes, ground, two.grid, -32, 1 / 16, (i) => i === 4 * 9 + 4);
  expect([made, two.lakes.bodies[0]!.surface, ground[4 * 9 + 3], ground[4 * 9 + 4], two.lakes.body[4 * 9 + 4]]).toEqual([{ lowered: 1, farthest: 0.5, dried: 0, crossed: 1 }, 0.5, 0, 0.6000000238418579, 0]);
  const held = set("pool", 0.5, 1.2);
  expect([held.made.lowered, held.lakes.bodies[0]!.surface, held.height[4 * 9 + 4]]).toEqual([0, 1, 0.5]);
  const pond = set("pond", 0.5, 0.4);
  expect([pond.made.lowered, pond.lakes.bodies[0]!.surface]).toEqual([0, 1]);
  const filled = set("pool", 0.9, 1);
  expect([filled.made.dried, filled.lakes.body[4 * 9 + 4], lakeSquares(filled.lakes, oneBody("pool").grid, 2).some((b) => b !== 0)]).toEqual([1, 0, false]);
});
