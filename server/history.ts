// Where every moving entity was over the last half second. A shot is judged against where its target was when the shooter saw it.
// Only players and awake creatures have rows. A sleeping creature has none, because it has not moved.

import { F_ALIVE, type EntityStore } from "../shared/sim/entities.ts";

/** Ticks kept. A power of two. Covers the 12-tick rewind cap with room for the tick being stepped. */
export const HISTORY_TICKS = 16;
const MASK = HISTORY_TICKS - 1;
/** Per entity per tick. */
const ROW_BYTES = 20;

export class Past {
  x = 0;
  y = 0;
  z = 0;
  /** 1/65536 turns. */
  yaw = 0;
  /** Packed pose state. See `AnimState.pack`. */
  anim = 0;
}

export class History {
  private readonly ents: EntityStore;
  /** Row of each entity slot, or -1. */
  private readonly rowOf: Int32Array;
  /** Entity slot of each row. Rows 0 to rows-1 are in use. */
  private entOf: Int32Array;
  rows = 0;
  private capacity: number;
  private readonly tickOf = new Uint32Array(HISTORY_TICKS);
  // Each column holds HISTORY_TICKS values per row, row-major, so one entity's past is contiguous.
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private yaw: Uint16Array;
  private anim: Uint32Array;
  private gen: Uint16Array;

  constructor(ents: EntityStore, capacity = 256) {
    this.ents = ents;
    this.rowOf = new Int32Array(ents.cap).fill(-1);
    this.capacity = capacity;
    this.entOf = new Int32Array(capacity);
    this.x = new Float32Array(capacity * HISTORY_TICKS);
    this.y = new Float32Array(capacity * HISTORY_TICKS);
    this.z = new Float32Array(capacity * HISTORY_TICKS);
    this.yaw = new Uint16Array(capacity * HISTORY_TICKS);
    this.anim = new Uint32Array(capacity * HISTORY_TICKS);
    this.gen = new Uint16Array(capacity * HISTORY_TICKS);
  }

  get bytes(): number {
    return this.capacity * HISTORY_TICKS * ROW_BYTES + this.rowOf.byteLength;
  }

  /** Call when an entity begins to be stepped (a body is made, a creature wakes). Its whole past is filled with where it stands now. */
  track(e: number): void {
    if (this.rowOf[e]! >= 0) return;
    if (this.rows === this.capacity) this.grow();
    const r = this.rows++;
    this.rowOf[e] = r;
    this.entOf[r] = e;
    for (let t = 0; t < HISTORY_TICKS; t++) this.write(r * HISTORY_TICKS + t, e);
  }

  /** Call when it goes to sleep. record() drops destroyed entities itself. */
  untrack(e: number): void {
    const r = this.rowOf[e]!;
    if (r < 0) return;
    this.rowOf[e] = -1;
    const last = --this.rows;
    if (r === last) return;
    // The last row moves into the gap.
    const moved = this.entOf[last]!;
    this.entOf[r] = moved;
    this.rowOf[moved] = r;
    const from = last * HISTORY_TICKS;
    const to = r * HISTORY_TICKS;
    this.x.copyWithin(to, from, from + HISTORY_TICKS);
    this.y.copyWithin(to, from, from + HISTORY_TICKS);
    this.z.copyWithin(to, from, from + HISTORY_TICKS);
    this.yaw.copyWithin(to, from, from + HISTORY_TICKS);
    this.anim.copyWithin(to, from, from + HISTORY_TICKS);
    this.gen.copyWithin(to, from, from + HISTORY_TICKS);
  }

  /** Call once per tick, after everything has moved. */
  record(tick: number): void {
    const flags = this.ents.flags;
    const slot = tick & MASK;
    this.tickOf[slot] = tick;
    for (let r = this.rows - 1; r >= 0; r--) {
      const e = this.entOf[r]!;
      // Destroyed without an untrack call. Iterating backward means the row moved into the gap was already written.
      if ((flags[e]! & F_ALIVE) === 0) this.untrack(e);
      else this.write(r * HISTORY_TICKS + slot, e);
    }
  }

  has(tick: number): boolean {
    return tick > 0 && this.tickOf[tick & MASK] === tick;
  }

  /** Clamps `tick` to the remembered window ending at `now`. Returns 0 if the clamped tick is not held either. */
  clamp(tick: number, now: number): number {
    let t = tick > now ? now : tick;
    if (t <= now - HISTORY_TICKS) t = now - HISTORY_TICKS + 1;
    return this.has(t) ? t : 0;
  }

  /** False if the tick is no longer remembered, or if slot `e` held a different entity then or holds none now. */
  at(tick: number, e: number, out: Past): boolean {
    if (!this.has(tick)) return false;
    const ents = this.ents;
    const r = this.rowOf[e]!;
    if (r < 0) {
      // An untracked entity has not moved, so its present state is its past.
      if ((ents.flags[e]! & F_ALIVE) === 0) return false;
      out.x = ents.x[e]!;
      out.y = ents.y[e]!;
      out.z = ents.z[e]!;
      out.yaw = ents.yaw[e]!;
      out.anim = ents.anim[e]!;
      return true;
    }
    const i = r * HISTORY_TICKS + (tick & MASK);
    if (this.gen[i] !== ents.gen[e]) return false;
    out.x = this.x[i]!;
    out.y = this.y[i]!;
    out.z = this.z[i]!;
    out.yaw = this.yaw[i]!;
    out.anim = this.anim[i]!;
    return true;
  }

  /** A fractional `tick` blends position and yaw and takes anim from the nearer tick, as a client does. False unless both ticks are held. */
  sample(tick: number, e: number, out: Past): boolean {
    const t0 = Math.floor(tick);
    const k = tick - t0;
    if (k === 0) return this.at(t0, e, out);
    if (!this.at(t0 + 1, e, later) || !this.at(t0, e, out)) return false;
    out.x += (later.x - out.x) * k;
    out.y += (later.y - out.y) * k;
    out.z += (later.z - out.z) * k;
    let turn = later.yaw - out.yaw;
    if (turn > 32768) turn -= 65536;
    else if (turn < -32768) turn += 65536;
    out.yaw = (out.yaw + Math.round(turn * k)) & 0xffff;
    if (k >= 0.5) out.anim = later.anim;
    return true;
  }

  private write(i: number, e: number): void {
    const ents = this.ents;
    this.x[i] = ents.x[e]!;
    this.y[i] = ents.y[e]!;
    this.z[i] = ents.z[e]!;
    this.yaw[i] = ents.yaw[e]!;
    this.anim[i] = ents.anim[e]!;
    this.gen[i] = ents.gen[e]!;
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    const n = capacity * HISTORY_TICKS;
    const entOf = new Int32Array(capacity);
    entOf.set(this.entOf);
    this.entOf = entOf;
    const x = new Float32Array(n);
    x.set(this.x);
    this.x = x;
    const y = new Float32Array(n);
    y.set(this.y);
    this.y = y;
    const z = new Float32Array(n);
    z.set(this.z);
    this.z = z;
    const yaw = new Uint16Array(n);
    yaw.set(this.yaw);
    this.yaw = yaw;
    const anim = new Uint32Array(n);
    anim.set(this.anim);
    this.anim = anim;
    const gen = new Uint16Array(n);
    gen.set(this.gen);
    this.gen = gen;
    this.capacity = capacity;
  }
}

const later = new Past();
