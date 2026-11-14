// Blocks and pictures for the block-compression tests and for tools/pack/bc-gpu.ts, which shows the same ones to a GPU.

import { Rng } from "../../shared/rng.ts";

/** `count` BC7 blocks of random bits, all in one mode. Any bits after a mode's first are a block of that mode. */
export function randomBc7(mode: number, count: number, seed: number): Uint8Array {
  const rng = new Rng(seed);
  const blocks = new Uint8Array(count * 16);
  for (let i = 0; i < blocks.length; i++) blocks[i] = rng.int(256);
  for (let at = 0; at < blocks.length; at += 16) blocks[at] = ((blocks[at]! >> (mode + 1)) << (mode + 1)) | (1 << mode);
  return blocks;
}

/** `count` BC5 blocks of random bits. Every one is a block. */
export function randomBc5(count: number, seed: number): Uint8Array {
  const rng = new Rng(seed);
  const blocks = new Uint8Array(count * 16);
  for (let i = 0; i < blocks.length; i++) blocks[i] = rng.int(256);
  return blocks;
}

/** The six colours of a mask's regions in ring order, and black. */
export const PURE: readonly (readonly number[])[] = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [0, 0, 0]];

/** The bands of the card, top to bottom. */
export const BANDS = ["ramp", "two flat colours", "edge", "noise", "one channel apart", "regions", "three stripes", "fine grain"] as const;

/**
 * A square picture in eight bands of patterns that between them bring out every mode the BC7 encoder uses. With
 * `alpha` each band has an alpha pattern too: ramps, cut-outs, noise and constants.
 */
export function card(size: number, alpha: boolean): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const rng = new Rng(11);
  // A colour for each block, so flat patterns differ from block to block.
  const tint = new Uint8Array((size >> 2) * (size >> 2) * 8);
  for (let i = 0; i < tint.length; i++) tint[i] = rng.int(256);
  const band = size >> 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const kind = Math.min(7, (y / band) | 0);
      const block = ((y >> 2) * (size >> 2) + (x >> 2)) * 8;
      const u = x & 3;
      const v = y & 3;
      let c: readonly number[];
      let a = 255;
      if (kind === 0) {
        // Sixteen colours along one line in every block.
        const s = ((x * 2 + y * 5) * 64) / size;
        c = [s, 255 - s * 0.8, 40 + s / 2];
        a = 255 - s;
      } else if (kind === 1) {
        const first = u + v * ((block >> 3) & 3) > 3;
        c = first ? [tint[block]!, tint[block + 1]!, tint[block + 2]!] : [tint[block + 3]!, tint[block + 4]!, tint[block + 5]!];
        a = first ? 255 : tint[block + 6]!;
      } else if (kind === 2) {
        c = u * 2 + v > 4 + ((block >> 3) & 3) ? [200 + rng.int(8), 60 + u * 6, 30] : [30 + v * 4, 90, 180 + rng.int(24)];
        a = u * 2 + v > 4 ? 255 : 0;
      } else if (kind === 3) {
        c = [rng.int(256), rng.int(256), rng.int(256)];
        a = rng.int(256);
      } else if (kind === 4) {
        c = [240 + rng.int(16), 100 + rng.int(80), (block >> 3) & 1 ? 0 : (x * 3 + y * 5) & 255];
        a = 128;
      } else if (kind === 5) {
        c = PURE[((x >> 3) + ((x + y) >> 4)) % 7]!;
        if ((x + 2 * y) % 23 === 0) c = PURE[6]!;
        a = c === PURE[6] ? 0 : 255;
      } else if (kind === 6) {
        const stripe = (u + ((block >> 3) % 3 === 0 ? v : 0)) % 3;
        c = [tint[block + stripe]! + u * 3, tint[block + stripe + 2]! >> 1, 128 + v * 9 + stripe * 30];
        a = stripe === 1 ? 255 : 255 - v * 30;
      } else {
        c = [120 + rng.int(6) + u, 110 + rng.int(6), 96 + rng.int(4) + v];
        a = 250 - rng.int(12);
      }
      rgba[at] = Math.min(255, c[0]! | 0);
      rgba[at + 1] = Math.min(255, c[1]! | 0);
      rgba[at + 2] = Math.min(255, c[2]! | 0);
      rgba[at + 3] = alpha ? a | 0 : 255;
    }
  }
  return rgba;
}
