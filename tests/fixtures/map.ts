import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapData, NodeList, NodeScatter, NodeZoned } from "../../shared/world/mapfile.ts";

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
  };
}
