// How a texture is laid out in a texture file, so that a client can fetch as far into it as it wants.
//
// A texture is square, a power of two from 64 to 4096 on a side, and is stored smallest first: the picture one pixel
// across, then 2, 4, and so on up to its top size. The pictures up to 64 make step 0; each larger one is a step of its
// own. Steps 0 to k are therefore a prefix of the texture's bytes, and with them a client has the whole texture at
// 64 << k pixels. The manifest gives where a texture starts and one hash per step; the sizes come from here.
//
// A texture file holds one variant of every texture:
//
//   0   "SNTX"
//   4   u16 version, u16 format (index into TEXTURE_FORMATS)
//   8   u32 textures, u32 reserved
//   16  the textures, one after another
//
//   variant   base            normal                        mro, mask
//   bc        BC7, sRGB       BC5 (x in red, y in green)    BC7
//   astc      ASTC 4x4, sRGB  ASTC 4x4 (x in rgb, y alpha)  ASTC 4x4
//   rgba      RGBA8, sRGB     RG8                           RGBA8
//
// The rgba variant is what every device can show and what the software rasterizer reads. It stops at 1024.

export const TEXTURE_MAGIC = 0x58544e53; // "SNTX" little-endian
export const TEXTURE_VERSION = 1;
export const TEXTURE_HEADER_BYTES = 16;

export type TextureFormat = "bc" | "astc" | "rgba";
export const TEXTURE_FORMATS: readonly TextureFormat[] = ["bc", "astc", "rgba"];

/** `mro` packs ambient occlusion in red, roughness in green and metalness in blue. `mask` marks the colour regions. */
export type TextureRole = "base" | "normal" | "mro" | "mask";
export const TEXTURE_ROLES: readonly TextureRole[] = ["base", "normal", "mro", "mask"];

/** The side of step 0, and the last step there is: 64 << 6 is 4096. */
export const STEP0_SIZE = 64;
export const LAST_STEP = 6;
/** The largest side the rgba variant holds. */
export const RGBA_TOP = 1024;

/** The side, in pixels, of a texture that has steps 0 to `step`. */
export function stepSize(step: number): number {
  return STEP0_SIZE << step;
}

/** The step whose side is `size`, or -1 if `size` is not one a texture can have. */
export function stepOf(size: number): number {
  for (let s = 0; s <= LAST_STEP; s++) if (stepSize(s) === size) return s;
  return -1;
}

/** The top side a texture authored at `top` has in a variant. */
export function topIn(format: TextureFormat, top: number): number {
  return format === "rgba" && top > RGBA_TOP ? RGBA_TOP : top;
}

/** Bytes of one picture `size` pixels across. Block formats hold 4 x 4 pixels in 16 bytes, and nothing is less than a block. */
export function pictureBytes(format: TextureFormat, role: TextureRole, size: number): number {
  if (format === "rgba") return size * size * (role === "normal" ? 2 : 4);
  const blocks = (size + 3) >> 2;
  return blocks * blocks * 16;
}

/** Bytes of a step. Step 0 holds the pictures 1, 2, 4 .. 64 across, in that order. */
export function stepBytes(format: TextureFormat, role: TextureRole, step: number): number {
  if (step > 0) return pictureBytes(format, role, stepSize(step));
  let bytes = 0;
  for (let size = 1; size <= STEP0_SIZE; size <<= 1) bytes += pictureBytes(format, role, size);
  return bytes;
}

/** Where a step starts, from the start of its texture. */
export function stepOffset(format: TextureFormat, role: TextureRole, step: number): number {
  let at = 0;
  for (let s = 0; s < step; s++) at += stepBytes(format, role, s);
  return at;
}

/** Bytes of a whole texture whose top side is `top`. */
export function textureBytes(format: TextureFormat, role: TextureRole, top: number): number {
  return stepOffset(format, role, stepOf(top) + 1);
}
