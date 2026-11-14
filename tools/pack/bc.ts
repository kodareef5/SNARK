// BC5 and BC7, the block formats of the `bc` texture variant: the encoders the build runs and the decoders that check
// them. Written from the Khronos Data Format Specification 1.3 (section 19, RGTC, and section 20, BPTC) and
// Microsoft's pages on the BC5 and BC7 formats. tools/pack/bc-gpu.ts holds the decoders, and so the bit layouts,
// against a GPU.
//
// A block is 4 by 4 texels in 16 bytes. A picture is its blocks, row by row from the top. One that is not a multiple
// of four across is padded by repeating its last column and row.
//
// The same pixels give the same bytes on any machine and in any engine: every choice is made with integers, or with
// floating point add, subtract, multiply and divide, which are exact everywhere.

/** Blocks in a picture. */
export function blockCount(width: number, height: number): number {
  return ((width + 3) >> 2) * ((height + 3) >> 2);
}

/** The block being encoded: r, g, b, a for each texel, and texel k is at (k & 3, k >> 2). */
const px = new Int32Array(64);

function load(rgba: Uint8Array, width: number, height: number, block: number): void {
  const across = (width + 3) >> 2;
  const x0 = (block % across) * 4;
  const y0 = ((block / across) | 0) * 4;
  for (let y = 0; y < 4; y++) {
    const row = Math.min(y0 + y, height - 1) * width;
    for (let x = 0; x < 4; x++) {
      const at = (row + Math.min(x0 + x, width - 1)) * 4;
      for (let c = 0; c < 4; c++) px[(y * 4 + x) * 4 + c] = rgba[at + c]!;
    }
  }
}

const texels = new Uint8Array(64);

/** Puts the decoded block in `texels` into a picture, leaving out what lies past its edges. */
function store(out: Uint8Array, width: number, height: number, block: number): void {
  const across = (width + 3) >> 2;
  const x0 = (block % across) * 4;
  const y0 = ((block / across) | 0) * 4;
  for (let y = 0; y < 4 && y0 + y < height; y++) {
    for (let x = 0; x < 4 && x0 + x < width; x++) {
      const at = ((y0 + y) * width + x0 + x) * 4;
      for (let c = 0; c < 4; c++) out[at + c] = texels[(y * 4 + x) * 4 + c]!;
    }
  }
}

// BC5: two BC4 blocks, red then green. A BC4 block is two values and sixteen 3-bit codes. When the first value is the
// greater the codes pick from eight values spread between the two; otherwise from six, and from 0 and 255.

/** One channel of the block. */
const one = new Int32Array(16);

/** How far, in levels, the search looks around its best pair of values. */
const BC4_REACH = 2;

/** Which of the eight values from `hi` (0) to `lo` (7) is nearest `v`. */
function step8(v: number, lo: number, hi: number): number {
  const j = (((hi - v) * 7) / (hi - lo) + 0.5) | 0;
  return j < 0 ? 0 : j > 7 ? 7 : j;
}

/** Which of the six values from `lo` (0) to `hi` (5) is nearest `v`. */
function step6(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  const j = (((v - lo) * 5) / (hi - lo) + 0.5) | 0;
  return j < 0 ? 0 : j > 5 ? 5 : j;
}

/**
 * Squared error of the channel against eight values (in sevenths of a level, since a decoder divides by seven last)
 * or against six and the two ends of the range (in fifths). Gives up once the error reaches `stop`.
 */
function miss(lo: number, hi: number, six: boolean, stop: number): number {
  let sum = 0;
  for (let i = 0; i < 16 && sum < stop; i++) {
    const v = one[i]!;
    if (six) {
      const j = step6(v, lo, hi);
      const d = 5 * v - ((5 - j) * lo + j * hi);
      sum += Math.min(d * d, 25 * v * v, 25 * (255 - v) * (255 - v));
    } else {
      const j = step8(v, lo, hi);
      const d = 7 * v - ((7 - j) * hi + j * lo);
      sum += d * d;
    }
  }
  return sum;
}

let walkLo = 0;
let walkHi = 0;

/** Walks from `walkLo` and `walkHi` to the best pair of values nearby, and on from there until no pair nearby is better. Returns its error. */
function walk(six: boolean): number {
  let best = miss(walkLo, walkHi, six, Infinity);
  for (let moved = true; moved && best > 0; ) {
    moved = false;
    const l0 = walkLo;
    const h0 = walkHi;
    for (let h = h0 - BC4_REACH; h <= h0 + BC4_REACH; h++) {
      for (let l = l0 - BC4_REACH; l <= l0 + BC4_REACH; l++) {
        if (l < 0 || h > 255 || l > h || (l === h && !six)) continue;
        const e = miss(l, h, six, best);
        if (e < best) {
          best = e;
          walkLo = l;
          walkHi = h;
          moved = true;
        }
      }
    }
  }
  return best;
}

function encodeBc4(out: Uint8Array, o: number): void {
  let min = 255;
  let max = 0;
  // The least and greatest value that is not at an end of the range, for the six-value form.
  let inMin = 255;
  let inMax = 0;
  for (let i = 0; i < 16; i++) {
    const v = one[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > 0 && v < inMin) inMin = v;
    if (v < 255 && v > inMax) inMax = v;
  }
  if (min === max) {
    out[o] = min;
    out[o + 1] = min;
    out.fill(0, o + 2, o + 8);
    return;
  }
  walkLo = min;
  walkHi = max;
  const best = walk(false);
  let lo = walkLo;
  let hi = walkHi;
  // Six values leave the two ends of the range free, which pays when texels sit on them.
  let six = false;
  if (best > 0 && (min === 0 || max === 255) && inMin <= inMax) {
    walkLo = inMin;
    walkHi = inMax;
    // Sevenths against fifths: both to thirty-fifths.
    if (walk(true) * 49 < best * 25) {
      six = true;
      lo = walkLo;
      hi = walkHi;
    }
  }
  let low = 0;
  let high = 0;
  for (let i = 0; i < 16; i++) {
    const v = one[i]!;
    let code: number;
    if (six) {
      const j = step6(v, lo, hi);
      const d = 5 * v - ((5 - j) * lo + j * hi);
      code = j === 0 ? 0 : j === 5 ? 1 : j + 1;
      if (25 * v * v < d * d && v <= 255 - v) code = 6;
      else if (25 * (255 - v) * (255 - v) < d * d) code = 7;
    } else {
      const j = step8(v, lo, hi);
      code = j === 0 ? 0 : j === 7 ? 1 : j + 1;
    }
    if (i < 8) low |= code << (3 * i);
    else high |= code << (3 * (i - 8));
  }
  out[o] = six ? lo : hi;
  out[o + 1] = six ? hi : lo;
  out[o + 2] = low & 255;
  out[o + 3] = (low >> 8) & 255;
  out[o + 4] = low >> 16;
  out[o + 5] = high & 255;
  out[o + 6] = (high >> 8) & 255;
  out[o + 7] = high >> 16;
}

/** Decodes a BC4 block into every fourth byte of `texels` from `channel`, each value rounded to the nearest level. */
function decodeBc4(src: Uint8Array, at: number, channel: number): void {
  const r0 = src[at]!;
  const r1 = src[at + 1]!;
  const low = src[at + 2]! | (src[at + 3]! << 8) | (src[at + 4]! << 16);
  const high = src[at + 5]! | (src[at + 6]! << 8) | (src[at + 7]! << 16);
  for (let i = 0; i < 16; i++) {
    const code = ((i < 8 ? low : high) >> (3 * (i & 7))) & 7;
    let v: number;
    if (code === 0) v = r0;
    else if (code === 1) v = r1;
    else if (r0 > r1) v = Math.floor((2 * ((8 - code) * r0 + (code - 1) * r1) + 7) / 14);
    else if (code < 6) v = Math.floor((2 * ((6 - code) * r0 + (code - 1) * r1) + 5) / 10);
    else v = code === 6 ? 0 : 255;
    texels[i * 4 + channel] = v;
  }
}

/**
 * Encodes the red and green of a picture as unsigned BC5: blocks `from` up to `to`, 16 bytes each. A build may share
 * a picture's blocks out among workers by range.
 */
export function encodeBc5(rgba: Uint8Array, width: number, height: number, from = 0, to = blockCount(width, height)): Uint8Array {
  const out = new Uint8Array((to - from) * 16);
  for (let b = from; b < to; b++) {
    load(rgba, width, height, b);
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 16; i++) one[i] = px[i * 4 + c]!;
      encodeBc4(out, (b - from) * 16 + c * 8);
    }
  }
  return out;
}

/** Decodes a BC5 picture to RGBA, as a GPU presents it: blue 0 and alpha 255. */
export function decodeBc5(blocks: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const count = blockCount(width, height);
  for (let t = 0; t < 16; t++) {
    texels[t * 4 + 2] = 0;
    texels[t * 4 + 3] = 255;
  }
  for (let b = 0; b < count; b++) {
    decodeBc4(blocks, b * 16, 0);
    decodeBc4(blocks, b * 16 + 8, 1);
    store(out, width, height, b);
  }
  return out;
}

// BC7. A block is in one of eight modes, named by how many zero bits come before the first one bit. A mode fixes how
// many subsets the texels fall into (each a line between two endpoint colours), how many bits the endpoints and the
// indices along the line have, and whether alpha lies on the colour's line or has its own.

/**
 * Table 109, a row for each mode: subsets, partition bits, rotation bits, index selection bits, colour bits, alpha
 * bits, P-bits for each endpoint, P-bits for each subset, index bits, second index bits.
 */
const MODES: readonly (readonly number[])[] = [
  [3, 4, 0, 0, 4, 0, 1, 0, 3, 0],
  [2, 6, 0, 0, 6, 0, 0, 1, 3, 0],
  [3, 6, 0, 0, 5, 0, 0, 0, 2, 0],
  [2, 6, 0, 0, 7, 0, 1, 0, 2, 0],
  [1, 0, 2, 1, 5, 6, 0, 0, 2, 3],
  [1, 0, 2, 0, 7, 8, 0, 0, 2, 2],
  [1, 0, 0, 0, 7, 7, 1, 0, 4, 0],
  [2, 6, 0, 0, 5, 5, 1, 0, 2, 0],
];

/** Table 114: which subset each texel is in, for the 64 ways of making two. Bit k is texel k. */
const PARTITION2 = new Uint16Array([
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000,
  0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
  0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660,
  0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22,
]);

/** Table 115: the same for three subsets. Bits 2k and 2k + 1 are texel k. */
const PARTITION3 = new Uint32Array([
  0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050,
  0xaa550000, 0xaa555500, 0xaaaa5500, 0x90909090, 0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250,
  0xa5945040, 0x0a425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040, 0xa4a45000, 0x1a1a0500,
  0x0050a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200,
  0xa9a58000, 0x5090a0a8, 0xa8a09050, 0x24242424, 0x00aa5500, 0x24924924, 0x24499224, 0x50a50a50,
  0x500aa550, 0xaaaa4444, 0x66660000, 0xa5a0a5a0, 0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600,
  0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414, 0x96960000,
  0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000, 0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254,
]);

// A subset's anchor is the texel whose index is stored one bit short. The first subset's is texel 0. Table 118 gives
// the second's of two, Table 116 the second's of three and Table 117 the third's. Where the bold figures in Tables
// 114 and 115 differ from these (two subsets, partitions 23 and 35; three, partition 1) a GPU follows these.
const ANCHOR2 = new Uint8Array([
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
]);
const ANCHOR3A = new Uint8Array([
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
]);
const ANCHOR3B = new Uint8Array([
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
]);

/** Table 119: how much of the second endpoint an index stands for, out of 64, for indices of 2, 3 and 4 bits. */
const WEIGHTS: readonly Int32Array[] = [
  new Int32Array([0, 21, 43, 64]),
  new Int32Array([0, 9, 18, 27, 37, 46, 55, 64]),
  new Int32Array([0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]),
];

function subsetOf(subsets: number, partition: number, texel: number): number {
  if (subsets === 1) return 0;
  return subsets === 2 ? (PARTITION2[partition]! >> texel) & 1 : (PARTITION3[partition]! >>> (2 * texel)) & 3;
}

/** A stored value of `width` bits as a byte: moved to the top, with its top bits repeated below it. */
function expand(raw: number, width: number): number {
  const v = raw << (8 - width);
  return v | (v >> width);
}

/** The mode of a BC7 block, 0 to 7, or 8 for the reserved block that decodes to nothing. */
export function bc7Mode(blocks: Uint8Array, at: number): number {
  const first = blocks[at]!;
  let mode = 0;
  while (mode < 8 && ((first >> mode) & 1) === 0) mode++;
  return mode;
}

let bitsOf: Uint8Array = texels;
let bitAt = 0;

/** The next `n` bits of the block, lowest first. */
function take(n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++, bitAt++) v |= ((bitsOf[bitAt >> 3]! >> (bitAt & 7)) & 1) << i;
  return v;
}

function put(v: number, n: number): void {
  for (let i = 0; i < n; i++, bitAt++) bitsOf[bitAt >> 3]! |= ((v >> i) & 1) << (bitAt & 7);
}

/** A block's fields: its endpoints as bytes, four channels each, two for each subset; and its two sets of indices. */
const ends = new Int32Array(24);
const index = new Uint8Array(16);
const index2 = new Uint8Array(16);

/** Decodes the BC7 block at `at` into `texels`. */
function decodeBlock(src: Uint8Array, at: number): void {
  const mode = bc7Mode(src, at);
  if (mode === 8) {
    texels.fill(0);
    return;
  }
  const m = MODES[mode]!;
  const subsets = m[0]!;
  const colourBits = m[4]!;
  const alphaBits = m[5]!;
  const pEach = m[6]!;
  const pShared = m[7]!;
  const indexBits = m[8]!;
  const indexBits2 = m[9]!;
  bitsOf = src;
  bitAt = at * 8 + mode + 1;
  const partition = take(m[1]!);
  const rotation = take(m[2]!);
  const selection = take(m[3]!);
  const count = subsets * 2;
  for (let c = 0; c < 3; c++) for (let e = 0; e < count; e++) ends[e * 4 + c] = take(colourBits);
  for (let e = 0; e < count; e++) ends[e * 4 + 3] = alphaBits > 0 ? take(alphaBits) : 255;
  // A P-bit goes under the bits read so far, in every channel of its endpoint or of both endpoints of its subset.
  for (let e = 0; e < count && pEach > 0; e++) {
    const p = take(1);
    for (let c = 0; c < (alphaBits > 0 ? 4 : 3); c++) ends[e * 4 + c] = (ends[e * 4 + c]! << 1) | p;
  }
  for (let s = 0; s < subsets && pShared > 0; s++) {
    const p = take(1);
    for (let c = 0; c < 3; c++) {
      ends[s * 8 + c] = (ends[s * 8 + c]! << 1) | p;
      ends[s * 8 + 4 + c] = (ends[s * 8 + 4 + c]! << 1) | p;
    }
  }
  for (let e = 0; e < count; e++) {
    for (let c = 0; c < 3; c++) ends[e * 4 + c] = expand(ends[e * 4 + c]!, colourBits + pEach + pShared);
    if (alphaBits > 0) ends[e * 4 + 3] = expand(ends[e * 4 + 3]!, alphaBits + pEach);
  }
  const anchor1 = subsets === 2 ? ANCHOR2[partition]! : subsets === 3 ? ANCHOR3A[partition]! : 0;
  const anchor2 = subsets === 3 ? ANCHOR3B[partition]! : 0;
  for (let t = 0; t < 16; t++) index[t] = take(t === 0 || t === anchor1 || t === anchor2 ? indexBits - 1 : indexBits);
  for (let t = 0; t < 16 && indexBits2 > 0; t++) index2[t] = take(t === 0 ? indexBits2 - 1 : indexBits2);
  // Colour reads the second indices only when the selection bit says so. Alpha reads them unless it does.
  const colourSecond = indexBits2 > 0 && selection === 1;
  const alphaSecond = indexBits2 > 0 && selection === 0;
  const colourWeights = WEIGHTS[(colourSecond ? indexBits2 : indexBits) - 2]!;
  const alphaWeights = WEIGHTS[(alphaSecond ? indexBits2 : indexBits) - 2]!;
  for (let t = 0; t < 16; t++) {
    const e0 = subsetOf(subsets, partition, t) * 8;
    const w = colourWeights[colourSecond ? index2[t]! : index[t]!]!;
    const wa = alphaWeights[alphaSecond ? index2[t]! : index[t]!]!;
    for (let c = 0; c < 3; c++) texels[t * 4 + c] = ((64 - w) * ends[e0 + c]! + w * ends[e0 + 4 + c]! + 32) >> 6;
    texels[t * 4 + 3] = ((64 - wa) * ends[e0 + 3]! + wa * ends[e0 + 7]! + 32) >> 6;
    // Table 120: a rotation exchanges alpha with red, green or blue.
    if (rotation > 0) {
      const a = texels[t * 4 + 3]!;
      texels[t * 4 + 3] = texels[t * 4 + rotation - 1]!;
      texels[t * 4 + rotation - 1] = a;
    }
  }
}

/** Decodes a BC7 picture to RGBA. */
export function decodeBc7(blocks: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const count = blockCount(width, height);
  for (let b = 0; b < count; b++) {
    decodeBlock(blocks, b * 16);
    store(out, width, height, b);
  }
  return out;
}

// The BC7 encoder. A block is tried in the modes that could suit it, and the one whose decoded texels are nearest the
// source is kept, by the sum of squared differences over the four channels.
//
// A fit of one subset is a line through its colours: the direction the colours vary most along, the ends where the
// outermost colours fall, each texel given the nearest of the colours the line offers, and then the ends moved to
// where least squares puts them for those indices, a few times over. Which partitions and rotations to fit is judged
// first from sums over the block, without fitting anything. The best fits are then taken further, each stored
// endpoint walked up and down a step for as long as that helps.

/** How an endpoint's lowest stored bit, the P-bit, is chosen: there is none, each endpoint has one, a subset's two share one, or it must be 1. */
const NONE = 0;
const EACH = 1;
const SHARED = 2;
const ODD = 3;

/** Rounds of least squares after the first fit, multiplications to find a line's direction, and passes of the walk over stored endpoints. */
const ROUNDS = 3;
const POWER = 6;
const PASSES = 4;
/** How many partitions are fitted, for modes 0, 1, 2, 3 and 7. */
const TRY = [1, 4, 2, 4, 0, 0, 0, 4];
/** How many fits are taken further, and how near the best a first fit must be, as a ratio of errors, to be one of them. */
const SHORT = 2;
const CLOSE = 1.5;
/** The share of a subset's spread along its line that indices of 2, 3 and 4 bits leave as error: 1 / (levels - 1) squared. */
const LEFT = [1 / 9, 1 / 49, 1 / 225];
/** With no more error than this in mode 6, only finer endpoints could do better, and mode 5 has them. */
const SMALL = 64;
/** A block that mode 6 brings this near its source is not tried in two subsets. */
const NEAR = 12;
/** Three subsets have the coarsest endpoints. They are tried when everything else leaves more error than this. */
const ROUGH = 256;

/** NEAREST[width - 5][p][v] is the byte nearest v that an endpoint of `width` bits can hold with its lowest bit p, or with any lowest bit for p = 2. */
const NEAREST: Uint8Array[][] = [];
for (let width = 5; width <= 8; width++) {
  const tables: Uint8Array[] = [];
  for (let p = 0; p < 3; p++) {
    const table = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let best = 256;
      for (let raw = p === 1 ? 1 : 0; raw < 1 << width; raw += p === 2 ? 1 : 2) {
        const e = expand(raw, width);
        if (Math.abs(e - v) < Math.abs(best - v)) best = e;
      }
      table[v] = best;
    }
    tables.push(table);
  }
  NEAREST.push(tables);
}

/** For each level, two 7-bit endpoints that index 1 of four blends to exactly that level: mode 5 holds a block of one colour without error. */
const SOLID = new Uint8Array(512);
{
  const found = new Uint8Array(256);
  for (let gap = 0; gap < 128; gap++) {
    for (let lo = 0; lo < 128; lo++) {
      for (const hi of [lo + gap, lo - gap]) {
        if (hi < 0 || hi > 127) continue;
        const v = (43 * expand(lo, 7) + 21 * expand(hi, 7) + 32) >> 6;
        if (found[v] === 1) continue;
        found[v] = 1;
        SOLID[v * 2] = expand(lo, 7);
        SOLID[v * 2 + 1] = expand(hi, 7);
      }
    }
  }
}

/** The texels of each subset of each partition, one subset after another, and how many texels each subset has. */
const LIST1 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const LIST2 = new Uint8Array(64 * 16);
const COUNT2 = new Uint8Array(64 * 2);
const LIST3 = new Uint8Array(64 * 16);
const COUNT3 = new Uint8Array(64 * 3);
for (let p = 0; p < 64; p++) {
  for (let subsets = 2; subsets <= 3; subsets++) {
    const list = subsets === 2 ? LIST2 : LIST3;
    const count = subsets === 2 ? COUNT2 : COUNT3;
    let at = p * 16;
    for (let s = 0; s < subsets; s++) {
      for (let t = 0; t < 16; t++) {
        if (subsetOf(subsets, p, t) !== s) continue;
        list[at++] = t;
        count[p * subsets + s]!++;
      }
    }
  }
}

/** Whether every texel of the block is opaque, and whether alpha is being ignored. */
let opaque = false;
let rgbOnly = false;

/** The block with a colour channel and alpha exchanged, for a rotation of modes 4 and 5. */
const turned = new Int32Array(64);

/** A block being tried. */
const tEnds = new Int32Array(24);
const tIndex = new Uint8Array(16);
const tIndex2 = new Uint8Array(16);

// One fit. What is being fitted: the texels listed from `at`, in three channels or with alpha as a fourth, to
// endpoints of `width` bits with P-bits chosen as `pBit` says and indices of `bits`.
let src = px;
let list = LIST1;
let at = 0;
let n = 0;
let alpha = false;
let width = 0;
let pBit = NONE;
let bits = 0;
/** Where the ends would be if any value could be stored, and how much the texels lean on each end and on both: sums of squares and of products of their shares. */
const wantLo = new Float64Array(4);
const wantHi = new Float64Array(4);
let leanLo = 0;
let leanBoth = 0;
let leanHi = 0;
/** Stored ends being tried with their indices, and the best so far with its error. */
const qLo = new Int32Array(4);
const qHi = new Int32Array(4);
const qIndex = new Uint8Array(16);
const fLo = new Int32Array(4);
const fHi = new Int32Array(4);
const fIndex = new Uint8Array(16);
let fError = 0;
const palette = new Int32Array(64);
const cLo = new Int32Array(4);
const cHi = new Int32Array(4);

function copy4(to: Int32Array, from: Int32Array): void {
  to[0] = from[0]!;
  to[1] = from[1]!;
  to[2] = from[2]!;
  to[3] = from[3]!;
}

function level(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
}

/**
 * Turns the ends that are wanted into ends that can be stored. Moving an end off what is wanted costs by how much the
 * texels lean on it, and the two ends' moves can cancel, so for each channel the stored values either side of both
 * wanted ends are weighed as pairs, under each choice of P-bits.
 */
function settle(): void {
  const tables = NEAREST[width - 5]!;
  const shift = 8 - width;
  const top = (1 << width) - 1;
  const channels = alpha ? 4 : 3;
  let least = Infinity;
  for (let choice = 0; choice < 4; choice++) {
    let pl = choice >> 1;
    let ph = choice & 1;
    if (pBit === NONE) {
      if (choice > 0) break;
      pl = ph = 2;
    } else if ((pBit === SHARED && pl !== ph) || (pBit === ODD && choice !== 3)) continue;
    let cost = 0;
    for (let c = 0; c < channels; c++) {
      const l = wantLo[c]!;
      const h = wantHi[c]!;
      const a0 = tables[pl]![level(l)]!;
      const b0 = tables[ph]![level(h)]!;
      // The stored value on the other side of what is wanted.
      let ar = (a0 >> shift) + (a0 <= l ? 1 : -1) * (pl === 2 ? 1 : 2);
      let br = (b0 >> shift) + (b0 <= h ? 1 : -1) * (ph === 2 ? 1 : 2);
      if (ar < 0 || ar > top) ar = a0 >> shift;
      if (br < 0 || br > top) br = b0 >> shift;
      const a1 = expand(ar, width);
      const b1 = expand(br, width);
      let best = Infinity;
      for (let k = 0; k < 4; k++) {
        const a = k & 1 ? a1 : a0;
        const b = k & 2 ? b1 : b0;
        const q = leanLo * (a - l) * (a - l) + 2 * leanBoth * (a - l) * (b - h) + leanHi * (b - h) * (b - h);
        if (q < best) {
          best = q;
          cLo[c] = a;
          cHi[c] = b;
        }
      }
      cost += best;
    }
    if (cost < least) {
      least = cost;
      copy4(qLo, cLo);
      copy4(qHi, cHi);
    }
  }
}

/**
 * Gives each texel the nearest colour between `qLo` and `qHi`, exactly as a decoder blends them, and returns the
 * squared error. Gives up once the error reaches `stop`.
 */
function evaluate(stop: number): number {
  const weights = WEIGHTS[bits - 2]!;
  const levels = 1 << bits;
  const l0 = qLo[0]!, l1 = qLo[1]!, l2 = qLo[2]!, l3 = alpha ? qLo[3]! : 0;
  const d0 = qHi[0]! - l0, d1 = qHi[1]! - l1, d2 = qHi[2]! - l2, d3 = alpha ? qHi[3]! - l3 : 0;
  for (let j = 0; j < levels; j++) {
    const w = weights[j]!;
    palette[j * 4] = l0 + ((w * d0 + 32) >> 6);
    palette[j * 4 + 1] = l1 + ((w * d1 + 32) >> 6);
    palette[j * 4 + 2] = l2 + ((w * d2 + 32) >> 6);
    palette[j * 4 + 3] = l3 + ((w * d3 + 32) >> 6);
  }
  // Where a texel falls along the line says which colour is nearest, give or take one. Four colours are simply all tried.
  const dd = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
  const scale = dd > 0 ? (levels - 1) / dd : 0;
  let sum = 0;
  for (let i = 0; i < n && sum < stop; i++) {
    const t = list[at + i]! << 2;
    const r = src[t]!, g = src[t + 1]!, b = src[t + 2]!, a = alpha ? src[t + 3]! : 0;
    let from = 0;
    let to = levels - 1;
    if (bits > 2) {
      let j = (((r - l0) * d0 + (g - l1) * d1 + (b - l2) * d2 + (a - l3) * d3) * scale + 0.5) | 0;
      j = j < 0 ? 0 : j > to ? to : j;
      from = j > 0 ? j - 1 : 0;
      to = j < to ? j + 1 : to;
    }
    let best = 0x7fffffff;
    let which = 0;
    for (let j = from; j <= to; j++) {
      const er = r - palette[j * 4]!, eg = g - palette[j * 4 + 1]!, eb = b - palette[j * 4 + 2]!, ea = a - palette[j * 4 + 3]!;
      const e = er * er + eg * eg + eb * eb + ea * ea;
      if (e < best) {
        best = e;
        which = j;
      }
    }
    qIndex[i] = which;
    sum += best;
  }
  return sum;
}

/** Evaluates the ends being tried and keeps them if they are the best so far. */
function keep(): boolean {
  const e = evaluate(fError);
  if (e >= fError) return false;
  copy4(fLo, qLo);
  copy4(fHi, qHi);
  for (let i = 0; i < n; i++) fIndex[i] = qIndex[i]!;
  fError = e;
  return true;
}

/** Sets the wanted ends to those least squares gives for the best indices so far. False if every index is the same. */
function refit(): boolean {
  const weights = WEIGHTS[bits - 2]!;
  // Each texel is u parts of the low end and v of the high, in 64ths.
  let uu = 0, uv = 0, vv = 0;
  let ur = 0, ug = 0, ub = 0, ua = 0;
  let vr = 0, vg = 0, vb = 0, va = 0;
  for (let i = 0; i < n; i++) {
    const t = list[at + i]! << 2;
    const v = weights[fIndex[i]!]!;
    const u = 64 - v;
    uu += u * u; uv += u * v; vv += v * v;
    ur += u * src[t]!; vr += v * src[t]!;
    ug += u * src[t + 1]!; vg += v * src[t + 1]!;
    ub += u * src[t + 2]!; vb += v * src[t + 2]!;
    if (alpha) {
      ua += u * src[t + 3]!; va += v * src[t + 3]!;
    }
  }
  const det = uu * vv - uv * uv;
  if (det === 0) return false;
  const k = 64 / det;
  wantLo[0] = (ur * vv - vr * uv) * k; wantHi[0] = (vr * uu - ur * uv) * k;
  wantLo[1] = (ug * vv - vg * uv) * k; wantHi[1] = (vg * uu - ug * uv) * k;
  wantLo[2] = (ub * vv - vb * uv) * k; wantHi[2] = (vb * uu - ub * uv) * k;
  wantLo[3] = (ua * vv - va * uv) * k; wantHi[3] = (va * uu - ua * uv) * k;
  leanLo = uu;
  leanBoth = uv;
  leanHi = vv;
  return true;
}

/** Walks the stored ends of the fit a step down and up, one at a time, both of a channel together, and by turning P-bits over, keeping what lowers the error until nothing does. */
function polish(): void {
  const channels = alpha ? 4 : 3;
  const shift = 8 - width;
  const top = (1 << width) - 1;
  const step = pBit === NONE ? 1 : 2;
  for (let moved = true, pass = 0; moved && fError > 0 && pass < PASSES; pass++) {
    moved = false;
    for (let k = 0; k < channels * 8; k++) {
      copy4(qLo, fLo);
      copy4(qHi, fHi);
      const c = k >> 3;
      // First each end alone, then the two together.
      const lo = (qLo[c]! >> shift) + (k & 4 ? (k & 1 ? step : -step) : k & 2 ? 0 : k & 1 ? step : -step);
      const hi = (qHi[c]! >> shift) + (k & 4 ? (k & 2 ? step : -step) : k & 2 ? (k & 1 ? step : -step) : 0);
      if (lo < 0 || lo > top || hi < 0 || hi > top) continue;
      qLo[c] = expand(lo, width);
      qHi[c] = expand(hi, width);
      if (keep()) moved = true;
    }
    // A P-bit turned over moves every channel of its end, or of both ends, a single step.
    for (let k = 0; k < (pBit === EACH ? 4 : pBit === SHARED ? 2 : 0); k++) {
      let inside = true;
      for (let c = 0; c < channels; c++) {
        const lo = (fLo[c]! >> shift) + (pBit === EACH && k >> 1 === 1 ? 0 : k & 1 ? 1 : -1);
        const hi = (fHi[c]! >> shift) + (pBit === EACH && k >> 1 === 0 ? 0 : k & 1 ? 1 : -1);
        if (lo < 0 || lo > top || hi < 0 || hi > top) inside = false;
        qLo[c] = expand(lo, width);
        qHi[c] = expand(hi, width);
      }
      if (inside && keep()) moved = true;
    }
  }
}

/** Fits a line to the texels set out above. The result goes into the trial as subset `subset`. Returns the squared error. */
function fit(subset: number, fine: boolean): number {
  let mr = 0, mg = 0, mb = 0, ma = 0;
  for (let i = 0; i < n; i++) {
    const t = list[at + i]! << 2;
    mr += src[t]!; mg += src[t + 1]!; mb += src[t + 2]!;
    if (alpha) ma += src[t + 3]!;
  }
  mr /= n; mg /= n; mb /= n; ma /= n;
  let rr = 0, rg = 0, rb = 0, ra = 0, gg = 0, gb = 0, ga = 0, bb = 0, ba = 0, aa = 0;
  for (let i = 0; i < n; i++) {
    const t = list[at + i]! << 2;
    const dr = src[t]! - mr, dg = src[t + 1]! - mg, db = src[t + 2]! - mb;
    rr += dr * dr; rg += dr * dg; rb += dr * db; gg += dg * dg; gb += dg * db; bb += db * db;
    if (alpha) {
      const da = src[t + 3]! - ma;
      ra += dr * da; ga += dg * da; ba += db * da; aa += da * da;
    }
  }
  // The direction the colours vary most along: a vector multiplied through their scatter a few times turns to it.
  // It starts as the row of the scatter with the most on the diagonal.
  let vr = ra, vg = ga, vb = ba, va = aa;
  if (rr >= gg && rr >= bb && rr >= aa) {
    vr = rr; vg = rg; vb = rb; va = ra;
  } else if (gg >= bb && gg >= aa) {
    vr = rg; vg = gg; vb = gb; va = ga;
  } else if (bb >= aa) {
    vr = rb; vg = gb; vb = bb; va = ba;
  }
  for (let k = 0; k < POWER; k++) {
    const xr = rr * vr + rg * vg + rb * vb + ra * va;
    const xg = rg * vr + gg * vg + gb * vb + ga * va;
    const xb = rb * vr + gb * vg + bb * vb + ba * va;
    const xa = ra * vr + ga * vg + ba * vb + aa * va;
    const m = Math.max(Math.abs(xr), Math.abs(xg), Math.abs(xb), Math.abs(xa));
    if (m === 0) break;
    vr = xr / m; vg = xg / m; vb = xb / m; va = xa / m;
  }
  const vv = vr * vr + vg * vg + vb * vb + va * va;
  let lo = 0;
  let hi = 0;
  if (vv > 0) {
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const t = list[at + i]! << 2;
      const d = (src[t]! - mr) * vr + (src[t + 1]! - mg) * vg + (src[t + 2]! - mb) * vb + (alpha ? (src[t + 3]! - ma) * va : 0);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    lo /= vv;
    hi /= vv;
  }
  wantLo[0] = mr + lo * vr; wantLo[1] = mg + lo * vg; wantLo[2] = mb + lo * vb; wantLo[3] = ma + lo * va;
  wantHi[0] = mr + hi * vr; wantHi[1] = mg + hi * vg; wantHi[2] = mb + hi * vb; wantHi[3] = ma + hi * va;
  // With no indices yet, each end is simply rounded to the nearest stored value.
  leanLo = leanHi = 1;
  leanBoth = 0;
  settle();
  fError = Infinity;
  keep();
  for (let round = 0; round < ROUNDS && fError > 0 && refit(); round++) {
    settle();
    let same = true;
    for (let c = 0; c < 4; c++) if (qLo[c] !== fLo[c] || qHi[c] !== fHi[c]) same = false;
    if (same || !keep()) break;
  }
  if (fine) polish();
  for (let c = 0; c < (alpha ? 4 : 3); c++) {
    tEnds[subset * 8 + c] = fLo[c]!;
    tEnds[subset * 8 + 4 + c] = fHi[c]!;
  }
  for (let i = 0; i < n; i++) tIndex[list[at + i]!] = fIndex[i]!;
  return fError;
}

/**
 * Squared error of the fourth channel of `from` against the values between `lo` and `hi`, with the indices left in
 * the trial's second set. Gives up once the error reaches `stop`.
 */
function missAlone(from: Int32Array, lo: number, hi: number, indexBits: number, stop: number): number {
  const weights = WEIGHTS[indexBits - 2]!;
  const levels = 1 << indexBits;
  for (let j = 0; j < levels; j++) palette[j] = lo + ((weights[j]! * (hi - lo) + 32) >> 6);
  let sum = 0;
  for (let t = 0; t < 16 && sum < stop; t++) {
    const v = from[t * 4 + 3]!;
    let best = 0x7fffffff;
    let which = 0;
    for (let j = 0; j < levels; j++) {
      const e = (v - palette[j]!) * (v - palette[j]!);
      if (e < best) {
        best = e;
        which = j;
      }
    }
    tIndex2[t] = which;
    sum += best;
  }
  return sum;
}

/** Fits the fourth channel of `from` on a line of its own, as modes 4 and 5 store it: from its least and greatest value, walking to better stored values nearby. */
function fitAlone(from: Int32Array, endBits: number, indexBits: number): number {
  let min = 255;
  let max = 0;
  for (let t = 3; t < 64; t += 4) {
    if (from[t]! < min) min = from[t]!;
    if (from[t]! > max) max = from[t]!;
  }
  const table = NEAREST[endBits - 5]![2]!;
  let lo = table[min]!;
  let hi = table[max]!;
  let best = missAlone(from, lo, hi, indexBits, Infinity);
  const top = (1 << endBits) - 1;
  for (let moved = true; moved && best > 0; ) {
    moved = false;
    const l0 = lo >> (8 - endBits);
    const h0 = hi >> (8 - endBits);
    for (let h = h0 - 1; h <= h0 + 1; h++) {
      for (let l = l0 - 1; l <= l0 + 1; l++) {
        if (l < 0 || h < 0 || l > top || h > top || (l === l0 && h === h0)) continue;
        const e = missAlone(from, expand(l, endBits), expand(h, endBits), indexBits, best);
        if (e < best) {
          best = e;
          lo = expand(l, endBits);
          hi = expand(h, endBits);
          moved = true;
        }
      }
    }
  }
  tEnds[3] = lo;
  tEnds[7] = hi;
  return missAlone(from, lo, hi, indexBits, Infinity);
}

/** For each texel, each channel and each product of two: r g b, rr rg rb gg gb bb, then a, ra ga ba aa. And their sums over the block. */
const moments = new Float64Array(16 * 14);
const total = new Float64Array(14);
const part = new Float64Array(14);
const rest = new Float64Array(14);
/** The least and greatest of each channel over the block. */
const least = new Int32Array(4);
const most = new Int32Array(4);

function measure(): void {
  const terms = opaque ? 9 : 14;
  total.fill(0);
  least.fill(255);
  most.fill(0);
  for (let t = 0; t < 16; t++) {
    const r = px[t * 4]!, g = px[t * 4 + 1]!, b = px[t * 4 + 2]!, a = px[t * 4 + 3]!;
    const m = t * 14;
    moments[m] = r; moments[m + 1] = g; moments[m + 2] = b;
    moments[m + 3] = r * r; moments[m + 4] = r * g; moments[m + 5] = r * b;
    moments[m + 6] = g * g; moments[m + 7] = g * b; moments[m + 8] = b * b;
    moments[m + 9] = a; moments[m + 10] = r * a; moments[m + 11] = g * a; moments[m + 12] = b * a; moments[m + 13] = a * a;
    for (let k = 0; k < terms; k++) total[k]! += moments[m + k]!;
    for (let c = 0; c < 4; c++) {
      if (px[t * 4 + c]! < least[c]!) least[c] = px[t * 4 + c]!;
      if (px[t * 4 + c]! > most[c]!) most[c] = px[t * 4 + c]!;
    }
  }
}

/** What `spread` and `line` find: how much of a set of colours' squared distance from their mean lies along their best line, and how much off it. */
let along = 0;
let across = 0;

/** Splits the scatter of `count` colours, given their sums, into `along` and `across`. */
function spread(s: Float64Array, count: number): void {
  along = 0;
  across = 0;
  if (count < 2) return;
  const rr = s[3]! - (s[0]! * s[0]!) / count, rg = s[4]! - (s[0]! * s[1]!) / count, rb = s[5]! - (s[0]! * s[2]!) / count;
  const gg = s[6]! - (s[1]! * s[1]!) / count, gb = s[7]! - (s[1]! * s[2]!) / count, bb = s[8]! - (s[2]! * s[2]!) / count;
  if (opaque) line(rr, rg, rb, 0, gg, gb, 0, bb, 0, 0);
  else line(rr, rg, rb, s[10]! - (s[0]! * s[9]!) / count, gg, gb, s[11]! - (s[1]! * s[9]!) / count, bb, s[12]! - (s[2]! * s[9]!) / count, s[13]! - (s[9]! * s[9]!) / count);
}

/** The same from the scatter itself: the upper half of a symmetric four by four, by rows. */
function line(rr: number, rg: number, rb: number, ra: number, gg: number, gb: number, ga: number, bb: number, ba: number, aa: number): void {
  let vr = ra, vg = ga, vb = ba, va = aa;
  if (rr >= gg && rr >= bb && rr >= aa) {
    vr = rr; vg = rg; vb = rb; va = ra;
  } else if (gg >= bb && gg >= aa) {
    vr = rg; vg = gg; vb = gb; va = ga;
  } else if (bb >= aa) {
    vr = rb; vg = gb; vb = bb; va = ba;
  }
  const trace = rr + gg + bb + aa;
  along = 0;
  across = trace > 0 ? trace : 0;
  for (let k = 0; k < 3; k++) {
    const m = Math.max(Math.abs(vr), Math.abs(vg), Math.abs(vb), Math.abs(va));
    if (m === 0) return;
    vr /= m; vg /= m; vb /= m; va /= m;
    const xr = rr * vr + rg * vg + rb * vb + ra * va;
    const xg = rg * vr + gg * vg + gb * vb + ga * va;
    const xb = rb * vr + gb * vg + bb * vb + ba * va;
    const xa = ra * vr + ga * vg + ba * vb + aa * va;
    // The scatter's strength along v, which nears its greatest as v turns to the line.
    along = (vr * xr + vg * xg + vb * xb + va * xa) / (vr * vr + vg * vg + vb * vb + va * va);
    vr = xr; vg = xg; vb = xb; va = xa;
  }
  across = trace > along ? trace - along : 0;
}

/** For each partition, the `across` and `along` of its subsets added up. */
const acrossOf = new Float64Array(64);
const alongOf = new Float64Array(64);

function rank(subsets: number): void {
  const terms = opaque ? 9 : 14;
  const lists = subsets === 2 ? LIST2 : LIST3;
  const counts = subsets === 2 ? COUNT2 : COUNT3;
  for (let p = 0; p < 64; p++) {
    // The first subset's sums are the block's less the others'.
    rest.set(total);
    let a = 0;
    let b = 0;
    for (let s = 1, i = counts[p * subsets]!; s < subsets; s++) {
      const count = counts[p * subsets + s]!;
      part.fill(0);
      for (const end = i + count; i < end; i++) {
        const m = lists[p * 16 + i]! * 14;
        for (let k = 0; k < terms; k++) part[k]! += moments[m + k]!;
      }
      for (let k = 0; k < terms; k++) rest[k]! -= part[k]!;
      spread(part, count);
      a += across;
      b += along;
    }
    spread(rest, counts[p * subsets]!);
    acrossOf[p] = a + across;
    alongOf[p] = b + along;
  }
}

/** A fit is named by its mode, partition, rotation and selection bit in one number. */
function named(mode: number, partition: number, rotation: number, selection: number): number {
  return mode | (partition << 3) | (rotation << 9) | (selection << 11);
}

/** The best first fits so far, least error first. */
const shortError = new Float64Array(SHORT);
const shortName = new Int32Array(SHORT);

/** Fits the block as `name` says, into the trial, and returns the error. Stops early, with too great an error, once it is past `stop`. */
function attempt(name: number, fine: boolean, stop: number): number {
  const mode = name & 7;
  const partition = (name >> 3) & 63;
  const rotation = (name >> 9) & 3;
  const selection = name >> 11;
  const m = MODES[mode]!;
  const subsets = m[0]!;
  src = px;
  list = subsets === 1 ? LIST1 : subsets === 2 ? LIST2 : LIST3;
  at = partition * 16;
  alpha = mode === 7 || (mode === 6 && !opaque);
  width = m[4]! + m[6]! + m[7]!;
  // An opaque block in mode 6 keeps its alpha exact by taking P-bits of 1, unless alpha is not wanted.
  pBit = mode === 6 && opaque && !rgbOnly ? ODD : m[6]! > 0 ? EACH : m[7]! > 0 ? SHARED : NONE;
  bits = mode === 4 && selection === 1 ? 3 : m[8]!;
  if (mode === 4 || mode === 5) {
    // One channel changes places with alpha and so has the line of its own.
    if (rotation > 0) {
      src = turned;
      turned.set(px);
      for (let t = 0; t < 64; t += 4) {
        turned[t + rotation - 1] = px[t + 3]!;
        turned[t + 3] = px[t + rotation - 1]!;
      }
    }
    n = 16;
    const error = fit(0, fine);
    return error < stop ? error + fitAlone(src, m[5]!, mode === 4 && selection === 0 ? 3 : 2) : error;
  }
  const counts = subsets === 2 ? COUNT2 : COUNT3;
  let error = 0;
  for (let s = 0; s < subsets && error < stop; s++) {
    n = subsets === 1 ? 16 : counts[partition * subsets + s]!;
    error += fit(s, fine);
    at += n;
  }
  if (mode === 6 && opaque) tEnds[3] = tEnds[7] = 255;
  return error;
}

/** Makes a first fit as `name` says and notes it if it is among the best so far. */
function first(name: number): void {
  const error = attempt(name, false, shortError[SHORT - 1]!);
  let k = SHORT - 1;
  if (error >= shortError[k]!) return;
  for (; k > 0 && shortError[k - 1]! > error; k--) {
    shortError[k] = shortError[k - 1]!;
    shortName[k] = shortName[k - 1]!;
  }
  shortError[k] = error;
  shortName[k] = name;
}

const guess = new Float64Array(64);

/** Makes first fits in the `tries` partitions of a mode that the sums say suit the block best, or until one is exact. */
function trySubsets(mode: number, tries = TRY[mode]!): void {
  const m = MODES[mode]!;
  const count = 1 << m[1]!;
  const left = LEFT[m[8]! - 2]!;
  for (let p = 0; p < count; p++) guess[p] = acrossOf[p]! + left * alongOf[p]!;
  for (let k = 0; k < tries && shortError[0]! > 0; k++) {
    let best = 0;
    for (let p = 1; p < count; p++) if (guess[p]! < guess[best]!) best = p;
    guess[best] = Infinity;
    first(named(mode, best, 0, 0));
  }
}

/** The scatter of the block's four channels, upper half by rows: rr rg rb ra, gg gb ga, bb ba, aa. And where in it channels i and j meet. */
const scatter = new Float64Array(10);
const MEET = [0, 1, 2, 3, 1, 4, 5, 6, 2, 5, 7, 8, 3, 6, 8, 9];
const SUMS = [3, 4, 5, 10, 6, 7, 11, 8, 12, 13];

/** Error to expect from holding a channel's ends in `endBits` bits: how far its least and greatest values are from values that can be stored. */
function coarse(channel: number, endBits: number): number {
  const table = NEAREST[endBits - 5]![2]!;
  const lo = least[channel]! - table[least[channel]!]!;
  const hi = most[channel]! - table[most[channel]!]!;
  return (16 / 3) * (lo * lo + lo * hi + hi * hi);
}

/** Makes first fits in the rotation of mode 5 and of mode 4 that the block's sums say is best. */
function tryRotations(): void {
  for (let i = 0; i < 4; i++) {
    for (let j = i; j < 4; j++) {
      const k = MEET[i * 4 + j]!;
      const si = i === 3 ? 9 : i;
      const sj = j === 3 ? 9 : j;
      scatter[k] = opaque && j === 3 ? 0 : total[SUMS[k]!]! - (total[si]! * total[sj]!) / 16;
    }
  }
  let best5 = 0;
  let guess5 = Infinity;
  let best4 = 0;
  let guess4 = Infinity;
  // An opaque block's alpha needs no line of its own, so rotation 0 gains it nothing.
  for (let rotation = opaque ? 1 : 0; rotation < 4; rotation++) {
    // The channel that would stand alone, and the other three.
    const alone = rotation === 0 ? 3 : rotation - 1;
    const i = alone === 0 ? 1 : 0;
    const j = alone <= 1 ? 2 : 1;
    const k = alone === 3 ? 2 : 3;
    line(scatter[MEET[i * 4 + i]!]!, scatter[MEET[i * 4 + j]!]!, scatter[MEET[i * 4 + k]!]!, 0, scatter[MEET[j * 4 + j]!]!, scatter[MEET[j * 4 + k]!]!, 0, scatter[MEET[k * 4 + k]!]!, 0, 0);
    const own = scatter[MEET[alone * 4 + alone]!]!;
    const g5 = across + LEFT[0]! * along + LEFT[0]! * own + coarse(i, 7) + coarse(j, 7) + coarse(k, 7);
    if (g5 < guess5) {
      guess5 = g5;
      best5 = named(5, 0, rotation, 0);
    }
    // Mode 4 gives the finer indices to the three channels or to the one.
    const c4 = coarse(i, 5) + coarse(j, 5) + coarse(k, 5) + coarse(alone, 6);
    const g40 = across + LEFT[0]! * along + LEFT[1]! * own + c4;
    const g41 = across + LEFT[1]! * along + LEFT[0]! * own + c4;
    if (Math.min(g40, g41) < guess4) {
      guess4 = Math.min(g40, g41);
      best4 = named(4, 0, rotation, g41 < g40 ? 1 : 0);
    }
  }
  first(best5);
  first(best4);
}

/** Writes the block in `ends`, `index` and `index2`. */
function pack(out: Uint8Array, o: number, name: number): void {
  const mode = name & 7;
  const partition = (name >> 3) & 63;
  const selection = name >> 11;
  const m = MODES[mode]!;
  const subsets = m[0]!;
  const colourBits = m[4]!;
  const alphaBits = m[5]!;
  const pEach = m[6]!;
  const pShared = m[7]!;
  const indexBits = m[8]!;
  const indexBits2 = m[9]!;
  const anchor1 = subsets === 2 ? ANCHOR2[partition]! : subsets === 3 ? ANCHOR3A[partition]! : 0;
  const anchor2 = subsets === 3 ? ANCHOR3B[partition]! : 0;
  // `index` holds colour's indices and `index2` alpha's own, when it has them. In mode 4 the selection bit says which of the two is the wider.
  const colourIndexBits = indexBits2 > 0 && selection === 1 ? indexBits2 : indexBits;
  const alphaIndexBits = selection === 1 ? indexBits : indexBits2;
  // The top bit of an anchor's index is not stored, so it must be 0. A line reads the same from either end: where
  // the bit is 1 the ends change places and the indices count from the other end.
  for (let s = 0; s < subsets; s++) {
    const anchor = s === 0 ? 0 : s === 1 ? anchor1 : anchor2;
    if (index[anchor]! >> (colourIndexBits - 1) === 0) continue;
    for (let c = 0; c < (indexBits2 > 0 ? 3 : 4); c++) {
      const v = ends[s * 8 + c]!;
      ends[s * 8 + c] = ends[s * 8 + 4 + c]!;
      ends[s * 8 + 4 + c] = v;
    }
    for (let t = 0; t < 16; t++) if (subsetOf(subsets, partition, t) === s) index[t] = (1 << colourIndexBits) - 1 - index[t]!;
  }
  if (indexBits2 > 0 && index2[0]! >> (alphaIndexBits - 1) === 1) {
    const v = ends[3]!;
    ends[3] = ends[7]!;
    ends[7] = v;
    for (let t = 0; t < 16; t++) index2[t] = (1 << alphaIndexBits) - 1 - index2[t]!;
  }
  out.fill(0, o, o + 16);
  bitsOf = out;
  bitAt = o * 8;
  put(1 << mode, mode + 1);
  put(partition, m[1]!);
  put((name >> 9) & 3, m[2]!);
  put(selection, m[3]!);
  // An endpoint's stored bits are the top bits of its byte, the P-bit lowest of them.
  const p = pEach + pShared;
  const colourShift = 8 - colourBits - p;
  for (let c = 0; c < 3; c++) for (let e = 0; e < subsets * 2; e++) put(ends[e * 4 + c]! >> (colourShift + p), colourBits);
  for (let e = 0; e < subsets * 2 && alphaBits > 0; e++) put(ends[e * 4 + 3]! >> (8 - alphaBits), alphaBits);
  for (let e = 0; e < subsets * 2 && pEach > 0; e++) put(ends[e * 4]! >> colourShift, 1);
  for (let s = 0; s < subsets && pShared > 0; s++) put(ends[s * 8]! >> colourShift, 1);
  const firstSet = indexBits2 > 0 && selection === 1 ? index2 : index;
  const secondSet = indexBits2 > 0 && selection === 1 ? index : index2;
  for (let t = 0; t < 16; t++) put(firstSet[t]!, t === 0 || t === anchor1 || t === anchor2 ? indexBits - 1 : indexBits);
  for (let t = 0; t < 16 && indexBits2 > 0; t++) put(secondSet[t]!, t === 0 ? indexBits2 - 1 : indexBits2);
}

/** Encodes the block in `px` to 16 bytes at `o`. */
function encodeBlock(out: Uint8Array, o: number): void {
  opaque = true;
  let solid = true;
  // Pure: every colour channel of every texel is 0 or 255.
  let pure = true;
  for (let t = 0; t < 64; t += 4) {
    if (px[t + 3] !== 255) opaque = false;
    if (px[t] !== px[0] || px[t + 1] !== px[1] || px[t + 2] !== px[2] || px[t + 3] !== px[3]) solid = false;
    if (((px[t]! + 1) & 254) + ((px[t + 1]! + 1) & 254) + ((px[t + 2]! + 1) & 254) !== 0) pure = false;
  }
  if (solid) {
    for (let c = 0; c < 3; c++) {
      ends[c] = SOLID[px[c]! * 2]!;
      ends[4 + c] = SOLID[px[c]! * 2 + 1]!;
    }
    ends[3] = ends[7] = px[3]!;
    index.fill(1);
    index2.fill(0);
    pack(out, o, named(5, 0, 0, 0));
    return;
  }
  // Mode 6 first: one line, the finest indices.
  shortError.fill(Infinity);
  first(named(6, 0, 0, 0));
  if (shortError[0]! > 0) {
    measure();
    if (opaque) {
      // Modes 0 to 3 have no alpha, so they are for opaque blocks only.
      if (shortError[0]! <= SMALL) first(named(5, 0, 0, 0));
      if (shortError[0]! > NEAR) {
        rank(2);
        trySubsets(1);
        trySubsets(3);
      }
      tryRotations();
      // Mode 2 holds three pairs of pure colours exactly, which a mask of colour regions is made of: every partition
      // is worth a look for an exact one.
      if (shortError[0]! > ROUGH || (pure && shortError[0]! > 0)) {
        rank(3);
        trySubsets(0);
        trySubsets(2, pure ? 64 : TRY[2]!);
      }
    } else {
      rank(2);
      trySubsets(7);
      tryRotations();
    }
  }
  // Take the best first fits further, and keep the best of those.
  let best = Infinity;
  let bestName = 0;
  for (let k = 0; k < SHORT && best > 0 && shortError[k]! <= shortError[0]! * CLOSE; k++) {
    const e = attempt(shortName[k]!, true, best);
    if (e >= best) continue;
    best = e;
    bestName = shortName[k]!;
    ends.set(tEnds);
    index.set(tIndex);
    index2.set(tIndex2);
  }
  pack(out, o, bestName);
}

/**
 * Encodes a picture as BC7: blocks `from` up to `to`, 16 bytes each. A build may share a picture's blocks out among
 * workers by range. With `channels` 4, alpha is encoded like any channel and an opaque texel stays opaque. With 3,
 * nothing is to read the alpha: it comes back 254 or 255, and the bits it would have taken go to the colour.
 */
export function encodeBc7(rgba: Uint8Array, width: number, height: number, channels: 3 | 4 = 4, from = 0, to = blockCount(width, height)): Uint8Array {
  const out = new Uint8Array((to - from) * 16);
  rgbOnly = channels === 3;
  for (let b = from; b < to; b++) {
    load(rgba, width, height, b);
    if (rgbOnly) for (let t = 3; t < 64; t += 4) px[t] = 255;
    encodeBlock(out, (b - from) * 16);
  }
  return out;
}
