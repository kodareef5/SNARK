// The engine's smallest job (engine.ts): a layer of tiling noise in each channel, which a material could read. Nothing
// in the game draws it yet; the engine's tests and the card's check draw it beside the weathering's, which holds the
// engine to a job it was not made for.

import type { Job } from "./engine.ts";
import { fbm } from "./noise.ts";

/** A layer `cells` cells a side of `octaves` of noise, seeded `seed` and on from it a channel at a time. */
export function grainJob(seed: number, cells = 8, octaves = 4): Job {
  return {
    layers: 1,
    bands: 1,
    pad: 0,
    taps: [1, 1],
    cost: 2,
    rows: 1,
    glsl: `vec4 made(vec2 at) {
  vec4 g = uJob[2];
  int s = int(g.x), n = int(g.y), k = int(g.z);
  vec2 p = at * g.y;
  return vec4(fbm(p.x, p.y, n, n, s, k), fbm(p.x, p.y, n, n, s + 1000, k), fbm(p.x, p.y, n, n, s + 2000, k), fbm(p.x, p.y, n, n, s + 3000, k));
}
`,
    fill(_layer, _band, out, at) {
      out[at] = seed;
      out[at + 1] = cells;
      out[at + 2] = octaves;
      out[at + 3] = 0;
    },
    made(_layer, _band, u, v, out) {
      for (let c = 0; c < 4; c++) out[c] = fbm(u * cells, v * cells, cells, cells, seed + c * 1000, octaves);
    },
  };
}
