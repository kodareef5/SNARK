// Python's random.Random for a whole-number seed or a text one: the Mersenne Twister with Python's own seeding and
// draws. The Python tier scripts drew every bow, width and wander from it, so a recipe ported with it makes the timbers
// they made.

import { createHash } from "node:crypto";

const N = 624;
const M = 397;

export class PyRandom {
  private readonly mt = new Uint32Array(N);
  private at = N;

  constructor(seed: number | string) {
    const mt = this.mt;
    mt[0] = 19650218;
    for (let i = 1; i < N; i++) mt[i] = (Math.imul(1812433253, mt[i - 1]! ^ (mt[i - 1]! >>> 30)) + i) >>> 0;
    // init_by_array with the words of the seed: one for a number, and for a text those of the number Python makes of it.
    const key = typeof seed === "string" ? textWords(seed) : [Math.abs(seed) >>> 0];
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      mt[i] = ((mt[i]! ^ Math.imul(mt[i - 1]! ^ (mt[i - 1]! >>> 30), 1664525)) + key[j]! + j) >>> 0;
      if (++j >= key.length) j = 0;
      if (++i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    for (let k = N - 1; k > 0; k--) {
      mt[i] = ((mt[i]! ^ Math.imul(mt[i - 1]! ^ (mt[i - 1]! >>> 30), 1566083941)) - i) >>> 0;
      if (++i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private word(): number {
    const mt = this.mt;
    if (this.at >= N) {
      for (let k = 0; k < N; k++) {
        const y = (mt[k]! & 0x80000000) | (mt[(k + 1) % N]! & 0x7fffffff);
        mt[k] = mt[(k + M) % N]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.at = 0;
    }
    let y = mt[this.at++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    return (y ^ (y >>> 18)) >>> 0;
  }

  /** From 0 up to 1. */
  random(): number {
    const a = this.word() >>> 5, b = this.word() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** A whole number from 0 up to `n`, which is under 2^32. */
  randrange(n: number): number {
    const bits = 32 - Math.clz32(n);
    for (;;) {
      const r = this.word() >>> (32 - bits);
      if (r < n) return r;
    }
  }
}

/** The 32-bit words, least first, of the number Python seeds a text with: its bytes followed by their SHA-512. */
function textWords(text: string): number[] {
  const own = Buffer.from(text, "utf8");
  const bytes = Buffer.concat([own, createHash("sha512").update(own).digest()]);
  const words: number[] = [];
  for (let end = bytes.length; end > 0; end -= 4) {
    let word = 0;
    for (let k = Math.max(0, end - 4); k < end; k++) word = word * 256 + bytes[k]!;
    words.push(word >>> 0);
  }
  return words;
}

/** Python's repr of a number that is whole or has a few decimals: what a seed made of numbers is spelt with. */
export function pyRepr(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** Python's round to `digits` decimals, and its remainder, which takes the divisor's sign. */
export const pyRound = (v: number, digits: number): number => Number(v.toFixed(digits));
export function pyMod(x: number, m: number): number {
  const r = x % m;
  return r !== 0 && r < 0 !== m < 0 ? r + m : r;
}
