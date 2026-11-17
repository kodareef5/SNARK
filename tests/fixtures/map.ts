import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapData, NodeList, NodeScatter, NodeZoned } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";

/** Flat ground at y = 0, `chunks` on a side, with one spawn point in the middle and no water. */
export function flatMap(chunks = 4, more: Partial<MapData> = {}): MapData {
  const side = (chunks * CHUNK_SIZE) / TERRAIN_CELL + 1;
  return {
    id: "test:flat",
    dims: { chunksX: chunks, chunksZ: chunks },
    minY: -32,
    stepY: 1 / 256,
    seaLevel: -Infinity,
    heights: new Uint16Array(side * side).fill(32 * 256),
    tint: new Uint8Array(side * side).fill(1),
    statics: [],
    nodes: [],
    spawns: [{ name: "Middle", x: (chunks * CHUNK_SIZE) / 2, z: (chunks * CHUNK_SIZE) / 2, yaw: 0 }],
    ...more,
  };
}

/** Sloping ground of 2 by 3 chunks with one of everything a file can hold. */
export function busyMap(): MapData {
  const rng = new Rng(41);
  const samples = 65 * 97;
  // Trees may stand on the west half only.
  const allow = new Uint8Array((32 * 48) / 8);
  for (let z = 0; z < 48; z++) for (let x = 16; x < 32; x++) allow[(z * 32 + x) >> 3]! |= 1 << ((z * 32 + x) & 7);
  const scatter: NodeScatter = { seed: 77, perChunk: 40, kinds: [["core:tree", 4], ["core:rock", 1]], allowCell: 4, allow };
  // Squares of 16 m: palms and bare ground in the south, figs and ferns in the north, and nothing in the east of the middle row.
  const zone = Uint8Array.from({ length: 8 * 12 }, (_, k) => (Math.floor(k / 8) < 4 ? 1 : Math.floor(k / 8) < 8 && k % 8 >= 4 ? 0 : 2));
  const zoned: NodeZoned = { seed: 78, perChunk: 30, zones: [{ bare: 2, kinds: [["core:palm", 1]] }, { bare: 0, kinds: [["core:fig", 1], ["core:fern", 2]] }], zoneCell: 16, zone };
  const list: NodeList = { kinds: ["core:bush", "core:rock"], first: Uint32Array.from([0, 2, 2, 3, 3, 3, 3]), kind: Uint8Array.from([0, 1, 0]), x: Uint16Array.from([1024, 40000, 7]), z: Uint16Array.from([2048, 3, 65535]), yaw: Uint16Array.from([0, 16384, 65535]) };
  return {
    id: "test:busy",
    dims: { chunksX: 2, chunksZ: 3 },
    minY: -40.5,
    stepY: 1 / 128,
    seaLevel: 31.25,
    heights: Uint16Array.from({ length: samples }, (_, k) => 9000 + 40 * (k % 65) + rng.int(60)),
    tint: Uint8Array.from({ length: samples }, () => rng.int(256)),
    statics: [
      { kind: "core:wall", x: 12.5, y: 40.25, z: 100, yaw: 16384 },
      { kind: "core:crate", x: 127 + 511 / 512, y: -3 / 512, z: 0, yaw: 65535 },
      { kind: "core:wall", x: 64, y: 44, z: 191.5, yaw: 0 },
    ],
    nodes: [scatter, list, zoned],
    spawns: [{ name: "Shore", x: 20, z: 30.5, yaw: 49152 }, { name: "Çà et là", x: 100, z: 150, yaw: 1 }],
    regions: [
      { kind: "spawn", spawns: "core:spawns_beach", count: 12, at: [30, 60.5], radius: 25 + 1 / 512 },
      { kind: "spawn", spawns: "test:elsewhere", count: 0, at: [100, 150], half: [20, 40] },
    ],
    vehicles: [
      { kind: "core:compact", x: 40.25, z: 70, yaw: 16384 },
      { kind: "test:hauler", x: 128, z: 0, yaw: 65535 },
      { kind: "core:compact", x: 90, z: 120 + 1 / 512, yaw: 0 },
    ],
  };
}

/**
 * Ground of 70 by 20 chunks whose corner is off the lattice's grids of sectors and of overviews, so that it lies on two
 * overviews and ten sectors, the first column of each 8 chunks wide: with every kind of node layer, water in both overviews,
 * and statics in every sector, some on squares' edges and the map's.
 */
export function wideMap(): MapData {
  const rng = new Rng(43);
  const dims = { chunksX: 70, chunksZ: 20, frameX: 2040, frameZ: 2050, originX: 2112, originZ: 2080 };
  const [nx, nz] = [70 * 32 + 1, 20 * 32 + 1];
  const heights = Uint16Array.from({ length: nx * nz }, (_, k) => 8000 + ((k % nx) * 3 + Math.floor(k / nx) * 5) % 900 + rng.int(40));
  const bits = (n: number): Uint8Array => Uint8Array.from({ length: Math.ceil(n / 8) }, () => rng.int(256));
  const scatter: NodeScatter = { seed: 5, perChunk: 20, kinds: [["core:tree", 3], ["core:rock", 1]], allowCell: 8, allow: bits(560 * 160), out: bits(1400 * 20) };
  const zone = Uint8Array.from({ length: 280 * 80 }, (_, k) => Math.floor(k / 280 / 20 + (k % 280) / 50) % 3);
  const zones = [{ bare: 1, kinds: [["core:palm", 2]] as [string, number][] }, { bare: 0, kinds: [["core:fig", 1], ["core:fern", 1]] as [string, number][] }];
  const zoned: NodeZoned = { seed: 6, perChunk: 16, zones, zoneCell: 16, zone, out: bits(1400 * 16) };
  const other: NodeZoned = { seed: 7, perChunk: 8, zones: [zones[1]!], zoneCell: 16, zone: zone.map((z, k) => (k % 7 === 0 ? 0 : Math.min(z, 1))) };
  const first = new Uint32Array(1401);
  for (let c = 0; c < 1400; c++) first[c + 1] = first[c]! + (c % 7 === 3 ? 2 : 0);
  const rows = first[1400]!;
  const list: NodeList = { kinds: ["core:bush", "core:rock"], first, kind: Uint8Array.from({ length: rows }, (_, r) => r % 2), x: Uint16Array.from({ length: rows }, () => rng.int(65536)), z: Uint16Array.from({ length: rows }, () => rng.int(65536)), yaw: Uint16Array.from({ length: rows }, () => rng.int(65536)) };
  const grid = new Uint16Array(560 * 160);
  for (let j = 30; j < 70; j++) for (let i = 20; i < 540; i += 3) grid[j * 560 + i] = 1 + (i % 2);
  const water = MapWater.fromGrid(dims, -32, 1 / 256, 8, [{ name: "Long Pond", level: 8300 }, { name: "", level: 8200 }], grid);
  const kinds = ["core:wall", "core:crate", "core:pillar"];
  const statics = [
    ...Array.from({ length: 4000 }, (_, i) => ({ kind: kinds[i % 3]!, x: rng.int(4480 * 512) / 512, y: rng.int(80 * 512) / 512, z: rng.int(1280 * 512) / 512, yaw: rng.int(65536) })),
    { kind: "core:wall", x: 512, y: 3, z: 0, yaw: 0 },
    { kind: "core:wall", x: 4480, y: 3, z: 1280, yaw: 1 },
    { kind: "core:crate", x: 511 + 511 / 512, y: -1024, z: 896, yaw: 65535 },
    // Under a sector's edge, on it once set on the 1/512 m lattice.
    { kind: "core:wall", x: 512 - 1 / 4096, y: 3, z: 700, yaw: 2 },
  ];
  return { id: "test:wide", dims, minY: -32, stepY: 1 / 256, seaLevel: 0, heights, tint: Uint8Array.from({ length: nx * nz }, () => rng.int(256)), statics, nodes: [scatter, list, zoned, other], spawns: [{ name: "West", x: 4000, z: 600, yaw: 0 }], water };
}

/**
 * Ground of 6 by 6 chunks whose middle is the corner of four sectors and of four overviews: rolling hills, a pond on a rise
 * across that corner, the sea in the south, trees and rocks scattered, bushes listed where `listed`, and walls in every
 * sector. A client's ground comes in parts on it from every side of the corner.
 */
export function cornerMap(listed = false): MapData {
  const dims = { chunksX: 6, chunksZ: 6, frameX: 2045, frameZ: 2045 };
  const [n, cell, minY, stepY] = [6 * 32 + 1, TERRAIN_CELL, -32, 1 / 256];
  const pond = { x: 192, z: 200, r: 40, surface: 7.5 };
  const ground = (x: number, z: number): number => {
    let h = 4 + 2.5 * Math.sin(x / 23) + 1.5 * Math.cos(z / 17) + Math.sin((x + z) / 7);
    const d = Math.hypot(x - pond.x, z - pond.z);
    if (d < pond.r + 20) h = Math.max(h, 8.5 - Math.max(0, d - pond.r) * 0.1);
    if (d < pond.r) h = pond.surface - 0.5 - (pond.r - d) * 0.05;
    if (z < 50) h = Math.min(h, -3 + (z / 50) * 7);
    return h;
  };
  const heights = Uint16Array.from({ length: n * n }, (_, k) => Math.round((ground((k % n) * cell, Math.floor(k / n) * cell) - minY) / stepY));
  const side = (6 * CHUNK_SIZE) / cell;
  const grid = Uint16Array.from({ length: side * side }, (_, k) => (Math.hypot(((k % side) + 0.5) * cell - pond.x, (Math.floor(k / side) + 0.5) * cell - pond.z) < pond.r + cell ? 1 : 0));
  const water = MapWater.fromGrid(dims, minY, stepY, cell, [{ name: "Corner Pond", level: Math.round((pond.surface - minY) / stepY) }], grid);
  const scatter: NodeScatter = { seed: 31, perChunk: 24, kinds: [["core:tree", 3], ["core:rock", 1]], allowCell: 0, allow: null };
  const first = Uint32Array.from({ length: 37 }, (_, c) => 2 * c);
  const list: NodeList = { kinds: ["core:bush"], first, kind: new Uint8Array(72), x: Uint16Array.from({ length: 72 }, (_, r) => 9000 + r * 700), z: Uint16Array.from({ length: 72 }, (_, r) => 40000 - r * 300), yaw: Uint16Array.from({ length: 72 }, (_, r) => r * 900) };
  const statics = Array.from({ length: 24 }, (_, i) => ({ kind: i % 2 ? "core:wall" : "core:crate", x: 20 + (i % 6) * 64, y: ground(20 + (i % 6) * 64, 30 + Math.floor(i / 6) * 96), z: 30 + Math.floor(i / 6) * 96, yaw: i * 4000 }));
  return { id: "test:corner", dims, minY, stepY, seaLevel: 0, heights, tint: Uint8Array.from({ length: n * n }, (_, k) => 1 + ((k % n >> 3) + (Math.floor(k / n) >> 3)) % 5), statics, nodes: listed ? [scatter, list] : [scatter], spawns: [{ name: "Corner", x: 150, z: 150, yaw: 0 }], water };
}
