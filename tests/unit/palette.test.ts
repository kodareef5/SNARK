// The palette: what is fixed stays as it was, and the block between is dyes and natural tones made by rule, the natural
// tones fitted to the colours in tests/fixtures/palette-targets.ts.
import { expect, test } from "bun:test";
import { hashBytes } from "../../shared/hash.ts";
import { EYE_BASE, HAIR_BASE, RAMP_BASE, REGION_BASE, SKIN_BASE, defaultPalette, nearestColour, rampColours } from "../../shared/pack/palette.ts";
import { TARGETS, cie76, labOf, rgbOf } from "../fixtures/palette-targets.ts";

const palette = defaultPalette();
const at = (i: number): number[] => [...palette.subarray(i * 4, i * 4 + 3)];
/** How far a colour lands, by eye, from the palette colour it is drawn in. */
const far = (c: readonly number[]): number => cie76(c, at(nearestColour(palette, c[0]!, c[1]!, c[2]!)));

test("the fixed colours, the body colours, the regions and the dyes are what they were, and the block between is full", () => {
  // Indices 0 to 21 and 214 to 255, as they were before the block between them was made again.
  expect(hashBytes(Uint8Array.from([...palette.subarray(0, RAMP_BASE * 4), ...palette.subarray(SKIN_BASE * 4)])).toString(16)).toBe("d2fdf5f1");
  expect([at(0), at(3), at(15), at(SKIN_BASE), at(HAIR_BASE), at(EYE_BASE), at(REGION_BASE)]).toEqual([[255, 0, 255], [232, 140, 48], [128, 128, 128], [255, 224, 196], [236, 214, 150], [104, 66, 38], [255, 0, 255]]);
  // The dyes, 22 to 81, are as they were before the natural tones were fitted again.
  expect(hashBytes(palette.subarray(RAMP_BASE * 4, (RAMP_BASE + 60) * 4)).toString(16)).toBe("dd82c2");
  // The block is exactly as long as the gap, every colour in it its own, and the same on any machine.
  const ramp = rampColours();
  expect([ramp.length, new Set(ramp.map(String)).size]).toEqual([SKIN_BASE - RAMP_BASE, SKIN_BASE - RAMP_BASE]);
  expect(hashBytes(palette.subarray(RAMP_BASE * 4, SKIN_BASE * 4)).toString(16)).toBe("c5b6fd1f");
});

test("the dyes are twelve hues at five lightnesses, and the rest are runs of natural tones from dark to light", () => {
  const ramp = rampColours();
  // A row of dyes runs red, orange, yellow, and round to rose. Rows go from dark to light.
  const [red, orange, yellow, green, blue] = [0, 1, 2, 4, 8].map((hue) => ramp[2 * 12 + hue]!);
  expect([red![0]! > 200 && red![1]! < 80, orange![0]! > orange![1]! && orange![1]! > orange![2]!, yellow![2]! < 80 && yellow![1]! > 200, green![1]! > 200 && green![0]! < 80, blue![2]! > 200 && blue![0]! < 80]).toEqual([true, true, true, true, true]);
  const light = (c: readonly number[]): number => c[0]! + c[1]! + c[2]!;
  for (let hue = 0; hue < 12; hue++) for (let row = 1; row < 5; row++) expect(light(ramp[row * 12 + hue]!)).toBeGreaterThan(light(ramp[(row - 1) * 12 + hue]!));
  // What is left is more than two thirds of the block, none as vivid as a dye, in runs that grow lighter: two of greys
  // from near black to near white, and shorter ones the further they are from grey.
  const earth = ramp.slice(60);
  expect(earth.length).toBe(132);
  const lab = earth.map(labOf);
  for (const [, a, b] of lab) expect(Math.hypot(a, b)).toBeLessThan(60);
  const runs: number[][] = [];
  lab.forEach(([l], i) => (i > 0 && l > lab[i - 1]![0] ? runs[runs.length - 1]!.push(l) : runs.push([l])));
  expect(runs.map((r) => r.length)).toEqual([12, 12, 10, 10, 10, 10, 8, 8, 8, 8, 8, 8, 8, 6, 6]);
  for (const grey of runs.slice(0, 2)) expect([grey[0]! < 20, grey[11]! > 85]).toEqual([true, true]);
});

test("natural colours land near a palette colour: the dodo's, every material's, and those of creatures, buildings, ground and plants", () => {
  // The mean and the worst, by eye, of each group. Under about 5 reads as the same colour.
  // On D167's ramp they were 5.6 and 15.2 for the dodo, 4.7 and 8.6 for the materials, 10.7 and 33 for plants, and
  // 4.3 and 9.9 for the earth tones that ramp was held to.
  const most: Record<string, [mean: number, worst: number]> = { dodo: [4.5, 10], materials: [4, 8], creatures: [5, 11], building: [5, 10], ground: [4.5, 10], plants: [6, 12], earth: [5.5, 10.5] };
  for (const [group, [mean, worst]] of Object.entries(most)) {
    const off = TARGETS[group]!.map(([, hex]) => far(rgbOf(hex)));
    expect([group, off.reduce((a, b) => a + b, 0) / off.length < mean, Math.max(...off) < worst]).toEqual([group, true, true]);
  }
  // The dodo's colours by default, the first of each region in its design: slate, rose buff, olive horn, ochre, umber
  // and cream. The ochre was 12 away and the nearest natural tone 13.5.
  for (const hex of ["6B737A", "DDA58E", "8F8A5E", "C4983C", "3B302A", "E6DCC4"]) expect([hex, far(rgbOf(hex)) < 7.5]).toEqual([hex, true]);
  // The nearest is a fixed colour, never the missing colour and never a region.
  expect([nearestColour(palette, 128, 128, 128), nearestColour(palette, 20, 20, 24)]).toEqual([15, 11]);
  expect(nearestColour(palette, 255, 0, 255)).toBeGreaterThan(0);
  expect(nearestColour(palette, 255, 0, 255)).toBeLessThan(REGION_BASE);
});
