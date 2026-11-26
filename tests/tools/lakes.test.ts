// The perched lakes a city's build makes (tools/mapworld/lakes.ts), on a small grid of its own.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base, Grid } from "../../tools/mapworld/base.ts";
import { carveLakes, lakeSquares, poolBeds, raiseRims, readLakes, settleRims, type Lakes } from "../../tools/mapworld/lakes.ts";

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

/**
 * A pool of `wide` by `deep` samples from (3, 3) on a grid of 13 by 13, its surface a metre up and its bed 1.5 m under
 * it, the ground round it at `rim`; with its beds as carved.
 */
function pool(wide: number, deep: number, rim: number | ((col: number, row: number) => number)): { lakes: Lakes; grid: Grid; height: Float32Array; beds: Map<number, number>; at: (col: number, row: number) => number; settle: () => ReturnType<typeof settleRims> } {
  const n = 13, at = (col: number, row: number): number => row * n + col;
  const body = new Uint16Array(n * n), height = new Float32Array(n * n);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const inside = col >= 3 && col < 3 + wide && row >= 3 && row < 3 + deep;
    body[at(col, row)] = inside ? 1 : 0;
    height[at(col, row)] = inside ? -0.5 : typeof rim === "number" ? rim : rim(col, row);
  }
  const lakes: Lakes = { body, bodies: [{ name: "", surface: 1, kind: "pool" }], made: [] }, grid = { nx: n, nz: n, cell: 2, sizeX: 24, sizeZ: 24 } as Grid;
  const beds = poolBeds(lakes, height);
  return { lakes, grid, height, beds, at, settle: () => settleRims(lakes, {}, height, grid, -32, 1 / 16, beds) };
}
const none = { lowered: 0, farthest: 0, dried: 0, crossed: 0, laddered: 0, benched: 0, filled: 0 };
const near = (v: number): number => Math.round(v * 1000) / 1000;

test("a pool level with its rim keeps its bed, and settling it again changes nothing", () => {
  const p = pool(4, 4, 1.1);
  expect(p.settle()).toEqual(none);
  expect([p.lakes.bodies[0]!.surface, near(p.height[p.at(3, 3)]!), near(p.height[p.at(6, 6)]!)]).toEqual([1, -0.5, -0.5]);
  expect(p.settle()).toEqual(none);
});

test("a pool beside lower ground goes under it, bed and all, and keeps a way out", () => {
  // A floor east of it 0.6 m under its surface: one sample, no way out by itself.
  const p = pool(4, 4, (col, row) => (col === 7 && row === 5 ? 0.4 : 1));
  // A sixteenth's lattice: 0.1 m under 0.4 is 0.25. Its rim is then 0.75 m over the water and 2.25 over the bed.
  expect(p.settle()).toEqual({ ...none, lowered: 1, farthest: 0.75, laddered: 1 });
  expect(p.lakes.bodies[0]!.surface).toBe(0.25);
  // The ladder: the first two samples of its north side, 1.5 m under the rim; the rest 1.5 m under the water.
  expect([p.at(3, 3), p.at(4, 3), p.at(5, 3), p.at(3, 4), p.at(6, 6)].map((i) => near(p.height[i]!))).toEqual([-0.5, -0.5, -1.25, -1.25, -1.25]);
  const before = Array.from(p.height);
  expect(p.settle()).toEqual(none);
  expect(Array.from(p.height)).toEqual(before);
});

test("ground a way's edge raised under the water stays the pool's bed; ground raised out of it is given up", () => {
  const p = pool(4, 4, 1.1);
  // The fringe of a way to a door: one sample raised a little, one to the way's own level.
  [p.height[p.at(4, 6)], p.height[p.at(3, 5)]] = [-0.2, 1.2];
  expect(p.settle()).toEqual({ ...none, crossed: 1 });
  expect([p.lakes.bodies[0]!.surface, p.lakes.body[p.at(4, 6)], p.lakes.body[p.at(3, 5)], near(p.height[p.at(4, 6)]!), near(p.height[p.at(3, 5)]!)]).toEqual([1, 1, 0, -0.2, 1.2]);
});

test("a way graded across a pool under its surface stays where it is, and the pool goes under it", () => {
  // West to east along row 5 at 0.5 m, half a metre under the water, the rim's samples on it too.
  const p = pool(4, 5, (col, row) => (row === 5 ? 0.5 : 1.1));
  for (let col = 3; col <= 6; col++) p.height[p.at(col, 5)] = 0.5;
  const made = p.settle();
  expect([made.lowered, made.crossed, made.dried, p.lakes.bodies[0]!.surface]).toEqual([1, 1, 0, 0.375]);
  expect([3, 4, 5, 6].map((col) => [p.lakes.body[p.at(col, 5)], p.height[p.at(col, 5)]])).toEqual([[0, 0.5], [0, 0.5], [0, 0.5], [0, 0.5]]);
  // Each side of it the water is as deep as it was carved.
  expect([near(p.height[p.at(4, 3)]!), near(p.height[p.at(4, 7)]!)]).toEqual([-1.125, -1.125]);
});

test("a pool in a pit gets a ladder two samples wide, a step of 1.5 m a pair", () => {
  const p = pool(5, 5, 4);
  expect(p.settle()).toEqual({ ...none, laddered: 1 });
  expect([3, 4, 5, 6].map((row) => [near(p.height[p.at(3, row)]!), near(p.height[p.at(4, row)]!), near(p.height[p.at(5, row)]!)])).toEqual([[2.5, 2.5, -0.5], [1, 1, -0.5], [-0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]]);
});

test("a gap one sample wide in a high rim is no way out", () => {
  // The rim 2 m over the water, but for one sample level with it.
  const p = pool(4, 4, (col, row) => (col === 5 && row === 2 ? 1.1 : 3));
  expect(p.settle()).toEqual({ ...none, laddered: 1 });
});

test("a slot one sample wide is benched to the ground at its sides", () => {
  const p = pool(1, 4, 1.1);
  expect(p.settle()).toEqual(none);
  expect([3, 4, 5, 6].map((row) => near(p.height[p.at(3, row)]!))).toEqual([-0.15, -0.15, -0.15, -0.15]);
  // In a rim 2 m over it the bench stands out of the water: no pool is left.
  const pit = pool(1, 4, 3);
  expect(pit.settle()).toEqual({ ...none, dried: 1 });
  expect(pit.lakes.body[pit.at(3, 4)]).toBe(0);
});

test("a pool whose rim no two samples of are level is benched all round, or filled", () => {
  const p = pool(4, 4, (col, row) => ((col + row) % 2 ? 3 : 6));
  const made = p.settle();
  expect([made.laddered, made.benched + made.filled, made.dried]).toEqual([0, 1, 1]);
  expect(p.lakes.body[p.at(4, 4)]).toBe(0);
});

test("a swimming pool is carved to swim in; a fountain and a pond keep the shore's depth", () => {
  const bed = (kind: string, rules = {}): number => {
    const { lakes, grid } = oneBody(kind);
    const height = new Float32Array(81).fill(1);
    carveLakes(lakes, rules, height, grid);
    return Math.round((1 - height[4 * 9 + 4]!) * 100) / 100;
  };
  expect([bed("pool"), bed("fountain"), bed("reflecting_pool"), bed("pond"), bed("pool", { poolDepth: 2 })]).toEqual([1.5, 0.46, 0.46, 0.46, 2]);
});


test("a ledge two samples wide under a high rim is no way out", () => {
  // The rim 2 m over the water; two samples of it north of the pool level with the water, the rim behind them.
  const p = pool(4, 4, (col, row) => (row === 2 && (col === 5 || col === 6) ? 1.1 : 3));
  expect(p.settle()).toEqual({ ...none, laddered: 1 });
  // The ladder climbs the rim itself, by the pool's west end: 1.5 m under it, then the bed.
  expect([near(p.height[p.at(3, 3)]!), near(p.height[p.at(4, 3)]!), near(p.height[p.at(3, 4)]!)]).toEqual([1.5, 1.5, 0]);
});

test("a pool beside another that gives ground up goes under that ground in the same settling", () => {
  const p = pool(4, 4, (col) => (col === 9 ? 0.3 : 1.1));
  // A second pool east of the first, sample to sample, with lower ground east of it and a way's ground in its west row.
  p.lakes.bodies.push({ name: "", surface: 1, kind: "pool" });
  for (let row = 3; row <= 6; row++) for (const col of [7, 8]) [p.lakes.body[p.at(col, row)], p.height[p.at(col, row)]] = [2, -0.5];
  const beds = poolBeds(p.lakes, p.height);
  p.height[p.at(7, 4)] = 0.6;
  const settle = () => settleRims(p.lakes, {}, p.height, p.grid, -32, 1 / 16, beds);
  const made = settle();
  // The second goes under the ground east of it, 0.3; its way's sample stands out at 0.6, and the first goes under that.
  expect([made.lowered, made.crossed, p.lakes.bodies[1]!.surface, p.lakes.body[p.at(7, 4)], p.lakes.bodies[0]!.surface]).toEqual([2, 1, 0.1875, 0, 0.5]);
  expect(settle()).toEqual(none);
});
