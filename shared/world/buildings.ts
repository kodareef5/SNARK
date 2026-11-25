// A map's buildings: what each is, where its frame lies, and which of a chunk's slots are its pieces. A map file holds them
// a sector at a time (shared/world/mapfile.ts, the buildings part), and a piece's building, storey and tile come from its
// slot and its place alone: nothing is stored a piece.
//
// A building's frame is the grid its maker laid it out on: `cols` by `rows` tiles of `bay` metres round (x, z), turned by
// `yaw`, its ground storey's floor at `base`. Tile (i, j) has its middle at u = (i - (cols - 1) / 2) * bay and
// v = (j - (rows - 1) / 2) * bay, and a point of the frame stands at x + u * c + v * s, z - u * s + v * c. A wall stands on
// a tile's edge and a pier on its corner, so a place is told in half tiles (placeOf): an odd number is a tile's middle
// (tile (n - 1) / 2), an even one the edge between tiles n / 2 - 1 and n / 2. A storey is 4 m, and a slab is the lid of the
// storey under it.
//
// A chunk's pieces are in the order building, then storey, so a building's pieces in a chunk are a run of slots, and a
// storey's a run within it. A building that stands in two sectors has a row in each, with the same id.

import { CHUNK_SIZE, SECTOR_CHUNKS, STRUCT_UNITS, YAW_UNITS, chunkAt, chunkCx, chunkCz, framed, type FramedDims, type MapDims } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { BitWriter } from "../net/codec.ts";
import { decodeUtf8 } from "../pack/pack.ts";
import { HIT_PREFIX } from "./bends.ts";

/** Metres a storey. */
export const STOREY = 4;
/**
 * Metres under a storey's floor that still count as that storey: more than a place's rounding, less than the 0.2 m a
 * slab's middle lies under its top, so a slab is the lid of the storey below it.
 */
export const STOREY_SLACK = 1 / 16;
/** The version of the head's names (a map's BLDG). */
export const BUILDINGS_VERSION = 1;
/** The version of a sector's buildings as a part holds them: 2 names its own tables, 1 the head's (maps of version 11). */
const PART_VERSION = 2;
const HEAD_NAMED = 1;
/** A building's flags: a stair climbs in it, one reaches its roof, it is a place its city names by hand, it has a row in another sector. */
export const BUILDING_STAIRS = 1;
export const BUILDING_ROOF = 2;
export const BUILDING_NAMED = 4;
export const BUILDING_SPANS = 8;
/** A stair's flag: it is the escape beside a core, not the core. */
export const STAIR_ESCAPE = 1;
/** Buildings a sector may hold, strings its buildings may name, and stairs a building may have. */
const MOST = 65535;
const MOST_STAIRS = MOST;
/** The most an id may be: 48 bits. */
const MOST_ID = 281474976710655;
/** A base is told in sixteenths of a metre, as a maker rounds it, and a frame's width and depth too. */
const BASE_UNITS = 16;
/** Bytes of a name or a part of an address. */
const TEXT_BYTES = 255;
/** A building's bytes in a part's columns. */
const ROW_BYTES = 6 + 9 + 3 * 2 + 2 * 4 + 6 * 2 + 2;

/** What the numbers of a building's columns stand for: a map's head holds them once (BLDG). */
export interface BuildingNames {
  /** What the data calls a building: "apartment_block", "house". */
  readonly kinds: readonly string[];
  /** The maker's recipe and form. */
  readonly recipes: readonly string[];
  readonly forms: readonly string[];
  /** How it fell. */
  readonly collapses: readonly string[];
  readonly districts: readonly string[];
}

/** A stair of a building: its tile, the storeys it climbs, and whether it is an escape. It never falls. */
export interface BuildingStair {
  readonly i: number;
  readonly j: number;
  readonly floors: number;
  readonly escape: boolean;
}

/** A building as its maker knows it, in the map's metres; `yaw` in 1/65,536 turns. */
export interface BuildingRow {
  /** Whole, below 2^48, and no other building's. */
  readonly id: number;
  readonly kind: string;
  readonly recipe: string;
  readonly form: string;
  readonly district: string;
  readonly collapse: string;
  readonly storeys: number;
  readonly playable: number;
  /** A stair reaches its roof; it is a place its city names by hand. */
  readonly roof: boolean;
  readonly named: boolean;
  readonly name: string | null;
  readonly address: string | null;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly bay: number;
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly depth: number;
  readonly base: number;
  readonly stairs: readonly BuildingStair[];
}

/** A building's frame, with the cosine and sine of its turn. */
export interface BuildingFrame {
  x: number;
  z: number;
  yaw: number;
  c: number;
  s: number;
  bay: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  base: number;
}

export function blankFrame(): BuildingFrame {
  return { x: 0, z: 0, yaw: 0, c: 1, s: 0, bay: 8, cols: 0, rows: 0, width: 0, depth: 0, base: 0 };
}

/** Where placeOf leaves a place: in half tiles from the frame's least corner along i and j. */
export const place = { hi: 0, hj: 0 };

/** The place of (x, z) in frame `f`, into `place`: the nearest tile's middle, edge or corner. */
export function placeOf(f: BuildingFrame, x: number, z: number): void {
  const dx = x - f.x, dz = z - f.z;
  // Plus nought: a place a hair under the least corner is 0, not the -0 a rounding gives.
  place.hi = Math.round(((dx * f.c - dz * f.s) / f.bay) * 2 + f.cols) + 0;
  place.hj = Math.round(((dx * f.s + dz * f.c) / f.bay) * 2 + f.rows) + 0;
}

/** The tile (x, z) is in, j * cols + i, held within the frame: a wall on the frame's rim is its rim tile's. */
export function tileOf(f: BuildingFrame, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z;
  const i = Math.floor((dx * f.c - dz * f.s) / f.bay + f.cols / 2), j = Math.floor((dx * f.s + dz * f.c) / f.bay + f.rows / 2);
  const most = (n: number): number => (n > 0 ? n - 1 : 0);
  return (j < 0 ? 0 : j > most(f.rows) ? most(f.rows) : j) * (f.cols > 0 ? f.cols : 1) + (i < 0 ? 0 : i > most(f.cols) ? most(f.cols) : i);
}

/** The storey a height `y` is in, the ground storey 0, and no storey below it. */
export function storeyAt(f: BuildingFrame, y: number): number {
  const n = Math.floor((y - f.base + STOREY_SLACK) / STOREY);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/** A sector's square as it lies on a map: its column and row on the lattice and the map's chunks it holds. */
interface Held {
  readonly col: number;
  readonly row: number;
  readonly ox: number;
  readonly oz: number;
  readonly cx0: number;
  readonly cz0: number;
  readonly cx1: number;
  readonly cz1: number;
}

function heldOf(dims: FramedDims, col: number, row: number): Held | null {
  const ox = col * SECTOR_CHUNKS - dims.frameX, oz = row * SECTOR_CHUNKS - dims.frameZ;
  const sq = { col, row, ox, oz, cx0: Math.max(0, ox), cz0: Math.max(0, oz), cx1: Math.min(dims.chunksX, ox + SECTOR_CHUNKS), cz1: Math.min(dims.chunksZ, oz + SECTOR_CHUNKS) };
  return sq.cx0 < sq.cx1 && sq.cz0 < sq.cz1 ? sq : null;
}

/** Bytes written one after another. */
class Bytes {
  bytes = new Uint8Array(1024);
  at = 0;

  take(n: number): number {
    const at = this.at;
    if (at + n > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.bytes.length * 2, at + n));
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.at = at + n;
    return at;
  }

  /** `n` whole numbers of `wide` bytes each as planes: every one's low byte, then the next. */
  planes(n: number, wide: number, of: (k: number) => number): void {
    const at = this.take(n * wide);
    for (let k = 0; k < n; k++) {
      let v = of(k);
      for (let b = 0; b < wide; b++) {
        this.bytes[at + b * n + k] = v % 256;
        v = Math.floor(v / 256);
      }
    }
  }

  /** One byte. Room is taken before `bytes` is read, which taking it may replace. */
  u8(v: number): void {
    const at = this.take(1);
    this.bytes[at] = v;
  }

  varint(v: number): void {
    for (; ; v = Math.floor(v / 128)) {
      this.u8((v % 128) | (v > 127 ? 128 : 0));
      if (v <= 127) return;
    }
  }

  put(src: Uint8Array): void {
    const at = this.take(src.length);
    this.bytes.set(src, at);
  }
}

/** The five tables of `names` in the order a part holds them. */
const tablesOf = (names: BuildingNames): readonly (readonly string[])[] => [names.kinds, names.recipes, names.forms, names.districts, names.collapses];

const placesOf = new WeakMap<readonly string[], Map<string, number>>();
/** A table's names by their places, made once a table. */
function placeIn(table: readonly string[]): Map<string, number> {
  let m = placesOf.get(table);
  if (!m) placesOf.set(table, (m = new Map(table.map((name, k) => [name, k]))));
  return m;
}

/** Bytes read one after another; a read past their end throws a RangeError, as a map's reader expects. */
class Read {
  readonly bytes: Uint8Array;
  at = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  take(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.bytes.length) throw new RangeError();
    this.at += n;
    return this.bytes.subarray(this.at - n, this.at);
  }

  planes<T extends Uint8Array | Uint16Array | Uint32Array | Int32Array | Float64Array>(into: T, wide: number): T {
    const n = into.length, b = this.take(n * wide);
    for (let k = 0; k < n; k++) {
      let v = 0;
      for (let p = wide - 1; p >= 0; p--) v = v * 256 + b[p * n + k]!;
      into[k] = v;
    }
    return into;
  }

  varint(): number {
    let v = 0;
    for (let scale = 1; ; scale *= 128) {
      if (scale > 34359738368) throw new RangeError();
      const b = this.take(1)[0]!;
      v += (b & 127) * scale;
      if (b < 128) return v;
    }
  }
}

const fail = (what: string): never => {
  throw new Error(`map: ${what}`);
};

/**
 * One sector's buildings as columns, a row a building, and its chunks' runs of slots. `runAt[k]` up to `runAt[k + 1]` are
 * the runs of the square's k-th chunk, row by row, ascending by slot. Run r is `runCount[r]` slots from `runSlot[r]`, of
 * building `runOf[r]`, its first storey `runStorey[r]`; `steps[stepAt[r] + q]` of its slots are in its first q + 1 storeys.
 */
export class SectorBuildings {
  readonly col: number;
  readonly row: number;
  readonly n: number;
  readonly id: Float64Array;
  readonly kind: Uint8Array;
  readonly recipe: Uint8Array;
  readonly form: Uint8Array;
  readonly district: Uint8Array;
  readonly collapse: Uint8Array;
  readonly flags: Uint8Array;
  readonly storeys: Uint8Array;
  readonly playable: Uint8Array;
  readonly bay: Uint8Array;
  /** A string's number counting from 1, or 0 for none: its name, and its address as a number and a street. */
  readonly name: Uint16Array;
  readonly number: Uint16Array;
  readonly street: Uint16Array;
  /** Its frame's middle in 1/512 m from the square's corner, which may lie off the map. */
  readonly ux: Int32Array;
  readonly uz: Int32Array;
  readonly yaw: Uint16Array;
  /** In sixteenths of a metre, the base from the datum. */
  readonly base: Int32Array;
  readonly width: Uint16Array;
  readonly depth: Uint16Array;
  readonly cols: Uint16Array;
  readonly rows: Uint16Array;
  /** Building b's stairs are `stairAt[b]` up to `stairAt[b + 1]`. */
  readonly stairAt: Uint32Array;
  readonly stairI: Uint16Array;
  readonly stairJ: Uint16Array;
  readonly stairFloors: Uint8Array;
  readonly stairFlags: Uint8Array;
  /** Its strings' UTF-8 one after another: string k counting from 1 is `textAt[k - 1]` up to `textAt[k]`. */
  readonly text: Uint8Array;
  readonly textAt: Uint32Array;
  readonly runAt: Uint32Array;
  readonly runSlot: Uint16Array;
  readonly runCount: Uint16Array;
  readonly runOf: Uint16Array;
  readonly runStorey: Uint8Array;
  readonly stepAt: Uint32Array;
  readonly steps: Uint16Array;
  /** Its buildings in the order of their ids, and each one's runs as a chain, made when first asked. */
  private order: Uint32Array | null = null;
  private chain: { first: Int32Array; next: Int32Array } | null = null;

  constructor(col: number, row: number, n: number, stairs: number, text: Uint8Array, textAt: Uint32Array, chunks: number, runs: number, steps: number) {
    this.col = col;
    this.row = row;
    this.n = n;
    this.id = new Float64Array(n);
    [this.kind, this.recipe, this.form, this.district, this.collapse, this.flags, this.storeys, this.playable, this.bay] = Array.from({ length: 9 }, () => new Uint8Array(n)) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    [this.name, this.number, this.street, this.yaw, this.width, this.depth, this.cols, this.rows] = Array.from({ length: 8 }, () => new Uint16Array(n)) as [Uint16Array, Uint16Array, Uint16Array, Uint16Array, Uint16Array, Uint16Array, Uint16Array, Uint16Array];
    [this.ux, this.uz, this.base] = [new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    this.stairAt = new Uint32Array(n + 1);
    [this.stairI, this.stairJ] = [new Uint16Array(stairs), new Uint16Array(stairs)];
    [this.stairFloors, this.stairFlags] = [new Uint8Array(stairs), new Uint8Array(stairs)];
    this.text = text;
    this.textAt = textAt;
    this.runAt = new Uint32Array(chunks + 1);
    [this.runSlot, this.runCount, this.runOf] = [new Uint16Array(runs), new Uint16Array(runs), new Uint16Array(runs)];
    this.runStorey = new Uint8Array(runs);
    this.stepAt = new Uint32Array(runs + 1);
    this.steps = new Uint16Array(steps);
  }

  /** Bytes it holds in memory. */
  get bytes(): number {
    let n = this.text.length;
    for (const v of Object.values(this)) if (ArrayBuffer.isView(v) && v !== this.text) n += v.byteLength;
    return n;
  }

  /** String `k` counting from 1, or null for 0. */
  string(k: number): string | null {
    return k === 0 ? null : decodeUtf8(this.text.subarray(this.textAt[k - 1]!, this.textAt[k]!));
  }

  /** The run of the square's `k`-th chunk that holds `slot`, or -1. */
  runOfSlot(k: number, slot: number): number {
    let lo = this.runAt[k]!, hi = this.runAt[k + 1]! - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.runSlot[mid]! > slot) hi = mid - 1;
      else if (this.runSlot[mid]! + this.runCount[mid]! <= slot) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  /** The storey of the slot `off` slots into run `r`. */
  storeyIn(r: number, off: number): number {
    let lo = this.stepAt[r]!, hi = this.stepAt[r + 1]! - 1;
    const from = lo;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.steps[mid]! > off) hi = mid;
      else lo = mid + 1;
    }
    return this.runStorey[r]! + lo - from;
  }

  /**
   * The slot of its chunk at which run `r`'s pieces of storey `storey` start: the run's first for a storey under its
   * lowest, and one past its last for a storey over its highest. A storey's slots end where the next storey's start.
   */
  storeyStart(r: number, storey: number): number {
    const q = storey - this.runStorey[r]!, n = this.stepAt[r + 1]! - this.stepAt[r]!;
    return this.runSlot[r]! + (q <= 0 ? 0 : q >= n ? this.runCount[r]! : this.steps[this.stepAt[r]! + q - 1]!);
  }

  /** The building of id `id`, or -1. */
  find(id: number): number {
    const order = (this.order ??= Uint32Array.from({ length: this.n }, (_, k) => k).sort((a, b) => this.id[a]! - this.id[b]!));
    let lo = 0, hi = this.n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, v = this.id[order[mid]!]!;
      if (v === id) return order[mid]!;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /** Calls `each` with every run of building `b`: the square's chunk it is in, counted row by row, and the run. */
  eachRun(b: number, each: (k: number, run: number) => void): void {
    if (!this.chain) {
      const first = new Int32Array(this.n).fill(-1), next = new Int32Array(this.runOf.length);
      for (let r = this.runOf.length - 1; r >= 0; r--) {
        next[r] = first[this.runOf[r]!]!;
        first[this.runOf[r]!] = r;
      }
      this.chain = { first, next };
    }
    for (let r = this.chain.first[b]!, k = 0; r >= 0; r = this.chain.next[r]!) {
      while (this.runAt[k + 1]! <= r) k++;
      each(k, r);
    }
  }

  /**
   * Its bytes as a map's part holds them (shared/world/mapfile.ts), its numbers those of `names`: each of the five tables
   * written as the names it uses, in their order there, so its bytes depend on its own buildings alone.
   */
  encode(names: BuildingNames): Uint8Array {
    const o = new Bytes(), n = this.n;
    o.u8(PART_VERSION);
    o.planes(1, 2, () => n);
    const columns = [this.kind, this.recipe, this.form, this.district, this.collapse];
    const own = tablesOf(names).map((table, t) => {
      const column = columns[t]!, used = new Uint8Array(table.length), place = new Uint8Array(table.length);
      for (let k = 0; k < n; k++) used[column[k]!] = 1;
      let count = 0;
      for (let k = 0; k < table.length; k++) if (used[k]) place[k] = count++;
      o.u8(count);
      for (let k = 0; k < table.length; k++) {
        if (!used[k]) continue;
        const w = new BitWriter(4 + table[k]!.length * 3);
        w.string(table[k]!);
        o.put(w.bytes());
      }
      return Uint8Array.from(column, (v) => place[v]!);
    });
    o.planes(n, 6, (k) => this.id[k]!);
    for (const column of [...own, this.flags, this.storeys, this.playable, this.bay]) o.put(column);
    for (const column of [this.name, this.number, this.street]) o.planes(n, 2, (k) => column[k]!);
    for (const column of [this.ux, this.uz]) o.planes(n, 4, (k) => column[k]! >>> 0);
    for (const column of [this.yaw, this.base, this.width, this.depth, this.cols, this.rows]) o.planes(n, 2, (k) => column[k]! & 0xffff);
    o.planes(n, 2, (k) => this.stairAt[k + 1]! - this.stairAt[k]!);
    const stairs = this.stairI.length;
    o.planes(stairs, 2, (k) => this.stairI[k]!);
    o.planes(stairs, 2, (k) => this.stairJ[k]!);
    o.put(this.stairFloors);
    o.put(this.stairFlags);
    const strings = this.textAt.length - 1;
    o.planes(1, 2, () => strings);
    for (let k = 0; k < strings; k++) o.u8(this.textAt[k + 1]! - this.textAt[k]!);
    o.put(this.text);
    const chunks = this.runAt.length - 1, runs = this.runOf.length;
    o.planes(chunks, 2, (k) => this.runAt[k + 1]! - this.runAt[k]!);
    o.planes(runs, 2, (r) => this.runSlot[r]!);
    o.planes(runs, 2, (r) => this.runOf[r]!);
    o.put(this.runStorey);
    o.planes(runs, 1, (r) => this.stepAt[r + 1]! - this.stepAt[r]!);
    // A storey's count of slots, not its step: a small number, and most are below 128.
    for (let r = 0; r < runs; r++) for (let q = this.stepAt[r]!; q < this.stepAt[r + 1]!; q++) o.varint(this.steps[q]! - (q > this.stepAt[r]! ? this.steps[q - 1]! : 0));
    return o.bytes.slice(0, o.at);
  }

  /**
   * The buildings of the sector at `col`, `row` of the map of `dims` from a part's bytes, each number checked against
   * `names` and each run against `counts`, the statics each of the map's chunks holds, where they are known. Throws,
   * saying what is wrong.
   */
  static decode(dims: FramedDims, names: BuildingNames, counts: ArrayLike<number> | null, col: number, row: number, bytes: Uint8Array): SectorBuildings {
    const sq = heldOf(dims, col, row) ?? fail(`its buildings of sector ${col}, ${row} lie off the map`);
    const s = new Read(bytes);
    const version = s.take(1)[0];
    if (version !== PART_VERSION && version !== HEAD_NAMED) fail("its buildings are of a version this build does not read: build the map again");
    const n = s.planes(new Uint16Array(1), 2)[0]!;
    // Each table's names as their places in the head's, or null where the part names the head's.
    const own = version === HEAD_NAMED ? null : tablesOf(names).map((table) => {
      const place = placeIn(table), count = s.take(1)[0]!, out = new Uint8Array(count);
      for (let k = 0; k < count; k++) {
        const name = decodeUtf8(s.take(s.varint()));
        const at = place.get(name);
        if (at === undefined) fail("a building is of a kind, a form or a district its head does not name");
        out[k] = at!;
      }
      return out;
    });
    const head = s.take(n * ROW_BYTES);
    // A building's count of stairs is the last of its columns, two bytes.
    const stairsOf = (k: number): number => head[(ROW_BYTES - 2) * n + k]! | (head[(ROW_BYTES - 1) * n + k]! << 8);
    let stairs = 0;
    for (let k = 0; k < n; k++) stairs += stairsOf(k);
    const tail = new Read(bytes.subarray(s.at));
    const stair = tail.take(stairs * 6);
    const strings = tail.planes(new Uint16Array(1), 2)[0]!;
    const textAt = new Uint32Array(strings + 1);
    const lengths = tail.take(strings);
    for (let k = 0; k < strings; k++) textAt[k + 1] = textAt[k]! + lengths[k]!;
    const text = tail.take(textAt[strings]!).slice();
    const chunks = (sq.cx1 - sq.cx0) * (sq.cz1 - sq.cz0);
    const perChunk = tail.planes(new Uint16Array(chunks), 2);
    const runs = perChunk.reduce((a, b) => a + b, 0);
    const runBytes = tail.take(runs * 6);
    let steps = 0;
    for (let r = 0; r < runs; r++) steps += runBytes[5 * runs + r]!;
    const t = new SectorBuildings(col, row, n, stairs, text, textAt, chunks, runs, steps);
    const columns = new Read(head);
    columns.planes(t.id, 6);
    for (const column of [t.kind, t.recipe, t.form, t.district, t.collapse, t.flags, t.storeys, t.playable, t.bay]) column.set(columns.take(n));
    if (own) {
      [t.kind, t.recipe, t.form, t.district, t.collapse].forEach((column, c) => {
        const table = own[c]!;
        for (let k = 0; k < n; k++) {
          if (column[k]! >= table.length) fail("a building is of a kind, a form or a district its head does not name");
          column[k] = table[column[k]!]!;
        }
      });
    }
    for (const column of [t.name, t.number, t.street]) columns.planes(column, 2);
    for (const column of [t.ux, t.uz]) columns.planes(column, 4);
    columns.planes(t.yaw, 2);
    // The base alone goes below zero.
    const base = columns.planes(new Uint16Array(n), 2);
    for (let k = 0; k < n; k++) t.base[k] = (base[k]! << 16) >> 16;
    for (const column of [t.width, t.depth, t.cols, t.rows]) columns.planes(column, 2);
    for (let k = 0; k < n; k++) t.stairAt[k + 1] = t.stairAt[k]! + stairsOf(k);
    const stairRead = new Read(stair);
    stairRead.planes(t.stairI, 2);
    stairRead.planes(t.stairJ, 2);
    t.stairFloors.set(stairRead.take(stairs));
    t.stairFlags.set(stairRead.take(stairs));
    for (let k = 0; k < chunks; k++) t.runAt[k + 1] = t.runAt[k]! + perChunk[k]!;
    const runRead = new Read(runBytes);
    runRead.planes(t.runSlot, 2);
    runRead.planes(t.runOf, 2);
    t.runStorey.set(runRead.take(runs));
    for (let r = 0; r < runs; r++) t.stepAt[r + 1] = t.stepAt[r]! + runBytes[5 * runs + r]!;
    for (let r = 0; r < runs; r++) {
      let sum = 0;
      for (let q = t.stepAt[r]!; q < t.stepAt[r + 1]!; q++) {
        sum += tail.varint();
        if (sum > MOST) fail("a run of a building's slots is longer than a chunk");
        t.steps[q] = sum;
      }
      t.runCount[r] = sum;
    }
    if (tail.at !== tail.bytes.length) fail(`its buildings of sector ${col}, ${row} run on past what they hold`);
    t.check(dims, names, counts, sq);
    return t;
  }

  /** Throws unless every number names what it should and every run lies in its chunk's slots, after the run before. */
  check(dims: FramedDims, names: BuildingNames, counts: ArrayLike<number> | null, sq: Held = heldOf(dims, this.col, this.row)!): void {
    const strings = this.textAt.length - 1;
    for (let k = 0; k < this.n; k++) {
      if (this.kind[k]! >= names.kinds.length || this.recipe[k]! >= names.recipes.length || this.form[k]! >= names.forms.length || this.district[k]! >= names.districts.length || this.collapse[k]! >= names.collapses.length) fail("a building is of a kind, a form or a district its head does not name");
      if (this.name[k]! > strings || this.number[k]! > strings || this.street[k]! > strings) fail("a building names a string its sector does not hold");
      if (this.bay[k] === 0) fail("a building's frame has no bay");
    }
    const w = sq.cx1 - sq.cx0;
    for (let k = 0; k + 1 < this.runAt.length; k++) {
      const most = counts ? counts[(sq.cz0 + Math.floor(k / w)) * dims.chunksX + sq.cx0 + (k % w)]! : MOST;
      for (let r = this.runAt[k]!, from = 0; r < this.runAt[k + 1]!; r++) {
        if (this.runOf[r]! >= this.n || this.runCount[r] === 0 || this.runSlot[r]! < from || this.runSlot[r]! + this.runCount[r]! > most) fail(`the runs of buildings' slots in sector ${this.col}, ${this.row} do not lie in their chunks' statics`);
        from = this.runSlot[r]! + this.runCount[r]!;
      }
    }
  }
}

/**
 * The buildings of a map, a sector's set in as it comes: the same table on a server, which holds them all, and on a page,
 * which holds those whose parts have come. A building is named by a handle, its sector's place among the map's times
 * 65,536 plus its row there; a building in two sectors has a handle in each and one id.
 */
export class Buildings {
  readonly dims: FramedDims;
  readonly names: BuildingNames;
  /** By a sector's place among the map's, row by row; null for one that has not come or holds none. */
  readonly sectors: (SectorBuildings | null)[];
  private readonly col0: number;
  private readonly row0: number;
  private readonly across: number;

  constructor(dims: MapDims, names: BuildingNames) {
    this.dims = framed(dims);
    this.names = names;
    const d = this.dims;
    this.col0 = Math.floor(d.frameX / SECTOR_CHUNKS);
    this.row0 = Math.floor(d.frameZ / SECTOR_CHUNKS);
    this.across = Math.floor((d.frameX + d.chunksX - 1) / SECTOR_CHUNKS) - this.col0 + 1;
    this.sectors = new Array<SectorBuildings | null>(this.across * (Math.floor((d.frameZ + d.chunksZ - 1) / SECTOR_CHUNKS) - this.row0 + 1)).fill(null);
  }

  /** Takes in a sector's buildings. */
  set(t: SectorBuildings): void {
    this.sectors[(t.row - this.row0) * this.across + t.col - this.col0] = t;
  }

  /** Buildings held, one in two sectors counted in each; and their bytes in memory. */
  get count(): number {
    return this.sectors.reduce((n, t) => n + (t?.n ?? 0), 0);
  }

  get bytes(): number {
    return this.sectors.reduce((n, t) => n + (t?.bytes ?? 0), 0);
  }

  /** The place among the map's sectors of the one `chunk` is in, and the chunk's place in that sector's square, row by row. */
  private sectorOf(chunk: number): number {
    const d = this.dims;
    return (Math.floor((d.frameZ + chunkCz(d, chunk)) / SECTOR_CHUNKS) - this.row0) * this.across + Math.floor((d.frameX + chunkCx(d, chunk)) / SECTOR_CHUNKS) - this.col0;
  }

  private within(sector: number, chunk: number): number {
    const d = this.dims;
    const col = this.col0 + (sector % this.across), row = this.row0 + Math.floor(sector / this.across);
    const cx0 = Math.max(0, col * SECTOR_CHUNKS - d.frameX), cz0 = Math.max(0, row * SECTOR_CHUNKS - d.frameZ);
    const cx1 = Math.min(d.chunksX, col * SECTOR_CHUNKS - d.frameX + SECTOR_CHUNKS);
    return (chunkCz(d, chunk) - cz0) * (cx1 - cx0) + chunkCx(d, chunk) - cx0;
  }

  /** The map's chunk that is the `k`-th of sector `sector`'s square. */
  private chunkOf(sector: number, k: number): number {
    const d = this.dims;
    const col = this.col0 + (sector % this.across), row = this.row0 + Math.floor(sector / this.across);
    const cx0 = Math.max(0, col * SECTOR_CHUNKS - d.frameX), cz0 = Math.max(0, row * SECTOR_CHUNKS - d.frameZ);
    const w = Math.min(d.chunksX, col * SECTOR_CHUNKS - d.frameX + SECTOR_CHUNKS) - cx0;
    return (cz0 + Math.floor(k / w)) * d.chunksX + cx0 + (k % w);
  }

  /** The building whose piece slot `slot` of `chunk` is, as a handle, or -1 for a piece of none or a sector not held. */
  buildingOf(chunk: number, slot: number): number {
    const sector = this.sectorOf(chunk), t = this.sectors[sector];
    if (!t) return -1;
    const r = t.runOfSlot(this.within(sector, chunk), slot);
    return r < 0 ? -1 : sector * 65536 + t.runOf[r]!;
  }

  /** The storey of the piece in slot `slot` of `chunk`, as its maker placed it, or -1 for a piece of no building. */
  storeyOf(chunk: number, slot: number): number {
    const sector = this.sectorOf(chunk), t = this.sectors[sector];
    if (!t) return -1;
    const r = t.runOfSlot(this.within(sector, chunk), slot);
    return r < 0 ? -1 : t.storeyIn(r, slot - t.runSlot[r]!);
  }

  /** The buildings with a piece in `chunk`, as handles, each once, in the order of their first slots. */
  inChunk(chunk: number): number[] {
    const sector = this.sectorOf(chunk), t = this.sectors[sector];
    if (!t) return [];
    const k = this.within(sector, chunk), out: number[] = [];
    for (let r = t.runAt[k]!; r < t.runAt[k + 1]!; r++) if (!out.includes(sector * 65536 + t.runOf[r]!)) out.push(sector * 65536 + t.runOf[r]!);
    return out;
  }

  /** Every handle held, a sector's after another's. */
  *handles(): IterableIterator<number> {
    for (let s = 0; s < this.sectors.length; s++) for (let k = 0; k < (this.sectors[s]?.n ?? 0); k++) yield s * 65536 + k;
  }

  /** A handle of the building of id `id`, or -1 where none is held; and with `all`, every sector's handle of it. */
  byId(id: number, all?: number[]): number {
    let found = -1;
    for (let s = 0; s < this.sectors.length; s++) {
      const k = this.sectors[s]?.find(id) ?? -1;
      if (k < 0) continue;
      if (found < 0) found = s * 65536 + k;
      if (!all) break;
      all.push(s * 65536 + k);
    }
    return found;
  }

  /** The sector's table a handle is of, whose columns hold the rest at `handle & 0xffff`. */
  table(handle: number): SectorBuildings {
    return this.sectors[handle >>> 16]!;
  }

  id(handle: number): number {
    return this.table(handle).id[handle & 0xffff]!;
  }

  kind(handle: number): string {
    return this.names.kinds[this.table(handle).kind[handle & 0xffff]!]!;
  }

  recipe(handle: number): string {
    return this.names.recipes[this.table(handle).recipe[handle & 0xffff]!]!;
  }

  form(handle: number): string {
    return this.names.forms[this.table(handle).form[handle & 0xffff]!]!;
  }

  district(handle: number): string {
    return this.names.districts[this.table(handle).district[handle & 0xffff]!]!;
  }

  collapse(handle: number): string {
    return this.names.collapses[this.table(handle).collapse[handle & 0xffff]!]!;
  }

  storeys(handle: number): number {
    return this.table(handle).storeys[handle & 0xffff]!;
  }

  playable(handle: number): number {
    return this.table(handle).playable[handle & 0xffff]!;
  }

  flags(handle: number): number {
    return this.table(handle).flags[handle & 0xffff]!;
  }

  name(handle: number): string | null {
    const t = this.table(handle);
    return t.string(t.name[handle & 0xffff]!);
  }

  /** Its address as it is written: its number and its street. */
  address(handle: number): string | null {
    const t = this.table(handle), k = handle & 0xffff;
    const number = t.string(t.number[k]!), street = t.string(t.street[k]!);
    return number !== null && street !== null ? `${number} ${street}` : (street ?? number);
  }

  /** Its frame, into `out`, in the map's metres. */
  frame(handle: number, out: BuildingFrame = blankFrame()): BuildingFrame {
    const t = this.table(handle), k = handle & 0xffff, d = this.dims;
    out.x = (t.col * SECTOR_CHUNKS - d.frameX) * CHUNK_SIZE + t.ux[k]! / STRUCT_UNITS;
    out.z = (t.row * SECTOR_CHUNKS - d.frameZ) * CHUNK_SIZE + t.uz[k]! / STRUCT_UNITS;
    out.yaw = t.yaw[k]!;
    const a = (out.yaw / YAW_UNITS) * TAU;
    out.c = detCos(a);
    out.s = detSin(a);
    out.bay = t.bay[k]!;
    out.cols = t.cols[k]!;
    out.rows = t.rows[k]!;
    out.width = t.width[k]! / BASE_UNITS;
    out.depth = t.depth[k]! / BASE_UNITS;
    out.base = t.base[k]! / BASE_UNITS;
    return out;
  }

  /** Its stairs, cores and escapes. */
  stairs(handle: number): BuildingStair[] {
    const t = this.table(handle), k = handle & 0xffff, out: BuildingStair[] = [];
    for (let q = t.stairAt[k]!; q < t.stairAt[k + 1]!; q++) out.push({ i: t.stairI[q]!, j: t.stairJ[q]!, floors: t.stairFloors[q]!, escape: (t.stairFlags[q]! & STAIR_ESCAPE) !== 0 });
    return out;
  }

  /** Whether tile (i, j) of it holds a stair, a core's or an escape's. */
  stairAt(handle: number, i: number, j: number): boolean {
    const t = this.table(handle), k = handle & 0xffff;
    for (let q = t.stairAt[k]!; q < t.stairAt[k + 1]!; q++) if (t.stairI[q] === i && t.stairJ[q] === j) return true;
    return false;
  }

  /**
   * Calls `each` with every run of its slots in this handle's sector: the chunk, the first slot, how many, and the run's
   * place in the sector's table (SectorBuildings `runStorey`, `stepAt` and `steps` say its storeys). One in two sectors
   * (BUILDING_SPANS) has the rest under its other handles (byId).
   */
  eachRun(handle: number, each: (chunk: number, slot: number, count: number, run: number) => void): void {
    const sector = handle >>> 16, t = this.table(handle);
    t.eachRun(handle & 0xffff, (k, r) => each(this.chunkOf(sector, k), t.runSlot[r]!, t.runCount[r]!, r));
  }

  /**
   * The buildings `rows` of a map of `dims` whose statics are `statics` in the map's order, `of[i]` the row of the building
   * the i-th is a piece of, or -1, and `storey[i]` its storey: each sector's table, with the runs of slots a file's reader
   * will find the pieces in. A piece's slot is its place among its chunk's in that order, as a file lays them out; a
   * collision piece of a bent one is none of the list's. A row with no piece is left out.
   */
  static of(dims: MapDims, rows: readonly BuildingRow[], statics: Iterable<{ readonly kind: string; readonly x: number; readonly z: number }>, of: ArrayLike<number>, storey: ArrayLike<number>): Buildings {
    const sorted = (pick: (r: BuildingRow) => string): string[] => [...new Set(rows.map(pick))].sort();
    const names: BuildingNames = { kinds: sorted((r) => r.kind), recipes: sorted((r) => r.recipe), forms: sorted((r) => r.form), collapses: sorted((r) => r.collapse), districts: sorted((r) => r.district) };
    for (const [what, list] of Object.entries(names)) if (list.length > 255) fail(`its buildings have ${list.length} ${what}, and a map names 255 at most`);
    const out = new Buildings(dims, names);
    const d = out.dims;
    // A sector's rows in the order its first pieces come, and each chunk's runs as they come.
    interface Run { slot: number; of: number; storey: number; counts: number[]; last: number }
    const made = out.sectors.map(() => ({ rows: [] as number[], local: new Map<number, number>(), runs: new Map<number, Run[]>() }));
    const slots = new Uint16Array(d.chunksX * d.chunksZ);
    const sectorsOf = new Map<number, number>();
    let i = -1;
    for (const p of statics) {
      i++;
      if (p.kind.startsWith(HIT_PREFIX)) continue;
      const chunk = chunkAt(d, Math.round(p.x * STRUCT_UNITS) / STRUCT_UNITS, Math.round(p.z * STRUCT_UNITS) / STRUCT_UNITS);
      const slot = slots[chunk]!++;
      const b = of[i]!;
      if (b < 0) continue;
      if (!rows[b]) fail(`a static piece is of building ${b}, and the map has ${rows.length}`);
      const sector = out.sectorOf(chunk), m = made[sector]!;
      let local = m.local.get(b);
      if (local === undefined) {
        m.local.set(b, (local = m.rows.length));
        m.rows.push(b);
        sectorsOf.set(b, (sectorsOf.get(b) ?? 0) + 1);
        if (local >= MOST) fail("a sector holds more than 65,535 buildings");
      }
      const k = out.within(sector, chunk);
      let runs = m.runs.get(k);
      if (!runs) m.runs.set(k, (runs = []));
      const s = Math.max(0, Math.min(255, storey[i]!));
      const run = runs[runs.length - 1];
      // The same run while the building's pieces come one after another, storeys ascending, within a u8 of storeys.
      if (run && run.of === local && run.slot + run.counts.reduce((a, c) => a + c, 0) === slot && s >= run.last && s - run.storey < 255) {
        while (run.storey + run.counts.length <= s) run.counts.push(0);
        run.counts[s - run.storey]!++;
        run.last = s;
      } else runs.push({ slot, of: local, storey: s, counts: [1], last: s });
    }
    out.sectors.forEach((_, sector) => {
      const m = made[sector]!;
      if (m.rows.length === 0) return;
      const col = out.col0 + (sector % out.across), row = out.row0 + Math.floor(sector / out.across);
      const sq = heldOf(d, col, row)!;
      // The strings in the order they are first named.
      const strings = new Map<string, number>();
      const string = (text: string | null): number => {
        if (text === null || text === "") return 0;
        let k = strings.get(text);
        if (k === undefined) strings.set(text, (k = strings.size + 1));
        if (k > MOST) fail("a sector's buildings name more than 65,535 strings");
        return k;
      };
      const named = m.rows.map((b) => {
        const r = rows[b]!, [number, street] = addressParts(r.address);
        return [string(clip(r.name)), string(clip(number)), string(clip(street))] as const;
      });
      const texts = [...strings.keys()].map((text) => {
        const w = new BitWriter(4 + text.length * 3);
        w.string(text);
        // Without its length, which is one byte below 128 and two from there to TEXT_BYTES.
        const b = w.bytes();
        return b.subarray(b[0]! < 128 ? 1 : 2);
      });
      const textAt = new Uint32Array(texts.length + 1);
      texts.forEach((b, k) => (textAt[k + 1] = textAt[k]! + b.length));
      const text = new Uint8Array(textAt[texts.length]!);
      texts.forEach((b, k) => text.set(b, textAt[k]!));
      const chunks = (sq.cx1 - sq.cx0) * (sq.cz1 - sq.cz0);
      const runs = [...m.runs.entries()].sort((a, b) => a[0] - b[0]);
      const t = new SectorBuildings(col, row, m.rows.length, m.rows.reduce((n, b) => n + rows[b]!.stairs.length, 0), text, textAt, chunks, runs.reduce((n, [, list]) => n + list.length, 0), runs.reduce((n, [, list]) => n + list.reduce((a, r) => a + r.counts.length, 0), 0));
      const whole = (v: number, lo: number, hi: number, what: string): number => (Number.isInteger(v) && v >= lo && v <= hi ? v : fail(`a building's ${what} is ${v}, and a map holds ${lo} to ${hi}`));
      m.rows.forEach((b, k) => {
        const r = rows[b]!;
        t.id[k] = whole(r.id, 0, MOST_ID, "id");
        [t.kind[k], t.recipe[k], t.form[k], t.district[k], t.collapse[k]] = [names.kinds.indexOf(r.kind), names.recipes.indexOf(r.recipe), names.forms.indexOf(r.form), names.districts.indexOf(r.district), names.collapses.indexOf(r.collapse)];
        t.flags[k] = (r.stairs.length > 0 ? BUILDING_STAIRS : 0) | (r.roof ? BUILDING_ROOF : 0) | (r.named ? BUILDING_NAMED : 0) | (sectorsOf.get(b)! > 1 ? BUILDING_SPANS : 0);
        t.storeys[k] = Math.max(0, Math.min(255, Math.round(r.storeys)));
        t.playable[k] = Math.max(0, Math.min(255, Math.round(r.playable)));
        t.bay[k] = whole(r.bay, 1, 255, "bay");
        [t.name[k], t.number[k], t.street[k]] = named[k]!;
        t.ux[k] = Math.round(r.x * STRUCT_UNITS) - sq.ox * CHUNK_SIZE * STRUCT_UNITS;
        t.uz[k] = Math.round(r.z * STRUCT_UNITS) - sq.oz * CHUNK_SIZE * STRUCT_UNITS;
        t.yaw[k] = whole(r.yaw, 0, YAW_UNITS - 1, "turn");
        t.base[k] = whole(Math.round(r.base * BASE_UNITS), -32768, 32767, "base in sixteenths of a metre");
        t.width[k] = Math.min(MOST, Math.round(r.width * BASE_UNITS));
        t.depth[k] = Math.min(MOST, Math.round(r.depth * BASE_UNITS));
        t.cols[k] = whole(r.cols, 0, MOST, "tiles across");
        t.rows[k] = whole(r.rows, 0, MOST, "tiles deep");
        if (r.stairs.length > MOST_STAIRS) fail(`a building has ${r.stairs.length} stairs, and a map holds ${MOST_STAIRS}`);
        t.stairAt[k + 1] = t.stairAt[k]! + r.stairs.length;
        r.stairs.forEach((stair, q) => {
          const at = t.stairAt[k]! + q;
          [t.stairI[at], t.stairJ[at], t.stairFloors[at], t.stairFlags[at]] = [whole(stair.i, 0, MOST, "stair's tile"), whole(stair.j, 0, MOST, "stair's tile"), Math.min(255, stair.floors), stair.escape ? STAIR_ESCAPE : 0];
        });
      });
      let r = 0, q = 0;
      for (const [k, list] of runs) {
        for (const run of list) {
          [t.runSlot[r], t.runOf[r], t.runStorey[r]] = [run.slot, run.of, run.storey];
          let sum = 0;
          for (const c of run.counts) t.steps[q++] = sum += c;
          t.runCount[r] = sum;
          t.stepAt[++r] = q;
        }
        t.runAt[k + 1] = r;
      }
      for (let k = 0; k < chunks; k++) if (t.runAt[k + 1]! < t.runAt[k]!) t.runAt[k + 1] = t.runAt[k]!;
      out.set(t);
    });
    return out;
  }
}

/** `text` held to a string's bytes: cut at a whole character where it is longer. */
function clip(text: string | null): string | null {
  if (text === null) return null;
  let out = "", bytes = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes > TEXT_BYTES) break;
    out += ch;
  }
  return out;
}

/** An address as its number and its street: "5700 Northwest 10th Avenue" is "5700" and the rest; one with no number is all street. */
export function addressParts(address: string | null): [number: string | null, street: string | null] {
  if (address === null || address === "") return [null, null];
  const space = address.indexOf(" ");
  return space > 0 && address.charCodeAt(0) >= 48 && address.charCodeAt(0) <= 57 && space < address.length - 1 ? [address.slice(0, space), address.slice(space + 1)] : [null, address];
}

/** What a player reads of a kind: "apartment_block" is "Apartment block". */
export function kindWords(kind: string): string {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
