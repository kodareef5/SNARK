// Minimal PNG reader for source textures: 8 bits a channel, RGB or RGBA, not
// interlaced, which is what the packs in assets/raw use. Anything else is an
// error that says what the file is.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface Image {
  readonly width: number;
  readonly height: number;
  /** 3 or 4 bytes a pixel, rows top to bottom. */
  readonly channels: number;
  readonly data: Uint8Array;
}

export function readPng(path: string): Image {
  const file = new Uint8Array(readFileSync(path));
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 33 || view.getUint32(0) !== 0x89504e47) throw new Error(`${path}: not a PNG file`);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = file[24]!;
  const type = file[25]!;
  const interlace = file[28]!;
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) throw new Error(`${path}: only 8-bit RGB or RGBA PNGs without interlacing are read (this one: depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const channels = type === 2 ? 3 : 4;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= file.length; ) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(file[at + 4]!, file[at + 5]!, file[at + 6]!, file[at + 7]!);
    if (name === "IDAT") parts.push(file.subarray(at + 8, at + 8 + length));
    if (name === "IEND") break;
    at += 12 + length;
  }
  let size = 0;
  for (const p of parts) size += p.length;
  const packed = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    packed.set(p, o);
    o += p.length;
  }
  const raw = inflateSync(packed);
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new Error(`${path}: image data is ${raw.length} bytes, expected ${(stride + 1) * height}`);
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[dst + x - channels]! : 0;
      const b = y > 0 ? data[dst + x - stride]! : 0;
      const c = x >= channels && y > 0 ? data[dst + x - stride - channels]! : 0;
      let predict = 0;
      if (filter === 1) predict = a;
      else if (filter === 2) predict = b;
      else if (filter === 3) predict = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[dst + x] = (raw[src + x]! + predict) & 255;
    }
  }
  return { width, height, channels, data };
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
