// Structures: walls, foundations, resource nodes. Anything placed and mostly still.
//
// A structure is a row in its chunk's table, not an entity. It has no per-tick
// cost, no object, no callback. Half a million of them are a few megabytes of
// typed arrays plus a collision grid.
//
//   identity     ref = chunk * 65536 + slot. Slots are stable until removed.
//   replication  every table has a version; every slot records the version that
//                last changed it. "What changed since version v" is a scan, so a
//                client can always be brought up to date without an op log.
//   collision    a 4 m grid of linked cells, updated incrementally. Cell tables
//                exist only for chunks that something stands in, so memory
//                follows built-up area, not map size.
//
// The server, the client's prediction and the save file all use this one class.

import { CHUNK_SIZE, STRUCT_UNITS, YAW_UNITS, chunkAt, chunkCount, type MapDims } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";

export const GRID_CELL = 4;
/** Grid cells per chunk side (64 m / 4 m). */
const CELLS = 16;
export const MAX_SLOTS_PER_CHUNK = 65535;
const YAW_TO_RAD = TAU / YAW_UNITS;

export class ChunkTable {
  /** Bumped on every change to this chunk. 0 means never touched. */
  version = 0;
  /** Slots [0, high) have been used at some point. */
  high = 0;
  live = 0;
  cap: number;
  /** Content index; 0 marks an empty slot. */
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

  constructor(cap = 16) {
    this.cap = cap;
    this.kind = new Uint16Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.yaw = new Uint16Array(cap);
    this.owner = new Uint32Array(cap);
    this.hp = new Float32Array(cap);
    this.mod = new Uint32Array(cap);
  }

  ensure(slot: number): void {
    if (slot < this.cap) return;
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
    this.cap = cap;
  }
}

export class StructureStore {
  readonly dims: MapDims;
  readonly chunks: (ChunkTable | null)[];
  /** Total live structures. */
  count = 0;
  /** Called after any change to a chunk's table. */
  onChunkChanged: ((chunk: number) => void) | null = null;

  /** Collider half extents per content index. */
  private readonly halfX: Float32Array;
  private readonly halfY: Float32Array;
  private readonly halfZ: Float32Array;

  private readonly gridX: number;
  private readonly gridZ: number;
  /** Per chunk, allocated on first use: per cell, first node + 1, or 0. */
  private readonly heads: (Int32Array | null)[];
  private nodeRef: Uint32Array;
  /** Per node: next node + 1, or 0. */
  private nodeNext: Int32Array;
  private nodeHigh = 0;
  private nodeFree = 0;

  // Footprint scratch, filled by `footprint`.
  private fx0 = 0;
  private fx1 = 0;
  private fz0 = 0;
  private fz1 = 0;

  constructor(dims: MapDims, halfX: Float32Array, halfY: Float32Array, halfZ: Float32Array) {
    this.dims = dims;
    this.halfX = halfX;
    this.halfY = halfY;
    this.halfZ = halfZ;
    this.chunks = new Array(chunkCount(dims)).fill(null);
    this.gridX = (dims.chunksX * CHUNK_SIZE) / GRID_CELL;
    this.gridZ = (dims.chunksZ * CHUNK_SIZE) / GRID_CELL;
    this.heads = new Array(chunkCount(dims)).fill(null);
    this.nodeRef = new Uint32Array(1024);
    this.nodeNext = new Int32Array(1024);
  }

  /**
   * Place a structure. The position snaps to the 1/512 m lattice. Returns its
   * ref, or -1 if the kind is unknown or the chunk is full. Authority only.
   */
  add(kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number): number {
    if (kind <= 0 || kind >= this.halfX.length || this.halfX[kind] === 0) return -1;
    x = Math.round(x * STRUCT_UNITS) / STRUCT_UNITS;
    y = Math.round(y * STRUCT_UNITS) / STRUCT_UNITS;
    z = Math.round(z * STRUCT_UNITS) / STRUCT_UNITS;
    const chunk = chunkAt(this.dims, x, z);
    const t = (this.chunks[chunk] ??= new ChunkTable());
    let slot: number;
    if (t.free.length > 0) slot = t.free.pop()!;
    else {
      if (t.high >= MAX_SLOTS_PER_CHUNK) return -1;
      slot = t.high;
    }
    t.version++;
    this.write(chunk, t, slot, kind, x, y, z, yaw & 0xffff, owner, hp, t.version);
    this.onChunkChanged?.(chunk);
    return chunk * 65536 + slot;
  }

  /** Remove a structure. Authority only. */
  remove(ref: number): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    t.version++;
    this.erase(chunk, t, slot, t.version);
    t.free.push(slot);
    this.onChunkChanged?.(chunk);
    return true;
  }

  /**
   * Set a slot to replicated or loaded contents. `kind` 0 empties it. Does not
   * advance the table version; follow with `setVersion`.
   */
  put(chunk: number, slot: number, kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number, mod: number): void {
    const t = (this.chunks[chunk] ??= new ChunkTable());
    if (slot < t.high && t.kind[slot] !== 0) this.erase(chunk, t, slot, mod);
    if (kind !== 0) this.write(chunk, t, slot, kind, x, y, z, yaw, owner, hp, mod);
    else {
      t.ensure(slot);
      if (slot >= t.high) t.high = slot + 1;
      t.mod[slot] = mod;
    }
  }

  /** After loading or applying a delta: record the version and rebuild the free list. */
  setVersion(chunk: number, version: number): void {
    const t = (this.chunks[chunk] ??= new ChunkTable());
    t.version = version;
    t.free.length = 0;
    for (let s = t.high - 1; s >= 0; s--) if (t.kind[s] === 0) t.free.push(s);
    this.onChunkChanged?.(chunk);
  }

  /** Forget a chunk entirely (client side, when it leaves interest). */
  dropChunk(chunk: number): void {
    const t = this.chunks[chunk];
    if (!t) return;
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0) this.erase(chunk, t, s, 0);
    this.chunks[chunk] = null;
    this.onChunkChanged?.(chunk);
  }

  /**
   * Collect refs of structures whose footprint cell overlaps the rectangle.
   * Returns the count written to `out`. Conservative: callers test exactly.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Uint32Array): number {
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
    const chunksX = this.dims.chunksX;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cells = this.heads[(cz >> 4) * chunksX + (cx >> 4)];
        if (!cells) continue;
        let node = cells[(cz & 15) * CELLS + (cx & 15)]!;
        while (node !== 0) {
          const ref = this.nodeRef[node - 1]!;
          node = this.nodeNext[node - 1]!;
          if (!single) {
            let seen = false;
            for (let i = 0; i < n; i++) {
              if (out[i] === ref) {
                seen = true;
                break;
              }
            }
            if (seen) continue;
          }
          if (n === out.length) return n;
          out[n++] = ref;
        }
      }
    }
    return n;
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

  private write(chunk: number, t: ChunkTable, slot: number, kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number, mod: number): void {
    t.ensure(slot);
    if (slot >= t.high) t.high = slot + 1;
    t.kind[slot] = kind;
    t.x[slot] = x;
    t.y[slot] = y;
    t.z[slot] = z;
    t.yaw[slot] = yaw;
    t.owner[slot] = owner;
    t.hp[slot] = hp;
    t.mod[slot] = mod;
    t.live++;
    this.count++;
    this.footprint(kind, x, z, yaw);
    const ref = chunk * 65536 + slot;
    for (let cz = this.fz0; cz <= this.fz1; cz++) {
      for (let cx = this.fx0; cx <= this.fx1; cx++) {
        const cells = (this.heads[(cz >> 4) * this.dims.chunksX + (cx >> 4)] ??= new Int32Array(CELLS * CELLS));
        const cell = (cz & 15) * CELLS + (cx & 15);
        const node = this.allocNode();
        this.nodeRef[node] = ref;
        this.nodeNext[node] = cells[cell]!;
        cells[cell] = node + 1;
      }
    }
  }

  private erase(chunk: number, t: ChunkTable, slot: number, mod: number): void {
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
    t.kind[slot] = 0;
    t.x[slot] = 0;
    t.y[slot] = 0;
    t.z[slot] = 0;
    t.yaw[slot] = 0;
    t.owner[slot] = 0;
    t.hp[slot] = 0;
    t.mod[slot] = mod;
    t.live--;
    this.count--;
  }

  /** Grid cells covered by a structure's rotated box. */
  private footprint(kind: number, x: number, z: number, yaw: number): void {
    const a = yaw * YAW_TO_RAD;
    const s = Math.abs(detSin(a));
    const c = Math.abs(detCos(a));
    const hx = this.halfX[kind]!;
    const hz = this.halfZ[kind]!;
    const ex = c * hx + s * hz;
    const ez = s * hx + c * hz;
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
    if (this.nodeHigh === this.nodeRef.length) {
      const cap = this.nodeHigh * 2;
      const refs = new Uint32Array(cap);
      refs.set(this.nodeRef);
      this.nodeRef = refs;
      const next = new Int32Array(cap);
      next.set(this.nodeNext);
      this.nodeNext = next;
    }
    return this.nodeHigh++;
  }
}
