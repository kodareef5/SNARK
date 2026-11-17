// A map as one file: a head and its parts. The server reads the file whole and serves each part as a file of its own, which
// a client fetches by the name the head gives it, so both stand on the same bytes. Little-endian.
//
// The head:
//   0   "SNMP"
//   4   u16 version 7, u16 reserved
//   8   u32 hash        FNV-1a of every byte of the head after it: the map's hash, which names each part by its own
//   12  u32 bytes of the head. Its parts follow it in the order of its table, each where the one before ends.
//   16  u16 chunksX, u16 chunksZ
//   20  u16 frameX, u16 frameZ
//                       the lattice column and row of the south-east corner (shared/coords.ts)
//   24  u16 originX, u16 originZ
//                       the display origin's, a sector's corner at or beyond the north-west corner
//   28  f32 cell        metres between samples, which is 2
//   32  f64 minY, f64 stepY, f64 seaLevel
//                       a height is minY + sample * stepY metres; a sea level of -Infinity is no sea
//   56  string id
//   ..  sections, each a 4-byte tag, a u32 byte length and its bytes. A tag this build does not know is skipped.
//
//   NODE  one layer of resource nodes' rules; its pictures are the overviews' and its rows the sectors'. A file may hold
//         several, and a chunk's slots are the first layer's, then the next's.
//         u8 0, scattered by a hash (shared/world/nodes.ts): u32 seed, u16 slots a chunk, u8 count of kinds, each a u8 weight
//               and a content id, then u8 metres a square of its picture of where a node may stand, 0 for none: a node may
//               stand anywhere. Then u8 1 where slots are taken out, else 0.
//         u8 1, listed: u8 count of kinds, each a content id.
//         u8 2, zoned, scattered as by 0: u32 seed, u16 slots a chunk, u8 count of zones, each a u8 weight of bare ground,
//               a u8 count of kinds and each a u8 weight and a content id, then u8 metres a square, a u8 count of codes and
//               that many bytes, u8 1 to take the picture of the zoned layer before or 0 for its own, and u8 1 where slots
//               are taken out, else 0. With codes, the picture is one the zoned layers share, and a value's zone in this
//               layer is its code.
//   SPWN  u8 count, then each a string name, i32 x, i32 z in 1/512 m, u16 yaw. The first is where a new survivor arrives.
//   WILD  where wild creatures live: u16 count, then each a string spawns id, u16 count it holds at 1x, u8 shape (0 a circle,
//         1 a box), i32 x, i32 z, u32 radius or half width, u32 half depth, in 1/512 m.
//   VHCL  vehicles parked in a new world: u16 count and that many content ids, a u32 count, then 12-byte rows:
//         u16 id, u16 yaw, i32 x, z in 1/512 m. Each stands on the ground under it.
//   VHCX  what a parked vehicle has beyond its VHCL row (found aircraft and boats): u8 version 1, a u32 count, then each a
//         u32 row index and a u8 of bits, and what they name in this order: 1 a stable string id, 2 an f64 height it
//         stands at (a roof, a berth), 4 and 8 two f64 fractions each, the range its condition and its fuel are rolled in.
//   WATR  water standing on its own surfaces (shared/world/water.ts): u8 metres a square (1, 2, 4, 8, 16, 32 or 64), u16
//         count of bodies, each a string name and a u16 surface in the heights' units. Its squares are the overviews'.
//   LAND  what the map adds to the content: u8 count of its landmarks and each a name, whose files a client fetches
//         (assets/landmarks/<name>.json), then f64 x, y, z of its origin and u16 yaw as it was placed. The definitions
//         they add are the land part.
//   STAT  u16 count and that many content ids, which a sector's statics name by their place here.
//   PART  u16 count, then each part's u8 kind, u8 column and u8 row of its square, u32 byte length, and its hash
//         (partHash) as two u32s.
//
// The parts, each read alone given the head. A sector's square is 16 by 16 chunks of the lattice (1,024 m) and an
// overview's 64 by 64 (4,096 m); a part is keyed by its square's column and row on the lattice, which a map widened keeps,
// and holds what of its square lies on the map, its places from the square's corner. A grid of samples is row by row from
// its least x and z, each sample less (left + above - above left) within the grid as an i16, zigzagged (0, -1, 1, -2 ...):
// every sample's low byte, then every high byte. u16s are planes the same way.
//
//   1 land      the definitions of LAND's landmarks, compiled after the core's: UTF-8 JSON. Where they add some.
//   2 overview  its ground at every fourth sample (8 m), its far edges among them, as a grid, then a u8 tint each, a palette
//               index. Each of its chunks' lowest sample and then each one's highest, its edges among them, row by row as
//               u16s. Then for each node layer: a scattered one's picture, a bit a square row by row, lowest bit first, set
//               where a node may stand; a zoned one's own picture, a byte a square, the number of its zone counting from 1,
//               or 0 where nothing grows; and where slots are taken out a bit a slot, chunk by chunk row by row, set where
//               none stands. A layer's bits start on a byte. Then, where the head has WATR, a u16 count of its chunks holding
//               water, each a u16 index among its chunks row by row, ascending, and its squares as u16s row by row: the
//               number of its body counting from 1, or 0 for the sea's.
//   3 ground    a sector's ground at every sample (2 m), its edges among them, as a grid, then a u8 tint each. Then for each
//               listed layer, for each of its chunks row by row, a u16 count and 7-byte rows: u8 kind, u16 x, u16 z in
//               1/1024 m from the chunk's corner, u16 yaw.
//   4 statics   a sector's statics, where it has some: u32 count n, then columns of n in the map's order, each as byte
//               planes (every value's low byte, then the next): u16 kind, its place in STAT; u16 yaw less the piece
//               before's, modulo 65,536; and x, y, z in 1/512 m from the square's corner and the datum, as zigzagged
//               differences from the piece before's modulo 2^24, in 3 bytes (the first's from 0). Slot s of a chunk holds
//               its s-th piece here.
//
// A part's file is `<kind>.<column>-<row>.<hash>.part` (partName); the land's and the head's have no square.
// A string is a varint byte length and UTF-8, as on the wire. A yaw is in 1/65,536 turns.

import type { Def, MapZone } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, FRAME_CHUNKS, MAX_CHUNKS_PER_AXIS, SECTOR_CHUNKS, STRUCT_UNITS, WORLD_MAX_Y, WORLD_MIN_Y, chunkAt, chunkCount, chunkCx, chunkCz, frameKey, framed, type FramedDims, type MapDims } from "../coords.ts";
import { hashBytes } from "../hash.ts";
import { decodeUtf8 } from "../pack/pack.ts";
import { BitReader, BitWriter } from "../net/codec.ts";
import { Heightfield, TERRAIN_CELL } from "./heightfield.ts";
import { formOf, mix, nodeForms, scatterNodes, type NodeSource } from "./nodes.ts";
import type { StructureStore } from "./structures.ts";
import { MAX_WATER_BODIES, MapWater, type WaterBody } from "./water.ts";

export const MAP_VERSION = 7;
const MAGIC = 0x504d4e53;
const HEADER_BYTES = 56;
/** Chunks a side of an overview's square, 4,096 m. */
export const OVERVIEW_CHUNKS = 64;
/** An overview's ground is every this many samples, 8 m. */
export const OVERVIEW_STEP = 4;
/** Samples along a chunk's side, less its far edge. */
const CHUNK_SAMPLES = CHUNK_SIZE / TERRAIN_CELL;
/** A static's bytes in a statics part's columns: id, yaw, x, y, z. */
const STAT_ROW = 2 + 2 + 3 + 3 + 3;
/** Statics read between yields when read a step at a time: about a millisecond's work here, a few on a phone. */
const SLICE = 1 << 15;
/** A part's kinds, by their number in the file less one. */
const PART_KINDS = ["land", "overview", "ground", "statics"] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** What `steps` comes to, run without a pause. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
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

/**
 * A map's static pieces as columns, grouped by the chunk their centre is in as a structure store holds them, so that the far
 * city reads the same arrays (shared/world/city.ts). A city of a million pieces is held once, with no object a piece.
 */
export class MapStatics {
  /** The content ids `kind` indexes. */
  readonly kinds: readonly string[];
  /** Chunk `c` holds rows `first[c]` up to `first[c + 1]`, in the order the map lists them. */
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  /** Centres in metres on the file's 1/512 m lattice, which a float32 holds exactly anywhere on a map. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** The row of the map's `i`th piece. Empty where the map's order was not kept, and its pieces are then the chunks' order. */
  readonly row: Uint32Array;

  /** With `of`, its columns without the map's order. */
  private constructor(kinds: readonly string[], chunks: number, n: number, order: boolean, of: MapStatics | null = null) {
    this.kinds = kinds;
    this.first = of ? of.first : new Uint32Array(chunks + 1);
    this.row = new Uint32Array(order ? n : 0);
    this.kind = of ? of.kind : new Uint16Array(n);
    this.yaw = of ? of.yaw : new Uint16Array(n);
    this.x = of ? of.x : new Float32Array(n);
    this.y = of ? of.y : new Float32Array(n);
    this.z = of ? of.z : new Float32Array(n);
  }

  /** The same pieces, their columns shared, without the map's order: a server needs it only to set them down. */
  unordered(): MapStatics {
    return this.row.length === 0 ? this : new MapStatics(this.kinds, 0, 0, false, this);
  }

  /** `n` pieces over `chunks` chunks, all zero, for parts to be set into once `first` is laid out (joinStatics). */
  static blank(kinds: readonly string[], chunks: number, n: number, order: boolean): MapStatics {
    return new MapStatics(kinds, chunks, n, order);
  }

  /**
   * Pieces as columns in the map's order, `kind` indexing `kinds` and centres on the lattice, grouped by chunk a slice at a
   * time. Without `order` the map's order is not kept, as a client never reads it.
   */
  static *group(dims: MapDims, kinds: readonly string[], kind: Uint16Array, yaw: Uint16Array, x: Float32Array, y: Float32Array, z: Float32Array, order = true): Generator<void, MapStatics> {
    const n = kind.length;
    const chunks = chunkCount(dims);
    const t = new MapStatics(kinds, chunks, n, order);
    const first = t.first;
    const row = order ? t.row : new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      row[i] = chunkAt(dims, x[i]!, z[i]!);
      first[row[i]! + 1]!++;
      if (i % SLICE === SLICE - 1) yield;
    }
    for (let c = 0; c < chunks; c++) first[c + 1]! += first[c]!;
    const at = first.slice(0, chunks);
    for (let i = 0; i < n; i++) {
      const r = at[row[i]!]!++;
      row[i] = r;
      t.kind[r] = kind[i]!;
      t.yaw[r] = yaw[i]!;
      t.x[r] = x[i]!;
      t.y[r] = y[i]!;
      t.z[r] = z[i]!;
      if (i % SLICE === SLICE - 1) yield;
    }
    return t;
  }

  /** `statics` as a table: itself if it is one, or a list's pieces with their centres set on the lattice as a file would. */
  static of(dims: MapDims, statics: MapStatics | readonly MapStatic[]): MapStatics {
    if (statics instanceof MapStatics) return statics;
    const ids = new Map<string, number>();
    for (const s of statics) if (!ids.has(s.kind)) ids.set(s.kind, ids.size);
    const snap = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;
    const [kind, yaw] = [Uint16Array.from(statics, (s) => ids.get(s.kind)!), Uint16Array.from(statics, (s) => s.yaw)];
    return finish(MapStatics.group(dims, [...ids.keys()], kind, yaw, Float32Array.from(statics, (s) => snap(s.x)), Float32Array.from(statics, (s) => snap(s.y)), Float32Array.from(statics, (s) => snap(s.z))));
  }

  get length(): number {
    return this.kind.length;
  }

  /** The map's `i`th piece as an object, for tools. */
  piece(i: number): MapStatic {
    const r = this.row.length > 0 ? this.row[i]! : i;
    return { kind: this.kinds[this.kind[r]!]!, x: this.x[r]!, y: this.y[r]!, z: this.z[r]!, yaw: this.yaw[r]! };
  }

  *[Symbol.iterator](): IterableIterator<MapStatic> {
    for (let i = 0; i < this.length; i++) yield this.piece(i);
  }

  /** The pieces `keep` takes, as objects in the map's order, for tools written against a list. */
  filter(keep: (s: MapStatic) => unknown): MapStatic[] {
    const out: MapStatic[] = [];
    for (const s of this) if (keep(s)) out.push(s);
    return out;
  }
}

/** Calls `each` with every piece of `statics` in the order the map lists them. */
function eachStatic(statics: MapStatics | readonly MapStatic[], each: (kind: string, x: number, y: number, z: number, yaw: number) => void): void {
  if (!(statics instanceof MapStatics)) {
    for (const s of statics) each(s.kind, s.x, s.y, s.z, s.yaw);
    return;
  }
  const { kinds, kind, x, y, z, yaw, row } = statics;
  for (let i = 0; i < kind.length; i++) {
    const r = row.length > 0 ? row[i]! : i;
    each(kinds[kind[r]!]!, x[r]!, y[r]!, z[r]!, yaw[r]!);
  }
}

export interface MapSpawn {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** A vehicle the map parks: set down once, in a new world, and its save's from then on. `kind` is a content id, `yaw` in 1/65,536 turns. */
export interface MapVehicle {
  readonly kind: string;
  /** Stable authored placement name, independent of list order. Rolled condition is saved with the vehicle. */
  readonly id?: string;
  readonly x: number;
  /** Landing surface height. Omitted, it stands on the terrain. */
  readonly y?: number;
  readonly z: number;
  readonly yaw: number;
  /** Inclusive starting fractions. Each mechanical component is rolled independently once. */
  readonly condition?: readonly [number, number];
  readonly fuel?: readonly [number, number];
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
  /** Bit `chunk * perChunk + slot`, lowest bit first, set where that slot's node is taken out: the map's build froze it. */
  readonly out?: Uint8Array;
}

/** Kinds that grow in a zone, each with its weight, and the weight of bare ground among them. */
export interface NodeZone {
  readonly bare: number;
  readonly kinds: readonly (readonly [id: string, weight: number])[];
}

/** Nodes scattered by a hash, each square of the map in a zone that says which kinds grow there and how thickly. */
export interface NodeZoned {
  readonly seed: number;
  readonly perChunk: number;
  readonly zones: readonly NodeZone[];
  /** Metres a square of `zone`: a whole number that divides a chunk's 64. */
  readonly zoneCell: number;
  /** A byte per square, row by row from z = 0: the number of its zone counting from 1, or 0 where nothing grows. */
  readonly zone: Uint8Array;
  /** Where `zone` is a picture the map's zoned layers share, each of its values' zone in this layer. */
  readonly codes?: Uint8Array;
  /** As NodeScatter's. */
  readonly out?: Uint8Array;
}

export type NodeLayer = NodeScatter | NodeList | NodeZoned;

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
  /** -Infinity for a map with no sea. */
  readonly seaLevel: number;
  /** Row by row from z = 0, as a Heightfield holds them. */
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  /** As a file gives them back, or a list in the map's order, which every reader takes alike. */
  readonly statics: MapStatics | readonly MapStatic[];
  readonly nodes: readonly NodeLayer[];
  /** At least one. The first is where a new survivor arrives. */
  readonly spawns: readonly MapSpawn[];
  /** Spawn regions, each naming a `spawns` definition and the creatures it holds. They are added to those of the map's definition. */
  readonly regions?: readonly MapZone[];
  readonly vehicles?: readonly MapVehicle[];
  /** Lakes, ponds, reservoirs and the reaches of rivers, each on its own surface. Without it the sea is the only water. */
  readonly water?: MapWater;
  readonly content?: MapContent;
}

/** What a map adds to the content: its landmarks, each named by its files, and the definitions they bring. */
export interface MapContent {
  readonly landmarks: readonly MapLandmark[];
  readonly defs: readonly Def[];
}

/** A landmark the map places, with its origin and its yaw in 1/65,536 turns exactly as `placeLandmark` was given them. */
export interface MapLandmark {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** A map read from a file, with the hash that names those bytes. */
export interface MapFile extends MapData {
  readonly hash: number;
  readonly dims: FramedDims;
  readonly statics: MapStatics;
}

const outBytes = (dims: MapDims, perChunk: number): number => Math.ceil((chunkCount(dims) * perChunk) / 8);

function slotsOf(layer: NodeLayer, chunks: number): number {
  if (!("first" in layer)) return layer.perChunk;
  let most = 0;
  for (let c = 0; c < chunks; c++) most = Math.max(most, layer.first[c + 1]! - layer.first[c]!);
  return most;
}

function checkStatics(dims: MapDims, statics: MapStatics | readonly MapStatic[]): void {
  const [sizeX, sizeZ] = [dims.chunksX * CHUNK_SIZE, dims.chunksZ * CHUNK_SIZE];
  eachStatic(statics, (kind, x, y, z) => {
    if (!(x >= 0 && x <= sizeX && z >= 0 && z <= sizeZ && y >= WORLD_MIN_Y && y <= WORLD_MAX_Y)) throw new Error(`map: a ${kind} at ${x}, ${y}, ${z} is off the map`);
  });
}

/** Throws, saying what is wrong, if nothing could be played on `m`. */
function check(m: MapData): void {
  const fail = (what: string): never => {
    throw new Error(`map: ${what}`);
  };
  const { chunksX, chunksZ } = m.dims;
  const whole = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  // Each picture of zones once, where layers share one.
  const tops = new Map<Uint8Array, number>();
  const highest = (zone: Uint8Array): number => {
    let top = tops.get(zone);
    if (top === undefined) {
      top = 0;
      for (let i = 0; i < zone.length; i++) if (zone[i]! > top) top = zone[i]!;
      tops.set(zone, top);
    }
    return top;
  };
  if (!/^[\x21-\x7e]{1,64}$/.test(m.id)) fail("its id must be 1 to 64 characters of plain text with no space");
  const landmarks = (m.content?.landmarks ?? []).map((l) => l.name);
  if (landmarks.length > 255 || landmarks.some((n) => !/^[a-z][a-z0-9-]{0,31}$/.test(n)) || new Set(landmarks).size !== landmarks.length) fail("its landmarks are each named once, in lower case, at most 255 of them");
  if (m.content?.landmarks.some((l) => ![l.x, l.y, l.z].every(Number.isFinite) || !whole(l.yaw, 0, 65535))) fail("a landmark of it is not set down at a place and a yaw");
  if (!whole(chunksX, 1, MAX_CHUNKS_PER_AXIS) || !whole(chunksZ, 1, MAX_CHUNKS_PER_AXIS)) fail(`it is ${chunksX} by ${chunksZ} chunks, and a side is 1 to ${MAX_CHUNKS_PER_AXIS}`);
  const { frameX, frameZ, originX, originZ } = framed(m.dims);
  if (!whole(frameX, 0, FRAME_CHUNKS - chunksX) || !whole(frameZ, 0, FRAME_CHUNKS - chunksZ)) fail(`its south-east corner is at column ${frameX}, row ${frameZ}, and it must lie whole on the lattice of ${FRAME_CHUNKS} chunks a side`);
  if (!whole(originX, frameX + chunksX, FRAME_CHUNKS) || !whole(originZ, frameZ + chunksZ, FRAME_CHUNKS) || originX % SECTOR_CHUNKS !== 0 || originZ % SECTOR_CHUNKS !== 0) fail(`its display origin is at column ${originX}, row ${originZ}, and it must be a sector's corner at or west of column ${frameX + chunksX} and at or north of row ${frameZ + chunksZ}`);
  if (!(m.stepY > 0 && Number.isFinite(m.stepY) && Number.isFinite(m.minY) && m.seaLevel < Infinity)) fail("its height range or its sea level is not a number");
  const sizeX = chunksX * CHUNK_SIZE;
  const sizeZ = chunksZ * CHUNK_SIZE;
  const samples = (sizeX / TERRAIN_CELL + 1) * (sizeZ / TERRAIN_CELL + 1);
  if (m.heights.length !== samples || m.tint.length !== samples) fail(`it has ${m.heights.length} heights and ${m.tint.length} tints, and its size takes ${samples} of each`);
  const inside = (x: number, z: number): boolean => x >= 0 && x <= sizeX && z >= 0 && z <= sizeZ;
  if (!whole(m.spawns.length, 1, MAX_SPAWNS)) fail(`it has ${m.spawns.length} spawn points, and a map has 1 to ${MAX_SPAWNS}`);
  for (const s of m.spawns) if (!inside(s.x, s.z)) fail(`spawn point "${s.name}" is off the map`);
  checkStatics(m.dims, m.statics);
  let slots = 0;
  for (const layer of m.nodes) {
    slots += slotsOf(layer, chunksX * chunksZ);
    if ("first" in layer) {
      const rows = layer.first[chunksX * chunksZ];
      if (layer.first.length !== chunksX * chunksZ + 1 || rows !== layer.kind.length || rows !== layer.x.length || rows !== layer.z.length || rows !== layer.yaw.length) fail("a list of nodes does not match its chunks");
      if (layer.kinds.length > 255 || layer.kind.some((k) => k >= layer.kinds.length)) fail("a listed node is of a kind its list does not name");
      continue;
    }
    if (layer.out && layer.out.length !== outBytes(m.dims, layer.perChunk)) fail("the slots taken out of scattered nodes are not a bit per slot of every chunk");
    if ("zone" in layer) {
      const cell = layer.zoneCell;
      const weighed = (z: NodeZone): boolean => whole(z.bare, 0, 255) && whole(z.kinds.length, 0, 255) && z.kinds.every(([, weight]) => whole(weight, 1, 255)) && z.bare + z.kinds.length > 0;
      if (!whole(layer.perChunk, 1, NODE_SLOTS) || !whole(layer.zones.length, 1, 255) || !layer.zones.every(weighed)) fail("zoned nodes need 1 to 256 slots a chunk and 1 to 255 zones, each of 0 to 255 kinds of weight 1 to 255 and bare ground of weight 0 to 255");
      if (!whole(cell, 1, CHUNK_SIZE) || CHUNK_SIZE % cell !== 0 || layer.zone.length !== (sizeX / cell) * (sizeZ / cell)) fail("the zones of zoned nodes are not a byte per square of 1, 2, 4, 8, 16, 32 or 64 m");
      const codes = layer.codes;
      if (codes ? codes.length > 255 || codes.some((z) => z > layer.zones.length) || highest(layer.zone) >= codes.length : highest(layer.zone) > layer.zones.length) fail("a square is in a zone the list of zones does not have");
      continue;
    }
    const cell = layer.allowCell;
    if (!whole(layer.perChunk, 1, NODE_SLOTS) || !whole(layer.kinds.length, 1, 255) || layer.kinds.some(([, weight]) => !whole(weight, 1, 255))) fail("scattered nodes need 1 to 256 slots a chunk and 1 to 255 kinds, each of weight 1 to 255");
    if (layer.allow === null ? cell !== 0 : !whole(cell, 1, CHUNK_SIZE) || CHUNK_SIZE % cell !== 0 || layer.allow.length !== Math.ceil(((sizeX / cell) * (sizeZ / cell)) / 8)) fail("where scattered nodes may stand is not a bit per square of 1, 2, 4, 8, 16, 32 or 64 m");
  }
  if (slots > NODE_SLOTS) fail(`its nodes take ${slots} slots in a chunk, and a chunk has ${NODE_SLOTS}`);
  const w = m.water;
  if (w) {
    if (!whole(w.cell, 1, CHUNK_SIZE) || CHUNK_SIZE % w.cell !== 0 || w.dims.chunksX !== chunksX || w.dims.chunksZ !== chunksZ) fail("its water is not in squares of 1, 2, 4, 8, 16, 32 or 64 m over its chunks");
    if (!whole(w.bodies.length, 1, MAX_WATER_BODIES) || w.bodies.some((b) => !whole(b.level, 0, 65535) || b.name.length > MAX_TEXT)) fail(`it has ${w.bodies.length} bodies of water, and a map with water has 1 to ${MAX_WATER_BODIES}, each a surface on its heights' lattice and a name of at most ${MAX_TEXT} characters`);
    if (w.squares.length !== w.chunks().length * w.side * w.side || w.squares.some((b) => b > w.bodies.length)) fail("a square of its water is in a body it does not list");
  }
  const regions = m.regions ?? [];
  if (regions.length > MAX_REGIONS) fail(`it has ${regions.length} spawn regions, and a map has ${MAX_REGIONS} at most`);
  for (const z of regions) {
    const [rx, rz] = z.half ?? [z.radius ?? 0, z.radius ?? 0];
    if (z.kind !== "spawn" || z.spawns === undefined || !whole(z.count ?? -1, 0, 65535)) fail(`a spawn region at ${z.at[0]}, ${z.at[1]} names no spawns, or holds other than 0 to 65,535`);
    if (!inside(z.at[0], z.at[1]) || !(rx > 0 && rz > 0 && rx <= sizeX && rz <= sizeZ)) fail(`the spawn region of ${z.spawns} at ${z.at[0]}, ${z.at[1]} is off the map or has no size`);
  }
  const vehicleIds = new Set<string>();
  for (const v of m.vehicles ?? []) {
    if (!inside(v.x, v.z)) fail(`a ${v.kind} parked at ${v.x}, ${v.z} is off the map`);
    if (v.y !== undefined && !(v.y >= WORLD_MIN_Y && v.y <= WORLD_MAX_Y)) fail(`a ${v.kind} has an invalid landing height`);
    if (v.id !== undefined) {
      if (!/^[\x21-\x7e]{1,80}$/.test(v.id) || vehicleIds.has(v.id)) fail("parked vehicle ids must be unique plain names of 1 to 80 characters");
      vehicleIds.add(v.id);
    }
    for (const range of [v.condition, v.fuel]) if (range !== undefined &&
      (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0]! < 0 || range[1]! > 1 || range[0]! > range[1]!)) fail("parked vehicle condition and fuel ranges must be ordered fractions from 0 to 1");
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

  /** A section: its tag, its length, and what `body` writes. */
  section(tag: string, body: () => void): void {
    for (let i = 0; i < 4; i++) this.u8(tag.charCodeAt(i));
    const at = this.take(4);
    body();
    this.view.setUint32(at, this.at - at - 4, true);
  }

  /** What was written, as an array of its own. */
  done(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.at);
  }
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

/** Runs `read`, saying so if a section or a part runs past its end. */
function within<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    throw err instanceof RangeError ? new Error("map: a section runs past its end") : err;
  }
}

/**
 * The map's zoned layers on one picture, each value of it standing for a zone of every layer, so the squares are held and
 * sent once: a city's plants, stones and sea floor make 16 to 24 such values. Left as they are where there is one, where
 * their squares differ, or where they would make more than 255 values.
 */
function shareZones(nodes: readonly NodeLayer[]): readonly NodeLayer[] {
  const zoned = nodes.filter((l): l is NodeZoned => "zone" in l);
  if (zoned.length < 2 || zoned.some((l) => l.zoneCell !== zoned[0]!.zoneCell)) return nodes;
  const picture = new Uint8Array(zoned[0]!.zone.length);
  const codes = new Map<number, number>();
  let [key, code] = [-1, 0];
  for (let i = 0; i < picture.length; i++) {
    let k = 0;
    for (const l of zoned) k = k * 256 + (l.codes ? l.codes[l.zone[i]!]! : l.zone[i]!);
    if (k !== key) {
      key = k;
      if (!codes.has(k)) codes.set(k, codes.size);
      if (codes.size > 255) return nodes;
      code = codes.get(k)!;
    }
    picture[i] = code;
  }
  const each = zoned.map(() => new Uint8Array(codes.size));
  for (const [k, c] of codes) for (let at = zoned.length - 1, v = k; at >= 0; at--, v = Math.floor(v / 256)) each[at]![c] = v % 256;
  return nodes.map((l) => {
    const at = zoned.indexOf(l as NodeZoned);
    return at < 0 ? l : { ...(l as NodeZoned), zone: picture, codes: each[at]! };
  });
}

/**
 * A part's hash, which its file's name ends with, as 16 hex digits: two hashes of 32 bits in one walk over its length and
 * then its bytes four at a time as a little-endian u32, the last few padded with zeros, each step xor, multiply and its
 * high bits folded down, by two primes from two starts. Each step undoes, so any one word changed changes both. Not a
 * security primitive.
 */
export function partHash(bytes: Uint8Array): string {
  let a = Math.imul(0x811c9dc5 ^ bytes.length, 0x01000193);
  let b = Math.imul(0x9e3779b9 ^ bytes.length, 0x5bd1e995);
  const n = bytes.length & ~3;
  for (let i = 0; i < bytes.length; i += 4) {
    const v = i < n ? bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24) : bytes[i]! | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16);
    a = Math.imul(a ^ v, 0x01000193);
    a ^= a >>> 15;
    b = Math.imul(b ^ v, 0x5bd1e995);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The name of a part's file, or with `kind` "head" of the head's, which a client fetches it by. */
export function partName(kind: PartKind | "head", col: number, row: number, hash: string): string {
  return kind === "head" || kind === "land" ? `${kind}.${hash}.part` : `${kind}.${col}-${row}.${hash}.part`;
}

/** Where a map's build puts the files of the parts of the map at `path`, with their copies for the wire: a folder beside it. */
export function partsFolder(path: string): string {
  return `${path.replace(/\.snmap$/, "")}.parts`;
}

/** The squares a part's of `kind` lie on: SECTOR_CHUNKS a side for a sector's, OVERVIEW_CHUNKS for an overview's. */
const sizeOf = (kind: PartKind): number => (kind === "overview" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS);

/**
 * A square of the lattice, `size` chunks a side, as it lies on a map: its column and row of such squares, its corner in the
 * map's chunks (ox, oz), which may be off the map, and the map's chunks it holds, cx0 up to cx1 and cz0 up to cz1.
 */
export interface Square {
  readonly col: number;
  readonly row: number;
  readonly ox: number;
  readonly oz: number;
  readonly cx0: number;
  readonly cz0: number;
  readonly cx1: number;
  readonly cz1: number;
}

/** The square at `col`, `row` of `size` chunks a side on the map of `dims`, or null if it holds none of it. */
export function squareOf(dims: FramedDims, size: number, col: number, row: number): Square | null {
  const ox = col * size - dims.frameX;
  const oz = row * size - dims.frameZ;
  const sq = { col, row, ox, oz, cx0: Math.max(0, ox), cz0: Math.max(0, oz), cx1: Math.min(dims.chunksX, ox + size), cz1: Math.min(dims.chunksZ, oz + size) };
  return sq.cx0 < sq.cx1 && sq.cz0 < sq.cz1 ? sq : null;
}

/** Every square of `size` chunks a side that holds some of the map, row by row. */
export function squaresOf(dims: FramedDims, size: number): Square[] {
  const out: Square[] = [];
  for (let row = Math.floor(dims.frameZ / size); row * size < dims.frameZ + dims.chunksZ; row++) {
    for (let col = Math.floor(dims.frameX / size); col * size < dims.frameX + dims.chunksX; col++) out.push(squareOf(dims, size, col, row)!);
  }
  return out;
}

/** Samples of a grid `w` a row: each less what its left, upper and upper-left neighbours predict, zigzagged, as planes. */
function putGrid(o: Out, h: Uint16Array, w: number): void {
  const n = h.length;
  const at = o.take(n * 2);
  const b = o.bytes;
  for (let k = 0; k < n; k++) {
    const i = k % w;
    const left = i > 0 ? h[k - 1]! : 0;
    const above = k >= w ? h[k - w]! : 0;
    const corner = i > 0 && k >= w ? h[k - w - 1]! : 0;
    const r = ((h[k]! - (left + above - corner)) << 16) >> 16;
    const z = (r << 1) ^ (r >> 31);
    b[at + k] = z;
    b[at + n + k] = z >> 8;
  }
}

function getGrid(s: In, w: number, d: number): Uint16Array {
  const n = w * d;
  const b = s.take(n * 2);
  const h = new Uint16Array(n);
  for (let j = 0, k = 0; j < d; j++) {
    for (let i = 0; i < w; i++, k++) {
      const z = b[k]! | (b[n + k]! << 8);
      const guess = j === 0 ? (i === 0 ? 0 : h[k - 1]!) : i === 0 ? h[k - w]! : h[k - 1]! + h[k - w]! - h[k - w - 1]!;
      h[k] = ((z >>> 1) ^ -(z & 1)) + guess;
    }
  }
  return h;
}

/** u16s as planes: every low byte, then every high byte. */
function putU16s(o: Out, v: Uint16Array): void {
  const at = o.take(v.length * 2);
  for (let k = 0; k < v.length; k++) {
    o.bytes[at + k] = v[k]!;
    o.bytes[at + v.length + k] = v[k]! >> 8;
  }
}

function getU16s(s: In, n: number): Uint16Array {
  const b = s.take(n * 2);
  return Uint16Array.from({ length: n }, (_, k) => b[k]! | (b[n + k]! << 8));
}

/** Copies `n` bits from bit `at` of `from` to bit `into` of `to`, lowest bit first. */
function copyBits(from: Uint8Array, at: number, to: Uint8Array, into: number, n: number): void {
  for (let k = 0; k < n; k++, at++, into++) {
    if ((from[at >> 3]! >> (at & 7)) & 1) to[into >> 3]! |= 1 << (into & 7);
    else to[into >> 3]! &= ~(1 << (into & 7));
  }
}

/** Where a picture of `cell` metres a square over the map of `dims` meets a square of the lattice, in its squares. */
function pictureOf(dims: MapDims, sq: Square, cell: number): { across: number; i0: number; j0: number; w: number; d: number } {
  const per = CHUNK_SIZE / cell;
  return { across: dims.chunksX * per, i0: sq.cx0 * per, j0: sq.cz0 * per, w: (sq.cx1 - sq.cx0) * per, d: (sq.cz1 - sq.cz0) * per };
}

/** Its chunks row by row as the map's chunks, by its index among them. */
function chunksOf(dims: MapDims, sq: Square): Uint32Array {
  const w = sq.cx1 - sq.cx0;
  return Uint32Array.from({ length: w * (sq.cz1 - sq.cz0) }, (_, k) => (sq.cz0 + Math.floor(k / w)) * dims.chunksX + sq.cx0 + (k % w));
}

/** The samples of `field` (the map's, row by row) from (i0, j0), `w` by `d` of them, every `step`th. */
function samplesOf<T extends Uint8Array | Uint16Array>(field: T, nx: number, i0: number, j0: number, w: number, d: number, step: number): T {
  const out = new (field.constructor as new (n: number) => T)(w * d);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) out[j * w + i] = field[(j0 + j * step) * nx + i0 + i * step]!;
  return out;
}

function overviewPart(m: MapData, dims: FramedDims, layers: readonly NodeLayer[], sq: Square): Uint8Array {
  const o = new Out();
  const nx = dims.chunksX * CHUNK_SAMPLES + 1;
  const per = CHUNK_SAMPLES / OVERVIEW_STEP;
  const [w, d] = [(sq.cx1 - sq.cx0) * per + 1, (sq.cz1 - sq.cz0) * per + 1];
  const [i0, j0] = [sq.cx0 * CHUNK_SAMPLES, sq.cz0 * CHUNK_SAMPLES];
  putGrid(o, samplesOf(m.heights, nx, i0, j0, w, d, OVERVIEW_STEP), w);
  o.put(samplesOf(m.tint, nx, i0, j0, w, d, OVERVIEW_STEP));
  const chunks = chunksOf(dims, sq);
  const [low, high] = [new Uint16Array(chunks.length), new Uint16Array(chunks.length)];
  chunks.forEach((c, k) => {
    let [a, b] = [65535, 0];
    const [ci, cj] = [chunkCx(dims, c) * CHUNK_SAMPLES, chunkCz(dims, c) * CHUNK_SAMPLES];
    for (let j = cj; j <= cj + CHUNK_SAMPLES; j++) {
      for (let i = ci; i <= ci + CHUNK_SAMPLES; i++) {
        const h = m.heights[j * nx + i]!;
        if (h < a) a = h;
        if (h > b) b = h;
      }
    }
    [low[k], high[k]] = [a, b];
  });
  putU16s(o, low);
  putU16s(o, high);
  let picture: Uint8Array | null = null;
  for (const layer of layers) {
    if ("first" in layer) continue;
    if ("zone" in layer) {
      if (layer.zone !== picture) {
        const p = pictureOf(dims, sq, layer.zoneCell);
        for (let j = 0; j < p.d; j++) o.put(layer.zone.subarray((p.j0 + j) * p.across + p.i0, (p.j0 + j) * p.across + p.i0 + p.w));
      }
      picture = layer.zone;
    } else if (layer.allow) {
      const p = pictureOf(dims, sq, layer.allowCell);
      const bits = new Uint8Array(Math.ceil((p.w * p.d) / 8));
      for (let j = 0; j < p.d; j++) copyBits(layer.allow, (p.j0 + j) * p.across + p.i0, bits, j * p.w, p.w);
      o.put(bits);
    }
    if (layer.out) {
      const bits = new Uint8Array(Math.ceil((chunks.length * layer.perChunk) / 8));
      chunks.forEach((c, k) => copyBits(layer.out!, c * layer.perChunk, bits, k * layer.perChunk, layer.perChunk));
      o.put(bits);
    }
  }
  const water = m.water;
  if (water) {
    const held = [...chunks.keys()].filter((k) => water.block[chunks[k]!]! >= 0);
    const squares = water.side * water.side;
    o.u16(held.length);
    for (const k of held) {
      o.u16(k);
      putSquares(o, water.squares.subarray(water.block[chunks[k]!]!, water.block[chunks[k]!]! + squares));
    }
  }
  return o.done();
}

function putSquares(o: Out, squares: Uint16Array): void {
  const at = o.take(squares.length * 2);
  for (let q = 0; q < squares.length; q++) o.view.setUint16(at + q * 2, squares[q]!, true);
}

function groundPart(m: MapData, dims: FramedDims, layers: readonly NodeLayer[], sq: Square): Uint8Array {
  const o = new Out();
  const nx = dims.chunksX * CHUNK_SAMPLES + 1;
  const [w, d] = [(sq.cx1 - sq.cx0) * CHUNK_SAMPLES + 1, (sq.cz1 - sq.cz0) * CHUNK_SAMPLES + 1];
  const [i0, j0] = [sq.cx0 * CHUNK_SAMPLES, sq.cz0 * CHUNK_SAMPLES];
  putGrid(o, samplesOf(m.heights, nx, i0, j0, w, d, 1), w);
  o.put(samplesOf(m.tint, nx, i0, j0, w, d, 1));
  for (const layer of layers) {
    if (!("first" in layer)) continue;
    for (const c of chunksOf(dims, sq)) {
      o.u16(layer.first[c + 1]! - layer.first[c]!);
      for (let r = layer.first[c]!; r < layer.first[c + 1]!; r++) {
        o.u8(layer.kind[r]!);
        o.u16(layer.x[r]!);
        o.u16(layer.z[r]!);
        o.u16(layer.yaw[r]!);
      }
    }
  }
  return o.done();
}

/** The map's statics by sector, each sector's in the map's order, and the table of content ids they name. */
function sectorStatics(statics: MapStatics | readonly MapStatic[], dims: FramedDims, sectors: readonly Square[]): { ids: Map<string, number>; parts: (Uint8Array | null)[] } {
  const n = statics.length;
  const ids = new Map<string, number>();
  const [id, yaw, sector] = [new Uint16Array(n), new Uint16Array(n), new Uint32Array(n)];
  const [ux, uy, uz] = [new Int32Array(n), new Int32Array(n), new Int32Array(n)];
  const [col0, row0] = [sectors[0]!.col, sectors[0]!.row];
  const cols = sectors.findLast((s) => s.row === row0)!.col - col0 + 1;
  const counts = new Uint32Array(sectors.length + 1);
  let i = 0;
  eachStatic(statics, (kind, x, y, z, turn) => {
    if (!ids.has(kind)) ids.set(kind, ids.size);
    [ux[i], uy[i], uz[i]] = [Math.round(x * STRUCT_UNITS), Math.round(y * STRUCT_UNITS), Math.round(z * STRUCT_UNITS)];
    // Its chunk is that of its place on the lattice, as a reader finds it.
    const c = chunkAt(dims, ux[i]! / STRUCT_UNITS, uz[i]! / STRUCT_UNITS);
    const s = (Math.floor((dims.frameZ + chunkCz(dims, c)) / SECTOR_CHUNKS) - row0) * cols + Math.floor((dims.frameX + chunkCx(dims, c)) / SECTOR_CHUNKS) - col0;
    [id[i], yaw[i], sector[i]] = [ids.get(kind)!, turn, s];
    counts[s + 1]!++;
    i++;
  });
  for (let s = 0; s < sectors.length; s++) counts[s + 1]! += counts[s]!;
  // Each sector's pieces in the map's order.
  const order = new Uint32Array(n);
  const at = counts.slice(0, sectors.length);
  for (let k = 0; k < n; k++) order[at[sector[k]!]!++] = k;
  // A difference is taken modulo 2^24, which the reader undoes: a square's widest is 2^19 units.
  const zigzag = (v: number): number => (v = (v << 8) >> 8, (v << 1) ^ (v >> 31));
  const parts = sectors.map((sq, s): Uint8Array | null => {
    const count = counts[s + 1]! - counts[s]!;
    if (count === 0) return null;
    const o = new Out();
    o.u32(count);
    const at = o.take(count * STAT_ROW);
    const b = o.bytes;
    const plane = (column: number, i: number, v: number, bytes: number): void => {
      for (let k = 0; k < bytes; k++) b[at + (column + k) * count + i] = v >>> (8 * k);
    };
    const [x0, z0] = [sq.ox * CHUNK_SIZE * STRUCT_UNITS, sq.oz * CHUNK_SIZE * STRUCT_UNITS];
    let [px, py, pz, pyaw] = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      const k = order[counts[s]! + i]!;
      const [x, y, z] = [ux[k]! - x0, uy[k]!, uz[k]! - z0];
      plane(0, i, id[k]!, 2);
      plane(2, i, yaw[k]! - pyaw, 2);
      plane(4, i, zigzag(x - px), 3);
      plane(7, i, zigzag(y - py), 3);
      plane(10, i, zigzag(z - pz), 3);
      [px, py, pz, pyaw] = [x, y, z, yaw[k]!];
    }
    return o.done();
  });
  return { ids, parts };
}

interface Written {
  readonly kind: PartKind;
  readonly sq: Square | null;
  readonly bytes: Uint8Array;
}

function headPart(m: MapData, dims: FramedDims, layers: readonly NodeLayer[], ids: Map<string, number>, parts: readonly Written[]): Uint8Array<ArrayBuffer> {
  const o = new Out();
  o.u32(MAGIC);
  o.u16(MAP_VERSION);
  o.u16(0);
  o.u32(0);
  o.u32(0);
  for (const v of [dims.chunksX, dims.chunksZ, dims.frameX, dims.frameZ, dims.originX, dims.originZ]) o.u16(v);
  const cellAt = o.take(4);
  o.view.setFloat32(cellAt, TERRAIN_CELL, true);
  o.f64(m.minY);
  o.f64(m.stepY);
  o.f64(m.seaLevel);
  o.text(m.id);
  let picture: Uint8Array | null = null;
  for (const layer of layers) {
    o.section("NODE", () => {
      if ("zone" in layer) {
        o.u8(2);
        o.u32(layer.seed);
        o.u16(layer.perChunk);
        o.u8(layer.zones.length);
        for (const z of layer.zones) {
          o.u8(z.bare);
          o.u8(z.kinds.length);
          for (const [id, weight] of z.kinds) {
            o.u8(weight);
            o.text(id);
          }
        }
        o.u8(layer.zoneCell);
        o.u8(layer.codes?.length ?? 0);
        if (layer.codes) o.put(layer.codes);
        o.u8(layer.zone === picture ? 1 : 0);
        o.u8(layer.out ? 1 : 0);
        picture = layer.zone;
        return;
      }
      if ("first" in layer) {
        o.u8(1);
        o.u8(layer.kinds.length);
        for (const id of layer.kinds) o.text(id);
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
      o.u8(layer.out ? 1 : 0);
    });
  }
  o.section("SPWN", () => {
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
    o.section("WILD", () => {
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
  const vehicles = m.vehicles ?? [];
  if (vehicles.length > 0) {
    o.section("VHCL", () => {
      const ids = new Map<string, number>();
      for (const v of vehicles) if (!ids.has(v.kind)) ids.set(v.kind, ids.size);
      o.u16(ids.size);
      for (const id of ids.keys()) o.text(id);
      o.u32(vehicles.length);
      for (const v of vehicles) {
        o.u16(ids.get(v.kind)!);
        o.u16(v.yaw);
        o.i32(Math.round(v.x * STRUCT_UNITS));
        o.i32(Math.round(v.z * STRUCT_UNITS));
      }
    });
    const extended = vehicles.map((v, index) => ({ v, index })).filter(({ v }) => v.id !== undefined || v.y !== undefined || v.condition !== undefined || v.fuel !== undefined);
    if (extended.length > 0) o.section("VHCX", () => {
      o.u8(1); o.u32(extended.length);
      for (const { v, index } of extended) {
        o.u32(index);
        o.u8((v.id !== undefined ? 1 : 0) | (v.y !== undefined ? 2 : 0) | (v.condition !== undefined ? 4 : 0) | (v.fuel !== undefined ? 8 : 0));
        if (v.id !== undefined) o.text(v.id);
        if (v.y !== undefined) o.f64(v.y);
        if (v.condition !== undefined) { o.f64(v.condition[0]); o.f64(v.condition[1]); }
        if (v.fuel !== undefined) { o.f64(v.fuel[0]); o.f64(v.fuel[1]); }
      }
    });
  }
  const w = m.water;
  if (w) {
    o.section("WATR", () => {
      o.u8(w.cell);
      o.u16(w.bodies.length);
      for (const b of w.bodies) {
        o.text(b.name);
        o.u16(b.level);
      }
    });
  }
  const land = m.content;
  if (land && land.landmarks.length + land.defs.length > 0) {
    o.section("LAND", () => {
      o.u8(land.landmarks.length);
      for (const l of land.landmarks) {
        o.text(l.name);
        o.f64(l.x);
        o.f64(l.y);
        o.f64(l.z);
        o.u16(l.yaw);
      }
    });
  }
  if (ids.size > 0) {
    o.section("STAT", () => {
      o.u16(ids.size);
      for (const id of ids.keys()) o.text(id);
    });
  }
  o.section("PART", () => {
    o.u16(parts.length);
    for (const p of parts) {
      o.u8(PART_KINDS.indexOf(p.kind) + 1);
      o.u8(p.sq?.col ?? 0);
      o.u8(p.sq?.row ?? 0);
      o.u32(p.bytes.length);
      const hash = partHash(p.bytes);
      o.u32(parseInt(hash.slice(0, 8), 16));
      o.u32(parseInt(hash.slice(8), 16));
    }
  });
  const head = o.done();
  const view = new DataView(head.buffer);
  view.setUint32(12, head.length, true);
  view.setUint32(8, hashBytes(head.subarray(12)), true);
  return head;
}

/**
 * The map as its file: the head, then the landmarks' definitions, the overviews, each sector's ground and each sector's
 * statics. Throws, saying why, if nothing could be played on it.
 */
export function writeMap(m: MapData): Uint8Array<ArrayBuffer> {
  check(m);
  const dims = framed(m.dims);
  const layers = shareZones(m.nodes);
  const parts: Written[] = [];
  const defs = m.content?.defs ?? [];
  if (defs.length > 0) {
    // Written as ASCII, every other character escaped, which UTF-8 reads as it is.
    const json = JSON.stringify(defs).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    parts.push({ kind: "land", sq: null, bytes: Uint8Array.from(json, (c) => c.charCodeAt(0)) });
  }
  for (const sq of squaresOf(dims, OVERVIEW_CHUNKS)) parts.push({ kind: "overview", sq, bytes: overviewPart(m, dims, layers, sq) });
  const sectors = squaresOf(dims, SECTOR_CHUNKS);
  for (const sq of sectors) parts.push({ kind: "ground", sq, bytes: groundPart(m, dims, layers, sq) });
  const statics = sectorStatics(m.statics, dims, sectors);
  sectors.forEach((sq, s) => statics.parts[s] && parts.push({ kind: "statics", sq, bytes: statics.parts[s] }));
  const head = headPart(m, dims, layers, statics.ids, parts);
  const file = new Uint8Array(head.length + parts.reduce((n, p) => n + p.bytes.length, 0));
  file.set(head);
  let at = head.length;
  for (const p of parts) {
    file.set(p.bytes, at);
    at += p.bytes.length;
  }
  return file;
}

/** A node layer as the head gives it: its rules, and whether the parts hold a picture of it and its slots taken out. */
export type LayerRule =
  | { readonly type: 0; readonly seed: number; readonly perChunk: number; readonly kinds: readonly (readonly [string, number])[]; readonly allowCell: number; readonly out: boolean }
  | { readonly type: 1; readonly kinds: readonly string[] }
  | { readonly type: 2; readonly seed: number; readonly perChunk: number; readonly zones: readonly NodeZone[]; readonly zoneCell: number; readonly codes: Uint8Array | null; readonly shared: boolean; readonly out: boolean };

/** A part as its head lists it. */
export interface MapPart {
  readonly kind: PartKind;
  /** Its square's column and row, of sectors or of overviews as its kind is; 0 for the land. */
  readonly col: number;
  readonly row: number;
  /** Where it starts in the map's file, and its bytes. */
  readonly at: number;
  readonly length: number;
  /** partHash of its bytes. */
  readonly hash: string;
  /** Its file's (partName). */
  readonly name: string;
}

/** A map's head read: what each part is read against. */
export interface MapHead {
  /** The map's hash, as the welcome and a save know it. */
  readonly hash: number;
  /** Its bytes, at which the first part starts. */
  readonly bytes: number;
  /** Its own file's name. */
  readonly name: string;
  readonly id: string;
  readonly dims: FramedDims;
  readonly minY: number;
  readonly stepY: number;
  readonly seaLevel: number;
  readonly spawns: readonly MapSpawn[];
  readonly regions: readonly MapZone[];
  readonly vehicles: readonly MapVehicle[];
  /** Null where it has no LAND. */
  readonly landmarks: readonly MapLandmark[] | null;
  readonly layers: readonly LayerRule[];
  readonly water: { readonly cell: number; readonly bodies: readonly WaterBody[] } | null;
  /** The content ids its statics name by number. */
  readonly kinds: readonly string[];
  readonly parts: readonly MapPart[];
}

function readRule(s: In): LayerRule {
  const type = s.u8();
  const weights = (): [string, number][] =>
    Array.from({ length: s.u8() }, (): [string, number] => {
      const weight = s.u8();
      return [s.text(), weight];
    });
  const cellOf = (cell: number): number => {
    if (!(cell >= 1 && cell <= CHUNK_SIZE && CHUNK_SIZE % cell === 0)) throw new Error(`map: nodes are placed by squares of ${cell} m, and a square is 1, 2, 4, 8, 16, 32 or 64 m`);
    return cell;
  };
  if (type === 1) return { type, kinds: Array.from({ length: s.u8() }, () => s.text()) };
  if (type === 0) {
    const [seed, perChunk, kinds] = [s.u32(), s.u16(), weights()];
    const allowCell = s.u8();
    return { type, seed, perChunk, kinds, allowCell: allowCell === 0 ? 0 : cellOf(allowCell), out: s.u8() === 1 };
  }
  if (type !== 2) throw new Error(`map: nodes of type ${type} are not ones this build reads`);
  const [seed, perChunk] = [s.u32(), s.u16()];
  const zones = Array.from({ length: s.u8() }, (): NodeZone => {
    const bare = s.u8();
    return { bare, kinds: weights() };
  });
  const zoneCell = cellOf(s.u8());
  const codes = s.u8();
  return { type, seed, perChunk, zones, zoneCell, codes: codes > 0 ? s.take(codes).slice() : null, shared: s.u8() === 1, out: s.u8() === 1 };
}

/**
 * A map's head, from its own bytes or from the start of the map's file. Throws with a reason if it is not a map this build
 * can play on. Without `verify` its hash is taken on trust, as a page does that fetched it by its name.
 */
export function readHead(file: Uint8Array, verify = true): MapHead {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 16 || v.getUint32(0, true) !== MAGIC) throw new Error("map: this is not a map file");
  const version = v.getUint16(4, true);
  if (version !== MAP_VERSION) throw new Error(`map: version ${version} is not one this build reads: build the map again`);
  const bytes = v.getUint32(12, true);
  if (bytes < HEADER_BYTES || bytes > file.length) throw new Error("map: it is cut short");
  const hash = v.getUint32(8, true);
  if (verify && hash !== hashBytes(file.subarray(12, bytes))) throw new Error("map: its head is damaged: its hash is not that of its bytes");
  return within(() => readHeadSections(new In(file.subarray(0, bytes)), hash));
}

function readHeadSections(r: In, hash: number): MapHead {
  r.at = 16;
  const dims = { chunksX: r.u16(), chunksZ: r.u16(), frameX: r.u16(), frameZ: r.u16(), originX: r.u16(), originZ: r.u16() };
  const cell = r.view.getFloat32(r.at, true);
  r.at += 4;
  if (cell !== TERRAIN_CELL) throw new Error(`map: its samples are ${cell} m apart, and this build draws ground of ${TERRAIN_CELL} m`);
  if (dims.chunksX < 1 || dims.chunksZ < 1 || dims.frameX + dims.chunksX > FRAME_CHUNKS || dims.frameZ + dims.chunksZ > FRAME_CHUNKS) throw new Error(`map: it is ${dims.chunksX} by ${dims.chunksZ} chunks at column ${dims.frameX}, row ${dims.frameZ}, which is not on the lattice`);
  const [minY, stepY, seaLevel] = [r.f64(), r.f64(), r.f64()];
  const id = r.text();
  const layers: LayerRule[] = [];
  const spawns: MapSpawn[] = [];
  const regions: MapZone[] = [];
  const vehicles: MapVehicle[] = [];
  const vehicleExtras = new Map<number, Partial<MapVehicle>>();
  let water: MapHead["water"] = null;
  let landmarks: MapLandmark[] | null = null;
  let kinds: string[] = [];
  let parts: MapPart[] | null = null;
  while (r.at < r.bytes.length) {
    const tag = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
    const s = new In(r.take(r.u32()));
    if (tag === "NODE") layers.push(readRule(s));
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
    } else if (tag === "VHCL") {
      const ids = Array.from({ length: s.u16() }, () => s.text());
      for (let n = s.u32(); n > 0; n--) {
        const kind = ids[s.u16()];
        if (kind === undefined) throw new Error("map: a parked vehicle is of a kind its table does not name");
        const yaw = s.u16();
        vehicles.push({ kind, x: s.i32() / STRUCT_UNITS, z: s.i32() / STRUCT_UNITS, yaw });
      }
    } else if (tag === "VHCX") {
      if (s.u8() !== 1) throw new Error("map: unsupported parked vehicle extension");
      for (let n = s.u32(); n > 0; n--) {
        const index = s.u32(), flags = s.u8();
        if ((flags & ~15) !== 0 || vehicleExtras.has(index)) throw new Error("map: invalid parked vehicle extension");
        vehicleExtras.set(index, {
          ...(flags & 1 ? { id: s.text() } : {}),
          ...(flags & 2 ? { y: s.f64() } : {}),
          ...(flags & 4 ? { condition: [s.f64(), s.f64()] as const } : {}),
          ...(flags & 8 ? { fuel: [s.f64(), s.f64()] as const } : {}),
        });
      }
    } else if (tag === "LAND") {
      if (landmarks) throw new Error("map: it has two LAND sections");
      landmarks = Array.from({ length: s.u8() }, (): MapLandmark => ({ name: s.text(), x: s.f64(), y: s.f64(), z: s.f64(), yaw: s.u16() }));
    } else if (tag === "WATR") {
      if (water) throw new Error("map: it has two WATR sections");
      const cell = s.u8();
      if (!(cell >= 1 && cell <= CHUNK_SIZE && CHUNK_SIZE % cell === 0)) throw new Error(`map: its water is in squares of ${cell} m, and a square is 1, 2, 4, 8, 16, 32 or 64 m`);
      water = { cell, bodies: Array.from({ length: s.u16() }, () => ({ name: s.text(), level: s.u16() })) };
    } else if (tag === "STAT") kinds = Array.from({ length: s.u16() }, () => s.text());
    else if (tag === "PART") {
      if (parts) throw new Error("map: it has two PART sections");
      parts = [];
      let at = r.bytes.length;
      for (let n = s.u16(); n > 0; n--) {
        const kind = PART_KINDS[s.u8() - 1];
        if (!kind) throw new Error("map: a part is of a kind this build does not read");
        const [col, row, length] = [s.u8(), s.u8(), s.u32()];
        const hash = s.u32().toString(16).padStart(8, "0") + s.u32().toString(16).padStart(8, "0");
        parts.push({ kind, col, row, at, length, hash, name: partName(kind, col, row, hash) });
        at += length;
      }
    }
  }
  for (const [index, extra] of vehicleExtras) {
    if (!vehicles[index]) throw new Error("map: parked vehicle extension names a missing vehicle");
    vehicles[index] = { ...vehicles[index]!, ...extra };
  }
  const head = { hash, bytes: r.bytes.length, name: partName("head", 0, 0, partHash(r.bytes)), id, dims, minY, stepY, seaLevel, spawns, regions, vehicles, landmarks, layers, water, kinds, parts: parts ?? [] };
  checkParts(head);
  return head;
}

/** Throws unless the head lists one overview for each of the map's overview squares, one ground for each sector, and nothing else twice. */
function checkParts(head: MapHead): void {
  const seen = new Set<string>();
  for (const p of head.parts) {
    const key = `${p.kind} ${p.col} ${p.row}`;
    if (seen.has(key)) throw new Error(`map: it has two parts ${p.kind} ${p.col}, ${p.row}`);
    seen.add(key);
    if (p.kind === "land" ? p.col !== 0 || p.row !== 0 : !squareOf(head.dims, sizeOf(p.kind), p.col, p.row)) throw new Error(`map: its part ${p.name} lies off the map`);
  }
  for (const [kind, size] of [["overview", OVERVIEW_CHUNKS], ["ground", SECTOR_CHUNKS]] as const) {
    for (const sq of squaresOf(head.dims, size)) if (!seen.has(`${kind} ${sq.col} ${sq.row}`)) throw new Error(`map: it has no ${kind} part of square ${sq.col}, ${sq.row}`);
  }
}

/** The landmarks' definitions. */
export interface LandPiece {
  readonly kind: "land";
  readonly defs: readonly Def[];
}

/** An overview's ground at every fourth sample, its chunks' lowest and highest ground, its nodes' pictures and its water. */
export interface OverviewPiece {
  readonly kind: "overview";
  readonly sq: Square;
  /** Row by row, (cx1 - cx0) * 8 + 1 a row. */
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  /** Each of its chunks' lowest and highest sample, its edges among them, row by row. */
  readonly low: Uint16Array;
  readonly high: Uint16Array;
  /** By node layer, its picture of the square, bits or bytes as the layer's is, and its slots taken out, or null where it has none. */
  readonly pictures: readonly (Uint8Array | null)[];
  readonly out: readonly (Uint8Array | null)[];
  /** The map's chunks of it that hold water, ascending, and their squares. Null where the map has no WATR. */
  readonly water: { readonly chunks: Uint32Array; readonly squares: Uint16Array } | null;
}

/** A sector's ground and tint at every sample, and its listed nodes. */
export interface GroundPiece {
  readonly kind: "ground";
  readonly sq: Square;
  /** Row by row, (cx1 - cx0) * 32 + 1 a row. */
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  /** By node layer, a listed one's rows chunk by chunk and each of its chunks' count, row by row; null for another layer. */
  readonly listed: readonly ({ readonly count: Uint16Array; readonly kind: Uint8Array; readonly x: Uint16Array; readonly z: Uint16Array; readonly yaw: Uint16Array } | null)[];
}

/** A sector's statics in the map's order, at their places on the map, each with its chunk. */
export interface StaticsPiece {
  readonly kind: "statics";
  readonly sq: Square;
  /** Its place in the head's `kinds`. */
  readonly id: Uint16Array;
  readonly yaw: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly chunk: Uint32Array;
}

export type MapPiece = LandPiece | OverviewPiece | GroundPiece | StaticsPiece;

/**
 * A part read a step at a time, given its head: a sector's statics yield every SLICE pieces, so a page reads a city's
 * between frames. With `verify` a part whose bytes are not those the head names is refused with its name.
 */
export function* partSteps(head: MapHead, part: MapPart, bytes: Uint8Array, verify = true): Generator<void, MapPiece> {
  if (bytes.length !== part.length || (verify && partHash(bytes) !== part.hash)) throw new Error(`map: its part ${part.name} is damaged or another's: its bytes are not those its head names`);
  const s = new In(bytes);
  const sq = part.kind === "land" ? null : squareOf(head.dims, sizeOf(part.kind), part.col, part.row)!;
  const steps = (function* (): Generator<void, MapPiece> {
    if (part.kind === "land") return { kind: "land", defs: JSON.parse(decodeUtf8(bytes)) as Def[] };
    if (part.kind === "statics") return yield* readStatics(head, sq!, s);
    return part.kind === "overview" ? readOverview(head, sq!, s) : readGround(head, sq!, s);
  })();
  for (;;) {
    let step: IteratorResult<void, MapPiece>;
    try {
      step = steps.next();
    } catch (err) {
      throw err instanceof RangeError ? new Error(`map: its part ${part.name} runs past its end`) : err;
    }
    if (!step.done) {
      yield;
      continue;
    }
    if (part.kind !== "land" && s.at !== bytes.length) throw new Error(`map: its part ${part.name} runs on past what it holds`);
    return step.value;
  }
}

/** partSteps without a pause. */
export function readPart(head: MapHead, part: MapPart, bytes: Uint8Array, verify = true): MapPiece {
  return finish(partSteps(head, part, bytes, verify));
}

function readOverview(head: MapHead, sq: Square, s: In): OverviewPiece {
  const per = CHUNK_SAMPLES / OVERVIEW_STEP;
  const [w, d] = [(sq.cx1 - sq.cx0) * per + 1, (sq.cz1 - sq.cz0) * per + 1];
  const heights = getGrid(s, w, d);
  const tint = s.take(w * d).slice();
  const chunks = chunksOf(head.dims, sq);
  const [low, high] = [getU16s(s, chunks.length), getU16s(s, chunks.length)];
  const pictures: (Uint8Array | null)[] = [];
  const out: (Uint8Array | null)[] = [];
  for (const rule of head.layers) {
    let picture: Uint8Array | null = null;
    if (rule.type === 2 && !rule.shared) {
      const p = pictureOf(head.dims, sq, rule.zoneCell);
      picture = s.take(p.w * p.d).slice();
    } else if (rule.type === 0 && rule.allowCell > 0) {
      const p = pictureOf(head.dims, sq, rule.allowCell);
      picture = s.take(Math.ceil((p.w * p.d) / 8)).slice();
    }
    pictures.push(picture);
    out.push(rule.type !== 1 && rule.out ? s.take(Math.ceil((chunks.length * rule.perChunk) / 8)).slice() : null);
  }
  let water: OverviewPiece["water"] = null;
  if (head.water) {
    const per = (CHUNK_SIZE / head.water.cell) ** 2;
    const n = s.u16();
    const held = new Uint32Array(n);
    const squares = new Uint16Array(n * per);
    for (let k = 0; k < n; k++) {
      const at = s.u16();
      if (at >= chunks.length || (k > 0 && chunks[at]! <= held[k - 1]!)) throw new Error("map: its water's chunks are off its square or out of order");
      held[k] = chunks[at]!;
      const b = s.take(per * 2);
      for (let q = 0; q < per; q++) squares[k * per + q] = b[q * 2]! | (b[q * 2 + 1]! << 8);
    }
    water = { chunks: held, squares };
  }
  return { kind: "overview", sq, heights, tint, low, high, pictures, out, water };
}

function readGround(head: MapHead, sq: Square, s: In): GroundPiece {
  const [w, d] = [(sq.cx1 - sq.cx0) * CHUNK_SAMPLES + 1, (sq.cz1 - sq.cz0) * CHUNK_SAMPLES + 1];
  const heights = getGrid(s, w, d);
  const tint = s.take(w * d).slice();
  const chunks = (sq.cx1 - sq.cx0) * (sq.cz1 - sq.cz0);
  const listed = head.layers.map((rule) => {
    if (rule.type !== 1) return null;
    const count = new Uint16Array(chunks);
    const rows: number[][] = [[], [], [], [], []];
    for (let k = 0; k < chunks; k++) {
      count[k] = s.u16();
      for (let r = 0; r < count[k]!; r++) {
        rows[0]!.push(s.u8());
        for (let c = 1; c < 4; c++) rows[c]!.push(s.u16());
      }
    }
    return { count, kind: Uint8Array.from(rows[0]!), x: Uint16Array.from(rows[1]!), z: Uint16Array.from(rows[2]!), yaw: Uint16Array.from(rows[3]!) };
  });
  return { kind: "ground", sq, heights, tint, listed };
}

function* readStatics(head: MapHead, sq: Square, s: In): Generator<void, StaticsPiece> {
  const n = s.u32();
  const b = s.take(n * STAT_ROW);
  const [id, yaw, chunk] = [new Uint16Array(n), new Uint16Array(n), new Uint32Array(n)];
  const [xs, ys, zs] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const unzig = (z: number): number => (z >>> 1) ^ -(z & 1);
  const three = (column: number, i: number): number => unzig(b[column * n + i]! | (b[(column + 1) * n + i]! << 8) | (b[(column + 2) * n + i]! << 16));
  const { dims } = head;
  const [x0, z0] = [sq.ox * CHUNK_SIZE * STRUCT_UNITS, sq.oz * CHUNK_SIZE * STRUCT_UNITS];
  const [wide, deep] = [dims.chunksX * CHUNK_SIZE * STRUCT_UNITS, dims.chunksZ * CHUNK_SIZE * STRUCT_UNITS];
  const off = (kind: number, x: number, y: number, z: number, what: string): Error => new Error(`map: a ${head.kinds[kind]} at ${x / STRUCT_UNITS}, ${y / STRUCT_UNITS}, ${z / STRUCT_UNITS} is off ${what}`);
  let [x, y, z, turn] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    id[i] = b[i]! | (b[n + i]! << 8);
    if (id[i]! >= head.kinds.length) throw new Error("map: a static piece is of a kind its table does not name");
    yaw[i] = turn = (turn + (b[2 * n + i]! | (b[3 * n + i]! << 8))) & 0xffff;
    x = (x + three(4, i)) & 0xffffff;
    y = ((y + three(7, i)) << 8) >> 8;
    z = (z + three(10, i)) & 0xffffff;
    const [ax, az] = [x0 + x, z0 + z];
    if (ax < 0 || ax > wide || az < 0 || az > deep || y < WORLD_MIN_Y * STRUCT_UNITS || y > WORLD_MAX_Y * STRUCT_UNITS) throw off(id[i]!, ax, y, az, "the map");
    xs[i] = ax / STRUCT_UNITS;
    ys[i] = y / STRUCT_UNITS;
    zs[i] = az / STRUCT_UNITS;
    const c = (chunk[i] = chunkAt(dims, xs[i]!, zs[i]!));
    const [cx, cz] = [chunkCx(dims, c), chunkCz(dims, c)];
    if (cx < sq.cx0 || cx >= sq.cx1 || cz < sq.cz0 || cz >= sq.cz1) throw off(id[i]!, ax, y, az, `its sector ${sq.col}, ${sq.row}`);
    if (i % SLICE === SLICE - 1) yield;
  }
  return { kind: "statics", sq, id, yaw, x: xs, y: ys, z: zs, chunk };
}

/** Sets a sector's ground into the map's heights and tint, row by row from z = 0. An empty tint, as a server's, is left so. */
export function setGround(dims: MapDims, heights: Uint16Array, tint: Uint8Array, piece: GroundPiece): void {
  const { sq } = piece;
  const nx = dims.chunksX * CHUNK_SAMPLES + 1;
  const w = (sq.cx1 - sq.cx0) * CHUNK_SAMPLES + 1;
  for (let j = 0; j < piece.heights.length / w; j++) {
    const at = (sq.cz0 * CHUNK_SAMPLES + j) * nx + sq.cx0 * CHUNK_SAMPLES;
    heights.set(piece.heights.subarray(j * w, j * w + w), at);
    if (tint.length > 0) tint.set(piece.tint.subarray(j * w, j * w + w), at);
  }
}

/** Sets an overview's pictures and slots taken out into the map's node layers, as `blankLayers` made them. */
export function setNodes(dims: MapDims, layers: readonly NodeLayer[], piece: OverviewPiece): void {
  const chunks = chunksOf(dims, piece.sq);
  layers.forEach((layer, k) => {
    const picture = piece.pictures[k];
    if ("first" in layer) return;
    if (picture && "zone" in layer) {
      const p = pictureOf(dims, piece.sq, layer.zoneCell);
      for (let j = 0; j < p.d; j++) layer.zone.set(picture.subarray(j * p.w, j * p.w + p.w), (p.j0 + j) * p.across + p.i0);
    } else if (picture && !("zone" in layer) && layer.allow) {
      const p = pictureOf(dims, piece.sq, layer.allowCell);
      for (let j = 0; j < p.d; j++) copyBits(picture, j * p.w, layer.allow, (p.j0 + j) * p.across + p.i0, p.w);
    }
    const out = piece.out[k];
    if (out && layer.out) chunks.forEach((c, i) => copyBits(out, i * layer.perChunk, layer.out!, c * layer.perChunk, layer.perChunk));
  });
}

/** The node layers a head names, their pictures and slots taken out blank for the overviews to be set into, and a listed one's rows none. */
export function blankLayers(head: MapHead): NodeLayer[] {
  const { dims } = head;
  const squares = (cell: number): number => ((dims.chunksX * CHUNK_SIZE) / cell) * ((dims.chunksZ * CHUNK_SIZE) / cell);
  const layers: NodeLayer[] = [];
  let picture: Uint8Array | null = null;
  for (const rule of head.layers) {
    const out = rule.type !== 1 && rule.out ? { out: new Uint8Array(outBytes(dims, rule.perChunk)) } : {};
    if (rule.type === 1) layers.push({ kinds: rule.kinds, first: new Uint32Array(chunkCount(dims) + 1), kind: new Uint8Array(0), x: new Uint16Array(0), z: new Uint16Array(0), yaw: new Uint16Array(0) });
    else if (rule.type === 0) layers.push({ seed: rule.seed, perChunk: rule.perChunk, kinds: rule.kinds, allowCell: rule.allowCell, allow: rule.allowCell > 0 ? new Uint8Array(Math.ceil(squares(rule.allowCell) / 8)) : null, ...out });
    else {
      if (rule.shared && picture?.length !== squares(rule.zoneCell)) throw new Error("map: zoned nodes share a picture of zones no layer before them has");
      const zone: Uint8Array = rule.shared ? picture! : new Uint8Array(squares(rule.zoneCell));
      picture = zone;
      layers.push({ seed: rule.seed, perChunk: rule.perChunk, zones: rule.zones, zoneCell: rule.zoneCell, zone, ...(rule.codes ? { codes: rule.codes } : {}), ...out });
    }
  }
  return layers;
}

/** A listed layer's rows from the sectors' grounds, chunk by chunk. */
function listedOf(dims: MapDims, kinds: readonly string[], k: number, grounds: readonly GroundPiece[]): NodeList {
  const chunks = chunkCount(dims);
  const first = new Uint32Array(chunks + 1);
  for (const g of grounds) chunksOf(dims, g.sq).forEach((c, i) => (first[c + 1] = g.listed[k]!.count[i]!));
  for (let c = 0; c < chunks; c++) first[c + 1]! += first[c]!;
  const n = first[chunks]!;
  const list = { kinds, first, kind: new Uint8Array(n), x: new Uint16Array(n), z: new Uint16Array(n), yaw: new Uint16Array(n) };
  for (const g of grounds) {
    const rows = g.listed[k]!;
    let r = 0;
    chunksOf(dims, g.sq).forEach((c, i) => {
      for (let e = 0; e < rows.count[i]!; e++, r++) {
        const at = first[c]! + e;
        [list.kind[at], list.x[at], list.z[at], list.yaw[at]] = [rows.kind[r]!, rows.x[r]!, rows.z[r]!, rows.yaw[r]!];
      }
    });
  }
  return list;
}

/**
 * Sets a sector's statics into the rows of its chunks in `t`, whose `first` was laid out with it (joinStatics), slot s of a
 * chunk its s-th piece. With the map's order kept, `from` is the place of its first piece in that order.
 */
export function* setStatics(dims: MapDims, t: MapStatics, piece: StaticsPiece, from = 0): Generator<void, void> {
  const { sq } = piece;
  const w = sq.cx1 - sq.cx0;
  const filled = new Uint32Array(w * (sq.cz1 - sq.cz0));
  for (let i = 0; i < piece.id.length; i++) {
    const c = piece.chunk[i]!;
    const r = t.first[c]! + filled[(chunkCz(dims, c) - sq.cz0) * w + chunkCx(dims, c) - sq.cx0]!++;
    if (r >= t.first[c + 1]!) throw new Error(`map: the statics of sector ${sq.col}, ${sq.row} do not fit the rows laid out for them`);
    t.kind[r] = piece.id[i]!;
    t.yaw[r] = piece.yaw[i]!;
    t.x[r] = piece.x[i]!;
    t.y[r] = piece.y[i]!;
    t.z[r] = piece.z[i]!;
    if (t.row.length > 0) t.row[from + i] = r;
    if (i % SLICE === SLICE - 1) yield;
  }
}

/**
 * The statics of a map from its sectors' pieces, given in the order of its head's table, a sector or a slice of one at a
 * time: each chunk's rows laid out from the pieces' counts, then each piece set in. Without `order` the map's order is not
 * kept.
 */
export function* joinStatics(head: MapHead, pieces: readonly StaticsPiece[], order = true): Generator<void, MapStatics> {
  const chunks = chunkCount(head.dims);
  const t = MapStatics.blank(head.kinds, chunks, pieces.reduce((n, p) => n + p.id.length, 0), order);
  for (const p of pieces) for (const c of p.chunk) t.first[c + 1]!++;
  for (let c = 0; c < chunks; c++) t.first[c + 1]! += t.first[c]!;
  let from = 0;
  for (const p of pieces) {
    yield* setStatics(head.dims, t, p, from);
    from += p.id.length;
    yield;
  }
  return t;
}

/**
 * The map its head and `pieces` make, set into whole arrays as a Heightfield and a node field hold them. Pieces of every
 * overview and every sector's ground make all of it but its statics, which come of the statics pieces among them, in the
 * head's order: without them it is the map with none, which a client draws from while they come.
 */
export function joinParts(head: MapHead, pieces: readonly MapPiece[], order = true): MapFile {
  const { dims } = head;
  const n = (dims.chunksX * CHUNK_SAMPLES + 1) * (dims.chunksZ * CHUNK_SAMPLES + 1);
  const [heights, tint] = [new Uint16Array(n), new Uint8Array(n)];
  const nodes = blankLayers(head);
  const grounds: GroundPiece[] = [];
  const statics: StaticsPiece[] = [];
  const water: { chunks: Uint32Array; squares: Uint16Array }[] = [];
  let defs: readonly Def[] = [];
  for (const p of pieces) {
    if (p.kind === "land") defs = p.defs;
    else if (p.kind === "overview") {
      setNodes(dims, nodes, p);
      if (p.water) water.push(p.water);
    } else if (p.kind === "ground") {
      setGround(dims, heights, tint, p);
      grounds.push(p);
    } else statics.push(p);
  }
  head.layers.forEach((rule, k) => rule.type === 1 && (nodes[k] = listedOf(dims, rule.kinds, k, grounds)));
  let mapWater: MapWater | null = null;
  if (head.water) {
    const per = (CHUNK_SIZE / head.water.cell) ** 2;
    const held = water.flatMap((w) => [...w.chunks].map((c, k) => [c, w.squares.subarray(k * per, k * per + per)] as const)).sort((a, b) => a[0] - b[0]);
    const squares = new Uint16Array(held.length * per);
    held.forEach(([, s], k) => squares.set(s, k * per));
    mapWater = new MapWater(dims, head.minY, head.stepY, head.water.cell, head.water.bodies, Uint32Array.from(held, ([c]) => c), squares);
  }
  const content = head.landmarks ? { content: { landmarks: head.landmarks, defs } } : {};
  const { id, minY, stepY, seaLevel, spawns, regions, vehicles, hash } = head;
  return { id, dims, minY, stepY, seaLevel, heights, tint, statics: finish(joinStatics(head, statics, order)), nodes, spawns, ...(regions.length > 0 ? { regions } : {}), ...(vehicles.length > 0 ? { vehicles } : {}), ...(mapWater ? { water: mapWater } : {}), ...content, hash };
}

/**
 * The map in a file: its head and every part read and joined. Throws with a reason if the file is not a map this build can
 * play on; a part that is damaged is named. Without `verify` its hashes are taken on trust.
 */
export function parseMap(file: Uint8Array, verify = true): MapFile {
  const head = readHead(file, verify);
  const end = head.parts.reduce((at, p) => Math.max(at, p.at + p.length), head.bytes);
  if (file.length < end) throw new Error("map: it is cut short");
  if (file.length > end) throw new Error("map: it runs on past its last part");
  const map = joinParts(head, head.parts.map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length), verify)));
  check(map);
  return map;
}

/** The head and each part of a map's file, with its file's name: what a server serves and a build writes beside the map. */
export function partsOf<B extends ArrayBufferLike>(file: Uint8Array<B>): { name: string; part: MapPart | null; bytes: Uint8Array<B> }[] {
  const head = readHead(file, false);
  return [{ name: head.name, part: null, bytes: file.subarray(0, head.bytes) }, ...head.parts.map((p) => ({ name: p.name, part: p, bytes: file.subarray(p.at, p.at + p.length) }))];
}
export function mapHeightfield(map: MapData): Heightfield {
  const hf = new Heightfield(map.dims, TERRAIN_CELL, map.minY, map.stepY, map.heights, map.tint);
  hf.seaLevel = map.seaLevel;
  hf.water = map.water ?? null;
  return hf;
}

/** Content indices repeated for weight, with 0 for each share of bare ground. A kind this content lacks is left out, and the rest share its slots. */
function weighed(reg: Registry, kinds: readonly (readonly [id: string, weight: number])[], bare = 0): number[] {
  const out: number[] = [];
  for (const [id, weight] of kinds) {
    const k = reg.index.get(id);
    if (k !== undefined) for (let i = 0; i < weight; i++) out.push(k);
  }
  for (let i = 0; i < bare; i++) out.push(0);
  return out;
}

function layerSource(dims: MapDims, hf: Heightfield, reg: Registry, layer: NodeLayer): NodeSource {
  const source = sourceOf(dims, hf, reg, layer);
  const out = "first" in layer ? null : layer.out;
  if (!out) return source;
  const per = source.perChunk;
  return {
    perChunk: per,
    at(chunk, index, spot) {
      const bit = chunk * per + index;
      if ((out[bit >> 3]! >> (bit & 7)) & 1) spot.kind = 0;
      else source.at(chunk, index, spot);
    },
  };
}

function sourceOf(dims: MapDims, hf: Heightfield, reg: Registry, layer: NodeLayer): NodeSource {
  const forms = nodeForms(reg);
  const wide = (cell: number): number => (dims.chunksX * CHUNK_SIZE) / cell;
  if ("zone" in layer) {
    const own: (readonly number[] | null)[] = [null, ...layer.zones.map((z) => weighed(reg, z.kinds, z.bare))];
    const zones = layer.codes ? Array.from(layer.codes, (c) => own[c]!) : own;
    const { zone, zoneCell: cell } = layer;
    const across = wide(cell);
    return scatterNodes(dims, hf, layer.seed, layer.perChunk, forms, (x, z) => zones[zone[Math.floor(z / cell) * across + Math.floor(x / cell)]!]!);
  }
  if (!("first" in layer)) {
    const kinds = weighed(reg, layer.kinds);
    const { allow, allowCell: cell } = layer;
    if (!allow) return scatterNodes(dims, hf, layer.seed, layer.perChunk, forms, () => kinds);
    const across = wide(cell);
    return scatterNodes(dims, hf, layer.seed, layer.perChunk, forms, (x, z) => {
      const bit = Math.floor(z / cell) * across + Math.floor(x / cell);
      return ((allow[bit >> 3]! >> (bit & 7)) & 1) === 1 ? kinds : null;
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
      // A listed node's variant and size come from its chunk's frame key, its slot and its place, as a scattered one's do.
      out.form = formOf(forms, kind, mix(frameKey(dims, chunk) * 256 + index, layer.x[row]! | (layer.z[row]! << 16), layer.yaw[row]!));
      out.x = chunkCx(dims, chunk) * CHUNK_SIZE + layer.x[row]! / NODE_UNITS;
      out.z = chunkCz(dims, chunk) * CHUNK_SIZE + layer.z[row]! / NODE_UNITS;
      out.y = hf.heightAt(out.x, out.z);
      out.yaw = layer.yaw[row]!;
    },
  };
}

/** The nodes of `layers` on `hf`, their slots in a chunk one layer's after another's, or null if there are none. */
export function nodeLayers(dims: MapDims, hf: Heightfield, reg: Registry, layers: readonly NodeLayer[]): NodeSource | null {
  const sources = layers.map((layer) => layerSource(dims, hf, reg, layer));
  if (sources.length < 2) return sources[0] ?? null;
  return {
    perChunk: sources.reduce((sum, l) => sum + l.perChunk, 0),
    at(chunk, index, out) {
      out.kind = 0;
      for (const l of sources) {
        if (index < l.perChunk) return l.at(chunk, index, out);
        index -= l.perChunk;
      }
    },
  };
}

/** The map's resource nodes for `hf`, which is its ground, or null if it has none. The server and every client call this. */
export function mapNodes(map: MapData, hf: Heightfield, reg: Registry): NodeSource | null {
  return nodeLayers(map.dims, hf, reg, map.nodes);
}

/** Each of the table's kinds as a content index, 0 for one this content lacks. */
export function staticKinds(statics: MapStatics, reg: Registry): Uint16Array {
  return Uint16Array.from(statics.kinds, (id) => reg.index.get(id) ?? 0);
}

/**
 * Sets the map's statics down in the map's order, so that slot s of a chunk holds the s-th static of that chunk in the map's
 * order (MapStatics row first[chunk] + s), with no owner and its kind's most health (Registry.maxHp).
 */
export function placeStatics(map: MapData, structs: StructureStore, reg: Registry): void {
  const statics = MapStatics.of(map.dims, map.statics);
  const kinds = staticKinds(statics, reg);
  kinds.forEach((k, i) => {
    if (k === 0) throw new Error(`map "${map.id}" needs content "${statics.kinds[i]}"`);
  });
  structs.placeMap(statics, kinds, reg.maxHp);
}
