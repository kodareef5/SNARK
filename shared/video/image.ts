// A header reader for what a screen's still must be: PNG, JPEG or WebP, within the caps. It reads the size from the
// header (PNG IHDR, JPEG SOF, WebP VP8, VP8L or VP8X); nothing is decoded.
import { IMAGE_MAX_BYTES, IMAGE_MAX_LONG, IMAGE_TYPES } from "./clip.ts";

export type ImageType = (typeof IMAGE_TYPES)[number];

/** What an image's header says of it. */
export interface ImageInfo {
  readonly type: ImageType;
  readonly width: number;
  readonly height: number;
}

/** The file ending each type is kept under. */
export const IMAGE_EXT: Readonly<Record<ImageType, string>> = { png: "png", jpeg: "jpg", webp: "webp" };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const NOT = "This is not a PNG, JPEG or WebP image.";

function png(b: Uint8Array, v: DataView): ImageInfo | string {
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return "This PNG has no header.";
  return { type: "png", width: v.getUint32(16), height: v.getUint32(20) };
}

/** The frame header's size, walking the markers up to the scan. Only baseline and progressive frames are taken. */
function jpeg(b: Uint8Array, v: DataView): ImageInfo | string {
  for (let at = 2; at + 4 <= b.length; ) {
    if (b[at] !== 0xff) return "This JPEG is broken.";
    const marker = b[at + 1]!;
    // Fill bytes, and markers with no length.
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return "This JPEG has no frame header before its picture.";
    const length = v.getUint16(at + 2);
    if (length < 2 || at + 2 + length > b.length) return "This JPEG is broken.";
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 7) return "This JPEG is broken.";
      return { type: "jpeg", width: v.getUint16(at + 7), height: v.getUint16(at + 5) };
    }
    if ((marker >= 0xc3 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return "This JPEG is lossless or arithmetic coded, which browsers do not show.";
    at += 2 + length;
  }
  return "This JPEG is broken.";
}

function webp(b: Uint8Array, v: DataView): ImageInfo | string {
  if (b.length < 30) return "This WebP is broken.";
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return "This WebP is broken.";
    return { type: "webp", width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return "This WebP is broken.";
    const bits = v.getUint32(21, true);
    return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    const u24 = (at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
    return { type: "webp", width: u24(24) + 1, height: u24(27) + 1 };
  }
  return "This WebP is broken.";
}

/** What `bytes` are as a screen's still, or why they may not be one. */
export function probeImage(bytes: Uint8Array): ImageInfo | string {
  if (bytes.length > IMAGE_MAX_BYTES) return `An image is ${IMAGE_MAX_BYTES / 1048576} MB at most.`;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let info: ImageInfo | string = NOT;
  if (bytes.length >= 8 && PNG.every((x, i) => bytes[i] === x)) info = png(bytes, v);
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) info = jpeg(bytes, v);
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") info = webp(bytes, v);
  if (typeof info === "string") return info;
  if (!(info.width > 0 && info.height > 0)) return "The picture has no size.";
  if (Math.max(info.width, info.height) > IMAGE_MAX_LONG) return `The picture is ${info.width}×${info.height}, over ${IMAGE_MAX_LONG} on its long side.`;
  return info;
}
