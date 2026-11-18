// Authoritative moving-vehicle contacts. Inputs select controls; only the server's
// completed body sweeps can select a victim or submit damage to native Combat.
import type { CorpseImpact } from '../shared/anim/corpse.ts';
import { ZONE_NONE } from '../shared/anim/human.ts';
import { CHUNK_SIZE, TICK_DT } from '../shared/coords.ts';
import { makeHandle } from '../shared/ids.ts';
import { MAX_CONTACT_PROXIES, contactBody, contactRelevant, contactHorizon, contactReach, publicContactBody, type ContactSnapshot } from '../shared/net/contact.ts';
import { clamp, len3, TAU } from '../shared/math/scalar.ts';
import { youngScale } from '../shared/sim/breeding.ts';
import { Body, MODE_GHOST, MODE_NONE, stanceHeight } from '../shared/sim/character.ts';
import { DMG_MELEE } from '../shared/sim/damage.ts';
import { F_ALIVE, F_GROUNDED, F_HELD, F_PROP } from '../shared/sim/entities.ts';
import { isBoatVehicle, isRotorVehicle, type VehicleDefinition } from '../shared/sim/vehicle.ts';
import { vehicleMassProperties } from '../shared/sim/vehicle-rigid.ts';
import { dynamicState, DynamicScratch, resolveDynamicContact, type DynamicBody, type DynamicContact, type DynamicResult, type DynamicState } from '../shared/sim/vehicle-dynamic.ts';
import { vehicleSolidRadius } from '../shared/world/vehicle-shapes.ts';
import type { Combat, Source } from './combat.ts';
import { CAPSULE_EXTENT, VehiclePairQueries } from '../shared/world/vehicle-pair.ts';
import { Past } from './history.ts';
import type { EntityRecord, Records } from './records.ts';
import type { ServerWorld } from './world.ts';

export interface VehicleCollisionParty {
  entity: number; handle: number; pid: number; vehicle: boolean; driverPid: number; driverHandle: number; mass: number; deltaSpeed: number;
}
/** One physical event, normal A to B. Consumer applies policy to both sides; handle order carries no blame. */
export interface VehicleCollisionPair {
  tick: number; a: VehicleCollisionParty; b: VehicleCollisionParty;
  x: number; y: number; z: number; nx: number; ny: number; nz: number;
  signedClosingSpeed: number; impulse: number; fresh: boolean; protectedA: boolean; protectedB: boolean;
  rotorA: boolean; rotorB: boolean; propellerA: boolean; propellerB: boolean;
  hazardFreshA: boolean; hazardFreshB: boolean;
}
export interface VehicleContactsContext {
  world: ServerWorld;
  records: Records;
  combat: Combat;
  driverOf(vehicle: number): EntityRecord | null;
  /** Native occupancy may approve an entrant's path through only its own host during enter/carjack. */
  boarding?(actor: number, vehicle: number): boolean;
  /** Only an empty, parked protected foreign vehicle is anchored against an unauthorized opposing actor. */
  anchored?(vehicle: number, opposing: EntityRecord): boolean;
  pair?(event: VehicleCollisionPair): void;
}
interface Frame { body: Body; handle: number; pid: number; tick: number; motionEpoch: number; consumed: boolean; by: number; byHandle: number }
interface Touch { seen: number; hazardFirst: number; hazardSecond: number }
interface Contact extends DynamicContact { entity: number; handle: number; pid: number; rotor: boolean; propeller: boolean; otherRotor: boolean; otherPropeller: boolean; hazardSpeed: number; mass: number }
const MIN_HARM_SPEED = 2.5;
const REARM_TICKS = 15;
const contact = (): Contact => ({ entity: -1, handle: 0, pid: 0, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, depth: 0, rotor: false, propeller: false, otherRotor: false, otherPropeller: false, hazardSpeed: 0, mass: 1 });

export class VehicleContacts {
  private readonly ctx: VehicleContactsContext;
  private readonly frames = new Map<number, Frame>();
  private readonly touches = new Map<number, Map<number, Touch>>();
  private pairCount = 0;
  private readonly past = new Past();
  private readonly candidates: number[] = [];
  private readonly ordered: number[] = [];
  private readonly changed: number[] = [];
  private readonly a: DynamicBody = { prior: dynamicState(), state: dynamicState(), spec: null, mass: 1, response: 'dynamic' };
  private readonly b: DynamicBody = { prior: dynamicState(), state: dynamicState(), spec: null, mass: 1, response: 'dynamic' };
  private readonly scratch = new DynamicScratch();
  private readonly result: DynamicResult = { signedClosingSpeed: 0, pointSpeedA: 0, pointSpeedB: 0, impulse: 0, deltaSpeedA: 0, deltaSpeedB: 0, unresolved: false };
  private readonly hit = contact();
  private readonly first = contact();
  private readonly queries: VehiclePairQueries;
  private readonly snapshotBody = new Body();
  private readonly publicBody = new Body();
  private defA!: VehicleDefinition;
  private defB: VehicleDefinition | undefined;
  private radiusB = 0;
  private heightB = 0;
  private readonly restingPadding: number;
  private targetPadding = 0;
  /** Diagnostics, not replicated gameplay state. */
  contacts = 0;

  constructor(ctx: VehicleContactsContext) {
    this.ctx = ctx;
    this.queries = new VehiclePairQueries(ctx.world);
    // stepBody splits motion into at most 16 half-radius pieces. This includes a
    // body's previous chunk even when it crosses the whole vehicle in one tick.
    let reach = 0;
    for (const [kind, p] of ctx.world.reg.move.entries()) if (p) {
      const def = ctx.world.reg.vehicle[kind];
      reach = Math.max(reach, def ? vehicleSolidRadius(def) : p.radius * (8 + CAPSULE_EXTENT) + .05);
    }
    this.restingPadding = this.targetPadding = reach;
  }

  /** Current authority facts for a driver's nearby contact candidates; view clocks and damage do not enter prediction. */
  proxies(car: number, out: ContactSnapshot): void {
    const { world, records, combat } = this.ctx, ents = world.ents;
    out.tick = world.tick; out.count = 0; out.truncated = false;
    const def = world.reg.vehicle[ents.kind[car]!], vehicle = records.byPid.get(ents.pid[car]!);
    if (!def || !vehicle) return;
    out.owner = makeHandle(car, ents.gen[car]!); out.epoch = world.history.motionEpoch(car);
    ents.loadBody(car, this.snapshotBody);
    const by = this.ctx.driverOf(car);
    this.gather(car, this.snapshotBody, def, 14 + Math.min(60, len3(ents.vx[car]!, 0, ents.vz[car]!) * 1.5));
    // The nearest predicted approach gets the limited wire budget first, including bodies crossing the road.
    const distance = (e: number): number => {
      const x = ents.x[e]! - ents.x[car]!, z = ents.z[e]! - ents.z[car]!;
      const vx = ents.vx[e]! - ents.vx[car]!, vz = ents.vz[e]! - ents.vz[car]!;
      const t = clamp(-(x * vx + z * vz) / Math.max(.001, vx * vx + vz * vz), 0, .5);
      return (x + vx * t) ** 2 + (z + vz * t) ** 2;
    };
    this.candidates.sort((a, b) => distance(a) - distance(b) || a - b);
    out.truncated = false;
    for (const e of this.candidates) {
      if (out.count === MAX_CONTACT_PROXIES) { out.truncated = true; break; }
      const row = out.rows[out.count]!, kind = ents.kind[e]!, move = world.reg.move[kind]!, other = world.reg.vehicle[kind];
      const victim = records.byPid.get(ents.pid[e]!)!, definition = world.reg.defs[kind];
      const scale = ents.grown[e] ? youngScale(world.reg.birthScale[kind]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
      row.handle = makeHandle(e, ents.gen[e]!); row.epoch = world.history.motionEpoch(e); row.kind = kind;
      row.vehicle = !!other; row.grounded = (ents.flags[e]! & F_GROUNDED) !== 0;
      ents.loadBody(e, this.publicBody);
      publicContactBody(this.publicBody, row.body);
      row.radius = other ? Math.max(move.radius, contactReach(other)) : move.radius * scale;
      row.height = stanceHeight(move, ents.stance[e]!) * scale;
      if (!contactRelevant(this.snapshotBody, row, contactReach(def), other ? 1.5 : .5)) continue;
      contactBody(row.body, row.state);
      row.mass = other ? vehicleMassProperties(other.spec, row.state).mass : Math.max(1, (world.reg.mass[kind]! || 80 * (move.radius / .4) * (move.radius / .4) * move.height / 1.8) * scale * scale * scale);
      const fixed = !other && definition?.type === 'species' && definition.still === true && row.grounded;
      const anchored = !!other && (this.ctx.anchored?.(e, by ?? vehicle) ?? false);
      row.response = fixed || anchored ? 'fixed' : combat.vehicleDisplaces(by, vehicle, victim) ? 'dynamic' : 'protected';
      if (!contactHorizon(row)) continue;
      out.count++;
      if (row.response === 'fixed') {
        row.state.vx = row.state.vy = row.state.vz = row.state.pitchRate = row.state.yawRate = row.state.rollRate = 0;
        row.body.vx = row.body.vy = row.body.vz = row.body.vehiclePitchRate = row.body.vehicleYawRate = row.body.vehicleRollRate = 0;
      }
    }
  }

  /** Once per registered vehicle before any player/NPC movement in this tick. */
  capture(e: number): void {
    const { world, records } = this.ctx, ents = world.ents;
    if (!world.reg.vehicle[ents.kind[e]!] || (ents.flags[e]! & F_ALIVE) === 0) return;
    const vehicle = records.byPid.get(ents.pid[e]!);
    if (!vehicle || vehicle.dead || records.entOf.get(vehicle.pid) !== e) return;
    const handle = makeHandle(e, ents.gen[e]!);
    let frame = this.frames.get(e);
    if (!frame) { frame = { body: new Body(), handle, pid: 0, tick: 0, motionEpoch: 0, consumed: false, by: 0, byHandle: 0 }; this.frames.set(e, frame); }
    ents.loadBody(e, frame.body);
    world.history.track(e);
    frame.handle = handle; frame.pid = ents.pid[e]!; frame.tick = world.tick; frame.motionEpoch = world.history.motionEpoch(e); frame.consumed = false;
    const driver = this.ctx.driverOf(e), actor = driver ? records.entOf.get(driver.pid) : undefined;
    frame.by = driver?.pid ?? 0;
    frame.byHandle = actor !== undefined && ents.pid[actor] === frame.by ? makeHandle(actor, ents.gen[actor]!) : 0;
  }

  /** After creatures.step, before attachment repinning/history/replication. */
  step(): readonly number[] {
    const { world } = this.ctx, ents = world.ents;
    this.changed.length = 0;
    this.ordered.length = 0;
    this.targetPadding = this.restingPadding;
    // Validate every capture before any pair can borrow it as its target's prior pose. Powered cruise speed is
    // not a physical limit; the distance guard follows actual velocity, while explicit teleports change the epoch.
    for (const [e, frame] of this.frames) {
      const from = frame.body, speed = Math.max(len3(from.vx, from.vy, from.vz), len3(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!));
      const dx = ents.x[e]! - from.x, dy = ents.y[e]! - from.y, dz = ents.z[e]! - from.z;
      if (frame.tick !== world.tick || ents.resolve(frame.handle) !== e || ents.pid[e] !== frame.pid ||
          frame.motionEpoch !== world.history.motionEpoch(e) ||
          len3(dx, dy, dz) > Math.max(4, speed * TICK_DT * 2)) {
        this.frames.delete(e); continue;
      }
      // Chunk lists hold final positions. A qualified vehicle may have started in a different chunk.
      this.includeTravel(world.reg.vehicle[ents.kind[e]!]!, dx, dz);
      this.ordered.push(e);
    }
    this.ordered.sort((a, b) => this.frames.get(a)!.handle - this.frames.get(b)!.handle);
    for (const e of this.ordered) {
      const frame = this.frames.get(e)!;
      if (frame.tick !== world.tick || ents.resolve(frame.handle) !== e || ents.pid[e] !== frame.pid || frame.motionEpoch !== world.history.motionEpoch(e)) {
        this.frames.delete(e); continue;
      }
      // Consume once while retaining its qualified tick for another vehicle's relative sweep.
      if (frame.consumed) continue;
      frame.consumed = true;
      const def = world.reg.vehicle[ents.kind[e]!]!, from = frame.body;
      for (let iteration = 0; iteration < 4; iteration++) {
        if (ents.resolve(frame.handle) !== e || ents.pid[e] !== frame.pid || frame.motionEpoch !== world.history.motionEpoch(e)) break;
        this.gather(e, from, def);
        this.first.entity = -1;
        for (const target of this.candidates) {
          const handle = makeHandle(target, ents.gen[target]!);
          if (this.touches.get(Math.min(frame.handle, handle))?.get(Math.max(frame.handle, handle))?.seen === world.tick) continue;
          const hit = this.rigidContact(e, frame, target, def);
          if (hit && (this.first.entity < 0 || hit.t < this.first.t || (hit.t === this.first.t && makeHandle(target, ents.gen[target]!) < this.first.handle))) Object.assign(this.first, hit);
        }
        if (this.first.entity < 0) break;
        if (this.resolve(e, frame, this.first) && !this.changed.includes(e)) this.changed.push(e);
      }
    }
    // A contact must separate for half a second before it can harm the same body
    // again. Both sides are generation handles, so recycled slots inherit nothing.
    for (const [car, pairs] of this.touches) {
      for (const [actor, touch] of pairs) if (world.tick - touch.seen > REARM_TICKS || ents.resolve(car) < 0 || ents.resolve(actor) < 0) { pairs.delete(actor); this.pairCount--; }
      if (!pairs.size) this.touches.delete(car);
    }
    return this.changed;
  }

  private includeTravel(def: VehicleDefinition, dx: number, dz: number): void {
    this.targetPadding = Math.max(this.targetPadding, vehicleSolidRadius(def) + Math.max(Math.abs(dx), Math.abs(dz)));
  }

  /** Every body near the car's path, however many: a herd beside a road is met, never a reason to stop the car. */
  private gather(e: number, from: Body, def: VehicleDefinition, reach = 0): void {
    const { world } = this.ctx, ents = world.ents, pad = this.targetPadding + Math.max(reach, vehicleSolidRadius(def));
    const x0 = Math.max(0, Math.floor((Math.min(from.x, ents.x[e]!) - pad) / CHUNK_SIZE));
    const x1 = Math.min(world.dims.chunksX - 1, Math.floor((Math.max(from.x, ents.x[e]!) + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((Math.min(from.z, ents.z[e]!) - pad) / CHUNK_SIZE));
    const z1 = Math.min(world.dims.chunksZ - 1, Math.floor((Math.max(from.z, ents.z[e]!) + pad) / CHUNK_SIZE));
    this.candidates.length = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (let target = ents.chunkHead[z * world.dims.chunksX + x]!; target >= 0; target = ents.next[target]!) {
        if (!this.target(e, target)) continue;
        if (Math.abs(ents.x[target]! - from.x) > pad + Math.abs(ents.x[e]! - from.x) ||
          Math.abs(ents.z[target]! - from.z) > pad + Math.abs(ents.z[e]! - from.z)) continue;
        this.candidates.push(target);
      }
    }
    this.candidates.sort((a, b) => a - b);
  }

  private target(car: number, e: number): boolean {
    const { world, records } = this.ctx, ents = world.ents;
    if (e === car || (ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE ||
      ents.mode[e] === MODE_GHOST || ents.mode[e] === MODE_NONE || !world.reg.move[ents.kind[e]!]) return false;
    const seat = ents.seat[e]! - 1;
    // Any valid seat is protected from a second impact on its attached visual body.
    if (seat >= 0 && ents.gen[seat] === ents.seatGen[e] && (ents.flags[seat]! & F_ALIVE) !== 0) return false;
    if (this.ctx.boarding?.(e, car)) return false;
    const rec = records.byPid.get(ents.pid[e]!);
    return !!rec && !rec.dead && records.entOf.get(rec.pid) === e;
  }

  private prepare(car: number, frame: Frame, e: number): void {
    const { world } = this.ctx, ents = world.ents, kind = ents.kind[e]!, move = world.reg.move[kind]!;
    this.defA = world.reg.vehicle[ents.kind[car]!]!; this.defB = world.reg.vehicle[kind] ?? undefined;
    const scale = ents.grown[e] ? youngScale(world.reg.birthScale[kind]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
    this.radiusB = move.radius * scale; this.heightB = stanceHeight(move, ents.stance[e]!) * scale;
    this.loadRigid(car, this.a.state); this.fromBody(frame.body, this.a.prior);
    this.loadRigid(e, this.b.state); Object.assign(this.b.prior, this.b.state);
    const captured = this.defB ? this.frames.get(e) : undefined;
    if (captured?.tick === world.tick && captured.handle === makeHandle(e, ents.gen[e]!) && captured.pid === ents.pid[e] && captured.motionEpoch === world.history.motionEpoch(e)) this.fromBody(captured.body, this.b.prior);
    // Vehicles have explicit pre-step captures. A rejected capture must not revive through an older history row.
    else if (!this.defB && world.history.at(world.tick - 1, e, this.past) && !this.past.seat) {
      this.b.prior.x = this.past.x; this.b.prior.y = this.past.y; this.b.prior.z = this.past.z;
    }
    if (!this.defB) { this.upright(this.b.prior); this.upright(this.b.state); }
    this.a.spec = this.defA.spec; this.a.mass = vehicleMassProperties(this.defA.spec, this.a.state).mass; this.a.response = 'dynamic';
    const mass = this.defB ? vehicleMassProperties(this.defB.spec, this.b.state).mass
      : (world.reg.mass[kind]! || 80 * (move.radius / .4) * (move.radius / .4) * move.height / 1.8) * scale * scale * scale;
    this.b.spec = this.defB?.spec ?? null; this.b.mass = Math.max(1, mass); this.b.response = 'dynamic';
    this.queries.configure(this.a, this.b, this.defA, this.defB, this.radiusB, this.heightB);
  }

  private upright(s: DynamicState): void { s.qx = s.qy = s.qz = 0; s.qw = 1; s.pitchRate = s.yawRate = s.rollRate = 0; }
  /** Geometry bounds choose samples; they are never used as damage speed. */
  private rigidContact(car: number, frame: Frame, e: number, def: VehicleDefinition): Contact | null {
    this.prepare(car, frame, e);
    const { world } = this.ctx, ents = world.ents, c = this.b.prior, d = this.b.state;
    // Actors use history and a capped character step. Vehicle captures have already passed their own velocity and epoch checks.
    if (!this.defB && len3(d.x - c.x, d.y - c.y, d.z - c.z) > world.reg.move[ents.kind[e]!]!.radius * 8 + .05) return null;
    const hit = this.queries.sweep();
    if (hit) {
      const cv = ents.vrow[car]!;
      const rpm = isRotorVehicle(def) ? Math.max(frame.body.vehicleRotorRpm, ents.vehicleRotorRpm[cv]!) : Math.max(frame.body.vehicleRpm, ents.vehicleRpm[cv]!);
      const propeller = 'propeller' in hit && hit.propeller === true && rpm > 30 && (frame.body.vehicleEngineOn || ents.vehicleEngineOn[cv] !== 0) && (frame.body.vehicleGear !== 0 || ents.vehicleGear[cv] !== 0);
      const rotor = 'rotor' in hit && hit.rotor === true && rpm > 30;
      const out = this.hit;
      out.entity = e; out.handle = makeHandle(e, ents.gen[e]!); out.pid = ents.pid[e]!; out.t = hit.t;
      out.nx = hit.nx; out.ny = hit.ny; out.nz = hit.nz;
      out.x = hit.x!; out.y = hit.y!; out.z = hit.z!; out.depth = hit.depth ?? 0;
      out.rotor = rotor; out.propeller = propeller; out.mass = this.b.mass;
      const other = this.defB, otherFrame = this.frames.get(e), ov = ents.vrow[e]!;
      const prior = otherFrame?.tick === world.tick && otherFrame.handle === out.handle && otherFrame.pid === out.pid && otherFrame.motionEpoch === world.history.motionEpoch(e) ? otherFrame.body : undefined;
      out.otherRotor = !!other && isRotorVehicle(other) && 'otherRotor' in hit && hit.otherRotor === true && Math.max(prior?.vehicleRotorRpm ?? 0, ents.vehicleRotorRpm[ov]!) > 30;
      out.otherPropeller = !!other && isBoatVehicle(other) && 'otherPropeller' in hit && hit.otherPropeller === true &&
        Math.max(prior?.vehicleRpm ?? 0, ents.vehicleRpm[ov]!) > 30 && (prior?.vehicleEngineOn === true || ents.vehicleEngineOn[ov] !== 0) &&
        ((prior?.vehicleGear ?? 0) !== 0 || ents.vehicleGear[ov] !== 0);
      out.hazardSpeed = rotor || propeller ? Math.min(32, rpm * TAU / 60 * (isBoatVehicle(def) ? def.spec.propeller.radius : 1)) : 0;
      return out;
    }
    return null;
  }

  private fromBody(b: Body, s: DynamicState): void {
    s.x = b.x; s.y = b.y; s.z = b.z; s.vx = b.vx; s.vy = b.vy; s.vz = b.vz;
    s.yaw = b.vehicleYaw; s.pitch = b.vehiclePitch; s.roll = b.vehicleRoll;
    s.qx = b.vehicleQx; s.qy = b.vehicleQy; s.qz = b.vehicleQz; s.qw = b.vehicleQw;
    s.pitchRate = b.vehiclePitchRate; s.yawRate = b.vehicleYawRate; s.rollRate = b.vehicleRollRate;
    s.payloadMass = b.vehiclePayloadMass; s.flooding = b.vehicleFlooding; s.steering = b.steering;
  }

  private loadRigid(e: number, s: DynamicState): void {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!;
    s.x = ents.x[e]!; s.y = ents.y[e]!; s.z = ents.z[e]!;
    s.vx = ents.vx[e]!; s.vy = ents.vy[e]!; s.vz = ents.vz[e]!;
    s.yaw = ents.vehicleYaw[v]!; s.pitch = ents.vehiclePitch[v]!; s.roll = ents.vehicleRoll[v]!;
    s.qx = ents.vehicleQx[v]!; s.qy = ents.vehicleQy[v]!; s.qz = ents.vehicleQz[v]!; s.qw = ents.vehicleQw[v]!;
    s.pitchRate = ents.vehiclePitchRate[v]!; s.yawRate = ents.vehicleYawRate[v]!; s.rollRate = ents.vehicleRollRate[v]!;
    s.payloadMass = ents.vehiclePayloadMass[v]!; s.flooding = ents.vehicleFlooding[v]!; s.steering = ents.steering[v]!;
  }

  private store(e: number, s: DynamicState, vehicle: boolean): void {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!;
    ents.setPosition(e, s.x, s.y, s.z);
    ents.vx[e] = Math.fround(s.vx); ents.vy[e] = Math.fround(s.vy); ents.vz[e] = Math.fround(s.vz);
    if (vehicle) {
      ents.vehiclePitchRate[v] = Math.fround(s.pitchRate); ents.vehicleYawRate[v] = Math.fround(s.yawRate); ents.vehicleRollRate[v] = Math.fround(s.rollRate);
    }
    if (s.vy > .01) ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
  }

  private driver(car: number, frame: Frame): EntityRecord | null {
    const { records, world } = this.ctx, driver = records.byPid.get(frame.by), current = this.ctx.driverOf(car);
    return driver && current?.pid === frame.by && frame.byHandle !== 0 && world.ents.resolve(frame.byHandle) === records.entOf.get(frame.by) ? driver : null;
  }

  private resolve(car: number, frame: Frame, c: Contact): boolean {
    const { world, records, combat } = this.ctx, ents = world.ents;
    if (ents.resolve(c.handle) !== c.entity || ents.pid[c.entity] !== c.pid || !this.target(car, c.entity)) return false;
    const vehicle = records.byPid.get(frame.pid)!, victim = records.byPid.get(c.pid)!;
    const by = this.driver(car, frame), movable = combat.vehicleDisplaces(by, vehicle, victim);
    this.prepare(car, frame, c.entity);
    const other = this.defB, a = this.a, b = this.b, result = this.result;
    const otherFrame = other ? this.frames.get(c.entity) : undefined;
    const otherDriver = otherFrame?.handle === c.handle && otherFrame.motionEpoch === world.history.motionEpoch(c.entity) ? this.driver(c.entity, otherFrame) : null;
    const anchoredA = this.ctx.anchored?.(car, otherDriver ?? victim) ?? false;
    const anchoredB = !!other && (this.ctx.anchored?.(c.entity, by ?? vehicle) ?? false);
    const definition = world.reg.defs[ents.kind[c.entity]!];
    const fixed = !other && definition?.type === 'species' && definition.still === true && (ents.flags[c.entity]! & F_GROUNDED) !== 0;
    a.response = anchoredA ? 'fixed' : 'dynamic';
    b.response = fixed || anchoredB ? 'fixed' : movable ? 'dynamic' : 'protected';
    if (anchoredA) a.state.vx = a.state.vy = a.state.vz = a.state.pitchRate = a.state.yawRate = a.state.rollRate = 0;
    if (fixed || anchoredB) b.state.vx = b.state.vy = b.state.vz = b.state.pitchRate = b.state.yawRate = b.state.rollRate = 0;
    const firstHandle = Math.min(frame.handle, c.handle), secondHandle = Math.max(frame.handle, c.handle);
    let pairs = this.touches.get(firstHandle);
    const previous = pairs?.get(secondHandle), fresh = !previous || world.tick - previous.seen > REARM_TICKS;
    if (previous?.seen === world.tick) return false;
    if (!pairs) { pairs = new Map(); this.touches.set(firstHandle, pairs); }
    if (!previous) this.pairCount++;
    const touch = previous ?? { seen: world.tick, hazardFirst: -REARM_TICKS, hazardSecond: -REARM_TICKS };
    touch.seen = world.tick; if (!previous) pairs.set(secondHandle, touch);
    const aFirst = frame.handle === firstHandle;
    const hazardFreshA = (c.rotor || c.propeller) && world.tick - (aFirst ? touch.hazardFirst : touch.hazardSecond) >= REARM_TICKS;
    const hazardFreshB = (c.otherRotor || c.otherPropeller) && world.tick - (aFirst ? touch.hazardSecond : touch.hazardFirst) >= REARM_TICKS;
    if (hazardFreshA) { if (aFirst) touch.hazardFirst = world.tick; else touch.hazardSecond = world.tick; }
    if (hazardFreshB) { if (aFirst) touch.hazardSecond = world.tick; else touch.hazardFirst = world.tick; }
    this.contacts++;
    // Track before correction so history keeps the stationary prior pose of an actor first woken by this touch.
    world.history.track(c.entity);
    resolveDynamicContact(a, b, c, this.queries, this.scratch, result);
    this.store(car, a.state, true); this.store(c.entity, b.state, !!other);
    // The impulse can move either vehicle again, including across a chunk boundary, before the next gather.
    this.includeTravel(this.defA, a.state.x - a.prior.x, a.state.z - a.prior.z);
    if (other) this.includeTravel(other, b.state.x - b.prior.x, b.state.z - b.prior.z);
    let impact: CorpseImpact | undefined;
    if (!other && movable && !fixed) {
      const mass = b.mass, radius = this.radiusB, height = this.heightB;
      const rx = c.x - b.state.x, ry = c.y - b.state.y - height / 2, rz = c.z - b.state.z;
      const jx = c.nx * result.impulse, jy = c.ny * result.impulse, jz = c.nz * result.impulse;
      const inertia = mass * (3 * radius * radius + height * height) / 12, axial = mass * radius * radius / 2;
      impact = { victimHandle: c.handle, victimPid: c.pid, vx: b.state.vx, vy: b.state.vy, vz: b.state.vz,
        wx: clamp((ry * jz - rz * jy) / inertia, -8, 8), wy: clamp((rz * jx - rx * jz) / axial, -8, 8), wz: clamp((rx * jy - ry * jx) / inertia, -8, 8) };
    }
    const event: VehicleCollisionPair = {
      tick: world.tick,
      a: { entity: car, handle: frame.handle, pid: frame.pid, vehicle: true, driverPid: by?.pid ?? 0, driverHandle: by ? frame.byHandle : 0, mass: a.mass, deltaSpeed: result.deltaSpeedA },
      b: { entity: c.entity, handle: c.handle, pid: c.pid, vehicle: !!other, driverPid: otherDriver?.pid ?? 0, driverHandle: otherDriver ? otherFrame!.byHandle : 0, mass: b.mass, deltaSpeed: result.deltaSpeedB },
      x: c.x, y: c.y, z: c.z, nx: c.nx, ny: c.ny, nz: c.nz,
      signedClosingSpeed: result.signedClosingSpeed, impulse: result.impulse, fresh,
      protectedA: anchoredA, protectedB: !movable || anchoredB, rotorA: c.rotor, rotorB: c.otherRotor, propellerA: c.propeller, propellerB: c.otherPropeller,
      hazardFreshA, hazardFreshB,
    };
    this.ctx.pair?.(event);
    // A vehicle receives one physical charge per side through the pair consumer, never an extra generic ram charge.
    const bladeSpeed = hazardFreshA ? c.hazardSpeed : 0;
    const hullSpeed = fresh && result.pointSpeedA > MIN_HARM_SPEED ? result.signedClosingSpeed : 0;
    const speed = Math.max(hullSpeed, bladeSpeed);
    if (!other && by && ents.resolve(frame.handle) === car && ents.resolve(c.handle) === c.entity &&
        this.driver(car, frame) === by && speed > MIN_HARM_SPEED) {
      const harmful = speed - MIN_HARM_SPEED;
      const src: Source = { by, x: frame.body.x, z: frame.body.z, item: 0,
        base: Math.min(300, .5 * harmful * harmful * a.mass / (a.mass + b.mass)), type: DMG_MELEE,
        quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
      combat.land(src, c.entity, ZONE_NONE, c.x, c.y, c.z, 0, impact);
    }
    // Either callback can destroy or replace a slot.
    if (ents.resolve(c.handle) === c.entity && ents.pid[c.entity] === c.pid) {
      ents.pose(c.entity, world.tick);
      if (!this.changed.includes(c.entity)) this.changed.push(c.entity);
    }
    if (ents.resolve(frame.handle) !== car || ents.pid[car] !== frame.pid) return false;
    ents.pose(car, world.tick);
    return true;
  }
}
