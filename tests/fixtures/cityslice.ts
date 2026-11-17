// A square of a built city's chunks kept as a fixture, so that a test counts what a view of a real city draws without the
// city's build: its ground and its statics in a layout of its own, which does not follow the map file's version, gzipped.
// tools/bench/census.ts cuts it from a built map. Varints as on the wire (shared/net/codec.ts):
//
//   string id of the map it was cut from, u8 chunks a side, f64 minY, f64 stepY, f64 seaLevel, then f64 x and z of that
//   map's centre in the slice's metres
//   varint count of kinds, each a string id; varint count n of statics, then columns of n chunk by chunk in the map's
//   order: varint kind, u16 yaw, and svarint x, y, z in 1/512 m less the piece before's
//   the ground's samples row by row from z = 0: svarint height less the sample before's, then u8 tint each

import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { CHUNK_SIZE, STRUCT_UNITS } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { MapStatics, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";

/** Downtown Miami's 9 by 9 chunks from chunk (99, 48), whose corner is on the far city's tiles of 3 by 3 chunks. */
export const MIAMI_SLICE = new URL("./miami-slice.gz", import.meta.url).pathname;
export const MIAMI_CUT = { cx: 99, cz: 48, side: 9 } as const;

export interface CitySlice {
  readonly map: MapData;
  /** Where the map it was cut from has its centre, in the slice's metres. */
  readonly centre: readonly [number, number];
}

const SAMPLES = CHUNK_SIZE / TERRAIN_CELL;

/** The `side` by `side` chunks of `map` from chunk (cx0, cz0), statics of the kinds `keep` takes. */
export function cutSlice(map: MapData, cx0: number, cz0: number, side: number, keep: (id: string) => boolean): Uint8Array {
  const t = MapStatics.of(map.dims, map.statics);
  const rows: number[] = [];
  for (let cz = cz0; cz < cz0 + side; cz++) {
    for (let cx = cx0; cx < cx0 + side; cx++) {
      const c = cz * map.dims.chunksX + cx;
      for (let r = t.first[c]!; r < t.first[c + 1]!; r++) if (keep(t.kinds[t.kind[r]!]!)) rows.push(r);
    }
  }
  const kinds = [...new Set(rows.map((r) => t.kind[r]!))];
  const n = side * SAMPLES + 1;
  const w = new BitWriter(65536 + rows.length * 20 + n * n * 6);
  w.string(map.id);
  w.u8(side);
  [map.minY, map.stepY, map.seaLevel, (map.dims.chunksX * CHUNK_SIZE) / 2 - cx0 * CHUNK_SIZE, (map.dims.chunksZ * CHUNK_SIZE) / 2 - cz0 * CHUNK_SIZE].forEach((v) => w.f64(v));
  w.varint(kinds.length);
  for (const k of kinds) w.string(t.kinds[k]!);
  w.varint(rows.length);
  for (const r of rows) w.varint(kinds.indexOf(t.kind[r]!));
  for (const r of rows) w.u16(t.yaw[r]!);
  for (const [column, origin] of [[t.x, cx0 * CHUNK_SIZE], [t.y, 0], [t.z, cz0 * CHUNK_SIZE]] as const) {
    let before = 0;
    for (const r of rows) {
      const v = Math.round((column[r]! - origin) * STRUCT_UNITS);
      w.svarint(v - before);
      before = v;
    }
  }
  const nx = map.dims.chunksX * SAMPLES + 1;
  const at = (i: number, j: number): number => (cz0 * SAMPLES + j) * nx + cx0 * SAMPLES + i;
  let before = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      w.svarint(map.heights[at(i, j)]! - before);
      before = map.heights[at(i, j)]!;
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) w.u8(map.tint[at(i, j)]!);
  if (w.overflow) throw new Error("the slice outgrew its writer");
  return gzipSync(w.bytes(), { level: 9 });
}

export function readSlice(bytes: Uint8Array): CitySlice {
  const r = new BitReader(new Uint8Array(gunzipSync(bytes)));
  const id = r.string(256);
  const side = r.u8();
  const [minY, stepY, seaLevel, x, z] = [r.f64(), r.f64(), r.f64(), r.f64(), r.f64()];
  const kinds = Array.from({ length: r.varint() }, () => r.string(256));
  const count = r.varint();
  const kind = Array.from({ length: count }, () => kinds[r.varint()]!);
  const yaw = Array.from({ length: count }, () => r.u16());
  const [px, py, pz] = [0, 1, 2].map(() => {
    let v = 0;
    return Array.from({ length: count }, () => (v += r.svarint()) / STRUCT_UNITS);
  }) as [number[], number[], number[]];
  const statics: MapStatic[] = kind.map((k, i) => ({ kind: k, x: px[i]!, y: py[i]!, z: pz[i]!, yaw: yaw[i]! }));
  const n = side * SAMPLES + 1;
  let h = 0;
  const heights = Uint16Array.from({ length: n * n }, () => (h += r.svarint()));
  const tint = Uint8Array.from({ length: n * n }, () => r.u8());
  if (r.overflow) throw new Error("the slice is cut short");
  const middle = (side * CHUNK_SIZE) / 2;
  return { map: { id, dims: { chunksX: side, chunksZ: side }, minY, stepY, seaLevel, heights, tint, statics, nodes: [], spawns: [{ name: "Middle", x: middle, z: middle, yaw: 0 }] }, centre: [x, z] };
}

let miami: CitySlice | null = null;

/** The Miami slice, read once a process. */
export function miamiSlice(): CitySlice {
  return (miami ??= readSlice(new Uint8Array(readFileSync(MIAMI_SLICE))));
}
