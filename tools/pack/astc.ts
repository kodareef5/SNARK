// ASTC, low dynamic range, with square blocks of 4, 5, 6 or 8 pixels a side: an encoder, and the decoder that checks
// it. Both are written from the ASTC chapter of the Khronos Data Format Specification, which has the same text and
// tables as the extension KHR_texture_compression_astc_ldr. The section numbers cited here, C.2.x, are the extension's.
//
// A block is 16 bytes whatever its side. It holds one or more pairs of end colours, and weights on a grid no finer
// than the block's pixels that say where between its pair each pixel lies. How the 128 bits are shared out between
// weights and colours is chosen block by block.
//
// The encoder fits lines through the block's colours, estimates the error of every way of spending the bits, runs the
// most promising ones for real, and keeps the one whose decoded pixels are closest. It works in integers and in
// float operations that are exact everywhere, so the same pixels give the same bytes on any machine.

import { ASTC_BLOCKS } from "../../shared/pack/texture.ts";

/** How the texture will be read. `srgb` is base colour, decoded through the sRGB format. `normal` takes x from red and
 *  y from green, and stores x as luminance and y as alpha. */
export type AstcKind = "srgb" | "linear" | "normal";

// ---- Ranges and the integer sequence encoding (C.2.12) ----

/** The ranges a stored value can have, by how many levels: some bits, under at most one trit or one quint. */
const LEVELS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256];
const BITS = [1, 0, 2, 0, 1, 3, 1, 2, 4, 2, 3, 5, 3, 4, 6, 4, 5, 7, 5, 6, 8];
/** 1 where the range has a trit, 2 where it has a quint. */
const BASE = [0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0];
/** Weights use the first twelve ranges. Colours use the ranges from six levels up. */
const WEIGHT_RANGES = 12;
const FIRST_COLOUR_RANGE = 4;
const LAST_RANGE = 20;

/** Bits that `count` values of a range take. Five trits share 8 bits and three quints share 7. */
export function iseBits(range: number, count: number): number {
  const base = BASE[range];
  return BITS[range] * count + (base === 1 ? ((count * 8 + 4) / 5) | 0 : base === 2 ? ((count * 7 + 2) / 3) | 0 : 0);
}

/** The trits that each 8 bits hold and the quints that each 7 bits hold, and the fewest bits that hold given digits. */
const TRITS = new Uint8Array(256 * 5);
const QUINTS = new Uint8Array(128 * 3);
const TRIT_BITS = new Int16Array(243).fill(-1);
const QUINT_BITS = new Int16Array(125).fill(-1);

for (let T = 0; T < 256; T++) {
  const t = (hi: number, lo: number): number => (T >> lo) & ((1 << (hi - lo + 1)) - 1);
  let C: number;
  let t4: number;
  let t3: number;
  if (t(4, 2) === 7) {
    C = (t(7, 5) << 2) | t(1, 0);
    t4 = t3 = 2;
  } else {
    C = t(4, 0);
    if (t(6, 5) === 3) {
      t4 = 2;
      t3 = t(7, 7);
    } else {
      t4 = t(7, 7);
      t3 = t(6, 5);
    }
  }
  const c = (hi: number, lo: number): number => (C >> lo) & ((1 << (hi - lo + 1)) - 1);
  let t2: number;
  let t1: number;
  let t0: number;
  if (c(1, 0) === 3) {
    t2 = 2;
    t1 = c(4, 4);
    t0 = (c(3, 3) << 1) | (c(2, 2) & ~c(3, 3) & 1);
  } else if (c(3, 2) === 3) {
    t2 = 2;
    t1 = 2;
    t0 = c(1, 0);
  } else {
    t2 = c(4, 4);
    t1 = c(3, 2);
    t0 = (c(1, 1) << 1) | (c(0, 0) & ~c(1, 1) & 1);
  }
  TRITS.set([t0, t1, t2, t3, t4], T * 5);
  const digits = t0 + 3 * t1 + 9 * t2 + 27 * t3 + 81 * t4;
  if (TRIT_BITS[digits] < 0) TRIT_BITS[digits] = T;
}

for (let Q = 0; Q < 128; Q++) {
  const q = (hi: number, lo: number): number => (Q >> lo) & ((1 << (hi - lo + 1)) - 1);
  let q2: number;
  let q1: number;
  let q0: number;
  if (q(2, 1) === 3 && q(6, 5) === 0) {
    q2 = (q(0, 0) << 2) | ((q(4, 4) & ~q(0, 0) & 1) << 1) | (q(3, 3) & ~q(0, 0) & 1);
    q1 = q0 = 4;
  } else {
    let C: number;
    if (q(2, 1) === 3) {
      q2 = 4;
      C = (q(4, 3) << 3) | ((~q(6, 5) & 3) << 1) | q(0, 0);
    } else {
      q2 = q(6, 5);
      C = q(4, 0);
    }
    if ((C & 7) === 5) {
      q1 = 4;
      q0 = (C >> 3) & 3;
    } else {
      q1 = (C >> 3) & 3;
      q0 = C & 7;
    }
  }
  QUINTS.set([q0, q1, q2], Q * 3);
  const digits = q0 + 5 * q1 + 25 * q2;
  if (QUINT_BITS[digits] < 0) QUINT_BITS[digits] = Q;
}

let cursor = 0;
let cursorEnd = 0;
let cursorBits: Uint8Array = new Uint8Array(0);

function put(value: number, count: number): void {
  for (let i = 0; i < count; i++, cursor++) if (cursor < cursorEnd) cursorBits[cursor] = (value >> i) & 1;
}

function take(count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++, cursor++) if (cursor < cursorEnd) value |= cursorBits[cursor] << i;
  return value;
}

/** Writes `count` values of a range into `bits`, one bit an entry, from `at`. A sequence that ends part way through a
 *  group of trits or quints is cut short, and the bits cut off are zero because the lowest packing is the one used. */
export function iseEncode(values: ArrayLike<number>, count: number, range: number, bits: Uint8Array, at: number): void {
  const n = BITS[range];
  const mask = (1 << n) - 1;
  cursorBits = bits;
  cursor = at;
  cursorEnd = at + iseBits(range, count);
  if (BASE[range] === 1) {
    for (let i = 0; i < count; i += 5) {
      const v0 = values[i];
      const v1 = i + 1 < count ? values[i + 1] : 0;
      const v2 = i + 2 < count ? values[i + 2] : 0;
      const v3 = i + 3 < count ? values[i + 3] : 0;
      const v4 = i + 4 < count ? values[i + 4] : 0;
      const T = TRIT_BITS[(v0 >> n) + 3 * (v1 >> n) + 9 * (v2 >> n) + 27 * (v3 >> n) + 81 * (v4 >> n)];
      put(v0 & mask, n);
      put(T, 2);
      put(v1 & mask, n);
      put(T >> 2, 2);
      put(v2 & mask, n);
      put(T >> 4, 1);
      put(v3 & mask, n);
      put(T >> 5, 2);
      put(v4 & mask, n);
      put(T >> 7, 1);
    }
  } else if (BASE[range] === 2) {
    for (let i = 0; i < count; i += 3) {
      const v0 = values[i];
      const v1 = i + 1 < count ? values[i + 1] : 0;
      const v2 = i + 2 < count ? values[i + 2] : 0;
      const Q = QUINT_BITS[(v0 >> n) + 5 * (v1 >> n) + 25 * (v2 >> n)];
      put(v0 & mask, n);
      put(Q, 3);
      put(v1 & mask, n);
      put(Q >> 3, 2);
      put(v2 & mask, n);
      put(Q >> 5, 2);
    }
  } else {
    for (let i = 0; i < count; i++) put(values[i], n);
  }
}

/** Reads `count` values of a range from `bits`, from `at`. Bits past the end of the sequence read as zero. */
export function iseDecode(bits: Uint8Array, at: number, range: number, count: number, out: Int32Array | Uint8Array): void {
  const n = BITS[range];
  cursorBits = bits;
  cursor = at;
  cursorEnd = at + iseBits(range, count);
  if (BASE[range] === 1) {
    for (let i = 0; i < count; i += 5) {
      const m0 = take(n);
      let T = take(2);
      const m1 = take(n);
      T |= take(2) << 2;
      const m2 = take(n);
      T |= take(1) << 4;
      const m3 = take(n);
      T |= take(2) << 5;
      const m4 = take(n);
      T |= take(1) << 7;
      const m = [m0, m1, m2, m3, m4];
      for (let k = 0; k < 5 && i + k < count; k++) out[i + k] = (TRITS[T * 5 + k] << n) | m[k];
    }
  } else if (BASE[range] === 2) {
    for (let i = 0; i < count; i += 3) {
      const m0 = take(n);
      let Q = take(3);
      const m1 = take(n);
      Q |= take(2) << 3;
      const m2 = take(n);
      Q |= take(2) << 5;
      const m = [m0, m1, m2];
      for (let k = 0; k < 3 && i + k < count; k++) out[i + k] = (QUINTS[Q * 3 + k] << n) | m[k];
    }
  } else {
    for (let i = 0; i < count; i++) out[i] = take(n);
  }
}

// ---- What a stored value stands for (C.2.13 and C.2.17) ----

// Rows of the two unquantization tables, C.2.16 for colours and C.2.26 for weights, by range: the pattern of B, whose
// letters are bits of the value's low part with a the lowest, and C.
const COLOUR_ROWS: Record<number, readonly [string, number]> = { 4: ["000000000", 204], 6: ["000000000", 113], 7: ["b000b0bb0", 93], 9: ["b0000bb00", 54], 10: ["cb000cbcb", 44], 12: ["cb0000cbc", 26], 13: ["dcb000dcb", 22], 15: ["dcb0000dc", 13], 16: ["edcb000ed", 11], 18: ["edcb0000e", 6], 19: ["fedcb000f", 5] };
const WEIGHT_ROWS: Record<number, readonly [string, number]> = { 4: ["0000000", 50], 6: ["0000000", 28], 7: ["b000b0b", 23], 9: ["b0000b0", 13], 10: ["cb000cb", 11] };

function spread(pattern: string, low: number): number {
  let v = 0;
  for (const ch of pattern) v = (v << 1) | (ch === "0" ? 0 : (low >> (ch.charCodeAt(0) - 97)) & 1);
  return v;
}

/** The top `to` bits of the `n` bits of `low`, repeated. */
function replicate(low: number, n: number, to: number): number {
  let v = 0;
  for (let shift = to - n; shift > -n; shift -= n) v |= shift >= 0 ? low << shift : low >> -shift;
  return v;
}

/** A stored colour value as 0 to 255. */
function unquantColour(range: number, code: number): number {
  const n = BITS[range];
  const low = code & ((1 << n) - 1);
  if (BASE[range] === 0) return replicate(low, n, 8);
  const [pattern, c] = COLOUR_ROWS[range]!;
  const a = low & 1 ? 511 : 0;
  const t = ((code >> n) * c + spread(pattern, low)) ^ a;
  return (a & 0x80) | (t >> 2);
}

/** A stored weight as 0 to 64. */
function unquantWeight(range: number, code: number): number {
  const n = BITS[range];
  const low = code & ((1 << n) - 1);
  let t: number;
  // Table C.2.25 gives the two ranges that have no bits.
  if (range === 1) t = [0, 32, 63][code]!;
  else if (range === 3) t = [0, 16, 32, 47, 63][code]!;
  else if (BASE[range] === 0) t = replicate(low, n, 6);
  else {
    const [pattern, c] = WEIGHT_ROWS[range]!;
    const a = low & 1 ? 127 : 0;
    t = ((code >> n) * c + spread(pattern, low)) ^ a;
    t = (a & 0x20) | (t >> 2);
  }
  return t > 32 ? t + 1 : t;
}

/** By range: the value of each code, the code of each value a range can hold, and the nearest such value below and
 *  above any value. */
const COLOUR_VALUE: Uint8Array[] = [];
const COLOUR_CODE: Uint8Array[] = [];
const COLOUR_DOWN: Uint8Array[] = [];
const COLOUR_UP: Uint8Array[] = [];
/** By range: the value of each code, the code of each value, and the value nearest to each quarter step of 0 to 64. */
const WEIGHT_VALUE: Uint8Array[] = [];
const WEIGHT_CODE: Uint8Array[] = [];
const WEIGHT_NEAR: Uint8Array[] = [];
/** By range: the next level below and above each value of 0 to 64, or the value itself at the ends. */
const WEIGHT_BELOW: Uint8Array[] = [];
const WEIGHT_ABOVE: Uint8Array[] = [];

for (let range = 0; range <= LAST_RANGE; range++) {
  const levels = LEVELS[range];
  const value = new Uint8Array(levels);
  const code = new Uint8Array(256);
  const down = new Uint8Array(256);
  const up = new Uint8Array(256);
  if (range >= FIRST_COLOUR_RANGE) {
    const has = new Uint8Array(256);
    for (let k = 0; k < levels; k++) {
      value[k] = unquantColour(range, k);
      code[value[k]] = k;
      has[value[k]] = 1;
    }
    for (let v = 0, last = 0; v < 256; v++) down[v] = last = has[v] ? v : last;
    for (let v = 255, last = 255; v >= 0; v--) up[v] = last = has[v] ? v : last;
  }
  COLOUR_VALUE.push(value);
  COLOUR_CODE.push(code);
  COLOUR_DOWN.push(down);
  COLOUR_UP.push(up);
  if (range >= WEIGHT_RANGES) continue;
  const wValue = new Uint8Array(levels);
  const wCode = new Uint8Array(65);
  const near = new Uint8Array(257);
  for (let k = 0; k < levels; k++) {
    wValue[k] = unquantWeight(range, k);
    wCode[wValue[k]] = k;
  }
  for (let q = 0; q <= 256; q++) {
    let best = 0;
    for (let k = 1; k < levels; k++) if (Math.abs(wValue[k] * 4 - q) < Math.abs(wValue[best] * 4 - q)) best = k;
    near[q] = wValue[best];
  }
  const below = new Uint8Array(65);
  const above = new Uint8Array(65);
  const sorted = Array.from(wValue).sort((a, b) => a - b);
  for (let v = 0; v <= 64; v++) {
    below[v] = sorted.findLast((s) => s < v) ?? v;
    above[v] = sorted.find((s) => s > v) ?? v;
  }
  WEIGHT_BELOW.push(below);
  WEIGHT_ABOVE.push(above);
  WEIGHT_VALUE.push(wValue);
  WEIGHT_CODE.push(wCode);
  WEIGHT_NEAR.push(near);
}

// ---- Block modes (C.2.10) ----

// What the last block mode read says: the weight grid, whether there are two planes, and the weight range.
let modeW = 0;
let modeH = 0;
let modeDual = 0;
let modeRange = 0;

/** Reads a block mode, table C.2.8, into modeW and the rest. False for a reserved mode. */
function readMode(mode: number): boolean {
  if ((mode & 3) !== 0) {
    const r = ((mode & 3) << 1) | ((mode >> 4) & 1);
    const A = (mode >> 5) & 3;
    const B = (mode >> 7) & 3;
    switch ((mode >> 2) & 3) {
      case 0:
        modeW = B + 4;
        modeH = A + 2;
        break;
      case 1:
        modeW = B + 8;
        modeH = A + 2;
        break;
      case 2:
        modeW = A + 2;
        modeH = B + 8;
        break;
      default:
        if (B & 2) {
          modeW = (B & 1) + 2;
          modeH = A + 2;
        } else {
          modeW = A + 2;
          modeH = (B & 1) + 6;
        }
    }
    modeDual = (mode >> 10) & 1;
    modeRange = r - 2 + 6 * ((mode >> 9) & 1);
    return true;
  }
  // With its low two bits clear the range is in bits 2 to 4, and the grid is 6 or more on a side.
  if ((mode & 15) === 0) return false;
  const r = ((mode >> 1) & 6) | ((mode >> 4) & 1);
  const A = (mode >> 5) & 3;
  let high = (mode >> 9) & 1;
  modeDual = (mode >> 10) & 1;
  switch ((mode >> 7) & 3) {
    case 0:
      modeW = 12;
      modeH = A + 2;
      break;
    case 1:
      modeW = A + 2;
      modeH = 12;
      break;
    case 2:
      // Bits 9 and 10 are the height here, so this row has one plane and the lower ranges only.
      modeW = A + 6;
      modeH = ((mode >> 9) & 3) + 6;
      modeDual = high = 0;
      break;
    default:
      if (A > 1) return false;
      modeW = A ? 10 : 6;
      modeH = A ? 6 : 10;
  }
  modeRange = r - 2 + 6 * high;
  return true;
}

// ---- Partitions (C.2.21) ----

function hash52(p: number): number {
  p ^= p >>> 15;
  p = (p - (p << 17)) | 0;
  p = (p + (p << 7)) | 0;
  p = (p + (p << 4)) | 0;
  p ^= p >>> 5;
  p = (p + (p << 16)) | 0;
  p ^= p >>> 7;
  p ^= p >>> 3;
  p ^= p << 6;
  p ^= p >>> 17;
  return p >>> 0;
}

/** The partition of each pixel of a block `side` across, rows top to bottom, for a pattern index and a number of
 *  partitions. A block of fewer than 31 pixels doubles its coordinates. There is no z. */
function partitionOf(index: number, parts: number, side: number, out: Uint8Array): void {
  const seed = index + (parts - 1) * 1024;
  const r = hash52(seed);
  const s = [r & 15, (r >>> 4) & 15, (r >>> 8) & 15, (r >>> 12) & 15, (r >>> 16) & 15, (r >>> 20) & 15, (r >>> 24) & 15, (r >>> 28) & 15];
  let sh1: number;
  let sh2: number;
  if (seed & 1) {
    sh1 = seed & 2 ? 4 : 5;
    sh2 = parts === 3 ? 6 : 5;
  } else {
    sh1 = parts === 3 ? 6 : 5;
    sh2 = seed & 2 ? 4 : 5;
  }
  for (let k = 0; k < 8; k++) s[k] = (s[k]! * s[k]!) >> (k & 1 ? sh2 : sh1);
  const small = side * side < 31 ? 1 : 0;
  for (let i = 0; i < side * side; i++) {
    const x = (i % side) << small;
    const y = ((i / side) | 0) << small;
    const a = (s[0]! * x + s[1]! * y + (r >>> 14)) & 63;
    const b = (s[2]! * x + s[3]! * y + (r >>> 10)) & 63;
    const c = parts < 3 ? 0 : (s[4]! * x + s[5]! * y + (r >>> 6)) & 63;
    const d = parts < 4 ? 0 : (s[6]! * x + s[7]! * y + (r >>> 2)) & 63;
    out[i] = a >= b && a >= c && a >= d ? 0 : b >= c && b >= d ? 1 : c >= d ? 2 : 3;
  }
}

/** Set bits in a 32-bit number. */
function pop32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

// ---- Footprints: weight grids (C.2.18) and what each block side needs ----

/** What blocks of one side need, made the first time a block that size is read or written. */
interface Footprint {
  side: number;
  pixels: number;
  /** 32-bit words in a mask of the pixels. */
  words: number;
  /** partition[parts][index]: the partition of each pixel. Index 0 of the outer array is one partition. */
  partition: Uint8Array[][];
  /** The patterns of two and of three partitions that differ from one another and leave no partition empty: the index
   *  of each, and a mask of the pixels of each of its partitions, `words` to a mask. */
  distinct: { index: number[]; masks: Int32Array }[];
  /** Every weight grid a block mode can give this side, the full one first. */
  grids: (readonly [number, number])[];
  /** For each grid and each pixel: the four stored weights it blends, and sixteenths of each. */
  at: Uint8Array[];
  by: Uint8Array[];
  /** For each grid and each stored weight, the pixels it reaches. */
  reach: Uint8Array[][];
  /** For each grid of a 4 by 4 block, the matrix that turns the wanted weights of the pixels into the stored weights
   *  that come closest. Larger blocks fit rows and then columns with `across`. */
  inverse: Float64Array[];
  /** The same for a row of pixels and a row of a grid `n` wide, at `n`. */
  across: Float64Array[];
  /** For each grid, the grids at least as wide and as tall, which fit any weights at least as closely, or nearly. */
  over: number[][];
  /** The block mode for a grid, a weight range and one or two planes, at (grid * 12 + range) * 2 + planes - 1, or -1. */
  mode: Int16Array;
  /** See CONFIGS below. */
  configs: Int32Array[][];
}

/** The matrix that turns `rows` wanted values into the `count` that come closest through A, which is `rows` by
 *  `count`: the solution X of (A' A) X = A', `count` by `rows`. */
function leastSquares(A: Float64Array, rows: number, count: number): Float64Array {
  const wide = count + rows;
  const m = new Float64Array(count * wide);
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) for (let i = 0; i < rows; i++) m[r * wide + c] += A[i * count + r]! * A[i * count + c]!;
    for (let i = 0; i < rows; i++) m[r * wide + count + i] = A[i * count + r]!;
  }
  for (let c = 0; c < count; c++) {
    let pivot = c;
    for (let r = c + 1; r < count; r++) if (Math.abs(m[r * wide + c]!) > Math.abs(m[pivot * wide + c]!)) pivot = r;
    for (let k = 0; k < wide; k++) {
      const swap = m[c * wide + k]!;
      m[c * wide + k] = m[pivot * wide + k]!;
      m[pivot * wide + k] = swap;
    }
    const d = m[c * wide + c]!;
    for (let k = 0; k < wide; k++) m[c * wide + k]! /= d;
    for (let r = 0; r < count; r++) {
      const f = m[r * wide + c]!;
      if (r !== c && f !== 0) for (let k = 0; k < wide; k++) m[r * wide + k]! -= f * m[c * wide + k]!;
    }
  }
  const inv = new Float64Array(count * rows);
  for (let r = 0; r < count; r++) for (let i = 0; i < rows; i++) inv[r * rows + i] = m[r * wide + count + i]!;
  return inv;
}

/** The grids of a 4 by 4 block, in the order its encoder was tuned with. */
const GRIDS_4: readonly (readonly [number, number])[] = [[4, 4], [4, 3], [3, 4], [4, 2], [2, 4], [3, 3], [3, 2], [2, 3], [2, 2]];

const footprints = new Map<number, Footprint>();

function footprint(side: number): Footprint {
  const had = footprints.get(side);
  if (had) return had;
  if (!ASTC_BLOCKS.includes(side)) throw new Error(`astc: blocks ${side} pixels across are not one of ${ASTC_BLOCKS.join(", ")}`);
  const pixels = side * side;
  const words = (pixels + 31) >> 5;
  const partition: Uint8Array[][] = [[], [new Uint8Array(pixels)], [], [], []];
  const distinct: Footprint["distinct"] = [];
  for (let parts = 2; parts <= 4; parts++) {
    const seen = new Set<string>();
    const index: number[] = [];
    const masks: number[] = [];
    for (let k = 0; k < 1024; k++) {
      const row = new Uint8Array(pixels);
      partitionOf(k, parts, side, row);
      partition[parts]!.push(row);
      const m = new Int32Array(parts * words);
      for (let i = 0; i < pixels; i++) m[row[i]! * words + (i >> 5)] |= 1 << (i & 31);
      const used = Array.from({ length: parts }, (_, p) => Array.from(m.subarray(p * words, (p + 1) * words)));
      const key = used.map((w) => w.join(".")).sort().join();
      if (used.some((w) => w.every((v) => v === 0)) || seen.has(key)) continue;
      seen.add(key);
      index.push(k);
      masks.push(...m);
    }
    distinct[parts] = { index, masks: Int32Array.from(masks) };
  }

  // Every grid some mode gives, no wider or taller than the block and of 64 weights at most, and its modes.
  const shapes = new Map<number, number[]>();
  for (let mode = 0; mode < 2048; mode++) {
    if ((mode & 0x1ff) === 0x1fc || !readMode(mode) || modeW > side || modeH > side || modeW * modeH > 64) continue;
    const key = modeW * 16 + modeH;
    if (!shapes.has(key)) shapes.set(key, new Array(WEIGHT_RANGES * 2).fill(-1));
    const modes = shapes.get(key)!;
    if (modes[modeRange * 2 + modeDual] === -1) modes[modeRange * 2 + modeDual] = mode;
  }
  const grids = side === 4 ? GRIDS_4.slice() : [...shapes.keys()].map((k) => [k >> 4, k & 15] as const).sort((a, b) => b[0] * b[1] - a[0] * a[1] || b[0] - a[0]);
  if (grids[0]![0] !== side || grids[0]![1] !== side || grids.length !== shapes.size) throw new Error(`astc: the grids of a block ${side} across are not as expected`);
  const mode = new Int16Array(grids.length * WEIGHT_RANGES * 2);
  grids.forEach(([w, h], g) => shapes.get(w * 16 + h)!.forEach((m, k) => (mode[g * WEIGHT_RANGES * 2 + k] = m)));

  const at: Uint8Array[] = [];
  const by: Uint8Array[] = [];
  const reach: Uint8Array[][] = [];
  const inverse: Float64Array[] = [];
  // The scale from a pixel's place to the grid's, C.2.18: floor((1024 + side / 2) / (side - 1)).
  const ds = ((1024 + (side >> 1)) / (side - 1)) | 0;
  for (const [N, M] of grids) {
    const gAt = new Uint8Array(pixels * 4);
    const gBy = new Uint8Array(pixels * 4);
    const count = N * M;
    for (let i = 0; i < pixels; i++) {
      const gs = (ds * (i % side) * (N - 1) + 32) >> 6;
      const gt = (ds * ((i / side) | 0) * (M - 1) + 32) >> 6;
      const fs = gs & 15;
      const ft = gt & 15;
      const v0 = (gs >> 4) + (gt >> 4) * N;
      const w11 = (fs * ft + 8) >> 4;
      const factors = [16 - fs - ft + w11, fs - w11, ft - w11, w11];
      const places = [v0, v0 + 1, v0 + N, v0 + N + 1];
      for (let k = 0; k < 4; k++) {
        gBy[i * 4 + k] = factors[k]!;
        gAt[i * 4 + k] = factors[k]! > 0 ? places[k]! : 0;
      }
    }
    at.push(gAt);
    by.push(gBy);
    reach.push(Array.from({ length: count }, (_, j) => Uint8Array.from([...Array(pixels).keys()].filter((i) => [0, 1, 2, 3].some((k) => gBy[i * 4 + k]! > 0 && gAt[i * 4 + k] === j)))));
    // Row i of A holds pixel i's sixteenths.
    const A = new Float64Array(pixels * count);
    for (let i = 0; i < pixels; i++) for (let k = 0; k < 4; k++) A[i * count + gAt[i * 4 + k]!] += gBy[i * 4 + k]! / 16;
    inverse.push(side === 4 ? leastSquares(A, pixels, count) : new Float64Array(0));
  }
  // The same along one row of pixels, for grids 2 to `side` wide.
  const across = Array.from({ length: side + 1 }, (_, n) => {
    if (n < 2) return new Float64Array(0);
    const A = new Float64Array(side * n);
    for (let x = 0; x < side; x++) {
      const gs = (ds * x * (n - 1) + 32) >> 6;
      A[x * n + (gs >> 4)] += (16 - (gs & 15)) / 16;
      if (gs & 15) A[x * n + (gs >> 4) + 1] += (gs & 15) / 16;
    }
    return leastSquares(A, side, n);
  });
  const over = grids.map(([w, h], g) => grids.flatMap(([w2, h2], g2) => (g2 !== g && w2 >= w && h2 >= h ? [g2] : [])));
  const fp: Footprint = { side, pixels, words, partition, distinct, grids, at, by, reach, inverse, across, over, mode, configs: [] };
  for (let parts = 1; parts <= 3; parts++) {
    for (let channels = 1; channels <= 4; channels++) {
      for (let planes = 1; planes <= 2; planes++) {
        // Two planes need two channels and, here, one partition. A 4 by 4 block tries smaller grids with one partition
        // only; a larger one cannot spend a weight on every pixel and still hold more than one pair of colours.
        const usable = planes === 1 || (channels > 1 && parts === 1);
        fp.configs.push(grids.map((_, g) => (usable && (g === 0 || parts === 1 || side > 4) ? configsFor(fp, parts, channels, planes, g) : new Int32Array(0))));
      }
    }
  }
  footprints.set(side, fp);
  return fp;
}

/** The weight grids a block `side` across can have, and for each grid, weight range and number of planes the block
 *  mode that says so, or -1: for tests that build blocks bit by bit. */
export function astcModes(side: number): { grids: readonly (readonly [number, number])[]; mode: (g: number, range: number, planes: number) => number } {
  const fp = footprint(side);
  return { grids: fp.grids, mode: (g, range, planes) => fp.mode[(g * WEIGHT_RANGES + range) * 2 + planes - 1]! };
}

/** The grid of a footprint that is `w` by `h`, or -1. */
function gridOf(fp: Footprint, w: number, h: number): number {
  return fp.grids.findIndex((g) => g[0] === w && g[1] === h);
}

// ---- End colours (C.2.14) ----

/** The colour endpoint modes of the low dynamic range profile, and the name of each. */
const CEM_NAMES: Record<number, string> = { 0: "l", 1: "l offset", 4: "la", 5: "la offset", 6: "rgb scale", 8: "rgb", 9: "rgb offset", 10: "rgb scale a", 12: "rgba", 13: "rgba offset" };

/** The two colours of a mode from its values `v[at..]`, each 0 to 255, into `e[to..to+7]`: red, green, blue and alpha of
 *  the first, then of the second. */
function endColours(cem: number, v: Int32Array, at: number, e: Int32Array, to: number): void {
  let v0 = v[at];
  let v1 = v[at + 1];
  let v2 = v[at + 2];
  let v3 = v[at + 3];
  let v4 = v[at + 4];
  let v5 = v[at + 5];
  let v6 = v[at + 6];
  let v7 = v[at + 7];
  let contract = false;
  let r0 = 0, g0 = 0, b0 = 0, a0 = 255, r1 = 0, g1 = 0, b1 = 0, a1 = 255;
  if (cem === 0) {
    r0 = g0 = b0 = v0;
    r1 = g1 = b1 = v1;
  } else if (cem === 1) {
    r0 = g0 = b0 = (v0 >> 2) | (v1 & 0xc0);
    r1 = g1 = b1 = r0 + (v1 & 0x3f);
  } else if (cem === 4) {
    r0 = g0 = b0 = v0;
    r1 = g1 = b1 = v1;
    a0 = v2;
    a1 = v3;
  } else if (cem === 5) {
    // bit_transfer_signed: the first of a pair gets the top bit of the second, which becomes a signed offset.
    v0 = (v0 >> 1) | (v1 & 0x80);
    v1 = ((v1 >> 1) & 0x3f) - (v1 & 0x40);
    v2 = (v2 >> 1) | (v3 & 0x80);
    v3 = ((v3 >> 1) & 0x3f) - (v3 & 0x40);
    r0 = g0 = b0 = v0;
    r1 = g1 = b1 = v0 + v1;
    a0 = v2;
    a1 = v2 + v3;
  } else if (cem === 6 || cem === 10) {
    r0 = (v0 * v3) >> 8;
    g0 = (v1 * v3) >> 8;
    b0 = (v2 * v3) >> 8;
    r1 = v0;
    g1 = v1;
    b1 = v2;
    if (cem === 10) {
      a0 = v4;
      a1 = v5;
    }
  } else if (cem === 8 || cem === 12) {
    if (cem === 8) v6 = v7 = 255;
    if (v1 + v3 + v5 >= v0 + v2 + v4) {
      r0 = v0, g0 = v2, b0 = v4, a0 = v6;
      r1 = v1, g1 = v3, b1 = v5, a1 = v7;
    } else {
      contract = true;
      r0 = v1, g0 = v3, b0 = v5, a0 = v7;
      r1 = v0, g1 = v2, b1 = v4, a1 = v6;
    }
  } else {
    // 9 and 13, base and offset.
    v0 = (v0 >> 1) | (v1 & 0x80);
    v1 = ((v1 >> 1) & 0x3f) - (v1 & 0x40);
    v2 = (v2 >> 1) | (v3 & 0x80);
    v3 = ((v3 >> 1) & 0x3f) - (v3 & 0x40);
    v4 = (v4 >> 1) | (v5 & 0x80);
    v5 = ((v5 >> 1) & 0x3f) - (v5 & 0x40);
    if (cem === 13) {
      v6 = (v6 >> 1) | (v7 & 0x80);
      v7 = ((v7 >> 1) & 0x3f) - (v7 & 0x40);
    } else {
      v6 = 255;
      v7 = 0;
    }
    if (v1 + v3 + v5 >= 0) {
      r0 = v0, g0 = v2, b0 = v4, a0 = v6;
      r1 = v0 + v1, g1 = v2 + v3, b1 = v4 + v5, a1 = v6 + v7;
    } else {
      contract = true;
      r0 = v0 + v1, g0 = v2 + v3, b0 = v4 + v5, a0 = v6 + v7;
      r1 = v0, g1 = v2, b1 = v4, a1 = v6;
    }
  }
  if (contract) {
    // blue_contract: red and green are stored as their distance from blue, which is finer near grey.
    r0 = (r0 + b0) >> 1;
    g0 = (g0 + b0) >> 1;
    r1 = (r1 + b1) >> 1;
    g1 = (g1 + b1) >> 1;
  }
  const clamp = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : x);
  e[to] = clamp(r0);
  e[to + 1] = clamp(g0);
  e[to + 2] = clamp(b0);
  e[to + 3] = clamp(a0);
  e[to + 4] = clamp(r1);
  e[to + 5] = clamp(g1);
  e[to + 6] = clamp(b1);
  e[to + 7] = clamp(a1);
}

// ---- The decoder ----

/** What a block is, as the decoder read it. */
export interface AstcBlockInfo {
  valid: boolean;
  /** A void-extent block: one colour. */
  solid: boolean;
  partitions: number;
  pattern: number;
  /** The colour endpoint mode of each partition. */
  modes: number[];
  /** The channel with weights of its own, or -1. */
  secondPlane: number;
  gridWidth: number;
  gridHeight: number;
  /** How many levels a weight and an endpoint value have. */
  weightLevels: number;
  colourLevels: number;
}

const info: AstcBlockInfo = { valid: false, solid: false, partitions: 0, pattern: 0, modes: [], secondPlane: -1, gridWidth: 0, gridHeight: 0, weightLevels: 0, colourLevels: 0 };
const dBit = new Uint8Array(128);
const dStream = new Uint8Array(192);
const dValues = new Int32Array(32);
const dWeights = new Int32Array(72);
const dEnds = new Int32Array(32);
const dModes = new Int32Array(4);

function field(at: number, count: number): number {
  let v = 0;
  for (let i = 0; i < count; i++) v |= dBit[at + i] << i;
  return v;
}

/** The error colour, C.2.5: opaque magenta. */
function invalid(out: Uint16Array, pixels: number): boolean {
  for (let i = 0; i < pixels * 4; i += 4) {
    out[i] = out[i + 2] = out[i + 3] = 0xffff;
    out[i + 1] = 0;
  }
  return false;
}

/** Decodes the block at `blocks[at]`, `side` pixels across, to its pixels' red, green, blue and alpha as the 16-bit
 *  results of C.2.19, rows top to bottom. Returns false, with the error colour in `out`, for a block the format does
 *  not allow. It also returns false for a block with a high dynamic range mode in some partition: those pixels are the
 *  error colour and the others are decoded, as C.2.24 asks of this profile.
 *
 *  This reads everything a low dynamic range block can be: every weight grid and range, one or two planes, one to four
 *  partitions with one mode or a mode each, all ten endpoint modes, and void-extent blocks.
 *
 *  `srgb` chooses how an end colour's 8 bits become 16 before they are blended: with 0x80 under them, as the sRGB
 *  format does, or repeated. The specification keeps alpha out of the first; the GPU this was checked on does not,
 *  and this follows the GPU. With `srgb` false the alpha is the specification's in either format. */
export function decodeAstcBlock16(blocks: Uint8Array, at: number, side: number, srgb: boolean, out: Uint16Array): boolean {
  const fp = footprint(side);
  const pixels = fp.pixels;
  for (let i = 0; i < 128; i++) dBit[i] = (blocks[at + (i >> 3)] >> (i & 7)) & 1;
  info.valid = info.solid = false;
  info.partitions = 0;
  const mode = field(0, 11);
  if ((mode & 0x1ff) === 0x1fc) {
    // A void-extent block, C.2.23. Bit 9 says the colour is high dynamic range, bits 10 and 11 must be set, and the
    // four coordinates are either all ones or a low below a high on each axis.
    const s0 = field(12, 13);
    const s1 = field(25, 13);
    const t0 = field(38, 13);
    const t1 = field(51, 13);
    const none = s0 === 8191 && s1 === 8191 && t0 === 8191 && t1 === 8191;
    if (dBit[9] || !dBit[10] || !dBit[11] || (!none && (s0 >= s1 || t0 >= t1))) return invalid(out, pixels);
    for (let i = 0; i < pixels * 4; i++) out[i] = field(64 + (i & 3) * 16, 16);
    info.valid = info.solid = true;
    return true;
  }
  if (!readMode(mode) || modeW > side || modeH > side) return invalid(out, pixels);
  const w = modeW;
  const h = modeH;
  const dual = modeDual;
  const wRange = modeRange;
  const weights = w * h * (dual + 1);
  const wBits = iseBits(wRange, weights);
  const parts = field(11, 2) + 1;
  if (weights > 64 || wBits < 24 || wBits > 96 || (dual && parts === 4)) return invalid(out, pixels);

  // The colour endpoint modes, C.2.11, and how many bits are left for the colours, C.2.22.
  let config = 17;
  let colourAt = 17;
  let extra = 0;
  let pattern = 0;
  if (parts === 1) dModes[0] = field(13, 4);
  else {
    pattern = field(13, 10);
    colourAt = 29;
    const low = field(23, 6);
    if ((low & 3) === 0) {
      config = 29;
      for (let p = 0; p < parts; p++) dModes[p] = low >> 2;
    } else {
      extra = 3 * parts - 4;
      config = 25 + 3 * parts;
      const all = low | (field(128 - wBits - extra, extra) << 6);
      for (let p = 0; p < parts; p++) dModes[p] = (((all & 3) - 1 + ((all >> (2 + p)) & 1)) << 2) | ((all >> (2 + parts + 2 * p)) & 3);
    }
  }
  if (dual) config += 2;
  let values = 0;
  for (let p = 0; p < parts; p++) values += ((dModes[p] >> 2) + 1) * 2;
  const left = 128 - config - wBits;
  if (values > 18 || left < iseBits(FIRST_COLOUR_RANGE, values)) return invalid(out, pixels);
  let cRange = LAST_RANGE;
  while (iseBits(cRange, values) > left) cRange--;
  const second = dual ? field(128 - wBits - extra - 2, 2) : -1;

  dStream.fill(0);
  const cBits = iseBits(cRange, values);
  for (let i = 0; i < cBits; i++) dStream[i] = dBit[colourAt + i];
  iseDecode(dStream, 0, cRange, values, dValues);
  for (let i = 0; i < values; i++) dValues[i] = COLOUR_VALUE[cRange][dValues[i]];
  // The weights are read from the top of the block downwards, C.2.16.
  dStream.fill(0);
  for (let i = 0; i < wBits; i++) dStream[i] = dBit[127 - i];
  iseDecode(dStream, 0, wRange, weights, dWeights);
  for (let i = 0; i < weights; i++) dWeights[i] = WEIGHT_VALUE[wRange][dWeights[i]];

  let hdr = 0;
  for (let p = 0, from = 0; p < parts; p++) {
    const cem = dModes[p];
    if (CEM_NAMES[cem] === undefined) hdr |= 1 << p;
    else endColours(cem, dValues, from, dEnds, p * 8);
    from += ((cem >> 2) + 1) * 2;
  }
  const g = gridOf(fp, w, h);
  const gAt = fp.at[g]!;
  const gBy = fp.by[g]!;
  const part = fp.partition[parts]![pattern]!;
  for (let i = 0; i < pixels; i++) {
    const p = part[i];
    const e = p * 8;
    for (let c = 0; c < 4; c++) {
      // In a block with two planes the stored weights alternate: first plane, second plane.
      const plane = c === second ? 1 : 0;
      let weight = 8;
      for (let k = 0; k < 4; k++) weight += dWeights[gAt[i * 4 + k] * (dual + 1) + plane] * gBy[i * 4 + k];
      weight >>= 4;
      const c0 = srgb ? (dEnds[e + c] << 8) | 0x80 : dEnds[e + c] * 257;
      const c1 = srgb ? (dEnds[e + 4 + c] << 8) | 0x80 : dEnds[e + 4 + c] * 257;
      // A partition with a high dynamic range mode shows the error colour in this profile, C.2.24.
      out[i * 4 + c] = hdr & (1 << p) ? (c === 1 ? 0 : 0xffff) : (c0 * (64 - weight) + c1 * weight + 32) >> 6;
    }
  }
  info.valid = hdr === 0;
  info.partitions = parts;
  info.pattern = pattern;
  info.modes = Array.from(dModes.subarray(0, parts));
  info.secondPlane = second;
  info.gridWidth = w;
  info.gridHeight = h;
  info.weightLevels = LEVELS[wRange];
  info.colourLevels = LEVELS[cRange];
  return hdr === 0;
}

/** Through a 16-bit float, as C.2.19 has it: 65535 is one, anything else is divided by 65536 and cut to the float's 11
 *  bits. Then to 8 bits, rounding. */
export function astcFloat8(c: number): number {
  if (c === 65535) return 255;
  for (let cut = 5; cut > 0; cut--) {
    if (c >> (cut + 10)) {
      c &= ~((1 << cut) - 1);
      break;
    }
  }
  return (c * 255 + 32768) >> 16;
}

const d16 = new Uint16Array(256);

/** Decodes one block to its pixels as 8-bit RGBA at `out[to]`, as a GPU shows them. False for a block that is not valid.
 *
 *  The specification lets a GPU make 8 bits of a 16-bit result in more than one way. This is what Apple silicon
 *  does, read from it with `bun run probe -- --textured`: the sRGB format takes the top 8 bits of all four channels,
 *  and the linear format goes through a 16-bit float. A GPU that chooses otherwise differs by one level at most. */
export function decodeAstcBlock(blocks: Uint8Array, at: number, side: number, srgb: boolean, out: Uint8Array, to = 0): boolean {
  const ok = decodeAstcBlock16(blocks, at, side, srgb, d16);
  for (let i = 0; i < side * side * 4; i++) out[to + i] = srgb ? d16[i] >> 8 : astcFloat8(d16[i]);
  return ok;
}

/** What the block at `blocks[at]` is. */
export function astcBlockInfo(blocks: Uint8Array, at: number, side: number): AstcBlockInfo {
  decodeAstcBlock16(blocks, at, side, false, d16);
  return { ...info, modes: info.modes.slice() };
}

/** A line about a block, for reports: "2 parts rgb 4x4 weights 8 colours 16". */
export function describeAstcBlock(blocks: Uint8Array, at: number, side: number): string {
  const b = astcBlockInfo(blocks, at, side);
  if (b.solid) return "solid";
  if (b.partitions === 0) return "invalid";
  const modes = b.modes.map((m) => CEM_NAMES[m] ?? "hdr");
  const mode = modes.every((m) => m === modes[0]) ? modes[0] : modes.join("+");
  return `${b.partitions} part${b.partitions > 1 ? "s" : ""} ${mode}${b.secondPlane >= 0 ? " two planes" : ""} ${b.gridWidth}x${b.gridHeight} weights ${b.weightLevels} colours ${b.colourLevels}`;
}

/** Blocks in a picture of blocks `side` across: its last column and row of blocks may hang over its edge. */
export function astcBlockCount(width: number, height: number, side: number): number {
  return Math.ceil(width / side) * Math.ceil(height / side);
}

/** Decodes a picture to 8-bit RGBA. For `normal`, x comes back in red, green and blue and y in alpha. */
export function decodeAstc(blocks: Uint8Array, width: number, height: number, kind: AstcKind, side: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const across = Math.ceil(width / side);
  const block = new Uint8Array(side * side * 4);
  for (let b = 0; b * 16 < blocks.length; b++) {
    decodeAstcBlock(blocks, b * 16, side, kind === "srgb", block);
    const bx = (b % across) * side;
    const by = ((b / across) | 0) * side;
    for (let i = 0; i < side * side; i++) {
      const x = bx + (i % side);
      const y = by + ((i / side) | 0);
      if (x < width && y < height) out.set(block.subarray(i * 4, i * 4 + 4), (y * width + x) * 4);
    }
  }
  return out;
}

// ---- The encoder ----

/** CONFIGS: which ways of spending the bits are worth trying, for a number of partitions, a kind of end colour (1 to 4
 *  channels), one or two planes of weights and a grid: pairs of a weight range and the colour range it leaves room
 *  for. A pair is left out when no block mode has it, or another has finer weights and colours at least as fine. */
function configsFor(fp: Footprint, parts: number, channels: number, planes: number, g: number): Int32Array {
  const pairs: number[] = [];
  const weights = fp.grids[g]![0] * fp.grids[g]![1] * planes;
  const values = parts * channels * 2;
  let finest = -1;
  for (let wRange = WEIGHT_RANGES - 1; wRange >= 0; wRange--) {
    const wBits = iseBits(wRange, weights);
    const left = 128 - (parts === 1 ? 17 : 29) - (planes - 1) * 2 - wBits;
    if (fp.mode[(g * WEIGHT_RANGES + wRange) * 2 + planes - 1]! < 0 || weights > 64 || wBits < 24 || wBits > 96 || values > 18 || left < iseBits(FIRST_COLOUR_RANGE, values)) continue;
    let cRange = LAST_RANGE;
    while (iseBits(cRange, values) > left) cRange--;
    if (cRange > finest) pairs.push(wRange, cRange);
    finest = Math.max(finest, cRange);
  }
  return Int32Array.from(pairs);
}

/** Mean squared error of a value rounded to a range's steps, for the estimates: weights as a share of the line, and
 *  colours in levels. */
const WEIGHT_STEP = LEVELS.map((n) => 1 / ((n - 1) * (n - 1) * 12));
const COLOUR_STEP = LEVELS.map((n) => (255 * 255) / ((n - 1) * (n - 1) * 12));
/** How much of that error is left once a trial has fitted the ends to the weights, set by what encoded our test
 *  textures best: for colours, again for colours on lines short enough to store as base and offset, and for the
 *  weights of a smaller grid. */
const COLOUR_SHARE = 0.15;
const SHORT_SHARE = 0.5;
const GRID_SHARE = 0.5;

/** What 8 bits a GPU shows for the sum `e0 * (64 - w) + e1 * w` of two 8-bit end values, in each format: what
 *  decodeAstcBlock does, by table. */
const SHOWN_SRGB = new Uint8Array(16321);
const SHOWN_LINEAR = new Uint8Array(16321);
for (let s = 0; s <= 16320; s++) {
  SHOWN_SRGB[s] = (s * 256 + 0x80 * 64 + 32) >> 14;
  SHOWN_LINEAR[s] = astcFloat8((s * 257 + 32) >> 6);
}

/** A way of splitting a block into lines: its partitions, and whether one channel has weights of its own. With it,
 *  the weight each pixel would have if nothing were rounded. */
interface Fit {
  parts: number;
  pattern: number;
  part: Uint8Array;
  /** The channel on the second plane, as an index into the block's channels, or -1. */
  second: number;
  /** Ideal weights, 0 to 1: the first plane's, one a pixel, then the second's. */
  u: Float64Array;
  /** Squared length of each line: the first plane's by partition from 0, the second's from 4. */
  len2: Float64Array;
  /** Squared error of the lines themselves. */
  base: number;
  /** What each grid's weights miss of the ideal ones (gridCost), where it has been measured, else -1. */
  miss: Float64Array;
}

// The footprint of the blocks being encoded, and its pixels.
let fp: Footprint;
let N = 16;

/** Fits to reuse. 0 is one line through the block and 1 to 4 have a channel on a plane of its own. 7 is the pixels'
 *  own grouping, and from 8 on are partition patterns. */
const fits: Fit[] = [];
for (let i = 0; i < 12; i++) fits.push({ parts: 1, pattern: 0, part: new Uint8Array(64), second: -1, u: new Float64Array(128), len2: new Float64Array(8), base: 0, miss: new Float64Array(64) });

// The block being encoded. Its pixels, and the channels that vary: `channels` of them, each read from `chan[c]` of
// a pixel and weighing `cw[c]` in the error. `fx` holds them scaled by the square root of that weight.
const px = new Int32Array(256);
const fx = new Float64Array(256);
let channels = 0;
let cem = 0;
const chan = new Int32Array(4);
const cw = new Float64Array(4);
let cwSum = 0;
let shown = SHOWN_LINEAR;

const fCount = new Float64Array(3);
const fSum = new Float64Array(12);
const fCov = new Float64Array(48);
const fMean = new Float64Array(12);
const fDir = new Float64Array(12);
const fAlong = new Float64Array(64);
const fLow = new Float64Array(8);
const fHigh = new Float64Array(8);
const vec = new Float64Array(4);
const vec2 = new Float64Array(4);

/** Fits a line through each partition's pixels, by the main axis of their spread. */
function fit(f: Fit): void {
  const { parts, part, second } = f;
  fCount.fill(0);
  fSum.fill(0);
  fCov.fill(0);
  for (let i = 0; i < N; i++) {
    const p = part[i];
    const o = i * 4;
    fCount[p]++;
    for (let c = 0; c < channels; c++) {
      const x = fx[o + c];
      fSum[p * 4 + c] += x;
      for (let d = c; d < channels; d++) fCov[p * 16 + c * 4 + d] += x * fx[o + d];
    }
  }
  let spread = 0;
  for (let p = 0; p < parts; p++) {
    const n = fCount[p];
    const m = p * 16;
    for (let c = 0; c < channels; c++) fMean[p * 4 + c] = fSum[p * 4 + c] / n;
    for (let c = 0; c < channels; c++) {
      for (let d = c; d < channels; d++) {
        const v = c === second || d === second ? 0 : fCov[m + c * 4 + d] - n * fMean[p * 4 + c] * fMean[p * 4 + d];
        fCov[m + c * 4 + d] = fCov[m + d * 4 + c] = v;
      }
    }
    // Power iteration from the row of the channel that varies most.
    let top = -1;
    let most = 0;
    for (let c = 0; c < channels; c++) {
      spread += fCov[m + c * 5];
      if (fCov[m + c * 5] > most) {
        most = fCov[m + c * 5];
        top = c;
      }
    }
    for (let c = 0; c < channels; c++) vec[c] = top < 0 ? 0 : fCov[m + top * 4 + c];
    for (let it = 0; it < 6 && channels > 1; it++) {
      for (let c = 0; c < channels; c++) {
        let s = 0;
        for (let d = 0; d < channels; d++) s += fCov[m + c * 4 + d] * vec[d];
        vec2[c] = s;
      }
      for (let c = 0; c < channels; c++) vec[c] = vec2[c];
    }
    let norm = 0;
    for (let c = 0; c < channels; c++) norm += vec[c] * vec[c];
    norm = Math.sqrt(norm);
    for (let c = 0; c < channels; c++) fDir[p * 4 + c] = norm > 0 ? vec[c] / norm : 0;
  }
  fLow.fill(Infinity);
  fHigh.fill(-Infinity);
  let along = 0;
  for (let i = 0; i < N; i++) {
    const p = part[i];
    const o = i * 4;
    let t = 0;
    for (let c = 0; c < channels; c++) t += (fx[o + c] - fMean[p * 4 + c]) * fDir[p * 4 + c];
    fAlong[i] = t;
    along += t * t;
    if (t < fLow[p]) fLow[p] = t;
    if (t > fHigh[p]) fHigh[p] = t;
    if (second >= 0) {
      const x = fx[o + second];
      if (x < fLow[4 + p]) fLow[4 + p] = x;
      if (x > fHigh[4 + p]) fHigh[4 + p] = x;
    }
  }
  f.base = Math.max(0, spread - along);
  f.miss.fill(-1);
  for (let p = 0; p < parts; p++) {
    const a = fHigh[p] - fLow[p];
    const b = second >= 0 ? fHigh[4 + p] - fLow[4 + p] : 0;
    f.len2[p] = a * a;
    f.len2[4 + p] = b * b;
    fHigh[p] = a > 0 ? 1 / a : 0;
    fHigh[4 + p] = b > 0 ? 1 / b : 0;
  }
  for (let i = 0; i < N; i++) {
    const p = part[i];
    f.u[i] = (fAlong[i] - fLow[p]) * fHigh[p];
    f.u[N + i] = second >= 0 ? (fx[i * 4 + second] - fLow[4 + p]) * fHigh[4 + p] : 0;
  }
}

/** The error rounding a fit's ideal weights to a range would add, with a weight for every pixel. */
function weightCost(f: Fit, wRange: number): number {
  const near = WEIGHT_NEAR[wRange];
  const { u, len2, part } = f;
  const planes = f.second >= 0 ? 2 : 1;
  let cost = 0;
  for (let plane = 0; plane < planes; plane++) {
    for (let i = 0; i < N; i++) {
      const w = u[plane * N + i];
      const d = w - near[(w * 256 + 0.5) | 0] * (1 / 64);
      cost += len2[plane * 4 + part[i]] * d * d;
    }
  }
  return cost;
}

const gridWeights = new Float64Array(64);
const gridRows = new Float64Array(64);

/** The weights a grid stores that come closest to the wanted weights `want[o..]`, into gridWeights. Past 4 by 4 they
 *  are fitted along rows and then down columns, which is nearly as close and far quicker. */
function fitGrid(g: number, want: Float64Array, o: number): void {
  const gw = fp.grids[g]![0];
  const gh = fp.grids[g]![1];
  const side = fp.side;
  if (side === 4) {
    const inverse = fp.inverse[g]!;
    for (let j = 0; j < gw * gh; j++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += inverse[j * N + i] * want[o + i];
      gridWeights[j] = s;
    }
    return;
  }
  const px = fp.across[gw]!;
  const py = fp.across[gh]!;
  for (let y = 0; y < side; y++) {
    for (let j = 0; j < gw; j++) {
      let s = 0;
      for (let x = 0; x < side; x++) s += px[j * side + x] * want[o + y * side + x];
      gridRows[y * gw + j] = s;
    }
  }
  for (let k = 0; k < gh; k++) {
    for (let j = 0; j < gw; j++) {
      let s = 0;
      for (let y = 0; y < side; y++) s += py[k * side + y] * gridRows[y * gw + j];
      gridWeights[k * gw + j] = s;
    }
  }
}

/** The error a smaller grid adds to a fit before any rounding: its best weights cannot follow the ideal ones exactly. */
function gridCost(f: Fit, g: number): number {
  const at = fp.at[g]!;
  const by = fp.by[g]!;
  const planes = f.second >= 0 ? 2 : 1;
  let cost = 0;
  for (let plane = 0; plane < planes; plane++) {
    const o = plane * N;
    fitGrid(g, f.u, o);
    let miss = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 4;
      const d = f.u[o + i] - (gridWeights[at[k]] * by[k] + gridWeights[at[k + 1]] * by[k + 1] + gridWeights[at[k + 2]] * by[k + 2] + gridWeights[at[k + 3]] * by[k + 3]) * (1 / 16);
      // A share of a line is as long as its partition's line.
      if (f.parts === 1) miss += d * d;
      else cost += d * d * f.len2[plane * 4 + f.part[i]];
    }
    cost += miss * f.len2[plane * 4];
  }
  return cost;
}

// The candidates: the ways of spending the bits with the lowest estimated error, best first.
const MOST = 8;
const candCost = new Float64Array(MOST);
const candFit: Fit[] = new Array<Fit>(MOST).fill(fits[0]!);
const candGrid = new Int32Array(MOST);
const candW = new Int32Array(MOST);
const candC = new Int32Array(MOST);
let cands = 0;

function offer(cost: number, f: Fit, g: number, wRange: number, cRange: number, keep: number): void {
  let at = cands;
  while (at > 0 && candCost[at - 1] > cost) at--;
  if (at >= keep) return;
  if (cands < keep) cands++;
  for (let k = cands - 1; k > at; k--) {
    candCost[k] = candCost[k - 1];
    candFit[k] = candFit[k - 1]!;
    candGrid[k] = candGrid[k - 1];
    candW[k] = candW[k - 1];
    candC[k] = candC[k - 1];
  }
  candCost[at] = cost;
  candFit[at] = f;
  candGrid[at] = g;
  candW[at] = wRange;
  candC[at] = cRange;
}

/** Offers every way of spending the bits on a fit with a grid. */
function consider(f: Fit, g: number, keep: number): void {
  const pairs = fp.configs[((f.parts - 1) * 4 + channels - 1) * 2 + (f.second >= 0 ? 1 : 0)]![g]!;
  if (pairs.length === 0) return;
  // Ends under 30 levels apart can be stored as base and offset, which is a bit finer.
  let longest = 0;
  for (let p = 0; p < f.parts; p++) longest = Math.max(longest, f.len2[p], f.len2[4 + p]);
  const ends = N * cwSum * COLOUR_SHARE * (longest < 900 ? SHORT_SHARE : 1);
  if (g === 0) {
    for (let k = 0; k < pairs.length; k += 2) offer(f.base + weightCost(f, pairs[k]) + ends * COLOUR_STEP[pairs[k + 1]]!, f, g, pairs[k], pairs[k + 1], keep);
    return;
  }
  // A smaller grid is worth measuring only if it could beat the worst candidate kept with no error of its own.
  let lines = N * GRID_SHARE * (f.len2[0] + f.len2[4]);
  if (f.parts > 1) {
    lines = 0;
    for (let i = 0; i < N; i++) lines += f.len2[f.part[i]] + f.len2[4 + f.part[i]];
    lines *= GRID_SHARE;
  }
  let least = Infinity;
  for (let k = 0; k < pairs.length; k += 2) least = Math.min(least, lines * WEIGHT_STEP[pairs[k]]! + ends * COLOUR_STEP[pairs[k + 1]]!);
  // Past 4 by 4, what a grid that holds this one misses is about the least this one can.
  let floor = 0;
  if (fp.side > 4) for (const o of fp.over[g]!) floor = Math.max(floor, f.miss[o]);
  if (cands === keep && f.base + floor + least >= candCost[keep - 1]) return;
  const miss = f.base + (f.miss[g] = gridCost(f, g));
  for (let k = 0; k < pairs.length; k += 2) offer(miss + lines * WEIGHT_STEP[pairs[k]]! + ends * COLOUR_STEP[pairs[k + 1]]!, f, g, pairs[k], pairs[k + 1], keep);
}

// A trial: one way of spending the bits, carried through to the pixels a GPU would show.
const tWant = new Float64Array(128);
const tWeight = new Int32Array(128);
const tStored = new Int32Array(128);
const tValues = new Int32Array(24);
const tEnds = new Int32Array(24);
let tCem = 0;
let tSecond = -1;
const sAA = new Float64Array(6);
const sAB = new Float64Array(6);
const sBB = new Float64Array(6);
const sA = new Float64Array(12);
const sB = new Float64Array(12);
/** The two ends each channel of a partition wants, before rounding. */
const wantA = new Float64Array(4);
const wantB = new Float64Array(4);
const qA = new Int32Array(4);
const qB = new Int32Array(4);
/** Each partition's values stored directly, and stored as base and offset: eight to a partition. */
const vDirect = new Int32Array(24);
const vOffset = new Int32Array(24);
const vTry = new Int32Array(8);
const eTry = new Int32Array(8);

// The best block found so far.
let bestError = Infinity;
let bestParts = 1;
let bestPattern = 0;
let bestSecond = -1;
let bestGrid = 0;
let bestW = 0;
let bestC = 0;
let bestCem = 0;
const bestValues = new Int32Array(24);
const bestStored = new Int32Array(128);

/** Rounds the wanted weights to what a grid and a range can store, and works out the weight each pixel then gets. */
function placeWeights(g: number, wRange: number, planes: number): void {
  const near = WEIGHT_NEAR[wRange];
  if (g === 0) {
    for (let i = 0; i < planes * N; i++) tWeight[i] = tStored[i] = near[(tWant[i] * 256 + 0.5) | 0];
    return;
  }
  const count = fp.grids[g]![0] * fp.grids[g]![1];
  const at = fp.at[g]!;
  const by = fp.by[g]!;
  for (let plane = 0; plane < planes; plane++) {
    const o = plane * N;
    fitGrid(g, tWant, o);
    for (let j = 0; j < count; j++) {
      const s = gridWeights[j];
      tStored[o + j] = near[((s < 0 ? 0 : s > 1 ? 1 : s) * 256 + 0.5) | 0];
    }
    for (let i = 0; i < N; i++) {
      const k = i * 4;
      tWeight[o + i] = (tStored[o + at[k]] * by[k] + tStored[o + at[k + 1]] * by[k + 1] + tStored[o + at[k + 2]] * by[k + 2] + tStored[o + at[k + 3]] * by[k + 3] + 8) >> 4;
    }
  }
}

/** The squared error, less a constant, of giving channel `c` of partition `p` the ends `e0` and `e1` while the
 *  weights stay as they are. */
function miss(p: number, c: number, e0: number, e1: number): number {
  const s = (c === tSecond ? 3 : 0) + p;
  return sAA[s] * e0 * e0 + 2 * sAB[s] * e0 * e1 + sBB[s] * e1 * e1 - 2 * sA[p * 4 + c] * e0 - 2 * sB[p * 4 + c] * e1;
}

/** The same for all of a partition's channels, from decoded ends. The ends may be the other way round: the weights
 *  are chosen again once the ends are known. */
function missOf(p: number, e: Int32Array): number {
  let one = 0;
  let other = 0;
  for (let c = 0; c < channels; c++) {
    one += miss(p, c, e[chan[c]], e[4 + chan[c]]);
    other += miss(p, c, e[4 + chan[c]], e[chan[c]]);
  }
  return one < other ? one : other;
}

// What a search for one channel's pair of values found: the two values to store and, for a base and offset, the
// base and the base plus offset they decode to.
let pairLow = 0;
let pairHigh = 0;
let pairBase = 0;
let pairOther = 0;

/** Rounds the two ends of a channel to values a range can store: each down or up, whichever of the four ways misses
 *  least. With `contract` the values are ones the decoder will halve towards the blues given. */
function directPair(p: number, c: number, cRange: number, a: number, b: number, blueA: number, blueB: number, contract: boolean): number {
  const down = COLOUR_DOWN[cRange];
  const up = COLOUR_UP[cRange];
  const a0 = down[a | 0];
  const a1 = up[Math.ceil(a)];
  const b0 = down[b | 0];
  const b1 = up[Math.ceil(b)];
  let least = Infinity;
  for (let k = 0; k < 4; k++) {
    const qa = k & 1 ? a1 : a0;
    const qb = k & 2 ? b1 : b0;
    const e = contract ? miss(p, c, (qa + blueA) >> 1, (qb + blueB) >> 1) : miss(p, c, qa, qb);
    if (e < least) {
      least = e;
      pairLow = qa;
      pairHigh = qb;
    }
  }
  return least;
}

/** The same for a channel stored as a base and an offset, C.2.14: the second value carries the base's top bit above
 *  an offset of -32 to 31, and the first carries the rest of the base. `base` and `other` are what the base and the
 *  base plus offset should come to; `baseIsA` says which end of the line the base is. */
function offsetPair(p: number, c: number, cRange: number, base: number, other: number, blueBase: number, blueOther: number, contract: boolean, baseIsA: boolean): number {
  const down = COLOUR_DOWN[cRange];
  const up = COLOUR_UP[cRange];
  const whole = (base + 0.5) | 0;
  const top = whole & 0x80;
  const x = (whole & 0x7f) << 1;
  let least = Infinity;
  for (let k = 0; k < 2; k++) {
    const v0 = k ? up[x] : down[x | 1];
    const got = (v0 >> 1) | top;
    let off = Math.floor(other + 0.5) - got;
    off = off < -32 ? -32 : off > 31 ? 31 : off;
    const y = top | ((off & 0x3f) << 1);
    for (let j = 0; j < 2; j++) {
      const v1 = j ? up[y] : down[y | 1];
      if ((v1 & 0x80) !== top) continue;
      const sum = got + ((v1 >> 1) & 0x3f) - (v1 & 0x40);
      let e0 = contract ? (got + blueBase) >> 1 : got;
      let e1 = contract ? (sum + blueOther) >> 1 : sum;
      e0 = e0 < 0 ? 0 : e0 > 255 ? 255 : e0;
      e1 = e1 < 0 ? 0 : e1 > 255 ? 255 : e1;
      const e = baseIsA ? miss(p, c, e0, e1) : miss(p, c, e1, e0);
      if (e < least) {
        least = e;
        pairLow = v0;
        pairHigh = v1;
        pairBase = got;
        pairOther = sum;
      }
    }
  }
  return least;
}

/** Direct colours with blue_contract: red and green are stored as twice themselves less blue, which is finer when a
 *  colour is near grey. The decoder contracts when the second colour stored sums to less than the first. Leaves the
 *  values in vTry and returns their miss, or Infinity when the colours cannot be stored this way. */
function contractedEnds(p: number, cRange: number): number {
  for (let c = 0; c < 2; c++) {
    const a = 2 * wantA[c] - qA[2];
    const b = 2 * wantB[c] - qB[2];
    if (a < 0 || a > 255 || b < 0 || b > 255) return Infinity;
    directPair(p, c, cRange, a, b, qA[2], qB[2], true);
    vTry[c * 2] = pairLow;
    vTry[c * 2 + 1] = pairHigh;
  }
  for (let c = 2; c < channels; c++) {
    vTry[c * 2] = qA[c];
    vTry[c * 2 + 1] = qB[c];
  }
  const first = vTry[0] + vTry[2] + vTry[4];
  const second = vTry[1] + vTry[3] + vTry[5];
  if (first === second) return Infinity;
  if (first < second) {
    for (let c = 0; c < channels; c++) {
      const swap = vTry[c * 2];
      vTry[c * 2] = vTry[c * 2 + 1];
      vTry[c * 2 + 1] = swap;
    }
  }
  endColours(cem, vTry, 0, eTry, 0);
  return missOf(p, eTry);
}

/** Base and offset: a bit finer than direct colours when the two ends are within 32 levels of each other. With
 *  `contract`, blue_contract as well, which the decoder applies when the offsets of red, green and blue sum below
 *  zero. Leaves the values in vTry and returns their miss. */
function offsetEnds(p: number, cRange: number, contract: boolean): number {
  let baseIsA = true;
  if (channels >= 3) {
    // Without contraction the base must be the end with the lower sum, so that the offsets do not sum below zero.
    // With it, the base must be the end whose stored values, twice red and green less blue, sum higher.
    const a = contract ? 2 * wantA[0] + 2 * wantA[1] - wantA[2] : wantA[0] + wantA[1] + wantA[2];
    const b = contract ? 2 * wantB[0] + 2 * wantB[1] - wantB[2] : wantB[0] + wantB[1] + wantB[2];
    if (contract && a === b) return Infinity;
    baseIsA = contract ? a > b : a <= b;
  }
  // Ends too far apart for an offset are not worth the search.
  for (let c = 0; c < channels; c++) {
    const apart = contract && c < 2 ? 2 * (wantB[c] - wantA[c]) - (wantB[2] - wantA[2]) : wantB[c] - wantA[c];
    if (apart > 34 || apart < -34) return Infinity;
  }
  let blueBase = 0;
  let blueOther = 0;
  // Blue goes first: when contracting, red and green are stored relative to the blues that were stored.
  for (let c = channels - 1; c >= 0; c--) {
    let base = baseIsA ? wantA[c] : wantB[c];
    let other = baseIsA ? wantB[c] : wantA[c];
    const halved = contract && c < 2;
    if (halved) {
      base = 2 * base - blueBase;
      other = 2 * other - blueOther;
      if (base < 0 || base > 255) return Infinity;
    }
    offsetPair(p, c, cRange, base, other, blueBase, blueOther, halved, baseIsA);
    vTry[c * 2] = pairLow;
    vTry[c * 2 + 1] = pairHigh;
    if (c === 2) {
      blueBase = pairBase;
      blueOther = pairOther;
    }
  }
  endColours(cem + 1, vTry, 0, eTry, 0);
  return missOf(p, eTry);
}

/** With the pixels' weights fixed, finds the end colours with the least squared error, then the values a range can
 *  store that come closest to them. Below 256 levels the ends can be stored in ways that are finer for some colours,
 *  and the way that misses least is taken. Base and offset is a mode of its own, so every partition has it or none. */
function placeEnds(f: Fit, cRange: number): void {
  const { parts, part, second } = f;
  tSecond = second;
  sAA.fill(0);
  sAB.fill(0);
  sBB.fill(0);
  sA.fill(0);
  sB.fill(0);
  for (let i = 0; i < N; i++) {
    const p = part[i];
    const o = i * 4;
    const w = tWeight[i] * (1 / 64);
    const v = 1 - w;
    sAA[p] += v * v;
    sAB[p] += v * w;
    sBB[p] += w * w;
    for (let c = 0; c < channels; c++) {
      if (c === second) continue;
      const x = px[o + chan[c]];
      sA[p * 4 + c] += v * x;
      sB[p * 4 + c] += w * x;
    }
    if (second >= 0) {
      const w1 = tWeight[N + i] * (1 / 64);
      const v1 = 1 - w1;
      const x = px[o + chan[second]];
      sAA[3 + p] += v1 * v1;
      sAB[3 + p] += v1 * w1;
      sBB[3 + p] += w1 * w1;
      sA[p * 4 + second] += v1 * x;
      sB[p * 4 + second] += w1 * x;
    }
  }
  const finer = cRange < LAST_RANGE && channels > 1;
  let direct = 0;
  let offset = 0;
  for (let p = 0; p < parts; p++) {
    let score = 0;
    for (let c = 0; c < channels; c++) {
      const s = (c === second ? 3 : 0) + p;
      const aa = sAA[s];
      const ab = sAB[s];
      const bb = sBB[s];
      const ra = sA[p * 4 + c];
      const rb = sB[p * 4 + c];
      const det = aa * bb - ab * ab;
      // When every pixel has the same weight the two ends cannot be told apart: both take the mean.
      const a = det > 1e-7 ? (ra * bb - rb * ab) / det : (ra + rb) / (aa + 2 * ab + bb);
      const b = det > 1e-7 ? (rb * aa - ra * ab) / det : a;
      wantA[c] = a < 0 ? 0 : a > 255 ? 255 : a;
      wantB[c] = b < 0 ? 0 : b > 255 ? 255 : b;
      score += directPair(p, c, cRange, wantA[c], wantB[c], 0, 0, false);
      qA[c] = pairLow;
      qB[c] = pairHigh;
    }
    // Direct colours whose second end sums lower would be read as blue-contracted, so they swap.
    const swap = channels >= 3 && qB[0] + qB[1] + qB[2] < qA[0] + qA[1] + qA[2];
    for (let c = 0; c < channels; c++) {
      vDirect[p * 8 + c * 2] = swap ? qB[c] : qA[c];
      vDirect[p * 8 + c * 2 + 1] = swap ? qA[c] : qB[c];
    }
    if (finer) {
      const contracted = channels >= 3 ? contractedEnds(p, cRange) : Infinity;
      if (contracted < score) {
        score = contracted;
        vDirect.set(vTry, p * 8);
      }
      let other = offsetEnds(p, cRange, false);
      vOffset.set(vTry, p * 8);
      const both = channels >= 3 ? offsetEnds(p, cRange, true) : Infinity;
      if (both < other) {
        other = both;
        vOffset.set(vTry, p * 8);
      }
      offset += other;
    }
    direct += score;
  }
  tCem = finer && offset < direct ? cem + 1 : cem;
  const from = tCem === cem ? vDirect : vOffset;
  const per = channels * 2;
  for (let p = 0; p < parts; p++) {
    for (let k = 0; k < per; k++) tValues[p * per + k] = from[p * 8 + k];
    endColours(tCem, tValues, p * per, tEnds, p * 8);
  }
}

/** With the end colours fixed, the weight each pixel wants: where it falls along the line between its two ends. */
function wantWeights(f: Fit): void {
  const { part, second } = f;
  for (let i = 0; i < N; i++) {
    const e = part[i] * 8;
    const o = i * 4;
    let num = 0;
    let den = 0;
    for (let c = 0; c < channels; c++) {
      const ch = chan[c];
      const d = tEnds[e + 4 + ch] - tEnds[e + ch];
      if (c === second) {
        const t = d !== 0 ? (px[o + ch] - tEnds[e + ch]) / d : 0;
        tWant[N + i] = t < 0 ? 0 : t > 1 ? 1 : t;
      } else {
        num += cw[c] * d * (px[o + ch] - tEnds[e + ch]);
        den += cw[c] * d * d;
      }
    }
    const t = den > 0 ? num / den : 0;
    tWant[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
}

/** The squared error of pixel `i` as the trial stands, against what a GPU would show. */
function pixelError(f: Fit, i: number): number {
  const e = f.part[i] * 8;
  const o = i * 4;
  let error = 0;
  for (let c = 0; c < channels; c++) {
    const ch = chan[c];
    const w = tWeight[c === f.second ? N + i : i];
    const d = shown[tEnds[e + ch] * (64 - w) + tEnds[e + 4 + ch] * w] - px[o + ch];
    error += cw[c] * d * d;
  }
  return error;
}

function trialError(f: Fit): number {
  let error = 0;
  for (let i = 0; i < N; i++) error += pixelError(f, i);
  return error;
}

/** Works out the weight of pixel `i` from the weights stored for a smaller grid, for the plane that starts at `o`. */
function infill(g: number, o: number, i: number): void {
  const at = fp.at[g]!;
  const by = fp.by[g]!;
  const k = i * 4;
  tWeight[o + i] = (tStored[o + at[k]] * by[k] + tStored[o + at[k + 1]] * by[k + 1] + tStored[o + at[k + 2]] * by[k + 2] + tStored[o + at[k + 3]] * by[k + 3] + 8) >> 4;
}

/** Keeps the trial as it stands if it is the best block so far. */
function keep(f: Fit, g: number, wRange: number, cRange: number, error: number): void {
  if (error >= bestError) return;
  bestError = error;
  bestParts = f.parts;
  bestPattern = f.pattern;
  bestSecond = f.second;
  bestGrid = g;
  bestW = wRange;
  bestC = cRange;
  bestCem = tCem;
  bestValues.set(tValues);
  bestStored.set(tStored);
}

// The best a trial reached, to come back to.
let rCem = 0;
const rValues = new Int32Array(24);
const rStored = new Int32Array(128);

/** How many times a trial fits its ends and weights to each other. It stops sooner when a round does not help. */
const ROUNDS = 3;
/** A trial on a smaller grid has its stored weights polished if it came this close to the best block so far. */
const POLISH_WITHIN = 1.25;

/** Carries one way of spending the bits through to its error, and keeps it if it is the best. */
function trial(f: Fit, g: number, wRange: number, cRange: number): void {
  const planes = f.second >= 0 ? 2 : 1;
  tWant.set(f.u);
  placeWeights(g, wRange, planes);
  let least = Infinity;
  for (let round = 0; round < ROUNDS; round++) {
    placeEnds(f, cRange);
    wantWeights(f);
    placeWeights(g, wRange, planes);
    const error = trialError(f);
    if (error >= least) break;
    least = error;
    if (g > 0) {
      rCem = tCem;
      rValues.set(tValues);
      rStored.set(tStored);
    }
    keep(f, g, wRange, cRange, error);
    if (error === 0) break;
  }
  if (g === 0 || least === 0 || least > bestError * POLISH_WITHIN) return;
  // On a smaller grid a stored weight reaches several pixels, and rounding each to its nearest level is not the best
  // for its neighbours. Each is tried one level down and one up against the pixels, and the ends are fitted once more
  // to the weights that come of it.
  tCem = rCem;
  tValues.set(rValues);
  tStored.set(rStored);
  endColours(tCem, tValues, 0, tEnds, 0);
  for (let plane = 0; plane < planes; plane++) for (let i = 0; i < N; i++) infill(g, plane * N, i);
  const reaches = fp.reach[g]!;
  const below = WEIGHT_BELOW[wRange];
  const above = WEIGHT_ABOVE[wRange];
  for (let plane = 0; plane < planes; plane++) {
    const o = plane * N;
    for (let j = 0; j < reaches.length; j++) {
      const reach = reaches[j]!;
      const was = tStored[o + j];
      let before = 0;
      for (let n = 0; n < reach.length; n++) before += pixelError(f, reach[n]);
      let best = was;
      let after = before;
      for (let side = 0; side < 2; side++) {
        const v = side ? above[was] : below[was];
        if (v === was) continue;
        tStored[o + j] = v;
        let error = 0;
        for (let n = 0; n < reach.length; n++) {
          infill(g, o, reach[n]);
          error += pixelError(f, reach[n]);
        }
        if (error < after) {
          after = error;
          best = v;
        }
      }
      tStored[o + j] = best;
      for (let n = 0; n < reach.length; n++) infill(g, o, reach[n]);
      least += after - before;
    }
  }
  keep(f, g, wRange, cRange, least);
  placeEnds(f, cRange);
  keep(f, g, wRange, cRange, trialError(f));
}

function runCandidates(): void {
  for (let k = 0; k < cands && bestError > 0; k++) trial(candFit[k]!, candGrid[k], candW[k], candC[k]);
  cands = 0;
}

const centre = new Float64Array(12);
const centreSum = new Float64Array(12);
const centreCount = new Int32Array(3);
const cluster = new Uint8Array(64);
const clusterMask = new Int32Array(6);
const nearCost = new Int32Array(1024);
const nearAt = new Int32Array(1024);
/** Pixels each of three groups shares with each of a pattern's three partitions. */
const shared3 = new Int32Array(9);

/** Sorts the pixels into `parts` groups of like colour, starting from the two ends of the block's line. */
function groupPixels(parts: number, line: Fit): void {
  let first = 0;
  let last = 0;
  for (let i = 1; i < N; i++) {
    if (line.u[i] < line.u[first]) first = i;
    if (line.u[i] > line.u[last]) last = i;
  }
  for (let c = 0; c < channels; c++) {
    centre[c] = fx[first * 4 + c];
    centre[4 + c] = fx[last * 4 + c];
  }
  if (parts === 3) {
    // The third starts at the pixel farthest from both.
    let far = 0;
    let farthest = -1;
    for (let i = 0; i < N; i++) {
      let d0 = 0;
      let d1 = 0;
      for (let c = 0; c < channels; c++) {
        d0 += (fx[i * 4 + c] - centre[c]) * (fx[i * 4 + c] - centre[c]);
        d1 += (fx[i * 4 + c] - centre[4 + c]) * (fx[i * 4 + c] - centre[4 + c]);
      }
      const d = Math.min(d0, d1);
      if (d > farthest) {
        farthest = d;
        far = i;
      }
    }
    for (let c = 0; c < channels; c++) centre[8 + c] = fx[far * 4 + c];
  }
  for (let round = 0; round < 3; round++) {
    centreSum.fill(0);
    centreCount.fill(0);
    for (let i = 0; i < N; i++) {
      let pick = 0;
      let least = Infinity;
      for (let k = 0; k < parts; k++) {
        let d = 0;
        for (let c = 0; c < channels; c++) d += (fx[i * 4 + c] - centre[k * 4 + c]) * (fx[i * 4 + c] - centre[k * 4 + c]);
        if (d < least) {
          least = d;
          pick = k;
        }
      }
      cluster[i] = pick;
      centreCount[pick]++;
      for (let c = 0; c < channels; c++) centreSum[pick * 4 + c] += fx[i * 4 + c];
    }
    for (let k = 0; k < parts; k++) if (centreCount[k] > 0) for (let c = 0; c < channels; c++) centre[k * 4 + c] = centreSum[k * 4 + c] / centreCount[k];
  }
  clusterMask.fill(0);
  for (let i = 0; i < N; i++) clusterMask[cluster[i] * fp.words + (i >> 5)] |= 1 << (i & 31);
}

/** Pixels that two masks of the footprint's share. */
function overlap(a: Int32Array, at: number, b: Int32Array, bt: number): number {
  let n = 0;
  for (let w = 0; w < fp.words; w++) n += pop32(a[at + w] & b[bt + w]);
  return n;
}

/** Patterns are fitted only if the pixels' own grouping is estimated to come within this factor of the block in hand.
 *  The estimate is rough, so it is given room. */
const HOPE = 1.5;

/** Tries blocks of two or three partitions. The `nearest` patterns to the pixels' own grouping are fitted, or every
 *  pattern when `nearest` is that many, and the `fitted` with the straightest lines go on to trials. */
function tryPartitions(parts: number, line: Fit, nearest: number, fitted: number, trials: number): void {
  const { index, masks } = fp.distinct[parts]!;
  const words = fp.words;
  // A 4 by 4 block has a weight for every pixel with several partitions; a larger one has them on smaller grids.
  const grids = fp.side === 4 ? 1 : fp.grids.length;
  let found = 0;
  if (nearest >= index.length) {
    for (found = 0; found < index.length; found++) nearAt[found] = index[found]!;
  } else {
    groupPixels(parts, line);
    // The pixels' own grouping is about the best any pattern could do. If even that is not expected to come near
    // the block in hand, no pattern is fitted. A group that came out empty means there are fewer kinds of pixel.
    for (let k = 0; k < parts; k++) if (centreCount[k] === 0) return;
    const own = fits[7]!;
    own.parts = parts;
    own.part = cluster;
    own.second = -1;
    fit(own);
    for (let g = 0; g < grids; g++) consider(own, g, 1);
    const hope = cands > 0 ? candCost[0] : Infinity;
    cands = 0;
    if (hope >= bestError * HOPE) return;
    for (let j = 0; j < index.length; j++) {
      let off: number;
      if (parts === 2) {
        // The pixels in the pattern's second partition and not the grouping's, or the other way round.
        off = 0;
        for (let w = 0; w < words; w++) off += pop32(clusterMask[words + w] ^ masks[(j * 2 + 1) * words + w]!);
        if (off > N / 2) off = N - off;
      } else {
        const m = j * 3 * words;
        const s = shared3;
        for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) s[x * 3 + y] = overlap(clusterMask, x * words, masks, m + y * words);
        off = N - Math.max(s[0] + s[4] + s[8], s[0] + s[5] + s[7], s[1] + s[3] + s[8], s[1] + s[5] + s[6], s[2] + s[3] + s[7], s[2] + s[4] + s[6]);
      }
      let at = found;
      while (at > 0 && nearCost[at - 1] > off) at--;
      if (at >= nearest) continue;
      if (found < nearest) found++;
      for (let k = found - 1; k > at; k--) {
        nearCost[k] = nearCost[k - 1];
        nearAt[k] = nearAt[k - 1];
      }
      nearCost[at] = off;
      nearAt[at] = index[j]!;
    }
  }
  // Fit each. fits[8] onwards holds the straightest so far in order, and after them the one being fitted.
  let kept = 0;
  for (let k = 0; k < found; k++) {
    const f = fits[8 + kept]!;
    f.parts = parts;
    f.pattern = nearAt[k];
    f.part = fp.partition[parts]![f.pattern]!;
    f.second = -1;
    fit(f);
    let at = kept;
    while (at > 0 && fits[8 + at - 1]!.base > f.base) at--;
    if (at === fitted) continue;
    for (let j = 8 + kept; j > 8 + at; j--) fits[j] = fits[j - 1]!;
    fits[8 + at] = f;
    if (kept < fitted) kept++;
  }
  for (let n = 0; n < kept; n++) for (let g = 0; g < grids; g++) consider(fits[8 + n]!, g, trials);
  runCandidates();
}

const eBits = new Uint8Array(128);
const eStream = new Uint8Array(128);
const eCodes = new Int32Array(64);

function setBits(at: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) eBits[at + i] = (value >> i) & 1;
}

/** Writes the best block found, laid out as C.2.9 to C.2.11 have it. */
function writeBest(out: Uint8Array, at: number): void {
  const [w, h] = fp.grids[bestGrid]!;
  const planes = bestSecond >= 0 ? 2 : 1;
  eBits.fill(0);
  setBits(0, 11, fp.mode[(bestGrid * WEIGHT_RANGES + bestW) * 2 + planes - 1]!);
  setBits(11, 2, bestParts - 1);
  let colourAt = 17;
  if (bestParts === 1) setBits(13, 4, bestCem);
  else {
    // Every partition has the same mode: the selector in bits 23 and 24 stays 0.
    setBits(13, 10, bestPattern);
    setBits(25, 4, bestCem);
    colourAt = 29;
  }
  const values = bestParts * channels * 2;
  for (let k = 0; k < values; k++) eCodes[k] = COLOUR_CODE[bestC][bestValues[k]];
  iseEncode(eCodes, values, bestC, eBits, colourAt);
  const weights = w * h * planes;
  for (let j = 0; j < w * h; j++) for (let plane = 0; plane < planes; plane++) eCodes[j * planes + plane] = WEIGHT_CODE[bestW][bestStored[plane * N + j]];
  iseEncode(eCodes, weights, bestW, eStream, 0);
  const wBits = iseBits(bestW, weights);
  for (let k = 0; k < wBits; k++) eBits[127 - k] = eStream[k];
  if (planes === 2) setBits(128 - wBits - 2, 2, chan[bestSecond]);
  for (let k = 0; k < 16; k++) {
    let byte = 0;
    for (let i = 0; i < 8; i++) byte |= eBits[k * 8 + i] << i;
    out[at + k] = byte;
  }
}

/** How many one-partition candidates are run. More was tried on 4 by 4 blocks and gained under 0.1 dB. */
const LINE_TRIALS = 6;
/** A block is not searched further once its mean squared error per channel is below this, */
const GOOD_ENOUGH = 0.25;
/** and has every partition pattern fitted if it is still above this. No block of our test textures is; random noise
 *  is all such blocks, and takes ten times as long. */
const BAD = 48;

/** Encodes the block in `px`. */
function encodeBlock(kind: AstcKind, out: Uint8Array, at: number): void {
  let solid = true;
  let grey = true;
  let opaque = true;
  for (let i = 0; i < N * 4; i += 4) {
    if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2] || px[i + 3] !== px[3]) solid = false;
    if (px[i] !== px[i + 1] || px[i] !== px[i + 2]) grey = false;
    if (px[i + 3] !== 255) opaque = false;
  }
  if (solid) {
    // A void-extent block with no extent, C.2.23: the colour as 16 bits a channel.
    out.set([0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, px[0], px[0], px[1], px[1], px[2], px[2], px[3], px[3]], at);
    return;
  }
  // The channels that vary, and the mode that stores just those: luminance, with alpha, RGB, RGBA.
  channels = (grey ? 1 : 3) + (opaque ? 0 : 1);
  cem = (channels - 1) * 4;
  chan[0] = 0;
  chan[1] = grey ? 3 : 1;
  chan[2] = 2;
  chan[3] = 3;
  cw.fill(1);
  // Luminance is shown in three channels. A normal map reads it once.
  if (grey && kind !== "normal") cw[0] = 3;
  cwSum = 0;
  for (let c = 0; c < channels; c++) cwSum += cw[c];
  const scale = Math.sqrt(cw[0]);
  for (let i = 0; i < N; i++) for (let c = 0; c < channels; c++) fx[i * 4 + c] = px[i * 4 + chan[c]] * (c === 0 ? scale : 1);
  shown = kind === "srgb" ? SHOWN_SRGB : SHOWN_LINEAR;
  bestError = Infinity;
  cands = 0;

  // One partition: one line through everything, or one channel apart on a plane of its own.
  const line = fits[0]!;
  line.second = -1;
  fit(line);
  consider(line, 0, LINE_TRIALS);
  let lines = 1;
  for (let c = grey ? 1 : 0; c < channels && channels > 1; c++) {
    const f = fits[lines++]!;
    f.second = c;
    fit(f);
    consider(f, 0, LINE_TRIALS);
  }
  for (let k = 0; k < lines; k++) for (let g = 1; g < fp.grids.length; g++) consider(fits[k]!, g, LINE_TRIALS);
  runCandidates();
  // More partitions, while the block is not yet good. A block that stays bad has every pattern fitted. That is slow,
  // about a millisecond, and it is where three regions of a mask meet that it pays most: somewhere there may be a
  // pattern that puts no more than two colours in a partition, which is exact.
  const good = N * cwSum * GOOD_ENOUGH;
  const bad = N * cwSum * BAD;
  if (bestError > good) tryPartitions(2, line, bestError > bad ? 1024 : 8, 2, 4);
  if (bestError > good && channels < 4) tryPartitions(3, line, bestError > bad ? 1024 : 6, 2, 3);
  writeBest(out, at);
}

/** Encodes `count` blocks `side` pixels across of a picture of RGBA pixels, starting with block `first`, into `out`
 *  from its start. Blocks are counted along rows from the top left. A picture whose side is not a multiple of the
 *  block's is padded by repeating its edge. A build spreads a picture over cores by giving each a range of blocks. */
export function encodeAstcBlocks(rgba: Uint8Array, width: number, height: number, kind: AstcKind, side: number, first: number, count: number, out: Uint8Array): void {
  fp = footprint(side);
  N = fp.pixels;
  for (let i = 0; i < fits.length; i++) fits[i]!.part = fp.partition[1]![0]!;
  const across = Math.ceil(width / side);
  for (let b = 0; b < count; b++) {
    const bx = ((first + b) % across) * side;
    const by = (((first + b) / across) | 0) * side;
    for (let i = 0; i < N; i++) {
      const from = (Math.min(by + ((i / side) | 0), height - 1) * width + Math.min(bx + (i % side), width - 1)) * 4;
      if (kind === "normal") {
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = rgba[from];
        px[i * 4 + 3] = rgba[from + 1];
      } else {
        px[i * 4] = rgba[from];
        px[i * 4 + 1] = rgba[from + 1];
        px[i * 4 + 2] = rgba[from + 2];
        px[i * 4 + 3] = rgba[from + 3];
      }
    }
    encodeBlock(kind, out, b * 16);
  }
}

/** Encodes a picture of RGBA pixels, rows top to bottom, to its blocks `side` pixels across. */
export function encodeAstc(rgba: Uint8Array, width: number, height: number, kind: AstcKind, side: number): Uint8Array {
  const out = new Uint8Array(astcBlockCount(width, height, side) * 16);
  encodeAstcBlocks(rgba, width, height, kind, side, 0, out.length / 16, out);
  return out;
}
