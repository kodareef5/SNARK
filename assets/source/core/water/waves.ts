// Makes the sea's two pictures of wave slopes, long.png and short.png, beside this file: the long waves and the
// ripples on them, as client/core/render/water.ts reads them (LONG, SHORT). Each is a field of waves drawn from a wind
// sea's spectrum (Phillips 1957, as Tessendorf's "Simulating Ocean Water" uses it), summed by our own Fourier
// transform, so that it tiles. Red and green hold the slopes along the picture's x and y, blue the mean of their
// squares, alpha the height. Run: bun assets/source/core/water/waves.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LONG, RMS_SLOPE, SHORT, SLOPE_MOST, SQUARE_MOST, type WaveLayer } from "../../../../client/core/render/water.ts";
import { Rng } from "../../../../shared/rng.ts";
import { encodePng } from "../../../../tools/pack/image.ts";

const SIZE = 256;
const G = 9.81;

/**
 * A layer's sea: its wind's speed, which sets its longest waves (Phillips's L = speed squared over g); the shortest
 * kept, in metres; the longest kept, past which waves are left to the long layer; how much a wave across the wind
 * keeps against one along it; and the seed.
 */
interface Sea {
  layer: WaveLayer;
  wind: number;
  shortest: number;
  longest: number;
  across: number;
  seed: number;
}

const SEAS: readonly (Sea & { file: string })[] = [
  { file: "long.png", layer: LONG, wind: 6.5, shortest: 3, longest: Infinity, across: 0.25, seed: 7 },
  { file: "short.png", layer: SHORT, wind: 2.5, shortest: 0.2, longest: 3, across: 0.5, seed: 11 },
];

/** An FFT of one row or column, in place: `n` a power of two, every `step`th value from `at`. */
function fft(re: Float64Array, im: Float64Array, at: number, step: number, n: number, inverse: boolean): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const [a, b] = [at + i * step, at + j * step];
      [re[a], re[b]] = [re[b]!, re[a]!];
      [im[a], im[b]] = [im[b]!, im[a]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const turn = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const [c, s] = [Math.cos(turn * k), Math.sin(turn * k)];
        const a = at + (i + k) * step;
        const b = at + (i + k + len / 2) * step;
        const xr = re[b]! * c - im[b]! * s;
        const xi = re[b]! * s + im[b]! * c;
        [re[b], im[b]] = [re[a]! - xr, im[a]! - xi];
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/** The field a spectrum makes: the inverse transform across rows, then down columns, real part kept. */
function field(re: Float64Array, im: Float64Array): Float64Array {
  for (let y = 0; y < SIZE; y++) fft(re, im, y * SIZE, 1, SIZE, true);
  for (let x = 0; x < SIZE; x++) fft(re, im, x, SIZE, SIZE, true);
  return re;
}

/** The picture of one layer's sea, as RGBA bytes, and its RMS slope before it was scaled to RMS_SLOPE. */
export function waves(sea: Sea): { rgba: Uint8Array; rms: number } {
  const rng = new Rng(sea.seed);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng.float())) * Math.cos(2 * Math.PI * rng.float());
  const n = SIZE * SIZE;
  const [hr, hi] = [new Float64Array(n), new Float64Array(n)];
  const big = (sea.wind * sea.wind) / G;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const kx = (2 * Math.PI * (x < SIZE / 2 ? x : x - SIZE)) / sea.layer.span;
      const ky = (2 * Math.PI * (y < SIZE / 2 ? y : y - SIZE)) / sea.layer.span;
      const k = Math.hypot(kx, ky);
      const [a, b] = [gauss(), gauss()];
      if (k === 0) continue;
      const along = kx / k;
      const spread = sea.across + (1 - sea.across) * along * along;
      const kept = Math.exp(-Math.pow((k * sea.shortest) / (2 * Math.PI), 2)) * (1 - Math.exp(-Math.pow((k * sea.longest) / (2 * Math.PI), 2)));
      const amp = Math.sqrt((Math.exp(-1 / (k * big * k * big)) / (k * k * k * k)) * spread * kept / 2);
      hr[y * SIZE + x] = a * amp;
      hi[y * SIZE + x] = b * amp;
    }
  }
  // Each slope is the transform of the spectrum times i k.
  const slope = (along: (x: number, y: number) => number): Float64Array => {
    const [re, im] = [new Float64Array(n), new Float64Array(n)];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const k = along(x < SIZE / 2 ? x : x - SIZE, y < SIZE / 2 ? y : y - SIZE) * ((2 * Math.PI) / sea.layer.span);
        re[y * SIZE + x] = -k * hi[y * SIZE + x]!;
        im[y * SIZE + x] = k * hr[y * SIZE + x]!;
      }
    }
    return field(re, im);
  };
  const sx = slope((x) => x);
  const sy = slope((_, y) => y);
  const h = field(hr.slice(), hi.slice());
  let square = 0;
  let high = 0;
  for (let i = 0; i < n; i++) {
    square += sx[i]! * sx[i]! + sy[i]! * sy[i]!;
    high = Math.max(high, Math.abs(h[i]!));
  }
  const rms = Math.sqrt(square / n);
  const scale = RMS_SLOPE / rms;
  const rgba = new Uint8Array(n * 4);
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < n; i++) {
    const [x, y] = [sx[i]! * scale, sy[i]! * scale];
    rgba[i * 4] = byte(128 + (127 * x) / SLOPE_MOST);
    rgba[i * 4 + 1] = byte(128 + (127 * y) / SLOPE_MOST);
    rgba[i * 4 + 2] = byte((255 * (x * x + y * y)) / SQUARE_MOST);
    rgba[i * 4 + 3] = byte(128 + (127 * h[i]!) / high);
  }
  return { rgba, rms };
}

if (import.meta.main) {
  for (const sea of SEAS) {
    const { rgba, rms } = waves(sea);
    writeFileSync(join(import.meta.dir, sea.file), encodePng({ width: SIZE, height: SIZE, channels: 4, depth: 8, data: rgba }));
    console.log(`${sea.file}: ${SIZE} square over ${sea.layer.span} m, waves from ${sea.shortest} m long${sea.longest < Infinity ? ` to ${sea.longest} m` : ""}, RMS slope ${rms.toExponential(2)} made ${RMS_SLOPE}`);
  }
}
