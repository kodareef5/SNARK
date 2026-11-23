import { CHUNK_SIZE, TICK_DT, TICK_RATE, chunkAt } from "../shared/coords.ts";
import { makeHandle } from "../shared/ids.ts";
import { CMD_AIR_SUPPORT, CMD_CHAT, RESULT_BUSY, RESULT_DENIED, RESULT_INVALID, RESULT_OK, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { AIR_BAYS, AIR_VIEW_LIMIT, type AirDrone, type AirPose, type AirSupportView } from "../shared/sim/air-support.ts";
import { droneLookPitch, droneLookYaw, droneMove, droneStep, type DroneTravel } from "../shared/sim/air-drone.ts";
import { BTN_AIR_REMOTE, BTN_SPRINT } from "../shared/sim/character.ts";
import { DMG_EXPLOSIVE } from "../shared/sim/damage.ts";
import { F_ALIVE, F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { vehicleRotation } from "../shared/sim/vehicle-frame.ts";
import { HIT_NONE, castWorld, rayHit } from "../shared/world/ray.ts";
import { bodyAlong } from "../shared/world/water.ts";
import { SURVEY_DRONE_ART } from "../content/vehicles/air-freight-art.ts";
import type { Frame } from "./air-cargo-space.ts";
import type { Combat } from "./combat.ts";
import type { Client, GameServer } from "./game.ts";
import type { Projectiles } from "./projectiles.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Urban } from "./urban.ts";
import type { ServerWorld } from "./world.ts";

export interface AirFlightContext {
  world: ServerWorld;
  game: GameServer;
  combat: Combat;
  projectiles: Projectiles;
  rules: Rules;
  records: Records;
  urban: Urban;
  valid(c: Client, rack: number): boolean;
  /** The trailer entity of rack `rack`, which its own drones fly out of, or -1. */
  spare?(rack: number): number;
  /** Puts a vehicle in the world; `transient` ones are never saved. */
  spawn(id: string, at: Frame, team: number, opts?: { health?: number; transient?: boolean }): number;
  discard(e: number): void;
  wake?(chunk: number, delta: number): void;
}

interface Flight extends AirDrone {
  rack: number;
  capacity: number;
  burn: number;
  boostBurn: number;
  damage: number;
  radius: number;
  range: number;
  lookYaw: number;
  lookPitch: number;
  boost: boolean;
  chunk: number;
  /** The drone's own record: a vehicle in the world that can be shot down. */
  pid: number;
  /** Where its link reaches from, if its rack is gone. */
  homeX: number; homeZ: number;
}

const q = new Float64Array(4);
const travel: DroneTravel = { dx: 0, dy: 0, dz: 0, length: 0 };

export class AirFlights {
  private readonly flights = new Map<Client, Flight>();
  private nextId = 1;
  private readonly notices = new WeakMap<Client, { until: number; text: string }>();
  private readonly flown = new Set<number>();

  private readonly ctx: AirFlightContext;

  constructor(ctx: AirFlightContext) {
    this.ctx = ctx;
    const { game } = ctx;
    game.players.remoteInput = (c, tick) => this.input(c, tick);
    game.replication.cameraChunk = (c) => this.flights.get(c)?.chunk;
    game.players.allows.on((c, op) => !this.active(c) || op === CMD_AIR_SUPPORT || op === CMD_CHAT);
    game.sessions.onPresence.on(c => { if (c.closed) this.abort(c); });
    game.sessions.onExit.on(c => { this.forget(c); });
    game.sessions.onBodyGone.on(c => { this.abort(c); });
  }

  active(c: Client): boolean { return this.flights.has(c); }

  /** Whether record `pid` is a drone in flight, moved here rather than by the vehicle system. */
  flies(pid: number): boolean { return this.flown.has(pid); }

  camera(c: Client): Readonly<AirDrone> | undefined { return this.flights.get(c); }

  private permitted(c: Client, rack: number): boolean {
    const rec = this.ctx.records.byPid.get(c.pid);
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0 && !!rec && !rec.out && !rec.dead && !this.ctx.game.players.isDown(c.ent) && this.ctx.valid(c, rack);
  }

  /** The live entity of record `pid`, or -1. */
  private entity(pid: number): number {
    const ents = this.ctx.world.ents, e = this.ctx.records.entOf.get(pid) ?? -1;
    return e >= 0 && ents.pid[e] === pid && (ents.flags[e]! & (F_ALIVE | F_PROP)) === F_ALIVE ? e : -1;
  }

  launch(c: Client, origin: AirPose, rack: number, slot: number): number {
    if (this.active(c)) return RESULT_BUSY;
    if (!Number.isInteger(slot) || slot < 0 || slot >= AIR_BAYS) return RESULT_INVALID;
    if (!this.permitted(c, rack)) return RESULT_DENIED;
    const { rules, world, records } = this.ctx;
    const team = records.byPid.get(c.pid)?.team ?? 0;
    const e = this.ctx.spawn(SURVEY_DRONE_ART.id, { ...origin, qx: 0, qy: Math.sin(origin.yaw / 2), qz: 0, qw: Math.cos(origin.yaw / 2) }, team,
      { health: rules.num("AirDroneHealth"), transient: true });
    if (e < 0) return RESULT_BUSY;
    const ents = world.ents;
    const f: Flight = {
      ...origin, rack, bay: slot, id: this.nextId++, fuel: 1, pitch: 0, launched: world.tick, signal: 1,
      ent: makeHandle(e, ents.gen[e]!), pid: ents.pid[e]!,
      capacity: rules.num("AirDroneFuel"), burn: rules.num("AirDroneBurn"), boostBurn: rules.num("AirDroneBoostBurn"),
      speed: rules.num("AirDroneSpeed"), turn: rules.num("AirDroneTurnRate") * Math.PI / 180,
      damage: rules.num("AirDroneDamage"), radius: rules.num("AirDroneRadius"), range: rules.num("AirDroneRange"),
      lookYaw: origin.yaw, lookPitch: 0.27, boost: false, chunk: chunkAt(world.dims, origin.x, origin.z),
      homeX: origin.x, homeZ: origin.z,
    };
    f.x = Math.fround(f.x); f.y = Math.fround(f.y); f.z = Math.fround(f.z); f.yaw = Math.fround(f.yaw);
    this.flights.set(c, f);
    this.flown.add(f.pid);
    this.notices.delete(c);
    this.watch(f.chunk, 1);
    this.place(f, e, 0, 0, 0);
    return RESULT_OK;
  }

  private input(c: Client, tick: number): boolean {
    const f = this.flights.get(c);
    if (!f) return false;
    if (c.inputs.has(tick) && (c.heldButtons & BTN_AIR_REMOTE) !== 0) {
      f.lookYaw = droneLookYaw(c.heldYaw);
      f.lookPitch = droneLookPitch(c.heldPitch);
      f.boost = (c.heldButtons & BTN_SPRINT) !== 0;
    }
    return true;
  }

  /** The drone's entity where its flight has it, turning its impellers, for everyone who can see it. */
  private place(f: Flight, e: number, vx: number, vy: number, vz: number): void {
    const { world, urban } = this.ctx, ents = world.ents, v = ents.vrow[e]!;
    ents.setPosition(e, f.x, f.y, f.z);
    vehicleRotation({ x: f.x, y: f.y, z: f.z, yaw: f.yaw, pitch: f.pitch, roll: 0 }, q);
    ents.vehicleQx[v] = Math.fround(q[0]!); ents.vehicleQy[v] = Math.fround(q[1]!); ents.vehicleQz[v] = Math.fround(q[2]!); ents.vehicleQw[v] = Math.fround(q[3]!);
    ents.vehicleYaw[v] = Math.fround(f.yaw); ents.vehiclePitch[v] = Math.fround(f.pitch); ents.vehicleRoll[v] = 0;
    ents.vx[e] = Math.fround(vx); ents.vy[e] = Math.fround(vy); ents.vz[e] = Math.fround(vz);
    ents.vehicleEngineOn[v] = 1;
    const rpm = (world.reg.vehicle[ents.kind[e]!] as { spec?: { rotorRpm?: number } } | undefined)?.spec?.rotorRpm ?? 2400;
    ents.vehicleRotorRpm[v] = rpm * (f.boost ? 1.25 : 1);
    ents.vehicleRotorPhase[v] = (ents.vehicleRotorPhase[v]! + ents.vehicleRotorRpm[v]! * Math.PI * 2 / 60 * TICK_DT) % (Math.PI * 2);
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    urban.syncAfterContact(e);
  }

  step(tick: number): void {
    const { world, combat } = this.ctx;
    for (const [c, f] of this.flights) {
      const e = this.entity(f.pid);
      if (e < 0) { this.downed(c, f); continue; }
      if (!this.permitted(c, f.rack)) { this.finish(c, "Drone link lost"); continue; }
      f.fuel = Math.max(0, f.fuel - (f.boost ? f.boostBurn : f.burn) * TICK_DT / f.capacity);
      if (f.fuel <= 0) { this.finish(c, "Drone fuel exhausted"); continue; }
      const home = this.ctx.spare?.(f.rack) ?? -1;
      const hx = home >= 0 ? world.ents.x[home]! : f.homeX, hz = home >= 0 ? world.ents.z[home]! : f.homeZ;
      const reach = Math.hypot(f.x - hx, f.z - hz) / f.range;
      f.signal = Math.max(0, Math.min(1, 1 - reach * reach));
      if (reach > 1) { this.finish(c, "Drone out of range. Link lost"); continue; }
      const age = tick - f.launched;
      if (age === 0) continue;
      droneStep(f, age, f.lookYaw, f.lookPitch, f.boost, f, travel);
      const { dx, dy, dz, length } = travel;
      const solid = castWorld(world, f.x, f.y, f.z, dx, dy, dz, length) !== HIT_NONE;
      const solidAt = solid ? rayHit.t : Infinity;
      const waterAt = bodyAlong(world.hf.water, f.x, f.y, f.z, dx, dy, dz, length);
      const stop = Math.min(length, solidAt, waterAt);
      const body = combat.castBodiesBesides(home, e, f.x, f.y, f.z, dx, dy, dz, stop);
      const hit = body >= 0 || solidAt <= length || waterAt <= length;
      const distance = hit ? Math.max(0, (body >= 0 ? combat.t : stop) - 0.05) : length;
      droneMove(f, travel, distance);
      if (f.x < 0 || f.z < 0 || f.x >= world.hf.sizeX || f.z >= world.hf.sizeZ) { this.finish(c, "Drone left the map"); continue; }
      this.place(f, e, dx * distance / TICK_DT, dy * distance / TICK_DT, dz * distance / TICK_DT);
      if (hit) { this.payload(c, f, body); continue; }
      const chunk = chunkAt(world.dims, f.x, f.z);
      if (chunk !== f.chunk) {
        this.watch(chunk, 1);
        this.watch(f.chunk, -1);
        f.chunk = chunk;
      }
    }
  }

  trigger(c: Client): number {
    const f = this.flights.get(c);
    if (!f || !this.permitted(c, f.rack)) return RESULT_DENIED;
    this.payload(c, f, -1);
    return RESULT_OK;
  }

  private payload(c: Client, f: Flight, direct: number): void {
    const { combat, records, projectiles, world } = this.ctx;
    this.finish(c, "Drone payload spent");
    const by = records.byPid.get(c.pid) ?? null;
    projectiles.boom(f.x, f.y, f.z, f.radius, by?.name, c);
    combat.blast({
      by, item: world.reg.index.get("core:grenade") ?? 0, base: f.damage, type: DMG_EXPLOSIVE,
      x: f.x, z: f.z, attack: 1, draw: 1, quality: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0,
    }, f.x, f.y, f.z, f.radius, direct);
  }

  /** Shot down: it bursts where it was, harmlessly, and its operator's picture cuts out. */
  private downed(c: Client, f: Flight): void {
    this.ctx.projectiles.boom(f.x, f.y, f.z, 1.2, null, c);
    this.finish(c, "Drone shot down. Signal lost");
  }

  abort(c: Client): number {
    if (!this.active(c)) return RESULT_DENIED;
    this.finish(c, "Drone link closed");
    return RESULT_OK;
  }

  private finish(c: Client, text: string): void {
    this.forget(c);
    this.notices.set(c, { text, until: this.ctx.world.tick + 2 * TICK_RATE });
  }

  private forget(c: Client): void {
    const f = this.flights.get(c);
    if (!f) return;
    this.flights.delete(c);
    this.flown.delete(f.pid);
    this.watch(f.chunk, -1);
    const e = this.entity(f.pid);
    if (e >= 0) this.ctx.discard(e);
  }

  private watch(chunk: number, delta: number): void {
    const { wake, world } = this.ctx;
    if (!wake) return;
    const { chunksX, chunksZ } = world.dims;
    const cx = chunk % chunksX, cz = Math.floor(chunk / chunksX);
    for (let z = Math.max(0, cz - 1); z <= Math.min(chunksZ - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(chunksX - 1, cx + 1); x++) wake(z * chunksX + x, delta);
    }
  }

  view(c: Client, into: AirSupportView): void {
    const own = this.flights.get(c);
    into.flight = own?.id ?? 0;
    const near = own ?? c.body;
    const reach = CHUNK_SIZE * (1 + this.ctx.game.opts.entityRadius);
    if (own) into.drones.push(own);
    for (const f of this.flights.values()) {
      if (into.drones.length >= AIR_VIEW_LIMIT) break;
      if (f !== own && Math.abs(f.x - near.x) <= reach && Math.abs(f.z - near.z) <= reach) into.drones.push(f);
    }
    const notice = this.notices.get(c);
    if (notice && notice.until > this.ctx.world.tick) into.notice = notice.text;
  }
}
