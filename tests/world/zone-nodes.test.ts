import { expect, test } from "bun:test";
import { S, type Ground, type World } from "../../tools/mapworld/ground.ts";
import { clearingMask, makeNodes } from "../../tools/mapworld/nodes.ts";

/** A ground `side` samples a side, all open ground at one height. */
function ground(side: number): Ground {
  const n = side * side;
  return {
    grid: { nx: side, nz: side, cell: 2, noiseWest: 0, noiseNorth: 0 },
    surface: new Uint8Array(n).fill(S.OPEN),
    height: new Float32Array(n).fill(3),
    shore: new Float32Array(n).fill(500),
    sand: new Float32Array(n).fill(500),
    district: new Uint8Array(n),
  } as unknown as Ground;
}
const world = { districts: [] } as unknown as World;

/** Clearings as the build makes them: off-sample middles, the three radii it uses, some past the map's edge. */
function clearings(seed: number, count: number, side: number): [number, number, number][] {
  let h = seed;
  const next = (): number => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: count }, () => [next() * (side + 20) - 10, next() * (side + 20) - 10, [16, 49, 9, 30.25][Math.floor(next() * 4)]!]);
}

test("the clearing mask holds the squares a scan of every clearing clears", () => {
  const side = 129;
  const across = (side - 1) / 2;
  for (const seed of [1, 2, 3]) {
    const list = clearings(seed, 40, side);
    // Middles on a sample and half a sample off, where the strict compare decides.
    list.push([33, 33, 16], [34, 35, 9], [37.5, 41, 49]);
    const mask = clearingMask(across, across, list);
    for (let py = 0; py < across; py++) for (let px = 0; px < across; px++) {
      const col = px * 2 + 1, row = py * 2 + 1;
      expect([px, py, mask[py * across + px]]).toEqual([px, py, list.some(([c, r, d2]) => (c - col) ** 2 + (r - row) ** 2 < d2) ? 1 : 0]);
    }
  }
});

test("zone pictures are the same from the mask as from the scan", () => {
  const side = 129;
  const g = ground(side);
  const list = clearings(9, 25, side);
  const mask = clearingMask((side - 1) / 2, (side - 1) / 2, list);
  const scanned = makeNodes(g, world, (col, row) => list.some(([c, r, d2]) => (c - col) ** 2 + (r - row) ** 2 < d2));
  const stamped = makeNodes(g, world, (col, row) => mask[Math.floor(row / 2) * ((side - 1) / 2) + Math.floor(col / 2)] === 1);
  expect(stamped.plants).toEqual(scanned.plants);
  expect(stamped.stones).toEqual(scanned.stones);
  expect(scanned.plants.some((p) => p === 0)).toBe(true);
  expect(scanned.plants.some((p) => p !== 0)).toBe(true);
});

test("nothing grows on a street, a highway or a crosswalk, and a walk, a plaza and a lot keep their gardens", () => {
  const side = 129, across = (side - 1) / 2;
  const growth = { zones: {} } as unknown as NonNullable<Parameters<typeof makeNodes>[4]>;
  const plantsOn = (surface: number): number => {
    const g = ground(side);
    g.surface.fill(surface);
    return makeNodes(g, world, () => false, () => false, growth).plants.filter((p) => p !== 0).length;
  };
  for (const s of [S.STREET, S.HIGHWAY, S.CROSSWALK]) expect([s, plantsOn(s)]).toEqual([s, 0]);
  for (const s of [S.SIDEWALK, S.PLAZA, S.LOT]) expect(plantsOn(s)).toBeGreaterThan(across * across / 8);
  // Stones still lie in the road.
  const g = ground(side);
  g.surface.fill(S.STREET);
  expect(makeNodes(g, world, () => false, () => false, growth).stones.every((t) => t !== 0)).toBe(true);
});
