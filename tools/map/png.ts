// One-channel PNGs for map layers: 8 or 16 bits a pixel, read and written, with a palette if 8-bit pixels are indices.

import { deflateSync, inflateSync } from "node:zlib";

export interface Grey {
  readonly width: number;
  readonly height: number;
  /** A value a pixel, rows top to bottom: a Uint16Array from a 16-bit picture, else a Uint8Array. */
  readonly data: Uint8Array | Uint16Array;
}

/** Throws unless the file is a greyscale or indexed PNG of 8 bits, or a greyscale one of 16, without interlacing. */
export function readGrey(file: Uint8Array, name: string): Grey {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 33 || view.getUint32(0) !== 0x89504e47) throw new Error(`${name}: not a PNG file`);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = file[24]!;
  const type = file[25]!;
  if (!((type === 0 && (depth === 8 || depth === 16)) || (type === 3 && depth === 8)) || file[28] !== 0) {
    throw new Error(`${name}: a layer is one channel: greyscale of 8 or 16 bits, or indexed of 8, without interlacing (this one: depth ${depth}, colour type ${type}, interlace ${file[28]})`);
  }
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= file.length; at += 12 + view.getUint32(at)) {
    const tag = String.fromCharCode(file[at + 4]!, file[at + 5]!, file[at + 6]!, file[at + 7]!);
    if (tag === "IDAT") parts.push(file.subarray(at + 8, at + 8 + view.getUint32(at)));
    if (tag === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const bytes = depth >> 3;
  const stride = width * bytes;
  if (raw.length !== (stride + 1) * height) throw new Error(`${name}: its pixels are ${raw.length} bytes, and ${width} by ${height} takes ${(stride + 1) * height}`);
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytes ? rows[dst + x - bytes]! : 0;
      const b = y > 0 ? rows[dst + x - stride]! : 0;
      const c = x >= bytes && y > 0 ? rows[dst + x - stride - bytes]! : 0;
      let predict = 0;
      if (filter === 1) predict = a;
      else if (filter === 2) predict = b;
      else if (filter === 3) predict = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[dst + x] = raw[src + x]! + predict;
    }
  }
  if (depth === 8) return { width, height, data: rows };
  // A PNG holds 16 bits high byte first.
  return { width, height, data: Uint16Array.from({ length: width * height }, (_, i) => (rows[i * 2]! << 8) | rows[i * 2 + 1]!) };
}

function chunk(tag: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Greyscale, or with `palette` (256 colours, four bytes each) indexed, so that 8-bit indices show in their colours. */
export function writeGrey(width: number, height: number, data: Uint8Array | Uint16Array, palette?: Uint8Array): Uint8Array {
  const bytes = data.BYTES_PER_ELEMENT;
  const raw = new Uint8Array(height * (1 + width * bytes));
  for (let i = 0, at = 0; i < width * height; i++) {
    if (i % width === 0) at++;
    if (bytes === 2) raw[at++] = data[i]! >> 8;
    raw[at++] = data[i]!;
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([bytes * 8, palette ? 3 : 0, 0, 0, 0], 8);
  const colours = palette ? [chunk("PLTE", Uint8Array.from({ length: 768 }, (_, i) => palette[Math.floor(i / 3) * 4 + (i % 3)]!))] : [];
  return new Uint8Array(Buffer.concat([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...colours, chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
}
