// What a tier asks of the screen and the card beside its detail: how many pixels the canvas has for one CSS pixel
// (canvasRatio), and how a material's textures are read where they are seen at a glancing angle.
import { expect, test } from "bun:test";
import { TIERS, canvasRatio, forTouch, tierOf } from "../../client/core/assets/tiers.ts";

test("high and ultra read a material's textures for the angle they are seen at, as far as 16 to 1 where the card offers it; low poly, medium and a touch-first device read them as seen head on", () => {
  expect(TIERS.map((t) => [t.name, t.anisotropy])).toEqual([["lowpoly", 1], ["medium", 1], ["high", 16], ["ultra", 16]]);
  expect(TIERS.map((t) => forTouch(t, true).anisotropy)).toEqual([1, 1, 1, 1]);
});

test("every tier draws the screen's own pixels as far as its pixelRatio, ultra as many as the screen has, and a touch-first device as its rule says", () => {
  /** The canvas a tier draws in a window of `w` by `h` CSS pixels on a screen of `dpr` device pixels to one. */
  const canvas = (name: string, dpr: number, w: number, h: number, touch = false): [number, number] => {
    const r = canvasRatio(forTouch(tierOf(name), touch), dpr, w, h);
    return [Math.floor(w * r), Math.floor(h * r)];
  };
  const tiers = ["lowpoly", "medium", "high", "ultra"];
  // A 1440p screen at one device pixel a CSS pixel, and at two; 1080p at one, and a laptop of 1080p at one and a half.
  expect(tiers.map((t) => canvas(t, 1, 2560, 1440))).toEqual([[2560, 1440], [2560, 1440], [2560, 1440], [2560, 1440]]);
  expect(tiers.map((t) => canvas(t, 2, 2560, 1440))).toEqual([[2560, 1440], [3840, 2160], [5120, 2880], [5120, 2880]]);
  expect(tiers.map((t) => canvas(t, 1, 1920, 1080))).toEqual([[1920, 1080], [1920, 1080], [1920, 1080], [1920, 1080]]);
  expect(tiers.map((t) => canvas(t, 1.5, 1280, 720))).toEqual([[1280, 720], [1920, 1080], [1920, 1080], [1920, 1080]]);
  // A touch-first device, as on a phone of three device pixels a CSS pixel.
  expect(tiers.map((t) => canvas(t, 3, 390, 844, true))).toEqual([[390, 844], [585, 1266], [780, 1688], [1170, 2532]]);
});
