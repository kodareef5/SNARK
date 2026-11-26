// Numbers listed in the square cells of a plane that each one's box meets, as typed arrays: count each, lay, put each.
// A test that a thing within some distance of a point holds reads only the cells round the point, so it reads each thing
// whose box comes within that distance, some of them more than once. The build's spatial lists that held a list a bin
// of up to thousands of pieces read this instead (ruin-growth.ts, ruin-clearance.ts).

/** How far past a test's own bound its cells are read, for the rounding of the bound. */
export const SLACK = 0.01;

export class CellLists {
  private readonly across: number;
  private readonly down: number;
  private readonly start: Int32Array;
  private readonly next: Int32Array;
  private items = new Int32Array(0);
  private readonly size: number;
  private readonly x0: number;
  private readonly z0: number;

  /** Cells of `size` metres over a plane `width` by `depth` from (x0, z0); a box past its edge is in the edge's cells. */
  constructor(width: number, depth: number, size: number, x0 = 0, z0 = 0) {
    this.size = size; this.x0 = x0; this.z0 = z0;
    this.across = Math.ceil(width / size) + 1;
    this.down = Math.ceil(depth / size) + 1;
    this.start = new Int32Array(this.across * this.down + 1);
    this.next = new Int32Array(this.across * this.down);
  }

  // Clamped at both ends, so two spans that meet still meet once clamped.
  private col(x: number): number { return Math.min(this.across - 1, Math.max(0, Math.floor((x - this.x0) / this.size))); }
  private row(z: number): number { return Math.min(this.down - 1, Math.max(0, Math.floor((z - this.z0) / this.size))); }

  /** Counts a box from (x0, z0) to (x1, z1): every box is counted before `lay`, then put in the same order. */
  countBox(x0: number, z0: number, x1: number, z1: number): void {
    const c1 = this.col(x1), r1 = this.row(z1);
    for (let row = this.row(z0); row <= r1; row++) for (let col = this.col(x0); col <= c1; col++) this.start[row * this.across + col + 1]!++;
  }

  count(x: number, z: number, r: number): void { this.countBox(x - r, z - r, x + r, z + r); }

  lay(): void {
    for (let c = 1; c < this.start.length; c++) this.start[c]! += this.start[c - 1]!;
    this.items = new Int32Array(this.start[this.start.length - 1]!);
    this.next.set(this.start.subarray(0, this.next.length));
  }

  putBox(x0: number, z0: number, x1: number, z1: number, item: number): void {
    const c1 = this.col(x1), r1 = this.row(z1);
    for (let row = this.row(z0); row <= r1; row++) for (let col = this.col(x0); col <= c1; col++) this.items[this.next[row * this.across + col]!++] = item;
  }

  put(x: number, z: number, r: number, item: number): void { this.putBox(x - r, z - r, x + r, z + r, item); }

  /** Whether `test` holds for a number whose box meets a cell of the square of half side `r` round (x, z). */
  some(x: number, z: number, r: number, test: (item: number) => boolean): boolean {
    const c1 = this.col(x + r), r1 = this.row(z + r);
    for (let row = this.row(z - r); row <= r1; row++) for (let col = this.col(x - r); col <= c1; col++) {
      const c = row * this.across + col;
      for (let k = this.start[c]!, end = this.start[c + 1]!; k < end; k++) if (test(this.items[k]!)) return true;
    }
    return false;
  }
}
