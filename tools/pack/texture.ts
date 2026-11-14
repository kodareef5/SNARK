// Writes a texture file: one variant of every texture, each stored smallest picture first, as shared/pack/texture.ts
// lays it out. The pictures come already encoded for the variant, so a block encoder only has to supply them. The
// rgba variant needs no encoder and is made here.

import { RGBA_TOP, TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, TEXTURE_MAGIC, TEXTURE_VERSION, pictureBytes, stepBytes, stepOf, stepOffset, textureBytes, topIn, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import { baseMips, normalMips, packedMips, type Picture } from "./image.ts";
import { partHash } from "./manifest.ts";
import { checkMask, maskMips } from "./mask.ts";

export interface EncodedTexture {
  role: TextureRole;
  /** One picture for every side from 1 pixel up to the top, each in the variant's encoding. */
  pictures: readonly Uint8Array[];
}

/** Where a texture starts in its file, and the hash of each of its steps: what the manifest lists under the variant, with the file. */
export interface PlacedTexture {
  at: number;
  hash: string[];
}

/** Where the picture `size` pixels across starts in its texture. */
export function pictureOffset(format: TextureFormat, role: TextureRole, size: number): number {
  let at = 0;
  for (let s = 1; s < size; s <<= 1) at += pictureBytes(format, role, s);
  return at;
}

/** Throws if a texture has a top its variant does not hold, or a picture that is not the size the layout gives it. */
export function writeTextureFile(format: TextureFormat, textures: readonly EncodedTexture[]): { bytes: Uint8Array; placed: PlacedTexture[] } {
  const tops = textures.map((t, i) => {
    const top = 1 << (t.pictures.length - 1);
    if (stepOf(top) < 0 || topIn(format, top) !== top) throw new Error(`texture file: texture ${i} is ${top} pixels across, which ${format} does not hold`);
    t.pictures.forEach((p, k) => {
      if (p.length !== pictureBytes(format, t.role, 1 << k)) throw new Error(`texture file: the ${1 << k}-pixel picture of texture ${i} is ${p.length} bytes, not ${pictureBytes(format, t.role, 1 << k)}`);
    });
    return top;
  });
  const bytes = new Uint8Array(tops.reduce((sum, top, i) => sum + textureBytes(format, textures[i]!.role, top), TEXTURE_HEADER_BYTES));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, TEXTURE_MAGIC, true);
  view.setUint16(4, TEXTURE_VERSION, true);
  view.setUint16(6, TEXTURE_FORMATS.indexOf(format), true);
  view.setUint32(8, textures.length, true);
  let at = TEXTURE_HEADER_BYTES;
  const placed = textures.map((t, i): PlacedTexture => {
    const start = at;
    for (const p of t.pictures) {
      bytes.set(p, at);
      at += p.length;
    }
    const hash: string[] = [];
    for (let s = 0; s <= stepOf(tops[i]!); s++) {
      const from = start + stepOffset(format, t.role, s);
      hash.push(partHash(bytes.subarray(from, from + stepBytes(format, t.role, s))));
    }
    return { at: start, hash };
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
  return { role, pictures: mips.slice(0, Math.log2(RGBA_TOP) + 1).map((m) => rgbaPicture(role, m)) };
}

/**
 * The mips of a material's maps from its source pictures: RGBA8, smallest first, to cut at the top each texture is
 * given and hand to an encoder. The packed map is roughened by what the normal map loses, and a mask that breaks the
 * ring rule is refused. `wraps` is for a material that tiles.
 */
export function materialMips(maps: Readonly<Partial<Record<TextureRole, Picture>>>, wraps = false): Partial<Record<TextureRole, Uint8Array[]>> {
  const out: Partial<Record<TextureRole, Uint8Array[]>> = {};
  const normal = maps.normal && normalMips(maps.normal);
  if (maps.base) out.base = baseMips(maps.base);
  if (normal) out.normal = normal.pictures;
  if (maps.mro) out.mro = packedMips(maps.mro, normal?.lengths);
  if (maps.mask) {
    const report = checkMask(maps.mask, wraps);
    if (report.faults > 0) throw new Error(`mask: regions that are not neighbours on the ring touch with no black between: ${report.where.join("; ")}`);
    out.mask = maskMips(maps.mask, wraps);
  }
  return out;
}
