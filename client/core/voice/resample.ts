// Linear resampler for a stream of blocks. The voice pipeline runs at 48,000 samples a second, whatever the device does.
// Linear interpolation is enough for speech. With equal rates it copies.

export class Resampler {
  /** Input samples per output sample. */
  private readonly step: number;
  /** Where the next output falls between `a` and `b`: 0 at `a`, 1 at `b`. */
  private at = 0;
  private a = 0;
  private b = 0;
  /** How many of the first two samples have been taken. The line needs both ends. */
  private primed = 0;

  constructor(from: number, to: number) {
    this.step = from / to;
  }

  /** The most outputs `n` inputs can give. */
  capacity(n: number): number {
    return Math.ceil(n / this.step) + 1;
  }

  /** Writes to `out` from `start` and returns how many samples it wrote. The stream carries on between calls with no loss or repeat. */
  run(input: Float32Array, n: number, out: Float32Array, start = 0): number {
    if (this.step === 1) {
      out.set(n === input.length ? input : input.subarray(0, n), start);
      return n;
    }
    let w = start;
    let i = 0;
    if (this.primed < 2) {
      if (this.primed === 0 && i < n) {
        this.a = input[i++]!;
        this.primed = 1;
      }
      if (this.primed === 1 && i < n) {
        this.b = input[i++]!;
        this.primed = 2;
      }
      if (this.primed < 2) return 0;
    }
    for (;;) {
      // Move along the input until the next output lies between `a` and `b`.
      while (this.at >= 1) {
        if (i === n) return w - start;
        this.a = this.b;
        this.b = input[i++]!;
        this.at -= 1;
      }
      out[w++] = this.a + (this.b - this.a) * this.at;
      this.at += this.step;
    }
  }
}
