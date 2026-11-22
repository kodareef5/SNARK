// The map's pictures: tiles of terrain, and what a screen composes of them.

import { expect, test } from "bun:test";
import { HudModel } from "../../client/core/hud.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { Chart, MapPicture, MapStore, ReliefTiles, ZOOMS, paintRelief } from "../../client/core/tactical.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { KEY_MAP_LINE, buildMap } from "../../client/core/ui/screens.ts";
import { CHUNK_SIZE, type MapDims } from "../../shared/coords.ts";
import { MARKER_DEATH } from "../../shared/net/protocol.ts";
import { latOf, lonOf, mapU, mapV, xOfLon, zOfLat } from "../../shared/world/coords.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
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

/** A pixel's red, green and blue darkened by `a` 256ths, as the grid darkens one. */
const darkened = (c: number[], a: number): number[] => c.map((v) => (v * (256 - a)) >> 8);
/** What a picture of N pixels holds at (px, py). */
const at = (p: MapPicture, px: number, py: number): number[] => {
  const n = p.image.width;
  return [...p.image.data.subarray((py * n + px) * 4, (py * n + px) * 4 + 3)];
};
/** Where no ground is. */
const VOID = [0x1a, 0x24, 0x30];

/** A picture of `m` at `zoom`, `n` pixels a side, looking at (x, z), once its tiles have come. */
function drawn(m: Heightfield, n: number, zoom = 0, x = m.sizeX / 2, z = m.sizeZ / 2): MapPicture {
  const tiles = new ReliefTiles(m, palette);
  const p = new MapPicture();
  for (let frame = 0; frame < 6; frame++) {
    tiles.step();
    p.draw(m, palette, tiles, null, 0, zoom, mapU(m, x), mapV(m, z), n);
  }
  return p;
}

/** Pixels from a picture's left edge to x, and from its top to z. */
const across = (p: MapPicture, m: Heightfield, x: number): number => ((mapU(m, x) - p.view.u0) / p.view.du) * p.image.width;
const down = (p: MapPicture, m: Heightfield, z: number): number => ((mapV(m, z) - p.view.v0) / p.view.dv) * p.image.width;

/**
 * The grid's lines a picture draws across the row at z or down the column at x, each as the metres east of the picture's
 * left or south of its top it stands at, and whether it is a sector's. `ground` is the colour of the plain ground they cross.
 */
function lines(p: MapPicture, m: Heightfield, ground: number[], row: { z: number } | { x: number }): { at: number; sector: boolean }[] {
  const n = p.image.width;
  const metres = (p.view.du * m.sizeX) / n;
  const [unit, sector] = [darkened(ground, 56).join(), darkened(ground, 110).join()];
  const out: { at: number; sector: boolean }[] = [];
  const fixed = Math.floor("z" in row ? down(p, m, row.z) : across(p, m, row.x));
  for (let k = 0; k < n; k++) {
    const c = ("z" in row ? at(p, k, fixed) : at(p, fixed, k)).join();
    if (c === unit || c === sector) out.push({ at: (k + 0.5) * metres, sector: c === sector });
  }
  return out;
}

// A made-up map 12,032 m west to east and 8,000 m north to south, its samples 16 m apart: its picture is what is held
// here. Its ground is plain, with a band 320 m wide round its edge and a disc 3 km across its middle each of their own colour.
function twelveByEight(): Heightfield {
  const m = new Heightfield({ chunksX: 188, chunksZ: 125 }, 16, -32, 1 / 256);
  for (let j = 0; j < m.nz; j++) {
    for (let i = 0; i < m.nx; i++) {
      const [x, z] = [i * m.cell, j * m.cell];
      m.tint[j * m.nx + i] = x < 320 || z < 320 || x > m.sizeX - 320 || z > m.sizeZ - 320 ? 3 : Math.hypot(x - m.sizeX / 2, z - m.sizeZ / 2) < 1500 ? 5 : 1;
    }
  }
  return m;
}

test("a map 12 by 8 km is shown whole in its own proportions: at the middle of the far zoom with no ground past its edges, its sectors square and numbered from its origin, and a window at its edge kept on it", () => {
  const m = twelveByEight();
  const d = m.dims;
  // It reads 2.5 to 120 west to east and 1.9 to 80 north to south.
  expect([lonOf(d, m.sizeX), lonOf(d, 0), latOf(d, m.sizeZ), latOf(d, 0)]).toEqual([2.5, 120, 1.875, 80]);
  const n = 480;
  const p = drawn(m, n);
  // The whole map, as wide as the picture and as deep as its proportions make it, with an even band of nothing above and
  // below, to a pixel of the 256-pixel tile it is drawn from, which is 1.9 of the picture's.
  const filled = (py: number): boolean => at(p, Math.floor(across(p, m, xOfLon(d, 65))), py).join() !== VOID.join();
  const rows = Array.from({ length: n }, (_, py) => filled(py));
  const top = rows.indexOf(true);
  const bottom = rows.lastIndexOf(true) + 1;
  expect(Math.abs(bottom - top - (n * m.sizeZ) / m.sizeX)).toBeLessThanOrEqual(2);
  expect(Math.abs(top - (n - bottom))).toBeLessThanOrEqual(2);
  expect(rows.slice(top, bottom).every((f) => f)).toBe(true);
  // Past the ground nothing is drawn but the grid's lines where the map's edge falls within a pixel of the tile's.
  const nothing = [VOID.join(), darkened(VOID, 110).join()];
  for (const py of [0, top - 1, bottom, n - 1]) for (let px = 0; px < n; px++) expect(nothing).toContain(at(p, px, py).join());
  // The disc is as wide as it is deep.
  const disc = at(p, Math.floor(across(p, m, m.sizeX / 2 + 300)), Math.floor(down(p, m, m.sizeZ / 2 + 300)));
  const inDisc = (c: number[]): boolean => c.join() === disc.join() || c.join() === darkened(disc, 110).join();
  const wide = Array.from({ length: n }, (_, px) => inDisc(at(p, px, Math.floor(down(p, m, m.sizeZ / 2))))).filter(Boolean).length;
  const deep = Array.from({ length: n }, (_, py) => inDisc(at(p, Math.floor(across(p, m, m.sizeX / 2)), py))).filter(Boolean).length;
  expect([Math.abs(wide - (3000 * n) / m.sizeX) <= 2, Math.abs(wide - deep) <= 1]).toEqual([true, true]);
  // The lines across the middle of a sector of plain ground at latitude 65, and down one at longitude 25: a sector's edge
  // every ten units, 1,024 m apart both ways to the pixel, and none in the band at the map's edges.
  const ground = at(p, Math.floor(across(p, m, xOfLon(d, 25))), Math.floor(down(p, m, zOfLat(d, 65))));
  const metres = (p.view.du * m.sizeX) / n;
  const east = lines(p, m, ground, { z: zOfLat(d, 65) });
  const south = lines(p, m, ground, { x: xOfLon(d, 25) });
  // Metres from the picture's left edge are metres west of x = sizeX, since the picture starts at the map's west edge.
  expect(east.map((l) => Math.round(lonOf(d, m.sizeX - l.at)))).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
  expect(south.map((l) => Math.round(latOf(d, m.sizeZ - (l.at - top * metres))))).toEqual([10, 20, 30, 40, 50, 60, 70]);
  for (const l of [...east, ...south]) expect(l.sector).toBe(true);
  for (const list of [east, south]) for (let k = 1; k < list.length; k++) expect(Math.abs(list[k]!.at - list[k - 1]!.at - 1024)).toBeLessThanOrEqual(metres);

  // The minimap starts where its window is about a kilometre and a half, and at the south-east corner it stays on the map.
  const chart = new Chart(m, palette);
  expect(chart.miniZoom).toBe(3);
  for (const zoom of [3, 2, 1]) {
    chart.miniZoom = zoom;
    for (let frame = 0; frame < 6; frame++) {
      chart.tiles.step();
      chart.drawMini(null, 0, mapU(m, 40), mapV(m, 40), 240, true);
    }
    // Its corner is on a whole pixel of the pyramid's square, so its edge is the map's to within half a pixel.
    const v = chart.mini.view;
    const half = (v.du * m.sizeX) / 240 / 2;
    expect([v.zoom, Math.abs(1 - v.u0 - v.du) * m.sizeX <= half, Math.abs(1 - v.v0 - v.dv) * m.sizeZ <= half]).toEqual([zoom, true, true]);
    for (let py = 0; py < 240; py += 3) for (let px = 0; px < 240; px += 3) expect(at(chart.mini, px, py)).not.toEqual(VOID);
  }
});

test("a place keeps its coordinate when the map is widened: the same ground with a column or a row more on each side reads the same at the same places, and its grid's lines fall on the same ground", () => {
  // Ground of 12 by 8 chunks with room to the west and north before the origin, plain, every map of it with the same origin.
  const base: MapDims = { chunksX: 12, chunksZ: 8, frameX: 2040, frameZ: 2045, originX: 2064, originZ: 2064 };
  const maps: [string, MapDims][] = [
    ["base", base],
    ["east", { ...base, frameX: 2039, chunksX: 13 }],
    ["west", { ...base, chunksX: 13 }],
    ["north", { ...base, chunksZ: 9 }],
    ["south", { ...base, frameZ: 2044, chunksZ: 9 }],
  ];
  // Places by their metres on the lattice from the corner of its column 2040 and row 2045, counted west and north as x and z
  // are: all on the base map.
  const places = [[30, 20], [400, 250], [700, 500], [512, 192]] as const;
  const lattice = (dims: MapDims): [number, number] => [(dims.frameX! - 2040) * CHUNK_SIZE, (dims.frameZ! - 2045) * CHUNK_SIZE];
  const seen: Record<string, string[]> = {};
  const grids: Record<string, { at: number; sector: boolean; across: boolean }[]> = {};
  for (const [name, dims] of maps) {
    const m = new Heightfield(dims, 4, -32, 1 / 256);
    m.tint.fill(1);
    const [ox, oz] = lattice(dims);
    // The map screen at its far zoom, with a death at each place: the line under it says where each was.
    const f = new UiFrame();
    f.begin(16 / 9);
    const hud = new HudModel();
    hud.chart = new Chart(m, palette);
    const session = { world: { hf: m }, markers: places.map(([x, z]) => ({ kind: MARKER_DEATH, x: x - ox, y: 0, z: z - oz, tick: 0 })), serverTick: 0, tactical: null, tribe: { team: 0 }, mapLocation: true, own: { x: 100, y: 0, z: 100 } } as unknown as ClientSession;
    for (let frame = 0; frame < 6; frame++) {
      hud.chart.tiles.step();
      buildMap(f, session, hud);
    }
    seen[name] = places.map((_, i) => f.find(KEY_MAP_LINE + i)!.text);
    // The grid's lines across the picture at lattice row 160 m and down it at column 600 m, in metres on the lattice.
    const p = hud.chart.full;
    const metres = (p.view.du * m.sizeX) / p.image.width;
    const [west, north] = [(1 - p.view.u0) * m.sizeX, (1 - p.view.v0) * m.sizeZ];
    const ground = at(p, Math.floor(across(p, m, 600 - ox + 40)), Math.floor(down(p, m, 160 - oz)));
    expect(ground).not.toEqual(VOID);
    grids[name] = [
      ...lines(p, m, ground, { z: 160 - oz }).map((l) => ({ at: ox + west - l.at, sector: l.sector, across: true })),
      ...lines(p, m, ground, { x: 600 - ox }).map((l) => ({ at: oz + north - l.at, sector: l.sector, across: false })),
    ];
    // Each line stands on a whole unit, within a pixel.
    for (const l of grids[name]!) {
      const k = l.across ? lonOf(m.dims, l.at - ox) : latOf(m.dims, l.at - oz);
      expect(Math.abs(k - Math.round(k)) * 102.4).toBeLessThanOrEqual(metres);
      expect(l.sector).toBe(Math.round(k) % 10 === 0);
    }
  }
  // The base map reads its places, and has a sector's line each way and the units' between.
  expect(seen.base).toEqual(["died  11.7 lat  14.7 lon  0 min ago", "died  9.4 lat  11.1 lon  0 min ago", "died  7.0 lat  8.2 lon  0 min ago", "died  10.0 lat  10.0 lon  0 min ago"]);
  expect(grids.base!.map((l) => [l.across, l.sector]).filter(([, s]) => s)).toEqual([[true, true], [false, true]]);
  expect(grids.base!.length).toBe(12);
  for (const [name] of maps) {
    expect([name, seen[name]]).toEqual([name, seen.base]);
    // Within the base map's ground, a pixel from its edges, the lines of the two are the same lines at the same places to a pixel.
    const inside = (l: { at: number; across: boolean }): boolean => l.at > 4 && l.at < (l.across ? 12 : 8) * CHUNK_SIZE - 4;
    const [mine, theirs] = [grids[name]!.filter(inside), grids.base!.filter(inside)];
    expect([name, mine.length]).toEqual([name, theirs.length]);
    for (let k = 0; k < mine.length; k++) {
      expect([name, mine[k]!.across, mine[k]!.sector]).toEqual([name, theirs[k]!.across, theirs[k]!.sector]);
      expect(Math.abs(mine[k]!.at - theirs[k]!.at)).toBeLessThanOrEqual(3.25);
    }
  }
});
