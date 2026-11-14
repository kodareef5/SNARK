// A material's colour regions. An artist paints one region map in flat colours, with any regions touching. The build
// turns it into the two masks the engine reads, which say how much of each region a pixel has: regions 0 to 2 in the
// red, green and blue of `mask`, regions 3 to 5 in those of `mask2` (see shared/pack/texture.ts). Every region has a
// channel to itself, so the plain average of a mask is a true mix of the regions under it.

import { asPicture, halvings, square, unpack, type Picture } from "./image.ts";

/** The colour of each region in a painted region map, regions 0 to 5: ARK's. Black is what is never dyed. */
export const REGION_COLOURS: readonly (readonly [number, number, number])[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 255], [255, 0, 255], [255, 255, 0]];

/** The same seven colours with channels of 0 and 1, black last. */
const PAINTED = [...REGION_COLOURS, [0, 0, 0]].map((c) => c.map((v) => v / 255));
/** A painted pixel is near a colour when none of its channels is further than this from the colour's, of 1. */
const NEAR = 0.25;
/** Six channels of 8 bits may each round up by half a step. */
const ROUNDING = 3 / 255 + 1e-9;

/** How much of each region each pixel of a picture has: six numbers a pixel, 0 to 1. */
export interface Regions {
  width: number;
  height: number;
  weights: Float32Array;
}

/**
 * Reads a painted region map: each pixel is the region whose colour it is nearest, or none where that is black.
 * `stray` is the share of pixels that were not near any of the seven colours, so had to be guessed. A flat map has
 * none; soft edges, noise and colours that are no region's all show here.
 */
export function readRegions(map: Picture): Regions & { stray: number } {
  const rgba = unpack(map);
  const weights = new Float32Array((rgba.length / 4) * 6);
  let stray = 0;
  for (let i = 0, at = 0; i < rgba.length; i += 4, at += 6) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    let best = 6;
    let least = Infinity;
    for (let k = 0; k < 7; k++) {
      const d = (r - PAINTED[k]![0]!) ** 2 + (g - PAINTED[k]![1]!) ** 2 + (b - PAINTED[k]![2]!) ** 2;
      if (d < least) {
        least = d;
        best = k;
      }
    }
    const c = PAINTED[best]!;
    if (Math.max(Math.abs(r - c[0]!), Math.abs(g - c[1]!), Math.abs(b - c[2]!)) > NEAR) stray++;
    if (best < 6) weights[at + best] = 1;
  }
  return { width: map.width, height: map.height, weights, stray: stray / (rgba.length / 4) };
}

/** The regions of two masks that were made by hand and not from a region map. */
export function readMasks(mask: Picture, mask2?: Picture): Regions {
  if (mask2 && (mask2.width !== mask.width || mask2.height !== mask.height)) throw new Error(`the two masks are not one size: ${mask.width}x${mask.height} and ${mask2.width}x${mask2.height}`);
  const weights = new Float32Array(mask.width * mask.height * 6);
  [mask, mask2].forEach((p, half) => {
    if (!p) return;
    const rgba = unpack(p);
    for (let i = 0, at = half * 3; i < rgba.length; i += 4, at += 6) {
      weights[at] = rgba[i]!;
      weights[at + 1] = rgba[i + 1]!;
      weights[at + 2] = rgba[i + 2]!;
    }
  });
  return { width: mask.width, height: mask.height, weights };
}

/**
 * The mips of the two masks: the plain average of the weights, so a border between two regions comes out as a mix of
 * those two. There is no second mask where regions 3 to 5 are empty.
 */
export function maskMips(regions: Regions): { mask: Uint8Array[]; mask2?: Uint8Array[] } {
  const { data, size } = square(regions.weights, regions, 6);
  const levels = halvings(data, size, 6);
  const encode = (first: number): Uint8Array[] => {
    return levels.map((level) => {
      const out = new Uint8Array((level.length / 6) * 4).fill(255);
      for (let at = first, to = 0; at < level.length; at += 6, to += 4) {
        out[to] = level[at]! * 255 + 0.5;
        out[to + 1] = level[at + 1]! * 255 + 0.5;
        out[to + 2] = level[at + 2]! * 255 + 0.5;
      }
      return out;
    });
  };
  // The one-pixel mip holds the mean of every region, so it says whether regions 3 to 5 are used at all.
  const least = levels[0]!;
  return least[3]! + least[4]! + least[5]! > 0 ? { mask: encode(0), mask2: encode(3) } : { mask: encode(0) };
}

/**
 * The two masks of a painted region map, `size` pixels across, and how much of the map was stray (see readRegions).
 * Masks are stored a size below the base colour, so a map painted at the base colour's size is halved and its
 * borders come out soft.
 */
export function regionMasks(map: Picture, size: number): { mask: Picture; mask2?: Picture; stray: number } {
  const regions = readRegions(map);
  const mips = maskMips(regions);
  const at = Math.log2(size);
  if (!mips.mask[at]) throw new Error(`a region map ${map.width} pixels across does not make masks of ${size}`);
  const out: { mask: Picture; mask2?: Picture; stray: number } = { mask: asPicture(mips.mask[at]), stray: regions.stray };
  if (mips.mask2) out.mask2 = asPicture(mips.mask2[at]!);
  return out;
}

export interface MasksReport {
  /** False when the second mask is not the size of the first. Nothing else is measured then. */
  sameSize: boolean;
  /** The share of pixels whose six weights sum past 1 by more than rounding. Such a pixel is dyed more than wholly, and draws too bright. */
  over: number;
  /** The largest sum of the six weights anywhere. */
  most: number;
  /** The share of the surface each region covers, regions 0 to 5. What is left of 1 is not dyed. */
  cover: number[];
}

/** Measures a pair of masks, or one mask alone. */
export function checkMasks(mask: Picture, mask2?: Picture): MasksReport {
  const cover = [0, 0, 0, 0, 0, 0];
  if (mask2 && (mask2.width !== mask.width || mask2.height !== mask.height)) return { sameSize: false, over: 0, most: 0, cover };
  const pixels = mask.width * mask.height;
  const pair = mask2 ? [mask, mask2] : [mask];
  const full = [mask.depth === 8 ? 255 : 65535, mask2?.depth === 16 ? 65535 : 255];
  let over = 0;
  let most = 0;
  for (let i = 0; i < pixels; i++) {
    // Summed as whole numbers, so two halves of 255 are 1 and not a hair over it.
    let sum = 0;
    for (let half = 0; half < pair.length; half++) {
      const p = pair[half]!;
      for (let k = 0; k < 3; k++) {
        const v = p.data[i * p.channels + (p.channels < 3 ? 0 : k)]!;
        sum += v * full[1 - half]!;
        cover[half * 3 + k]! += v;
      }
    }
    sum /= full[0]! * full[1]!;
    if (sum > 1 + ROUNDING) over++;
    most = Math.max(most, sum);
  }
  return { sameSize: true, over: over / pixels, most, cover: cover.map((c, k) => c / full[k < 3 ? 0 : 1]! / pixels) };
}
