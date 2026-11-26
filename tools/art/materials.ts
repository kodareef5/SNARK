// The materials an asset names in its asset.ts: where their pictures are, what a pack says of each, the colour each is
// drawn flat in, and the mips of each of their textures for the texture build.

import { airMaterial, airTextures } from "../pack/air-support.ts";
import { HAS_SURFACES, worldMaterials, worldSurfaceMeshes } from "../surfaces/build.ts";
import { HAS_FACADES, facadeMaterials, facadeMeshes } from "../facade/build.ts";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MATERIAL_BLEND, MATERIAL_CUTOUT, MATERIAL_INDICATOR, MATERIAL_NIGHT, MATERIAL_TWO_SIDED, parsePack, type PackMaterial, type PackTexture } from "../../shared/pack/pack.ts";
import { REGION_BASE, nearestColour } from "../../shared/pack/palette.ts";
import { LAST_STEP, STEP0_SIZE, stepOf, stepSize, type TextureRole } from "../../shared/pack/texture.ts";
import type { TextureSource } from "../pack/encode.ts";
import { baseMips, layerPicture, packMro, packedMips, readPicture, type Picture } from "../pack/image.ts";
import { checkMasks, maskMips, readMasks, readRegions } from "../pack/mask.ts";
import { materialMips, type MaterialMaps } from "../pack/texture.ts";
import { findAssets, landmarkOf, type Asset } from "./assets.ts";
import { SOURCE } from "./source.ts";
import type { MaterialSpec } from "./spec.ts";

export interface Material {
  /** As the model names it. */
  name: string;
  /** Its id in the pack: its own where several assets share it, "<asset>/<name>" where not. A texture is "<material>/<role>". */
  id: string;
  spec: MaterialSpec;
  /** The folder its paths are in. */
  dir: string;
}

export function materialsOf(asset: Asset): Material[] {
  const spec = asset.spec;
  if (spec.kind === "sky") return [{ name: "sky", id: `${asset.id}/sky`, spec: { base: spec.moon, regions: { mask: spec.low, mask2: spec.high }, data: true }, dir: asset.dir }];
  if (spec.kind === "water") return [{ name: "waves", id: `${asset.id}/waves`, spec: { regions: { mask: spec.long, mask2: spec.short }, data: true }, dir: asset.dir }];
  if (spec.kind !== "creature" && spec.kind !== "pieces" && spec.kind !== "human-bodies") return [];
  // A creature's worn saddles and its saddled model name their materials as its body does, in the one list.
  const named: Readonly<Record<string, MaterialSpec>> = spec.kind === "creature" ? Object.assign({}, spec.materials, ...(spec.worn ?? []).map((w) => w.materials ?? {}), spec.saddled?.materials) : (spec.materials ?? {});
  return Object.entries(named).map(([name, m]) => ({ name, id: m.id ?? `${asset.id}/${name}`, spec: m, dir: m.dir ?? asset.dir }));
}

/** The picture files of a material, by what each is. A packed map of layers and masks made by hand are several. */
export function pictureFiles(m: Material): Record<string, string> {
  const { base, normal, packed, regions, height, small, hurt, decay } = m.spec;
  const out: Record<string, string | undefined> = { base, normal, height, "small base": small?.base, "small normal": small?.normal, hurt, decay };
  if (typeof packed === "string") out.packed = packed;
  else if (packed) Object.assign(out, { occlusion: packed.occlusion, roughness: packed.roughness, metal: packed.metal });
  if (typeof regions === "string") out.regions = regions;
  else if (regions) Object.assign(out, { mask: regions.mask, mask2: regions.mask2 });
  return Object.fromEntries(Object.entries(out).flatMap(([what, file]) => (file === undefined ? [] : [[what, join(m.dir, file)]])));
}

/** A material's pictures as the texture pipeline takes them, read from its files: all of them, or those the `roles` given are made from. */
export function readMaps(m: Material, roles?: readonly TextureRole[]): MaterialMaps {
  const files = pictureFiles(m);
  const want = (role: TextureRole): boolean => !roles || roles.includes(role);
  const read = (what: string): Picture | undefined => (files[what] === undefined ? undefined : readPicture(files[what]));
  const out: MaterialMaps = {};
  if (want("base")) out.base = read("base");
  // A packed map is roughened by what its normal map loses, so it is made with it.
  if (want("normal") || want("mro")) out.normal = read("normal");
  if (want("mro")) out.mro = files.occlusion !== undefined ? packMro(read("occlusion")!, read("roughness")!, read("metal")) : read("packed");
  if (want("mask") || want("mask2")) Object.assign(out, { regions: read("regions"), mask: read("mask"), mask2: read("mask2") });
  if (want("layer")) Object.assign(out, { hurt: read("hurt"), decay: read("decay") });
  for (const key of Object.keys(out) as (keyof MaterialMaps)[]) if (!out[key]) delete out[key];
  return out;
}

/** The side a picture has as a texture: the power of two nearest its own. */
export const sideOf = (p: { width: number }): number => 2 ** Math.round(Math.log2(p.width));

const linear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const srgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/** What a pack says of a material, the colour it is drawn flat in, and its pictures for whoever reads colours off them. */
export interface Described {
  /** Its textures are named by their place in `textures`. `span` is how far it tiles, or 0 for the meshes it is on to be measured. */
  material: PackMaterial;
  textures: PackTexture[];
  maps: MaterialMaps;
  /** A palette colour, or the region that dyes half of it or more. */
  flat: number;
  faults: string[];
}

/**
 * Reads a material's pictures and says what the pack holds of it. Base colour and normal are stored as large as they
 * come, up to `top`, the packed map and the masks one size under the base colour, and the layer its pictures make as
 * large as they are up to `layer`, each no wider than the material's `tops` says. The layer comes after the five maps.
 */
export function describe(m: Material, top: number, palette: Uint8Array, layer = top): Described {
  if (m.spec.data) return describeData(m);
  const faults: string[] = [];
  const maps = readMaps(m);
  for (const [what, p] of Object.entries(maps) as [string, Picture][]) {
    if (p.width !== p.height) throw new Error(`${m.id}: its ${what} picture is ${p.width} by ${p.height}, and a texture is square`);
    if (sideOf(p) < STEP0_SIZE) throw new Error(`${m.id}: its ${what} picture is ${p.width} pixels across, and a texture is ${STEP0_SIZE} at least`);
  }
  const base = maps.base && baseMips(maps.base);
  let masks: ReturnType<typeof maskMips> | null = null;
  if (maps.regions) masks = maskMips(readRegions(maps.regions));
  else if (maps.mask) {
    const report = checkMasks(maps.mask, maps.mask2);
    if (!report.sameSize) throw new Error(`${m.id}: its two masks are not one size`);
    if (report.over > 0) faults.push(`${m.id}: the weights of ${(report.over * 100).toFixed(2)}% of its masks' pixels sum past 1, to as much as ${report.most.toFixed(2)}`);
    else masks = maskMips(readMasks(maps.mask, maps.mask2));
  }
  const most = Math.min(top, stepSize(LAST_STEP));
  const under = Math.max(STEP0_SIZE, Math.min(maps.base ? sideOf(maps.base) : most, most) / 2);
  const tops: Partial<Record<TextureRole, number>> = {};
  if (maps.base) tops.base = Math.min(sideOf(maps.base), most);
  if (maps.normal) tops.normal = Math.min(sideOf(maps.normal), most);
  if (maps.mro) tops.mro = Math.min(sideOf(maps.mro), under);
  if (masks) tops.mask = Math.min(1 << (masks.mask.length - 1), under);
  const told = m.spec.tops ?? {};
  for (const [role, side] of Object.entries(told) as [TextureRole, number][]) {
    if (stepOf(side) < 0) throw new Error(`${m.id}: it stores its ${role} at ${side} pixels, and a texture is a power of two from ${STEP0_SIZE} to ${stepSize(LAST_STEP)}`);
    if (tops[role] !== undefined) tops[role] = Math.min(tops[role]!, side);
  }
  if (masks?.mask2) tops.mask2 = tops.mask;
  const lender = m.spec.borrows ? `${m.id.slice(0, m.id.length - m.name.length)}${m.spec.borrows.from}` : null;
  const owner = (role: TextureRole): string => (lender && m.spec.borrows!.roles.includes(role) ? lender : m.id);
  const textures = (Object.keys(tops) as TextureRole[]).sort().map((role): PackTexture => ({ id: `${owner(role)}/${role}`, role, top: tops[role]! }));
  const layered = maps.hurt ?? maps.decay;
  if (layered) {
    if (maps.hurt && maps.decay && maps.hurt.width !== maps.decay.width) throw new Error(`${m.id}: its hurt and decay pictures are not one size`);
    textures.push({ id: `${m.id}/layer`, role: "layer", top: Math.max(STEP0_SIZE, Math.min(sideOf(layered), most, layer, told.layer ?? Infinity)) });
    const { hidden } = layerPicture(maps.hurt, maps.decay);
    if (hidden > 0) faults.push(`${m.id}: ${hidden} texels of its decay picture lie under its hurt picture's, where only the hurt picture shows`);
  }
  const place = (role: TextureRole): number => textures.findIndex((t) => t.role === role);
  const tint = (m.spec.tint ?? [1, 1, 1]).slice(0, 3) as [number, number, number];
  const cutout = m.spec.cutout !== undefined && m.spec.cutout !== false;

  // How much of each region the whole picture has, and how bright the base colour is where a region dyes it.
  const cover = [0, 0, 0, 0, 0, 0];
  let grey = 1;
  if (masks) {
    const one = [masks.mask[0]!, masks.mask2?.[0]];
    for (let k = 0; k < 6; k++) cover[k] = (one[k < 3 ? 0 : 1]?.[k % 3] ?? 0) / 255;
    // Read where base colour and masks are one size, and no finer than 256 pixels.
    const at = Math.min(8, masks.mask.length - 1, (base?.length ?? 1) - 1);
    let lit = 0;
    let dyed = 0;
    for (let p = 0; base && p < base[at]!.length; p += 4) {
      const share = (masks.mask[at]![p]! + masks.mask[at]![p + 1]! + masks.mask[at]![p + 2]! + (masks.mask2 ? masks.mask2[at]![p]! + masks.mask2[at]![p + 1]! + masks.mask2[at]![p + 2]! : 0)) / 255;
      lit += share * (0.2126 * linear(base[at]![p]! / 255) + 0.7152 * linear(base[at]![p + 1]! / 255) + 0.0722 * linear(base[at]![p + 2]! / 255));
      dyed += share;
    }
    if (dyed > 0 && lit > 0) grey = Math.round((lit / dyed) * 1e4) / 1e4;
  }
  const material: PackMaterial = {
    id: m.id, base: place("base"), normal: place("normal"), mro: place("mro"), mask: place("mask"), mask2: place("mask2"), tint, grey, emissive: m.spec.emissive ?? 0,
    flags: (m.spec.twoSided ? MATERIAL_TWO_SIDED : 0) | (cutout ? MATERIAL_CUTOUT : 0) | (m.spec.night ? MATERIAL_NIGHT : 0) | (m.spec.indicator ? MATERIAL_INDICATOR : 0) | (m.spec.blend ? MATERIAL_BLEND : 0), cutoff: cutout ? (m.spec.cutout === true ? 0.5 : (m.spec.cutout as number)) : 0, span: m.spec.tiles ?? 0,
  };
  if (layered) material.layer = place("layer");
  if (m.spec.sheet) material.sheet = m.spec.sheet;
  if (m.spec.id !== undefined && !m.spec.tiles) faults.push(`${m.id}: a material several assets share says how far it tiles, so that it is the same on all of them`);

  // Flat, it is the region that dyes half of it or more, the colour its asset gives it, or its base colour's mean as light.
  const region = cover.indexOf(Math.max(...cover));
  let flat: number;
  if (m.spec.flat) flat = nearestColour(palette, ...(m.spec.flat as [number, number, number]));
  else if (cover[region]! >= 0.5) flat = REGION_BASE + region;
  else {
    const mean = base ? [...base[0]!.subarray(0, 3)].map((c) => linear(c / 255)) : [1, 1, 1];
    flat = nearestColour(palette, ...(mean.map((c, k) => srgb(Math.min(1, c * tint[k]!)) * 255) as [number, number, number]));
  }
  return { material, textures, maps, flat, faults };
}

/** A material whose pictures are data: each texture as large as its picture, plain, drawn flat in palette colour 0, which it never is. */
function describeData(m: Material): Described {
  const files = pictureFiles(m);
  const textures = (["base", "mask", "mask2"] as const).filter((role) => files[role] !== undefined).map((role): PackTexture => {
    const p = readPicture(files[role]!);
    if (p.width !== p.height || sideOf(p) < STEP0_SIZE) throw new Error(`${m.id}: its ${role} picture is ${p.width} by ${p.height}, and a texture is square and ${STEP0_SIZE} at least`);
    return { id: `${m.id}/${role}`, role, top: Math.min(sideOf(p), stepSize(LAST_STEP)) };
  });
  const place = (role: TextureRole): number => textures.findIndex((t) => t.role === role);
  const material: PackMaterial = { id: m.id, base: place("base"), normal: -1, mro: -1, mask: place("mask"), mask2: place("mask2"), tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 0 };
  return { material, textures, maps: {}, flat: 0, faults: [] };
}

/** The mips of one of a material's textures: RGBA8, smallest first, from one pixel across up to `top`. */
export function mipsOf(m: Material, role: TextureRole, top: number): Uint8Array[] {
  if (m.spec.data) {
    const picture = readPicture(pictureFiles(m)[role]!);
    return (role === "base" ? baseMips(picture) : packedMips(picture)).slice(0, Math.log2(top) + 1);
  }
  const mips = materialMips(readMaps(m, [role]))[role];
  if (!mips || mips.length < Math.log2(top) + 1) throw new Error(`${m.id}: its pictures do not make a ${role} texture ${top} pixels across`);
  return mips.slice(0, Math.log2(top) + 1);
}

/**
 * Every texture the packs under `source` name, for the texture build (tools/pack/encode.ts): its id, role and top as
 * its pack has them, and a way to its mips, which reads its pictures only when asked. A texture several packs name
 * is listed once. A landmark's are its own (tools/art/assets.ts landmarkOf), and the core's are every other.
 */
export async function gameTextures(source: string = SOURCE, landmark: string | null = null): Promise<TextureSource[]> {
  const out = new Map<string, TextureSource>();
  for (const asset of await findAssets(source)) {
    if (!existsSync(asset.file) || landmarkOf(asset, source) !== landmark) continue;
    const named = parsePack(new Uint8Array(readFileSync(asset.file))).header.textures ?? [];
    const materials = materialsOf(asset);
    for (const t of named) {
      const m = materials.find((m) => t.id === `${m.id}/${t.role}`);
      if (!m) throw new Error(`${asset.id}: its pack names the texture ${t.id}, which no material in its asset.ts has. Build it again`);
      const had = out.get(t.id);
      if (had && had.top !== t.top) throw new Error(`texture ${t.id} is ${had.top} pixels across in one pack and ${t.top} in ${asset.id}: assets that share a material give it one size`);
      out.set(t.id, { id: t.id, role: t.role, top: t.top, mips: () => mipsOf(m, t.role, t.top) });
    }
  }
  if (resolve(source) === resolve(SOURCE) && landmark === null) for (const t of airTextures) out.set(t.id, { ...t, mips: () => mipsOf(airMaterial, t.role, t.top) });
  if (HAS_SURFACES && resolve(source) === resolve(SOURCE) && landmark === null) {
    let materials: Material[] | undefined;
    worldSurfaceMeshes().forEach((mesh, k) => {
      for (const t of mesh.textures!) out.set(t.id, { id: t.id, role: t.role, top: t.top, mips: () => mipsOf((materials ??= worldMaterials())[k]!, t.role, t.top) });
    });
  }
  if (HAS_FACADES && resolve(source) === resolve(SOURCE) && landmark === null) {
    let materials: Material[] | undefined;
    facadeMeshes().forEach((mesh, k) => {
      for (const t of mesh.textures!) out.set(t.id, { id: t.id, role: t.role, top: t.top, mips: () => mipsOf((materials ??= facadeMaterials())[k]!, t.role, t.top) });
    });
  }
  return [...out.values()];
}
