// The colour-region mask. Six pure colours mark the six regions, and black marks what is never dyed. A filtered pixel
// between two regions is a mix of their colours, and the shader reads any pixel as one primary colour and one
// secondary. That is the true mix only when the two regions are neighbours on the ring red, yellow, green, cyan, blue,
// magenta: red beside green filters to yellow, a third region. So regions that are not neighbours need black between
// them, in the mask as it is painted and in every mip made from it.

import { halvings, square, unpack, type Picture } from "./image.ts";

/** The regions in ring order. Each is a neighbour of the one before and the one after, and magenta of red. */
export const MASK_RING: readonly string[] = ["red", "yellow", "green", "cyan", "blue", "magenta"];

/** How far a channel may be from 0 or 1 and still count as it, as measure.py had it: 8 in 255. */
const NEAR = 8.5 / 255;

/** By set of regions, one bit each: whether the set is nothing, one region, or two that are neighbours. */
const FITS = new Uint8Array(64);
FITS[0] = 1;
for (let k = 0; k < 6; k++) FITS[1 << k] = FITS[(1 << k) | (1 << ((k + 1) % 6))] = 1;

/**
 * Six numbers a pixel: how much of it each region has, in ring order. The primary colour has what the largest channel
 * has over the middle one, and the secondary what the middle has over the smallest. What all three share is white,
 * which is no region.
 */
function regions(rgba: Float32Array): Float32Array {
  const out = new Float32Array((rgba.length / 4) * 6);
  for (let i = 0, at = 0; i < rgba.length; i += 4, at += 6) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const mid = Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));
    out[at + (r === hi ? 0 : g === hi ? 2 : 4)] = hi - mid;
    out[at + (b === lo ? 1 : r === lo ? 3 : 5)] = mid - lo;
  }
  return out;
}

export interface MaskReport {
  /** The share of pixels that are not black or one of the six colours, 0 to 1. */
  impure: number;
  /** The share of the mask each region covers, in ring order. Black has the rest. */
  cover: number[];
  /** How many squares of four pixels hold regions that are not neighbours. A mask with any draws a third region between them. */
  faults: number;
  /** For each two regions that touch and may not: how often, and the first place, as "red touches green in 12 places, first at 31, 0". */
  where: string[];
}

/** Measures a mask. `wraps` is for one that tiles, whose opposite edges touch. */
export function checkMask(p: Picture, wraps = false): MaskReport {
  const { width, height } = p;
  const rgba = unpack(p);
  const share = regions(rgba);
  const held = new Uint8Array(width * height);
  const cover = [0, 0, 0, 0, 0, 0];
  const between = (v: number): boolean => v > NEAR && v < 1 - NEAR;
  let impure = 0;
  for (let i = 0; i < held.length; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    if (between(r) || between(g) || between(b) || Math.min(r, g, b) >= 1 - NEAR) impure++;
    for (let k = 0; k < 6; k++) {
      cover[k]! += share[i * 6 + k]! / held.length;
      if (share[i * 6 + k]! > NEAR) held[i]! |= 1 << k;
    }
  }
  /** By pair of regions, a * 6 + b: how many squares hold both, and the first. */
  const count = new Int32Array(36);
  const first: string[] = [];
  let faults = 0;
  for (let y = 0; y < (wraps ? height : height - 1); y++) {
    for (let x = 0; x < (wraps ? width : width - 1); x++) {
      const x1 = (x + 1) % width;
      const y1 = (y + 1) % height;
      const set = held[y * width + x]! | held[y * width + x1]! | held[y1 * width + x]! | held[y1 * width + x1]!;
      if (FITS[set]) continue;
      faults++;
      for (let a = 0; a < 6; a++) {
        for (let b = a + 2; b < 6 && b < a + 5; b++) if (set & (1 << a) && set & (1 << b) && count[a * 6 + b]!++ === 0) first[a * 6 + b] = `${x}, ${y}`;
      }
    }
  }
  const where: string[] = [];
  count.forEach((n, pair) => {
    if (n > 0) where.push(`${MASK_RING[(pair / 6) | 0]} touches ${MASK_RING[pair % 6]} in ${n} places, first at ${first[pair]}`);
  });
  return { impure: impure / held.length, cover, faults, where };
}

/** Leaves, in every square of four pixels, only the pair of neighbouring regions that covers most of it. */
function settle(share: Float32Array, size: number, wraps: boolean): void {
  const sum = new Float32Array(6);
  for (let y = 0; y < size; y++) {
    const y1 = y + 1 < size ? y + 1 : wraps ? 0 : y;
    for (let x = 0; x < size; x++) {
      const x1 = x + 1 < size ? x + 1 : wraps ? 0 : x;
      const a = (y * size + x) * 6;
      const b = (y * size + x1) * 6;
      const c = (y1 * size + x) * 6;
      const d = (y1 * size + x1) * 6;
      let set = 0;
      for (let k = 0; k < 6; k++) {
        sum[k] = share[a + k]! + share[b + k]! + share[c + k]! + share[d + k]!;
        if (sum[k]! > 0) set |= 1 << k;
      }
      if (FITS[set]) continue;
      let best = 0;
      for (let k = 1; k < 6; k++) if (sum[k]! + sum[(k + 1) % 6]! > sum[best]! + sum[(best + 1) % 6]!) best = k;
      for (let k = 0; k < 6; k++) if (k !== best && k !== (best + 1) % 6) share[a + k] = share[b + k] = share[c + k] = share[d + k] = 0;
    }
  }
}

/**
 * The mips of a mask. How much of each region lies under a pixel is averaged as it is, which is the plain average of
 * the colours. Then each mip is made to obey the ring rule by itself: in every square of four pixels only the
 * strongest pair of neighbouring regions stays, and what else was there goes black. A mask of pure colours that
 * passes checkMask keeps its top picture, and a mask of neighbours only is the plain average all the way down.
 */
export function maskMips(p: Picture, wraps = false): Uint8Array[] {
  const { data, size } = square(regions(unpack(p)), p, 6);
  return halvings(data, size, 6).map((level, i) => {
    settle(level, 1 << i, wraps);
    const out = new Uint8Array((level.length / 6) * 4).fill(255);
    for (let at = 0, to = 0; at < level.length; at += 6, to += 4) {
      out[to] = (level[at]! + level[at + 1]! + level[at + 5]!) * 255 + 0.5;
      out[to + 1] = (level[at + 1]! + level[at + 2]! + level[at + 3]!) * 255 + 0.5;
      out[to + 2] = (level[at + 3]! + level[at + 4]! + level[at + 5]!) * 255 + 0.5;
    }
    return out;
  });
}
