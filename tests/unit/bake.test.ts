// The flat colours of a mesh that is drawn with materials, read off its pictures.
import { expect, test } from "bun:test";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { MOST_COLOURS, baker, flatOf, painted, placed } from "../../tools/pack/bake.ts";
import type { Picture } from "../../tools/pack/image.ts";
import { REGION_COLOURS } from "../../tools/pack/mask.ts";
import { simplify } from "../../tools/pack/simplify.ts";
import { picture, plainMaterial, plate } from "../fixtures/shapes.ts";

const palette = defaultPalette();

test("a mesh's flat colours are its regions and a few palette colours, a dozen at most, with no triangle alone in its colour", () => {
  // Three materials, each a rainbow of its own, and six regions across the top quarter: more colours than a flat mesh may have.
  const rainbow = (dark: number, light: number): Picture => picture(64, (x) => [0, 1, 2].map((k) => Math.round(dark + ((light - dark) / 2) * (1 + Math.cos((x / 64 - k / 3) * Math.PI * 2)))));
  const regions = picture(64, (x, y) => (y < 16 ? REGION_COLOURS[Math.floor((x * 6) / 64)]! : [0, 0, 0]));
  const thirds = plate(12, (_, j) => Math.floor(j / 4));
  const colours = baker(thirds, [plainMaterial("a"), plainMaterial("b"), plainMaterial("c")], [{ base: rainbow(0, 255), regions }, { base: rainbow(0, 110) }, { base: rainbow(150, 255) }], palette)(thirds);
  const used = [...new Set(colours)].sort((a, b) => a - b);
  expect(used.filter((c) => c >= REGION_BASE)).toEqual([240, 241, 242, 243, 244, 245]);
  expect(used.length).toBe(MOST_COLOURS);
  // A triangle is the region the map has under it, all across the top quarter.
  for (let t = 0; t < 24 * 3; t++) expect(colours[t]).toBe(REGION_BASE + Math.floor((t % 24) / 4));

  // One material alone gets a handful. One colour is enough for a picture of one colour, or for a tint with no picture.
  const whole = plate(12);
  const alone = new Set(baker(whole, [plainMaterial("a")], [{ base: rainbow(0, 255) }], palette)(whole)).size;
  expect([alone > 3, alone <= 6]).toEqual([true, true]);
  expect([...new Set(baker(whole, [plainMaterial("a")], [{ base: picture(64, () => [150, 152, 156]) }], palette)(whole))]).toEqual([2]);
  expect([...new Set(baker(whole, [{ ...plainMaterial("a"), tint: [0.2, 0.2, 0.2] }], [{}], palette)(whole))]).toEqual([15]);
  expect(() => baker(plate(2, () => 1), [plainMaterial("a")], [], palette)).toThrow("which the mesh does not have");

  // Grey with a blue cell and a red one. Where the red is only half its cell, one triangle, it has no neighbour of its colour and goes.
  const spotted = (half: boolean): Picture => picture(64, (x, y) => (x >= 16 && x < 32 && y >= 16 && y < 32 && (!half || x + y < 48) ? [208, 72, 72] : x >= 32 && x < 48 && y >= 32 && y < 48 ? [60, 110, 170] : [150, 152, 156]));
  const four = plate(4);
  const settled = (half: boolean): Uint8Array => baker(four, [plainMaterial("a")], [{ base: spotted(half) }], palette)(four);
  const count = (colours: Uint8Array): number[] => [2, 8, 14].map((colour) => [...colours].filter((c) => c === colour).length);
  expect([count(settled(false)), count(settled(true))]).toEqual([[28, 2, 2], [30, 0, 2]]);

  // Drawn flat with its surface, a triangle shows the colour of its last corner. That is its own colour even for the
  // two cells of two triangles, which have no vertex to themselves.
  const drawn = painted(four, settled(false));
  expect([drawn.uvs, [...drawn.indices].sort((a, b) => a - b)]).toEqual([four.uvs, [...four.indices].sort((a, b) => a - b)]);
  for (let t = 0; t < 32; t++) expect(drawn.colors[drawn.indices[t * 3 + 2]!]).toBe(settled(false)[t]!);

  // As a flat level every triangle has corners of its own in its colour, which the simplifier makes one mesh of again.
  const flat = flatOf(four, settled(false));
  expect([flat.uvs, flat.positions.length / 3, count(flat.colors)]).toEqual([undefined, 96, [84, 6, 6]]);
  const welded = simplify(flat, [32])[0]!.lod;
  expect([welded.positions.length / 3 < 40, count(Uint8Array.from({ length: 32 }, (_, t) => welded.colors[welded.indices[t * 3 + 2]!]!))]).toEqual([true, [28, 2, 2]]);
});

test("vertices a hair apart are at one point, and vertices a step of the pack's grid apart are not", () => {
  const lod = plate(2);
  lod.positions.set([1e-9, 0, 0, 0.5, 1e-9, 0], 0);
  // The second vertex is copied a hair off, and again a whole step off: the plate is a metre across, so a step is 1 / 65534.
  const positions = Float32Array.from([...lod.positions, 0.5 + 1e-7, 0, 0, 0.5 + 2 / 65534, 0, 0]);
  expect([...placed({ ...lod, positions })]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 10]);
});
