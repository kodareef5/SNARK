// A chunk's frame key, the default frame and display origin, and nodes that stand where they stood when a map's corner moves.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, FRAME_CHUNKS, chunkCount, chunkCx, chunkCz, chunkOfKey, frameKey, framed, type MapDims } from "../../shared/coords.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { nodeLayers, type NodeList, type NodeScatter, type NodeZoned } from "../../shared/world/mapfile.ts";
import { mix, type NodeSpot } from "../../shared/world/nodes.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();

test("a chunk's frame key is its column and row on the lattice, and names it again on the map, or nothing off it", () => {
  const d: MapDims = { chunksX: 5, chunksZ: 3, frameX: 4091, frameZ: 7 };
  for (let c = 0; c < chunkCount(d); c++) {
    expect(frameKey(d, c)).toBe((7 + chunkCz(d, c)) * FRAME_CHUNKS + 4091 + chunkCx(d, c));
    expect(chunkOfKey(d, frameKey(d, c))).toBe(c);
  }
  // A column or a row past each side, and keys off the lattice.
  for (const [col, row] of [[4090, 8], [4096, 8], [4093, 6], [4093, 10]] as const) expect(chunkOfKey(d, row * FRAME_CHUNKS + col)).toBe(-1);
  expect([chunkOfKey(d, -1), chunkOfKey(d, FRAME_CHUNKS * FRAME_CHUNKS + 4091)]).toEqual([-1, -1]);
  // Hand-made dims sit with their south-east corner in the lattice's middle, and the origin is the sector corner at or
  // beyond their north-west corner: a 127-chunk map reads 0.6 to 80 across and down.
  expect(framed({ chunksX: 127, chunksZ: 127 })).toEqual({ chunksX: 127, chunksZ: 127, frameX: 2048, frameZ: 2048, originX: 2176, originZ: 2176 });
  expect(framed({ chunksX: 16, chunksZ: 1 })).toEqual({ chunksX: 16, chunksZ: 1, frameX: 2048, frameZ: 2048, originX: 2064, originZ: 2064 });
  expect(framed({ chunksX: 2, chunksZ: 2, frameX: 100, frameZ: 33 })).toEqual({ chunksX: 2, chunksZ: 2, frameX: 100, frameZ: 33, originX: 112, originZ: 48 });
  expect(frameKey({ chunksX: 8, chunksZ: 8 }, 9)).toBe(2049 * FRAME_CHUNKS + 2049);
});

// The ground and what grows on it by metres on the lattice from its south-east corner, the same whatever map holds them.
// The ground steps up 3 m westward across the middle of every column of chunks, where rocks' footings fail on the high
// side, far enough from a map's edge that what lies past it is out of their reach.
const ground = (x: number, z: number): number => 3 * Math.floor((x + 32) / CHUNK_SIZE - 2040) + 3 * Math.sin(x / 41) * Math.cos(z / 53);
const allowed = (x: number, z: number): boolean => Math.sin(x / 23) + Math.cos(z / 31) > -0.6;
const zoneAt = (x: number, z: number): number => (Math.floor(x / 96) + Math.floor(z / 80)) % 3;

/** The ground and node layers of the lattice under a map of 6 by 5 chunks whose south-east corner is at `frameX`, `frameZ`. */
function mapAt(frameX: number, frameZ: number): { dims: MapDims; hf: Heightfield; layers: [NodeScatter, NodeList, NodeZoned] } {
  const dims: MapDims = { chunksX: 6, chunksZ: 5, frameX, frameZ };
  const [x0, z0] = [frameX * CHUNK_SIZE, frameZ * CHUNK_SIZE];
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, ground(x0 + i * hf.cell, z0 + j * hf.cell));
  hf.seaLevel = 2.5;
  const squares = (cell: number, at: (x: number, z: number) => number): Uint8Array => {
    const [w, h] = [(dims.chunksX * CHUNK_SIZE) / cell, (dims.chunksZ * CHUNK_SIZE) / cell];
    return Uint8Array.from({ length: w * h }, (_, k) => at(x0 + ((k % w) + 0.5) * cell, z0 + (Math.floor(k / w) + 0.5) * cell));
  };
  const open = squares(4, (x, z) => (allowed(x, z) ? 1 : 0));
  const allow = new Uint8Array(Math.ceil(open.length / 8));
  open.forEach((v, bit) => (allow[bit >> 3]! |= v << (bit & 7)));
  const scatter: NodeScatter = { seed: 21, perChunk: 48, kinds: [["core:tree", 4], ["core:rock", 3], ["core:bush", 2]], allowCell: 4, allow };
  const zoned: NodeZoned = { seed: 22, perChunk: 32, zones: [{ bare: 1, kinds: [["core:palm", 2], ["core:seagrape", 1]] }, { bare: 0, kinds: [["core:fig", 1], ["core:fern", 2], ["core:rubble", 1]] }], zoneCell: 8, zone: squares(8, zoneAt) };
  // Up to three nodes listed in a chunk, each where a hash of its chunk's key and its row says.
  const rows: { chunk: number; kind: number; x: number; z: number; yaw: number }[] = [];
  for (let c = 0; c < chunkCount(dims); c++) {
    const key = frameKey(dims, c);
    for (let r = 0; r < mix(key, 1, 2) % 4; r++) rows.push({ chunk: c, kind: mix(key, r, 3) % 2, x: mix(key, r, 4) & 0xffff, z: mix(key, r, 5) & 0xffff, yaw: mix(key, r, 6) & 0xffff });
  }
  const first = new Uint32Array(chunkCount(dims) + 1);
  for (const row of rows) first[row.chunk + 1]!++;
  for (let c = 0; c < chunkCount(dims); c++) first[c + 1]! += first[c]!;
  const list: NodeList = { kinds: ["core:rock", "core:bush"], first, kind: Uint8Array.from(rows, (r) => r.kind), x: Uint16Array.from(rows, (r) => r.x), z: Uint16Array.from(rows, (r) => r.z), yaw: Uint16Array.from(rows, (r) => r.yaw) };
  return { dims, hf, layers: [scatter, list, zoned] };
}

test("on the same ground with the map's corner a chunk further east, west, north or south, every chunk both hold has the same nodes at the same lattice places", () => {
  const base = mapAt(2040, 2050);
  const a = nodeLayers(base.dims, base.hf, reg, base.layers)!;
  /** What a slot holds: nothing, or its kind, form (variant and size), turn, height and place in lattice metres. */
  const held = (m: ReturnType<typeof mapAt>, source: typeof a, chunk: number, slot: number, s: NodeSpot): number[] => {
    source.at(chunk, slot, s);
    return s.kind === 0 ? [0] : [s.kind, s.form, s.yaw, s.y, m.dims.frameX! * CHUNK_SIZE + s.x, m.dims.frameZ! * CHUNK_SIZE + s.z];
  };
  const [sa, sb] = [{ kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 }, { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 }];
  const kinds = new Set<number>();
  let footless = 0;
  // Columns count west and rows north, so east is one column less.
  for (const [name, dx, dz] of [["east", -1, 0], ["west", 1, 0], ["north", 0, 1], ["south", 0, -1]] as const) {
    const moved = mapAt(2040 + dx, 2050 + dz);
    const b = nodeLayers(moved.dims, moved.hf, reg, moved.layers)!;
    let [shared, standing, differ] = [0, 0, 0];
    for (let c = 0; c < chunkCount(base.dims); c++) {
      const there = chunkOfKey(moved.dims, frameKey(base.dims, c));
      if (there < 0) continue;
      expect(there).not.toBe(c);
      shared++;
      for (let i = 0; i < a.perChunk; i++) {
        const [one, other] = [held(base, a, c, i, sa), held(moved, b, there, i, sb)];
        if (one.join() !== other.join()) differ++;
        if (one[0] === 0) continue;
        standing++;
        kinds.add(one[0]!);
      }
    }
    expect([name, shared, differ, standing > 900]).toEqual([name, dx === 0 ? 24 : 25, 0, true]);
  }
  // Every kind grew, and some rocks did not, where the step falls away under them: those footings were judged alike too.
  expect(kinds.size).toBe(8);
  const level = compileContent(CORE_CONTENT.map((d) => (d.type === "node" ? { ...d, footing: undefined } : d))).registry!;
  const flat = nodeLayers(base.dims, base.hf, level, base.layers)!;
  for (let c = 0; c < chunkCount(base.dims); c++) {
    for (let i = 0; i < a.perChunk; i++) {
      a.at(c, i, sa);
      flat.at(c, i, sb);
      if (sa.kind === 0 && sb.kind !== 0) footless++;
    }
  }
  expect(footless).toBeGreaterThan(10);
});
