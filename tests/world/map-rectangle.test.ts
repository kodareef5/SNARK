import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGrey } from "../../tools/map/png.ts";
import { Base, gridOf, type MapInfo } from "../../tools/mapworld/base.ts";
import type { Ground } from "../../tools/mapworld/ground.ts";
import { binKey } from "../../tools/mapworld/raster.ts";
import { siteOf } from "../../tools/mapworld/statics.ts";

const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

/** A map folder's frame: how big, where on the lattice and its bounds in metres from the projection's centre. */
interface Frame { size_m: number[]; chunks: number[]; grid_samples: number[]; frame: number[]; bounds: number[] }
// 8 by 6 chunks round its projection's centre, at the lattice's middle.
const WHOLE: Frame = { size_m: [512, 384], chunks: [8, 6], grid_samples: [257, 193], frame: [2048, 2048], bounds: [-256, -192, 256, 192] };
// A cut of the same city 5 by 4 chunks, its south-east corner two chunks west and one north of the whole's (v2 cuts a
// city by its bounds round one centre, tools/maps/city.ts).
const CUT: Frame = { size_m: [320, 256], chunks: [5, 4], grid_samples: [161, 129], frame: [2050, 2049], bounds: [-192, -128, 128, 128] };

// A source of `f` round one projection's centre: its water a pattern of every sample's column and row, a footprint in the
// middle and one at its east edge, and a spawn point in each.
function source(f: Frame = WHOLE): string {
  const folder = mkdtempSync(join(tmpdir(), "snark-rectangle-")); folders.push(folder);
  for (const sub of ["base", "world", "blocks"]) mkdirSync(join(folder, sub));
  const [w, h] = f.grid_samples as [number, number];
  const info = { ...f, chunk_m: 64, spacing_m: 2, center_lon_lat: [-80.17, 25.78] };
  writeFileSync(join(folder, "map.json"), JSON.stringify(info));
  const pattern = new Uint8Array(w * h).map((_, i) => (Math.floor(i / w) * 7 + (i % w)) % 251);
  writeFileSync(join(folder, "base/water.png"), writeGrey(w, h, pattern));
  writeFileSync(join(folder, "base/height.png"), writeGrey(w, h, new Uint16Array(w * h).map((_, i) => i % 65536)));
  const square = (e: number, n: number): number[][][] => [[[e, n], [e + 10, n], [e + 10, n + 10], [e, n + 10], [e, n]]];
  writeFileSync(join(folder, "base/buildings.geojson"), JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: square(-20, -20) }, properties: { id: 1 } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: square(122, 0) }, properties: { id: 2 } },
  ] }));
  const base = new Base(folder);
  const at = (e: number, n: number): [number, number] => base.tm.inverse(e, n);
  writeFileSync(join(folder, "world/world.json"), JSON.stringify({ id: "test:rectangle", districts: [], spawns: [{ name: "middle", at: at(0, 0), face: at(0, 10), ground: "open" }, { name: "east", at: at(200, 0), face: at(200, 10), ground: "open" }] }));
  return folder;
}

test("a map.json must say the same in its bounds, sizes, chunks and samples", () => {
  const info: MapInfo = { size_m: [512, 384], chunks: [8, 6], grid_samples: [257, 193], spacing_m: 2, frame: [2048, 2048], bounds: [-256, -192, 256, 192], center_lon_lat: [0, 0] };
  expect(gridOf(info)).toMatchObject({ nx: 257, nz: 193, sizeX: 512, sizeZ: 384, x0: 0, z0: 0, x1: 512, z1: 384 });
  expect(() => gridOf({ ...info, chunks: [8, 8] })).toThrow();
  expect(() => gridOf({ ...info, grid_samples: [257, 257] })).toThrow();
});

test("a place in a smaller cut of a city and in a wider one has the same lattice metres to the bit, the same sample and the same noise", () => {
  // What lets anchors and recorded places survive a new cut (D810): each cut is its own source round the same centre.
  const [a, b] = [new Base(source(WHOLE)), new Base(source(CUT))];
  const site = (base: Base) => siteOf({ id: "test", label: "test", seaNavd88: 0, minY: 0, stepY: 1, districts: [], spawns: [] }, { grid: base.grid, height: new Float32Array(base.samples), lakes: null, heaps: { ruins: [] } } as unknown as Ground, base.folder);
  const [sa, sb] = [site(a), site(b)];
  let differ = 0;
  for (let k = 0; k < 1000; k++) {
    const e = -190 + ((k * 7919) % 31700) / 100, n = -126 + ((k * 104729) % 25300) / 100;
    const [xa, za] = sa.toLattice(e, n), [xb, zb] = sb.toLattice(e, n);
    if (!Object.is(xa, xb) || !Object.is(za, zb)) differ++;
  }
  expect(differ).toBe(0);
  // A sample's place, column and noise read the same in both: the cut's (0, 0) is the source's (32, 32).
  const [ga, gb] = [a.grid, b.grid];
  expect(gb.x1 - 0 * 2).toBe(ga.x1 - 32 * 2);
  expect(gb.z1 - 0 * 2).toBe(ga.z1 - 32 * 2);
  expect(0 * 2 + gb.noiseWest).toBe(32 * 2 + ga.noiseWest);
  expect(0 * 2 + gb.noiseNorth).toBe(32 * 2 + ga.noiseNorth);
  // The cut's engine metres are its lattice metres less its east and south edges'.
  expect([gb.x0, gb.z0]).toEqual([128, 64]);
});

test("a bin's key is its own on either side of the lattice's middle", () => {
  const keys = new Set<number>();
  for (let row = -3; row <= 3; row++) for (const column of [-4097, -1025, -1, 0, 1, 1023, 1024, 4095, 4096]) keys.add(binKey(column, row));
  expect(keys.size).toBe(7 * 9);
});
