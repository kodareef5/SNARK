// The world finishes' material sets, from each finish's painted sources under assets/source/core/world/<finish>/ to the
// three pictures a material takes: base colour with the tint mask in alpha, a normal made from the height, and
// occlusion, roughness, metal and height packed at half the side. Kept under var/surfaces/art/<finish>/ by a hash of
// what made them. bun tools/surfaces/build.ts builds them.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SURFACE_NAMES, surfaceMaterial, type SurfaceName } from "../../content/surfaces.ts";
import type { Material } from "../art/materials.ts";
import { encodePng, readPicture, type Picture } from "../pack/image.ts";
import type { SourceMesh } from "../pack/write.ts";

const ROOT = resolve(import.meta.dir, "../..");
export const WORLD_ART = resolve(ROOT, "assets/source/core/world");
export const SURFACE_ART = resolve(ROOT, "var/surfaces/art");
/** The side of a finish's base colour and normal; the packed map is half. */
export const SURFACE_TOP = 2048;

/** What a finish's painter says of it (material.json). */
export interface Painted {
  /** Metres the tile spans. */
  metres: number;
  /** Millimetres from black to white in its height. */
  height_mm: number;
  /** The shift, in tiles across and down, that maps a laid pattern onto itself, or null for a natural finish. */
  module: [number, number] | null;
  mean_srgb: [number, number, number];
}

export const paintedOf = (name: SurfaceName): Painted => JSON.parse(readFileSync(join(WORLD_ART, name, "material.json"), "utf8")) as Painted;
const sources = (name: SurfaceName): string[] => ["base", "height", "roughness", "occlusion", "tint", "metal"].map((m) => join(WORLD_ART, name, `${m}.png`));
export const HAS_SURFACES = SURFACE_NAMES.every((name) => existsSync(join(WORLD_ART, name, "material.json")));

/** The finishes as materials, their pictures made first where they are not. */
export function worldMaterials(): Material[] {
  return SURFACE_NAMES.map((name) => {
    buildFinish(name);
    return { name, id: surfaceMaterial(name), dir: join(SURFACE_ART, name), spec: { base: "base.png", normal: "normal.png", packed: "mro.png", tiles: paintedOf(name).metres } };
  });
}

const grey = (p: Picture, side: number, what: string): Float32Array => {
  if (p.width !== side || p.height !== side) throw new Error(`world finish: its ${what} is ${p.width} by ${p.height}, not ${side}`);
  const max = p.depth === 8 ? 255 : 65535, out = new Float32Array(side * side);
  for (let i = 0; i < out.length; i++) out[i] = p.data[i * p.channels]! / max;
  return out;
};
const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Makes one finish's three pictures from its sources, unless those under var/ were made from these. */
export function buildFinish(name: SurfaceName): void {
  const hash = createHash("sha256").update(readFileSync(import.meta.filename));
  for (const file of [join(WORLD_ART, name, "material.json"), ...sources(name)]) if (existsSync(file)) hash.update(file).update(readFileSync(file));
  const key = hash.digest("hex"), dir = join(SURFACE_ART, name), stamp = join(dir, "key");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === key) return;
  mkdirSync(dir, { recursive: true });
  const n = SURFACE_TOP, painted = paintedOf(name);
  const [baseFile, heightFile, roughFile, occlusionFile, tintFile, metalFile] = sources(name);
  const colour = readPicture(baseFile!);
  if (colour.width !== n || colour.height !== n || colour.depth !== 8 || colour.channels < 3) throw new Error(`world finish ${name}: its base colour is not ${n} by ${n} RGB`);
  const height = grey(readPicture(heightFile!), n, "height");
  const rough = grey(readPicture(roughFile!), n, "roughness");
  const occlusion = grey(readPicture(occlusionFile!), n, "occlusion");
  const tint = existsSync(tintFile!) ? grey(readPicture(tintFile!), n, "tint") : new Float32Array(n * n).fill(1);
  const metal = existsSync(metalFile!) ? grey(readPicture(metalFile!), n, "metal") : new Float32Array(n * n);
  const base = new Uint8Array(n * n * 4), normal = new Uint8Array(n * n * 3);
  // Slope of the height in metres a metre, across and down, from its neighbours either side, the tile wrapping.
  const rise = (painted.height_mm / 1000) / (2 * painted.metres / n);
  const at = (x: number, y: number): number => height[((y + n) % n) * n + ((x + n) % n)]!;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    for (let c = 0; c < 3; c++) base[i * 4 + c] = colour.data[i * colour.channels + c]!;
    base[i * 4 + 3] = byte(tint[i]!);
    // x right and y up the picture, as a material's normal map has them: a rise down the picture leans it up.
    const sx = -(at(x + 1, y) - at(x - 1, y)) * rise, sy = (at(x, y + 1) - at(x, y - 1)) * rise, l = Math.hypot(sx, sy, 1);
    normal[i * 3] = byte(sx / l * 0.5 + 0.5);
    normal[i * 3 + 1] = byte(sy / l * 0.5 + 0.5);
    normal[i * 3 + 2] = byte(1 / l * 0.5 + 0.5);
  }
  // The packed map at half the side, each texel the mean of the four under it.
  const h = n >> 1, mro = new Uint8Array(h * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
    const four = (m: Float32Array): number => (m[2 * y * n + 2 * x]! + m[2 * y * n + 2 * x + 1]! + m[(2 * y + 1) * n + 2 * x]! + m[(2 * y + 1) * n + 2 * x + 1]!) / 4;
    const o = (y * h + x) * 4;
    mro[o] = byte(four(occlusion));
    mro[o + 1] = byte(four(rough));
    mro[o + 2] = byte(four(metal));
    mro[o + 3] = byte(four(height));
  }
  writeFileSync(join(dir, "base.png"), encodePng({ width: n, height: n, channels: 4, depth: 8, data: base }));
  writeFileSync(join(dir, "normal.png"), encodePng({ width: n, height: n, channels: 3, depth: 8, data: normal }));
  writeFileSync(join(dir, "mro.png"), encodePng({ width: h, height: h, channels: 4, depth: 8, data: mro }));
  writeFileSync(stamp, key);
}

/** A finish's material carrier: like the sky's, this triangle is never drawn. Named last, it renumbers no other mesh. */
export function worldSurfaceMeshes(): SourceMesh[] {
  return SURFACE_NAMES.map((name) => {
    const id = surfaceMaterial(name);
    const textures = (["base", "normal", "mro"] as const).map((role) => ({ id: `${id}/${role}`, role, top: role === "mro" ? SURFACE_TOP / 2 : SURFACE_TOP }));
    const material = { id, base: 0, normal: 1, mro: 2, mask: -1, mask2: -1, tint: [1, 1, 1] as [number, number, number], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 0 };
    return { id: `core:zz_world_${name}`, flat: 1, materials: [material], textures,
      lods: [{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 2, 1]),
        uvs: Float32Array.from([0, 0, 1, 0, 0, 1]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]) }] };
  });
}

if (import.meta.main) {
  for (const name of SURFACE_NAMES) if (existsSync(join(WORLD_ART, name, "material.json"))) buildFinish(name);
  console.log(SURFACE_ART);
}
