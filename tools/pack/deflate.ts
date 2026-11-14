// Raw deflate (RFC 1951), for the parts a build serves. Every choice is made with integers, or with a table of
// logarithms checked to come out the same on any runtime, so the same input gives the same bytes on any machine,
// which hashed file names need.
//
// The input is taken a segment at a time. Every position of a segment is searched for matches through hash chains,
// keeping for each length the nearest match that reaches it. A lazy parse of the segment is cut into blocks where its
// statistics change, and each block is then parsed again for the fewest bits by the code lengths of its last parse,
// for as long as that helps. A block is written stored, with the fixed codes or with its own, whichever is smallest.

const WINDOW = 32768;
const WMASK = WINDOW - 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
/** Input taken at a time: matches, parses and blocks are worked out for one segment before the next. */
const SEGMENT = 1 << 20;
const HASH_BITS = 16;
/** The smallest run of symbols worth a block of its own. */
const LEAST_BLOCK = 1024;

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/** The order the lengths of the code-length code are written in, and the extra bits of its codes 16, 17 and 18. */
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const CL_EXTRA = [2, 3, 7];

const LITS = 286;
const DISTS = 30;

/** The length code of each match length, 0 to 28. */
const LEN_CODE = new Uint8Array(MAX_MATCH + 1);
for (let c = 0; c < 28; c++) LEN_CODE.fill(c, LEN_BASE[c]!, LEN_BASE[c + 1]!);
LEN_CODE[MAX_MATCH] = 28;
/** The distance code of distances 1 to 256 at d - 1, and of larger ones at 256 + ((d - 1) >> 7). */
const DIST_CODE = new Uint8Array(512);
for (let c = 0; c < 30; c++) {
  for (let d = DIST_BASE[c]!; d < (c === 29 ? WINDOW + 1 : DIST_BASE[c + 1]!); d++) DIST_CODE[d <= 256 ? d - 1 : 256 + ((d - 1) >> 7)] = c;
}
const distCode = (d: number): number => (d <= 256 ? DIST_CODE[d - 1]! : DIST_CODE[256 + ((d - 1) >> 7)]!);

/** The fixed codes' lengths, over all 288 symbols, since the two never used still take their places among the codes. */
const FIXED_LIT = new Uint8Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288);
const FIXED_DIST = new Uint8Array(DISTS).fill(5);

export interface DeflateOptions {
  /** Links of a hash chain followed at a position before the search there stops. */
  chain?: number;
  /** The most times a block is parsed again by the code lengths of its last parse. 0 keeps the lazy parse. */
  passes?: number;
}

/** The raw deflate stream of `data`. The defaults are what a build uses; tests and benchmarks may ask for less. */
export function deflate(data: Uint8Array, opts: DeflateOptions = {}): Uint8Array {
  const chain = opts.chain ?? 1024;
  const passes = opts.passes ?? 4;
  const out = new BitWriter();
  const coder = new Coder();
  const chains = new Chains(data);
  if (data.length === 0) {
    // One last block, with the fixed codes and nothing in it but its end.
    out.write(3, 3);
    out.write(0, 7);
    return out.finish();
  }
  for (let s = 0; s < data.length; s += SEGMENT) {
    const e = Math.min(s + SEGMENT, data.length);
    const found = chains.find(s, e, chain);
    const lazy = lazyParse(data, s, e, found);
    const cuts = splitBlocks(coder, lazy);
    for (let b = 0; b + 1 < cuts.length; b++) {
      const [from, to] = [lazy.at[cuts[b]!]!, lazy.at[cuts[b + 1]!]!];
      let best = part(lazy, cuts[b]!, cuts[b + 1]!);
      let bits = coder.blockBits(best);
      for (let p = 0; p < passes; p++) {
        const next = optimalParse(coder, data, s, from, to, found, best);
        const nextBits = coder.blockBits(next);
        if (nextBits >= bits) break;
        [best, bits] = [next, nextBits];
      }
      writeBlock(out, coder, data.subarray(s + from, s + to), best, e === data.length && b + 2 === cuts.length);
    }
  }
  return out.finish();
}

/** Writes bits least significant first, as deflate packs them. */
class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private at = 0;
  private bits = 0;
  private count = 0;

  /** Bits written so far. */
  get length(): number {
    return this.at * 8 + this.count;
  }

  /** Up to 24 bits at once. */
  write(value: number, n: number): void {
    this.bits |= value << this.count;
    this.count += n;
    while (this.count >= 8) {
      if (this.at === this.buf.length) this.grow(1);
      this.buf[this.at++] = this.bits & 255;
      this.bits >>>= 8;
      this.count -= 8;
    }
  }

  align(): void {
    if (this.count > 0) this.write(0, 8 - this.count);
  }

  bytes(data: Uint8Array): void {
    this.grow(data.length);
    this.buf.set(data, this.at);
    this.at += data.length;
  }

  private grow(more: number): void {
    if (this.at + more <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.at + more));
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
  }

  finish(): Uint8Array {
    this.align();
    return this.buf.slice(0, this.at);
  }
}

/**
 * Code lengths of at most `most` bits by package-merge, which gives as few bits as any code so limited can. Symbols
 * that never occur get none. Ties go by symbol, so the lengths depend on the counts alone.
 */
export class Lengths {
  private readonly keys: Float64Array;
  private readonly order: Int32Array;
  private readonly weight: Float64Array[];
  private readonly leaf: Int32Array[];
  private readonly sizes: Int32Array;
  private readonly most: number;

  constructor(size: number, most: number) {
    this.most = most;
    this.keys = new Float64Array(size);
    this.order = new Int32Array(size);
    this.weight = Array.from({ length: most }, () => new Float64Array(size * 2));
    this.leaf = Array.from({ length: most }, () => new Int32Array(size * 2));
    this.sizes = new Int32Array(most);
  }

  make(freq: ArrayLike<number>, n: number, out: Uint8Array): void {
    out.fill(0, 0, n);
    let used = 0;
    // Sorted by count and then symbol, as one number each.
    for (let s = 0; s < n; s++) if (freq[s]! > 0) this.keys[used++] = freq[s]! * 512 + s;
    if (used === 0) return;
    const keys = this.keys.subarray(0, used).sort();
    if (used === 1) {
      out[keys[0]! % 512] = 1;
      return;
    }
    const order = this.order;
    for (let k = 0; k < used; k++) order[k] = keys[k]! % 512;
    // Level 0 is the leaves. Each level above is the leaves merged by weight with the pairs of the level below, a leaf first on a tie.
    for (let k = 0; k < used; k++) {
      this.weight[0]![k] = freq[order[k]!]!;
      this.leaf[0]![k] = order[k]!;
    }
    this.sizes[0] = used;
    for (let l = 1; l < this.most; l++) {
      const below = this.weight[l - 1]!;
      const pairs = this.sizes[l - 1]! >> 1;
      const w = this.weight[l]!;
      const leaf = this.leaf[l]!;
      let a = 0;
      let p = 0;
      let k = 0;
      while (a < used || p < pairs) {
        const pw = p < pairs ? below[2 * p]! + below[2 * p + 1]! : Infinity;
        const lw = a < used ? freq[order[a]!]! : Infinity;
        if (lw <= pw) {
          w[k] = lw;
          leaf[k++] = order[a++]!;
        } else {
          w[k] = pw;
          leaf[k++] = -1;
          p++;
        }
      }
      this.sizes[l] = k;
    }
    // The first 2n - 2 items of the top level are taken. A leaf taken at any level is a bit of its symbol's length, and
    // the pairs taken at a level are its first, so they take the first items of the level below.
    let take = 2 * used - 2;
    for (let l = this.most - 1; l >= 0; l--) {
      const leaf = this.leaf[l]!;
      let pairs = 0;
      for (let k = 0; k < take; k++) {
        if (leaf[k]! >= 0) out[leaf[k]!]!++;
        else pairs++;
      }
      take = 2 * pairs;
    }
  }
}

/** Canonical codes for these lengths (RFC 1951, 3.2.2), bit-reversed, since deflate writes a code from its first bit. */
function codesOf(lengths: Uint8Array): Uint16Array {
  const count = new Uint16Array(16);
  for (const l of lengths) count[l]!++;
  count[0] = 0;
  const next = new Uint16Array(16);
  for (let bits = 1, code = 0; bits < 16; bits++) next[bits] = code = (code + count[bits - 1]!) << 1;
  const codes = new Uint16Array(lengths.length);
  lengths.forEach((l, s) => {
    if (l === 0) return;
    const c = next[l]!++;
    let r = 0;
    for (let i = 0; i < l; i++) r |= ((c >> i) & 1) << (l - 1 - i);
    codes[s] = r;
  });
  return codes;
}

/** Gives a tree of `n` symbols a second code where it would have fewer than two, so that every inflater takes it. */
function twoAtLeast(freq: Uint32Array, n: number): void {
  let used = 0;
  for (let s = 0; s < n; s++) if (freq[s]! > 0) used++;
  for (let s = 0; s < n && used < 2; s++) {
    if (freq[s] === 0) {
      freq[s] = 1;
      used++;
    }
  }
}

/** A run of symbols: a literal byte where `dist` is 0, else a match of `len` bytes `dist` back. */
interface Symbols {
  len: Uint16Array;
  dist: Uint16Array;
  n: number;
}

/** Tables and scratch for one deflate. */
class Coder {
  private readonly big = new Lengths(LITS, 15);
  private readonly small = new Lengths(19, 7);
  readonly litLen = new Uint8Array(LITS);
  readonly distLen = new Uint8Array(DISTS);
  readonly clLen = new Uint8Array(19);
  private readonly lit = new Uint32Array(LITS);
  private readonly dist = new Uint32Array(DISTS);
  private readonly both = new Uint8Array(LITS + DISTS);
  /** The code lengths of both trees in the code-length alphabet: symbols, and the extra value of each 16, 17 and 18. */
  readonly runSym = new Uint8Array(LITS + DISTS);
  readonly runExtra = new Uint8Array(LITS + DISTS);
  runs = 0;
  private readonly clFreq = new Uint32Array(19);
  private readonly clCount = new Uint32Array(19);

  count(sym: Symbols, from: number, to: number, lit: Uint32Array, dist: Uint32Array): void {
    lit.fill(0);
    dist.fill(0);
    for (let k = from; k < to; k++) this.add(sym, k, lit, dist, 1);
  }

  add(sym: Symbols, k: number, lit: Uint32Array, dist: Uint32Array, by: number): void {
    if (sym.dist[k] === 0) lit[sym.len[k]!]! += by;
    else {
      lit[257 + LEN_CODE[sym.len[k]!]!]! += by;
      dist[distCode(sym.dist[k]!)]! += by;
    }
  }

  /** The code lengths of a block whose symbols are counted in `lit` and `dist`, with its end. */
  tables(lit: Uint32Array, dist: Uint32Array): void {
    this.lit.set(lit);
    this.dist.set(dist);
    this.lit[256] = 1;
    twoAtLeast(this.lit, LITS);
    twoAtLeast(this.dist, DISTS);
    this.big.make(this.lit, LITS, this.litLen);
    this.big.make(this.dist, DISTS, this.distLen);
  }

  /** Lengths for costs: every symbol gets one, and those not counted a long one. */
  costs(lit: Uint32Array, dist: Uint32Array): void {
    for (let s = 0; s < LITS; s++) this.lit[s] = lit[s]! * 2 + 1;
    for (let s = 0; s < DISTS; s++) this.dist[s] = dist[s]! * 2 + 1;
    this.big.make(this.lit, LITS, this.litLen);
    this.big.make(this.dist, DISTS, this.distLen);
  }

  /**
   * Bits of the header for the tables last made. With `all`, every way of writing runs of lengths is tried and the
   * best is left in `runSym`, `runExtra` and `clLen`; without, only the way that uses every kind of run is.
   */
  header(all: boolean): { bits: number; hlit: number; hdist: number; hclen: number } {
    let hlit = LITS;
    while (hlit > 257 && this.litLen[hlit - 1] === 0) hlit--;
    let hdist = DISTS;
    while (hdist > 1 && this.distLen[hdist - 1] === 0) hdist--;
    const both = this.both.subarray(0, hlit + hdist);
    both.set(this.litLen.subarray(0, hlit));
    both.set(this.distLen.subarray(0, hdist), hlit);
    let best = 7;
    let bestBits = Infinity;
    for (let flags = all ? 0 : 7; flags < 8; flags++) {
      const bits = this.runsOf(both, flags);
      if (bits >= bestBits) continue;
      best = flags;
      bestBits = bits;
    }
    if (all && best !== 7) this.runsOf(both, best);
    let hclen = 19;
    while (hclen > 4 && this.clLen[CL_ORDER[hclen - 1]!] === 0) hclen--;
    return { bits: bestBits, hlit, hdist, hclen };
  }

  /** Writes the lengths as runs, `flags` saying which of 16, 17 and 18 may be used, and makes the code-length code. Returns the header's bits. */
  private runsOf(lengths: Uint8Array, flags: number): number {
    const use16 = (flags & 1) !== 0;
    const use17 = (flags & 2) !== 0;
    const use18 = (flags & 4) !== 0;
    this.runs = 0;
    this.clCount.fill(0);
    for (let i = 0; i < lengths.length; ) {
      const v = lengths[i]!;
      let run = 1;
      while (i + run < lengths.length && lengths[i + run] === v) run++;
      i += run;
      if (v === 0) {
        for (; use18 && run >= 11; run -= Math.min(run, 138)) this.put(18, Math.min(run, 138) - 11);
        for (; use17 && run >= 3; run -= Math.min(run, 10)) this.put(17, Math.min(run, 10) - 3);
      } else if (use16 && run >= 4) {
        this.put(v, 0);
        for (run--; run >= 3; run -= Math.min(run, 6)) this.put(16, Math.min(run, 6) - 3);
      }
      for (; run > 0; run--) this.put(v, 0);
    }
    this.clFreq.set(this.clCount);
    twoAtLeast(this.clFreq, 19);
    this.small.make(this.clFreq, 19, this.clLen);
    let hclen = 19;
    while (hclen > 4 && this.clLen[CL_ORDER[hclen - 1]!] === 0) hclen--;
    let bits = 5 + 5 + 4 + 3 * hclen;
    for (let s = 0; s < 19; s++) bits += this.clCount[s]! * (this.clLen[s]! + (s >= 16 ? CL_EXTRA[s - 16]! : 0));
    return bits;
  }

  private put(s: number, extra: number): void {
    this.runSym[this.runs] = s;
    this.runExtra[this.runs++] = extra;
    this.clCount[s]!++;
  }

  /** Bits of a block with tables of its own, but for the extra bits of its matches. The tables are left made. */
  dynamicBits(lit: Uint32Array, dist: Uint32Array, all: boolean): number {
    this.tables(lit, dist);
    let bits = 3 + this.header(all).bits + this.litLen[256]!;
    for (let s = 0; s < LITS; s++) bits += lit[s]! * this.litLen[s]!;
    for (let s = 0; s < DISTS; s++) bits += dist[s]! * this.distLen[s]!;
    return bits;
  }

  /** The fewest bits these symbols take as a block with tables of its own or the fixed ones. */
  blockBits(sym: Symbols): number {
    const lit = new Uint32Array(LITS);
    const dist = new Uint32Array(DISTS);
    this.count(sym, 0, sym.n, lit, dist);
    return Math.min(this.dynamicBits(lit, dist, true), fixedBits(lit, dist)) + extraBits(lit, dist);
  }
}

/** Bits of the extra bits of the lengths and distances counted. */
function extraBits(lit: Uint32Array, dist: Uint32Array): number {
  let bits = 0;
  for (let c = 0; c < 29; c++) bits += lit[257 + c]! * LEN_EXTRA[c]!;
  for (let c = 0; c < DISTS; c++) bits += dist[c]! * DIST_EXTRA[c]!;
  return bits;
}

function fixedBits(lit: Uint32Array, dist: Uint32Array): number {
  let bits = 3 + FIXED_LIT[256]!;
  for (let s = 0; s < LITS; s++) bits += lit[s]! * FIXED_LIT[s]!;
  for (let s = 0; s < DISTS; s++) bits += dist[s]! * FIXED_DIST[s]!;
  return bits;
}

/** Matches at every position of a segment. */
interface Matches {
  /** Those at position k are at `start[k]` up to `start[k + 1]`, longest last: each a length and the distance of the nearest match that reaches it, for that length and those down to the one before. */
  start: Int32Array;
  len: Uint16Array;
  dist: Uint16Array;
  /** How many bytes from each position are the same byte. */
  same: Uint16Array;
}

/** Hash chains over the window behind the position searched. */
class Chains {
  private readonly head = new Int32Array(1 << HASH_BITS).fill(-1);
  private readonly prev = new Int32Array(WINDOW).fill(-1);
  private inserted = 0;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  private hash(i: number): number {
    const d = this.data;
    return Math.imul(d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16), 0x9e3779b1) >>> (32 - HASH_BITS);
  }

  /** Searches every position from `s` to `e`, following `chain` links at most. */
  find(s: number, e: number, chain: number): Matches {
    const data = this.data;
    const n = e - s;
    const start = new Int32Array(n + 1);
    let len = new Uint16Array(Math.max(64, n));
    let dist = new Uint16Array(Math.max(64, n));
    let k = 0;
    const same = new Uint16Array(n);
    for (let i = e - 1, run = 0; i >= s; i--) {
      run = i + 1 < data.length && data[i + 1] === data[i] ? run + 1 : 1;
      same[i - s] = run < 65535 ? run : 65535;
    }
    for (let i = s; i < e; i++) {
      start[i - s] = k;
      for (; this.inserted < i && this.inserted + 2 < data.length; this.inserted++) {
        const h = this.hash(this.inserted);
        this.prev[this.inserted & WMASK] = this.head[h]!;
        this.head[h] = this.inserted;
      }
      const most = Math.min(MAX_MATCH, data.length - i);
      if (most < MIN_MATCH) continue;
      let best = MIN_MATCH - 1;
      let p = this.head[this.hash(i)]!;
      for (let links = 0; p >= 0 && i - p <= WINDOW && links < chain; links++) {
        if (data[p + best] === data[i + best] && data[p] === data[i]) {
          let l = 1;
          while (l < most && data[p + l] === data[i + l]) l++;
          if (l > best) {
            if (k === len.length) {
              const longer = new Uint16Array(k * 2);
              longer.set(len);
              len = longer;
              const further = new Uint16Array(k * 2);
              further.set(dist);
              dist = further;
            }
            len[k] = l;
            dist[k++] = i - p;
            best = l;
            if (l >= most) break;
          }
        }
        const q = this.prev[p & WMASK]!;
        if (q >= p) break;
        p = q;
      }
    }
    start[n] = k;
    return { start, len, dist, same };
  }
}

/** zlib's lazy parse: a match is put off a byte when the next position has a longer one. `at[k]` is where symbol k starts in the segment. */
function lazyParse(data: Uint8Array, s: number, e: number, m: Matches): Symbols & { at: Int32Array } {
  const n = e - s;
  const len = new Uint16Array(n);
  const dist = new Uint16Array(n);
  const at = new Int32Array(n + 1);
  const longest = (i: number): number => (i < n && m.start[i + 1]! > m.start[i]! ? Math.min(m.len[m.start[i + 1]! - 1]!, n - i) : 0);
  let k = 0;
  for (let i = 0; i < n; k++) {
    at[k] = i;
    const l = longest(i);
    if (l >= MIN_MATCH && longest(i + 1) <= l) {
      len[k] = l;
      dist[k] = m.dist[m.start[i + 1]! - 1]!;
      i += l;
    } else {
      len[k] = data[s + i]!;
      dist[k] = 0;
      i++;
    }
  }
  at[k] = n;
  return { len, dist, n: k, at };
}

function part(sym: Symbols, from: number, to: number): Symbols {
  return { len: sym.len.slice(from, to), dist: sym.dist.slice(from, to), n: to - from };
}

/**
 * log2 of 0 to 65535 in 65536ths of a bit. Math.log2 may differ between runtimes in its last place, so the table is
 * checked to hold no value that near a boundary of rounding: every runtime then makes the same table.
 */
const LOG2 = new Float64Array(65536);
for (let x = 1; x < 65536; x++) {
  const v = Math.log2(x) * 65536;
  LOG2[x] = Math.round(v);
  if (Math.abs(Math.abs(v - LOG2[x]!) - 0.5) < 1e-7) throw new Error("deflate: a log2 lies too near a boundary of rounding");
}

/** f log2 f in 65536ths of a bit, for a whole number f. */
function flog(f: number): number {
  let x = f;
  let shift = 0;
  for (; x >= 65536; shift++) x = Math.floor(x / 2);
  return f * (LOG2[x]! + shift * 65536);
}

/** Counts of the symbols of a stretch, and what a block of them would cost by their entropy, kept as symbols come and go. */
class Tally {
  readonly lit = new Float64Array(LITS);
  readonly dist = new Float64Array(DISTS);
  private litSum = 0;
  private distSum = 0;
  private litTotal = 0;
  private distTotal = 0;
  private used = 0;

  move(sym: Symbols, k: number, by: number): void {
    if (sym.dist[k] === 0) this.bump(this.lit, sym.len[k]!, by, false);
    else {
      this.bump(this.lit, 257 + LEN_CODE[sym.len[k]!]!, by, false);
      this.bump(this.dist, distCode(sym.dist[k]!), by, true);
    }
  }

  private bump(counts: Float64Array, s: number, by: number, isDist: boolean): void {
    const was = counts[s]!;
    const now = was + by;
    counts[s] = now;
    const change = flog(now) - flog(was);
    if (isDist) {
      this.distSum += change;
      this.distTotal += by;
    } else {
      this.litSum += change;
      this.litTotal += by;
    }
    this.used += (now > 0 ? 1 : 0) - (was > 0 ? 1 : 0);
  }

  /** About as many bits as a block of these would take with its own tables, in 65536ths, but for the extra bits. */
  bits(): number {
    return flog(this.litTotal) - this.litSum + flog(this.distTotal) - this.distSum + (60 + 4 * this.used) * 65536;
  }
}

/**
 * Where a run of symbols is cut into blocks, as indices into it, first 0 and last its count. A stretch is cut where
 * its two halves would cost fewest bits by their entropy, if they then cost fewer bits than the whole with tables of
 * their own; then each half is looked at the same way.
 */
function splitBlocks(coder: Coder, sym: Symbols): number[] {
  const lit = new Uint32Array(LITS);
  const dist = new Uint32Array(DISTS);
  const exact = (from: number, to: number): number => {
    coder.count(sym, from, to, lit, dist);
    return coder.dynamicBits(lit, dist, false);
  };
  const cuts = [0, sym.n];
  const todo = [0, sym.n];
  while (todo.length > 0) {
    const to = todo.pop()!;
    const from = todo.pop()!;
    if (to - from < 2 * LEAST_BLOCK) continue;
    const left = new Tally();
    const right = new Tally();
    for (let k = from; k < to; k++) right.move(sym, k, 1);
    let at = -1;
    let least = Infinity;
    for (let c = from; c < to - LEAST_BLOCK; c++) {
      left.move(sym, c, 1);
      right.move(sym, c, -1);
      if (c + 1 - from < LEAST_BLOCK) continue;
      const bits = left.bits() + right.bits();
      if (bits < least) {
        least = bits;
        at = c + 1;
      }
    }
    if (at < 0 || exact(from, at) + exact(at, to) >= exact(from, to) - 64) continue;
    cuts.push(at);
    todo.push(from, at, at, to);
  }
  return cuts.sort((a, b) => a - b);
}

/**
 * The fewest bits from `from` to `to` in the segment that starts at `s`, by the code lengths of `was`: every position
 * is reached by a literal, or by any length of the matches found there at the nearest distance for that length.
 */
function optimalParse(coder: Coder, data: Uint8Array, s: number, from: number, to: number, m: Matches, was: Symbols): Symbols {
  const [lit, dist] = [new Uint32Array(LITS), new Uint32Array(DISTS)];
  coder.count(was, 0, was.n, lit, dist);
  coder.costs(lit, dist);
  const litCost = Uint16Array.from(coder.litLen);
  const lenCost = new Uint16Array(MAX_MATCH + 1);
  for (let l = MIN_MATCH; l <= MAX_MATCH; l++) lenCost[l] = coder.litLen[257 + LEN_CODE[l]!]! + LEN_EXTRA[LEN_CODE[l]!]!;
  const distCost = new Uint16Array(DISTS);
  for (let c = 0; c < DISTS; c++) distCost[c] = coder.distLen[c]! + DIST_EXTRA[c]!;

  const n = to - from;
  const cost = new Float64Array(n + 1).fill(Infinity);
  const step = new Uint16Array(n + 1);
  const back = new Uint16Array(n + 1);
  cost[0] = 0;
  const runCost = lenCost[MAX_MATCH]! + distCost[0]!;
  for (let i = 0; i < n; i++) {
    const k = from + i;
    const c = cost[i]!;
    // Deep in a run of one byte, the whole match one byte back is all that is tried.
    if (m.same[k]! > MAX_MATCH * 2 && i > MAX_MATCH && m.same[k - MAX_MATCH]! > MAX_MATCH && n - i > MAX_MATCH) {
      if (c + runCost < cost[i + MAX_MATCH]!) {
        cost[i + MAX_MATCH] = c + runCost;
        step[i + MAX_MATCH] = MAX_MATCH;
        back[i + MAX_MATCH] = 1;
      }
      continue;
    }
    const byLit = c + litCost[data[s + k]!]!;
    if (byLit < cost[i + 1]!) {
      cost[i + 1] = byLit;
      step[i + 1] = 1;
      back[i + 1] = 0;
    }
    const most = n - i;
    for (let j = m.start[k]!, l = MIN_MATCH; j < m.start[k + 1]! && l <= most; j++) {
      const d = m.dist[j]!;
      const dc = c + distCost[distCode(d)]!;
      const upTo = m.len[j]! < most ? m.len[j]! : most;
      for (; l <= upTo; l++) {
        const cc = dc + lenCost[l]!;
        if (cc < cost[i + l]!) {
          cost[i + l] = cc;
          step[i + l] = l;
          back[i + l] = d;
        }
      }
    }
  }
  let k = 0;
  for (let i = n; i > 0; i -= step[i]!) k++;
  const sym: Symbols = { len: new Uint16Array(k), dist: new Uint16Array(k), n: k };
  for (let i = n; i > 0; i -= step[i]!) {
    k--;
    sym.len[k] = back[i] === 0 ? data[s + from + i - 1]! : step[i]!;
    sym.dist[k] = back[i]!;
  }
  return sym;
}

/** Writes a block of `bytes`, parsed as `sym`, as whichever kind is smallest. */
function writeBlock(out: BitWriter, coder: Coder, bytes: Uint8Array, sym: Symbols, last: boolean): void {
  const [lit, dist] = [new Uint32Array(LITS), new Uint32Array(DISTS)];
  coder.count(sym, 0, sym.n, lit, dist);
  const fixed = fixedBits(lit, dist);
  const dyn = coder.dynamicBits(lit, dist, true);
  const pieces = Math.max(1, Math.ceil(bytes.length / 65535));
  const stored = pieces * 3 + ((8 - ((out.length + 3) & 7)) & 7) + (pieces - 1) * 5 + pieces * 32 + bytes.length * 8 - extraBits(lit, dist);
  if (stored <= dyn && stored <= fixed) {
    for (let at = 0; at < bytes.length || at === 0; ) {
      const to = Math.min(bytes.length, at + 65535);
      out.write(last && to === bytes.length ? 1 : 0, 1);
      out.write(0, 2);
      out.align();
      out.write(to - at, 16);
      out.write(~(to - at) & 0xffff, 16);
      out.bytes(bytes.subarray(at, to));
      if ((at = to) === bytes.length) break;
    }
    return;
  }
  let litLen = FIXED_LIT;
  let distLen = FIXED_DIST;
  out.write(last ? 1 : 0, 1);
  if (fixed <= dyn) out.write(1, 2);
  else {
    out.write(2, 2);
    const h = coder.header(true);
    out.write(h.hlit - 257, 5);
    out.write(h.hdist - 1, 5);
    out.write(h.hclen - 4, 4);
    for (let i = 0; i < h.hclen; i++) out.write(coder.clLen[CL_ORDER[i]!]!, 3);
    const clCodes = codesOf(coder.clLen);
    for (let r = 0; r < coder.runs; r++) {
      const s = coder.runSym[r]!;
      out.write(clCodes[s]!, coder.clLen[s]!);
      if (s >= 16) out.write(coder.runExtra[r]!, CL_EXTRA[s - 16]!);
    }
    litLen = coder.litLen;
    distLen = coder.distLen;
  }
  const litCodes = codesOf(litLen);
  const distCodes = codesOf(distLen);
  for (let k = 0; k < sym.n; k++) {
    const d = sym.dist[k]!;
    const l = sym.len[k]!;
    if (d === 0) {
      out.write(litCodes[l]!, litLen[l]!);
      continue;
    }
    const lc = LEN_CODE[l]!;
    out.write(litCodes[257 + lc]!, litLen[257 + lc]!);
    if (LEN_EXTRA[lc]! > 0) out.write(l - LEN_BASE[lc]!, LEN_EXTRA[lc]!);
    const dc = distCode(d);
    out.write(distCodes[dc]!, distLen[dc]!);
    if (DIST_EXTRA[dc]! > 0) out.write(d - DIST_BASE[dc]!, DIST_EXTRA[dc]!);
  }
  out.write(litCodes[256]!, litLen[256]!);
}
