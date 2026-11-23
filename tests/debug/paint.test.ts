import { expect, test } from "bun:test";
import { Paint } from "../../client/core/debug/paint.ts";

const pixel = (p: Paint, x: number, y: number): number[] => [...p.image.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

test("a painted rectangle is clipped to the picture and in RGBA order", () => {
  const p = new Paint();
  p.size(8, 4);
  p.clear(0x000000ff);
  p.rect(6, 1, 10, 2, 0x112233ff);
  expect(pixel(p, 7, 1)).toEqual([0x11, 0x22, 0x33, 0xff]);
  expect(pixel(p, 5, 1)).toEqual([0, 0, 0, 0xff]);
  expect(pixel(p, 7, 3)).toEqual([0, 0, 0, 0xff]);
});

test("a colour under full alpha is laid over what is there", () => {
  const p = new Paint();
  p.size(2, 2);
  p.clear(0x000000ff);
  p.rect(0, 0, 1, 1, 0xff000080);
  const [r, g, b, a] = pixel(p, 0, 0);
  expect([Math.abs(r! - 128) <= 1, g, b, a]).toEqual([true, 0, 0, 0xff]);
});

test("a new size makes a new picture and done marks it changed", () => {
  const p = new Paint();
  p.size(4, 3);
  const v = p.image.version;
  p.size(4, 3);
  expect(p.image.data.length).toBe(4 * 3 * 4);
  p.size(5, 3);
  expect([p.width, p.height, p.image.data.length]).toEqual([5, 3, 60]);
  p.bar(1, 2, 1, 0xffffffff);
  p.done();
  expect(p.image.version).toBe(v + 1);
  expect(pixel(p, 2, 2)).toEqual([255, 255, 255, 255]);
  expect(pixel(p, 2, 0)).toEqual([0, 0, 0, 0]);
});
