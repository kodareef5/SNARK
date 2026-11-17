// Writes a texture file: one variant of every texture, each stored smallest picture first, as shared/pack/texture.ts
// lays it out. The pictures come already encoded for the variant, so a block encoder only has to supply them. The
// rgba variant needs no encoder and is made here.

import { NEUTRAL } from "../../client/core/render/surface.ts";
import { RGBA_TOP, STEP0_SIZE, TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, TEXTURE_MAGIC, TEXTURE_VERSION, pictureBytes, stepBytes, stepOf, stepOffset, textureBytes, topIn, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import { baseMips, layerMips, layerPicture, normalMips, packedMips, type Picture } from "./image.ts";
import { partHash } from "./manifest.ts";
import { checkMasks, maskMips, readMasks, readRegions } from "./mask.ts";

export interface EncodedTexture {
  role: TextureRole;
  /** Pixels a block holds on a side (shared/pack/texture.ts `blockOf`). */
  block: number;
  /** One picture for every side from 1 pixel up to the top, each in the variant's encoding. */
  pictures: readonly Uint8Array[];
}

/** Where a texture starts in its file, and the hash of each of its steps: what the manifest lists under the variant, with the file. */
export interface PlacedTexture {
  at: number;
  hash: string[];
  block?: number;
  /** The bytes each step is stored in, where one is deflated (tools/pack/store.ts). */
  stored?: number[];
}

/** Where the picture `size` pixels across starts in its texture. */
export function pictureOffset(format: TextureFormat, role: TextureRole, size: number, block: number): number {
  let at = 0;
  for (let s = 1; s < size; s <<= 1) at += pictureBytes(format, role, s, block);
  return at;
}

/** A texture file's header, saying it holds `count` textures. */
export function textureHeader(format: TextureFormat, count: number, version: number = TEXTURE_VERSION): Uint8Array {
  const bytes = new Uint8Array(TEXTURE_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, TEXTURE_MAGIC, true);
  view.setUint16(4, version, true);
  view.setUint16(6, TEXTURE_FORMATS.indexOf(format), true);
  view.setUint32(8, count, true);
  return bytes;
}

/**
 * Texture `i` as its variant's file holds it: its pictures one after another, and the hash of each step. Throws if it
 * has a top its variant does not hold, or a picture that is not the size the layout gives it.
 */
export function laidOut(format: TextureFormat, t: EncodedTexture, i: number): { bytes: Uint8Array; hash: string[] } {
  const top = 1 << (t.pictures.length - 1);
  if (stepOf(top) < 0 || topIn(format, top) !== top) throw new Error(`texture file: texture ${i} is ${top} pixels across, which ${format} does not hold`);
  t.pictures.forEach((p, k) => {
    const want = pictureBytes(format, t.role, 1 << k, t.block);
    if (p.length !== want) throw new Error(`texture file: the ${1 << k}-pixel picture of texture ${i} is ${p.length} bytes, not ${want}`);
  });
  const bytes = new Uint8Array(textureBytes(format, t.role, top, t.block));
  let at = 0;
  for (const p of t.pictures) {
    bytes.set(p, at);
    at += p.length;
  }
  const hash: string[] = [];
  for (let s = 0; s <= stepOf(top); s++) {
    const from = stepOffset(format, t.role, s, t.block);
    hash.push(partHash(bytes.subarray(from, from + stepBytes(format, t.role, s, t.block))));
  }
  return { bytes, hash };
}

/** What the manifest lists of a texture starting `at` in its file. */
export function placedAt(format: TextureFormat, t: EncodedTexture, at: number, hash: string[]): PlacedTexture {
  return format === "astc" && t.block !== 4 ? { at, hash, block: t.block } : { at, hash };
}

/** The texture file of `textures`, each laid out as `laidOut` lays it, and where each is in it. */
export function writeTextureFile(format: TextureFormat, textures: readonly EncodedTexture[]): { bytes: Uint8Array; placed: PlacedTexture[] } {
  const laid = textures.map((t, i) => laidOut(format, t, i));
  const bytes = new Uint8Array(laid.reduce((sum, l) => sum + l.bytes.length, TEXTURE_HEADER_BYTES));
  bytes.set(textureHeader(format, textures.length));
  let at = TEXTURE_HEADER_BYTES;
  const placed = laid.map((l, i): PlacedTexture => {
    bytes.set(l.bytes, at);
    at += l.bytes.length;
    return placedAt(format, textures[i]!, at - l.bytes.length, l.hash);
  });
  return { bytes, placed };
}

/** A mip as the rgba variant holds it: red and green alone for a normal, whose blue the shader works out, and all four channels for the rest. */
export function rgbaPicture(role: TextureRole, mip: Uint8Array): Uint8Array {
  if (role !== "normal") return mip;
  const out = new Uint8Array(mip.length >> 1);
  for (let i = 0; i < out.length; i += 2) {
    out[i] = mip[i * 2]!;
    out[i + 1] = mip[i * 2 + 1]!;
  }
  return out;
}

/** A texture in the rgba variant from its mips. It stops at 1024 however large they go. */
export function rgbaTexture(role: TextureRole, mips: readonly Uint8Array[]): EncodedTexture {
  return { role, block: 1, pictures: mips.slice(0, Math.log2(RGBA_TOP) + 1).map((m) => rgbaPicture(role, m)) };
}

/** A material's source pictures. Its colour regions come as a painted region map, or as the two masks where those were made by hand. */
export interface MaterialMaps {
  base?: Picture;
  normal?: Picture;
  mro?: Picture;
  regions?: Picture;
  mask?: Picture;
  mask2?: Picture;
  /** Made into one texture, the layer. */
  hurt?: Picture;
  decay?: Picture;
}

/**
 * The mips of a material's maps from its source pictures: RGBA8, smallest first, to cut at the top each texture is
 * given and hand to an encoder. The packed map is roughened by what the normal map loses. Both masks come from the
 * one region map, and there is no `mask2` where regions 3 to 5 are empty. Masks made by hand are refused if they are
 * not one size or their weights sum past 1. The hurt and decay pictures make the layer.
 */
export function materialMips(maps: Readonly<MaterialMaps>): Partial<Record<TextureRole, Uint8Array[]>> {
  const out: Partial<Record<TextureRole, Uint8Array[]>> = {};
  const normal = maps.normal && normalMips(maps.normal);
  if (maps.base) out.base = baseMips(maps.base);
  if (normal) out.normal = normal.pictures;
  if (maps.mro) out.mro = packedMips(maps.mro, normal?.lengths);
  if (maps.regions) Object.assign(out, maskMips(readRegions(maps.regions)));
  else if (maps.mask) {
    const report = checkMasks(maps.mask, maps.mask2);
    if (report.over > 0) throw new Error(`masks: the weights of ${(report.over * 100).toFixed(2)}% of the pixels sum past 1, to as much as ${report.most.toFixed(2)}`);
    Object.assign(out, maskMips(readMasks(maps.mask, maps.mask2)));
  }
  if (maps.hurt || maps.decay) out.layer = layerMips(layerPicture(maps.hurt, maps.decay).picture);
  return out;
}

/** Whether every texel of `mips` is `role`'s neutral in the channels drawn: red and green of a normal, alpha only where it is read. */
export function isNeutral(role: TextureRole, alpha: boolean, mips: readonly Uint8Array[]): boolean {
  const want = NEUTRAL[role];
  const channels = role === "normal" ? 2 : alpha ? 4 : 3;
  for (const mip of mips) for (let p = 0; p < mip.length; p += 4) for (let c = 0; c < channels; c++) if (mip[p + c] !== want[c]) return false;
  return true;
}

/** What a map may lose where it is stored smaller: the degrees a normal turns, and the levels any other channel moves. */
export const SMALLER_TURN = 3;
export const SMALLER_MOVE = 4;

/**
 * The most any texel changes where a map is stored `k` steps smaller. A material's maps are wanted a fixed number of
 * steps apart (D153), so the map is then drawn k steps coarser at every distance: each mip from 128 pixels up is held
 * against the one k smaller, or step 0's, enlarged by bilinear filtering as a sampler enlarges it. Degrees for a
 * normal, from its red and green; levels of red, green and blue otherwise, and of alpha where it is read. Counting
 * stops once past `stop`.
 */
export function smallerBy(role: TextureRole, alpha: boolean, mips: readonly Uint8Array[], k: number, stop = Infinity): number {
  const channels = alpha ? 4 : 3;
  let worst = 0;
  for (let level = Math.log2(STEP0_SIZE) + 1; level < mips.length && worst <= stop; level++) {
    const fine = mips[level]!;
    const from = Math.max(Math.log2(STEP0_SIZE), level - k);
    const coarse = mips[from]!;
    const [side, small, grow] = [1 << level, 1 << from, 1 << (level - from)];
    // The two texels of the smaller mip each texel of a row or column lies between, and how far along.
    const near = new Int32Array(side * 2);
    const along = new Float32Array(side);
    for (let x = 0; x < side; x++) {
      const at = (x + 0.5) / grow - 0.5;
      const a = Math.floor(at);
      near[x * 2] = Math.max(0, a);
      near[x * 2 + 1] = Math.min(small - 1, a + 1);
      along[x] = at - a;
    }
    const value = (y: number, x: number, c: number): number => {
      const [y0, y1, x0, x1] = [near[y * 2]!, near[y * 2 + 1]!, near[x * 2]!, near[x * 2 + 1]!];
      const [wy, wx] = [along[y]!, along[x]!];
      return (coarse[(y0 * small + x0) * 4 + c]! * (1 - wx) + coarse[(y0 * small + x1) * 4 + c]! * wx) * (1 - wy) + (coarse[(y1 * small + x0) * 4 + c]! * (1 - wx) + coarse[(y1 * small + x1) * 4 + c]! * wx) * wy;
    };
    for (let y = 0; y < side && worst <= stop; y++) {
      for (let x = 0; x < side; x++) {
        const p = (y * side + x) * 4;
        if (role === "normal") {
          const [ax, ay, bx, by] = [(value(y, x, 0) - 128) / 127.5, (value(y, x, 1) - 128) / 127.5, (fine[p]! - 128) / 127.5, (fine[p + 1]! - 128) / 127.5];
          const [az, bz] = [Math.sqrt(Math.max(0, 1 - ax * ax - ay * ay)), Math.sqrt(Math.max(0, 1 - bx * bx - by * by))];
          const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
          worst = Math.max(worst, (Math.acos(Math.min(1, cos)) * 180) / Math.PI);
        } else for (let c = 0; c < channels; c++) worst = Math.max(worst, Math.abs(value(y, x, c) - fine[p + c]!));
      }
    }
  }
  return worst;
}

/**
 * The side a map's content needs: the smallest a whole number of steps under its top, no smaller than step 0's, that
 * changes no texel past SMALLER_TURN or SMALLER_MOVE (`smallerBy`), and how much that is.
 */
export function neededSide(role: TextureRole, alpha: boolean, mips: readonly Uint8Array[]): { side: number; change: number } {
  const limit = role === "normal" ? SMALLER_TURN : SMALLER_MOVE;
  const top = mips.length - 1;
  let [k, change] = [0, 0];
  for (; top - k - 1 >= Math.log2(STEP0_SIZE); k++) {
    const next = smallerBy(role, alpha, mips, k + 1, limit);
    if (next > limit) break;
    change = next;
  }
  return { side: 1 << (top - k), change };
}
