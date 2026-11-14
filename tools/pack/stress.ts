// Meshes made to load the asset library: many rocks with five levels each, and one plate too large for 16-bit indices.
// Each level is a different colour, so a picture shows which level was drawn. Three more rocks are listed wrongly, to
// show what the library does with a part that cannot be had.

import type { Manifest } from "../../shared/pack/manifest.ts";
import { LEVEL_COLOURS, defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { splitPack, type SplitFile } from "./split.ts";
import { buildPack, type SourceLod, type SourceMesh } from "./write.ts";

export { LEVEL_COLOURS };

export interface StressOptions {
  /** How many rocks. 64 where not given. */
  rocks?: number;
  /** How many times a rock's finest level is subdivided: 5 gives 20,480 triangles down to 80. */
  detail?: number;
  /** Cells along a side of the plate. 512 gives 263,169 vertices. 0 for no plate. */
  plate?: number;
  seed?: number;
}

/** The 95th in 100 of `values`. */
function most(values: number[]): number {
  values.sort((a, b) => a - b);
  return values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!;
}

/** An icosphere of radius 1, subdivided `times`: corners as unit vectors, and triangles. A coarser one's corners are corners of a finer one. */
function icosphere(times: number): { dirs: number[]; tris: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const dirs: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    dirs.push(x / l, y / l, z / l);
    return dirs.length / 3 - 1;
  };
  for (const [x, y, z] of [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as const) add(x, y, z);
  let tris = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < times; s++) {
    const mids = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      let m = mids.get(key);
      if (m === undefined) {
        m = add(dirs[a * 3]! + dirs[b * 3]!, dirs[a * 3 + 1]! + dirs[b * 3 + 1]!, dirs[a * 3 + 2]! + dirs[b * 3 + 2]!);
        mids.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
      const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    tris = next;
  }
  return { dirs, tris };
}

function rock(id: string, rng: Rng, detail: number): SourceMesh {
  const size = rng.range(0.6, 2.4);
  const phase = Array.from({ length: 4 }, () => rng.range(0, 6.283));
  // How far the rock reaches in a direction. Every level takes its corners from this one surface.
  const reach = (x: number, y: number, z: number): number => size * (1 + 0.16 * Math.sin(3 * x + phase[0]!) * Math.sin(4 * y + phase[1]!) + 0.09 * Math.sin(7 * z + phase[2]!) * Math.sin(5 * x + phase[3]!));
  const lods: SourceLod[] = [];
  for (let level = 0; level < detail; level++) {
    const { dirs, tris } = icosphere(detail - level);
    const positions = new Float32Array(dirs.length);
    for (let v = 0; v < dirs.length; v += 3) {
      const r = reach(dirs[v]!, dirs[v + 1]!, dirs[v + 2]!);
      positions[v] = dirs[v]! * r;
      positions[v + 1] = dirs[v + 1]! * r + size;
      positions[v + 2] = dirs[v + 2]! * r;
    }
    const lod: SourceLod = { positions, colors: new Uint8Array(dirs.length / 3).fill(LEVEL_COLOURS[level % LEVEL_COLOURS.length]!), indices: Uint32Array.from(tris) };
    if (level > 0) {
      // A coarse triangle's corners are on the rock. Its middle is inside it by this much.
      const sunk: number[] = [];
      for (let i = 0; i < tris.length; i += 3) {
        const [a, b, c] = [tris[i]! * 3, tris[i + 1]! * 3, tris[i + 2]! * 3];
        const [x, y, z] = [(positions[a]! + positions[b]! + positions[c]!) / 3, (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3 - size, (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3];
        const l = Math.hypot(x, y, z);
        sunk.push(Math.abs(reach(x / l, y / l, z / l) - l));
      }
      lod.error = most(sunk);
    }
    lods.push(lod);
  }
  return { id, lods };
}

function plate(cells: number, rng: Rng): SourceMesh {
  const across = 256;
  const phase = Array.from({ length: 4 }, () => rng.range(0, 6.283));
  const height = (x: number, z: number): number => 3 * Math.sin(x * 0.09 + phase[0]!) * Math.sin(z * 0.07 + phase[1]!) + 0.8 * Math.sin(x * 0.41 + phase[2]!) * Math.sin(z * 0.37 + phase[3]!);
  const lods: SourceLod[] = [];
  for (let level = 0, n = cells; level < 5 && n >= 8; level++, n >>= 1) {
    const row = n + 1;
    const positions = new Float32Array(row * row * 3);
    for (let j = 0; j < row; j++) {
      for (let i = 0; i < row; i++) {
        const [x, z] = [(i / n - 0.5) * across, (j / n - 0.5) * across];
        positions.set([x, height(x, z), z], (j * row + i) * 3);
      }
    }
    const indices = new Uint32Array(n * n * 6);
    const off: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * row + i;
        indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], (j * n + i) * 6);
        // The middle of a coarse cell against the ground it stands for.
        if (level > 0) off.push(Math.abs(height(((i + 0.5) / n - 0.5) * across, ((j + 0.5) / n - 0.5) * across) - (positions[a * 3 + 1]! + positions[(a + 1) * 3 + 1]! + positions[(a + row) * 3 + 1]! + positions[(a + row + 1) * 3 + 1]!) / 4));
      }
    }
    const lod: SourceLod = { positions, colors: new Uint8Array(row * row).fill(LEVEL_COLOURS[level]!), indices };
    if (level > 0) lod.error = most(off);
    lods.push(lod);
  }
  return { id: "stress:plate", lods };
}

export function stressMeshes(opts: StressOptions = {}): SourceMesh[] {
  const rng = new Rng(opts.seed ?? 7);
  const detail = opts.detail ?? 5;
  const out: SourceMesh[] = [];
  for (let i = 0; i < (opts.rocks ?? 64); i++) out.push(rock(`stress:rock_${String(i).padStart(2, "0")}`, rng, detail));
  // Listed wrongly by stressSet, below.
  for (const bad of ["hash", "range", "short"]) out.push(rock(`stress:bad_${bad}`, rng, detail));
  if ((opts.plate ?? 512) > 0) out.push(plate(opts.plate ?? 512, rng));
  return out;
}

/**
 * The stress meshes as a boot file, a mesh file and a manifest. The finest level of three rocks cannot be had: one has
 * the wrong hash listed, one is listed past the end of its file, and one runs off the end of it. The manifest says the
 * mesh file is longer than it is, as one written for a file since cut short would.
 */
export function stressSet(opts: StressOptions = {}): { files: SplitFile[]; manifest: Manifest } {
  const set = splitPack(buildPack(stressMeshes(opts), defaultPalette()), "stress");
  spoilStress(set.files, set.manifest);
  return set;
}

/** Lists the finest level of the three bad rocks wrongly, in the manifest of a split pack that holds them. */
export function spoilStress(files: readonly SplitFile[], manifest: Manifest): void {
  const real = files[1]!.bytes.length;
  const finest = (id: string) => manifest.meshes.find((m) => m.id === id)!.levels[0]!;
  finest("stress:bad_hash").parts[0]!.hash = "0000000000000000";
  manifest.files[1]!.bytes = real + 2 * finest("stress:bad_range").parts[0]!.bytes + 64;
  finest("stress:bad_range").at = real + 32;
  finest("stress:bad_short").at = real - (finest("stress:bad_short").parts[0]!.bytes >> 1);
}
