import { expect, test } from "bun:test";
import { BANK_FIXED, BANK_LAND, BANK_WATER, shapeBanks, shareDistance } from "../../shared/world/banks.ts";

/** Where along row `z` the ground crosses `level`, in samples, walking from the water at x = 0 inland. */
function crossing(h: Float32Array, n: number, z: number, level = 0): number {
  for (let x = 1; x < n; x++) {
    const a = h[z * n + x - 1]! - level, b = h[z * n + x]! - level;
    if (a < 0 && b >= 0) return x - 1 + a / (a - b);
  }
  return NaN;
}

test("the filter's share of land gives back the distance to a straight line", () => {
  expect(shareDistance(0.5)).toBeCloseTo(0, 3);
  expect(shareDistance(0.999999)).toBeGreaterThan(0.95);
  expect(shareDistance(0.000001)).toBeLessThan(-0.95);
  expect(shareDistance(0.8)).toBeCloseTo(-shareDistance(0.2), 3);
});

test("a low grass bank stepped across the samples gets a smooth waterline and a slope, and high or built banks stay", () => {
  const n = 96, h = new Float32Array(n * n), kind = new Uint8Array(n * n);
  // A shore running at a slant: 12 cm grass to a 55 cm deep bed in one sample, stepping a sample every third row. Rows
  // 60 on are a 1.8 m bank, and rows under 12 are a road at the water's edge.
  const edge = (z: number): number => 30 + Math.floor(z / 3);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x, land = x >= edge(z);
      h[i] = land ? (z >= 60 ? 1.8 : 0.12) : -0.55;
      kind[i] = land ? (z < 12 ? BANK_LAND | BANK_FIXED : BANK_LAND) : BANK_WATER;
    }
  const original = h.slice(), bed = new Set<number>(), out = new Set<number>();
  const moved = shapeBanks(h, n, n, 2, (i) => kind[i]!, () => 0, (i) => bed.add(i), (i) => out.add(i));
  expect(moved).toBeGreaterThan(150);
  // Along the low bank the waterline is a straight line, where it stepped a sample at a time.
  const rows = [30, 31, 32, 33, 34, 35, 36, 37, 38];
  const fit = rows.map((z) => crossing(h, n, z) - z / 3);
  const before = rows.map((z) => crossing(original, n, z) - z / 3);
  const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
  expect(spread(before)).toBeGreaterThan(0.6);
  expect(spread(fit)).toBeLessThan(0.25);
  // Across it the ground falls all the way, gently: never more than 22 cm a sample.
  for (const z of rows)
    for (let x = edge(z) - 4; x <= edge(z) + 4; x++) {
      const step = h[z * n + x]! - h[z * n + x - 1]!;
      expect(step).toBeGreaterThanOrEqual(-0.001);
      expect(step).toBeLessThan(0.22);
    }
  // The high bank, the road and the bed far out are as they were.
  for (let x = 0; x < n; x++) {
    expect(h[75 * n + x]).toBe(original[75 * n + x]!);
    expect(h[5 * n + x]).toBe(original[5 * n + x]!);
  }
  expect(h[30 * n + 2]).toBe(original[30 * n + 2]!);
  expect(bed.size).toBeGreaterThan(0);
  for (const i of bed) expect(h[i]).toBeLessThan(0);
  for (const i of out) expect(h[i]).toBeGreaterThanOrEqual(0);
});
