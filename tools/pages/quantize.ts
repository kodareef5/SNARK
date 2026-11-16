// A picture in 256 colours, for a PNG of indices a third or a quarter the size of its colours: median cut over its
// colours at five bits a channel, and its coverage at two bits where it has clear pixels.

import { deflateSync } from "node:zlib";

const chunk = (tag: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/** An indexed PNG of the RGBA picture: a fully clear pixel is index 0, which is clear. */
export function indexedPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const n = width * height;
  // Five bits of each colour and two of coverage; a clear pixel has a key of its own.
  const CLEAR = 1 << 17;
  const keys = new Uint32Array(n);
  for (let p = 0; p < n; p++) {
    const at = p * 4;
    keys[p] = rgba[at + 3] === 0 ? CLEAR : ((rgba[at + 3]! >> 6) << 15) | ((rgba[at]! >> 3) << 10) | ((rgba[at + 1]! >> 3) << 5) | (rgba[at + 2]! >> 3);
  }
  const count = new Uint32Array(CLEAR + 1);
  for (const k of keys) count[k]!++;
  const clear = count[CLEAR]! > 0;
  const channel = (k: number, c: number): number => (c === 3 ? (k >> 15) & 3 : (k >> (10 - 5 * c)) & 31) * (c === 3 ? 8 : 1);
  let boxes: number[][] = [[...count.keys()].filter((k) => k !== CLEAR && count[k]! > 0)];
  while (boxes.length < (clear ? 255 : 256)) {
    // Split the box whose widest channel is widest, at its median by pixels.
    let [best, widest, along] = [-1, 0, 0];
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 4; c++) {
        let [lo, hi] = [Infinity, -Infinity];
        for (const k of b) [lo, hi] = [Math.min(lo, channel(k, c)), Math.max(hi, channel(k, c))];
        if (hi - lo > widest) [widest, best, along] = [hi - lo, i, c];
      }
    });
    if (best < 0) break;
    const b = boxes[best]!.sort((p, q) => channel(p, along) - channel(q, along));
    const half = b.reduce((s, k) => s + count[k]!, 0) / 2;
    let split = 1;
    for (let seen = count[b[0]!]!; split < b.length - 1 && seen + count[b[split]!]! <= half; split++) seen += count[b[split]!]!;
    boxes = [...boxes.slice(0, best), b.slice(0, split), b.slice(split), ...boxes.slice(best + 1)];
  }
  const first = clear ? 1 : 0;
  const colours = boxes.length + first;
  const palette = new Uint8Array(colours * 3);
  const alpha = new Uint8Array(colours);
  const index = new Map<number, number>();
  // A box's colour is the mean of the pixels in it, taken from the picture, not from the keys.
  const sums = new Float64Array(colours * 5);
  boxes.forEach((b, i) => b.forEach((k) => index.set(k, i + first)));
  if (clear) index.set(CLEAR, 0);
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = (out[p] = index.get(keys[p]!)!);
    for (let c = 0; c < 4; c++) sums[i * 5 + c]! += rgba[p * 4 + c]!;
    sums[i * 5 + 4]!++;
  }
  for (let i = first; i < colours; i++) {
    for (let c = 0; c < 3; c++) palette[i * 3 + c] = Math.round(sums[i * 5 + c]! / sums[i * 5 + 4]!);
    alpha[i] = Math.round(sums[i * 5 + 3]! / sums[i * 5 + 4]!);
  }
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) raw.set(out.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8);
  const seeThrough = alpha.some((a) => a < 255) ? [chunk("tRNS", alpha.subarray(0, alpha.findLastIndex((a) => a < 255) + 1))] : [];
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", header), chunk("PLTE", palette), ...seeThrough, chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  parts.reduce((at, x) => (png.set(x, at), at + x.length), 0);
  return png;
}
