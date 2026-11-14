// Pictures for the texture pipeline: PNG in and out, a resize for a source that is not a power of two across, the mips
// of each kind of map, and the measures the asset check prints.
//
// Mips are RGBA8 pictures, smallest first: picture i is 1 << i pixels across, which is the order a texture file keeps.

import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

/** A picture as a PNG holds it: rows top to bottom, `channels` samples a pixel, each 0 to 255 or 0 to 65535. */
export interface Picture {
  width: number;
  height: number;
  /** 1 grey, 2 grey and alpha, 3 RGB, 4 RGBA. */
  channels: number;
  depth: 8 | 16;
  data: Uint8Array | Uint16Array;
}

/** Channels by PNG colour type, and colour type by channels. A palette (type 3) is not read. */
const CHANNELS: readonly number[] = [1, 0, 3, 0, 2, 0, 4];
const COLOUR_TYPE: readonly number[] = [0, 0, 4, 2, 6];

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Throws with a reason if the file is not a PNG of a kind that is read: 8 or 16 bits a channel, no palette, no interlacing. */
export function decodePng(file: Uint8Array, name = "picture"): Picture {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 33 || view.getUint32(0) !== 0x89504e47) throw new Error(`${name}: not a PNG file`);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = file[24]!;
  const type = file[25]!;
  const interlace = file[28]!;
  const channels = CHANNELS[type] ?? 0;
  if ((depth !== 8 && depth !== 16) || channels === 0 || interlace !== 0) throw new Error(`${name}: only grey, RGB and RGBA PNGs of 8 or 16 bits without interlacing are read (this one: depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 12 <= file.length; ) {
    const length = view.getUint32(at);
    const chunk = view.getUint32(at + 4);
    if (chunk === 0x49444154) parts.push(file.subarray(at + 8, at + 8 + length)); // IDAT
    if (chunk === 0x49454e44) break; // IEND
    at += 12 + length;
  }
  const raw = inflateSync(join(parts));
  // A filter predicts a byte from the same byte of the pixel to the left, the one above, and the one above left.
  const pixel = (channels * depth) >> 3;
  const stride = width * pixel;
  if (raw.length !== (stride + 1) * height) throw new Error(`${name}: image data is ${raw.length} bytes, expected ${(stride + 1) * height}`);
  const bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= pixel ? bytes[dst + x - pixel]! : 0;
      const b = y > 0 ? bytes[dst + x - stride]! : 0;
      const c = x >= pixel && y > 0 ? bytes[dst + x - stride - pixel]! : 0;
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
      bytes[dst + x] = (raw[src + x]! + predict) & 255;
    }
  }
  if (depth === 8) return { width, height, channels, depth, data: bytes };
  const data = new Uint16Array(width * height * channels);
  for (let i = 0; i < data.length; i++) data[i] = (bytes[i * 2]! << 8) | bytes[i * 2 + 1]!;
  return { width, height, channels, depth, data };
}

export function readPicture(path: string): Picture {
  return decodePng(new Uint8Array(readFileSync(path)), path);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]!) & 0xff]! ^ (c >>> 8);
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

/** The picture as a PNG file, unfiltered. */
export function encodePng(p: Picture): Uint8Array {
  const stride = (p.width * p.channels * p.depth) >> 3;
  const raw = new Uint8Array((stride + 1) * p.height);
  for (let y = 0; y < p.height; y++) {
    const to = y * (stride + 1) + 1;
    if (p.depth === 8) raw.set(p.data.subarray(y * stride, (y + 1) * stride), to);
    else {
      for (let x = 0; x < stride; x += 2) {
        const v = p.data[(y * stride + x) >> 1]!;
        raw[to + x] = v >> 8;
        raw[to + x + 1] = v & 255;
      }
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, p.width);
  view.setUint32(4, p.height);
  header.set([p.depth, COLOUR_TYPE[p.channels]!], 8);
  return join([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))]);
}

/** A mip as a picture again, to measure it or write it as a PNG. */
export function asPicture(mip: Uint8Array): Picture {
  const size = Math.sqrt(mip.length / 4);
  return { width: size, height: size, channels: 4, depth: 8, data: mip };
}

const toLinear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const toSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/**
 * The picture as red, green, blue and alpha, each 0 to 1. Grey is spread over the three colours and a missing alpha
 * is 1. `colour` is applied to the colours and not to alpha.
 */
export function unpack(p: Picture, colour: (v: number) => number = (v) => v): Float32Array {
  const max = p.depth === 8 ? 255 : 65535;
  const curve = new Float32Array(max + 1);
  for (let i = 0; i <= max; i++) curve[i] = colour(i / max);
  const c = p.channels;
  const green = c < 3 ? 0 : 1;
  const blue = c < 3 ? 0 : 2;
  const alpha = c === 2 ? 1 : c === 4 ? 3 : -1;
  const out = new Float32Array(p.width * p.height * 4);
  for (let i = 0, at = 0; i < out.length; i += 4, at += c) {
    out[i] = curve[p.data[at]!]!;
    out[i + 1] = curve[p.data[at + green]!]!;
    out[i + 2] = curve[p.data[at + blue]!]!;
    out[i + 3] = alpha < 0 ? 1 : p.data[at + alpha]! / max;
  }
  return out;
}

/**
 * A square of `from` pixels a side as one of `to`. Each new pixel is a mean of the old ones around it, weighted by a
 * tent as wide as the wider of the two spacings, so shrinking averages and enlarging interpolates.
 */
function resize(src: Float32Array, from: number, to: number, channels: number): Float32Array {
  // One axis at a time. `at` gives where sample k of a line is when the line has n samples.
  const axis = (data: Float32Array, lines: number, at: (line: number, k: number, n: number) => number): Float32Array => {
    const out = new Float32Array(lines * to * channels);
    const reach = Math.max(1, from / to);
    for (let i = 0; i < to; i++) {
      const centre = ((i + 0.5) * from) / to - 0.5;
      const first = Math.ceil(centre - reach);
      const last = Math.floor(centre + reach);
      let sum = 0;
      for (let j = first; j <= last; j++) sum += 1 - Math.abs(j - centre) / reach;
      for (let j = first; j <= last; j++) {
        const weight = (1 - Math.abs(j - centre) / reach) / sum;
        const k = Math.min(from - 1, Math.max(0, j));
        for (let line = 0; line < lines; line++) {
          const a = at(line, k, from);
          const b = at(line, i, to);
          for (let c = 0; c < channels; c++) out[b + c]! += data[a + c]! * weight;
        }
      }
    }
    return out;
  };
  const across = axis(src, from, (line, k, n) => (line * n + k) * channels);
  return axis(across, to, (line, k) => (k * to + line) * channels);
}

/** The pixels of `p` as a square with a power of two for a side: as they are when it is one, resized to the nearest when not. */
export function square(data: Float32Array, p: { width: number; height: number }, channels: number): { data: Float32Array; size: number } {
  if (p.width !== p.height) throw new Error(`a texture is square, and this picture is ${p.width} by ${p.height}`);
  const size = 2 ** Math.round(Math.log2(p.width));
  return { size, data: size === p.width ? data : resize(data, p.width, size, channels) };
}

/** `top`, which is `size` pixels across, and every halving of it down to one pixel, smallest first. A pixel is the mean of the four under it. */
export function halvings(top: Float32Array, size: number, channels: number): Float32Array[] {
  const out = [top];
  for (let n = size >> 1; n >= 1; n >>= 1) {
    const from = out[0]!;
    const to = new Float32Array(n * n * channels);
    const right = channels;
    const down = n * 2 * channels;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = (y * 2 * n * 2 + x * 2) * channels;
        const b = (y * n + x) * channels;
        for (let c = 0; c < channels; c++) to[b + c] = (from[a + c]! + from[a + right + c]! + from[a + down + c]! + from[a + down + right + c]!) / 4;
      }
    }
    out.unshift(to);
  }
  return out;
}

/** The mips of a base colour map. Colours are averaged as light, which is what a far surface sends the eye, and alpha as it is. */
export function baseMips(p: Picture): Uint8Array[] {
  const { data, size } = square(unpack(p, toLinear), p, 4);
  return halvings(data, size, 4).map((level) => {
    const out = new Uint8Array(level.length);
    for (let i = 0; i < level.length; i++) out[i] = ((i & 3) === 3 ? level[i]! : toSrgb(level[i]!)) * 255 + 0.5;
    return out;
  });
}

/**
 * The mips of a normal map (x in red, y in green, z in blue), and how long the mean normal under each pixel of each
 * is. Normals are averaged as vectors and stored at full length again. Where they disagree the mean is short, and
 * packedMips turns what was lost into roughness.
 */
export function normalMips(p: Picture): { pictures: Uint8Array[]; lengths: Float32Array[] } {
  const rgba = unpack(p, (v) => v * 2 - 1);
  const unit = new Float32Array((rgba.length / 4) * 3);
  for (let i = 0, at = 0; i < rgba.length; i += 4, at += 3) {
    const l = Math.hypot(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) || 1;
    unit[at] = rgba[i]! / l;
    unit[at + 1] = rgba[i + 1]! / l;
    unit[at + 2] = rgba[i + 2]! / l;
  }
  const { data, size } = square(unit, p, 3);
  const pictures: Uint8Array[] = [];
  const lengths: Float32Array[] = [];
  for (const level of halvings(data, size, 3)) {
    const picture = new Uint8Array((level.length / 3) * 4).fill(255);
    const length = new Float32Array(level.length / 3);
    for (let i = 0, at = 0; i < length.length; i++, at += 3) {
      const l = Math.hypot(level[at]!, level[at + 1]!, level[at + 2]!);
      length[i] = Math.min(1, l);
      // Normals that cancel leave nothing to point with, so the pixel points straight out.
      picture[i * 4] = (l > 1e-6 ? level[at]! / l : 0) * 127.5 + 128;
      picture[i * 4 + 1] = (l > 1e-6 ? level[at + 1]! / l : 0) * 127.5 + 128;
      picture[i * 4 + 2] = (l > 1e-6 ? level[at + 2]! / l : 1) * 127.5 + 128;
    }
    pictures.push(picture);
    lengths.push(length);
  }
  return { pictures, lengths };
}

/**
 * The roughness of a surface whose normals, averaged over a pixel, are `length` long. This is Toksvig's estimate: the
 * normals vary by (1 - length) / length, and a highlight of power s seen through that variance has the power
 * s / (1 + s * variance). A roughness r is a GGX width of r * r, which is the power 2 / r^4 - 2.
 */
export function roughened(roughness: number, length: number): number {
  const variance = (1 - length) / Math.max(length, 1e-4);
  const width = roughness ** 4;
  const more = 2 * variance * (1 - width);
  return ((width + more) / (1 + more)) ** 0.25;
}

/**
 * The mips of a packed map (occlusion in red, roughness in green, metalness in blue), averaged as they are. Given the
 * `lengths` of its normal map's mips, each roughness is raised by what the normals of the mip of the same size lost,
 * so a bumpy surface seen from far is rough and does not sparkle.
 */
export function packedMips(p: Picture, lengths: readonly Float32Array[] = []): Uint8Array[] {
  const { data, size } = square(unpack(p), p, 4);
  return halvings(data, size, 4).map((level, i) => {
    const length = lengths[i];
    const out = new Uint8Array(level.length);
    for (let k = 0; k < level.length; k++) out[k] = (length && (k & 3) === 1 ? roughened(level[k]!, length[k >> 2]!) : level[k]!) * 255 + 0.5;
    return out;
  });
}

/** A packed map from grey layers of one size. Without a metalness layer nothing is metal. */
export function packMro(occlusion: Picture, roughness: Picture, metal?: Picture): Picture {
  const layers = [occlusion, roughness, metal];
  const data = new Uint8Array(occlusion.width * occlusion.height * 3);
  layers.forEach((layer, c) => {
    if (!layer) return;
    if (layer.width !== occlusion.width || layer.height !== occlusion.height) throw new Error("the layers of a packed map are not one size");
    const shift = layer.depth - 8;
    for (let i = 0; i < data.length / 3; i++) data[i * 3 + c] = layer.data[i * layer.channels]! >> shift;
  });
  return { width: occlusion.width, height: occlusion.height, channels: 3, depth: 8, data };
}

/** The layers that are not the size of the first, each as "name 512x512". None when the set agrees. */
export function oddSizes(layers: Readonly<Record<string, Picture>>): string[] {
  const first = Object.values(layers)[0];
  return Object.entries(layers).filter(([, p]) => p.width !== first!.width || p.height !== first!.height).map(([name, p]) => `${name} ${p.width}x${p.height}`);
}

/**
 * How hard a picture jumps across its wrap edge, against the jump between neighbours inside it, across and down.
 * About 1 for a picture that tiles. A seam shows as several times that.
 */
export function seam(p: Picture): [number, number] {
  const { width, height, channels, data } = p;
  const row = width * channels;
  let innerX = 0;
  let innerY = 0;
  let edgeX = 0;
  let edgeY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < row; x++) {
      const v = data[y * row + x]!;
      if (x + channels < row) innerX += Math.abs(v - data[y * row + x + channels]!);
      else edgeX += Math.abs(v - data[y * row + x + channels - row]!);
      if (y + 1 < height) innerY += Math.abs(v - data[(y + 1) * row + x]!);
      else edgeY += Math.abs(v - data[x]!);
    }
  }
  return [(edgeX * (width - 1)) / Math.max(innerX, 1e-9), (edgeY * (height - 1)) / Math.max(innerY, 1e-9)];
}

/**
 * How a normal map follows a height map of the same size. `x` and `y` are how well the lean of the normals matches
 * the slope of the height across and down the image, 1 for exactly. A negative `y` is a map whose green points down
 * the image: the other convention, which lights upside down here. `length` is the mean length of the normals as
 * stored and `off` the furthest any is from 1.
 */
export function normalAgainstHeight(normal: Picture, height: Picture): { x: number; y: number; length: number; off: number } {
  const { width, height: rows } = normal;
  if (height.width !== width || height.height !== rows || normal.channels < 3) throw new Error("a normal map is measured against a height of its own size");
  const n = unpack(normal, (v) => v * 2 - 1);
  const h = (x: number, y: number): number => height.data[(((y + rows) % rows) * width + ((x + width) % width)) * height.channels]!;
  // Sums for two correlations: of a, of b, of a * b, of a * a, of b * b.
  const sums = [new Float64Array(5), new Float64Array(5)];
  const add = (s: Float64Array, a: number, b: number): void => {
    s[0]! += a;
    s[1]! += b;
    s[2]! += a * b;
    s[3]! += a * a;
    s[4]! += b * b;
  };
  let length = 0;
  let off = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const l = Math.hypot(n[at]!, n[at + 1]!, n[at + 2]!);
      length += l;
      off = Math.max(off, Math.abs(l - 1));
      // A surface that rises to the right leans its normal left. One that rises down the image leans it up, which is +y.
      const z = Math.max(n[at + 2]!, 0.05);
      add(sums[0]!, -n[at]! / z, h(x + 1, y) - h(x - 1, y));
      add(sums[1]!, n[at + 1]! / z, h(x, y + 1) - h(x, y - 1));
    }
  }
  const count = width * rows;
  const [x, y] = sums.map((s) => {
    const spread = Math.sqrt((s[3]! - (s[0]! * s[0]!) / count) * (s[4]! - (s[1]! * s[1]!) / count));
    return spread > 0 ? (s[2]! - (s[0]! * s[1]!) / count) / spread : 0;
  });
  return { x: x!, y: y!, length: length / count, off };
}

/**
 * Decibels between two sets of mips of one map, made from a large source and a small one, at the small one's size:
 * how well the large picture, shrunk, is the small one. Colours only. 99 when they are equal.
 */
export function shrunkAgainst(large: readonly Uint8Array[], small: readonly Uint8Array[]): number {
  const a = large[small.length - 1]!;
  const b = small[small.length - 1]!;
  let sum = 0;
  for (let i = 0; i < b.length; i++) if ((i & 3) !== 3) sum += (a[i]! - b[i]!) ** 2;
  return sum === 0 ? 99 : 10 * Math.log10((255 * 255 * b.length * 0.75) / sum);
}
