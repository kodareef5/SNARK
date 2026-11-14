// A map as one file: its ground, its static pieces, its resource nodes and where survivors arrive. The server loads it and
// serves it, and each client fetches it, so both stand on the same bytes. Little-endian:
//
//   0   "SNMP"
//   4   u16 version, u16 reserved
//   8   u32 hash        FNV-1a of every byte after it
//   12  u16 chunksX, u16 chunksZ
//   16  f32 cell        metres between samples, which is 2
//   20  f64 minY, f64 stepY, f64 seaLevel
//                       a height is minY + sample * stepY metres; a sea level of -Infinity is no water
//   44  string id
//   ..  sections, each a 4-byte tag, a u32 byte length and its bytes. A tag this build does not know is skipped.
//
//   HGTS  u16 per sample, row by row from z = 0: the sample less (left + above - above left), modulo 65,536
//   TINT  u8 per sample, a palette index. Without it every sample is 0.
//   STAT  u16 count and that many content ids, a u32 count, then 16-byte rows:
//         u16 id, u16 yaw, i32 x, y, z in 1/512 m
//   NODE  one layer of resource nodes. A file may hold several, and a chunk's slots are the first layer's, then the next's.
//         u8 0, scattered by a hash (shared/world/nodes.ts): u32 seed, u16 slots a chunk, u8 count of kinds, each a
//               u8 weight and a content id, then u8 metres a bit and a bit per square, row by row from z = 0, lowest bit
//               first, set where a node may stand. 0 metres has no bits: a node may stand anywhere.
//         u8 1, listed: u8 count of kinds, each a content id, then for each chunk a u16 count and 7-byte rows:
//               u8 kind, u16 x, u16 z in 1/1024 m from the chunk's corner, u16 yaw
//   SPWN  u8 count, then each a string name, i32 x, i32 z in 1/512 m, u16 yaw. The first is where a new survivor arrives.
//   WILD  where wild creatures live: u16 count, then each a string spawns id, u16 count it holds at 1x, u8 shape (0 a circle,
//         1 a box), i32 x, i32 z, u32 radius or half width, u32 half depth, in 1/512 m.
//
// A string is a varint byte length and UTF-8, as on the wire. A yaw is in 1/65,536 turns.

import type { MapZone } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, MAX_CHUNKS_PER_AXIS, STRUCT_UNITS, WORLD_MAX_Y, WORLD_MIN_Y, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import { hashBytes } from "../hash.ts";
import { BitReader, BitWriter } from "../net/codec.ts";
import { Heightfield, TERRAIN_CELL } from "./heightfield.ts";
import { scatterNodes, type NodeSource } from "./nodes.ts";
import type { StructureStore } from "./structures.ts";

export const MAP_VERSION = 1;
const MAGIC = 0x504d4e53;
const HEADER_BYTES = 44;
/** Slots a chunk's nodes may take over every layer (shared/world/nodes.ts). */
const NODE_SLOTS = 256;
/** A listed node's place in its chunk is a u16 of this many steps a metre. */
const NODE_UNITS = 65536 / CHUNK_SIZE;
/** Spawn points a map may have: as many as a respawn screen lists. */
const MAX_SPAWNS = 16;
/** UTF-16 units in a name or an id, which is at most 240 bytes. */
const MAX_TEXT = 80;
const MAX_REGIONS = 65535;

/** A piece set down with the world and owned by nobody. `kind` is a content id, and `yaw` is in 1/65,536 turns. */
export interface MapStatic {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface MapSpawn {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Nodes scattered by a hash: `perChunk` slots in every chunk, each a kind drawn by weight, or empty where the ground does not suit. */
export interface NodeScatter {
  readonly seed: number;
  readonly perChunk: number;
  readonly kinds: readonly (readonly [id: string, weight: number])[];
  /** Metres a bit of `allow`: a whole number that divides a chunk's 64. 0 with no `allow`, where a node may stand anywhere. */
  readonly allowCell: number;
  /** A bit per square, row by row from z = 0, lowest bit first, set where a node may stand. */
  readonly allow: Uint8Array | null;
}

/** Nodes placed one by one. Chunk `c` holds rows `first[c]` up to `first[c + 1]`, and a row's place among them is its slot. */
export interface NodeList {
  readonly kinds: readonly string[];
  readonly first: Uint32Array;
  /** Index into `kinds`. */
  readonly kind: Uint8Array;
  /** From the chunk's corner, in 1/1024 m. */
  readonly x: Uint16Array;
  readonly z: Uint16Array;
  readonly yaw: Uint16Array;
}

export interface MapData {
  /** What the server calls the map, and the id of its definition if the content has one. */
  readonly id: string;
  readonly dims: MapDims;
  readonly minY: number;
  /** Metres per height unit. A power-of-two fraction keeps round heights exact. */
  readonly stepY: number;
  /** -Infinity for a map with no water. */
  readonly seaLevel: number;
  /** Row by row from z = 0, as a Heightfield holds them. */
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  readonly statics: readonly MapStatic[];
  readonly nodes: readonly (NodeScatter | NodeList)[];
  /** At least one. The first is where a new survivor arrives. */
  readonly spawns: readonly MapSpawn[];
  /** Spawn regions, each naming a `spawns` definition and the creatures it holds. They are added to those of the map's definition. */
  readonly regions?: readonly MapZone[];
}

/** A map read from a file, with the hash that names those bytes. */
export interface MapFile extends MapData {
  readonly hash: number;
}

function slotsOf(layer: NodeScatter | NodeList, chunks: number): number {
  if (!("first" in layer)) return layer.perChunk;
  let most = 0;
  for (let c = 0; c < chunks; c++) most = Math.max(most, layer.first[c + 1]! - layer.first[c]!);
  return most;
}

/** Throws, saying what is wrong, if nothing could be played on `m`. */
function check(m: MapData): void {
  const fail = (what: string): never => {
    throw new Error(`map: ${what}`);
  };
  const { chunksX, chunksZ } = m.dims;
  const whole = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  if (!/^[\x21-\x7e]{1,64}$/.test(m.id)) fail("its id must be 1 to 64 characters of plain text with no space");
  if (!whole(chunksX, 1, MAX_CHUNKS_PER_AXIS) || !whole(chunksZ, 1, MAX_CHUNKS_PER_AXIS)) fail(`it is ${chunksX} by ${chunksZ} chunks, and a side is 1 to ${MAX_CHUNKS_PER_AXIS}`);
  if (!(m.stepY > 0 && Number.isFinite(m.stepY) && Number.isFinite(m.minY) && m.seaLevel < Infinity)) fail("its height range or its sea level is not a number");
  const sizeX = chunksX * CHUNK_SIZE;
  const sizeZ = chunksZ * CHUNK_SIZE;
  const samples = (sizeX / TERRAIN_CELL + 1) * (sizeZ / TERRAIN_CELL + 1);
  if (m.heights.length !== samples || m.tint.length !== samples) fail(`it has ${m.heights.length} heights and ${m.tint.length} tints, and its size takes ${samples} of each`);
  const inside = (x: number, z: number): boolean => x >= 0 && x <= sizeX && z >= 0 && z <= sizeZ;
  if (!whole(m.spawns.length, 1, MAX_SPAWNS)) fail(`it has ${m.spawns.length} spawn points, and a map has 1 to ${MAX_SPAWNS}`);
  for (const s of m.spawns) if (!inside(s.x, s.z)) fail(`spawn point "${s.name}" is off the map`);
  for (const s of m.statics) if (!inside(s.x, s.z) || !(s.y >= WORLD_MIN_Y && s.y <= WORLD_MAX_Y)) fail(`a ${s.kind} at ${s.x}, ${s.y}, ${s.z} is off the map`);
  let slots = 0;
  for (const layer of m.nodes) {
    slots += slotsOf(layer, chunksX * chunksZ);
    if ("first" in layer) {
      const rows = layer.first[chunksX * chunksZ];
      if (layer.first.length !== chunksX * chunksZ + 1 || rows !== layer.kind.length || rows !== layer.x.length || rows !== layer.z.length || rows !== layer.yaw.length) fail("a list of nodes does not match its chunks");
      if (layer.kinds.length > 255 || layer.kind.some((k) => k >= layer.kinds.length)) fail("a listed node is of a kind its list does not name");
      continue;
    }
    const cell = layer.allowCell;
    if (!whole(layer.perChunk, 1, NODE_SLOTS) || !whole(layer.kinds.length, 1, 255) || layer.kinds.some(([, weight]) => !whole(weight, 1, 255))) fail("scattered nodes need 1 to 256 slots a chunk and 1 to 255 kinds, each of weight 1 to 255");
    if (layer.allow === null ? cell !== 0 : !whole(cell, 1, CHUNK_SIZE) || CHUNK_SIZE % cell !== 0 || layer.allow.length !== Math.ceil(((sizeX / cell) * (sizeZ / cell)) / 8)) fail("where scattered nodes may stand is not a bit per square of 1, 2, 4, 8, 16, 32 or 64 m");
  }
  if (slots > NODE_SLOTS) fail(`its nodes take ${slots} slots in a chunk, and a chunk has ${NODE_SLOTS}`);
  const regions = m.regions ?? [];
  if (regions.length > MAX_REGIONS) fail(`it has ${regions.length} spawn regions, and a map has ${MAX_REGIONS} at most`);
  for (const z of regions) {
    const [rx, rz] = z.half ?? [z.radius ?? 0, z.radius ?? 0];
    if (z.kind !== "spawn" || z.spawns === undefined || !whole(z.count ?? -1, 0, 65535)) fail(`a spawn region at ${z.at[0]}, ${z.at[1]} names no spawns, or holds other than 0 to 65,535`);
    if (!inside(z.at[0], z.at[1]) || !(rx > 0 && rz > 0 && rx <= sizeX && rz <= sizeZ)) fail(`the spawn region of ${z.spawns} at ${z.at[0]}, ${z.at[1]} is off the map or has no size`);
  }
}

class Out {
  bytes = new Uint8Array(4096);
  view = new DataView(this.bytes.buffer);
  at = 0;

  /** Makes room for `n` more bytes and returns where they start. Call it before touching `view`, which it may replace. */
  take(n: number): number {
    const at = this.at;
    if (at + n > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.bytes.length * 2, at + n));
      grown.set(this.bytes);
      this.bytes = grown;
      this.view = new DataView(grown.buffer);
    }
    this.at = at + n;
    return at;
  }

  u8(v: number): void {
    const at = this.take(1);
    this.bytes[at] = v;
  }

  u16(v: number): void {
    const at = this.take(2);
    this.view.setUint16(at, v, true);
  }

  u32(v: number): void {
    const at = this.take(4);
    this.view.setUint32(at, v, true);
  }

  i32(v: number): void {
    const at = this.take(4);
    this.view.setInt32(at, v, true);
  }

  f64(v: number): void {
    const at = this.take(8);
    this.view.setFloat64(at, v, true);
  }

  put(src: Uint8Array): void {
    const at = this.take(src.length);
    this.bytes.set(src, at);
  }

  text(s: string): void {
    if (s.length > MAX_TEXT) throw new Error(`map: "${s}" is longer than ${MAX_TEXT} characters`);
    const w = new BitWriter(5 + s.length * 3);
    w.string(s);
    this.put(w.bytes());
  }
}

export function writeMap(m: MapData): Uint8Array<ArrayBuffer> {
  check(m);
  const o = new Out();
  const section = (tag: string, body: () => void): void => {
    for (let i = 0; i < 4; i++) o.u8(tag.charCodeAt(i));
    const at = o.take(4);
    body();
    o.view.setUint32(at, o.at - at - 4, true);
  };
  o.u32(MAGIC);
  o.u16(MAP_VERSION);
  o.u16(0);
  o.u32(0);
  o.u16(m.dims.chunksX);
  o.u16(m.dims.chunksZ);
  const cellAt = o.take(4);
  o.view.setFloat32(cellAt, TERRAIN_CELL, true);
  o.f64(m.minY);
  o.f64(m.stepY);
  o.f64(m.seaLevel);
  o.text(m.id);
  section("HGTS", () => {
    const h = m.heights;
    const nx = (m.dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1;
    const at = o.take(h.length * 2);
    for (let k = 0; k < h.length; k++) {
      const left = k % nx > 0 ? h[k - 1]! : 0;
      const above = k >= nx ? h[k - nx]! : 0;
      const corner = k % nx > 0 && k >= nx ? h[k - nx - 1]! : 0;
      o.view.setUint16(at + k * 2, h[k]! - (left + above - corner), true);
    }
  });
  section("TINT", () => o.put(m.tint));
  if (m.statics.length > 0) {
    section("STAT", () => {
      const ids = new Map<string, number>();
      for (const s of m.statics) if (!ids.has(s.kind)) ids.set(s.kind, ids.size);
      o.u16(ids.size);
      for (const id of ids.keys()) o.text(id);
      o.u32(m.statics.length);
      for (const s of m.statics) {
        o.u16(ids.get(s.kind)!);
        o.u16(s.yaw);
        o.i32(Math.round(s.x * STRUCT_UNITS));
        o.i32(Math.round(s.y * STRUCT_UNITS));
        o.i32(Math.round(s.z * STRUCT_UNITS));
      }
    });
  }
  for (const layer of m.nodes) {
    section("NODE", () => {
      if ("first" in layer) {
        o.u8(1);
        o.u8(layer.kinds.length);
        for (const id of layer.kinds) o.text(id);
        for (let c = 0; c + 1 < layer.first.length; c++) {
          o.u16(layer.first[c + 1]! - layer.first[c]!);
          for (let r = layer.first[c]!; r < layer.first[c + 1]!; r++) {
            o.u8(layer.kind[r]!);
            o.u16(layer.x[r]!);
            o.u16(layer.z[r]!);
            o.u16(layer.yaw[r]!);
          }
        }
        return;
      }
      o.u8(0);
      o.u32(layer.seed);
      o.u16(layer.perChunk);
      o.u8(layer.kinds.length);
      for (const [id, weight] of layer.kinds) {
        o.u8(weight);
        o.text(id);
      }
      o.u8(layer.allowCell);
      if (layer.allow) o.put(layer.allow);
    });
  }
  section("SPWN", () => {
    o.u8(m.spawns.length);
    for (const s of m.spawns) {
      o.text(s.name);
      o.i32(Math.round(s.x * STRUCT_UNITS));
      o.i32(Math.round(s.z * STRUCT_UNITS));
      o.u16(s.yaw);
    }
  });
  const regions = m.regions ?? [];
  if (regions.length > 0) {
    section("WILD", () => {
      o.u16(regions.length);
      for (const z of regions) {
        o.text(z.spawns!);
        o.u16(z.count!);
        o.u8(z.half ? 1 : 0);
        o.i32(Math.round(z.at[0] * STRUCT_UNITS));
        o.i32(Math.round(z.at[1] * STRUCT_UNITS));
        const [rx, rz] = z.half ?? [z.radius!, z.radius!];
        o.u32(Math.round(rx * STRUCT_UNITS));
        o.u32(Math.round(rz * STRUCT_UNITS));
      }
    });
  }
  const file = o.bytes.slice(0, o.at);
  new DataView(file.buffer).setUint32(8, hashBytes(file.subarray(12)), true);
  return file;
}

/** Reads within its bytes, and throws a RangeError past their end. */
class In {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  at = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    return this.view.getUint8(this.at++);
  }

  u16(): number {
    this.at += 2;
    return this.view.getUint16(this.at - 2, true);
  }

  u32(): number {
    this.at += 4;
    return this.view.getUint32(this.at - 4, true);
  }

  i32(): number {
    this.at += 4;
    return this.view.getInt32(this.at - 4, true);
  }

  f64(): number {
    this.at += 8;
    return this.view.getFloat64(this.at - 8, true);
  }

  /** A view of the next `n` bytes. */
  take(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new RangeError();
    this.at += n;
    return this.bytes.subarray(this.at - n, this.at);
  }

  text(): string {
    const r = new BitReader(this.bytes.subarray(this.at));
    const s = r.string(255);
    if (r.overflow) throw new RangeError();
    this.at += r.pos >>> 3;
    return s;
  }
}

function readNodes(r: In, dims: MapDims): NodeScatter | NodeList {
  if (r.u8() === 0) {
    const seed = r.u32();
    const perChunk = r.u16();
    const kinds = Array.from({ length: r.u8() }, (): [string, number] => {
      const weight = r.u8();
      return [r.text(), weight];
    });
    const allowCell = r.u8();
    return { seed, perChunk, kinds, allowCell, allow: allowCell === 0 ? null : r.take(r.bytes.length - r.at) };
  }
  const kinds = Array.from({ length: r.u8() }, () => r.text());
  const chunks = chunkCount(dims);
  // A row is 7 bytes and a chunk's count 2, so what is left says how many rows there are.
  const rows = (r.bytes.length - r.at - chunks * 2) / 7;
  if (!Number.isInteger(rows) || rows < 0) throw new RangeError();
  const list = { kinds, first: new Uint32Array(chunks + 1), kind: new Uint8Array(rows), x: new Uint16Array(rows), z: new Uint16Array(rows), yaw: new Uint16Array(rows) };
  let n = 0;
  for (let c = 0; c < chunks; c++) {
    for (let left = r.u16(); left > 0; left--, n++) {
      list.kind[n] = r.u8();
      list.x[n] = r.u16();
      list.z[n] = r.u16();
      list.yaw[n] = r.u16();
    }
    list.first[c + 1] = n;
  }
  return list;
}

function read(r: In): MapData {
  const dims = { chunksX: r.u16(), chunksZ: r.u16() };
  const cell = r.view.getFloat32(r.at, true);
  r.at += 4;
  if (cell !== TERRAIN_CELL) throw new Error(`map: its samples are ${cell} m apart, and this build draws ground of ${TERRAIN_CELL} m`);
  const minY = r.f64();
  const stepY = r.f64();
  const seaLevel = r.f64();
  const id = r.text();
  let heights: Uint16Array | null = null;
  let tint: Uint8Array | null = null;
  const statics: MapStatic[] = [];
  const nodes: (NodeScatter | NodeList)[] = [];
  const spawns: MapSpawn[] = [];
  const regions: MapZone[] = [];
  while (r.at < r.bytes.length) {
    const tag = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
    const s = new In(r.take(r.u32()));
    if (tag === "HGTS") {
      const nx = (dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1;
      const h = (heights = new Uint16Array(s.bytes.length >> 1));
      for (let k = 0; k < h.length; k++) {
        const left = k % nx > 0 ? h[k - 1]! : 0;
        const above = k >= nx ? h[k - nx]! : 0;
        const corner = k % nx > 0 && k >= nx ? h[k - nx - 1]! : 0;
        h[k] = s.view.getUint16(k * 2, true) + left + above - corner;
      }
    } else if (tag === "TINT") tint = s.bytes;
    else if (tag === "STAT") {
      const ids = Array.from({ length: s.u16() }, () => s.text());
      for (let n = s.u32(); n > 0; n--) {
        const kind = ids[s.u16()];
        if (kind === undefined) throw new Error("map: a static piece is of a kind its table does not name");
        statics.push({ kind, yaw: s.u16(), x: s.i32() / STRUCT_UNITS, y: s.i32() / STRUCT_UNITS, z: s.i32() / STRUCT_UNITS });
      }
    } else if (tag === "NODE") nodes.push(readNodes(s, dims));
    else if (tag === "SPWN") {
      for (let n = s.u8(); n > 0; n--) spawns.push({ name: s.text(), x: s.i32() / STRUCT_UNITS, z: s.i32() / STRUCT_UNITS, yaw: s.u16() });
    } else if (tag === "WILD") {
      for (let n = s.u16(); n > 0; n--) {
        const spawns = s.text();
        const count = s.u16();
        const box = s.u8() === 1;
        const at = [s.i32() / STRUCT_UNITS, s.i32() / STRUCT_UNITS] as const;
        const rx = s.u32() / STRUCT_UNITS;
        const rz = s.u32() / STRUCT_UNITS;
        regions.push(box ? { kind: "spawn", spawns, count, at, half: [rx, rz] } : { kind: "spawn", spawns, count, at, radius: rx });
      }
    }
  }
  if (!heights) throw new Error("map: it has no heights");
  return { id, dims, minY, stepY, seaLevel, heights, tint: tint ?? new Uint8Array(heights.length), statics, nodes, spawns, ...(regions.length > 0 ? { regions } : {}) };
}

/** Throws with a reason if the file is not a map this build can play on. */
export function parseMap(file: Uint8Array): MapFile {
  const r = new In(file);
  if (file.length < HEADER_BYTES || r.u32() !== MAGIC) throw new Error("map: this is not a map file");
  const version = r.u16();
  if (version !== MAP_VERSION) throw new Error(`map: version ${version} is not one this build reads`);
  r.at += 2;
  const hash = r.u32();
  if (hash !== hashBytes(file.subarray(12))) throw new Error("map: the file is damaged: its hash is not that of its bytes");
  let map: MapData;
  try {
    map = read(r);
  } catch (err) {
    throw err instanceof RangeError ? new Error("map: a section runs past its end") : err;
  }
  check(map);
  return { ...map, hash };
}

export function mapHeightfield(map: MapData): Heightfield {
  const hf = new Heightfield(map.dims, TERRAIN_CELL, map.minY, map.stepY, map.heights, map.tint);
  hf.seaLevel = map.seaLevel;
  return hf;
}

function layerSource(map: MapData, hf: Heightfield, reg: Registry, layer: NodeScatter | NodeList): NodeSource {
  const dims = map.dims;
  if (!("first" in layer)) {
    // A kind this content lacks is left out, and the rest share its slots.
    const kinds: number[] = [];
    for (const [id, weight] of layer.kinds) {
      const k = reg.index.get(id);
      if (k !== undefined) for (let i = 0; i < weight; i++) kinds.push(k);
    }
    const { allow, allowCell: cell } = layer;
    if (!allow) return scatterNodes(dims, hf, layer.seed, layer.perChunk, kinds, reg.halfY, () => true);
    const wide = (dims.chunksX * CHUNK_SIZE) / cell;
    return scatterNodes(dims, hf, layer.seed, layer.perChunk, kinds, reg.halfY, (x, z) => {
      const bit = Math.floor(z / cell) * wide + Math.floor(x / cell);
      return ((allow[bit >> 3]! >> (bit & 7)) & 1) === 1;
    });
  }
  const kinds = layer.kinds.map((id) => reg.index.get(id) ?? 0);
  return {
    perChunk: slotsOf(layer, chunkCount(dims)),
    at(chunk, index, out) {
      const row = layer.first[chunk]! + index;
      const kind = row < layer.first[chunk + 1]! ? kinds[layer.kind[row]!]! : 0;
      out.kind = kind;
      if (kind === 0) return;
      out.x = chunkCx(dims, chunk) * CHUNK_SIZE + layer.x[row]! / NODE_UNITS;
      out.z = chunkCz(dims, chunk) * CHUNK_SIZE + layer.z[row]! / NODE_UNITS;
      out.y = hf.heightAt(out.x, out.z) + reg.halfY[kind]!;
      out.yaw = layer.yaw[row]!;
    },
  };
}

/** The map's resource nodes for `hf`, which is its ground, or null if it has none. The server and every client call this. */
export function mapNodes(map: MapData, hf: Heightfield, reg: Registry): NodeSource | null {
  const layers = map.nodes.map((layer) => layerSource(map, hf, reg, layer));
  if (layers.length < 2) return layers[0] ?? null;
  return {
    perChunk: layers.reduce((sum, l) => sum + l.perChunk, 0),
    at(chunk, index, out) {
      out.kind = 0;
      for (const l of layers) {
        if (index < l.perChunk) return l.at(chunk, index, out);
        index -= l.perChunk;
      }
    },
  };
}

/** Server side: sets the map's static pieces down in `structs`. Clients receive them by replication. */
export function placeStatics(map: MapData, structs: StructureStore, reg: Registry): void {
  for (const s of map.statics) {
    const kind = reg.index.get(s.kind);
    if (kind === undefined) throw new Error(`map "${map.id}" needs content "${s.kind}"`);
    const def = reg.defs[kind]!;
    structs.add(kind, s.x, s.y, s.z, s.yaw, 0, def.type === "structure" ? def.hp : 0);
  }
}
