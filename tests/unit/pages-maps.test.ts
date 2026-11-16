import { expect, test } from "bun:test";
import { mapPoint, paintMap, sampleGrid } from "../../tools/pages/maps.ts";
import type { Picture } from "../../tools/pack/image.ts";

test("authored map coordinates align with north-up image endpoints and exclude outside points", () => {
  const bounds = [-4064, -4064, 4064, 4064];
  expect(mapPoint(-4064, 4064, bounds)).toEqual({ x: 0, y: 0 });
  expect(mapPoint(4064, -4064, bounds)).toEqual({ x: 1, y: 1 });
  expect(mapPoint(0, 0, bounds)).toEqual({ x: .5, y: .5 });
  expect(mapPoint(4065, 0, bounds)).toBe(null);
  expect(mapPoint(NaN, 0, bounds)).toBe(null);
  expect(mapPoint(0, 0, [1, 1, 1, 1])).toBe(null);
});

test("map reduction preserves geographic endpoints and thin authored road features", () => {
  const p: Picture = { width: 4, height: 4, channels: 1, depth: 8, data: Uint8Array.from([2, 0, 0, 4, 0, 0, 7, 0, 0, 0, 0, 0, 6, 0, 0, 8]) };
  expect([...sampleGrid(p, 2, "point")]).toEqual([2, 4, 6, 8]);
  expect([...sampleGrid(p, 2, "max")]).toEqual([2, 7, 6, 8]);
});

test("map layers share their grid and roads stay transparent away from authored roads", () => {
  const h = Float32Array.from([10000, 10010, 10020, 10030]);
  const b = Float32Array.from([1, 2, 3, 7]), w = Float32Array.from([255, 0, 0, 0]), r = Float32Array.from([0, 1, 0, 0]);
  const layers = paintMap(h, b, w, r, 2, 64);
  expect([layers.terrain.width, layers.biomes.width, layers.roads.width]).toEqual([2, 2, 2]);
  expect([layers.roads.data[3], layers.roads.data[7], layers.roads.data[11], layers.roads.data[15]]).toEqual([0, 214, 0, 0]);
  expect([...layers.terrain.data.slice(0, 4)]).toEqual([22, 69, 91, 255]);
  expect(() => paintMap(new Float32Array(3), b, w, r, 2, 64)).toThrow("extent");
});
