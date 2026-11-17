// What a tier asks of the screen and the card beside its detail: how many pixels the canvas has for one CSS pixel
// (canvasRatio), and how a material's textures are read where they are seen at a glancing angle.
import { expect, test } from "bun:test";
import { TIERS, canvasRatio, forTouch, tierOf } from "../../client/core/assets/tiers.ts";

test("high and ultra read a material's textures for the angle they are seen at, as far as 16 to 1 where the card offers it; low poly, medium and a touch-first device read them as seen head on", () => {
  expect(TIERS.map((t) => [t.name, t.anisotropy])).toEqual([["lowpoly", 1], ["medium", 1], ["high", 16], ["ultra", 16]]);
  expect(TIERS.map((t) => forTouch(t, true).anisotropy)).toEqual([1, 1, 1, 1]);
});

test("ultra draws twice the screen's pixels a side on a screen of one or one and a half device pixels a CSS pixel, as far as a 5K screen's pixels; the other tiers and a touch-first device draw the screen's own at most, as they did", () => {
  /** The canvas a tier draws in a window of `w` by `h` CSS pixels on a screen of `dpr` device pixels to one. */
  const canvas = (name: string, dpr: number, w: number, h: number, touch = false): [number, number] => {
    const r = canvasRatio(forTouch(tierOf(name), touch), dpr, w, h);
    return [Math.floor(w * r), Math.floor(h * r)];
  };
  const tiers = ["lowpoly", "medium", "high", "ultra"];
  // A 1440p screen at one device pixel a CSS pixel, and at two.
  expect(tiers.map((t) => canvas(t, 1, 2560, 1440))).toEqual([[2560, 1440], [2560, 1440], [2560, 1440], [5120, 2880]]);
  expect(tiers.map((t) => canvas(t, 2, 2560, 1440))).toEqual([[2560, 1440], [3840, 2160], [5120, 2880], [5120, 2880]]);
  // 1080p at one; a laptop of 1080p at one and a half, whose device pixels ultra doubles; 1440p's CSS pixels at one
  // and a half, a 4K screen, where twice would pass 5K's pixels, so a third more a side.
  expect(tiers.map((t) => canvas(t, 1, 1920, 1080))).toEqual([[1920, 1080], [1920, 1080], [1920, 1080], [3840, 2160]]);
  expect(tiers.map((t) => canvas(t, 1.5, 1280, 720))).toEqual([[1280, 720], [1920, 1080], [1920, 1080], [3840, 2160]]);
  expect(canvas("ultra", 1.5, 2560, 1440)).toEqual([5120, 2880]);
  // A 4K screen at one: never past 5K's pixels, and never under the screen's own however large the window.
  expect(canvas("ultra", 1, 3840, 2160)).toEqual([5120, 2880]);
  expect(canvas("ultra", 1, 7680, 4320)).toEqual([7680, 4320]);
  // A touch-first device, as on a phone of three device pixels a CSS pixel, or one of one forced to ultra.
  expect(canvas("ultra", 1, 1920, 1080, true)).toEqual([1920, 1080]);
  expect(tiers.map((t) => canvas(t, 3, 390, 844, true))).toEqual([[390, 844], [585, 1266], [780, 1688], [1170, 2532]]);
});
