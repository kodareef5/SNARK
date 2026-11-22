// The far city's whole pictures held to the near drawing from every side (farcity.test.ts has the rules and one small
// view): rasterized frames by the dozen at full size, slow by nature.

import { expect, test } from "bun:test";
import { cityWorld, slopes } from "../fixtures/cityworld.ts";

const sum = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0);

test("sloped pieces drawn far are the near store's picture, from three sides", () => {
  const scene = slopes(160, 160, 0, 5000);
  // Every group, from three sides and 150 m off, on its ground: the box level far is the same picture as the near store's.
  const w = cityWorld({ chunks: 8, statics: scene.all, width: 640, height: 360 });
  const chunks = [...new Set(scene.all.map((s) => w.chunkOf(s.x, s.z)))];
  w.cam.fovY = (14 * Math.PI) / 180;
  for (const view of [0.4, 2.3, 4.4]) {
    w.look(160, 2, 160, 150, view, 25);
    w.frame(true);
    w.frame(true);
    // The sky's openness and what stands overhead all on the card, so that the light is the same in both pictures.
    while (!w.scene.farShadow!.whole) w.frame(true);
    const drawnFar = w.covered().far;
    const colours = w.raster.color.slice();
    expect(sum(drawnFar)).toBeGreaterThan(5000);
    for (const c of chunks) w.rows(c);
    w.frame(true);
    const { far, near } = w.covered();
    expect(sum(far)).toBe(0);
    let differ = 0;
    for (let i = 0; i < near.length; i++) if (Math.max(...[0, 1, 2].map((k) => Math.abs(w.raster.color[i * 4 + k]! - colours[i * 4 + k]!))) > 6) differ++;
    expect(differ / sum(drawnFar)).toBeLessThan(0.01);
    for (const c of chunks) w.drop(c);
  }
});
