// What the asset check says of an asset's textures: the pictures each material names and how large the pack stores
// them, and, when the pictures are read, the measures of tools/pack/image.ts and mask.ts. A fault is what would draw
// wrong: a picture that is missing or not square, a tiling picture with a seam, a normal map that leans against its
// height, a region map that is not flat colours, masks that dye a pixel more than wholly, a large picture that is not
// its small one, and more megabytes than the asset allows.

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Pack } from "../../shared/pack/pack.ts";
import { nearestColour } from "../../shared/pack/palette.ts";
import { STEP0_SIZE, TEXTURE_FORMATS, blockOf, textureBytes, topIn, type TextureRole } from "../../shared/pack/texture.ts";
import { ASTC_BLOCK } from "../pack/encode.ts";
import { asPicture, baseMips, normalAgainstHeight, normalMips, readPicture, seam, shrunkAgainst, type Picture } from "../pack/image.ts";
import { checkMasks, readRegions, regionMasks } from "../pack/mask.ts";
import { isNeutral, materialMips, neededSide } from "../pack/texture.ts";
import type { Asset } from "./assets.ts";
import { materialsOf, pictureFiles, readMaps, sideOf, type Material } from "./materials.ts";

/**
 * A picture that tiles jumps across its edge about as hard as inside it: 1. Pictures that do tile measure up to
 * about 2, more where a feature lies along the edge. Past SEAM_NOTED it is remarked on, and past SEAM it is a fault.
 */
const SEAM_NOTED = 2;
const SEAM = 4;
/** A normal map agrees with its height when this much of its lean is the height's slope. Under 0 it leans the other way. */
const AGREES = 0.5;
/** A painted region map may have this share of pixels that are no region's colour. */
const STRAY = 0.02;
/** A large picture, shrunk, is its small one when they are this many decibels alike. */
const ALIKE = 30;

export interface LayerFacts {
  /** "base", "normal", "packed", "regions", "height", and so on. */
  what: string;
  /** Its path within the asset's folder. */
  file: string;
  width: number;
  height: number;
  depth: number;
  /** For a material that tiles, when the pictures are read: how hard it jumps across its edge, across and down. About 1 where it wraps. */
  seam?: [number, number];
}

export interface MaterialFacts {
  id: string;
  name: string;
  layers: LayerFacts[];
  /** The side, in pixels, at which the pack stores each of its textures. */
  tops: Partial<Record<TextureRole, number>>;
  /** Metres one picture spans, as the pack has it, and whether the asset gave that. */
  span: number;
  tiles: boolean;
  // What follows is there only when the pictures are read.
  /** Its base colour's mean, as light, under its tint, and the palette colour nearest that. */
  mean?: [number, number, number];
  nearest?: { colour: number; distance: number };
  /** How the normal map follows the height (normalAgainstHeight in tools/pack/image.ts). */
  normal?: { x: number; y: number; length: number; off: number };
  /** `stray` is of a painted map. The rest is of the masks (checkMasks in tools/pack/mask.ts). */
  regions?: { stray?: number; over: number; most: number; cover: number[] };
  /** Decibels between each large picture, shrunk, and its small one. */
  shrunk?: Record<string, number>;
}

function header(file: string): { width: number; height: number; depth: number } {
  const bytes = new Uint8Array(26);
  const fd = openSync(file, "r");
  try {
    readSync(fd, bytes, 0, 26, 0);
  } finally {
    closeSync(fd);
  }
  const view = new DataView(bytes.buffer);
  if (view.getUint32(0) !== 0x89504e47) throw new Error(`${file}: not a PNG file`);
  return { width: view.getUint32(16), height: view.getUint32(20), depth: bytes[24]! };
}

/** One material's facts. `deep` reads its pictures, and holds them against those of `others`. */
function measure(asset: Asset, m: Material, pack: Pack, deep: boolean, faults: string[], notes: string[], others: readonly Material[]): MaterialFacts {
  const before = faults.length;
  const held = (pack.header.materials ?? []).find((p) => p.id === m.id);
  const tops: Partial<Record<TextureRole, number>> = {};
  for (const t of pack.header.textures ?? []) if (t.id === `${m.id}/${t.role}`) tops[t.role] = t.top;
  const out: MaterialFacts = { id: m.id, name: m.name, layers: [], tops, span: held?.span ?? 0, tiles: m.spec.tiles !== undefined };
  const files = pictureFiles(m);
  for (const [what, file] of Object.entries(files)) {
    const short = relative(asset.dir, file);
    if (!existsSync(file)) {
      faults.push(`${m.id}: its ${what} picture, ${short}, is not there`);
      continue;
    }
    const h = header(file);
    out.layers.push({ what, file: short, ...h });
    if (h.width !== h.height) faults.push(`${m.id}: its ${what} picture is ${h.width} by ${h.height}, and a texture is square`);
    else if (sideOf(h) < STEP0_SIZE && what !== "height" && !what.startsWith("small")) faults.push(`${m.id}: its ${what} picture is ${h.width} pixels across, and a texture is ${STEP0_SIZE} at least`);
  }
  if (!held) faults.push(`${m.id}: the pack has no such material. Build the asset again`);
  const side = (what: string): number => sideOf(out.layers.find((l) => l.what === what) ?? { width: 0 });
  for (const [role, what] of [["base", "base"], ["normal", "normal"], ["mro", files.packed ? "packed" : "occlusion"], ["mask", files.regions ? "regions" : "mask"], ["layer", files.hurt ? "hurt" : "decay"]] as const) {
    const have = files[what] !== undefined;
    if (have !== (tops[role] !== undefined)) faults.push(`${m.id}: its asset ${have ? "names" : "does not name"} a ${what} picture, and the pack has ${have ? "no such texture" : "one"}. Build the asset again`);
    else if (have && side(what) > 0 && tops[role]! > side(what)) faults.push(`${m.id}: the pack stores its ${role} at ${tops[role]} pixels, and its picture is ${side(what)}. Build the asset again`);
  }
  if (!deep || faults.length > before) return out;

  const read = (what: string): Picture | undefined => (files[what] === undefined ? undefined : readPicture(files[what]));
  if (m.spec.data) {
    // Pictures that are data: the masks are layers of the sky that tile, and nothing else is measured.
    for (const layer of out.layers.filter((l) => l.what.startsWith("mask"))) {
      layer.seam = seam(read(layer.what)!);
      if (Math.max(...layer.seam) > SEAM) faults.push(`${m.id}: its ${layer.what} picture does not wrap: it jumps ${layer.seam.map((v) => v.toFixed(2)).join(" and ")} times as hard across its edge as inside it`);
    }
    return out;
  }
  const [base, normal, height] = [read("base"), read("normal"), read("height")];
  if (base) {
    const tint = m.spec.tint ?? [1, 1, 1];
    const linear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
    const srgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
    const mean = [...baseMips(base)[0]!.subarray(0, 3)].map((c, k) => Math.round(srgb(Math.min(1, linear(c / 255) * tint[k]!)) * 255)) as [number, number, number];
    const colour = nearestColour(pack.palette, ...mean);
    out.mean = mean;
    out.nearest = { colour, distance: Math.hypot(pack.palette[colour * 4]! - mean[0], pack.palette[colour * 4 + 1]! - mean[1], pack.palette[colour * 4 + 2]! - mean[2]) };
  }
  if (out.tiles) {
    for (const layer of out.layers) {
      if (layer.what.startsWith("small") || layer.what === "regions" || layer.what.startsWith("mask")) continue;
      layer.seam = seam(layer.what === "base" ? base! : layer.what === "normal" ? normal! : layer.what === "height" ? height! : read(layer.what)!);
      const jumps = `it jumps ${layer.seam.map((v) => v.toFixed(2)).join(" and ")} times as hard across its edge, across and down, as inside it`;
      if (Math.max(...layer.seam) > SEAM) faults.push(`${m.id}: its ${layer.what} picture does not wrap: ${jumps}`);
      else if (Math.max(...layer.seam) > SEAM_NOTED) notes.push(`${m.id}: its ${layer.what} picture may show where it wraps: ${jumps}`);
    }
  }
  if (normal && height) {
    // A normal map larger than its height is held against it at the height's size.
    const [n, h] = [sideOf(normal), sideOf(height)];
    const same = n === h ? normal : n > h && h === height.width ? asPicture(normalMips(normal).pictures[Math.log2(h)]!) : null;
    if (same && same.width === height.width) {
      out.normal = normalAgainstHeight(same, height);
      const { x, y } = out.normal;
      if (y < -AGREES) faults.push(`${m.id}: its normal map's green points down the picture (${y.toFixed(2)} against its height): it would be lit upside down`);
      else if (x < -AGREES) faults.push(`${m.id}: its normal map's red points left (${x.toFixed(2)} against its height): it would be lit from the wrong side`);
      else if (x < AGREES || y < AGREES) notes.push(`${m.id}: its normal map follows its height loosely (${x.toFixed(2)} across, ${y.toFixed(2)} down, where 1 is exactly)`);
    }
  }
  const [regions, mask, mask2] = [read("regions"), read("mask"), read("mask2")];
  if (regions && tops.mask) {
    const made = regionMasks(regions, tops.mask);
    out.regions = { stray: made.stray, ...checkMasks(made.mask, made.mask2) };
    if (made.stray > STRAY) faults.push(`${m.id}: ${(made.stray * 100).toFixed(1)}% of its region map is no region's colour`);
  } else if (mask) {
    const report = checkMasks(mask, mask2);
    if (!report.sameSize) faults.push(`${m.id}: its two masks are not one size`);
    else out.regions = report;
  } else if (regions) out.regions = { stray: readRegions(regions).stray, over: 0, most: 0, cover: [] };
  if (out.regions && out.regions.over > 0) faults.push(`${m.id}: the weights of ${(out.regions.over * 100).toFixed(2)}% of its masks' pixels sum past 1, to as much as ${out.regions.most.toFixed(2)}`);
  const [smallBase, smallNormal] = [read("small base"), read("small normal")];
  if (base && smallBase) (out.shrunk ??= {}).base = shrunkAgainst(baseMips(base), baseMips(smallBase));
  if (normal && smallNormal) (out.shrunk ??= {}).normal = shrunkAgainst(normalMips(normal).pictures, normalMips(smallNormal).pictures);
  for (const [what, db] of Object.entries(out.shrunk ?? {})) if (db < ALIKE) faults.push(`${m.id}: its ${what} picture, shrunk, is not its small one (${db.toFixed(1)} dB)`);
  if (faults.length === before) notes.push(...contentNotes(m, tops, others));
  return out;
}

/** The map each picture a material's textures are made from goes into. Its height and small pictures are kept for the record. */
const MAKES: Readonly<Record<string, TextureRole>> = { base: "base", normal: "normal", packed: "mro", occlusion: "mro", roughness: "mro", metal: "mro", regions: "mask", mask: "mask", mask2: "mask2", hurt: "layer", decay: "layer" };

/**
 * What a material's maps hold, as the build makes them: one its role's neutral everywhere, which the build leaves out;
 * one whose pictures' steps past some side change nothing beyond what tools/pack/texture.ts `neededSide` allows, which
 * its asset can store at that side (`tops`); and a picture another material names too, of which the build keeps one
 * texture where the two are made alike.
 */
function contentNotes(m: Material, tops: Partial<Record<TextureRole, number>>, others: readonly Material[]): string[] {
  const notes: string[] = [];
  const mips = materialMips(readMaps(m));
  const neutral = new Set<TextureRole>();
  for (const [role, top] of Object.entries(tops) as [TextureRole, number][]) {
    const all = mips[role];
    if (!all || all.length < Math.log2(top) + 1) continue;
    const alpha = role === "layer" || (role === "base" && m.spec.cutout !== undefined && m.spec.cutout !== false);
    if (isNeutral(role, alpha, all.slice(0, Math.log2(top) + 1))) {
      neutral.add(role);
      notes.push(`${m.id}: its ${role} is everywhere what a material without one draws, and the build leaves it out`);
      continue;
    }
    if (role === "mask" || role === "mask2") continue;
    const { side, change } = neededSide(role, alpha, all);
    if (side < top) notes.push(`${m.id}: its ${role} needs ${side} pixels and is stored at ${top}: from ${side} up no texel ${role === "normal" ? `turns more than ${change.toFixed(1)} degrees` : `moves more than ${change.toFixed(1)} levels`} (tops: { ${role}: ${side} })`);
  }
  const files = pictureFiles(m);
  for (const [what, file] of Object.entries(files)) {
    if (MAKES[what] === undefined || neutral.has(MAKES[what]) || !existsSync(file)) continue;
    const bytes = statSync(file).size;
    const twin = others.find((o) => {
      const theirs = o.id === m.id ? undefined : pictureFiles(o)[what];
      if (theirs === undefined || !existsSync(theirs)) return false;
      return resolve(theirs) === resolve(file) || (statSync(theirs).size === bytes && readFileSync(theirs).equals(readFileSync(file)));
    });
    if (twin) notes.push(`${m.id}: its ${what} picture is ${twin.id}'s too, and the build keeps one texture of what the two make alike`);
  }
  return notes;
}

export interface TextureReport {
  materials: MaterialFacts[];
  /** Megabytes of all the asset's textures in the variant that takes most, and the most its asset allows, or null. */
  megabytes: number;
  budget: number | null;
}

/**
 * The facts of every material the asset names. With `deep` their pictures are read and measured, which takes seconds,
 * and held against the pictures of its other materials and of the `others` assets' materials.
 */
export function measureTextures(asset: Asset, pack: Pack, deep: boolean, faults: string[], notes: string[], others: readonly Asset[] = []): TextureReport {
  const spec = asset.spec;
  const own = materialsOf(asset);
  const pool = deep ? [...own, ...others.filter((o) => o.id !== asset.id).flatMap(materialsOf)] : [];
  const materials = own.map((m) => measure(asset, m, pack, deep, faults, notes, pool));
  const named = pack.header.textures ?? [];
  for (const t of named) if (!materials.some((m) => t.id === `${m.id}/${t.role}`)) faults.push(`the pack names the texture ${t.id}, which no material in asset.ts has. Build the asset again`);
  const megabytes = Math.max(...TEXTURE_FORMATS.map((format) => named.reduce((sum, t) => sum + textureBytes(format, t.role, topIn(format, t.top), format === "astc" ? ASTC_BLOCK[t.role] : blockOf(format, {})), 0))) / 2 ** 20;
  const budget = (spec.kind === "creature" || spec.kind === "pieces" ? spec.budgets.texture?.megabytes : undefined) ?? null;
  if (budget !== null && megabytes > budget) faults.push(`its textures take ${megabytes.toFixed(1)} MB in one variant, and its budget is ${budget} MB`);
  return { materials, megabytes, budget };
}
