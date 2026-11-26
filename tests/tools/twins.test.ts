import { expect, test } from "bun:test";
import { knownOf, own } from "../../tools/mapworld/known.ts";
import { dropTwins } from "../../tools/mapworld/twins.ts";

const slab = (x: number, yaw = 90, kind = "core:zruin_floor4_concrete") => ({ kind, x, y: 1.5, z: 20, yaw });

test("a piece placed twice stays once, the first, with whose it is", () => {
  const a = slab(10), b = slab(10), c = slab(14), d = slab(10.0001);
  own(a, 3);
  own(b, 7);
  const pieces = [a, c, b, d];
  expect(dropTwins(pieces)).toBe(2);
  expect([pieces.length, pieces[0] === a, pieces[1] === c, knownOf(pieces[0]!)!.owner]).toEqual([2, true, true, 3]);
});

test("another turn, kind, height or bend at the same place is another piece", () => {
  const pieces = [slab(10), slab(10, 270), slab(10, 90, "core:zruin_beam8_concrete"), { ...slab(10), y: 4.5 }, { ...slab(10), bend: [1, 2] }, { ...slab(10), bend: [1, 3] }, { ...slab(10), bend: [1, 2] }];
  expect(dropTwins(pieces)).toBe(1);
  expect(pieces.length).toBe(6);
});

test("pieces 16 km apart in one bucket are not taken for twins", () => {
  const pieces = [slab(10), slab(10 + 256 * 64), slab(10)];
  expect(dropTwins(pieces)).toBe(1);
  expect(pieces.map((p) => p.x)).toEqual([10, 10 + 256 * 64]);
});
