// The palette: what is fixed stays as it was, and the block between is dyes and natural tones made by rule.
import { expect, test } from "bun:test";
import { hashBytes } from "../../shared/hash.ts";
import { EYE_BASE, HAIR_BASE, REGION_BASE, SKIN_BASE, defaultPalette, nearestColour, rampColours } from "../../shared/pack/palette.ts";

const palette = defaultPalette();
const at = (i: number): number[] => [...palette.subarray(i * 4, i * 4 + 3)];
const far = (c: readonly number[]): number => {
  const i = nearestColour(palette, c[0]!, c[1]!, c[2]!);
  return Math.hypot(palette[i * 4]! - c[0]!, palette[i * 4 + 1]! - c[1]!, palette[i * 4 + 2]! - c[2]!);
};

test("the fixed colours, the body colours and the regions are what they were, and the block between is full", () => {
  // Indices 0 to 21 and 214 to 255, as they were before the block between them was made again.
  expect(hashBytes(Uint8Array.from([...palette.subarray(0, 22 * 4), ...palette.subarray(SKIN_BASE * 4)])).toString(16)).toBe("d2fdf5f1");
  expect([at(0), at(3), at(15), at(SKIN_BASE), at(HAIR_BASE), at(EYE_BASE), at(REGION_BASE)]).toEqual([[255, 0, 255], [232, 140, 48], [128, 128, 128], [255, 224, 196], [236, 214, 150], [104, 66, 38], [255, 0, 255]]);
  // The block is exactly as long as the gap, every colour in it its own, and the same on any machine.
  const ramp = rampColours();
  expect([ramp.length, new Set(ramp.map(String)).size]).toEqual([SKIN_BASE - 22, SKIN_BASE - 22]);
  expect(hashBytes(palette.subarray(22 * 4, SKIN_BASE * 4)).toString(16)).toBe("b97bea09");
});

test("the dyes are twelve hues at five lightnesses, and the rest are natural tones from near black to near white", () => {
  const ramp = rampColours();
  // A row of dyes runs red, orange, yellow, and round to rose. Rows go from dark to light.
  const [red, orange, yellow, green, blue] = [0, 1, 2, 4, 8].map((hue) => ramp[2 * 12 + hue]!);
  expect([red![0]! > 200 && red![1]! < 80, orange![0]! > orange![1]! && orange![1]! > orange![2]!, yellow![2]! < 80 && yellow![1]! > 200, green![1]! > 200 && green![0]! < 80, blue![2]! > 200 && blue![0]! < 80]).toEqual([true, true, true, true, true]);
  const light = (c: readonly number[]): number => c[0]! + c[1]! + c[2]!;
  for (let hue = 0; hue < 12; hue++) for (let row = 1; row < 5; row++) expect(light(ramp[row * 12 + hue]!)).toBeGreaterThan(light(ramp[(row - 1) * 12 + hue]!));
  // What is left is more than two thirds of the block, none of it vivid, in runs of twelve from dark to light.
  const earth = ramp.slice(60);
  expect(earth.length).toBe(132);
  for (const c of earth) expect(Math.max(...c) - Math.min(...c)).toBeLessThan(90);
  for (let run = 0; run < 11; run++) {
    for (let step = 1; step < 12; step++) expect(light(earth[run * 12 + step]!)).toBeGreaterThan(light(earth[run * 12 + step - 1]!));
    expect([light(earth[run * 12]!) < 120, light(earth[run * 12 + 11]!) > 640]).toEqual([true, true]);
  }
});

test("natural materials find a near colour at any lightness: the mean colours of the materials there are, and the tones an artist reaches for", () => {
  // The mean base colour, as light, of the thatch tier's four materials and of the two test materials in planning/artist-test.
  const materials = { thatch: [192, 168, 115], mat: [178, 160, 118], pole: [133, 114, 90], cord: [119, 97, 64], wood: [119, 106, 94], feather: [200, 194, 184] };
  const off = Object.values(materials).map(far);
  // They were 19.9 away on average and 32.4 at worst on the ramp of hues alone.
  expect([Math.max(...off) < 14, off.reduce((a, b) => a + b, 0) / off.length < 9]).toEqual([true, true]);
  const named = [[62, 46, 34], [92, 64, 44], [150, 116, 78], [196, 160, 110], [150, 140, 126], [150, 84, 60], [214, 190, 130], [176, 158, 112], [158, 146, 106], [106, 104, 62], [90, 100, 60], [226, 216, 196], [188, 168, 136], [74, 62, 52], [128, 126, 124], [84, 88, 96], [200, 194, 178], [196, 164, 124], [48, 48, 52], [236, 234, 226], [176, 138, 100], [124, 84, 54], [70, 48, 36], [110, 104, 98], [228, 214, 186], [140, 124, 104], [36, 32, 30]];
  for (const c of named) expect([c, far(c) < 12.5]).toEqual([c, true]);
  // The nearest is a fixed colour, never the missing colour and never a region.
  expect([nearestColour(palette, 128, 128, 128), nearestColour(palette, 20, 20, 24)]).toEqual([15, 11]);
  expect(nearestColour(palette, 255, 0, 255)).toBeGreaterThan(0);
  expect(nearestColour(palette, 255, 0, 255)).toBeLessThan(REGION_BASE);
});
