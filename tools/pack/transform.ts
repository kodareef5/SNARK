// The encoder of the take code in shared/pack/transform.ts. For each band of each frame it finds what the frame masks
// there (the band's own energy, less more for a tone than for noise; its neighbours' spread across the critical bands;
// the frame before, fading; the threshold of hearing), and takes the coarsest step whose error stays under that. A band
// whose error would be all of it is left to the decoder's noise.

import { ENERGY_SPAN, ESCAPE, FILL, FINE_MAX, FINE_MIN, LOUD, MAX_LOG, MIN_LOG, Model, Models, QUIET, SKIP, STEP, bandsOf, dct4, decodeTransform, fft, magnitudeContext, shiftOf, windowOf } from "../../shared/pack/transform.ts";

const TOP = 1 << 24;

class RangeEncoder {
  private low = 0;
  private range = 0xffffffff;
  private cache = 0;
  private pending = 1;
  private out = new Uint8Array(4096);
  private at = 0;

  private put(b: number): void {
    if (this.at === this.out.length) {
      const grown = new Uint8Array(this.out.length * 2);
      grown.set(this.out);
      this.out = grown;
    }
    this.out[this.at++] = b;
  }
  private shift(): void {
    const carry = this.low >= 0x100000000 ? 1 : 0;
    const low = this.low % 0x100000000;
    if (low < 0xff000000 || carry) {
      let c = this.cache;
      do {
        this.put((c + carry) & 0xff);
        c = 0xff;
      } while (--this.pending !== 0);
      this.cache = Math.floor(low / TOP);
    }
    this.pending++;
    this.low = (low % TOP) * 256;
  }
  private encode(start: number, size: number, total: number): void {
    const r = Math.floor(this.range / total);
    this.low += start * r;
    this.range = size * r;
    while (this.range < TOP) {
      this.range *= 256;
      this.shift();
    }
  }
  symbol(m: Model, s: number): void {
    let cum = 0;
    for (let i = 0; i < s; i++) cum += m.freq[i]!;
    this.encode(cum, m.freq[s]!, m.total);
    m.update(s);
  }
  bits(v: number, bits: number): void {
    this.encode(v, 1, 1 << bits);
  }
  gamma(v: number): void {
    let n = 0;
    while (v >= 2 ** (n + 1)) n++;
    for (let i = 0; i < n; i++) this.bits(0, 1);
    this.bits(1, 1);
    for (let i = n - 1; i >= 0; i--) this.bits(Math.floor(v / 2 ** i) & 1, 1);
  }
  finish(): Uint8Array {
    for (let i = 0; i < 5; i++) this.shift();
    return this.out.subarray(0, this.at);
  }
}

/** Hz of a band's middle, of a frame of `n` at `rate`. */
const hzOf = (k: number, n: number, rate: number): number => ((k + 0.5) * rate) / (2 * n);

/** The threshold of hearing in dB SPL at `hz` (Terhardt), no higher than 40 dB where hearing fades. */
function hearing(hz: number): number {
  const f = Math.max(20, hz) / 1000;
  return Math.min(40, 3.64 * f ** -0.8 - 6.5 * Math.exp(-0.6 * (f - 3.3) ** 2) + 1e-3 * f ** 4);
}

/** dB SPL of a sine at full scale, as the threshold of hearing is placed. */
const FULL_SCALE_DB = 96;
/** dB the noise in a band stays under its own energy, for a tone and for noise. */
const UNDER_TONE = 20;
const UNDER_NOISE = 6;
/** dB a critical band's masking falls per band above it, and below. */
const SPREAD_UP = 10;
const SPREAD_DOWN = 25;
/** By band from 4 below to 4 above, what a band's masking is there. */
const SPREAD = Float64Array.from({ length: 9 }, (_, i) => 10 ** (-(i < 4 ? SPREAD_UP * (4 - i) : SPREAD_DOWN * (i - 4)) / 10));
/** dB a frame's masking falls a millisecond after it. */
const FADE_PER_MS = 0.25;
/** dB the noise stays under what is heard in time where it is; dB more under it 2 ms before it, and 4 ms before;
 * dB what was heard masks less a millisecond after. */
const UNDER_TIME = 10;
const PRE_ONE = 10;
const PRE_TWO = 30;
const POST_PER_MS = 0.5;
/** Above this many Hz, a band less like a tone than this is heard as noise of its energy, where the take allows. */
const NOISE_HZ = 5000;
const NOISE_TONE = 0.15;
/** Of a step, the part above which a coefficient rounds up: under a half, small coefficients go to zero more often. */
const ROUND = 0.4;

export interface CodeOptions {
  /** dB more noise allowed than the masking gives: higher is smaller and worse. */
  looser: number;
  loop: boolean;
  /** Whether noisy high bands may be heard as noise of their energy. */
  noise: boolean;
}

/** `x`, of samples at `rate`, coded with frames of 2^log. */
export function encodeTransform(x: Float32Array, rate: number, log: number, opts: CodeOptions): Uint8Array {
  if (log < MIN_LOG || log > MAX_LOG) throw new Error(`transform: frame 2^${log} is out of range`);
  const n = 1 << log;
  const len = x.length;
  const frames = Math.ceil(len / n) + 1;
  const p = new Float64Array((frames + 1) * n);
  for (let i = 0; i < p.length; i++) {
    const j = i - n;
    if (j >= 0 && j < len) p[i] = x[j]!;
    else if (opts.loop && len > 0) p[i] = x[((j % len) + len) % len]!;
  }
  const edges = bandsOf(n);
  const bands = edges.length - 1;
  const window = windowOf(n);
  const enc = new RangeEncoder();
  const m = new Models();
  const energy = new Int32Array(bands).fill(QUIET);
  const was = new Int32Array(bands);
  const c = new Float64Array(n);
  const re = new Float64Array(2 * n);
  const im = new Float64Array(2 * n);
  const own = new Float64Array(bands);
  const tone = new Float64Array(bands);
  const pw = new Float64Array(n);
  const peak = new Uint8Array(n);
  const [re1, im1, re2, im2] = [0, 1, 2, 3].map(() => new Float64Array(n));
  const noisy = Math.floor((NOISE_HZ * 2 * n) / rate);
  const thr = new Float64Array(bands);
  const last = new Float64Array(bands);
  const e = new Float64Array(bands);
  const q = new Int32Array(n);
  const fineOf = new Int32Array(bands);
  const coded = new Uint8Array(bands);
  const fade = 10 ** ((-FADE_PER_MS * ((n / rate) * 1000)) / 10);
  const loose = 10 ** (opts.looser / 10);
  const ath = Float64Array.from({ length: bands }, (_, b) => {
    let least = Infinity;
    for (let k = edges[b]!; k < edges[b + 1]!; k++) least = Math.min(least, hearing(hzOf(k, n, rate)));
    return n * 0.5 * 10 ** ((least - FULL_SCALE_DB) / 10);
  });
  // What each 2 ms of what is played masks in time, as noise power a sample: itself, what came before it fading, what
  // follows it less. A frame's noise spreads over its window as the window's square, so the quietest of these it
  // covers caps its noise; that keeps it from sounding before what made it (pre-echo).
  const seg = Math.max(16, Math.round(rate / 500));
  const segs = Math.ceil(p.length / seg);
  const power = new Float64Array(segs);
  for (let i = 0; i < p.length; i++) power[Math.floor(i / seg)]! += (p[i]! * p[i]!) / seg;
  const allowed = new Float64Array(segs);
  const after = 10 ** ((-POST_PER_MS * ((seg / rate) * 1000)) / 10);
  for (let s = 0, carried = 0; s < segs; s++) {
    carried = Math.max(power[s]!, carried * after);
    allowed[s] = Math.max(carried, (power[s + 1] ?? 0) * 10 ** (-PRE_ONE / 10), (power[s + 2] ?? 0) * 10 ** (-PRE_TWO / 10)) * 10 ** (-UNDER_TIME / 10) * loose;
  }
  const squares = new Float64Array(2 * n + 1);
  for (let i = 0; i < 2 * n; i++) squares[i + 1] = squares[i]! + window[i]! * window[i]!;
  const h = n >> 1;
  for (let f = 0; f < frames; f++) {
    const at = f * n;
    let cap = Infinity;
    for (let s = Math.floor(at / seg); s * seg < at + 2 * n; s++) {
      const a = Math.max(at, s * seg, opts.loop ? 0 : n);
      const b = Math.min(at + 2 * n, (s + 1) * seg, opts.loop ? p.length : n + len);
      if (b <= a) continue;
      const w2 = (squares[b - at]! - squares[a - at]!) / (b - a);
      if (w2 >= 0.1) cap = Math.min(cap, (n * allowed[s]!) / w2);
    }
    for (let i = 0; i < 2 * n; i++) {
      re[i] = p[at + i]! * window[i]!;
      im[i] = 0;
    }
    // Folded to n, the windowed frame's DCT-IV is its MDCT: (-c reversed - d, a - b reversed) of its quarters a b c d.
    for (let i = 0; i < h; i++) {
      c[i] = -re[3 * h - 1 - i]! - re[3 * h + i]!;
      c[h + i] = re[i]! - re[n - 1 - i]!;
    }
    dct4(c);
    fft(re, im);
    for (let k = 0; k < n; k++) pw[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    // A tone is a peak 7 dB over the bins two and three away (MPEG-1's first model), with the bins either side of it.
    peak.fill(0);
    for (let k = 3; k < n - 3; k++) if (pw[k]! > pw[k - 1]! && pw[k]! >= pw[k + 1]! && pw[k]! > 5 * Math.max(pw[k - 2]!, pw[k + 2]!, pw[k - 3]!, pw[k + 3]!)) peak[k - 1] = peak[k] = peak[k + 1] = 1;
    for (let b = 0; b < bands; b++) {
      let sum = 0;
      let power = 0;
      let missed = 0;
      let peaks = 0;
      const from = edges[b]!;
      const to = edges[b + 1]!;
      for (let k = from; k < to; k++) {
        sum += c[k]! * c[k]!;
        const p2 = pw[k]!;
        power += p2;
        if (peak[k]) peaks += p2;
        // Or a bin whose value its last two frames foretell, its length and turn going on alike (the second model). New
        // sound is taken for a tone.
        const r = Math.sqrt(p2);
        const r1 = Math.sqrt(re1[k]! * re1[k]! + im1[k]! * im1[k]!);
        const r2 = Math.sqrt(re2[k]! * re2[k]! + im2[k]! * im2[k]!);
        if (f < 2 || !(r1 > 0.1 * r && r2 > 0.1 * r)) {
          missed += p2 * 0.05;
          continue;
        }
        const ar = re1[k]! / r1;
        const ai = im1[k]! / r1;
        const br = re2[k]! / r2;
        const bi = -im2[k]! / r2;
        const ur = ar * ar - ai * ai;
        const ui = 2 * ar * ai;
        const len = Math.max(0, 2 * r1 - r2);
        const wr = len * (ur * br - ui * bi);
        const wi = len * (ur * bi + ui * br);
        const dr = re[k]! - wr;
        const di = im[k]! - wi;
        missed += (p2 * Math.sqrt(dr * dr + di * di)) / (r + len + 1e-20);
      }
      e[b] = sum;
      const told = Math.min(1, Math.max(0, -0.299 - 0.43 * Math.log(Math.max(1e-6, missed / Math.max(1e-30, power)))));
      tone[b] = Math.max(told, Math.min(1, peaks / Math.max(1e-30, power)));
      own[b] = sum * 10 ** (-(tone[b]! * UNDER_TONE + (1 - tone[b]!) * UNDER_NOISE) / 10);
    }
    re2.set(re1);
    im2.set(im1);
    re1.set(re.subarray(0, n));
    im1.set(im.subarray(0, n));
    for (let b = 0; b < bands; b++) {
      let t = 0;
      for (let j = Math.max(0, b - 4); j <= Math.min(bands - 1, b + 4); j++) t += own[j]! * SPREAD[j - b + 4]!;
      t = Math.max(t, last[b]! * fade);
      last[b] = t;
      thr[b] = t * loose;
    }
    let total = 0;
    for (let b = 0; b < bands; b++) total += thr[b]!;
    const scale = total > cap ? cap / total : 1;
    for (let b = 0; b < bands; b++) thr[b] = Math.max(thr[b]! * scale, ath[b]!);
    for (let b = 0; b < bands; b++) {
      const from = edges[b]!;
      const to = edges[b + 1]!;
      const w = to - from;
      const ms = e[b]! / w;
      const level = ms > 0 ? Math.round(2 * Math.log2(ms)) : QUIET;
      let target = Math.max(QUIET + 1, Math.min(LOUD, level));
      let fine = FINE_MIN;
      coded[b] = 0;
      if (level <= QUIET) target = QUIET;
      else if (e[b]! > thr[b]! && !(opts.noise && from >= noisy && tone[b]! < NOISE_TONE && e[b]! <= cap)) {
        let k = Math.max(FINE_MIN, Math.min(FINE_MAX, target - Math.floor(2 * Math.log2((12 * thr[b]!) / w))));
        for (; ; k++) {
          const step = STEP[128 + target - k]!;
          let err = 0;
          let any = false;
          for (let i = from; i < to; i++) {
            const v = Math.floor(Math.abs(c[i]!) / step + ROUND);
            q[i] = c[i]! < 0 ? -v : v;
            if (v !== 0) any = true;
            const d = c[i]! - q[i]! * step;
            // A coefficient coded zero is heard with the decoder's fill as well.
            err += d * d + (v === 0 ? (FILL * FILL * step * step) / 3 : 0);
          }
          fine = k;
          coded[b] = any ? 1 : 0;
          if (err <= thr[b]! || k === FINE_MAX) break;
        }
      }
      fineOf[b] = fine;
      e[b] = target - energy[b]!;
      energy[b] = target;
    }
    let below = 0;
    for (let b = 0; b < bands; b++) {
      const change = e[b]!;
      const model = m.energy[Math.min(2, Math.abs(below))]!;
      if (Math.abs(change) <= ENERGY_SPAN) enc.symbol(model, change + ENERGY_SPAN + 1);
      else {
        enc.symbol(model, 0);
        enc.gamma(Math.abs(change) - ENERGY_SPAN);
        enc.bits(change < 0 ? 1 : 0, 1);
      }
      below = change;
      const k = coded[b] ? fineOf[b]! - FINE_MIN + 1 : SKIP;
      enc.symbol(m.fine[was[b]!]!, k);
      was[b] = k;
    }
    for (let b = 0; b < bands; b++) {
      if (!coded[b]) continue;
      const fine = fineOf[b]!;
      const shift = shiftOf(fine);
      let before = 0;
      for (let i = edges[b]!; i < edges[b + 1]!; i++) {
        const a = Math.abs(q[i]!);
        const v = a >> shift;
        const s = Math.min(ESCAPE, v);
        enc.symbol(m.magnitude[magnitudeContext(fine, shift, before)]!, s);
        before = s;
        if (s === ESCAPE) enc.gamma(v - ESCAPE + 1);
        if (shift > 0) enc.bits(a & ((1 << shift) - 1), shift);
        if (a !== 0) enc.bits(q[i]! < 0 ? 1 : 0, 1);
      }
    }
  }
  const body = enc.finish();
  const out = new Uint8Array(1 + body.length);
  out[0] = log;
  out.set(body, 1);
  return out;
}

/**
 * How far over what it masks the decoded `y` of `x` is at worst, in dB, by 2 ms windows: each window's original, what
 * came before it fading 0.5 dB a millisecond, 20 dB under the window after it and 40 dB under the one after that. A
 * frame too long for a sharp sound shows here as sound before it (pre-echo).
 */
export function overMask(x: Float32Array, y: Float32Array, rate: number): number {
  const w = Math.max(16, Math.round(rate / 500));
  const n = Math.ceil(x.length / w);
  const ex = new Float64Array(n + 2);
  const ey = new Float64Array(n);
  for (let i = 0; i < x.length; i++) {
    ex[Math.floor(i / w)]! += x[i]! * x[i]!;
    ey[Math.floor(i / w)]! += y[i]! * y[i]!;
  }
  let peak = 0;
  for (const v of ex) peak = Math.max(peak, v);
  // Under 60 dB below its loudest, a take is not heard over itself.
  const floor = Math.max(peak * 1e-6, 1e-12);
  let worst = -Infinity;
  for (let i = 0, carried = 0; i < n; i++) {
    carried = Math.max(ex[i]!, carried * 0.7943);
    worst = Math.max(worst, 10 * Math.log10(ey[i]! / Math.max(carried, ex[i + 1]! * 0.01, ex[i + 2]! * 1e-4, floor)));
  }
  return worst;
}

/** dB over its mask a take's decoded sound may be, at worst, for the longest frame that keeps it under to be taken. */
const OVER_MASK = 6;

/**
 * `x` coded as a take: of the frames from 2^6 to 2^11 samples, the one that codes it smallest of those that keep it
 * under its mask in time, else the one that comes nearest. Each is decoded to check it.
 */
export function codeTake(x: Float32Array, rate: number, opts: CodeOptions): { bytes: Uint8Array; over: number } {
  let best: { bytes: Uint8Array; over: number } | null = null;
  const y = new Float32Array(x.length);
  for (let log = MAX_LOG; log >= MIN_LOG; log--) {
    if (log > MIN_LOG && 1 << log > 2 * x.length) continue;
    const bytes = encodeTransform(x, rate, log, opts);
    if (!decodeTransform(bytes, x.length, y)) throw new Error(`transform: a take of ${x.length} samples coded with frames of 2^${log} does not decode`);
    const over = overMask(x, y, rate);
    const fits = (o: number): boolean => o <= OVER_MASK;
    if (!best || (fits(over) && (!fits(best.over) || bytes.length < best.bytes.length)) || (!fits(over) && !fits(best.over) && over < best.over)) best = { bytes, over };
  }
  return best!;
}
