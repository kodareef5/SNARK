// The facades' two atlases from their painted sources (assets/source/core/facades): each element's maps laid into its
// place (client/core/render/facade.ts PLACED), its border carried into the gap round it, and each room's four faces
// into its cell. Written under var/facade/art, kept while the sources and this file are unchanged.
// bun tools/facade/build.ts [--means] prints the means facade.ts keeps; --write puts them there.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeTexture, type Texture } from "../../client/core/render/cpu-texture.ts";
import { ELEMENTS, FACADE_MATERIALS, FACADE_TOP, MARKS_PLACED, PLACED, ROOMS, ROOM_FACES, type FacadeTier } from "../../client/core/render/facade.ts";
import type { Material } from "../art/materials.ts";
import { baseMips, encodePng, normalMips, packedMips, readPicture, unpack, type Picture } from "../pack/image.ts";
import type { SourceMesh } from "../pack/write.ts";
import { MATERIAL_CUTOUT } from "../../shared/pack/pack.ts";

const ROOT = resolve(import.meta.dir, "../..");
export const FACADE_SOURCE = resolve(ROOT, "assets/source/core/facades");
export const FACADE_ART = resolve(ROOT, "var/facade/art");
/** The atlases this writes, each FACADE_TOP across. */
export const FACADE_MAPS = ["elements-base", "elements-normal", "elements-orm", "rooms", "marks"] as const;
/** What an element's map reads where its source has none: no occlusion, rough, not metal, flat. */
const MISSING: Readonly<Record<string, number>> = { roughness: 0.8, metal: 0, occlusion: 1 };

const toLinear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const toSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/** `p`'s pixels as red, green, blue and alpha, `colour` on the colours, resized to w by h by the mean of what each new pixel covers. */
function fitted(p: Picture, w: number, h: number, colour: (v: number) => number = (v) => v): Float32Array {
  const src = unpack(p, colour), out = new Float32Array(w * h * 4);
  const sx = p.width / w, sy = p.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let total = 0;
      const sum = [0, 0, 0, 0];
      for (let j = Math.floor(y0); j < Math.ceil(y1); j++) {
        const wy = Math.min(y1, j + 1) - Math.max(y0, j);
        for (let i = Math.floor(x0); i < Math.ceil(x1); i++) {
          const wgt = wy * (Math.min(x1, i + 1) - Math.max(x0, i));
          const at = (Math.min(j, p.height - 1) * p.width + Math.min(i, p.width - 1)) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += src[at + c]! * wgt;
          total += wgt;
        }
      }
      for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = sum[c]! / total;
    }
  }
  return out;
}

/** Puts w by h pixels at (x, y) of a FACADE_TOP atlas of 4 channels, and carries its border `gap` pixels out round it. */
function lay(atlas: Float32Array, px: Float32Array, x: number, y: number, w: number, h: number, gap: number): void {
  for (let j = -gap; j < h + gap; j++) {
    const ay = y + j;
    if (ay < 0 || ay >= FACADE_TOP) continue;
    const sj = Math.min(h - 1, Math.max(0, j));
    for (let i = -gap; i < w + gap; i++) {
      const ax = x + i;
      if (ax < 0 || ax >= FACADE_TOP) continue;
      const si = Math.min(w - 1, Math.max(0, i));
      atlas.set(px.subarray((sj * w + si) * 4, (sj * w + si) * 4 + 4), (ay * FACADE_TOP + ax) * 4);
    }
  }
}

/** A value from 0 to 1 for whole numbers x, y and a seed. */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise from 0 to 1, and three octaves of it. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash(xi, yi, seed) + (hash(xi + 1, yi, seed) - hash(xi, yi, seed)) * sx;
  const foot = hash(xi, yi + 1, seed) + (hash(xi + 1, yi + 1, seed) - hash(xi, yi + 1, seed)) * sx;
  return top + (foot - top) * sy;
}
const fbm = (x: number, y: number, seed: number): number => 0.5 * noise(x, y, seed) + 0.3 * noise(2 * x, 2 * y, seed + 1) + 0.2 * noise(4 * x, 4 * y, seed + 2);
const smooth = (a: number, b: number, t: number): number => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** `field`, w by h, through a box `r` pixels each way, across then down. */
function boxed(field: Float32Array, w: number, h: number, r: number): Float32Array {
  const across = new Float32Array(field.length), out = new Float32Array(field.length);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += field[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      across[y * w + x] = sum / (2 * r + 1);
      sum += field[y * w + Math.min(w - 1, x + r + 1)]! - field[y * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += across[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      sum += across[Math.min(h - 1, y + r + 1) * w + x]! - across[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/**
 * The film on an element's glass, its colour and roughness, softened over about 3 cm, so dust on a shop's glass reads as
 * a film and not as grain from a few metres. Only glass is read and written: a frame keeps its own.
 */
function softGlass(colour: Float32Array, rough: Float32Array, w: number, h: number): void {
  const n = w * h, mask = Float32Array.from({ length: n }, (_, i) => (colour[i * 4 + 3]! < 0.1 ? 1 : 0));
  const blur = (f: Float32Array): Float32Array => boxed(boxed(f, w, h, 2), w, h, 2);
  const weight = blur(mask);
  const fields = [0, 1, 2].map((c) => blur(Float32Array.from({ length: n }, (_, i) => colour[i * 4 + c]! * mask[i]!)));
  const r = blur(Float32Array.from({ length: n }, (_, i) => rough[i * 4]! * mask[i]!));
  for (let i = 0; i < n; i++) {
    if (mask[i] === 0 || weight[i]! <= 0) continue;
    for (let c = 0; c < 3; c++) colour[i * 4 + c] = fields[c]![i]! / weight[i]!;
    rough.fill(r[i]! / weight[i]!, i * 4, i * 4 + 3);
  }
}

/**
 * A sign band left to the weather, in its linear colour and roughness: its paint bleached in patches, run-off streaks
 * from its top edge, grime along its foot, and flakes gone to the render beneath. Lettering still reads at 15 m.
 */
function weatherSign(colour: Float32Array, rough: Float32Array, w: number, h: number, seed: number, perMetre: number): void {
  const metres = h / perMetre;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, u = x / perMetre, v = y / perMetre;
      const rgb = [colour[i]!, colour[i + 1]!, colour[i + 2]!];
      const lum = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
      // Sun bleaching, in broad patches.
      const bleach = 0.18 + 0.3 * fbm(u * 1.2, v * 1.2, seed);
      for (let c = 0; c < 3; c++) rgb[c] = rgb[c]! * (1 - bleach) + (0.25 + 0.5 * lum) * bleach;
      // Run-off from the top edge: narrow streaks of uneven length, darkest where they start.
      const streak = smooth(0.55, 0.85, noise(u * 30, 0.5, seed + 3)) * smooth(0.3, 0.6, noise(u * 4, 1.5, seed + 4));
      const reach = metres * (0.35 + 0.65 * noise(u * 9, 2.5, seed + 5));
      const run = streak * Math.max(0, 1 - v / reach) * (0.8 + 0.2 * noise(u * 30, v * 6, seed + 6));
      // Grime settling along the foot.
      const grime = smooth(0.5, 1, v / metres) * (0.12 + 0.18 * fbm(u * 3, v * 3, seed + 7));
      for (let c = 0; c < 3; c++) rgb[c] = rgb[c]! * (1 - 0.4 * run - grime) * (c === 2 ? 1 - 0.25 * run : 1);
      // Flakes of paint gone to the grey render beneath, with a darker rim.
      const f = fbm(u * 7, v * 7, seed + 8);
      const lost = smooth(0.7, 0.73, f), rim = smooth(0.66, 0.7, f) - lost;
      const render = 0.24 + 0.06 * noise(u * 40, v * 40, seed + 9);
      for (let c = 0; c < 3; c++) rgb[c] = (rgb[c]! * (1 - lost) + render * [1, 0.97, 0.9][c]! * lost) * (1 - 0.3 * rim);
      for (let c = 0; c < 3; c++) colour[i + c] = Math.max(0, rgb[c]!);
      rough.fill(Math.min(1, Math.max(rough[i]! + 0.1, 0.9 * lost, rough[i]! + 0.2 * run)), i, i + 3);
    }
  }
}

const bytes = (data: Float32Array, srgb: boolean, channels = 4): Picture => {
  const out = new Uint8Array((data.length / 4) * channels);
  for (let i = 0, k = 0; i < data.length; i += 4) for (let c = 0; c < channels; c++) out[k++] = Math.round(Math.min(1, Math.max(0, srgb && c < 3 ? toSrgb(data[i + c]!) : data[i + c]!)) * 255);
  return { width: FACADE_TOP, height: FACADE_TOP, channels, depth: 8, data: out };
};

/** The sources, in a key: every file under the source folder and this file. */
function key(source: string): string {
  const hash = createHash("sha256").update(readFileSync(import.meta.filename));
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (name.name.endsWith(".png")) hash.update(path.slice(source.length)).update(readFileSync(path));
    }
  };
  if (existsSync(source)) walk(source);
  return hash.digest("hex");
}

/**
 * Builds the atlases from `source` into `out` unless they are there from the same sources, and returns each element's
 * and each room's mean (facade.ts ELEMENT_MEANS, ROOM_MEANS). An element or a room the sources lack is left grey.
 */
export function buildFacadeArt(source = FACADE_SOURCE, out = FACADE_ART): { elements: number[]; marks: number[]; rooms: number[] } {
  const stamp = join(out, "key"), means = join(out, "means.json"), k = key(source);
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === k && existsSync(means)) return JSON.parse(readFileSync(means, "utf8")) as { elements: number[]; marks: number[]; rooms: number[] };
  mkdirSync(out, { recursive: true });
  const size = FACADE_TOP * FACADE_TOP * 4;
  const base = new Float32Array(size).fill(0.2), normal = new Float32Array(size), orm = new Float32Array(size), rooms = new Float32Array(size).fill(0.08);
  for (let i = 0; i < size; i += 4) {
    normal.set([0.5, 0.5, 1, 1], i);
    orm.set([1, 0.8, 0, 1], i);
    base[i + 3] = rooms[i + 3] = 1;
  }
  const elements: number[] = [];
  for (const p of PLACED) {
    const dir = join(source, "elements", `${p.name}-${p.variant}`);
    const read = (name: string): Picture | null => (existsSync(join(dir, `${name}.png`)) ? readPicture(join(dir, `${name}.png`)) : null);
    const b = read("base");
    const colour = b ? fitted(b, p.w, p.h, toLinear) : new Float32Array(p.w * p.h * 4).fill(0.2).map((v, i) => ((i & 3) === 3 ? 1 : v));
    const n = read("normal");
    const flat = new Float32Array(p.w * p.h * 4).map((_, i) => [0.5, 0.5, 1, 1][i & 3]!);
    const bent = n ? fitted(n, p.w, p.h) : flat;
    const grey = (name: string): Float32Array => {
      const q = read(name);
      return q ? fitted(q, p.w, p.h) : new Float32Array(p.w * p.h * 4).fill(MISSING[name]!);
    };
    const [occ, rough, metal] = [grey("occlusion"), grey("roughness"), grey("metal")];
    if (p.name === "sign") weatherSign(colour, rough, p.w, p.h, 11 + p.variant, p.w / ELEMENTS.find((e) => e[0] === "sign")![1]);
    softGlass(colour, rough, p.w, p.h);
    const packed = new Float32Array(p.w * p.h * 4);
    for (let i = 0; i < packed.length; i += 4) packed.set([occ[i]!, rough[i]!, metal[i]!, 1], i);
    lay(base, colour, p.x, p.y, p.w, p.h, 16);
    lay(normal, bent, p.x, p.y, p.w, p.h, 16);
    lay(orm, packed, p.x, p.y, p.w, p.h, 16);
    // The mean of the solid part's colour, its cover, and the mean roughness.
    let cover = 0, r = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < colour.length; i += 4) {
      const a = colour[i + 3]!;
      for (let c = 0; c < 3; c++) sum[c]! += colour[i + c]! * a;
      cover += a;
      r += rough[i]!;
    }
    const px = colour.length / 4;
    elements.push(...sum.map((s) => (cover > 0 ? s / cover : 0.2)), cover / px, r / px);
  }
  // The marks: each one's colour where it covers and its cover, the rest of their atlas clear.
  const marks = new Float32Array(size), markMeans: number[] = [];
  for (const p of MARKS_PLACED) {
    const file = join(source, "marks", `${p.name}-${p.variant}`, "base.png");
    const px = existsSync(file) ? fitted(readPicture(file), p.w, p.h, toLinear) : new Float32Array(p.w * p.h * 4);
    lay(marks, px, p.x, p.y, p.w, p.h, 16);
    let cover = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) {
      for (let c = 0; c < 3; c++) sum[c]! += px[i + c]! * px[i + 3]!;
      cover += px[i + 3]!;
    }
    markMeans.push(...sum.map((v) => (cover > 0 ? v / cover : 0)), cover / (px.length / 4));
  }
  const roomMeans: number[] = [];
  const quarter = FACADE_TOP / 8;
  for (let k = 0; k < ROOMS; k++) {
    const dir = join(source, "rooms", `room-${String(k).padStart(2, "0")}`);
    const sum = [0, 0, 0];
    let n = 0;
    ROOM_FACES.forEach((face, f) => {
      const file = join(dir, `${face}.png`);
      if (!existsSync(file)) return;
      const px = fitted(readPicture(file), quarter, quarter, toLinear);
      lay(rooms, px, (k % 4) * quarter * 2 + (f & 1) * quarter, Math.floor(k / 4) * quarter * 2 + (f >> 1) * quarter, quarter, quarter, 0);
      for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += px[i + c]!;
      n += px.length / 4;
    });
    roomMeans.push(...sum.map((s) => (n > 0 ? s / n : 0.08)));
  }
  writeFileSync(join(out, "elements-base.png"), encodePng(bytes(base, true)));
  writeFileSync(join(out, "elements-normal.png"), encodePng(bytes(normal, false, 3)));
  writeFileSync(join(out, "elements-orm.png"), encodePng(bytes(orm, false)));
  writeFileSync(join(out, "rooms.png"), encodePng(bytes(rooms, true, 3)));
  writeFileSync(join(out, "marks.png"), encodePng(bytes(marks, true)));
  const four = (v: number): number => Number(v.toPrecision(4));
  const result = { elements: elements.map(four), marks: markMeans.map(four), rooms: roomMeans.map(four) };
  writeFileSync(means, JSON.stringify(result));
  writeFileSync(stamp, k);
  return result;
}

/** Whether the facades' painted sources are in the checkout, as the world finishes' are (HAS_SURFACES). */
export const HAS_FACADES = existsSync(join(FACADE_SOURCE, "elements")) && existsSync(join(FACADE_SOURCE, "rooms"));

/** The pack's materials of the atlases (facade.ts FACADE_MATERIALS). */
export function facadeMaterials(): Material[] {
  buildFacadeArt();
  return [
    { name: "elements", id: FACADE_MATERIALS[0], dir: FACADE_ART, spec: { base: "elements-base.png", normal: "elements-normal.png", packed: "elements-orm.png" } },
    { name: "rooms", id: FACADE_MATERIALS[1], dir: FACADE_ART, spec: { base: "rooms.png" } },
    { name: "marks", id: FACADE_MATERIALS[2], dir: FACADE_ART, spec: { base: "marks.png" } },
  ];
}

/** Carriers of the materials, as the world finishes' are: a triangle never drawn, named after theirs, renumbering no mesh. */
export function facadeMeshes(): SourceMesh[] {
  return FACADE_MATERIALS.map((id, k) => {
    const roles = k === 0 ? (["base", "normal", "mro"] as const) : (["base"] as const);
    // The elements' and the marks' base colours keep their alpha (the glass, a mark's cover), as a cut-out's does.
    const material = { id, base: 0, normal: k === 0 ? 1 : -1, mro: k === 0 ? 2 : -1, mask: -1, mask2: -1, tint: [1, 1, 1] as [number, number, number], grey: 1, emissive: 0, flags: id === FACADE_MATERIALS[1] ? 0 : MATERIAL_CUTOUT, cutoff: 0, span: 0 };
    return { id: `core:zzz_${id.slice(5)}`, flat: 1, materials: [material], textures: roles.map((role) => ({ id: `${id}/${role}`, role, top: FACADE_TOP })),
      lods: [{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 2, 1]), uvs: Float32Array.from([0, 0, 1, 0, 0, 1]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]) }] };
  });
}

/**
 * The atlases as the card holds them in the rgba variant at a tier's sides: each one's levels from the finest down (the
 * elements' base, normal as red and green, packed, the rooms' and the marks'), and the same as the software twin's textures.
 */
export function facadeMaps(tier: FacadeTier, source = FACADE_SOURCE): { levels: Uint8Array[][]; textures: Texture[] } {
  buildFacadeArt(source);
  const normal = normalMips(readPicture(join(FACADE_ART, "elements-normal.png")));
  const rg = normal.pictures.map((p) => Uint8Array.from({ length: p.length / 2 }, (_, i) => p[(i >> 1) * 4 + (i & 1)]!));
  const smallest = [
    baseMips(readPicture(join(FACADE_ART, "elements-base.png"))),
    rg,
    packedMips(readPicture(join(FACADE_ART, "elements-orm.png")), normal.lengths),
    baseMips(readPicture(join(FACADE_ART, "rooms.png"))),
    baseMips(readPicture(join(FACADE_ART, "marks.png"))),
  ].map((mips, k) => mips.slice(0, Math.log2(Math.max(k < 3 ? tier.elements : k === 3 ? tier.rooms : tier.marks, 64)) + 1));
  return { levels: smallest.map((m) => [...m].reverse()), textures: smallest.map((m, k) => decodeTexture(k === 1 ? "normal" : k === 2 ? "mro" : "base", m)) };
}

if (import.meta.main) {
  const at = process.argv.indexOf("--source");
  const m = buildFacadeArt(at > 0 ? resolve(process.argv[at + 1]!) : FACADE_SOURCE);
  console.log(FACADE_ART, `${ELEMENTS.length} elements, ${PLACED.length} placed`);
  if (process.argv.includes("--means")) console.log(JSON.stringify(m));
  // --write puts the means into facade.ts, whose GLSL and twin fade to them.
  if (process.argv.includes("--write")) {
    const file = resolve(ROOT, "client/core/render/facade.ts");
    const text = readFileSync(file, "utf8")
      .replace(/^export const ELEMENT_MEANS: readonly number\[\] = .*$/m, `export const ELEMENT_MEANS: readonly number[] = [${m.elements.join(", ")}];`)
      .replace(/^export const MARK_MEANS: readonly number\[\] = .*$/m, `export const MARK_MEANS: readonly number[] = [${m.marks.join(", ")}];`)
      .replace(/^export const ROOM_MEANS: readonly number\[\] = .*$/m, `export const ROOM_MEANS: readonly number[] = [${m.rooms.join(", ")}];`);
    writeFileSync(file, text);
  }
}
