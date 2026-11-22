import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { withContent } from "../../shared/content/registry.ts";
import { BEND_SHORTS, packBend, placeKerb } from "../../shared/world/bends.ts";
import { mapHeightfield, mapNodes, mapTops, parseMap, readHead, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";
import { roadSamples } from "../../shared/world/roadframe.ts";
import { encodeStreets, heldSide, kindsByte } from "../../shared/world/streets.ts";
import { describe, made } from "../../tools/map.ts";
import { readLayers, writeLayers } from "../../tools/map/layers.ts";
import { readGrey, writeGrey } from "../../tools/map/png.ts";
import { lakesMap } from "../fixtures/lakes.ts";
import { busyMap, flatMap } from "../fixtures/map.ts";
import { FRAME_MIDDLE } from "../../shared/coords.ts";
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
    "south-east corner at lattice column 2048, row 2048; display origin at column 2064, row 2064",
    "3 static pieces",
    "40 node slots a chunk, scattered where a picture of 4 m a pixel allows: core:tree x4, core:rock x1",
    "3 listed nodes",
    "30 node slots a chunk, by zones of 16 m: 1 core:palm x1, bare x2; 2 core:fig x1, core:fern x2; 14 slots taken out",
    "spawn points: Shore (20, 30.5), Çà et là (100, 150)",
    "spawn regions: 12 of core:spawns_beach at (30, 60.5), 0 of test:elsewhere at (100, 150)",
    "parked vehicles: 2 of core:compact, 1 of test:hauler",
    "not in the core content: test:elsewhere, test:hauler",
  ]);
  // Where it sits on the lattice and its display origin go into the folder's map.json, and come back.
  const placed = writeMap({ ...busyMap(), tideEyes: [{ name: "The Lantern", x: 32, y: 4, z: 60, radius: 24, color: "green", form: "lantern", yaw: 61873 }], dims: { chunksX: 2, chunksZ: 3, frameX: 3000, frameZ: 17, originX: 3008, originZ: 128 } });
  writeLayers(parseMap(placed), join(dir, "placed"));
  expect(JSON.parse(readFileSync(join(dir, "placed", "map.json"), "utf8"))).toMatchObject({ chunks: [2, 3], frame: [3000, 17], origin: [3008, 128] });
  expect(writeMap(readLayers(join(dir, "placed")))).toEqual(placed);
  expect(describe(placed)[2]).toBe("south-east corner at lattice column 3000, row 17; display origin at column 3008, row 128");
  // A scattered layer's slots taken out go into the folder as their own file, and come back.
  const busy = busyMap();
  const out = writeMap({ ...busy, nodes: busy.nodes.map((l) => ("zone" in l ? { ...l, out: new Uint8Array(Math.ceil((6 * l.perChunk) / 8)).fill(0x0f) } : l)) });
  writeLayers(parseMap(out), join(dir, "out"));
  expect(writeMap(readLayers(join(dir, "out")))).toEqual(out);
  expect(describe(out)[6]).toBe("30 node slots a chunk, by zones of 16 m: 1 core:palm x1, bare x2; 2 core:fig x1, core:fern x2; 92 slots taken out");
});

test("a map's streets, roads' frame, landmarks and bent pieces unpacked and built again are the same parts: what a city's build adds after its layers", () => {
  const busy = busyMap();
  // A street along x with its kerbs, a sector's part; the frame's planes every 4 m; a landmark of its own definition; a
  // raised kerb of bent pieces, whose collision is made where the map is read.
  const side = heldSide(4, 1.5, 2, kindsByte(1, 1, 0));
  const part = encodeStreets({ x0: 0, z0: 0, stretches: [{ type: 3, flags: 0, seed: 77, sides: [side, side], xz: Float64Array.of(10, 100, 120, 100) }], corners: [] });
  const cells = roadSamples(2 * 32 + 1) * roadSamples(3 * 32 + 1), plane = (k: number): Uint8Array => Uint8Array.from({ length: cells }, (_, i) => (i * k + 1) & 255);
  const content = { landmarks: [{ name: "hut", x: 60, y: 35, z: 90, yaw: 12345 }], defs: [{ type: "structure", class: "static", id: "hut:wall", mesh: "box", color: 5, half: [2, 2, 0.2], hp: 50 }] as never[] };
  const kerb = placeKerb({ x: [20, 60], z: [104, 104], y: [31.5, 31.5] }, 1, { kerb: "raised", walk: 2, panel: 1.5, seed: 3, wear: 0.4 }).map((p) => {
    const bend = new Int16Array(BEND_SHORTS);
    packBend(bend, 0, p.bend);
    return { kind: p.kind, x: p.x, y: p.y, z: p.z, yaw: Math.round((p.yaw / 360) * 65536) & 0xffff, bend };
  });
  const map = { ...busy, statics: [...busy.statics, ...kerb], streets: [{ col: 128, row: 128, bytes: part }], road: { across: plane(3), along: plane(5), half: plane(7), lanes: plane(11) }, content };
  const file = writeMap({ ...map, tops: mapTops(map, withContent(coreRegistry(), content.defs)) });
  const folder = join(dir, "attached");
  // As tools/map.ts unpack and build do.
  writeLayers(parseMap(file, true, true), folder);
  const again = writeMap(made(readLayers(folder)));
  expect(readHead(again).parts.map((p) => `${p.kind} ${p.hash}`)).toEqual(readHead(file).parts.map((p) => `${p.kind} ${p.hash}`));
  expect(readHead(file).parts.filter((p) => p.kind === "streets" || p.kind === "road").length).toBeGreaterThan(1);
  expect(again).toEqual(file);
  // Kerbs round the corner of four sectors, listed round their arcs as a build lays them: the collision pieces that stand
  // in another sector than their bent piece are stored there in the order of their pieces' sectors, as the file lists
  // its pieces, so a list whose sectors keep their own order (the folder of layers, sector by sector) writes the same bytes.
  const ring = (r: number): MapStatic[] => {
    const at = (k: number): [number, number] => [128 + r * Math.cos((k * Math.PI) / 24), 128 + r * Math.sin((k * Math.PI) / 24)];
    return placeKerb({ x: Array.from({ length: 49 }, (_, k) => at(k)[0]), z: Array.from({ length: 49 }, (_, k) => at(k)[1]), y: Array.from({ length: 49 }, () => 1) }, 1, { kerb: "raised", walk: 3, panel: 1.5, seed: 77, wear: 0.4 }).map((p) => {
      const bend = new Int16Array(BEND_SHORTS);
      packBend(bend, 0, p.bend);
      return { kind: p.kind, x: p.x, y: p.y + 32, z: p.z, yaw: Math.round((p.yaw / 360) * 65536) & 0xffff, bend };
    });
  };
  const corner = (statics: MapStatic[]) => writeMap(flatMap(4, { dims: { chunksX: 4, chunksZ: 4, frameX: FRAME_MIDDLE - 2, frameZ: FRAME_MIDDLE - 2 }, statics }));
  const rings = [...ring(30), ...ring(20)], sectorOf = (s: MapStatic): number => (s.z >= 128 ? 2 : 0) + (s.x >= 128 ? 1 : 0);
  const cornered = corner(rings);
  expect(corner([...rings].sort((a, b) => sectorOf(b) - sectorOf(a)))).toEqual(cornered);
  writeLayers(parseMap(cornered), join(dir, "cornered"));
  expect(writeMap(readLayers(join(dir, "cornered")))).toEqual(cornered);
});

test("a map's water unpacked into its picture of squares and its list of bodies builds the same file again", () => {
  const file = writeMap(lakesMap());
  const folder = join(dir, "lakes");
  writeLayers(parseMap(file), folder);
  expect(writeMap(readLayers(folder))).toEqual(file);
  expect(describe(file).at(-1)).toBe("4 bodies of water in 1932 squares of 2 m over 10 chunks, surfaces 1.25 to 20.00 m: High Pond, Low Pond, Channel");
  // North up: the high pond, at x 190 and z 190 from the south-east corner, is in the picture's upper left quarter.
  const squares = readGrey(new Uint8Array(readFileSync(join(folder, "water.png"))), "water.png");
  expect([squares.width, squares.data[(128 - 95) * 128 + (128 - 95)]]).toEqual([128, 1]);
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
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
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
