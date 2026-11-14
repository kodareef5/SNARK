// The picture a body's colours are sampled from: an 8-bit RGB or RGBA PNG, which is what the packs in assets/raw use.
// image.ts reads the file.

import { readPicture } from "./image.ts";

export interface Image {
  readonly width: number;
  readonly height: number;
  /** 3 or 4 bytes a pixel, rows top to bottom. */
  readonly channels: number;
  readonly data: Uint8Array;
}

export function readPng(path: string): Image {
  const { width, height, channels, depth, data } = readPicture(path);
  if (depth !== 8 || channels < 3) throw new Error(`${path}: a body's colours are sampled from an 8-bit RGB or RGBA PNG (this one: ${depth} bits, ${channels} channels)`);
  return { width, height, channels, data: data as Uint8Array };
}

/** Mean colour of the square of side `2 * reach + 1` pixels around texture coordinate (u, v), which wraps. */
export function sampleImage(img: Image, u: number, v: number, reach: number, out: number[]): void {
  const cx = Math.floor((u - Math.floor(u)) * img.width);
  const cy = Math.floor((v - Math.floor(v)) * img.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = (cx + dx + img.width) % img.width;
      const y = (cy + dy + img.height) % img.height;
      const at = (y * img.width + x) * img.channels;
      r += img.data[at]!;
      g += img.data[at + 1]!;
      b += img.data[at + 2]!;
      n++;
    }
  }
  out[0] = r / n;
  out[1] = g / n;
  out[2] = b / n;
}
