// Authoritative moving-vehicle contacts. Inputs select controls; only the server's
// completed body sweeps can select a victim or submit damage to native Combat.
import { ZONE_NONE } from '../shared/anim/human.ts';
import { CHUNK_SIZE, TICK_DT } from '../shared/coords.ts';
import { makeHandle } from '../shared/ids.ts';
import { clamp, detCos, detSin, TAU } from '../shared/math/scalar.ts';
import { youngScale } from '../shared/sim/breeding.ts';
import { Body, MODE_GHOST, MODE_NONE, stanceHeight } from '../shared/sim/character.ts';
import { DMG_MELEE } from '../shared/sim/damage.ts';
import { F_ALIVE, F_GROUNDED, F_HELD, F_PROP } from '../shared/sim/entities.ts';
import type { VehicleSpec } from '../shared/sim/vehicle.ts';
import { capsuleFree } from '../shared/world/collide.ts';
import type { Combat, Source } from './combat.ts';
import { Past } from './history.ts';
import type { EntityRecord, Records } from './records.ts';
import type { ServerWorld } from './world.ts';

export interface VehicleContactsContext {
  world: ServerWorld;
  records: Records;
  combat: Combat;
  driverOf(vehicle: number): EntityRecord | null;
}
interface Frame { body: Body; handle: number; pid: number; tick: number; by: number; byHandle: number }
interface Touch { seen: number }
interface Contact { entity: number; handle: number; pid: number; t: number; nx: number; nz: number; speed: number; mass: number }
const MIN_HARM_SPEED = 2.5;
const REARM_TICKS = 15;
const MAX_CANDIDATES = 256;
const MAX_VISITED = 4096;
const MAX_PAIRS = 4096;
const SKIN = 0.025;

/** Segment against an axis-aligned box in X/Z. Infinity means no contact. */
function box(x: number, z: number, dx: number, dz: number, hx: number, hz: number): number {
  let near = 0, far = 1;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis === 0 ? x : z, d = axis === 0 ? dx : dz, half = axis === 0 ? hx : hz;
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > half) return Infinity; continue; }
    let a = (-half - p) / d, b = (half - p) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  return near <= 1 && far >= 0 ? near : Infinity;
}

/** Exact 2D rectangle expanded by a capsule radius: strips plus round corners. */
function rounded(x: number, z: number, dx: number, dz: number, hx: number, hz: number, radius: number): number {
  let t = Math.min(box(x, z, dx, dz, hx + radius, hz), box(x, z, dx, dz, hx, hz + radius));
  const a = dx * dx + dz * dz;
  for (let corner = 0; corner < 4; corner++) {
    const px = x - (corner & 1 ? hx : -hx), pz = z - (corner & 2 ? hz : -hz), c = px * px + pz * pz - radius * radius;
    if (c <= 0) { t = 0; continue; }
    if (a < 1e-12) continue;
    const b = px * dx + pz * dz, disc = b * b - a * c;
    if (disc < 0) continue;
    const at = (-b - Math.sqrt(disc)) / a;
    if (at >= 0 && at <= 1) t = Math.min(t, at);
  }
  return t;
}

function length(x: number, z: number): number { return Math.sqrt(x * x + z * z); }
function turn(a: number): number { return a - Math.floor((a + TAU / 2) / TAU) * TAU; }

export class VehicleContacts {
  private readonly ctx: VehicleContactsContext;
  private readonly frames = new Map<number, Frame>();
  private readonly touches = new Map<number, Map<number, Touch>>();
  private pairCount = 0;
  private readonly past = new Past();
  private readonly candidates: number[] = [];
  private readonly changed: number[] = [];
  private readonly body = new Body();
  private readonly padding: number;
  /** Diagnostics, not replicated gameplay state. */
  contacts = 0;
  overflowStops = 0;

  constructor(ctx: VehicleContactsContext) {
    this.ctx = ctx;
    // stepBody splits motion into at most 16 half-radius pieces. This includes a
    // body's previous chunk even when it crosses the whole vehicle in one tick.
    let reach = 0;
    for (const p of ctx.world.reg.move) if (p) reach = Math.max(reach, p.radius * 9);
    this.padding = reach;
  }

  /** Once per registered vehicle before any player/NPC movement in this tick. */
  capture(e: number): void {
    const { world, records } = this.ctx, ents = world.ents;
    if (!world.reg.vehicle[ents.kind[e]!] || (ents.flags[e]! & F_ALIVE) === 0) return;
    const vehicle = records.byPid.get(ents.pid[e]!);
    if (!vehicle || vehicle.dead || records.entOf.get(vehicle.pid) !== e) return;
    const handle = makeHandle(e, ents.gen[e]!);
    let frame = this.frames.get(e);
    if (!frame) { frame = { body: new Body(), handle, pid: 0, tick: 0, by: 0, byHandle: 0 }; this.frames.set(e, frame); }
    ents.loadBody(e, frame.body);
    frame.handle = handle; frame.pid = ents.pid[e]!; frame.tick = world.tick;
    const driver = this.ctx.driverOf(e), actor = driver ? records.entOf.get(driver.pid) : undefined;
    frame.by = driver?.pid ?? 0;
    frame.byHandle = actor !== undefined && ents.pid[actor] === frame.by ? makeHandle(actor, ents.gen[actor]!) : 0;
  }

  /** After creatures.step, before attachment repinning/history/replication. */
  step(): readonly number[] {
    const { world } = this.ctx, ents = world.ents;
    this.changed.length = 0;
    for (const [e, frame] of this.frames) {
      if (frame.tick !== world.tick || ents.resolve(frame.handle) !== e || ents.pid[e] !== frame.pid) {
        this.frames.delete(e); continue;
      }
      // Consume once: an accidentally repeated host hook cannot repeat an impact.
      frame.tick = -1;
      const spec = world.reg.vehicle[ents.kind[e]!]!.spec, from = frame.body;
      const distance = length(ents.x[e]! - from.x, ents.z[e]! - from.z);
      // Administrative teleports are discontinuities, not a road sweep through the map.
      if (distance > Math.max(4, spec.maxForward * TICK_DT * 2)) continue;
      if (!this.gather(e, from, spec)) { this.clip(e, frame, 0, true); this.overflowStops++; this.changed.push(e); continue; }
      let first: Contact | null = null;
      for (const target of this.candidates) {
        const contact = this.contact(e, frame, target, spec);
        if (contact && (!first || contact.t < first.t || (contact.t === first.t && target < first.entity))) first = contact;
      }
      if (first && this.resolve(e, frame, first)) this.changed.push(e);
    }
    // A contact must separate for half a second before it can harm the same body
    // again. Both sides are generation handles, so recycled slots inherit nothing.
    for (const [car, pairs] of this.touches) {
      for (const [actor, touch] of pairs) if (world.tick - touch.seen > REARM_TICKS || ents.resolve(car) < 0 || ents.resolve(actor) < 0) { pairs.delete(actor); this.pairCount--; }
      if (!pairs.size) this.touches.delete(car);
    }
    return this.changed;
  }

  private gather(e: number, from: Body, spec: VehicleSpec): boolean {
    const { world } = this.ctx, ents = world.ents, pad = this.padding + length(spec.halfWidth, spec.halfLength);
    const x0 = Math.max(0, Math.floor((Math.min(from.x, ents.x[e]!) - pad) / CHUNK_SIZE));
    const x1 = Math.min(world.dims.chunksX - 1, Math.floor((Math.max(from.x, ents.x[e]!) + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((Math.min(from.z, ents.z[e]!) - pad) / CHUNK_SIZE));
    const z1 = Math.min(world.dims.chunksZ - 1, Math.floor((Math.max(from.z, ents.z[e]!) + pad) / CHUNK_SIZE));
    let visited = 0;
    this.candidates.length = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (let target = ents.chunkHead[z * world.dims.chunksX + x]!; target >= 0; target = ents.next[target]!) {
        if (++visited > MAX_VISITED) return false;
        if (!this.target(e, target)) continue;
        if (Math.abs(ents.x[target]! - from.x) > pad + Math.abs(ents.x[e]! - from.x) ||
          Math.abs(ents.z[target]! - from.z) > pad + Math.abs(ents.z[e]! - from.z)) continue;
        this.candidates.push(target);
        if (this.candidates.length > MAX_CANDIDATES) return false;
      }
    }
    this.candidates.sort((a, b) => a - b);
    return true;
  }

  private target(car: number, e: number): boolean {
    const { world, records } = this.ctx, ents = world.ents;
    if (e === car || (ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE || ents.vehicle[e] ||
      ents.mode[e] === MODE_GHOST || ents.mode[e] === MODE_NONE || !world.reg.move[ents.kind[e]!]) return false;
    const seat = ents.seat[e]! - 1;
    // Any valid seat is protected from a second impact on its attached visual body.
    if (seat >= 0 && ents.gen[seat] === ents.seatGen[e] && (ents.flags[seat]! & F_ALIVE) !== 0) return false;
    const rec = records.byPid.get(ents.pid[e]!);
    return !!rec && !rec.dead && records.entOf.get(rec.pid) === e;
  }

  private contact(car: number, frame: Frame, e: number, p: VehicleSpec): Contact | null {
    const { world } = this.ctx, ents = world.ents, from = frame.body, kind = ents.kind[e]!, move = world.reg.move[kind]!;
    const scale = ents.grown[e] ? youngScale(world.reg.birthScale[kind]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
    const radius = move.radius * scale, height = stanceHeight(move, ents.stance[e]!) * scale;
    const past = this.past;
    if (!world.history.at(world.tick - 1, e, past)) { past.x = ents.x[e]!; past.y = ents.y[e]!; past.z = ents.z[e]!; }
    // A teleport must not be mistaken for an entity crossing the bonnet.
    if (length(ents.x[e]! - past.x, ents.z[e]! - past.z) > move.radius * 8 + 0.05) return null;
    const yawDelta = turn(ents.vehicleYaw[car]! - from.vehicleYaw), yaw = from.vehicleYaw + yawDelta / 2;
    const sn = detSin(yaw), cs = detCos(yaw);
    const rx = past.x - from.x, rz = past.z - from.z;
    const dx = ents.x[e]! - ents.x[car]! - rx, dz = ents.z[e]! - ents.z[car]! - rz;
    const x = cs * rx - sn * rz, z = sn * rx + cs * rz, sx = cs * dx - sn * dz, sz = sn * dx + cs * dz;
    const arc = length(p.halfWidth, p.halfLength) * Math.abs(yawDelta) / 2;
    const t = rounded(x, z, sx, sz, p.halfWidth, p.halfLength, radius + arc);
    if (!Number.isFinite(t)) return null;
    const carY = from.y + (ents.y[car]! - from.y) * t, victimY = past.y + (ents.y[e]! - past.y) * t;
    const tilt = p.halfLength * Math.max(Math.abs(from.vehiclePitch), Math.abs(ents.vehiclePitch[car]!)) +
      p.halfWidth * Math.max(Math.abs(from.vehicleRoll), Math.abs(ents.vehicleRoll[car]!));
    if (victimY + height < carY - tilt || victimY > carY + p.height + tilt) return null;
    const atX = x + sx * t, atZ = z + sz * t;
    let nx = atX - clamp(atX, -p.halfWidth, p.halfWidth), nz = atZ - clamp(atZ, -p.halfLength, p.halfLength);
    const norm = length(nx, nz);
    if (norm > 1e-6) { nx /= norm; nz /= norm; }
    else if (p.halfWidth - Math.abs(atX) < p.halfLength - Math.abs(atZ)) { nx = atX >= 0 ? 1 : -1; nz = 0; }
    else { nx = 0; nz = atZ >= 0 ? 1 : -1; }
    const wx = cs * nx + sn * nz, wz = -sn * nx + cs * nz;
    const speed = Math.max(0, -(dx * wx + dz * wz) / TICK_DT);
    // Separating contacts cannot brake a vehicle moving away from the body.
    if (speed < 0.001 && t === 0 && dx * wx + dz * wz >= 0) return null;
    const mass = world.reg.mass[kind]! || 80 * (move.radius / 0.4) * (move.radius / 0.4) * move.height / 1.8;
    return { entity: e, handle: makeHandle(e, ents.gen[e]!), pid: ents.pid[e]!, t, nx: wx, nz: wz, speed,
      mass: Math.max(1, mass * scale * scale * scale) };
  }

  private resolve(car: number, frame: Frame, c: Contact): boolean {
    const { world, records, combat } = this.ctx, ents = world.ents;
    if (ents.resolve(c.handle) !== c.entity || ents.pid[c.entity] !== c.pid || !this.target(car, c.entity)) return false;
    this.contacts++;
    let pairs = this.touches.get(frame.handle);
    const previous = pairs?.get(c.handle), fresh = !previous || world.tick - previous.seen > REARM_TICKS;
    // Exhaustion is a conservative stop, never untracked damage every tick.
    if (!previous && this.pairCount >= MAX_PAIRS) { this.clip(car, frame, c.t, true); this.overflowStops++; return true; }
    if (!pairs) { pairs = new Map(); this.touches.set(frame.handle, pairs); }
    if (!previous) this.pairCount++;
    if (previous) previous.seen = world.tick; else pairs.set(c.handle, { seen: world.tick });
    const spec = world.reg.vehicle[ents.kind[car]!]!.spec;
    const mass = Math.max(1, (spec.mass ?? world.reg.mass[ents.kind[car]!]!) || 1100) + Math.max(0, ents.vehiclePayloadMass[car]!);
    const impulse = c.speed / (1 / mass + 1 / c.mass);
    const carNormal = ((ents.x[car]! - frame.body.x) * c.nx + (ents.z[car]! - frame.body.z) * c.nz) / TICK_DT;
    let taken = 0;
    // Harm needs a live driver to answer to the rules. Crediting the car's own record would let an
    // unowned (team 0) car coast through PvE protection, so a driverless car only blocks.
    const driver = records.byPid.get(frame.by);
    const by = driver && frame.byHandle !== 0 && ents.resolve(frame.byHandle) === records.entOf.get(frame.by) ? driver : null;
    if (by && fresh && c.speed > MIN_HARM_SPEED && carNormal > MIN_HARM_SPEED) {
      const harmful = c.speed - MIN_HARM_SPEED;
      const src: Source = { by, x: frame.body.x, z: frame.body.z, item: 0,
        base: Math.min(300, 0.5 * harmful * harmful * mass / (mass + c.mass)), type: DMG_MELEE,
        quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
      combat.land(src, c.entity, ZONE_NONE, ents.x[c.entity]!, ents.y[c.entity]! + 0.5, ents.z[c.entity]!, 0);
      if (combat.last.victim === c.pid) taken = combat.last.damage;
    }
    // A death/module callback can destroy and reuse either slot during Combat.land.
    if (ents.resolve(frame.handle) !== car || ents.pid[car] !== frame.pid) return false;
    this.clip(car, frame, c.t, taken <= 0);
    if (taken > 0) {
      const loss = Math.min(impulse / mass, Math.max(0, ents.vx[car]! * c.nx + ents.vz[car]! * c.nz));
      ents.vx[car] = Math.fround(ents.vx[car]! - c.nx * loss);
      ents.vz[car] = Math.fround(ents.vz[car]! - c.nz * loss);
    }
    if (taken <= 0) this.clipActor(car, c);
    if (taken > 0 && ents.resolve(c.handle) === c.entity && ents.pid[c.entity] === c.pid && this.target(car, c.entity)) {
      const kick = Math.min(12, impulse / c.mass);
      ents.vx[c.entity] = Math.fround(ents.vx[c.entity]! + c.nx * kick);
      ents.vz[c.entity] = Math.fround(ents.vz[c.entity]! + c.nz * kick);
      ents.vy[c.entity] = Math.fround(Math.max(ents.vy[c.entity]!, Math.min(3, kick * 0.2)));
      // The next native step must retain the vertical impulse instead of zeroing it
      // as grounded motion. Horizontal velocity already approaches input gradually.
      ents.flags[c.entity] = ents.flags[c.entity]! & ~F_GROUNDED;
      ents.pose(c.entity, world.tick); world.history.track(c.entity);
    }
    ents.pose(car, world.tick);
    return true;
  }

  /** Stop only the actor's own inward movement. Protected victims and pedestrians
   * walking into a parked car are never shoved by a vehicle that cannot harm them.
   */
  private clipActor(car: number, contact: Contact): void {
    const { world } = this.ctx, ents = world.ents, e = contact.entity, past = this.past;
    if (ents.resolve(contact.handle) !== e || ents.pid[e] !== contact.pid || !this.target(car, e) ||
      !world.history.at(world.tick - 1, e, past)) return;
    const dx = ents.x[e]! - past.x, dz = ents.z[e]! - past.z;
    if (dx * contact.nx + dz * contact.nz >= -0.00001) return;
    const distance = length(dx, dz), b = this.body, p = world.reg.move[ents.kind[e]!]!;
    const at = Math.max(0, contact.t - SKIN / Math.max(distance, SKIN));
    const dy = ents.y[e]! - past.y;
    ents.loadBody(e, b);
    // A chord of a stepped terrain path may be obstructed. Try progressively earlier
    // points, including the prior authority position; never force a capsule into a wall.
    for (let attempt = 0; attempt < 4; attempt++) {
      const fraction = at * (3 - attempt) / 3;
      const x = past.x + dx * fraction, y = past.y + dy * fraction, z = past.z + dz * fraction;
      if (!capsuleFree(world, x, y, z, p.radius, stanceHeight(p, b.stance))) continue;
      b.x = x; b.y = y; b.z = z;
      const inward = Math.min(0, b.vx * contact.nx + b.vz * contact.nz);
      b.vx = Math.fround(b.vx - contact.nx * inward); b.vz = Math.fround(b.vz - contact.nz * inward);
      ents.storeBody(e, b); ents.pose(e, world.tick); world.history.track(e);
      break;
    }
  }

  private clip(car: number, frame: Frame, t: number, brake: boolean): void {
    const ents = this.ctx.world.ents, b = this.body, from = frame.body;
    ents.loadBody(car, b);
    const distance = length(b.x - from.x, b.z - from.z);
    const at = Math.max(0, t - SKIN / Math.max(distance, SKIN));
    b.x = from.x + (b.x - from.x) * at; b.y = from.y + (b.y - from.y) * at; b.z = from.z + (b.z - from.z) * at;
    b.vehicleYaw = from.vehicleYaw + turn(b.vehicleYaw - from.vehicleYaw) * at;
    b.yaw = Math.round(b.vehicleYaw * 65536 / TAU) & 65535;
    if (brake) b.vx = b.vz = b.vehicleYawRate = 0;
    ents.storeBody(car, b);
  }
}
