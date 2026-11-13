// Dynamic entities: players, creatures, projectiles. Things that move.
//
// Struct-of-arrays with generational handles. No per-entity objects, so the
// tick allocates nothing and iterates memory in order. Each entity is linked
// into the list of the chunk it stands in; interest, dormancy and broad-phase
// queries all walk those lists.

import { chunkAt, chunkCount, type MapDims } from "../coords.ts";
import { HANDLE_GEN_MASK, HANDLE_INDEX_MASK, NULL_HANDLE, handleGen, handleIndex, makeHandle } from "../ids.ts";
import { MODE_WALK, STAMINA_UNITS, type Body } from "./character.ts";

export const F_ALIVE = 1;
export const F_GROUNDED = 2;
/** Stepped every tick. Cleared while the entity's chunk sleeps. */
export const F_AWAKE = 4;
export const F_PLAYER = 8;
/** A thing that stands where it is put: never stepped, never woken. */
export const F_PROP = 16;

export class EntityStore {
  readonly dims: MapDims;
  readonly cap: number;
  count = 0;

  readonly gen: Uint16Array;
  readonly flags: Uint8Array;
  /** Content index of the species. */
  readonly kind: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Facing, 1/65536 turns. */
  readonly yaw: Uint16Array;
  /** Persistent id, or 0 for entities that are never saved. */
  readonly pid: Float64Array;
  /** The rest of the predicted body state; see `Body` in character.ts. */
  readonly mode: Uint8Array;
  readonly stamina: Int32Array;
  readonly staminaMax: Uint16Array;
  readonly speedQ: Uint16Array;
  readonly swimQ: Uint16Array;
  readonly mflags: Uint8Array;
  /**
   * What others are told about a body when it enters their view: level, six
   * region colours, a name. `rev` changes whenever any of it does.
   */
  readonly level: Uint16Array;
  readonly colors: Uint8Array;
  readonly name: string[];
  readonly rev: Uint8Array;

  /** Chunk the entity is linked into, or -1. */
  readonly chunk: Int32Array;
  /** Per chunk: first entity index, or -1. */
  readonly chunkHead: Int32Array;
  readonly next: Int32Array;
  readonly prev: Int32Array;

  /** Free slots, oldest first, so a slot rests as long as possible before reuse. */
  private readonly freeRing: Int32Array;
  private freeRead = 0;
  private freeCount: number;

  constructor(dims: MapDims, cap: number) {
    if (cap > HANDLE_INDEX_MASK + 1) throw new Error("entity capacity exceeds handle index range");
    this.dims = dims;
    this.cap = cap;
    this.gen = new Uint16Array(cap).fill(1);
    this.flags = new Uint8Array(cap);
    this.kind = new Uint16Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.yaw = new Uint16Array(cap);
    this.pid = new Float64Array(cap);
    this.mode = new Uint8Array(cap);
    this.stamina = new Int32Array(cap);
    this.staminaMax = new Uint16Array(cap);
    this.speedQ = new Uint16Array(cap);
    this.swimQ = new Uint16Array(cap);
    this.mflags = new Uint8Array(cap);
    this.level = new Uint16Array(cap);
    this.colors = new Uint8Array(cap * 6);
    this.name = new Array<string>(cap).fill("");
    this.rev = new Uint8Array(cap);
    this.chunk = new Int32Array(cap).fill(-1);
    this.chunkHead = new Int32Array(chunkCount(dims)).fill(-1);
    this.next = new Int32Array(cap).fill(-1);
    this.prev = new Int32Array(cap).fill(-1);
    this.freeRing = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.freeRing[i] = i;
    this.freeCount = cap;
  }

  /** Create an entity. Returns its index, or -1 when the store is full. */
  create(kind: number, x: number, y: number, z: number, flags: number): number {
    if (this.freeCount === 0) return -1;
    const i = this.freeRing[this.freeRead]!;
    this.freeRead = (this.freeRead + 1) % this.cap;
    this.freeCount--;
    this.count++;
    this.flags[i] = F_ALIVE | flags;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.vz[i] = 0;
    this.yaw[i] = 0;
    this.pid[i] = 0;
    this.mode[i] = MODE_WALK;
    this.staminaMax[i] = 100;
    this.stamina[i] = 100 * STAMINA_UNITS;
    this.speedQ[i] = 1000;
    this.swimQ[i] = 1000;
    this.mflags[i] = 0;
    this.level[i] = 0;
    this.colors.fill(0, i * 6, i * 6 + 6);
    this.name[i] = "";
    this.rev[i] = (this.rev[i]! + 1) & 15;
    this.link(i, chunkAt(this.dims, x, z));
    return i;
  }

  /** Set what others see of an entity. If anything changed, clients that already see it are sent it again. */
  setLook(i: number, level: number, colors: ArrayLike<number> | null, name: string): void {
    if (level > 65535) level = 65535;
    // 24 characters is at most 72 bytes, which is what a snapshot will carry.
    if (name.length > 24) name = name.slice(0, 24);
    let same = this.level[i] === level && this.name[i] === name;
    for (let k = 0; k < 6 && same; k++) same = this.colors[i * 6 + k] === (colors ? colors[k]! : 0);
    if (same) return;
    this.level[i] = level;
    for (let k = 0; k < 6; k++) this.colors[i * 6 + k] = colors ? colors[k]! : 0;
    this.name[i] = name;
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  /** Copy an entity's predicted state into `b`. */
  loadBody(i: number, b: Body): void {
    b.x = this.x[i]!;
    b.y = this.y[i]!;
    b.z = this.z[i]!;
    b.vx = this.vx[i]!;
    b.vy = this.vy[i]!;
    b.vz = this.vz[i]!;
    b.grounded = (this.flags[i]! & F_GROUNDED) !== 0;
    b.mode = this.mode[i]!;
    b.stamina = this.stamina[i]!;
    b.staminaMax = this.staminaMax[i]!;
    b.speedQ = this.speedQ[i]!;
    b.swimQ = this.swimQ[i]!;
    b.mflags = this.mflags[i]!;
  }

  /** Write back what a step may change. Returns true if the entity changed chunk. */
  storeBody(i: number, b: Body): boolean {
    this.vx[i] = b.vx;
    this.vy[i] = b.vy;
    this.vz[i] = b.vz;
    this.flags[i] = b.grounded ? this.flags[i]! | F_GROUNDED : this.flags[i]! & ~F_GROUNDED;
    this.mode[i] = b.mode;
    this.stamina[i] = b.stamina;
    this.mflags[i] = b.mflags;
    return this.setPosition(i, b.x, b.y, b.z);
  }

  destroy(i: number): void {
    if ((this.flags[i]! & F_ALIVE) === 0) return;
    this.unlink(i);
    this.flags[i] = 0;
    let g = (this.gen[i]! + 1) & HANDLE_GEN_MASK;
    if (g === 0) g = 1;
    this.gen[i] = g;
    this.freeRing[(this.freeRead + this.freeCount) % this.cap] = i;
    this.freeCount++;
    this.count--;
  }

  handleOf(i: number): number {
    return makeHandle(i, this.gen[i]!);
  }

  /** Index for a handle, or -1 if it no longer names a live entity. */
  resolve(handle: number): number {
    if (handle === NULL_HANDLE) return -1;
    const i = handleIndex(handle);
    if (i >= this.cap || this.gen[i] !== handleGen(handle) || (this.flags[i]! & F_ALIVE) === 0) return -1;
    return i;
  }

  /** Move an entity, keeping its chunk link current. Returns true if it changed chunk. */
  setPosition(i: number, x: number, y: number, z: number): boolean {
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    const c = chunkAt(this.dims, x, z);
    if (c === this.chunk[i]) return false;
    this.unlink(i);
    this.link(i, c);
    return true;
  }

  private link(i: number, c: number): void {
    const head = this.chunkHead[c]!;
    this.chunk[i] = c;
    this.prev[i] = -1;
    this.next[i] = head;
    if (head >= 0) this.prev[head] = i;
    this.chunkHead[c] = i;
  }

  private unlink(i: number): void {
    const c = this.chunk[i]!;
    if (c < 0) return;
    const p = this.prev[i]!;
    const n = this.next[i]!;
    if (p >= 0) this.next[p] = n;
    else this.chunkHead[c] = n;
    if (n >= 0) this.prev[n] = p;
    this.chunk[i] = -1;
    this.prev[i] = -1;
    this.next[i] = -1;
  }
}
