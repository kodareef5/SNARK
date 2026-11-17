// A map as one file: its ground, its static pieces, its resource nodes and where survivors arrive. The server loads it and
// serves it, and each client fetches it, so both stand on the same bytes. Little-endian:
//
//   0   "SNMP"
//   4   u16 version 5, u16 reserved
//   8   u32 hash        FNV-1a of every byte after it
//   12  u32 ground      bytes before the STAT section, which is last: all a client needs to draw. The whole file if none.
//   16  u16 chunksX, u16 chunksZ
//   20  f32 cell        metres between samples, which is 2
//   24  f64 minY, f64 stepY, f64 seaLevel
//                       a height is minY + sample * stepY metres; a sea level of -Infinity is no sea
//   48  string id
//   ..  sections, each a 4-byte tag, a u32 byte length and its bytes. A tag this build does not know is skipped.
//
//   HGTS  per sample, row by row from z = 0, the sample less (left + above - above left) as an i16, zigzagged (0, -1, 1, -2
//         ...): every sample's low byte, then every sample's high byte
//   TINT  u8 per sample, a palette index. Without it every sample is 0.
//   NODE  one layer of resource nodes. A file may hold several, and a chunk's slots are the first layer's, then the next's.
//         u8 0, scattered by a hash (shared/world/nodes.ts): u32 seed, u16 slots a chunk, u8 count of kinds, each a
//               u8 weight and a content id, then u8 metres a bit and a bit per square, row by row from z = 0, lowest bit
//               first, set where a node may stand. 0 metres has no bits: a node may stand anywhere. Then the slots taken
//               out: u8 0 for none, or u8 1 and a bit per slot, chunk by chunk, lowest bit first, set where none stands.
//         u8 1, listed: u8 count of kinds, each a content id, then for each chunk a u16 count and 7-byte rows:
//               u8 kind, u16 x, u16 z in 1/1024 m from the chunk's corner, u16 yaw
//         u8 2, zoned, scattered as by 0: u32 seed, u16 slots a chunk, u8 count of zones, each a u8 weight of bare ground,
//               a u8 count of kinds and each a u8 weight and a content id, then u8 metres a square, a u8 count of codes and
//               that many bytes, and u8 1 to take the picture of the zoned layer before, or 0 and a byte per square, row by
//               row from z = 0: the number of its zone counting from 1, or 0 where nothing grows; with codes, a value of
//               a picture the zoned layers share, whose zone in this layer is its code. Then the slots taken out, as by 0.
//   SPWN  u8 count, then each a string name, i32 x, i32 z in 1/512 m, u16 yaw. The first is where a new survivor arrives.
//   WILD  where wild creatures live: u16 count, then each a string spawns id, u16 count it holds at 1x, u8 shape (0 a circle,
//         1 a box), i32 x, i32 z, u32 radius or half width, u32 half depth, in 1/512 m.
//   VHCL  vehicles parked in a new world: u16 count and that many content ids, a u32 count, then 12-byte rows:
//         u16 id, u16 yaw, i32 x, z in 1/512 m. Each stands on the ground under it.
//   VHCX  what a parked vehicle has beyond its VHCL row (found aircraft and boats): u8 version 1, a u32 count, then each a
//         u32 row index and a u8 of bits, and what they name in this order: 1 a stable string id, 2 an f64 height it
//         stands at (a roof, a berth), 4 and 8 two f64 fractions each, the range its condition and its fuel are rolled in.
//   WATR  water standing on its own surfaces (shared/world/water.ts): u8 metres a square (1, 2, 4, 8, 16, 32 or 64), u16
//         count of bodies, each a string name and a u16 surface in the heights' units, then a u32 count of the chunks
//         holding water, each a u32 chunk index, ascending, and its squares as u16, row by row from z = 0: the number of
//         its body counting from 1, or 0 for the sea's.
//   LAND  what the map adds to the content: u8 count of its landmarks and each a name, whose files a client fetches
//         (assets/landmarks/<name>.json), then f64 x, y, z of its origin and u16 yaw as it was placed; then a u32 byte
//         length and that many bytes of UTF-8 JSON, the definitions they add, compiled after the core's. Before STAT, so
//         a client has them before it says hello.
//   STAT  u16 count and that many content ids, a u32 count n, then columns of n in the map's order, each as byte planes
//         (every value's low byte, then the next): u16 id; u16 yaw less the piece before's, modulo 65,536; and x, y, z in
//         1/512 m as zigzagged differences from the piece before's modulo 2^24, in 3 bytes (the first's from 0).
//
// A string is a varint byte length and UTF-8, as on the wire. A yaw is in 1/65,536 turns.

import type { Def, MapZone } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, MAX_CHUNKS_PER_AXIS, STRUCT_UNITS, WORLD_MAX_Y, WORLD_MIN_Y, chunkAt, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import { hashBytes } from "../hash.ts";
import { decodeUtf8 } from "../pack/pack.ts";
import { BitReader, BitWriter } from "../net/codec.ts";
import { Heightfield, TERRAIN_CELL } from "./heightfield.ts";
import { formOf, mix, nodeForms, scatterNodes, type NodeSource } from "./nodes.ts";
import type { StructureStore } from "./structures.ts";
import { MAX_WATER_BODIES, MapWater } from "./water.ts";

export const MAP_VERSION = 5;
const MAGIC = 0x504d4e53;
const HEADER_BYTES = 48;
/** Where the header says how many bytes come before the statics. */
const GROUND_AT = 12;
/** A static's bytes in STAT's columns: id, yaw, x, y, z. */
const STAT_ROW = 2 + 2 + 3 + 3 + 3;
/** Statics read between yields when read a step at a time: about a millisecond's work here, a few on a phone. */
const SLICE = 1 << 15;

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
    const n = h.length;
    const nx = (m.dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1;
    const at = o.take(n * 2);
    const b = o.bytes;
    for (let k = 0; k < n; k++) {
      const left = k % nx > 0 ? h[k - 1]! : 0;
      const above = k >= nx ? h[k - nx]! : 0;
      const corner = k % nx > 0 && k >= nx ? h[k - nx - 1]! : 0;
      const r = ((h[k]! - (left + above - corner)) << 16) >> 16;
      const z = (r << 1) ^ (r >> 31);
      b[at + k] = z;
      b[at + n + k] = z >> 8;
    }
  });
  section("TINT", () => o.put(m.tint));
  const slotsOut = (layer: NodeScatter | NodeZoned): void => {
    o.u8(layer.out ? 1 : 0);
    if (layer.out) o.put(layer.out);
  };
  let picture: Uint8Array | null = null;
  for (const layer of shareZones(m.nodes)) {
    section("NODE", () => {
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
        if (layer.zone !== picture) o.put(layer.zone);
        picture = layer.zone;
        slotsOut(layer);
        return;
      }
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
      slotsOut(layer);
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
  const vehicles = m.vehicles ?? [];
  if (vehicles.length > 0) {
    section("VHCL", () => {
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
    if (extended.length > 0) section("VHCX", () => {
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
    section("WATR", () => {
      o.u8(w.cell);
      o.u16(w.bodies.length);
      for (const b of w.bodies) {
        o.text(b.name);
        o.u16(b.level);
      }
      const chunks = w.chunks();
      const per = w.side * w.side;
      o.u32(chunks.length);
      for (const c of chunks) {
        o.u32(c);
        const at = o.take(per * 2);
        const from = w.block[c]!;
        for (let q = 0; q < per; q++) o.view.setUint16(at + q * 2, w.squares[from + q]!, true);
      }
    });
  }
  const land = m.content;
  if (land && land.landmarks.length + land.defs.length > 0) {
    section("LAND", () => {
      o.u8(land.landmarks.length);
      for (const l of land.landmarks) {
        o.text(l.name);
        o.f64(l.x);
        o.f64(l.y);
        o.f64(l.z);
        o.u16(l.yaw);
      }
      // Written as ASCII, every other character escaped, which UTF-8 reads as it is.
      const json = JSON.stringify(land.defs).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      o.u32(json.length);
      const at = o.take(json.length);
      for (let i = 0; i < json.length; i++) o.bytes[at + i] = json.charCodeAt(i);
    });
  }
  const ground = o.at;
  if (m.statics.length > 0) {
    section("STAT", () => {
      const ids = new Map<string, number>();
      eachStatic(m.statics, (kind) => {
        if (!ids.has(kind)) ids.set(kind, ids.size);
      });
      o.u16(ids.size);
      for (const id of ids.keys()) o.text(id);
      const n = m.statics.length;
      o.u32(n);
      const at = o.take(n * STAT_ROW);
      const b = o.bytes;
      const plane = (column: number, i: number, v: number, bytes: number): void => {
        for (let k = 0; k < bytes; k++) b[at + (column + k) * n + i] = v >>> (8 * k);
      };
      // A difference is taken modulo 2^24, which the reader undoes: a map's widest is 2^23 units.
      const zigzag = (d: number): number => (d = (d << 8) >> 8, (d << 1) ^ (d >> 31));
      let i = 0;
      let [px, py, pz, pyaw] = [0, 0, 0, 0];
      eachStatic(m.statics, (kind, x, y, z, yaw) => {
        const [ux, uy, uz] = [Math.round(x * STRUCT_UNITS), Math.round(y * STRUCT_UNITS), Math.round(z * STRUCT_UNITS)];
        plane(0, i, ids.get(kind)!, 2);
        plane(2, i, yaw - pyaw, 2);
        plane(4, i, zigzag(ux - px), 3);
        plane(7, i, zigzag(uy - py), 3);
        plane(10, i, zigzag(uz - pz), 3);
        [px, py, pz, pyaw] = [ux, uy, uz, yaw];
        i++;
      });
    });
  }
  const file = o.bytes.slice(0, o.at);
  const view = new DataView(file.buffer);
  view.setUint32(GROUND_AT, ground, true);
  view.setUint32(8, hashBytes(file.subarray(12)), true);
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

/** `picture` is the zone picture of the zoned layer read before this one, which this one may share. */
function readNodes(r: In, dims: MapDims, picture: Uint8Array | null): NodeLayer {
  const type = r.u8();
  const squares = (cell: number): number => {
    if (!(cell >= 1 && cell <= CHUNK_SIZE && CHUNK_SIZE % cell === 0)) throw new Error(`map: nodes are placed by squares of ${cell} m, and a square is 1, 2, 4, 8, 16, 32 or 64 m`);
    return ((dims.chunksX * CHUNK_SIZE) / cell) * ((dims.chunksZ * CHUNK_SIZE) / cell);
  };
  const out = (perChunk: number): { out?: Uint8Array } => (r.u8() === 1 ? { out: r.take(outBytes(dims, perChunk)).slice() } : {});
  if (type === 2) {
    const seed = r.u32();
    const perChunk = r.u16();
    const zones = Array.from({ length: r.u8() }, (): NodeZone => {
      const bare = r.u8();
      const kinds = Array.from({ length: r.u8() }, (): [string, number] => {
        const weight = r.u8();
        return [r.text(), weight];
      });
      return { bare, kinds };
    });
    const zoneCell = r.u8();
    const codes = r.u8();
    const coded = codes > 0 ? { codes: r.take(codes).slice() } : {};
    const shared = r.u8() === 1;
    if (shared && picture?.length !== squares(zoneCell)) throw new Error("map: zoned nodes share a picture of zones no layer before them has");
    const zone = shared ? picture! : r.take(squares(zoneCell)).slice();
    return { seed, perChunk, zones, zoneCell, zone, ...coded, ...out(perChunk) };
  }
  if (type > 2) throw new Error(`map: nodes of type ${type} are not ones this build reads`);
  if (type === 0) {
    const seed = r.u32();
    const perChunk = r.u16();
    const kinds = Array.from({ length: r.u8() }, (): [string, number] => {
      const weight = r.u8();
      return [r.text(), weight];
    });
    const allowCell = r.u8();
    const allow = allowCell === 0 ? null : r.take(Math.ceil(squares(allowCell) / 8)).slice();
    return { seed, perChunk, kinds, allowCell, allow, ...out(perChunk) };
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

function* readStatics(s: In, dims: MapDims, order = true): Generator<void, MapStatics> {
  const ids = Array.from({ length: s.u16() }, () => s.text());
  const n = s.u32();
  const b = s.take(n * STAT_ROW);
  const [kind, yaw] = [new Uint16Array(n), new Uint16Array(n)];
  const [xs, ys, zs] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const unzig = (z: number): number => (z >>> 1) ^ -(z & 1);
  const three = (column: number, i: number): number => unzig(b[column * n + i]! | (b[(column + 1) * n + i]! << 8) | (b[(column + 2) * n + i]! << 16));
  const [wide, deep] = [dims.chunksX * CHUNK_SIZE * STRUCT_UNITS, dims.chunksZ * CHUNK_SIZE * STRUCT_UNITS];
  let [x, y, z, turn] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    kind[i] = b[i]! | (b[n + i]! << 8);
    if (kind[i]! >= ids.length) throw new Error("map: a static piece is of a kind its table does not name");
    yaw[i] = turn = (turn + (b[2 * n + i]! | (b[3 * n + i]! << 8))) & 0xffff;
    x = (x + three(4, i)) & 0xffffff;
    y = ((y + three(7, i)) << 8) >> 8;
    z = (z + three(10, i)) & 0xffffff;
    if (x > wide || z > deep || y < WORLD_MIN_Y * STRUCT_UNITS || y > WORLD_MAX_Y * STRUCT_UNITS) throw new Error(`map: a ${ids[kind[i]!]} at ${x / STRUCT_UNITS}, ${y / STRUCT_UNITS}, ${z / STRUCT_UNITS} is off the map`);
    xs[i] = x / STRUCT_UNITS;
    ys[i] = y / STRUCT_UNITS;
    zs[i] = z / STRUCT_UNITS;
    if (i % SLICE === SLICE - 1) yield;
  }
  return yield* MapStatics.group(dims, ids, kind, yaw, xs, ys, zs, order);
}

function read(r: In): Omit<MapFile, "hash"> {
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
  let statics: MapStatics | null = null;
  const nodes: NodeLayer[] = [];
  const spawns: MapSpawn[] = [];
  const regions: MapZone[] = [];
  const vehicles: MapVehicle[] = [];
  const vehicleExtras = new Map<number, Partial<MapVehicle>>();
  let water: MapWater | null = null;
  let content: MapContent | null = null;
  while (r.at < r.bytes.length) {
    const tag = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
    const s = new In(r.take(r.u32()));
    if (tag === "HGTS") {
      const nx = (dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1;
      const n = s.bytes.length >> 1;
      const b = s.bytes;
      const h = (heights = new Uint16Array(n));
      for (let k = 0; k < n; k++) {
        const left = k % nx > 0 ? h[k - 1]! : 0;
        const above = k >= nx ? h[k - nx]! : 0;
        const corner = k % nx > 0 && k >= nx ? h[k - nx - 1]! : 0;
        const z = b[k]! | (b[n + k]! << 8);
        h[k] = ((z >>> 1) ^ -(z & 1)) + left + above - corner;
      }
    } else if (tag === "TINT") {
      // Copied, as the nodes' bytes are: a view would keep the whole file, statics and all, for as long as the map is held.
      tint = s.bytes.slice();
    } else if (tag === "STAT") {
      if (statics) throw new Error("map: it has two STAT sections");
      statics = finish(readStatics(s, dims));
    } else if (tag === "NODE") nodes.push(readNodes(s, dims, nodes.findLast((l): l is NodeZoned => "zone" in l)?.zone ?? null));
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
      if (content) throw new Error("map: it has two LAND sections");
      const landmarks = Array.from({ length: s.u8() }, (): MapLandmark => ({ name: s.text(), x: s.f64(), y: s.f64(), z: s.f64(), yaw: s.u16() }));
      content = { landmarks, defs: JSON.parse(decodeUtf8(s.take(s.u32()))) as Def[] };
    } else if (tag === "WATR") {
      if (water) throw new Error("map: it has two WATR sections");
      const cell = s.u8();
      if (!(cell >= 1 && cell <= CHUNK_SIZE && CHUNK_SIZE % cell === 0)) throw new Error(`map: its water is in squares of ${cell} m, and a square is 1, 2, 4, 8, 16, 32 or 64 m`);
      const bodies = Array.from({ length: s.u16() }, () => ({ name: s.text(), level: s.u16() }));
      const per = (CHUNK_SIZE / cell) * (CHUNK_SIZE / cell);
      const n = s.u32();
      if (n > chunkCount(dims) || n * (4 + per * 2) > s.bytes.length - s.at) throw new RangeError();
      const chunks = new Uint32Array(n);
      const squares = new Uint16Array(n * per);
      for (let k = 0; k < n; k++) {
        chunks[k] = s.u32();
        if (chunks[k]! >= chunkCount(dims) || (k > 0 && chunks[k]! <= chunks[k - 1]!)) throw new Error("map: its water's chunks are off the map or out of order");
        for (let q = 0; q < per; q++) squares[k * per + q] = s.u16();
      }
      water = new MapWater(dims, minY, stepY, cell, bodies, chunks, squares);
    }
  }
  if (!heights) throw new Error("map: it has no heights");
  for (const [index, extra] of vehicleExtras) {
    if (!vehicles[index]) throw new Error("map: parked vehicle extension names a missing vehicle");
    vehicles[index] = { ...vehicles[index]!, ...extra };
  }
  statics ??= MapStatics.of(dims, []);
  return { id, dims, minY, stepY, seaLevel, heights, tint: tint ?? new Uint8Array(heights.length), statics, nodes, spawns, ...(regions.length > 0 ? { regions } : {}), ...(vehicles.length > 0 ? { vehicles } : {}), ...(water ? { water } : {}), ...(content ? { content } : {}) };
}

/** How many of a file's bytes come before its statics, from its first 16. */
export function groundBytes(head: Uint8Array): number {
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 16 || v.getUint32(0, true) !== MAGIC) throw new Error("map: this is not a map file");
  const version = v.getUint16(4, true);
  if (version !== MAP_VERSION) throw new Error(`map: version ${version} is not one this build reads: build the map again`);
  return v.getUint32(GROUND_AT, true);
}

/** Runs `read`, saying so if a section runs past its end. */
function within<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    throw err instanceof RangeError ? new Error("map: a section runs past its end") : err;
  }
}

/**
 * Throws with a reason if the file is not a map this build can play on. Without `verify` its hash is taken on trust, and
 * its first `groundBytes` alone read as the map with no statics, which a client draws from while they arrive.
 */
export function parseMap(file: Uint8Array, verify = true): MapFile {
  const ground = groundBytes(file);
  if (file.length < HEADER_BYTES || ground > file.length) throw new Error("map: it is cut short");
  const hash = new DataView(file.buffer, file.byteOffset).getUint32(8, true);
  if (verify && hash !== hashBytes(file.subarray(12))) throw new Error("map: the file is damaged: its hash is not that of its bytes");
  const r = new In(file);
  r.at = 16;
  const map = within(() => read(r));
  check(map);
  return { ...map, hash };
}

/**
 * The statics of a file of `dims` from its bytes past `groundBytes`, read apart from the rest a slice at a time: a client
 * takes a step between frames, so a city's million pieces come in without a hitch.
 */
export function* staticsSteps(rest: Uint8Array, dims: MapDims, order = true): Generator<void, MapStatics> {
  if (rest.length === 0) return MapStatics.of(dims, []);
  const steps = within(() => {
    const r = new In(rest);
    if (String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8()) !== "STAT") throw new Error("map: what follows its ground is not its statics");
    return readStatics(new In(r.take(r.u32())), dims, order);
  });
  for (;;) {
    const step = within(() => steps.next());
    if (step.done) return step.value;
    yield;
  }
}

export function parseStatics(rest: Uint8Array, dims: MapDims): MapStatics {
  return finish(staticsSteps(rest, dims));
}

/** Where a map's build puts the file at `path` compressed for the wire, `br` or `gz`: beside it, named by its hash. */
export function mapCopy(path: string, hash: number, encoding: "br" | "gz"): string {
  return `${path}.${hash.toString(16).padStart(8, "0")}.${encoding}`;
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
      // A listed node's variant and size come from its place, as a scattered one's do.
      out.form = formOf(forms, kind, mix(chunk * 256 + index, layer.x[row]! | (layer.z[row]! << 16), layer.yaw[row]!));
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
