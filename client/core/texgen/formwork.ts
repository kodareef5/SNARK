// The formwork a concrete wall was poured in, as one tile of the textures the card makes (engine.ts): 2 m panels along
// the wall and 2 m lifts up it, their joints and their tie holes, as how much of a texel each covers. A wall reads it
// with a tap and darkens by it (world-surfaces.ts weathered); the card's mipmaps fade the joints out as the wall goes.

import type { Job } from "./engine.ts";
import { FORMWORK } from "./layers.ts";
import { tiled } from "./noise.ts";

/** Metres from a joint's middle within which a line's edge goes from all to none, under a texel of the tile at 512. */
const SOFT = 0.002;
const SEED = 4100;

/** How much of a line `half` metres either side of its middle covers a point `d` metres from it. */
const covers = (d: number, half: number): number => Math.min(Math.max((half - d) / SOFT + 0.5, 0), 1);
/** The nearest tie hole's distance along one way, holes at 0.38, 1 and 1.62 m of a panel. */
const hole = (a: number): number => a - (0.38 + 0.62 * Math.min(Math.max(Math.round((a - 0.38) / 0.62), 0), 2));

/** The tile's cover at (x, y) metres in it. */
export function formworkTexel(x: number, y: number): number {
  const half = 0.0045 + 0.003 * tiled(x / 0.25, y / 0.25, 8, 8, SEED);
  const across = Math.min(x, FORMWORK - x) + (tiled(0.5, y / 0.5, 1, 4, SEED + 1) - 0.5) * 0.008;
  const up = Math.min(y, FORMWORK - y) + (tiled(x / 0.5, 0.5, 4, 1, SEED + 2) - 0.5) * 0.008;
  const ha = hole(x), hb = hole(y);
  return Math.max(covers(Math.abs(across), half), covers(Math.abs(up), half), covers(Math.sqrt(ha * ha + hb * hb), 0.0125) * 0.8);
}

export const formworkJob = (): Job => ({
  layers: 1,
  bands: 1,
  pad: 0,
  taps: [3, 3],
  cost: 0.3,
  rows: 0,
  glsl: `float covers(float d, float hw) { return clamp((hw - d) / ${SOFT} + 0.5, 0.0, 1.0); }
float hole(float a) { return a - (0.38 + 0.62 * clamp(floor((a - 0.38) / 0.62 + 0.5), 0.0, 2.0)); }
vec4 made(vec2 at) {
  float x = at.x * ${FORMWORK}.0, y = at.y * ${FORMWORK}.0;
  float hw = 0.0045 + 0.003 * tiled(x / 0.25, y / 0.25, 8, 8, ${SEED});
  float across = min(x, ${FORMWORK}.0 - x) + (tiled(0.5, y / 0.5, 1, 4, ${SEED + 1}) - 0.5) * 0.008;
  float up = min(y, ${FORMWORK}.0 - y) + (tiled(x / 0.5, 0.5, 4, 1, ${SEED + 2}) - 0.5) * 0.008;
  float ha = hole(x), hb = hole(y);
  return vec4(max(max(covers(abs(across), hw), covers(abs(up), hw)), covers(sqrt(ha * ha + hb * hb), 0.0125) * 0.8), 0.0, 0.0, 0.0);
}
`,
  fill: () => {},
  made: (_layer, _band, u, v, out) => {
    out[0] = formworkTexel(u * FORMWORK, v * FORMWORK);
    out[1] = out[2] = out[3] = 0;
  },
});
