// Where every moving entity was over the last half second. A shot is judged against where its target was when the shooter saw it.
// Only players and awake creatures have rows. A sleeping creature has none, because it has not moved.

import { F_ALIVE, wider, type EntityStore } from "../shared/sim/entities.ts";

/** Ticks kept, a power of two. A tick is recorded after it is stepped, so while it steps these are the ticks before it, past REWIND_TICKS (server/combat.ts). */
export const HISTORY_TICKS = 16;
const MASK = HISTORY_TICKS - 1;
/** Per entity per tick. */
const ROW_BYTES = 20;
const VEHICLE_FIELDS = ["pitch", "roll", "qx", "qy", "qz", "qw", "steering"] as const;

export class Past {
  x = 0;
  y = 0;
  z = 0;
  /** 1/65536 turns. */
  yaw = 0;
  /** Packed pose state and cues. See `AnimState.pack` and `packCue`. */
  anim = 0;
  cue = 0;
  /** Mechanical attitude is sparse in History; ordinary creatures do not allocate a second ring. */
  pitch = 0; roll = 0; qx = 0; qy = 0; qz = 0; qw = 1; steering = 0;

  vehicleFrom(ents: EntityStore, e: number): void {
    const v = ents.vrow[e]!;
    this.pitch = ents.vehiclePitch[v]!; this.roll = ents.vehicleRoll[v]!;
    this.qx = ents.vehicleQx[v]!; this.qy = ents.vehicleQy[v]!; this.qz = ents.vehicleQz[v]!; this.qw = ents.vehicleQw[v]!;
    this.steering = ents.steering[v]!;
  }

  blendVehicle(other: Past, k: number): void {
    this.pitch += (other.pitch - this.pitch) * k; this.roll += (other.roll - this.roll) * k;
    this.steering += (other.steering - this.steering) * k;
    const sign = this.qx * other.qx + this.qy * other.qy + this.qz * other.qz + this.qw * other.qw < 0 ? -1 : 1;
    this.qx += (other.qx * sign - this.qx) * k; this.qy += (other.qy * sign - this.qy) * k;
    this.qz += (other.qz * sign - this.qz) * k; this.qw += (other.qw * sign - this.qw) * k;
    const norm = Math.hypot(this.qx, this.qy, this.qz, this.qw);
    if (norm > 1e-6) { this.qx /= norm; this.qy /= norm; this.qz /= norm; this.qw /= norm; }
    else { this.qx = this.qy = this.qz = 0; this.qw = 1; }
  }
}

export class History {
  private readonly ents: EntityStore;
  /** Row of each entity slot, or -1. It grows with the entity store. */
  private rowOf: Int32Array;
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
  /**
   * The cues of each tracked body that has had any in the last HISTORY_TICKS, by entity, one a tick. Cues are few and
   * change seldom, so a body without any keeps none. Each is told of by `cued`.
   */
  private readonly cues = new Map<number, Uint32Array>();
  private readonly vehicles = new Map<number, Float32Array>();

  constructor(ents: EntityStore, capacity = 256) {
    this.ents = ents;
    this.rowOf = new Int32Array(ents.cap).fill(-1);
    ents.onGrow.push((cap) => void (this.rowOf = wider(this.rowOf, cap, -1)));
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
    return this.capacity * HISTORY_TICKS * ROW_BYTES + this.rowOf.byteLength + this.vehicles.size * HISTORY_TICKS * VEHICLE_FIELDS.length * 4;
  }

  /** The entity in row `r`, for `r` below `rows`: an awake creature or a player's body. */
  tracked(r: number): number {
    return this.entOf[r]!;
  }

  /** Call when an entity begins to be stepped (a body is made, a creature wakes). Its whole past is filled with where it stands now. */
  track(e: number): void {
    if (this.rowOf[e]! >= 0) return;
    if (this.rows === this.capacity) this.grow();
    const r = this.rows++;
    this.rowOf[e] = r;
    this.entOf[r] = e;
    for (let t = 0; t < HISTORY_TICKS; t++) this.write(r * HISTORY_TICKS + t, e);
    if (this.ents.cue[e] !== 0) this.cues.set(e, new Uint32Array(HISTORY_TICKS).fill(this.ents.cue[e]!));
  }

  /** Call when a body's cues (EntityStore.cue) change. */
  cued(e: number): void {
    if (this.rowOf[e]! >= 0 && !this.cues.has(e)) this.cues.set(e, new Uint32Array(HISTORY_TICKS));
  }

  /** Call when it goes to sleep. record() drops destroyed entities itself. */
  untrack(e: number): void {
    const r = this.rowOf[e]!;
    if (r < 0) return;
    this.cues.delete(e);
    this.vehicles.delete(e);
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
    // A body's cues are let go once it has had none for the whole window.
    for (const [e, ring] of this.cues) {
      ring[slot] = this.ents.cue[e]!;
      if (ring[slot] === 0 && ring.every((c) => c === 0)) this.cues.delete(e);
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
      out.cue = ents.cue[e]!;
      out.vehicleFrom(ents, e);
      return true;
    }
    const i = r * HISTORY_TICKS + (tick & MASK);
    if (this.gen[i] !== ents.gen[e]) return false;
    out.x = this.x[i]!;
    out.y = this.y[i]!;
    out.z = this.z[i]!;
    out.yaw = this.yaw[i]!;
    out.anim = this.anim[i]!;
    out.cue = this.cues.get(e)?.[tick & MASK] ?? 0;
    const vehicle = this.vehicles.get(e);
    if (vehicle) for (let field = 0; field < VEHICLE_FIELDS.length; field++) out[VEHICLE_FIELDS[field]!] = vehicle[(tick & MASK) * VEHICLE_FIELDS.length + field]!;
    else out.vehicleFrom(ents, e);
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
    out.blendVehicle(later, k);
    let turn = later.yaw - out.yaw;
    if (turn > 32768) turn -= 65536;
    else if (turn < -32768) turn += 65536;
    out.yaw = (out.yaw + Math.round(turn * k)) & 0xffff;
    if (k >= 0.5) {
      out.anim = later.anim;
      out.cue = later.cue;
    }
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
    if (ents.vehicle[ents.vrow[e]!]) {
      let ring = this.vehicles.get(e);
      current.vehicleFrom(ents, e);
      if (!ring) {
        ring = new Float32Array(HISTORY_TICKS * VEHICLE_FIELDS.length);
        for (let tick = 0; tick < HISTORY_TICKS; tick++) for (let field = 0; field < VEHICLE_FIELDS.length; field++) ring[tick * VEHICLE_FIELDS.length + field] = current[VEHICLE_FIELDS[field]!]!;
        this.vehicles.set(e, ring);
      }
      for (let field = 0; field < VEHICLE_FIELDS.length; field++) ring[(i & MASK) * VEHICLE_FIELDS.length + field] = current[VEHICLE_FIELDS[field]!]!;
    }
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
const current = new Past();
