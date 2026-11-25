// A map as one file: a head and its parts. The server reads the file whole and serves each part as a file of its own, which
// a client fetches by the name the head gives it, so both stand on the same bytes. Little-endian.
//
// The head:
//   0   "SNMP"
//   4   u16 version 14, u16 reserved
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
//               stand anywhere.
//         u8 1, listed: u8 count of kinds, each a content id.
//         u8 2, zoned, scattered as by 0: u32 seed, u16 slots a chunk, u8 count of zones, each a u8 weight of bare ground,
//               a u8 count of kinds and each a u8 weight and a content id, then u8 metres a square, a u8 count of codes and
//               that many bytes, and u8 1 to take the picture of the zoned layer before or 0 for its own. With codes, the
//               picture is one the zoned layers share, and a value's zone in this layer is its code.
//   TEYE  Optional. u8 count, then each a name, f64 x/y/z, u16 yaw, u8 colour and f64 deck radius.
//         An optional trailing u8 form per site distinguishes the newer instruments.
//   ORBS  Optional. u8 count, then each a name, f64 x/y/z, u16 yaw, f64 radius and f64 height of its centre over y.
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
//   COAR  the whole map at every chunk's corner (64 m), which a client draws until each overview comes: (chunksX + 1) by
//         (chunksZ + 1) heights as a grid, then a u8 tint each. A height is the mean of the 64 m square round it, held
//         under the surface of the water most of that square is under, the sea's or a body's, and at or over the sea's
//         where most of it is dry; a tint the square's commonest. Then, where the head has WATR, a u16 each as a grid, the
//         number of the body most of its square is under counting from 1, or 0; and a bit a chunk row by row, lowest bit
//         first, set where the overviews hold its water squares.
//   LAND  what the map adds to the content: u8 count of its landmarks and each a name, whose files a client fetches
//         (assets/landmarks/<name>.json), then f64 x, y, z of its origin and u16 yaw as it was placed. The definitions
//         they add are the land part.
//   STAT  u16 count and that many content ids in the order of their characters, which a sector's statics name by their
//         place here. Then how many statics each of the map's chunks holds, row by row, as u16 planes, so a reader lays out
//         every chunk's rows before any sector's statics come.
//   BLDG  Optional. What its sectors' buildings name by number (shared/world/buildings.ts BuildingNames): u8 version 1, then
//         five tables, each a u8 count and that many strings: kinds, recipes, forms, ways of falling, districts. A map
//         without it has no buildings part and no buildings.
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
//               or 0 where nothing grows; and for either, two planes of a bit a slot, chunk by chunk row by row: set where
//               the node the slot's hash and picture draw does not stand, then set where it stands as its footing's other
//               kind. Whether a node stands is the map's build's to say (resolveNodes), so its place, kind, form and turn
//               need no ground; only its height does. A layer's bits start on a byte. Then, where the head has WATR, a u16
//               count of its chunks holding water, each a u16 index among its chunks row by row, ascending, and its squares
//               as u16s row by row: the number of its body counting from 1, or 0 for the sea's.
//   3 ground    a sector's ground at every sample (2 m), its edges among them, as a grid, then a u8 tint each, then a u8
//               ground class (shared/world/vehicle-surface.ts GROUND_CLASS) each two samples a side, its far edge's cells
//               among them: sample (i, j)'s cell is (i >> 1, j >> 1), 257 a side of a whole sector. Then for each
//               listed layer, for each of its chunks row by row, a u16 count and 7-byte rows: u8 kind, u16 x, u16 z in
//               1/1024 m from the chunk's corner, u16 yaw.
//   4 statics   a sector's statics, where it has some: u32 count n, then columns of n in the map's order, each as byte
//               planes (every value's low byte, then the next): u16 kind, its place in STAT; u16 yaw less the piece
//               before's, modulo 65,536; and x, y, z in 1/512 m from the square's corner and the datum, as zigzagged
//               differences from the piece before's modulo 2^24, in 3 bytes (the first's from 0). Slot s of a chunk holds
//               its s-th piece here. Then, where some of its pieces are bent along the street (shared/world/bends.ts), a
//               u32 count of them, how many pieces lie before each one's since the one before it as a varint (its place
//               in the columns' order, ascending), and each one's bend as eight 16-bit numbers (packBend) less what the
//               bend before predicts (bendGuess), modulo 65,536, in planes: every bend's first number's low byte, then
//               its high byte, then the next. A bent piece after a bent piece is coded in the columns against where it
//               would stand were it the next of that one's line (shared/world/bends.ts bentNext), not the piece before's
//               place and turn. The collision pieces under the bent pieces (shared/world/bends.ts madeHits)
//               are not stored but made from them where the part is read, after its own pieces, each in the chunk it
//               stands in; one that stands in another sector is stored there, as a piece of its own. STAT's counts and
//               kinds hold them all.
//   5 tops      the far feed's cells of an overview's square's chunks as the map places its statics, where its maker baked
//               them (mapTops) and some of them are filled: a u16 count of those chunks, each a u16 index among its chunks
//               row by row, ascending; then 256 bytes each, its 4 m cells' tops row by row from its corner (farTopByte in
//               shared/world/tactical.ts, 0 for an empty cell); then 256 each of their palette colours. What a far block is
//               drawn from where a sector's statics are not held. Nothing waits for it; it comes after every other part.
//   6 road      a sector's roads' frame (shared/world/roadframe.ts), where a road runs in it: at its ground classes' cells,
//               a plane a byte each after another: across (0 where no road runs), along, half width and lanes. For
//               drawing alone: a page asks for those its terrain window reaches, and a server reads past them.
//   7 streets   a sector's streets as lines (shared/world/streets.ts encodeStreets), where a street reaches it: each
//               stretch's centre line, its kerbs, verges and walks on both sides, and the corners round its junctions,
//               its places from the square's corner. A page asks for those round its body, for the ground's edges and its
//               own car's grip; a server reads them all, for what a wheel meets at a street's and a walk's edge.
//   8 buildings a sector's buildings (shared/world/buildings.ts SectorBuildings), where a building has a piece in it. u8
//               version 1 and a u16 count n. Then columns of n as byte planes: a 6-byte id; u8 kind, recipe, form, district
//               and way of falling, each its place in BLDG's table; u8 flags (1 a stair climbs in it, 2 one reaches its
//               roof, 4 a place the city names by hand, 8 it has a row in another sector too); u8 storeys, u8 storeys
//               walked, u8 metres a bay; u16 name, u16 address number and u16 street, each a string's number counting from
//               1 or 0 for none; its frame's middle as i32 x and z in 1/512 m from the square's corner, u16 turn, i16 base
//               and u16 width and depth in 1/16 m, u16 tiles across and deep; and a u16 count of stairs. Then every stair,
//               a building's after another's, in planes: u16 tile i, u16 tile j, u8 storeys it climbs, u8 flags (1 an
//               escape). Then a u16 count of strings, a u8 byte length each, and their UTF-8 one after another. Then the
//               runs: a u16 count for each of the square's chunks row by row, and every run, a chunk's after another's and
//               ascending by slot, in planes: u16 first slot, u16 building, u8 first storey, u8 count of storeys; then for
//               each run, each of its storeys' count of slots as a varint. A chunk's statics are in the order building,
//               then storey, then as the maker placed them, so a run is one building's pieces in a chunk and a storey's
//               are next to each other in it. A piece in no run is no building's. Before the tops.
//
// A part's file is `<kind>.<column>-<row>.<hash>.part` (partName); the land's and the head's have no square.
// A string is a varint byte length and UTF-8, as on the wire. A yaw is in 1/65,536 turns.

import { EYE_COLORS, EYE_FORMS, type TideEyeSite } from "./tide-eye.ts";
import type { OrbSite } from "./orb.ts";
import type { Def, MapZone } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, FRAME_CHUNKS, MAX_CHUNKS_PER_AXIS, SECTOR_CHUNKS, STRUCT_UNITS, WORLD_MAX_Y, WORLD_MIN_Y, chunkAt, chunkCount, chunkCx, chunkCz, frameKey, framed, type FramedDims, type MapDims } from "../coords.ts";
import { hashBytes } from "../hash.ts";
import { decodeUtf8 } from "../pack/pack.ts";
import { BitReader, BitWriter } from "../net/codec.ts";
import { Heightfield, TERRAIN_CELL } from "./heightfield.ts";
import { formOf, mix, nodeForms, placedNodes, resolveSlots, type KindsAt, type NodeSource, type SlotsTaken } from "./nodes.ts";
import { MAX_SLOTS_PER_CHUNK, StructureStore } from "./structures.ts";
import { FarCells, Summary, TACTICAL_CELL, bakeChunk, pieceShapes } from "./tactical.ts";
import { MAX_WATER_BODIES, MapWater, type WaterBody } from "./water.ts";
import { ROAD_PLANES, RoadSectors, type MapRoad } from "./roadframe.ts";
import { StreetSectors, decodeStreets, type StreetsPart } from "./streets.ts";
import { HIT_PREFIX, bentNext, madeHits, walkedFlush } from "./bends.ts";
import { BUILDINGS_VERSION, Buildings, SectorBuildings, type BuildingNames } from "./buildings.ts";

export const MAP_VERSION = 14;
/** Read too, until the city maps in var/maps are built again: they are 11, which is 14 with no streets part and no bent piece. */
const KEPT_VERSION = 11;
const MAGIC = 0x504d4e53;
const HEADER_BYTES = 56;
/** Chunks a side of an overview's square, 4,096 m. */
export const OVERVIEW_CHUNKS = 64;
/** An overview's ground is every this many samples, 8 m. */
export const OVERVIEW_STEP = 4;
/** Samples along a chunk's side, less its far edge. */
const CHUNK_SAMPLES = CHUNK_SIZE / TERRAIN_CELL;
/** Samples between two of the head's coarse picture (COAR): a chunk's side, 64 m. */
export const COARSE_STEP = CHUNK_SAMPLES;
/** A static's bytes in a statics part's columns: id, yaw, x, y, z. */
const STAT_ROW = 2 + 2 + 3 + 3 + 3;
/** The far feed's cells of a chunk, 4 m each (shared/world/tactical.ts). */
const FAR_CELLS = (CHUNK_SIZE / TACTICAL_CELL) * (CHUNK_SIZE / TACTICAL_CELL);
/** Statics read between yields when read a step at a time: about a millisecond's work here, a few on a phone. */
const SLICE = 1 << 15;
/** A part's kinds, by their number in the file less one. */
const PART_KINDS = ["land", "overview", "ground", "statics", "tops", "road", "streets", "buildings"] as const;
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

/**
 * A piece set down with the world and owned by nobody. `kind` is a content id, and `yaw` is in 1/65,536 turns. A bent
 * piece's `bend` is its eight numbers (shared/world/bends.ts packBend).
 */
export interface MapStatic {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly bend?: ArrayLike<number>;
}

/**
 * What the next bend in a statics part is guessed to be from `bend` (into `guess`): the same, but starting where `bend`
 * ends along its kerb line, as the next piece of a line does (shared/world/bends.ts packBend: the station in cm within
 * 600 m, half the chord in mm).
 */
function bendGuess(guess: Int16Array, bend: ArrayLike<number>): void {
  for (let k = 0; k < 8; k++) guess[k] = bend[k]!;
  guess[3] = ((bend[3]! & 0xffff) + Math.round(bend[0]! / 5)) % 60000;
}

/** A chunk's bent pieces: each one's slot, ascending, and its bend, eight numbers a slot (shared/world/bends.ts). */
export interface ChunkBends {
  readonly slot: Uint16Array;
  readonly bend: Int16Array;
}

/** The bend of slot `slot` among a chunk's, or null. */
export function bendOf(bends: ChunkBends | undefined, slot: number): Int16Array | null {
  if (!bends) return null;
  let lo = 0, hi = bends.slot.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = bends.slot[mid]!;
    if (s === slot) return bends.bend.subarray(mid * 8, mid * 8 + 8);
    if (s < slot) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
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
  /** The bent pieces of each chunk that has some, by chunk. */
  readonly bends: Map<number, ChunkBends>;
  /**
   * Where these are some sectors' rows copied out of the map's statics as a page sets those in a sector at a time
   * (client/core/mapload.ts rowsOf): that table, whose other sectors' rows and bends are set in as each comes. Else null.
   */
  coming: MapStatics | null = null;

  /** With `of`, its columns without the map's order. */
  private constructor(kinds: readonly string[], chunks: number, n: number, order: boolean, of: MapStatics | null = null) {
    this.kinds = kinds;
    this.bends = of ? of.bends : new Map();
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
   * time, with the bends `bend` gives of pieces by their place in that order. Without `order` the map's order is not kept,
   * as a client never reads it.
   */
  static *group(dims: MapDims, kinds: readonly string[], kind: Uint16Array, yaw: Uint16Array, x: Float32Array, y: Float32Array, z: Float32Array, order = true, bend: ReadonlyMap<number, ArrayLike<number>> | null = null): Generator<void, MapStatics> {
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
    if (bend && bend.size > 0) {
      const lists = new Map<number, { slot: number[]; bend: number[] }>();
      for (const i of [...bend.keys()].sort((a, b) => a - b)) {
        const c = chunkAt(dims, x[i]!, z[i]!);
        let l = lists.get(c);
        if (!l) lists.set(c, (l = { slot: [], bend: [] }));
        l.slot.push(row[i]! - first[c]!);
        for (let k = 0; k < 8; k++) l.bend.push(bend.get(i)![k]!);
      }
      // A chunk's rows are in the map's order, so its bent pieces' slots come ascending, as bendOf looks them up.
      for (const [c, l] of lists) t.bends.set(c, { slot: Uint16Array.from(l.slot), bend: Int16Array.from(l.bend) });
    }
    return t;
  }

  /**
   * `statics` as a table: itself if it is one, or a list's pieces with their centres set on the lattice as a file would,
   * and as a file of this version holds them: no collision piece of a bent one in the list is kept, but each bent piece's
   * are made from it (madeOn), after every piece of the list, as a file read whole has them.
   */
  static of(dims: MapDims, statics: MapStatics | readonly MapStatic[]): MapStatics {
    if (statics instanceof MapStatics) return statics;
    const ids = new Map<string, number>();
    const unit = (v: number): number => Math.round(v * STRUCT_UNITS);
    // The collision pieces made, as columns: their kinds' ids, and their places and turns on the lattice.
    const made: number[][] = [[], [], [], [], []];
    let n = 0;
    for (const s of statics) {
      if (s.kind.startsWith(HIT_PREFIX)) continue;
      n++;
      if (!ids.has(s.kind)) ids.set(s.kind, ids.size);
      if (s.bend) madeOn(dims, s.kind, unit(s.x), unit(s.y), unit(s.z), s.yaw, Int16Array.from(s.bend), (kind, x, y, z, yaw) => {
        if (!ids.has(kind)) ids.set(kind, ids.size);
        made[0]!.push(ids.get(kind)!);
        made[1]!.push(x);
        made[2]!.push(y);
        made[3]!.push(z);
        made[4]!.push(yaw);
      });
    }
    const all = n + made[0]!.length;
    const [kind, yaw, x, y, z] = [new Uint16Array(all), new Uint16Array(all), new Float32Array(all), new Float32Array(all), new Float32Array(all)];
    const bend = new Map<number, ArrayLike<number>>();
    let i = 0;
    for (const s of statics) {
      if (s.kind.startsWith(HIT_PREFIX)) continue;
      [kind[i], yaw[i], x[i], y[i], z[i]] = [ids.get(s.kind)!, s.yaw, unit(s.x) / STRUCT_UNITS, unit(s.y) / STRUCT_UNITS, unit(s.z) / STRUCT_UNITS];
      if (s.bend) bend.set(i, s.bend);
      i++;
    }
    for (let k = 0; k < made[0]!.length; k++, i++) [kind[i], x[i], y[i], z[i], yaw[i]] = [made[0]![k]!, made[1]![k]! / STRUCT_UNITS, made[2]![k]! / STRUCT_UNITS, made[3]![k]! / STRUCT_UNITS, made[4]![k]!];
    return finish(MapStatics.group(dims, [...ids.keys()], kind, yaw, x, y, z, true, bend));
  }

  get length(): number {
    return this.kind.length;
  }

  /** The map's `i`th piece as an object, for tools. */
  piece(i: number): MapStatic {
    const r = this.row.length > 0 ? this.row[i]! : i;
    const bend = this.bends.size > 0 ? this.bendOfRow(r) : null;
    return { kind: this.kinds[this.kind[r]!]!, x: this.x[r]!, y: this.y[r]!, z: this.z[r]!, yaw: this.yaw[r]!, ...(bend ? { bend } : {}) };
  }

  /** The bend of row `r`, or null: that of its slot in the last chunk whose rows start at or before it. */
  bendOfRow(r: number): Int16Array | null {
    let lo = 0, hi = this.first.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.first[mid]! <= r) lo = mid;
      else hi = mid - 1;
    }
    return bendOf(this.bends.get(lo), r - this.first[lo]!);
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

/** Calls `each` with every piece of `statics` in the order the map lists them, a bent piece with its bend. */
function eachStatic(statics: MapStatics | readonly MapStatic[], each: (kind: string, x: number, y: number, z: number, yaw: number, bend: ArrayLike<number> | null) => void): void {
  if (!(statics instanceof MapStatics)) {
    for (const s of statics) each(s.kind, s.x, s.y, s.z, s.yaw, s.bend ?? null);
    return;
  }
  const { kinds, kind, x, y, z, yaw, row } = statics;
  const bent = statics.bends.size > 0;
  for (let i = 0; i < kind.length; i++) {
    const r = row.length > 0 ? row[i]! : i;
    each(kinds[kind[r]!]!, x[r]!, y[r]!, z[r]!, yaw[r]!, bent ? statics.bendOfRow(r) : null);
  }
}

/**
 * The collision pieces bent piece (ux, uy, uz, yaw) of kind `kind` with `bend` makes (shared/world/bends.ts madeHits), on
 * the lattice, each to `each` with the chunk it stands in, those that stand on the map at a height a map holds: what a
 * map's writer counts and what its reader makes, from the same numbers on both sides.
 */
export function madeOn(dims: MapDims, kind: string, ux: number, uy: number, uz: number, yaw: number, bend: ArrayLike<number>, each: (kind: string, ux: number, uy: number, uz: number, yaw: number, chunk: number) => void): void {
  const wide = dims.chunksX * CHUNK_SIZE * STRUCT_UNITS, deep = dims.chunksZ * CHUNK_SIZE * STRUCT_UNITS;
  madeHits(ux, uy, uz, yaw, bend, walkedFlush(kind), (k, x, y, z, turn) => {
    if (x < 0 || x >= wide || z < 0 || z >= deep || y < WORLD_MIN_Y * STRUCT_UNITS || y > WORLD_MAX_Y * STRUCT_UNITS) return;
    each(k, x, y, z, turn, chunkAt(dims, x / STRUCT_UNITS, z / STRUCT_UNITS));
  });
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
  /**
   * Bit `chunk * perChunk + slot`, lowest bit first, set where the node the slot draws does not stand: the build took it out
   * (a ruin's way, a route, a canopy), or once the layer is resolved, the rule of where nodes stand did too (resolveNodes).
   */
  readonly out?: Uint8Array;
  /** As `out`, set where the node stands as its footing's other kind. With it the layer is resolved, as a file holds every one. */
  readonly other?: Uint8Array;
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
  readonly other?: Uint8Array;
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
  /**
   * What the ground is to a wheel, a class each two samples a side (Heightfield.ground); left out, every place is plain
   * ground. The build sets it from the surface it made each sample (tools/mapworld/ground.ts).
   */
  readonly ground?: Uint8Array;
  /**
   * Its roads' frame, for drawing (shared/world/roadframe.ts): left out, no road has one. A file read whole keeps it only
   * where it is drawn from (parseMap's `drawn`); a server reads past it.
   */
  readonly road?: MapRoad;
  /**
   * Its streets as lines (shared/world/streets.ts), a part's bytes for each sector a street reaches, by the sector's square
   * on the lattice: left out, it has none.
   */
  readonly streets?: readonly MapStreets[];
  /** As a file gives them back, or a list in the map's order, which every reader takes alike. */
  readonly statics: MapStatics | readonly MapStatic[];
  readonly nodes: readonly NodeLayer[];
  /** At least one. The first is where a new survivor arrives. */
  readonly spawns: readonly MapSpawn[];
  readonly tideEyes?: readonly TideEyeSite[];
  /** Its orbs (shared/world/orb.ts): left out, it has none. */
  readonly orbs?: readonly OrbSite[];
  /** Spawn regions, each naming a `spawns` definition and the creatures it holds. They are added to those of the map's definition. */
  readonly regions?: readonly MapZone[];
  readonly vehicles?: readonly MapVehicle[];
  /** Lakes, ponds, reservoirs and the reaches of rivers, each on its own surface. Without it the sea is the only water. */
  readonly water?: MapWater;
  readonly content?: MapContent;
  /** The far feed's cells of its chunks as it places its statics, where its maker baked them (mapTops). */
  readonly tops?: MapTops;
  /** Its buildings and the runs of its statics' slots that are theirs (shared/world/buildings.ts): left out, it has none. */
  readonly buildings?: Buildings;
}

/** A sector's streets: its square's column and row on the lattice, and its part's bytes (encodeStreets). */
export interface MapStreets {
  readonly col: number;
  readonly row: number;
  readonly bytes: Uint8Array;
  /** Its lines, where the file's reader decoded them already. */
  readonly part?: StreetsPart;
}

/**
 * The far feed's cells of a map's chunks as the map places its statics (shared/world/tactical.ts FarCells), from which a
 * far block is drawn: the chunks with a filled cell, ascending, and FAR_CELLS of each, row by row from its corner.
 */
export interface MapTops {
  readonly chunks: Uint32Array;
  /** farTopByte of each cell's tallest piece above the ground at its middle, 0 for an empty cell. */
  readonly top: Uint8Array;
  /** Each cell's palette colour, 0 for an empty one. */
  readonly tint: Uint8Array;
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

function validateEyes(eyes: readonly TideEyeSite[], dims: MapDims): void {
  if (eyes.length > 255 || eyes.some(e => !e.name || e.name.length > 64 || !EYE_COLORS.includes(e.color)
    || !EYE_FORMS.includes(e.form) || !Number.isFinite(e.y) || !(e.x >= 0 && e.x <= dims.chunksX * CHUNK_SIZE && e.z >= 0 && e.z <= dims.chunksZ * CHUNK_SIZE)
    || !(e.radius > 0 && e.radius <= 70) || !Number.isInteger(e.yaw) || e.yaw < 0 || e.yaw > 65535)) throw new Error("map: invalid Tide Eye site");
}

/** An orb stands in the ground: some of it over, some under. */
function validateOrbs(orbs: readonly OrbSite[], dims: MapDims): void {
  if (orbs.length > 255 || orbs.some(o => !o.name || o.name.length > 64 || !Number.isFinite(o.y)
    || !(o.x >= 0 && o.x <= dims.chunksX * CHUNK_SIZE && o.z >= 0 && o.z <= dims.chunksZ * CHUNK_SIZE)
    || !(o.radius > 0 && o.radius <= 1024 && Math.abs(o.centre) < o.radius) || !Number.isInteger(o.yaw) || o.yaw < 0 || o.yaw > 65535)) throw new Error("map: invalid orb site");
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
  if (m.tideEyes) validateEyes(m.tideEyes, m.dims);
  if (m.orbs) validateOrbs(m.orbs, m.dims);
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
  if (m.ground && m.ground.length !== (sizeX / TERRAIN_CELL / 2 + 1) * (sizeZ / TERRAIN_CELL / 2 + 1)) fail(`its ground classes are ${m.ground.length}, and its size takes a cell each two samples a side`);
  if (m.road && roadPlanes(m.road).some((plane) => plane.length !== (sizeX / TERRAIN_CELL / 2 + 1) * (sizeZ / TERRAIN_CELL / 2 + 1))) fail("its roads' frame is not a cell each two samples a side");
  if (m.heights.length !== samples || m.tint.length !== samples) fail(`it has ${m.heights.length} heights and ${m.tint.length} tints, and its size takes ${samples} of each`);
  const inside = (x: number, z: number): boolean => x >= 0 && x <= sizeX && z >= 0 && z <= sizeZ;
  if (!whole(m.spawns.length, 1, MAX_SPAWNS)) fail(`it has ${m.spawns.length} spawn points, and a map has 1 to ${MAX_SPAWNS}`);
  for (const s of m.spawns) if (!inside(s.x, s.z)) fail(`spawn point "${s.name}" is off the map`);
  checkStatics(m.dims, m.statics);
  const slots = m.nodes.reduce((n, layer) => n + slotsOf(layer, chunksX * chunksZ), 0);
  if (slots > NODE_SLOTS) fail(`its nodes take ${slots} slots in a chunk, and a chunk has ${NODE_SLOTS}`);
  for (const layer of m.nodes) {
    if ("first" in layer) {
      const rows = layer.first[chunksX * chunksZ];
      if (layer.first.length !== chunksX * chunksZ + 1 || rows !== layer.kind.length || rows !== layer.x.length || rows !== layer.z.length || rows !== layer.yaw.length) fail("a list of nodes does not match its chunks");
      if (layer.kinds.length > 255 || layer.kind.some((k) => k >= layer.kinds.length)) fail("a listed node is of a kind its list does not name");
      continue;
    }
    if ("zone" in layer) {
      const cell = layer.zoneCell;
      const weighed = (z: NodeZone): boolean => whole(z.bare, 0, 255) && whole(z.kinds.length, 0, 255) && z.kinds.every(([, weight]) => whole(weight, 1, 255)) && z.bare + z.kinds.length > 0;
      if (!whole(layer.perChunk, 1, NODE_SLOTS) || !whole(layer.zones.length, 1, 255) || !layer.zones.every(weighed)) fail("zoned nodes need 1 to 256 slots a chunk and 1 to 255 zones, each of 0 to 255 kinds of weight 1 to 255 and bare ground of weight 0 to 255");
      if (!whole(cell, 1, CHUNK_SIZE) || CHUNK_SIZE % cell !== 0 || layer.zone.length !== (sizeX / cell) * (sizeZ / cell)) fail("the zones of zoned nodes are not a byte per square of 1, 2, 4, 8, 16, 32 or 64 m");
      const codes = layer.codes;
      if (codes ? codes.length > 255 || codes.some((z) => z > layer.zones.length) || highest(layer.zone) >= codes.length : highest(layer.zone) > layer.zones.length) fail("a square is in a zone the list of zones does not have");
    } else {
      const cell = layer.allowCell;
      if (!whole(layer.perChunk, 1, NODE_SLOTS) || !whole(layer.kinds.length, 1, 255) || layer.kinds.some(([, weight]) => !whole(weight, 1, 255))) fail("scattered nodes need 1 to 256 slots a chunk and 1 to 255 kinds, each of weight 1 to 255");
      if (layer.allow === null ? cell !== 0 : !whole(cell, 1, CHUNK_SIZE) || CHUNK_SIZE % cell !== 0 || layer.allow.length !== Math.ceil(((sizeX / cell) * (sizeZ / cell)) / 8)) fail("where scattered nodes may stand is not a bit per square of 1, 2, 4, 8, 16, 32 or 64 m");
    }
    if ([layer.out, layer.other].some((bits) => bits && bits.length !== outBytes(m.dims, layer.perChunk))) fail("the slots taken out of scattered nodes are not a bit per slot of every chunk");
    if (!layer.out || !layer.other) fail("its scattered nodes are not resolved: resolveNodes decides where each stands, as a file says");
  }
  const w = m.water;
  if (w) {
    if (!whole(w.cell, 1, CHUNK_SIZE) || CHUNK_SIZE % w.cell !== 0 || w.dims.chunksX !== chunksX || w.dims.chunksZ !== chunksZ) fail("its water is not in squares of 1, 2, 4, 8, 16, 32 or 64 m over its chunks");
    if (!whole(w.bodies.length, 1, MAX_WATER_BODIES) || w.bodies.some((b) => !whole(b.level, 0, 65535) || b.name.length > MAX_TEXT)) fail(`it has ${w.bodies.length} bodies of water, and a map with water has 1 to ${MAX_WATER_BODIES}, each a surface on its heights' lattice and a name of at most ${MAX_TEXT} characters`);
    if (w.squares.length !== w.chunks().length * w.side * w.side || w.squares.some((b) => b > w.bodies.length)) fail("a square of its water is in a body it does not list");
  }
  const far = m.tops;
  if (far && (far.top.length !== far.chunks.length * FAR_CELLS || far.tint.length !== far.top.length || far.chunks.some((c, k) => c >= chunksX * chunksZ || (k > 0 && c <= far.chunks[k - 1]!)))) fail("its tops are not the cells of chunks of it in their order");
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

/** The squares a part's of `kind` lie on: SECTOR_CHUNKS a side for a sector's, OVERVIEW_CHUNKS for an overview's and its tops'. */
const sizeOf = (kind: PartKind): number => (kind === "overview" || kind === "tops" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS);

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
    for (const all of [layer.out!, layer.other!]) {
      const bits = new Uint8Array(Math.ceil((chunks.length * layer.perChunk) / 8));
      chunks.forEach((c, k) => copyBits(all, c * layer.perChunk, bits, k * layer.perChunk, layer.perChunk));
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

/** The whole map at every chunk's corner, as the head's COAR holds it, and the chunks its overviews hold water for. */
export interface CoarsePicture {
  /** (chunksX + 1) a row, row by row from z = 0. */
  readonly heights: Uint16Array;
  readonly tint: Uint8Array;
  /** By sample, the number of the body of water most of its square is under, or 0; null where the map has no WATR. */
  readonly bodies: Uint16Array | null;
  /** The chunks the overviews hold water squares for, ascending. */
  readonly water: Uint32Array;
}

function coarsePicture(m: MapData, dims: MapDims): CoarsePicture {
  const nx = dims.chunksX * CHUNK_SAMPLES + 1;
  const nz = dims.chunksZ * CHUNK_SAMPLES + 1;
  const w = dims.chunksX + 1;
  const n = w * (dims.chunksZ + 1);
  const [heights, tint] = [new Uint16Array(n), new Uint8Array(n)];
  const water = m.water ?? null;
  const bodies = water ? new Uint16Array(n) : null;
  // Surfaces in the heights' units: the sea's, -Infinity for none, and each body's by its number.
  const sea = (m.seaLevel - m.minY) / m.stepY;
  const level = [0, ...(water?.bodies.map((b) => b.level) ?? [])];
  const half = COARSE_STEP / 2;
  const tints = new Uint32Array(256);
  // What each sample of a square shows, -1 dry ground, 0 the sea or a body's number, and how many show each.
  const shows: number[] = [];
  const many: number[] = [];
  for (let k = 0; k < n; k++) {
    const [I, J] = [k % w, Math.floor(k / w)];
    let sum = 0;
    tints.fill(0);
    shows.length = many.length = 0;
    for (let j = Math.max(0, J * COARSE_STEP - half); j <= Math.min(nz - 1, J * COARSE_STEP + half); j++) {
      const cz = Math.min(dims.chunksZ - 1, Math.floor(j / CHUNK_SAMPLES));
      for (let i = Math.max(0, I * COARSE_STEP - half); i <= Math.min(nx - 1, I * COARSE_STEP + half); i++) {
        const h = m.heights[j * nx + i]!;
        sum += h;
        tints[m.tint[j * nx + i]!]!++;
        let b = 0;
        if (water) {
          const cx = Math.min(dims.chunksX - 1, Math.floor(i / CHUNK_SAMPLES));
          const at = water.block[cz * dims.chunksX + cx]!;
          const square = (v: number, c: number): number => Math.min(water.side - 1, Math.floor(((v - c * CHUNK_SAMPLES) * TERRAIN_CELL) / water.cell));
          if (at >= 0) b = water.squares[at + square(j, cz) * water.side + square(i, cx)]!;
        }
        const s = b > 0 ? (h < level[b]! ? b : -1) : h < sea ? 0 : -1;
        const at = shows.indexOf(s);
        if (at < 0) shows.push(s), many.push(1);
        else many[at]!++;
      }
    }
    let top = 0;
    for (let q = 1; q < many.length; q++) if (many[q]! > many[top]!) top = q;
    const what = shows[top]!;
    let h = Math.round(sum / many.reduce((a, b) => a + b, 0));
    if (what >= 0) h = Math.min(h, Math.ceil(what === 0 ? sea : level[what]!) - 1);
    else if (h < sea) h = Math.ceil(sea);
    heights[k] = Math.max(0, Math.min(65535, h));
    if (bodies && what > 0) bodies[k] = what;
    let t = 0;
    for (let q = 1; q < 256; q++) if (tints[q]! > tints[t]!) t = q;
    tint[k] = t;
  }
  return { heights, tint, bodies, water: water?.chunks() ?? new Uint32Array(0) };
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
  // The ground's classes, a cell each two samples: plain ground where the map gives none.
  const [gw, gd] = [((w - 1) >> 1) + 1, ((d - 1) >> 1) + 1];
  o.put(m.ground ? samplesOf(m.ground, (nx + 1) >> 1, i0 >> 1, j0 >> 1, gw, gd, 1) : new Uint8Array(gw * gd));
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

/** The tops of an overview's square's chunks, or null where none of them has a filled cell. */
function topsPart(tops: MapTops, dims: FramedDims, sq: Square): Uint8Array | null {
  const w = sq.cx1 - sq.cx0;
  const held: number[] = [];
  tops.chunks.forEach((c, k) => {
    const [cx, cz] = [chunkCx(dims, c), chunkCz(dims, c)];
    if (cx >= sq.cx0 && cx < sq.cx1 && cz >= sq.cz0 && cz < sq.cz1) held.push(k);
  });
  if (held.length === 0) return null;
  const o = new Out();
  o.u16(held.length);
  for (const k of held) o.u16((chunkCz(dims, tops.chunks[k]!) - sq.cz0) * w + chunkCx(dims, tops.chunks[k]!) - sq.cx0);
  for (const cells of [tops.top, tops.tint]) for (const k of held) o.put(cells.subarray(k * FAR_CELLS, (k + 1) * FAR_CELLS));
  return o.done();
}

/**
 * The map's statics by sector, each sector's in the map's order, the table of content ids they name, and each chunk's count.
 * No collision piece of a bent piece is stored, but each one's place is counted in its chunk and its kind named: a reader
 * makes them from the bends (madeOn). One that stands in another sector than its bent piece is stored in its own, after
 * that sector's other pieces, in the order of their pieces' sectors.
 */
function sectorStatics(statics: MapStatics | readonly MapStatic[], dims: FramedDims, sectors: readonly Square[]): { ids: Map<string, number>; parts: (Uint8Array | null)[]; chunks: Uint16Array } {
  const ids = new Map<string, number>();
  const chunks = new Uint16Array(chunkCount(dims));
  const [col0, row0] = [sectors[0]!.col, sectors[0]!.row];
  const cols = sectors.findLast((s) => s.row === row0)!.col - col0 + 1;
  const sectorOf = (c: number): number => (Math.floor((dims.frameZ + chunkCz(dims, c)) / SECTOR_CHUNKS) - row0) * cols + Math.floor((dims.frameX + chunkCx(dims, c)) / SECTOR_CHUNKS) - col0;
  const unit = (v: number): number => Math.round(v * STRUCT_UNITS);
  const tally = (c: number): void => {
    if (chunks[c] === MAX_SLOTS_PER_CHUNK) throw new Error(`map: chunk ${chunkCx(dims, c)}, ${chunkCz(dims, c)} holds more than ${MAX_SLOTS_PER_CHUNK} statics`);
    chunks[c]!++;
  };
  // The kinds in the order of their ids, so a piece added or taken away renumbers no other kind; the collision pieces
  // made counted where they stand, and those that stand in another sector kept to be stored there.
  const names = new Set<string>();
  const away: { kind: string; ux: number; uy: number; uz: number; yaw: number; home: number }[] = [];
  let n = 0;
  eachStatic(statics, (kind, x, y, z, turn, bend) => {
    if (kind.startsWith(HIT_PREFIX)) return;
    names.add(kind);
    n++;
    if (!bend) return;
    const [ux, uy, uz] = [unit(x), unit(y), unit(z)];
    const home = sectorOf(chunkAt(dims, ux / STRUCT_UNITS, uz / STRUCT_UNITS));
    // From the bend as a reader takes it back, sixteen bits a number.
    madeOn(dims, kind, ux, uy, uz, turn, Int16Array.from(bend), (k, hx, hy, hz, yaw, c) => {
      names.add(k);
      if (sectorOf(c) === home) tally(c);
      else away.push({ kind: k, ux: hx, uy: hy, uz: hz, yaw, home });
    });
  });
  // Stored in the order of their pieces' sectors, and in each in the map's order, as the file lists its pieces: so a list
  // in any order whose sectors keep theirs (a map unpacked into its layers and built again) writes the same bytes.
  away.sort((a, b) => a.home - b.home);
  for (const kind of [...names].sort()) ids.set(kind, ids.size);
  n += away.length;
  const [id, yaw, sector] = [new Uint16Array(n), new Uint16Array(n), new Uint32Array(n)];
  const [ux, uy, uz] = [new Int32Array(n), new Int32Array(n), new Int32Array(n)];
  const counts = new Uint32Array(sectors.length + 1);
  let i = 0;
  const bends = new Map<number, ArrayLike<number>>();
  const put = (kind: string, x: number, y: number, z: number, turn: number): void => {
    [ux[i], uy[i], uz[i]] = [x, y, z];
    // Its chunk is that of its place on the lattice, as a reader finds it.
    const c = chunkAt(dims, x / STRUCT_UNITS, z / STRUCT_UNITS);
    tally(c);
    const s = sectorOf(c);
    [id[i], yaw[i], sector[i]] = [ids.get(kind)!, turn, s];
    counts[s + 1]!++;
    i++;
  };
  eachStatic(statics, (kind, x, y, z, turn, bend) => {
    if (kind.startsWith(HIT_PREFIX)) return;
    if (bend) bends.set(i, bend);
    put(kind, unit(x), unit(y), unit(z), turn);
  });
  for (const a of away) put(a.kind, a.ux, a.uy, a.uz, a.yaw);
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
    let was: Int16Array | null = null;
    for (let i = 0; i < count; i++) {
      const k = order[counts[s]! + i]!;
      const [x, y, z] = [ux[k]! - x0, uy[k]!, uz[k]! - z0];
      // A bent piece after a bent piece is coded against where it would stand were it the next of that one's line.
      const bend = bends.has(k) ? Int16Array.from(bends.get(k)!) : null;
      if (bend && was) bentNext(px, py, pz, pyaw, was, bend, next);
      const [gx, gy, gz, gyaw] = bend && was ? next : [px, py, pz, pyaw];
      plane(0, i, id[k]!, 2);
      plane(2, i, yaw[k]! - gyaw!, 2);
      plane(4, i, zigzag(x - gx!), 3);
      plane(7, i, zigzag(y - gy!), 3);
      plane(10, i, zigzag(z - gz!), 3);
      [px, py, pz, pyaw] = [x, y, z, yaw[k]!];
      was = bend;
    }
    // Its bent pieces, by their places among its own.
    const bent: number[] = [];
    for (let i = 0; i < count; i++) if (bends.has(order[counts[s]! + i]!)) bent.push(i);
    if (bent.length > 0) {
      o.u32(bent.length);
      bent.forEach((i, q) => {
        for (let gap = i - (q > 0 ? bent[q - 1]! + 1 : 0); ; gap >>>= 7) {
          o.u8((gap & 127) | (gap > 127 ? 128 : 0));
          if (gap <= 127) break;
        }
      });
      const planes = o.take(bent.length * 16);
      const guess = new Int16Array(8);
      bent.forEach((i, q) => {
        const bend = bends.get(order[counts[s]! + i]!)!;
        for (let k = 0; k < 8; k++) {
          const v = (bend[k]! - guess[k]!) & 0xffff;
          o.bytes[planes + k * 2 * bent.length + q] = v & 255;
          o.bytes[planes + (k * 2 + 1) * bent.length + q] = v >> 8;
        }
        bendGuess(guess, bend);
      });
    }
    return o.done();
  });
  return { ids, parts, chunks };
}

interface Written {
  readonly kind: PartKind;
  readonly sq: Square | null;
  readonly bytes: Uint8Array;
}

function headPart(m: MapData, dims: FramedDims, layers: readonly NodeLayer[], statics: { ids: Map<string, number>; chunks: Uint16Array }, parts: readonly Written[]): Uint8Array<ArrayBuffer> {
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
    });
  }
  if (m.tideEyes?.length) o.section("TEYE", () => {
    o.u8(m.tideEyes!.length);
    for (const eye of m.tideEyes!) {
      o.text(eye.name); o.f64(eye.x); o.f64(eye.y); o.f64(eye.z);
      o.u16(eye.yaw); o.u8(EYE_COLORS.indexOf(eye.color)); o.f64(eye.radius);
    }
    // Older headers end after the radii. Only maps with a distinct instrument need the form column.
    if (m.tideEyes!.some(eye => eye.form)) for (const eye of m.tideEyes!) o.u8(EYE_FORMS.indexOf(eye.form));
  });
  if (m.orbs?.length) o.section("ORBS", () => {
    o.u8(m.orbs!.length);
    for (const orb of m.orbs!) {
      o.text(orb.name); o.f64(orb.x); o.f64(orb.y); o.f64(orb.z);
      o.u16(orb.yaw); o.f64(orb.radius); o.f64(orb.centre);
    }
  });
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
  const coarse = coarsePicture(m, dims);
  o.section("COAR", () => {
    putGrid(o, coarse.heights, dims.chunksX + 1);
    o.put(coarse.tint);
    if (!coarse.bodies) return;
    putGrid(o, coarse.bodies, dims.chunksX + 1);
    const bits = new Uint8Array(Math.ceil(chunkCount(dims) / 8));
    for (const c of coarse.water) bits[c >> 3]! |= 1 << (c & 7);
    o.put(bits);
  });
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
  if (statics.ids.size > 0) {
    o.section("STAT", () => {
      o.u16(statics.ids.size);
      for (const id of statics.ids.keys()) o.text(id);
      putU16s(o, statics.chunks);
    });
  }
  const names = m.buildings?.sectors.some((t) => t) ? m.buildings.names : null;
  if (names) {
    o.section("BLDG", () => {
      o.u8(BUILDINGS_VERSION);
      for (const table of [names.kinds, names.recipes, names.forms, names.collapses, names.districts]) {
        o.u8(table.length);
        for (const name of table) o.text(name);
      }
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
  // Each sector's roads' frame, where a road runs in it.
  for (const sq of m.road ? sectors : []) {
    const bytes = roadPart(m.road!, dims, sq);
    if (bytes) parts.push({ kind: "road", sq, bytes });
  }
  // Each sector's streets, where a street reaches it.
  for (const sq of m.streets ? sectors : []) {
    const held = m.streets!.find((p) => p.col === sq.col && p.row === sq.row);
    if (held) parts.push({ kind: "streets", sq, bytes: held.bytes });
  }
  // Each sector's buildings, their runs within the slots its statics take.
  const built = m.buildings;
  if (built && (built.dims.chunksX !== dims.chunksX || built.dims.chunksZ !== dims.chunksZ || built.dims.frameX !== dims.frameX || built.dims.frameZ !== dims.frameZ)) throw new Error("map: its buildings are laid out for another map");
  for (const t of built?.sectors ?? []) {
    if (!t) continue;
    t.check(dims, built!.names, statics.chunks);
    parts.push({ kind: "buildings", sq: squareOf(dims, SECTOR_CHUNKS, t.col, t.row)!, bytes: t.encode() });
  }
  const tops = m.tops;
  if (tops) {
    for (const sq of squaresOf(dims, OVERVIEW_CHUNKS)) {
      const bytes = topsPart(tops, dims, sq);
      if (bytes) parts.push({ kind: "tops", sq, bytes });
    }
  }
  const head = headPart(m, dims, layers, statics, parts);
  const file = new Uint8Array(head.length + parts.reduce((n, p) => n + p.bytes.length, 0));
  file.set(head);
  let at = head.length;
  for (const p of parts) {
    file.set(p.bytes, at);
    at += p.bytes.length;
  }
  return file;
}

/** A node layer as the head gives it: its rules, and whether the parts hold a picture of it. */
export type LayerRule =
  | { readonly type: 0; readonly seed: number; readonly perChunk: number; readonly kinds: readonly (readonly [string, number])[]; readonly allowCell: number }
  | { readonly type: 1; readonly kinds: readonly string[] }
  | { readonly type: 2; readonly seed: number; readonly perChunk: number; readonly zones: readonly NodeZone[]; readonly zoneCell: number; readonly codes: Uint8Array | null; readonly shared: boolean };

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
  readonly tideEyes?: readonly TideEyeSite[];
  /** Its orbs (shared/world/orb.ts): left out, it has none. */
  readonly orbs?: readonly OrbSite[];
  readonly regions: readonly MapZone[];
  readonly vehicles: readonly MapVehicle[];
  /** Null where it has no LAND. */
  readonly landmarks: readonly MapLandmark[] | null;
  readonly layers: readonly LayerRule[];
  readonly water: { readonly cell: number; readonly bodies: readonly WaterBody[] } | null;
  /** The whole map at every chunk's corner, which a client draws until each overview comes. */
  readonly coarse: CoarsePicture;
  /** Its version: MAP_VERSION or KEPT_VERSION. */
  readonly version: number;
  /** The content ids its statics name by number. */
  readonly kinds: readonly string[];
  /** How many statics each chunk holds, row by row: a chunk's rows of MapStatics, laid out before any sector's come (blankStatics). */
  readonly counts: Uint16Array;
  /** What its buildings name by number, or null where it has none. */
  readonly buildings: BuildingNames | null;
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
    return { type, seed, perChunk, kinds, allowCell: allowCell === 0 ? 0 : cellOf(allowCell) };
  }
  if (type !== 2) throw new Error(`map: nodes of type ${type} are not ones this build reads`);
  const [seed, perChunk] = [s.u32(), s.u16()];
  const zones = Array.from({ length: s.u8() }, (): NodeZone => {
    const bare = s.u8();
    return { bare, kinds: weights() };
  });
  const zoneCell = cellOf(s.u8());
  const codes = s.u8();
  return { type, seed, perChunk, zones, zoneCell, codes: codes > 0 ? s.take(codes).slice() : null, shared: s.u8() === 1 };
}

/**
 * A map's head, from its own bytes or from the start of the map's file. Throws with a reason if it is not a map this build
 * can play on. Without `verify` its hash is taken on trust, as a page does that fetched it by its name.
 */
export function readHead(file: Uint8Array, verify = true): MapHead {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 16 || v.getUint32(0, true) !== MAGIC) throw new Error("map: this is not a map file");
  const version = v.getUint16(4, true);
  if (version !== MAP_VERSION && version !== KEPT_VERSION) throw new Error(`map: version ${version} is not one this build reads: build the map again`);
  const bytes = v.getUint32(12, true);
  if (bytes < HEADER_BYTES || bytes > file.length) throw new Error("map: it is cut short");
  const hash = v.getUint32(8, true);
  if (verify && hash !== hashBytes(file.subarray(12, bytes))) throw new Error("map: its head is damaged: its hash is not that of its bytes");
  return within(() => readHeadSections(new In(file.subarray(0, bytes)), hash, version));
}

function readHeadSections(r: In, hash: number, version: number): MapHead {
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
  let tideEyes: TideEyeSite[] | undefined;
  let orbs: OrbSite[] | undefined;
  let landmarks: MapLandmark[] | null = null;
  let kinds: string[] = [];
  let counts: Uint16Array = new Uint16Array(chunkCount(dims));
  let parts: MapPart[] | null = null;
  let buildings: BuildingNames | null = null;
  let coarse: In | null = null;
  while (r.at < r.bytes.length) {
    const tag = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
    const s = new In(r.take(r.u32()));
    if (tag === "NODE") layers.push(readRule(s));
    else if (tag === "COAR") {
      if (coarse) throw new Error("map: it has two COAR sections");
      coarse = s;
    }
    else if (tag === "TEYE") {
      if (tideEyes) throw new Error("map: duplicate Tide Eye section");
      tideEyes = Array.from({ length: s.u8() }, () => {
        const name = s.text(), x = s.f64(), y = s.f64(), z = s.f64(), yaw = s.u16();
        const color = EYE_COLORS[s.u8()], radius = s.f64();
        if (!color) throw new Error("map: invalid Tide Eye color");
        return { name, x, y, z, yaw, color, radius };
      });
      if (s.at < s.bytes.length) {
        if (s.bytes.length - s.at !== tideEyes.length) throw new Error("map: invalid obelisk form column");
        tideEyes = tideEyes.map(eye => {
          const form = s.u8();
          if (form >= EYE_FORMS.length) throw new Error("map: unknown obelisk form");
          return form ? { ...eye, form: EYE_FORMS[form]! } : eye;
        });
      }
      validateEyes(tideEyes, dims);
    } else if (tag === "ORBS") {
      if (orbs) throw new Error("map: it has two ORBS sections");
      orbs = Array.from({ length: s.u8() }, () => ({ name: s.text(), x: s.f64(), y: s.f64(), z: s.f64(), yaw: s.u16(), radius: s.f64(), centre: s.f64() }));
      validateOrbs(orbs, dims);
    } else if (tag === "SPWN") {
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
    } else if (tag === "STAT") {
      kinds = Array.from({ length: s.u16() }, () => s.text());
      counts = getU16s(s, counts.length);
    } else if (tag === "BLDG") {
      if (buildings) throw new Error("map: it has two BLDG sections");
      if (s.u8() !== BUILDINGS_VERSION) throw new Error("map: its buildings are of a version this build does not read: build the map again");
      const table = (): string[] => Array.from({ length: s.u8() }, () => s.text());
      buildings = { kinds: table(), recipes: table(), forms: table(), collapses: table(), districts: table() };
    } else if (tag === "PART") {
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
  const head = { hash, bytes: r.bytes.length, name: partName("head", 0, 0, partHash(r.bytes)), version, id, dims, minY, stepY, seaLevel, spawns, regions, vehicles, landmarks, ...(tideEyes ? { tideEyes } : {}), ...(orbs ? { orbs } : {}), layers, water, coarse: readCoarse(coarse, dims, water), kinds, counts, buildings, parts: parts ?? [] };
  checkParts(head);
  return head;
}

function readCoarse(s: In | null, dims: FramedDims, water: MapHead["water"]): CoarsePicture {
  if (!s) throw new Error("map: its head has no coarse picture (COAR): build the map again");
  const [w, d, chunks] = [dims.chunksX + 1, dims.chunksZ + 1, chunkCount(dims)];
  const heights = getGrid(s, w, d);
  const tint = s.take(w * d).slice();
  let bodies: Uint16Array | null = null;
  const held: number[] = [];
  if (water) {
    bodies = getGrid(s, w, d);
    if (bodies.some((b) => b > water.bodies.length)) throw new Error("map: its coarse picture names a body of water its head does not list");
    const bits = s.take(Math.ceil(chunks / 8));
    for (let c = 0; c < chunks; c++) if ((bits[c >> 3]! >> (c & 7)) & 1) held.push(c);
  }
  if (s.at !== s.bytes.length) throw new Error("map: its coarse picture runs on past what it holds");
  return { heights, tint, bodies, water: Uint32Array.from(held) };
}

/** Throws unless the head lists one overview for each of the map's overview squares, one ground for each sector, and nothing else twice. */
function checkParts(head: MapHead): void {
  const seen = new Set<string>();
  for (const p of head.parts) {
    const key = `${p.kind} ${p.col} ${p.row}`;
    if (seen.has(key)) throw new Error(`map: it has two parts ${p.kind} ${p.col}, ${p.row}`);
    seen.add(key);
    if (p.kind === "land" ? p.col !== 0 || p.row !== 0 : !squareOf(head.dims, sizeOf(p.kind), p.col, p.row)) throw new Error(`map: its part ${p.name} lies off the map`);
    if (p.kind === "buildings" && !head.buildings) throw new Error("map: it has a sector's buildings and no names for them (BLDG)");
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
  /**
   * By node layer, its picture of the square, bits or bytes as the layer's is, or null where it has none; and a scattered or
   * zoned one's bits of its chunks' slots, chunk by chunk, where none stands and where the footing's other kind does.
   */
  readonly pictures: readonly (Uint8Array | null)[];
  readonly out: readonly (Uint8Array | null)[];
  readonly other: readonly (Uint8Array | null)[];
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
  /** Row by row, (cx1 - cx0) * 16 + 1 a row: the ground's class each two samples a side. */
  readonly ground: Uint8Array;
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
  /** Its bent pieces' places among its own, ascending, and their bends, eight numbers each; empty where none is bent. */
  readonly bendAt: Uint32Array;
  readonly bend: Int16Array;
}

/** An overview's square's tops: those of its chunks with a filled cell, by their map's chunks. Nothing waits for it. */
export interface TopsPiece extends MapTops {
  readonly kind: "tops";
  readonly sq: Square;
}

/** A sector's roads' frame (roadframe.ts), its planes at its ground classes' cells row by row, as views of the part's bytes. */
export interface RoadPiece {
  readonly kind: "road";
  readonly sq: Square;
  readonly road: MapRoad;
}

/** A sector's streets as its part gives them: its lines, decoded once as the part is read, and its bytes, which a map's writer keeps. */
export interface StreetsPiece {
  readonly kind: "streets";
  readonly sq: Square;
  readonly part: StreetsPart;
  readonly bytes: Uint8Array;
}

/** A sector's buildings and the runs of its chunks' slots that are theirs. */
export interface BuildingsPiece {
  readonly kind: "buildings";
  readonly sq: Square;
  readonly table: SectorBuildings;
}

export type MapPiece = LandPiece | OverviewPiece | GroundPiece | StaticsPiece | TopsPiece | RoadPiece | StreetsPiece | BuildingsPiece;

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
    if (part.kind === "tops") return readTops(head, sq!, s);
    if (part.kind === "road") return readRoad(sq!, s);
    if (part.kind === "buildings") {
      const table = SectorBuildings.decode(head.dims, head.buildings!, head.counts, part.col, part.row, bytes);
      s.take(bytes.length);
      return { kind: "buildings", sq: sq!, table };
    }
    if (part.kind === "streets") {
      const lines = decodeStreets(bytes, sq!.ox * CHUNK_SIZE, sq!.oz * CHUNK_SIZE);
      s.take(bytes.length);
      return { kind: "streets", sq: sq!, part: lines, bytes: bytes.slice() };
    }
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
  const other: (Uint8Array | null)[] = [];
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
    const bits = rule.type === 1 ? 0 : Math.ceil((chunks.length * rule.perChunk) / 8);
    out.push(rule.type === 1 ? null : s.take(bits).slice());
    other.push(rule.type === 1 ? null : s.take(bits).slice());
  }
  let water: OverviewPiece["water"] = null;
  if (head.water) {
    const per = (CHUNK_SIZE / head.water.cell) * (CHUNK_SIZE / head.water.cell);
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
  return { kind: "overview", sq, heights, tint, low, high, pictures, out, other, water };
}

function readGround(head: MapHead, sq: Square, s: In): GroundPiece {
  const [w, d] = [(sq.cx1 - sq.cx0) * CHUNK_SAMPLES + 1, (sq.cz1 - sq.cz0) * CHUNK_SAMPLES + 1];
  const heights = getGrid(s, w, d);
  const tint = s.take(w * d).slice();
  const ground = s.take((((w - 1) >> 1) + 1) * (((d - 1) >> 1) + 1)).slice();
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
  return { kind: "ground", sq, heights, tint, ground, listed };
}

function readRoad(sq: Square, s: In): RoadPiece {
  const cells = ((sq.cx1 - sq.cx0) * CHUNK_SAMPLES) / 2 + 1, n = cells * (((sq.cz1 - sq.cz0) * CHUNK_SAMPLES) / 2 + 1);
  return { kind: "road", sq, road: { across: s.take(n), along: s.take(n), half: s.take(n), lanes: s.take(n) } };
}

function readTops(head: MapHead, sq: Square, s: In): TopsPiece {
  const square = chunksOf(head.dims, sq);
  const chunks = new Uint32Array(s.u16());
  for (let k = 0; k < chunks.length; k++) {
    const at = s.u16();
    if (at >= square.length || (k > 0 && square[at]! <= chunks[k - 1]!)) throw new Error("map: its tops' chunks are off their square or out of order");
    chunks[k] = square[at]!;
  }
  const top = s.take(chunks.length * FAR_CELLS).slice();
  return { kind: "tops", sq, chunks, top, tint: s.take(top.length).slice() };
}

function* readStatics(head: MapHead, sq: Square, s: In): Generator<void, StaticsPiece> {
  const n = s.u32();
  const b = s.take(n * STAT_ROW);
  // Its bent pieces first: a bent piece after a bent piece is coded against the guess of the one before.
  let bendAt = new Uint32Array(0), bend = new Int16Array(0);
  if (s.at < s.bytes.length) {
    const m = s.u32();
    bendAt = new Uint32Array(m);
    for (let q = 0, at = 0; q < m; q++) {
      let gap = 0;
      for (let scale = 1, b = 128; b >= 128; scale *= 128) {
        if (scale > 1 << 28) throw new Error("map: its bent pieces are not among its statics");
        b = s.u8();
        gap += (b & 127) * scale;
      }
      bendAt[q] = at += gap;
      at++;
      if (bendAt[q]! >= n) throw new Error("map: its bent pieces are not among its statics");
    }
    const planes = s.take(m * 16);
    bend = new Int16Array(m * 8);
    const guess = new Int16Array(8);
    for (let q = 0; q < m; q++) {
      for (let k = 0; k < 8; k++) bend[q * 8 + k] = guess[k]! + ((planes[(k * 2 + 1) * m + q]! << 8) | planes[k * 2 * m + q]!);
      bendGuess(guess, bend.subarray(q * 8, q * 8 + 8));
    }
  }
  const [id, yaw, chunk] = [new Uint16Array(n), new Uint16Array(n), new Uint32Array(n)];
  const [xs, ys, zs] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const unzig = (z: number): number => (z >>> 1) ^ -(z & 1);
  const three = (column: number, i: number): number => unzig(b[column * n + i]! | (b[(column + 1) * n + i]! << 8) | (b[(column + 2) * n + i]! << 16));
  const { dims } = head;
  const [x0, z0] = [sq.ox * CHUNK_SIZE * STRUCT_UNITS, sq.oz * CHUNK_SIZE * STRUCT_UNITS];
  const [wide, deep] = [dims.chunksX * CHUNK_SIZE * STRUCT_UNITS, dims.chunksZ * CHUNK_SIZE * STRUCT_UNITS];
  const off = (kind: number, x: number, y: number, z: number, what: string): Error => new Error(`map: a ${head.kinds[kind]} at ${x / STRUCT_UNITS}, ${y / STRUCT_UNITS}, ${z / STRUCT_UNITS} is off ${what}`);
  let [x, y, z, turn] = [0, 0, 0, 0];
  for (let i = 0, q = 0; i < n; i++) {
    id[i] = b[i]! | (b[n + i]! << 8);
    if (id[i]! >= head.kinds.length) throw new Error("map: a static piece is of a kind its table does not name");
    // A bent piece after a bent piece: from where it would stand as the next of that one's line.
    const bent = q < bendAt.length && bendAt[q] === i;
    if (bent && q > 0 && bendAt[q - 1] === i - 1) {
      bentNext(x, y, z, turn, bend.subarray((q - 1) * 8, q * 8), bend.subarray(q * 8, q * 8 + 8), next);
      [x, y, z, turn] = [next[0]!, next[1]!, next[2]!, next[3]!];
    }
    if (bent) q++;
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
  if (bendAt.length === 0) return { kind: "statics", sq, id, yaw, x: xs, y: ys, z: zs, chunk, bendAt, bend };
  // The collision pieces under its bent pieces, made from them as the writer counted them, those in this sector after its
  // own pieces.
  const kindOf = kindIndex(head.kinds);
  const made: number[][] = [[], [], [], [], [], []];
  for (let q = 0; q < bendAt.length; q++) {
    const i = bendAt[q]!;
    madeOn(dims, head.kinds[id[i]!]!, Math.round(xs[i]! * STRUCT_UNITS), Math.round(ys[i]! * STRUCT_UNITS), Math.round(zs[i]! * STRUCT_UNITS), yaw[i]!, bend.subarray(q * 8, q * 8 + 8), (k, hx, hy, hz, turn, c) => {
      const cx = chunkCx(dims, c), cz = chunkCz(dims, c);
      if (cx < sq.cx0 || cx >= sq.cx1 || cz < sq.cz0 || cz >= sq.cz1) return;
      const kind = kindOf.get(k);
      if (kind === undefined) throw new Error(`map: a bent piece makes a ${k}, which its table does not name`);
      made[0]!.push(kind);
      made[1]!.push(turn);
      made[2]!.push(hx);
      made[3]!.push(hy);
      made[4]!.push(hz);
      made[5]!.push(c);
    });
    if (q % MADE_SLICE === MADE_SLICE - 1) yield;
  }
  const all = n + made[0]!.length;
  const grown = <T extends Uint16Array | Uint32Array | Float32Array>(a: T, column: readonly number[], scale: number): T => {
    const b = new (a.constructor as new (n: number) => T)(all);
    b.set(a);
    for (let k = 0; k < column.length; k++) b[n + k] = column[k]! / scale;
    return b;
  };
  return {
    kind: "statics", sq, id: grown(id, made[0]!, 1), yaw: grown(yaw, made[1]!, 1), x: grown(xs, made[2]!, STRUCT_UNITS), y: grown(ys, made[3]!, STRUCT_UNITS), z: grown(zs, made[4]!, STRUCT_UNITS),
    chunk: grown(chunk, made[5]!, 1), bendAt, bend,
  };
}

/** Bent pieces whose collision pieces are made between yields when a part is read a step at a time: about a millisecond's work. */
const MADE_SLICE = 1 << 9;
const kindIndices = new WeakMap<readonly string[], Map<string, number>>();
/** A head's kinds by their ids, made once a head. */
function kindIndex(kinds: readonly string[]): Map<string, number> {
  let m = kindIndices.get(kinds);
  if (!m) kindIndices.set(kinds, (m = new Map(kinds.map((k, i) => [k, i]))));
  return m;
}

/**
 * Sets a sector's ground into the map's heights, tint and ground classes, row by row from z = 0. An empty tint, as a
 * server's, is left so; and so is an empty ground, as a client's that has no use for it.
 */
export function setGround(dims: MapDims, heights: Uint16Array, tint: Uint8Array, piece: GroundPiece, ground: Uint8Array = NO_GROUND): void {
  const { sq } = piece;
  const nx = dims.chunksX * CHUNK_SAMPLES + 1;
  const w = (sq.cx1 - sq.cx0) * CHUNK_SAMPLES + 1;
  for (let j = 0; j < piece.heights.length / w; j++) {
    const at = (sq.cz0 * CHUNK_SAMPLES + j) * nx + sq.cx0 * CHUNK_SAMPLES;
    heights.set(piece.heights.subarray(j * w, j * w + w), at);
    if (tint.length > 0) tint.set(piece.tint.subarray(j * w, j * w + w), at);
  }
  if (ground.length === 0) return;
  const [gx, gw] = [(nx + 1) >> 1, ((w - 1) >> 1) + 1];
  for (let j = 0; j < piece.ground.length / gw; j++) {
    ground.set(piece.ground.subarray(j * gw, j * gw + gw), ((sq.cz0 * CHUNK_SAMPLES) / 2 + j) * gx + (sq.cx0 * CHUNK_SAMPLES) / 2);
  }
}
const NO_GROUND = new Uint8Array(0);

/** A frame's planes in the order a part holds them. */
const roadPlanes = (r: MapRoad): readonly Uint8Array[] => [r.across, r.along, r.half, r.lanes];
/** A sector's roads' frame (RoadPiece) held where it is drawn from (Heightfield `road`), by its square. */
export function holdRoad(road: RoadSectors, piece: RoadPiece): void {
  const { sq } = piece;
  road.put(sq.col * 4096 + sq.row, (sq.cx0 * CHUNK_SAMPLES) / 2, (sq.cz0 * CHUNK_SAMPLES) / 2, ((sq.cx1 - sq.cx0) * CHUNK_SAMPLES) / 2 + 1, piece.road);
}
/** A sector's streets (StreetsPiece) held where they are asked (Heightfield `streets`), by its square. */
export function holdStreets(held: StreetSectors, piece: StreetsPiece): void {
  const sq = piece.sq;
  held.put(sq.col * 4096 + sq.row, piece.part, sq.cx0, sq.cz0, sq.cx1, sq.cz1);
}

/** Where bentNext puts its guess. */
const next = [0, 0, 0, 0];

/** The bytes of a sector's road part: its square's cells of the map's frame, or null where no road runs in it. */
function roadPart(road: MapRoad, dims: FramedDims, sq: Square): Uint8Array | null {
  const cells = (dims.chunksX * CHUNK_SAMPLES) / 2 + 1;
  const [w, d] = [((sq.cx1 - sq.cx0) * CHUNK_SAMPLES) / 2 + 1, ((sq.cz1 - sq.cz0) * CHUNK_SAMPLES) / 2 + 1];
  const planes = roadPlanes(road).map((plane) => samplesOf(plane, cells, (sq.cx0 * CHUNK_SAMPLES) / 2, (sq.cz0 * CHUNK_SAMPLES) / 2, w, d, 1));
  if (planes[0]!.every((v) => v === 0)) return null;
  const out = new Uint8Array(w * d * ROAD_PLANES);
  planes.forEach((plane, p) => out.set(plane, p * w * d));
  return out;
}

/** Sets an overview's pictures and its slots' bits of where nodes stand into the map's node layers, as `blankLayers` made them. */
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
    for (const [from, into] of [[piece.out[k], layer.out], [piece.other[k], layer.other]] as const) {
      if (from && into) chunks.forEach((c, i) => copyBits(from, i * layer.perChunk, into, c * layer.perChunk, layer.perChunk));
    }
  });
}

/** The node layers a head names, their pictures and their slots' bits blank for the overviews to be set into, and a listed one's rows none. */
export function blankLayers(head: MapHead): NodeLayer[] {
  const { dims } = head;
  const squares = (cell: number): number => ((dims.chunksX * CHUNK_SIZE) / cell) * ((dims.chunksZ * CHUNK_SIZE) / cell);
  const layers: NodeLayer[] = [];
  let picture: Uint8Array | null = null;
  for (const rule of head.layers) {
    const out = rule.type === 1 ? {} : { out: new Uint8Array(outBytes(dims, rule.perChunk)), other: new Uint8Array(outBytes(dims, rule.perChunk)) };
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

/**
 * Listed layer `k`'s rows from the sectors' grounds given, chunk by chunk, in any order: a chunk of a sector not given has
 * none. A loader sets them into the layer its node source reads as each sector comes.
 */
export function listedRows(dims: MapDims, kinds: readonly string[], k: number, grounds: readonly GroundPiece[]): NodeList {
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
 * Sets a sector's statics into the rows of its chunks in `t`, slot s of a chunk its s-th piece, and with the map's order
 * kept, its pieces from place `from` of that order on. Throws unless they fill those rows.
 */
function* fillRows(dims: MapDims, t: MapStatics, piece: StaticsPiece, from: number): Generator<void, void> {
  const { sq } = piece;
  const w = sq.cx1 - sq.cx0;
  const filled = new Uint32Array(w * (sq.cz1 - sq.cz0));
  const fail = (): Error => new Error(`map: the statics of sector ${sq.col}, ${sq.row} do not fill the rows laid out for them`);
  // Its bent pieces' slots by chunk, as they come in their chunks' order, and their places among the part's bends.
  const lists = new Map<number, { slot: number[]; at: number[] }>();
  for (let i = 0, q = 0; i < piece.id.length; i++) {
    const c = piece.chunk[i]!;
    const r = t.first[c]! + filled[(chunkCz(dims, c) - sq.cz0) * w + chunkCx(dims, c) - sq.cx0]!++;
    if (q < piece.bendAt.length && piece.bendAt[q] === i) {
      let l = lists.get(c);
      if (!l) lists.set(c, (l = { slot: [], at: [] }));
      l.slot.push(r - t.first[c]!);
      l.at.push(q++);
    }
    if (r >= t.first[c + 1]!) throw fail();
    t.kind[r] = piece.id[i]!;
    t.yaw[r] = piece.yaw[i]!;
    t.x[r] = piece.x[i]!;
    t.y[r] = piece.y[i]!;
    t.z[r] = piece.z[i]!;
    if (t.row.length > 0) t.row[from + i] = r;
    if (i % SLICE === SLICE - 1) yield;
  }
  for (let k = 0; k < filled.length; k++) {
    const c = (sq.cz0 + Math.floor(k / w)) * dims.chunksX + sq.cx0 + (k % w);
    if (filled[k] !== t.first[c + 1]! - t.first[c]!) throw fail();
  }
  for (const [c, l] of lists) {
    const bend = new Int16Array(l.at.length * 8);
    l.at.forEach((q, k) => bend.set(piece.bend.subarray(q * 8, q * 8 + 8), k * 8));
    t.bends.set(c, { slot: Uint16Array.from(l.slot), bend });
  }
}

/**
 * The map's statics laid out from its head, each chunk's rows where its count puts them and blank, for each sector's to be
 * set in as it comes, in any order and alone (setStatics). Without `order` the map's order is not kept.
 */
export function blankStatics(head: MapHead, order = true): MapStatics {
  const { counts } = head;
  const t = MapStatics.blank(head.kinds, counts.length, counts.reduce((n, k) => n + k, 0), order);
  for (let c = 0; c < counts.length; c++) t.first[c + 1] = t.first[c]! + counts[c]!;
  return t;
}

/**
 * Sets a sector's statics into the rows its head lays out for its chunks in `t` (blankStatics), a slice of them a step, and
 * with the map's order kept, each at its place in that order: the sectors' in the order of the head's table, each sector's in
 * its own. Throws unless they fill those rows.
 */
export function* setStatics(head: MapHead, t: MapStatics, piece: StaticsPiece): Generator<void, void> {
  let from = 0;
  for (const p of head.parts) {
    if (p.kind !== "statics") continue;
    if (p.col === piece.sq.col && p.row === piece.sq.row) break;
    for (const c of chunksOf(head.dims, squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!)) from += head.counts[c]!;
  }
  yield* fillRows(head.dims, t, piece, from);
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
    yield* fillRows(head.dims, t, p, from);
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
export function joinParts(head: MapHead, pieces: readonly MapPiece[], order = true, drawn = false): MapFile {
  const { dims } = head;
  const n = (dims.chunksX * CHUNK_SAMPLES + 1) * (dims.chunksZ * CHUNK_SAMPLES + 1);
  const [heights, tint] = [new Uint16Array(n), new Uint8Array(n)];
  const gx = (dims.chunksX * CHUNK_SAMPLES) / 2 + 1, cells = gx * ((dims.chunksZ * CHUNK_SAMPLES) / 2 + 1);
  const ground = new Uint8Array(cells);
  const road = drawn && head.parts.some((p) => p.kind === "road") ? { across: new Uint8Array(cells), along: new Uint8Array(cells), half: new Uint8Array(cells), lanes: new Uint8Array(cells) } : null;
  const nodes = blankLayers(head);
  const grounds: GroundPiece[] = [];
  const statics: StaticsPiece[] = [];
  const water: { chunks: Uint32Array; squares: Uint16Array }[] = [];
  const tops: TopsPiece[] = [];
  const streets: MapStreets[] = [];
  const buildings = head.buildings ? new Buildings(dims, head.buildings) : null;
  let defs: readonly Def[] = [];
  for (const p of pieces) {
    if (p.kind === "land") defs = p.defs;
    else if (p.kind === "overview") {
      setNodes(dims, nodes, p);
      if (p.water) water.push(p.water);
    } else if (p.kind === "ground") {
      setGround(dims, heights, tint, p, ground);
      grounds.push(p);
    } else if (p.kind === "road") {
      if (!road) continue;
      const gw = ((p.sq.cx1 - p.sq.cx0) * CHUNK_SAMPLES) / 2 + 1, at = ((p.sq.cz0 * CHUNK_SAMPLES) / 2) * gx + (p.sq.cx0 * CHUNK_SAMPLES) / 2;
      roadPlanes(p.road).forEach((plane, k) => {
        for (let j = 0; j < plane.length / gw; j++) roadPlanes(road)[k]!.set(plane.subarray(j * gw, j * gw + gw), at + j * gx);
      });
    } else if (p.kind === "tops") tops.push(p);
    else if (p.kind === "streets") streets.push({ col: p.sq.col, row: p.sq.row, bytes: p.bytes, part: p.part });
    else if (p.kind === "buildings") buildings!.set(p.table);
    else statics.push(p);
  }
  head.layers.forEach((rule, k) => rule.type === 1 && (nodes[k] = listedRows(dims, rule.kinds, k, grounds)));
  const mapWater = joinWater(head, water);
  const content = head.landmarks ? { content: { landmarks: head.landmarks, defs } } : {};
  const { id, minY, stepY, seaLevel, spawns, regions, vehicles, hash } = head;
  // A map whose ground is plain everywhere reads back with no classes, as it was written: the same map, and no grid held.
  return { id, dims, minY, stepY, seaLevel, heights, tint, ...(ground.some((v) => v !== 0) ? { ground } : {}), ...(road && road.across.some((v) => v !== 0) ? { road } : {}), ...(streets.length > 0 ? { streets } : {}), statics: finish(joinStatics(head, statics, order)), nodes, spawns, ...(head.tideEyes ? { tideEyes: head.tideEyes } : {}), ...(head.orbs ? { orbs: head.orbs } : {}), ...(regions.length > 0 ? { regions } : {}), ...(vehicles.length > 0 ? { vehicles } : {}), ...(mapWater ? { water: mapWater } : {}), ...content, ...(tops.length > 0 ? { tops: joinTops(tops) } : {}), ...(buildings ? { buildings } : {}), hash };
}

/** The water of a map's overviews (OverviewPiece.water) as the map's, every overview's given, or null where its head has no WATR. */
export function joinWater(head: MapHead, overviews: readonly { readonly chunks: Uint32Array; readonly squares: Uint16Array }[]): MapWater | null {
  if (!head.water) return null;
  const per = (CHUNK_SIZE / head.water.cell) * (CHUNK_SIZE / head.water.cell);
  const held = overviews.flatMap((w) => [...w.chunks].map((c, k) => [c, w.squares.subarray(k * per, k * per + per)] as const)).sort((a, b) => a[0] - b[0]);
  const squares = new Uint16Array(held.length * per);
  held.forEach(([, s], k) => squares.set(s, k * per));
  return new MapWater(head.dims, head.minY, head.stepY, head.water.cell, head.water.bodies, Uint32Array.from(held, ([c]) => c), squares);
}

/** The tops of overviews' squares as one map's, its chunks ascending. */
function joinTops(pieces: readonly TopsPiece[]): MapTops {
  const at = pieces.flatMap((p) => [...p.chunks].map((c, k) => [c, p, k] as const)).sort((a, b) => a[0] - b[0]);
  const [top, tint] = [new Uint8Array(at.length * FAR_CELLS), new Uint8Array(at.length * FAR_CELLS)];
  at.forEach(([, p, k], i) => {
    top.set(p.top.subarray(k * FAR_CELLS, (k + 1) * FAR_CELLS), i * FAR_CELLS);
    tint.set(p.tint.subarray(k * FAR_CELLS, (k + 1) * FAR_CELLS), i * FAR_CELLS);
  });
  return { chunks: Uint32Array.from(at, ([c]) => c), top, tint };
}

/**
 * Sets `out` to the far feed's cells of `chunk` as `tops` (a map's, or an overview's tops part) holds them, every cell empty
 * where it holds none of it. True where it holds them.
 */
export function topsOf(tops: MapTops, chunk: number, out: FarCells): boolean {
  let [lo, hi] = [0, tops.chunks.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops.chunks[mid]! < chunk) lo = mid + 1;
    else hi = mid;
  }
  if (tops.chunks[lo] !== chunk) {
    out.top.fill(0);
    out.tint.fill(0);
    out.filled = 0;
    return false;
  }
  out.top.set(tops.top.subarray(lo * FAR_CELLS, (lo + 1) * FAR_CELLS));
  out.tint.set(tops.tint.subarray(lo * FAR_CELLS, (lo + 1) * FAR_CELLS));
  out.filled = 0;
  for (const t of out.top) if (t !== 0) out.filled++;
  return true;
}

/**
 * The far feed's cells of every chunk of `map` as the server bakes them once its statics are set down (shared/world/tactical.ts
 * bakeChunk), which a map's maker writes into its overviews' tops parts.
 */
export function mapTops(map: MapData, reg: Registry): MapTops {
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const hf = mapHeightfield(map);
  const shapes = pieceShapes(reg);
  const summary = new Summary();
  const chunks: number[] = [];
  const cells: Uint8Array[] = [];
  for (const c of structs.held) {
    bakeChunk(structs.chunks[c]!, chunkCx(map.dims, c) * CHUNK_SIZE, chunkCz(map.dims, c) * CHUNK_SIZE, shapes, hf, summary);
    if (summary.far.filled === 0) continue;
    chunks.push(c);
    cells.push(summary.far.top.slice(), summary.far.tint.slice());
  }
  const [top, tint] = [new Uint8Array(chunks.length * FAR_CELLS), new Uint8Array(chunks.length * FAR_CELLS)];
  for (let k = 0; k < chunks.length; k++) {
    top.set(cells[k * 2]!, k * FAR_CELLS);
    tint.set(cells[k * 2 + 1]!, k * FAR_CELLS);
  }
  return { chunks: Uint32Array.from(chunks), top, tint };
}

/**
 * The map in a file: its head and every part read and joined. Throws with a reason if the file is not a map this build can
 * play on; a part that is damaged is named. Without `verify` its hashes are taken on trust. Its roads' frame is kept
 * where it is `drawn` from, and read past elsewhere.
 */
export function parseMap(file: Uint8Array, verify = true, drawn = false): MapFile {
  const head = readHead(file, verify);
  const end = head.parts.reduce((at, p) => Math.max(at, p.at + p.length), head.bytes);
  if (file.length < end) throw new Error("map: it is cut short");
  if (file.length > end) throw new Error("map: it runs on past its last part");
  const map = joinParts(head, head.parts.map((p) => readPart(head, p, file.subarray(p.at, p.at + p.length), verify)), true, drawn);
  if (head.counts.some((n, c) => map.statics.first[c + 1]! - map.statics.first[c]! !== n)) throw new Error("map: its statics are not as many a chunk as its head counts");
  const held = map.water?.chunks() ?? new Uint32Array(0);
  if (held.length !== head.coarse.water.length || held.some((c, k) => c !== head.coarse.water[k])) throw new Error("map: its head's chunks of water are not those its overviews hold");
  check(map);
  return map;
}

/** The head and each part of a map's file, with its file's name: what a server serves and a build writes beside the map. */
export function partsOf<B extends ArrayBufferLike>(file: Uint8Array<B>): { name: string; part: MapPart | null; bytes: Uint8Array<B> }[] {
  const head = readHead(file, false);
  return [{ name: head.name, part: null, bytes: file.subarray(0, head.bytes) }, ...head.parts.map((p) => ({ name: p.name, part: p, bytes: file.subarray(p.at, p.at + p.length) }))];
}
export function mapHeightfield(map: MapData): Heightfield {
  const hf = new Heightfield(map.dims, TERRAIN_CELL, map.minY, map.stepY, map.heights, map.tint, map.ground);
  hf.seaLevel = map.seaLevel;
  hf.water = map.water ?? null;
  if (map.road) {
    hf.road = new RoadSectors();
    hf.road.put(0, 0, 0, (map.dims.chunksX * CHUNK_SAMPLES) / 2 + 1, map.road);
  }
  if (map.streets) {
    hf.streets = new StreetSectors();
    const dims = framed(map.dims);
    for (const p of map.streets) {
      const sq = squareOf(dims, SECTOR_CHUNKS, p.col, p.row)!;
      holdStreets(hf.streets, { kind: "streets", sq, part: p.part ?? decodeStreets(p.bytes, sq.ox * CHUNK_SIZE, sq.oz * CHUNK_SIZE), bytes: p.bytes });
    }
  }
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

/** What a scattered or zoned layer grows at a place, by content index (KindsAt in shared/world/nodes.ts). */
function kindsOf(dims: MapDims, reg: Registry, layer: NodeScatter | NodeZoned): KindsAt {
  const wide = (cell: number): number => (dims.chunksX * CHUNK_SIZE) / cell;
  if ("zone" in layer) {
    const own: (readonly number[] | null)[] = [null, ...layer.zones.map((z) => weighed(reg, z.kinds, z.bare))];
    const zones = layer.codes ? Array.from(layer.codes, (c) => own[c]!) : own;
    const { zone, zoneCell: cell } = layer;
    const across = wide(cell);
    return (x, z) => zones[zone[Math.floor(z / cell) * across + Math.floor(x / cell)]!]!;
  }
  const kinds = weighed(reg, layer.kinds);
  const { allow, allowCell: cell } = layer;
  if (!allow) return () => kinds;
  const across = wide(cell);
  return (x, z) => {
    const bit = Math.floor(z / cell) * across + Math.floor(x / cell);
    return ((allow[bit >> 3]! >> (bit & 7)) & 1) === 1 ? kinds : null;
  };
}

/** A scattered or zoned layer's bits of where its nodes stand: its own once resolved, else resolved now on `hf` (resolveSlots). */
function standing(dims: MapDims, hf: Heightfield, reg: Registry, layer: NodeScatter | NodeZoned, tally?: SlotsTaken): { out: Uint8Array; other: Uint8Array } {
  if (layer.out && layer.other) return { out: layer.out, other: layer.other };
  return resolveSlots(dims, hf, layer.seed, layer.perChunk, nodeForms(reg), kindsOf(dims, reg, layer), layer.out, tally);
}

/**
 * `map` with each scattered and zoned layer resolved on its own ground, as its file holds it: whether each slot's node stands,
 * and as what, decided once by the rule of where nodes stand (resolveSlots in shared/world/nodes.ts) and kept in its `out` and
 * `other` bits, so that a reader needs only its overviews' bits, its pictures and a slot's hash to know a node's place, kind,
 * form and turn. Slots a layer's `out` already takes out stay out. A layer already resolved is kept as it is. A map made in
 * code is resolved so as it is made, before it is written.
 */
export function resolveNodes(map: MapData, reg: Registry, tally?: SlotsTaken): MapData {
  if (map.nodes.every((layer) => "first" in layer || (layer.out && layer.other))) return map;
  const hf = mapHeightfield(map);
  return { ...map, nodes: map.nodes.map((layer) => ("first" in layer ? layer : { ...layer, ...standing(map.dims, hf, reg, layer, tally) })) };
}

function layerSource(dims: MapDims, hf: Heightfield, reg: Registry, layer: NodeLayer): NodeSource {
  const forms = nodeForms(reg);
  if (!("first" in layer)) {
    const { out, other } = standing(dims, hf, reg, layer);
    return placedNodes(dims, hf, layer.seed, layer.perChunk, forms, kindsOf(dims, reg, layer), out, other);
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
