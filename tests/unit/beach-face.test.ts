import { expect, test } from "bun:test";
import { BEACH_LAND, BEACH_SEA, shapeBeach } from "../../shared/world/beach.ts";

test("the sandy waterline rounds a stepped survey across tile boundaries and leaves the deep bed and built bank intact", () => {
  const n = 81,
    h = new Float32Array(n * n),
    kind = new Uint8Array(n * n);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const d = x - (32 + Math.floor(z / 8));
      const i = z * n + x;
      h[i] = d < 0 ? -0.3 + 0.07 * d : 0.12 + 0.09 * Math.max(0, d - 3);
      kind[i] = z < 23 ? 0 : d < 0 ? BEACH_SEA : BEACH_LAND;
    }
  const original = h.slice(),
    bed = new Set<number>();
  expect(
    shapeBeach(
      h,
      n,
      n,
      2,
      (i) => kind[i]!,
      (i) => bed.add(i),
    ),
  ).toBeGreaterThan(50);
  const row = 40,
    edge = 32 + Math.floor(row / 8);
  const coast = (x: number) => h[row * n + edge + x]!;
  expect(coast(-9)).toBe(original[row * n + edge - 9]!);
  expect(coast(-2)).toBeLessThan(0);
  expect(coast(2)).toBeGreaterThan(0);
  for (let x = -4; x <= 4; x++) {
    expect(coast(x) - coast(x - 1)).toBeGreaterThan(0);
    expect(coast(x) - coast(x - 1)).toBeLessThan(0.24);
  }
  expect(h.slice((n - 1) * n)).toEqual(original.slice((n - 1) * n));
  expect(h.slice(0, 23 * n)).toEqual(original.slice(0, 23 * n));
  expect(bed.size).toBeGreaterThan(0);
  for (const i of bed) expect(kind[i]).toBe(BEACH_SEA);
  const flat = original.slice();
  expect(
    shapeBeach(
      flat,
      n,
      n,
      2,
      () => BEACH_SEA,
      () => {
        throw Error("no beach");
      },
    ),
  ).toBe(0);
  expect(flat).toEqual(original);
});
