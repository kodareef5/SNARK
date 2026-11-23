// The materials made from recipes (content/texgen/materials.ts), as one job of the textures the card makes (engine.ts).
// A slot is two layers: its base colour, the light about its mean halved in red, green and blue and how much a piece's
// colour dyes it in alpha; and its relief, the lean across and up the tile in red and green, roughness in blue and
// height in alpha. A layer's version is the number of the material it holds, so one program makes any of them from
// its rows, and a slot takes another by its version alone. A wall reads each with a tap (world-surfaces.ts made).

import { MATERIAL_RECIPES, type MaterialRecipe } from "../../../content/texgen/materials.ts";
import { sample, type Texture } from "../render/cpu-texture.ts";
import { jobPixels, type Job } from "./engine.ts";
import type { WorldSample } from "../render/world-surfaces.ts";
import { MADE_FLOATS, MADE_SLOTS, TEXGEN_LAYERS } from "./layers.ts";
import { cells, fbm, hash3, smoothstep } from "./noise.ts";
import { mipmapped } from "./weather.ts";

/** Metres either way the relief's slope is measured over for the lean. */
const SLOPE = 0.003;
/** Rows of four numbers a material is given the card as (materialRows). */
export const MATERIAL_ROWS = 13;

/** Recipe `r` as the card is given it, `which` 0 for its base colour and 1 for its relief. */
export function materialRows(r: MaterialRecipe, which: number): Float32Array {
  const f = new Float32Array(MATERIAL_ROWS * 4), g = r.grain, c = r.course, b = r.rib;
  f.set([r.metres, r.seed, r.level, which, 0.5 / r.means[0], r.shade, r.dye, r.rough, r.hollow, r.relief / 1000 / (2 * SLOPE), 0, 0]);
  r.noise.forEach((n, i) => {
    f.set([n.cell[0], n.cell[1], n.height, n.light], 12 + i * 4);
    f[28 + i] = n.warp ?? 0;
  });
  if (g) f.set([g.size, g.core, g.radius, g.height, g.tone, g.gap, g.bare, g.warm], 32);
  if (c) f.set([c.size[0], c.size[1], c.bond, c.joint, c.depth, c.tone, c.dark, 0], 40);
  if (b) f.set([b.pitch, b.width, b.height, 0], 48);
  return f;
}

const cell = new Float64Array(3), look = new Float64Array(3);
const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/**
 * The height at (x, y) metres in the tile of rows `f`, from 0 to 1, and into `out` its light about 1, its dye and its
 * warmth either way from grey.
 */
export function materialHeight(f: Float32Array, x: number, y: number, out: Float64Array): number {
  const T = f[0]!, seed = f[1]!;
  let h = f[2]!, light = 1, dye = f[6]!, warm = 0, before = 0.5;
  for (let i = 0; i < 4; i++) {
    const a = 12 + i * 4, cx = f[a]!;
    if (cx <= 0) break;
    const cy = f[a + 1]!, n = fbm((x + f[28 + i]! * (before - 0.5)) / cx, y / cy, Math.round(T / cx), Math.round(T / cy), seed + 100 * (i + 1), 2);
    h += f[a + 2]! * (n - 0.5);
    light *= 1 + f[a + 3]! * (n - 0.5);
    before = n;
  }
  if (f[32]! > 0) {
    const size = f[32]!, p = Math.round(T / size);
    cells(x / size, y / size, p, p, seed + 7, cell);
    const m = 1 - smoothstep(f[33]!, f[34]!, cell[0]!), id = cell[2]!;
    h += f[35]! * m * (0.5 + 0.5 * id);
    light *= f[37]! + (1 + f[36]! * (id - 0.5) - f[37]!) * m;
    dye *= f[38]! + (1 - f[38]!) * m;
    warm = (hash3(Math.floor(id * 4096), seed, 3) - 0.5) * f[39]! * m;
  }
  if (f[40]! > 0) {
    const cw = f[40]!, ch = f[41]!, row = Math.floor(y / ch), sx = x + f[42]! * cw * (row - 2 * Math.floor(row / 2)), col = Math.floor(sx / cw);
    const fx = sx - col * cw, fy = y - row * ch, d = Math.min(fx, cw - fx, fy, ch - fy);
    const joint = 1 - smoothstep(0.5 * f[43]!, f[43]!, d), tone = hash3(wrap(col, Math.round(T / cw)), wrap(row, Math.round(T / ch)), seed + 5);
    h *= 1 - f[44]! * joint;
    light *= (1 + f[45]! * (tone - 0.5)) * (1 - f[46]! * joint);
  }
  if (f[48]! > 0) {
    const pitch = f[48]!, fx = x - Math.floor(x / pitch) * pitch, d = Math.min(fx, pitch - fx);
    const rib = f[49]! > 0 ? 1 - smoothstep(0.5 * f[49]!, f[49]!, d) : 0.5 + 0.5 * Math.cos((6.283185307179586 * fx) / pitch);
    h = h * (1 - f[50]!) + f[50]! * rib;
  }
  h = Math.min(Math.max(h, 0), 1);
  out[0] = light * (1 + f[5]! * (h - 0.5));
  out[1] = dye;
  out[2] = warm;
  return h;
}

/** The layer's four values at (x, y) metres in the tile of rows `f` (materialRows): its base colour or its relief. Into `out`. */
export function materialTexel(f: Float32Array, x: number, y: number, out: Float64Array | number[]): void {
  const h = materialHeight(f, x, y, look);
  if (f[3]! < 0.5) {
    const v = look[0]! * f[4]!;
    out[0] = v * (1 + look[2]!);
    out[1] = v;
    out[2] = v * (1 - look[2]!);
    out[3] = look[1]!;
    return;
  }
  const k = f[9]!;
  const sx = (materialHeight(f, x + SLOPE, y, look) - materialHeight(f, x - SLOPE, y, look)) * k;
  const sy = (materialHeight(f, x, y - SLOPE, look) - materialHeight(f, x, y + SLOPE, look)) * k;
  const l = Math.sqrt(sx * sx + sy * sy + 1);
  out[0] = 0.5 - (0.5 * sx) / l;
  out[1] = 0.5 - (0.5 * sy) / l;
  out[2] = f[7]! + f[8]! * (0.5 - h);
  out[3] = h;
}

const MATERIAL_GLSL = `float heightOf(float x, float y, out vec3 look) {
  float T = uJob[2].x, h = uJob[2].z, light = 1.0, dye = uJob[3].z, warm = 0.0, before = 0.5;
  int seed = int(uJob[2].y);
  for (int i = 0; i < 4; i++) {
    vec4 n = uJob[5 + i];
    if (n.x <= 0.0) break;
    float v = fbm((x + uJob[9][i] * (before - 0.5)) / n.x, y / n.y, int(floor(T / n.x + 0.5)), int(floor(T / n.y + 0.5)), seed + 100 * (i + 1), 2);
    h += n.z * (v - 0.5);
    light *= 1.0 + n.w * (v - 0.5);
    before = v;
  }
  vec4 g = uJob[10], g2 = uJob[11];
  if (g.x > 0.0) {
    int p = int(floor(T / g.x + 0.5));
    vec3 c = cells(x / g.x, y / g.x, p, p, seed + 7);
    float m = 1.0 - smoothstep(g.y, g.z, c.x);
    h += g.w * m * (0.5 + 0.5 * c.z);
    light *= g2.y + (1.0 + g2.x * (c.z - 0.5) - g2.y) * m;
    dye *= g2.z + (1.0 - g2.z) * m;
    warm = (hash3(int(floor(c.z * 4096.0)), seed, 3) - 0.5) * g2.w * m;
  }
  vec4 k = uJob[12], k2 = uJob[13];
  if (k.x > 0.0) {
    float row = floor(y / k.y), sx = x + k.z * k.x * (row - 2.0 * floor(row / 2.0)), col = floor(sx / k.x);
    float fx = sx - col * k.x, fy = y - row * k.y, d = min(min(fx, k.x - fx), min(fy, k.y - fy));
    float joint = 1.0 - smoothstep(0.5 * k.w, k.w, d), tone = hash3(wrapi(int(col), int(floor(T / k.x + 0.5))), wrapi(int(row), int(floor(T / k.y + 0.5))), seed + 5);
    h *= 1.0 - k2.x * joint;
    light *= (1.0 + k2.y * (tone - 0.5)) * (1.0 - k2.z * joint);
  }
  vec4 b = uJob[14];
  if (b.x > 0.0) {
    float fx = x - floor(x / b.x) * b.x, d = min(fx, b.x - fx);
    float rib = b.y > 0.0 ? 1.0 - smoothstep(0.5 * b.y, b.y, d) : 0.5 + 0.5 * cos(6.283185307179586 * fx / b.x);
    h = h * (1.0 - b.z) + b.z * rib;
  }
  h = clamp(h, 0.0, 1.0);
  look = vec3(light * (1.0 + uJob[3].y * (h - 0.5)), dye, warm);
  return h;
}
vec4 made(vec2 at) {
  float x = at.x * uJob[2].x, y = at.y * uJob[2].x;
  vec3 look, side;
  float h = heightOf(x, y, look);
  if (uJob[2].w < 0.5) {
    float v = look.x * uJob[3].x;
    return vec4(v * (1.0 + look.z), v, v * (1.0 - look.z), look.y);
  }
  float k = uJob[4].y;
  float sx = (heightOf(x + ${SLOPE}, y, side) - heightOf(x - ${SLOPE}, y, side)) * k;
  float sy = (heightOf(x, y - ${SLOPE}, side) - heightOf(x, y + ${SLOPE}, side)) * k;
  float l = sqrt(sx * sx + sy * sy + 1.0);
  return vec4(0.5 - 0.5 * sx / l, 0.5 - 0.5 * sy / l, uJob[3].w + uJob[4].x * (0.5 - h), h);
}
`;

/** The slots' job: layer 2s the base colour of slot s and 2s + 1 its relief, each of the material its version numbers (from 1). */
export function materialJob(slots = MADE_SLOTS, recipes: readonly MaterialRecipe[] = MATERIAL_RECIPES): Job {
  const tables: Float32Array[] = [];
  const rows = (version: number, which: number): Float32Array => (tables[version * 2 + which] ??= materialRows(recipes[version - 1]!, which));
  return {
    layers: slots * 2,
    bands: 1,
    pad: 0,
    // A tap a texel: its lines lie along the tile and its grain is no finer than a texel. A base tap weighs 0.9 and a relief's five heights 4.9.
    taps: [1, 1],
    cost: 3,
    whole: true,
    rows: MATERIAL_ROWS,
    glsl: MATERIAL_GLSL,
    fill: (layer, _band, out, at, version) => out.set(rows(Math.max(version, 1), layer & 1), at),
    made(layer, _band, u, v, out, version) {
      const f = rows(Math.max(version, 1), layer & 1);
      materialTexel(f, u * f[0]!, v * f[0]!, out);
    },
  };
}

const textures = new Map<number, Texture>();
/** Material `k`'s layer `which` (0 its base colour, 1 its relief) `side` a side, as the rasterizer reads a texture: made once. */
export function materialRead(k: number, which: number, side: number, u: number, v: number, spread: number, out: Float64Array): void {
  const key = (k * 2 + which) * 65536 + side;
  let t = textures.get(key);
  if (!t) textures.set(key, (t = mipmapped(jobPixels(materialJob(1), which, side, undefined, k), side)));
  sample(t, u, v, spread, out);
}

/**
 * For the rasterizer and the tools, which make nothing on a card: every material held and come up, as fMade says it
 * (slots.ts), each at two layers of its own past the array's; and the read of those layers `side` a side.
 */
export const TWIN_SLOTS = Float32Array.from({ length: MATERIAL_RECIPES.length * MADE_FLOATS }, (_, i) => (i % MADE_FLOATS === 0 ? TEXGEN_LAYERS + (i / MADE_FLOATS) * 2 : i % MADE_FLOATS === 1 ? 1 : 0));
const twins = new Map<number, WorldSample>();
export function madeTwin(side: number): WorldSample {
  let t = twins.get(side);
  if (!t) twins.set(side, (t = (_role, layer, u, v, spread, out) => materialRead(((layer - TEXGEN_LAYERS) >> 1) + 1, (layer - TEXGEN_LAYERS) & 1, side, u, v, spread, out)));
  return t;
}
