// Struct-of-arrays store for everything that moves. There are no per-entity objects, so the tick
// allocates nothing. Each entity is linked into the list of the chunk it stands in. The columns double
// when every slot is taken, up to the store's limit.

import { chunkAt, chunkCount, type MapDims } from "../coords.ts";
import { HANDLE_GEN_MASK, HANDLE_INDEX_MASK, NULL_HANDLE, handleGen, handleIndex, makeHandle } from "../ids.ts";
import { AnimState } from "../anim/pose.ts";
import { PI, TAU } from "../math/scalar.ts";
import { MODE_WALK, STAMINA_UNITS, type Body } from "./character.ts";

const posed = new AnimState();

/** Indices into EntityStore.gear: the item in hand, then one per armor slot. */
export const GEAR_HELD = 0;
export const GEAR_WORN = 1;
export const GEAR_COUNT = 6;

export const F_ALIVE = 1;
export const F_GROUNDED = 2;
/** Stepped every tick. Cleared while the entity's chunk sleeps. */
export const F_AWAKE = 4;
export const F_PLAYER = 8;
/** A thing that stands where it is put: never stepped, never woken. */
export const F_PROP = 16;
/**
 * Held in a survivor's arms or carried by a creature: the creature tick does not step it, and whoever holds it moves it.
 * Server only; clients see CUE_HELD (shared/anim/pose.ts).
 */
export const F_HELD = 32;

/** The most slots a store can have: what a handle's index can name. */
export const ENTITY_LIMIT = HANDLE_INDEX_MASK + 1;

type Column = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

/** A longer copy of a column. Its new entries hold `fill`. */
export function wider<T extends Column>(a: T, length: number, fill = 0): T {
  const out = new (a.constructor as unknown as new (length: number) => T)(length);
  out.set(a);
  if (fill !== 0) out.fill(fill, a.length);
  return out;
}

export class EntityStore {
  readonly dims: MapDims;
  /** Slots the columns have room for. It doubles when every one is taken, up to `max`. */
  cap: number;
  /** The most slots it may grow to. */
  readonly max: number;
  count = 0;
  /** Slots kept for players' bodies. Once only these are left, a create for anything else is refused. */
  reserve = 0;
  /** Creates refused because there was no slot to give. */
  refused = 0;
  /** Each is called with the new capacity after the store grows. Whoever keeps a column for each entity widens it here. */
  readonly onGrow: ((cap: number) => void)[] = [];

  // The typed columns are replaced when the store grows, so none is kept across a create. That includes indexing
  // one with a create's result in the same expression: `ents.pid[spawn()]` reads the column from before the spawn.
  gen: Uint16Array;
  /** The generation of the last body at each index that died, 0 for none. A view tells a client that one died. */
  died: Uint16Array;
  flags: Uint8Array;
  kind: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  /** Facing, 1/65536 turns. */
  yaw: Uint16Array;
  vehicle: Uint8Array;
  vehicleYaw: Float32Array;
  vehicleYawRate: Float32Array;
  vehiclePitchRate: Float32Array;
  vehicleRollRate: Float32Array;
  vehicleGroundPitch: Float32Array;
  vehicleGroundRoll: Float32Array;
  vehicleRideOffset: Float32Array;
  vehicleRideVelocity: Float32Array;
  vehicleDoors: Uint16Array;

  vehiclePitch: Float32Array;
  vehicleRoll: Float32Array;
  steering: Float32Array;
  wheelAngle: Float32Array;
  fuel: Float32Array;
  seatSlot: Uint8Array;
  seatGen: Uint16Array;

  /** Persistent id, or 0 for entities that are never saved. */
  pid: Float64Array;
  /** In input pitch units: 16384 is straight up. */
  pitch: Int16Array;
  /** The pose, packed as shared/net/view.ts sends it. Whoever moves the body writes it. */
  anim: Uint32Array;
  /** A creature's cues (AnimState.packCue), sent beside the pose. The server's Creatures sets and clears them. */
  cue: Uint32Array;
  /** The rest of the predicted state. See `Body` in character.ts. */
  mode: Uint8Array;
  stance: Uint8Array;
  stamina: Int32Array;
  staminaMax: Uint16Array;
  speedQ: Uint16Array;
  swimQ: Uint16Array;
  mflags: Uint8Array;
  /** Action state (shared/sim/weapon.ts): the act, its ticks, rounds loaded, and what a reload would bring that to. */
  act: Uint8Array;
  actTicks: Uint8Array;
  rounds: Uint8Array;
  reloadTo: Uint8Array;
  /** HOLD_*, for the pose. Set with its gear. */
  hold: Uint8Array;
  /** 1 while a session's inputs drive it (a mount). */
  driven: Uint8Array;
  /**
   * Sent when it enters a view, 0 for none: the owning team, the entity it sits on plus one, and for the
   * young the ticks its growing takes and the tick it ends. Set only through the setters, so `rev` follows.
   */
  team: Uint32Array;
  seat: Uint32Array;
  span: Uint32Array;
  grown: Uint32Array;
  /** Also sent when it enters a view. `rev` changes whenever any of it does. */
  level: Uint16Array;
  colors: Uint8Array;
  readonly name: string[];
  /** A survivor's look (shared/anim/look.ts). */
  readonly look: (Uint8Array | null)[];
  /** Content indices: GEAR_HELD, then one per armor slot. Replaced, never changed in place. */
  readonly gear: (Uint16Array | null)[];
  rev: Uint8Array;

  /** Chunk the entity is linked into, or -1. */
  chunk: Int32Array;
  /** Per chunk: first entity index, or -1. */
  readonly chunkHead: Int32Array;
  next: Int32Array;
  prev: Int32Array;

  /** Free slots, oldest first, so a slot rests as long as possible before reuse. */
  private freeRing: Int32Array;
  private freeRead = 0;
  private freeCount: number;

  /** It starts with room for `cap` and may grow to `max`. With no `max` it never grows. */
  constructor(dims: MapDims, cap: number, max = cap) {
    if (max > ENTITY_LIMIT) throw new Error("entity capacity exceeds handle index range");
    if (cap < 1 || cap > max) throw new Error("an entity store starts with at least one slot and no more than its limit");
    this.dims = dims;
    this.cap = cap;
    this.max = max;
    this.gen = new Uint16Array(cap).fill(1);
    this.died = new Uint16Array(cap);
    this.flags = new Uint8Array(cap);
    this.kind = new Uint16Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.yaw = new Uint16Array(cap);
    this.vehicle = new Uint8Array(cap);
    this.vehicleYaw = new Float32Array(cap);
    this.vehicleYawRate = new Float32Array(cap);
    this.vehiclePitchRate = new Float32Array(cap);
    this.vehicleRollRate = new Float32Array(cap);
    this.vehicleGroundPitch = new Float32Array(cap);
    this.vehicleGroundRoll = new Float32Array(cap);
    this.vehicleRideOffset = new Float32Array(cap);
    this.vehicleRideVelocity = new Float32Array(cap);
    this.vehicleDoors = new Uint16Array(cap);

    this.vehiclePitch = new Float32Array(cap);
    this.vehicleRoll = new Float32Array(cap);
    this.steering = new Float32Array(cap);
    this.wheelAngle = new Float32Array(cap);
    this.fuel = new Float32Array(cap);
    this.seatSlot = new Uint8Array(cap);
    this.seatGen = new Uint16Array(cap);

    this.pitch = new Int16Array(cap);
    this.anim = new Uint32Array(cap);
    this.cue = new Uint32Array(cap);
    this.pid = new Float64Array(cap);
    this.mode = new Uint8Array(cap);
    this.stance = new Uint8Array(cap);
    this.stamina = new Int32Array(cap);
    this.staminaMax = new Uint16Array(cap);
    this.speedQ = new Uint16Array(cap);
    this.swimQ = new Uint16Array(cap);
    this.mflags = new Uint8Array(cap);
    this.act = new Uint8Array(cap);
    this.actTicks = new Uint8Array(cap);
    this.rounds = new Uint8Array(cap);
    this.reloadTo = new Uint8Array(cap);
    this.hold = new Uint8Array(cap);
    this.driven = new Uint8Array(cap);
    this.team = new Uint32Array(cap);
    this.seat = new Uint32Array(cap);
    this.span = new Uint32Array(cap);
    this.grown = new Uint32Array(cap);
    this.level = new Uint16Array(cap);
    this.colors = new Uint8Array(cap * 6);
    this.name = new Array<string>(cap).fill("");
    this.look = new Array<Uint8Array | null>(cap).fill(null);
    this.gear = new Array<Uint16Array | null>(cap).fill(null);
    this.rev = new Uint8Array(cap);
    this.chunk = new Int32Array(cap).fill(-1);
    this.chunkHead = new Int32Array(chunkCount(dims)).fill(-1);
    this.next = new Int32Array(cap).fill(-1);
    this.prev = new Int32Array(cap).fill(-1);
    this.freeRing = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.freeRing[i] = i;
    this.freeCount = cap;
  }

  /** Slots left for anything but a player's body. */
  get room(): number {
    const left = this.max - this.reserve - this.count;
    return left > 0 ? left : 0;
  }

  /** Returns the index, or -1 when there is no slot to give, which is counted in `refused`. */
  create(kind: number, x: number, y: number, z: number, flags: number): number {
    if (((flags & F_PLAYER) === 0 && this.count >= this.max - this.reserve) || (this.freeCount === 0 && !this.grow())) {
      this.refused++;
      return -1;
    }
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
    this.vehicle[i] = 0;
    this.vehicleYaw[i] = 0;
    this.vehicleYawRate[i] = 0;
    this.vehiclePitchRate[i] = 0;
    this.vehicleRollRate[i] = 0;
    this.vehicleGroundPitch[i] = 0;
    this.vehicleGroundRoll[i] = 0;
    this.vehicleRideOffset[i] = 0;
    this.vehicleRideVelocity[i] = 0;
    this.vehicleDoors[i] = 0;

    this.vehiclePitch[i] = 0;
    this.vehicleRoll[i] = 0;
    this.steering[i] = 0;
    this.wheelAngle[i] = 0;
    this.fuel[i] = 0;
    this.seatSlot[i] = 0;
    this.seatGen[i] = 0;

    this.pitch[i] = 0;
    this.anim[i] = 0;
    this.cue[i] = 0;
    this.pid[i] = 0;
    this.mode[i] = MODE_WALK;
    this.stance[i] = 0;
    this.staminaMax[i] = 100;
    this.stamina[i] = 100 * STAMINA_UNITS;
    this.speedQ[i] = 1000;
    this.swimQ[i] = 1000;
    this.mflags[i] = 0;
    this.act[i] = 0;
    this.actTicks[i] = 0;
    this.rounds[i] = 0;
    this.reloadTo[i] = 0;
    this.hold[i] = 0;
    this.driven[i] = 0;
    this.team[i] = 0;
    this.seat[i] = 0;
    this.span[i] = 0;
    this.grown[i] = 0;
    this.level[i] = 0;
    this.colors.fill(0, i * 6, i * 6 + 6);
    this.name[i] = "";
    this.look[i] = null;
    this.gear[i] = null;
    this.rev[i] = (this.rev[i]! + 1) & 15;
    this.link(i, chunkAt(this.dims, x, z));
    return i;
  }

  /** Doubles the columns. False when they are at `max`. Called only with every slot taken. */
  private grow(): boolean {
    const old = this.cap;
    if (old >= this.max) return false;
    const cap = old * 2 < this.max ? old * 2 : this.max;
    this.gen = wider(this.gen, cap, 1);
    this.died = wider(this.died, cap);
    this.flags = wider(this.flags, cap);
    this.kind = wider(this.kind, cap);
    this.x = wider(this.x, cap);
    this.y = wider(this.y, cap);
    this.z = wider(this.z, cap);
    this.vx = wider(this.vx, cap);
    this.vy = wider(this.vy, cap);
    this.vz = wider(this.vz, cap);
    this.yaw = wider(this.yaw, cap);
    this.vehicle = wider(this.vehicle, cap);
    this.vehicleYaw = wider(this.vehicleYaw, cap);
    this.vehicleYawRate = wider(this.vehicleYawRate, cap);
    this.vehiclePitchRate = wider(this.vehiclePitchRate, cap);
    this.vehicleRollRate = wider(this.vehicleRollRate, cap);
    this.vehicleGroundPitch = wider(this.vehicleGroundPitch, cap);
    this.vehicleGroundRoll = wider(this.vehicleGroundRoll, cap);
    this.vehicleRideOffset = wider(this.vehicleRideOffset, cap);
    this.vehicleRideVelocity = wider(this.vehicleRideVelocity, cap);
    this.vehicleDoors = wider(this.vehicleDoors, cap);

    this.vehiclePitch = wider(this.vehiclePitch, cap);
    this.vehicleRoll = wider(this.vehicleRoll, cap);
    this.steering = wider(this.steering, cap);
    this.wheelAngle = wider(this.wheelAngle, cap);
    this.fuel = wider(this.fuel, cap);
    this.seatSlot = wider(this.seatSlot, cap);
    this.seatGen = wider(this.seatGen, cap);

    this.pitch = wider(this.pitch, cap);
    this.anim = wider(this.anim, cap);
    this.cue = wider(this.cue, cap);
    this.pid = wider(this.pid, cap);
    this.mode = wider(this.mode, cap);
    this.stance = wider(this.stance, cap);
    this.stamina = wider(this.stamina, cap);
    this.staminaMax = wider(this.staminaMax, cap);
    this.speedQ = wider(this.speedQ, cap);
    this.swimQ = wider(this.swimQ, cap);
    this.mflags = wider(this.mflags, cap);
    this.act = wider(this.act, cap);
    this.actTicks = wider(this.actTicks, cap);
    this.rounds = wider(this.rounds, cap);
    this.reloadTo = wider(this.reloadTo, cap);
    this.hold = wider(this.hold, cap);
    this.driven = wider(this.driven, cap);
    this.team = wider(this.team, cap);
    this.seat = wider(this.seat, cap);
    this.span = wider(this.span, cap);
    this.grown = wider(this.grown, cap);
    this.level = wider(this.level, cap);
    this.colors = wider(this.colors, cap * 6);
    while (this.name.length < cap) {
      this.name.push("");
      this.look.push(null);
      this.gear.push(null);
    }
    this.rev = wider(this.rev, cap);
    this.chunk = wider(this.chunk, cap, -1);
    this.next = wider(this.next, cap, -1);
    this.prev = wider(this.prev, cap, -1);
    // Every old slot is taken, so the free slots are the new ones, in order.
    this.freeRing = new Int32Array(cap);
    for (let i = old; i < cap; i++) this.freeRing[i - old] = i;
    this.freeRead = 0;
    this.freeCount = cap - old;
    this.cap = cap;
    for (const widen of this.onGrow) widen(cap);
    return true;
  }

  /** The setters bump `rev` only on a change, and clients that already see the entity are then sent it again. */
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

  setTeam(i: number, team: number): void {
    if (this.team[i] === team) return;
    this.team[i] = team;
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  /** `mount` is an entity index, or -1. */
  setSeat(i: number, mount: number, slot = 0): void {
    const gen = mount < 0 ? 0 : this.gen[mount]!;
    if (mount < 0) slot = 0;
    if (this.seat[i] === mount + 1 && this.seatSlot[i] === slot && this.seatGen[i] === gen) return;
    this.seat[i] = mount + 1;
    this.seatSlot[i] = slot;
    this.seatGen[i] = gen;
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  /** Both 0 for one that is grown. */
  setYoung(i: number, span: number, grown: number): void {
    // Both are 32 bits here and on the wire.
    if (span > 0xffffffff) span = 0xffffffff;
    if (grown > 0xffffffff) grown = 0xffffffff;
    if (this.span[i] === span && this.grown[i] === grown) return;
    this.span[i] = span;
    this.grown[i] = grown;
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  setBodyLook(i: number, look: Uint8Array | null): void {
    this.look[i] = look;
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  setGear(i: number, gear: ArrayLike<number>): void {
    const old = this.gear[i];
    let same = old !== null && old !== undefined;
    for (let k = 0; k < GEAR_COUNT && same; k++) same = old![k] === gear[k];
    if (same) return;
    this.gear[i] = Uint16Array.from({ length: GEAR_COUNT }, (_, k) => gear[k] ?? 0);
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  /** Brings `anim[i]` up to date. Call it after changing velocity, facing, pitch, mode, stance or act. */
  pose(i: number, tick = 0): void {
    posed.mode = this.mode[i]!;
    posed.grounded = (this.flags[i]! & F_GROUNDED) !== 0;
    posed.stance = this.stance[i]!;
    posed.setAction(this.act[i]!, this.hold[i]!, tick - this.actTicks[i]!);
    posed.setMotion(this.vx[i]!, this.vz[i]!, (this.yaw[i]! * TAU) / 65536, (this.pitch[i]! * (PI / 2)) / 16384);
    this.anim[i] = posed.pack();
  }

  loadBody(i: number, b: Body): void {
    b.x = this.x[i]!;
    b.y = this.y[i]!;
    b.z = this.z[i]!;
    b.vx = this.vx[i]!;
    b.vy = this.vy[i]!;
    b.vz = this.vz[i]!;
    b.grounded = (this.flags[i]! & F_GROUNDED) !== 0;
    b.mode = this.mode[i]!;
    b.stance = this.stance[i]!;
    b.stamina = this.stamina[i]!;
    b.staminaMax = this.staminaMax[i]!;
    b.speedQ = this.speedQ[i]!;
    b.swimQ = this.swimQ[i]!;
    b.mflags = this.mflags[i]!;
    b.kind = this.kind[i]!;
    b.yaw = this.yaw[i]!;
    b.vehicle = this.vehicle[i] !== 0;
    b.vehicleYaw = this.vehicleYaw[i]!;
    b.vehicleYawRate = this.vehicleYawRate[i]!;
    b.vehiclePitchRate = this.vehiclePitchRate[i]!;
    b.vehicleRollRate = this.vehicleRollRate[i]!;
    b.vehicleGroundPitch = this.vehicleGroundPitch[i]!;
    b.vehicleGroundRoll = this.vehicleGroundRoll[i]!;
    b.vehicleRideOffset = this.vehicleRideOffset[i]!;
    b.vehicleRideVelocity = this.vehicleRideVelocity[i]!;

    b.vehiclePitch = this.vehiclePitch[i]!;
    b.vehicleRoll = this.vehicleRoll[i]!;
    b.steering = this.steering[i]!;
    b.wheelAngle = this.wheelAngle[i]!;
    b.fuel = this.fuel[i]!;
    b.seat = this.seat[i]!;
    b.seatSlot = this.seatSlot[i]!;
    b.seatGen = this.seatGen[i]!;

    b.held = this.gear[i]?.[GEAR_HELD] ?? 0;
    b.act = this.act[i]!;
    b.actTicks = this.actTicks[i]!;
    b.rounds = this.rounds[i]!;
    b.reloadTo = this.reloadTo[i]!;
  }

  /** Returns true if the entity changed chunk. */
  storeBody(i: number, b: Body): boolean {
    this.vx[i] = b.vx;
    this.vy[i] = b.vy;
    this.vz[i] = b.vz;
    this.flags[i] = b.grounded ? this.flags[i]! | F_GROUNDED : this.flags[i]! & ~F_GROUNDED;
    this.mode[i] = b.mode;
    this.stance[i] = b.stance;
    this.stamina[i] = b.stamina;
    this.mflags[i] = b.mflags;
    this.yaw[i] = b.yaw;
    this.vehicle[i] = b.vehicle ? 1 : 0;
    this.vehicleYaw[i] = b.vehicleYaw;
    this.vehicleYawRate[i] = b.vehicleYawRate;
    this.vehiclePitchRate[i] = b.vehiclePitchRate;
    this.vehicleRollRate[i] = b.vehicleRollRate;
    this.vehicleGroundPitch[i] = b.vehicleGroundPitch;
    this.vehicleGroundRoll[i] = b.vehicleGroundRoll;
    this.vehicleRideOffset[i] = b.vehicleRideOffset;
    this.vehicleRideVelocity[i] = b.vehicleRideVelocity;

    this.vehiclePitch[i] = b.vehiclePitch;
    this.vehicleRoll[i] = b.vehicleRoll;
    this.steering[i] = b.steering;
    this.wheelAngle[i] = b.wheelAngle;
    this.fuel[i] = b.fuel;

    this.act[i] = b.act;
    this.actTicks[i] = b.actTicks;
    this.rounds[i] = b.rounds;
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

  /** Returns true if it changed chunk. */
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
