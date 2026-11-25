// A vehicle's own guns and missiles (planning/workstreams/jet.md). Once a tick, after the rounds of hand weapons, it reads
// the held buttons of each client that drives an armed vehicle, under the vehicle step's own rule for a quiet input:
// PRIMARY held fires the cannon, SECONDARY held seeks a lock, and SECONDARY let go fires a missile at what is locked.
// The cannon's rounds go through a survivor's round path (Projectiles.vehicleRound), judged at the pilot's view tick and
// credited to the pilot. A missile is a prop entity this system flies by proportional navigation, which every client
// draws from the snapshots it already reads, with a proximity fuse that meets a craft in the sky through combat.sky; it
// goes off through the ordinary blast (Projectiles.detonate).
//
// What is left in the drum and the racks is saved on the vehicle's record, so a parked jet keeps its empty racks; the
// vehicle service rearms it. The pilot is told its weapons (OWN_ARMS), and whoever drives or sits in what a seeker looks
// at is warned (OWN_WARNED).

import { TICK_DT, TICK_RATE } from "../shared/coords.ts";
import { makeHandle } from "../shared/ids.ts";
import { quatRotate } from "../shared/math/quat.ts";
import { EVENT_NAME_BYTES, OWN_ARMS, OWN_WARNED, VEHICLE_HOLD_TICKS } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { BTN_AIR_REMOTE, BTN_PRIMARY, BTN_SECONDARY } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { vehiclePoint, vehicleRotation, type VehicleFrame } from "../shared/sim/vehicle-frame.ts";
import type { VehicleDefinition, VehicleMissiles } from "../shared/sim/vehicle.ts";
import { castWorld, HIT_NONE, rayHit } from "../shared/world/ray.ts";
import type { Combat } from "./combat.ts";
import type { Client, GameServer } from "./game.ts";
import type { MissileEnd, Projectiles } from "./projectiles.ts";
import { part, type EntityRecord, type Records } from "./records.ts";
import { saved } from "./saved.ts";
import type { SkyPoint, SkyTarget } from "./sky.ts";
import { lockMiddle, scanLock, type LockPick } from "./vehicle-lock.ts";
import type { ServerWorld } from "./world.ts";

/** Ticks between two looks of the seeker while SECONDARY is held. */
export const LOCK_SCAN = 3;
/** A lock formed holds while its target stays within this many times the cone. */
const LOCK_KEEP = 1.5;
const MAX_MISSILES = 64;
export const LOCK_NONE = 0;
export const LOCK_SEEKING = 1;
export const LOCK_LOCKED = 2;
/** What a vehicle or a rider is warned of: being looked for, locked, or a missile on its way. */
export const WARN_NONE = 0;
export const WARN_SEEKING = 1;
export const WARN_LOCKED = 2;
export const WARN_MISSILE = 3;
/** Metres a far viewer is sent an airborne jet from, and a live missile (Replication.far). */
export const JET_REACH = 3000;
export const MISSILE_REACH = 800;
/** Airborne jets past this many are left to the ordinary view. */
export const MAX_FAR_JETS = 4;

/** Rounds and missiles left on a vehicle's record; -1 is a full drum or rack, as a new vehicle has. */
export const ARMS = part(() => ({ rounds: -1, missiles: -1 }));

saved({
  name: "arms",
  has: (rec) => rec.part(ARMS) !== undefined,
  write(rec, w) {
    const a = rec.part(ARMS)!;
    w.bool(a.rounds >= 0);
    if (a.rounds >= 0) w.u16(a.rounds);
    w.bool(a.missiles >= 0);
    if (a.missiles >= 0) w.u8(a.missiles);
  },
  read(rec, r) {
    const a = rec.own(ARMS);
    a.rounds = r.bool() ? r.u16() : -1;
    a.missiles = r.bool() ? r.u8() : -1;
  },
});

interface Lock { entity: number; gen: number; sky: SkyTarget | null; since: number; scanAt: number; clearAt: number; locked: boolean; x: number; y: number; z: number }
/** A vehicle's weapons as they are this run: when the gun and the rail are next ready, the lock, and SECONDARY last tick. */
interface Arms { pid: number; gunAt: number; railAt: number; held: boolean; lock: Lock | null; rev: number; seen: number }
interface Missile {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  ox: number; oz: number; until: number; by: number; self: number; carrier: number;
  entity: number; gen: number; sky: SkyTarget | null;
  prop: number; propGen: number; weapon: number; ammo: number; spec: VehicleMissiles;
}

export interface VehicleWeaponsContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly combat: Combat;
  readonly projectiles: Projectiles;
  /** Whether a client's input this tick works a remote and not its seat (Players.remoteInput). */
  readonly remote?: (c: Client, tick: number) => boolean;
  /** Puts an entity in the view of every session within `reach` metres of it this tick (Replication.far). */
  readonly far?: (e: number, reach: number) => void;
}

export class VehicleWeapons {
  /** Counters for tests and measurement. */
  rounds = 0;
  launched = 0;
  detonated = 0;
  private readonly ctx: VehicleWeaponsContext;
  private readonly arms = new Map<number, Arms>();
  private readonly missiles: Missile[] = [];
  /** What a seeker does to each entity this tick, for OWN_WARNED. */
  private readonly danger = new Map<number, number>();
  private readonly rng: Rng;
  private revs = 0;
  private readonly frame: VehicleFrame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  private readonly q = new Float64Array(4);
  private readonly at = [0, 0, 0];
  private readonly nose = [0, 0, 0];
  private readonly dir = [0, 0, 0];
  private readonly pick: LockPick = { entity: -1, gen: 0, sky: null, x: 0, y: 0, z: 0, angle: 0 };
  private readonly point: SkyPoint = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private readonly middle = { x: 0, y: 0, z: 0 };
  private readonly end: MissileEnd = { body: -1, what: HIT_NONE, ref: 0, nx: 0, ny: 1, nz: 0, water: false, sky: false };
  private readonly airborne: number[] = [];

  constructor(ctx: VehicleWeaponsContext, seed: number) {
    this.ctx = ctx;
    this.rng = new Rng(seed);
    const game = ctx.game;
    game.own.add<number>({
      kind: OWN_ARMS,
      // A new connection is told at once, so a session never keeps another's weapons.
      unsent: -1,
      version: (c) => this.armsOf(c)?.rev ?? 0,
      write: (w, c) => {
        const e = c.drive, def = e >= 0 ? ctx.world.reg.vehicle[ctx.world.ents.kind[e]!] : undefined, a = this.armsOf(c);
        const w8 = def?.weapons, vehicle = e >= 0 ? ctx.records.byPid.get(ctx.world.ents.pid[e]!) : undefined;
        w.bool(!!a && !!w8 && !!vehicle);
        if (!a || !w8 || !vehicle) return;
        const left = vehicle.own(ARMS), lock = a.lock, m = w8.missiles;
        w.u16(this.roundsOf(left, def!)); w.u16(w8.cannon?.rounds ?? 0);
        w.u8(this.missilesOf(left, def!)); w.u8(m?.count ?? 0);
        w.bits(!lock ? LOCK_NONE : lock.locked ? LOCK_LOCKED : LOCK_SEEKING, 2);
        w.u8(this.progress(lock, m));
        w.bits(!lock ? 0 : lock.sky ? 2 : 1, 2);
        if (lock && !lock.sky) w.u32(makeHandle(lock.entity, lock.gen));
        // Where it is, for a target past the pilot's view.
        if (lock) { w.f32(lock.x); w.f32(lock.y); w.f32(lock.z); }
        if (lock?.sky) w.string(lock.sky.name.slice(0, EVENT_NAME_BYTES / 3));
      },
    });
    game.own.add<number>({
      kind: OWN_WARNED,
      unsent: -1,
      version: (c) => this.warnedOf(c),
      write: (w, c) => w.u8(this.warnedOf(c)),
    });
  }

  /** The live missiles, for tests. */
  get flying(): readonly { readonly x: number; readonly y: number; readonly z: number; readonly prop: number }[] { return this.missiles; }

  /** The lock vehicle `e`'s driver holds, for tests: its state, and the entity or sky target it is on. */
  lockOf(e: number): { state: number; entity: number; sky: SkyTarget | null } {
    const lock = this.arms.get(this.ctx.world.ents.pid[e]!)?.lock;
    return { state: !lock ? LOCK_NONE : lock.locked ? LOCK_LOCKED : LOCK_SEEKING, entity: lock?.entity ?? -1, sky: lock?.sky ?? null };
  }

  /** The vehicle's rounds and missiles, as words for an inspection, or "" for an unarmed one. */
  words(vehicle: EntityRecord): string {
    const def = this.ctx.world.reg.vehicle[vehicle.kind], w = def?.weapons;
    if (!w) return "";
    const left = vehicle.own(ARMS);
    return [w.cannon ? `cannon ${this.roundsOf(left, def)}/${w.cannon.rounds}` : "", w.missiles ? `missiles ${this.missilesOf(left, def)}/${w.missiles.count}` : ""].filter(Boolean).join(", ");
  }

  /** Whether the vehicle's drum and racks are full (an unarmed one always is). */
  full(vehicle: EntityRecord): boolean {
    const left = vehicle.part(ARMS);
    return !left || (left.rounds < 0 && left.missiles < 0);
  }

  /** Fills the vehicle's drum and racks. */
  rearm(vehicle: EntityRecord): void {
    const left = vehicle.part(ARMS);
    if (!left) return;
    left.rounds = left.missiles = -1;
    this.ctx.records.dirty.add(vehicle.pid);
    this.touch(vehicle.pid);
  }

  private roundsOf(left: { rounds: number }, def: VehicleDefinition): number {
    const most = def.weapons?.cannon?.rounds ?? 0;
    return left.rounds < 0 ? most : Math.min(left.rounds, most);
  }

  private missilesOf(left: { missiles: number }, def: VehicleDefinition): number {
    const most = def.weapons?.missiles?.count ?? 0;
    return left.missiles < 0 ? most : Math.min(left.missiles, most);
  }

  private progress(lock: Lock | null, m: VehicleMissiles | undefined): number {
    return lock && m ? Math.min(255, Math.round((this.ctx.world.tick - lock.since) / Math.max(1, m.lock * TICK_RATE) * 255)) : 0;
  }

  /** The state of the armed vehicle `c` drives this run, or null. */
  private armsOf(c: Client): Arms | null {
    const e = c.drive;
    return e >= 0 ? this.arms.get(this.ctx.world.ents.pid[e]!) ?? null : null;
  }

  private warnedOf(c: Client): number {
    if (this.danger.size === 0) return WARN_NONE;
    const ents = this.ctx.world.ents;
    const craft = c.drive >= 0 ? c.drive : c.ent >= 0 && ents.seat[c.ent]! > 0 ? ents.seat[c.ent]! - 1 : c.ent;
    return craft >= 0 ? this.danger.get(craft) ?? WARN_NONE : WARN_NONE;
  }

  /** What the pilot is told changed: OWN_ARMS goes again at its next sync. */
  private touch(pid: number): void {
    const a = this.arms.get(pid);
    if (a) a.rev = ++this.revs;
  }

  /** The vehicle `e`'s pose as a frame, from the entity columns, and its nose's unit way in `nose`. */
  private pose(e: number): VehicleFrame {
    const ents = this.ctx.world.ents, v = ents.vrow[e]!, f = this.frame;
    f.x = ents.x[e]!; f.y = ents.y[e]!; f.z = ents.z[e]!;
    f.yaw = ents.vehicleYaw[v]!; f.pitch = ents.vehiclePitch[v]!; f.roll = ents.vehicleRoll[v]!;
    f.qx = ents.vehicleQx[v]!; f.qy = ents.vehicleQy[v]!; f.qz = ents.vehicleQz[v]!; f.qw = ents.vehicleQw[v]!;
    vehicleRotation(f, this.q);
    quatRotate(this.q, 0, 0, 0, 1, this.nose, 0);
    return f;
  }

  /** Once a tick, after the hand weapons' rounds: each armed driver's buttons, the missiles flown, and who is warned. */
  step(): void {
    const { world, game, records } = this.ctx, ents = world.ents, now = world.tick;
    this.airborne.length = 0;
    const clients = game.clients;
    let locks = this.locks;
    for (let k = 0; k < clients.length; k++) {
      const c = clients[k];
      if (!c?.active || c.drive < 0) continue;
      const e = c.drive;
      if ((ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
      const def = world.reg.vehicle[ents.kind[e]!];
      if (!def) continue;
      if (def.movement === "jet" && (ents.flags[e]! & F_GROUNDED) === 0 && this.airborne.length < MAX_FAR_JETS) this.airborne.push(e);
      if (!def.weapons) continue;
      const vehicle = records.byPid.get(ents.pid[e]!), pilot = records.byPid.get(c.pid);
      if (!vehicle || !pilot || pilot.dead) continue;
      let a = this.arms.get(vehicle.pid);
      if (!a) { a = { pid: vehicle.pid, gunAt: 0, railAt: 0, held: false, lock: null, rev: ++this.revs, seen: now }; this.arms.set(vehicle.pid, a); }
      a.seen = now;
      // The vehicle step's rule: a driver whose inputs stopped coming, or who works a remote, holds no trigger.
      const quiet = c.closed || now - c.inputAt > VEHICLE_HOLD_TICKS || (c.heldButtons & BTN_AIR_REMOTE) !== 0 || (this.ctx.remote?.(c, now) ?? false);
      const buttons = quiet ? 0 : c.heldButtons;
      const fired = (buttons & BTN_PRIMARY) !== 0 && this.gun(c, pilot, vehicle, e, def);
      const seeking = (buttons & BTN_SECONDARY) !== 0;
      // A look of the seeker waits a tick for a round that went this one: each casts far, and one tick takes one.
      if (seeking) { if (!(fired && a.lock)) this.seek(c, e, def, a); }
      else if (a.held) this.fire(c, pilot, vehicle, e, def, a);
      else if (a.lock) { a.lock = null; this.touch(a.pid); }
      a.held = seeking;
      if (a.lock) locks++;
    }
    // A lock nobody holds goes, and now and then a vehicle that is gone forgets its state.
    this.locks = locks;
    if (locks > 0 || now % TICK_RATE === 0) this.arms.forEach(this.tidy);
    let kept = 0;
    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i]!;
      if (this.fly(m)) this.missiles[kept++] = m;
      else this.out(m);
    }
    this.missiles.length = kept;
    if (this.locks > 0 || this.missiles.length > 0 || this.danger.size > 0) this.warn();
    const far = this.ctx.far;
    if (far) {
      for (let i = 0; i < this.airborne.length; i++) far(this.airborne[i]!, JET_REACH);
      for (let i = 0; i < this.missiles.length; i++) far(this.missiles[i]!.prop, MISSILE_REACH);
    }
  }

  /** Locks held when the last step ended. */
  private locks = 0;
  /** A vehicle's state after the drivers' turn: its lock goes when nobody drove it this tick, all of it when it is gone. */
  private readonly tidy = (a: Arms, pid: number): void => {
    if (!this.ctx.records.entOf.has(pid)) { this.arms.delete(pid); return; }
    if (a.lock && a.seen !== this.ctx.world.tick) { a.lock = null; a.held = false; this.touch(pid); }
  };

  /** One round from the nose, if the gun has one and its interval has passed. Whether it went. */
  private gun(c: Client, pilot: EntityRecord, vehicle: EntityRecord, e: number, def: VehicleDefinition): boolean {
    const g = def.weapons!.cannon, { world, projectiles } = this.ctx, reg = world.reg, now = world.tick;
    const a = this.arms.get(vehicle.pid)!, left = vehicle.own(ARMS), rounds = this.roundsOf(left, def);
    if (!g || now < a.gunAt || rounds <= 0) return false;
    const weapon = reg.index.get(g.weapon) ?? 0, ammo = reg.index.get(g.ammo) ?? 0;
    if (weapon === 0 || ammo === 0) return false;
    left.rounds = rounds - 1;
    a.gunAt = now + Math.max(1, Math.round(g.interval * TICK_RATE));
    const f = this.pose(e), d = this.nose, at = this.at, dir = this.dir;
    vehiclePoint(f, g.muzzle, at);
    // Within a small cone about the nose, from a seed of the server's: two ways across it, level to its side and the
    // nose crossed with that.
    const s = g.spread * Math.sqrt(this.rng.float()), turn = this.rng.float() * Math.PI * 2;
    const ul = Math.hypot(d[0]!, d[2]!) || 1, sideX = -d[2]! / ul, sideZ = d[0]! / ul;
    const upX = d[1]! * sideZ, upY = d[2]! * sideX - d[0]! * sideZ, upZ = -d[1]! * sideX;
    const cs = Math.cos(turn) * s, sn = Math.sin(turn) * s;
    dir[0] = d[0]! + sideX * cs + upX * sn; dir[1] = d[1]! + upY * sn; dir[2] = d[2]! + sideZ * cs + upZ * sn;
    const n = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
    dir[0] = dir[0]! / n; dir[1] = dir[1]! / n; dir[2] = dir[2]! / n;
    this.rounds++;
    projectiles.vehicleRound(c, pilot, weapon, ammo, at[0]!, at[1]!, at[2]!, dir);
    this.ctx.records.dirty.add(vehicle.pid);
    this.touch(vehicle.pid);
    return true;
  }

  /** A look of the seeker: a lock is kept, begun again on a new target, or formed once it has been held long enough. */
  private seek(c: Client, e: number, def: VehicleDefinition, a: Arms): void {
    const m = def.weapons!.missiles, { world, combat } = this.ctx, now = world.tick, ents = world.ents;
    if (!m || (a.lock && now - a.lock.scanAt < LOCK_SCAN)) return;
    const f = this.pose(e), d = this.nose, at = this.at;
    vehiclePoint(f, [0, def.spec.height * .5, def.spec.halfLength + .5], at);
    const lock = a.lock, pick = this.pick;
    // The seeker stays on what it has while it is there, and a formed lock holds in a wider cone, so a target that jinks at
    // the edge is not lost at once. Only a seeker with nothing looks round the whole cone.
    if (lock && this.still(lock, at, d, lock.locked ? m.cone * LOCK_KEEP : m.cone, lock.locked ? m.range * 1.1 : m.range)) {
      lock.scanAt = now;
      lock.locked = now - lock.since >= Math.round(m.lock * TICK_RATE);
      this.touch(a.pid);
      return;
    }
    if (!scanLock(world, combat.sky, now, at[0]!, at[1]!, at[2]!, d[0]!, d[1]!, d[2]!, m.cone, m.range, e, c.ent, pick)) {
      if (a.lock) { a.lock = null; this.touch(a.pid); }
      return;
    }
    const same = lock !== null && (pick.sky ? lock.sky === pick.sky : lock.entity === pick.entity && lock.gen === pick.gen);
    if (!same) a.lock = { entity: pick.entity, gen: pick.gen, sky: pick.sky, since: now, scanAt: now, clearAt: now, locked: false, x: pick.x, y: pick.y, z: pick.z };
    const held = a.lock!;
    held.scanAt = held.clearAt = now; held.x = pick.x; held.y = pick.y; held.z = pick.z;
    held.locked = now - held.since >= Math.round(m.lock * TICK_RATE);
    if (held.entity >= 0 && (ents.flags[held.entity]! & F_ALIVE) === 0) a.lock = null;
    this.touch(a.pid);
  }

  /** Whether a formed lock's target is still there, within `cone` and `range` of the nose and in clear sight. */
  private still(lock: Lock, at: readonly number[], d: readonly number[], cone: number, range: number): boolean {
    const { world, combat } = this.ctx, ents = world.ents, p = this.middle;
    if (lock.sky) {
      if (!combat.sky.targets.includes(lock.sky) || !lock.sky.at(world.tick, this.point)) return false;
      p.x = this.point.x; p.y = this.point.y; p.z = this.point.z;
    } else {
      if ((ents.flags[lock.entity]! & F_ALIVE) === 0 || ents.gen[lock.entity] !== lock.gen) return false;
      lockMiddle(world, lock.entity, p);
    }
    const rx = p.x - at[0]!, ry = p.y - at[1]!, rz = p.z - at[2]!, far = Math.hypot(rx, ry, rz);
    if (far > range || far < 1 || (rx * d[0]! + ry * d[1]! + rz * d[2]!) / far < Math.cos(cone)) return false;
    // The clear line is cast at a third of the seeker's pace: a cast of the whole range is its dearest part.
    if (world.tick - lock.clearAt >= LOCK_SCAN * 3) {
      if (castWorld(world, at[0]!, at[1]!, at[2]!, rx / far, ry / far, rz / far, far) !== HIT_NONE && rayHit.t < far - .5) return false;
      lock.clearAt = world.tick;
    }
    lock.x = p.x; lock.y = p.y; lock.z = p.z;
    return true;
  }

  /** SECONDARY let go: a missile off the rail at what is locked, if one is loaded and the rail is ready. The lock ends. */
  private fire(c: Client, pilot: EntityRecord, vehicle: EntityRecord, e: number, def: VehicleDefinition, a: Arms): void {
    const m = def.weapons!.missiles, lock = a.lock, { world } = this.ctx, ents = world.ents, reg = world.reg, now = world.tick;
    a.lock = null;
    this.touch(a.pid);
    const left = vehicle.own(ARMS), count = this.missilesOf(left, def);
    if (!m || !lock?.locked || count <= 0 || now < a.railAt || this.missiles.length >= MAX_MISSILES) return;
    const weapon = reg.index.get(m.weapon) ?? 0, ammo = reg.index.get(m.ammo) ?? 0, kind = reg.index.get(m.prop) ?? 0;
    if (weapon === 0 || ammo === 0 || kind === 0) return;
    const f = this.pose(e), d = this.nose, at = this.at;
    vehiclePoint(f, m.rail, at);
    const prop = ents.create(kind, at[0]!, at[1]!, at[2]!, F_PROP);
    if (prop < 0) return;
    left.missiles = count - 1;
    a.railAt = now + Math.max(1, Math.round(m.reload * TICK_RATE));
    this.ctx.records.dirty.add(vehicle.pid);
    this.launched++;
    // It leaves at the jet's own speed along the nose, and its motor takes it to its own.
    const missile: Missile = {
      x: at[0]!, y: at[1]!, z: at[2]!, vx: d[0]! * m.speed, vy: d[1]! * m.speed, vz: d[2]! * m.speed,
      ox: at[0]!, oz: at[2]!, until: now + Math.round(m.life * TICK_RATE), by: pilot.pid, self: c.ent, carrier: e,
      entity: lock.entity, gen: lock.gen, sky: lock.sky, prop, propGen: ents.gen[prop]!, weapon, ammo, spec: m,
    };
    this.aim(missile);
    this.missiles.push(missile);
  }

  /** Turns a missile's prop to the way it flies, as a stuck arrow is turned (its yaw and pitch go as any body's). */
  private aim(m: Missile): void {
    const ents = this.ctx.world.ents, speed = m.spec.speed, dy = m.vy / speed;
    ents.yaw[m.prop] = Math.round(Math.atan2(m.vx, m.vz) / (Math.PI * 2) * 65536) & 65535;
    ents.pitch[m.prop] = Math.round(Math.asin(dy < -1 ? -1 : dy > 1 ? 1 : dy) / (Math.PI / 2) * 16384);
    ents.vx[m.prop] = m.vx; ents.vy[m.prop] = m.vy; ents.vz[m.prop] = m.vz;
    ents.pose(m.prop, this.ctx.world.tick);
  }

  /**
   * One tick of a missile: proportional navigation toward its target's middle (a = N Vc ω × r̂, across its path and within
   * its turn), then the piece it flies met against the world, the bodies, and its fuse about its target at their nearest.
   * False once it has gone off or gone.
   */
  private fly(m: Missile): boolean {
    const { world, combat, records } = this.ctx, ents = world.ents, now = world.tick, s = m.spec, end = this.end;
    if ((ents.flags[m.prop]! & F_ALIVE) === 0 || ents.gen[m.prop] !== m.propGen) return false;
    const by = records.byPid.get(m.by) ?? null;
    end.body = -1; end.what = HIT_NONE; end.water = end.sky = false;
    if (now >= m.until) { this.burst(m, by, m.x, m.y, m.z); return false; }
    // Where the target is and goes. One that has gone leaves the missile flying straight.
    let tx = 0, ty = 0, tz = 0, tvx = 0, tvy = 0, tvz = 0, seen = false, radius = 0;
    if (m.sky) {
      if (combat.sky.targets.includes(m.sky) && m.sky.at(now, this.point)) {
        seen = true; tx = this.point.x; ty = this.point.y; tz = this.point.z; tvx = this.point.vx; tvy = this.point.vy; tvz = this.point.vz;
      }
    } else if (m.entity >= 0 && (ents.flags[m.entity]! & F_ALIVE) !== 0 && ents.gen[m.entity] === m.gen) {
      seen = true; lockMiddle(world, m.entity, this.middle);
      tx = this.middle.x; ty = this.middle.y; tz = this.middle.z; tvx = ents.vx[m.entity]!; tvy = ents.vy[m.entity]!; tvz = ents.vz[m.entity]!;
      const def = world.reg.vehicle[ents.kind[m.entity]!];
      radius = def ? Math.min(def.spec.halfWidth, def.spec.halfLength) : world.reg.bodyRadius[ents.kind[m.entity]!]!;
    }
    if (seen) {
      const rx = tx - m.x, ry = ty - m.y, rz = tz - m.z, r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2);
      const wx = tvx - m.vx, wy = tvy - m.vy, wz = tvz - m.vz;
      if (r > 1e-3) {
        // The line of sight's turn rate ω = (r × w) / |r|², and the closing speed Vc = -(r · w) / |r|.
        const ox = (ry * wz - rz * wy) / r2, oy = (rz * wx - rx * wz) / r2, oz = (rx * wy - ry * wx) / r2;
        const closing = Math.max(0, -(rx * wx + ry * wy + rz * wz) / r);
        const k = s.navigation * Math.max(closing, s.speed * .5);
        let ax = k * (oy * rz - oz * ry) / r, ay = k * (oz * rx - ox * rz) / r, az = k * (ox * ry - oy * rx) / r;
        const along = (ax * m.vx + ay * m.vy + az * m.vz) / (s.speed * s.speed);
        ax -= m.vx * along; ay -= m.vy * along; az -= m.vz * along;
        const size = Math.hypot(ax, ay, az);
        if (size > s.turn) { ax *= s.turn / size; ay *= s.turn / size; az *= s.turn / size; }
        m.vx += ax * TICK_DT; m.vy += ay * TICK_DT; m.vz += az * TICK_DT;
        const v = Math.hypot(m.vx, m.vy, m.vz);
        m.vx *= s.speed / v; m.vy *= s.speed / v; m.vz *= s.speed / v;
      }
    }
    const length = s.speed * TICK_DT, dx = m.vx / s.speed, dy = m.vy / s.speed, dz = m.vz / s.speed;
    // The fuse: the nearest the two come within this tick, each moving on as it goes.
    let fuseAt = Infinity;
    if (seen) {
      const rx = tx - m.x, ry = ty - m.y, rz = tz - m.z, wx = tvx - m.vx, wy = tvy - m.vy, wz = tvz - m.vz;
      const w2 = wx * wx + wy * wy + wz * wz;
      const t = w2 > 1e-9 ? Math.max(0, Math.min(TICK_DT, -(rx * wx + ry * wy + rz * wz) / w2)) : 0;
      const gap = Math.hypot(rx + wx * t, ry + wy * t, rz + wz * t);
      const px = m.x + m.vx * t, py = m.y + m.vy * t, pz = m.z + m.vz * t;
      if (m.sky) { if (combat.sky.within(px, py, pz, s.fuse, now - 1 + t * TICK_RATE)) { fuseAt = t * s.speed; end.sky = true; } }
      else if (gap - radius <= s.fuse) fuseAt = t * s.speed;
    }
    let reach = Math.min(length, fuseAt);
    const what = castWorld(world, m.x, m.y, m.z, dx, dy, dz, reach);
    if (what !== HIT_NONE) {
      reach = rayHit.t; end.what = what; end.ref = rayHit.ref; end.nx = rayHit.nx; end.ny = rayHit.ny; end.nz = rayHit.nz; end.sky = false;
    }
    // Neither its shooter nor the jet it left is in its way.
    const shooter = (ents.flags[m.self]! & F_ALIVE) !== 0 ? m.self : -1;
    const body = combat.castBodiesBesides(m.carrier, shooter, m.x, m.y, m.z, dx, dy, dz, reach);
    if (body >= 0) { reach = combat.t; end.body = body; end.what = HIT_NONE; end.sky = false; }
    const sea = world.hf.waterAt(m.x + dx * reach, m.z + dz * reach);
    const wet = m.y + dy * reach <= sea;
    if (end.what !== HIT_NONE || end.body >= 0 || fuseAt <= length || wet) {
      if (wet && end.what === HIT_NONE && end.body < 0 && fuseAt > length) end.water = true;
      // Off what it met it goes off a little short, on the near side.
      const back = end.what !== HIT_NONE ? Math.min(.05, reach) : 0;
      this.burst(m, by, m.x + dx * (reach - back), m.y + dy * (reach - back), m.z + dz * (reach - back));
      return false;
    }
    m.x += m.vx * TICK_DT; m.y += m.vy * TICK_DT; m.z += m.vz * TICK_DT;
    if (m.x < 0 || m.z < 0 || m.x > world.hf.sizeX || m.z > world.hf.sizeZ) return false;
    ents.setPosition(m.prop, m.x, m.y, m.z);
    this.aim(m);
    return true;
  }

  private burst(m: Missile, by: EntityRecord | null, x: number, y: number, z: number): void {
    this.detonated++;
    const s = m.spec.speed;
    this.ctx.projectiles.detonate(by, m.weapon, m.ammo, m.ox, m.oz, x, y, z, m.vx / s, m.vy / s, m.vz / s, this.end);
  }

  /** A missile's prop leaves the world. */
  private out(m: Missile): void {
    const ents = this.ctx.world.ents;
    if ((ents.flags[m.prop]! & F_ALIVE) !== 0 && ents.gen[m.prop] === m.propGen) ents.destroy(m.prop);
  }

  /** What every seeker does this tick to the entities it looks at, and to those a missile chases. */
  private warn(): void {
    const danger = this.danger;
    if (danger.size > 0) danger.clear();
    let locks = 0;
    for (const a of this.arms.values()) {
      const lock = a.lock;
      if (!lock) continue;
      locks++;
      if (lock.entity < 0) continue;
      danger.set(lock.entity, Math.max(danger.get(lock.entity) ?? 0, lock.locked ? WARN_LOCKED : WARN_SEEKING));
    }
    this.locks = locks;
    for (let i = 0; i < this.missiles.length; i++) { const m = this.missiles[i]!; if (m.entity >= 0) danger.set(m.entity, WARN_MISSILE); }
  }
}
