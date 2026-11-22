// The materials made from recipes (content/texgen/finishes.ts), twice: in TypeScript for the rasterizer, the tests and
// the tools, and in GLSL for the card, which makes them as it makes the weathering masks (plan.ts), two layers each in
// the same array after the masks' (weather.ts WEATHER_LAYERS): its base colour, light in red, green and blue and how much
// a piece's colour dyes it in alpha; and its relief, the normal's lean across and up the tile from 0 to 1 in red and
// green, roughness in blue and height in alpha. Every one tiles: each noise repeats a whole number of times a tile.

import { FINISH_RECIPES, type FinishRecipe } from "../../../content/texgen/finishes.ts";
import { cells, fbm, hash3, smoothstep } from "./noise.ts";

/** Metres the relief's slope is measured over, either way, for the normal. */
const SLOPE = 0.002;
const cell = new Float64Array(3);

/**
 * Recipe `r`'s height at (x, y) metres in its tile, from 0 to 1, and into `look` its light from 0 to 1, how much the
 * piece's colour dyes it, and a warmth either way from grey (gravel's stones).
 */
export function finishHeight(r: FinishRecipe, x: number, y: number, look: Float64Array | null): number {
  const T = r.metres, s = r.seed;
  // Noise of cells `c` metres across over the tile, which a whole number of them span.
  const n = (c: number, o: number, octaves: number): number => fbm(x / c, y / c, Math.round(T / c), Math.round(T / c), s + o, octaves);
  let h = 0, v = r.light, dye = r.dye, warm = 0;
  switch (r.name) {
    case "stucco": {
      // Grit in hard little peaks, over a broad sag the trowel left.
      cells(x / 0.0125, y / 0.0125, Math.round(T / 0.0125), Math.round(T / 0.0125), s, cell);
      const grain = (1 - smoothstep(0.05, 0.5, cell[0]!)) * (0.5 + 0.5 * cell[2]!);
      h = 0.3 * n(0.25, 1, 3) + 0.25 * n(0.05, 2, 2) + 0.45 * grain;
      v *= (0.84 + 0.32 * h) * (0.92 + 0.16 * n(0.5, 3, 2));
      break;
    }
    case "render": {
      // Fine sand, in the float's sweeps: a broad wave warped across the tile.
      const w = n(0.5, 4, 2) - 0.5;
      h = 0.45 * fbm(x / 0.25 + 1.5 * w, y / 0.0625, 10, 40, s + 5, 2) + 0.35 * n(0.0125, 6, 2) + 0.2 * n(0.25, 7, 2);
      v *= (0.88 + 0.24 * h) * (0.93 + 0.14 * n(0.5, 8, 2));
      break;
    }
    case "block": {
      // Blocks 400 by 200 mm in running bond; each its own tone, its face pitted; the joints struck back 5 mm either way.
      const row = Math.floor(y / 0.2), shift = row % 2 === 0 ? 0 : 0.2, col = Math.floor((x + shift) / 0.4) % 4;
      const dy = Math.min(y - row * 0.2, (row + 1) * 0.2 - y), bx = (x + shift) - Math.floor((x + shift) / 0.4) * 0.4, dx = Math.min(bx, 0.4 - bx);
      const joint = 1 - smoothstep(0.004, 0.007, Math.min(dx, dy)), tone = hash3(col, row % 8, s);
      h = (1 - joint) * (0.8 + 0.2 * n(0.0125, 9, 2)) * (0.92 + 0.08 * smoothstep(0, 0.02, Math.min(dx, dy)));
      v *= (1 + (tone - 0.5) * 0.08) * (1 - 0.22 * joint) * (0.96 + 0.06 * n(0.1, 10, 2));
      dye *= 1 - 0.3 * joint;
      break;
    }
    case "corrugated": {
      // Ten waves a tile, dented a little, the paint streaked down the troughs.
      const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * x * 10) / T);
      h = 0.92 * wave + 0.08 * n(0.0762, 11, 2);
      v *= (0.94 + 0.1 * wave) * (0.95 + 0.1 * fbm(x / 0.0381, y / 0.381, 20, 2, s + 12, 2));
      break;
    }
    case "seam": {
      // Panels 500 mm wide, a seam 25 mm proud between them, the pan between oil-canned a little.
      const p = x - Math.floor(x / 0.5) * 0.5, d = Math.min(p, 0.5 - p);
      const seam = 1 - smoothstep(0.006, 0.011, d);
      h = 0.12 + 0.88 * seam + 0.06 * (n(0.25, 13, 2) - 0.5) * (1 - seam);
      v *= (1 + 0.06 * seam) * (0.96 + 0.08 * fbm(x / 0.5, y / 1, 4, 2, s + 14, 2));
      break;
    }
    case "gravel": {
      // Stones about 16 mm, each its own grey, warmer or cooler, in black tar.
      cells(x / 0.016, y / 0.016, Math.round(T / 0.016), Math.round(T / 0.016), s, cell);
      const stone = 1 - smoothstep(0.32, 0.46, cell[0]!), id = cell[2]!;
      h = stone * (0.6 + 0.4 * Math.sqrt(Math.max(0, 1 - (cell[0]! / 0.46) * (cell[0]! / 0.46)))) + 0.1 * n(0.25, 15, 2);
      v = stone * (0.25 + 0.55 * id) * (0.9 + 0.2 * n(0.5, 16, 2)) + (1 - stone) * 0.035;
      warm = (hash3(Math.floor(id * 4096), s, 3) - 0.5) * 0.25 * stone;
      dye *= stone;
      break;
    }
  }
  if (look) {
    look[0] = Math.min(Math.max(v, 0), 1);
    look[1] = Math.min(Math.max(dye, 0), 1);
    look[2] = warm;
  }
  return Math.min(Math.max(h, 0), 1);
}

const look = new Float64Array(3);
/** Recipe `r`'s two layers' values at (x, y) metres in its tile: layer 0 its base colour, layer 1 its relief. Into `out`. */
export function finishTexel(r: FinishRecipe, layer: number, x: number, y: number, out: Float64Array | number[]): void {
  const h = finishHeight(r, x, y, look);
  if (layer === 0) {
    out[0] = Math.min(1, look[0]! * (1 + look[2]!));
    out[1] = look[0]!;
    out[2] = Math.min(1, look[0]! * (1 - look[2]!));
    out[3] = look[1]!;
    return;
  }
  // The lean across and up the tile, for a relief `relief` millimetres deep.
  const k = r.relief / 1000 / (2 * SLOPE);
  const sx = (finishHeight(r, x + SLOPE, y, null) - finishHeight(r, x - SLOPE, y, null)) * k, sy = (finishHeight(r, x, y - SLOPE, null) - finishHeight(r, x, y + SLOPE, null)) * k;
  const l = Math.sqrt(sx * sx + sy * sy + 1);
  out[0] = 0.5 - (0.5 * sx) / l;
  out[1] = 0.5 - (0.5 * sy) / l;
  out[2] = Math.min(1, r.rough * (0.92 + 0.16 * (1 - h)));
  out[3] = h;
}

const fl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The GLSL of finishHeight and finishTexel, for the masks' program (weather.ts weatherFragment). */
export function finishGlsl(recipes: readonly FinishRecipe[] = FINISH_RECIPES): string {
  const n = (r: FinishRecipe, c: number, o: number, octaves: number): string => `fbm(x / ${fl(c)}, y / ${fl(c)}, ${Math.round(r.metres / c)}, ${Math.round(r.metres / c)}, ${r.seed + o}, ${octaves})`;
  const body = (r: FinishRecipe, k: number): string => {
    const T = r.metres, s = r.seed;
    switch (r.name) {
      case "stucco":
        return `vec3 c = cells(x / 0.0125, y / 0.0125, ${Math.round(T / 0.0125)}, ${Math.round(T / 0.0125)}, ${s});
    float grain = (1.0 - smoothstep(0.05, 0.5, c.x)) * (0.5 + 0.5 * c.z);
    h = 0.3 * ${n(r, 0.25, 1, 3)} + 0.25 * ${n(r, 0.05, 2, 2)} + 0.45 * grain;
    v *= (0.84 + 0.32 * h) * (0.92 + 0.16 * ${n(r, 0.5, 3, 2)});`;
      case "render":
        return `float w = ${n(r, 0.5, 4, 2)} - 0.5;
    h = 0.45 * fbm(x / 0.25 + 1.5 * w, y / 0.0625, 10, 40, ${s + 5}, 2) + 0.35 * ${n(r, 0.0125, 6, 2)} + 0.2 * ${n(r, 0.25, 7, 2)};
    v *= (0.88 + 0.24 * h) * (0.93 + 0.14 * ${n(r, 0.5, 8, 2)});`;
      case "block":
        return `float row = floor(y / 0.2), shift = mod(row, 2.0) == 0.0 ? 0.0 : 0.2, col = mod(floor((x + shift) / 0.4), 4.0);
    float dy = min(y - row * 0.2, (row + 1.0) * 0.2 - y), bx = (x + shift) - floor((x + shift) / 0.4) * 0.4, dx = min(bx, 0.4 - bx);
    float joint = 1.0 - smoothstep(0.004, 0.007, min(dx, dy)), tone = hash3(int(col), int(mod(row, 8.0)), ${s});
    h = (1.0 - joint) * (0.8 + 0.2 * ${n(r, 0.0125, 9, 2)}) * (0.92 + 0.08 * smoothstep(0.0, 0.02, min(dx, dy)));
    v *= (1.0 + (tone - 0.5) * 0.08) * (1.0 - 0.22 * joint) * (0.96 + 0.06 * ${n(r, 0.1, 10, 2)});
    dye *= 1.0 - 0.3 * joint;`;
      case "corrugated":
        return `float wave = 0.5 + 0.5 * sin(${fl(2 * Math.PI * 10 / T)} * x);
    h = 0.92 * wave + 0.08 * ${n(r, 0.0762, 11, 2)};
    v *= (0.94 + 0.1 * wave) * (0.95 + 0.1 * fbm(x / 0.0381, y / 0.381, 20, 2, ${s + 12}, 2));`;
      case "seam":
        return `float p = x - floor(x / 0.5) * 0.5, d = min(p, 0.5 - p);
    float seam = 1.0 - smoothstep(0.006, 0.011, d);
    h = 0.12 + 0.88 * seam + 0.06 * (${n(r, 0.25, 13, 2)} - 0.5) * (1.0 - seam);
    v *= (1.0 + 0.06 * seam) * (0.96 + 0.08 * fbm(x / 0.5, y / 1.0, 4, 2, ${s + 14}, 2));`;
      case "gravel":
        return `vec3 c = cells(x / 0.016, y / 0.016, ${Math.round(T / 0.016)}, ${Math.round(T / 0.016)}, ${s});
    float stone = 1.0 - smoothstep(0.32, 0.46, c.x), id = c.z;
    h = stone * (0.6 + 0.4 * sqrt(max(0.0, 1.0 - (c.x / 0.46) * (c.x / 0.46)))) + 0.1 * ${n(r, 0.25, 15, 2)};
    v = stone * (0.25 + 0.55 * id) * (0.9 + 0.2 * ${n(r, 0.5, 16, 2)}) + (1.0 - stone) * 0.035;
    warm = (hash3(int(floor(id * 4096.0)), ${s}, 3) - 0.5) * 0.25 * stone;
    dye *= stone;`;
    }
    throw new Error(`no look for recipe ${r.name} (${k})`);
  };
  return `
float finishHeight(int k, float x, float y, out vec3 look) {
  float h = 0.0, v = 0.0, dye = 0.0, warm = 0.0;
${recipes.map((r, k) => `  ${k ? "else " : ""}if (k == ${k + 1}) {
    v = ${fl(r.light)}; dye = ${fl(r.dye)};
    ${body(r, k)}
  }`).join("\n")}
  look = vec3(clamp(v, 0.0, 1.0), clamp(dye, 0.0, 1.0), warm);
  return clamp(h, 0.0, 1.0);
}
const float FINISH_ROUGH[${recipes.length + 1}] = float[${recipes.length + 1}](0.0, ${recipes.map((r) => fl(r.rough)).join(", ")});
const float FINISH_RELIEF[${recipes.length + 1}] = float[${recipes.length + 1}](0.0, ${recipes.map((r) => fl(r.relief)).join(", ")});
vec4 finishTexel(int k, int layer, float x, float y) {
  vec3 look;
  float h = finishHeight(k, x, y, look);
  if (layer == 0) return vec4(min(1.0, look.x * (1.0 + look.z)), look.x, min(1.0, look.x * (1.0 - look.z)), look.y);
  float s = FINISH_RELIEF[k] / 1000.0 / ${fl(2 * SLOPE)};
  float sx = (finishHeight(k, x + ${fl(SLOPE)}, y, look) - finishHeight(k, x - ${fl(SLOPE)}, y, look)) * s;
  float sy = (finishHeight(k, x, y - ${fl(SLOPE)}, look) - finishHeight(k, x, y + ${fl(SLOPE)}, look)) * s;
  float l = sqrt(sx * sx + sy * sy + 1.0);
  return vec4(0.5 - 0.5 * sx / l, 0.5 - 0.5 * sy / l, min(1.0, FINISH_ROUGH[k] * (0.92 + 0.16 * (1.0 - h))), h);
}
`;
}
