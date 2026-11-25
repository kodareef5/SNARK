import { expect, test } from "bun:test";
import { BODY_CELL, BodyGrid } from "../../server/bodies.ts";
import { Rng } from "../../shared/rng.ts";

test("a body grid gives the bodies in the cells a square meets, in the same order for the same adds, and forgets them when cleared", () => {
  const grid = new BodyGrid({ chunksX: 4, chunksZ: 4 });
  const near = (x: number, z: number, r: number): number[] => {
    // `found` may be replaced by a larger one during the call, so it is read after.
    const n = grid.near(x, z, r);
    return Array.from(grid.found.subarray(0, n));
  };
  // Two in one cell, one in the next cell east, one in the next chunk, one far off, and one off the map's edge.
  grid.add(1, 100.5, 100.5);
  grid.add(2, 101.5, 100.5);
  grid.add(3, 100.5 + BODY_CELL, 100.5);
  grid.add(4, 130, 100.5);
  grid.add(5, 220, 220);
  grid.add(6, -3, 100.5);
  expect(near(100.5, 100.5, 1)).toEqual([2, 1]);
  expect(near(104, 100.5, 5)).toEqual([2, 1, 3]);
  expect(near(115, 100.5, 16)).toEqual([2, 1, 3, 4]);
  expect(near(220, 220, 0)).toEqual([5]);
  expect(near(0, 100.5, 2)).toEqual([6]);
  // Past a thousand bodies it grows, and still finds every one.
  for (let i = 0; i < 1000; i++) grid.add(100 + i, 50 + (i % 40), 50 + Math.floor(i / 40));
  expect(near(70, 62, 30).filter((e) => e >= 100).length).toBe(1000);
  grid.clear();
  expect([grid.count, near(100.5, 100.5, 50).length]).toEqual([0, 0]);
  grid.add(7, 100.5, 100.5);
  expect(near(100.5, 100.5, 1)).toEqual([7]);
});

/** The grid as it was before it cleared only the cells it filled: every cell of every chunk that held a body. */
class FullClearGrid {
  found = new Int32Array(64);
  count = 0;
  private ents: number[] = [];
  private next: number[] = [];
  private xs: number[] = [];
  private zs: number[] = [];
  private reachOf: number[] = [];
  private readonly per: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: (Int32Array | null)[];
  private readonly reaches: (Float32Array | null)[];
  private most = 0;
  private readonly used = new Set<number>();

  private readonly chunksX: number;
  private readonly cell: number;

  constructor(dims: { chunksX: number; chunksZ: number }, cell: number) {
    this.chunksX = dims.chunksX;
    this.cell = cell;
    this.per = 64 / cell;
    this.cols = dims.chunksX * this.per;
    this.rows = dims.chunksZ * this.per;
    this.heads = new Array(dims.chunksX * dims.chunksZ).fill(null);
    this.reaches = new Array(dims.chunksX * dims.chunksZ).fill(null);
  }

  clear(): void {
    for (const c of this.used) {
      this.heads[c]!.fill(-1);
      this.reaches[c]!.fill(0);
    }
    this.used.clear();
    this.ents.length = this.next.length = this.xs.length = this.zs.length = this.reachOf.length = 0;
    this.count = 0;
    this.most = 0;
  }

  add(e: number, x: number, z: number, reach = 0): void {
    const per = this.per;
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const cz = Math.min(this.rows - 1, Math.max(0, Math.floor(z / this.cell)));
    const chunk = Math.floor(cz / per) * this.chunksX + Math.floor(cx / per);
    if (!this.heads[chunk]) {
      this.heads[chunk] = new Int32Array(per * per).fill(-1);
      this.reaches[chunk] = new Float32Array(per * per);
    }
    const heads = this.heads[chunk]!, reaches = this.reaches[chunk]!;
    const cell = (cz % per) * per + (cx % per);
    this.used.add(chunk);
    if (reach > reaches[cell]!) reaches[cell] = reach;
    if (reach > this.most) this.most = reach;
    const n = this.count++;
    this.ents.push(e);
    this.xs.push(x);
    this.zs.push(z);
    this.reachOf.push(reach);
    this.next.push(heads[cell]!);
    heads[cell] = n;
  }

  gather(x: number, z: number, r: number, reach: boolean): number[] {
    const size = this.cell, per = this.per, pad = reach ? r + this.most : r;
    const cx0 = Math.max(0, Math.floor((x - pad) / size)), cz0 = Math.max(0, Math.floor((z - pad) / size));
    const cx1 = Math.min(this.cols - 1, Math.floor((x + pad) / size)), cz1 = Math.min(this.rows - 1, Math.floor((z + pad) / size));
    const out: number[] = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      const gz = Math.max(cz * size - z, 0, z - (cz + 1) * size);
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = Math.floor(cz / per) * this.chunksX + Math.floor(cx / per);
        const heads = this.heads[chunk];
        if (!heads) continue;
        const cell = (cz % per) * per + (cx % per);
        if (reach) {
          const gx = Math.max(cx * size - x, 0, x - (cx + 1) * size), most = r + this.reaches[chunk]![cell]!;
          if (gx * gx + gz * gz > most * most) continue;
        }
        for (let k = heads[cell]!; k >= 0; k = this.next[k]!) {
          if (reach) {
            const dx = this.xs[k]! - x, dz = this.zs[k]! - z, most = r + this.reachOf[k]!;
            if (dx * dx + dz * dz > most * most) continue;
          }
          out.push(this.ents[k]!);
        }
      }
    }
    return out;
  }
}

test("clearing only filled cells finds what a full clear found, tick after tick", () => {
  const dims = { chunksX: 12, chunksZ: 12 };
  const rng = new Rng(7311);
  let queries = 0, found = 0;
  for (const cell of [1, BODY_CELL]) {
    const grid = new BodyGrid(dims, cell), ref = new FullClearGrid(dims, cell);
    // Herds that wander, one that leaves a chunk empty for a while and comes back, and strays anywhere on the map.
    const bodies = Array.from({ length: 2400 }, (_, e) => {
      const herd = rng.int(3) !== 0;
      return { e, x: herd ? rng.range(140, 260) : rng.range(-4, 772), z: herd ? rng.range(140, 260) : rng.range(-4, 772), reach: rng.int(4) === 0 ? 0 : rng.range(0.2, 4), on: true };
    });
    for (let tick = 0; tick < 240; tick++) {
      grid.clear();
      ref.clear();
      const away = tick % 60 < 30;
      for (const b of bodies) {
        if (rng.int(40) === 0) b.on = !b.on;
        b.x += rng.range(-1.5, 1.5);
        b.z += rng.range(-1.5, 1.5);
        if (rng.int(200) === 0) [b.x, b.z] = [rng.range(0, 768), rng.range(0, 768)];
        if (!b.on || (away && b.e % 7 === 0)) continue;
        const x = b.e % 7 === 0 ? 100 + (b.x % 60) : b.x, z = b.e % 7 === 0 ? 100 + (b.z % 60) : b.z;
        grid.add(b.e, x, z, b.reach);
        ref.add(b.e, x, z, b.reach);
      }
      expect(grid.count).toBe(ref.count);
      for (let q = 0; q < 60; q++) {
        const x = q % 4 === 0 ? rng.range(-10, 780) : rng.range(130, 270), z = q % 4 === 0 ? rng.range(-10, 780) : rng.range(130, 270), r = rng.range(0, q % 3 === 0 ? 30 : 4), touching = q % 2 === 0;
        const n = touching ? grid.touching(x, z, r) : grid.near(x, z, r);
        const got = Array.from(grid.found.subarray(0, n));
        expect(got).toEqual(ref.gather(x, z, r, touching));
        queries++;
        found += n;
      }
    }
  }
  expect(queries).toBe(28800);
  expect(found).toBeGreaterThan(queries * 5);
});
