// The map's pictures: tiles of terrain, and what a screen composes of them.

import { expect, test } from "bun:test";
import { MapPicture, MapStore, ReliefTiles, ZOOMS, paintRelief } from "../../client/core/tactical.ts";
import { lonOf, mapU, mapV } from "../../shared/world/coords.ts";
import { PROVING_POOL, buildProvingHeightfield } from "../../shared/world/proving.ts";
import { CELL_FILLED, Cells } from "../../shared/world/tactical.ts";
import { corePack } from "../fixtures/pack.ts";

const hf = buildProvingHeightfield();
const palette = corePack().palette;
const N = 256;

/** A picture of the proving ground at `zoom` with (x, z) at its middle, once its tiles have come. */
function picture(zoom: number, x: number, z: number, store: MapStore | null = null, team = 0): MapPicture {
  const tiles = new ReliefTiles(hf, palette);
  const p = new MapPicture();
  for (let frame = 0; frame < 6; frame++) {
    tiles.step();
    p.draw(hf, palette, tiles, store, team, zoom, mapU(hf, x), mapV(hf, z), N);
  }
  return p;
}

/** Where a place falls in a picture, in pixels from its top left. */
const column = (p: MapPicture, x: number): number => ((mapU(hf, x) - p.view.u0) / p.view.du) * N;
const row = (p: MapPicture, z: number): number => ((mapV(hf, z) - p.view.v0) / p.view.dv) * N;
const pixel = (p: MapPicture, px: number, py: number): number[] => [...p.image.data.subarray((py * N + px) * 4, (py * N + px) * 4 + 3)];

test("tiles are made one a frame, hold what the painter paints, and only so many are kept", () => {
  const tiles = new ReliefTiles(hf, palette);
  expect(tiles.tile(2, 1, 3)).toBeNull();
  tiles.step();
  const want = new Uint32Array(256 * 256);
  paintRelief(hf, palette, 2, 1, 3, 256, want);
  expect(tiles.tile(2, 1, 3)!.rgba).toEqual(want);
  // Every tile of the pyramid is asked for every frame.
  for (let frame = 0; frame < 150; frame++) {
    const before = tiles.version;
    for (let zoom = 0; zoom < ZOOMS; zoom++) for (let r = 0; r < 1 << zoom; r++) for (let c = 0; c < 1 << zoom; c++) tiles.tile(zoom, c, r);
    tiles.step();
    expect(tiles.version - before).toBe(1);
    expect(tiles.held).toBeLessThanOrEqual(24);
  }
  expect(tiles.held).toBe(24);
});

test("each zoom lines up with the next to within a pixel: the shore of the pool, a structure's cell, and the grid", () => {
  // The pool's west shore along its own latitude, from the heights themselves. West is +X.
  const j = PROVING_POOL.z / hf.cell;
  let i = PROVING_POOL.x / hf.cell;
  while (hf.sample(i, j) < hf.seaLevel) i++;
  const shore = i * hf.cell;
  const water = (c: number[]): boolean => c[2]! > c[0]! * 1.3;
  // A cell of 4 m with its corner at (212, 164), the reader's own.
  const store = new MapStore();
  const cells = new Cells();
  cells.teams[0] = 5;
  cells.teamCount = 1;
  cells.info[9 * 16 + 5] = CELL_FILLED | 2;
  cells.tint[9 * 16 + 5] = 3;
  store.chunks.set(2 * 8 + 3, cells);
  store.version++;
  for (let zoom = 0; zoom < ZOOMS; zoom++) {
    const metres = 512 / (1 << zoom) / N;
    const p = picture(zoom, shore, PROVING_POOL.z);
    expect(p.view.du).toBe(1 / (1 << zoom));
    // The first dry pixel west of the water is where the shore is, to the pixel.
    const py = Math.floor(row(p, PROVING_POOL.z - 0.01));
    let px = Math.floor(column(p, PROVING_POOL.x));
    expect(water(pixel(p, px, py))).toBe(true);
    while (water(pixel(p, px, py))) px--;
    expect(Math.abs(px + 1 - column(p, shore))).toBeLessThanOrEqual(1);
    // In metres that is within a pixel of this zoom, so two zooms differ by no more than a pixel of the coarser.
    expect(Math.abs((px + 1 - column(p, shore)) * metres)).toBeLessThanOrEqual(metres);

    // The cell is where its corners' coordinates put it, in green for the reader's own tribe.
    const bare = picture(zoom, 214, 166);
    const built = picture(zoom, 214, 166, store, 5);
    let [x0, y0, x1, y1] = [N, N, -1, -1];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (pixel(bare, x, y).join() === pixel(built, x, y).join()) continue;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        const c = pixel(built, x, y);
        expect(c[1]! > c[0]! && c[1]! > c[2]!).toBe(true);
      }
    }
    // Its west edge is x = 216 and its north edge z = 168.
    for (const [got, want] of [[x0, column(built, 216)], [x1 + 1, column(built, 212)], [y0, row(built, 168)], [y1 + 1, row(built, 164)]] as const) expect(Math.abs(got - want)).toBeLessThanOrEqual(1);

    // The line of longitude 8 runs down the column its coordinate gives, darker than the ground beside it. The proving ground
    // reads 5 to 10 each way, so its lines inside are a unit's, which are fainter than a sector's (this was longitude 50).
    expect(lonOf(hf.dims, 204.8)).toBeCloseTo(8, 12);
    const mid = picture(zoom, 204.8, 250);
    const line = Math.round(column(mid, 204.8));
    let [on, beside] = [0, 0];
    for (let y = 100; y < 200; y++) {
      on += pixel(mid, line, y)[1]!;
      beside += pixel(mid, line + 3, y)[1]!;
    }
    expect(on).toBeLessThan(beside * 0.85);
  }
});
