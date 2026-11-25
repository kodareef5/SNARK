import { expect, test } from "bun:test";
import { CellLists } from "../../tools/mapworld/cell-lists.ts";

/** Circles on a 300 m plane, some leaning past its edges. */
function circles(seed: number, count: number): [number, number, number][] {
  let h = seed;
  const next = (): number => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: count }, () => [next() * 340 - 20, next() * 340 - 20, next() * 12]);
}

test("a cell list finds every circle that comes within the square asked", () => {
  for (const seed of [1, 2, 3]) {
    const list = circles(seed, 400);
    const cells = new CellLists(300, 300, 8);
    for (const [x, z, r] of list) cells.count(x, z, r);
    cells.lay();
    list.forEach(([x, z, r], i) => cells.put(x, z, r, i));
    for (const [px, pz, reach] of circles(seed + 10, 200)) {
      const found = new Set<number>();
      cells.some(px, pz, reach, (i) => { found.add(i); return false; });
      list.forEach(([x, z, r], i) => {
        if (Math.abs(x - px) < r + reach && Math.abs(z - pz) < r + reach) expect([i, found.has(i)]).toEqual([i, true]);
      });
    }
  }
});

test("a cell list stops at the first number its test takes", () => {
  const cells = new CellLists(64, 64, 8);
  for (let i = 0; i < 3; i++) cells.count(20, 20, 2);
  cells.lay();
  for (let i = 0; i < 3; i++) cells.put(20, 20, 2, i);
  const seen: number[] = [];
  expect(cells.some(20, 20, 1, (i) => { seen.push(i); return i === 1; })).toBe(true);
  expect(seen).toEqual([0, 1]);
  expect(cells.some(50, 50, 1, () => true)).toBe(false);
});
