// Where every moving entity was over the last half second. A shot is judged against where its target was when the shooter saw it.
// Only players and awake creatures have rows. A sleeping creature has none, because it has not moved.

import type { Registry } from "../shared/content/registry.ts";
import { blendDoors } from "../shared/sim/vehicle-panels.ts";
import { ANIM_STRIDE_MASK, AnimState, bodySeed, fallFrameChanged } from "../shared/anim/pose.ts";
import { HUMAN } from "../shared/anim/human.ts";
import type { ServerWorld } from "./world.ts";
import { F_ALIVE, GEAR_WORN, wider, type EntityStore } from "../shared/sim/entities.ts";

/** Ticks kept, a power of two. A tick is recorded after it is stepped, so while it steps these are the ticks before it, past REWIND_TICKS (server/combat.ts). */
export const HISTORY_TICKS = 16;
const MASK = HISTORY_TICKS - 1;
/** Per entity per tick. */
const ROW_BYTES = 20;
const VEHICLE_FIELDS = ["pitch", "roll", "qx", "qy", "qz", "qw", "steering"] as const;
// Kept only while an entity has occupied a seat in the retained window. Host pose and saddle belong to that
// instant: a dismount, changed saddle or recycled host slot must not rewrite an earlier seated hitbox.
const SEAT_FIELDS = ["seat", "seatGen", "seatSlot", "saddle", "hostKind", "hostX", "hostY", "hostZ", "hostYaw", "hostAnim", "hostCue", "hostQx", "hostQy", "hostQz", "hostQw", "hostSteering", "hostEpoch"] as const;

export class Past {
  x = 0;
  y = 0;
  z = 0;
  /** 1/65536 turns. */
  yaw = 0;
  /** Packed pose state and cues. See `AnimState.pack` and `packCue`. */
  anim = 0;
  cue = 0;
  /** A survivor's reaction to a blow (shared/anim/reactions.ts); 0 for none. */
  react = 0;
  stride = 0;
  /** Mechanical attitude is sparse in History; ordinary creatures do not allocate a second ring. */
  pitch = 0; roll = 0; qx = 0; qy = 0; qz = 0; qw = 1; steering = 0;
  doors = 0; missingPanels = 0;
  seat = 0; seatGen = 0; seatSlot = 0; saddle = 0; hostKind = 0;
  hostX = 0; hostY = 0; hostZ = 0; hostYaw = 0; hostAnim = 0; hostCue = 0;
  hostQx = 0; hostQy = 0; hostQz = 0; hostQw = 1; hostSteering = 0; hostEpoch = 0;

  seatFrom(ents: EntityStore, e: number): void {
    this.hostEpoch = 0;
    const host = ents.seat[e]! - 1;
    this.seat = host >= 0 && ents.seatSlot[e] !== 0 && ents.seatGen[e] === ents.gen[host] && (ents.flags[host]! & F_ALIVE) !== 0 ? host + 1 : 0;
    this.seatGen = this.seat ? ents.seatGen[e]! : 0;
    this.seatSlot = this.seat ? ents.seatSlot[e]! : 0;
    this.saddle = this.seat ? ents.gears.get(host)?.[GEAR_WORN] ?? 0 : 0;
    if (!this.seat) return;
    this.hostKind = ents.kind[host]!;
    this.hostX = ents.x[host]!; this.hostY = ents.y[host]!; this.hostZ = ents.z[host]!;
    this.hostYaw = ents.yaw[host]!; this.hostAnim = ents.anim[host]!; this.hostCue = ents.cue[host]!;
    const v = ents.vrow[host]!;
    this.hostQx = ents.vehicleQx[v]!; this.hostQy = ents.vehicleQy[v]!; this.hostQz = ents.vehicleQz[v]!; this.hostQw = ents.vehicleQw[v]!;
    this.hostSteering = ents.steering[v]!;
  }

  blendSeat(other: Past, k: number): void {
    if (!this.sameSeat(other)) {
      if (k >= 0.5) for (const field of SEAT_FIELDS) this[field] = other[field];
      return;
    }
    if (!this.seat) return;
    this.hostX += (other.hostX - this.hostX) * k;
    this.hostY += (other.hostY - this.hostY) * k;
    this.hostZ += (other.hostZ - this.hostZ) * k;
    const turn = ((other.hostYaw - this.hostYaw + 32768) & 0xffff) - 32768;
    this.hostYaw = (this.hostYaw + Math.round(turn * k)) & 0xffff;
    const sign = this.hostQx * other.hostQx + this.hostQy * other.hostQy + this.hostQz * other.hostQz + this.hostQw * other.hostQw < 0 ? -1 : 1;
    this.hostQx += (other.hostQx * sign - this.hostQx) * k; this.hostQy += (other.hostQy * sign - this.hostQy) * k;
    this.hostQz += (other.hostQz * sign - this.hostQz) * k; this.hostQw += (other.hostQw * sign - this.hostQw) * k;
    const norm = Math.hypot(this.hostQx, this.hostQy, this.hostQz, this.hostQw);
    if (norm > 1e-6) { this.hostQx /= norm; this.hostQy /= norm; this.hostQz /= norm; this.hostQw /= norm; }
    else { this.hostQx = this.hostQy = this.hostQz = 0; this.hostQw = 1; }
    this.hostSteering += (other.hostSteering - this.hostSteering) * k;
    if (k >= 0.5) { this.hostAnim = other.hostAnim; this.hostCue = other.hostCue; }
  }

  sameSeat(other: Past): boolean {
    return this.seat === other.seat && this.seatGen === other.seatGen && this.seatSlot === other.seatSlot && this.saddle === other.saddle && this.hostEpoch === other.hostEpoch;
  }

  /** Feet and hips switch at the recorded tick. Seat attachments switch at the nearer sample. */
  blend(other: Past, k: number, survivor = false): void {
    if (fallFrameChanged(survivor, this.cue, this.react, other.cue, other.react)) k = k < 1 ? 0 : 1;
    else if (!this.sameSeat(other)) k = k < 0.5 ? 0 : 1;
    this.x += (other.x - this.x) * k; this.y += (other.y - this.y) * k; this.z += (other.z - this.z) * k;
    this.blendVehicle(other, k);
    this.blendSeat(other, k);
    const turn = ((other.yaw - this.yaw + 32768) & 0xffff) - 32768;
    this.yaw = (this.yaw + Math.round(turn * k)) & 0xffff;
    if (k >= 0.5) { this.anim = other.anim; this.cue = other.cue; this.react = other.react; this.stride = other.stride; }
  }

  vehicleFrom(ents: EntityStore, e: number): void {
    const v = ents.vrow[e]!;
    this.pitch = ents.vehiclePitch[v]!; this.roll = ents.vehicleRoll[v]!;
    this.qx = ents.vehicleQx[v]!; this.qy = ents.vehicleQy[v]!; this.qz = ents.vehicleQz[v]!; this.qw = ents.vehicleQw[v]!;
    this.steering = ents.steering[v]!;
    this.doors = ents.vehicleDoors[v]!; this.missingPanels = ents.vehicleMissingPanels[v]!;
  }

  blendVehicle(other: Past, k: number): void {
    this.doors = blendDoors(this.doors, other.doors, k);
    if (k >= .5) this.missingPanels = other.missingPanels;
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
  private readonly panels = new Map<number, Uint32Array>();
  /** The same for reactions to blows, each told of by `reacted`. */
  private readonly reacts = new Map<number, Uint32Array>();
  private readonly strides = new Map<number, { gen: number; motion: number; rate: number; offset: number; ring: Uint8Array }>();
  private readonly strideState = new AnimState();
  private readonly vehicles = new Map<number, Float32Array>();
  private readonly seats = new Map<number, Float64Array>();
  /** Tokens exist only for queried/teleported tracked bodies; untrack retires them with the history row. */
  private readonly motionEpochs = new Map<number, number>();
  private motionVersion = 0;
  /** Maximum travelled distance of any tracked entity during each recorded tick, plus the tick still being stepped. */
  private readonly travel = new Float64Array(HISTORY_TICKS);
  private travelled: Float64Array;
  private travelGen: Uint16Array;
  private currentTravel = 0;
  private travelDirty = false;

  private readonly kinds?: Registry["vehicle"];
  private readonly survivor: number;

  constructor(ents: EntityStore, capacity = 256, kinds?: Registry["vehicle"], survivor = -1) {
    this.kinds = kinds;
    this.survivor = survivor;
    this.ents = ents;
    this.rowOf = new Int32Array(ents.cap).fill(-1);
    this.travelled = new Float64Array(capacity);
    this.travelGen = new Uint16Array(capacity);
    ents.onGrow.push((cap) => {
      this.rowOf = wider(this.rowOf, cap, -1);
    });
    ents.onPosition.push((e, x, y, z) => {
      const r = this.rowOf[e]!;
      if (r < 0) return;
      if (this.travelGen[r] !== ents.gen[e]) { this.travelGen[r] = ents.gen[e]!; this.travelled[r] = 0; }
      const distance = Math.hypot(ents.x[e]! - x, ents.y[e]! - y, ents.z[e]! - z);
      this.travelled[r] = this.travelled[r]! + distance;
      this.currentTravel = Math.max(this.currentTravel, this.travelled[r]!);
    });
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
    return this.capacity * HISTORY_TICKS * ROW_BYTES + this.rowOf.byteLength + this.travelled.byteLength + this.travelGen.byteLength + this.travel.byteLength
      + this.panels.size * HISTORY_TICKS * 8 + this.strides.size * HISTORY_TICKS + this.vehicles.size * HISTORY_TICKS * VEHICLE_FIELDS.length * 4 + this.seats.size * HISTORY_TICKS * SEAT_FIELDS.length * 8;
  }

  /** The entity in row `r`, for `r` below `rows`: an awake creature or a player's body. */
  tracked(r: number): number {
    return this.entOf[r]!;
  }

  /** Whether `e` has a row. */
  follows(e: number): boolean {
    return this.rowOf[e]! >= 0;
  }

  /** Call when an entity begins to be stepped (a body is made, a creature wakes). Its whole past is filled with where it stands now. */
  track(e: number): void {
    if (this.rowOf[e]! >= 0) return;
    if (this.rows === this.capacity) this.grow();
    const r = this.rows++;
    this.travelled[r] = 0;
    this.travelGen[r] = this.ents.gen[e]!;
    this.rowOf[e] = r;
    this.entOf[r] = e;
    for (let t = 0; t < HISTORY_TICKS; t++) this.write(r * HISTORY_TICKS + t, e);
    if (this.ents.cue[e] !== 0) this.cues.set(e, new Uint32Array(HISTORY_TICKS).fill(this.ents.cue[e]!));
    if (this.ents.react[e] !== 0) this.reacts.set(e, new Uint32Array(HISTORY_TICKS).fill(this.ents.react[e]!));
  }

  /** Call when a body's cues (EntityStore.cue) change. */
  cued(e: number): void {
    if (this.rowOf[e]! >= 0 && !this.cues.has(e)) this.cues.set(e, new Uint32Array(HISTORY_TICKS));
  }

  /** Call when a body's reaction (EntityStore.react) changes. */
  reacted(e: number): void {
    if (this.rowOf[e]! >= 0 && !this.reacts.has(e)) this.reacts.set(e, new Uint32Array(HISTORY_TICKS));
  }

  /** Call when it goes to sleep. record() drops destroyed entities itself. */
  untrack(e: number): void {
    const r = this.rowOf[e]!;
    if (r < 0) return;
    this.cues.delete(e);
    this.reacts.delete(e);
    this.strides.delete(e);
    this.vehicles.delete(e);
    this.panels.delete(e);
    this.seats.delete(e);
    this.motionEpochs.delete(e);
    this.travelled[r] = 0;
    this.rowOf[e] = -1;
    const last = --this.rows;
    if (r === last) return;
    // Rows past the last in use stay at zero, so record() clears only the rows in use.
    // The last row moves into the gap.
    const moved = this.entOf[last]!;
    this.travelled[r] = this.travelled[last]!;
    this.travelled[last] = 0;
    this.travelGen[r] = this.travelGen[last]!;
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

  /**
   * Stops tracking a body that will stand as it is until `resume`: its present is its past meanwhile, as for any body
   * without a row. Returns its motion token for `resume` to give back, since nothing moves it between.
   */
  suspend(e: number): number {
    const epoch = this.motionEpochs.get(e) ?? 0;
    this.untrack(e);
    return epoch;
  }

  /** Tracks a suspended body again, as it stands, with the token `suspend` returned. */
  resume(e: number, epoch: number): void {
    this.track(e);
    if (epoch !== 0 && !this.motionEpochs.has(e)) this.motionEpochs.set(e, epoch);
  }

  /** A speed or stance change starts a new clock at the phase the previous clock reached. */
  strideOf(e: number, tick: number, world: ServerWorld): number {
    const ents = this.ents, def = world.reg.defs[ents.kind[e]!];
    if (def?.type !== "species" || def.skeleton !== HUMAN.id || !this.follows(e)) return 0;
    const gen = ents.gen[e]!, motion = ents.anim[e]! & ANIM_STRIDE_MASK;
    let clock = this.strides.get(e);
    if (clock?.gen !== gen) {
      if (clock) this.strides.delete(e);
      if (!(motion & 15)) return 0;
      clock = { gen, motion: -1, rate: 0, offset: 0, ring: new Uint8Array(HISTORY_TICKS) };
      this.strides.set(e, clock);
    }
    if (clock.motion !== motion) {
      this.strideState.unpack(ents.anim[e]!, ents.cue[e]!);
      const rate = world.anim.strideRate(this.strideState);
      clock.offset = (clock.offset + Math.round((tick + bodySeed(e)) * (clock.rate - rate) * 256)) & 255;
      clock.rate = rate;
      clock.motion = motion;
    }
    return clock.offset;
  }

  /** Call once per tick, after everything has moved. */
  record(tick: number, world?: ServerWorld): void {
    const flags = this.ents.flags;
    const slot = tick & MASK;
    this.tickOf[slot] = tick;
    this.travel[slot] = this.currentDistance();
    this.travelled.fill(0, 0, this.rows);
    this.currentTravel = 0;
    for (let r = this.rows - 1; r >= 0; r--) {
      const e = this.entOf[r]!;
      // Destroyed without an untrack call. Iterating backward means the row moved into the gap was already written.
      if ((flags[e]! & F_ALIVE) === 0) this.untrack(e);
      else {
        if (world) {
          const offset = this.strideOf(e, tick, world), clock = this.strides.get(e);
          if (clock) clock.ring[slot] = offset;
        }
        this.write(r * HISTORY_TICKS + slot, e);
      }
    }
    // A body's cues are let go once it has had none for the whole window.
    for (const [e, ring] of this.cues) {
      ring[slot] = this.ents.cue[e]!;
      if (ring[slot] === 0 && ring.every((c) => c === 0)) this.cues.delete(e);
    }
    for (const [e, ring] of this.reacts) {
      ring[slot] = this.ents.react[e]!;
      if (ring[slot] === 0 && ring.every((c) => c === 0)) this.reacts.delete(e);
    }
    for (const [e, ring] of this.seats) {
      let occupied = false;
      for (let t = 0; t < HISTORY_TICKS; t++) if (ring[t * SEAT_FIELDS.length] !== 0) { occupied = true; break; }
      if (!occupied) this.seats.delete(e);
    }
  }

  /**
   * Conservative path length since `from`, including projectile flight and movement in the unrecorded tick. The sum
   * of per-tick maxima bounds every individual path, regardless of carrier, impulse, vertical or downhill speed.
   * At most the retained 16 intervals are visited; the current tick has its own accumulator.
   */
  displacement(from: number, now: number): number {
    let distance = this.currentDistance();
    for (let tick = Math.max(Math.floor(from) + 1, now - HISTORY_TICKS + 1); tick <= now; tick++) {
      if (this.has(tick)) distance += this.travel[tick & MASK]!;
    }
    return distance;
  }

  /** An exit crosses the cabin without sweeping a body through it. Keep the previous seat and its
   * travel bound for shots already in flight. Past.blend selects one side of the attachment change. */
  seatExit(e: number): void {
    if (this.rowOf[e]! < 0) this.track(e);
    this.motionEpochs.set(e, ++this.motionVersion);
  }

  /** Immediately after an explicit teleport. Do not interpolate or sweep through the space it skipped. */
  discontinuity(e: number): void {
    if ((this.ents.flags[e]! & F_ALIVE) === 0) return;
    if (this.rowOf[e]! < 0) this.track(e);
    const r = this.rowOf[e]!;
    this.gen.fill(0, r * HISTORY_TICKS, (r + 1) * HISTORY_TICKS);
    this.seats.delete(e);
    this.motionEpochs.set(e, ++this.motionVersion);
    this.travelled[r] = 0;
    this.travelDirty = true;
  }

  /** A lazy tracked-body token. Retracking cannot revive an earlier capture, even without an intervening teleport. */
  motionEpoch(e: number): number {
    if (this.rowOf[e]! < 0) return 0;
    let epoch = this.motionEpochs.get(e);
    if (epoch === undefined) { epoch = ++this.motionVersion; this.motionEpochs.set(e, epoch); }
    return epoch;
  }

  private currentDistance(): number {
    if (this.travelDirty) {
      this.currentTravel = 0;
      for (let r = 0; r < this.rows; r++) this.currentTravel = Math.max(this.currentTravel, this.travelled[r]!);
      this.travelDirty = false;
    }
    return this.currentTravel;
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
      out.react = ents.react[e]!;
      out.stride = 0;
      out.vehicleFrom(ents, e);
      out.seatFrom(ents, e);
      if (out.seat) out.hostEpoch = this.motionEpoch(out.seat - 1);
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
    out.react = this.reacts.get(e)?.[tick & MASK] ?? 0;
    out.stride = this.strides.get(e)?.ring[tick & MASK] ?? 0;
    const vehicle = this.vehicles.get(e);
    if (vehicle) for (let field = 0; field < VEHICLE_FIELDS.length; field++) out[VEHICLE_FIELDS[field]!] = vehicle[(tick & MASK) * VEHICLE_FIELDS.length + field]!;
    else out.vehicleFrom(ents, e);
    const panels = this.panels.get(e);
    out.doors = panels?.[(tick & MASK) * 2] ?? 0;
    out.missingPanels = panels?.[(tick & MASK) * 2 + 1] ?? 0;
    const seat = this.seats.get(e);
    if (seat) for (let field = 0; field < SEAT_FIELDS.length; field++) out[SEAT_FIELDS[field]!] = seat[(tick & MASK) * SEAT_FIELDS.length + field]!;
    else { out.seat = out.seatGen = out.seatSlot = out.saddle = out.hostEpoch = 0; }
    return true;
  }

  /** A fractional `tick` blends position and yaw and takes anim from the nearer tick, as a client does. False unless both ticks are held. */
  sample(tick: number, e: number, out: Past): boolean {
    const t0 = Math.floor(tick);
    const k = tick - t0;
    if (k === 0) return this.at(t0, e, out);
    if (!this.at(t0 + 1, e, later) || !this.at(t0, e, out)) return false;
    out.blend(later, k, this.ents.kind[e] === this.survivor);
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
    let seat = this.seats.get(e);
    if (seat || ents.seatSlot[e] !== 0) {
      current.seatFrom(ents, e);
      if (current.seat) current.hostEpoch = this.motionEpoch(current.seat - 1);
      if (!seat) { seat = new Float64Array(HISTORY_TICKS * SEAT_FIELDS.length); this.seats.set(e, seat); }
      for (let field = 0; field < SEAT_FIELDS.length; field++) seat[(i & MASK) * SEAT_FIELDS.length + field] = current[SEAT_FIELDS[field]!]!;
    }
    if (ents.vehicle[ents.vrow[e]!]) {
      let ring = this.vehicles.get(e);
      current.vehicleFrom(ents, e);
      if (this.kinds?.[ents.kind[e]!]?.breakablePanels) {
        let panels = this.panels.get(e);
        if (current.doors || current.missingPanels || panels) {
          if (!panels) this.panels.set(e, panels = new Uint32Array(HISTORY_TICKS * 2));
          panels[(i & MASK) * 2] = current.doors;
          panels[(i & MASK) * 2 + 1] = current.missingPanels;
        }
      }
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
    this.travelled = wider(this.travelled, capacity);
    this.travelGen = wider(this.travelGen, capacity);
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
