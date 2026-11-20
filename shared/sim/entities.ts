// Struct-of-arrays store for everything that moves. There are no per-entity objects, so the tick
// allocates nothing. Each entity is linked into the list of the chunk it stands in. The columns double
// when every slot is taken, up to the store's limit.

import { chunkAt, chunkCount, type MapDims } from "../coords.ts";
import { HANDLE_GEN_MASK, HANDLE_INDEX_MASK, NULL_HANDLE, handleGen, handleIndex, makeHandle } from "../ids.ts";
import { AnimState, CUE_DEAD, CUE_JET } from "../anim/pose.ts";
import { PI, TAU } from "../math/scalar.ts";
import { MODE_WALK, STAMINA_UNITS, type Body } from "./character.ts";

const posed = new AnimState();

/** Indices into EntityStore.gears: the item in hand, then one per armor slot. */
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
/** Vehicle rows a store starts with, row 0 among them. */
const VEHICLE_START = 16;

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
  /** Server history observes authoritative movement, including movement within the tick being simulated. */
  readonly onPosition: ((e: number, fromX: number, fromY: number, fromZ: number) => void)[] = [];

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
  /** The slot's row in the vehicle columns below, 0 for none. */
  vrow: Uint32Array;
  seatSlot: Uint8Array;
  seatGen: Uint16Array;

  // By vehicle row: a slot of a vehicle's kind is given one when it is made, and any other slot when a vehicle body is stored
  // in it. Row 0 is what a slot with no vehicle reads, and is never written. These double as rows are taken, on a create or
  // a storeBody, so none is kept across either.
  vehicle: Uint8Array;
  vehicleYaw: Float32Array;
  vehicleYawRate: Float32Array;
  vehicleGear: Float32Array;
  vehicleRpm: Float32Array;
  vehicleShiftTime: Float32Array;
  vehiclePayloadMass: Float32Array;
  vehicleRotorRpm: Float32Array;
  vehicleRotorPhase: Float32Array;
  vehicleEngineCondition: Float32Array;
  vehicleFlooding: Float32Array;
  vehicleHullCondition: Float32Array;
  vehicleRotorCondition: Float32Array;
  vehicleEngineOn: Uint8Array;
  vehicleQx: Float32Array;
  vehicleQy: Float32Array;
  vehicleQz: Float32Array;
  vehicleQw: Float32Array;
  vehicleCollective: Float32Array;
  vehiclePitchRate: Float32Array;
  vehicleRollRate: Float32Array;
  vehicleGroundPitch: Float32Array;
  vehicleGroundRoll: Float32Array;
  vehicleRideOffset: Float32Array;
  vehicleRideVelocity: Float32Array;
  /** Four doors, 8 bits each of how far open (shared/sim/vehicle-body.ts). */
  vehicleDoors: Uint32Array;
  vehicleLightMode: Uint8Array;
  vehiclePitch: Float32Array;
  vehicleRoll: Float32Array;
  steering: Float32Array;
  wheelAngle: Float32Array;
  fuel: Float32Array;
  /** Rows the vehicle columns have room for, and the rows used so far, row 0 among them. */
  private vcap = VEHICLE_START;
  private vused = 1;
  private readonly vfree: number[] = [];
  /** By kind, set for a vehicle's. */
  private readonly vehicular: ArrayLike<unknown>;

  /** Persistent id, or 0 for entities that are never saved. */
  pid: Float64Array;
  /** In input pitch units: 16384 is straight up. */
  pitch: Int16Array;
  /** The pose, packed as shared/net/view.ts sends it. Whoever moves the body writes it. */
  anim: Uint32Array;
  /** A creature's cues (AnimState.packCue), sent beside the pose. The server's Creatures sets and clears them. */
  cue: Uint32Array;
  /** A survivor's emote (AnimState.packEmote), sent beside the pose; 0 for none. The server's Emotes sets and clears it. */
  emote: Uint32Array;
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
  /** Aim state (Body.bloom, Body.kick), stepped by stepAim (shared/sim/aim.ts). */
  bloom: Uint8Array;
  kick: Uint8Array;
  /** Flight state (Body.regenWait, Body.rollWait): 0 until FL1 of planning/reference/flyers-plan.md steps them. */
  jetGear: Uint8Array;
  jetSpent: Uint16Array;
  jetThrust: Uint8Array;
  regenWait: Uint16Array;
  rollWait: Uint16Array;
  creatureMode: Uint8Array;
  creatureCooldown: Uint16Array;
  creaturePrimaryCooldown: Uint16Array;
  creaturePower: Uint8Array;
  creatureSide: Uint8Array;
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
  /** Only for the slots that have one, as few do: a name, a survivor's look (shared/anim/look.ts), and gear. */
  readonly names = new Map<number, string>();
  readonly looks = new Map<number, Uint8Array>();
  /** Content indices: GEAR_HELD, then one per armor slot. Replaced, never changed in place. */
  readonly gears = new Map<number, Uint16Array>();
  /**
   * 1 while the laser on the item in hand is switched on: the create's gear "on" bit (protocol 13; weapons-plan.md, M10).
   * A flashlight's is kept on its owner's books and not sent, as nothing draws it until there are local lights (D436).
   */
  on: Uint8Array;
  rev: Uint8Array;

  /** Chunk the entity is linked into, or -1. */
  chunk: Int32Array;
  /** Per chunk: first entity index, or -1. */
  readonly chunkHead: Int32Array;
  next: Int32Array;
  /** The previous in its chunk's list, or for a free slot the next free one, -1 for none. */
  prev: Int32Array;

  /** Free slots are a list through `prev`, oldest first, so a slot rests as long as possible before reuse. */
  private freeHead = -1;
  private freeTail = -1;
  private freeCount = 0;

  /**
   * It starts with room for `cap` and may grow to `max`. With no `max` it never grows. `vehicular` is set for each kind that
   * is a vehicle (Registry.vehicle).
   */
  constructor(dims: MapDims, cap: number, max = cap, vehicular: ArrayLike<unknown> = []) {
    if (max > ENTITY_LIMIT) throw new Error("entity capacity exceeds handle index range");
    if (cap < 1 || cap > max) throw new Error("an entity store starts with at least one slot and no more than its limit");
    this.dims = dims;
    this.cap = cap;
    this.max = max;
    this.vehicular = vehicular;
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
    this.vrow = new Uint32Array(cap);
    this.seatSlot = new Uint8Array(cap);
    this.seatGen = new Uint16Array(cap);
    this.vehicle = new Uint8Array(VEHICLE_START);
    this.vehicleYaw = new Float32Array(VEHICLE_START);
    this.vehicleYawRate = new Float32Array(VEHICLE_START);
    this.vehicleGear = new Float32Array(VEHICLE_START);
    this.vehicleRpm = new Float32Array(VEHICLE_START);
    this.vehicleShiftTime = new Float32Array(VEHICLE_START);
    this.vehiclePayloadMass = new Float32Array(VEHICLE_START);
    this.vehicleRotorRpm = new Float32Array(VEHICLE_START);
    this.vehicleRotorPhase = new Float32Array(VEHICLE_START);
    this.vehicleEngineCondition = new Float32Array(VEHICLE_START);
    this.vehicleFlooding = new Float32Array(VEHICLE_START);
    this.vehicleHullCondition = new Float32Array(VEHICLE_START);
    this.vehicleRotorCondition = new Float32Array(VEHICLE_START);
    this.vehicleEngineOn = new Uint8Array(VEHICLE_START);
    this.vehicleQx = new Float32Array(VEHICLE_START);
    this.vehicleQy = new Float32Array(VEHICLE_START);
    this.vehicleQz = new Float32Array(VEHICLE_START);
    this.vehicleQw = new Float32Array(VEHICLE_START);
    this.vehicleCollective = new Float32Array(VEHICLE_START);
    this.vehiclePitchRate = new Float32Array(VEHICLE_START);
    this.vehicleRollRate = new Float32Array(VEHICLE_START);
    this.vehicleGroundPitch = new Float32Array(VEHICLE_START);
    this.vehicleGroundRoll = new Float32Array(VEHICLE_START);
    this.vehicleRideOffset = new Float32Array(VEHICLE_START);
    this.vehicleRideVelocity = new Float32Array(VEHICLE_START);
    this.vehicleDoors = new Uint32Array(VEHICLE_START);
    this.vehicleLightMode = new Uint8Array(VEHICLE_START);
    this.vehiclePitch = new Float32Array(VEHICLE_START);
    this.vehicleRoll = new Float32Array(VEHICLE_START);
    this.steering = new Float32Array(VEHICLE_START);
    this.wheelAngle = new Float32Array(VEHICLE_START);
    this.fuel = new Float32Array(VEHICLE_START);
    this.clearVehicle(0);
    this.pitch = new Int16Array(cap);
    this.anim = new Uint32Array(cap);
    this.cue = new Uint32Array(cap);
    this.emote = new Uint32Array(cap);
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
    this.bloom = new Uint8Array(cap);
    this.kick = new Uint8Array(cap);
    this.jetGear = new Uint8Array(cap);
    this.jetSpent = new Uint16Array(cap);
    this.jetThrust = new Uint8Array(cap);
    this.regenWait = new Uint16Array(cap);
    this.rollWait = new Uint16Array(cap);
    this.creatureMode = new Uint8Array(cap);
    this.creatureCooldown = new Uint16Array(cap);
    this.creaturePrimaryCooldown = new Uint16Array(cap);
    this.creaturePower = new Uint8Array(cap);
    this.creatureSide = new Uint8Array(cap);
    this.hold = new Uint8Array(cap);
    this.driven = new Uint8Array(cap);
    this.team = new Uint32Array(cap);
    this.seat = new Uint32Array(cap);
    this.span = new Uint32Array(cap);
    this.grown = new Uint32Array(cap);
    this.level = new Uint16Array(cap);
    this.colors = new Uint8Array(cap * 6);
    this.on = new Uint8Array(cap);
    this.rev = new Uint8Array(cap);
    this.chunk = new Int32Array(cap).fill(-1);
    this.chunkHead = new Int32Array(chunkCount(dims)).fill(-1);
    this.next = new Int32Array(cap).fill(-1);
    this.prev = new Int32Array(cap);
    this.freeFrom(0);
  }

  /** Lists the slots from `first` to the end as free, in order. The list was empty. */
  private freeFrom(first: number): void {
    for (let i = first; i < this.cap - 1; i++) this.prev[i] = i + 1;
    this.prev[this.cap - 1] = -1;
    this.freeHead = first;
    this.freeTail = this.cap - 1;
    this.freeCount = this.cap - first;
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
    const i = this.freeHead;
    this.freeHead = this.prev[i]!;
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
    this.vrow[i] = this.vehicular[kind] ? this.addVehicle() : 0;
    this.seatSlot[i] = 0;
    this.seatGen[i] = 0;
    this.pitch[i] = 0;
    this.anim[i] = 0;
    this.cue[i] = 0;
    this.emote[i] = 0;
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
    this.bloom[i] = 0;
    this.kick[i] = 0;
    this.jetGear[i] = this.jetSpent[i] = this.jetThrust[i] = 0;
    this.regenWait[i] = 0;
    this.rollWait[i] = 0;
    this.creatureMode[i] = 0;
    this.creatureCooldown[i] = 0;
    this.creaturePrimaryCooldown[i] = 0;
    this.creaturePower[i] = 0;
    this.creatureSide[i] = 0;
    this.hold[i] = 0;
    this.driven[i] = 0;
    this.team[i] = 0;
    this.seat[i] = 0;
    this.span[i] = 0;
    this.grown[i] = 0;
    this.level[i] = 0;
    this.colors.fill(0, i * 6, i * 6 + 6);
    this.names.delete(i);
    this.looks.delete(i);
    this.gears.delete(i);
    this.on[i] = 0;
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
    this.vrow = wider(this.vrow, cap);
    this.seatSlot = wider(this.seatSlot, cap);
    this.seatGen = wider(this.seatGen, cap);
    this.pitch = wider(this.pitch, cap);
    this.anim = wider(this.anim, cap);
    this.cue = wider(this.cue, cap);
    this.emote = wider(this.emote, cap);
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
    this.bloom = wider(this.bloom, cap);
    this.kick = wider(this.kick, cap);
    this.jetGear = wider(this.jetGear, cap);
    this.jetSpent = wider(this.jetSpent, cap);
    this.jetThrust = wider(this.jetThrust, cap);
    this.regenWait = wider(this.regenWait, cap);
    this.rollWait = wider(this.rollWait, cap);
    this.creatureMode = wider(this.creatureMode, cap);
    this.creatureCooldown = wider(this.creatureCooldown, cap);
    this.creaturePrimaryCooldown = wider(this.creaturePrimaryCooldown, cap);
    this.creaturePower = wider(this.creaturePower, cap);
    this.creatureSide = wider(this.creatureSide, cap);
    this.hold = wider(this.hold, cap);
    this.driven = wider(this.driven, cap);
    this.team = wider(this.team, cap);
    this.seat = wider(this.seat, cap);
    this.span = wider(this.span, cap);
    this.grown = wider(this.grown, cap);
    this.level = wider(this.level, cap);
    this.colors = wider(this.colors, cap * 6);
    this.on = wider(this.on, cap);
    this.rev = wider(this.rev, cap);
    this.chunk = wider(this.chunk, cap, -1);
    this.next = wider(this.next, cap, -1);
    this.prev = wider(this.prev, cap);
    this.cap = cap;
    // Every old slot is taken, so the free slots are the new ones, in order.
    this.freeFrom(old);
    for (const widen of this.onGrow) widen(cap);
    return true;
  }

  /** A vehicle row with nothing in it, the columns doubling when every row is taken. */
  private addVehicle(): number {
    let v = this.vfree.pop();
    if (v === undefined) {
      if (this.vused === this.vcap) this.growVehicles();
      v = this.vused++;
    }
    this.clearVehicle(v);
    return v;
  }

  private growVehicles(): void {
    const cap = (this.vcap *= 2);
    this.vehicle = wider(this.vehicle, cap);
    this.vehicleYaw = wider(this.vehicleYaw, cap);
    this.vehicleYawRate = wider(this.vehicleYawRate, cap);
    this.vehicleGear = wider(this.vehicleGear, cap);
    this.vehicleRpm = wider(this.vehicleRpm, cap);
    this.vehicleShiftTime = wider(this.vehicleShiftTime, cap);
    this.vehiclePayloadMass = wider(this.vehiclePayloadMass, cap);
    this.vehicleRotorRpm = wider(this.vehicleRotorRpm, cap);
    this.vehicleRotorPhase = wider(this.vehicleRotorPhase, cap);
    this.vehicleEngineCondition = wider(this.vehicleEngineCondition, cap);
    this.vehicleFlooding = wider(this.vehicleFlooding, cap);
    this.vehicleHullCondition = wider(this.vehicleHullCondition, cap);
    this.vehicleRotorCondition = wider(this.vehicleRotorCondition, cap);
    this.vehicleEngineOn = wider(this.vehicleEngineOn, cap);
    this.vehicleQx = wider(this.vehicleQx, cap);
    this.vehicleQy = wider(this.vehicleQy, cap);
    this.vehicleQz = wider(this.vehicleQz, cap);
    this.vehicleQw = wider(this.vehicleQw, cap);
    this.vehicleCollective = wider(this.vehicleCollective, cap);
    this.vehiclePitchRate = wider(this.vehiclePitchRate, cap);
    this.vehicleRollRate = wider(this.vehicleRollRate, cap);
    this.vehicleGroundPitch = wider(this.vehicleGroundPitch, cap);
    this.vehicleGroundRoll = wider(this.vehicleGroundRoll, cap);
    this.vehicleRideOffset = wider(this.vehicleRideOffset, cap);
    this.vehicleRideVelocity = wider(this.vehicleRideVelocity, cap);
    this.vehicleDoors = wider(this.vehicleDoors, cap);
    this.vehicleLightMode = wider(this.vehicleLightMode, cap);
    this.vehiclePitch = wider(this.vehiclePitch, cap);
    this.vehicleRoll = wider(this.vehicleRoll, cap);
    this.steering = wider(this.steering, cap);
    this.wheelAngle = wider(this.wheelAngle, cap);
    this.fuel = wider(this.fuel, cap);
  }

  /** What a slot's vehicle columns held when it was made: a parked, sound vehicle that is no vehicle yet. */
  private clearVehicle(v: number): void {
    this.vehicle[v] = 0;
    this.vehicleYaw[v] = 0;
    this.vehicleYawRate[v] = 0;
    this.vehicleGear[v] = 0;
    this.vehicleRpm[v] = 0;
    this.vehicleShiftTime[v] = 0;
    this.vehiclePayloadMass[v] = 0;
    this.vehicleRotorRpm[v] = 0;
    this.vehicleRotorPhase[v] = 0;
    this.vehicleEngineCondition[v] = 1;
    this.vehicleFlooding[v] = 0;
    this.vehicleHullCondition[v] = 1;
    this.vehicleRotorCondition[v] = 1;
    this.vehicleEngineOn[v] = 0;
    this.vehicleQx[v] = 0;
    this.vehicleQy[v] = 0;
    this.vehicleQz[v] = 0;
    this.vehicleQw[v] = 1;
    this.vehicleCollective[v] = 0;
    this.vehiclePitchRate[v] = 0;
    this.vehicleRollRate[v] = 0;
    this.vehicleGroundPitch[v] = 0;
    this.vehicleGroundRoll[v] = 0;
    this.vehicleRideOffset[v] = 0;
    this.vehicleRideVelocity[v] = 0;
    this.vehicleDoors[v] = 0;
    this.vehicleLightMode[v] = 0;
    this.vehiclePitch[v] = 0;
    this.vehicleRoll[v] = 0;
    this.steering[v] = 0;
    this.wheelAngle[v] = 0;
    this.fuel[v] = 0;
  }

  /** The setters bump `rev` only on a change, and clients that already see the entity are then sent it again. */
  setLook(i: number, level: number, colors: ArrayLike<number> | null, name: string): void {
    if (level > 65535) level = 65535;
    // 24 characters is at most 72 bytes, which is what a snapshot will carry.
    if (name.length > 24) name = name.slice(0, 24);
    let same = this.level[i] === level && (this.names.get(i) ?? "") === name;
    for (let k = 0; k < 6 && same; k++) same = this.colors[i * 6 + k] === (colors ? colors[k]! : 0);
    if (same) return;
    this.level[i] = level;
    for (let k = 0; k < 6; k++) this.colors[i * 6 + k] = colors ? colors[k]! : 0;
    if (name === "") this.names.delete(i);
    else this.names.set(i, name);
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
    if (look) this.looks.set(i, look);
    else this.looks.delete(i);
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  setGear(i: number, gear: ArrayLike<number>): void {
    const old = this.gears.get(i);
    let same = old !== undefined;
    for (let k = 0; k < GEAR_COUNT && same; k++) same = old![k] === gear[k];
    if (same) return;
    this.gears.set(i, Uint16Array.from({ length: GEAR_COUNT }, (_, k) => gear[k] ?? 0));
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  /** Whether the laser in hand is on. A change is sent as a new create, as the gear is. */
  setOn(i: number, on: boolean): void {
    if ((this.on[i] !== 0) === on) return;
    this.on[i] = on ? 1 : 0;
    this.rev[i] = (this.rev[i]! + 1) & 15;
  }

  /** Brings `anim[i]` up to date. Call it after changing velocity, facing, pitch, mode, stance or act. */
  pose(i: number, tick = 0): void {
    posed.mode = this.mode[i]!;
    posed.grounded = (this.flags[i]! & F_GROUNDED) !== 0;
    posed.stance = this.stance[i]!;
    posed.setAction(this.act[i]!, this.hold[i]!, tick - this.actTicks[i]!);
    posed.setMotion(this.vx[i]!, this.vz[i]!, (this.yaw[i]! * TAU) / 65536, (this.pitch[i]! * (PI / 2)) / 16384, this.vy[i]!);
    this.anim[i] = posed.pack();
    if (!(this.cue[i]! & CUE_DEAD)) this.cue[i] = this.jetThrust[i] ? this.cue[i]! | CUE_JET : this.cue[i]! & ~CUE_JET;
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
    const v = this.vrow[i]!;
    b.vehicle = this.vehicle[v] !== 0;
    b.vehicleYaw = this.vehicleYaw[v]!;
    b.vehicleYawRate = this.vehicleYawRate[v]!;
    b.vehicleGear = this.vehicleGear[v]!;
    b.vehicleRpm = this.vehicleRpm[v]!;
    b.vehicleShiftTime = this.vehicleShiftTime[v]!;
    b.vehiclePayloadMass = this.vehiclePayloadMass[v]!;
    b.vehicleRotorRpm = this.vehicleRotorRpm[v]!;
    b.vehicleRotorPhase = this.vehicleRotorPhase[v]!;
    b.vehicleEngineCondition = this.vehicleEngineCondition[v]!;
    b.vehicleFlooding = this.vehicleFlooding[v]!;
    b.vehicleHullCondition = this.vehicleHullCondition[v]!;
    b.vehicleRotorCondition = this.vehicleRotorCondition[v]!;
    b.vehicleEngineOn = this.vehicleEngineOn[v] !== 0;
    b.vehicleQx = this.vehicleQx[v]!;
    b.vehicleQy = this.vehicleQy[v]!;
    b.vehicleQz = this.vehicleQz[v]!;
    b.vehicleQw = this.vehicleQw[v]!;
    b.vehicleCollective = this.vehicleCollective[v]!;
    b.vehiclePitchRate = this.vehiclePitchRate[v]!;
    b.vehicleRollRate = this.vehicleRollRate[v]!;
    b.vehicleGroundPitch = this.vehicleGroundPitch[v]!;
    b.vehicleGroundRoll = this.vehicleGroundRoll[v]!;
    b.vehicleRideOffset = this.vehicleRideOffset[v]!;
    b.vehicleRideVelocity = this.vehicleRideVelocity[v]!;
    b.vehiclePitch = this.vehiclePitch[v]!;
    b.vehicleRoll = this.vehicleRoll[v]!;
    b.steering = this.steering[v]!;
    b.wheelAngle = this.wheelAngle[v]!;
    b.fuel = this.fuel[v]!;
    b.seat = this.seat[i]!;
    b.seatSlot = this.seatSlot[i]!;
    b.seatGen = this.seatGen[i]!;
    b.held = this.gears.get(i)?.[GEAR_HELD] ?? 0;
    b.act = this.act[i]!;
    b.actTicks = this.actTicks[i]!;
    b.rounds = this.rounds[i]!;
    b.reloadTo = this.reloadTo[i]!;
    b.bloom = this.bloom[i]!;
    b.kick = this.kick[i]!;
    b.jetGear = this.jetGear[i]!;
    b.jetSpent = this.jetSpent[i]!;
    b.jetThrust = this.jetThrust[i]!;
    b.regenWait = this.regenWait[i]!;
    b.rollWait = this.rollWait[i]!;
    b.creatureMode = this.creatureMode[i]!;
    b.creatureCooldown = this.creatureCooldown[i]!;
    b.creaturePrimaryCooldown = this.creaturePrimaryCooldown[i]!;
    b.creaturePower = this.creaturePower[i]!;
    b.creatureSide = this.creatureSide[i]!;
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
    let v = this.vrow[i]!;
    if (v === 0 && b.vehicle) {
      v = this.addVehicle();
      this.vrow[i] = v;
    }
    if (v !== 0) this.storeVehicle(v, b);
    this.act[i] = b.act;
    this.actTicks[i] = b.actTicks;
    this.rounds[i] = b.rounds;
    this.bloom[i] = b.bloom;
    this.kick[i] = b.kick;
    this.jetSpent[i] = b.jetSpent;
    this.jetThrust[i] = b.jetThrust;
    this.regenWait[i] = b.regenWait;
    this.rollWait[i] = b.rollWait;
    this.creatureMode[i] = b.creatureMode;
    this.creatureCooldown[i] = b.creatureCooldown;
    this.creaturePrimaryCooldown[i] = b.creaturePrimaryCooldown;
    this.creaturePower[i] = b.creaturePower;
    this.creatureSide[i] = b.creatureSide;
    return this.setPosition(i, b.x, b.y, b.z);
  }

  private storeVehicle(v: number, b: Body): void {
    this.vehicle[v] = b.vehicle ? 1 : 0;
    this.vehicleYaw[v] = b.vehicleYaw;
    this.vehicleYawRate[v] = b.vehicleYawRate;
    this.vehicleGear[v] = b.vehicleGear;
    this.vehicleRpm[v] = b.vehicleRpm;
    this.vehicleShiftTime[v] = b.vehicleShiftTime;
    this.vehiclePayloadMass[v] = b.vehiclePayloadMass;
    this.vehicleRotorRpm[v] = b.vehicleRotorRpm;
    this.vehicleRotorPhase[v] = b.vehicleRotorPhase;
    this.vehicleEngineCondition[v] = b.vehicleEngineCondition;
    this.vehicleFlooding[v] = b.vehicleFlooding;
    this.vehicleHullCondition[v] = b.vehicleHullCondition;
    this.vehicleRotorCondition[v] = b.vehicleRotorCondition;
    this.vehicleEngineOn[v] = b.vehicleEngineOn ? 1 : 0;
    this.vehicleQx[v] = b.vehicleQx;
    this.vehicleQy[v] = b.vehicleQy;
    this.vehicleQz[v] = b.vehicleQz;
    this.vehicleQw[v] = b.vehicleQw;
    this.vehicleCollective[v] = b.vehicleCollective;
    this.vehiclePitchRate[v] = b.vehiclePitchRate;
    this.vehicleRollRate[v] = b.vehicleRollRate;
    this.vehicleGroundPitch[v] = b.vehicleGroundPitch;
    this.vehicleGroundRoll[v] = b.vehicleGroundRoll;
    this.vehicleRideOffset[v] = b.vehicleRideOffset;
    this.vehicleRideVelocity[v] = b.vehicleRideVelocity;
    this.vehiclePitch[v] = b.vehiclePitch;
    this.vehicleRoll[v] = b.vehicleRoll;
    this.steering[v] = b.steering;
    this.wheelAngle[v] = b.wheelAngle;
    this.fuel[v] = b.fuel;
  }

  destroy(i: number): void {
    if ((this.flags[i]! & F_ALIVE) === 0) return;
    this.unlink(i);
    this.flags[i] = 0;
    let g = (this.gen[i]! + 1) & HANDLE_GEN_MASK;
    if (g === 0) g = 1;
    this.gen[i] = g;
    const v = this.vrow[i]!;
    if (v !== 0) {
      this.vfree.push(v);
      this.vrow[i] = 0;
    }
    this.prev[i] = -1;
    if (this.freeCount === 0) this.freeHead = i;
    else this.prev[this.freeTail] = i;
    this.freeTail = i;
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
    const fromX = this.x[i]!, fromY = this.y[i]!, fromZ = this.z[i]!;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    for (const moved of this.onPosition) moved(i, fromX, fromY, fromZ);
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
