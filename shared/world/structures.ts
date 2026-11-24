// A structure is a row in its chunk's table, not an entity, with no per-tick cost. ref = chunk * 65536 + slot, stable until removed.
// A slot the map set a piece down in stays that piece's when it is emptied, so its ref means that piece for good.
// Each slot records the table version that last changed it, so a client is brought up to date by a scan, without an op log.

import { CHUNK_SIZE, STRUCT_UNITS, chunkAt, chunkCount, type MapDims } from "../coords.ts";
import type { VehicleSurface } from "../sim/vehicle.ts";
import { hullPoint, type HullTable } from "./convex.ts";
import { HALF_SIDE, STRETCH_MOST, frame, frameOf } from "./frame.ts";
import { KEY_BETWEEN, KEY_FOUND, keyOfPose } from "./lattice/adopt.ts";
import type { FormTable } from "./lattice/forms.ts";
import { Frames, baseOrigin, keyFits, poseOf, twOfKey, type Frame, type LatticeKey, type LatticePose } from "./lattice/frames.ts";
import { key0, key1 } from "./lattice/module.ts";
import { Cells, Occupancy, formCells } from "./lattice/occupancy.ts";

export const GRID_CELL = 4;
/**
 * The boxes bodies and rays meet. Kind `k` owns the boxes numbered `start[k]` up to `start[k + 1]`. Each box is six numbers in
 * `box`: its centre, measured from the structure's origin, then its half extents.
 */
export type GrindLine = readonly (readonly [number, number, number])[];

export interface PartTable {
  /** The skateable edges of each kind: its own line, or those found along the tops of its low boxes. */
  readonly grindLine?: readonly (readonly GrindLine[] | undefined)[];
  readonly vehicleSurface?: readonly (VehicleSurface | null)[];
  /** The grip a server's settings give a surface, by its id, where they give one (shared/content/tuning.ts `surfaces`). */
  readonly surfaceGrip?: Readonly<Record<string, number>>;
  readonly start: Uint32Array;
  readonly box: Float32Array;
  /** Convex parts, for kinds with sloped or three-sided forms. */
  readonly hulls?: HullTable;
  /** The slot of a base's lattice each built kind fills. A store given none keys no row. */
  readonly forms?: FormTable;
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
const NO_SLOTS = new Uint16Array(0);
export const MAX_SLOTS_PER_CHUNK = 65535;

/** Why a structure was removed: taken (picked up or demolished), out of health, left with no support, or blown apart. */
export const GONE_TAKEN = 0;
export const GONE_DESTROYED = 1;
export const GONE_FELL = 2;
export const GONE_BLAST = 3;
/** What a logged change did to its slot: moved, made or emptied it; gave it another kind where it stood; and whether a batch that leaves heaps says so. */
export const TOUCH_MOVED = 1;
export const TOUCH_KIND = 2;
export const TOUCH_LEFT = 4;
/** Removals a chunk remembers, so a client can be sent each as one batch. */
export const GONE_KEPT = 8;
/** Changed slots a chunk remembers, so a client a few changes behind is sent those without a scan of every slot. */
export const RECENT = 256;

/**
 * Structures of one chunk broken together. `version` is the chunk's version, (x, y, z) is where it began in metres (for a fall,
 * where support was lost; for a blast, its centre), `radius` is a blast's reach in metres, `stamp` is the caller's clock,
 * and `runs` holds pairs of first slot and count for the slots emptied, `left` for those that took a heap's kind in place.
 */
export interface GoneBatch {
  version: number;
  readonly cause: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly stamp: number;
  readonly radius: number;
  readonly runs: number[];
  readonly left: number[];
  count: number;
}

/** What a broken slot takes in place of emptying: a kind and its health. Kind 0 empties it. */
export interface Leaves {
  kind: number;
  hp: number;
}

export class ChunkTable {
  /** Bumped on every change to this chunk. 0 means never touched. */
  version = 0;
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
   * A ring of the last RECENT changes the authority made: the slot, the version the change gave it, and what the change
   * did as TOUCH_ bits (0 for health or owner alone). Versions ascend. A client at `recentFloor` or later finds every slot
   * it lacks here. Null until the first change.
   */
  recentSlot: Uint16Array | null = null;
  recentVer: Uint32Array | null = null;
  recentShaped: Uint8Array | null = null;
  recentCount = 0;
  recentFloor = 0;
  /** Per slot, the id of the query that last counted it. Scratch for queries that cover several cells. */
  stamp: Uint32Array;
  /** Slots [0, mapped) are the map's, each its piece's for good: one emptied is never given to another piece. */
  mapped = 0;
  /**
   * Per map slot, the kind the map set down in it, numbered as the map numbers kinds (StructureStore.mapKind gives content's).
   * It is the map's own column where every row of the chunk took a slot.
   */
  map: Uint16Array | null = null;
  /** Map slots that are not as the map set them down (StructureStore.asMap). */
  changed = 0;
  /** `changed` and the live slots past the map's. At 0 the chunk stands as the map placed it (StructureStore.asPlaced). */
  differs = 0;
  /** The changed map slots as StructureStore.changedSlots last listed them, or null once one more or one fewer differs. */
  diff: Uint16Array | null = null;
  /** Slots [0, high) have been used at some point. */
  high = 0;
  live = 0;
  cap: number;
  /** Content index. 0 marks an empty slot. */
  kind: Uint16Array;
  /**
   * Centre of the collider box, world metres. `x`, `y`, `z` and `yaw` are the map's own columns, lent by placeMap, until a
   * piece built in the chunk grows the table. A map's piece swapped, emptied or set back leaves them lent.
   */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Uint16Array;
  owner: Uint32Array;
  hp: Float32Array;
  /** Table version at which the slot last changed. */
  mod: Uint32Array;
  /**
   * A lattice row's address: its frame's gid (0 for a row with a free pose), its key's two words, and its direction mod 3.
   * Null until the chunk's first lattice row, then 13 bytes a row. A table detached keeps them: see StructureStore.unkeyRows.
   */
  fr: Uint32Array | null = null;
  k0: Uint32Array | null = null;
  k1: Uint32Array | null = null;
  tw: Uint8Array | null = null;
  free: number[] = [];
  constructor(cap = 16, lent: Pick<PlacedRows, "x" | "y" | "z" | "yaw"> | null = null) {
    this.cap = cap;
    this.kind = new Uint16Array(cap);
    this.x = lent ? lent.x : new Float32Array(cap);
    this.y = lent ? lent.y : new Float32Array(cap);
    this.z = lent ? lent.z : new Float32Array(cap);
    this.yaw = lent ? lent.yaw : new Uint16Array(cap);
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

  ensure(slot: number): void {
    if (slot < this.cap) return;
    let cap = this.cap;
    while (cap <= slot) cap *= 2;
    const grow = <T extends Uint16Array | Float32Array | Uint32Array | Uint8Array>(a: T): T => {
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
    if (this.fr) [this.fr, this.k0, this.k1, this.tw] = [grow(this.fr), grow(this.k0!), grow(this.k1!), grow(this.tw!)];
    this.cap = cap;
  }

  /** Makes the key columns, for the chunk's first lattice row. */
  keyed(): void {
    [this.fr, this.k0, this.k1, this.tw] = [new Uint32Array(this.cap), new Uint32Array(this.cap), new Uint32Array(this.cap), new Uint8Array(this.cap)];
  }
}

// Scratch for keying a row.
const cells = new Cells();
const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
const found: LatticeKey = { fr: 0, k0: 0, k1: 0 };
const origin = { ox: 0, oy: 0, oz: 0 };
const tried: Frame[] = [];

/** A query's results. `refs` is replaced when it grows, so read it after the query returns. */
export class Found {
  refs: Uint32Array;

  constructor(cap = 64) {
    this.refs = new Uint32Array(cap);
  }
}

/** A store's parts with the surfaces of content a server's settings have changed: the boxes are as they were. */
export function withSurfaces(parts: PartTable, of: PartTable): PartTable {
  const { vehicleSurface: _was, surfaceGrip: _grip, ...boxes } = parts;
  return { ...boxes, ...(of.vehicleSurface ? { vehicleSurface: of.vehicleSurface } : {}), ...(of.surfaceGrip ? { surfaceGrip: of.surfaceGrip } : {}) };
}

export class StructureStore {
  readonly dims: MapDims;
  readonly chunks: (ChunkTable | null)[];
  /** The chunks that have a table, lowest first, for a walk that would otherwise visit every chunk of the map. */
  readonly held: number[] = [];
  count = 0;
  /** Bumped with any chunk's `shape`. */
  shapes = 0;
  /** Each is called with the chunk whose `shape` a piece set down or taken away has just bumped: once a chunk for pieces broken together. */
  readonly onShape: ((chunk: number) => void)[] = [];
  /** While above 0, shape listeners wait. `waiting` holds the chunks they are then told of. */
  private holding = 0;
  private readonly waiting: number[] = [];
  private readonly leaves: Leaves = { kind: 0, hp: 0 };
  /** Entries the last query passed over for lying outside its height band. */
  passed = 0;
  /** Called after any change to a chunk's table. `healthOnly` is true when nothing but a piece's health changed. */
  onChunkChanged: ((chunk: number, healthOnly: boolean) => void) | null = null;

  /** Per content index, the half extents of the box that bounds the whole structure. */
  private readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  private readonly halfZ: Float32Array;
  /** The host and the session give it content's parts again when a server's settings change them. */
  parts: PartTable;

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

  /** As placeMap was given them: the map's kinds as content indices, and each kind's health. Null where no map was set down. */
  private placedKinds: Uint16Array | null = null;
  private placedHp: Float32Array | null = null;

  /** Kinds that bodies pass through. Rays and drawing still see them. */
  private readonly soft: Uint8Array | null;
  /** Per kind, in metres from a structure's origin: the bottom and top of its boxes, and how far they reach sideways at any yaw. */
  readonly low: Float32Array;
  readonly top: Float32Array;
  readonly spread: Float32Array;
  /** Per kind, metres its footprint is widened by, for convex parts on a 60 degree vector, whose corners round a little out. */
  private readonly pad: Float32Array;

  /** The built kinds' forms, or null: then no row has a key. */
  readonly forms: FormTable | null;
  /** The bases: each lattice row is in one, by the gid in its `fr`. */
  readonly frames: Frames;
  /** Which lattice row fills each cell of each frame. */
  readonly occupied = new Occupancy();
  /** The frame and key `place` is setting a row down by, while `add` writes it. */
  private placing: Frame | null = null;
  private placingK0 = 0;
  private placingK1 = 0;
  /** Chunks with rows `put` found no key for, each with `frames.listings` as it was when they were last tried. */
  private readonly orphans = new Map<number, number>();

  constructor(dims: MapDims, halfX: Float32Array, halfY: Float32Array, halfZ: Float32Array, soft: Uint8Array | null = null, parts: PartTable | null = null) {
    this.dims = dims;
    this.soft = soft;
    this.parts = parts ?? oneBoxEach(halfX, halfY, halfZ);
    this.forms = parts?.forms ?? null;
    this.frames = new Frames(chunkCount(dims));
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
    this.top = new Float32Array(kinds);
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
      this.top[k] = high;
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
      for (let s = t.high - 1; s >= t.mapped; s--) if (t.kind[s] === 0) t.free.push(s);
      t.freeStale = false;
    }
    if (t.free.length > 0) slot = t.free.pop()!;
    else {
      if (t.high >= MAX_SLOTS_PER_CHUNK) return -1;
      slot = t.high;
    }
    t.version++;
    this.write(chunk, t, slot, kind, x, y, z, yaw & 0xffff, owner, hp, t.version);
    if (this.placing) this.key(chunk, t, slot, this.placing, this.placingK0, this.placingK1);
    else if (this.forms) this.adopt(chunk, t, slot);
    t.touch(slot, TOUCH_MOVED);
    this.onChunkChanged?.(chunk, false);
    return chunk * 65536 + slot;
  }

  /**
   * Whether `place` would set a piece of `kind` down by this key: the frame is made, the key names a slot of the kind's
   * form (keyFits), and every cell the piece would cover is on the lattice and free.
   */
  fits(kind: number, fr: number, k0: number, k1: number): boolean {
    const forms = this.forms;
    if (!forms || !(kind > 0 && kind < forms.cls.length) || forms.cls[kind]! < 0 || !this.frames.get(fr)) return false;
    if (!keyFits(forms, kind, k0, k1) || !formCells(forms, kind, k0, k1, cells)) return false;
    for (let i = 0; i < cells.n; i++) if (!this.occupied.free(fr, cells.k0[i]!, cells.k1[i]!, cells.reach[i]!)) return false;
    return true;
  }

  /**
   * Sets a piece down in a slot of a frame's lattice, as `add` does one by its pose: its place and turn are poseOf of its
   * key. Returns the ref, or -1 where the key does not fit (`fits`), the owner is not the frame's team, the pose is off
   * the map or the chunk is full. Authority only.
   */
  place(kind: number, fr: number, k0: number, k1: number, owner: number, hp: number): number {
    if (!this.fits(kind, fr, k0, k1)) return -1;
    const f = this.frames.get(fr)!;
    poseOf(f, k0, k1, this.forms!, kind, pose);
    const x = pose.x / STRUCT_UNITS;
    const z = pose.z / STRUCT_UNITS;
    if (owner === 0 || owner !== f.team || !(x >= 0 && z >= 0 && x < this.dims.chunksX * CHUNK_SIZE && z < this.dims.chunksZ * CHUNK_SIZE)) return -1;
    this.placing = f;
    this.placingK0 = k0;
    this.placingK1 = k1;
    // Shape listeners wait until the row has its key.
    this.hold();
    const ref = this.add(kind, x, pose.y / STRUCT_UNITS, z, pose.yaw, owner, hp);
    this.placing = null;
    this.release();
    return ref;
  }

  /** The gid of the frame the piece `ref` is in, or 0 for a row with a free pose, or for none. */
  frameAt(ref: number): number {
    const t = this.chunks[Math.floor(ref / 65536)];
    return t && t.fr ? t.fr[ref & 0xffff]! : 0;
  }

  /** The address of the piece `ref`, to `out`. False for a row with a free pose, or for none. */
  keyAt(ref: number, out: LatticeKey): boolean {
    const t = this.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || !t.fr || t.fr[slot] === 0) return false;
    out.fr = t.fr[slot]!;
    out.k0 = t.k0![slot]!;
    out.k1 = t.k1![slot]!;
    return true;
  }

  /** The ref of the piece entered in exactly the cell of this key in frame `fr`, whatever its turn, or -1. */
  refAt(fr: number, k0: number, k1: number): number {
    return this.occupied.at(fr, k0, k1);
  }

  /** The ref of the piece that covers the level of this key's edge, face or vertex, from there or from under it, or -1. */
  covering(fr: number, k0: number, k1: number): number {
    return this.occupied.covering(fr, k0, k1);
  }

  /** Writes the refs of frame `fr`'s rows to `out`, a chunk at a time in the order the frame came to them, and returns the count. */
  rowsOf(fr: number, out: Found): number {
    const f = this.frames.get(fr);
    if (!f) return 0;
    if (out.refs.length < f.live) out.refs = new Uint32Array(f.live);
    let n = 0;
    for (const chunk of f.chunks) {
      const t = this.chunks[chunk]!;
      const of = t.fr!;
      for (let slot = t.mapped; slot < t.high; slot++) if (of[slot] === fr) out.refs[n++] = chunk * 65536 + slot;
    }
    return n;
  }

  /** Makes a frame's box the least that holds its rows' origins, if rows that left may have made it more. */
  tighten(f: Frame): void {
    if (!f.loose) return;
    f.loose = false;
    let first = true;
    for (const chunk of f.chunks) {
      const t = this.chunks[chunk]!;
      const of = t.fr!;
      for (let slot = t.mapped; slot < t.high; slot++) {
        if (of[slot] !== f.gid) continue;
        const x = Math.round(t.x[slot]! * STRUCT_UNITS);
        const z = Math.round(t.z[slot]! * STRUCT_UNITS);
        if (first) [f.minX, f.maxX, f.minZ, f.maxZ] = [x, x, z, z];
        first = false;
        f.minX = Math.min(f.minX, x);
        f.maxX = Math.max(f.maxX, x);
        f.minZ = Math.min(f.minZ, z);
        f.maxZ = Math.max(f.maxZ, z);
      }
    }
  }

  /** Gives the row in `slot` its place in frame `f`: its key columns, its cells and its count. The cells are free (`fits`). */
  private key(chunk: number, t: ChunkTable, slot: number, f: Frame, k0: number, k1: number): void {
    const forms = this.forms!;
    const kind = t.kind[slot]!;
    if (!t.fr) t.keyed();
    t.fr![slot] = f.gid;
    t.k0![slot] = k0;
    t.k1![slot] = k1;
    t.tw![slot] = twOfKey(k0, k1);
    this.cover(chunk, t, slot);
    this.frames.enter(f, chunk, Math.round(t.x[slot]! * STRUCT_UNITS), Math.round(t.z[slot]! * STRUCT_UNITS), forms.def[kind]!.root !== undefined);
  }

  /** Enters the keyed row in `slot` in each cell its kind's form covers. */
  private cover(chunk: number, t: ChunkTable, slot: number): void {
    formCells(this.forms!, t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, cells);
    for (let i = 0; i < cells.n; i++) this.occupied.put(t.fr![slot]!, cells.k0[i]!, cells.k1[i]!, chunk * 65536 + slot, cells.reach[i]!);
  }

  /**
   * Takes the keyed row in `slot` out of its cells before it is erased. A row changed where it stands keeps its key columns
   * and its count, for `rekey` once its new kind is written; any other leaves its frame, which goes with its last row.
   */
  private unkey(chunk: number, t: ChunkTable, slot: number, inPlace: boolean): void {
    const f = this.frames.get(t.fr![slot]!)!;
    const kind = t.kind[slot]!;
    const root = this.forms!.def[kind]!.root !== undefined;
    formCells(this.forms!, kind, t.k0![slot]!, t.k1![slot]!, cells);
    for (let i = 0; i < cells.n; i++) this.occupied.take(f.gid, cells.k0[i]!, cells.k1[i]!);
    if (inPlace) {
      if (root) f.roots--;
      return;
    }
    this.frames.leave(f, chunk, Math.round(t.x[slot]! * STRUCT_UNITS), Math.round(t.z[slot]! * STRUCT_UNITS), root);
    t.fr![slot] = t.k0![slot] = t.k1![slot] = t.tw![slot] = 0;
  }

  /** Enters a row changed where it stands in its cells again, if its new kind fills the same slot at the same pose (a door opened). Else the row leaves its frame (a heap). */
  private rekey(chunk: number, t: ChunkTable, slot: number): void {
    const forms = this.forms!;
    const kind = t.kind[slot]!;
    const fr = t.fr![slot]!;
    const f = this.frames.get(fr)!;
    const x = Math.round(t.x[slot]! * STRUCT_UNITS);
    const z = Math.round(t.z[slot]! * STRUCT_UNITS);
    if (this.fits(kind, fr, t.k0![slot]!, t.k1![slot]!)) {
      poseOf(f, t.k0![slot]!, t.k1![slot]!, forms, kind, pose);
      if (pose.x === x && pose.z === z && pose.y === Math.round(t.y[slot]! * STRUCT_UNITS) && pose.yaw === t.yaw[slot]) {
        this.cover(chunk, t, slot);
        if (forms.def[kind]!.root !== undefined) f.roots++;
        return;
      }
    }
    this.frames.leave(f, chunk, x, z, false);
    t.fr![slot] = t.k0![slot] = t.k1![slot] = t.tw![slot] = 0;
  }

  /**
   * Takes every row of a table out of its frame and its cells, and leaves the rows free. For a table about to be detached:
   * attached again, `adoptRows` keys its rows by their poses, as rows received are keyed.
   */
  unkeyRows(chunk: number, t: ChunkTable): void {
    if (!t.fr) return;
    for (let slot = t.mapped; slot < t.high; slot++) if (t.fr[slot] !== 0) this.unkey(chunk, t, slot, false);
  }

  // The adoption shim: `adopt`, `adoptRows`, `orphans`, their callers in `add`, `put` and `setVersion`, and lattice/adopt.ts.
  // Temporary. A piece set down by its pose alone is given a frame and a key where its pose is exactly a slot's. Delete it
  // all once placing, the wire and the save speak keys.

  /**
   * Keys the free row in `slot` if it can be: into a frame of its owner with rows in this chunk or one beside it, where its
   * pose is exactly that of a free slot, or else, for a piece that may hold a base up, as the first row of a new frame.
   * False for a built piece left free.
   */
  private adopt(chunk: number, t: ChunkTable, slot: number): boolean {
    const forms = this.forms!;
    const kind = t.kind[slot]!;
    const owner = t.owner[slot]!;
    if (owner === 0 || slot < t.mapped || forms.cls[kind]! < 0 || (t.fr !== null && t.fr[slot] !== 0)) return true;
    const x = Math.round(t.x[slot]! * STRUCT_UNITS);
    const y = Math.round(t.y[slot]! * STRUCT_UNITS);
    const z = Math.round(t.z[slot]! * STRUCT_UNITS);
    const yaw = t.yaw[slot]!;
    const { chunksX, chunksZ } = this.dims;
    const cx = chunk % chunksX;
    const cz = (chunk - cx) / chunksX;
    tried.length = 0;
    let between = false;
    for (let nz = Math.max(0, cz - 1); nz <= Math.min(chunksZ - 1, cz + 1); nz++) {
      for (let nx = Math.max(0, cx - 1); nx <= Math.min(chunksX - 1, cx + 1); nx++) {
        for (const f of this.frames.listed(nz * chunksX + nx)) {
          if (f.team !== owner || tried.includes(f)) continue;
          tried.push(f);
          const answer = keyOfPose(f, forms, kind, x, y, z, yaw, found);
          if (answer === KEY_BETWEEN) between = true;
          if (answer !== KEY_FOUND || !this.fits(kind, f.gid, found.k0, found.k1)) continue;
          poseOf(f, found.k0, found.k1, forms, kind, pose);
          if (pose.x !== x || pose.y !== y || pose.z !== z || pose.yaw !== yaw) continue;
          this.key(chunk, t, slot, f, found.k0, found.k1);
          return true;
        }
      }
    }
    // A pillar hung under a foundation is of its base and half a level off every slot: it stays free, where it is today.
    if (between || forms.def[kind]!.root === undefined) return false;
    baseOrigin(forms, kind, x, y, z, yaw, origin);
    this.key(chunk, t, slot, this.frames.make(origin.ox, origin.oy, origin.oz, yaw, owner), key0(forms.cls[kind]!, 0, 0, 0), key1(0, 0, 0, forms.layer[kind]!, 0, 0));
    return true;
  }

  /** Tries each built row of a table that has no key. Returns whether one is still free. */
  adoptRows(chunk: number, t: ChunkTable): boolean {
    const forms = this.forms;
    let left = false;
    if (forms) for (let slot = t.mapped; slot < t.high; slot++) if (t.kind[slot] !== 0 && !this.adopt(chunk, t, slot)) left = true;
    return left;
  }

  /** Tries the rows `put` left free in `chunk` and the chunks round it again, where a frame has come to a chunk since they were last tried. */
  private readopt(chunk: number): void {
    const { chunksX, chunksZ } = this.dims;
    const cx = chunk % chunksX;
    const cz = (chunk - cx) / chunksX;
    for (let nz = Math.max(0, cz - 1); nz <= Math.min(chunksZ - 1, cz + 1); nz++) {
      for (let nx = Math.max(0, cx - 1); nx <= Math.min(chunksX - 1, cx + 1); nx++) {
        const near = nz * chunksX + nx;
        const t = this.chunks[near];
        if (this.orphans.get(near) === this.frames.listings || !this.orphans.has(near)) continue;
        if (t && this.adoptRows(near, t)) this.orphans.set(near, this.frames.listings);
        else this.orphans.delete(near);
      }
    }
  }

  /**
   * Sets down a map's statics in a store that holds nothing, as `add` would one by one in the map's order with no owner and
   * `hp` of its kind: chunk `c` takes rows `first[c]` up to `first[c + 1]` into its slots in turn, and the grid takes them in
   * the order `rows.row` gives (the chunks' where it is empty), so every query lists them as it would. `kinds` turns a row's
   * kind into a content index. Each table and the grid are made the size they need, nothing is logged as changed, and each
   * chunk stands as placed (`asPlaced`). The store keeps `rows`, `kinds` and `hp` to tell what has changed since. Authority only.
   */
  placeMap(rows: PlacedRows, kinds: Uint16Array, hp: Float32Array): void {
    if (this.count !== 0 || this.held.length !== 0) throw new Error("the map's statics are set down in a store that holds nothing");
    const { first, kind, x, z, yaw } = rows;
    this.placedKinds = kinds;
    this.placedHp = hp;
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
      t.map = lent ? kind.subarray(from, to) : new Uint16Array(n);
      this.held.push(c);
      for (let r = from; r < to; r++) {
        const s = slotOf[r]!;
        if (s < 0) continue;
        const k = kinds[kind[r]!]!;
        t.kind[s] = k;
        if (!lent) {
          t.map[s] = kind[r]!;
          t.x[s] = x[r]!;
          t.y[s] = rows.y[r]!;
          t.z[s] = z[r]!;
          t.yaw[s] = yaw[r]!;
        }
        t.hp[s] = hp[k]!;
        t.mod[s] = s + 1;
      }
      // What was set down is not in the log of changes.
      t.mapped = t.high = t.live = t.version = t.recentFloor = t.shape = t.placed = n;
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
   * Whether `chunk` holds what the map set down in it and nothing else: each of the map's slots its piece, owned by nobody
   * and at its kind's health, and no piece built. A chunk mended or swapped back to that stands as placed again, whatever
   * its version. A chunk the map set nothing down in stands so while nothing stands in it. Authority only.
   */
  asPlaced(chunk: number): boolean {
    const t = this.chunks[chunk];
    return !t || t.differs === 0;
  }

  /** Whether `slot` is a map slot of `chunk` that holds what the map set down in it. A map slot's place and turn never change. Authority only. */
  asMap(chunk: number, slot: number): boolean {
    const t = this.chunks[chunk];
    return !!t && slot < t.mapped && !this.differsAt(t, slot);
  }

  /** The kind the map set down in `slot` of `chunk`, whatever stands there now, or 0 for a slot that is not the map's. Authority only. */
  mapKind(chunk: number, slot: number): number {
    const t = this.chunks[chunk];
    return t && slot < t.mapped ? this.placedKinds![t.map![slot]!]! : 0;
  }

  /**
   * The kind whose material and full health the piece in `slot` of `chunk` has: the kind the map placed, for a map's piece
   * owned by nobody, whatever form its row has taken; else its row's own. Authority only.
   */
  bodyKind(chunk: number, slot: number): number {
    const t = this.chunks[chunk];
    if (!t || slot >= t.high) return 0;
    return slot < t.mapped && t.owner[slot] === 0 && t.kind[slot] !== 0 ? this.placedKinds![t.map![slot]!]! : t.kind[slot]!;
  }

  /** Whether `slot` counts in its chunk's `differs`: a map slot not as the map set it down, or a live slot past the map's. */
  private differsAt(t: ChunkTable, slot: number): boolean {
    if (slot >= t.mapped) return t.kind[slot] !== 0;
    const kind = this.placedKinds![t.map![slot]!]!;
    return t.kind[slot] !== kind || t.owner[slot] !== 0 || t.hp[slot] !== this.placedHp![kind];
  }

  /** Counts `slot` again after a change to it. `was` is what differsAt said of it before. */
  private tally(t: ChunkTable, slot: number, was: boolean): void {
    if (this.differsAt(t, slot) === was) return;
    const by = was ? -1 : 1;
    t.differs += by;
    if (slot >= t.mapped) return;
    t.changed += by;
    t.diff = null;
  }

  /**
   * The map slots of `chunk` that are not as the map set them down, in ascending order. What each now holds is its row. The
   * list is made when first asked for and kept until a map slot comes to differ or stops differing, so it is made at most
   * once a version, and a blow to a slot already on it leaves it standing. Authority only.
   */
  changedSlots(chunk: number): Uint16Array {
    const t = this.chunks[chunk];
    if (!t || t.changed === 0) return NO_SLOTS;
    if (t.diff) return t.diff;
    const list = new Uint16Array(t.changed);
    for (let s = 0, n = 0; n < list.length; s++) if (this.differsAt(t, s)) list[n++] = s;
    return (t.diff = list);
  }

  /** Called with a structure's ref and cause before it is removed, while its row can still be read. Authority only. */
  onRemove: ((ref: number, cause: number) => void) | null = null;

  /** Called as a piece with an owner is set down (`by` 1) or goes (-1), and once each way when one changes owner. (x, z) is as its row holds it. */
  onOwned: ((kind: number, x: number, z: number, owner: number, by: number) => void) | null = null;

  /** Gives the piece in `slot` to `to`, which may be nobody. */
  private own(t: ChunkTable, slot: number, to: number): void {
    const was = t.owner[slot]!;
    if (was === to) return;
    if (was !== 0) this.onOwned?.(t.kind[slot]!, t.x[slot]!, t.z[slot]!, was, -1);
    t.owner[slot] = to;
    if (to !== 0) this.onOwned?.(t.kind[slot]!, t.x[slot]!, t.z[slot]!, to, 1);
    // A frame is its rows' owner's.
    if (t.fr !== null && t.fr[slot] !== 0) this.frames.get(t.fr[slot]!)!.team = to;
  }

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
    const joins = last !== undefined && last.version === t.version && last.cause === cause && last.stamp === stamp && last.left.length === 0 && last.radius === 0;
    t.version++;
    if (joins) {
      const runs = last.runs;
      if (runs[runs.length - 2]! + runs[runs.length - 1]! === slot) runs[runs.length - 1]!++;
      else runs.push(slot, 1);
      last.version = t.version;
      last.count++;
    } else t.log({ version: t.version, cause, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, stamp, radius: 0, runs: [slot, 1], left: [], count: 1 });
    this.erase(chunk, t, slot, t.version);
    t.touch(slot, TOUCH_MOVED);
    if (slot >= t.mapped) t.free.push(slot);
    this.onChunkChanged?.(chunk, false);
    return true;
  }

  /**
   * Removes the first `n` of `refs`, which it sorts in place. Each chunk changes version once and logs one batch that began at
   * (x, y, z). Returns how many were removed. Authority only.
   */
  removeMany(refs: Uint32Array, n: number, cause: number, x: number, y: number, z: number, stamp: number): number {
    return this.breakMany(refs, n, cause, null, x, y, z, stamp);
  }

  /**
   * Breaks the first `n` of `refs`, which it sorts in place. Each is emptied, or takes in place the kind and health `leaves`
   * gives it (its heap). Each chunk changes version once, logs one batch that began at (x, y, z) and tells its shape
   * listeners once. `radius` is a blast's reach. Returns how many were broken. Authority only.
   */
  breakMany(refs: Uint32Array, n: number, cause: number, leaves: ((ref: number, out: Leaves) => void) | null, x: number, y: number, z: number, stamp: number, radius = 0): number {
    const sorted = refs.subarray(0, n).sort();
    const out = this.leaves;
    let broken = 0;
    this.hold();
    for (let i = 0; i < n; ) {
      const chunk = Math.floor(sorted[i]! / 65536);
      const t = this.chunks[chunk];
      let end = i;
      while (end < n && Math.floor(sorted[end]! / 65536) === chunk) end++;
      if (t) {
        const runs: number[] = [];
        const left: number[] = [];
        let count = 0;
        for (let k = i; k < end; k++) {
          const slot = sorted[k]! & 0xffff;
          if (slot >= t.high || t.kind[slot] === 0 || (k > i && sorted[k] === sorted[k - 1])) continue;
          out.kind = 0;
          leaves?.(sorted[k]!, out);
          const heap = out.kind !== 0;
          if (!heap) this.onRemove?.(sorted[k]!, cause);
          if (count === 0) t.version++;
          if (heap) {
            const [px, py, pz, yaw, owner] = [t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!];
            this.erase(chunk, t, slot, t.version, true);
            this.write(chunk, t, slot, out.kind, px, py, pz, yaw, owner, out.hp, t.version, true);
            t.touch(slot, TOUCH_KIND | TOUCH_LEFT);
          } else {
            this.erase(chunk, t, slot, t.version);
            t.touch(slot, TOUCH_MOVED);
            if (slot >= t.mapped) t.free.push(slot);
          }
          // Slots come in ascending order, so an adjacent slot extends the last run.
          const list = heap ? left : runs;
          if (list.length > 0 && list[list.length - 2]! + list[list.length - 1]! === slot) list[list.length - 1]!++;
          else list.push(slot, 1);
          count++;
        }
        if (count > 0) {
          t.log({ version: t.version, cause, x, y, z, stamp, radius, runs, left, count });
          this.onChunkChanged?.(chunk, false);
          broken += count;
        }
      }
      i = end;
    }
    this.release();
    return broken;
  }

  /** Until `release`, shape listeners wait, and are then told once of each chunk whose shape changed. Authority only. */
  hold(): void {
    this.holding++;
  }

  release(): void {
    if (--this.holding > 0) return;
    const waiting = this.waiting;
    for (let k = 0; k < waiting.length; k++) for (let i = 0; i < this.onShape.length; i++) this.onShape[i]!(waiting[k]!);
    waiting.length = 0;
  }

  /** Tells the shape listeners of `chunk`, or keeps it for `release`. */
  private shaped(chunk: number): void {
    if (this.holding === 0) {
      for (let i = 0; i < this.onShape.length; i++) this.onShape[i]!(chunk);
      return;
    }
    if (!this.waiting.includes(chunk)) this.waiting.push(chunk);
  }

  /**
   * Changes a structure's kind in place and keeps the rest of its row (a door opening), but its health where `health` is
   * given (a city piece taking a broken form). False if there is no such structure. Authority only.
   */
  swap(ref: number, kind: number, health = -1): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0 || kind === 0) return false;
    const [x, y, z, yaw, owner, hp] = [t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]!];
    t.version++;
    this.erase(chunk, t, slot, t.version, true);
    this.write(chunk, t, slot, kind, x, y, z, yaw, owner, health >= 0 ? health : hp, t.version, true);
    t.touch(slot, TOUCH_KIND);
    this.onChunkChanged?.(chunk, false);
    return true;
  }

  /**
   * Sets a structure's health and tells nobody: the chunk's version and its log of changes stand, so no client is sent it
   * and nothing drawn far off is made again. What differs from the map is still counted, so the chunk is saved, and a
   * client that comes later is sent the health. For wear that shows no change. False if there is no such structure. Authority only.
   */
  wear(ref: number, hp: number): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    const was = this.differsAt(t, slot);
    t.hp[slot] = hp;
    this.tally(t, slot, was);
    this.onChunkChanged?.(chunk, true);
    return true;
  }

  /** False if there is no such structure. Authority only. */
  mend(ref: number, hp: number): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    t.version++;
    const was = this.differsAt(t, slot);
    t.hp[slot] = hp;
    this.tally(t, slot, was);
    t.mod[slot] = t.version;
    t.touch(slot, 0);
    this.onChunkChanged?.(chunk, true);
    return true;
  }

  /**
   * Sets the first `n` map slots of `slots` in `chunk` back as the map set them down: each its piece, owned by nobody, at
   * its kind's health. The chunk changes version once and tells its shape listeners once; a slot that is as the map has
   * it is passed over. What differs is counted again, so the list of changed slots, the far lists made from it and the
   * save all follow, and a chunk wholly healed stands as placed. Returns how many were set back. Authority only.
   */
  heal(chunk: number, slots: ArrayLike<number>, n = slots.length): number {
    const t = this.chunks[chunk];
    if (!t || !this.placedKinds) return 0;
    let healed = 0, shaped = false;
    this.hold();
    for (let i = 0; i < n; i++) {
      const slot = slots[i]!;
      if (slot >= t.mapped || !this.differsAt(t, slot)) continue;
      if (healed++ === 0) t.version++;
      const kind = this.placedKinds[t.map![slot]!]!, hp = this.placedHp![kind]!;
      const was = t.kind[slot]!;
      if (was === kind) {
        // Its health or its owner alone: the grid and what is drawn stand.
        this.own(t, slot, 0);
        t.hp[slot] = hp;
        this.tally(t, slot, true);
        t.mod[slot] = t.version;
        t.touch(slot, 0);
        continue;
      }
      // An emptied slot is set down again; a form or a heap is changed where it stands.
      if (was !== 0) this.erase(chunk, t, slot, t.version, true);
      this.write(chunk, t, slot, kind, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 0, hp, t.version, was !== 0);
      t.touch(slot, was !== 0 ? TOUCH_KIND : TOUCH_MOVED);
      shaped = true;
    }
    if (healed > 0) this.onChunkChanged?.(chunk, !shaped);
    this.release();
    return healed;
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
    const was = this.differsAt(t, slot);
    t.hp[slot] = left;
    this.tally(t, slot, was);
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
      if (!t || (from !== 0 && t.differs === 0)) continue;
      let any = false;
      for (let slot = 0; slot < t.high; slot++) {
        if (t.kind[slot] === 0 || t.owner[slot] !== from) continue;
        if (!any) t.version++;
        any = true;
        const was = this.differsAt(t, slot);
        this.own(t, slot, to);
        this.tally(t, slot, was);
        t.mod[slot] = t.version;
        t.touch(slot, 0);
        n++;
      }
      if (any) this.onChunkChanged?.(chunk, false);
    }
    return n;
  }

  /**
   * Sets a slot to replicated or loaded contents. `kind` 0 empties it. Does not advance the table version, so follow with
   * setVersion. A piece for a map slot goes where the map has that slot (putMapped), since a map slot never moves.
   */
  put(chunk: number, slot: number, kind: number, x: number, y: number, z: number, yaw: number, owner: number, hp: number, mod: number): void {
    const t = this.tableOf(chunk);
    const there = slot < t.high && t.x[slot] === Math.fround(x) && t.y[slot] === Math.fround(y) && t.z[slot] === Math.fround(z) && t.yaw[slot] === yaw;
    if (kind !== 0 && slot < t.mapped && !there) throw new Error(`chunk ${chunk}: slot ${slot} is the map's and keeps its place`);
    if (kind !== 0 && there && t.kind[slot] === kind) {
      // The same piece in the same place: only its health or owner changed, so the grid and what is drawn stand.
      const was = this.differsAt(t, slot);
      this.own(t, slot, owner);
      t.hp[slot] = hp;
      this.tally(t, slot, was);
      t.mod[slot] = mod;
      return;
    }
    const inPlace = kind !== 0 && there && t.kind[slot] !== 0;
    if (slot < t.high && t.kind[slot] !== 0) this.erase(chunk, t, slot, mod, inPlace);
    if (kind !== 0) this.write(chunk, t, slot, kind, x, y, z, yaw, owner, hp, mod, inPlace);
    else {
      t.ensure(slot);
      if (slot >= t.high) t.high = slot + 1;
      t.mod[slot] = mod;
    }
    if (kind !== 0 && this.forms && !this.adopt(chunk, t, slot)) this.orphans.set(chunk, -1);
  }

  /** Sets a map slot to loaded contents, where the map has it. `kind` 0 empties it. Follow with setVersion, as after put. */
  putMapped(chunk: number, slot: number, kind: number, owner: number, hp: number, mod: number): void {
    const t = this.chunks[chunk];
    if (!t || slot >= t.mapped) throw new Error(`chunk ${chunk}: slot ${slot} is not the map's`);
    this.put(chunk, slot, kind, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, owner, hp, mod);
  }

  /** Call after loading or applying a delta. */
  setVersion(chunk: number, version: number): void {
    const t = this.tableOf(chunk);
    t.version = version;
    // What was loaded or applied is not in the log of changes.
    t.recentCount = 0;
    t.recentFloor = version;
    t.freeStale = true;
    if (this.orphans.size > 0) this.readopt(chunk);
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

  /** Whether `query` would find any structure there: the same test, stopped at the first. */
  any(minX: number, minZ: number, maxX: number, maxZ: number, minY = -Infinity, maxY = Infinity): boolean {
    const cx0 = Math.max(0, Math.floor(minX / GRID_CELL)), cx1 = Math.min(this.gridX - 1, Math.floor(maxX / GRID_CELL));
    const cz0 = Math.max(0, Math.floor(minZ / GRID_CELL)), cz1 = Math.min(this.gridZ - 1, Math.floor(maxZ / GRID_CELL));
    const chunksX = this.dims.chunksX;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cells = this.heads[(cz >> 4) * chunksX + (cx >> 4)];
        if (!cells) continue;
        for (let node = cells[(cz & 15) * CELLS + (cx & 15)]!; node !== 0; node = this.nodeNext[node - 1]!) {
          if (this.nodeTop[node - 1]! >= minY && this.nodeBottom[node - 1]! <= maxY) return true;
        }
      }
    }
    return false;
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
    if (slot >= t.high) t.high = slot + 1;
    const was = this.differsAt(t, slot);
    t.kind[slot] = kind;
    // A map's slot holds its place and turn for good, so the columns the map lent are never written.
    if (slot >= t.mapped) {
      t.x[slot] = x;
      t.y[slot] = y;
      t.z[slot] = z;
      t.yaw[slot] = yaw;
    }
    t.owner[slot] = owner;
    if (owner !== 0) this.onOwned?.(kind, t.x[slot]!, t.z[slot]!, owner, 1);
    t.hp[slot] = hp;
    this.tally(t, slot, was);
    t.mod[slot] = mod;
    t.shape++;
    this.shapes++;
    this.shaped(chunk);
    t.live++;
    this.count++;
    this.footprint(kind, x, z, yaw);
    this.link(chunk * 65536 + slot, kind, y);
    if (inPlace && t.fr !== null && t.fr[slot] !== 0) this.rekey(chunk, t, slot);
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
        this.nodeTop[node] = y + this.top[kind]!;
        this.nodeNext[node] = cells[cell]!;
        cells[cell] = node + 1;
      }
    }
  }

  private erase(chunk: number, t: ChunkTable, slot: number, mod: number, inPlace = false): void {
    if (!inPlace) t.placed++;
    if (t.fr !== null && t.fr[slot] !== 0) this.unkey(chunk, t, slot, inPlace);
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
    if (t.owner[slot] !== 0) this.onOwned?.(t.kind[slot]!, t.x[slot]!, t.z[slot]!, t.owner[slot]!, -1);
    // Empty slots hold zeros, so equal tables are equal byte for byte. A map's slot keeps its place and turn, which are the map's.
    const was = this.differsAt(t, slot);
    t.kind[slot] = 0;
    if (slot >= t.mapped) {
      t.x[slot] = 0;
      t.y[slot] = 0;
      t.z[slot] = 0;
      t.yaw[slot] = 0;
    }
    t.owner[slot] = 0;
    t.hp[slot] = 0;
    this.tally(t, slot, was);
    t.mod[slot] = mod;
    t.shape++;
    this.shapes++;
    this.shaped(chunk);
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
