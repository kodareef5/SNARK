// A structure is a row in its chunk's table, not an entity, with no per-tick cost. ref = chunk * 65536 + slot, stable until removed.
// Each slot records the table version that last changed it, so a client is brought up to date by a scan, without an op log.

import { CHUNK_SIZE, STRUCT_UNITS, chunkAt, chunkCount, type MapDims } from "../coords.ts";
import type { VehicleSurface } from "../sim/vehicle.ts";
import { hullPoint, type HullTable } from "./convex.ts";
import { HALF_SIDE, STRETCH_MOST, frame, frameOf } from "./frame.ts";

export const GRID_CELL = 4;
/**
 * The boxes bodies and rays meet. Kind `k` owns the boxes numbered `start[k]` up to `start[k + 1]`. Each box is six numbers in
 * `box`: its centre, measured from the structure's origin, then its half extents.
 */
export interface PartTable {
  readonly vehicleSurface?: readonly (VehicleSurface | null)[];
  readonly start: Uint32Array;
  readonly box: Float32Array;
  /** Convex parts, for kinds with sloped or three-sided forms. */
  readonly hulls?: HullTable;
}

/** A map's statics as columns grouped by chunk, as MapStatics holds them (shared/world/mapfile.ts). */
export interface PlacedRows {
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Uint16Array;
  /** The row of the map's `i`th piece, or empty where the rows are in the map's order. */
  readonly row: Uint32Array;
}

/** Every kind gets one box of its half extents. */
function oneBoxEach(halfX: Float32Array, halfY: Float32Array, halfZ: Float32Array): PartTable {
  const n = halfX.length;
  const start = new Uint32Array(n + 1);
  const box = new Float32Array(n * 6);
  for (let k = 0; k < n; k++) {
    start[k] = k;
    box[k * 6 + 3] = halfX[k]!;
    box[k * 6 + 4] = halfY[k]!;
    box[k * 6 + 5] = halfZ[k]!;
  }
  start[n] = n;
  return { start, box };
}

/** Grid cells per chunk side (64 m / 4 m). */
const CELLS = 16;
export const MAX_SLOTS_PER_CHUNK = 65535;

/** Why a structure was removed: taken (picked up or demolished), out of health, or left with no support. */
export const GONE_TAKEN = 0;
export const GONE_DESTROYED = 1;
export const GONE_FELL = 2;
/** Removals a chunk remembers, so a client can be sent each as one batch. */
export const GONE_KEPT = 8;
/** Changed slots a chunk remembers, so a client a few changes behind is sent those without a scan of every slot. */
export const RECENT = 256;

/**
 * Structures of one chunk removed together. `version` is the chunk's version, (x, y, z) is where it began in metres (for a fall,
 * where support was lost), `stamp` is the caller's clock, and `runs` holds pairs of first slot and count.
 */
export interface GoneBatch {
  version: number;
  readonly cause: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly stamp: number;
  readonly runs: number[];
  count: number;
}

export class ChunkTable {
  /** Bumped on every change to this chunk. 0 means never touched. */
  version = 0;
  /**
   * The version this chunk had once placeMap set the map's statics down in it, 0 for one it set none down in. While
   * `version` is still this, the chunk stands as the map placed it (StructureStore.asPlaced).
   */
  placedVersion = 0;
  /** Bumped when a slot's kind, position or yaw changes. Damage, repair and a change of owner leave it alone, so what is drawn need not be rebuilt for them. */
  shape = 0;
  /** Bumped with `shape` but where a slot keeps its place and turn and takes another kind (a door opening), which what is drawn may follow in place. */
  placed = 0;
  /** The free list must be rebuilt before the authority next adds to this chunk. */
  freeStale = false;
  /** The last GONE_KEPT removals, oldest first. goneFloor is the version of the newest removal dropped from the list. */
  readonly gone: GoneBatch[] = [];
  goneFloor = 0;
  /**
   * A ring of the last RECENT changes the authority made: the slot, the version the change gave it, and 1 where it changed
   * the slot's kind, place or yaw (0 for health or owner alone). Versions ascend. A client at `recentFloor` or later finds
   * every slot it lacks here. Null until the first change.
   */
  recentSlot: Uint16Array | null = null;
  recentVer: Uint32Array | null = null;
  recentShaped: Uint8Array | null = null;
  recentCount = 0;
  recentFloor = 0;
  /** Per slot, the id of the query that last counted it. Scratch for queries that cover several cells. */
  stamp: Uint32Array;
  /** Slots [0, high) have been used at some point. */
  high = 0;
  live = 0;
  cap: number;
  /** Content index. 0 marks an empty slot. */
  kind: Uint16Array;
  /** Centre of the collider box, world metres. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Uint16Array;
  owner: Uint32Array;
  hp: Float32Array;
  /** Table version at which the slot last changed. */
  mod: Uint32Array;
  free: number[] = [];
  /** `x`, `y`, `z` and `yaw` are the map's own columns, lent by placeMap, until the first write to a slot's place or turn copies them. */
  private lent: boolean;

  constructor(cap = 16, lent: Pick<PlacedRows, "x" | "y" | "z" | "yaw"> | null = null) {
    this.cap = cap;
    this.kind = new Uint16Array(cap);
    this.x = lent ? lent.x : new Float32Array(cap);
    this.y = lent ? lent.y : new Float32Array(cap);
    this.z = lent ? lent.z : new Float32Array(cap);
    this.yaw = lent ? lent.yaw : new Uint16Array(cap);
    this.lent = lent !== null;
    this.owner = new Uint32Array(cap);
    this.hp = new Float32Array(cap);
    this.mod = new Uint32Array(cap);
    this.stamp = new Uint32Array(cap);
  }

  /** Records that the authority changed `slot` at the current version. */
  touch(slot: number, shaped: number): void {
    const slots = (this.recentSlot ??= new Uint16Array(RECENT));
    const vers = (this.recentVer ??= new Uint32Array(RECENT));
    const at = this.recentCount % RECENT;
    if (this.recentCount >= RECENT) this.recentFloor = vers[at]!;
    slots[at] = slot;
    vers[at] = this.version;
    (this.recentShaped ??= new Uint8Array(RECENT))[at] = shaped;
    this.recentCount++;
  }

  log(batch: GoneBatch): void {
    this.gone.push(batch);
    if (this.gone.length > GONE_KEPT) this.goneFloor = this.gone.shift()!.version;
  }

  /** Copies the columns it was lent, if it was, so that a slot's place or turn may be written. */
  own(): void {
    if (!this.lent) return;
    this.x = this.x.slice();
    this.y = this.y.slice();
    this.z = this.z.slice();
    this.yaw = this.yaw.slice();
    this.lent = false;
  }

  ensure(slot: number): void {
    if (slot < this.cap) return;
    this.lent = false;
    let cap = this.cap;
    while (cap <= slot) cap *= 2;
    const grow = <T extends Uint16Array | Float32Array | Uint32Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(cap);
      b.set(a);
      return b;
    };
    this.kind = grow(this.kind);
    this.x = grow(this.x);
    this.y = grow(this.y);
    this.z = grow(this.z);
    this.yaw = grow(this.yaw);
    this.owner = grow(this.owner);
    this.hp = grow(this.hp);
    this.mod = grow(this.mod);
    this.stamp = grow(this.stamp);
    this.cap = cap;
  }
}

/** A query's results. `refs` is replaced when it grows, so read it after the query returns. */
export class Found {
  refs: Uint32Array;

  constructor(cap = 64) {
    this.refs = new Uint32Array(cap);
  }
}

export class StructureStore {
  readonly dims: MapDims;
  readonly chunks: (ChunkTable | null)[];
  /** The chunks that have a table, lowest first, for a walk that would otherwise visit every chunk of the map. */
  readonly held: number[] = [];
  count = 0;
  /** Bumped with any chunk's `shape`. */
  shapes = 0;
  /** Entries the last query passed over for lying outside its height band. */
  passed = 0;
  /** Called after any change to a chunk's table. `healthOnly` is true when nothing but a piece's health changed. */
  onChunkChanged: ((chunk: number, healthOnly: boolean) => void) | null = null;

  /** Per content index, the half extents of the box that bounds the whole structure. */
  private readonly halfX: Float32Array;
  private readonly halfY: Float32Array;
  private readonly halfZ: Float32Array;
  readonly parts: PartTable;

  private readonly gridX: number;
  private readonly gridZ: number;
  /** The 4 m collision grid. Per chunk, allocated on first use. Per cell, first node + 1, or 0. */
  private readonly heads: (Int32Array | null)[];
  private nodeRef: Uint32Array;
  /** Per node: next node + 1, or 0. */
  private nodeNext: Int32Array;
  /** The bottom and top of each node's structure, in metres, so a query with a height band rejects without loading the chunk table. */
  private nodeBottom: Float32Array;
  private nodeTop: Float32Array;
  private nodeHigh = 0;
  private nodeFree = 0;
  private queryId = 0;

  // Footprint scratch, filled by `footprint`.
  private fx0 = 0;
  private fx1 = 0;
  private fz0 = 0;
  private fz1 = 0;

  /** Kinds that bodies pass through. Rays and drawing still see them. */
  private readonly soft: Uint8Array | null;
  /** Per kind, in metres from a structure's origin: the bottom and top of its boxes, and how far they reach sideways at any yaw. */
  private readonly low: Float32Array;
  private readonly high: Float32Array;
  readonly spread: Float32Array;
  /** Per kind, metres its footprint is widened by, for convex parts on a 60 degree vector, whose corners round a little out. */
  private readonly pad: Float32Array;

  constructor(dims: MapDims, halfX: Float32Array, halfY: Float32Array, halfZ: Float32Array, soft: Uint8Array | null = null, parts: PartTable | null = null) {
    this.dims = dims;
    this.soft = soft;
    this.parts = parts ?? oneBoxEach(halfX, halfY, halfZ);
    this.halfX = halfX;
    this.halfY = halfY;
    this.halfZ = halfZ;
    this.chunks = new Array(chunkCount(dims)).fill(null);
    this.gridX = (dims.chunksX * CHUNK_SIZE) / GRID_CELL;
    this.gridZ = (dims.chunksZ * CHUNK_SIZE) / GRID_CELL;
    this.heads = new Array(chunkCount(dims)).fill(null);
    this.nodeRef = new Uint32Array(1024);
    this.nodeNext = new Int32Array(1024);
    this.nodeBottom = new Float32Array(1024);
    this.nodeTop = new Float32Array(1024);
    const kinds = halfX.length;
    this.low = new Float32Array(kinds);
    this.high = new Float32Array(kinds);
    this.spread = new Float32Array(kinds);
    this.pad = new Float32Array(kinds);
    const box = this.parts.box;
    for (let k = 0; k < kinds; k++) {
      // The box of half sizes too, which the support rules measure by.
      let low = -halfY[k]!;
      let high = halfY[k]!;
      let spread = 0;
      for (let p = this.parts.start[k]! * 6, end = this.parts.start[k + 1]! * 6; p < end; p += 6) {
        low = Math.min(low, box[p + 1]! - box[p + 4]!);
        high = Math.max(high, box[p + 1]! + box[p + 4]!);
        const fx = Math.abs(box[p]!) + box[p + 3]!;
        const fz = Math.abs(box[p + 2]!) + box[p + 5]!;
        spread = Math.max(spread, Math.sqrt(fx * fx + fz * fz));
      }
      const hulls = this.parts.hulls;
      for (let h = hulls ? hulls.start[k]! : 0, end = hulls ? hulls.start[k + 1]! : 0; h < end; h++) {
        const sixty = hulls!.sixty[h] === 1;
        for (let c = hulls!.corner[h]!; c < hulls!.corner[h + 1]!; c++) {
          const at = hulls!.at;
          const [px, py, pz] = hullPoint([at[c * 3]!, at[c * 3 + 1]!, at[c * 3 + 2]!], sixty);
          low = Math.min(low, py);
          high = Math.max(high, py);
          // A corner along a 60 degree vector is off its true place by up to that vector's rounding, under a unit in a half side.
          spread = Math.max(spread, Math.sqrt(px * px + pz * pz) * (sixty ? 1 + 2 / HALF_SIDE : 1));
          if (sixty) this.pad[k] = Math.max(this.pad[k]!, Math.abs(at[c * 3 + 2]!) / HALF_SIDE);
        }
      }
      this.low[k] = low;
      this.high[k] = high;
      this.spread[k] = spread * STRETCH_MOST;
    }
  }

  /** Snaps the position to the 1/512 m lattice. Returns the ref, or -1 if the kind is unknown or the chunk is full. Authority only. */
  add(kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number): number {
    if (kind <= 0 || kind >= this.halfX.length || this.halfX[kind] === 0) return -1;
    x = Math.round(x * STRUCT_UNITS) / STRUCT_UNITS;
    y = Math.round(y * STRUCT_UNITS) / STRUCT_UNITS;
    z = Math.round(z * STRUCT_UNITS) / STRUCT_UNITS;
    const chunk = chunkAt(this.dims, x, z);
    const t = this.tableOf(chunk);
    let slot: number;
    if (t.freeStale) {
      // Rows were loaded or applied since the list was kept. A client applies rows every tick and never adds, so it never pays for this.
      t.free.length = 0;
      for (let s = t.high - 1; s >= 0; s--) if (t.kind[s] === 0) t.free.push(s);
      t.freeStale = false;
    }
    if (t.free.length > 0) slot = t.free.pop()!;
    else {
      if (t.high >= MAX_SLOTS_PER_CHUNK) return -1;
      slot = t.high;
    }
    t.version++;
    this.write(chunk, t, slot, kind, x, y, z, yaw & 0xffff, owner, hp, t.version);
    t.touch(slot, 1);
    this.onChunkChanged?.(chunk, false);
    return chunk * 65536 + slot;
  }

  /**
   * Sets down a map's statics in a store that holds nothing, as `add` would one by one in the map's order with no owner and
   * `hp` of its kind: chunk `c` takes rows `first[c]` up to `first[c + 1]` into its slots in turn, and the grid takes them in
   * the order `rows.row` gives (the chunks' where it is empty), so every query lists them as it would. `kinds` turns a row's
   * kind into a content index. Each table and the grid are made the size they need, nothing is logged as changed, and each
   * chunk is marked as the map placed it (`placedVersion`). Authority only.
   */
  placeMap(rows: PlacedRows, kinds: Uint16Array, hp: Float32Array): void {
    if (this.count !== 0 || this.held.length !== 0) throw new Error("the map's statics are set down in a store that holds nothing");
    const { first, kind, x, z, yaw } = rows;
    const placeable = (r: number): boolean => {
      const k = kinds[kind[r]!]!;
      return k > 0 && k < this.halfX.length && this.halfX[k] !== 0;
    };
    // Per row, its slot, or -1 where add would have refused it.
    const slotOf = new Int32Array(kind.length);
    for (let c = 0; c + 1 < first.length; c++) {
      let n = 0;
      for (let r = first[c]!; r < first[c + 1]!; r++) slotOf[r] = placeable(r) && n < MAX_SLOTS_PER_CHUNK ? n++ : -1;
      if (n === 0) continue;
      // Where every row takes a slot, the slots' places and turns are the map's own columns.
      const [from, to] = [first[c]!, first[c + 1]!];
      const lent = n === to - from ? { x: x.subarray(from, to), y: rows.y.subarray(from, to), z: z.subarray(from, to), yaw: yaw.subarray(from, to) } : null;
      const t = (this.chunks[c] = new ChunkTable(n, lent));
      this.held.push(c);
      for (let r = from; r < to; r++) {
        const s = slotOf[r]!;
        if (s < 0) continue;
        const k = kinds[kind[r]!]!;
        t.kind[s] = k;
        if (!lent) {
          t.x[s] = x[r]!;
          t.y[s] = rows.y[r]!;
          t.z[s] = z[r]!;
          t.yaw[s] = yaw[r]!;
        }
        t.hp[s] = hp[k]!;
        t.mod[s] = s + 1;
      }
      // What was set down is not in the log of changes.
      t.high = t.live = t.version = t.placedVersion = t.recentFloor = t.shape = t.placed = n;
      this.count += n;
      this.shapes += n;
    }
    const order = rows.row;
    const each = (put: (r: number) => void): void => {
      for (let i = 0; i < kind.length; i++) {
        const r = order.length > 0 ? order[i]! : i;
        if (slotOf[r]! < 0) continue;
        this.footprint(kinds[kind[r]!]!, x[r]!, z[r]!, yaw[r]!);
        put(r);
      }
    };
    let nodes = 0;
    each(() => (nodes += (this.fx1 - this.fx0 + 1) * (this.fz1 - this.fz0 + 1)));
    // Room for what players build is left past the map's, and pages never written to cost no memory.
    this.growNodes(this.nodeHigh + nodes + (nodes >> 3));
    each((r) => this.link(chunkAt(this.dims, x[r]!, z[r]!) * 65536 + slotOf[r]!, kinds[kind[r]!]!, rows.y[r]!));
    for (const c of this.held) this.onChunkChanged?.(c, false);
  }

  /**
   * Whether `chunk` holds what the map set down in it and nothing else, as placeMap set it down: nothing in it has changed
   * since, health and owner included. A chunk the map set nothing down in stands so while nothing is built in it. Authority only.
   */
  asPlaced(chunk: number): boolean {
    const t = this.chunks[chunk];
    return !t || t.version === t.placedVersion;
  }

  /** Called with a structure's ref and cause before it is removed, while its row can still be read. Authority only. */
  onRemove: ((ref: number, cause: number) => void) | null = null;

  /** `stamp` is the caller's clock. Authority only. */
  remove(ref: number, cause = GONE_TAKEN, stamp = 0): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    this.onRemove?.(ref, cause);
    // Removals in a row with the same cause and stamp and no other change between (a blast through a wall)
    // join one batch, which began at the first.
    const last = t.gone[t.gone.length - 1];
    const joins = last !== undefined && last.version === t.version && last.cause === cause && last.stamp === stamp;
    t.version++;
    if (joins) {
      const runs = last.runs;
      if (runs[runs.length - 2]! + runs[runs.length - 1]! === slot) runs[runs.length - 1]!++;
      else runs.push(slot, 1);
      last.version = t.version;
      last.count++;
    } else t.log({ version: t.version, cause, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, stamp, runs: [slot, 1], count: 1 });
    this.erase(chunk, t, slot, t.version);
    t.touch(slot, 1);
    t.free.push(slot);
    this.onChunkChanged?.(chunk, false);
    return true;
  }

  /**
   * Removes the first `n` of `refs`, which it sorts in place. Each chunk changes version once and logs one batch that began at
   * (x, y, z). Returns how many were removed. Authority only.
   */
  removeMany(refs: Uint32Array, n: number, cause: number, x: number, y: number, z: number, stamp: number): number {
    const sorted = refs.subarray(0, n).sort();
    let removed = 0;
    for (let i = 0; i < n; ) {
      const chunk = Math.floor(sorted[i]! / 65536);
      const t = this.chunks[chunk];
      let end = i;
      while (end < n && Math.floor(sorted[end]! / 65536) === chunk) end++;
      if (t) {
        const runs: number[] = [];
        let count = 0;
        for (let k = i; k < end; k++) {
          const slot = sorted[k]! & 0xffff;
          if (slot >= t.high || t.kind[slot] === 0 || (k > i && sorted[k] === sorted[k - 1])) continue;
          this.onRemove?.(sorted[k]!, cause);
          if (count === 0) t.version++;
          this.erase(chunk, t, slot, t.version);
          t.touch(slot, 1);
          t.free.push(slot);
          // Slots come in ascending order, so an adjacent slot extends the last run.
          if (runs.length > 0 && runs[runs.length - 2]! + runs[runs.length - 1]! === slot) runs[runs.length - 1]!++;
          else runs.push(slot, 1);
          count++;
        }
        if (count > 0) {
          t.log({ version: t.version, cause, x, y, z, stamp, runs, count });
          this.onChunkChanged?.(chunk, false);
          removed += count;
        }
      }
      i = end;
    }
    return removed;
  }

  /** Changes a structure's kind in place and keeps the rest of its row (a door opening). False if there is no such structure. Authority only. */
  swap(ref: number, kind: number): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0 || kind === 0) return false;
    const [x, y, z, yaw, owner, hp] = [t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]!];
    t.version++;
    this.erase(chunk, t, slot, t.version, true);
    this.write(chunk, t, slot, kind, x, y, z, yaw, owner, hp, t.version, true);
    t.touch(slot, 1);
    this.onChunkChanged?.(chunk, false);
    return true;
  }

  /** False if there is no such structure. Authority only. */
  mend(ref: number, hp: number): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    t.version++;
    t.hp[slot] = hp;
    t.mod[slot] = t.version;
    t.touch(slot, 0);
    this.onChunkChanged?.(chunk, true);
    return true;
  }

  /** Removes the structure at 0 health. Returns the health left (0 if it is gone), or -1 if there is no such structure. Authority only. */
  damage(ref: number, points: number, stamp = 0): number {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return -1;
    if (!(points > 0)) return t.hp[slot]!;
    const left = t.hp[slot]! - points;
    if (left <= 0) {
      this.remove(ref, GONE_DESTROYED, stamp);
      return 0;
    }
    // Health is saved and replicated, so the slot counts as changed.
    t.version++;
    t.hp[slot] = left;
    t.mod[slot] = t.version;
    t.touch(slot, 0);
    this.onChunkChanged?.(chunk, true);
    return left;
  }

  /** Returns how many structures changed owner. Authority only. */
  reown(from: number, to: number): number {
    let n = 0;
    if (from === to) return 0;
    for (let chunk = 0; chunk < this.chunks.length; chunk++) {
      const t = this.chunks[chunk];
      // A chunk as the map placed it holds only pieces owned by nobody.
      if (!t || (from !== 0 && t.version === t.placedVersion)) continue;
      let any = false;
      for (let slot = 0; slot < t.high; slot++) {
        if (t.kind[slot] === 0 || t.owner[slot] !== from) continue;
        if (!any) t.version++;
        any = true;
        t.owner[slot] = to;
        t.mod[slot] = t.version;
        t.touch(slot, 0);
        n++;
      }
      if (any) this.onChunkChanged?.(chunk, false);
    }
    return n;
  }

  /** Sets a slot to replicated or loaded contents. `kind` 0 empties it. Does not advance the table version, so follow with setVersion. */
  put(chunk: number, slot: number, kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number, mod: number): void {
    const t = this.tableOf(chunk);
    if (kind !== 0 && slot < t.high && t.kind[slot] === kind && t.x[slot] === Math.fround(x) && t.y[slot] === Math.fround(y) && t.z[slot] === Math.fround(z) && t.yaw[slot] === yaw) {
      // The same piece in the same place: only its health or owner changed, so the grid and what is drawn stand.
      t.owner[slot] = owner;
      t.hp[slot] = hp;
      t.mod[slot] = mod;
      return;
    }
    const inPlace = kind !== 0 && slot < t.high && t.kind[slot] !== 0 && t.x[slot] === Math.fround(x) && t.y[slot] === Math.fround(y) && t.z[slot] === Math.fround(z) && t.yaw[slot] === yaw;
    if (slot < t.high && t.kind[slot] !== 0) this.erase(chunk, t, slot, mod, inPlace);
    if (kind !== 0) this.write(chunk, t, slot, kind, x, y, z, yaw, owner, hp, mod, inPlace);
    else {
      t.ensure(slot);
      if (slot >= t.high) t.high = slot + 1;
      t.mod[slot] = mod;
    }
  }

  /** Call after loading or applying a delta. */
  setVersion(chunk: number, version: number): void {
    const t = this.tableOf(chunk);
    t.version = version;
    // What was loaded or applied is not in the log of changes.
    t.recentCount = 0;
    t.recentFloor = version;
    t.freeStale = true;
    this.onChunkChanged?.(chunk, false);
  }

  /** Forgets the chunk without logging removals. Used when a chunk leaves a client's interest, and by NodeField. */
  dropChunk(chunk: number): void {
    const t = this.chunks[chunk];
    if (!t) return;
    // Later slots were written later, so they lie nearer the head of each cell's list.
    for (let s = t.high - 1; s >= 0; s--) if (t.kind[s] !== 0) this.erase(chunk, t, s, 0);
    this.chunks[chunk] = null;
    this.held.splice(this.heldAt(chunk), 1);
    this.onChunkChanged?.(chunk, false);
  }

  /** The chunk's table, made if it has none. */
  private tableOf(chunk: number): ChunkTable {
    let t = this.chunks[chunk];
    if (!t) {
      this.chunks[chunk] = t = new ChunkTable();
      this.held.splice(this.heldAt(chunk), 0, chunk);
    }
    return t;
  }

  /** Where `chunk` is or would go in `held`. */
  private heldAt(chunk: number): number {
    let lo = 0;
    let hi = this.held.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.held[mid]! < chunk) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The highest top of what stands in the grid cells over the rectangle, or -Infinity where nothing does. Conservative, as query is. */
  topIn(minX: number, minZ: number, maxX: number, maxZ: number): number {
    const cx0 = Math.max(0, Math.floor(minX / GRID_CELL));
    const cz0 = Math.max(0, Math.floor(minZ / GRID_CELL));
    const cx1 = Math.min(this.gridX - 1, Math.floor(maxX / GRID_CELL));
    const cz1 = Math.min(this.gridZ - 1, Math.floor(maxZ / GRID_CELL));
    let top = -Infinity;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cells = this.heads[(cz >> 4) * this.dims.chunksX + (cx >> 4)];
        if (!cells) continue;
        for (let node = cells[(cz & 15) * CELLS + (cx & 15)]!; node !== 0; node = this.nodeNext[node - 1]!) if (this.nodeTop[node - 1]! > top) top = this.nodeTop[node - 1]!;
      }
    }
    return top;
  }

  /**
   * Writes the refs of structures whose grid cells overlap the rectangle, and whose boxes reach into the height band if one
   * is given, to `out` and returns the count. Conservative, so callers test exactly.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Found, minY = -Infinity, maxY = Infinity): number {
    let cx0 = Math.floor(minX / GRID_CELL);
    let cx1 = Math.floor(maxX / GRID_CELL);
    let cz0 = Math.floor(minZ / GRID_CELL);
    let cz1 = Math.floor(maxZ / GRID_CELL);
    if (cx0 < 0) cx0 = 0;
    if (cz0 < 0) cz0 = 0;
    if (cx1 >= this.gridX) cx1 = this.gridX - 1;
    if (cz1 >= this.gridZ) cz1 = this.gridZ - 1;
    const single = cx0 === cx1 && cz0 === cz1;
    let n = 0;
    let refs = out.refs;
    const chunksX = this.dims.chunksX;
    // A structure in several cells is counted once, by the query id stamped on its slot.
    if (++this.queryId === 0xffffffff) {
      for (const t of this.chunks) t?.stamp.fill(0);
      this.queryId = 1;
    }
    const id = this.queryId;
    let passed = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cells = this.heads[(cz >> 4) * chunksX + (cx >> 4)];
        if (!cells) continue;
        let node = cells[(cz & 15) * CELLS + (cx & 15)]!;
        while (node !== 0) {
          const at = node - 1;
          node = this.nodeNext[at]!;
          // The grid has no height, so a tall building puts every storey in the same cells.
          if (this.nodeTop[at]! < minY || this.nodeBottom[at]! > maxY) {
            passed++;
            continue;
          }
          const ref = this.nodeRef[at]!;
          if (!single) {
            const t = this.chunks[Math.floor(ref / 65536)]!;
            const slot = ref & 0xffff;
            if (t.stamp[slot] === id) continue;
            t.stamp[slot] = id;
          }
          if (n === refs.length) {
            // Never drop a result. A dropped wall is one a body walks through.
            refs = new Uint32Array(n * 2);
            refs.set(out.refs);
            out.refs = refs;
          }
          refs[n++] = ref;
        }
      }
    }
    this.passed = passed;
    return n;
  }

  isSoft(kind: number): boolean {
    return this.soft !== null && this.soft[kind] === 1;
  }

  halfXOf(kind: number): number {
    return this.halfX[kind]!;
  }

  halfYOf(kind: number): number {
    return this.halfY[kind]!;
  }

  halfZOf(kind: number): number {
    return this.halfZ[kind]!;
  }

  private write(chunk: number, t: ChunkTable, slot: number, kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number, mod: number, inPlace = false): void {
    if (!inPlace) t.placed++;
    t.ensure(slot);
    t.own();
    if (slot >= t.high) t.high = slot + 1;
    t.kind[slot] = kind;
    t.x[slot] = x;
    t.y[slot] = y;
    t.z[slot] = z;
    t.yaw[slot] = yaw;
    t.owner[slot] = owner;
    t.hp[slot] = hp;
    t.mod[slot] = mod;
    t.shape++;
    this.shapes++;
    t.live++;
    this.count++;
    this.footprint(kind, x, z, yaw);
    this.link(chunk * 65536 + slot, kind, y);
  }

  /** Puts `ref`, of `kind` with its centre at height `y`, at the head of the list of each grid cell from fx0..fz1. */
  private link(ref: number, kind: number, y: number): void {
    for (let cz = this.fz0; cz <= this.fz1; cz++) {
      for (let cx = this.fx0; cx <= this.fx1; cx++) {
        const cells = (this.heads[(cz >> 4) * this.dims.chunksX + (cx >> 4)] ??= new Int32Array(CELLS * CELLS));
        const cell = (cz & 15) * CELLS + (cx & 15);
        const node = this.allocNode();
        this.nodeRef[node] = ref;
        this.nodeBottom[node] = y + this.low[kind]!;
        this.nodeTop[node] = y + this.high[kind]!;
        this.nodeNext[node] = cells[cell]!;
        cells[cell] = node + 1;
      }
    }
  }

  private erase(chunk: number, t: ChunkTable, slot: number, mod: number, inPlace = false): void {
    if (!inPlace) t.placed++;
    this.footprint(t.kind[slot]!, t.x[slot]!, t.z[slot]!, t.yaw[slot]!);
    const ref = chunk * 65536 + slot;
    for (let cz = this.fz0; cz <= this.fz1; cz++) {
      for (let cx = this.fx0; cx <= this.fx1; cx++) {
        const cells = this.heads[(cz >> 4) * this.dims.chunksX + (cx >> 4)];
        if (!cells) continue;
        const cell = (cz & 15) * CELLS + (cx & 15);
        let prev = 0;
        let node = cells[cell]!;
        while (node !== 0 && this.nodeRef[node - 1] !== ref) {
          prev = node;
          node = this.nodeNext[node - 1]!;
        }
        if (node === 0) continue;
        const next = this.nodeNext[node - 1]!;
        if (prev === 0) cells[cell] = next;
        else this.nodeNext[prev - 1] = next;
        this.nodeNext[node - 1] = this.nodeFree;
        this.nodeFree = node;
      }
    }
    // Empty slots hold zeros, so equal tables are equal byte for byte.
    t.own();
    t.kind[slot] = 0;
    t.x[slot] = 0;
    t.y[slot] = 0;
    t.z[slot] = 0;
    t.yaw[slot] = 0;
    t.owner[slot] = 0;
    t.hp[slot] = 0;
    t.mod[slot] = mod;
    t.shape++;
    this.shapes++;
    t.live--;
    this.count--;
  }

  /** Writes the grid cells a structure's rotated box covers to fx0..fz1. */
  private footprint(kind: number, x: number, z: number, yaw: number): void {
    frameOf(yaw);
    const s = Math.abs(frame.sin);
    const c = Math.abs(frame.cos);
    const hx = this.halfX[kind]! * frame.stretch;
    const hz = this.halfZ[kind]! * frame.stretch;
    const ex = c * hx + s * hz + this.pad[kind]!;
    const ez = s * hx + c * hz + this.pad[kind]!;
    let x0 = Math.floor((x - ex) / GRID_CELL);
    let x1 = Math.floor((x + ex) / GRID_CELL);
    let z0 = Math.floor((z - ez) / GRID_CELL);
    let z1 = Math.floor((z + ez) / GRID_CELL);
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 >= this.gridX) x1 = this.gridX - 1;
    if (z1 >= this.gridZ) z1 = this.gridZ - 1;
    this.fx0 = x0;
    this.fx1 = x1;
    this.fz0 = z0;
    this.fz1 = z1;
  }

  private allocNode(): number {
    if (this.nodeFree !== 0) {
      const node = this.nodeFree - 1;
      this.nodeFree = this.nodeNext[node]!;
      return node;
    }
    if (this.nodeHigh === this.nodeRef.length) this.growNodes(this.nodeHigh * 2);
    return this.nodeHigh++;
  }

  /** Makes room for `cap` grid nodes, if there is less. */
  private growNodes(cap: number): void {
    if (cap <= this.nodeRef.length) return;
    const grow = <T extends Uint32Array | Int32Array | Float32Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(cap);
      b.set(a.subarray(0, this.nodeHigh));
      return b;
    };
    this.nodeRef = grow(this.nodeRef);
    this.nodeNext = grow(this.nodeNext);
    this.nodeBottom = grow(this.nodeBottom);
    this.nodeTop = grow(this.nodeTop);
  }
}
