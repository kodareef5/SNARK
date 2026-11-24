// Draws a material made from a recipe (content/texgen/materials.ts) on its own, from its TypeScript twin, with no card
// and no client: a wall of it lit at a slant and full on, a tile at the array's own texels, and its flat fallback.
//
//   bun tools/texgen/card.ts plate [--colour 89] [--finish steel] [--out var/texgen]
//
// The wall is the read's sum without the weathering: the finish's mean, dyed by the palette colour, times the tile.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { jobPixels } from "../../client/core/texgen/engine.ts";
import { materialJob } from "../../client/core/texgen/materials.ts";
import { SURFACE_FINISHES, type SurfaceName } from "../../content/surfaces.ts";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { encodePng } from "../snap/png.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { colour: { type: "string", default: "89" }, finish: { type: "string", default: "steel" }, out: { type: "string", default: "var/texgen" } } });
const name = positionals[0] ?? "plate", k = MATERIAL_RECIPES.findIndex((r) => r.name === name);
if (k < 0) throw new Error(`no recipe "${name}": ${MATERIAL_RECIPES.map((r) => r.name).join(", ")}`);
const recipe = MATERIAL_RECIPES[k]!, SIDE = 512, job = materialJob(1);
const base = jobPixels(job, 0, SIDE, job.taps, k + 1), relief = jobPixels(job, 1, SIDE, job.taps, k + 1);
const finish = values.finish as SurfaceName, colour = Number(values.colour), palette = defaultPalette();
const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgb = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055));
const mean = (JSON.parse(readFileSync(resolve(import.meta.dir, `../../assets/source/core/world/${finish}/material.json`), "utf8")) as { mean_srgb: number[] }).mean_srgb.map((v) => linear(v / 255));
const dye = [0, 1, 2].map((c) => linear(palette[colour * 4 + c]! / 255));
// As worldSurface dyes a finish: the palette colour about 0.3, by the finish's share.
const tint = dye.map((d) => 1 + (Math.min(2.2, Math.max(0.18, d / 0.3)) - 1) * SURFACE_FINISHES[finish].palette);

/** A texel of a layer at (u, v) tiles, nearest. */
const texel = (layer: Uint8Array, u: number, v: number, c: number): number => layer[((Math.floor((v - Math.floor(v)) * SIDE) % SIDE) * SIDE + (Math.floor((u - Math.floor(u)) * SIDE) % SIDE)) * 4 + c]! / 255;

/** A wall `wide` by `high` metres at `scale` pixels a metre, lit from `sun` (to its right, up and out of it). */
function wall(wide: number, high: number, scale: number, sun: readonly [number, number, number]): { w: number; h: number; px: Uint8Array } {
  const w = Math.round(wide * scale), h = Math.round(high * scale), px = new Uint8Array(w * h * 4), l = Math.hypot(...sun), s = sun.map((v) => v / l);
  // The eye stands off the wall's middle, 4 m out.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / scale / recipe.metres, v = y / scale / recipe.metres;
    const bx = (texel(relief, u, v, 0) - 0.5) * 2, by = (texel(relief, u, v, 1) - 0.5) * 2, bz = Math.sqrt(Math.max(0, 1 - bx * bx - by * by));
    // The lean is across and down the tile; the wall's up is the picture's.
    const n = [bx, -by, bz], nl = Math.hypot(n[0]!, n[1]!, n[2]!);
    const e = [wide / 2 - x / scale, y / scale - high / 2, 4], el = Math.hypot(e[0]!, e[1]!, e[2]!);
    const half = [s[0]! + e[0]! / el, s[1]! + e[1]! / el, s[2]! + e[2]! / el], hl = Math.hypot(half[0]!, half[1]!, half[2]!);
    const lit = Math.max(0, (n[0]! * s[0]! + n[1]! * s[1]! + n[2]! * s[2]!) / nl), rough = texel(relief, u, v, 2);
    const shine = Math.max(0, (n[0]! * half[0]! + n[1]! * half[1]! + n[2]! * half[2]!) / nl / hl) ** (2 / Math.max(0.02, rough ** 4)) * 0.25 * (1 - rough);
    for (let c = 0; c < 3; c++) px[(y * w + x) * 4 + c] = srgb(mean[c]! * tint[c]! * 2 * texel(base, u, v, c) * (0.32 + 1.5 * lit) + shine);
    px[(y * w + x) * 4 + 3] = 255;
  }
  return { w, h, px };
}

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });
const shots = [wall(3, 3, 256, [-0.5, 0.8, 0.45]), wall(3, 3, 256, [-0.25, 0.35, 1]), wall(1.5, 1.5, SIDE / recipe.metres, [-0.5, 0.8, 0.45])];
const gap = 8, flat = 96, width = shots.reduce((sum, s) => sum + s.w + gap, gap), height = Math.max(...shots.map((s) => s.h)) + 2 * gap + flat;
const sheet = new Uint8Array(width * height * 4).fill(236);
let at = gap;
for (const s of shots) {
  for (let y = 0; y < s.h; y++) sheet.set(s.px.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((gap + y) * width + at) * 4);
  at += s.w + gap;
}
// Under them, what a client that makes no recipes draws: the finish's mean dyed, and the palette colour alone.
[mean.map((m, c) => srgb(m * tint[c]! * 1.2)), [0, 1, 2].map((c) => palette[colour * 4 + c]!)].forEach((rgb, i) => {
  for (let y = height - flat; y < height - gap; y++) for (let x = gap + i * (flat * 3 + gap); x < gap + i * (flat * 3 + gap) + flat * 3; x++) sheet.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], (y * width + x) * 4);
});
const file = join(out, `card-${name}.png`);
writeFileSync(file, encodePng(width, height, sheet));
console.log(`${file}: a 3 m wall with the sun at a slant and full on, a tile at ${SIDE} texels, then the finish's mean and palette colour ${colour}`);
