// Seeded random numbers (mulberry32). All game randomness comes from here, so a seed reproduces a run. The generator uses
// integer arithmetic only, so it is identical on every engine.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  u32(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
}
