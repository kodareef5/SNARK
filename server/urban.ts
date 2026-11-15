// Vehicle seats in the normal game world. The surviving actor, its record, inventory,
// team and connection stay the same; only the body its inputs drive changes.
import { Pose } from '../shared/anim/clip.ts';
import { HUMAN, HUMAN_BONES } from '../shared/anim/human.ts';
import { defaultLook, lookScales, LOOK_SEX, SEX_IDS } from '../shared/anim/look.ts';
import type { PackRig } from '../shared/pack/pack.ts';
import { createMountMotion, mountOrigin, mountPose } from '../shared/anim/mount.ts';
import { Solved, solve } from '../shared/anim/skeleton.ts';
import { TICK_DT } from '../shared/coords.ts';
import { makeHandle } from '../shared/ids.ts';
import { detAtan2, detCos, detSin, TAU } from '../shared/math/scalar.ts';
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK, SESSION_ALIVE, TEXT_NOTICE } from '../shared/net/protocol.ts';
import { BTN_JUMP, Body, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceHeight } from '../shared/sim/character.ts';
import { F_ALIVE, F_GROUNDED, F_PLAYER } from '../shared/sim/entities.ts';
import { stepVehicleBody, vehicleDoor, withVehicleDoor } from '../shared/sim/vehicle-body.ts';
import { vehiclePoint, vehicleRotation } from '../shared/sim/vehicle-frame.ts';
import type { VehicleDefinition, VehicleState } from '../shared/sim/vehicle.ts';
import { capsuleFree, groundUnder } from '../shared/world/collide.ts';
import type { Connection } from '../shared/net/transport.ts';
import type { Items } from './items.ts';
import type { VehicleContacts } from './vehicle-contacts.ts';
import type { Creatures } from './creatures.ts';
import type { Client, GameServer } from './game.ts';
import { Occupancy, type OccupancyAction, type OccupancyApproval, type OccupancyEffect } from './occupancy.ts';
import type { EntityRecord, Records } from './records.ts';
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
}
interface HostSeat { entity: number; handle: number; definition: VehicleDefinition; last: Point }
interface Scope { epoch: number; request: number; connection: Connection | null }
interface Point { x: number; y: number; z: number }
export interface UrbanIncident { action: number; tick: number; offender: number; victim: number; vehicle: number }
/** Seat tables are pruned as hosts disappear and actors go idle; these only bound a pathological world. */
const MAX_HOSTS = 1 << 16;
const MAX_ACTORS = 1 << 16;
/** Namespaced extension, preserved by the normal record codec even in builds without vehicles. */
const VEHICLE_COMPONENT = 0x757262;
/** One preserved unreadable component, bounded by the record codec's ordinary part limit. */
const VEHICLE_QUARANTINE = 0x757263;
const VEHICLE_FIELDS = ["vehicleYaw", "vehiclePitch", "vehicleRoll", "steering", "wheelAngle", "fuel", "vehicleYawRate", "vehiclePitchRate", "vehicleRollRate", "vehicleGroundPitch", "vehicleGroundRoll", "vehicleRideOffset", "vehicleRideVelocity", "vx", "vy", "vz", "vehicleGear", "vehicleRpm", "vehicleShiftTime", "vehiclePayloadMass"] as const;
const PLAIN = defaultLook();

export class Urban {
  readonly occupancy: Occupancy;
  contacts: VehicleContacts | null = null;
  /** Bounded live incident feed; production save components are a separate follow-up. */
  readonly incidents: UrbanIncident[] = [];
  private readonly ctx: UrbanContext;
  private readonly hosts = new Map<number, HostSeat>();
  private readonly scopes = new Map<number, Scope>();
  private readonly preserveComponent = new Set<number>();
  /** Per host this tick, a bit for each door someone is getting in or out by. */
  private readonly opening = new Map<number, number>();
  private epochs = 0;
  private readonly body = new Body();
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly solved = new Solved(HUMAN_BONES);
  private readonly motion = createMountMotion();
  private readonly scales = new Float32Array(HUMAN_BONES * 3);
  private readonly rests = new Map<string, Float32Array>();

  constructor(ctx: UrbanContext) {
    this.ctx = ctx;
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
    this.hosts.set(pid, { entity: e, handle, definition, last: { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]! } });
    ents.loadBody(e, this.body);
    if (!this.body.vehicle) {
      this.body.vehicle = true;
      for (const field of VEHICLE_FIELDS) this.body[field] = 0;
      this.body.vehicleYaw = this.body.yaw * TAU / 65536;
      this.body.grounded = true;
      this.body.fuel = definition.spec.fuelCapacity;
      this.body.vehicleRpm = definition.spec.drivetrain?.idleRpm ?? 0;
      const saved = this.ctx.records.byPid.get(pid)?.extra.get(VEHICLE_COMPONENT);
      if (saved) this.restoreSaved(pid, saved, definition);
      ents.storeBody(e, this.body);
    }
    ents.vehiclePayloadMass[e] = Math.fround(this.payloadMass(e));
    this.note(this.hosts.get(pid)!);
    world.history.track(e);
    this.save(e);
    return true;
  }

  /** Reads a saved component into `this.body`. A save from another build or a retuned
   * definition must never stop the world loading: unreadable components keep the parked
   * defaults, and readable ones are clamped to the current definition.
   */
  private restoreSaved(pid: number, saved: Uint8Array, definition: VehicleDefinition): void {
    const b = this.body, version = saved[0]!;
    const count = version === 1 ? 6 : version === 2 ? 13 : version === 3 ? 16 : version === 4 ? VEHICLE_FIELDS.length : 0;
    if (!count || saved.length !== 1 + count * 4 + (version >= 3 ? 1 : 0)) {
      this.quarantine(pid, saved, `version ${version} (${saved.length} bytes)`);
      return;
    }
    const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength);
    const values = Array.from({ length: count }, (_, i) => view.getFloat32(1 + i * 4, true));
    if (!values.every(Number.isFinite) || (version >= 3 && saved[saved.length - 1]! > 1)) {
      this.quarantine(pid, saved, 'invalid numeric or contact state');
      return;
    }
    for (let i = 0; i < count; i++) b[VEHICLE_FIELDS[i]!] = values[i]!;
    if (version === 1) { b.vehicleGroundPitch = b.vehiclePitch; b.vehicleGroundRoll = b.vehicleRoll; }
    if (version >= 3) b.grounded = saved[saved.length - 1]! !== 0;
    // Earlier components stored a parked pose without translational velocity.
    else b.vehicleYawRate = b.vehiclePitchRate = b.vehicleRollRate = b.vehicleRideVelocity = 0;
    const clampTo = (v: number, lo: number, hi: number): number => Math.fround(Math.min(hi, Math.max(lo, v)));
    const train = definition.spec.drivetrain;
    const spec = definition.spec, travel = spec.suspensionTravel ?? 0.18;
    const grade = detAtan2(Math.sqrt(1 - spec.minGroundNormal * spec.minGroundNormal), spec.minGroundNormal);
    const wrapped = (v: number): number => { const a = v % TAU; return Math.fround(a - Math.floor((a + TAU / 2) / TAU) * TAU); };
    b.vehicleYaw = wrapped(b.vehicleYaw); b.wheelAngle = wrapped(b.wheelAngle);
    b.vehiclePitch = clampTo(b.vehiclePitch, -grade - 0.35, grade + 0.35);
    b.vehicleRoll = clampTo(b.vehicleRoll, -grade - 0.35, grade + 0.35);
    b.vehicleGroundPitch = clampTo(b.vehicleGroundPitch, -grade, grade);
    b.vehicleGroundRoll = clampTo(b.vehicleGroundRoll, -grade, grade);
    b.steering = clampTo(b.steering, -spec.maxSteer, spec.maxSteer);
    b.vehicleYawRate = clampTo(b.vehicleYawRate, -3, 3);
    b.vehiclePitchRate = clampTo(b.vehiclePitchRate, -12, 12);
    b.vehicleRollRate = clampTo(b.vehicleRollRate, -12, 12);
    b.vehicleRideOffset = clampTo(b.vehicleRideOffset, -Math.min(travel * 0.65, spec.clearance * 0.65), travel);
    b.vehicleRideVelocity = clampTo(b.vehicleRideVelocity, -60, 60);
    const speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz), limit = Math.max(spec.maxForward, spec.maxReverse);
    if (speed > limit) { b.vx = Math.fround(b.vx * limit / speed); b.vz = Math.fround(b.vz * limit / speed); }
    b.vy = clampTo(b.vy, -60, 60);
    b.fuel = clampTo(b.fuel, 0, definition.spec.fuelCapacity);
    if (version === 4) {
      b.vehicleGear = Math.round(clampTo(b.vehicleGear, -1, train?.forwardRatios.length ?? 12));
      b.vehicleRpm = clampTo(b.vehicleRpm, 0, train?.redlineRpm ?? 32767);
      b.vehicleShiftTime = clampTo(b.vehicleShiftTime, 0, train?.shiftCooldown ?? 1);
      // Payload is recomputed from records right after loading.
      b.vehiclePayloadMass = 0;
    }
    b.yaw = Math.round(b.vehicleYaw * 65536 / TAU) & 65535;
  }

  private quarantine(pid: number, saved: Uint8Array, reason: string): void {
    const rec = this.ctx.records.byPid.get(pid);
    if (!rec) return;
    const old = rec.extra.get(VEHICLE_QUARANTINE);
    if (!old) rec.extra.set(VEHICLE_QUARANTINE, saved);
    else if (old.length !== saved.length || !old.every((n, i) => saved[i] === n)) this.preserveComponent.add(pid);
    // If a second different unreadable component arrives, keep both existing blobs;
    // this incarnation runs parked defaults without replacing the current component.
    console.warn(`vehicle ${pid}: preserved unreadable ${reason}; using parked defaults${this.preserveComponent.has(pid) ? ' without saving mechanical updates' : ''}`);
    this.ctx.records.dirty.add(pid);
  }

  private note(host: HostSeat): void {
    const ents = this.ctx.world.ents, e = host.entity;
    host.last.x = ents.x[e]!; host.last.z = ents.z[e]!;
    host.last.y = ents.y[e]! - ((ents.flags[e]! & F_GROUNDED) !== 0 ? ents.vehicleRideOffset[e]! : 0);
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
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
      ents.pose(e, world.tick);
      records.dirty.add(effect.actor);
      const c = this.client(effect.actor);
      if (c) c.ownDirty = true;
    }
    this.hosts.delete(pid);
    this.preserveComponent.delete(pid);
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
        if (!this.free(point, actor, [actor], 0, height) || !this.corridor(origin, point, actor, [actor], 0, height)) continue;
        ents.setPosition(e, point.x, point.y, point.z); ents.stance[e] = stance;
        return;
      }
    }
    // Do not invent a teleport through a wall if geometry changed around the car.
    // Keep the smaller seated capsule; ordinary obstruction recovery can retry later.
    ents.stance[e] = STANCE_CROUCH;
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
    for (const [pid, host] of this.hosts) {
      // Destroyed, removed or recycled: nobody may stay seated in a slot that is no longer this car.
      if (this.entity(pid) !== host.entity || makeHandle(host.entity, ents.gen[host.entity]!) !== host.handle) { this.evict(pid); continue; }
      if (ents.driven[host.entity] === 2) ents.driven[host.entity] = 0;
    }
    for (const [pid] of this.scopes) {
      const rec = this.ctx.records.byPid.get(pid), e = this.entity(pid);
      if (!rec || rec.dead || e < 0) {
        for (const effect of this.occupancy.invalidateActor(pid, world.tick)) this.apply(effect);
        continue;
      }
      if (rec.out) for (const effect of this.occupancy.cancel(pid, world.tick, 'unconscious')) this.apply(effect);
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
    for (const [pid, host] of this.hosts) {
      const e = this.entity(pid);
      if (e !== host.entity || makeHandle(e, ents.gen[e]!) !== host.handle) continue;
      const client = game.clients.find(c => c?.active && c.drive === e);
      if (!client) {
        ents.loadBody(e, this.body);
        stepVehicleBody(world, this.body, 0, 0, BTN_JUMP, host.definition, TICK_DT);
        ents.storeBody(e, this.body);
        ents.pose(e, world.tick);
        ents.driven[e] = 2; // Reserved only between ticks; beforeStep clears this before game.take.
      }
      this.note(host);
      this.save(e);
      // A seat's door swings open while someone is getting in or out by it, and shut after.
      const opening = this.opening.get(pid) ?? 0;
      let doors = ents.vehicleDoors[e]!;
      host.definition.doors.forEach((door, d) => {
        const was = vehicleDoor(doors, d);
        doors = withVehicleDoor(doors, d, (opening & (1 << d)) !== 0 ? Math.min(1, was + 1 / door.openTicks) : Math.max(0, was - 1 / door.closeTicks));
      });
      ents.vehicleDoors[e] = doors;
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

  private entity(pid: number): number {
    const e = this.ctx.records.entOf.get(pid), ents = this.ctx.world.ents;
    return e !== undefined && ents.pid[e] === pid && (ents.flags[e]! & F_ALIVE) !== 0 ? e : -1;
  }
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
  private state(e: number): VehicleState {
    const ents = this.ctx.world.ents;
    return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[e]!, pitch: ents.vehiclePitch[e]!, roll: ents.vehicleRoll[e]!,
      vx: ents.vx[e]!, vy: ents.vy[e]!, vz: ents.vz[e]!, grounded: (ents.flags[e]! & F_GROUNDED) !== 0, yawRate: ents.vehicleYawRate[e]!, pitchRate: ents.vehiclePitchRate[e]!, rollRate: ents.vehicleRollRate[e]!, groundPitch: ents.vehicleGroundPitch[e]!, groundRoll: ents.vehicleGroundRoll[e]!, rideOffset: ents.vehicleRideOffset[e]!, rideVelocity: ents.vehicleRideVelocity[e]!, steering: ents.steering[e]!, wheelAngle: ents.wheelAngle[e]!, fuel: ents.fuel[e]!, gear: ents.vehicleGear[e]!, engineRpm: ents.vehicleRpm[e]!, shiftTime: ents.vehicleShiftTime[e]!, payloadMass: ents.vehiclePayloadMass[e]! };
  }
  private free(p: Point, actor: number, ignored: readonly number[], ignoredHost = 0, height?: number): boolean {
    const { world } = this.ctx, ents = world.ents;
    const ae = this.entity(actor), move = ae >= 0 ? world.reg.move[ents.kind[ae]!] : null;
    if (!move || !capsuleFree(world, p.x, p.y, p.z, move.radius, height ?? move.height)) return false;
    // Seat corridors may cross their own chassis, never another live body or car.
    for (const [pid, e] of this.ctx.records.entOf) {
      if (ignored.includes(pid) || pid === ignoredHost || (ents.flags[e]! & F_ALIVE) === 0) continue;
      if (p.y >= ents.y[e]! + world.reg.bodyHeight[ents.kind[e]!]! || p.y + (height ?? move.height) <= ents.y[e]!) continue;
      const vehicle = world.reg.vehicle[ents.kind[e]!];
      const dx = p.x - ents.x[e]!, dz = p.z - ents.z[e]!;
      if (vehicle) {
        const a = ents.vehicleYaw[e]!, co = Math.cos(a), sn = Math.sin(a);
        const x = Math.max(0, Math.abs(co * dx - sn * dz) - vehicle.spec.halfWidth);
        const z = Math.max(0, Math.abs(sn * dx + co * dz) - vehicle.spec.halfLength);
        if (x * x + z * z < move.radius * move.radius) return false;
      } else if (dx * dx + dz * dz < (move.radius + world.reg.bodyRadius[ents.kind[e]!]!) ** 2) return false;
    }
    return true;
  }
  private corridor(a: Point, b: Point, actor: number, ignored: readonly number[], ignoredHost = 0, height?: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
    if (n > 64) return false;
    for (let i = 0; i <= n; i++) if (!this.free({ x: a.x + (b.x - a.x) * i / n,
      y: a.y + (b.y - a.y) * i / n, z: a.z + (b.z - a.z) * i / n }, actor, ignored, ignoredHost, height)) return false;
    return true;
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
    const move = world.reg.move[ents.kind[ae]!]!;
    const side = seat.entry[0] >= 0 ? 1 : -1;
    // Current survivor and civilian capsules differ: keep the standing approach outside
    // the chassis for either body, while retaining the named visual door/seat anchors.
    const approachX = side * Math.max(Math.abs(seat.entry[0]), host.definition.spec.halfWidth + move.radius + 0.08);
    vehiclePoint(state, [approachX, seat.entry[1], seat.entry[2]], out);
    const entry = { x: out[0]!, y: Math.max(state.y, groundUnder(world.hf, out[0]!, out[2]!, move.radius)), z: out[2]! };
    const ignored = action.victim ? [action.actor, action.victim] : [action.actor];
    const start = { x: ents.x[ae]!, y: action.kind === 'exit' ? entry.y : ents.y[ae]!, z: ents.z[ae]! };
    if (action.kind !== 'exit' && Math.hypot(start.x - entry.x, start.z - entry.z) > 2) return { ok: false, reason: 'too-far' };
    if (!this.free(entry, action.actor, ignored)) return { ok: false, reason: 'door-blocked' };
    if (!this.corridor(start, entry, action.actor, ignored, action.kind === 'exit' ? action.host : 0)) return { ok: false, reason: 'corridor-blocked' };
    vehiclePoint(state, seat.anchor, out);
    if (!this.corridor(entry, { x: out[0]!, y: entry.y, z: out[2]! }, action.actor, ignored, action.host)) return { ok: false, reason: 'seat-blocked' };
    if (action.kind === 'enter') return { ok: true };
    const landed = action.victim || action.actor;
    for (const offset of [0, 0.8, -0.8, 1.4, -1.4]) {
      vehiclePoint(state, [seat.entry[0] + (seat.entry[0] >= 0 ? 1.1 : -1.1), 0, seat.entry[2] + offset], out);
      const landing = { x: out[0]!, y: Math.max(state.y, groundUnder(world.hf, out[0]!, out[2]!, move.radius)), z: out[2]!, yaw: state.yaw };
      if (this.free(landing, landed, [landed]) && this.corridor(entry, landing, landed, ignored, action.host)) return { ok: true, landing };
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
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
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
    if (!rec || this.preserveComponent.has(rec.pid)) return;
    const bytes = new Uint8Array(2 + VEHICLE_FIELDS.length * 4), view = new DataView(bytes.buffer);
    bytes[0] = 4;
    const values = VEHICLE_FIELDS.map(field => ents[field][e]!);
    for (let i = 0; i < values.length; i++) view.setFloat32(1 + i * 4, values[i]!, true);
    bytes[bytes.length - 1] = (ents.flags[e]! & F_GROUNDED) !== 0 ? 1 : 0;
    const old = rec.extra.get(VEHICLE_COMPONENT);
    if (old?.length === bytes.length && bytes.every((v, i) => old[i] === v)) return;
    rec.extra.set(VEHICLE_COMPONENT, bytes); records.dirty.add(rec.pid);
  }
  private pin(actor: number, vehicle: number, anchor: readonly [number, number, number], driver: boolean): void {
    const { world } = this.ctx, ents = world.ents;
    const state = this.state(vehicle), seat = [0, 0, 0], rotation = [0, 0, 0, 1], origin = [0, 0, 0];
    vehiclePoint(state, anchor, seat); vehicleRotation(state, rotation);
    const spec = world.reg.vehicle[ents.kind[vehicle]!]!.spec;
    mountPose(this.motion, { role: driver ? 'drive' : 'passenger', tick: world.tick, startTick: 0, durationTicks: 1, steering: state.steering / spec.maxSteer }, this.pose);
    const look = ents.look[actor] ?? this.ctx.records.byPid.get(ents.pid[actor]!)?.look ?? PLAIN;
    const definition = world.reg.defs[ents.kind[actor]!];
    const mesh = definition?.type === 'species' ? definition.mesh.replace(/^[^:]*:/, '') : 'human';
    const rest = this.rests.get(mesh + '_' + SEX_IDS[look[LOOK_SEX]!]) ?? HUMAN.rest;
    lookScales(look, this.scales);
    solve(HUMAN, this.pose, this.solved, rest, this.scales);
    mountOrigin(this.solved, seat, rotation, origin);
    ents.loadBody(actor, this.body);
    this.body.x = origin[0]!; this.body.y = origin[1]!; this.body.z = origin[2]!;
    if (driver || !this.client(ents.pid[actor]!)) this.body.yaw = ents.yaw[vehicle]!;
    this.body.vx = state.vx; this.body.vy = state.vy; this.body.vz = state.vz;
    this.body.stance = STANCE_CROUCH;
    ents.storeBody(actor, this.body);
    ents.pose(actor, world.tick);
  }
}
