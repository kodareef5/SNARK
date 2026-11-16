// The code of a take (shared/pack/sound.ts): a modified discrete cosine transform of N coefficients a frame, each
// frame windowed over 2N samples and overlapping the next by N, in bands of about one critical band each. The
// encoder (tools/pack/transform.ts) chooses each band's step from what the band masks; the stream says, for each band
// of each frame, its energy and how finely it is quantised, and then the quantised coefficients. A band with nothing
// worth coding is heard as noise of its energy. Everything is range-coded with models that learn as the take goes.
//
// A take of L samples is coded as ceil(L / N) + 1 frames of N before it, the take and what follows it: silence for a
// sound played once, the take's own end and start for a loop, so that its two ends join as they did.
//
//   0   u8 log2 N, 6 to 11
//   1   the range coder's bytes
//
// A frame, band by band, low to high: the energy as 1.5 dB steps from what the band had the frame before, then the
// fineness, the energy less the step, or SKIP; then each coded band's coefficients, as their magnitude, those above
// ESCAPE in Elias gamma, and a sign.

export const MIN_LOG = 6;
export const MAX_LOG = 11;
/** A band's energy, 4 log2 of the RMS of its coefficients (whole scale 1), from QUIET up; at QUIET a band is silent. */
export const QUIET = -64;
export const LOUD = 40;
/** Fineness, the energy less 4 log2 of the step, from FINE_MIN, coded one above it; 0 says the band is filled. */
export const FINE_MIN = -6;
export const FINE_MAX = 52;
export const SKIP = 0;
export const ENERGY_SPAN = 24;
export const ESCAPE = 15;
/** Coefficients a step above zero, noise's height in a band coded zero there. */
export const FILL = 0.25;
/** Critical band edges in Hz (Zwicker), each about one Bark, those above 7.7 kHz halved so that noise filling them
 * follows the slope of a decay: the bands as they would be at 32 kHz. */
const EDGES_HZ = [0, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000, 2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 8600, 9500, 10750, 12000, 13750, 15500];
const LAYOUT_RATE = 32000;

const layouts = new Map<number, Int32Array>();

/** The first coefficient of each band of a frame of `n`, and `n` last. Bands narrower than two coefficients join the next. */
export function bandsOf(n: number): Int32Array {
  let out = layouts.get(n);
  if (out) return out;
  const edges = [0];
  for (const hz of EDGES_HZ.slice(1)) {
    const k = Math.floor((hz * 2 * n + LAYOUT_RATE / 2) / LAYOUT_RATE);
    if (k - edges[edges.length - 1]! >= 2 && n - k >= 2) edges.push(k);
  }
  edges.push(n);
  layouts.set(n, (out = Int32Array.from(edges)));
  return out;
}

/** Steps 2^(i/4), for i from -128. */
export const STEP = Float64Array.from({ length: 256 }, (_, i) => 2 ** ((i - 128) / 4));

/** Symbol counts that learn: a symbol's share grows as it is seen. Starts from `prior`, a count for each symbol. */
export class Model {
  readonly freq: Uint16Array;
  total = 0;
  private readonly prior: Uint16Array;
  private readonly start: number;
  constructor(prior: readonly number[]) {
    this.prior = Uint16Array.from(prior);
    this.freq = this.prior.slice();
    this.start = this.total = prior.reduce((a, b) => a + b, 0);
  }
  reset(): void {
    this.freq.set(this.prior);
    this.total = this.start;
  }
  update(s: number): void {
    this.freq[s]! += 24;
    this.total += 24;
    if (this.total > 1 << 16) {
      this.total = 0;
      for (let i = 0; i < this.freq.length; i++) this.total += this.freq[i] = (this.freq[i]! + 1) >> 1;
    }
  }
}

/** Counts for `size` symbols, `top` for symbol `peak` and each further one `ratio` of the one before, none under 1.
 * Only + - * / make them, so that every engine makes the same. */
function prior(size: number, peak: number, ratio: number, top = 64): number[] {
  const out = new Array<number>(size);
  let v = top;
  for (let d = 0; d < size; d++, v *= ratio) {
    if (peak + d < size) out[peak + d] = Math.max(1, Math.round(v));
    if (d > 0 && peak - d >= 0) out[peak - d] = Math.max(1, Math.round(v));
  }
  return out;
}

const ENERGY_PRIOR = [2, ...prior(2 * ENERGY_SPAN + 1, ENERGY_SPAN, 0.625)];
const FINE_SYMBOLS = FINE_MAX - FINE_MIN + 2;
const FINE_PRIORS = Array.from({ length: FINE_SYMBOLS }, (_, c) => prior(FINE_SYMBOLS, c, 0.625));
/** By fineness from FINE_MIN, coefficients' magnitudes as a geometric spread of mean 2^(fineness / 4). */
const MAGNITUDE_PRIORS: number[][] = [];
for (let i = 0, mean = 0.3535533905932738; i < 24; i++, mean *= 1.189207115002721) MAGNITUDE_PRIORS.push(prior(ESCAPE + 1, 0, mean / (1 + mean)));

/** A take's models, made the same way by the encoder and the decoder. */
export class Models {
  /** The energy's change, by how far the band below changed (none, one step, more). */
  readonly energy = [0, 1, 2].map(() => new Model(ENERGY_PRIOR));
  /** The fineness, by the band's fineness the frame before. */
  readonly fine = FINE_PRIORS.map((p) => new Model(p));
  /** A coefficient's magnitude, by its band's fineness and the magnitude before it (none, one, more). */
  readonly magnitude = Array.from({ length: 3 * 24 }, (_, c) => new Model(MAGNITUDE_PRIORS[Math.floor(c / 3)]!));
  /** As made: a decoder keeps one set for every take, since making them costs more than a short take's decoding. */
  reset(): this {
    for (const list of [this.energy, this.fine, this.magnitude]) for (const m of list) m.reset();
    return this;
  }
}

let kept: Models | null = null;

/** The coefficients' magnitudes in a band of fineness `fine` are coded shifted down by this many bits, the rest sent as they are. */
export const shiftOf = (fine: number): number => Math.max(0, (fine - 12) >> 2);
/** The magnitude model of a band of fineness `fine` coded shifted by `shift`, after a coefficient of magnitude `before`. */
export const magnitudeContext = (fine: number, shift: number, before: number): number => 3 * Math.min(23, fine - 4 * shift - FINE_MIN) + Math.min(2, before);

const TOP = 1 << 24;

export class RangeDecoder {
  private range = 0xffffffff;
  private code = 0;
  private at = 0;
  private r = 0;
  bad = false;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
    for (let i = 0; i < 5; i++) this.code = this.code * 256 + this.byte();
    if (this.code > 0xffffffff) this.bad = true;
  }
  private byte(): number {
    return this.at < this.data.length ? this.data[this.at++]! : (this.at++, 0);
  }
  /** Whether the stream held what was read: a coder reads at most four bytes past its end. */
  get whole(): boolean {
    return !this.bad && this.at <= this.data.length + 4;
  }
  private take(start: number, size: number): void {
    this.code -= start * this.r;
    this.range = size * this.r;
    while (this.range < TOP) {
      this.code = this.code * 256 + this.byte();
      this.range *= 256;
    }
  }
  symbol(m: Model): number {
    this.r = Math.floor(this.range / m.total);
    const t = Math.floor(this.code / this.r);
    let s = 0;
    let cum = 0;
    const f = m.freq;
    while (s < f.length && cum + f[s]! <= t) cum += f[s++]!;
    if (s === f.length) {
      this.bad = true;
      return 0;
    }
    this.take(cum, f[s]!);
    m.update(s);
    return s;
  }
  /** `bits` bits, at most 16, each as likely as not. */
  bits(bits: number): number {
    const total = 1 << bits;
    this.r = Math.floor(this.range / total);
    const v = Math.min(total - 1, Math.floor(this.code / this.r));
    this.take(v, 1);
    return v;
  }
}

/** Elias gamma of v >= 1 in bypass bits: as many zeros as v has bits after its first, then v. */
export function readGamma(d: RangeDecoder): number {
  let n = 0;
  while (n < 24 && d.bits(1) === 0) n++;
  if (n === 24) {
    d.bad = true;
    return 1;
  }
  let v = 1;
  for (let i = 0; i < n; i++) v = v * 2 + d.bits(1);
  return v;
}

const ffts = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

/** In place, a complex FFT of `re` and `im`, whose length is a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  let t = ffts.get(n);
  if (!t) {
    const rev = new Uint32Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      rev[i] = j ^= bit;
    }
    t = { cos: Float64Array.from({ length: n / 2 }, (_, k) => Math.cos((2 * Math.PI * k) / n)), sin: Float64Array.from({ length: n / 2 }, (_, k) => -Math.sin((2 * Math.PI * k) / n)), rev };
    ffts.set(n, t);
  }
  const { cos, sin, rev } = t;
  for (let i = 1; i < n; i++) {
    const j = rev[i]!;
    if (i < j) {
      let x = re[i]!;
      re[i] = re[j]!;
      re[j] = x;
      x = im[i]!;
      im[i] = im[j]!;
      im[j] = x;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = sin[k * step]!;
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
      }
    }
  }
}

interface Dct {
  pre: Float64Array;
  post: Float64Array;
  re: Float64Array;
  im: Float64Array;
  window: Float64Array;
}
const dcts = new Map<number, Dct>();

function dctOf(n: number): Dct {
  let d = dcts.get(n);
  if (!d) {
    const h = n >> 1;
    const pre = new Float64Array(2 * h);
    const post = new Float64Array(2 * h);
    for (let i = 0; i < h; i++) {
      pre[2 * i] = Math.cos((Math.PI * (i + 0.25)) / n);
      pre[2 * i + 1] = -Math.sin((Math.PI * (i + 0.25)) / n);
      post[2 * i] = Math.cos((Math.PI * i) / n);
      post[2 * i + 1] = -Math.sin((Math.PI * i) / n);
    }
    // The power-sine window: each sample's square and its square a frame on add to one.
    const window = Float64Array.from({ length: 2 * n }, (_, i) => Math.sin((Math.PI / 2) * Math.sin((Math.PI * (i + 0.5)) / (2 * n)) ** 2));
    dcts.set(n, (d = { pre, post, re: new Float64Array(h), im: new Float64Array(h), window }));
  }
  return d;
}

/** The window of a frame of `n`, over its 2n samples. */
export const windowOf = (n: number): Float64Array => dctOf(n).window;

/** In place, the orthonormal DCT-IV of `x`, whose length is a power of two of at least 4. It is its own inverse. */
export function dct4(x: Float64Array): void {
  const n = x.length;
  const h = n >> 1;
  const { pre, post, re, im } = dctOf(n);
  for (let i = 0; i < h; i++) {
    const a = x[2 * i]!;
    const b = x[n - 1 - 2 * i]!;
    re[i] = a * pre[2 * i]! - b * pre[2 * i + 1]!;
    im[i] = a * pre[2 * i + 1]! + b * pre[2 * i]!;
  }
  fft(re, im);
  const scale = Math.sqrt(2 / n);
  for (let k = 0; k < h; k++) {
    const yr = re[k]! * post[2 * k]! - im[k]! * post[2 * k + 1]!;
    const yi = re[k]! * post[2 * k + 1]! + im[k]! * post[2 * k]!;
    x[2 * k] = yr * scale;
    x[n - 1 - 2 * k] = -yi * scale;
  }
}

/**
 * Decodes a take of `samples` samples from `data` into `out` as floats. False, with `out` as far as it got, when the
 * data is not such a take.
 */
export function decodeTransform(data: Uint8Array, samples: number, out: Float32Array): boolean {
  const log = data[0] ?? 0;
  if (log < MIN_LOG || log > MAX_LOG || data.length < 2) return false;
  const n = 1 << log;
  const edges = bandsOf(n);
  const bands = edges.length - 1;
  const window = windowOf(n);
  const d = new RangeDecoder(data.subarray(1));
  const m = (kept ??= new Models()).reset();
  const energy = new Int32Array(bands).fill(QUIET);
  const fine = new Int32Array(bands);
  const was = new Int32Array(bands);
  const c = new Float64Array(n);
  const tail = new Float64Array(n);
  let seed = 0x9e3779b9;
  const frames = Math.ceil(samples / n) + 1;
  for (let f = 0; f < frames && !d.bad; f++) {
    let change = 0;
    for (let b = 0; b < bands; b++) {
      const s = d.symbol(m.energy[Math.min(2, Math.abs(change))]!);
      if (s === 0) {
        const g = ENERGY_SPAN + readGamma(d);
        change = d.bits(1) ? -g : g;
      } else change = s - 1 - ENERGY_SPAN;
      energy[b] = Math.max(QUIET, Math.min(LOUD, energy[b]! + change));
      const k = d.symbol(m.fine[was[b]!]!);
      was[b] = k;
      fine[b] = k === SKIP ? 0 : k - 1 + FINE_MIN;
    }
    c.fill(0);
    for (let b = 0; b < bands; b++) {
      const from = edges[b]!;
      const to = edges[b + 1]!;
      if (energy[b] === QUIET) continue;
      if (was[b] === SKIP) {
        const a = STEP[128 + energy[b]!]! * Math.sqrt(3);
        for (let i = from; i < to; i++) c[i] = a * ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) / 2147483648);
        continue;
      }
      const shift = shiftOf(fine[b]!);
      const step = STEP[128 + energy[b]! - fine[b]!]!;
      const scale = 1 << shift;
      let before = 0;
      for (let i = from; i < to; i++) {
        let q = d.symbol(m.magnitude[magnitudeContext(fine[b]!, shift, before)]!);
        before = q;
        if (q === ESCAPE) q += readGamma(d) - 1;
        q = q * scale + (shift > 0 ? d.bits(shift) : 0);
        if (q === 0) c[i] = FILL * step * ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) / 2147483648);
        else c[i] = (d.bits(1) ? -q : q) * step;
      }
    }
    dct4(c);
    // The frame's 2n samples are (c2, -c2 reversed, -c1 reversed, -c1), of its halves c1 and c2, windowed.
    const h = n >> 1;
    const at = (f - 1) * n;
    for (let i = 0; i < n; i++) {
      const first = i < h ? c[h + i]! : -c[n - 1 - (i - h)]!;
      const v = tail[i]! + first * window[i]!;
      const j = at + i;
      if (j >= 0 && j < samples) out[j] = v;
      tail[i] = (i < h ? -c[h - 1 - i]! : -c[i - h]!) * window[n + i]!;
    }
  }
  return d.whole;
}
