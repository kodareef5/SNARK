// A layer of tiling value noise, a channel at a time (engine.ts): what a wall's read would otherwise hash for at every
// pixel of every frame, made once. The weathering reads its slow noises from one; a material could read another.

import type { Job } from "./engine.ts";
import { fbm } from "./noise.ts";

/** A layer of noise, channel c `cells[c]` cells a side of `octaves` octaves, seeded `seed` and on from it a channel at a time. */
export function grainJob(seed: number, cells: readonly [number, number, number, number], octaves = 1): Job {
  return {
    layers: 1,
    bands: 1,
    pad: 0,
    taps: [1, 1],
    cost: 1,
    rows: 2,
    glsl: `vec4 made(vec2 at) {
  vec4 g = uJob[2], n = uJob[3];
  int s = int(g.x), k = int(g.y);
  vec4 o;
  for (int c = 0; c < 4; c++) o[c] = fbm(at.x * n[c], at.y * n[c], int(n[c]), int(n[c]), s + c * 1000, k);
  return o;
}
`,
    fill(_layer, _band, out, at) {
      out[at] = seed;
      out[at + 1] = octaves;
      out[at + 2] = out[at + 3] = 0;
      for (let c = 0; c < 4; c++) out[at + 4 + c] = cells[c]!;
    },
    made(_layer, _band, u, v, out) {
      for (let c = 0; c < 4; c++) out[c] = fbm(u * cells[c]!, v * cells[c]!, cells[c]!, cells[c]!, seed + c * 1000, octaves);
    },
  };
}
