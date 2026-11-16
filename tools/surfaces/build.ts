// Deterministic processing of the accepted photographic studies. Encoded variants stay in the build cache.
// bun tools/surfaces/build.ts writes the three maps and per-cell means under var/surfaces/art.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SURFACE_MATERIAL } from "../../content/surfaces.ts";
import type { Material } from "../art/materials.ts";
import { encodePng, readPicture } from "../pack/image.ts";
import type { SourceMesh } from "../pack/write.ts";

const ROOT = resolve(import.meta.dir, "../..");
export const SURFACE_ART = resolve(ROOT, "var/surfaces/art");
export const SURFACE_TOP = 2048;
/** Keep each distant cell in its own compression block: a 4x4 atlas would put sixteen finishes in ONE block. */
export function surfaceMips(mips: Uint8Array[]): Uint8Array[] {
  const means = mips[2]!; // The ordinary 4x4 mip contains the sixteen linear-light cell means.
  for (const level of [3, 4]) {
    const side = 1 << level, cell = side / 4, mip = mips[level]!;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const from = (Math.floor(y / cell) * 4 + Math.floor(x / cell)) * 4;
      mip.set(means.subarray(from, from + 4), (y * side + x) * 4);
    }
  }
  return mips;
}
export function worldMaterial(): Material {
  buildSurfaceArt();
  return { name: "atlas", id: SURFACE_MATERIAL, dir: SURFACE_ART, spec: { base: "base.png", normal: "normal.png", packed: "orm.png", tiles: 3 } };
}

/** Crops away neighbouring cells, makes each scan periodic, derives conservative relief, and adds wrap gutters. */
export function buildSurfaceArt(): void {
  const sources = ["ground-organic", "ground-mineral", "ruins-masonry", "ruins-finishes"].map((name) => resolve(ROOT, `assets/source/surfaces/source/${name}.png`));
  const hash = createHash("sha256").update(readFileSync(import.meta.filename));
  for (const source of sources) hash.update(readFileSync(source));
  const key = hash.digest("hex");
  const stamp = resolve(SURFACE_ART, "key");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === key) return;
  mkdirSync(SURFACE_ART, { recursive: true });
  const pictures = sources.map(readPicture);
  const side = SURFACE_TOP, cell = side / 4, pad = 16, core = cell - pad * 2;
  const base = new Uint8Array(side * side * 4), normal = new Uint8Array(base.length), orm = new Uint8Array(base.length);
  const means: number[][] = [];
  const byte = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
  for (let tile = 0; tile < 16; tile++) {
    const tx = tile % 4, ty = tile >> 2;
    const p = pictures[ty]!, sx = tx % 2, sy = tx >> 1;
    const scan = new Float32Array(core * core * 3), periodic = new Float32Array(scan.length);
    // Bilinear resampling. A 3-pixel crop prevents the study's neighbouring materials entering a cell.
    for (let y = 0; y < core; y++) for (let x = 0; x < core; x++) {
      const px = sx * p.width / 2 + 3 + x / (core - 1) * (p.width / 2 - 7);
      const py = sy * p.height / 2 + 3 + y / (core - 1) * (p.height / 2 - 7);
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
      for (let c = 0; c < 3; c++) {
        const at = (xx: number, yy: number): number => p.data[(yy * p.width + xx) * p.channels + c]!;
        scan[(y * core + x) * 3 + c] = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
      }
    }
    // Blend just the seam neighbourhood with its opposite. The two sides meet at precisely the same value.
    const edge = 32;
    for (let y = 0; y < core; y++) for (let x = 0; x < core; x++) {
      const wx = Math.max(0, 1 - Math.min(x, core - 1 - x) / edge) * 0.5;
      const wy = Math.max(0, 1 - Math.min(y, core - 1 - y) / edge) * 0.5;
      for (let c = 0; c < 3; c++) {
        const v = (xx: number, yy: number): number => scan[(yy * core + xx) * 3 + c]!;
        periodic[(y * core + x) * 3 + c] = (v(x, y) * (1 - wx) + v(core - 1 - x, y) * wx) * (1 - wy) + (v(x, core - 1 - y) * (1 - wx) + v(core - 1 - x, core - 1 - y) * wx) * wy;
      }
    }
    const wrap = (n: number): number => (n + core) % core;
    const height = (x: number, y: number): number => {
      const a = (wrap(y) * core + wrap(x)) * 3;
      return (periodic[a]! * 0.25 + periodic[a + 1]! * 0.6 + periodic[a + 2]! * 0.15) / 255;
    };
    const mean = [0, 0, 0];
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const u = wrap(x - pad), v = wrap(y - pad), from = (v * core + u) * 3;
      const to = ((ty * cell + y) * side + tx * cell + x) * 4;
      for (let c = 0; c < 3; c++) { base[to + c] = byte(periodic[from + c]!); mean[c]! += base[to + c]! / (cell * cell); }
      base[to + 3] = 255;
      // Shape is inferred from local luminance, not assumed to be scanned geometry; low strength avoids baked-light relief.
      const dx = (height(u - 2, v) - height(u + 2, v)) * 1.8;
      const dy = (height(u, v - 2) - height(u, v + 2)) * 1.8;
      const scale = 1 / Math.sqrt(1 + dx * dx + dy * dy);
      normal[to] = byte(128 + 127 * dx * scale); normal[to + 1] = byte(128 + 127 * dy * scale); normal[to + 2] = byte(128 + 127 * scale); normal[to + 3] = 255;
      const h = height(u, v);
      orm[to] = byte(225 + 30 * h); orm[to + 1] = byte(220 + 30 * h); orm[to + 2] = 0; orm[to + 3] = 255;
    }
    means.push(mean);
  }
  for (const [name, data] of [["base", base], ["normal", normal], ["orm", orm]] as const) writeFileSync(resolve(SURFACE_ART, `${name}.png`), encodePng({ width: side, height: side, channels: 4, depth: 8, data }));
  writeFileSync(resolve(SURFACE_ART, "means.json"), JSON.stringify(means, null, 2) + "\n");
  writeFileSync(stamp, key);
}

/** Like the sky's material carrier, this triangle is never drawn. Last by name, it renumbers no existing meshes. */
export function worldSurfaceMesh(): SourceMesh {
  const textures = (["base", "normal", "mro"] as const).map((role) => ({ id: `${SURFACE_MATERIAL}/${role}`, role, top: role === "mro" ? SURFACE_TOP / 2 : SURFACE_TOP }));
  const material = { id: SURFACE_MATERIAL, base: 0, normal: 1, mro: 2, mask: -1, mask2: -1, tint: [1, 1, 1] as [number, number, number], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 3 };
  return { id: "core:zz_world_surfaces", flat: 1, materials: [material], textures,
    lods: [{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 2, 1]),
      uvs: Float32Array.from([0, 0, 1, 0, 0, 1]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]) }] };
}
if (import.meta.main) { buildSurfaceArt(); console.log(SURFACE_ART); }
