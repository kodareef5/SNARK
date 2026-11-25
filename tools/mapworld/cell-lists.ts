// Numbers listed in the square cells of a plane that each one's circle meets, as typed arrays: count each, lay, put each.
// A test that a thing within some distance of a point holds reads only the cells round the point, so it reads each thing
// whose circle comes within that distance, some of them more than once. The build's spatial lists that held a list a bin
// of up to thousands of pieces read this instead (ruin-growth.ts).

/** How far past a test's own bound its cells are read, for the rounding of the bound. */
export const SLACK = 0.01;

export class CellLists {
  private readonly across: number;
  private readonly down: number;
  private readonly start: Int32Array;
  private readonly next: Int32Array;
  private items = new Int32Array(0);
  private readonly size: number;

  /** Cells of `size` metres over a plane `width` by `depth` from its origin; a circle past its edge is in the edge's cells. */
  constructor(width: number, depth: number, size: number) {
    this.size = size;
    this.across = Math.ceil(width / size) + 1;
    this.down = Math.ceil(depth / size) + 1;
    this.start = new Int32Array(this.across * this.down + 1);
    this.next = new Int32Array(this.across * this.down);
  }

  // Clamped at both ends, so two spans that meet still meet once clamped.
  private first(v: number, n: number): number { return Math.min(n - 1, Math.max(0, Math.floor(v / this.size))); }

  /** Counts a circle of radius `r` round (x, z): every circle is counted before `lay`, then put in the same order. */
  count(x: number, z: number, r: number): void {
    const x1 = this.first(x + r, this.across), z1 = this.first(z + r, this.down);
    for (let row = this.first(z - r, this.down); row <= z1; row++) for (let col = this.first(x - r, this.across); col <= x1; col++) this.start[row * this.across + col + 1]!++;
  }

  lay(): void {
    for (let c = 1; c < this.start.length; c++) this.start[c]! += this.start[c - 1]!;
    this.items = new Int32Array(this.start[this.start.length - 1]!);
    this.next.set(this.start.subarray(0, this.next.length));
  }

  put(x: number, z: number, r: number, item: number): void {
    const x1 = this.first(x + r, this.across), z1 = this.first(z + r, this.down);
    for (let row = this.first(z - r, this.down); row <= z1; row++) for (let col = this.first(x - r, this.across); col <= x1; col++) this.items[this.next[row * this.across + col]!++] = item;
  }

  /** Whether `test` holds for a number whose circle meets a cell of the square of half side `r` round (x, z). */
  some(x: number, z: number, r: number, test: (item: number) => boolean): boolean {
    const x1 = this.first(x + r, this.across), z1 = this.first(z + r, this.down);
    for (let row = this.first(z - r, this.down); row <= z1; row++) for (let col = this.first(x - r, this.across); col <= x1; col++) {
      const c = row * this.across + col;
      for (let k = this.start[c]!, end = this.start[c + 1]!; k < end; k++) if (test(this.items[k]!)) return true;
    }
    return false;
  }
}
