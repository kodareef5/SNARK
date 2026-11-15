// Lossless coding of 16-bit samples, as FLAC codes a fixed-predictor subframe (RFC 9639, sections 9.2.5 and 9.2.7):
// each block of samples is predicted from the ones before it by a fixed polynomial of order 0 to 4, and what the
// prediction misses is Rice-coded in partitions, each with a parameter of its own. Low bits every sample of a block
// leaves zero ("wasted bits") are not stored, so a take quantised more coarsely before coding comes out smaller.
//
// The bits run from the most significant of each byte. A block of BLOCK samples (the last may be shorter) is:
//
//   4 bits   wasted bits w: every sample of the block is a multiple of 2^w and is stored shifted down by w
//   3 bits   the predictor's order, 0 to 4
//   16 bits  each of the first `order` samples, signed
//   4 bits   the partition order p: 2^p partitions of the block's length >> p samples, the first less `order`
//   then each partition: 5 bits its Rice parameter k, and each residual zigzagged (0, -1, 1, -2 as 0, 1, 2, 3), its
//   value >> k in unary (that many 0 bits, then a 1), then its low k bits
//
// The stream ends at the next whole byte.

export const BLOCK = 4096;
const MAX_PARTITION_ORDER = 6;

/** The residual of sample i from those before it, by fixed predictor `order`. */
function residual(x: Int32Array, i: number, order: number): number {
  switch (order) {
    case 0:
      return x[i]!;
    case 1:
      return x[i]! - x[i - 1]!;
    case 2:
      return x[i]! - 2 * x[i - 1]! + x[i - 2]!;
    case 3:
      return x[i]! - 3 * x[i - 1]! + 3 * x[i - 2]! - x[i - 3]!;
    default:
      return x[i]! - 4 * x[i - 1]! + 6 * x[i - 2]! - 4 * x[i - 3]! + x[i - 4]!;
  }
}

function predicted(x: Int32Array, i: number, order: number): number {
  switch (order) {
    case 0:
      return 0;
    case 1:
      return x[i - 1]!;
    case 2:
      return 2 * x[i - 1]! - x[i - 2]!;
    case 3:
      return 3 * x[i - 1]! - 3 * x[i - 2]! + x[i - 3]!;
    default:
      return 4 * x[i - 1]! - 6 * x[i - 2]! + 4 * x[i - 3]! - x[i - 4]!;
  }
}

const zig = (e: number): number => (e >= 0 ? e * 2 : -e * 2 - 1);
const unzig = (u: number): number => (u & 1 ? -((u + 1) / 2) : u / 2);

class Bits {
  bytes: Uint8Array;
  at = 0;
  private acc = 0;
  private n = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
  }
  put(value: number, bits: number): void {
    for (let b = bits - 1; b >= 0; b--) this.bit((value / 2 ** b) & 1);
  }
  bit(v: number): void {
    this.acc = (this.acc << 1) | v;
    if (++this.n === 8) {
      if (this.at === this.bytes.length) {
        const grown = new Uint8Array(this.bytes.length * 2);
        grown.set(this.bytes);
        this.bytes = grown;
      }
      this.bytes[this.at++] = this.acc;
      this.acc = this.n = 0;
    }
  }
  zeros(count: number): void {
    for (let i = 0; i < count; i++) this.bit(0);
  }
  end(): Uint8Array {
    while (this.n !== 0) this.bit(0);
    return this.bytes.subarray(0, this.at);
  }
}

/** Bits of `u` values Rice-coded with parameter k. */
function riceBits(u: Int32Array | number[], from: number, to: number, k: number): number {
  let bits = 0;
  for (let i = from; i < to; i++) bits += Math.floor(u[i]! / 2 ** k) + 1 + k;
  return bits;
}

/** The Rice parameter that codes `u[from..to)` in the fewest bits, and those bits. */
function bestRice(u: Int32Array, from: number, to: number): [number, number] {
  let sum = 0;
  for (let i = from; i < to; i++) sum += u[i]!;
  const mean = to > from ? sum / (to - from) : 0;
  const guess = mean < 1 ? 0 : Math.min(30, Math.floor(Math.log2(mean)));
  let best = guess;
  let bits = riceBits(u, from, to, guess);
  for (const k of [guess - 1, guess + 1, guess + 2]) {
    if (k < 0 || k > 30) continue;
    const b = riceBits(u, from, to, k);
    if (b < bits) [best, bits] = [k, b];
  }
  return [best, bits];
}

/** `samples` coded losslessly. */
export function encodeLossless(samples: Int16Array): Uint8Array {
  const out = new Bits(Math.max(64, samples.length));
  const x = new Int32Array(BLOCK);
  const u = new Int32Array(BLOCK);
  for (let start = 0; start < samples.length; start += BLOCK) {
    const n = Math.min(BLOCK, samples.length - start);
    let common = 0;
    for (let i = 0; i < n; i++) common |= samples[start + i]!;
    let w = 0;
    while (w < 15 && common !== 0 && (common & (1 << w)) === 0) w++;
    if (common === 0) w = 0;
    for (let i = 0; i < n; i++) x[i] = samples[start + i]! >> w;
    // The order whose residuals are smallest in sum, of those that leave the block a residual to code.
    let order = 0;
    let least = Infinity;
    for (let o = 0; o <= Math.min(4, n - 1); o++) {
      let sum = 0;
      for (let i = o; i < n; i++) sum += Math.abs(residual(x, i, o));
      if (sum < least) [least, order] = [sum, o];
    }
    for (let i = order; i < n; i++) u[i] = zig(residual(x, i, order));
    // The partition order that codes the residuals in the fewest bits. Each partition must hold a residual.
    let bestP = 0;
    let bestBits = Infinity;
    let bestKs: number[] = [];
    for (let p = 0; p <= MAX_PARTITION_ORDER; p++) {
      if (n % (1 << p) !== 0 || n >> p <= order) break;
      const size = n >> p;
      const ks: number[] = [];
      let bits = 0;
      for (let q = 0; q < 1 << p; q++) {
        const [k, b] = bestRice(u, q === 0 ? order : q * size, (q + 1) * size);
        ks.push(k);
        bits += b + 5;
      }
      if (bits < bestBits) [bestP, bestBits, bestKs] = [p, bits, ks];
    }
    out.put(w, 4);
    out.put(order, 3);
    for (let i = 0; i < order; i++) out.put(x[i]! & 0xffff, 16);
    out.put(bestP, 4);
    const size = n >> bestP;
    for (let q = 0; q < 1 << bestP; q++) {
      const k = bestKs[q]!;
      out.put(k, 5);
      for (let i = q === 0 ? order : q * size; i < (q + 1) * size; i++) {
        out.zeros(Math.floor(u[i]! / 2 ** k));
        out.bit(1);
        out.put(u[i]! % 2 ** k, k);
      }
    }
  }
  return out.end().slice();
}

/** Decodes `samples` samples from `data` into `out` as floats from -1 to 1. False if the data ends early or is not a stream. */
export function decodeLossless(data: Uint8Array, samples: number, out: Float32Array): boolean {
  // The next bits are the low `have` of `acc`, at most 31 of them; `at` is the next byte to take in.
  let at = 0;
  let acc = 0;
  let have = 0;
  const fill = (): void => {
    while (have <= 23 && at < data.length) {
      acc = ((acc << 8) | data[at++]!) >>> 0;
      have += 8;
    }
  };
  const take = (bits: number): number => {
    if (bits > 16) return take(bits - 16) * 65536 + take(16);
    if (have < bits) fill();
    if (have < bits) throw RangeError();
    have -= bits;
    const v = acc >>> have;
    acc = have === 0 ? 0 : acc & (0xffffffff >>> (32 - have));
    return v;
  };
  const zeros = (): number => {
    let n = 0;
    for (;;) {
      if (have === 0) fill();
      if (have === 0) throw RangeError();
      if (acc === 0) {
        n += have;
        have = 0;
        if (n > 1 << 20) throw RangeError();
        continue;
      }
      const lead = Math.clz32(acc) - (32 - have);
      have -= lead + 1;
      acc = have === 0 ? 0 : acc & (0xffffffff >>> (32 - have));
      return n + lead;
    }
  };
  const x = new Int32Array(BLOCK);
  try {
    for (let start = 0; start < samples; start += BLOCK) {
      const n = Math.min(BLOCK, samples - start);
      const w = take(4);
      const order = take(3);
      if (order > 4 || order >= n) return false;
      for (let i = 0; i < order; i++) x[i] = (take(16) << 16) >> 16;
      const p = take(4);
      if (p > MAX_PARTITION_ORDER || n % (1 << p) !== 0 || n >> p <= order) return false;
      const size = n >> p;
      for (let q = 0; q < 1 << p; q++) {
        const k = take(5);
        const scale = 2 ** k;
        for (let i = q === 0 ? order : q * size; i < (q + 1) * size; i++) x[i] = predicted(x, i, order) + unzig(zeros() * scale + take(k));
      }
      for (let i = 0; i < n; i++) {
        const v = x[i]! * 2 ** w;
        if (v < -32768 || v > 32767) return false;
        out[start + i] = v / 32768;
      }
    }
  } catch {
    return false;
  }
  return true;
}
