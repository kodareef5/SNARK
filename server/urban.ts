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
import { TAU } from '../shared/math/scalar.ts';
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_OBSTRUCTED, RESULT_OK, SESSION_ALIVE, TEXT_NOTICE } from '../shared/net/protocol.ts';
import { BTN_JUMP, Body, STANCE_CROUCH, STANCE_STAND } from '../shared/sim/character.ts';
import { F_ALIVE, F_GROUNDED, F_PLAYER } from '../shared/sim/entities.ts';
import { stepVehicleBody, packVehicleDoors, unpackVehicleDoorLeft, unpackVehicleDoorRight } from '../shared/sim/vehicle-body.ts';
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
}
interface HostSeat { entity: number; handle: number; definition: VehicleDefinition }
interface Scope { epoch: number; request: number; connection: Connection | null }
interface Point { x: number; y: number; z: number }
export interface UrbanIncident { action: number; tick: number; offender: number; victim: number; vehicle: number }
const ACTION_TICKS = 18;
/** Namespaced extension, preserved by the normal record codec even in builds without vehicles. */
const VEHICLE_COMPONENT = 0x757262;
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
        return e < 0 || !rec ? null : { handle: makeHandle(e, ctx.world.ents.gen[e]!), alive: !rec.dead, ready: !rec.out };
      },
      host: pid => {
        const host = this.hosts.get(pid), e = host?.entity ?? -1;
        const valid = host && this.entity(pid) === e && makeHandle(e, ctx.world.ents.gen[e]!) === host.handle;
        return valid ? { handle: host.handle, ready: !ctx.records.byPid.get(pid)?.dead,
          speed: Math.hypot(ctx.world.ents.vx[e]!, ctx.world.ents.vz[e]!) } : null;
      },
      check: action => this.check(action),
      canControl: (actor, host) => this.entity(actor) >= 0 && this.hosts.has(host),
    }, { runtimeEpoch: 1 });
  }

  register(e: number): boolean {
    const { world } = this.ctx, ents = world.ents;
    const definition = world.reg.vehicle[ents.kind[e]!];
    if (!definition || (ents.flags[e]! & F_ALIVE) === 0) return false;
    const pid = ents.pid[e]!;
    if (this.hosts.has(pid)) return true;
    const handle = makeHandle(e, ents.gen[e]!);
    this.occupancy.addHost(pid, handle, definition.seats);
    this.hosts.set(pid, { entity: e, handle, definition });
    ents.loadBody(e, this.body);
    if (!this.body.vehicle) {
      this.body.vehicle = true;
      this.body.vehicleYaw = this.body.yaw * TAU / 65536;
      this.body.vehiclePitch = this.body.vehicleRoll = this.body.steering = this.body.wheelAngle = 0;
      this.body.fuel = definition.spec.fuelCapacity;
      this.body.vehicleRpm = definition.spec.drivetrain?.idleRpm ?? 0;
      const saved = this.ctx.records.byPid.get(pid)?.extra.get(VEHICLE_COMPONENT);
      if (saved) {
        const count = saved[0] === 1 ? 6 : saved[0] === 2 ? 13 : saved[0] === 3 ? 16 : saved[0] === 4 ? VEHICLE_FIELDS.length : 0;
        if (!count || saved.length !== 1 + count * 4 + (saved[0]! >= 3 ? 1 : 0)) throw new Error('Unsupported saved vehicle component');
        const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength);
        const values = Array.from({ length: count }, (_, i) => view.getFloat32(1 + i * 4, true));
        if (!values.every(Number.isFinite) || values[5]! < 0 || values[5]! > definition.spec.fuelCapacity) throw new Error('Invalid saved vehicle state');
        for (let i = 0; i < count; i++) this.body[VEHICLE_FIELDS[i]!] = values[i]!;
        if (saved[0] === 1) { this.body.vehicleGroundPitch = this.body.vehiclePitch; this.body.vehicleGroundRoll = this.body.vehicleRoll; }
        if (saved[0]! >= 3) {
          const grounded = saved[saved.length - 1]!;
          if (grounded > 1) throw new Error('Invalid saved vehicle contact state');
          this.body.grounded = grounded === 1;
        } else {
          // Earlier components stored a parked pose without translational velocity.
          this.body.vehicleYawRate = this.body.vehiclePitchRate = this.body.vehicleRollRate = this.body.vehicleRideVelocity = 0;
        }
        if (saved[0] === 4 && (!Number.isInteger(this.body.vehicleGear) || this.body.vehicleGear < -1 || this.body.vehicleGear > (definition.spec.drivetrain?.forwardRatios.length ?? 12) || this.body.vehicleRpm < 0 || this.body.vehicleRpm > 32767 || this.body.vehicleShiftTime < 0 || this.body.vehicleShiftTime > 60 || this.body.vehiclePayloadMass < 0 || this.body.vehiclePayloadMass > 1e6)) throw new Error('Invalid saved drivetrain state');
        this.body.yaw = Math.round(this.body.vehicleYaw * 65536 / TAU) & 65535;
      }
      ents.storeBody(e, this.body);
    }
    ents.vehiclePayloadMass[e] = Math.fround(this.payloadMass(e));
    world.history.track(e);
    this.save(e);
    return true;
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
    for (const seat of host.definition.seats) {
      const pid = this.occupancy.occupant(ents.pid[e]!, seat.id), actor = this.entity(pid);
      if (actor >= 0 && makeHandle(actor, ents.gen[actor]!) === this.occupancy.occupantHandle(ents.pid[e]!, seat.id)) this.pin(actor, e, seat.anchor, !!seat.driver);
    }
    ents.pose(e, world.tick); this.save(e);
  }

  riding(c: Client): boolean { return this.occupancy.seatOf(c.pid) !== null; }
  riderOf(e: number): EntityRecord | null {
    const pid = this.ctx.world.ents.pid[e]!;
    const driver = this.hosts.get(pid)?.definition.seats.find(seat => seat.driver);
    const actor = driver ? this.occupancy.occupant(pid, driver.id) : 0;
    return this.ctx.records.byPid.get(actor) ?? null;
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
    for (const host of this.hosts.values()) {
      if (makeHandle(host.entity, ents.gen[host.entity]!) === host.handle && ents.driven[host.entity] === 2) ents.driven[host.entity] = 0;
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
      if (c?.closed && this.occupancy.seatOf(pid) && !this.occupancy.pending(pid)) this.dismount(c);
    }
    for (const effect of this.occupancy.step(world.tick)) this.apply(effect);
    for (const host of this.hosts.values()) if (makeHandle(host.entity, ents.gen[host.entity]!) === host.handle) this.contacts?.capture(host.entity);
    // A driver released by death/disconnect stops owning movement even if a seat is retained for a blocked exit.
    for (const c of game.clients) {
      if (!c || c.drive < 0 || !world.reg.vehicle[ents.kind[c.drive]!]) continue;
      const control = this.occupancy.control(ents.pid[c.drive]!);
      if (control?.actor !== c.pid) game.release(c);
    }
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
      this.save(e);
      let left = false, right = false;
      for (const actor of this.scopes.keys()) {
        const action = this.occupancy.pending(actor);
        if (action?.host !== pid) continue;
        const entry = host.definition.seats.find(seat => seat.id === action.seat)?.entry;
        if (entry && entry[0] >= 0) left = true; else if (entry) right = true;
      }
      const doors = ents.vehicleDoors[e]!;
      const moveDoor = (v: number, opened: boolean): number => opened ? Math.min(1, v + 1 / 6) : Math.max(0, v - 1 / 10);
      ents.vehicleDoors[e] = packVehicleDoors(moveDoor(unpackVehicleDoorLeft(doors), left), moveDoor(unpackVehicleDoorRight(doors), right));
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
    if (!scope) {
      scope = { epoch: 1, request: 1, connection };
      this.scopes.set(pid, scope);
      for (const effect of this.occupancy.bindActor(pid, scope.epoch, this.ctx.world.tick)) this.apply(effect);
    } else if (scope.connection !== connection) {
      scope.connection = connection; scope.epoch++; scope.request = 1;
      for (const effect of this.occupancy.bindActor(pid, scope.epoch, this.ctx.world.tick)) this.apply(effect);
    }
    return scope;
  }
  private begin(actor: number, host: number, seat: string, kind: 'enter' | 'exit' | 'carjack'): number {
    const scope = this.scope(actor);
    const result = this.occupancy.begin({ actor, actorEpoch: scope.epoch, requestId: scope.request++, host, seat, kind }, this.ctx.world.tick, ACTION_TICKS);
    if (result.ok) return RESULT_OK;
    if (result.reason === 'too-far') return RESULT_FAR;
    if (result.reason === 'claimed' || result.reason === 'occupied' || result.reason === 'victim-claimed') return RESULT_BUSY;
    if (result.reason.includes('blocked') || result.reason === 'landing-required') return RESULT_OBSTRUCTED;
    return RESULT_DENIED;
  }
  private state(e: number): VehicleState {
    const ents = this.ctx.world.ents;
    return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[e]!, pitch: ents.vehiclePitch[e]!, roll: ents.vehicleRoll[e]!,
      vx: ents.vx[e]!, vy: ents.vy[e]!, vz: ents.vz[e]!, grounded: (ents.flags[e]! & F_GROUNDED) !== 0, yawRate: ents.vehicleYawRate[e]!, pitchRate: ents.vehiclePitchRate[e]!, rollRate: ents.vehicleRollRate[e]!, groundPitch: ents.vehicleGroundPitch[e]!, groundRoll: ents.vehicleGroundRoll[e]!, rideOffset: ents.vehicleRideOffset[e]!, rideVelocity: ents.vehicleRideVelocity[e]!, steering: ents.steering[e]!, wheelAngle: ents.wheelAngle[e]!, fuel: ents.fuel[e]!, gear: ents.vehicleGear[e]!, engineRpm: ents.vehicleRpm[e]!, shiftTime: ents.vehicleShiftTime[e]!, payloadMass: ents.vehiclePayloadMass[e]! };
  }
  private free(p: Point, actor: number, ignored: readonly number[], ignoredHost = 0): boolean {
    const { world } = this.ctx, ents = world.ents;
    const ae = this.entity(actor), move = ae >= 0 ? world.reg.move[ents.kind[ae]!] : null;
    if (!move || !capsuleFree(world, p.x, p.y, p.z, move.radius, move.height)) return false;
    // Seat corridors may cross their own chassis, never another live body or car.
    for (const [pid, e] of this.ctx.records.entOf) {
      if (ignored.includes(pid) || pid === ignoredHost || (ents.flags[e]! & F_ALIVE) === 0) continue;
      if (p.y >= ents.y[e]! + world.reg.bodyHeight[ents.kind[e]!]! || p.y + move.height <= ents.y[e]!) continue;
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
  private corridor(a: Point, b: Point, actor: number, ignored: readonly number[], ignoredHost = 0): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
    if (n > 64) return false;
    for (let i = 0; i <= n; i++) if (!this.free({ x: a.x + (b.x - a.x) * i / n,
      y: a.y + (b.y - a.y) * i / n, z: a.z + (b.z - a.z) * i / n }, actor, ignored, ignoredHost)) return false;
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
      if (c && seat.driver && !game.take(c, host.entity)) throw new Error('Validated vehicle takeover failed');
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
    mountPose(this.motion, { role: driver ? 'drive' : 'passenger', tick: world.tick, startTick: 0, durationTicks: 1, steering: state.steering }, this.pose);
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
