// Python's random.Random for a whole-number seed: the Mersenne Twister with Python's own seeding and draws. The Python
// tier scripts drew every bow, width and wander from it, so a recipe ported with it makes the timbers they made.

const N = 624;
const M = 397;

export class PyRandom {
  private readonly mt = new Uint32Array(N);
  private at = N;

  constructor(seed: number) {
    const mt = this.mt;
    mt[0] = 19650218;
    for (let i = 1; i < N; i++) mt[i] = (Math.imul(1812433253, mt[i - 1]! ^ (mt[i - 1]! >>> 30)) + i) >>> 0;
    // init_by_array with the one word of the seed.
    const key = Math.abs(seed) >>> 0;
    let i = 1;
    for (let k = N; k > 0; k--) {
      mt[i] = ((mt[i]! ^ Math.imul(mt[i - 1]! ^ (mt[i - 1]! >>> 30), 1664525)) + key) >>> 0;
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
