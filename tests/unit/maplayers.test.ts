import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { mapHeightfield, mapNodes, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";
import { describe } from "../../tools/map.ts";
import { readLayers, writeLayers } from "../../tools/map/layers.ts";
import { readGrey, writeGrey } from "../../tools/map/png.ts";
import { busyMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-layers-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a map unpacked into a folder of layers and built from it again is the same file", () => {
  const file = writeMap(busyMap());
  const folder = join(dir, "busy");
  writeLayers(parseMap(file), folder);
  expect(writeMap(readLayers(folder))).toEqual(file);
  expect(describe(file).slice(1)).toEqual([
    "2 by 3 chunks, 128 by 192 m, ground from 29.8 to 50.3 m, sea at 31.25 m",
    "3 static pieces",
    "40 node slots a chunk, scattered where a picture of 4 m a pixel allows: core:tree x4, core:rock x1",
    "3 listed nodes",
    "spawn points: Shore (20, 30.5), Çà et là (100, 150)",
    "spawn regions: 12 of core:spawns_beach at (30, 60.5), 0 of test:elsewhere at (100, 150)",
    "not in the core content: test:elsewhere",
  ]);
});

test("layers written by hand: pictures are north up, a raw layer reads like its picture, and a wrong one is named", () => {
  const folder = join(dir, "hand");
  mkdirSync(folder);
  const put = (name: string, data: unknown): void => writeFileSync(join(folder, name), data instanceof Uint8Array ? data : JSON.stringify(data));
  put("map.json", { id: "test:hand", chunks: [1, 1], minY: 0, stepY: 0.5 });
  put("spawns.json", [{ name: "Here", x: 32, z: 32 }]);
  expect(() => readLayers(folder)).toThrow("has no heights.png or heights.u16");
  // The first value is the north-west corner and the last the south-east one, which is the map's origin.
  const heights = new Uint16Array(33 * 33).fill(40);
  heights[0] = 500;
  heights[33 * 33 - 1] = 7;
  put("heights.u16", new Uint8Array(heights.buffer));
  // The top right pixel is the north-east corner: x = 0, z = 64.
  const tint = new Uint8Array(33 * 33);
  tint[32] = 9;
  put("tint.png", writeGrey(33, 33, tint));
  // Nodes may stand on the east half, which is the right of the picture, and one is listed in the west.
  put("east.png", writeGrey(8, 8, Uint8Array.from({ length: 64 }, (_, i) => (i % 8 >= 4 ? 255 : 0))));
  put("nodes.json", [{ seed: 3, perChunk: 200, kinds: { "core:rock": 1 }, allow: "east.png" }, { list: [{ kind: "core:bush", x: 50.5, z: 10, yaw: 90 }] }]);
  put("statics.json", [{ kind: "core:crate", x: 10, y: 20.5, z: 30, yaw: -90 }]);

  const map = readLayers(folder);
  const hf = mapHeightfield(map);
  expect([hf.sample(32, 32), hf.sample(0, 0), hf.sample(5, 5), hf.seaLevel]).toEqual([250, 3.5, 20, -Infinity]);
  expect([map.tint[32 * 33], map.tint.reduce((sum, v) => sum + v, 0)]).toEqual([9, 9]);
  expect([map.statics, map.spawns]).toEqual([[{ kind: "core:crate", x: 10, y: 20.5, z: 30, yaw: 49152 }], [{ name: "Here", x: 32, z: 32, yaw: 0 }]]);
  const nodes = mapNodes(map, hf, coreRegistry())!;
  const spot: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  let rocks = 0;
  for (let i = 0; i < 200; i++) {
    nodes.at(0, i, spot);
    if (spot.kind === 0) continue;
    rocks++;
    expect(spot.x).toBeLessThan(32);
  }
  expect(rocks).toBeGreaterThan(50);
  nodes.at(0, 200, spot);
  expect([spot.x, spot.z, spot.yaw]).toEqual([50.5, 10, 16384]);

  put("heights.png", writeGrey(33, 33, new Uint8Array(33 * 33)));
  expect(() => readLayers(folder)).toThrow("heights.png is 33 by 33 at 8 bits, and must be 33 by 33 at 16");
  put("heights.png", writeGrey(33, 32, new Uint16Array(33 * 32)));
  expect(() => readLayers(folder)).toThrow("heights.png is 33 by 32 at 16 bits, and must be 33 by 33 at 16");
});

test("a layer picture from another program is read whichever way its rows were filtered", () => {
  const png = (width: number, height: number, depth: number, rows: number[]): Uint8Array => {
    const header = new Uint8Array(33);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x89504e47);
    view.setUint32(8, 13);
    view.setUint32(16, width);
    view.setUint32(20, height);
    header[24] = depth;
    const data = deflateSync(Uint8Array.from(rows));
    const idat = new Uint8Array(12 + data.length);
    new DataView(idat.buffer).setUint32(0, data.length);
    idat.set([73, 68, 65, 84], 4);
    idat.set(data, 8);
    return Uint8Array.from([...header, ...idat]);
  };
  // Rows filtered by nothing, by the average of left and above, and by Paeth's choice among left, above and above left.
  expect([...readGrey(png(3, 3, 8, [0, 10, 20, 30, 3, 5, 5, 5, 4, 1, 1, 1]), "a.png").data]).toEqual([10, 20, 30, 10, 20, 30, 11, 21, 31]);
  // Sixteen bits, high byte first, filtered by the pixel to the left and then by the one above.
  expect([...readGrey(png(2, 2, 16, [1, 0x01, 0x00, 0x00, 0x05, 2, 0x00, 0x10, 0x01, 0x00]), "b.png").data]).toEqual([0x0100, 0x0105, 0x0110, 0x0205]);
  expect(() => readGrey(Uint8Array.from(writeGrey(2, 2, new Uint8Array(4)), (b, i) => (i === 25 ? 6 : b)), "c.png")).toThrow("c.png: a layer is one channel");
});
