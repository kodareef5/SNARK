// Vehicle seats in the normal game world. The surviving actor, its record, inventory,
// team and connection stay the same; only the body its inputs drive changes.
import { BOAT_ART } from '../content/vehicles/boat-art.ts';
import { Pose } from '../shared/anim/clip.ts';
import { HUMAN, HUMAN_BONES, SOCKET_EYE } from '../shared/anim/human.ts';
import { defaultLook, lookScales, LOOK_SEX, SEX_IDS } from '../shared/anim/look.ts';
import type { PackRig } from '../shared/pack/pack.ts';
import { createMountMotion, mountOrigin, mountPose } from '../shared/anim/mount.ts';
import { fitSeatControls } from '../shared/anim/seat-controls.ts';
import { boneToModel, Solved, solve } from '../shared/anim/skeleton.ts';
import { CHUNK_SIZE, TICK_DT, TICK_RATE } from '../shared/coords.ts';
import { makeHandle } from '../shared/ids.ts';
import { detAtan2, detCos, detSin, TAU } from '../shared/math/scalar.ts';
import { quatRotate } from '../shared/math/quat.ts';
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK, SESSION_ALIVE, TEXT_NOTICE } from '../shared/net/protocol.ts';
import { BTN_JUMP, Body, MODE_SWIM, MODE_WALK, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceHeight } from '../shared/sim/character.ts';
import { F_ALIVE, F_GROUNDED, F_PLAYER } from '../shared/sim/entities.ts';
import { stepVehicleBody, vehicleDoor, withVehicleDoor, vehicleStep } from '../shared/sim/vehicle-body.ts';
import { vehiclePoint, vehicleRotation } from '../shared/sim/vehicle-frame.ts';
import { isBoatVehicle, isRotorVehicle, isWheelVehicle, type VehicleDefinition, type VehicleSeat, type VehicleState } from '../shared/sim/vehicle.ts';
import { V_HEALTH } from '../shared/sim/vitals.ts';
import { capsuleFree, groundUnder, stepOnto } from '../shared/world/collide.ts';
import { boatMeetsCapsule } from '../shared/world/boat.ts';
import { helicopterMeetsCapsule } from '../shared/world/helicopter.ts';
import { carMeetsCapsule } from '../shared/world/vehicle.ts';
import { vehiclePointVelocity } from '../shared/sim/vehicle-rigid.ts';
import type { Connection } from '../shared/net/transport.ts';
import type { Items } from './items.ts';
import type { VehicleCollisionPair, VehicleCollisionParty, VehicleContacts } from './vehicle-contacts.ts';
import type { Creatures } from './creatures.ts';
import type { Client, GameServer } from './game.ts';
import { Occupancy, type OccupancyAction, type OccupancyApproval, type OccupancyEffect } from './occupancy.ts';
import type { EntityRecord, Records } from './records.ts';
import { Seating, type Point } from './seating.ts';
import type { ServerWorld } from './world.ts';

interface UrbanContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  items: Items;
  creatures: Creatures;
  rigs: readonly PackRig[];
  refresh(rec: EntityRecord): void;
  /** Tribe/PvE access: may `actor` take or keep a seat in `vehicle`, displacing `victim` (null for none)? */
  may?(actor: EntityRecord, vehicle: EntityRecord, victim: EntityRecord | null): boolean;
  /** Shares the engine's immobilization rule with ordinary dinosaur mounting. */
  tangled?(record: EntityRecord): boolean;
  /** Native health/death path, supplied by the host. */
  damage?(record: EntityRecord, points: number, by: number): number;
  /** Physical collision harm uses the opposing qualified body/driver and ordinary PvE rules. */
  collisionDamage?(record: EntityRecord, points: number, by: EntityRecord): number;
}
interface HostSeat { entity: number; handle: number; definition: VehicleDefinition; last: Point & { vx: number; vy: number; vz: number } }
interface Scope { epoch: number; request: number; connection: Connection | null }
export interface UrbanIncident { action: number; tick: number; offender: number; victim: number; vehicle: number }
/** Seat tables are pruned as hosts disappear and actors go idle; these only bound a pathological world. */
const MAX_HOSTS = 1 << 16;
const MAX_ACTORS = 1 << 16;
/** Namespaced extension, preserved by the normal record codec even in builds without vehicles. */
const VEHICLE_COMPONENT = 0x757262;
/**
 * The saved component, little-endian: a version u8 (8 wheeled, 5 rotor, 9 boat), these fields as f32 in this order and
 * whether it stands on its wheels u8, then its mechanical/attitude fields as f32 and whether its engine runs u8.
 */
const VEHICLE_FIELDS = ["vehicleYaw", "vehiclePitch", "vehicleRoll", "steering", "wheelAngle", "fuel", "vehicleYawRate", "vehiclePitchRate", "vehicleRollRate", "vehicleGroundPitch", "vehicleGroundRoll", "vehicleRideOffset", "vehicleRideVelocity", "vx", "vy", "vz", "vehicleGear", "vehicleRpm", "vehicleShiftTime", "vehiclePayloadMass"] as const;
const ROTOR_FIELDS = ["vehicleRotorRpm", "vehicleRotorPhase", "vehicleEngineCondition", "vehicleRotorCondition", "vehicleQx", "vehicleQy", "vehicleQz", "vehicleQw", "vehicleCollective"] as const;
const HULL_FIELDS = ["vehicleEngineCondition", "vehicleQx", "vehicleQy", "vehicleQz", "vehicleQw", "vehicleFlooding", "vehicleHullCondition"] as const;
const BASE_BYTES = 2 + VEHICLE_FIELDS.length * 4;
const formOf = (movement: VehicleDefinition['movement']): { version: number; extra: readonly (typeof ROTOR_FIELDS[number] | typeof HULL_FIELDS[number])[] } =>
  movement === 'rotor' ? { version: 5, extra: ROTOR_FIELDS } : movement === 'boat' ? { version: 9, extra: HULL_FIELDS } : { version: 8, extra: HULL_FIELDS };
const PLAIN = defaultLook();
/** How often a car at rest that nobody drives is stepped, to find the ground gone from under it. */
const REST_TICKS = 30;

export class Urban {
  readonly occupancy: Occupancy;
  contacts: VehicleContacts | null = null;
  /** Bounded live incident feed; production save components are a separate follow-up. */
  readonly incidents: UrbanIncident[] = [];
  private readonly ctx: UrbanContext;
  private readonly hosts = new Map<number, HostSeat>();
  private readonly scopes = new Map<number, Scope>();
  /** The entities sessions drive this tick. */
  private readonly drivers = new Set<number>();
  /** The bytes a car's mechanical component would be saved as, made again each tick without allocating. */
  private readonly saving = new Uint8Array(BASE_BYTES + ROTOR_FIELDS.length * 4 + 1);
  private readonly savingView = new DataView(this.saving.buffer);
  /** Per host this tick, a bit for each door someone is getting in or out by. */
  private readonly opening = new Map<number, number>();
  private epochs = 0;
  private readonly body = new Body();
  /** A vehicle's state as `save` reads it. */
  private readonly saved = new Body();
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly solved = new Solved(HUMAN_BONES);
  private readonly seatAt = new Float64Array(3);
  private readonly seatRotation = new Float64Array(4);
  private readonly seatOrigin = new Float64Array(3);
  private readonly motion = createMountMotion();
  private readonly scales = new Float32Array(HUMAN_BONES * 3);
  private readonly rests = new Map<string, Float32Array>();
  private readonly seating: Seating;
  private readonly impacts = new Map<number, { speed: number; rotor: boolean; prop: boolean; water: boolean; landing: number }>();
  private readonly hurtAt = new Map<number, number>();
  private readonly health = new Map<number, number>();
  private readonly collisionCharges: { party: VehicleCollisionParty; by: EntityRecord; damage: number; rotor: boolean; propeller: boolean }[] = [];
  private readonly pushes = new Map<number, { until: number; x: number; z: number }>();

  constructor(ctx: UrbanContext) {
    this.ctx = ctx;
    this.seating = new Seating(ctx.world, ctx.records);
    for (const rig of ctx.rigs) if (rig.rest.length === HUMAN_BONES * 3) this.rests.set(rig.id, Float32Array.from(rig.rest));
    this.occupancy = new Occupancy({
      actor: pid => {
        const e = this.entity(pid), rec = ctx.records.byPid.get(pid);
        return e < 0 || !rec ? null : { handle: makeHandle(e, ctx.world.ents.gen[e]!), alive: !rec.dead, ready: !rec.out && !ctx.tangled?.(rec) };
      },
      host: pid => {
        const host = this.hosts.get(pid), e = host?.entity ?? -1;
        const valid = host && this.entity(pid) === e && makeHandle(e, ctx.world.ents.gen[e]!) === host.handle;
        const record = ctx.records.byPid.get(pid);
        return valid && record ? { handle: host.handle, ready: !record.dead && !ctx.tangled?.(record),
          speed: Math.hypot(ctx.world.ents.vx[e]!, ctx.world.ents.vz[e]!) } : null;
      },
      check: action => this.check(action),
      canControl: (actor, host) => this.entity(actor) >= 0 && this.hosts.has(host) && this.allowed(actor, host, 0),
    }, { runtimeEpoch: 1, maxHosts: MAX_HOSTS, maxActors: MAX_ACTORS });
  }

  /** One access rule for taking a seat and for keeping control of one. */
  private allowed(actor: number, host: number, victim: number): boolean {
    const { records } = this.ctx, me = records.byPid.get(actor), car = records.byPid.get(host);
    if (!me || !car) return false;
    return this.ctx.may ? this.ctx.may(me, car, victim ? records.byPid.get(victim) ?? null : null) : true;
  }

  register(e: number): boolean {
    const { world } = this.ctx, ents = world.ents;
    const definition = world.reg.vehicle[ents.kind[e]!];
    if (!definition || (ents.flags[e]! & F_ALIVE) === 0) return false;
    const pid = ents.pid[e]!;
    const handle = makeHandle(e, ents.gen[e]!);
    const known = this.hosts.get(pid);
    if (known?.handle === handle) return true;
    // The same record rematerialized in another slot: the old body's seats are released first.
    if (known) this.evict(pid);
    if (this.hosts.size >= MAX_HOSTS) return false;
    this.occupancy.addHost(pid, handle, definition.seats);
    this.hosts.set(pid, { entity: e, handle, definition, last: { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, vx: 0, vy: 0, vz: 0 } });
    ents.loadBody(e, this.body);
    if (!this.body.vehicle) {
      this.body.vehicle = true;
      for (const field of VEHICLE_FIELDS) this.body[field] = 0;
      this.body.vehicleYaw = this.body.yaw * TAU / 65536;
      this.body.grounded = !isBoatVehicle(definition);
      this.body.fuel = definition.spec.fuelCapacity;
      this.body.vehicleRpm = isWheelVehicle(definition) ? definition.spec.drivetrain?.idleRpm ?? 0 : 0;
      this.body.vehicleRotorRpm = this.body.vehicleRotorPhase = 0;
      this.body.vehicleEngineCondition = this.body.vehicleRotorCondition = 1;
      this.body.vehicleEngineOn = false;
      this.body.vehicleHullCondition = 1; this.body.vehicleFlooding = 0;
      this.body.vehicleQx = this.body.vehicleQz = this.body.vehicleCollective = 0;
      this.body.vehicleQy = Math.fround(Math.sin(this.body.vehicleYaw / 2)); this.body.vehicleQw = Math.fround(Math.cos(this.body.vehicleYaw / 2));
      const saved = this.ctx.records.byPid.get(pid)?.extra.get(VEHICLE_COMPONENT);
      if (saved) this.restoreSaved(pid, saved, definition);
      else if (!isRotorVehicle(definition)) {
        const vitals = this.ctx.records.byPid.get(pid)?.vitals;
        this.body.vehicleHullCondition = Math.fround(vitals ? Math.max(0, Math.min(1, vitals.at(V_HEALTH, world.tick) / Math.max(1, vitals.max[V_HEALTH]!))) : 1);
      }
      ents.storeBody(e, this.body);
    }
    ents.vehiclePayloadMass[ents.vrow[e]!] = Math.fround(this.payloadMass(e));
    this.health.set(pid, this.ctx.records.byPid.get(pid)?.vitals?.at(V_HEALTH, world.tick) ?? 0);
    this.note(this.hosts.get(pid)!);
    world.history.track(e);
    this.save(e);
    return true;
  }

  /** Reads a saved component into `this.body`, clamped to the current definition, which settings may have retuned. */
  private restoreSaved(pid: number, saved: Uint8Array, definition: VehicleDefinition): void {
    const b = this.body, { version, extra } = formOf(definition.movement), size = BASE_BYTES + extra.length * 4 + 1;
    if (saved[0] !== version || saved.length !== size) throw new Error(`vehicle ${pid}: its saved state is version ${saved[0]} in ${saved.length} bytes, and this build reads version ${version} in ${size}`);
    const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength);
    const values = VEHICLE_FIELDS.map((_, i) => view.getFloat32(1 + i * 4, true));
    const rotor = extra.map((_, i) => view.getFloat32(BASE_BYTES + i * 4, true));
    if (!values.every(Number.isFinite) || !rotor.every(Number.isFinite) || saved[BASE_BYTES - 1]! > 1 || saved[saved.length - 1]! > 1) throw new Error(`vehicle ${pid}: its saved state is unreadable`);
    for (let i = 0; i < VEHICLE_FIELDS.length; i++) b[VEHICLE_FIELDS[i]!] = values[i]!;
    b.grounded = saved[BASE_BYTES - 1]! !== 0;
    const clampTo = (v: number, lo: number, hi: number): number => Math.fround(Math.min(hi, Math.max(lo, v)));
    const train = isWheelVehicle(definition) ? definition.spec.drivetrain : undefined;
    const spec = definition.spec, travel = isWheelVehicle(definition) ? definition.spec.suspensionTravel ?? .18 : 0;
    const normal = isBoatVehicle(definition) ? .9 : definition.spec.minGroundNormal;
    const grade = detAtan2(Math.sqrt(1 - normal * normal), normal);
    const wrapped = (v: number): number => { const a = v % TAU; return Math.fround(a - Math.floor((a + TAU / 2) / TAU) * TAU); };
    b.vehicleYaw = wrapped(b.vehicleYaw); b.wheelAngle = wrapped(b.wheelAngle);
    b.vehiclePitch = wrapped(b.vehiclePitch);
    b.vehicleRoll = wrapped(b.vehicleRoll);
    b.vehicleGroundPitch = clampTo(b.vehicleGroundPitch, -grade, grade);
    b.vehicleGroundRoll = clampTo(b.vehicleGroundRoll, -grade, grade);
    const steer = isRotorVehicle(definition) ? 0 : definition.spec.maxSteer;
    b.steering = clampTo(b.steering, -steer, steer);
    b.vehicleYawRate = clampTo(b.vehicleYawRate, -12, 12);
    b.vehiclePitchRate = clampTo(b.vehiclePitchRate, -12, 12);
    b.vehicleRollRate = clampTo(b.vehicleRollRate, -12, 12);
    b.vehicleRideOffset = clampTo(b.vehicleRideOffset, -Math.min(travel * 0.65, spec.clearance * 0.65), travel);
    b.vehicleRideVelocity = clampTo(b.vehicleRideVelocity, -60, 60);
    // Engine/cruise speed is a powered target, not a limit on downhill, impact or dive momentum, including boats.
    b.vx = clampTo(b.vx, -120, 120); b.vy = clampTo(b.vy, -100, 100); b.vz = clampTo(b.vz, -120, 120);
    b.fuel = clampTo(b.fuel, 0, definition.spec.fuelCapacity);
    b.vehicleGear = Math.round(clampTo(b.vehicleGear, -1, isBoatVehicle(definition) ? 1 : train?.forwardRatios.length ?? 12));
    b.vehicleRpm = clampTo(b.vehicleRpm, 0, isBoatVehicle(definition) ? definition.spec.maxRpm : train?.redlineRpm ?? 32767);
    b.vehicleShiftTime = clampTo(b.vehicleShiftTime, 0, isBoatVehicle(definition) ? definition.spec.shiftDelay : train?.shiftCooldown ?? 1);
    // Payload is recomputed from records right after loading.
    b.vehiclePayloadMass = 0;
    if (isRotorVehicle(definition)) {
      b.vehicleRotorRpm = clampTo(rotor[0]!, 0, definition.spec.rotorRpm);
      b.vehicleRotorPhase = wrapped(rotor[1]!);
      b.vehicleEngineCondition = clampTo(rotor[2]!, 0, 1);
      b.vehicleRotorCondition = clampTo(rotor[3]!, 0, 1);
      b.vehicleEngineOn = saved[size - 1] === 1;
      const norm = Math.hypot(rotor[4]!, rotor[5]!, rotor[6]!, rotor[7]!);
      if (norm > 1e-6) {
        b.vehicleQx = Math.fround(rotor[4]! / norm); b.vehicleQy = Math.fround(rotor[5]! / norm);
        b.vehicleQz = Math.fround(rotor[6]! / norm); b.vehicleQw = Math.fround(rotor[7]! / norm);
      } else throw new Error(`vehicle ${pid}: its saved attitude is unreadable`);
      b.vehicleCollective = clampTo(rotor[8]!, 0, 1);
    }
    if (!isRotorVehicle(definition)) {
      b.vehicleEngineCondition = clampTo(rotor[0]!, 0, 1);
      b.vehicleFlooding = clampTo(rotor[5]!, 0, 1);
      b.vehicleHullCondition = clampTo(rotor[6]!, 0, 1);
      b.vehicleEngineOn = saved[size - 1] === 1;
      const norm = Math.hypot(rotor[1]!, rotor[2]!, rotor[3]!, rotor[4]!);
      if (norm > 1e-6) { b.vehicleQx = Math.fround(rotor[1]! / norm); b.vehicleQy = Math.fround(rotor[2]! / norm); b.vehicleQz = Math.fround(rotor[3]! / norm); b.vehicleQw = Math.fround(rotor[4]! / norm); }
      else throw new Error(`vehicle ${pid}: its saved attitude is unreadable`);
    }
    b.yaw = Math.round(b.vehicleYaw * 65536 / TAU) & 65535;
  }

  private note(host: HostSeat): void {
    const ents = this.ctx.world.ents, e = host.entity;
    host.last.x = ents.x[e]!; host.last.z = ents.z[e]!;
    host.last.y = ents.y[e]! - ((ents.flags[e]! & F_GROUNDED) !== 0 ? ents.vehicleRideOffset[ents.vrow[e]!]! : 0);
    host.last.vx = ents.vx[e]!; host.last.vy = ents.vy[e]!; host.last.vz = ents.vz[e]!;
  }

  /** Releases everything seated in or headed for a vehicle whose entity is gone. Living
   * occupants use a locally reachable capsule/stance; a low roof never forces standing.
   */
  private evict(pid: number): void {
    const { world, records } = this.ctx, ents = world.ents;
    const host = this.hosts.get(pid);
    for (const effect of this.occupancy.evictHost(pid, world.tick)) {
      this.apply(effect);
      if (effect.type !== 'detach') continue;
      const e = this.entity(effect.actor);
      if (e < 0 || makeHandle(e, ents.gen[e]!) !== effect.actorHandle) continue;
      this.recover(e, host?.last);
      ents.vx[e] = host && !isWheelVehicle(host.definition) ? host.last.vx : 0;
      ents.vy[e] = host && !isWheelVehicle(host.definition) ? host.last.vy : 0;
      ents.vz[e] = host && !isWheelVehicle(host.definition) ? host.last.vz : 0;
      ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
      ents.pose(e, world.tick);
      records.dirty.add(effect.actor);
      const c = this.client(effect.actor);
      if (c) c.ownDirty = true;
    }
    this.hosts.delete(pid);
    this.impacts.delete(pid); this.hurtAt.delete(pid); this.health.delete(pid); this.pushes.delete(pid);
  }

  private recover(e: number, base?: Point): void {
    const { world } = this.ctx, ents = world.ents, actor = ents.pid[e]!, p = world.reg.move[ents.kind[e]!]!;
    const origin = { x: ents.x[e]!, y: Math.max(base?.y ?? ents.y[e]!, groundUnder(world.hf, ents.x[e]!, ents.z[e]!, p.radius)), z: ents.z[e]! };
    // The chassis support origin survives entity recycling. Most recoveries stay
    // here; the small bounded search also handles a nearby ledge or another body.
    for (const radius of [0, 0.6, 1.2, 2.4]) for (let side = 0; side < (radius === 0 ? 1 : 8); side++) {
      const x = origin.x + detSin(side * TAU / 8) * radius, z = origin.z + detCos(side * TAU / 8) * radius;
      const point = { x, y: Math.max(origin.y, groundUnder(world.hf, x, z, p.radius)), z };
      for (const stance of [STANCE_STAND, STANCE_CROUCH, STANCE_PRONE]) {
        const height = stanceHeight(p, stance);
        if (!this.seating.free(point, actor, [actor], 0, height) || !this.seating.corridor(origin, point, actor, [actor], 0, height)) continue;
        ents.setPosition(e, point.x, point.y, point.z); ents.stance[e] = stance;
        return;
      }
    }
    // Do not invent a teleport through a wall if geometry changed around the car.
    // Keep the smaller seated capsule; ordinary obstruction recovery can retry later.
    ents.stance[e] = STANCE_CROUCH;
  }

  /** Stands a body that was in a vehicle, or is inside its hull, where it can stand beside it: by the doors first, then
   * anywhere round the hull, each reached from the hull's middle through nothing but the vehicle itself. False when
   * there is nowhere; the body then stays crouched where it is. */
  private standBeside(e: number, host: HostSeat): boolean {
    const { world } = this.ctx, ents = world.ents, p = world.reg.move[ents.kind[e]!]!;
    const state = this.state(host.entity), spec = host.definition.spec, out = [0, 0, 0];
    if (isBoatVehicle(host.definition)) {
      const actor = ents.pid[e]!, pid = ents.pid[host.entity]!, ignored = [actor, ...host.definition.seats.map(s => this.occupancy.occupant(pid, s.id))];
      const from = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]! };
      const w = spec.halfWidth + p.radius + .15, l = spec.halfLength + p.radius + .4;
      for (const local of [BOAT_ART.anchors.boarding_water, [w, 0, 0], [-w, 0, 0], [w, 0, -l], [-w, 0, -l], [w, 0, l], [-w, 0, l]]) {
        const point = this.boatPoint(e, host, local);
        if (!this.seating.free(point, actor, ignored) || !this.seating.corridor(from, point, actor, ignored, pid)) continue;
        ents.setPosition(e, point.x, point.y, point.z); ents.stance[e] = STANCE_STAND; this.waterExit(e); return true;
      }
      ents.stance[e] = STANCE_CROUCH;
      return false;
    }
    const at = (x: number, z: number): Point => {
      vehiclePoint(state, [x, 0, z], out);
      return { x: out[0]!, y: Math.max(isRotorVehicle(host.definition) ? out[1]! : state.y - state.rideOffset, groundUnder(world.hf, out[0]!, out[2]!, p.radius)), z: out[2]! };
    };
    const spots: Point[] = [];
    for (const seat of host.definition.seats) {
      const side = seat.entry[0] >= 0 ? 1 : -1, x = side * Math.max(Math.abs(seat.entry[0]), spec.halfWidth + p.radius + 0.08);
      spots.push(at(x, seat.entry[2]), at(x + side * 1.1, seat.entry[2]));
    }
    // Then round the hull: its sides, its ends and its corners, just clear of it.
    const w = spec.halfWidth + p.radius + 0.1, l = spec.halfLength + p.radius + 0.1;
    for (const [x, z] of [[w, 0], [-w, 0], [0, l], [0, -l], [w, l], [-w, l], [w, -l], [-w, -l], [w, l / 2], [-w, l / 2], [w, -l / 2], [-w, -l / 2]] as const) spots.push(at(x, z));
    return this.seating.standAt(e, at(0, 0), spots, ents.pid[host.entity]!);
  }

  /** Seats are not saved. Before a seated body leaves the world, and for everyone as the server stops, its seat is freed
   * and it is stood beside its vehicle, so a save never keeps a body where a seat had it. */
  standDown(pid: number): void {
    const { world, records } = this.ctx, ents = world.ents, place = this.occupancy.seatOf(pid);
    const host = place ? this.hosts.get(place.host) : undefined, e = this.entity(pid);
    for (const effect of this.occupancy.remove(pid, world.tick)) this.apply(effect);
    if (!host || e < 0 || makeHandle(host.entity, ents.gen[host.entity]!) !== host.handle) return;
    const flying = !isWheelVehicle(host.definition) && (ents.flags[host.entity]! & F_GROUNDED) === 0;
    const vx = flying ? ents.vx[host.entity]! : 0, vy = flying ? ents.vy[host.entity]! : 0, vz = flying ? ents.vz[host.entity]! : 0;
    this.standBeside(e, host);
    ents.vx[e] = vx; ents.vy[e] = vy; ents.vz[e] = vz;
    if (flying) ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.pose(e, world.tick);
    records.dirty.add(pid);
  }

  private waterExit(e: number): void {
    const { world } = this.ctx, ents = world.ents, p = world.reg.move[ents.kind[e]!]!;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.mode[e] = world.hf.waterAt(ents.x[e]!, ents.z[e]!) - ents.y[e]! > p.height * .7 ? MODE_SWIM : MODE_WALK;
  }

  standDownAll(): void {
    for (const pid of [...this.scopes.keys()]) if (this.occupancy.seatOf(pid)) this.standDown(pid);
  }

  /** Release a doomed boat's crew while its live hull can still be excluded from the ladder corridor. */
  releaseHost(pid: number): void {
    const host = this.hosts.get(pid);
    if (!host) return;
    for (const seat of host.definition.seats) {
      const actor = this.occupancy.occupant(pid, seat.id);
      if (actor) this.standDown(actor);
    }
  }

  /** A body coming into the world inside a vehicle's hull, saved so by a server that stopped without standing it down, is
   * stood beside the vehicle. */
  settle(e: number): void {
    const { world, records } = this.ctx, ents = world.ents, p = world.reg.move[ents.kind[e]!];
    if (!p || this.occupancy.seatOf(ents.pid[e]!)) return;
    const pad = p.radius + this.seating.reach;
    const x0 = Math.max(0, Math.floor((ents.x[e]! - pad) / CHUNK_SIZE)), x1 = Math.min(world.dims.chunksX - 1, Math.floor((ents.x[e]! + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((ents.z[e]! - pad) / CHUNK_SIZE)), z1 = Math.min(world.dims.chunksZ - 1, Math.floor((ents.z[e]! + pad) / CHUNK_SIZE));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) for (let car = ents.chunkHead[cz * world.dims.chunksX + cx]!; car >= 0; car = ents.next[car]!) {
      const host = this.hosts.get(ents.pid[car]!);
      if (!host || host.entity !== car || car === e) continue;
      const spec = host.definition.spec, a = ents.vehicleYaw[ents.vrow[car]!]!, dx = ents.x[e]! - ents.x[car]!, dz = ents.z[e]! - ents.z[car]!;
      const x = Math.abs(Math.cos(a) * dx - Math.sin(a) * dz) - spec.halfWidth, z = Math.abs(Math.sin(a) * dx + Math.cos(a) * dz) - spec.halfLength;
      const outside = Math.max(0, x) ** 2 + Math.max(0, z) ** 2 >= p.radius * p.radius;
      if (outside || ents.y[e]! >= ents.y[car]! + spec.height || ents.y[e]! + p.height <= ents.y[car]! - spec.height) continue;
      this.standBeside(e, host);
      ents.pose(e, world.tick);
      records.dirty.add(ents.pid[e]!);
      return;
    }
  }

  /** Curb mass is content; cargo and the mass/possessions of every committed occupant are authority data. */
  payloadMass(e: number): number {
    const { world, records, items } = this.ctx, ents = world.ents;
    const pid = ents.pid[e]!, rec = records.byPid.get(pid), host = this.hosts.get(pid);
    let mass = rec?.inv ? items.inv(rec).weight(items.table) : 0;
    if (host) for (const seat of host.definition.seats) {
      const actor = this.occupancy.occupant(pid, seat.id), ae = this.entity(actor), occupant = records.byPid.get(actor);
      if (!occupant || ae < 0 || makeHandle(ae, ents.gen[ae]!) !== this.occupancy.occupantHandle(pid, seat.id)) continue;
      mass += world.reg.mass[occupant.kind]! || 80;
      if (occupant.inv) mass += items.inv(occupant).weight(items.table);
    }
    return Math.max(0, Math.min(1e6, mass));
  }

  /** A server contact may move the chassis after creature motion; publish the same final frame for every occupant. */
  syncAfterContact(e: number): void {
    const { world } = this.ctx, ents = world.ents, host = this.hosts.get(ents.pid[e]!);
    if (!host || host.handle !== makeHandle(e, ents.gen[e]!)) return;
    this.note(host);
    for (const seat of host.definition.seats) {
      const pid = this.occupancy.occupant(ents.pid[e]!, seat.id), actor = this.entity(pid);
      if (actor >= 0 && makeHandle(actor, ents.gen[actor]!) === this.occupancy.occupantHandle(ents.pid[e]!, seat.id)) this.pin(actor, e, seat.anchor, !!seat.driver);
    }
    ents.pose(e, world.tick); this.save(e);
  }

  /** Capture the shared solver's one-tick report before another vehicle overwrites it.
   * Damage is applied in step(), after all driving inputs, so a fatal impact cannot recycle a body under game.take. */
  impact(e: number): void {
    const { world } = this.ctx, ents = world.ents, def = world.reg.vehicle[ents.kind[e]!];
    if (!def) return;
    if (!(vehicleStep.impactSpeed > 0 || vehicleStep.landSpeed > 0 || vehicleStep.rotorHit || vehicleStep.propHit || vehicleStep.water)) return;
    const pid = ents.pid[e]!, old = this.impacts.get(pid);
    this.impacts.set(pid, {
      speed: Math.max(old?.speed ?? 0, vehicleStep.impactSpeed), rotor: !!old?.rotor || vehicleStep.rotorHit, prop: !!old?.prop || vehicleStep.propHit,
      water: !!old?.water || vehicleStep.water, landing: Math.max(old?.landing ?? 0, vehicleStep.landSpeed),
    });
  }

  /** Persist refueling/repair immediately with the ordinary vehicle component. */
  changed(e: number): void {
    const pid = this.ctx.world.ents.pid[e]!, host = this.hosts.get(pid);
    if (host) { this.observeHealth(host); this.note(host); }
    this.save(e);
  }

  /** Authored/found initial condition is a baseline, not a new damaging blow. */
  initialized(e: number): void {
    const { world, records } = this.ctx, pid = world.ents.pid[e]!;
    this.health.set(pid, records.byPid.get(pid)?.vitals?.at(V_HEALTH, world.tick) ?? 0);
    this.changed(e);
  }

  /** A local recovery shove releases only the unoccupied car's parking brake for one second. */
  push(e: number, x: number, z: number): void {
    this.pushes.set(this.ctx.world.ents.pid[e]!, { until: this.ctx.world.tick + TICK_RATE, x, z });
  }

  /** Empty parked vehicles keep their place when a protected foreign tribe hits them. */
  parked(e: number): boolean {
    const { world } = this.ctx, a = world.ents, v = a.vrow[e]!;
    return !this.hasOccupants(e) && (a.flags[e]! & F_GROUNDED) !== 0 &&
      Math.hypot(a.vx[e]!, a.vy[e]!, a.vz[e]!) < .15 &&
      Math.hypot(a.vehicleYawRate[v]!, a.vehiclePitchRate[v]!, a.vehicleRollRate[v]!) < .12;
  }

  hasOccupants(e: number): boolean {
    const pid = this.ctx.world.ents.pid[e]!, host = this.hosts.get(pid);
    return !!host && this.occupied(pid, host);
  }

  boarding(actor: number, vehicle: number): boolean {
    const { world } = this.ctx, a = world.ents, pending = this.occupancy.pending(a.pid[actor]!);
    return !!pending && pending.kind !== 'exit' && pending.host === a.pid[vehicle] &&
      pending.actorHandle === makeHandle(actor, a.gen[actor]!) && pending.hostHandle === makeHandle(vehicle, a.gen[vehicle]!) &&
      pending.expiresAt >= world.tick;
  }

  /** The producer sends this before generic ram harm can kill the opposing creature. */
  collisionPair(pair: VehicleCollisionPair): void {
    if (!pair.fresh && !pair.hazardFreshA && !pair.hazardFreshB) return;
    const { world, records } = this.ctx, ents = world.ents;
    const a = this.collisionRecord(pair.a), b = this.collisionRecord(pair.b);
    if (!a || !b) return;
    const source = (party: VehicleCollisionParty, fallback: EntityRecord): EntityRecord | null => {
      if (!party.driverPid) return fallback;
      const driver = records.byPid.get(party.driverPid), e = records.entOf.get(party.driverPid);
      return driver && !driver.dead && e !== undefined && ents.resolve(party.driverHandle) === e &&
        ents.pid[e] === driver.pid ? driver : null;
    };
    const byA = source(pair.b, b), byB = source(pair.a, a);
    for (const [party, victim, by, protectedOther, rotorHit, propHit] of [
      [pair.a, a, byA, pair.protectedB, pair.rotorA && pair.hazardFreshA, pair.propellerA && pair.hazardFreshA],
      [pair.b, b, byB, pair.protectedA, pair.rotorB && pair.hazardFreshB, pair.propellerB && pair.hazardFreshB],
    ] as const) {
      if (!party.vehicle || !by || protectedOther) continue;
      const def = world.reg.vehicle[victim.kind]!;
      const speed = Math.max(0, party.deltaSpeed - (isBoatVehicle(def) ? 3 : 5));
      const damage = (pair.fresh ? speed * speed * (isWheelVehicle(def) ? .8 : 7) : 0) +
        (isRotorVehicle(def) && rotorHit ? 45 + speed * 8 : 0) + (isBoatVehicle(def) && propHit ? 20 + speed * 6 : 0);
      if (damage > 0) this.collisionCharges.push({ party, by, damage, rotor: rotorHit, propeller: propHit });
    }
  }

  private collisionRecord(party: VehicleCollisionParty): EntityRecord | null {
    const { world, records } = this.ctx, rec = records.byPid.get(party.pid);
    return rec && !rec.dead && world.ents.resolve(party.handle) === party.entity &&
      records.entOf.get(party.pid) === party.entity && world.ents.pid[party.entity] === party.pid ? rec : null;
  }

  private applyCollisionPairs(): void {
    const ents = this.ctx.world.ents;
    for (const { party, by, damage, rotor, propeller } of this.collisionCharges) {
      const victim = this.collisionRecord(party);
      if (!victim) continue;
      // Source identity was qualified at contact time, like a projectile's provenance. Its death cannot erase the hit.
      const taken = this.ctx.collisionDamage?.(victim, damage, by) ?? 0;
      if (!(taken > 0) || !this.collisionRecord(party)) continue;
      const v = ents.vrow[party.entity]!;
      ents.vehicleEngineCondition[v] = Math.fround(Math.max(0, ents.vehicleEngineCondition[v]! - taken / 7000));
      if (rotor) ents.vehicleRotorCondition[v] = Math.fround(Math.max(0, ents.vehicleRotorCondition[v]! - .2));
      if (propeller) ents.vehicleEngineCondition[v] = Math.fround(Math.max(0, ents.vehicleEngineCondition[v]! - .12));
      this.changed(party.entity);
    }
    this.collisionCharges.length = 0;
  }

  private observeHealth(host: HostSeat): void {
    const { world, records } = this.ctx, ents = world.ents, pid = ents.pid[host.entity]!, v = ents.vrow[host.entity]!;
    const rec = records.byPid.get(pid), hp = rec?.vitals?.at(V_HEALTH, world.tick) ?? 0;
    const before = this.health.get(pid), maximum = rec?.vitals?.max[V_HEALTH] ?? 1;
    if (before !== undefined && hp < before) {
      const lost = (before - hp) / Math.max(1, maximum);
      ents.vehicleEngineCondition[v] = Math.fround(Math.max(0, ents.vehicleEngineCondition[v]! - lost * .45));
      if (isRotorVehicle(host.definition)) ents.vehicleRotorCondition[v] = Math.fround(Math.max(0, ents.vehicleRotorCondition[v]! - lost * .2));
      else ents.vehicleHullCondition[v] = Math.fround(Math.max(0, ents.vehicleHullCondition[v]! - lost));
    }
    this.health.set(pid, hp);
  }

  private applyImpact(host: HostSeat): boolean {
    const { world, records } = this.ctx, ents = world.ents, e = host.entity, pid = ents.pid[e]!, v = ents.vrow[e]!;
    const report = this.impacts.get(pid);
    this.impacts.delete(pid);
    if (!report) return true;
    const rec = records.byPid.get(pid);
    if (!rec || rec.dead) return false;
    const boat = isBoatVehicle(host.definition), rotor = isRotorVehicle(host.definition);
    const speed = Math.max(0, report.speed - (boat ? 3 : 5), report.landing - (isWheelVehicle(host.definition) ? 12 : 6));
    const fresh = world.tick - (this.hurtAt.get(pid) ?? -1000) >= 12;
    let damage = fresh ? speed * speed * (isWheelVehicle(host.definition) ? .8 : 7) : 0;
    if (rotor && report.rotor && fresh && ents.vehicleRotorRpm[v]! > 30) {
      ents.vehicleRotorCondition[v] = Math.fround(Math.max(0, ents.vehicleRotorCondition[v]! - .2 - speed * .025));
      damage += 45 + speed * 8;
    }
    if (boat && report.prop && fresh) {
      ents.vehicleEngineCondition[v] = Math.fround(Math.max(0, ents.vehicleEngineCondition[v]! - .12 - speed * .025));
      damage += 20 + speed * 6;
    }
    if (rotor && report.water) {
      ents.vehicleEngineOn[v] = 0;
      ents.vehicleEngineCondition[v] = 0;
      if (fresh) damage += 110;
    }
    if (damage > 0) {
      this.hurtAt.set(pid, world.tick);
      ents.vehicleEngineCondition[v] = Math.fround(Math.max(0, ents.vehicleEngineCondition[v]! - damage / 7000));
      this.note(host);
      this.ctx.damage?.(rec, damage, this.riderOf(e)?.pid ?? 0);
      if (this.entity(pid) !== e) { this.evict(pid); return false; }
    }
    return true;
  }

  riding(c: Client): boolean { return this.occupancy.seatOf(c.pid) !== null; }
  riderOf(e: number): EntityRecord | null {
    const { world, records } = this.ctx, ents = world.ents, pid = ents.pid[e]!;
    const host = this.hosts.get(pid), control = this.occupancy.control(pid);
    if (!host || host.handle !== makeHandle(e, ents.gen[e]!) || !control?.actor) return null;
    const c = this.client(control.actor);
    if (c && (!c.active || c.closed || c.state !== SESSION_ALIVE || c.drive !== e || c.driveGen !== ents.gen[e])) return null;
    return records.byPid.get(control.actor) ?? null;
  }

  /** Existing use/mount dispatch calls this first. -1 means the target is not a vehicle. */
  mount(c: Client, target: number): number {
    const { world, records } = this.ctx, ents = world.ents;
    let e = target;
    if (!world.reg.vehicle[ents.kind[e]!] && ents.seat[e]! > 0) e = ents.seat[e]! - 1;
    if (!world.reg.vehicle[ents.kind[e]!]) return -1;
    if (c.ent < 0 || !c.active || c.closed || c.state !== SESSION_ALIVE || c.drive >= 0 ||
      ents.seat[c.ent] !== 0 || records.byPid.get(c.pid)?.out) return RESULT_DENIED;
    if (!this.register(e)) return RESULT_INVALID;
    const pid = ents.pid[e]!, host = this.hosts.get(pid)!;
    const state = this.state(e);
    if (isBoatVehicle(host.definition)) {
      const ladder = [0, 0, 0]; vehiclePoint(state, BOAT_ART.anchors.boarding_water, ladder);
      if (Math.hypot(ents.x[c.ent]! - ladder[0]!, ents.z[c.ent]! - ladder[2]!) > 2) return RESULT_FAR;
      if (!this.allowed(c.pid, pid, 0)) return RESULT_NOT_YOURS;
      // One ladder serves the whole crew. A second press must find a free passenger seat, not displace the pilot.
      for (const seat of host.definition.seats) {
        if (this.occupancy.occupant(pid, seat.id)) continue;
        const result = this.begin(c.pid, pid, seat.id, 'enter');
        if (result !== RESULT_BUSY) return result;
      }
      return RESULT_BUSY;
    }
    let nearest = host.definition.seats[0]!, best = Infinity;
    for (const seat of host.definition.seats) {
      const entry = [0, 0, 0]; vehiclePoint(state, seat.entry, entry);
      const d = Math.hypot(ents.x[c.ent]! - entry[0]!, ents.z[c.ent]! - entry[2]!);
      if (d < best) { best = d; nearest = seat; }
    }
    if (best > 2) return RESULT_FAR;
    const occupant = this.occupancy.occupant(pid, nearest.id);
    if (occupant && !nearest.driver) return RESULT_BUSY;
    // Refused before the door/landing sweeps, so a press on someone else's car costs nothing.
    if (!this.allowed(c.pid, pid, occupant)) return RESULT_NOT_YOURS;
    return this.begin(c.pid, pid, nearest.id, occupant ? 'carjack' : 'enter');
  }

  dismount(c: Client): void {
    for (const effect of this.occupancy.cancel(c.pid, this.ctx.world.tick)) this.apply(effect);
    const seat = this.occupancy.seatOf(c.pid);
    if (!seat) return;
    const result = this.begin(c.pid, seat.host, seat.seat, 'exit');
    if (result !== RESULT_OK) this.ctx.game.notify(c, result);
  }

  /**
   * Where a body of `radius` stands to take `seat`: at its door, outside the chassis for a survivor's capsule or a
   * civilian's, by the named door and seat anchors.
   */
  door(vehicle: number, seat: VehicleSeat, radius: number, out: number[]): void {
    const definition = this.ctx.world.reg.vehicle[this.ctx.world.ents.kind[vehicle]!]!, spec = definition.spec;
    const side = seat.entry[0] >= 0 ? 1 : -1;
    const state = this.state(vehicle);
    vehiclePoint(state, [side * Math.max(Math.abs(seat.entry[0]), spec.halfWidth + radius + 0.08), seat.entry[1], seat.entry[2]], out);
    if (isWheelVehicle(definition)) {
      // An upright survivor must also clear the downhill overhang of a rolled chassis, not just its floor edge.
      const q = [0, 0, 0, 1], right = [0, 0, 0], up = [0, 0, 0], forward = [0, 0, 0];
      vehicleRotation(state, q); quatRotate(q, 0, 1, 0, 0, right, 0); quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 0, 0, 1, forward, 0);
      const length = Math.hypot(right[0]!, right[2]!);
      if (length > .7 && up[1]! > .7) {
        const nx = side * right[0]! / length, nz = side * right[2]! / length;
        const extent = spec.halfWidth * length + spec.halfLength * Math.abs(forward[0]! * nx + forward[2]! * nz) + spec.height * Math.max(0, up[0]! * nx + up[2]! * nz);
        const extra = Math.max(0, extent + radius + .08 - ((out[0]! - state.x) * nx + (out[2]! - state.z) * nz));
        out[0] = out[0]! + nx * extra; out[2] = out[2]! + nz * extra;
        out[1] = out[1]! - (up[0]! * nx + up[2]! * nz) * extra / up[1]!;
      }
    }
  }

  /** For authored NPC setup/schedules: a real humanoid record takes a seat without a fake Client. */
  seatNpc(actor: number, vehicle: number, seat = 'driver'): number {
    const { world, records } = this.ctx, ents = world.ents;
    const rec = records.byPid.get(ents.pid[actor]!);
    const definition = world.reg.defs[ents.kind[actor]!];
    if (!rec || rec.keyHash !== null || definition?.type !== 'species' || definition.skeleton !== 'human' || !this.register(vehicle)) return RESULT_INVALID;
    return this.begin(rec.pid, ents.pid[vehicle]!, seat, 'enter');
  }

  /** Commits seat transitions before the real player-input loop can drive any body. */
  beforeStep(): void {
    const { world, game } = this.ctx, ents = world.ents;
    this.applyCollisionPairs();
    for (const [pid, host] of this.hosts) {
      // Destroyed, removed or recycled: nobody may stay seated in a slot that is no longer this car.
      if (this.entity(pid) !== host.entity || makeHandle(host.entity, ents.gen[host.entity]!) !== host.handle) { this.evict(pid); continue; }
      this.observeHealth(host);
    }
    for (const [pid] of this.scopes) {
      const rec = this.ctx.records.byPid.get(pid), e = this.entity(pid);
      if (!rec || rec.dead || e < 0) {
        for (const effect of this.occupancy.invalidateActor(pid, world.tick)) this.apply(effect);
        continue;
      }
      // One knocked out falls from a seat as a rider falls from a mount: it lies beside the car (server/riding.ts).
      if (rec.out) {
        for (const effect of this.occupancy.cancel(pid, world.tick, 'unconscious')) this.apply(effect);
        if (this.occupancy.seatOf(pid)) this.standDown(pid);
        continue;
      }
      const c = this.client(pid);
      if (c) this.scope(pid);
      const place = this.occupancy.seatOf(pid);
      if (place && !this.occupancy.pending(pid) && (c?.closed || !this.allowed(pid, place.host, 0))) {
        // Retry quietly while moving or obstructed; a revoked seat cannot generate
        // a refusal notification on every server tick.
        this.begin(pid, place.host, place.seat, 'exit');
      }
    }
    for (const effect of this.occupancy.step(world.tick)) this.apply(effect);
    // Scopes exist only while an actor is seated or has a pending action, so the table and the
    // per-tick work over it stay proportional to vehicle use, not to everyone who ever used one.
    for (const pid of [...this.scopes.keys()]) {
      if (!this.occupancy.idle(pid)) continue;
      const e = this.entity(pid);
      if (e >= 0 && (ents.flags[e]! & F_PLAYER) === 0 && ents.driven[e] === 3) ents.driven[e] = 0;
      this.occupancy.retireActor(pid, world.tick);
      this.scopes.delete(pid);
    }
    // Readiness can suspend control without removing a living occupant. Reconcile both
    // directions, so recovering from a bola/knockout does not strand a valid driver.
    for (const c of game.clients) {
      if (!c) continue;
      const place = this.occupancy.seatOf(c.pid), host = place ? this.hosts.get(place.host) : undefined;
      const control = host ? this.occupancy.control(place!.host) : null;
      const ready = c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0 && control?.actor === c.pid;
      if (c.drive >= 0 && world.reg.vehicle[ents.kind[c.drive]!] && (!ready || c.drive !== host?.entity || c.driveGen !== ents.gen[c.drive])) game.release(c);
      if (ready && c.drive < 0 && host) game.take(c, host.entity);
    }
    for (const host of this.hosts.values()) if (makeHandle(host.entity, ents.gen[host.entity]!) === host.handle) this.contacts?.capture(host.entity);
  }

  /** After player bodies move, before combat/history. Unpiloted cars brake and creature AI
   * is suppressed while vehicle/seat authority owns those real entities.
   */
  step(): void {
    const { world, game } = this.ctx, ents = world.ents;
    // A scheduled civilian performing a seat action stays at its validated door.
    // Existing creature AI resumes if the action cancels or the occupant is displaced.
    for (const pid of this.scopes.keys()) {
      const e = this.entity(pid);
      if (e < 0 || (ents.flags[e]! & F_PLAYER) !== 0) continue;
      if (this.occupancy.pending(pid) || this.occupancy.seatOf(pid)) {
        ents.driven[e] = 3;
        if (!this.occupancy.seatOf(pid)) ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      } else if (ents.driven[e] === 3) ents.driven[e] = 0;
    }
    this.opening.clear();
    for (const actor of this.scopes.keys()) {
      const action = this.occupancy.pending(actor), host = action ? this.hosts.get(action.host) : undefined;
      const door = host?.definition.seats.find(seat => seat.id === action!.seat)?.door;
      if (door !== undefined) this.opening.set(action!.host, (this.opening.get(action!.host) ?? 0) | (1 << door));
    }
    this.drivers.clear();
    for (const c of game.clients) {
      if (!c?.active) continue;
      if (c.drive >= 0) this.drivers.add(c.drive);
      const cargoDoor = c.open ? this.hosts.get(c.open)?.definition.cargoDoor : undefined;
      if (cargoDoor !== undefined) this.opening.set(c.open, (this.opening.get(c.open) ?? 0) | (1 << cargoDoor));
    }
    for (const [pid, host] of this.hosts) {
      const e = this.entity(pid);
      if (e !== host.entity || makeHandle(e, ents.gen[e]!) !== host.handle) continue;
      // A car nobody drives stops on its handbrake, and once at rest is looked at again only once a REST_TICKS, each on
      // its own tick of them, to see whether the ground under it went.
      const driven = this.drivers.has(e);
      const push = this.pushes.get(pid);
      // Catch the car on its brake as the shove dies out, before gravity rolls it back downhill.
      const pushed = push && world.tick < push.until && ents.vx[e]! * push.x + ents.vz[e]! * push.z > .12 && !this.occupied(pid, host);
      if (!pushed) this.pushes.delete(pid);
      if (!driven && (!this.resting(e) || (world.tick + e) % REST_TICKS === 0)) {
        ents.loadBody(e, this.body);
        stepVehicleBody(world, this.body, 0, 0, isWheelVehicle(host.definition) && !pushed ? BTN_JUMP : 0, host.definition, TICK_DT, this.body.yaw, false);
        ents.storeBody(e, this.body);
        this.impact(e);
        ents.pose(e, world.tick);
      } else if (!driven && ents.vehicleDoors[ents.vrow[e]!] === 0 && !this.opening.has(pid) && !this.occupied(pid, host) && !this.impacts.has(pid)) continue;
      if (!this.applyImpact(host)) continue;
      this.note(host);
      this.save(e);
      // A seat's door swings open while someone is getting in or out by it, and shut after.
      const opening = this.opening.get(pid) ?? 0;
      let doors = ents.vehicleDoors[ents.vrow[e]!]!;
      host.definition.doors.forEach((door, d) => {
        const was = vehicleDoor(doors, d);
        doors = withVehicleDoor(doors, d, (opening & (1 << d)) !== 0 ? Math.min(1, was + 1 / door.openTicks) : Math.max(0, was - 1 / door.closeTicks));
      });
      ents.vehicleDoors[ents.vrow[e]!] = doors;
      for (let slot = 0; slot < host.definition.seats.length; slot++) {
        const seat = host.definition.seats[slot]!, actor = this.occupancy.occupant(pid, seat.id);
        const ae = this.entity(actor);
        if (!actor || ae < 0 || makeHandle(ae, ents.gen[ae]!) !== this.occupancy.occupantHandle(pid, seat.id)) continue;
        ents.setSeat(ae, e, slot + 1);
        if ((ents.flags[ae]! & F_PLAYER) === 0) ents.driven[ae] = 3;
        this.pin(ae, e, seat.anchor, !!seat.driver);
      }
    }
  }

  private entity(pid: number): number { return this.seating.entity(pid); }
  private client(pid: number): Client | null { return this.ctx.game.clients.find(c => c?.pid === pid && c.ent >= 0) ?? null; }
  private scope(pid: number): Scope {
    const connection = this.client(pid)?.conn ?? null;
    let scope = this.scopes.get(pid);
    // Epochs come from one process-wide counter, so a retired and re-created scope never reuses one.
    if (!scope) {
      scope = { epoch: ++this.epochs, request: 1, connection };
      this.scopes.set(pid, scope);
      for (const effect of this.occupancy.bindActor(pid, scope.epoch, this.ctx.world.tick)) this.apply(effect);
    } else if (scope.connection !== connection) {
      scope.connection = connection; scope.epoch = ++this.epochs; scope.request = 1;
      for (const effect of this.occupancy.bindActor(pid, scope.epoch, this.ctx.world.tick)) this.apply(effect);
    }
    return scope;
  }
  private begin(actor: number, host: number, seat: string, kind: 'enter' | 'exit' | 'carjack'): number {
    const scope = this.scope(actor);
    const ticks = this.hosts.get(host)?.definition.actionTicks ?? 1;
    const result = this.occupancy.begin({ actor, actorEpoch: scope.epoch, requestId: scope.request++, host, seat, kind }, this.ctx.world.tick, ticks);
    if (result.ok) return RESULT_OK;
    if (result.reason === 'too-far') return RESULT_FAR;
    if (result.reason === 'not-yours') return RESULT_NOT_YOURS;
    if (result.reason === 'claimed' || result.reason === 'occupied' || result.reason === 'victim-claimed') return RESULT_BUSY;
    if (result.reason.includes('blocked') || result.reason === 'landing-required') return RESULT_OBSTRUCTED;
    return RESULT_DENIED;
  }
  private state(e: number): VehicleState & { qx?: number; qy?: number; qz?: number; qw?: number } {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!;
    return { qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!, x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
      vx: ents.vx[e]!, vy: ents.vy[e]!, vz: ents.vz[e]!, grounded: (ents.flags[e]! & F_GROUNDED) !== 0, yawRate: ents.vehicleYawRate[v]!, pitchRate: ents.vehiclePitchRate[v]!, rollRate: ents.vehicleRollRate[v]!, groundPitch: ents.vehicleGroundPitch[v]!, groundRoll: ents.vehicleGroundRoll[v]!, rideOffset: ents.vehicleRideOffset[v]!, rideVelocity: ents.vehicleRideVelocity[v]!, steering: ents.steering[v]!, wheelAngle: ents.wheelAngle[v]!, fuel: ents.fuel[v]!, gear: ents.vehicleGear[v]!, engineRpm: ents.vehicleRpm[v]!, shiftTime: ents.vehicleShiftTime[v]!, payloadMass: ents.vehiclePayloadMass[v]! };
  }
  private check(action: Readonly<OccupancyAction>): OccupancyApproval {
    const { world, game } = this.ctx, ents = world.ents;
    const host = this.hosts.get(action.host), ae = this.entity(action.actor);
    if (!host || ae < 0) return { ok: false, reason: 'missing' };
    const seat = host.definition.seats.find(s => s.id === action.seat);
    if (!seat) return { ok: false, reason: 'missing-seat' };
    const actorClient = this.client(action.actor);
    if (action.kind !== 'exit' && actorClient && (actorClient.drive >= 0 || actorClient.state !== SESSION_ALIVE || actorClient.closed)) return { ok: false, reason: 'actor-busy' };
    // Re-checked at commit: a tribe change during the door action still refuses it.
    if (action.kind !== 'exit' && !this.allowed(action.actor, action.host, action.victim)) return { ok: false, reason: 'not-yours' };
    if (seat.driver && action.kind !== 'exit') {
      const driver = game.clients.find(c => c?.drive === host.entity);
      if (driver && driver.pid !== action.victim) return { ok: false, reason: 'driver-changed' };
    }
    const state = this.state(host.entity), out = [0, 0, 0];
    if (isBoatVehicle(host.definition)) return this.boatAction(action, host, ae);
    const rolledCar = isWheelVehicle(host.definition) && 1 - 2 * ((state.qx ?? 0) ** 2 + (state.qz ?? 0) ** 2) < .7;
    if (action.kind === 'exit' && (rolledCar || state.y + host.definition.spec.clearance < world.hf.waterAt(state.x, state.z))) return this.vehicleEscape(action, host, ae);
    // Ordinary door actions are grounded. Forced loss of a seat uses standDown/evict and inherits aircraft velocity.
    if (isRotorVehicle(host.definition) && !state.grounded) return { ok: false, reason: 'airborne' };
    const move = world.reg.move[ents.kind[ae]!]!;
    this.door(host.entity, seat, move.radius, out);
    // Resolve the posed floor against nearby walkable support, including city slabs. A blocked upper capsule
    // rejects the step, and every resulting segment is swept below; a wall or ceiling cannot become a new route.
    const supported = (p: Point): Point | null => {
      const low = p.y - move.stepDown, ground = groundUnder(world.hf, p.x, p.z, move.radius);
      if (ground > p.y + move.stepUp) return null;
      let high = Math.max(p.y, ground);
      const wasFree = capsuleFree(world, p.x, high, p.z, move.radius, move.height);
      if (!wasFree) {
        high += move.stepUp;
        if (!capsuleFree(world, p.x, high, p.z, move.radius, move.height)) return null;
      }
      const on = stepOnto(world, p.x, p.z, low, high, move.radius, move.height, move.slopeCos);
      if (!wasFree && Number.isNaN(on)) return null;
      return { x: p.x, y: Number.isNaN(on) ? high : on, z: p.z };
    };
    const entry = supported({ x: out[0]!, y: out[1]!, z: out[2]! });
    if (!entry) return { ok: false, reason: 'door-blocked' };
    const ignored = action.victim ? [action.actor, action.victim] : [action.actor];
    const start = { x: ents.x[ae]!, y: ents.y[ae]!, z: ents.z[ae]! };
    if (action.kind === 'exit') {
      vehiclePoint(state, [seat.anchor[0], 0, seat.anchor[2]], out);
      const floor = supported({ x: out[0]!, y: out[1]!, z: out[2]! });
      if (!floor) return { ok: false, reason: 'seat-blocked' };
      start.x = floor.x; start.y = floor.y; start.z = floor.z;
    }
    // Within reach of the door: 2 m across the ground, and no more than a step above or below it.
    if (action.kind !== 'exit' && (Math.hypot(start.x - entry.x, start.z - entry.z) > 2 || Math.abs(start.y - entry.y) > 1.2)) return { ok: false, reason: 'too-far' };
    const seating = this.seating;
    const corridor = (from: Point, to: Point, actor: number, ignoredHost = 0): boolean => {
      const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / .1));
      if (n > 64) return false;
      let previous = from;
      for (let i = 1; i <= n; i++) {
        const next = supported({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n, z: from.z + (to.z - from.z) * i / n });
        if (!next || !seating.corridor(previous, next, actor, ignored, ignoredHost)) return false;
        previous = next;
      }
      return true;
    };
    if (!seating.free(entry, action.actor, ignored)) return { ok: false, reason: 'door-blocked' };
    if (!corridor(start, entry, action.actor, action.kind === 'exit' ? action.host : 0)) return { ok: false, reason: 'corridor-blocked' };
    vehiclePoint(state, [seat.anchor[0], 0, seat.anchor[2]], out);
    if (!corridor(entry, { x: out[0]!, y: out[1]!, z: out[2]! }, action.actor, action.host)) return { ok: false, reason: 'seat-blocked' };
    if (action.kind === 'enter') return { ok: true };
    const landed = action.victim || action.actor;
    for (const offset of [0, 0.8, -0.8, 1.4, -1.4]) {
      vehiclePoint(state, [seat.entry[0] + (seat.entry[0] >= 0 ? 1.1 : -1.1), 0, seat.entry[2] + offset], out);
      const landing = supported({ x: out[0]!, y: out[1]!, z: out[2]! });
      if (landing && seating.free(landing, landed, [landed]) && corridor(entry, landing, landed, action.host)) return { ok: true, landing: { ...landing, yaw: state.yaw } };
    }
    return { ok: false, reason: 'landing-blocked' };
  }

  /** The stern ladder has one reachable water approach for all four seats. Terrain still wins in shallow water. */
  private boatPoint(e: number, host: HostSeat, local: readonly number[]): Point {
    const { world } = this.ctx, ents = world.ents, move = world.reg.move[ents.kind[e]!]!, out = [0, 0, 0];
    vehiclePoint(this.state(host.entity), local, out);
    const ground = groundUnder(world.hf, out[0]!, out[2]!, move.radius), water = world.hf.waterAt(out[0]!, out[2]!);
    return { x: out[0]!, y: Math.max(ground, Number.isFinite(water) ? water - move.height * .75 : out[1]!), z: out[2]! };
  }

  private boatAction(action: Readonly<OccupancyAction>, host: HostSeat, ae: number): OccupancyApproval {
    const { world } = this.ctx, ents = world.ents, state = this.state(host.entity);
    const tilted = Math.abs(state.pitch) > .35 || Math.abs(state.roll) > .45 ||
      1 - 2 * ((state.qx ?? 0) ** 2 + (state.qz ?? 0) ** 2) < .7;
    const flooded = ents.vehicleFlooding[ents.vrow[host.entity]!]! >= .5;
    // An overturned or sinking open boat must not hold its crew underwater until the hull dies.
    // The ordinary action still commits against a fresh, bounded route and a clear exterior landing.
    if (action.kind === 'exit' && (tilted || flooded)) return this.boatEscape(action, host, ae);
    if (Math.hypot(state.vx, state.vy, state.vz) > .55 || Math.hypot(state.yawRate, state.pitchRate, state.rollRate) > .2 ||
      tilted || flooded) return { ok: false, reason: 'boat-moving' };
    const seat = host.definition.seats.find(s => s.id === action.seat)!;
    const entry = this.boatPoint(ae, host, BOAT_ART.anchors.boarding_water), point = [0, 0, 0];
    const at = (anchor: readonly number[]): Point => { vehiclePoint(state, anchor, point); return { x: point[0]!, y: point[1]!, z: point[2]! }; };
    const ladder = at(BOAT_ART.anchors.boarding_ladder), deck = at(BOAT_ART.anchors.boarding_deck);
    const occupied = host.definition.seats.map(s => this.occupancy.occupant(action.host, s.id));
    const ignored = [action.actor, ...occupied];
    const start = { x: ents.x[ae]!, y: ents.y[ae]!, z: ents.z[ae]! };
    const move = world.reg.move[ents.kind[ae]!]!;
    const dock = action.kind !== 'exit' && (ents.flags[ae]! & F_GROUNDED) !== 0 && ents.mode[ae] !== MODE_SWIM &&
      start.y >= world.hf.waterAt(start.x, start.z) - .05 &&
      this.seating.free(start, action.actor, ignored) && !capsuleFree(world, start.x, start.y - .08, start.z, move.radius, move.height);
    if (action.kind !== 'exit' && (Math.hypot(start.x - entry.x, start.z - entry.z) > 2 || Math.abs(start.y - (dock ? ladder.y : entry.y)) > 1.3)) return { ok: false, reason: 'too-far' };
    if (dock) {
      // Walk clear of the dock edge at its own height, then step onto the physical ladder. Routing a dry actor
      // through the swimming foot position would first ask them to descend through the dock's floor.
      const approach = { ...ladder, y: Math.max(start.y, ladder.y) };
      if (!this.seating.corridor(start, approach, action.actor, ignored, action.host) ||
        !this.seating.corridor(approach, ladder, action.actor, ignored, action.host)) return { ok: false, reason: 'corridor-blocked' };
    } else {
      if (!this.seating.free(entry, action.actor, ignored)) return { ok: false, reason: 'ladder-blocked' };
      if (action.kind !== 'exit' && !this.seating.corridor(start, entry, action.actor, ignored)) return { ok: false, reason: 'corridor-blocked' };
      if (!this.seating.corridor(entry, ladder, action.actor, ignored, action.host)) return { ok: false, reason: 'ladder-blocked' };
    }
    const seatFoot = at([seat.anchor[0], BOAT_ART.deck.height, seat.anchor[2]]);
    if (!this.seating.corridor(ladder, deck, action.actor, ignored, action.host) ||
      !this.seating.corridor(deck, seatFoot, action.actor, ignored, action.host)) return { ok: false, reason: 'ladder-blocked' };
    if (action.kind === 'enter') return { ok: true };
    const landed = action.victim || action.actor;
    for (const offset of [0, .8, -.8, 1.4, -1.4]) {
      const anchor = BOAT_ART.anchors.boarding_water;
      const landing = this.boatPoint(ae, host, [anchor[0] + offset, anchor[1], anchor[2] - .25]);
      if (this.seating.free(landing, landed, [landed]) && this.seating.corridor(entry, landing, landed, ignored, action.host)) return { ok: true, landing: { ...landing, yaw: state.yaw } };
    }
    return { ok: false, reason: 'landing-blocked' };
  }

  /** A ditched or rolled crew leaves through a freshly checked local route, retaining its current depth/height. */
  private vehicleEscape(action: Readonly<OccupancyAction>, host: HostSeat, ae: number): OccupancyApproval {
    if (isBoatVehicle(host.definition)) return { ok: false, reason: 'missing' };
    const { world } = this.ctx, ents = world.ents, state = this.state(host.entity), spec = host.definition.spec;
    const move = world.reg.move[ents.kind[ae]!]!, seat = host.definition.seats.find(s => s.id === action.seat)!;
    const ignored = [action.actor, ...host.definition.seats.map(s => this.occupancy.occupant(action.host, s.id))];
    // Seated animation origins may sit just below the ground when the hull rests on its belly.
    // Begin the exit at local standing support; every horizontal sample still checks terrain and overhead solids.
    const start = { x: ents.x[ae]!, y: Math.max(ents.y[ae]!, groundUnder(world.hf, ents.x[ae]!, ents.z[ae]!, move.radius) + .05), z: ents.z[ae]! }, out = [0, 0, 0];
    const w = spec.halfWidth + move.radius + .3, l = spec.halfLength + move.radius + .3;
    for (const local of [[w, 0, seat.anchor[2]], [-w, 0, seat.anchor[2]], [w, 0, 0], [-w, 0, 0], [w, 0, l], [-w, 0, l], [w, 0, -l], [-w, 0, -l]]) {
      vehiclePoint(state, local, out);
      const ground = groundUnder(world.hf, out[0]!, out[2]!, move.radius), water = world.hf.waterAt(out[0]!, out[2]!);
      // Never lift a deeply submerged crew to the surface. The corridor also bounds distance and checks overhead solids.
      const wet = Number.isFinite(water) && state.y + spec.clearance < water;
      const landing = { x: out[0]!, y: Math.max(ground + .05, wet ? Math.min(start.y, water - move.height * .75) : start.y), z: out[2]! };
      const meets = isRotorVehicle(host.definition) ? helicopterMeetsCapsule(host.definition, state, landing.x, landing.y, landing.z, move.radius, move.height)
        : carMeetsCapsule(host.definition.spec, state, landing.x, landing.y, landing.z, move.radius, move.height);
      if (!this.seating.free(landing, action.actor, ignored, action.host) || meets ||
        !this.seating.corridor(start, landing, action.actor, ignored, action.host)) continue;
      return { ok: true, landing: { ...landing, yaw: state.yaw } };
    }
    return { ok: false, reason: 'landing-blocked' };
  }

  private boatEscape(action: Readonly<OccupancyAction>, host: HostSeat, ae: number): OccupancyApproval {
    if (!isBoatVehicle(host.definition)) return { ok: false, reason: 'missing' };
    const { world } = this.ctx, ents = world.ents, state = this.state(host.entity), spec = host.definition.spec;
    const move = world.reg.move[ents.kind[ae]!]!, seat = host.definition.seats.find(s => s.id === action.seat)!;
    const ignored = [action.actor, ...host.definition.seats.map(s => this.occupancy.occupant(action.host, s.id))];
    const start = { x: ents.x[ae]!, y: ents.y[ae]!, z: ents.z[ae]! };
    const w = spec.halfWidth + move.radius + .2, l = spec.halfLength + move.radius + .4;
    const spots = [[w, 0, seat.anchor[2]], [-w, 0, seat.anchor[2]], [0, spec.height + move.radius + .2, seat.anchor[2]],
      [w, 0, 0], [-w, 0, 0], [w, 0, l], [-w, 0, l], [w, 0, -l], [-w, 0, -l]]
      .map(local => this.boatPoint(ae, host, local))
      .sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y, a.z - start.z) - Math.hypot(b.x - start.x, b.y - start.y, b.z - start.z));
    for (const landing of spots) {
      const water = world.hf.waterAt(landing.x, landing.z);
      if (!Number.isFinite(water) || water - groundUnder(world.hf, landing.x, landing.z, move.radius) < move.height * .25) continue;
      // Seating's ordinary chassis envelope is upright. Check this tilted boat's actual hull and steered motor instead.
      if (!this.seating.free(landing, action.actor, ignored, action.host) ||
        boatMeetsCapsule(host.definition, state, landing.x, landing.y, landing.z, move.radius, move.height) ||
        !this.seating.corridor(start, landing, action.actor, ignored, action.host)) continue;
      return { ok: true, landing: { ...landing, yaw: state.yaw } };
    }
    return { ok: false, reason: 'landing-blocked' };
  }

  private apply(effect: OccupancyEffect): void {
    const { world, game, records } = this.ctx, ents = world.ents;
    if (effect.type === 'cancel') {
      const c = this.client(effect.action.actor);
      if (c && !c.closed) game.sendText(c, TEXT_NOTICE, 'Vehicle action cancelled: ' + effect.reason);
      return;
    }
    if (effect.type === 'detach') {
      const c = this.client(effect.actor);
      if (c) game.release(c);
      const e = this.entity(effect.actor);
      if (e >= 0 && makeHandle(e, ents.gen[e]!) === effect.actorHandle) { ents.setSeat(e, -1); ents.driven[e] = 0; }
      const host = this.hosts.get(effect.host), rec = records.byPid.get(effect.host);
      if (host && rec && host.handle === effect.hostHandle && makeHandle(host.entity, ents.gen[host.entity]!) === host.handle) this.ctx.refresh(rec);
      return;
    }
    const action = effect.action, host = this.hosts.get(action.host)!;
    const removed = action.kind === 'exit' ? action.actor : action.victim;
    if (removed) {
      const c = this.client(removed);
      if (c) { game.release(c); c.ownDirty = true; }
      const e = this.entity(removed), expected = action.kind === 'exit' ? action.actorHandle : action.victimHandle;
      if (e >= 0 && makeHandle(e, ents.gen[e]!) === expected && effect.landing) {
        ents.setSeat(e, -1); ents.driven[e] = 0; ents.stance[e] = STANCE_STAND;
        ents.setPosition(e, effect.landing.x, effect.landing.y, effect.landing.z);
        world.history.discontinuity(e);
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
        if (isBoatVehicle(host.definition) || effect.landing.y + world.reg.move[ents.kind[e]!]!.height * .75 < world.hf.waterAt(effect.landing.x, effect.landing.z) + .01) {
          const inherit = (v: number): number => Number.isFinite(v) ? v : 0;
          ents.vx[e] = inherit(ents.vx[host.entity]!); ents.vy[e] = inherit(ents.vy[host.entity]!); ents.vz[e] = inherit(ents.vz[host.entity]!);
          this.waterExit(e);
        }
        ents.pose(e, world.tick);
        records.dirty.add(removed);
        if (action.victim) this.ctx.creatures.provoke(e, effect.landing.x - 1, effect.landing.z, this.entity(action.actor));
      }
    }
    if (action.kind !== 'exit') {
      const e = this.entity(action.actor), c = this.client(action.actor);
      const slot = host.definition.seats.findIndex(s => s.id === action.seat);
      const seat = host.definition.seats[slot]!;
      // Never throw inside the tick: a refused takeover leaves the actor seated without control,
      // and the ordinary use button still exits.
      if (c && seat.driver && !game.take(c, host.entity)) console.error(`vehicle ${action.host}: validated takeover by ${action.actor} was refused`);
      ents.setSeat(e, host.entity, slot + 1); ents.stance[e] = STANCE_CROUCH;
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      if (!c) ents.driven[e] = 3;
      if (c) { c.open = 0; c.ownDirty = true; }
      this.pin(e, host.entity, seat.anchor, !!seat.driver);
    }
    if (action.kind === 'carjack') {
      this.incidents.push({ action: action.id, tick: world.tick, offender: action.actor, victim: action.victim, vehicle: action.host });
      if (this.incidents.length > 32) this.incidents.shift();
      const c = this.client(action.actor);
      if (c) game.sendText(c, TEXT_NOTICE, 'Vehicle taken. Its inventory and legal owner are unchanged.');
    }
    const rec = records.byPid.get(action.host);
    if (rec) { records.dirty.add(rec.pid); this.ctx.refresh(rec); }
  }
  private save(e: number): void {
    const { world, records } = this.ctx, ents = world.ents;
    const rec = records.byPid.get(ents.pid[e]!);
    if (!rec) return;
    const { version, extra } = formOf(world.reg.vehicle[rec.kind]?.movement);
    const bytes = this.saving.subarray(0, BASE_BYTES + extra.length * 4 + 1), view = this.savingView;
    bytes[0] = version;
    const b = this.saved;
    ents.loadBody(e, b);
    for (let i = 0; i < VEHICLE_FIELDS.length; i++) view.setFloat32(1 + i * 4, b[VEHICLE_FIELDS[i]!], true);
    bytes[BASE_BYTES - 1] = b.grounded ? 1 : 0;
    if (extra.length) {
      for (let i = 0; i < extra.length; i++) view.setFloat32(BASE_BYTES + i * 4, b[extra[i]!], true);
      bytes[bytes.length - 1] = b.vehicleEngineOn ? 1 : 0;
    }
    const old = rec.extra.get(VEHICLE_COMPONENT);
    if (old?.length === bytes.length && bytes.every((v, i) => old[i] === v)) return;
    rec.extra.set(VEHICLE_COMPONENT, bytes.slice()); records.dirty.add(rec.pid);
  }

  /** A car on its wheels that has stopped: no speed, and its springs and turn as good as settled. */
  private resting(e: number): boolean {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!, still = (n: number): boolean => Math.abs(n) < 1e-3;
    if (this.ctx.world.reg.vehicle[ents.kind[e]!]?.movement === 'rotor' && (ents.vehicleEngineOn[v] !== 0 || ents.vehicleRotorRpm[v]! > 0)) return false;
    return (ents.flags[e]! & F_GROUNDED) !== 0 && ents.vx[e] === 0 && ents.vz[e] === 0 && still(ents.vy[e]!) &&
      still(ents.vehicleYawRate[v]!) && still(ents.vehiclePitchRate[v]!) && still(ents.vehicleRollRate[v]!) && still(ents.vehicleRideVelocity[v]!);
  }

  /** Whether anyone sits in the vehicle: an asleep car with nobody in it and its doors shut has nothing to do this tick. */
  private occupied(pid: number, host: HostSeat): boolean {
    for (const seat of host.definition.seats) if (this.occupancy.occupant(pid, seat.id) !== 0) return true;
    return false;
  }

  /** Posed head before vital deadlines, independent of the last time the occupant's proxy body was pinned. */
  eye(actor: number, out: Float64Array): boolean {
    const { world } = this.ctx, ents = world.ents, vehicle = ents.seat[actor]! - 1;
    if (vehicle < 0 || ents.seatGen[actor] !== ents.gen[vehicle]) return false;
    const pid = ents.pid[vehicle]!, host = this.hosts.get(pid), seat = host?.definition.seats[ents.seatSlot[actor]! - 1];
    if (!host || !seat || this.entity(pid) !== vehicle || host.handle !== makeHandle(vehicle, ents.gen[vehicle]!)) return false;
    if (this.occupancy.occupant(pid, seat.id) !== ents.pid[actor] || this.occupancy.occupantHandle(pid, seat.id) !== makeHandle(actor, ents.gen[actor]!)) return false;
    this.poseOn(actor, vehicle, seat.anchor, !!seat.driver);
    boneToModel(this.solved, SOCKET_EYE.bone, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, out);
    quatRotate(this.seatRotation, 0, out[0]!, out[1]!, out[2]!, out, 0);
    out[0] += this.seatOrigin[0]!; out[1] += this.seatOrigin[1]!; out[2] += this.seatOrigin[2]!;
    return true;
  }

  /** Same role, controls, body proportions, pelvis alignment and chassis attitude as the drawn occupant. */
  private poseOn(actor: number, vehicle: number, anchor: readonly [number, number, number], driver: boolean): VehicleState & { qx?: number; qy?: number; qz?: number; qw?: number } {
    const { world } = this.ctx, ents = world.ents;
    const state = this.state(vehicle), seat = this.seatAt, rotation = this.seatRotation, origin = this.seatOrigin;
    vehiclePoint(state, anchor, seat); vehicleRotation(state, rotation);
    const def = world.reg.vehicle[ents.kind[vehicle]!]!, seatDefinition = def.seats.find(s => s.anchor === anchor), profile = seatDefinition?.pose;
    mountPose(this.motion, { role: profile ?? (driver ? 'drive' : 'passenger'), tick: world.tick, startTick: 0, durationTicks: 1, steering: isRotorVehicle(def) ? 0 : state.steering / def.spec.maxSteer }, this.pose);
    const look = ents.looks.get(actor) ?? this.ctx.records.byPid.get(ents.pid[actor]!)?.look ?? PLAIN;
    const definition = world.reg.defs[ents.kind[actor]!];
    const mesh = definition?.type === 'species' ? definition.mesh.replace(/^[^:]*:/, '') : 'human';
    const rest = this.rests.get(mesh + '_' + SEX_IDS[look[LOOK_SEX]!]) ?? HUMAN.rest;
    lookScales(look, this.scales);
    solve(HUMAN, this.pose, this.solved, rest, this.scales);
    if (seatDefinition) fitSeatControls(this.pose, this.solved, rest, this.scales, seatDefinition, state.steering);
    mountOrigin(this.solved, seat, rotation, origin);
    return state;
  }

  private pin(actor: number, vehicle: number, anchor: readonly [number, number, number], driver: boolean): void {
    const { world } = this.ctx, ents = world.ents, def = world.reg.vehicle[ents.kind[vehicle]!]!;
    const state = this.poseOn(actor, vehicle, anchor, driver), seat = this.seatAt, rotation = this.seatRotation, origin = this.seatOrigin;
    ents.loadBody(actor, this.body);
    this.body.x = origin[0]!; this.body.y = origin[1]!; this.body.z = origin[2]!;
    const client = this.client(ents.pid[actor]!);
    if (!isWheelVehicle(def)) {
      // The cabin owns the seated body's orientation; yaw/pitch carry the occupant's world gaze.
      if (client) { this.body.yaw = client.heldYaw; ents.pitch[actor] = client.heldPitch; }
      else {
        quatRotate(rotation, 0, 0, 0, 1, seat, 0);
        this.body.yaw = Math.round(detAtan2(seat[0]!, seat[2]!) * 65536 / TAU) & 65535;
        ents.pitch[actor] = Math.round(detAtan2(seat[1]!, Math.sqrt(seat[0]! * seat[0]! + seat[2]! * seat[2]!)) * 65536 / TAU);
      }
    } else if (driver || !client) this.body.yaw = ents.yaw[vehicle]!;
    vehiclePointVelocity(state, def.spec, this.body.x, this.body.y, this.body.z, origin);
    this.body.vx = origin[0]!; this.body.vy = origin[1]!; this.body.vz = origin[2]!;
    this.body.stance = STANCE_CROUCH;
    ents.storeBody(actor, this.body);
    ents.pose(actor, world.tick);
  }
}
