import { expect, test } from "bun:test";
import { type Bank, BANK_FAR, STILL_SHORE, bankFade, bankFoamGain, bankFoamScale, bankMurk, bankNear, bankShade, bankWash, shoreBank, shoreWet } from "../../client/core/render/bank.ts";
import { SURFACE_NAMES } from "../../content/surfaces.ts";

const bank = (): Bank => ({ soft: 0, built: 0, still: 0, muddy: 0, grade: 0 });
// Heights in units of 1/64 m over a level of 1000: two corners 12 cm over the water, two 55 cm under it.
const LOW = [1000 + 8, 1000 + 8, 1000 - 35, 1000 - 35];
const WALL = [1000 + 112, 1000 + 112, 1000 - 192, 1000 - 192];
const at = (tints: number[], heights = LOW): Bank => shoreBank(heights, tints, 0.5, 0.25, 1000, 2, 1 / 64, 1, bank());

test("a beach keeps the water as it was, whatever lies past it", () => {
  // Sand on the land, the beach's bed under the water.
  const b = at([125, 124, 122, 123]);
  expect([b.soft, b.built, b.still, b.muddy]).toEqual([0, 0, 0, 0]);
  expect([bankWash(b), bankFoamScale(b, 0.3), bankFoamGain(b), bankMurk(b), bankShade(b, 0.1), bankFade(b, 0.3)]).toEqual([1, 1, 1, 0, 0, 0.3]);
});

test("a grass bank laps in a thin line and is murkier; a wall is shaded at its foot; a marsh's pool is still", () => {
  const grass = at([197, 150, 123, 123]);
  expect(grass.soft).toBeCloseTo(0.75, 5);
  expect(grass.built).toBe(0);
  expect(bankWash(grass)).toBeLessThan(1);
  // The line spans LAP metres out from the waterline: on a slope of 0.24 the depth is stretched more than twice.
  expect(bankFoamScale(grass, 0.3)).toBeGreaterThan(1.5);
  expect(bankMurk(grass)).toBeCloseTo(0.75, 5);
  const wall = at([85, 85, 123, 123], WALL);
  expect(wall.grade).toBeGreaterThan(1.1);
  expect(wall.built).toBeCloseTo(0.75, 5);
  expect(bankWash(wall)).toBeCloseTo(0.25, 5);
  expect(bankShade(wall, 0.05)).toBeGreaterThan(bankShade(wall, 1));
  // A steep grass bank is a wall too.
  expect(at([197, 197, 123, 123], WALL).built).toBeCloseTo(0.75, 5);
  // All four corners a marsh's, two of them under the water.
  const pool = at([139, 139, 139, 139]);
  expect(pool.still).toBeCloseTo(0.25, 5);
  expect(bankFade(pool, 0.3)).toBeLessThan(0.3);
  expect(bankFade({ ...pool, still: 1 }, 0.3)).toBeCloseTo(STILL_SHORE, 5);
  expect(bankFoamGain({ ...pool, still: 1 })).toBeLessThan(0.5);
  // A muddy bed makes it murky and keeps the line.
  const mud = at([197, 197, 129, 128]);
  expect(mud.muddy).toBeCloseTo(0.25, 5);
  // It fades out far off.
  expect([bankNear(0), bankNear(BANK_FAR)]).toEqual([1, 0]);
});

test("the ground is wet under the sea and just over it near the waterline, and the beach's sand is left as it is", () => {
  const grass = SURFACE_NAMES.indexOf("grass"), sand = SURFACE_NAMES.indexOf("sand");
  expect(shoreWet(-0.1, 0, grass)).toBe(1);
  expect(shoreWet(0.05, 0.3, grass)).toBeGreaterThan(0.8);
  // Flat ground 12 cm over the sea is far from any waterline, and dry.
  expect(shoreWet(0.12, 0.01, grass)).toBe(0);
  expect(shoreWet(0.5, 1, grass)).toBe(0);
  expect(shoreWet(-0.1, 0, sand)).toBe(0);
});
