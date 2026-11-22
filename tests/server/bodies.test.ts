import { expect, test } from "bun:test";
import { BODY_CELL, BodyGrid } from "../../server/bodies.ts";

test("a body grid gives the bodies in the cells a square meets, in the same order for the same adds, and forgets them when cleared", () => {
  const grid = new BodyGrid({ chunksX: 4, chunksZ: 4 });
  const near = (x: number, z: number, r: number): number[] => {
    // `found` may be replaced by a larger one during the call, so it is read after.
    const n = grid.near(x, z, r);
    return Array.from(grid.found.subarray(0, n));
  };
  // Two in one cell, one in the next cell east, one in the next chunk, one far off, and one off the map's edge.
  grid.add(1, 100.5, 100.5);
  grid.add(2, 101.5, 100.5);
  grid.add(3, 100.5 + BODY_CELL, 100.5);
  grid.add(4, 130, 100.5);
  grid.add(5, 220, 220);
  grid.add(6, -3, 100.5);
  expect(near(100.5, 100.5, 1)).toEqual([2, 1]);
  expect(near(104, 100.5, 5)).toEqual([2, 1, 3]);
  expect(near(115, 100.5, 16)).toEqual([2, 1, 3, 4]);
  expect(near(220, 220, 0)).toEqual([5]);
  expect(near(0, 100.5, 2)).toEqual([6]);
  // Past a thousand bodies it grows, and still finds every one.
  for (let i = 0; i < 1000; i++) grid.add(100 + i, 50 + (i % 40), 50 + Math.floor(i / 40));
  expect(near(70, 62, 30).filter((e) => e >= 100).length).toBe(1000);
  grid.clear();
  expect([grid.count, near(100.5, 100.5, 50).length]).toEqual([0, 0]);
  grid.add(7, 100.5, 100.5);
  expect(near(100.5, 100.5, 1)).toEqual([7]);
});
