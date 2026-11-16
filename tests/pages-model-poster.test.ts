import { expect, test } from "bun:test";
import { parsePack } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import { buildPack, type SourceMesh } from "../tools/pack/write.ts";
import { ModelView } from "../tools/snap.ts";
import { PICK_SKY } from "../tools/snap/raster.ts";
import { posterPixels } from "../tools/pages/models/poster.ts";

test("native posters remove only empty sky pixels, preserving black geometry and its source colours", () => {
  const mesh: SourceMesh = { id: "test:black", lods: [{ positions: Float32Array.from([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 1, 2]) }] };
  const palette = defaultPalette(); palette.fill(0, 0, 3);
  const view = new ModelView(parsePack(buildPack([mesh], palette)), 48, 48, [0, 0, 0]);
  view.draw({ mesh: 0, level: 0, around: 0, above: 0, centre: [0, 0, 0], radius: 1, rig: null, colors: [0, 0, 0, 0, 0, 0], lit: false });
  const original = view.raster.color.slice(), pixels = posterPixels(view.raster);
  let opaque = 0, clear = 0, changedColour = false, wrongAlpha = false;
  for (let at = 0; at < view.raster.pickKind.length; at++) {
    const sky = view.raster.pickKind[at] === PICK_SKY;
    if (sky) clear++; else opaque++;
    if (pixels[at * 4 + 3] !== (sky ? 0 : 255)) wrongAlpha = true;
    for (let c = 0; c < 3; c++) if (pixels[at * 4 + c] !== original[at * 4 + c]) changedColour = true;
  }
  expect(clear).toBeGreaterThan(0);
  expect(opaque).toBeGreaterThan(0);
  expect(wrongAlpha).toBe(false);
  expect(changedColour).toBe(false);
  expect(view.raster.color).toEqual(original);
});
